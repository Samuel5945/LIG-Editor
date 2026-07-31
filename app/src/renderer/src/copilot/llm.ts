import type { ChatMessage } from '@shared/types'

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
