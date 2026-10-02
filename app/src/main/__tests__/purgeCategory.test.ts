/**
 * 彻底删除分类（purgeCategory / categoryPurgeInfo）为什么要测这些：
 * 这是唯一不可逆的分类操作，而预设分类的名字写死在 PROJECT_CATEGORIES 里——
 * 只删目录不留痕，下一次 listCategories 就把名字复活（workbuddy 现场命中：删完又出现，等于删不掉）。
 * 确认框要的清单也必须只报目录下真会被删的工程：报少了就是拿不可逆操作骗作者。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AppPaths, ArticleTheme } from '@shared/types'
import { UNCATEGORIZED } from '@shared/categories'

// projectStore 传递依赖 wechatStore（electron safeStorage）：与 store 系测试同款假实现
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => Buffer.from(b).toString().replace(/^enc:/, '')
  }
}))

// 工程目录定位走 ./paths 的临时目录（真实 fs 摆夹具，不做内存 fake）
let dir = ''
vi.mock('../paths', () => ({
  getAppPaths: (): AppPaths => ({
    root: dir,
    workspace: join(dir, 'workspace'),
    skills: join(dir, 'skills'),
    settings: join(dir, 'settings'),
    ideaInbox: join(dir, 'idea-inbox.md')
  })
}))

import {
  categoryPurgeInfo,
  createProject,
  deleteCategory,
  listCategories,
  listDisabledCategories,
  listPurgedCategories,
  purgeCategory,
  restoreCategory
} from '../projectStore'
import { getAppPaths } from '../paths'
import { listCategoryPresets, saveCategoryPreset } from '../categoryPresetStore'
import { listLibrary, saveTheme } from '../themeStore'

/** workspace/<分类>/<工程>/ 摆一个合规工程 */
function makeProject(name: string, category: string): string {
  const projectDir = join(getAppPaths().workspace, category, name)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify({ name, category }), 'utf-8')
  return projectDir
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lig-purge-'))
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'settings'), { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('purgeCategory：预设分类删得掉', () => {
  it('预设分类彻底删除后不再出现，也不留在「已删除」里', () => {
    const folder = join(getAppPaths().workspace, '设计鉴赏')
    makeProject('样张', '设计鉴赏')

    deleteCategory('设计鉴赏')
    expect(listCategories()).not.toContain('设计鉴赏')
    expect(listDisabledCategories()).toContain('设计鉴赏')

    purgeCategory('设计鉴赏')

    // 目录没了 + 隐藏标记抹了，但预设名字仍在代码清单里：不留痕就会被复活
    expect(existsSync(folder)).toBe(false)
    expect(listDisabledCategories()).not.toContain('设计鉴赏')
    expect(listPurgedCategories()).toContain('设计鉴赏')
    expect(listCategories()).not.toContain('设计鉴赏')
  })

  it('留痕只挡预设：作者重建同名目录时重新放行', () => {
    purgeCategory('生活常识')
    expect(listCategories()).not.toContain('生活常识')

    makeProject('重拾生活常识', '生活常识')
    expect(listCategories()).toContain('生活常识')
  })

  it('连带清掉该分类的自定义主题与账号预设（公众号绑定一并清除）', () => {
    saveTheme('workbuddy 排版', { h1: { fontSize: '20px' } } as unknown as ArticleTheme, 'workbuddy')
    saveCategoryPreset('workbuddy', { default_platform: 'zhihu' })
    expect(listLibrary().active['workbuddy']).toBe('workbuddy 排版')

    makeProject('test', 'workbuddy')
    deleteCategory('workbuddy')
    purgeCategory('workbuddy')

    expect(Object.values(listLibrary().themes).some((t) => t.category === 'workbuddy')).toBe(false)
    expect(listLibrary().active['workbuddy']).toBeUndefined()
    expect(listCategoryPresets()['workbuddy']).toBeUndefined()
    expect(listCategories()).not.toContain('workbuddy')
  })

  it('未分类是兜底：既不能隐藏也不能彻底删除', () => {
    makeProject('临时落脚', UNCATEGORIZED)
    expect(() => purgeCategory(UNCATEGORIZED)).toThrow(/兜底/)
    expect(() => deleteCategory(UNCATEGORIZED)).toThrow(/兜底/)
    expect(existsSync(join(getAppPaths().workspace, UNCATEGORIZED))).toBe(true)
  })

  it('只删除（隐藏）时目录与工程完好，恢复后原样归位', () => {
    const projectDir = makeProject('可恢复', '情感回忆')
    deleteCategory('情感回忆')
    expect(existsSync(projectDir)).toBe(true)

    restoreCategory('情感回忆')
    expect(listCategories()).toContain('情感回忆')
    expect(existsSync(projectDir)).toBe(true)
  })
})

describe('categoryPurgeInfo：删前列名受影响的工程', () => {
  it('点名目录下工程与该分类名下的主题，目录外的杂项不算', () => {
    makeProject('beta 稿', '科技数码')
    makeProject('alpha 稿', '科技数码')
    mkdirSync(join(getAppPaths().workspace, '科技数码', '素材备份'), { recursive: true })
    saveTheme('科技数码排版', { h1: { fontSize: '20px' } } as unknown as ArticleTheme, '科技数码')

    const info = categoryPurgeInfo('科技数码')
    expect(info.projects).toEqual(['alpha 稿', 'beta 稿'])
    expect(info.themes).toEqual(['科技数码排版'])
  })

  it('目录不存在时给空清单（确认框据此说"没有工程"）', () => {
    expect(categoryPurgeInfo('没有这个分类')).toEqual({ projects: [], themes: [] })
  })

  it('彻底删除后清单归零，且新建工程仍可用同名自定义分类', () => {
    makeProject('待删', '行业观察')
    deleteCategory('行业观察')
    purgeCategory('行业观察')
    expect(categoryPurgeInfo('行业观察').projects).toEqual([])

    const created = createProject('新工程', '行业观察')
    expect(created.category).toBe('行业观察')
    expect(listCategories()).toContain('行业观察')
  })
})
