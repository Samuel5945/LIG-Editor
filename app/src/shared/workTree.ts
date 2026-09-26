/**
 * 左栏工作树的骨架构建（纯函数，与渲染位置无关可单测）。
 * 输入 project:list + project:listCategories 的现算结果，输出按分类分组的有序结构；
 * 树只做导航骨架——状态/排期等推导值仍挂在 ProjectSummary 上由 UI 现场标注。
 */
import type { ProjectSummary } from './types'
import { UNCATEGORIZED } from './categories'

/** 树上的一个分类分组：分类名 + 组内工程（updated_at 倒序，与旧列表一致） */
export interface WorkTreeGroup {
  /** 分类名（未分类工程的兜底组名固定为「未分类」） */
  category: string
  projects: ProjectSummary[]
}

/**
 * 按分类分组工程。分类顺序跟随传入的 categories（project:listCategories 的返回序：
 * 预设 + 未分类 + 自定义），只在末尾追加「有工程但不在列表里」的分类兜底组
 * （比如分类被隐藏但工程还在盘上），保证任何工程都能在树里找到。
 * 组内排序：pinned 里的工程浮到最前（保持 updated_at 相对顺序），其余按 updated_at 倒序；
 * pinned 是渲染层本地偏好（localStorage），未知名字不影响排序。
 */
export function groupProjectsByCategory(
  projects: ProjectSummary[],
  categories: string[],
  pinned: string[] = []
): WorkTreeGroup[] {
  const byCat = new Map<string, ProjectSummary[]>()
  for (const p of projects) {
    const cat = p.category || UNCATEGORIZED
    const list = byCat.get(cat)
    if (list) list.push(p)
    else byCat.set(cat, [p])
  }
  const pinRank = new Set(pinned)
  const pinFirst = (list: ProjectSummary[]): ProjectSummary[] =>
    // Array.prototype.sort 稳定：置顶组内部保持已按 updated_at 倒序的相对位置
    sortByUpdatedDesc(list).sort((a, b) => Number(pinRank.has(b.name)) - Number(pinRank.has(a.name)))
  const groups: WorkTreeGroup[] = []
  const seen = new Set<string>()
  for (const cat of categories) {
    seen.add(cat)
    const list = byCat.get(cat)
    if (list) groups.push({ category: cat, projects: pinFirst(list) })
  }
  // 列表外的兜底（隐藏分类下仍有工程、或 meta.category 是任意值）：按出现顺序排最后
  for (const [cat, list] of byCat) {
    if (!seen.has(cat)) groups.push({ category: cat, projects: pinFirst(list) })
  }
  return groups
}

function sortByUpdatedDesc(list: ProjectSummary[]): ProjectSummary[] {
  return [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
}
