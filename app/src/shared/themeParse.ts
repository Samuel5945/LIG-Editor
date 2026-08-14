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

/**
 * 背景值是否为「单一背景色」：微信编辑器常生成多图层复合背景
 * （`rgba(0,0,0,0.4) rgba(0,0,0,0.4) rgb(53,179,120)`），此时不能当 highlight 底色
 */
function singleBgColor(v: string): string | null {
  const colorCount = (v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || []).length
  if (colorCount > 1) return null
  const hex = toHex(v)
  if (!hex) return null
  // 透明/全透明背景不算
  if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(v)) return null
  return hex
}

/** 是否「接近黑白灰」：三通道极差 < 40 视为中性色 */
function isNeutral(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return Math.max(r, g, b) - Math.min(r, g, b) < 40
}

/** 颜色亮度（WCAG 相对亮度，0-1） */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** 统计某类元素指定属性的颜色频次（含中性色，排除白色/透明） */
function tallyColors(
  els: ElementStyles[],
  tags: string[],
  keys: string[],
  opts: { skipNeutral?: boolean; maxLum?: number } = {}
): Map<string, number> {
  const freq = new Map<string, number>()
  for (const e of els) {
    if (!tags.includes(e.tag)) continue
    for (const k of keys) {
      const v = e.style[k]
      if (!v) continue
      const hex = singleBgColor(v) ?? toHex(v)
      if (!hex) continue
      if (WHITEISH.has(hex)) continue
      if (opts.skipNeutral && isNeutral(hex)) continue
      if (opts.maxLum !== undefined && luminance(hex) > opts.maxLum) continue
      freq.set(hex, (freq.get(hex) ?? 0) + 1)
    }
  }
  return freq
}

/** 频次最高者；空返回 undefined */
function topColor(freq: Map<string, number>): string | undefined {
  let best: string | undefined
  let n = 0
  for (const [hex, c] of freq) {
    if (c > n) {
      n = c
      best = hex
    }
  }
  return best
}

/** 元素样式收集（含标签名），供多轮统计 */
interface ElementStyles {
  tag: string
  style: Record<string, string>
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
  const dark = !!bodyBg && luminance(bodyBg) < 0.35

  // ---- 强调色（加权投票）：标题/加粗的 color 权重最高（品牌色常在此），
  //      其次普通元素 color，最后 border/背景；排除中性色与过浅色（浅色多为高亮底色） ----
  const COLOR_KEYS = ['color']
  const BORDER_KEYS = ['border-left', 'border-top', 'border-bottom', 'border-color']
  const accentFreq = new Map<string, number>()
  const addAll = (map: Map<string, number>, tags: string[], keys: string[], w: number): void => {
    const t = tallyColors(els, tags, keys, { skipNeutral: true, maxLum: 0.75 })
    for (const [hex, n] of t) map.set(hex, (map.get(hex) ?? 0) + n * w)
  }
  addAll(accentFreq, ['h1', 'h2', 'h3'], COLOR_KEYS, 4)
  addAll(accentFreq, ['strong', 'b'], COLOR_KEYS, 5)
  addAll(accentFreq, ['a', 'span', 'p', 'div', 'section', 'td', 'th'], COLOR_KEYS, 1)
  addAll(accentFreq, ['h1', 'h2', 'h3', 'strong', 'b', 'td', 'th'], BORDER_KEYS, 1)
  let accent = topColor(accentFreq) ?? DEFAULT_THEME.accent

  // ---- 标题文字色（h1/h2/h3 的 color；有彩色强调色时用，否则与正文同色） ----
  const headingColor = topColor(
    tallyColors(els, ['h1', 'h2', 'h3'], COLOR_KEYS, { skipNeutral: true })
  )

  // ---- 加粗强调色（strong/b 的 color；缺省=accent） ----
  const strongColor = topColor(tallyColors(els, ['strong', 'b'], COLOR_KEYS, { skipNeutral: true }))

