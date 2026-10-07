import type {
  ProjectMeta,
  ArticleTheme,
  H1Style,
  H2Style,
  H2Num,
  H3Mark,
  QuoteStyle,
  HrStyle,
  StrongStyle,
  CustomThemeLibrary,
  StoredThemeEntry
} from './types'
import { isHexColor } from './cards'
import { UNCATEGORIZED } from './categories'
export type { ArticleTheme, H1Style, H2Style, H2Num, H3Mark, QuoteStyle, HrStyle, StrongStyle } from './types'

/**
 * 分类调性：不同分类套用不同排版气质（强调色 / 字体 / 行高 / 字距 / 标题对齐 /
 * 背景卡片 / 标题装饰 / 引用形态 / 分隔线 / 加粗高亮 / 图片圆角 / 段间距）。
 * 解析链：项目显式强调色（meta.accent，用户手动选色） > 分类调性 > 默认调性。
 * 自定义分类无预设调性 → 回落默认。编辑器与导出 HTML 共用同一主题对象，所见即所得。
 * 新增结构级风格字段全部可选：缺省回退「默认调性」的经典排版，向后兼容。
 * ArticleTheme 类型定义在 shared/types.ts（IPC 契约也要引用，避免循环依赖）。
 */

const SANS = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
const SERIF = '"Source Han Serif SC", "Noto Serif SC", "STSong", "SimSun", serif'

/** 6 位 hex → [r,g,b]（0..1，含 3 位缩写展开）；非法返回 undefined */
function rgbOf(color: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return undefined
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const n = parseInt(hex, 16)
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]
}

/** WCAG 相对亮度（0 黑 / 1 白）；非法色按黑处理 */
function relLuminance(color: string): number {
  const rgb = rgbOf(color)
  if (!rgb) return 0
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/** 两色 WCAG 对比度（1..21）；读不清的脏数据自然拿低分 */
export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a)
  const lb = relLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** hex → HSL（h 角度，s/l 0..1）；非法返回 undefined */
function hslOf(color: string): { h: number; s: number; l: number } | undefined {
  const rgb = rgbOf(color)
  if (!rgb) return undefined
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const raw = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  const h = raw * 60
  return { h: h < 0 ? h + 360 : h, s, l }
}

/**
 * 是否「强调档」颜色：作者点名要看得见的品牌/装饰色——有彩度且属中调亮度
 * （科技绿 #0d9488、荧光青 #22d3ee、橙 #f59e0b、紫 #8b5cf6 这类）。
 * 近中性（#333 / #1a1a1a / #eef2f7）与极浅的灰彩（夜间默认浅字 #cbd5e1）都归文字档。
 */
export function isBrandColor(color: string): boolean {
  const hsl = hslOf(color)
  if (!hsl) return false
  return hsl.s >= 0.2 && hsl.l >= 0.15 && hsl.l <= 0.7
}

/**
 * 背景色是否偏深（用于选前景色/引用文字色）。WCAG 相对亮度 < 0.35 视为深色。
 * 非法输入按浅色处理（导出默认白底、编辑器默认深底由调用方按场景兜底）。
 */
export function isDarkColor(bg: string): boolean {
  if (!rgbOf(bg)) return false
  // 3 位缩写（#333）在 rgbOf 里已展开为 6 位再判
  return relLuminance(bg) < 0.35
}

/**
 * 按背景色亮度自动选前景色：亮底深字 / 暗底白字（保证 WCAG AA 级对比度）。
 * 阈值 0.35：橙色(#f59e0b)/荧光青(#22d3ee) 等中亮色用深字（对比 6:1+），
 * 深蓝/紫/红等低亮度用白字。用于 pill 胶囊 / block 色块标题等色块场景。
 */
export function contrastText(bg: string): string {
  // 非法输入回白（向后兼容）；合法色（含 3 位缩写）按亮度选深/浅字
  if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(bg.trim())) return '#ffffff'
  return isDarkColor(bg) ? '#ffffff' : '#2b2b2b'
}

/**
 * 公众号夜间逻辑（算法模拟）：把日间排版的颜色自动变深——色相保留、亮度翻转 + 降饱和。
 * - 背景（浅底→深底）：L' = 1 - L 夹在 [0.09, 0.16]，S' = S × 0.35（暖白卡→深暖卡、
 *   浅蓝白卡→深蓝黑卡）；
 * - 文字（深字→浅字）：贴近日间反色的「近白」观感——线性翻转 #333 只会得到 #ccc 偏灰
 *   看不清，公众号实际反色接近白，故夹在 [0.88, 0.94]（#333→#e0e0e0），S' = S × 0.5。
 * 强调色不走此函数（微信夜间对中亮度色基本保持原样）——这条现在由代码保证：
 * resolveEditorTheme / readableOn 的强调档把品牌色挡在翻转与换灰之外，
 * 只有它在当前底上读不清（<3:1）时才退回默认文字色。非法输入原样返回，
 * 由调用方的深浅兜底修正。
 */
export function wechatDarkColor(hex: string, kind: 'bg' | 'text' = 'bg'): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  // 3 位缩写（#333）展开为 6 位再变换（否则会被当非法色原样返回，夜间出深字看不清）
  const full = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const n = parseInt(full, 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l2 =
    kind === 'text'
      ? Math.min(0.94, Math.max(0.88, 1 - l))
      : Math.min(0.16, Math.max(0.09, 1 - l))
  const s2 = s * (kind === 'text' ? 0.5 : 0.35)
  const c = (1 - Math.abs(2 * l2 - 1)) * s2
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const mo = l2 - c / 2
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const to255 = (v: number) => Math.round((v + mo) * 255)
  return (
    '#' + rgb.map((v) => to255(v).toString(16).padStart(2, '0')).join('')
  )
}

export interface EditorThemeColors {
  /** 实际卡片背景色（夜间=公众号逻辑自动变深；无卡片主题夜间给默认深底；日间无卡片为 undefined → 透明白底） */
  bodyBg?: string
  /** 实际正文文字色（已做深浅兜底，杜绝浅底浅字看不清） */
  bodyText: string
  /** 实际标题文字色（同上兜底） */
  headingColor: string
  /** 卡片/面板是否偏深（无卡片时按 UI 深浅） */
  darkBg: boolean
}

/** 夜间配色兜底卡片底色（无卡片/浅底主题选夜间配色时使用，防白底浅字不可读） */
export const DEFAULT_NIGHT_BG = '#1e2126'

