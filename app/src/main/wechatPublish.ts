import { basename, extname, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml, extractTitle } from '@shared/exportHtml'
import { resolveThemeForExport } from './exporter'
import type { PushDraftResult, PublicIpResult } from '@shared/wechat'
import { projectDir, readMeta, readTextFile } from './projectStore'
import { getWechatSettings } from './wechatStore'
import { readCards } from './cardsStore'

/**
 * 公众号草稿推送：article.md → 图片上传微信 CDN → draft/add 入草稿箱
 * - 草稿箱接口对未认证个人订阅号开放；调用方 IP 必须在公众平台白名单内
 * - 正文图片走 media/uploadimg（不占素材库额度，返回 mmbiz CDN URL）
 * - 封面走 material/add_material（永久素材，返回 thumb_media_id，草稿必填）
 * - access_token 进程内缓存，提前 5 分钟过期重取
 */

const API = 'https://api.weixin.qq.com/cgi-bin'

interface WxError {
  errcode?: number
  errmsg?: string
}

/** 微信错误码 → 可操作的中文提示 */
function wxErrorHint(code: number, msg: string): string {
  const hints: Record<number, string> = {
    40001: 'AppSecret 错误或已重置，请到公众平台「基本配置」核对',
    40013: 'AppID 无效，请核对公众平台「基本配置」中的开发者ID',
    40164: '本机公网 IP 不在白名单，请到公众平台「基本配置-IP白名单」添加',
    41001: '缺少 access_token（内部错误，请重试）',
    42001: 'access_token 已过期（已自动重取，请重试）',
    45009: '接口调用次数超限，请明天再试',
    48001: '接口权限不足：该公众号类型无法使用此接口',
    53404: '账号已被限制带货能力（内容触发审核）',
    53501: '频繁请求发布，请稍后再试'
  }
  return hints[code] ?? msg
}

async function wxFetch<T extends WxError>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = (await res.json()) as T
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`微信接口错误 ${data.errcode}：${wxErrorHint(data.errcode, data.errmsg ?? '')}`)
  }
  return data
}

// ---------- access_token ----------

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token
  const { appId, appSecret } = getWechatSettings()
  if (!appId || !appSecret) throw new Error('未配置公众号 AppID/AppSecret（设置页或 settings/wechat.json）')
  const data = await wxFetch<WxError & { access_token: string; expires_in: number }>(
    `${API}/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`
  )
  // 提前 5 分钟过期，避免边界期调用失败
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 }
  return data.access_token
}

/** 配置变更后清缓存（换号立即生效） */
export function invalidateToken(): void {
  cachedToken = null
}

// ---------- 公网 IP 查询（IP 白名单辅助） ----------

/** 多个公网 IP 查询源，逐个兜底（任一可用即返回） */
const IP_SOURCES: { url: string; parse: (text: string) => string }[] = [
  { url: 'https://api.ipify.org', parse: (t) => t.trim() },
  { url: 'https://api.ip.sb/ip', parse: (t) => t.trim() },
  { url: 'https://ipinfo.io/ip', parse: (t) => t.trim() }
]

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * 获取本机公网出口 IP（用于填写公众平台「基本配置-IP 白名单」）。
 * 主进程发起，走系统网络栈；多源兜底 + 单源 8s 超时。
 */
export async function getPublicIp(): Promise<PublicIpResult> {
  let lastErr = '未知错误'
  for (const src of IP_SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(8_000) })
      if (!res.ok) {
        lastErr = `${src.url} 返回 HTTP ${res.status}`
        continue
      }
      const ip = src.parse(await res.text())
      if (IPV4_RE.test(ip)) return { ok: true, ip }
      lastErr = `${src.url} 返回了无法识别的内容`
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
  }
  return { ok: false, error: `无法获取公网 IP：${lastErr}` }
}

// ---------- 图片上传 ----------

const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif'
}

function imageBlob(abs: string): { blob: Blob; filename: string } {
  const ext = extname(abs).toLowerCase()
  const mime = IMG_MIME[ext]
  if (!mime) throw new Error(`公众号仅支持 png/jpg/gif 图片：${basename(abs)}`)
  const buf = readFileSync(abs)
  if (buf.length > 10 * 1024 * 1024) throw new Error(`图片超过 10MB 上限：${basename(abs)}`)
  return { blob: new Blob([buf], { type: mime }), filename: basename(abs) }
}

/** 正文图片 → 微信 CDN URL（uploadimg 不占素材库额度） */
async function uploadContentImage(token: string, abs: string): Promise<string> {
  const { blob, filename } = imageBlob(abs)
  const form = new FormData()
  form.append('media', blob, filename)
  const data = await wxFetch<WxError & { url: string }>(`${API}/media/uploadimg?access_token=${token}`, {
    method: 'POST',
    body: form
  })
  return data.url
}

