import { describe, expect, it } from 'vitest'
import {
  applyCutout,
  applyCutoutMasked,
  createCutoutMask,
  hasMaskPaint,
  paintCutoutMask,
  type RawImage
} from '../cutout'

/** 用像素数组快速造图（每项 [r,g,b]，输入均视为不透明白底图） */
function makeImage(width: number, height: number, px: [number, number, number][]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4)
  px.forEach(([r, g, b], i) => {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  })
  return { width, height, data }
}

describe('白底反预乘', () => {
  it('纯白变全透明、纯色保持原色全不透明', () => {
    const img = makeImage(2, 1, [
      [255, 255, 255],
      [255, 0, 0]
    ])
    const out = applyCutout(img, 'unpremultiply', 0.06)
    expect(out.data[3]).toBe(0) // 白 → alpha 0
    expect(out.data[7]).toBe(255) // 红 → alpha 1
    expect([out.data[4], out.data[5], out.data[6]]).toEqual([255, 0, 0])
  })

  it('与白色混合过的半透明红能还原前景色', () => {
    // 50% 红叠白底 ≈ (255,128,128)
    const out = applyCutout(makeImage(1, 1, [[255, 128, 128]]), 'unpremultiply', 0)
    expect(out.data[3]).toBeGreaterThan(120) // alpha ≈ 0.5
    expect(out.data[0]).toBe(255) // R 还原满值
    expect(out.data[1]).toBeLessThan(10) // G 压回接近 0
  })
})

describe('形状掩码', () => {
  it('中间调内部像素 alpha 拉满且原色保留（不发暗）', () => {
    // 浅褐金类中间调：min 通道 100 → alpha0≈0.61 ≥ 阈值 0.5 → 实心
    const out = applyCutout(makeImage(1, 1, [[180, 150, 100]]), 'shape-mask', 0.5)
    expect(out.data[3]).toBe(255)
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([180, 150, 100])
  })

  it('接近白的边缘像素仍是渐变半透明', () => {
    const out = applyCutout(makeImage(1, 1, [[255, 230, 230]]), 'shape-mask', 0.5)
    expect(out.data[3]).toBeGreaterThan(0)
    expect(out.data[3]).toBeLessThan(255)
  })
})

describe('拟合圆', () => {
  it('盘内像素（含内部白色细节）全保留，盘外白底透明', () => {
    // 8x8：中心 4x4 深色方块充当“圆盘”，(3,3)(4,4) 处夹一颗白像素模拟指南针
    const px: [number, number, number][] = []
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const inside = x >= 2 && x <= 5 && y >= 2 && y <= 5
        const white = x === 3 && y === 3
        px.push(inside && !white ? [30, 60, 200] : [255, 255, 255])
      }
    }
    const out = applyCutout(makeImage(8, 8, px), 'fit-circle', 1.0)
    const alphaAt = (x: number, y: number): number => out.data[(y * 8 + x) * 4 + 3]
    expect(alphaAt(3, 3)).toBe(255) // 盘内白色细节保留
    expect([out.data[(3 * 8 + 3) * 4], out.data[(3 * 8 + 3) * 4 + 1]]).toEqual([255, 255])
    expect(alphaAt(0, 0)).toBe(0) // 角落白底透明
  })

  it('全白图输出全透明', () => {
    const out = applyCutout(makeImage(2, 2, Array(4).fill([255, 255, 255])), 'fit-circle', 1.0)
    expect(Array.from(out.data).filter((_, i) => i % 4 === 3)).toEqual([0, 0, 0, 0])
  })
})

describe('手工精修蒙版', () => {
  it('新建蒙版全为 0，涂过一笔后 hasMaskPaint 变真', () => {
    const mask = createCutoutMask(4, 4)
    expect(Array.from(mask).every((v) => v === 0)).toBe(true)
    expect(hasMaskPaint(mask)).toBe(false)
    paintCutoutMask(mask, 4, 4, 2, 2, 2, 2, 1.5, 1, 1)
    expect(hasMaskPaint(mask)).toBe(true)
  })

  it('未涂区域逐字节等于纯算法结果', () => {
    const img = makeImage(2, 1, [
      [255, 255, 255],
      [255, 0, 0]
    ])
    const mask = createCutoutMask(2, 1)
    const base = applyCutout(img, 'unpremultiply', 0.06)
    const masked = applyCutoutMasked(img, 'unpremultiply', 0.06, mask)
    expect(Array.from(masked.data)).toEqual(Array.from(base.data))
  })

  it('保留画笔把算法削掉的浅色前景补回，且颜色取原图而非算法输出', () => {
    // 浅灰像素：shape-mask 阈值 0.8 下 alpha 只有几十
    const img = makeImage(1, 1, [[230, 225, 220]])
    const before = applyCutout(img, 'shape-mask', 0.8)
    expect(before.data[3]).toBeLessThan(100)
    const mask = createCutoutMask(1, 1)
    paintCutoutMask(mask, 1, 1, 0, 0, 0, 0, 2, 1, 1)
    const after = applyCutoutMasked(img, 'shape-mask', 0.8, mask)
    expect(after.data[3]).toBe(255)
    expect([after.data[0], after.data[1], after.data[2]]).toEqual([230, 225, 220])
  })

  it('擦除画笔把算法判定的前景擦成全透明', () => {
    const img = makeImage(1, 1, [[255, 0, 0]])
    expect(applyCutout(img, 'unpremultiply', 0.06).data[3]).toBe(255)
    const mask = createCutoutMask(1, 1)
    paintCutoutMask(mask, 1, 1, 0, 0, 0, 0, 2, 1, -1)
    expect(applyCutoutMasked(img, 'unpremultiply', 0.06, mask).data[3]).toBe(0)
  })

  it('同处再涂会翻转符号，不会退回未涂（不出现第三种状态）', () => {
    const mask = createCutoutMask(1, 1)
    paintCutoutMask(mask, 1, 1, 0, 0, 0, 0, 2, 1, 1)
    expect(mask[0]).toBeGreaterThan(0)
    paintCutoutMask(mask, 1, 1, 0, 0, 0, 0, 2, 1, -1)
    expect(mask[0]).toBeLessThan(0)
  })

  it('线段涂抹连续：两端之间的中点也被涂到（快速拖动不断线）', () => {
    const mask = createCutoutMask(20, 1)
    paintCutoutMask(mask, 20, 1, 2, 0.5, 17, 0.5, 1, 1, 1)
    expect(mask[2]).toBeGreaterThan(0)
    expect(mask[10]).toBeGreaterThan(0)
    expect(mask[17]).toBeGreaterThan(0)
  })

  it('软边：圆心满强度，外圈强度递减但不为 0', () => {
    const mask = createCutoutMask(20, 20)
    paintCutoutMask(mask, 20, 20, 10, 10, 10, 10, 8, 0.25, 1)
    const center = mask[10 * 20 + 10]
    const edge = mask[10 * 20 + 16] // 距圆心 6px，位于 soft 段
    expect(center).toBe(127)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(center)
  })

  it('蒙版长度与图不符时整体忽略，退回纯算法结果', () => {
    const img = makeImage(2, 1, [
      [255, 255, 255],
      [255, 0, 0]
    ])
    const wrong = createCutoutMask(3, 3)
    const masked = applyCutoutMasked(img, 'unpremultiply', 0.06, wrong)
    expect(Array.from(masked.data)).toEqual(Array.from(applyCutout(img, 'unpremultiply', 0.06).data))
  })
})
