/**
 * Skill 市场主进程侧：配置持久化、目录合并与降级、官方条目解析。
 * electron / paths / skillFetch(fetchText) 全部桩掉——网络与包路径由夹具扮演，
 * 钉住三条契约：断网降级如实带原因不崩、缓存让内容在断网后仍可见、官方件从包内读。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AppPaths } from '@shared/types'

// 夹具根：固定名（vi.mock 工厂会被提升，拿不到外层变量，只能在这里重新拼同样的路径）
const APP_DIR = join(tmpdir(), 'lig-market-app')
const ROOT_DIR = join(tmpdir(), 'lig-market-root')
const SETTINGS_DIR = join(ROOT_DIR, 'settings')
const SKILLS_DIR = join(ROOT_DIR, 'skills')
const BUNDLED_SKILL_MD = '# 官方件\n\n官方预装的演示 Skill 正文。'
const ONLINE_CATALOG = JSON.stringify({
  version: 1,
  entries: [
    { name: 'wechat-viral-topic', description: '在线更新的描述', category: '选题', recommended: true, ref: 'o/new-topic' },
    { name: 'writer-extra', description: '在线独有条目', category: '效率', ref: 'foo/writer-extra' }
  ]
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => join(tmpdir(), 'lig-market-app') },
  net: {}
}))

vi.mock('../paths', () => ({
  getAppPaths: (): AppPaths => ({
    root: join(tmpdir(), 'lig-market-root'),
    workspace: join(tmpdir(), 'lig-market-root', 'workspace'),
    skills: join(tmpdir(), 'lig-market-root', 'skills'),
    settings: join(tmpdir(), 'lig-market-root', 'settings'),
    ideaInbox: join(tmpdir(), 'lig-market-root', 'idea-inbox.md')
  })
}))

vi.mock('../skillFetch', () => ({ fetchText: vi.fn() }))

import { fetchText } from '../skillFetch'
import { getMarketCatalog, getMarketConfig, refreshMarketCatalog, resolveOfficialSkill, setMarketConfig } from '../skillMarket'

const fetchMock = fetchText as unknown as Mock

function seedOfficialSkill(): void {
  const dir = join(APP_DIR, 'resources', 'skills', 'wechat-viral-topic')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: wechat-viral-topic\ndescription: 官方选题 Skill 演示描述\n---\n${BUNDLED_SKILL_MD}`)
}

beforeEach(() => {
  rmSync(APP_DIR, { recursive: true, force: true })
  rmSync(ROOT_DIR, { recursive: true, force: true })
  mkdirSync(SETTINGS_DIR, { recursive: true })
  mkdirSync(SKILLS_DIR, { recursive: true })
  seedOfficialSkill()
  fetchMock.mockReset()
})

describe('市场源配置', () => {
  it('默认未配置（空串），写入后可读回并落盘', async () => {
    expect(getMarketConfig().catalogUrl).toBe('')
    setMarketConfig('  https://cdn.example.com/catalog.json  ')
    expect(getMarketConfig().catalogUrl).toBe('https://cdn.example.com/catalog.json')
    expect(JSON.parse(readFileSync(join(SETTINGS_DIR, 'skill-market.json'), 'utf-8'))).toMatchObject({
      catalogUrl: 'https://cdn.example.com/catalog.json'
    })
    await Promise.resolve()
  })
})

describe('getMarketCatalog（秒开路径，不碰网络）', () => {
  it('无缓存：内置 6 条打底，offline 如实带原因', () => {
    const s = getMarketCatalog()
    expect(s.items).toHaveLength(6)
    expect(s.items.every((i) => i.official && i.origin === 'builtin')).toBe(true)
    expect(s.offline).toBe(true)
    expect(s.offlineReason).toContain('未配置在线目录源')
    expect(s.onlineAt).toBeNull()
  })
})

describe('refreshMarketCatalog（在线刷新与降级）', () => {
  it('未配置源：不发起网络请求，如实带原因', async () => {
    const s = await refreshMarketCatalog()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s.offline).toBe(true)
    expect(s.offlineReason).toContain('未配置')
  })

  it('拉取成功：同名在线覆盖、独有追加，缓存落盘供断网秒开', async () => {
    setMarketConfig('https://cdn.example.com/catalog.json')
    fetchMock.mockResolvedValue(ONLINE_CATALOG)
    const s = await refreshMarketCatalog()
    expect(s.offline).toBe(false)
    expect(s.onlineAt).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/catalog.json')
    expect(s.items[0]).toMatchObject({ name: 'wechat-viral-topic', description: '在线更新的描述', origin: 'online' })
    expect(s.items.at(-1)).toMatchObject({ name: 'writer-extra', origin: 'online' })
    // 缓存已写：再走 get（无网络路径）也能拿到在线条目
    const got = getMarketCatalog()
    expect(got.offline).toBe(false)
    expect(got.items.some((i) => i.name === 'writer-extra')).toBe(true)
  })

  it('拉取失败且无缓存：降级内置目录，原因如实（不静默不崩）', async () => {
    setMarketConfig('https://cdn.example.com/catalog.json')
    fetchMock.mockRejectedValue(new Error('10 个候选地址全部下载失败'))
    const s = await refreshMarketCatalog()
    expect(s.offline).toBe(true)
    expect(s.offlineReason).toContain('拉取失败')
    expect(s.offlineReason).toContain('10 个候选地址全部下载失败')
    expect(s.items).toHaveLength(6)
    expect(s.items.every((i) => i.origin === 'builtin')).toBe(true)
  })

  it('拉取失败但有缓存：仍展示缓存并明示失败（offline=false + 原因）', async () => {
    setMarketConfig('https://cdn.example.com/catalog.json')
    fetchMock.mockResolvedValueOnce(ONLINE_CATALOG)
    await refreshMarketCatalog()
    fetchMock.mockRejectedValueOnce(new Error('HTTP 503'))
    const s = await refreshMarketCatalog()
    expect(s.offline).toBe(false)
    expect(s.offlineReason).toContain('仍展示上次缓存')
    expect(s.items.some((i) => i.name === 'writer-extra')).toBe(true)
  })

  it('返回 HTML 或空目录视为失败（指错 URL 的常见形态）', async () => {
    setMarketConfig('https://cdn.example.com/wrong.json')
    fetchMock.mockResolvedValue('<!doctype html><html></html>')
    const s = await refreshMarketCatalog()
    expect(s.offline).toBe(true)
    expect(s.offlineReason).toContain('不是合法的市场目录')
  })
})

describe('resolveOfficialSkill（官方件包内解析）', () => {
  it('从随包 resources/skills 读出预览：解析描述、scriptDep 检测、exists 看安装态', () => {
    const r = resolveOfficialSkill('wechat-viral-topic')
    expect(r).toMatchObject({
      name: 'wechat-viral-topic',
      description: '官方选题 Skill 演示描述',
      origin: '官方预装包',
      exists: false,
      scriptDep: null
    })
    expect(r.content).toContain('官方预装的演示 Skill 正文')
    // 装过（skills/ 下有同名目录）→ exists 如实标出
    mkdirSync(join(SKILLS_DIR, 'wechat-viral-topic'), { recursive: true })
    writeFileSync(join(SKILLS_DIR, 'wechat-viral-topic', 'SKILL.md'), BUNDLED_SKILL_MD)
    expect(resolveOfficialSkill('wechat-viral-topic').exists).toBe(true)
  })

  it('包内没有的条目报错；路径穿越名被清洗，不会读穿到包外', () => {
    expect(() => resolveOfficialSkill('not-exist')).toThrow('官方预装包里没有')
    // '..\etc' 清洗成 '..-etc'：不抛穿越，落「包里没有」的常规报错
    expect(() => resolveOfficialSkill('..\\etc')).toThrow('官方预装包里没有')
    expect(existsSync(join(APP_DIR, 'etc'))).toBe(false)
  })
})
