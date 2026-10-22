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

/** 公众号头图 2.35:1 —— 唯一真正交给后台的一张 */
export const COVER_WIDE = { w: 1175, h: 500 } as const
/**
 * 1:1 口径。公众号后台只采纳横图那一张，信息流/分享位的方图由它自己从横图裁，
 * 另外排一版方图它不认——所以 cover-11.png 是主图的裁剪产物（见 main/coverStore.ts），
 * 本文件的 size='square' 分支只留给「手写一份 square HTML」这种自愿用法。
 */
export const COVER_SQUARE = { w: 800, h: 800 } as const

const SIZES: Record<CoverSize, { w: number; h: number }> = {
  wide: COVER_WIDE,
  square: COVER_SQUARE
}

/**
 * 方图缺省取景：取到最右（1.0）。版式右侧那块方形画面区正好是主图最右边的满高正方形，
 * 取到边才落在设计留出的画面上；往左偏就会把标题尾字带进 1:1。
 */
export const DEFAULT_FOCAL = 1

/**
 * 方图裁剪：1:1 永远是从横图里取「满高的一段」，横位置由 focal（0=最左，1=最右）决定。
 * 竖图/方图画布则取满幅（居中），不放大。返回源图像素坐标，供 sharp.extract 直接用。
 */
export function squareCropRect(
  srcW: number,
  srcH: number,
  focal: number
): { left: number; top: number; width: number; height: number } {
  const side = Math.min(srcW, srcH)
  const f = Math.min(1, Math.max(0, Number.isFinite(focal) ? focal : DEFAULT_FOCAL))
  return {
    left: Math.round(f * (srcW - side)),
    top: Math.round((srcH - side) / 2),
    width: side,
    height: side
  }
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
  { id: 'magazine', name: '杂志大字', hint: '浅底细线 + 超大粗字 + 期号式装饰行，有底图时左侧自动磨砂面板' },
  { id: 'aurora', name: '氛围渐变', hint: '深底 + 强调色弥散光斑 + 细噪点，无底图也有氛围感，适合科技/AI 选题' },
  { id: 'plain', name: '大字版式', hint: '纯排印：超大字压底 + 右侧超大首字水印，不配图；方图裁到的就是那个首字' },
  { id: 'left', name: '左侧竖栏', hint: '深底 + 左侧强调色竖条，克制、有品牌感' },
  { id: 'editorial', name: '杂志留白', hint: '浅底细线 + 深色字，纯文字版式（不使用底图）' }
]

/**
 * 纯排印版式：刻意不吃底图。界面据此隐藏底图控件，主进程据此忽略传入的 bg——
 * 单源，免得两边各写一份 if 名单再漂移。
 */
export const NO_BG_TEMPLATES: readonly string[] = ['editorial', 'plain']

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
  /**
   * 压在照片上的文字用浅色还是深色：由主进程取样照片文字区亮度算出（见 main/coverStore.ts）。
   * 刻意不靠"压一层暗底"保可读性——那会在照片上凭空造出一块与照片对不上色的面板。
   * 无底图时忽略此项（各版式自己的底色已决定文字色）。
   */
  lightText?: boolean
  /**
   * 文字区磨砂面板：'none' 不铺（默认，靠自适应字色+投影兜底）；
   * 'frosted' 在文字块后垫一层 backdrop-filter 磨砂半透明面板——构图翻车（文字区不安静）时的保底。
   * 曾有一个 'auto' 档（按文字区亮度灰区自动开），实测效果一般、还多一层不可预期的判断，已删。
   */
  panel?: 'frosted' | 'none'
  /**
   * 1:1 方图裁横图时的取景位置（0=看最左，1=看最右），仅 size='square' 的手写 HTML 用到。
   * 默认流程不再渲染 square HTML：方图改为主图的实际裁剪，取景位置由 main/coverStore 的 focal 决定。
   */
  focalX?: number
  /** 装饰元素开关（光晕/圆环/细线等），缺省 true；关掉就是纯底色+字 */
  decor?: boolean
  /**
   * 超采样倍数：>1 时画布放大到 w×h 的 s 倍（版式坐标不变，最外层 transform: scale(s)）。
   * 用途是让「方图 = 主图裁剪」这一步拿到够高的源（500px 高的主图裁不出清晰的 800×800）。
   */
  scale?: number
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
 * maxLine 默认 9 字是照片版式的规矩（字要压在安静的左区）；纯排印版式要按自己的格子重排，见 posterLines。
 */
