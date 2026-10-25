/**
 * renderer 交互测试的 window.api 桩（jsdom）：按通道挂可编程应答，记录全部调用，
 * 事件通道（llm:stream / llm:done 一类）由测试手动 emit——组件挂的真实监听是
 * preload 经 IPC 转发来的，测试里没有主进程，就由这个桩扮演主进程那一侧。
 */

// never[] 参数让任意签名的 handler 都能挂进来（string 首参的也行），调用处再归一
type Handler = (...args: never[]) => unknown

export interface ApiStub {
  /** 按通道注册应答；返回值/抛错都会走组件的 await 路径 */
  on(channel: string, h: Handler): void
  /** 全部 invoke 调用记录（channel + 实参），按序 */
  calls: { channel: string; args: unknown[] }[]
  /** 某通道的调用记录 */
  callsOf(channel: string): unknown[][]
  /** 触发一个事件通道（如 llm:done），载荷原样交给组件注册的监听 */
  emit(channel: string, payload: unknown): void
}

export function installApiStub(): ApiStub {
  const handlers = new Map<string, Handler>()
  const listeners = new Map<string, Set<(payload: never) => void>>()
  const calls: { channel: string; args: unknown[] }[] = []
  const stub: ApiStub = {
    on(channel, h) {
      handlers.set(channel, h)
    },
    calls,
    callsOf(channel) {
      return calls.filter((c) => c.channel === channel).map((c) => c.args)
    },
    emit(channel, payload) {
      for (const cb of listeners.get(channel) ?? []) cb(payload as never)
    }
  }
  window.api = {
    invoke: (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      const h = handlers.get(channel) as ((...a: unknown[]) => unknown) | undefined
      if (!h) return Promise.reject(new Error(`测试桩未注册通道：${channel}`))
      return Promise.resolve(h(...args))
    },
    on: (channel: string, cb: (payload: never) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(cb)
      return () => {
        listeners.get(channel)?.delete(cb)
      }
    }
  } as unknown as Window['api']
  return stub
}

/** jsdom 缺的浏览器 API 补空实现（只求跑通，不求行为） */
export function installDomShims(): void {
  // useFittingRow / useElementBox 的 ResizeObserver
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverShim {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverShim as unknown as typeof ResizeObserver
  }
  // 滚动到底/滚到卡副作用
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.scrollTo = () => {}
  // 老版 jsdom 的 crypto 没有 randomUUID（chatOnce 生成 requestId 用）
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    let seq = 0
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        ...(globalThis.crypto ?? {}),
        randomUUID: () => `uuid-${Date.now()}-${seq++}`
      },
      configurable: true
    })
  }
}
