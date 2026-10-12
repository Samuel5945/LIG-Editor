import { describe, it, expect } from 'vitest'
import { isAbortLike, mergeAbortSignals } from '../abort'

describe('mergeAbortSignals', () => {
  it('外部信号 abort → 合并信号同步进入 aborted', () => {
    const external = new AbortController()
    const merged = mergeAbortSignals(60_000, external.signal)
    expect(merged.aborted).toBe(false)
    external.abort()
    expect(merged.aborted).toBe(true)
  })

  it('无外部信号时就是纯超时信号（未到时不 abort）', () => {
    const merged = mergeAbortSignals(60_000)
    expect(merged.aborted).toBe(false)
  })

  it('到时会 abort（超时路径依然成立）', async () => {
    const merged = mergeAbortSignals(10)
    await new Promise((r) => setTimeout(r, 40))
    expect(merged.aborted).toBe(true)
  })
})

describe('isAbortLike', () => {
  it('AbortError / TimeoutError 判为取消，其它错误不算', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    expect(isAbortLike(abort)).toBe(true)
    expect(isAbortLike(timeout)).toBe(true)
    expect(isAbortLike(new Error('HTTP 500'))).toBe(false)
    expect(isAbortLike('boom')).toBe(false)
  })
})
