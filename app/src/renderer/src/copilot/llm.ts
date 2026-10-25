import type { ChatMessage, ChatStartOptions, ToolCallInfo } from '@shared/types'

/** M8：JSON 提取移入 shared（主进程能力核复用），原路径转发 */
export { extractJsonArray, stripHtmlFence } from '@shared/llmText'

/**
 * 兜底看门狗：主进程各错误分支都会发 llm:done，请求本身也有 180s/300s 流级超时，
 * 正常路径永远不会走到这里——兜的是事件丢失/主进程异常这类极端情况。
 * 600s 取「压缩 180s + 首次 fetch 180s + 429 等 4s + 重试 180s」最坏合法链路之上，
 * 再长就当请求已死：清监听、按超时拒绝，让调用方的输入框恢复可重试，不再无限「生成中」。
 */
const WATCHDOG_MS = 600_000

/** 把 llm:chatStart 的事件流包装成 Promise；onDelta 可拿到累计全文做流式 UI，
 * onReasoning 拿累计思考过程（模型思考字段 reasoning/reasoning_content/thinking_delta 已在主进程归一）；
 * options.thinking 传思考档位（false/low/high，缺省跟随模型默认——分析面板等一次性调用用） */
export function chatOnce(
  messages: ChatMessage[],
  onDelta?: (full: string, delta: string) => void,
  onReasoning?: (full: string, delta: string) => void,
  options?: { thinking?: ChatStartOptions['thinking'] }
): { promise: Promise<string>; abort: () => void } {
  const requestId = crypto.randomUUID()
  let full = ''
  let reasoningFull = ''
  let offStream = (): void => {}
  let offDone = (): void => {}

  const promise = new Promise<string>((resolve, reject) => {
    const watchdog = setTimeout(() => {
      offStream()
      offDone()
      reject(new Error('等待模型响应超时（内部事件未送达），可重试'))
    }, WATCHDOG_MS)
    const settle = (fn: () => void): void => {
      clearTimeout(watchdog)
      fn()
    }
    offStream = window.api.on('llm:stream', ({ requestId: id, delta, reasoning }) => {
      if (id !== requestId) return
      full += delta
      onDelta?.(full, delta)
      if (reasoning) {
        reasoningFull += reasoning
        onReasoning?.(reasoningFull, reasoning)
      }
    })
    offDone = window.api.on('llm:done', ({ requestId: id, error }) => {
      if (id !== requestId) return
      settle(() => {
        offStream()
        offDone()
        if (error) reject(new Error(error))
        else resolve(full)
      })
    })
    // invoke 本身失败（如桥接层异常）不会有 llm:done 来收场，直接当错误收掉
    window.api
      .invoke('llm:chatStart', requestId, messages, options?.thinking === undefined ? undefined : { thinking: options.thinking })
      .catch((err) =>
      settle(() => {
        offStream()
        offDone()
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    )
  })

  return { promise, abort: () => void window.api.invoke('llm:abort', requestId) }
}

/** 一轮流式对话的结果：文本 + 思考过程 + 模型发起的工具调用（非空时调用方执行后回填下一轮） */
export interface ChatRoundResult {
  text: string
  /** 思考过程全文（模型未思考时为空串） */
  reasoning: string
  toolCalls?: ToolCallInfo[]
}

/** chat-tools v1：带工具的单轮流式对话。toolCalls 非空 = 模型要调工具，调用方执行后把
 *  assistant(tool_calls) + tool 结果追加进消息序列再发下一轮（循环逻辑在 ChatPanel） */
export function chatOnceWithTools(
  messages: ChatMessage[],
  options?: { tools?: ChatStartOptions['tools']; thinking?: ChatStartOptions['thinking']; onDelta?: (full: string, delta: string) => void; onReasoning?: (full: string, delta: string) => void }
): { promise: Promise<ChatRoundResult>; abort: () => void } {
  const requestId = crypto.randomUUID()
  let full = ''
  let reasoningFull = ''
  let offStream = (): void => {}
  let offDone = (): void => {}

  const promise = new Promise<ChatRoundResult>((resolve, reject) => {
    const watchdog = setTimeout(() => {
      offStream()
      offDone()
      reject(new Error('等待模型响应超时（内部事件未送达），可重试'))
    }, WATCHDOG_MS)
    const settle = (fn: () => void): void => {
      clearTimeout(watchdog)
      fn()
    }
    offStream = window.api.on('llm:stream', ({ requestId: id, delta, reasoning }) => {
      if (id !== requestId) return
      full += delta
      options?.onDelta?.(full, delta)
      if (reasoning) {
        reasoningFull += reasoning
        options?.onReasoning?.(reasoningFull, reasoning)
      }
    })
    offDone = window.api.on('llm:done', ({ requestId: id, error, toolCalls }) => {
      if (id !== requestId) return
      settle(() => {
        offStream()
        offDone()
        if (error) reject(new Error(error))
        else resolve({ text: full, reasoning: reasoningFull, toolCalls })
      })
    })
    // invoke 本身失败（如桥接层异常）不会有 llm:done 来收场，直接当错误收掉
    window.api.invoke('llm:chatStart', requestId, messages, {
      tools: options?.tools?.length ? options.tools : undefined,
      thinking: options?.thinking
    }).catch((err) =>
      settle(() => {
        offStream()
        offDone()
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    )
  })

  return { promise, abort: () => void window.api.invoke('llm:abort', requestId) }
}