/**
 * 文字色落到 bg 上的最终值（分档规则唯一来源，resolveEditorTheme 与导出 buildStyles 共用）：
 * - 强调档：有彩度且在这个底上读得清（≥3:1）→ 原样保留（微信夜间不动中亮度品牌色）
 * - 文字档：亮度与底撞车（深底深字 / 浅底浅字）→ 换给定的默认色
 * bg 为 undefined（无卡片透明白底）时不参与判断，原样返回。
 */
export function readableOn(color: string, bg: string | undefined, fallback: string): string {
  if (!bg) return color
  if (isBrandColor(color) && contrastRatio(color, bg) >= 3) return color
  return isDarkColor(color) === isDarkColor(bg) ? fallback : color
}

/**
 * 编辑器昼夜配色解析（纯函数，ArticleEditor 注入 CSS 变量用）：
 * - 日间 = 主题基础色（浅卡保持浅卡、自定义深卡保持深卡、无卡片透明白底）
 * - 夜间 = 公众号逻辑：不再有手调深色排版，把日间基础色经 wechatDarkColor
 *   自动变深（浅底→深底、深字→浅字）；深色基础色保持原样；无卡片主题给
 *   默认深底 DEFAULT_NIGHT_BG，避免「白底浅字」不可读
 * - 深浅兜底分两档判：
 *   文字档（近中性的正文/标题色）亮度与底不匹配就换默认浅/深字——历史导入的脏数据
 *   （浅粉底配浅灰字等）靠这条活着；
 *   强调档（isBrandColor：有彩度的中调品牌色，如科技绿 #0d9488）既不翻转也不换灰，
 *   只要在当前底上还读得清（≥3:1）就原样保留，与微信夜间「对中亮度色保持原样」一致。
 *   没做分档前，科技绿的标题会被判「同暗度」直接刷成 #eef2f7，夜间丢掉那口绿。
 * 导出/公众号同源：buildStyles 传 uiDark 时走同一解析，预览/复制/推送与编辑器一致。
 */
export function resolveEditorTheme(theme: ArticleTheme, uiDark: boolean): EditorThemeColors {
  const baseBg = theme.bodyBg
  const bg = uiDark
    ? !baseBg
      ? DEFAULT_NIGHT_BG
      : isDarkColor(baseBg)
        ? baseBg
        : wechatDarkColor(baseBg)
    : baseBg
  const darkBg = bg ? isDarkColor(bg) : uiDark
  /** 落到 bg 上的最终色：夜间先把文字档的深字翻成近白浅字（强调档不翻，翻了就褪色），
   *  再由 readableOn 决定要不要换成默认色 */
  const laneColor = (value: string, fallback: string): string => {
    const inverted =
      uiDark && baseBg && !isBrandColor(value) && isDarkColor(value) ? wechatDarkColor(value, 'text') : value
    return readableOn(inverted, bg, fallback)
  }
  const bodyText = laneColor(theme.bodyText ?? (darkBg ? '#cbd5e1' : '#333'), darkBg ? '#cbd5e1' : '#333')
  const headingColor = laneColor(theme.headingColor ?? (darkBg ? '#eef2f7' : '#1a1a1a'), darkBg ? '#eef2f7' : '#1a1a1a')
  return { bodyBg: bg, bodyText, headingColor, darkBg }
}

/**
 * 页面纸底昼夜解析：日间 = 主题纸色；夜间 = 公众号逻辑自动变深（浅纸变深纸、深纸保持）。
 * 不设纸底返回 undefined（调用方回自身底色逻辑）。编辑器画布与导出页面外壳共用，
 * 与 resolveEditorTheme 的卡片变深逻辑同源同参。
 */
export function resolvePageBg(theme: Pick<ArticleTheme, 'pageBg'>, uiDark: boolean): string | undefined {
  const base = theme.pageBg && isHexColor(theme.pageBg) ? theme.pageBg.trim() : undefined
  if (!base) return undefined
  return uiDark && !isDarkColor(base) ? wechatDarkColor(base) : base
}

/** 默认调性：与编辑器/导出历史排版一致（青绿强调色、黑体、2.13 行高、居中大标题）；
 * 2026-08-21 日间配色换色：默认蓝 #4f8cff → 青绿 #0d9488（深底 4.5:1 / 白底 3.7:1，昼夜同源跟色） */
export const DEFAULT_THEME: ArticleTheme = {
  accent: '#0d9488',
  fontFamily: SANS,
  lineHeight: 2.13,
  letterSpacing: '0.02em',
  fontSize: 16,
  headingFontSize: 20,
  headingAlign: 'center'
}

/**
 * 预设分类调性（按分类名索引；未收录的分类回落默认）。
 * 每套都参考了对应领域的公众号爆款排版范式（只有一套日间排版，夜间由
 * resolveEditorTheme 按公众号逻辑自动变深，不再手调深色变体）：
 * - 科技数码：衬线正文 + 青绿强调 + 下划线大标题 + ① 序号 + 圆角卡片引用（2026-10-02 由作者沉淀的「科技绿」主题转正）
 * - 设计鉴赏：杂志极简留白 + 直角图片 + 细下划线小节（设计美学号常见范式）
 * - 生活常识：暖色圆角卡片 + 胶囊标题 + 高亮加粗（生活科普爆款范式）
 * - 情感回忆：文艺信笺 + 引号引用 + 衬线疏朗（深夜情感号范式）
 * - 哲学思考：极简黑白 + 纯文字标题 + 通栏细线 + 大段距（哲思类公众号范式）
 * - 未分类（兜底调性，2026-10-07 重设计）：新建工程不选分类就落这里，等于应用的脸面，
 *   要压得住任何题材——冷灰纸底 + 白卡双层表面、墨蓝报头横幅、左条小节、淡靛高亮划重点，
 *   全部走 40 项新口径（pageBg / h1Style banner / imgFrame / imgGap / captionAlign / tableStyle）。
 *   夜间只覆盖 bodyBg/bodyText/headingColor 三项，故引用底色、表格边框这类不参与变深的
 *   字段一律留空走自适应，不写死浅值（否则深卡上是一块亮板）。
 *   原先这一格直接等于 DEFAULT_THEME（裸默认，无纸底无卡片），新用户首篇即是裸的。
 */
