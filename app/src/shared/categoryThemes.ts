import type { ProjectMeta } from './types'
import { isHexColor } from './cards'
import { UNCATEGORIZED } from './categories'

/**
 * 分类调性：不同分类套用不同排版气质（强调色 / 字体 / 行高 / 字距 / 标题对齐 /
 * 背景卡片 / 标题装饰 / 引用形态 / 分隔线 / 加粗高亮 / 图片圆角 / 段间距）。
 * 解析链：项目显式强调色（meta.accent，用户手动选色） > 分类调性 > 默认调性。
 * 自定义分类无预设调性 → 回落默认。编辑器与导出 HTML 共用同一主题对象，所见即所得。
 * 新增结构级风格字段全部可选：缺省回退「默认调性」的经典排版，向后兼容。
 */

/** H1 大标题装饰 */
export type H1Style = 'bar' | 'pill' | 'underline'
/** H2 小节标题装饰 */
export type H2Style = 'leftbar' | 'block' | 'underline' | 'plain'
/** H3 子标题前缀标记 */
export type H3Mark = 'diamond' | 'dot' | 'none'
/** 引用形态 */
export type QuoteStyle = 'leftbar' | 'card' | 'quotes'
/** 分隔线形态 */
export type HrStyle = 'line' | 'dot' | 'long'
/** 加粗强调方式 */
export type StrongStyle = 'color' | 'highlight' | 'plain'

export interface ArticleTheme {
  /** 强调色：H1 短横 / H2 竖条 / H3 菱形 / 引用边线 / 加粗词 */
  accent: string
  /** 正文字体族 */
  fontFamily: string
  /** 正文行高 */
  lineHeight: number
  /** 字距 */
  letterSpacing: string
  /** H1 对齐：center 仪式感居中 / left 干练左对齐 */
  headingAlign: 'center' | 'left'
  // ---- 结构级排版风格（爆款范式），缺省回退经典排版 ----
  /** 正文容器背景色（如深色卡片 / 暖白卡片）；不设则透明白底 */
  bodyBg?: string
  /** 正文文字色（深底卡片需浅色文字） */
  bodyText?: string
  /** 标题文字色（卡片底色不同需显式指定，缺省按 bodyBg 深/浅自适应） */
  headingColor?: string
  /** 正文容器圆角 */
  bodyRadius?: number
  /** 正文容器内边距 */
  bodyPadding?: string
  /** H1 装饰：bar 经典短横 / pill 胶囊色块字底 / underline 下划线 */
  h1Style?: H1Style
  /** H2 装饰：leftbar 左竖条 / block 色块标签 / underline 下划线 / plain 纯文字 */
  h2Style?: H2Style
  /** H3 前缀：diamond 菱形 / dot 圆点 / none 无 */
  h3Mark?: H3Mark
  /** 引用形态：leftbar 左条浅底 / card 圆角卡片 / quotes 引号 */
  quoteStyle?: QuoteStyle
  /** 分隔线：line 居中短横 / dot 圆点列 / long 通栏细线 */
  hrStyle?: HrStyle
  /** 加粗强调：color 着色 / highlight 底色高亮 / plain 纯黑加粗 */
  strongStyle?: StrongStyle
  /** highlight 加粗的底色（配 strongStyle: 'highlight'） */
  strongBg?: string
  /** 图片圆角 px */
  imgRadius?: number
  /** 段落间距 px */
  pGap?: number
}

const SANS = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
const SERIF = '"Source Han Serif SC", "Noto Serif SC", "STSong", "SimSun", serif'
const MONO = '"Cascadia Code", "JetBrains Mono", Consolas, monospace'

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

/** 解析工程最终排版调性：分类调性打底，项目显式强调色覆盖颜色 */
export function resolveArticleTheme(meta: Pick<ProjectMeta, 'accent' | 'category'> | null | undefined): ArticleTheme {
  const base = (meta?.category && CATEGORY_THEMES[meta.category]) || DEFAULT_THEME
  const accent = meta?.accent && isHexColor(meta.accent) ? meta.accent.trim() : base.accent
  return { ...base, accent }
}
