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
 * 按背景色亮度自动选前景色：亮底深字 / 暗底白字（保证 WCAG AA 级对比度）。
 * 阈值 0.35：橙色(#f59e0b)/荧光青(#22d3ee) 等中亮色用深字（对比 6:1+），
 * 深蓝/紫/红等低亮度用白字。用于 pill 胶囊 / block 色块标题等色块场景。
 */
export function contrastText(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.35 ? '#2b2b2b' : '#ffffff'
}

/** 默认调性：与编辑器/导出历史排版完全一致（蓝强调色、黑体、2.13 行高、居中大标题） */
export const DEFAULT_THEME: ArticleTheme = {
  accent: '#4f8cff',
  fontFamily: SANS,
  lineHeight: 2.13,
  letterSpacing: '0.02em',
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
 * 解析工程最终排版调性：分类调性打底，项目显式强调色覆盖颜色。
 * custom 为运行时加载的自定义主题库（settings/customThemes.json，优先级高于预设分类）。
 */
export function resolveArticleTheme(
  meta: Pick<ProjectMeta, 'accent' | 'category'> | null | undefined,
  custom?: Record<string, ArticleTheme>
): ArticleTheme {
  const cat = meta?.category
  const base = (cat && (custom?.[cat] ?? CATEGORY_THEMES[cat])) || DEFAULT_THEME
  const accent = meta?.accent && isHexColor(meta.accent) ? meta.accent.trim() : base.accent
  return { ...base, accent }
}