export const CATEGORY_THEMES: Record<string, ArticleTheme> = {
  科技数码: {
    accent: '#0d9488',
    fontFamily: SERIF,
    lineHeight: 1.85,
    letterSpacing: '0.04em',
    headingAlign: 'left',
    fontSize: 16,
    headingFontSize: 20,
    headingColor: '#0d9488',
    strongColor: '#0d9488',
    h1Style: 'underline',
    h2Style: 'plain',
    h2Num: '①',
    h3Mark: 'diamond',
    quoteStyle: 'card',
    hrStyle: 'line',
    strongStyle: 'color',
    imgRadius: 8,
    bodyRadius: 8,
    pGap: 18
  },
  设计鉴赏: {
    accent: '#8b5cf6',
    fontFamily: SANS,
    lineHeight: 2.05,
    letterSpacing: '0.03em',
    headingAlign: 'center',
    h1Style: 'bar',
    h2Style: 'underline',
    h3Mark: 'dot',
    quoteStyle: 'leftbar',
    hrStyle: 'dot',
    strongStyle: 'color',
    imgRadius: 0,
    pGap: 20
  },
  生活常识: {
    accent: '#f59e0b',
    fontFamily: SANS,
    lineHeight: 2.0,
    letterSpacing: '0.02em',
    headingAlign: 'center',
    // 暖白卡 + 深字（手调深暖卡在公众号夜间无法显示，夜间由公众号逻辑自动变深）
    bodyBg: '#fffaf2',
    bodyText: '#3d3a34',
    headingColor: '#1a1a1a',
    bodyRadius: 18,
    bodyPadding: '16px 18px',
    h1Style: 'pill',
    h2Style: 'block',
    h3Mark: 'diamond',
    quoteStyle: 'card',
    hrStyle: 'dot',
    strongStyle: 'highlight',
    strongBg: '#fef3c7',
    imgRadius: 14,
    pGap: 16
  },
  情感回忆: {
    accent: '#d64550',
    fontFamily: SERIF,
    lineHeight: 2.2,
    letterSpacing: '0.04em',
    headingAlign: 'center',
    h1Style: 'underline',
    h2Style: 'leftbar',
    h3Mark: 'diamond',
    quoteStyle: 'quotes',
    hrStyle: 'line',
    strongStyle: 'color',
    imgRadius: 8,
    pGap: 18
  },
  哲学思考: {
    accent: '#6b7280',
    fontFamily: SERIF,
    lineHeight: 2.25,
    letterSpacing: '0.05em',
    headingAlign: 'center',
    h1Style: 'bar',
    h2Style: 'plain',
    h3Mark: 'none',
    quoteStyle: 'quotes',
    hrStyle: 'long',
    strongStyle: 'plain',
    imgRadius: 0,
    pGap: 24
  },
  workbuddy: {
    accent: '#00b189',
    fontFamily: SERIF,
    lineHeight: 2.0,
    letterSpacing: '0.02em',
    headingAlign: 'center',
    // 小节：品牌绿纯文字居中 + 「01」序号（与导入的 workbuddy 排版同源）
    h1Style: 'bar',
    h2Style: 'plain',
    h2Num: '01',
    headingFontSize: 22,
    quoteStyle: 'card',
    hrStyle: 'line',
    strongStyle: 'color',
    pGap: 24
  },
  [UNCATEGORIZED]: {
    accent: '#2f4b7c',
    fontFamily: SANS,
    fontSize: 15,
    headingFontSize: 20,
    lineHeight: 1.9,
    letterSpacing: '0.02em',
    pGap: 16,
    bodyAlign: 'flush',
    headingAlign: 'left',
    // 报头横幅：墨蓝通栏色块，字色按底色自动取白（h1Bg 缺省会退到强调色）
    h1Style: 'banner',
    h1Bg: '#1b2330',
    h2Style: 'leftbar',
    h3Mark: 'dot',
    // 双层表面：冷灰纸底 + 纯白正文卡，公众号剥掉最外层后纸底仍在
    pageBg: '#eef0f4',
    bodyBg: '#ffffff',
    bodyText: '#39404d',
    headingColor: '#161b23',
    bodyRadius: 14,
    bodyPadding: '22px 20px',
    imgRadius: 10,
    imgStyle: 'inset',
    imgFrame: 'shadow',
    imgGap: 16,
    captionAlign: 'center',
    quoteStyle: 'card',
    // 引用底色/字色、表格边框一律不写死：这几项不参与夜间变深（buildStyles 只覆盖
    // bodyBg/bodyText/headingColor），写死浅值会在深卡上留一块亮板。留空即走自适应——
    // 卡片引用退到 tint(强调色,.1) 半透明靛洗，表边框浅底 #e5e7eb / 深底 #3a4a5e 各自取色
    hrStyle: 'dot',
    hrColor: '#c3cbd8',
    strongStyle: 'highlight',
    strongBg: '#e6ecf7',
    tableStyle: 'bordered',
    tableHeaderBg: '#1b2330'
  }
}

/**
 * 解析工程最终排版调性：分类调性打底，项目显式设置覆盖。
 * custom 为运行时加载的自定义主题库（settings/customThemes.json，优先级高于预设分类）。
 * 覆盖字段（meta）：原有 10 字段（accent/两字号/两排列/标题版式四项/bodyBg）+
 * B 期扩展 20 字段（字体/行高/字距/段距/正文字色/标题字色/引用形态与边色/分隔线/
 * 加粗形态与色/图片圆角/卡片圆角内边距/表格风格与色系/H2 色块底）——
 * 顶栏排版面板、AI set_theme 与排版优化对话框同源写入。
 * h2Num 覆盖值 'none' = 显式关掉主题自带序号（undefined 是「跟随主题」，
 * 与「关掉」语义不同，故用哨兵区分）。
 * 各覆盖字段逐项校验：hex 非法 / 枚举外值回落主题，数值越界夹取。
 */

// ---- 排版覆盖的枚举白名单与数值范围（resolveArticleTheme 与 sanitizeThemePatch 共用） ----

const QUOTE_STYLES: QuoteStyle[] = ['leftbar', 'card', 'quotes', 'dashcard']
const HR_STYLES: HrStyle[] = ['line', 'dot', 'long']
const STRONG_STYLES: StrongStyle[] = ['color', 'highlight', 'plain']
const TABLE_STYLES = ['bordered', 'striped', 'plain'] as const
const IMG_STYLES = ['inset', 'fullwidth', 'half'] as const
const IMG_FRAMES = ['none', 'line', 'shadow'] as const
const H2_NUMS: H2Num[] = ['01', '1.', '1、', '一、', '壹、', '①']

