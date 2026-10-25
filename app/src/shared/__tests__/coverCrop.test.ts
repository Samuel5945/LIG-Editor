/**
 * 封面方图裁剪的坐标契约（squareCropRect）：1:1 只能是横图「满高的一段」，
 * 横位置由 focal 决定——取景错一格就是把标题裁进方图或裁出画面区。
 * 输入尺寸刻意用 coverStore 实际喂的两组口径：请求的 2× 超采样与 HiDPI 实收 4×。
 */
import { describe, it, expect } from 'vitest'
import { squareCropRect, DEFAULT_FOCAL } from '../coverTemplates'

describe('squareCropRect（方图=主图裁剪）', () => {
  it('横图取满高一段：宽高恒等于源高，top 恒居中', () => {
    // 2.35:1 主图按 SUPERSAMPLE=2 请求 2350×1000
    const r = squareCropRect(2350, 1000, 0.5)
    expect(r).toEqual({ left: 675, top: 0, width: 1000, height: 1000 })
  })

  it('focal 0=最左（含标题）、1=最右（版式留出的方形画面区，缺省取景）', () => {
    expect(squareCropRect(2350, 1000, 0).left).toBe(0)
    expect(squareCropRect(2350, 1000, 1).left).toBe(1350)
    expect(DEFAULT_FOCAL).toBe(1)
    // 缺省值取到最右是设计决定：往左偏会把标题尾字带进 1:1（见 coverTemplates 注释）
    expect(squareCropRect(2350, 1000, DEFAULT_FOCAL).left).toBe(1350)
  })

  it('focal 越界与非法值夹回 [0,1]，不炸不 NaN', () => {
    expect(squareCropRect(2350, 1000, 1.7).left).toBe(1350)
    expect(squareCropRect(2350, 1000, -0.3).left).toBe(0)
    expect(squareCropRect(2350, 1000, Number.NaN).left).toBe(1350)
  })

  it('HiDPI 实收 4700×2000（capturePage DIP×2）同一 focal 取景比例不变', () => {
    // coverStore 按「解码后实测尺寸」喂本函数——同一 focal 在任何像素密度下裁的是同一段画面
    const r2x = squareCropRect(2350, 1000, 1)
    const r4x = squareCropRect(4700, 2000, 1)
    expect(r4x).toEqual({ left: 2700, top: 0, width: 2000, height: 2000 })
    expect(r4x.left / 2).toBe(r2x.left)
    expect(r4x.width / 2).toBe(r2x.width)
  })

  it('竖图/方图取满幅（居中），不放大不裁切', () => {
    expect(squareCropRect(1000, 1600, 1)).toEqual({ left: 0, top: 300, width: 1000, height: 1000 })
    expect(squareCropRect(1000, 1000, 0.5)).toEqual({ left: 0, top: 0, width: 1000, height: 1000 })
  })
})
