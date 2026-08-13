/**
 * 项目分类目录：预设分类 + 未分类兜底。
 * workspace 按分类分子文件夹存放工程（workspace/<分类>/<工程名>/），
 * 分类可 AI 推荐或手动切换，切换时工程目录随分类迁移。
 */

export const PROJECT_CATEGORIES = ['科技数码', '设计鉴赏', '生活常识', '情感回忆', '哲学思考'] as const

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]

/** 未设置分类时的兜底分类（也是一个真实的 workspace 子文件夹） */
export const UNCATEGORIZED = '未分类'

/** 全部合法分类（预设 + 未分类） */
export const ALL_CATEGORIES: string[] = [...PROJECT_CATEGORIES, UNCATEGORIZED]

export function isKnownCategory(c: string): boolean {
  return c === UNCATEGORIZED || (PROJECT_CATEGORIES as readonly string[]).includes(c)
}