/** 封面 → 永久素材 thumb_media_id（草稿必填字段） */
async function uploadCoverMaterial(token: string, abs: string): Promise<string> {
  const { blob, filename } = imageBlob(abs)
  const form = new FormData()
  form.append('media', blob, filename)
  const data = await wxFetch<WxError & { media_id: string }>(
    `${API}/material/add_material?access_token=${token}&type=image`,
    { method: 'POST', body: form }
  )
  return data.media_id
}

// ---------- 草稿组装 ----------

/** 纯文本摘要：取正文首段文字，公众号 digest 上限 120 字 */
function extractDigest(md: string): string {
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('---') || t.startsWith('![') || t.startsWith('<!--'))
      continue
    return t.replace(/\*\*/g, '').slice(0, 120)
  }
  return ''
}

/**
 * 推送工程到公众号草稿箱。
 * 两遍渲染：第一遍收集正文全部本地图片路径，逐张上传 CDN 后，第二遍用 URL 映射出最终 HTML
 */
export async function pushDraft(project: string, variant: 'day' | 'night' = 'day'): Promise<PushDraftResult> {
  try {
    const md = readTextFile(project, 'article.md')
    if (!md.trim()) throw new Error('article.md 为空，先写正文再推送')
    const meta = readMeta(project)
    if (!meta.cover?.main) throw new Error('工程未设置封面（草稿必须有封面），先在标题封面面板生成或 set_cover')

    const dir = projectDir(project)
    const doc = mdToDoc(md)
    const token = await getAccessToken()

    // 第一遍：收集正文引用的本地图片（相对路径，去重；http/data 链接原样保留）
    const locals = new Set<string>()
    docToExportHtml(doc, (src) => {
      if (!/^(data:|https?:)/.test(src)) locals.add(src)
      return src
    })

    const urlMap = new Map<string, string>()
    for (const rel of locals) {
      const abs = join(dir, rel.replace(/\//g, '\\'))
      if (!existsSync(abs)) throw new Error(`正文图片不存在：${rel}`)
      urlMap.set(rel, await uploadContentImage(token, abs))
    }

    // 封面传永久素材
    const coverAbs = join(dir, meta.cover.main.replace(/\//g, '\\'))
    if (!existsSync(coverAbs)) throw new Error(`封面图不存在：${meta.cover.main}`)
    const thumbMediaId = await uploadCoverMaterial(token, coverAbs)

    // 第二遍：本地图替换为 CDN URL，产出最终正文 HTML（跟随分类排版调性 + 指定配色变体）
    const content = docToExportHtml(doc, (src) => urlMap.get(src) ?? src, resolveThemeForExport(meta), variant === 'night')

    const title = extractTitle(doc, project).slice(0, 64)
    const data = await wxFetch<WxError & { media_id: string }>(`${API}/draft/add?access_token=${token}`, {
      method: 'POST',
      // 公众号接口要求 JSON 中文不转义，JSON.stringify 默认行为即符合
      body: JSON.stringify({
        articles: [
          {
            title,
            content,
            thumb_media_id: thumbMediaId,
            digest: extractDigest(md),
            need_open_comment: 0,
            only_fans_can_comment: 0
          }
        ]
      }),
      headers: { 'Content-Type': 'application/json' }
    })

    return { ok: true, mediaId: data.media_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 推送贴图组到公众号草稿箱（article_type=newspic 图片消息，即「图片分享」形态）。
 * - 每张卡片 PNG 走 material/add_material 拿 image_media_id（图片消息上限 20 张）
 * - 配文用 deck.caption（发布配文）；标题取封面卡标题
 */
export async function pushCards(project: string): Promise<PushDraftResult> {
  try {
    const deck = readCards(project)
    if (!deck || !deck.cards.length) throw new Error('工程没有贴图，先生成贴图再推送')
    if (deck.cards.length > 20) throw new Error(`图片消息最多 20 张，当前 ${deck.cards.length} 张，请精简后再推送`)
    const missing = deck.cards.map((c, i) => (c.png ? '' : `#${i + 1}`)).filter(Boolean)
    if (missing.length) throw new Error(`以下卡片未渲染：${missing.join(' ')}，先全部渲染再推送`)

    const dir = projectDir(project)
    const token = await getAccessToken()
    const mediaIds: string[] = []
    for (const card of deck.cards) {
      const abs = join(dir, card.png.replace(/\//g, '\\'))
      if (!existsSync(abs)) throw new Error(`卡片图不存在：${card.png}，请重新渲染`)
      mediaIds.push(await uploadCoverMaterial(token, abs))
    }

    const title = (deck.cards[0]?.title || project).slice(0, 64)
    const data = await wxFetch<WxError & { media_id: string }>(`${API}/draft/add?access_token=${token}`, {
      method: 'POST',
      body: JSON.stringify({
        articles: [
          {
            article_type: 'newspic',
            title,
            content: deck.caption ?? '',
            image_info: { image_list: mediaIds.map((id) => ({ image_media_id: id })) },
            need_open_comment: 0,
            only_fans_can_comment: 0
          }
        ]
      }),
      headers: { 'Content-Type': 'application/json' }
    })

    return { ok: true, mediaId: data.media_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
