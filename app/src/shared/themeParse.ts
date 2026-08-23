import type { ArticleTheme } from './types'
import { DEFAULT_THEME } from './categoryThemes'

/**
 * 从公众号/网页 HTML 启发式提取排版调性（无 DOM 依赖，纯正则扫描内联样式）。
 * 公众号文章几乎全是内联 style，覆盖率足够高；提取结果用 DEFAULT_THEME 打底补全，
 * 保证任何字段缺失都能回落经典排版。适合「复制一篇好看的公众号 → 复用它的排版」。
 *
 * v3 解析策略：
 * - 数值单位折算：px 行高/字距按字号折算倍率与 em（line-height:28px 不再被当 28 倍行距），
 *   全部数值过合理区间夹取，越界回落默认
 * - 同类众数投票：h1/h2/引用/加粗等形态判定不再只看首个元素（装饰性首元素会污染），
 *   按同类标签逐个分类后取众数；具体色值取该形态下最常见的颜色
 * - 新增字段：正文字号 / 标题字号 / 卡片圆角与内边距 / h3 前缀标记
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

/** HTML void 元素（无闭合标签，常不带斜杠；配对深度时不能计入，否则 13 个 <img> 就能让配对失效） */
const VOID_TAGS = new Set([
  'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'embed',
  'col', 'area', 'base', 'track', 'wbr', 'intersect'
])

/** 提取公众号正文容器 id="js_content" 的内容（含内部全部内联样式标签）；找不到返回 null。
 *  正文里先剥离 script/style（未配对的 <script（属性带 >）会破坏配对游走），再按深度配对；
 *  void 元素不计深度。配不上的极端页面退化为「开标签 + 干净余文」（仍优于全文）。 */
