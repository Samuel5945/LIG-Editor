import { describe, expect, it } from 'vitest'
import { applyCutout, type RawImage } from '../cutout'

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
