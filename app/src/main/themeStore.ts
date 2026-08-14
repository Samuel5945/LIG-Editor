import { net } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { ArticleTheme } from '@shared/types'
import { trimHtmlForTheme } from '@shared/themeParse'
import { getAppPaths } from './paths'

/**
 * 自定义排版主题库：settings/customThemes.json（随根目录迁移，与 wechat.json 同级）。
 * 保存主题时自动在 workspace 下建同名分类目录，工程即可在分类下拉里选它、套用该排版。
 */

function themesFile(): string {
  return join(getAppPaths().settings, 'customThemes.json')
}

export function listCustomThemes(): Record<string, ArticleTheme> {
  try {
    const raw = JSON.parse(readFileSync(themesFile(), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function writeThemes(themes: Record<string, ArticleTheme>): void {
  writeFileSync(themesFile(), JSON.stringify(themes, null, 2), 'utf8')
}

/** 供 projectStore.renameCategory 原子替换整个主题库（分类重命名时同步主题 key） */
export function saveCustomThemes(themes: Record<string, ArticleTheme>): void {
  writeThemes(themes)
}

/** 分类重命名时同步主题 key（旧名主题移到新名，无旧主题时静默） */
export function renameCustomTheme(oldName: string, newName: string): void {
  const themes = listCustomThemes()
  if (!themes[oldName]) return
  themes[newName] = themes[oldName]
  delete themes[oldName]
  writeThemes(themes)
}

/** 校验分类名（与 projectStore.assertCategoryName 同规则，避免目录穿越） */
export function validateThemeName(name: string): void {
  if (
    !name ||
    name !== name.trim() ||
    /[\\/:*?"<>|]/.test(name) ||
    name.includes('..') ||
    name.endsWith('.')
  ) {
    throw new Error(`非法分类名：${name}`)
  }
}

export function saveCustomTheme(name: string, theme: ArticleTheme): void {
  validateThemeName(name)
  const themes = listCustomThemes()
  themes[name] = theme
  writeThemes(themes)
  // 自动建同名分类目录：分类下拉即可选到，选中即套用该排版
  const catDir = join(getAppPaths().workspace, name)
  if (!existsSync(catDir)) mkdirSync(catDir, { recursive: true })
}

export function deleteCustomTheme(name: string): void {
  const themes = listCustomThemes()
  if (name in themes) {
    delete themes[name]
    writeThemes(themes)
  }
}

/**
 * 启动自愈：保证每个自定义主题对应的分类目录存在。
 * 历史 bug：setProjectCategory 移出项目时会把空的旧分类目录顺手删掉，
 * 绑定自定义主题的分类目录也被误删（主题变孤儿、分类从列表消失）。
 * 主题存在 = 用户主动保存的排版资产，对应分类目录必须补回来。
 */
export function ensureThemeCategoryDirs(): void {
  const { workspace } = getAppPaths()
  for (const name of Object.keys(listCustomThemes())) {
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
    if (text.length > 30_000_000) throw new Error('页面过大（>30MB），请改用复制正文 HTML')
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