function extractJsContent(html: string): string | null {
  const start = /<div[^>]*id=["']js_content["'][^>]*>/i.exec(html)
  if (!start) return null
  const open = start[0]
  const body = html
    .slice(start.index + open.length)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  let depth = 1
  const re = /<\/?([a-z][a-z0-9-]*)((?:\s[^<>]*?)?)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    if (/^<\//.test(m[0])) {
      depth--
      if (depth === 0) return open + body.slice(0, m.index + m[0].length)
    } else if (!/\/>$/.test(m[0]) && !VOID_TAGS.has(m[1].toLowerCase())) {
      depth++
    }
  }
  return open + body
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

/** 从开标签属性串提取 style（双引号优先，兼容单引号） */
function styleOfAttrs(attrs: string): Record<string, string> {
  const m = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
  return m ? parseStyle(m[1] ?? m[2] ?? '') : {}
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
 * （`rgba(0,0,0,0.4) rgba(0,0,0,0.4) rgb(53,179,120)`），此时不能当 highlight 底色。
 * 低透明度淡染（rgba alpha < 0.25，如引用浅底 rgba(0,196,152,0.08)）也不算——
 * 丢掉 alpha 会把 8% 淡绿误当实心色块，出「绿卡片绿字」的错误导入。
 */
function singleBgColor(v: string | undefined): string | null {
  if (!v) return null
  const colorCount = (v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || []).length
  if (colorCount > 1) return null
  const alphaM = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i.exec(v)
  if (alphaM && parseFloat(alphaM[1]) < 0.25) return null
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

/** 近白色（亮度 ≥0.98，仅拦 #fefefe/#fdfdfd 这类）：不作为卡片背景/标题色块候选。
 *  阈值不能更低：暖白卡片（生活常识 #fffaf2 ≈0.96）是常见合法卡色 */
function isWhiteish(hex: string): boolean {
  return luminance(hex) >= 0.98
}

/** 精确白：颜色统计里仅排除纯白（表格斑马纹/引用浅底 #fafafa 这类近白是合法配色） */
const PURE_WHITE = new Set(['#fff', '#ffffff'])

/** 统计某类元素指定属性的颜色频次（仅排除纯白） */
function tallyColors(
  els: ElementStyles[],
  tags: string[],
  keys: string[],
  opts: { skipNeutral?: boolean; onlyNeutral?: boolean; maxLum?: number } = {}
): Map<string, number> {
  const freq = new Map<string, number>()
  for (const e of els) {
    if (!tags.includes(e.tag)) continue
    for (const k of keys) {
      const v = e.style[k]
      if (!v) continue
      const hex = singleBgColor(v) ?? toHex(v)
      if (!hex) continue
      if (PURE_WHITE.has(hex)) continue
      if (opts.onlyNeutral && !isNeutral(hex)) continue
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

/** 数组众数（按四舍五入到 2 位小数聚合）；空返回 undefined */
function modeNum(values: (number | null | undefined)[]): number | undefined {
  const freq = new Map<string, number>()
  const val = new Map<string, number>()
  let best: string | undefined
  let n = 0
  for (const v0 of values) {
    if (v0 === null || v0 === undefined || !Number.isFinite(v0)) continue
    const v = Math.round(v0 * 100) / 100
    const k = String(v)
    freq.set(k, (freq.get(k) ?? 0) + 1)
    val.set(k, v)
    if ((freq.get(k) ?? 0) > n) {
      n = freq.get(k) as number
      best = k
    }
  }
  return best !== undefined ? val.get(best) : undefined
}

/** 字符串众数；空返回 undefined */
function modeStr(values: string[]): string | undefined {
  const freq = new Map<string, number>()
  let best: string | undefined
  let n = 0
  for (const v of values) {
    freq.set(v, (freq.get(v) ?? 0) + 1)
    if ((freq.get(v) as number) > n) {
      n = freq.get(v) as number
      best = v
    }
  }
  return best
}

// ---------- 数值单位折算 ----------

/** 严格 px 值（"16px"/"16.5px"）；% 与无单位返回 null */
function pxValue(v: string | undefined): number | null {
  if (!v) return null
  const m = /^\s*(\d+(?:\.\d+)?)px\s*$/i.exec(v)
  return m ? parseFloat(m[1]) : null
}

/** 数值区间夹取 */
function clampN(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** px 值夹取（非法/越界返回 null） */
function clampPx(v: string | undefined, lo: number, hi: number): number | null {
  const px = pxValue(v)
  return px !== null ? clampN(px, lo, hi) : null
}

/** 行高 → 倍率：无单位直取；px 按字号折算；% /100。区间 [1.2, 3] 外返回 null（回落默认） */
function lineHeightRatio(v: string | undefined, fontSizePx: number): number | null {
  if (!v) return null
  const s = v.trim()
  const unitless = /^(\d+(?:\.\d+)?)$/.exec(s)
  if (unitless) {
    const n = parseFloat(unitless[1])
    return n >= 1.2 && n <= 3 ? n : null
  }
  const px = pxValue(s)
  if (px !== null) {
    const r = px / (fontSizePx || 16)
    return r >= 1.2 && r <= 3 ? r : null
  }
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(s)
  if (pct) {
    const r = parseFloat(pct[1]) / 100
    return r >= 1.2 && r <= 3 ? r : null
  }
  return null
}

/** 字距 → em：em 直取；px 按字号折算（16 兜底）。区间 [0, 0.2em] 外返回 null */
function letterSpacingEm(v: string | undefined, fontSizePx: number): number | null {
  if (!v) return null
  const s = v.trim()
  const em = /^(-?\d+(?:\.\d+)?)em$/i.exec(s)
  if (em) {
    const n = parseFloat(em[1])
    return n >= 0 && n <= 0.2 ? n : null
  }
  const px = pxValue(s)
  if (px !== null) {
    const n = px / (fontSizePx || 16)
    return n >= 0 && n <= 0.2 ? n : null
  }
  return null
}

/** 段距（margin 垂直边距）：取上/下边距较大者（微信常用 margin:0 0 24px 底边距撑段距）；
 *  1-4 值写法按标准语义取 top 与 bottom；em ×16。区间 [4,48] 外 null */
function gapFromMargin(v: string | undefined): number | null {
  if (!v) return null
  const parts = v.trim().split(/\s+/)
  const conv = (tok: string): number | null => {
    const px = pxValue(tok)
    if (px !== null) return px
    const em = /^(\d+(?:\.\d+)?)em$/i.exec(tok)
    return em ? parseFloat(em[1]) * 16 : null
  }
  const top = conv(parts[0] ?? '')
  const bottom = conv(parts.length >= 3 ? parts[2] : (parts[0] ?? ''))
  const n = Math.max(top ?? -1, bottom ?? -1)
  return n >= 4 && n <= 48 ? Math.round(n) : null
}

/** 元素样式收集（含标签名与开标签位置，供多轮统计与包裹覆盖率计算） */
interface ElementStyles {
  tag: string
  style: Record<string, string>
  index: number
}

/** 扫描所有开标签的 style 属性（公众号 HTML 样式全内联，无需 DOM 配对；兼容单双引号） */
function collect(html: string): ElementStyles[] {
  const out: ElementStyles[] = []
  const re = /<([a-z0-9]+)((?:\s[^<>]*?)?)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    out.push({ tag: m[1].toLowerCase(), style: styleOfAttrs(m[2] ?? ''), index: m.index })
  }
  return out
}

/** 开标签的配对闭标签结束位置（游走；void 元素与自闭合不计深度；找不到返回 -1） */
function pairEnd(html: string, openIndex: number): number {
  const re = /<\/?([a-z][a-z0-9-]*)((?:\s[^<>]*?)?)\/?>/gi
  re.lastIndex = openIndex
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (/^<\//.test(m[0])) {
      depth--
      if (depth === 0) return m.index + m[0].length
    } else if (!/\/>$/.test(m[0]) && !VOID_TAGS.has(m[1].toLowerCase())) {
      depth++
    }
  }
  return -1
}

/** 开标签元素的包裹覆盖率（用于区分「整页背景卡」大覆盖与「装饰色块/引用淡底」小覆盖） */
function coverageOf(html: string, openIndex: number): number {
  const end = pairEnd(html, openIndex)
  return end > 0 ? (end - openIndex) / html.length : 0
}

/** 彩色块（非白实心/渐变）与引用块的区间集合：落在区间内的 p 是「卡内/引用文字」，
 *  不参与页面正文的颜色与字号统计——灰阶设计文的卡内浅灰字曾整篇顶掉真实正文色。
 *  覆盖过半的块视为整页背景卡，其内容就是页面正文，不排除 */
function contextSpans(html: string, els: ElementStyles[]): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const e of els) {
    if (!['section', 'div', 'blockquote'].includes(e.tag)) continue
    if (e.tag !== 'blockquote') {
      const v = e.style['background'] || e.style['background-color']
      if (!v) continue
      const hex = singleBgColor(v) ?? gradientFirstColor(v)
      if (!hex || isWhiteish(hex)) continue
    }
    const end = pairEnd(html, e.index)
    if (end > 0 && (end - e.index) / html.length < 0.5) spans.push([e.index, end])
  }
  return spans
}

/** 成对标签块（h1/h2/blockquote/strong 等）：开标签样式 + 内部首个 span 样式 + 开头内容 */
interface TagBlock {
  own: Record<string, string>
  innerSpan: Record<string, string>
  head: string
}

/** 提取所有 <tag…>…</tag> 块（h2/strong 的色块常落在内部首个 span 上，需要配对内容才能取到）。
 * 标签名后必须紧跟空白或 >（<b(\s|>)），防止 <b> 误匹配 <br>/<blockquote> */
function taggedBlocks(html: string, tag: string): TagBlock[] {
  const out: TagBlock[] = []
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const inner = m[2] ?? ''
    const sm = /<span[^>]*>/i.exec(inner)
    out.push({ own: styleOfAttrs(m[1] ?? ''), innerSpan: sm ? styleOfAttrs(sm[0]) : {}, head: inner.slice(0, 60) })
  }
  return out
}

/** 渐变背景取首色（linear-gradient(135deg, rgb(a,b,c), ...) → 首个颜色）：
 *  渐变标题卡/高亮条按首色近似复刻为纯色色块 */
function gradientFirstColor(v: string | undefined): string | null {
  if (!v || !/gradient/i.test(v)) return null
  return toHex(v)
}

/** 块的有效背景色（自身或内部首个 span；实心单一背景或渐变首色） */
function blockBg(b: TagBlock): string | null {
  return (
    singleBgColor(b.own['background'] ?? b.own['background-color']) ??
    gradientFirstColor(b.own['background'] ?? b.own['background-color']) ??
    singleBgColor(b.innerSpan['background'] ?? b.innerSpan['background-color']) ??
    gradientFirstColor(b.innerSpan['background'] ?? b.innerSpan['background-color'])
  )
}

/** 判断字体族气质（fangsong 全词匹配：裸 fang 会把苹方 PingFang 误判成衬线） */
function fontKind(family: string): string {
  const f = family.toLowerCase()
  if (/(song|serif|宋|明|kai|楷|fangsong|仿宋)/.test(f)) return 'serif'
  if (/(mono|consol|courier|code)/.test(f)) return 'mono'
  return 'sans'
}

/**
 * 标题排列（h1/h2 全体投票）：flex 的 justify-content 优先（微信居中标题常
 * display:flex + justify-content:center，text-align 是默认 left 不能只信它），
 * 其次 text-align 显式值；无任何显式值回落居中。
 */
function alignOf(blocks: TagBlock[]): ArticleTheme['headingAlign'] {
  let center = 0
  let left = 0
  for (const b of blocks) {
    const s = b.own
    if (/center/.test(s['justify-content'] ?? '') || /center/.test(s['text-align'] ?? '')) center++
    else if ((s['text-align'] ?? '').startsWith('left')) left++
  }
  if (center === 0 && left === 0) return 'center'
  return center >= left ? 'center' : 'left'
}

/** h3 前缀标记：内容首字符是 ● 系圆点 → dot；◆■ 系几何符 → diamond；全无 → none；无 h3 → 不设 */
function h3MarkOf(html: string): ArticleTheme['h3Mark'] | undefined {
  const blocks = taggedBlocks(html, 'h3')
  if (blocks.length === 0) return undefined
  let dot = 0
  let diamond = 0
  for (const b of blocks) {
    const text = b.head.replace(/<[^>]+>/g, '').trim()
    const ch = text[0] ?? ''
    if (/[●•‧·∙]/.test(ch)) dot++
    else if (/[◆◇■□▪▫]/.test(ch)) diamond++
  }
  if (dot > 0 && dot >= diamond) return 'dot'
  if (diamond > 0) return 'diamond'
  return 'none'
}

/** 中文序号（一~九十九）转数字；不认识的返回 null */
function cnOrdinal(s: string, upper: boolean): number | null {
  const map: Record<string, number> = upper
    ? { 壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9 }
    : { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const ten = upper ? '拾' : '十'
  if (s === ten) return 10
  if (s.length === 1) return map[s] ?? null
  if (s[0] === ten) return 10 + (map[s[1]] ?? NaN)
  const i = s.indexOf(ten)
  if (i > 0) return (map[s[0]] ?? NaN) * 10 + (s.length > i + 1 ? map[s[i + 1]] ?? 0 : 0)
  return null
}

/**
 * 小节标题序号范式检测：文本段以「01 」「1.」「1、」「一、」「壹、」开头。
 * 要求同一种类从 1 开始、文档序严格递增且 ≥2 个——正文里的普通列表「3、4、5」
 * （不从 1 开始）和零散「12 个技巧」不会误判成标题序号。
 */
function detectH2Num(html: string): ArticleTheme['h2Num'] {
  const KINDS = ['01', '1.', '1、', '一、', '壹、'] as const
  type Kind = (typeof KINDS)[number]
  const hits: { kind: Kind; n: number }[] = []
  for (const m of html.matchAll(/>([^<]{1,40})</g)) {
    const s = m[1].trim()
    let km: RegExpExecArray | null
    if ((km = /^(\d{2})\s+\S/.exec(s))) hits.push({ kind: '01', n: Number(km[1]) })
    else if ((km = /^([1-9]\d?)\s*、/.exec(s))) hits.push({ kind: '1、', n: Number(km[1]) })
    else if ((km = /^([1-9]\d?)[.．]\s*\S/.exec(s))) hits.push({ kind: '1.', n: Number(km[1]) })
    else if ((km = /^([一二三四五六七八九十]{1,3})、/.exec(s))) {
      const n = cnOrdinal(km[1], false)
      if (n !== null) hits.push({ kind: '一、', n })
    } else if ((km = /^([壹贰叁肆伍陆柒捌玖拾]{1,3})、/.exec(s))) {
      const n = cnOrdinal(km[1], true)
      if (n !== null) hits.push({ kind: '壹、', n })
    }
  }
  let best: { kind: Kind; run: number } | null = null
  for (const kind of KINDS) {
    const seq = hits.filter((h) => h.kind === kind)
    if (seq.length < 2) continue
    // 从 1 开始逐个核对（文档序）；被正文里的「12 个技巧」之类打断也保留前缀有效长度
    let expect = 1
    for (const h of seq) {
      if (h.n !== expect) break
      expect++
    }
    const run = expect - 1
    if (run >= 2 && (!best || run > best.run)) best = { kind, run }
  }
  return best?.kind
}

/** 虚线/点线边框文本卡（微信设计稿提示卡范式：1px dashed 彩色描边 + 圆角 + 内边距的
 *  小体积文本卡）。返回边框色；不是该范式返回 null */
function dashedCardOf(html: string, els: ElementStyles[]): string | null {
  for (const e of els) {
    if (!['section', 'div', 'blockquote'].includes(e.tag)) continue
    const v =
      e.style['border'] ?? e.style['border-top'] ?? e.style['border-bottom'] ??
      e.style['border-left'] ?? e.style['border-right']
    if (!v || !/dashed|dotted/i.test(v)) continue
    const hex = toHex(v)
    if (!hex) continue
    if (!e.style['border-radius'] || !e.style['padding']) continue
    const end = pairEnd(html, e.index)
    if (end < 0 || (end - e.index) / html.length >= 0.7) continue
    return hex
  }
  return null
}

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

  // 建议名：<title> 或首个 h1，去掉常见站名后缀
  let name = ''
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
  if (titleMatch) name = titleMatch[1].trim()
  if (!name) {
    const h1m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
    if (h1m) name = h1m[1].replace(/<[^>]+>/g, '').trim()
  }
  name = (name || '导入排版').replace(/\s*[|｜\-–—]\s*(公众号|微信公众号|微信|腾讯新闻)\s*$/, '').slice(0, 16)

  // ---- 背景卡片：section > body > div 优先级取最早的非白实心背景（html 排除：页面底色 ≠
  //      卡片色，常是夜间模式底），且元素须包裹 ≥35% 正文——装饰色块/引用淡底覆盖小，不算卡片；
  //      顺带取该元素的圆角与内边距 ----
  let bodyBg: string | undefined
  let bgEl: ElementStyles | undefined
  for (const tags of [['section'], ['body'], ['div']]) {
    for (const e of els) {
      if (!tags.includes(e.tag)) continue
      const v = e.style['background'] || e.style['background-color']
      if (!v || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(v)) continue
      const hex = singleBgColor(v)
      if (hex && !isWhiteish(hex) && coverageOf(html, e.index) >= 0.35) {
        bodyBg = hex
        bgEl = e
        break
      }
    }
    if (bodyBg) break
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
  const accent = topColor(accentFreq) ?? DEFAULT_THEME.accent

  // ---- 标题文字色：优先 h1/h2/h3 的 color；无标题标签的文章（微信编辑器常把小节做成
  //      section[font-size≥18px] + 品牌色 的大字块）回退「大字号元素」的颜色众数 ----
  let headingColor = topColor(
    tallyColors(els, ['h1', 'h2', 'h3'], COLOR_KEYS, { skipNeutral: true })
  )
  const bigHeadingEls = els.filter((e) => (pxValue(e.style['font-size']) ?? 0) >= 18)
  if (!headingColor) {
    const freq = new Map<string, number>()
    for (const e of bigHeadingEls) {
      const hex = toHex(e.style['color'] ?? '')
      if (!hex || isWhiteish(hex) || isNeutral(hex)) continue
      freq.set(hex, (freq.get(hex) ?? 0) + 1)
    }
    headingColor = topColor(freq)
  }

  // ---- 加粗强调色（strong/b 的 color；缺省=accent） ----
  const strongColor = topColor(tallyColors(els, ['strong', 'b'], COLOR_KEYS, { skipNeutral: true }))

  // ---- 正文色：只统计「页面级」p（不在彩色块/引用块内的）——灰阶设计文里渐变卡上的
  //      浅灰字是卡内文字不能当正文色；浅底只认深色，深底卡保持浅色。
  //      无 p 色时取 span 的中性灰后备（彩色 span 多是品牌强调字） ----
  const ctxSpans = contextSpans(html, els)
  const inCtx = (i: number): boolean => ctxSpans.some(([a, b]) => i > a && i < b)
  const pagePs = els.filter((e) => e.tag === 'p' && !inCtx(e.index))
  const bodyText =
    topColor(tallyColors(pagePs, ['p'], COLOR_KEYS, { maxLum: dark ? 0.92 : 0.5 })) ??
    topColor(tallyColors(els, ['p'], COLOR_KEYS, { maxLum: 0.92 })) ??
    topColor(tallyColors(els, ['span'], COLOR_KEYS, { onlyNeutral: true, maxLum: 0.6 }))
  // 深浅搭配校验：浅底必须深字、深底必须浅字。原文跨元素误配的常见坑——
  // 浅色卡片 + 深色卡片上的浅灰字（如 #fff0f0 底配 #cbd5e1 字，浅底浅字看不清）。
  // 提取的正文色与背景亮度不匹配时按背景回退（深底 #cbd5e1 / 浅底 #333）。
  const bodyTextOk =
    !!bodyText &&
    bodyText !== '#ffffff' &&
    (dark ? luminance(bodyText) >= 0.45 : luminance(bodyText) < 0.55)

  // ---- 标题装饰（同类块形态众数投票，防装饰性首元素污染） ----
  const h1Blocks = taggedBlocks(html, 'h1')
  const h2Blocks = taggedBlocks(html, 'h2')
  const h1Style: ArticleTheme['h1Style'] =
    (modeStr(
      h1Blocks.map((b) => {
        const bg = blockBg(b)
        return bg && !isWhiteish(bg) ? 'pill' : b.own['border-bottom'] ? 'underline' : 'bar'
      })
    ) as ArticleTheme['h1Style']) ?? 'bar'
  // h2 色块：自身或内部首个 span 的单一背景都算（渐变取首色近似复刻为纯色块）；
  // 无 h2 标签的文章（微信大字块/渐变标题卡范式）由大字号元素参与形态投票；
  // 色块颜色取该形态下最常见的
  // 渐变/彩色标题卡：卡自身不带字号、大字在内部（微信渐变 hero 卡范式）——
  // 区间内含 ≥18px 元素的彩色块按「色块小节」投票（渐变取首色近似复刻）；
  // 卡内的大字由卡代表，不再单独投 plain 票（否则平票互相抵消）
  const cardSpans: Array<{ start: number; end: number; bg: string }> = []
  for (const e of els) {
    if (!['section', 'div'].includes(e.tag)) continue
    const v = e.style['background'] || e.style['background-color']
    if (!v) continue
    const hex = singleBgColor(v) ?? gradientFirstColor(v)
    if (!hex || isWhiteish(hex)) continue
    const end = pairEnd(html, e.index)
    if (end < 0 || (end - e.index) / html.length >= 0.5) continue
    if (bigHeadingEls.some((b) => b.index > e.index && b.index < end)) {
      cardSpans.push({ start: e.index, end, bg: v })
    }
  }
  const inCardSpan = (i: number): boolean => cardSpans.some((c) => i > c.start && i < c.end)
  const h2Like: TagBlock[] = [
    ...h2Blocks,
    ...bigHeadingEls
      .filter((e) => !['h1', 'h2', 'h3'].includes(e.tag) && !inCardSpan(e.index))
      .map((e) => ({ own: e.style, innerSpan: {}, head: '' })),
    ...cardSpans.map((c) => ({ own: { background: c.bg }, innerSpan: {}, head: '' }))
  ]
  const h2Kinds = h2Like.map((b) => {
    const bg = blockBg(b)
    if (bg && !isWhiteish(bg)) return 'block'
    if (b.own['border-bottom']) return 'underline'
    if (b.own['border-left']) return 'leftbar'
    return 'plain'
  })
  const h2Style = (modeStr(h2Kinds) as ArticleTheme['h2Style']) ?? 'plain'
  const h2Bg = topColor(
    (() => {
      const freq = new Map<string, number>()
      h2Like.forEach((b, i) => {
        if (h2Kinds[i] !== 'block') return
        const bg = blockBg(b)
        if (bg) freq.set(bg, (freq.get(bg) ?? 0) + 1)
      })
      return freq
    })()
  )

  // ---- 引用形态：blockquote 众数投票（quotes/leftbar/card）；语义引用优先。
  //      无 blockquote 或泛化 card 时，存在「虚线边框文本卡」（设计稿提示卡范式）→ dashcard ----
  const bqVote = modeStr(
    taggedBlocks(html, 'blockquote').map((b) => {
      if (!b.own['border-left']) return 'card'
      return /^[❝“"「『]/.test(b.head.replace(/<[^>]+>/g, '').trim()) ? 'quotes' : 'leftbar'
    })
  ) as ArticleTheme['quoteStyle'] | undefined
  const dashedCard = dashedCardOf(html, els)
  const quoteStyle: ArticleTheme['quoteStyle'] =
    dashedCard && (!bqVote || bqVote === 'card') ? 'dashcard' : (bqVote ?? 'card')

  // ---- 分隔线（众数投票；hr 是自闭合标签走元素扫描） ----
  const hrStyle =
    (modeStr(
      els
        .filter((e) => e.tag === 'hr')
        .map((e) => {
          const s = e.style
          if (/dotted|dashed/.test(s['border-top'] ?? '')) return 'dot'
          if (/width\s*:\s*100%/.test(s['width'] ?? '')) return 'long'
          return 'line'
        })
    ) as ArticleTheme['hrStyle']) ?? 'line'

  // ---- 加粗：自身或内部首个 span 的「单一背景色」才算 highlight（微信多图层复合值不算） ----
  const strongBlocks = [...taggedBlocks(html, 'strong'), ...taggedBlocks(html, 'b')]
  const strongKinds = strongBlocks.map((b) => (blockBg(b) ? 'highlight' : 'color'))
  const strongStyle = (modeStr(strongKinds) as ArticleTheme['strongStyle']) ?? 'color'
  const strongBg = topColor(
    (() => {
      const freq = new Map<string, number>()
      strongBlocks.forEach((b, i) => {
        if (strongKinds[i] !== 'highlight') return
        const bg = blockBg(b)
        if (bg) freq.set(bg, (freq.get(bg) ?? 0) + 1)
      })
      return freq
    })()
  )

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

  // ---- 数值（页面级 p 众数，单位折算 + 区间夹取） ----
  const pStyles = pagePs.map((e) => e.style)
  // 正文字号：图注/小字说明常与正文不同色，优先取「与正文色同色」的 p 的字号众数
  const bodyColorPs = bodyText ? pagePs.filter((e) => toHex(e.style['color'] ?? '') === bodyText) : []
  const sizePool = bodyColorPs.length >= 3 ? bodyColorPs : pagePs
  const fontSize = modeNum(sizePool.map((e) => clampPx(e.style['font-size'], 12, 22)))
  const fsBase = fontSize ?? 16
  const lineHeight = modeNum(pStyles.map((s) => lineHeightRatio(s['line-height'], pxValue(s['font-size']) ?? fsBase)))
  const lsEm = modeNum(pStyles.map((s) => letterSpacingEm(s['letter-spacing'], pxValue(s['font-size']) ?? fsBase)))
  const pGap = modeNum(pStyles.map((s) => gapFromMargin(s['margin'])))
  // 标题字号：h2 标签字号众数，无则用大字号标题块（section 大字范式）的字号众数
  const headingFontSize = modeNum([
    ...h2Blocks.map((b) => clampPx(b.own['font-size'], 16, 34)),
    ...bigHeadingEls.map((e) => clampPx(e.style['font-size'], 16, 34))
  ])
  const imgRadius = modeNum(
    els.filter((e) => e.tag === 'img').map((e) => clampPx(e.style['border-radius'], 0, 40))
  )

  // ---- 卡片圆角/内边距（取提供背景卡的元素自身；缺省回落历史默认值） ----
  const bodyRadius = clampPx(bgEl?.style['border-radius'], 0, 30) ?? 14
  const rawPadding = bgEl?.style['padding']
  const bodyPadding =
    rawPadding && /^[\d.]+(px|em|%)(\s+[\d.]+(px|em|%)){0,3}$/.test(rawPadding.trim())
      ? rawPadding.trim()
      : '16px 18px'

  // 字体族只看结构级标签（p/section/div 等）：装饰 span 的字体不能带偏整篇判定
  const STRUCT_TAGS = ['p', 'section', 'div', 'body', 'blockquote', 'td', 'li']
  const family =
    els.find((e) => STRUCT_TAGS.includes(e.tag) && e.style['font-family'])?.style['font-family'] ?? 'sans'
  const kind = fontKind(family)
  const h3Mark = h3MarkOf(html)
  const h2Num = detectH2Num(html)
  const theme: ArticleTheme = {
    accent,
    fontFamily: kind === 'serif' ? SERIF : kind === 'mono' ? MONO : SANS,
    lineHeight: lineHeight ?? DEFAULT_THEME.lineHeight,
    letterSpacing: lsEm !== undefined ? `${lsEm}em` : DEFAULT_THEME.letterSpacing,
    headingAlign: alignOf([...h1Blocks, ...h2Blocks]),
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(headingFontSize !== undefined ? { headingFontSize } : {}),
    ...(bodyBg
      ? {
          bodyBg,
          bodyText: bodyTextOk ? bodyText : dark ? '#cbd5e1' : '#333',
          bodyRadius,
          bodyPadding
        }
      : bodyTextOk
        ? { bodyText }
        : {}),
    ...(headingColor ? { headingColor } : {}),
    h1Style,
    h2Style,
    ...(h2Bg ? { h2Bg } : {}),
    ...(h2Num ? { h2Num } : {}),
    ...(h3Mark ? { h3Mark } : {}),
    quoteStyle,
    ...(dashedCard ? { quoteBorder: dashedCard } : {}),
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
    `大标题 ${h1Style} / 小节 ${h2Style}${h2Bg ? `（底 ${h2Bg}）` : ''}${h2Num ? `，序号「${h2Num}」` : ''}`,
    `引用 ${quoteStyle}${dashedCard ? `（边 ${dashedCard}）` : ''} / 分隔线 ${hrStyle}`,
    `加粗 ${strongStyle}${strongBg ? `（底 ${strongBg}）` : ''}`,
    hasTable ? `表格 ${tableStyle}${thBg ? `（表头 ${thBg}）` : ''}` : '',
    `正文 ${fontSize ?? 16}px · 行高 ${lineHeight ?? DEFAULT_THEME.lineHeight}`
  ].filter(Boolean)

  return { name, theme, summary }
}
