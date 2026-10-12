/**
 * 取消信号工具：把「超时」与「用户主动停止」两条取消路径合成一个 AbortSignal。
 * 生图等长请求既要防卡死超时，又要支持界面上的「停止」按钮；
 * AbortSignal.any 在主进程（Node 22 / Chromium 126+）可用，抽成纯函数便于单测。
 */

/** 超时信号 + 可选的外部取消信号 → 合并信号；无外部信号时就是纯超时信号 */
export function mergeAbortSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return external ? AbortSignal.any([timeout, external]) : timeout
}

/** 异常是否来自取消（AbortError / TimeoutError）——界面据此把「已停止」与「失败」分开提示 */
export function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}
