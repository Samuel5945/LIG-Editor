import { net } from 'electron'
import type { ChatMessage, ChatStartOptions, LlmTestResult, ProviderConfig } from '@shared/types'
import { modelCapability } from '@shared/modelCatalog'
import { broadcast } from './ipc'
import { apiUserAgent, friendlyHttpError } from './apiUa'

/**
 * Anthropic Messages 兼容适配（商汤等双协议供应商）：
 * 把应用内部的 OpenAI 形状消息映射为 /v1/messages 请求，把 Anthropic SSE 归一回
 * llm:stream / llm:done 相同事件，渲染层不感知协议差异。
 * 端点 = baseUrl + '/messages'（baseUrl 统一带 /v1，避免 /v1/v1/messages 叠加 404）
 * 网络用 net.fetch（走系统代理），与 llm.ts 同理
 */

const ANTHROPIC_VERSION = '2023-06-01'
/** thinking 预算：商汤网关上限 1024（实测 >1024 返回 invalid_request），标准 Anthropic 最小 1024，两者兼容 */
const THINKING_BUDGET = 1024

function messagesUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/messages'
}

/** 商汤等兼容网关对 x-api-key / Bearer 均接受，双发以覆盖两种实现；
 * UA 覆盖为纯 ASCII（中文 UA 会被 gRPC 网关 500，见 apiUa.ts） */
function authHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'User-Agent': apiUserAgent()
  }
  if (apiKey) {
    h['x-api-key'] = apiKey
    h.Authorization = `Bearer ${apiKey}`
  }
  return h
}

/** dataURL → { media_type, data }；非 dataURL（http 直链）返回 null，Anthropic 协议仅接受 base64 */
function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(url)
  return m ? { mediaType: m[1], data: m[2] } : null
}

function textOfContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .map((p) => (p.type === 'text' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
}

/** OpenAI 形状消息 → Anthropic 请求体（system 提字段、tool 消息转 tool_result 块、空消息剔除） */
export function toAnthropicBody(
  provider: ProviderConfig,
  messages: ChatMessage[],
  options?: ChatStartOptions & { stream: boolean }
): Record<string, unknown> {
  const cap = modelCapability(provider, provider.textModel)
  const maxOut = cap.maxOutput ?? 8192

  const systemParts: string[] = []
  const out: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      const t = textOfContent(msg.content)
      if (t) systemParts.push(t)
      continue
    }
    if (msg.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id ?? '', content: textOfContent(msg.content) }]
      })
      continue
    }
    const blocks: Record<string, unknown>[] = []
    if (typeof msg.content === 'string') {
      if (msg.content) blocks.push({ type: 'text', text: msg.content })
    } else {
      for (const part of msg.content) {
        if (part.type === 'text') {
          if (part.text) blocks.push({ type: 'text', text: part.text })
        } else {
          const img = parseDataUrl(part.image_url.url)
          if (img) blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
        }
      }
    }
    // assistant 历史里的工具调用 → tool_use 块（思考过程不发回，Anthropic thinking 块有专用回传规则）
    for (const tc of msg.tool_calls ?? []) {
      let input: unknown = {}
      try {
        input = JSON.parse(tc.function.arguments || '{}')
      } catch {
        input = {}
      }
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
    }
    if (blocks.length) out.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: blocks })
  }

  // 商汤等思考模型默认就输出 thinking 块：思考开关只对声明了 reasoning 的模型下发——
  // 开 = enabled（预算按网关上限 1024），关 = 显式 disabled（实测能真正关掉默认思考）；无思考能力的模型不发该字段
  const thinkingWanted = options?.thinking ?? cap.reasoning?.defaultOn ?? false
  return {
    model: provider.textModel,
    ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
    messages: out,
    max_tokens: Math.max(maxOut, THINKING_BUDGET + 1024),
    stream: options?.stream ?? false,
    ...(cap.reasoning ? { thinking: thinkingWanted ? { type: 'enabled', budget_tokens: THINKING_BUDGET } : { type: 'disabled' } } : {}),
    ...(options?.tools?.length
      ? { tools: options.tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) }
      : {})
  }
}

