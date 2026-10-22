import { describe, it, expect } from 'vitest'
import { ratioToSenseNovaSize } from '../imageRatio'

describe('ratioToSenseNovaSize', () => {
  it('贴图卡 3:4 → 768x1024，长边对齐 1024', () => {
    expect(ratioToSenseNovaSize('3:4')).toBe('768x1024')
    expect(ratioToSenseNovaSize('4:3')).toBe('1024x768')
  })

  it('常用比例全部落在商汤约束内（32 倍数、512-4096）', () => {
    for (const r of ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2']) {
      const [w, h] = (ratioToSenseNovaSize(r) ?? '').split('x').map(Number)
      expect(w).toBeGreaterThanOrEqual(512)
      expect(h).toBeGreaterThanOrEqual(512)
      expect(w).toBeLessThanOrEqual(4096)
      expect(h).toBeLessThanOrEqual(4096)
      expect(w % 32).toBe(0)
      expect(h % 32).toBe(0)
    }
    expect(ratioToSenseNovaSize('9:16')).toBe('576x1024')
    expect(ratioToSenseNovaSize('16:9')).toBe('1024x576')
    expect(ratioToSenseNovaSize('1:1')).toBe('1024x1024')
  })

  it('小数比例（封面 2.35:1）也要能解析，且长边可指定', () => {
    // 以前正则只收整数，'2.35:1' 解析失败 → 回退 1024x1024 方图，封面再被裁掉一半高度
    // 短边会被 512 的下限抬起来（1024 长边下 2.35:1 只能给到 2:1）——这正是封面必须指定长边的原因
    expect(ratioToSenseNovaSize('2.35:1')).toBe('1024x512')
    const cover = ratioToSenseNovaSize('2.35:1', { longEdge: 2432 }) ?? ''
    const [w, h] = cover.split('x').map(Number)
    expect(w).toBe(2432)
    expect(h % 32).toBe(0)
    expect(Math.abs(w / h - 2.35)).toBeLessThan(0.05)
  })

  it('容忍斜杠写法与首尾空格', () => {
    expect(ratioToSenseNovaSize('3/4')).toBe('768x1024')
    expect(ratioToSenseNovaSize(' 3:4 ')).toBe('768x1024')
  })

  it('超 3:1 与无法解析返回 null（调用方回退默认方图）', () => {
    expect(ratioToSenseNovaSize('1:4')).toBeNull()
    expect(ratioToSenseNovaSize('5:1')).toBeNull()
    expect(ratioToSenseNovaSize('1K')).toBeNull()
    expect(ratioToSenseNovaSize(undefined)).toBeNull()
    expect(ratioToSenseNovaSize('')).toBeNull()
    expect(ratioToSenseNovaSize(':4')).toBeNull()
  })
})
