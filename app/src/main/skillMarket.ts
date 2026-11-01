import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { MarketCatalogState, SkillCatalog, SkillResolveResult } from '@shared/types'
import { mergeCatalogs, parseCatalog } from '@shared/skillMarket'
import { BUILTIN_MARKET_ENTRIES } from '@shared/skillMarketCatalog'
import { detectScriptDep } from '@shared/skillInstall'
import { getAppPaths } from './paths'
import { fetchText } from './skillFetch'
import { bundledSkillsDir, parseDescription, sanitizeSkillName } from './skillStore'

/**
 * Skill 市场（v1）：目录 = 内置打底 + 在线刷新（源 URL 持久化在 settings/skill-market.json）。
 * 打开市场走 getMarketCatalog（不碰网络，内置+缓存合并秒开）；手动刷新才拉网，
 * 拉不到降级缓存或内置并如实带原因——「断网优雅降级、状态不撒谎」是验收项，不是兜底注释。
 */

interface MarketDisk {
  /** 在线目录 JSON 直链；空 = 未配置（纯内置） */
  catalogUrl?: string
  /** 最近一次成功拉取的在线目录（断网后仍可展示） */
  cache?: SkillCatalog
  cacheAt?: string
}

function marketFile(): string {
  return join(getAppPaths().settings, 'skill-market.json')
}

function readDisk(): MarketDisk {
  try {
    return JSON.parse(readFileSync(marketFile(), 'utf-8')) as MarketDisk
  } catch {
    return {} // 文件不存在/损坏都从零开始，配置丢只影响在线刷新，内置目录永远在
  }
}

function writeDisk(disk: MarketDisk): void {
  writeFileSync(marketFile(), JSON.stringify(disk, null, 2), 'utf-8')
}

export function getMarketConfig(): { catalogUrl: string } {
  return { catalogUrl: readDisk().catalogUrl?.trim() ?? '' }
}

export function setMarketConfig(catalogUrl: string): void {
  const disk = readDisk()
  disk.catalogUrl = catalogUrl.trim()
  writeDisk(disk)
}

/** 内置 + 在线缓存合并（不碰网络）：打开市场的秒开路径 */
export function getMarketCatalog(): MarketCatalogState {
  const disk = readDisk()
  if (disk.cache) {
    return { items: mergeCatalogs(BUILTIN_MARKET_ENTRIES, disk.cache), offline: false, onlineAt: disk.cacheAt ?? null }
  }
  const configured = (disk.catalogUrl?.trim() ?? '') !== ''
  return {
    items: mergeCatalogs(BUILTIN_MARKET_ENTRIES, null),
    offline: true,
    onlineAt: null,
    offlineReason: configured ? '在线目录尚未成功拉取过，展示内置精选目录' : '未配置在线目录源，展示内置精选目录'
  }
}

/** 手动刷新：拉在线目录，成功写缓存；失败回退缓存/内置并带原因 */
export async function refreshMarketCatalog(): Promise<MarketCatalogState> {
  const { catalogUrl } = getMarketConfig()
  if (!catalogUrl) return { ...getMarketCatalog(), offlineReason: '未配置在线目录源，展示内置精选目录' }
  try {
    const catalog = parseCatalog(await fetchText(catalogUrl))
    if (!catalog || catalog.entries.length === 0) throw new Error('内容不是合法的市场目录 JSON（或缺条目）')
    const disk = readDisk()
    disk.cache = catalog
    disk.cacheAt = new Date().toISOString()
    writeDisk(disk)
    return { items: mergeCatalogs(BUILTIN_MARKET_ENTRIES, catalog), offline: false, onlineAt: disk.cacheAt }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const disk = readDisk()
    if (disk.cache) {
      return {
        items: mergeCatalogs(BUILTIN_MARKET_ENTRIES, disk.cache),
        offline: false,
        onlineAt: disk.cacheAt ?? null,
        offlineReason: `在线目录拉取失败，仍展示上次缓存（${reason}）`
      }
    }
    return {
      items: mergeCatalogs(BUILTIN_MARKET_ENTRIES, null),
      offline: true,
      onlineAt: null,
      offlineReason: `在线目录拉取失败：${reason}；当前展示内置精选目录`
    }
  }
}

/** 官方预装条目解析：读随包 resources/skills/<name>/SKILL.md 出预览，不落盘（确认后走 skill:installResolved） */
export function resolveOfficialSkill(name: string): SkillResolveResult {
  const clean = sanitizeSkillName(name, name)
  const md = join(bundledSkillsDir(), clean, 'SKILL.md')
  if (!existsSync(md)) throw new Error(`官方预装包里没有这个 Skill：${clean}`)
  const content = readFileSync(md, 'utf-8')
  return {
    name: clean,
    description: parseDescription(content),
    content,
    origin: '官方预装包',
    exists: existsSync(join(getAppPaths().skills, clean, 'SKILL.md')),
    scriptDep: detectScriptDep(content)
  }
}