/** 试连：发一条最小 messages 请求 */
export async function anthropicTestProvider(provider: ProviderConfig): Promise<LlmTestResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  try {
    const res = await net.fetch(messagesUrl(provider.baseUrl), {
      method: 'POST',
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({
        model: provider.textModel,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping，请仅回复 pong' }] }],
        max_tokens: 8
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300)
      return { ok: false, message: friendlyHttpError(res.status, text) }
    }
    const json = (await res.json()) as { content?: { type: string; text?: string }[] }
    const reply = (json.content ?? [])
      .map((b) => (b.type === 'text' ? b.text ?? '' : ''))
      .join('')
      .slice(0, 40)
    return { ok: true, message: `连接成功，模型 ${provider.textModel} 已响应（${reply}）` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, message: ctrl.signal.aborted ? '连接超时（30s）' : msg }
  } finally {
    clearTimeout(timer)
  }
}

/** 非流式对话：拼接 text 块。signal 可外部中止（如上下文摘要随对话「停止」一起取消） */
export async function anthropicChatComplete(
  provider: ProviderConfig,
  messages: ChatMessage[],
  timeoutMs = 300_000,
  signal?: AbortSignal,
  thinking?: boolean
): Promise<string> {
  const res = await net.fetch(messagesUrl(provider.baseUrl), {
    method: 'POST',
    headers: authHeaders(provider.apiKey),
    body: JSON.stringify(toAnthropicBody(provider, messages, { stream: false, thinking })),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(friendlyHttpError(res.status, (await res.text()).slice(0, 300)))
  const json = (await res.json()) as { content?: { type: string; text?: string }[] }
  const reply = (json.content ?? []).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('')
  if (!reply.trim()) throw new Error('模型返回了空回复')
  return reply
}

interface ToolAccEntry {
  id: string
  name: string
  arguments: string
}

/** 发起流式对话（由 llm.ts 持有 AbortController 并注册 activeRequests） */
export async function anthropicChatStart(ctx: {
  requestId: string
  provider: ProviderConfig
  messages: ChatMessage[]
  options?: ChatStartOptions
  signal: AbortSignal
}): Promise<void> {
  const { requestId, provider, messages, options, signal } = ctx
  try {
    const init: RequestInit = {
      method: 'POST',
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify(toAnthropicBody(provider, messages, { stream: true, thinking: options?.thinking, tools: options?.tools })),
      signal
    }
    let res = await net.fetch(messagesUrl(provider.baseUrl), init)
    if (res.status === 429) {
      // 限流：静默等 4 秒重试一次（429 的请求未被服务端执行，重试不重复计费）
      await new Promise((r) => setTimeout(r, 4000))
      res = await net.fetch(messagesUrl(provider.baseUrl), init)
    }
    if (!res.ok || !res.body) {
      const text = (await res.text()).slice(0, 300)
      broadcast('llm:done', { requestId, error: friendlyHttpError(res.status, text) })
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    const tools = new Map<number, ToolAccEntry>()
    let errored = false
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        let line = raw.trim()
        if (!line.startsWith('data:')) continue
        line = line.slice(5).trim()
        if (!line || line === '[DONE]') continue
        try {
          const json = JSON.parse(line) as {
            type: string
            error?: { message?: string }
            content_block?: { type: string; id?: string; name?: string }
            index?: number
            delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
          }
          if (json.type === 'error') {
            errored = true
            broadcast('llm:done', { requestId, error: json.error?.message ?? 'Anthropic 流错误' })
            return
          }
          if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
            tools.set(json.index ?? 0, { id: json.content_block.id ?? '', name: json.content_block.name ?? '', arguments: '' })
          } else if (json.type === 'content_block_delta') {
            if (json.delta?.type === 'text_delta' && json.delta.text) {
              broadcast('llm:stream', { requestId, delta: json.delta.text })
            } else if (json.delta?.type === 'thinking_delta' && json.delta.thinking) {
              broadcast('llm:stream', { requestId, delta: '', reasoning: json.delta.thinking })
            } else if (json.delta?.type === 'input_json_delta' && json.delta.partial_json) {
              const t = tools.get(json.index ?? 0)
              if (t) t.arguments += json.delta.partial_json
            }
          }
        } catch {
          // 非 JSON 心跳行（event: 行、ping 注释），忽略
        }
      }
    }
    if (errored) return
    const list = [...tools.values()]
    broadcast('llm:done', {
      requestId,
      toolCalls: list.length
        ? list.map((t, i) => ({ id: t.id || `call_${i}`, name: t.name, arguments: t.arguments || '{}' }))
        : undefined
    })
  } catch (err) {
    if (signal.aborted) {
      broadcast('llm:done', { requestId, error: '已中止' })
    } else {
      broadcast('llm:done', { requestId, error: err instanceof Error ? err.message : String(err) })
    }
  }
}
