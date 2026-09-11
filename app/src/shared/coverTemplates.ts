import { contrastText } from './categoryThemes'
import { hexToRgba } from './cards'

/**
 * 封面模板：纯 CSS/SVG 版式，不依赖任何内置图片资源。
 * 每个模板都要在两种比例下各渲染一次（2.35:1 头图与 1:1 方图），
 * 因此版式按 size 自适应（字号、留白、折行），而不是同一套 DOM 硬缩。
 *
 * 版式规则来自跨平台封面研究（少 / 大 / 粗 + 高对比 + 安全区），落到公众号首图上：
 * - **左文右方图**：文字锁在左区，右区是一个 `画布高 × 画布高` 的方形画面。
 *   公众号后台的 1:1 封面裁剪框可拖动，把框落在右区即可——
 *   头条大图看文字，缩略图看画面，两者不必互相牺牲。
 * - **顶部约 20% 让给标题遮罩**，文字块不进入。
 * - **字号受列宽硬约束**：`字号 ≤ 可用列宽 / 最长一行字数`，所以永远不会溢出画布；
 *   支持用 `|` 手动分行——行越短字号越大，这是「1 秒可读」的唯一出路。
 * - **高对比、平面优先**：白字压深底，最多一层极轻投影；不做 3D 描边与彩色投影。
 *
 * 本文件纯函数，无 electron 依赖：HTML 生成、折行与字号计算都可直接单测（同 cards.ts）。
 */

export type CoverSize = 'wide' | 'square'

/** 公众号头图 2.35:1 */
export const COVER_WIDE = { w: 1175, h: 500 } as const
/** 朋友圈分享方图 1:1 */
export const COVER_SQUARE = { w: 800, h: 800 } as const

const SIZES: Record<CoverSize, { w: number; h: number }> = {
  wide: COVER_WIDE,
  square: COVER_SQUARE
}

/** 系统字体栈（与 cards.ts 一致；仓库不内置字体文件，靠系统字体 + document.fonts.ready 等待） */
const FONT = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'

/** 文字块左右留白 */
const PAD = 56
/** 顶部让给标题遮罩的比例 */
const TOP_GUARD = 0.2

export interface CoverTemplate {
  id: string
  name: string
  /** picker 里的悬停说明 */
  hint: string
}

/** 顺序即推荐顺序：左文右图放第一，作为默认模板 */
export const COVER_TEMPLATES: CoverTemplate[] = [
  { id: 'split', name: '左文右图', hint: '文字在左、右侧方形画面可单独裁成 1:1 缩略图——公众号首图最稳的一种' },
  { id: 'plain', name: '大字版式', hint: '强调色压深满底 + 左侧超大字，无底图时的首选' },
  { id: 'left', name: '左侧竖栏', hint: '深底 + 左侧强调色竖条，克制、有品牌感' },
  { id: 'editorial', name: '杂志留白', hint: '浅底细线 + 深色字，纯文字版式（不使用底图）' }
]

export interface CoverHtmlOptions {
  template: string
  size: CoverSize
  title: string
  subtitle?: string
  /** 版式强调色（十六进制，来自文章排版调性） */
  accent: string
  /**
   * 底图路径：**相对工程目录**（如 `assets/cover-bg.png`）。
   * 生成的 HTML 落在 `<工程>/covers/` 下，故这里拼 `../` 前缀。
   */
  bgSrc?: string
  /** 品牌行（通常传账号名） */
  brand?: string
}

/** 中文断行优先落在这些标点后 */
const BREAK_AFTER = /[，。！？；：、,.!?;:、）)】」』]/
/** 一行超过这个字数就宁可硬折，否则字号上不去 */
const MAX_LINE = 9

/** 右侧方形区的边长（= 画布高；1:1 输出时整幅就是方图，没有右区） */
function squareSide(size: CoverSize): number {
  return size === 'wide' ? COVER_WIDE.h : 0
}

/** 文字可用列宽：头图扣掉右侧方形区与留白；方图没有右区，用整幅减留白 */
function textColumnWidth(size: CoverSize): number {
  const { w } = SIZES[size]
  return (size === 'wide' ? w - squareSide(size) : w) - PAD * 2
}

/**
 * 标题折行：先按 `|`（半角/全角）手动分行——这是把字号放大到「1 秒可读」的前提。
 * 没写分隔符时按标点贪心折行，标点不足再按字数硬折。
 */
export function splitTitleLines(title: string): string[] {
  const explicit = title
    .split(/[|｜]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (explicit.length > 1) return explicit
  const text = (explicit[0] ?? title).trim()
  if (!text) return ['未命名']
  // 带捕获组切分，标点留在原位（无捕获的 split 会把分隔符直接丢掉）
  const parts = text.split(new RegExp(`(${BREAK_AFTER.source})`))
  const segments: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i] + (parts[i + 1] ?? '')
    if (seg) segments.push(seg)
  }
  const lines: string[] = []
  let cur = ''
  const flush = (): void => {
    if (cur) lines.push(cur)
    cur = ''
  }
  for (const seg of segments.filter(Boolean)) {
    if (seg.length > MAX_LINE) {
      flush()
      for (let i = 0; i < seg.length; i += MAX_LINE) lines.push(seg.slice(i, i + MAX_LINE))
      continue
    }
    if (cur.length + seg.length > MAX_LINE) flush()
    cur += seg
  }
  flush()
  return lines.length ? lines : ['未命名']
}

