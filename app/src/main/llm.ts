import { net } from 'electron'
import type { ChatMessage, LlmTestResult, ProviderConfig } from '@shared/types'
import { broadcast } from './ipc'
import { getTextProvider } from './settingsStore'

/**
 * 主进程 LLM 代理：chat/completions 流式转发（SSE → IPC 事件）
 * 渲染进程不直接碰网络与 Key
 * 用 Electron net.fetch（Chromium 网络栈，自动走系统代理），Node undici fetch 不走代理会直连超时
 */

const activeRequests = new Map<string, AbortController>()

function chatUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions'
}

/** Key 为空时不带 Authorization（本地网关可能免鉴权，由服务端自己决定） */
function authHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) h.Authorization = `Bearer ${apiKey}`
  return h
}

/**
 * 从响应体提取回复文本。兼容三种形态：
 * 标准单 JSON；无视 stream:false 返回的 SSE（data: 前缀）；NDJSON 逐行 JSON
 */
function extractReply(body: string): string {
  try {
    const j = JSON.parse(body) as { choices?: { message?: { content?: string }; delta?: { content?: string } }[] }
    return j.choices?.[0]?.message?.content ?? j.choices?.[0]?.delta?.content ?? ''
  } catch {
    let out = ''
    for (const raw of body.split('\n')) {
      let line = raw.trim()
      if (line.startsWith('data:')) line = line.slice(5).trim()
      if (!line || line === '[DONE]') continue
      try {
        const j = JSON.parse(line) as { choices?: { message?: { content?: string }; delta?: { content?: string } }[] }
        out += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? ''
      } catch {
        // 非 JSON 行（心跳/注释）忽略
      }
    }
    return out
  }
}

/** 试连：发一条最小 chat 请求（比 /models 更能证明 Key/模型可用） */
export async function testProvider(provider: ProviderConfig): Promise<LlmTestResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  try {
    const res = await net.fetch(chatUrl(provider.baseUrl), {
      method: 'POST',
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({
        model: provider.textModel,
        messages: [{ role: 'user', content: 'ping，请仅回复 pong' }],
        max_tokens: 8
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300)
      return { ok: false, message: `HTTP ${res.status}：${text}` }
    }
    // 部分网关（9router 等）响应不是单 JSON，统一走容错提取
    const reply = extractReply(await res.text())
    return { ok: true, message: `连接成功，模型 ${provider.textModel} 已响应（${reply.slice(0, 40)}）` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, message: ctrl.signal.aborted ? '连接超时（30s）' : msg }
  } finally {
    clearTimeout(timer)
  }
}

/** 非流式对话（M8 能力核用）：直接返回全文，不走 IPC 广播 */
export async function chatComplete(messages: ChatMessage[], timeoutMs = 300_000): Promise<string> {
  const provider = getTextProvider()
  if (!provider) throw new Error('未配置模型供应商，请先在「模型接入」中设置')
  const res = await net.fetch(chatUrl(provider.baseUrl), {
    method: 'POST',
    headers: authHeaders(provider.apiKey),
    body: JSON.stringify({ model: provider.textModel, messages }),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}：${(await res.text()).slice(0, 300)}`)
  const reply = extractReply(await res.text())
  if (!reply.trim()) throw new Error('模型返回了空回复')
  return reply
}

/** 发起流式对话：增量经 llm:stream 广播，结束发 llm:done */
export async function chatStart(requestId: string, messages: ChatMessage[]): Promise<void> {
  const provider = getTextProvider()
  if (!provider) {
    broadcast('llm:done', { requestId, error: '未配置模型供应商，请先在「模型接入」中设置' })
    return
  }

  const ctrl = new AbortController()
  activeRequests.set(requestId, ctrl)
  try {
    const res = await net.fetch(chatUrl(provider.baseUrl), {
      method: 'POST',
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({ model: provider.textModel, messages, stream: true }),
      signal: ctrl.signal
    })
    if (!res.ok || !res.body) {
      const text = (await res.text()).slice(0, 300)
      broadcast('llm:done', { requestId, error: `HTTP ${res.status}：${text}` })
      return
    }

    // SSE 解析：按行切 data: 前缀，[DONE] 结束；跨 chunk 断行用 buffer 兜住
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        // 兼容 SSE（data: 前缀）与 NDJSON（裸 JSON 行）两种流格式
        let line = raw.trim()
        if (line.startsWith('data:')) line = line.slice(5).trim()
        if (!line || line === '[DONE]') continue
        try {
          const json = JSON.parse(line) as { choices?: { delta?: { content?: string } }[] }
          const delta = json.choices?.[0]?.delta?.content
          if (delta) broadcast('llm:stream', { requestId, delta })
        } catch {
          // 非 JSON 心跳行，忽略
        }
      }
    }
    broadcast('llm:done', { requestId })
  } catch (err) {
    if (ctrl.signal.aborted) {
      broadcast('llm:done', { requestId, error: '已中止' })
    } else {
      broadcast('llm:done', { requestId, error: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    activeRequests.delete(requestId)
  }
}

export function abortChat(requestId: string): void {
  activeRequests.get(requestId)?.abort()
}
