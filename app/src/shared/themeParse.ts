import type { ArticleTheme } from './types'
import { DEFAULT_THEME } from './categoryThemes'

/**
 * 从公众号/网页 HTML 启发式提取排版调性（无 DOM 依赖，纯正则扫描内联样式）。
 * 公众号文章几乎全是内联 style，覆盖率足够高；提取结果用 DEFAULT_THEME 打底补全，
 * 保证任何字段缺失都能回落经典排版。适合「复制一篇好看的公众号 → 复用它的排版」。
 */

const SANS = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
const SERIF = '"Source Han Serif SC", "Noto Serif SC", "STSong", "SimSun", serif'
const MONO = '"Cascadia Code", "JetBrains Mono", Consolas, monospace'

/**
 * 裁剪抓取到的 HTML，只留排版分析所需的正文：
 * - 公众号文章优先提取 id="js_content" 正文容器（微信生成的标签规范，可安全配对），
 *   体积通常从 3MB+ 骤降到几十 KB，解析快且 textarea 不卡；
 * - 非公众号页面去掉 script/style/注释等噪音。
 */
export function trimHtmlForTheme(html: string): string {
  const js = extractJsContent(html)
  if (js) return js
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
}

/** 提取公众号正文容器 id="js_content" 的内容（含内部全部内联样式标签）；找不到返回 null */
function extractJsContent(html: string): string | null {
  const start = /<div[^>]*id=["']js_content["'][^>]*>/i.exec(html)
  if (!start) return null
  const body = html.slice(start.index + start[0].length)
  let depth = 1
  const re = /<\/?[a-z][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const t = m[0]
    if (/^<\//.test(t)) {
      depth--
      if (depth === 0) return html.slice(start.index, start.index + start[0].length + m.index)
    } else if (!/\/>$/.test(t)) {
      // 非自闭合开标签（<img/> <br/> 等以 /> 结尾的不计深度）
      depth++
    }
  }
  return html.slice(start.index)
}

/** 解析 style 字符串 → 键值对象（小写键） */
function parseStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const seg of style.split(';')) {
    const i = seg.indexOf(':')
    if (i < 0) continue
    const k = seg.slice(0, i).trim().toLowerCase()
    const v = seg.slice(i + 1).trim()
    if (k && v) out[k] = v
  }
  return out
}

/** 从颜色字符串提取 hex：#22d3ee / 3px solid #22d3ee / rgba(34,211,238,0.1) 均可；提取不到返回 null */
function toHex(color: string): string | null {
  const c = color.trim().toLowerCase()
  const hexMatch = /#([0-9a-f]{6}|[0-9a-f]{3})\b/.exec(c)
  if (hexMatch) {
    const h = hexMatch[1]
    return h.length === 3
      ? '#' + h.split('').map((x) => x + x).join('')
      : '#' + h
  }
  const rgbMatch = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c)
  if (rgbMatch) {
    return (
      '#' +
      [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')
    )
  }
  return null
}

/** 是否「接近黑白灰」：三通道极差 < 40 视为中性色 */
function isNeutral(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return Math.max(r, g, b) - Math.min(r, g, b) < 40
}

/** 判断字体族气质 */
function fontKind(family: string): string {
  const f = family.toLowerCase()
  if (/(song|serif|宋|明|kai|楷|fang|仿)/.test(f)) return 'serif'
  if (/(mono|consol|courier|code)/.test(f)) return 'mono'
  return 'sans'
}

interface ElementStyles {
  tag: string
  style: Record<string, string>
}

/** 扫描所有开标签的 style 属性（公众号 HTML 样式全内联，无需 DOM 配对） */
function collect(html: string): ElementStyles[] {
  const out: ElementStyles[] = []
  const re = /<([a-z0-9]+)((?:\s[^<>]*?)?)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase()
    const attrs = m[2] ?? ''
    const styleMatch = /style\s*=\s*"([^"]*)"/i.exec(attrs)
    out.push({ tag, style: styleMatch ? parseStyle(styleMatch[1]) : {} })
  }
  return out
}

