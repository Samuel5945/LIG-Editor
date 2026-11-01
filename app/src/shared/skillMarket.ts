import type { SkillCatalog, SkillInstallDirective, SkillMarketEntry, SkillMarketItem } from './types'

/**
 * Skill 市场（v1）纯函数：目录解析 / 合并 / 搜索过滤。
 * 口径：编辑推荐档（收录时人工标注）+ 本地已安装状态，不假装社区评分；
 * 目录 = 内置打底 + 在线刷新合并，拉不到降级内置并如实标注（不静默）。
 */

/** 在线/内置目录 JSON 的容错解析：形状不对或条目残缺时丢弃对应部分，永不抛错 */
export function parseCatalog(text: string): SkillCatalog | null {
  if (/^\s*</.test(text)) return null // 返回的是网页而非 JSON
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.entries)) return null
  const entries = obj.entries.flatMap((e): SkillMarketEntry[] => {
    if (typeof e !== 'object' || e === null) return []
    const t = e as Record<string, unknown>
    const name = typeof t.name === 'string' ? t.name.trim() : ''
    if (!name) return []
    const official = t.official === true
    const ref = typeof t.ref === 'string' ? t.ref.trim() : ''
    if (!official && !ref) return [] // 非官方条目必须给得出安装来源，否则装不了
    return [
      {
        name,
        description: typeof t.description === 'string' ? t.description.trim().slice(0, 200) : '',
        category: typeof t.category === 'string' && t.category.trim() ? t.category.trim() : '其他',
        recommended: t.recommended === true,
        ref: ref || undefined,
        official
      }
    ]
  })
  return {
    version: typeof obj.version === 'number' ? obj.version : undefined,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    entries
  }
}

/**
 * 内置目录 + 在线目录合并：同名条目以在线元数据为准（刷新的意义就是更新描述等），
 * 但位置保持在内置目录的槽位（列表顺序稳定，用户不会一刷新就面目全非）；
 * 在线独有的条目按目录顺序追加在后。
 */
export function mergeCatalogs(builtin: SkillMarketEntry[], online: SkillCatalog | null): SkillMarketItem[] {
  const items: SkillMarketItem[] = builtin.map((e) => ({ ...e, origin: 'builtin' }))
  if (!online) return items
  const byName = new Map(items.map((it) => [it.name, it]))
  for (const e of online.entries) {
    const hit = byName.get(e.name)
    if (hit) Object.assign(hit, e, { origin: 'online' })
    else {
      const item: SkillMarketItem = { ...e, origin: 'online' }
      byName.set(item.name, item)
      items.push(item)
    }
  }
  return items
}

/** 市场搜索过滤：关键词匹配名称+描述（不区分大小写），分类空串 = 全部 */
export function filterMarketEntries(items: SkillMarketItem[], query: string, category: string): SkillMarketItem[] {
  const q = query.trim().toLowerCase()
  return items.filter((it) => {
    if (category && it.category !== category) return false
    if (!q) return true
    return it.name.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)
  })
}

/** 展示分类清单：按条目首次出现的顺序，稳定不跳 */
export function marketCategories(items: SkillMarketItem[]): string[] {
  return [...new Set(items.map((it) => it.category))]
}

const GITHUBISH_RE = /^(https:\/\/(raw\.)?github(usercontent)?\.com\/|[\w.-]+\/[\w.-]+$)/

/**
 * 市场条目 → 既有安装链路的指令。官方条目走包内复制通道（返回 null，不经网络）；
 * GitHub 形（blob/raw 直链、owner/repo 短引）走 github 源（吃镜像竞速）；
 * 其余 https 直链走 url 源；识别不了的返回 null（界面提示条目来源不可用）。
 */
export function installDirective(item: Pick<SkillMarketEntry, 'name' | 'ref' | 'official'>): SkillInstallDirective | null {
  if (item.official || !item.ref) return null
  if (GITHUBISH_RE.test(item.ref)) return { source: 'github', ref: item.ref, name: item.name }
  if (/^https?:\/\//.test(item.ref)) return { source: 'url', ref: item.ref, name: item.name }
  return null
}
