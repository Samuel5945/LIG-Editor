import { net } from 'electron'
import type { WebSearchResult } from '@shared/types'
import { getSearchSettings } from './settingsStore'

/**
 * 免密联网搜索：无需 API Key，主进程抓 HTML 解析结果摘要
 * - 用 net.fetch（走系统代理，见既有经验：Node fetch 不认系统代理）
 * - DuckDuckGo html 版优先，失败/为空退 Bing
 * - 结果注入提示词给模型读，模型 API 本身没有联网能力
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const MAX_RESULTS = 6

export async function webSearch(query: string, fresh = false): Promise<WebSearchResult[]> {
  const q = query.trim()
  if (!q) return []
  try {
    const ddg = await searchDdg(q, fresh)
    if (ddg.length > 0) return ddg
  } catch {
    // 换下一个源
  }
  try {
    return await searchBing(q, fresh)
  } catch (err) {
    throw new Error(`联网搜索失败：${err instanceof Error ? err.message : err}`)
  }
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await net.fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(15000)
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.text()
}

/** DuckDuckGo html 版：结构稳定，无 JS 渲染；fresh 限近一个月结果 */
async function searchDdg(q: string, fresh: boolean): Promise<WebSearchResult[]> {
  const df = fresh ? '&df=m' : ''
  const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=cn-zh${df}`)
  const out: WebSearchResult[] = []
  // 每条结果：<a class="result__a" href="...">标题</a> ... <a class="result__snippet">摘要</a>
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  const links: { url: string; title: string }[] = []
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) && links.length < MAX_RESULTS) {
    links.push({ url: decodeDdgUrl(m[1]), title: stripTags(m[2]) })
  }
  const snippets: string[] = []
  while ((m = snippetRe.exec(html)) && snippets.length < MAX_RESULTS) {
    snippets.push(stripTags(m[1]))
  }
  links.forEach((l, i) => {
    if (l.title) out.push({ title: l.title, url: l.url, snippet: snippets[i] ?? '' })
  })
  return out
}

/** DDG 结果链接是 /l/?uddg=<编码后真实地址> 形式 */
function decodeDdgUrl(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      return href
    }
  }
  return href.startsWith('//') ? 'https:' + href : href
}

/** Bing 兜底：解析 <li class="b_algo"> 块；fresh 限近一个月结果 */
async function searchBing(q: string, fresh: boolean): Promise<WebSearchResult[]> {
  const filter = fresh ? '&filters=ex1%3a%22ez3%22' : ''
  const html = await fetchHtml(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-hans${filter}`)
  const out: WebSearchResult[] = []
  const blockRe = /<li class="b_algo"[\s\S]*?<\/li>/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) && out.length < MAX_RESULTS) {
    const block = m[0]
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!link) continue
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block)
    out.push({
      title: stripTags(link[2]),
      url: link[1],
      snippet: snippet ? stripTags(snippet[1]) : ''
    })
  }
  return out
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- 审阅级深度检索（web:research） ----------

/** Bing 新闻垂直源：结果自带发布时间，限近一个月 */
async function searchBingNews(q: string): Promise<WebSearchResult[]> {
  const html = await fetchHtml(
    `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&qft=interval%3d%229%22&setlang=zh-hans`
  )
  const out: WebSearchResult[] = []
  // 每张卡片以 class="news-card 开头；按此切块后在块内找标题/摘要/时间
  const chunks = html.split(/class="news-card/).slice(1)
  for (const chunk of chunks) {
    if (out.length >= MAX_RESULTS) break
    const link =
      /<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(chunk) ??
      /url="([^"]+)"[^>]*data-title="([^"]+)"/.exec(chunk)
    if (!link) continue
    const snippet = /<div[^>]*class="snippet"[^>]*>([\s\S]*?)<\/div>/.exec(chunk)
    const time = />(\d+\s*(?:分钟|小时|天)前|昨天|\d{4}年\d{1,2}月\d{1,2}日)</.exec(chunk)
    out.push({
      title: stripTags(link[2]),
      url: link[1],
      snippet: snippet ? stripTags(snippet[1]) : '',
      date: time ? time[1] : undefined
    })
  }
  return out
}

/** 深抓单页：提取发布时间元信息 + 正文节选（失败返回 null，不阻断流程） */
async function fetchPageDetail(url: string): Promise<{ date?: string; content: string } | null> {
  try {
    const resp = await net.fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(8000)
    })
    if (!resp.ok) return null
    const html = await resp.text()
    const meta =
      /<meta[^>]*(?:property="article:published_time"|name="publishdate"|itemprop="datePublished")[^>]*content="([^"]+)"/i.exec(html)
    const body = stripTags(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<(?:nav|header|footer|aside)[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, ' ')
    )
    // 元信息没有就从正文开头找一个日期模式
    const inline = /20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}/.exec(body.slice(0, 2000))
    const date = meta?.[1]?.slice(0, 10) ?? inline?.[0]
    const content = body.slice(0, 1500)
    return content.length > 100 ? { date, content } : null
  } catch {
    return null
  }
}