export function splitTitleLines(title: string, maxLine = MAX_LINE): string[] {
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
    if (seg.length > maxLine) {
      flush()
      for (let i = 0; i < seg.length; i += maxLine) lines.push(seg.slice(i, i + maxLine))
      continue
    }
    if (cur.length + seg.length > maxLine) flush()
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
 * opts.colW / opts.cap：通栏排印的版式（大字版式）要换一套列宽与上限，不复用左列那套
 */
export function titleFontSize(
  maxLineLen: number,
  lineCount: number,
  size: CoverSize,
  opts?: { colW?: number; cap?: number }
): number {
  const cap = opts?.cap ?? (size === 'wide' ? 118 : 152)
  const byWidth = Math.floor((opts?.colW ?? textColumnWidth(size)) / Math.max(1, maxLineLen))
  const fit = lineCount <= 2 ? 1 : lineCount === 3 ? 0.86 : 0.72
  return Math.max(34, Math.round(Math.min(cap, byWidth) * fit))
}

/**
 * 副标题字号：主标题的 2/3（90 标题配 60 副标题），下限 30px、上限 64px。
 * 早先各版式各写 0.22～0.3，主副标题差三倍多，副标题在信息流缩略图里糊成一条线；
 * 0.4 也还不够——封面就两行字时，副标题要能当第二信息层读，1.5:1 是海报里常见的层级。
 */
function subtitleSize(titleSize: number): number {
  return Math.max(30, Math.min(64, Math.round((titleSize * 2) / 3)))
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

/**
 * 磨砂玻璃的几何：它是"背景大小"的唯一来源——文字按它的内区排版，字号跟着它走。
 * 宽高两侧共用一套，面板与文字块都从这里取坐标，改一处两边同步。
 */
const GLASS = { insetX: 34, padX: 30, padY: 26, topRatio: 0.72, bottomRatio: 0.72 }

function textArea(size: CoverSize): { left: number; top: number; width: number; height: number } {
  const canvas = SIZES[size]
  const guard = size === 'wide' ? Math.round(canvas.h * TOP_GUARD) : Math.round(canvas.h * 0.16)
  const foot = size === 'wide' ? 56 : 60
  return { left: PAD, top: guard, width: textColumnWidth(size), height: canvas.h - guard - foot }
}

function glassRect(size: CoverSize): { left: number; top: number; width: number; height: number } {
  const canvas = SIZES[size]
  const guard = size === 'wide' ? Math.round(canvas.h * TOP_GUARD) : Math.round(canvas.h * 0.16)
  const foot = size === 'wide' ? 56 : 60
  const colBox = size === 'wide' ? canvas.w - squareSide(size) : canvas.w
  const top = Math.round(guard * GLASS.topRatio)
  const bottom = Math.round(foot * GLASS.bottomRatio)
  return { left: GLASS.insetX, top, width: colBox - GLASS.insetX * 2, height: canvas.h - top - bottom }
}

/** 玻璃内区：字数一多，字号就该跟着缩——测量对象是玻璃，不是画布 */
function glassInner(size: CoverSize): { left: number; top: number; width: number; height: number } {
  const g = glassRect(size)
  return { left: g.left + GLASS.padX, top: g.top + GLASS.padY, width: g.width - GLASS.padX * 2, height: g.height - GLASS.padY * 2 }
}

/**
 * 把「标题 + 副标题」拟合进一个矩形：先按宽度定字号，再看总高度够不够，不够就连标题一起缩。
 * 副标题按 2/3 走；缩到下限仍放不下就接受（极少见，长到那种程度该改文案了）。
 */
function fitText(
  title: string,
  sub: string,
  boxW: number,
  boxH: number,
  cap: number
): { lines: string[]; fs: number; subFs: number } {
  const lines = splitTitleLines(title)
  const maxLen = Math.max(...lines.map((l) => l.length))
  const minFs = 26
  // 给定标题字号时，整块需要多高（副标题按 2/3 折算成行数）
  const needHeight = (f: number): number => {
    const subFs = subtitleSize(f)
    const perLine = Math.max(1, Math.floor(boxW / subFs))
    const subLines = sub ? Math.ceil(sub.length / perLine) : 0
    return lines.length * f * 1.18 + (sub ? subLines * subFs * 1.45 + 18 : 0)
  }
  const fits = (f: number): boolean => needHeight(f) <= boxH
  let hi = Math.min(cap, Math.floor(boxW / Math.max(1, maxLen)))
  const lo0 = minFs
  // 先快速缩到能放下，再二分往上找最大能放下的字号（缩完不回收会显得字偏小）
  let fs = hi
  if (!fits(fs)) {
    for (let i = 0; i < 12 && fs > lo0; i++) {
      fs = Math.max(lo0, Math.floor(fs * (boxH / needHeight(fs))))
      if (fits(fs)) break
    }
  }
  if (fits(fs)) {
    let lo = fs
    let up = hi
    for (let i = 0; i < 12 && up - lo > 1; i++) {
      const mid = Math.floor((lo + up) / 2)
      if (fits(mid)) lo = mid
      else up = mid
    }
    fs = lo
  }
  return { lines, fs, subFs: subtitleSize(fs) }
}

/**
 * 文字块（左文右图 / 左侧竖栏 / 氛围渐变 共用这套净空与折行，但**排版各走各的**）：
 * - align 'left'（默认）：贴左排，配 bar 色条——左文右图的基准语言
 * - align 'center'：在文字盒内水平居中，配 mark 方块——氛围渐变的"夜空里一块光"
 * - rule：标题左侧带一条等高竖线（无色条）——左侧竖栏的栏首呼应
 * 三条硬规矩共用：避开顶部遮罩净空、底部给品牌行留空、字号受列宽硬约束、
 * 文字盒右界 = 画布宽 − 画布高（越界的字会被 1:1 裁成半截）。
 */
function textBlock(
  o: CoverHtmlOptions,
  accent: string,
  color: string,
  subColor: string,
  opts: { marker?: 'bar' | 'mark' | 'none'; align?: 'left' | 'center'; rule?: boolean } = {}
): string {
  const { marker = 'bar', align = 'left', rule = false } = opts
  const size = o.size === 'square' ? 'square' : 'wide'
  const glassOn = !!(o.bgSrc && o.panel === 'frosted')
  // 有无底图都用**同一套文字盒**（玻璃内区）——没底图时只是不画那块玻璃，
  // 版式坐标、字号、分类名位置都不变；早先无底图走另一个更宽的盒子，切一下底图整块会跳
  const box = glassInner(size)
  const ruleInset = rule ? 29 : 0
  const boxW = box.width - ruleInset
  const sub = o.subtitle?.trim() ? escapeHtml(o.subtitle.trim()) : ''
  const { lines, fs, subFs } = fitText(o.title, sub, boxW, box.height, size === 'wide' ? 90 : 152)
  const body = lines.map((l) => `<span class="line">${escapeHtml(l)}</span>`).join('')
  // 有底图时文字直接压在照片上，用一层极轻投影兜底可读性（不铺底色）；纯色版式不加，免得在平底上显脏
  const shadow = o.bgSrc ? 'text-shadow:0 2px 12px rgba(0,0,0,0.38);' : ''
  const centered = align === 'center'
  const mark = marker === 'none' ? '' : markerHtml(marker, accent, centered)
  const h1 = `<h1 style="font-size:${fs}px;color:${color};${shadow}${
    centered ? 'text-align:center;' : ''
  }">${body}${
    sub ? `<span class="sub" style="color:${subColor};font-size:${subFs}px">${sub}</span>` : ''
  }</h1>`
  const content = rule
    ? `<div style="border-left:3px solid ${accent};padding-left:26px;width:100%">${mark}${h1}</div>`
    : `${mark}${h1}`
  // 分类名留在玻璃外面：它不属于正文，落进玻璃里像没擦干净的水印
  const brand = o.brand?.trim() ?? ''
  const kickerLine = brand
    ? `<div style="color:${accent};font-size:${size === 'wide' ? 15 : 18}px;font-weight:600;letter-spacing:4px;${
        centered ? 'text-align:center;' : ''
      }${shadow}">${escapeHtml(brand)}</div>`
    : ''
  // 分类名一律排在盒外上方：有没有玻璃都不占正文的高度，字号也就不会因此缩水
  const kicker = !brand
    ? ''
    : `<div class="abs" style="left:0;top:${Math.max(8, glassRect(size).top - 30) - box.top}px;width:${box.width}px">${kickerLine}</div>`
  return `<div class="abs" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;display:flex;flex-direction:column;justify-content:center;${centered ? 'align-items:center;' : ''}">
    ${kicker}${content}
  </div>`
}

/**
 * 文字块标题上方的小标记：两套语言——
 * 'bar'：88×8 圆角色条（左文右图用，稳重）；
 * 'mark'：10px 实心方块 + 56px 细线并排（氛围渐变用，更"信号感"，与光斑的科技感配套）。
 * 居中版式靠外层容器的 justify-content 决定位置，自己不带对齐。
 */
function markerHtml(kind: 'bar' | 'mark', accent: string, centered = false): string {
  const flex = `display:flex;align-items:center;gap:14px;margin-bottom:20px${centered ? ';justify-content:center' : ''}`
  if (kind === 'mark') {
    return `<div style="${flex}">
      <div style="width:10px;height:10px;background:${accent}"></div>
      <div style="width:56px;height:1px;background:${rgba(accent, 0.75)}"></div>
    </div>`
  }
  return `<div style="width:88px;height:8px;border-radius:4px;margin-bottom:20px;background:${accent}"></div>`
}

/** 大字版式的行高：比照片版式的 1.14 更紧，格子高度就是全部版面 */
const POSTER_LINE_HEIGHT = 1.06

/**
 * 大字版式的排字：在 colW×boxH 的格子里自动挑「一行几个字」，让字号最大。
 * 照抄照片版式的「每行 ≤9 字」会把字排小——22 字的标题按 9 字排只有 68px，按 6 字排能到 ~93px；
 * 再叠上 titleFontSize 按行数打的折扣（4 行起打八六折、5 行起七二折）就更小，还挤成一坨。
 * 用户写了 `|` 分行就完全照他分的行，不再挑。
 */
/** 行首不许站标点（悬挂到上一行末尾的除外） */
const NO_LINE_HEAD = /[，。！？；：、）》”’%,.;:!?]/
/** 标点算半个字宽：全角逗号本身占一格，但它是收尾的悬挂件，不该把整行字号压小一档 */
const HANG_TAIL = /[，。！？；：、）》”’%,.;:!?]$/

/**
 * 大字版式专用折行：按「每行几个字」硬排，但行尾正好遇上标点时让标点悬挂在本行，
 * 不留一行只有一个标点的孤行（照片版式那套贪心折行会切出「，」独立成行，排进大字里非常难看）。
 */
function posterWrap(title: string, perLine: number): string[] {
  const text = title.trim()
  if (!text) return ['未命名']
  const lines: string[] = []
  let cur = ''
  for (const ch of text) {
    if (cur.length >= perLine && !NO_LINE_HEAD.test(ch)) {
      lines.push(cur)
      cur = ''
    }
    cur += ch
  }
  if (cur) lines.push(cur)
  return lines
}

function posterLines(title: string, colW: number, boxH: number, cap: number): { lines: string[]; fs: number } {
  const explicit = title
    .split(/[|｜]/)
    .map((l) => l.trim())
    .filter(Boolean)
  const candidates = explicit.length > 1 ? [Math.max(...explicit.map((l) => l.length))] : [4, 5, 6, 7, 8, 9]
  let best: { lines: string[]; fs: number } = { lines: ['未命名'], fs: 0 }
  for (const perLine of candidates) {
    const lines = explicit.length > 1 ? explicit : posterWrap(title, perLine)
    const maxEff = Math.max(...lines.map((l) => l.length - (HANG_TAIL.test(l) ? 0.5 : 0)))
    const fs = Math.floor(Math.min(cap, colW / maxEff, boxH / (lines.length * POSTER_LINE_HEIGHT)))
    if (fs > best.fs) best = { lines, fs }
  }
  return best
}

/**
 * 大字版式的文字块：与「左文右图」拉开在**排版**而不只是底色——自动挑最优断行把字放到最大、
 * 垂直居中吃满整格、不放标记色条。
 * 两条硬边界写死在结构里：右界 = 方图起点（越界的字会被 1:1 裁成半截），
 * 上下只留品牌行的净空（照片版式那 20% 顶部遮罩留白是给画面让路的，纯排印没有画面可让）。
 */
function posterText(o: CoverHtmlOptions, color: string, subColor: string): string {
  const size = o.size === 'square' ? 'square' : 'wide'
  const boxW = size === 'wide' ? SIZES.wide.w - squareSide('wide') : SIZES.square.w
  const colW = boxW - PAD * 2
  const padTop = 24
  // 底部只留呼吸（分类名在顶部 kicker，不再放底部）
  const padBottom = size === 'wide' ? 40 : 44
  const sub = o.subtitle?.trim() ? escapeHtml(o.subtitle.trim()) : ''
  const brand = o.brand?.trim() ?? ''
  // 副标题（一行多）与顶部 kicker 都要占高度，先从净空里扣掉，免得它们把大字顶出格子
  const boxH = SIZES[size].h - padTop - padBottom - (sub ? 46 : 0) - (brand ? 38 : 0)
  const { lines, fs } = posterLines(o.title, colW, boxH, 150)
  const body = lines.map((l) => `<span class="line">${escapeHtml(l)}</span>`).join('')
  const kicker = brand
    ? `<div style="color:${color};opacity:.8;font-size:16px;font-weight:600;letter-spacing:5px;margin-bottom:22px">${escapeHtml(brand)}</div>`
    : ''
  return `<div class="abs" style="left:0;top:0;bottom:0;width:${boxW}px;display:flex;flex-direction:column;justify-content:center;padding:${padTop}px ${PAD}px ${padBottom}px;">
    ${kicker}<h1 style="font-size:${fs}px;color:${color};line-height:${POSTER_LINE_HEIGHT};letter-spacing:-1px">${body}${
    sub
      ? `<span class="sub" style="color:${subColor};font-size:${subtitleSize(fs)}px;font-weight:500;margin-top:18px;letter-spacing:0">${sub}</span>`
      : ''
  }</h1>
  </div>`
}

/**
 * 文字区磨砂面板：一块**定好的玻璃**，文字按它的内区排版（见 glassInner）。
 * 尺寸只有 glassRect 一个来源——文字绝不越出玻璃，玻璃也不会被文字撑变形。
 * 只在有底图且 panel='frosted' 时出现；magazine 有底图时按模板语言默认开。
 */
function frostedPanel(o: CoverHtmlOptions): string {
  if (!o.bgSrc || o.panel !== 'frosted') return ''
  const size = o.size === 'square' ? 'square' : 'wide'
  const g = glassRect(size)
  const dark = o.lightText === false
  const bg = dark ? 'rgba(255,255,255,0.42)' : 'rgba(10,14,20,0.38)'
  return `<div class="abs" style="left:${g.left}px;top:${g.top}px;width:${g.width}px;height:${g.height}px;border-radius:24px;background:${bg};backdrop-filter:blur(18px) saturate(1.15);-webkit-backdrop-filter:blur(18px) saturate(1.15)"></div>`
}

/** hexToRgba 的兜底封装：本文件的色值都由 shade 派生，理论上不会失败，兜底只为类型收窄 */
function rgba(hex: string, alpha: number): string {
  return hexToRgba(hex, alpha) ?? 'rgba(0,0,0,0)'
}

/**
 * 底图与文字的同化。
 *
 * 刻意不再分「左面板 / 右图块」——两块各自有底色就必然存在一条边界。
 * 做法是照片整幅铺满，只叠一层极淡强调色（mix-blend-mode:color，取色相不改明度，
 * 所以右区原图亮度不受影响，仍可直裁 1:1）把照片色调拉向品牌色。
 *
 * 不再压暗部渐变：底图的左侧留白由生图提示词保证（主体偏右、左侧安静），
 * 再叠一层暗部等于凭空造出一块与照片对不上色的面板——那是"文字底色不对"的来源。
 * 可读性交给自适应字色（lightText，浅底用深字、深底用白字）加一层极轻投影兜底。
 */
function photoLayer(o: CoverHtmlOptions, accent: string): string {
  if (!o.bgSrc) return ''
  // 头图几乎无横向余量可移（21:9 源 vs 2.35:1 画布），构图靠提示词保证；
  // 1:1 方图会从横图裁掉左右两侧，主体既然偏右就得靠右取景，否则缩略图把主体裁没。
  // 取 78% 而非 100%：完全靠右会把主体留在画面正中，而方图文字是通栏的，会压在字上。
  // focalX 可由主进程按底图左右半区细节量改判（主体其实在左时不再盲信提示词）。
  const fx = Math.max(0, Math.min(1, o.focalX ?? 0.78))
  const pos = o.size === 'wide' ? 'center' : `${Math.round(fx * 100)}% center`
  return `<div class="abs" style="inset:0;background-image:url('../${escapeHtml(o.bgSrc)}');background-size:cover;background-position:${pos}"></div>
    <div class="abs" style="inset:0;background:${accent};mix-blend-mode:color;opacity:0.13"></div>`
}

/** 无底图时右侧方形区的主体感：光晕 + 实线环 + 虚线外环 + 圆心实点，不铺自己的底色（铺了就会与左区形成硬竖边） */
function ringDecor(o: CoverHtmlOptions, accent: string): string {
  if (o.size !== 'wide' || o.bgSrc || o.decor === false) return ''
  const side = squareSide('wide')
  const ring = (d: number, style: string): string =>
    `<div class="abs" style="left:50%;top:50%;width:${Math.round(d)}px;height:${Math.round(d)}px;transform:translate(-50%,-50%);${style};border-radius:50%"></div>`
  return `<div class="abs" style="right:0;top:0;width:${side}px;height:${side}px;overflow:hidden">
    <div class="abs" style="left:-10%;top:-10%;width:120%;height:120%;background:radial-gradient(circle at 50% 50%, ${rgba(accent, 0.3)} 0%, ${rgba(accent, 0)} 62%)"></div>
    ${ring(side * 0.94, `border:1px dashed ${rgba(accent, 0.32)}`)}
    ${ring(side * 0.78, `border:3px solid ${rgba(accent, 0.5)}`)}
    ${ring(side * 0.52, `border:2px solid ${rgba(accent, 0.28)}`)}
    <div class="abs" style="left:50%;top:50%;width:14px;height:14px;transform:translate(-50%,-50%);background:${accent};border-radius:50%"></div>
  </div>`
}

/**
 * 压在照片上的文字配色：浅底用深字、深底用白字。
 * 由主进程取样照片文字区亮度后经 lightText 传入；无底图时 lightText 为 undefined，
 * 走白字分支（各版式无图时的底衬都是深色）。
 */
function photoInk(o: CoverHtmlOptions): { fg: string; sub: string; brand: string } {
  return o.lightText === false
    ? { fg: '#1f2937', sub: '#4b5563', brand: '#6b7280' }
    : { fg: '#ffffff', sub: 'rgba(255,255,255,0.86)', brand: 'rgba(255,255,255,0.72)' }
}

/** 杂志大字的文字块：kicker 小标签行 + 900 字重大标题 + 副标题上方细线 */
function magazineText(o: CoverHtmlOptions, accent: string, color: string, subColor: string): string {
  const size = o.size === 'square' ? 'square' : 'wide'
  const glassOn = !!(o.bgSrc && o.panel === 'frosted')
  // 与左列同一套盒子：无底图时也不换排版
  const box = glassInner(size)
  const sub = o.subtitle?.trim() ? escapeHtml(o.subtitle.trim()) : ''
  const { lines, fs, subFs } = fitText(o.title, sub, box.width, box.height, 118)
  const body = lines.map((l) => `<span class="line">${escapeHtml(l)}</span>`).join('')
  const shadow = o.bgSrc ? 'text-shadow:0 2px 12px rgba(0,0,0,0.30);' : ''
  const kickerSize = size === 'wide' ? 17 : 20
  // 刊眉字（分类名/FEATURE）留在玻璃外面，与正文分开
  const kickerLine = `<div style="color:${accent};font-size:${kickerSize}px;font-weight:700;letter-spacing:6px">${escapeHtml(
    o.brand?.trim() || 'FEATURE'
  )}</div>`
  const kicker = `<div class="abs" style="left:0;top:${Math.max(8, glassRect(size).top - 32) - box.top}px;width:${box.width}px">${kickerLine}</div>`
  return `<div class="abs" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;display:flex;flex-direction:column;justify-content:center;">
    ${kicker}
    <h1 style="font-size:${fs}px;color:${color};font-weight:900;letter-spacing:0.5px;line-height:1.1;${shadow}">${body}${
      sub
        ? `<span class="sub" style="color:${subColor};font-size:${subFs}px;margin-top:22px;padding-top:18px;border-top:2px solid ${rgba(accent, 0.85)};width:fit-content">${sub}</span>`
        : ''
    }</h1>
  </div>`
}

function stage(o: CoverHtmlOptions, accent: string): string {
  const deep = shade(accent, -0.34)
  const darker = shade(accent, -0.62)
  const onAccent = contrastText(accent)
  const ink = photoInk(o)
  const decorOn = o.decor !== false

  switch (o.template) {
    // 旧 id 'band'（底部色带）保留：老工程重渲染时落到新的左文右图版式
    case 'split':
    case 'band': {
      const base = `background:linear-gradient(115deg, ${darker} 0%, ${deep} 100%)`
      return `<div class="abs" style="inset:0;${base}">
        ${photoLayer(o, accent)}
        ${ringDecor(o, accent)}
        ${frostedPanel(o)}
        ${textBlock(o, accent, ink.fg, ink.sub)}
      </div>`
    }
    case 'magazine': {
      // 杂志感：浅底 + 顶部双细线（刊眉语言）+ 超大粗字 + 期号式 kicker + 右下页码式装饰。
      // 有底图时底图整幅铺满，文字区磨砂面板是本模板的默认件（杂志封面本就常见蒙版），
      // 面板色跟随自适应字色：深字配半透白、白字配半透黑。
      const paper = '#faf8f4'
      const fg = o.bgSrc ? ink.fg : '#16181d'
      const subC = o.bgSrc ? ink.sub : '#4b5563'
      const lineColor = o.bgSrc ? rgba(accent, 0.9) : '#16181d'
      // 刊眉双线只走文字列，不通栏：1:1 是从主图最右裁满高一段，通栏线会横穿方图，
      // 缩略图里就留下一条来路不明的横线（杂志语言再正也不行）。右界与标题列同宽。
      const ruleW = textColumnWidth(o.size)
      const masthead = decorOn
        ? `<div class="abs" style="left:${PAD}px;width:${ruleW}px;top:26px;height:2px;background:${lineColor}"></div>
           <div class="abs" style="left:${PAD}px;width:${ruleW}px;top:34px;height:1px;background:${o.bgSrc ? rgba(accent, 0.5) : 'rgba(22,24,29,0.4)'}"></div>`
        : ''
      // 页码式装饰：右下 accent 小方块 + 细线，杂志页脚语言。
      // 同样收在文字列内右对齐（不是画布右缘）——画布右边那 500px 会被整块裁进方图
      const folio = decorOn
        ? `<div class="abs" style="left:${PAD}px;width:${ruleW}px;bottom:36px;display:flex;align-items:center;justify-content:flex-end;gap:10px">
            <div style="width:40px;height:1px;background:${o.bgSrc ? rgba(accent, 0.8) : 'rgba(22,24,29,0.5)'}"></div>
            <div style="width:11px;height:11px;background:${accent}"></div>
          </div>`
        : ''
      // 无底图时右侧方形区的杂志式装饰：细描边大圆 + 圆心横线出血到右缘 + accent 实心小方块
      const side = squareSide('wide')
      const deco =
        decorOn && !o.bgSrc && o.size === 'wide'
          ? `<div class="abs" style="right:0;top:0;width:${side}px;height:${side}px;overflow:hidden">
              <div class="abs" style="left:50%;top:50%;width:${Math.round(side * 0.8)}px;height:${Math.round(side * 0.8)}px;transform:translate(-50%,-50%);border:2px solid ${rgba(accent, 0.55)};border-radius:50%"></div>
              <div class="abs" style="left:50%;top:50%;width:50%;height:1px;background:${rgba(accent, 0.45)}"></div>
              <div class="abs" style="left:50%;top:50%;width:26px;height:26px;transform:translate(-50%,-50%);background:${accent}"></div>
            </div>`
          : ''
      const brandColor = o.bgSrc ? ink.brand : '#6b7280'
      return `<div class="abs" style="inset:0;background:${paper}">
        ${photoLayer(o, accent)}
        ${deco}
        ${frostedPanel(o)}
        ${masthead}
        ${magazineText(o, accent, fg, subC)}
        ${folio}
      </div>`
    }
    case 'aurora': {
      // 氛围渐变：深底 + accent 派生的弥散光斑（radial-gradient 自带软边，无需 filter）+ 细噪点。
      // 无底图也成立——光斑本身就是画面主体；有底图时左侧压一道暗渐变保文字（本模板整体暗调，压暗不违和）。
      const night = '#0a0e17'
      const glow1 = shade(accent, 0.18)
      const glow2 = shade(accent, -0.2)
      const noise =
        "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/%3E%3C/filter%3E%3Crect width=%22120%22 height=%22120%22 filter=%22url(%23n)%22 opacity=%220.5%22/%3E%3C/svg%3E')"
      const glows = decorOn
        ? `<div class="abs" style="right:-8%;top:-22%;width:72%;height:110%;background:radial-gradient(circle at 50% 45%, ${rgba(glow1, 0.5)} 0%, ${rgba(glow1, 0)} 62%)"></div>
           <div class="abs" style="right:6%;bottom:-30%;width:52%;height:80%;background:radial-gradient(circle at 50% 55%, ${rgba(glow2, 0.42)} 0%, ${rgba(glow2, 0)} 60%)"></div>
           <div class="abs" style="left:-14%;bottom:-28%;width:44%;height:70%;background:radial-gradient(circle at 50% 50%, ${rgba(accent, 0.22)} 0%, ${rgba(accent, 0)} 62%)"></div>`
        : ''
      // 有底图时的暗部渐变：文字列（0 到 画布宽−画布高 ≈ 57%）整段要沉到近黑，右侧主体留住。
      // 0.9 → 0.78@45% → 0.35@70%：原来只压到 0.32，一张亮底图（lum≈0.9）在文字列右端合成后仍有
      // 约 160 的亮度，白字压上去对比只有 2:1 上下——这就是「氛围渐变的字色和底图不匹配」的来源。
      const veil = o.bgSrc
        ? `<div class="abs" style="inset:0;background:linear-gradient(100deg, rgba(10,14,23,0.9) 0%, rgba(10,14,23,0.78) 45%, rgba(10,14,23,0.35) 70%, rgba(10,14,23,0.02) 100%)"></div>`
        : ''
      // 极光地平细线：给纯渐变底一个"水平参照"，否则满屏光斑容易显得飘。
      // 但只画到文字列右界（画布宽 − 画布高 = 675px）并在那里淡出：1:1 是从最右裁满高一段，
      // 线要横贯过去，缩略图里就凭空多一条来路不明的横线
      const horizonW = o.size === 'wide' ? SIZES.wide.w - squareSide('wide') : SIZES.square.w
      const horizon = decorOn
        ? `<div class="abs" style="left:0;width:${horizonW}px;top:76%;height:1px;background:linear-gradient(90deg, ${rgba(accent, 0)} 0%, ${rgba(shade(accent, 0.35), 0.55)} 26%, ${rgba(shade(accent, 0.35), 0.55)} 44%, ${rgba(accent, 0)} 100%)"></div>`
        : ''
      // 字色不再跟原图亮度判：本模板的封底恒深（无底图是夜空，有底图被暗部压到近黑），
      // 拿原图取样判出来的深字压在暗部上就是黑压黑。深底配浅字在这里是恒等式，不是权衡。
      const fg = '#f4f6fb'
      const subC = 'rgba(244,246,251,0.78)'
      return `<div class="abs" style="inset:0;background:${night}">
        ${photoLayer(o, accent)}
        ${veil}
        ${glows}
        <div class="abs" style="inset:0;background-image:${noise};opacity:0.05"></div>
        ${horizon}
        ${frostedPanel(o)}
        ${textBlock(o, accent, fg, subC, { marker: 'mark', align: 'center' })}
      </div>`
    }
    case 'left': {
      // 左侧竖栏：一条 accent 色栏 + **标题等高竖线勾边**的排字（不放色条、不居中）。
      // 原先把条加宽到 44px 是为了刻竖排品牌字，但那行字与左下品牌行是同一句话，缺省还回退成「LIG」——去掉。
      // 竖线是"栏"的语言：它让这块文字读起来像是从色栏里长出来的，与左文右图的贴左排字一眼可分
      const bar = o.size === 'wide' ? 20 : 18
      return `<div class="abs" style="inset:0;background:linear-gradient(120deg, #0f141d 0%, ${darker} 100%)">
        ${photoLayer(o, accent)}
        ${ringDecor(o, accent)}
        ${frostedPanel(o)}
        <div class="abs" style="left:0;top:0;bottom:0;width:${bar}px;background:${accent}"></div>
        ${textBlock(o, accent, ink.fg, ink.sub, { marker: 'none', rule: true })}
      </div>`
    }
    case 'editorial': {
      // 刻意不吃底图：深色字压在照片上对比度会崩（尤其 1:1），它服务的是"没有配图"那条路。
      // 装饰块一律避开文字区：头图占右侧方形区，方图出血到右上角做成四分之一圆。
      const side = squareSide('wide')
      const deco =
        o.size === 'wide'
          ? `right:0;top:0;width:${side}px;height:100%`
          : 'right:-140px;top:-140px;width:540px;height:540px;border-radius:50%'
      // 渐变块里嵌一道细环，避免整块渐显成"补丁"；环色跟 accent 走，白环在浅底上几乎看不见
      const innerRing =
        decorOn && o.size === 'wide'
          ? `<div class="abs" style="left:50%;top:50%;width:${Math.round(side * 0.52)}px;height:${Math.round(side * 0.52)}px;transform:translate(-50%,-50%);border:1px solid ${rgba(accent, 0.4)};border-radius:50%"></div>`
          : ''
      // kicker：细线 + 灰色小字，比色条克制，配"留白"调性
      const kicker = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <div style="width:64px;height:1px;background:${accent}"></div>
          <span style="color:#6b7280;font-size:13px;font-weight:600;letter-spacing:4px">${escapeHtml(o.brand?.trim() || 'ESSAY')}</span>
        </div>`
      const lines = splitTitleLines(o.title)
      const fs = titleFontSize(Math.max(...lines.map((l) => l.length)), lines.length, o.size, {
        cap: o.size === 'wide' ? 90 : 152
      })
      const sub = o.subtitle?.trim() ? escapeHtml(o.subtitle.trim()) : ''
      const body = lines.map((l) => `<span class="line">${escapeHtml(l)}</span>`).join('')
      const guard = o.size === 'wide' ? Math.round(COVER_WIDE.h * TOP_GUARD) : Math.round(COVER_SQUARE.h * 0.16)
      const foot = o.size === 'wide' ? 108 : 112
      const colW = o.size === 'wide' ? SIZES.wide.w - squareSide('wide') : SIZES.square.w
      const text = `<div class="abs" style="left:0;top:0;bottom:0;width:${colW}px;display:flex;flex-direction:column;justify-content:center;padding:${guard}px ${PAD}px ${foot}px;">
        ${decorOn ? kicker : ''}
        <h1 style="font-size:${fs}px;color:#1f2937">${body}${
          sub ? `<span class="sub" style="color:#4b5563;font-size:${subtitleSize(fs)}px">${sub}</span>` : ''
        }</h1>
      </div>`
      return `<div class="abs" style="inset:0;background:#f5f3ef">
        <div class="abs" style="${deco};background:linear-gradient(160deg, ${hexToRgba(accent, 0.3) ?? accent} 0%, #ece8e1 100%)">${innerRing}</div>
        ${text}
      </div>`
    }
    default: {
      // plain「大字版式」：纯排印海报，**刻意不吃底图**（与 editorial 同属 NO_BG_TEMPLATES）。
      // 原来它和 split 共用同一个左列文字块，只差背景渐变的 135° 与 115°——照片一铺就完全撞脸，
      // 所以这里既忽略底图，也换成底部对齐、上限 150 的超大字（posterText），右区整个留给首字水印。要照片压字请选「左文右图」。
      const p: CoverHtmlOptions = { ...o, bgSrc: undefined, panel: undefined }
      const side = squareSide('wide')
      const firstChar = splitTitleLines(o.title)[0]?.trim().charAt(0) ?? ''
      // 右区放标题首字的超大水印（亮于底色 10% 明度）——满版纯色的"海报字"语言，让没有配图的封面也有记忆点
      const watermark =
        decorOn && o.size === 'wide' && firstChar
          ? `<div class="abs" style="right:0;top:0;width:${side}px;height:${side}px;overflow:hidden;display:flex;align-items:center;justify-content:center">
              <span style="font-size:${Math.round(side * 0.74)}px;font-weight:900;line-height:1;color:${rgba(shade(accent, 0.55), 0.26)};transform:translateY(-4%)">${escapeHtml(firstChar)}</span>
            </div>`
          : ''
      // 右下角一团 accent 亮斑，打破满版渐变的大平面
      const glowSpot = decorOn
        ? `<div class="abs" style="right:-10%;bottom:-35%;width:55%;height:90%;background:radial-gradient(circle at 50% 50%, ${rgba(shade(accent, 0.2), 0.3)} 0%, ${rgba(accent, 0)} 62%)"></div>`
        : ''
      return `<div class="abs" style="inset:0;background:linear-gradient(135deg, ${deep} 0%, ${darker} 100%)">
        ${watermark}
        ${glowSpot}
        ${watermark ? '' : ringDecor(p, accent)}
        ${posterText(p, onAccent, rgba(onAccent, 0.8))}
      </div>`
    }
  }
}

/** 生成完整封面 HTML（宽高由内联样式锁死，离屏渲染按此截图） */
export function coverHtml(o: CoverHtmlOptions): string {
  const { w, h } = SIZES[o.size === 'square' ? 'square' : 'wide']
  const accent = safeAccent(o.accent)
  // magazine 有底图时磨砂面板是默认件（杂志封面的蒙版语言）；其余模板缺省不铺面板
  const resolved: CoverHtmlOptions =
    o.template === 'magazine' && o.bgSrc && !o.panel ? { ...o, panel: 'frosted' } : o
  // 超采样只在最外层套一次 transform: scale(s)——版式里的留白、字号、面板位置一律按 1× 写，不用各自乘系数。
  // 为什么不用 Electron 的 setZoomFactor：离屏窗口里它实测不生效（成品只占画布左上角，其余是白底），
  // 而 CSS transform 是确定性的，还能在单测里断言。
  const s = o.scale && o.scale > 1 ? o.scale : 1
  const art = stage(resolved, accent)
  const body =
    s === 1
      ? art
      : `<div style="position:relative;width:${w}px;height:${h}px;transform:scale(${s});transform-origin:0 0">${art}</div>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html, body { width: ${Math.round(w * s)}px; height: ${Math.round(h * s)}px; margin: 0; padding: 0; overflow: hidden; }
body { position: relative; isolation: isolate; font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
${BASE_CSS}
</style></head><body>${body}</body></html>`
}
