import { net } from 'electron'
import type {
  ChatMessage,
  ChatStartOptions,
  FetchModelsResult,
  LlmTestResult,
  ModelInfo,
  ProviderConfig,
  ProviderModelsResult
} from '@shared/types'
import { accumulateToolCalls } from '@shared/llmText'
import { knownImageModels } from '@shared/providerSites'
import { classifyModels, estimateTokens, modelCapability } from '@shared/modelCatalog'
import { broadcast } from './ipc'
import { getLlmSettings, getTextProvider, saveProviderModels } from './settingsStore'
import { anthropicChatComplete, anthropicChatStart, anthropicTestProvider } from './llmAnthropic'
import { apiUserAgent, friendlyHttpError } from './apiUa'

/**
 * 主进程 LLM 代理：按供应商协议分发（OpenAI 兼容 /chat/completions 或 Anthropic 兼容 /messages）
 * 流式增量统一经 llm:stream IPC 事件转发（思考过程走 reasoning 字段），渲染进程不直接碰网络与 Key
 * 用 Electron net.fetch（Chromium 网络栈，自动走系统代理），Node undici fetch 不走代理会直连超时
 */

const activeRequests = new Map<string, AbortController>()
/** 进行中的模型列表刷新（按供应商 id 去重，避免启动刷新与手动刷新重复打接口） */
const refreshingModels = new Set<string>()

function chatUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions'
}

/** Key 为空时不带 Authorization（本地网关可能免鉴权，由服务端自己决定）。
 * UA 必须覆盖为纯 ASCII：Electron 默认 UA 带中文应用名，商汤 gRPC 网关拒收（500） */
function authHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': apiUserAgent() }
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

/** OpenAI 兼容路径的思考控制参数（Anthropic 路径在 llmAnthropic 内处理）：
 * - enable_thinking：双向开关（qwen3.5/3.6/3.7 系、qwen-plus/flash）
 * - reasoning_effort：开=发档位，关=不发（qwen3.8 系恒思考，无关闭档）
 * - 无参数声明（商汤 deepseek/kimi 系）：服务端默认开思考，不发 */
function openaiThinkingParams(provider: ProviderConfig, options?: ChatStartOptions): Record<string, unknown> {
  const cap = modelCapability(provider, provider.textModel)
  if (!cap.reasoning?.openaiParam) return {}
  const on = options?.thinking ?? cap.reasoning.defaultOn
  if (cap.reasoning.openaiParam === 'enable_thinking') return { enable_thinking: on }
  return on ? { reasoning_effort: 'medium' } : {}
}

// ---- 上下文自动压缩 ----

/** 从消息 content 提取纯文本（压缩/transcript 用） */
function contentTextOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content.filter((p) => p.type === 'text').map((p) => p.text).join('')
}

const SUMMARY_SYSTEM =
  '你是对话压缩器。把下面的对话记录压缩成一份供后续对话继续使用的摘要，要求：\n' +
  '- 保留：用户的目标与意图、已确认的决定与偏好、关键事实与数据（数字、名称、路径）、未完成的任务、AI 已承诺或已生成的内容要点\n' +
  '- 丢弃：寒暄、重复内容、与目标无关的细节\n' +
  '- 用简洁的要点列表，总长不超过 500 字，只输出摘要本身，不要任何评论或开场白'

/** 把任意消息序列压平为一段带角色标注的纯文本记录：摘要请求不含工具/多模态形状，任何协议都安全 */
function transcriptOf(msgs: ChatMessage[]): string {
  return msgs
    .map((m) => {
      const role = m.role === 'assistant' ? 'AI' : m.role === 'user' ? '用户' : m.role === 'tool' ? '工具结果' : '系统'
      let text = contentTextOf(m.content)
      if (m.tool_calls?.length) {
        text += (text ? '\n' : '') + `[调用工具] ${m.tool_calls.map((t) => t.function.name).join('、')}`
      }
      return `${role}: ${text}`
    })
    .join('\n')
}

