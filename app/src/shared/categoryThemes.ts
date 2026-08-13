import type { ProjectMeta } from './types'
import { isHexColor } from './cards'
import { UNCATEGORIZED } from './categories'

/**
 * 分类调性：不同分类套用不同排版气质（强调色 / 字体 / 行高 / 字距 / 标题对齐）。
 * 解析链：项目显式强调色（meta.accent，用户手动选色） > 分类调性 > 默认调性。
 * 自定义分类无预设调性 → 回落默认。编辑器与导出 HTML 共用同一主题对象，所见即所得。
 */

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
}

const SANS = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
const SERIF = '"Source Han Serif SC", "Noto Serif SC", "STSong", "SimSun", serif'

/** 默认调性：与编辑器/导出历史排版完全一致（蓝强调色、黑体、2.13 行高、居中大标题） */
export const DEFAULT_THEME: ArticleTheme = {
  accent: '#4f8cff',
  fontFamily: SANS,
  lineHeight: 2.13,
  letterSpacing: '0.02em',
  headingAlign: 'center'
}

/** 预设分类调性（按分类名索引；未收录的分类回落默认） */
export const CATEGORY_THEMES: Record<string, ArticleTheme> = {
  // 理性精密：冷蓝 + 黑体 + 紧凑行距 + 左对齐标题
  科技数码: { accent: '#2f7cf6', fontFamily: SANS, lineHeight: 1.95, letterSpacing: '0.01em', headingAlign: 'left' },
  // 精致策展感：紫 + 宽字距 + 居中标题
  设计鉴赏: { accent: '#8b5cf6', fontFamily: SANS, lineHeight: 2.05, letterSpacing: '0.03em', headingAlign: 'center' },
  // 亲和明快：暖橙 + 黑体 + 居中标题
  生活常识: { accent: '#f59e0b', fontFamily: SANS, lineHeight: 2.0, letterSpacing: '0.02em', headingAlign: 'center' },
  // 文艺抒情：暖红 + 宋体 + 疏朗行距字距
  情感回忆: { accent: '#d64550', fontFamily: SERIF, lineHeight: 2.2, letterSpacing: '0.04em', headingAlign: 'center' },
  // 沉静内省：灰蓝 + 宋体 + 最疏朗节奏
  哲学思考: { accent: '#5b6b7c', fontFamily: SERIF, lineHeight: 2.25, letterSpacing: '0.05em', headingAlign: 'center' },
  [UNCATEGORIZED]: DEFAULT_THEME
}

/** 解析工程最终排版调性：分类调性打底，项目显式强调色覆盖颜色 */
export function resolveArticleTheme(meta: Pick<ProjectMeta, 'accent' | 'category'> | null | undefined): ArticleTheme {
  const base = (meta?.category && CATEGORY_THEMES[meta.category]) || DEFAULT_THEME
  const accent = meta?.accent && isHexColor(meta.accent) ? meta.accent.trim() : base.accent
  return { ...base, accent }
}
