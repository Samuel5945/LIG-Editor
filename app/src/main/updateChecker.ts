import { app, net } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UpdateCheckResult, UpdateInfo } from '@shared/types'
import { compareVersions, extractUrl } from '@shared/versionUtils'
import { getAppPaths } from './paths'

/**
 * 版本更新检测（提示式，不做自动更新——网盘分发 + 国内网络 + portable 版均不适合静默升级）：
 * - 双源并行：官网 lig-editor-update.json（主，国内可达）+ GitHub Releases API（兜底），
 *   取两源中版本更高的「已就绪」者
 * - 「已就绪」对齐发版节奏（传网盘 → 发 Release → 官网 JSON）：GitHub 源要求 release 正文
 *   里贴了夸克/百度网盘链接才算发布完成，否则不提示
 * - 忽略版本持久化 settings/update.json；dev 可用 LIG_UPDATE_FAKE_VERSION 模拟远端新版本
 */

const SITE_MANIFEST_URL = 'https://ligdesign.win/lig-editor-update.json'
const GITHUB_LATEST_API = 'https://api.github.com/repos/Samuel5945/LIG-Editor/releases/latest'
const GITHUB_RELEASES_PAGE = 'https://github.com/Samuel5945/LIG-Editor/releases/latest'
const SITE_PAGE = 'https://ligdesign.win/lig-editor.html'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TIMEOUT_MS = 8000

/** 应用内置的稳定下载渠道兜底（网盘分享链接长期有效）：某源没给出链接时补齐，
 * 保证弹窗永远有夸克/百度/GitHub/官网四个入口；官网 update.json 里的同名字段可覆盖 */
const FALLBACK_DOWNLOADS: UpdateInfo['downloads'] = {
  quark: 'https://pan.quark.cn/s/1cb400aa407b',
  baidu: 'https://pan.baidu.com/s/1Y1tbciVySYOEd2gcwivqrw?pwd=35c8',
  github: GITHUB_RELEASES_PAGE,
  site: SITE_PAGE
}

/** 合并下载入口：源里明确给出（非空）的字段优先，其余落内置兜底 */
function mergeDownloads(partial: UpdateInfo['downloads']): UpdateInfo['downloads'] {
  const out = { ...FALLBACK_DOWNLOADS }
  for (const k of Object.keys(partial) as (keyof typeof out)[]) {
    if (partial[k]) out[k] = partial[k]
  }
  return out
}

// ---------- 偏好持久化（settings/update.json） ----------

interface UpdatePrefs {
  skippedVersion?: string
}

function prefsFile(): string {
  return join(getAppPaths().settings, 'update.json')
}

function readPrefs(): UpdatePrefs {
  try {
    if (!existsSync(prefsFile())) return {}
    return JSON.parse(readFileSync(prefsFile(), 'utf-8')) as UpdatePrefs
  } catch {
    return {}
  }
}

/** 记录「忽略此版本」；更新到更高版本后该记录自然失效（比较由渲染层按 latest 版本做） */
export function dismissVersion(version: string): void {
  writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), skippedVersion: version }, null, 2))
}

// ---------- 双源抓取 ----------

interface SiteManifest {
  version?: string
  releaseDate?: string
  notes?: string | string[]
  downloads?: { quark?: string; baidu?: string; github?: string; site?: string }
}

/** 官网源：ligdesign.win/lig-editor-update.json（cache-bust 避免 CDN/浏览器缓存旧版本）。
 * 站点是 Cloudflare 静态托管，未部署的路径会 200 返回首页 HTML（软 404）——正文不像 JSON
 * 时按「清单还没上传」处理而不是报错 */
async function fetchSiteManifest(): Promise<UpdateInfo | null> {
  const resp = await net.fetch(`${SITE_MANIFEST_URL}?t=${Date.now()}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const text = (await resp.text()).trimStart()
  if (!text.startsWith('{')) return null
  const json = JSON.parse(text) as SiteManifest
  const version = (json.version ?? '').trim().replace(/^v/i, '')
  if (!/^\d+\.\d+/.test(version)) return null
  return {
    version,
    notes: Array.isArray(json.notes) ? json.notes.join('\n') : json.notes,
    releaseDate: json.releaseDate,
    downloads: mergeDownloads({
      quark: json.downloads?.quark,
      baidu: json.downloads?.baidu,
      github: json.downloads?.github,
      site: json.downloads?.site
    }),
    source: 'site'
  }
}

interface GithubRelease {
  tag_name?: string
  body?: string | null
  html_url?: string
  published_at?: string
}

/** GitHub 源：releases/latest；正文必须含网盘链接才算「已发布」（传完网盘才发的版） */
async function fetchGithubRelease(): Promise<UpdateInfo | null> {
  const resp = await net.fetch(GITHUB_LATEST_API, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const rel = JSON.parse(await resp.text()) as GithubRelease
  if (!rel.tag_name) return null
  const body = rel.body ?? ''
  const quark = extractUrl(body, /pan\.quark\.cn\//)
  const baidu = extractUrl(body, /pan\.baidu\.com\//)
  if (!quark && !baidu) return null
  return {
    version: rel.tag_name.trim().replace(/^v/i, ''),
    notes: body || undefined,
    releaseDate: rel.published_at?.slice(0, 10),
    downloads: mergeDownloads({ quark, baidu, github: rel.html_url ?? GITHUB_RELEASES_PAGE, site: SITE_PAGE }),
    source: 'github'
  }
}

// ---------- 汇总 ----------

/** dev 联调：LIG_UPDATE_FAKE_VERSION=0.6.1 模拟远端出了新版本（仅未打包时生效） */
function fakeInfo(version: string): UpdateInfo {
  return {
    version,
    notes: '（LIG_UPDATE_FAKE_VERSION 模拟数据）\n· 验证弹窗、下载按钮与「忽略此版本」\n· 忽略后重启静默检查不再打扰',
    releaseDate: new Date().toISOString().slice(0, 10),
    downloads: mergeDownloads({}),
    source: 'site'
  }
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  const skippedVersion = readPrefs().skippedVersion

  const fake = app.isPackaged ? undefined : process.env.LIG_UPDATE_FAKE_VERSION
  if (fake) {
    const newer = compareVersions(fake, current) > 0
    return {
      status: newer ? 'available' : 'up-to-date',
      currentVersion: current,
      latest: newer ? fakeInfo(fake) : undefined,
      skippedVersion
    }
  }

  const settled = await Promise.allSettled([fetchSiteManifest(), fetchGithubRelease()])
  settled.forEach((r, i) => {
    if (r.status === 'rejected') console.warn(`[updateChecker] ${i === 0 ? 'site' : 'github'} 源检查失败:`, r.reason)
  })
  // fulfilled(null) = 源可达但无可用信息（官网清单未部署 / GitHub release 未贴网盘链接），与网络失败区分开
  const reachable = settled.filter((r) => r.status === 'fulfilled').length
  const candidates = settled
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((x): x is UpdateInfo => x !== null)
  const newer = candidates.filter((c) => compareVersions(c.version, current) > 0)

  if (newer.length === 0) {
    // 全部源网络失败才算 error；源可达但没有更高版本 = 已是最新
    if (reachable === 0) {
      return { status: 'error', currentVersion: current, message: '检查更新失败：更新源暂时连不上，请稍后重试或前往官网查看' }
    }
    return { status: 'up-to-date', currentVersion: current, skippedVersion }
  }
  newer.sort((a, b) => compareVersions(b.version, a.version))
  return { status: 'available', currentVersion: current, latest: newer[0], skippedVersion }
}