/**
 * 标题字号：受**列宽硬约束**（`可用列宽 / 最长一行字数`），再按行数收一档保证整块不顶出安全区。
 * 上限对应「标题块高度接近画面 1/3」，这是小屏缩略图里还能读出来的门槛。
 * 下限保可读性；比 MAX_LINE 更长的行由 splitTitleLines 折行保证不会出现，
 * 因此"字号 × 行宽 ≤ 列宽"对实际可达的行宽恒成立。
 */
export function titleFontSize(maxLineLen: number, lineCount: number, size: CoverSize): number {
  const cap = size === 'wide' ? 118 : 152
  const byWidth = Math.floor(textColumnWidth(size) / Math.max(1, maxLineLen))
  const fit = lineCount <= 2 ? 1 : lineCount === 3 ? 0.86 : 0.72
  return Math.max(34, Math.round(Math.min(cap, byWidth) * fit))
}

/** HTML 文本转义：标题可能来自模型或用户输入，直接拼进 HTML 会破版式 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 强调色兜底：非法输入退回主题默认青，保证 coverHtml 永不产出坏色值 */
function safeAccent(accent: string): string {
  return /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(accent.trim()) ? accent.trim() : '#0d9488'
}

/** 十六进制色按比例加深/减淡（amount 取 -1..1，负为加深） */
export function shade(hex: string, amount: number): string {
  const h = safeAccent(hex).replace(/^#/, '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  const ch = (v: number): number =>
    Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)))
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

const BASE_CSS = `
* { box-sizing: border-box; }
.abs { position: absolute; }
h1 { margin: 0; font-weight: 800; line-height: 1.14; letter-spacing: -0.5px; }
h1 .line { display: block; }
.sub { display: block; margin-top: 16px; font-weight: 500; line-height: 1.4; }
.brand { position: absolute; font-weight: 600; letter-spacing: 1px; }
`

/** 文字块：左锚定、避开顶部遮罩区，字号受列宽约束 */
function textBlock(o: CoverHtmlOptions, accent: string, color: string, subColor: string): string {
  const size = o.size === 'square' ? 'square' : 'wide'
  const lines = splitTitleLines(o.title)
  const fs = titleFontSize(Math.max(...lines.map((l) => l.length)), lines.length, size)
  const sub = o.subtitle?.trim() ? escapeHtml(o.subtitle.trim()) : ''
  const body = lines.map((l) => `<span class="line">${escapeHtml(l)}</span>`).join('')
  // 顶部让给标题遮罩、底部让给品牌行：居中发生在这段净空内，副标题就不会压到品牌行
  const guard = size === 'wide' ? Math.round(COVER_WIDE.h * TOP_GUARD) : Math.round(COVER_SQUARE.h * 0.16)
  const foot = size === 'wide' ? 108 : 112
  return `<div class="abs" style="left:0;top:0;bottom:0;width:${size === 'wide' ? SIZES.wide.w - squareSide('wide') : SIZES.square.w}px;display:flex;flex-direction:column;justify-content:center;padding:${guard}px ${PAD}px ${foot}px;">
    <div style="width:88px;height:8px;border-radius:4px;margin-bottom:20px;background:${accent}"></div>
    <h1 style="font-size:${fs}px;color:${color}">${body}${
      sub ? `<span class="sub" style="color:${subColor};font-size:${Math.round(fs * 0.3)}px">${sub}</span>` : ''
    }</h1>
  </div>`
}

function brandLine(brand: string | undefined, color: string, size: CoverSize): string {
  if (!brand) return ''
  const px = size === 'wide' ? 20 : 24
  return `<div class="brand" style="left:${PAD}px;bottom:30px;color:${color};font-size:${px}px">${escapeHtml(brand)}</div>`
}