function clampNum(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * 排版键名别名：模型与导入来源最爱用的写法 → 白名单键。
 * 为什么必须有：实测模型给 save_theme_preset 传的是一整套自造键名（text_color / font_family /
 * paragraph_spacing / h2_color…），白名单不认就静默剔除，工具却返回成功——
 * 于是模型照着「只写进去 1 个字段」的主题描述出「浅紫圆角引用卡片、紫色渐变分隔线」。
 * 能映射的先映射，映射不了的必须报出来，不能装成功。
 */
export const THEME_KEY_ALIASES: Record<string, ThemeOverrideKey> = {
  fontSize: 'bodyFontSize',
  font_size: 'bodyFontSize',
  body_font_size: 'bodyFontSize',
  text_color: 'bodyText',
  textColor: 'bodyText',
  body_color: 'bodyText',
  font_family: 'fontFamily',
  fontFamily: 'fontFamily',
  line_height: 'lineHeight',
  lineHeight: 'lineHeight',
  letter_spacing: 'letterSpacing',
  paragraph_spacing: 'pGap',
  para_spacing: 'pGap',
  p_gap: 'pGap',
  heading_color: 'headingColor',
  headingColor: 'headingColor',
  h2_color: 'headingColor',
  h1_color: 'headingColor',
  quote_style: 'quoteStyle',
  quote_style_type: 'quoteStyle',
  quote_border: 'quoteBorder',
  quote_border_color: 'quoteBorder',
  quote_bg: 'quoteBg',
  quote_background: 'quoteBg',
  quote_color: 'quoteText',
  quote_text_color: 'quoteText',
  quote_text: 'quoteText',
  divider_color: 'hrColor',
  hr_color: 'hrColor',
  h2_border_color: 'h2Border',
  h2_accent_color: 'h2Border',
  hr_style: 'hrStyle',
  divider_style: 'hrStyle',
  strong_style: 'strongStyle',
  bold_style: 'strongStyle',
  strong_bg: 'strongBg',
  highlight_bg: 'strongBg',
  strong_color: 'strongColor',
  bold_color: 'strongColor',
  img_radius: 'imgRadius',
  image_radius: 'imgRadius',
  // 图片形态/边框/间距/图注（模型口语：style/边框/留白/对齐各来一套）
  img_style: 'imgStyle',
  image_style: 'imgStyle',
  img_frame: 'imgFrame',
  image_frame: 'imgFrame',
  img_shadow: 'imgFrame',
  img_gap: 'imgGap',
  img_spacing: 'imgGap',
  image_spacing: 'imgGap',
  caption_align: 'captionAlign',
  caption_position: 'captionAlign',
  body_radius: 'bodyRadius',
  card_radius: 'bodyRadius',
  body_padding: 'bodyPadding',
  padding: 'bodyPadding',
  table_style: 'tableStyle',
  table_header_bg: 'tableHeaderBg',
  header_bg: 'tableHeaderBg',
  table_border: 'tableBorder',
  table_border_color: 'tableBorder',
  table_header_text: 'tableHeaderText',
  header_text: 'tableHeaderText',
  h2_bg: 'h2Bg',
  h2_bg_color: 'h2Bg',
  h1_style: 'h1Style',
  h1_bg: 'h1Bg',
  banner_bg: 'h1Bg',
  banner_color: 'h1Bg',
  page_bg: 'pageBg',
  page_background: 'pageBg',
  paper_bg: 'pageBg',
  h2_style: 'h2Style',
  h2_num: 'h2Num',
  h3_mark: 'h3Mark',
  body_align: 'bodyAlign',
  heading_align: 'headingAlign',
  body_bg: 'bodyBg',
  bg: 'bodyBg',
  background: 'bodyBg',
  accent_color: 'accent',
  primary_color: 'accent',
  primary: 'accent',
  main_color: 'accent',
  theme_color: 'accent',
  brand_color: 'accent',
  // 本次实跑新增的口语叫法（段距/圆角/字距/行距；para_spacing / image_radius 表内已有）
  paragraph_gap: 'pGap',
  space_after: 'pGap',
  line_spacing: 'lineHeight',
  corner_radius: 'bodyRadius',
  radius: 'bodyRadius',
  roundness: 'bodyRadius',
  picture_radius: 'imgRadius',
  letter_space: 'letterSpacing',
  text_spacing: 'letterSpacing'
}

/** 别名表的驼峰索引：模型直接写 paragraphSpacing / cornerRadius 这类驼峰口语时也要命中
 *  （此前只登记蛇形键，实测 paragraphSpacing 被判「不认识」而 paragraph_spacing 能命中，就是漏了这一半） */
const THEME_ALIAS_BY_CAMEL: Record<string, ThemeOverrideKey> = Object.fromEntries(
  Object.entries(THEME_KEY_ALIASES).map(([k, v]) => [camelCase(k), v])
)

/** 蛇形/带连字符的键名转驼峰 */
function camelCase(k: string): string {
  return k.replace(/[-_]([a-zA-Z0-9])/g, (_m, c: string) => c.toUpperCase())
}

export function normalizeThemeKeys(raw: Record<string, unknown>): {
  patch: Record<string, unknown>
  unknown: string[]
} {
  const patch: Record<string, unknown> = {}
  const unknown: string[] = []
  const legal = new Set<string>(THEME_OVERRIDE_KEYS)
  for (const [k, v] of Object.entries(raw)) {
    const camel = camelCase(k)
    // 顺序：原样命中白名单 → 驼化后命中 → 别名（原样 / 驼化 / 别名表的驼化索引）
    // 显式写法优先于别名推断（模型同时给了 fontSize 与 bodyFontSize 时取后者）
    const key =
      legal.has(k) ? k : legal.has(camel) ? camel : (THEME_KEY_ALIASES[k] ?? THEME_KEY_ALIASES[camel] ?? THEME_ALIAS_BY_CAMEL[camel])
    if (!key) {
      unknown.push(k)
      continue
    }
    if (!(key in patch)) patch[key] = v
  }
  return { patch, unknown }
}

/**
 * meta 覆盖口径 → 主题库口径。
 * 两者字号键名不同（ProjectMeta.bodyFontSize vs ArticleTheme.fontSize），
 * 直接把 meta 口径的对象存进主题库，编辑器与导出按主题口径读就什么都读不到——
 * 表现是「主题入库成功但毫无变化」，所以存主题前必须过这一道。
 */
export function metaPatchToThemeKeys(patch: Partial<ProjectMeta>): Partial<ArticleTheme> {
  const out: Record<string, unknown> = { ...patch }
  if ('bodyFontSize' in out) {
    if (out.fontSize === undefined) out.fontSize = out.bodyFontSize
    delete out.bodyFontSize
  }
  return out as Partial<ArticleTheme>
}

/** meta 级排版覆盖白名单（36 键）：set_theme 工具、sanitizeThemePatch、readMeta 透传、
 *  App handleApplyTypography 四处共用同一口径。
 *  新增视觉字段必须同步这几处（PRD §14 已点名 readMeta 白名单是回归高发点）——
 *  漏一处的表现是「写进 meta 却读不出来」或「下次 writeMeta 把它覆掉」。 */
export const THEME_OVERRIDE_KEYS = [
  'accent',
  'bodyFontSize',
  'headingFontSize',
  'bodyAlign',
  'headingAlign',
  'h1Style',
  'h1Bg',
  'h2Style',
  'h2Num',
  'h3Mark',
  'bodyBg',
  'pageBg',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'pGap',
  'bodyText',
  'headingColor',
  'quoteStyle',
  'quoteBorder',
  'quoteBg',
  'quoteText',
  'hrColor',
  'h2Border',
  'hrStyle',
  'strongStyle',
  'strongBg',
  'strongColor',
  'imgRadius',
  'imgStyle',
  'imgFrame',
  'imgGap',
  'captionAlign',
  'bodyRadius',
  'bodyPadding',
  'tableStyle',
  'tableHeaderBg',
  'tableBorder',
  'tableHeaderText',
  'h2Bg'
] as const

export type ThemeOverrideKey = (typeof THEME_OVERRIDE_KEYS)[number]

/** 键名清单速查（save_theme_preset 失败报错内嵌用）：文本协议模型收不到 inputSchema，
 *  报「键名须与工具说明一致」等于让它蒙——把可用键连取值口径直接塞进报错，一轮改对。
 *  枚举取值须与 sanitizeThemePatchDetailed 的 en() 白名单同步（改枚举先改这里）。 */
export const THEME_KEYS_HINT =
  'accent(必填,#rrggbb) / fontFamily / lineHeight(1.5-3) / letterSpacing / fontSize(10-40) / headingFontSize(10-40) / bodyAlign(indent|flush|center) / headingAlign(center|left) / h1Style(bar|pill|underline|banner) / h1Bg / h2Style(leftbar|block|underline|plain) / h2Num(01|1.|1、|一、|壹、|①|none) / h3Mark(diamond|dot|none) / bodyBg(#hex|none) / pageBg / pGap(0-48) / bodyText / headingColor / quoteStyle(leftbar|card|quotes|dashcard) / quoteBorder / quoteBg / quoteText / hrColor / h2Border / hrStyle(line|dot|long) / strongStyle(color|highlight|plain) / strongBg / strongColor / imgRadius(0-40) / imgStyle(inset|fullwidth|half) / imgFrame(none|line|shadow) / imgGap(0-48) / captionAlign(center|left) / bodyRadius(0-40) / bodyPadding / tableStyle(bordered|striped|plain) / tableHeaderBg / tableBorder / tableHeaderText / h2Bg'

/** 排版覆盖字段中文名（对话框视觉参数预览、工具返回值提示共用一套口径） */
export const THEME_FIELD_LABELS: Record<ThemeOverrideKey, string> = {
  accent: '强调色',
  bodyFontSize: '正文字号',
  headingFontSize: '标题字号',
  bodyAlign: '段落排列',
  headingAlign: '标题排列',
  h1Style: '一级标题版式',
  h1Bg: '报头横幅底色',
  h2Style: '二级标题版式',
  h2Num: '二级标题序号',
  h3Mark: '三级标题标记',
  bodyBg: '正文背景卡',
  pageBg: '页面纸底',
  fontFamily: '字体栈',
  lineHeight: '行高',
  letterSpacing: '字距',
  pGap: '段间距',
  bodyText: '正文字色',
  headingColor: '标题字色',
  quoteStyle: '引用形态',
  quoteBorder: '引用描边色',
  quoteBg: '引用底色',
  quoteText: '引用文字色',
  hrColor: '分隔线颜色',
  h2Border: '二级标题条色',
  hrStyle: '分隔线形态',
  strongStyle: '加粗形态',
  strongBg: '加粗底色',
  strongColor: '加粗字色',
  imgRadius: '图片圆角',
  imgStyle: '图片形态',
  imgFrame: '图片边框',
  imgGap: '图片外间距',
  captionAlign: '图注排列',
  bodyRadius: '正文卡片圆角',
  bodyPadding: '正文内边距',
  tableStyle: '表格样式',
  tableHeaderBg: '表头底色',
  tableBorder: '表格边线色',
  tableHeaderText: '表头字色',
  h2Bg: '二级标题底色'
}

/** 数值型覆盖的合法区间（口径单源：sanitizeThemePatch 夹取与 set_theme 的「越界如实报回」都读这里） */
export const THEME_NUM_RANGES: Partial<Record<ThemeOverrideKey, [number, number]>> = {
  bodyFontSize: [10, 40],
  headingFontSize: [10, 40],
  lineHeight: [1.5, 3],
  pGap: [0, 48],
  imgRadius: [0, 40],
  imgGap: [0, 48],
  bodyRadius: [0, 40]
}

/** 读数值型排版参数：数字直取，纯数字或带 px 的字符串（模型常写 "16px" / "2.4"）也读出来；读不出返回 undefined */
export function themeNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return isFinite(v) ? v : undefined
  if (typeof v === 'string' && /^\d+(\.\d+)?(px)?$/i.test(v.trim())) {
    const n = Number(v.trim().toLowerCase().replace(/px$/, ''))
    return isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * 数值覆盖越界处理：夹到区间端点，并给出一句能直接转述给作者的中文说明。
 * 为什么要报：作者说「行距调到 1.4」而口径下限是 1.5，静默抬成 1.5 的表现就是「设了没反应」，
 * 只有把「1.4 已抬到 1.5」写进工具返回值，模型才会照实说，而不是声称已按 1.4 设好。
 */
export function clampThemeNumbers(raw: Record<string, unknown>): {
  values: Record<string, number>
  notes: string[]
} {
  const values: Record<string, number> = {}
  const notes: string[] = []
  for (const [k, range] of Object.entries(THEME_NUM_RANGES) as [ThemeOverrideKey, [number, number]][]) {
    const v = themeNumber(raw[k])
    if (v === undefined) continue
    const [min, max] = range
    const fixed = clampNum(v, min, max)
    values[k] = fixed
    if (fixed !== v)
      notes.push(
        `${THEME_FIELD_LABELS[k]}只支持 ${min}-${max}，你给的 ${v} 已${v < min ? '抬到' : '压到'} ${fixed}`
      )
  }
  return { values, notes }
}

/**
 * 宽进口径：把模型爱写的色值形态收敛成 #rrggbb，转不出返回 undefined（语义化色名/乱串不猜）。
 * 为什么不只认 #rrggbb：实测 save_theme_preset 的 accent 写成渐变/rgba 连续两轮被拒，而报错
 * 又不带上「你实际传了什么」，模型只能原样重试。能机械转换的形态一律救回：
 * #rrggbbaa/#rgba 丢 alpha、rgb()/rgba() 换算、渐变等多色串取第一个可识别色（主题库不存渐变，
 * 取主色是最接近作者意图的落点）。
 */
export function coerceHexColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!s) return undefined
  // 合法 3/6 位原样通过（不改变既有口径：大小写、书写形态都保持）
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s
  // 8 位（#rrggbbaa，设计工具常见输出）：丢 alpha。4/5 位残缺串不做截断兜底——
  // 多半是 #rrggbb 打漏了字符，截出个错色还不如打回（themeFields 的拒收口径就靠这条）
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7).toLowerCase()
  // rgb()/rgba()：分量换算（逗号与空格两种分隔都认）
  const m = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})[^)]*\)/.exec(s)
  if (m) {
    return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
  }
  // 渐变/多色串：取文本顺序上第一个可识别色（hex 与 rgb() 混写时也按出现先后；
  // hex 匹配带 lookahead，防 5/7 位残缺串被截成 3 位假命中）
  const hexInside = s.match(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g)
  const rgbInside = s.match(/rgba?\(\s*\d{1,3}\s*[,\s]\s*\d{1,3}\s*[,\s]\s*\d{1,3}[^)]*\)/)
  const hexAt = hexInside?.length ? s.indexOf(hexInside[0]) : Infinity
  const rgbAt = rgbInside ? s.indexOf(rgbInside[0]) : Infinity
  if (hexAt === Infinity && rgbAt === Infinity) return undefined
  if (rgbAt < hexAt) return coerceHexColor(rgbInside![0])
  const first = hexInside![0]
  return (first.length === 9 || first.length === 7 ? first.slice(0, 7) : first).toLowerCase()
}

