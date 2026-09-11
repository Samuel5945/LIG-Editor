import { contrastText, isDarkColor } from './categoryThemes'
import { hexToRgba } from './cards'

/**
 * 封面模板：纯 CSS/SVG 版式，不依赖任何内置图片资源。
 * 每个模板都要在两种比例下各渲染一次（2.35:1 头图与 1:1 方图），
 * 因此版式按 size 自适应（横竖排向、字号、留白），而不是同一套 DOM 硬缩。
 *
 * 本文件纯函数，无 electron 依赖：HTML 生成与字号阶梯都可直接单测（同 cards.ts）。
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

export interface CoverTemplate {
  id: string
  name: string
  /** picker 里的悬停说明 */
  hint: string
}

export const COVER_TEMPLATES: CoverTemplate[] = [
  { id: 'plain', name: '大字版式', hint: '强调色满底 + 超大标题，无底图也成立；有底图则压暗垫字' },
  { id: 'band', name: '底部色带', hint: '整幅底图，底部强调色带压标题；最像常规公众号头图' },
  { id: 'left', name: '左侧竖栏', hint: '左侧强调色竖条 + 左对齐标题，右侧留给底图' },
  { id: 'editorial', name: '杂志留白', hint: '浅底留白 + 细分隔线，适合不配图的纯文字封面' }
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
  /** 右下角品牌行（通常传账号名） */
  brand?: string
}

/** 标题字号阶梯：按字数下降，避免长标题溢出画布 */
export function titleFontSize(length: number, size: CoverSize): number {
  const steps = size === 'wide' ? [92, 76, 62, 50] : [118, 98, 80, 64]
  if (length <= 12) return steps[0]
  if (length <= 18) return steps[1]
  if (length <= 26) return steps[2]
  return steps[3]
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

/** 底图层 + 压暗层：有底图时保证标题在任何照片上都读得清 */
function bgLayers(bgSrc: string | undefined, scrim: string): string {
  if (!bgSrc) return ''
  return `<div class="bg" style="background-image:url('../${escapeHtml(bgSrc)}')"></div><div class="scrim" style="background:${scrim}"></div>`
}

function brandLine(brand: string | undefined, color: string): string {
  return brand ? `<div class="brand" style="color:${color}">${escapeHtml(brand)}</div>` : ''
}

const BASE_CSS = `
* { box-sizing: border-box; }
.bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
.scrim { position: absolute; inset: 0; }
.stage { position: relative; width: 100%; height: 100%; display: flex; overflow: hidden; }
.brand { position: absolute; right: 40px; bottom: 28px; font-size: 22px; letter-spacing: 1px; opacity: 0.72; }
h1 { margin: 0; font-weight: 800; line-height: 1.16; letter-spacing: -0.5px; word-break: break-word; }
.sub { display: block; margin-top: 18px; font-size: 26px; font-weight: 500; line-height: 1.4; opacity: 0.86; }
`

/** 版式主体：按模板与比例分支 */
function stage(o: CoverHtmlOptions, accent: string): string {
  const title = escapeHtml(o.title.trim() || '未命名')
  const subtitle = o.subtitle?.trim() ? escapeHtml(o.subtitle.trim()) : ''
  const size = titleFontSize(o.title.trim().length, o.size)
  const wide = o.size === 'wide'
  const onAccent = contrastText(accent)
  const accentDeep = isDarkColor(accent) ? accent : shade(accent, -0.45)

  switch (o.template) {
    case 'band': {
      // 整幅底图（无图则深色渐变兜底），底部色带压标题
      const bandH = wide ? 0.44 : 0.38
      const noBg = `background:linear-gradient(150deg, #1f2937, ${accentDeep})`
      return `<div class="stage">
        ${o.bgSrc ? bgLayers(o.bgSrc, 'linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.42))') : `<div class="bg" style="${noBg}"></div>`}
        <div style="position:absolute;left:0;right:0;bottom:0;height:${Math.round(bandH * 100)}%;background:${accent};padding:${wide ? '38px 56px' : '44px 52px'};display:flex;flex-direction:column;justify-content:center">
          <h1 style="font-size:${title}px;color:${onAccent}">${title}${subtitle ? `<span class="sub" style="color:${onAccent}">${subtitle}</span>` : ''}</h1>
        </div>
        ${brandLine(o.brand, onAccent)}
      </div>`
    }
    case 'left': {
      const bar = wide ? 22 : 18
      return `<div class="stage" style="background:#14181f">
        ${bgLayers(o.bgSrc, 'linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.42) 62%, rgba(0,0,0,0.28) 100%)')}
        <div style="position:absolute;left:0;top:0;bottom:0;width:${bar}px;background:${accent}"></div>
        <div style="position:relative;display:flex;flex-direction:column;justify-content:center;padding:${wide ? '56px 72px 56px 84px' : '60px 58px 60px 64px'};max-width:${wide ? '72%' : '100%'}">
          <h1 style="font-size:${title}px;color:#ffffff">${title}${subtitle ? `<span class="sub" style="color:rgba(255,255,255,0.82)">${subtitle}</span>` : ''}</h1>
        </div>
        ${brandLine(o.brand, 'rgba(255,255,255,0.7)')}
      </div>`
    }
    case 'editorial': {
      // 浅底留白：有底图时图片占上幅、文字压在下方；无底图则整版居中，不留空区
      const hasBg = !!o.bgSrc
      return `<div class="stage" style="background:#f6f4f0">
        ${hasBg ? `<div class="bg" style="background-image:url('../${escapeHtml(o.bgSrc as string)}');inset:0 0 auto 0;height:${wide ? '52%' : '40%'}"></div>` : ''}
        <div style="position:relative;${hasBg ? 'margin-top:auto;' : 'margin:auto 0;'}background:#f6f4f0;padding:${wide ? '40px 64px' : '48px 56px'};border-top:6px solid ${accent}">
          <h1 style="font-size:${title}px;color:#1f2937">${title}${subtitle ? `<span class="sub" style="color:#4b5563">${subtitle}</span>` : ''}</h1>
        </div>
        ${brandLine(o.brand, '#6b7280')}
      </div>`
    }
    default: {
      // plain：强调色满底 + 居左大字；有底图则压暗垫字
      const pad = wide ? '72px 80px' : '80px 64px'
      return `<div class="stage" style="background:${accent}">
        ${bgLayers(o.bgSrc, 'linear-gradient(140deg, rgba(0,0,0,0.62), rgba(0,0,0,0.34))')}
        <div style="position:relative;display:flex;flex-direction:column;justify-content:center;padding:${pad}">
          <h1 style="font-size:${title}px;color:${o.bgSrc ? '#ffffff' : onAccent}">${title}${subtitle ? `<span class="sub" style="color:${o.bgSrc ? 'rgba(255,255,255,0.84)' : onAccent}">${subtitle}</span>` : ''}</h1>
        </div>
        ${brandLine(o.brand, o.bgSrc ? 'rgba(255,255,255,0.7)' : onAccent)}
      </div>`
    }
  }
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

/** 生成完整封面 HTML（宽高由内联样式锁死，离屏渲染按此截图） */
export function coverHtml(o: CoverHtmlOptions): string {
  const { w, h } = SIZES[o.size === 'square' ? 'square' : 'wide']
  const accent = safeAccent(o.accent)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html, body { width: ${w}px; height: ${h}px; margin: 0; padding: 0; overflow: hidden; }
body { font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
${BASE_CSS}
</style></head><body>${stage(o, accent)}</body></html>`
}