/** 右侧方形画面：有底图放底图，没底图放光晕与同心圆——保证 1:1 缩略图永远有主体 */
function rightSquare(o: CoverHtmlOptions, accent: string): string {
  if (o.size !== 'wide') return ''
  const side = squareSide('wide')
  const common = `right:0;top:0;width:${side}px;height:${side}px;`
  if (o.bgSrc) {
    return `<div class="abs" style="${common}background-image:url('../${escapeHtml(o.bgSrc)}');background-size:cover;background-position:center"></div>`
  }
  // 刻意不铺自己的底色：只发光晕与同心圆，让主渐变贯穿整幅
  // （右区一旦自带底色，与左区色调不同就会留一条硬竖边，正是要避免的"硬拼接"）
  return `<div class="abs" style="${common}overflow:hidden">
    <div class="abs" style="left:-10%;top:-10%;width:120%;height:120%;background:radial-gradient(circle at 50% 50%, ${hexToRgba(accent, 0.3) ?? accent} 0%, ${hexToRgba(accent, 0) ?? 'rgba(0,0,0,0)'} 62%)"></div>
    <div class="abs" style="left:50%;top:50%;width:${Math.round(side * 0.86)}px;height:${Math.round(side * 0.86)}px;transform:translate(-50%,-50%);border:3px solid ${hexToRgba(accent, 0.5) ?? accent};border-radius:50%"></div>
    <div class="abs" style="left:50%;top:50%;width:${Math.round(side * 0.58)}px;height:${Math.round(side * 0.58)}px;transform:translate(-50%,-50%);border:2px solid ${hexToRgba(accent, 0.3) ?? accent};border-radius:50%"></div>
  </div>`
}

/** 左区与右区之间的柔化过渡：压在右图左缘，避免两块硬拼接（仅头图有右区） */
function edgeBlend(accent: string): string {
  const side = squareSide('wide')
  return `<div class="abs" style="right:${side - 150}px;top:0;width:150px;height:100%;background:linear-gradient(90deg, ${accent} 0%, ${hexToRgba(accent, 0) ?? 'rgba(0,0,0,0)'} 100%)"></div>`
}

/** 版式主体：文字一律锁左区，模板之间只差底衬、右图与配色 */
function stage(o: CoverHtmlOptions, accent: string): string {
  const deep = shade(accent, -0.34)
  const darker = shade(accent, -0.62)
  const onAccent = contrastText(accent)

  switch (o.template) {
    // 旧 id 'band'（底部色带）保留：老工程重渲染时落到新的左文右图版式
    case 'split':
    case 'band': {
      const base = `background:linear-gradient(115deg, ${darker} 0%, ${deep} 100%)`
      return `<div class="abs" style="inset:0;${base}">
        ${rightSquare(o, accent)}
        ${o.size === 'wide' ? edgeBlend(darker) : ''}
        ${textBlock(o, accent, '#ffffff', 'rgba(255,255,255,0.86)')}
        ${brandLine(o.brand, 'rgba(255,255,255,0.72)', o.size)}
      </div>`
    }
    case 'left': {
      const bar = o.size === 'wide' ? 20 : 18
      return `<div class="abs" style="inset:0;background:linear-gradient(120deg, #0f141d 0%, ${darker} 100%)">
        ${rightSquare(o, accent)}
        ${o.size === 'wide' ? edgeBlend('#0f141d') : ''}
        <div class="abs" style="left:0;top:0;bottom:0;width:${bar}px;background:${accent}"></div>
        ${textBlock(o, accent, '#ffffff', 'rgba(255,255,255,0.82)')}
        ${brandLine(o.brand, 'rgba(255,255,255,0.7)', o.size)}
      </div>`
    }
    case 'editorial': {
      // 刻意不吃底图：深色字压在照片上对比度会崩（尤其 1:1），它服务的是"没有配图"那条路。
      // 装饰块一律避开文字区：头图占右侧方形区，方图出血到右上角做成四分之一圆。
      const deco =
        o.size === 'wide'
          ? `right:0;top:0;width:${squareSide('wide')}px;height:100%`
          : 'right:-140px;top:-140px;width:540px;height:540px;border-radius:50%'
      return `<div class="abs" style="inset:0;background:#f5f3ef">
        <div class="abs" style="${deco};background:linear-gradient(160deg, ${hexToRgba(accent, 0.18) ?? accent} 0%, #ece8e1 100%)"></div>
        ${textBlock(o, accent, '#1f2937', '#4b5563')}
        ${brandLine(o.brand, '#6b7280', o.size)}
      </div>`
    }
    default: {
      // plain：强调色压深满底 + 左侧超大字
      return `<div class="abs" style="inset:0;background:linear-gradient(135deg, ${deep} 0%, ${darker} 100%)">
        ${rightSquare(o, accent)}
        ${o.size === 'wide' ? edgeBlend(darker) : ''}
        ${textBlock(o, accent, o.bgSrc ? '#ffffff' : onAccent, o.bgSrc ? 'rgba(255,255,255,0.86)' : onAccent)}
        ${brandLine(o.brand, o.bgSrc ? 'rgba(255,255,255,0.7)' : onAccent, o.size)}
      </div>`
    }
  }
}

/** 生成完整封面 HTML（宽高由内联样式锁死，离屏渲染按此截图） */
export function coverHtml(o: CoverHtmlOptions): string {
  const { w, h } = SIZES[o.size === 'square' ? 'square' : 'wide']
  const accent = safeAccent(o.accent)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html, body { width: ${w}px; height: ${h}px; margin: 0; padding: 0; overflow: hidden; }
body { position: relative; font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
${BASE_CSS}
</style></head><body>${stage(o, accent)}</body></html>`
}