/** 把任意对象收敛为合法的排版覆盖键值对：剔未知键 / hex 校验 / 数值夹取 / 枚举守卫。
 *  set_theme 工具与 save_theme_preset 共用；null/undefined 值由调用方先行处理清除语义 */
export function sanitizeThemePatch(patch: Record<string, unknown>): Partial<ProjectMeta> {
  return sanitizeThemePatchDetailed(patch).values
}

/** 同上，但额外返回被剔掉的键名：工具层必须把「这些字段不认识，没写进去」照实回报，
 *  否则模型会拿一个只落了 1 个字段的主题去描述整套排版 */
export function sanitizeThemePatchDetailed(raw: Record<string, unknown>): {
  values: Partial<ProjectMeta>
  /** 完全映射不到白名单的键名 */
  unknown: string[]
  /** 键名认得、值却不合法而被丢弃的字段（枚举外值 / 读不出数值 / 空串 / 坏色值） */
  invalid: string[]
  /** 宽进转换说明（rgb()/渐变 accent 已按某某 hex 生效）：工具层照实转述，静默改值=「设了没反应」 */
  coerced: string[]
} {
  const { patch, unknown } = normalizeThemeKeys(raw ?? {})
  const out: Record<string, unknown> = {}
  const coerced: string[] = []
  const hex = (k: ThemeOverrideKey): void => {
    const v = patch[k]
    if (typeof v !== 'string' || !v.trim()) return
    if (isHexColor(v)) {
      out[k] = v.trim()
      return
    }
    const conv = coerceHexColor(v)
    if (conv) {
      out[k] = conv
      coerced.push(`${THEME_FIELD_LABELS[k]}：${v.trim()} 不是 #rrggbb 十六进制，已按 ${conv} 生效`)
    }
  }
  const num = (k: ThemeOverrideKey): void => {
    const range = THEME_NUM_RANGES[k]
    if (!range) return
    // 数值常被写成字符串（"16px" / "2.4"）：能安全读出来的先读出来
    const n = themeNumber(patch[k])
    if (n !== undefined) out[k] = clampNum(n, range[0], range[1])
  }
  const en = <T extends string>(k: string, list: readonly T[]): void => {
    const v = patch[k]
    if (typeof v === 'string' && (list as readonly string[]).includes(v)) out[k] = v
  }
  // 长度类字段：模型常写成裸数字（letterSpacing: 0.5 / bodyPadding: 20），CSS 需要带单位 → 按 px 补
  const len = (k: string): void => {
    const v = patch[k]
    if (typeof v === 'number' && isFinite(v)) out[k] = `${v}px`
    else if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  const str = (k: string): void => {
    const v = patch[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  // 原有 10 字段
  hex('accent')
  num('bodyFontSize')
  num('headingFontSize')
  en('bodyAlign', ['indent', 'flush', 'center'])
  en('headingAlign', ['center', 'left'])
  en('h1Style', ['bar', 'pill', 'underline', 'banner'])
  hex('h1Bg')
  en('h2Style', ['leftbar', 'block', 'underline', 'plain'])
  if (patch.h2Num === 'none' || (typeof patch.h2Num === 'string' && (H2_NUMS as string[]).includes(patch.h2Num))) {
    out.h2Num = patch.h2Num
  }
  en('h3Mark', ['diamond', 'dot', 'none'])
  if (patch.bodyBg === 'none') {
    out.bodyBg = 'none'
  } else if (typeof patch.bodyBg === 'string' && patch.bodyBg.trim()) {
    if (isHexColor(patch.bodyBg)) out.bodyBg = patch.bodyBg.trim()
    else {
      const conv = coerceHexColor(patch.bodyBg)
      if (conv) {
        out.bodyBg = conv
        coerced.push(`${THEME_FIELD_LABELS.bodyBg}：${patch.bodyBg.trim()} 不是 #rrggbb 十六进制，已按 ${conv} 生效`)
      }
    }
  }
  hex('pageBg')
  // B 期扩展 20 字段
  str('fontFamily')
  num('lineHeight')
  len('letterSpacing')
  num('pGap')
  hex('bodyText')
  hex('headingColor')
  en('quoteStyle', QUOTE_STYLES)
  hex('quoteBorder')
  hex('quoteBg')
  hex('quoteText')
  hex('hrColor')
  hex('h2Border')
  en('hrStyle', HR_STYLES)
  en('strongStyle', STRONG_STYLES)
  hex('strongBg')
  hex('strongColor')
  num('imgRadius')
  en('imgStyle', IMG_STYLES)
  en('imgFrame', IMG_FRAMES)
  num('imgGap')
  en('captionAlign', ['center', 'left'])
  num('bodyRadius')
  len('bodyPadding')
  en('tableStyle', TABLE_STYLES)
  hex('tableHeaderBg')
  hex('tableBorder')
  hex('tableHeaderText')
  hex('h2Bg')
  // 键名对上了但值被校验丢弃的，同样要能报出去（不然「设了没反应」又变成静默的）
  const invalid = Object.keys(patch).filter((k) => !(k in out))
  return { values: out as Partial<ProjectMeta>, unknown, invalid, coerced }
}

/**
 * 自定义主题库迁移：v1（Record<分类名, 主题>，主题名即分类名，一分类一主题）→ v2
 * （主题独立命名 + 归属分类 + active 指针，见 CustomThemeLibrary）。旧数据每个主题
 * 变成同名主题、归属同名分类并激活——迁移后所有分类的套用结果与迁移前完全一致。
 * v2 原样通过（缺字段补空）；损坏/非对象输入给空库，不让一个坏文件拖垮启动。
 */
export function migrateCustomThemes(raw: unknown): CustomThemeLibrary {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { version?: unknown }).version === 2) {
    const lib = raw as unknown as CustomThemeLibrary
    return {
      version: 2,
      themes: lib.themes && typeof lib.themes === 'object' ? lib.themes : {},
      active: lib.active && typeof lib.active === 'object' ? lib.active : {}
    }
  }
  const themes: Record<string, StoredThemeEntry> = {}
  const active: Record<string, string> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!k || !v || typeof v !== 'object' || Array.isArray(v)) continue
      themes[k] = { category: k, theme: v as ArticleTheme }
      active[k] = k
    }
  }
  return { version: 2, themes, active }
}