/** blockquote 开头是否带引号字符（quotes 风格判定） */
function quoteStartsWithMark(html: string): boolean {
  const m = /<blockquote[^>]*>([\s\S]{0,60})/i.exec(html)
  return !!m && /[❝“"「『]/.test(m[1])
}

const WHITEISH = new Set(['#fff', '#ffffff', 'white'])

export interface ParsedTheme {
  /** 建议分类名（从 <title> 提取，可改） */
  name: string
  /** 提取到的调性（DEFAULT_THEME 打底） */
  theme: ArticleTheme
  /** 从原文提取出的标签样式摘要（供 UI 展示「识别到了什么」） */
  summary: string[]
}

export function parseThemeFromHtml(html: string): ParsedTheme {
  const els = collect(html)

  // 建议名：<title> 或首个 h1
  let name = ''
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
  if (titleMatch) name = titleMatch[1].trim()
  if (!name) {
    const h1m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
    if (h1m) name = h1m[1].replace(/<[^>]+>/g, '').trim()
  }
  name = (name || '导入排版').slice(0, 16)

  // ---- 背景色：取第一个「非白」的 section/body/最外层背景 ----
  let bodyBg: string | undefined
  for (const e of els) {
    if (!['section', 'body', 'div', 'html'].includes(e.tag)) continue
    const bg = e.style['background'] || e.style['background-color']
    if (!bg) continue
    const hex = toHex(bg)
    if (hex && !WHITEISH.has(hex) && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)) {
      bodyBg = hex
      break
    }
  }
  const dark = !!bodyBg

  // ---- 强调色：所有颜色里最高频的「彩色」 ----
  const freq = new Map<string, number>()
  const colorKeys = [
    'color',
    'background',
    'background-color',
    'border-left',
    'border-top',
    'border-bottom',
    'border-color'
  ]
  for (const e of els) {
    for (const k of colorKeys) {
      const v = e.style[k]
      if (!v) continue
      const hex = toHex(v)
      if (hex && !isNeutral(hex)) freq.set(hex, (freq.get(hex) ?? 0) + 1)
    }
  }
  let accent = DEFAULT_THEME.accent
  let best = 0
  for (const [hex, n] of freq) {
    if (n > best) {
      best = n
      accent = hex
    }
  }

  // ---- 标题装饰：h1 / h2 的首个样式 ----
  const h1 = els.find((e) => e.tag === 'h1')
  const h2 = els.find((e) => e.tag === 'h2')
  const h1s = h1?.style ?? {}
  const h2s = h2?.style ?? {}
  const h1Style: ArticleTheme['h1Style'] =
    h1s['background'] && !WHITEISH.has(toHex(h1s['background']) ?? '')
      ? 'pill'
      : h1s['border-bottom']
        ? 'underline'
        : 'bar'
  const h2Style: ArticleTheme['h2Style'] = h2s['background']
    ? 'block'
    : h2s['border-bottom']
      ? 'underline'
      : h2s['border-left']
        ? 'leftbar'
        : 'plain'

  // ---- 引用形态 ----
  const bq = els.find((e) => e.tag === 'blockquote')
  const bqs = bq?.style ?? {}
  const quoteStyle: ArticleTheme['quoteStyle'] = !bqs['border-left']
    ? 'card'
    : quoteStartsWithMark(html)
      ? 'quotes'
      : 'leftbar'

  // ---- 分隔线 ----
  const hr = els.find((e) => e.tag === 'hr')
  const hrs = hr?.style ?? {}
  const hrStyle: ArticleTheme['hrStyle'] = /dotted|dashed/.test(hrs['border-top'] ?? '')
    ? 'dot'
    : /width\s*:\s*100%/.test(hrs['width'] ?? '')
      ? 'long'
      : 'line'

  // ---- 加粗 ----
  const strong = els.find((e) => e.tag === 'strong')
  const ss = strong?.style ?? {}
  const strongStyle: ArticleTheme['strongStyle'] = ss['background'] ? 'highlight' : 'color'

  // ---- 数值 ----
  const first = els.find((e) => e.tag === 'p')?.style ?? {}
  const lineHeight = parseFloat(first['line-height'] ?? '')
  const letterSpacing = /em/.test(first['letter-spacing'] ?? '')
    ? first['letter-spacing']
    : undefined
  const pGap = /px/.test(first['margin'] ?? '')
    ? Math.max(0, ...(first['margin'].match(/\d+/g) ?? []).map(Number))
    : undefined
  const img = els.find((e) => e.tag === 'img')
  const imgRadius = /px/.test(img?.style?.['border-radius'] ?? '')
    ? parseFloat(img!.style['border-radius'])
    : undefined

  const family = els.find((e) => e.style['font-family'])?.style['font-family'] ?? 'sans'
  const kind = fontKind(family)
  const theme: ArticleTheme = {
    accent,
    fontFamily: kind === 'serif' ? SERIF : kind === 'mono' ? MONO : SANS,
    lineHeight: Number.isFinite(lineHeight) && lineHeight >= 1 ? lineHeight : DEFAULT_THEME.lineHeight,
    letterSpacing: letterSpacing ?? DEFAULT_THEME.letterSpacing,
    headingAlign: h1s['text-align'] === 'left' ? 'left' : 'center',
    ...(bodyBg ? { bodyBg, bodyText: dark ? '#cbd5e1' : '#333', headingColor: dark ? '#eef2f7' : '#1a1a1a', bodyRadius: 14, bodyPadding: '16px 18px' } : {}),
    h1Style,
    h2Style,
    quoteStyle,
    hrStyle,
    strongStyle,
    ...(ss['background'] ? { strongBg: toHex(ss['background']) ?? '#fef3c7' } : {}),
    ...(imgRadius !== undefined ? { imgRadius } : {}),
    ...(pGap !== undefined ? { pGap } : {})
  }

  const summary = [
    `强调色 ${accent}`,
    bodyBg ? `背景卡片 ${bodyBg}` : '白底',
    `大标题 ${h1Style} / 小节 ${h2Style}`,
    `引用 ${quoteStyle} / 分隔线 ${hrStyle}`,
    `加粗 ${strongStyle}${ss['background'] ? `（底 ${toHex(ss['background'])}）` : ''}`
  ]

  return { name, theme, summary }
}
