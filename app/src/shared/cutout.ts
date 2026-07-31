/**
 * 导入抠图三算法（M6 管线三）：从已验证 Python 版移植
 * 输入输出均为 RGBA 平面数组（渲染层从 canvas ImageData 取；纯函数便于单测）
 * - unpremultiply 白底反预乘：alpha = 1 − min(RGB)，去噪底后反预乘还原前景色（渐变/抗锯齿 LOGO）
 * - shape-mask 形状掩码：alpha = clip(alpha0/阈值)，内部实心只边缘反预乘（中间调金色等避免深底发暗）
 * - fit-circle 拟合圆：非白像素拟合圆盘，盘内全保留（圆形图标含内部白色细节）
 */

export interface RawImage {
  width: number
  height: number
  /** RGBA，长度 = width*height*4 */
  data: Uint8ClampedArray
}

export type CutoutAlgo = 'none' | 'unpremultiply' | 'shape-mask' | 'fit-circle'

/** 各算法的滑杆参数语义与范围（UI 渲染用） */
export const CUTOUT_ALGOS: {
  id: CutoutAlgo
  label: string
  paramLabel: string
  min: number
  max: number
  step: number
  defaultValue: number
}[] = [
  { id: 'none', label: '原图', paramLabel: '', min: 0, max: 0, step: 0, defaultValue: 0 },
  { id: 'unpremultiply', label: '白底反预乘', paramLabel: '噪声底', min: 0, max: 0.3, step: 0.01, defaultValue: 0.06 },
  { id: 'shape-mask', label: '形状掩码', paramLabel: '掩码阈值', min: 0.2, max: 0.8, step: 0.02, defaultValue: 0.5 },
  { id: 'fit-circle', label: '拟合圆', paramLabel: '半径缩放', min: 0.8, max: 1.2, step: 0.01, defaultValue: 1.0 }
]

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v)

/** 白底反预乘：alpha0 = 1 − min(RGB)/255；≤噪声底归零并重新拉伸，再反预乘还原前景色 */
function unpremultiply(img: RawImage, noiseFloor: number): RawImage {
  const src = img.data
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const a0 = 1 - Math.min(src[i], src[i + 1], src[i + 2]) / 255
    const a = a0 <= noiseFloor ? 0 : (a0 - noiseFloor) / (1 - noiseFloor)
    if (a <= 0) {
      out[i + 3] = 0
      continue
    }
    const bg = 255 * (1 - a)
    out[i] = clamp255((src[i] - bg) / a)
    out[i + 1] = clamp255((src[i + 1] - bg) / a)
    out[i + 2] = clamp255((src[i + 2] - bg) / a)
    out[i + 3] = Math.round(a * 255)
  }
  return { width: img.width, height: img.height, data: out }
}

/** 形状掩码：alpha = clip(alpha0/阈值, 0, 1)，内部实心保原色，仅边缘渐变段反预乘压白边 */
function shapeMask(img: RawImage, threshold: number): RawImage {
  const src = img.data
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const a0 = 1 - Math.min(src[i], src[i + 1], src[i + 2]) / 255
    const a = Math.min(1, Math.max(0, a0 / threshold))
    if (a <= 0) {
      out[i + 3] = 0
      continue
    }
    if (a >= 1) {
      // 内部：原色全保留（中间调不会被半透明叠加压暗）
      out[i] = src[i]
      out[i + 1] = src[i + 1]
      out[i + 2] = src[i + 2]
      out[i + 3] = 255
      continue
    }
    const bg = 255 * (1 - a)
    out[i] = clamp255((src[i] - bg) / a)
    out[i + 1] = clamp255((src[i + 1] - bg) / a)
    out[i + 2] = clamp255((src[i + 2] - bg) / a)
    out[i + 3] = Math.round(a * 255)
  }
  return { width: img.width, height: img.height, data: out }
}

/** 拟合圆：非白像素求质心 + 99.5 分位半径，盘内全保留（含内部白色细节），边缘 1.5px 羽化 */
function fitCircle(img: RawImage, radiusScale: number): RawImage {
  const { width, height, data: src } = img
  // 非白掩码：min(RGB) 明显低于纯白才算前景
  let sumX = 0
  let sumY = 0
  let count = 0
  const maxDist = Math.ceil(Math.hypot(width, height))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (Math.min(src[i], src[i + 1], src[i + 2]) < 240) {
        sumX += x
        sumY += y
        count++
      }
    }
  }
  const out = new Uint8ClampedArray(src.length)
  if (count === 0) return { width, height, data: out } // 全白图 → 全透明
  const cx = sumX / count
  const cy = sumY / count
  // 距离直方图取 99.5 分位作半径（抗孤立噪点，O(n) 免排序）
  const hist = new Uint32Array(maxDist + 1)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (Math.min(src[i], src[i + 1], src[i + 2]) < 240) {
        hist[Math.min(maxDist, Math.round(Math.hypot(x - cx, y - cy)))]++
      }
    }
  }
  let acc = 0
  let radius = maxDist
  const target = count * 0.995
  for (let d = 0; d <= maxDist; d++) {
    acc += hist[d]
    if (acc >= target) {
      radius = d
      break
    }
  }
  const r = radius * radiusScale
  const feather = Math.max(1.5, r * 0.01)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const dist = Math.hypot(x - cx, y - cy)
      const a = Math.min(1, Math.max(0, (r + feather / 2 - dist) / feather))
      out[i] = src[i]
      out[i + 1] = src[i + 1]
      out[i + 2] = src[i + 2]
      out[i + 3] = Math.round(a * 255)
    }
  }
  return { width, height, data: out }
}

/** 统一入口：algo='none' 时原样返回（拷贝） */
export function applyCutout(img: RawImage, algo: CutoutAlgo, param: number): RawImage {
  switch (algo) {
    case 'unpremultiply':
      return unpremultiply(img, param)
    case 'shape-mask':
      return shapeMask(img, param)
    case 'fit-circle':
      return fitCircle(img, param)
    default:
      return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
  }
}
