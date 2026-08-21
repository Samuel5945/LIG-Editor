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
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim())
  if (!m) return false
  const n = parseInt(m[1], 16)
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
  // 非法输入回白（向后兼容）；合法色按亮度选深/浅字
  if (!/^#?[0-9a-f]{6}$/i.test(bg.trim())) return '#ffffff'
  return isDarkColor(bg) ? '#ffffff' : '#2b2b2b'
}

export interface EditorThemeColors {
  /** 实际卡片背景色（变体优先；夜间配色无卡片主题给默认深底；日间无卡片为 undefined → 透明白底） */
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
 * - 带背景卡片的主题：UI 深色优先 bodyBgDark、UI 浅色优先 bodyBgLight，无变体回退基础色
 * - 夜间配色语义统一 = 深色卡片 + 浅字：无卡片主题或基础色为浅底时给默认深底 DEFAULT_NIGHT_BG，
 *   避免「白底浅字」不可读；日间配色保持无卡片主题透明白底深字
 * - 深浅兜底：背景与文字亮度不匹配（浅底浅字/深底深字，历史导入脏数据）时强制修正
 * 导出/公众号同源：buildStyles 传 uiDark 时走同一解析，预览/复制/推送与编辑器一致。
 */
export function resolveEditorTheme(theme: ArticleTheme, uiDark: boolean): EditorThemeColors {
  // 夜间：Dark 变体 → 深色基础色 → 默认深底；日间：Light 变体 → 基础色（浅底保留、深底用 Light）
  const baseBg = theme.bodyBg
  const bg = uiDark
    ? theme.bodyBgDark ?? (baseBg && isDarkColor(baseBg) ? baseBg : DEFAULT_NIGHT_BG)
    : theme.bodyBgLight ?? baseBg
  const darkBg = bg ? isDarkColor(bg) : uiDark
  const bodyTv =
    (uiDark ? theme.bodyTextDark : theme.bodyTextLight) ?? theme.bodyText ?? (darkBg ? '#cbd5e1' : '#333')
  const bodyText = bg && isDarkColor(bodyTv) === darkBg ? (darkBg ? '#cbd5e1' : '#333') : bodyTv
  const headTv =
    (uiDark ? theme.headingColorDark : theme.headingColorLight) ??
    theme.headingColor ??
    (darkBg ? '#eef2f7' : '#1a1a1a')
  const headingColor = bg && isDarkColor(headTv) === darkBg ? (darkBg ? '#eef2f7' : '#1a1a1a') : headTv
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
 * 每套都参考了对应领域的公众号爆款排版范式：
 * - 科技数码：黑科技深色卡片 + 荧光青点缀 + 等宽数字感（135 编辑器「科技感」爆款范式）
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
    bodyBg: '#0d1526',
    bodyText: '#cbd5e1',
    headingColor: '#eef2f7',
    // 昼夜版：日间（浅 UI）编辑器自动切浅蓝白卡 + 深字，不刺眼；导出固定深卡保持科技感
    bodyBgLight: '#eef3fb',
    bodyTextLight: '#333',
    headingColorLight: '#1a1a1a',
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
    bodyBg: '#fffaf2',
    bodyText: '#3d3a34',
    headingColor: '#1a1a1a',
    // 昼夜版：夜间（深 UI）编辑器自动切深暖卡 + 浅字，深色面板不再亮一块；导出固定暖白保持温馨
    bodyBgDark: '#262016',
    bodyTextDark: '#e7e0d4',
    headingColorDark: '#f5efe3',
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