/** 用当前模型把旧消息摘要成一段文字（非流式，随对话「停止」一起中止；失败抛错由调用方回退截断） */
async function summarizeMessages(provider: ProviderConfig, old: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const body: ChatMessage[] = [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: `对话记录：\n${transcriptOf(old)}` }
  ]
  if (provider.api === 'anthropic-messages') {
    // 内部工具性调用不消耗思考
    return anthropicChatComplete(provider, body, 180_000, signal, false)
  }
  const res = await net.fetch(chatUrl(provider.baseUrl), {
    method: 'POST',
    headers: authHeaders(provider.apiKey),
    body: JSON.stringify({
      model: provider.textModel,
      messages: body,
      max_tokens: 2048,
      ...openaiThinkingParams(provider, { thinking: false })
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000)
  })
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}：${(await res.text()).slice(0, 300)}`)
  return extractReply(await res.text())
}

/**
 * 上下文自动压缩：估算 token 超过模型窗口 70% 时触发——把「最近一段（窗口 35% 预算、按 user 边界
 * 成段保留）」之外的旧消息交给当前模型摘要，摘要并入系统提示后与最近段一起发出。
 * 只影响发给模型的内容，不动可见历史与会话落盘；摘要失败回退为截断（并告知模型历史被省略）。
 * 压缩后的请求远低于阈值，工具循环的后续轮不会重复触发。
 */
async function compactMessages(provider: ProviderConfig, messages: ChatMessage[], signal?: AbortSignal): Promise<ChatMessage[]> {
  const cap = modelCapability(provider, provider.textModel)
  if (!cap.contextWindow) return messages
  const total = messages.reduce((s, m) => s + estimateTokens(m.content), 0)
  if (total <= cap.contextWindow * 0.7) return messages
  const hasSystem = messages.length > 0 && messages[0].role === 'system'
  const head = hasSystem ? messages.slice(0, 1) : []
  const body = hasSystem ? messages.slice(1) : messages
  // 与截断同一落刀规则：只从 user 消息处切，assistant(tool_calls) 与其后 tool 结果成组不被拆散
  const suffix: number[] = new Array(body.length + 1).fill(0)
  for (let i = body.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + estimateTokens(body[i].content)
  let cut = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i].role === 'user' && suffix[i] <= cap.contextWindow * 0.35) {
      cut = i
      break
    }
  }
  if (cut === 0) return messages
  const old = body.slice(0, cut)
  const recent = body.slice(cut)
  let summary = ''
  try {
    summary = await summarizeMessages(provider, old, signal)
  } catch {
    // 摘要失败（含被中止后恢复的网络错误）：回退截断，不让压缩拖垮主请求
  }
  const summaryBlock = summary
    ? `[此前对话摘要——更早的完整消息已自动压缩，以下是要点]\n${summary}`
    : `[注意：更早的 ${old.length} 条消息因超出模型上下文已被省略]`
  if (head.length) {
    return [{ ...head[0], content: `${contentTextOf(head[0].content)}\n\n${summaryBlock}` }, ...recent]
  }
  return [{ role: 'system', content: summaryBlock }, ...recent]
}

/** 试连：发一条最小 chat 请求（比 /models 更能证明 Key/模型可用） */
export async function testProvider(provider: ProviderConfig): Promise<LlmTestResult> {
  if (provider.api === 'anthropic-messages') return anthropicTestProvider(provider)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  try {
    // 思考模型的思考内容也计入输出 tokens，max_tokens 给足避免误报失败
    const cap = modelCapability(provider, provider.textModel)
    const res = await net.fetch(chatUrl(provider.baseUrl), {
      method: 'POST',
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({
        model: provider.textModel,
        messages: [{ role: 'user', content: 'ping，请仅回复 pong' }],
        max_tokens: cap.reasoning ? 1024 : 8
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300)
      return { ok: false, message: friendlyHttpError(res.status, text) }
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

/** 拉取供应商可用模型列表（GET /v1/models，OpenAI 标准接口）。
 * 部分供应商（如基元律动）的 /v1/models 不含生图模型，用精选目录 knownImageModels 并入补齐 */
export async function fetchModels(provider: ProviderConfig): Promise<FetchModelsResult> {
  const url = provider.baseUrl.replace(/\/+$/, '') + '/models'
  const known = knownImageModels(provider)
  const knownAsModels: ModelInfo[] = known.map((id) => ({ id }))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await net.fetch(url, {
      method: 'GET',
      headers: authHeaders(provider.apiKey),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300)
      // 列表拉取失败但有精选生图模型时照样返回，图像模型下拉仍可选
      if (knownAsModels.length > 0) return { ok: true, models: knownAsModels }
      return { ok: false, models: [], error: `HTTP ${res.status}：${text}` }
    }
    const json = (await res.json()) as { data?: { id: string; owned_by?: string }[] }
    const models: ModelInfo[] = (json.data ?? [])
      .filter((m) => typeof m.id === 'string' && m.id.length > 0)
      .map((m) => ({ id: m.id, owned_by: m.owned_by }))
    const merged = [
      ...models,
      ...knownAsModels.filter((k) => !models.some((m) => m.id === k.id))
    ].sort((a, b) => a.id.localeCompare(b.id))
    if (merged.length === 0) {
      return { ok: false, models: [], error: '接口返回了空模型列表' }
    }
    return { ok: true, models: merged }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (knownAsModels.length > 0) return { ok: true, models: knownAsModels }
    return { ok: false, models: [], error: ctrl.signal.aborted ? '请求超时（15s）' : msg }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 拉取并刷新某供应商的模型列表缓存：拉取 → 按文本/生图分类 → 落盘 → 返回分类结果。
 * 失败时回退该供应商已缓存的列表（refreshed=false）。启动自动刷新与设置界面手动刷新共用。
 */
export async function refreshProviderModels(provider: ProviderConfig): Promise<ProviderModelsResult> {
  if (refreshingModels.has(provider.id)) {
    return {
      ok: true,
      text: provider.models?.text ?? [],
      image: provider.models?.image ?? [],
      refreshed: false,
      updatedAt: provider.models?.updatedAt
    }
  }
  refreshingModels.add(provider.id)
  try {
    const result = await fetchModels(provider)
    if (!result.ok) {
      return {
        ok: false,
        text: provider.models?.text ?? [],
        image: provider.models?.image ?? [],
        refreshed: false,
        updatedAt: provider.models?.updatedAt,
        error: result.error
      }
    }
    const classified = classifyModels(provider, result.models.map((m) => m.id))
    // 当前选中值始终保留在对应列表里（避免目录/关键词未收录的选中模型从下拉里消失）
    if (provider.textModel && !classified.text.some((m) => m.id === provider.textModel)) {
      classified.text.unshift({ id: provider.textModel })
    }
    if (provider.imageModel && !classified.image.some((m) => m.id === provider.imageModel)) {
      classified.image.unshift({ id: provider.imageModel })
    }
    const cache = { text: classified.text, image: classified.image, updatedAt: new Date().toISOString() }
    saveProviderModels(provider.id, cache)
    return { ok: true, text: cache.text, image: cache.image, refreshed: true, updatedAt: cache.updatedAt }
  } finally {
    refreshingModels.delete(provider.id)
  }
}

/** 启动自动刷新：后台并发刷新所有已配 Key 的供应商模型列表，失败静默（保留旧缓存） */
export async function refreshAllProviderModels(): Promise<void> {
  const settings = getLlmSettings()
  await Promise.allSettled(
    settings.providers
      .filter((p) => p.apiKey)
      .map((p) => refreshProviderModels(p).catch(() => undefined))
  )
}

/** 非流式对话（M8 能力核用）：直接返回全文，不走 IPC 广播 */
export async function chatComplete(messages: ChatMessage[], timeoutMs = 300_000): Promise<string> {
  const provider = getTextProvider()
  if (!provider) throw new Error('未配置模型供应商，请先在「模型接入」中设置')
  const send = await compactMessages(provider, messages)
  if (provider.api === 'anthropic-messages') return anthropicChatComplete(provider, send, timeoutMs)
  const res = await net.fetch(chatUrl(provider.baseUrl), {
    method: 'POST',
    headers: authHeaders(provider.apiKey),
    body: JSON.stringify({ model: provider.textModel, messages: send }),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(friendlyHttpError(res.status, (await res.text()).slice(0, 300)))
  const reply = extractReply(await res.text())
  if (!reply.trim()) throw new Error('模型返回了空回复')
  return reply
}

/** 发起流式对话：增量经 llm:stream 广播（思考过程在 reasoning 字段），结束发 llm:done。
 * options.tools 非空时走 function calling；options.thinking 控制思考开关（缺省按模型目录默认） */
export async function chatStart(
  requestId: string,
  messages: ChatMessage[],
  options?: ChatStartOptions
): Promise<void> {
  const provider = getTextProvider()
  if (!provider) {
    broadcast('llm:done', { requestId, error: '未配置模型供应商，请先在「模型接入」中设置' })
    return
  }

  const ctrl = new AbortController()
  activeRequests.set(requestId, ctrl)
  try {
    // 上下文自动压缩：超窗口 70% 时先摘要旧消息（随「停止」一起中止，失败回退截断）
    const send = await compactMessages(provider, messages, ctrl.signal)
    if (provider.api === 'anthropic-messages') {
      await anthropicChatStart({ requestId, provider, messages: send, options, signal: ctrl.signal })
      return
    }

    const toolAcc: { id: string; name: string; arguments: string }[] = []
    const init: RequestInit = {
      method: 'POST',
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({
        model: provider.textModel,
        messages: send,
        stream: true,
        ...openaiThinkingParams(provider, options),
        ...(options?.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {})
      }),
      signal: ctrl.signal
    }
    let res = await net.fetch(chatUrl(provider.baseUrl), init)
    if (res.status === 429) {
      // 限流：静默等 4 秒重试一次（429 的请求未被服务端执行，重试不重复计费）
      await new Promise((r) => setTimeout(r, 4000))
      res = await net.fetch(chatUrl(provider.baseUrl), init)
    }
    if (!res.ok || !res.body) {
      const text = (await res.text()).slice(0, 300)
      broadcast('llm:done', { requestId, error: friendlyHttpError(res.status, text) })
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
          const json = JSON.parse(line) as {
            choices?: {
              delta?: {
                content?: string
                // 思考过程字段：千问系 reasoning_content（OpenAI 兼容约定）；商汤系非标 reasoning
                reasoning_content?: string
                reasoning?: string
                tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
              }
            }[]
          }
          const delta = json.choices?.[0]?.delta
          if (delta?.content) broadcast('llm:stream', { requestId, delta: delta.content })
          const reasoning = delta?.reasoning_content ?? delta?.reasoning
          if (reasoning) broadcast('llm:stream', { requestId, delta: '', reasoning })
          const tcs = delta?.tool_calls
          if (tcs?.length) accumulateToolCalls(toolAcc, tcs)
        } catch {
          // 非 JSON 心跳行，忽略
        }
      }
    }
    broadcast('llm:done', {
      requestId,
      toolCalls: toolAcc.length
        ? toolAcc.map((t, i) => ({ id: t.id || `call_${i}`, name: t.name, arguments: t.arguments || '{}' }))
        : undefined
    })
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
