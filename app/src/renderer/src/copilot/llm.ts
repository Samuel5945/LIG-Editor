import type { ChatMessage, ChatToolSchema, ToolCallInfo } from '@shared/types'

/** M8：JSON 提取移入 shared（主进程能力核复用），原路径转发 */
export { extractJsonArray } from '@shared/llmText'

/** 把 llm:chatStart 的事件流包装成 Promise；onDelta 可拿到累计全文做流式 UI */
export function chatOnce(
  messages: ChatMessage[],
  onDelta?: (full: string, delta: string) => void
): { promise: Promise<string>; abort: () => void } {
  const requestId = crypto.randomUUID()
  let full = ''
  let offStream = (): void => {}
  let offDone = (): void => {}

  const promise = new Promise<string>((resolve, reject) => {
    offStream = window.api.on('llm:stream', ({ requestId: id, delta }) => {
      if (id !== requestId) return
      full += delta
      onDelta?.(full, delta)
    })
    offDone = window.api.on('llm:done', ({ requestId: id, error }) => {
      if (id !== requestId) return
      offStream()
      offDone()
      if (error) reject(new Error(error))
      else resolve(full)
    })
    void window.api.invoke('llm:chatStart', requestId, messages)
  })

  return { promise, abort: () => void window.api.invoke('llm:abort', requestId) }
}

/** 一轮流式对话的结果：文本 + 模型发起的工具调用（非空时调用方执行后回填下一轮） */
export interface ChatRoundResult {
  text: string
  toolCalls?: ToolCallInfo[]
}

/** chat-tools v1：带工具的单轮流式对话。toolCalls 非空 = 模型要调工具，调用方执行后把
 *  assistant(tool_calls) + tool 结果追加进消息序列再发下一轮（循环逻辑在 ChatPanel） */
export function chatOnceWithTools(
  messages: ChatMessage[],
  options?: { tools?: ChatToolSchema[]; onDelta?: (full: string, delta: string) => void }
): { promise: Promise<ChatRoundResult>; abort: () => void } {
  const requestId = crypto.randomUUID()
  let full = ''
  let offStream = (): void => {}
  let offDone = (): void => {}

  const promise = new Promise<ChatRoundResult>((resolve, reject) => {
    offStream = window.api.on('llm:stream', ({ requestId: id, delta }) => {
      if (id !== requestId) return
      full += delta
      options?.onDelta?.(full, delta)
    })
    offDone = window.api.on('llm:done', ({ requestId: id, error, toolCalls }) => {
      if (id !== requestId) return
      offStream()
      offDone()
      if (error) reject(new Error(error))
      else resolve({ text: full, toolCalls })
    })
    void window.api.invoke(
      'llm:chatStart',
      requestId,
      messages,
      options?.tools?.length ? { tools: options.tools } : undefined
    )
  })

  return { promise, abort: () => void window.api.invoke('llm:abort', requestId) }
}