/**
 * 派生「分类 → 当前套用主题」视图：active 指针 → 先查自定义库、再查内置同名主题；
 * 指针缺失或指向的名字两边都不存在则该分类不进视图（resolveArticleTheme 自己回内置/默认）。
 * resolveArticleTheme 与导出链路只认这个视图形状，主题库结构升级不惊动它们。
 */
export function activeThemesView(
  lib: CustomThemeLibrary,
  builtin: Record<string, ArticleTheme> = CATEGORY_THEMES
): Record<string, ArticleTheme> {
  const out: Record<string, ArticleTheme> = {}
  for (const [cat, name] of Object.entries(lib.active)) {
    const t = lib.themes[name]?.theme ?? builtin[name]
    if (t) out[cat] = t
  }
  return out
}

export function resolveArticleTheme(
  meta: Pick<
    ProjectMeta,
    | 'accent'
    | 'category'
    | 'bodyFontSize'
    | 'headingFontSize'
    | 'bodyAlign'
    | 'headingAlign'
    | 'h1Style'
    | 'h1Bg'
    | 'h2Style'
    | 'h2Num'
    | 'h3Mark'
    | 'bodyBg'
    | 'pageBg'
    | 'fontFamily'
    | 'lineHeight'
    | 'letterSpacing'
    | 'pGap'
    | 'bodyText'
    | 'headingColor'
    | 'quoteStyle'
    | 'quoteBorder'
    | 'quoteBg'
    | 'quoteText'
    | 'hrColor'
    | 'h2Border'
    | 'hrStyle'
    | 'strongStyle'
    | 'strongBg'
    | 'strongColor'
    | 'imgRadius'
    | 'imgStyle'
    | 'imgFrame'
    | 'imgGap'
    | 'captionAlign'
    | 'bodyRadius'
    | 'bodyPadding'
    | 'tableStyle'
    | 'tableHeaderBg'
    | 'tableBorder'
    | 'tableHeaderText'
    | 'h2Bg'
  > | null | undefined,
  custom?: Record<string, ArticleTheme>
): ArticleTheme {
  const cat = meta?.category
  const base = (cat && (custom?.[cat] ?? CATEGORY_THEMES[cat])) || DEFAULT_THEME
  // ArticleTheme 的四个必填字段（accent/fontFamily/lineHeight/letterSpacing）+ headingAlign：
  // 自定义/导入主题可能缺省（文档口径「未写的键跟随默认调性」是有意留白），缺了必须回落
  // DEFAULT——之前 undefined 一路传到导出端 t.fontFamily.replace(...) 直接 TypeError 白屏
  const accent = (meta?.accent && isHexColor(meta.accent) ? meta.accent.trim() : base.accent) || DEFAULT_THEME.accent
  // 数值覆盖一律用 `!== undefined` 判定，不用真值判定：0 是合法覆盖值
  // （pGap 0=段间不留空、imgRadius 0=方角图片），按真值短路会被当成「未覆盖」悄悄回落主题默认
  const fontSize =
    meta?.bodyFontSize !== undefined && isFinite(meta.bodyFontSize)
      ? meta.bodyFontSize
      : base.fontSize ?? DEFAULT_THEME.fontSize
  const headingFontSize =
    meta?.headingFontSize !== undefined && isFinite(meta.headingFontSize)
      ? meta.headingFontSize
      : base.headingFontSize ?? DEFAULT_THEME.headingFontSize
  const bodyAlign = meta?.bodyAlign ?? base.bodyAlign
  const headingAlign = meta?.headingAlign ?? base.headingAlign ?? DEFAULT_THEME.headingAlign
  // 标题版式：显式覆盖 > 主题值；h2Num 'none' 哨兵把主题序号关掉
  const h1Style = meta?.h1Style ?? base.h1Style
  const h1Bg = meta?.h1Bg && isHexColor(meta.h1Bg) ? meta.h1Bg.trim() : base.h1Bg
  const h2Style = meta?.h2Style ?? base.h2Style
  const h2Num = meta?.h2Num ? (meta.h2Num === 'none' ? undefined : meta.h2Num) : base.h2Num
  const h3Mark = meta?.h3Mark ?? base.h3Mark
  // 背景卡：显式 hex 覆盖 / 'none' 哨兵去卡片（导出透明白底）/ 未设置跟随主题（深浅字色由
  // resolveEditorTheme / buildStyles 的兜底按实际背景亮度自动修正，覆盖亮色不会踩脏数据坑）
  const bodyBg = meta?.bodyBg
    ? meta.bodyBg === 'none'
      ? undefined
      : isHexColor(meta.bodyBg)
        ? meta.bodyBg.trim()
        : base.bodyBg
    : base.bodyBg
  // 页面纸底：显式 hex 覆盖 > 主题值；不设 = 无纸层（保持原双层行为）
  const pageBg = meta?.pageBg && isHexColor(meta.pageBg) ? meta.pageBg.trim() : base.pageBg
  // ---- B 期视觉覆盖扩展：逐字段校验合并（hex 校验 / 数值夹取 / 枚举守卫 / 字符串非空） ----
  const fontFamily = meta?.fontFamily?.trim() || base.fontFamily || DEFAULT_THEME.fontFamily
  const lineHeight =
    meta?.lineHeight !== undefined && isFinite(meta.lineHeight)
      ? clampNum(meta.lineHeight, 1.5, 3)
      : base.lineHeight ?? DEFAULT_THEME.lineHeight
  const letterSpacing = meta?.letterSpacing?.trim() || base.letterSpacing || DEFAULT_THEME.letterSpacing
  const pGap = meta?.pGap !== undefined && isFinite(meta.pGap) ? clampNum(meta.pGap, 0, 48) : base.pGap
  const bodyText = meta?.bodyText && isHexColor(meta.bodyText) ? meta.bodyText.trim() : base.bodyText
  const quoteStyle = meta?.quoteStyle && QUOTE_STYLES.includes(meta.quoteStyle) ? meta.quoteStyle : base.quoteStyle
  const quoteBorder = meta?.quoteBorder && isHexColor(meta.quoteBorder) ? meta.quoteBorder.trim() : base.quoteBorder
  const quoteBg = meta?.quoteBg && isHexColor(meta.quoteBg) ? meta.quoteBg.trim() : base.quoteBg
  const quoteText = meta?.quoteText && isHexColor(meta.quoteText) ? meta.quoteText.trim() : base.quoteText
  const hrColor = meta?.hrColor && isHexColor(meta.hrColor) ? meta.hrColor.trim() : base.hrColor
  const h2Border = meta?.h2Border && isHexColor(meta.h2Border) ? meta.h2Border.trim() : base.h2Border
  const hrStyle = meta?.hrStyle && HR_STYLES.includes(meta.hrStyle) ? meta.hrStyle : base.hrStyle
  const strongStyle =
    meta?.strongStyle && STRONG_STYLES.includes(meta.strongStyle) ? meta.strongStyle : base.strongStyle
  const strongBg = meta?.strongBg && isHexColor(meta.strongBg) ? meta.strongBg.trim() : base.strongBg
  const imgRadius =
    meta?.imgRadius !== undefined && isFinite(meta.imgRadius) ? clampNum(meta.imgRadius, 0, 40) : base.imgRadius
  const bodyRadius =
    meta?.bodyRadius !== undefined && isFinite(meta.bodyRadius) ? clampNum(meta.bodyRadius, 0, 40) : base.bodyRadius
  // 图片形态/边框/外间距/图注排列：枚举守卫 + 数值夹取，缺省跟随主题
  const imgStyle = meta?.imgStyle && IMG_STYLES.includes(meta.imgStyle) ? meta.imgStyle : base.imgStyle
  const imgFrame = meta?.imgFrame && IMG_FRAMES.includes(meta.imgFrame) ? meta.imgFrame : base.imgFrame
  const imgGap = meta?.imgGap !== undefined && isFinite(meta.imgGap) ? clampNum(meta.imgGap, 0, 48) : base.imgGap
  const captionAlign =
    meta?.captionAlign && ['center', 'left'].includes(meta.captionAlign) ? meta.captionAlign : base.captionAlign
  const bodyPadding = meta?.bodyPadding?.trim() || base.bodyPadding
  const tableStyle =
    meta?.tableStyle && TABLE_STYLES.includes(meta.tableStyle) ? meta.tableStyle : base.tableStyle
  const tableHeaderBg =
    meta?.tableHeaderBg && isHexColor(meta.tableHeaderBg) ? meta.tableHeaderBg.trim() : base.tableHeaderBg
  const tableBorder = meta?.tableBorder && isHexColor(meta.tableBorder) ? meta.tableBorder.trim() : base.tableBorder
  const tableHeaderText =
    meta?.tableHeaderText && isHexColor(meta.tableHeaderText) ? meta.tableHeaderText.trim() : base.tableHeaderText
  const h2Bg = meta?.h2Bg && isHexColor(meta.h2Bg) ? meta.h2Bg.trim() : base.h2Bg
  // 标题/加粗字色：meta 显式覆盖 > accent 重链（仅当 meta.accent 显式设置时重链）> 主题原值
  const accentSet = !!(meta?.accent && isHexColor(meta.accent))
  const headingColor =
    meta?.headingColor && isHexColor(meta.headingColor)
      ? meta.headingColor.trim()
      : accentSet
        ? accent
        : base.headingColor
  const strongColor =
    meta?.strongColor && isHexColor(meta.strongColor)
      ? meta.strongColor.trim()
      : accentSet
        ? accent
        : base.strongColor
  const overrides = {
    fontSize, headingFontSize, bodyAlign, headingAlign, h1Style, h1Bg, h2Style, h2Num, h3Mark, bodyBg, pageBg,
    fontFamily, lineHeight, letterSpacing, pGap, bodyText, headingColor, quoteStyle, quoteBorder,
    quoteBg, quoteText, hrColor, h2Border,
    hrStyle, strongStyle, strongBg, strongColor, imgRadius, imgStyle, imgFrame, imgGap, captionAlign, bodyRadius, bodyPadding,
    tableStyle, tableHeaderBg, tableBorder, tableHeaderText, h2Bg
  }
  return { ...base, accent, ...overrides }
}
