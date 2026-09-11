/**
 * 导入抠图三算法（M6 管线三）：从已验证 Python 版移植
 * 输入输出均为 RGBA 平面数组（渲染层从 canvas ImageData 取；纯函数便于单测）
 * - unpremultiply 白底反预乘：alpha = 1 − min(RGB)，去噪底后反预乘还原前景色（渐变/抗锯齿 LOGO）
 * - shape-mask 形状掩码：alpha = clip(alpha0/阈值)，内部实心只边缘反预乘（中间调金色等避免深底发暗）
 * - fit-circle 拟合圆：非白像素拟合圆盘，盘内全保留（圆形图标含内部白色细节）
 *
 * 算法之上还有一层**手工精修蒙版**（applyCutoutMasked）：算法定不下来的地方由用户涂抹补/擦，
 * 蒙版只覆盖 alpha，不改算法参数，因此调滑杆与手工涂抹互不干扰、可反复调整。
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

// ---------- 手工精修蒙版（叠在算法结果之上） ----------

/**
 * 每像素一个有符号字节：
 * - 0 = 未涂，交给算法结果
 * - >0 = 保留（补回算法误删的前景），强度按比例映射到 alpha
 * - <0 = 擦除（去掉算法误留的背景）
 * 正负一号定向覆盖：同一处再涂会翻转符号，但不会退化成"未涂"，
 * 因此不会出现「补过的地方被擦一笔后又变回算法原样」这种第三种状态。
 */
export type CutoutMask = Int8Array

/** 强度上限：有符号字节的正半区 */
export const MASK_STRENGTH = 127

export function createCutoutMask(width: number, height: number): CutoutMask {
  return new Int8Array(width * height)
}

/** 蒙版是否被涂过（UI 判断「清除涂抹」是否可用、以及是否提示已生效） */
export function hasMaskPaint(mask: CutoutMask): boolean {
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) return true
  return false
}

/**
 * 画一笔涂抹。按线段插值分步落笔，快速拖动不会断成一串孤点。
 * - radius 为图像像素半径；hardness=1 硬边，越小边缘越柔
 * - value：1 = 保留画笔，-1 = 擦除画笔
 */
export function paintCutoutMask(
  mask: CutoutMask,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  hardness: number,
  value: 1 | -1
): void {
  const target = value * MASK_STRENGTH
  const outer = Math.max(0.5, radius)
  const inner = outer * Math.max(0.05, Math.min(1, hardness))
  const dist = Math.hypot(x1 - x0, y1 - y0)
  // 步长取半径的 0.3 倍，保证相邻落笔的圆盘有重叠
  const steps = Math.max(1, Math.ceil(dist / Math.max(0.5, outer * 0.3)))
  for (let s = 0; s <= steps; s++) {
    const cx = x0 + ((x1 - x0) * s) / steps
    const cy = y0 + ((y1 - y0) * s) / steps
    const xa = Math.max(0, Math.floor(cx - outer))
    const xb = Math.min(width - 1, Math.ceil(cx + outer))
    const ya = Math.max(0, Math.floor(cy - outer))
    const yb = Math.min(height - 1, Math.ceil(cy + outer))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (d > outer) continue
        const falloff = d <= inner ? 1 : 1 - (d - inner) / Math.max(0.001, outer - inner)
        const p = y * width + x
        // 按落笔强度向目标值靠拢：反复涂同一处会逐渐逼近满强度
        const next = mask[p] + (target - mask[p]) * falloff
        mask[p] = Math.round(Math.max(-MASK_STRENGTH, Math.min(MASK_STRENGTH, next)))
      }
    }
  }
}

/**
 * 带手工蒙版的合成：先跑算法，再按蒙版覆盖 alpha。
 * 补回时颜色取**原图**像素——算法已把该处判成透明，其 RGB 往往是背景色或 0，
 * 只有原图颜色才是用户想要的前景色（这类图基本都是白底 LOGO 与实拍图）。
 */
export function applyCutoutMasked(
  img: RawImage,
  algo: CutoutAlgo,
  param: number,
  mask: CutoutMask | null
): RawImage {
  const base = applyCutout(img, algo, param)
  if (!mask || mask.length !== img.width * img.height) return base
  const out = base.data
  const src = img.data
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const m = mask[p]
    if (m > 0) {
      const a = Math.round((m / MASK_STRENGTH) * 255)
      if (a > out[i + 3]) {
        out[i] = src[i]
        out[i + 1] = src[i + 1]
        out[i + 2] = src[i + 2]
        out[i + 3] = a
      }
    } else if (m < 0) {
      const a = Math.round(255 + (m / MASK_STRENGTH) * 255)
      if (a < out[i + 3]) out[i + 3] = a
    }
  }
  return { width: img.width, height: img.height, data: out }
}