  // ---- 正文色：优先 p 的 color（span 常被代码高亮/链接色污染，如本文 74 次蓝色高亮）；
  //      无 p 色时取 span 的中性色作后备 ----
  const bodyText =
    topColor(tallyColors(els, ['p'], COLOR_KEYS, { maxLum: 0.92 })) ??
    topColor(tallyColors(els, ['span'], COLOR_KEYS, { skipNeutral: true, maxLum: 0.92 }))

  // ---- 标题装饰：h1 / h2 的首个样式 ----
  const h1 = els.find((e) => e.tag === 'h1')
  const h2 = els.find((e) => e.tag === 'h2')
  const h1s = h1?.style ?? {}
  const h2s = h2?.style ?? {}
  const h1Style: ArticleTheme['h1Style'] =
    h1s['background'] && singleBgColor(h1s['background']) && !WHITEISH.has(singleBgColor(h1s['background'])!)
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

  // ---- 加粗：仅「单一背景色」才算 highlight（微信多图层复合值不算） ----
  const strongEl = els.find((e) => e.tag === 'strong') ?? els.find((e) => e.tag === 'b')
  const ss = strongEl?.style ?? {}
  const strongBg = ss['background'] ? singleBgColor(ss['background']) : null
  const strongStyle: ArticleTheme['strongStyle'] = strongBg ? 'highlight' : 'color'

  // ---- 表格样式：th 背景 / 边框色 / 单元格底色 → bordered | striped | plain ----
  const thBg = topColor(tallyColors(els, ['th'], ['background', 'background-color'], { maxLum: 0.98 }))
  const tableBorder = topColor(
    tallyColors(els, ['table', 'td', 'th'], ['border', 'border-top', 'border-bottom', 'border-color'], {
      maxLum: 0.98
    })
  )
  const tdBg = topColor(tallyColors(els, ['td'], ['background', 'background-color'], { maxLum: 0.98 }))
  // 表格风格：有表头背景 → bordered；td 有非白背景 → striped（斑马纹意图）；否则按边框有无
  const hasTable = els.some((e) => e.tag === 'table')
  const tableStyle: ArticleTheme['tableStyle'] = !hasTable
    ? undefined
    : tdBg && tdBg !== thBg
      ? 'striped'
      : thBg || tableBorder
        ? 'bordered'
        : 'plain'

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
    ...(bodyBg
      ? {
          bodyBg,
          bodyText: bodyText && bodyText !== '#ffffff' ? bodyText : dark ? '#cbd5e1' : '#333',
          bodyRadius: 14,
          bodyPadding: '16px 18px'
        }
      : bodyText && bodyText !== '#ffffff'
        ? { bodyText }
        : {}),
    ...(headingColor ? { headingColor } : {}),
    h1Style,
    h2Style,
    quoteStyle,
    hrStyle,
    strongStyle,
    ...(strongColor ? { strongColor } : {}),
    ...(strongBg ? { strongBg } : {}),
    ...(tableStyle ? { tableStyle } : {}),
    ...(thBg ? { tableHeaderBg: thBg } : {}),
    ...(tableBorder ? { tableBorder } : {}),
    ...(imgRadius !== undefined ? { imgRadius } : {}),
    ...(pGap !== undefined ? { pGap } : {})
  }

  const summary = [
    `强调色 ${accent}`,
    bodyBg ? `背景卡片 ${bodyBg}` : '白底',
    headingColor && headingColor !== accent ? `标题色 ${headingColor}` : `标题随强调色`,
    strongColor && strongColor !== accent ? `加粗色 ${strongColor}` : '',
    `大标题 ${h1Style} / 小节 ${h2Style}`,
    `引用 ${quoteStyle} / 分隔线 ${hrStyle}`,
    `加粗 ${strongStyle}${strongBg ? `（底 ${strongBg}）` : ''}`,
    hasTable ? `表格 ${tableStyle}${thBg ? `（表头 ${thBg}）` : ''}` : ''
  ].filter(Boolean)

  return { name, theme, summary }
}