// ---- 搜索 API（设置里配了 key 才走）----

async function searchTavily(q: string, apiKey: string): Promise<WebSearchResult[]> {
  const resp = await net.fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: q, max_results: MAX_RESULTS, days: 30, include_answer: false }),
    signal: AbortSignal.timeout(15000)
  })
  if (!resp.ok) throw new Error(`Tavily HTTP ${resp.status}`)
  const data = (await resp.json()) as {
    results?: { title: string; url: string; content: string; published_date?: string }[]
  }
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content?.slice(0, 400) ?? '',
    date: r.published_date?.slice(0, 10)
  }))
}

async function searchBocha(q: string, apiKey: string): Promise<WebSearchResult[]> {
  const resp = await net.fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: q, freshness: 'oneMonth', summary: true, count: MAX_RESULTS }),
    signal: AbortSignal.timeout(15000)
  })
  if (!resp.ok) throw new Error(`博查 HTTP ${resp.status}`)
  const data = (await resp.json()) as {
    data?: { webPages?: { value?: { name: string; url: string; summary?: string; snippet?: string; datePublished?: string }[] } }
  }
  return (data.data?.webPages?.value ?? []).map((r) => ({
    title: r.name,
    url: r.url,
    snippet: (r.summary ?? r.snippet ?? '').slice(0, 400),
    date: r.datePublished?.slice(0, 10)
  }))
}

/**
 * 审阅级深度检索：多查询并行，去重合并
 * - 配了搜索 API：走 API（自带日期+高质量摘要），失败降级免密路径
 * - 免密路径：网页搜（限近一个月）+ Bing 新闻源，再对缺日期的 top 结果深抓正文+发布时间
 */
export async function webResearch(queries: string[]): Promise<WebSearchResult[]> {
  const qs = queries.map((q) => q.trim()).filter(Boolean).slice(0, 3)
  if (qs.length === 0) return []
  const { provider, apiKey } = getSearchSettings()

  if (provider !== 'none' && apiKey) {
    const fn = provider === 'tavily' ? searchTavily : searchBocha
    const settled = await Promise.allSettled(qs.map((q) => fn(q, apiKey)))
    const merged = dedupe(settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [])))
    if (merged.length > 0) return merged.slice(0, 8)
    // API 全挂了也不能两手空空，落到免密路径
  }

  const settled = await Promise.allSettled([
    ...qs.map((q) => webSearch(q, true)),
    ...qs.map((q) => searchBingNews(q))
  ])
  const merged = dedupe(settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))).slice(0, 8)
  // 只对缺日期的前几条深抓（新闻源已带日期的不重复抓），并行限 3 页
  const targets = merged.filter((r) => !r.date).slice(0, 3)
  await Promise.allSettled(
    targets.map(async (r) => {
      const detail = await fetchPageDetail(r.url)
      if (detail) {
        r.date = detail.date ?? r.date
        r.content = detail.content
      }
    })
  )
  return merged
}

function dedupe(list: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>()
  const out: WebSearchResult[] = []
  for (const r of list) {
    if (!r.url || seen.has(r.url)) continue
    seen.add(r.url)
    out.push(r)
  }
  return out
}
