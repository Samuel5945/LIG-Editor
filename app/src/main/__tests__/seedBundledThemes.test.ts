/**
 * 随包预装排版主题的首启种子。
 * 为什么必须有：主题库的「内置 N 套」来自编译进包的 CATEGORY_THEMES，而日报八套这类版式资产
 * 落在 settings/customThemes.json（用户数据，.gitignore 忽略、不进 extraResources）。
 * 不种子化，装机后主题库就只剩内置那几套——宣传口径「十几套主题一键换装」当场对不上。
 *
 * 钉死四件事：
 * 1. 空库首启能种出随包主题，且不动任何 active 绑定（预装不等于替用户改套用）；
 * 2. 同名主题不覆盖（用户可能已经自己存了一套同名的，覆盖=偷改）；
 * 3. 删过不复活（版本戳记账；这条是跟 seedBundledSkills 的关键差异——Skill 靠「目录已存在」判断，
 *    主题全在一个文件里，没有记账就会每次启动把用户删掉的预装主题塞回来）；
 * 4. 记账版本落后时只补缺名，已有的一律不动。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppPaths } from '@shared/types'

// 夹具根：electron 侧的开发态包路径与 settings 路径分别落到两个固定的临时目录，
// 用固定名而非 mkdtemp 是因为两个 vi.mock 工厂都要引用同一路径（工厂会被提升，拿不到外层变量）
const APP_DIR = join(tmpdir(), 'lig-seed-app')
const ROOT_DIR = join(tmpdir(), 'lig-seed-root')

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => join(tmpdir(), 'lig-seed-app')
  },
  net: {}
}))

vi.mock('../paths', () => ({
  getAppPaths: (): AppPaths => ({
    root: join(tmpdir(), 'lig-seed-root'),
    workspace: join(tmpdir(), 'lig-seed-root', 'workspace'),
    skills: join(tmpdir(), 'lig-seed-root', 'skills'),
    settings: join(tmpdir(), 'lig-seed-root', 'settings'),
    ideaInbox: join(tmpdir(), 'lig-seed-root', 'idea-inbox.md')
  })
}))

import { deleteTheme, ensureThemeCategoryDirs, listLibrary, seedBundledThemes } from '../themeStore'

const themesFile = (): string => join(ROOT_DIR, 'settings', 'customThemes.json')
const markerFile = (): string => join(ROOT_DIR, 'settings', 'themeSeed.json')
const packFile = (): string => join(APP_DIR, 'resources', 'themes', 'daily.json')

const preset = (accent: string): Record<string, unknown> => ({
  category: '日报',
  theme: { accent, origin: 'preset' }
})

/** 摆一份随包主题包夹具（模拟 extraResources 带过来的文件） */
function writePack(themes: Record<string, unknown>): void {
  mkdirSync(join(APP_DIR, 'resources', 'themes'), { recursive: true })
  writeFileSync(packFile(), JSON.stringify({ version: 1, themes }), 'utf8')
}

beforeEach(() => {
  rmSync(APP_DIR, { recursive: true, force: true })
  rmSync(ROOT_DIR, { recursive: true, force: true })
  mkdirSync(join(ROOT_DIR, 'settings'), { recursive: true })
  writePack({ 日报01: preset('#0d9488'), 日报02: preset('#b91c1c') })
})

describe('seedBundledThemes', () => {
  it('空库首启种出随包主题，且不替用户改套用关系', () => {
    seedBundledThemes()
    const lib = listLibrary()
    expect(Object.keys(lib.themes).sort()).toEqual(['日报01', '日报02'])
    expect(lib.themes['日报01'].category).toBe('日报')
    // 预装只是把主题放进库，active 一个都不写
    expect(lib.active).toEqual({})
    expect(readFileSync(markerFile(), 'utf8')).toContain('"version":1')
  })

  it('同名主题不覆盖：用户自己存的那套原样保留', () => {
    writeFileSync(
      themesFile(),
      JSON.stringify({
        version: 2,
        themes: { 日报01: { category: '我的分类', theme: { accent: '#000000' } } },
        active: { 我的分类: '日报01' }
      }),
      'utf8'
    )
    seedBundledThemes()
    const lib = listLibrary()
    expect(lib.themes['日报01'].theme.accent).toBe('#000000')
    expect(lib.themes['日报01'].category).toBe('我的分类')
    expect(Object.keys(lib.themes)).toEqual(['日报01', '日报02'])
    expect(lib.active).toEqual({ 我的分类: '日报01' })
  })

  it('删过的预装主题不会在下次启动复活', () => {
    seedBundledThemes()
    deleteTheme('日报01')
    expect(listLibrary().themes['日报01']).toBeUndefined()

    seedBundledThemes() // 模拟重启
    expect(listLibrary().themes['日报01']).toBeUndefined()
  })

  it('记账版本落后时只补缺名，已有主题不动', () => {
    seedBundledThemes()
    writeFileSync(markerFile(), JSON.stringify({ version: 0 }), 'utf8') // 模拟老版本客户端升级
    writeFileSync(
      themesFile(),
      JSON.stringify(
        {
          version: 2,
          themes: { 日报01: { category: '日报', theme: { accent: '#111111' } } },
          active: {}
        },
        null,
        2
      ),
      'utf8'
    )
    seedBundledThemes()
    const lib = listLibrary()
    expect(lib.themes['日报01'].theme.accent).toBe('#111111') // 已有的不覆盖
    expect(lib.themes['日报02']).toBeDefined() // 缺的补上
  })

  it('主题包缺失/损坏时静默跳过，不阻塞启动', () => {
    rmSync(APP_DIR, { recursive: true, force: true })
    expect(() => seedBundledThemes()).not.toThrow()
    expect(existsSync(markerFile())).toBe(false) // 包不在就不记账，下次带了包还能种

    mkdirSync(join(APP_DIR, 'resources', 'themes'), { recursive: true })
    writeFileSync(packFile(), '{ 这不是 JSON', 'utf8')
    expect(() => seedBundledThemes()).not.toThrow()
    expect(Object.keys(listLibrary().themes)).toEqual([])
  })

  it('预装主题的归属分类目录会被启动自愈建出来（不留孤儿主题）', () => {
    seedBundledThemes()
    ensureThemeCategoryDirs()
    expect(existsSync(join(ROOT_DIR, 'workspace', '日报'))).toBe(true)
  })
})
