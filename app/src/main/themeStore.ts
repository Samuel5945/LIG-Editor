import { net } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { ArticleTheme, CustomThemeLibrary } from '@shared/types'
import { activeThemesView, migrateCustomThemes, CATEGORY_THEMES } from '@shared/categoryThemes'
import { trimHtmlForTheme } from '@shared/themeParse'
import { getAppPaths } from './paths'

/**
 * 自定义排版主题库：settings/customThemes.json（随根目录迁移，与 wechat.json 同级）。
 * v2 结构（CustomThemeLibrary）：主题独立命名、归属分类，一个分类可挂多套主题；
 * 「分类当前套用哪套」由 active 指针决定，可指向自定义主题或内置主题（CATEGORY_THEMES 键）。
 * 保存主题时自动创建归属分类目录，工程即可在分类下拉里选它、套用该排版。
 * v1 旧格式（主题名=分类名的一层映射）读取时自动迁移并落盘。
 */

function themesFile(): string {
  return join(getAppPaths().settings, 'customThemes.json')
}

function readLibrary(): CustomThemeLibrary {
  let raw: unknown = null
  try {
    raw = JSON.parse(readFileSync(themesFile(), 'utf8'))
  } catch {
    return { version: 2, themes: {}, active: {} }
  }
  const lib = migrateCustomThemes(raw)
  // v1 → v2 迁移落盘一次（只在确实迁移过时写，避免每次读都摸盘）
  if (!(raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { version?: unknown }).version === 2)) {
    try {
      writeLibrary(lib)
    } catch {
      // 迁移落盘失败不阻塞读：下次启动再迁
    }
  }
  return lib
}

function writeLibrary(lib: CustomThemeLibrary): void {
  writeFileSync(themesFile(), JSON.stringify(lib, null, 2), 'utf8')
}

/** 主题库全量结构（主题库页签用） */
export function listLibrary(): CustomThemeLibrary {
  return readLibrary()
}

/** 派生视图「分类 → 当前套用主题」：导出链路、projectStore 守卫等旧消费方共用 */
export function listCustomThemes(): Record<string, ArticleTheme> {
  return activeThemesView(readLibrary())
}

/** 校验主题名/分类名（与 projectStore.assertCategoryName 同规则，避免目录穿越） */
export function validateThemeName(name: string): void {
  if (
    !name ||
    name !== name.trim() ||
    /[\\/:*?"<>|]/.test(name) ||
    name.includes('..') ||
    name.endsWith('.')
  ) {
    throw new Error(`非法名称：${name}`)
  }
}

/**
 * 保存主题（upsert：同名覆盖更新）并激活到归属分类——「保存即生效」。
 * category 缺省沿用该主题原归属，再缺省与主题同名；保存的这套自动成为该分类当前套用。
 */
export function saveTheme(name: string, theme: ArticleTheme, category?: string): void {
  validateThemeName(name)
  const lib = readLibrary()
  const cat = (category ?? lib.themes[name]?.category ?? name).trim()
  validateThemeName(cat)
  lib.themes[name] = { category: cat, theme }
  lib.active[cat] = name
  writeLibrary(lib)
  // 自动建归属分类目录：分类下拉即可选到，选中即套用该排版
  const catDir = join(getAppPaths().workspace, cat)
  if (!existsSync(catDir)) mkdirSync(catDir, { recursive: true })
}

/** 切换分类当前套用的主题：null = 解绑（回同名内置/默认）；名字须在自定义库或内置主题里存在 */
export function setActiveTheme(category: string, name: string | null): void {
  validateThemeName(category)
  const lib = readLibrary()
  if (name === null || name === '') {
    delete lib.active[category]
    writeLibrary(lib)
    return
  }
  if (!lib.themes[name] && !(name in CATEGORY_THEMES)) {
    throw new Error(`主题不存在：${name}（既不在自定义主题库，也不是内置主题）`)
  }
  lib.active[category] = name
  writeLibrary(lib)
}

/** 删除主题：引用它的分类自动解绑（回同名内置/默认），其余主题不受影响 */
export function deleteTheme(name: string): void {
  const lib = readLibrary()
  if (!(name in lib.themes)) return
  delete lib.themes[name]
  for (const [cat, n] of Object.entries(lib.active)) {
    if (n === name) delete lib.active[cat]
  }
  writeLibrary(lib)
}

/** 分类重命名时同步主题库：归属分类与 active 指针的 key 一起迁移（主题名保持不变） */
export function renameCategoryThemes(oldName: string, newName: string): void {
  const lib = readLibrary()
  let touched = false
  for (const entry of Object.values(lib.themes)) {
    if (entry.category === oldName) {
      entry.category = newName
      touched = true
    }
  }
  if (oldName in lib.active) {
    lib.active[newName] = lib.active[oldName]
    delete lib.active[oldName]
    touched = true
  }
  if (touched) writeLibrary(lib)
}

/** 该分类名下是否还有主题（空分类目录回收的守卫：有主题的目录是排版资产，不能顺手删） */
export function hasThemesForCategory(category: string): boolean {
  return Object.values(readLibrary().themes).some((e) => e.category === category)
}

/**
 * 启动自愈：保证每个有主题的分类目录存在。
 * 历史 bug：setProjectCategory 移出项目时会把空的旧分类目录顺手删掉，
 * 绑定自定义主题的分类目录也被误删（主题变孤儿、分类从列表消失）。
 * 主题存在 = 用户主动保存的排版资产，对应分类目录必须补回来。
 */
export function ensureThemeCategoryDirs(): void {
  const { workspace } = getAppPaths()
  const cats = new Set(Object.values(readLibrary().themes).map((e) => e.category))
  for (const name of cats) {
    const dir = join(workspace, name)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

/**
 * 抓取公众号文章/网页 HTML（导入排版的链接入口）。
 * 公众号原始页面普遍 3MB+，抓取后立即裁剪（提取 js_content 正文容器），
 * 只把解析所需的小体积 HTML 传回渲染进程。
 */
export async function fetchUrlHtml(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http/https 链接')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    // 必须带完整浏览器 UA：Electron net.fetch 默认 UA 会被微信反爬拦截，
    // 返回「环境异常，完成验证后即可继续访问」验证页而非文章正文
    const res = await net.fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache'
      }
    })
    if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`)
    const text = await res.text()
    if (text.length > 30_000_000) throw new Error(`页面过大（>30MB），请改用复制正文 HTML`)
    const trimmed = trimHtmlForTheme(text)
    // 微信风控验证页检测：无 js_content 正文容器 + 验证特征 → 明确提示改用粘贴 HTML
    if (
      !trimmed.includes('js_content') &&
      /环境异常|完成验证|去验证|访问过于频繁/.test(trimmed)
    ) {
      throw new Error('被微信验证拦截（抓取到验证页）。请用浏览器打开文章，复制正文 HTML 后直接粘贴解析')
    }
    return trimmed
  } finally {
    clearTimeout(timer)
  }
}
