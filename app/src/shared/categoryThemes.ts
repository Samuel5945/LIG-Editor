import type { ProjectMeta, ArticleTheme } from './types'
import { isHexColor } from './cards'
import { UNCATEGORIZED } from './categories'
export type { ArticleTheme, H1Style, H2Style, H3Mark, QuoteStyle, HrStyle, StrongStyle } from './types'

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
const MONO = '"Cascadia Code", "JetBrains Mono", Consolas, monospace'

/**
 * 背景色是否偏深（用于选前景色/引用文字色）。WCAG 相对亮度 < 0.35 视为深色。
 * 非法输入按浅色处理（导出默认白底、编辑器默认深底由调用方按场景兜底）。
 */
export function isDarkColor(bg: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg.trim())
  if (!m) return false
  // 3 位缩写（#333）展开为 6 位再判
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const n = parseInt(hex, 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.35
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
 * 强调色不走此函数（微信夜间对中亮度色基本保持原样）。非法输入原样返回，
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
 * 编辑器昼夜配色解析（纯函数，ArticleEditor 注入 CSS 变量用）：
 * - 日间 = 主题基础色（浅卡保持浅卡、自定义深卡保持深卡、无卡片透明白底）
 * - 夜间 = 公众号逻辑：不再有手调深色排版，把日间基础色经 wechatDarkColor
 *   自动变深（浅底→深底、深字→浅字）；深色基础色保持原样；无卡片主题给
 *   默认深底 DEFAULT_NIGHT_BG，避免「白底浅字」不可读
 * - 深浅兜底：背景与文字亮度不匹配（浅底浅字/深底深字，历史导入脏数据）时强制修正
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
  const bodyTv = theme.bodyText ?? (darkBg ? '#cbd5e1' : '#333')
  // 夜间把日间卡片的深字翻转成近白浅字（公众号反色观感）；无卡片主题用兜底浅字，不翻转
  const bodyInverted = uiDark && baseBg && isDarkColor(bodyTv) ? wechatDarkColor(bodyTv, 'text') : bodyTv
  const bodyText = bg && isDarkColor(bodyInverted) === darkBg ? (darkBg ? '#cbd5e1' : '#333') : bodyInverted
  const headTv = theme.headingColor ?? (darkBg ? '#eef2f7' : '#1a1a1a')
  const headInverted = uiDark && baseBg && isDarkColor(headTv) ? wechatDarkColor(headTv, 'text') : headTv
  const headingColor = bg && isDarkColor(headInverted) === darkBg ? (darkBg ? '#eef2f7' : '#1a1a1a') : headInverted
  return { bodyBg: bg, bodyText, headingColor, darkBg }
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
 * - 科技数码：浅蓝白卡片 + 荧光青点缀 + 等宽数字感（135 编辑器「科技感」爆款范式）
 * - 设计鉴赏：杂志极简留白 + 直角图片 + 细下划线小节（设计美学号常见范式）
 * - 生活常识：暖色圆角卡片 + 胶囊标题 + 高亮加粗（生活科普爆款范式）
 * - 情感回忆：文艺信笺 + 引号引用 + 衬线疏朗（深夜情感号范式）
 * - 哲学思考：极简黑白 + 纯文字标题 + 通栏细线 + 大段距（哲思类公众号范式）
 */
export const CATEGORY_THEMES: Record<string, ArticleTheme> = {
  科技数码: {
    accent: '#22d3ee',
    fontFamily: MONO,
    lineHeight: 1.95,
    letterSpacing: '0.01em',
    headingAlign: 'left',
    // 浅蓝白卡 + 深字（深色卡片排版在公众号夜间无法显示，夜间由公众号逻辑自动变深）
    bodyBg: '#eef3fb',
    bodyText: '#333',
    headingColor: '#1a1a1a',
    bodyRadius: 14,
    bodyPadding: '20px 22px',
    h1Style: 'underline',
    h2Style: 'block',
    h3Mark: 'dot',
    quoteStyle: 'card',
    hrStyle: 'line',
    strongStyle: 'color',
    imgRadius: 10,
    pGap: 14
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
  [UNCATEGORIZED]: DEFAULT_THEME
}

/**
 * 解析工程最终排版调性：分类调性打底，项目显式设置覆盖。
 * custom 为运行时加载的自定义主题库（settings/customThemes.json，优先级高于预设分类）。
 * 覆盖字段（meta）：accent 强调色（标题/加粗色同源联动）、bodyFontSize 正文字号、
 * headingFontSize 标题字号、bodyAlign 正文排列、headingAlign 标题排列。
 * 正文阅读色（bodyText）、块背景（h2Bg 黑块等）属排版形态，保持主题原值。
 */
export function resolveArticleTheme(
  meta: Pick<
    ProjectMeta,
    'accent' | 'category' | 'bodyFontSize' | 'headingFontSize' | 'bodyAlign' | 'headingAlign'
  > | null | undefined,
  custom?: Record<string, ArticleTheme>
): ArticleTheme {
  const cat = meta?.category
  const base = (cat && (custom?.[cat] ?? CATEGORY_THEMES[cat])) || DEFAULT_THEME
  const accent = meta?.accent && isHexColor(meta.accent) ? meta.accent.trim() : base.accent
  // 项目显式覆盖 → 覆盖主题；未设置 → 跟随主题（主题缺字段回退默认 16/20）
  const fontSize =
    meta?.bodyFontSize && isFinite(meta.bodyFontSize) ? meta.bodyFontSize : base.fontSize ?? DEFAULT_THEME.fontSize
  const headingFontSize =
    meta?.headingFontSize && isFinite(meta.headingFontSize)
      ? meta.headingFontSize
      : base.headingFontSize ?? DEFAULT_THEME.headingFontSize
  const bodyAlign = meta?.bodyAlign ?? base.bodyAlign
  const headingAlign = meta?.headingAlign ?? base.headingAlign
  if (meta?.accent && isHexColor(meta.accent)) {
    return {
      ...base,
      accent,
      ...(base.headingColor ? { headingColor: accent } : {}),
      ...(base.strongColor ? { strongColor: accent } : {}),
      fontSize,
      headingFontSize,
      bodyAlign,
      headingAlign
    }
  }
  return { ...base, accent, fontSize, headingFontSize, bodyAlign, headingAlign }
}
