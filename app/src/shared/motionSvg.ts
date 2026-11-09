/**
 * 公众号动效（SVG/SMIL 无脚本片段）格式核心：校验 → 调色板令牌 → 热区 ID 命名空间 → 根画布组装。
 *
 * 格式边界（源自微信正文实测社区格式，2026-11-08 调研）：
 * - 公众号正文只认「无脚本 SVG + SMIL」：点击触发 begin="id.click"、显隐 set visibility、
 *   属性动画 animate / animateTransform、自动循环 repeatCount="indefinite"。
 * - 滚动吸附 / 长按拖动等网页手势在正文里不成立，本格式不覆盖。
 * - 画布宽 480 视框、width:100% 等比缩放；传 height 时根画布固定高（无 viewBox），
 *   body 里 attributeName="height" 的 animate 直接作用根画布，后文被真实推低。
 * - 安全模型是 fail-closed 白名单扫描：任何解析不了的标签/属性/实体一律判非法，
 *   调用方降级为 still 静态文字，绝不把不可信片段送进导出物。
 * - 主进程与渲染层共用（导出在 main、编辑器预览在 renderer），只用字符串扫描，不碰 DOMParser。
 */

/** 主题调色板令牌：body 里写 {{accent}} / {{ink}} / {{bg}} / {{muted}}，渲染时按当前主题解析 */
export interface MotionPalette {
  accent: string
  ink: string
  bg: string
  muted: string
  /** 根画布字体栈（调用方先把双引号换单引号，防截断 style 属性） */
  fontFamily: string
}

export interface MotionSvgOptions {
  /** 热区 ID 前缀（字母数字）：同一篇文章多个动效块各拿一个，导出按块序号分配 */
  idPrefix: string
  palette: MotionPalette
}

const TAGS = new Set([
  'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'use', 'svg',
  'animate', 'set', 'animateTransform', 'title', 'desc'
])

const ATTRS = new Set([
  'id', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'opacity',
  'visibility', 'display', 'transform', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy',
  'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'viewBox', 'overflow',
  'preserveAspectRatio', 'font-size', 'font-family', 'font-weight', 'text-anchor',
  'dominant-baseline', 'letter-spacing', 'fill-rule', 'clip-rule', 'clip-path',
  'pathLength', 'pointer-events', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'fx', 'fy', 'spreadMethod', 'href', 'xlink:href',
  'dx', 'dy', 'attributeName', 'from', 'to', 'by', 'values', 'keyTimes', 'keySplines',
  'calcMode', 'begin', 'end', 'dur', 'repeatCount', 'repeatDur', 'restart',
  'additive', 'accumulate', 'type'
])

/** 标签整体形态：名字 + 若干带引号属性 + 可选自闭合；匹配不上的「<」按 stray 拒掉 */
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
const ATTR_RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const ID_RE = /^[A-Za-z][\w-]*$/
const VIEWBOX_RE = /^\s*-?[\d.]+\s+-?[\d.]+\s+[\d.]+\s+[\d.]+\s*$/
const ENTITY_RE = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/
const TOKEN_RE = /\{\{(accent|ink|bg|muted)\}\}/g

export interface MotionScan {
  ids: string[]
  error: string | null
}

/** 白名单扫描：标签/属性/实体/引用全过才放行；收集全部热区 ID 供命名空间改写 */
export function scanMotion(body: string): MotionScan {
  const fail = (error: string): MotionScan => ({ ids: [], error })
  if (!body.trim()) return fail('动效 body 为空')
  if (body.includes('-->') || body.includes('<!--')) return fail('body 不允许注释（会破坏 markdown 注释块）')
  if (body.includes(']]>')) return fail('body 不允许 CDATA 结束符')
  if (/\{\{/.test(body)) return fail('未知调色板令牌（只支持 {{accent}}/{{ink}}/{{bg}}/{{muted}}）')

  const ids: string[] = []
  const refs = new Set<string>()
  const stack: string[] = []
  let cursor = 0

  const checkValue = (name: string, value: string): string | null => {
    if (/javascript:/i.test(value) || /data:/i.test(value)) return `属性 ${name} 含禁用协议`
    if (ENTITY_RE.test(value)) return `属性 ${name} 含未转义 &`
    if (name === 'href' || name === 'xlink:href') {
      if (!value.startsWith('#')) return 'href 只允许片段内引用（#id）'
      refs.add(value.slice(1))
    }
    const urls = value.match(/url\([^)]*\)/g)
    if (urls) {
      for (const u of urls) {
        const m = /^url\(\s*['"]?#([\w-]+)['"]?\s*\)$/.exec(u)
        if (!m) return `url() 只允许片段内引用：${u}`
        refs.add(m[1])
      }
    }
    if (name === 'begin' || name === 'end') {
      // 事件引用：id.click / id.click+0.3s / 分号分隔多事件；纯时间值（0s、indefinite）不产生引用
      for (const m of value.matchAll(/([A-Za-z][\w-]*)\.[a-zA-Z]+/g)) refs.add(m[1])
    }
    return null
  }

  for (const m of body.matchAll(TAG_RE)) {
    const gap = body.slice(cursor, m.index)
    if (gap.includes('<')) return fail('存在无法解析的标签（属性必须带引号）')
    if (ENTITY_RE.test(gap)) return fail('文本含未转义 &')
    cursor = m.index + m[0].length

    const [, closing, name, rawAttrs, selfClose] = m
    if (!TAGS.has(name)) return fail(`禁用标签：<${name}>`)
    if (closing) {
      if (selfClose) return fail(`闭合标签不能自闭合：</${name}>`)
      if (stack.pop() !== name) return fail(`标签不配对：</${name}>`)
      continue
    }
    const seen = new Set<string>()
    for (const a of rawAttrs.matchAll(ATTR_RE)) {
      const attr = a[1]
      const value = a[2] ?? a[3] ?? ''
      if (!ATTRS.has(attr)) return fail(`禁用属性：${attr}`)
      if (seen.has(attr)) return fail(`属性重复：${attr}`)
      seen.add(attr)
      if (value.includes('<')) return fail(`属性 ${attr} 含未转义 <`)
      const err = checkValue(attr, value)
      if (err) return fail(err)
      if (attr === 'id') {
        if (!ID_RE.test(value)) return fail(`非法 id：${value}`)
        if (ids.includes(value)) return fail(`id 重复：${value}`)
        ids.push(value)
      }
    }
    if (rawAttrs.replace(/([\w:-]+)\s*=\s*(?:"[^"]*"|'[^']*')/g, '').trim()) return fail(`<${name}> 属性区有无法解析的内容`)
    if (!selfClose) stack.push(name)
  }
  const tail = body.slice(cursor)
  if (tail.includes('<')) return fail('存在无法解析的标签')
  if (ENTITY_RE.test(tail)) return fail('文本含未转义 &')
  if (stack.length) return fail(`标签未闭合：<${stack[stack.length - 1]}>`)
  for (const r of refs) {
    if (!ids.includes(r)) return fail(`引用了不存在的 id：${r}`)
  }
  return { ids, error: null }
}

/** 热区 ID 命名空间改写：id、begin/end 事件引用、url(#id)、href="#id" 同步加前缀（须先过 scanMotion） */
export function namespaceMotionIds(body: string, prefix: string, ids: string[]): string {
  if (!ids.length) return body
  const idSet = new Set(ids)
  return body.replace(TAG_RE, (whole, closing: string, name: string, rawAttrs: string, selfClose: string) => {
    if (closing) return whole
    const attrs = rawAttrs.replace(ATTR_RE, (awhole, attr: string, dq: string | undefined, sq: string | undefined) => {
      const value = dq ?? sq ?? ''
      let next = value
      if (attr === 'id' && idSet.has(value)) next = prefix + value
      else if (attr === 'begin' || attr === 'end') {
        next = value.replace(/([A-Za-z][\w-]*)\.[a-zA-Z]+/g, (ev, id: string) => (idSet.has(id) ? prefix + ev : ev))
      } else if (attr === 'href' || attr === 'xlink:href') {
        if (value.startsWith('#') && idSet.has(value.slice(1))) next = '#' + prefix + value.slice(1)
      } else {
        next = value.replace(/url\(\s*['"]?#([\w-]+)['"]?\s*\)/g, (u, id: string) => (idSet.has(id) ? u.replace('#' + id, '#' + prefix + id) : u))
      }
      if (next === value) return awhole
      const q = dq !== undefined ? '"' : "'"
      return `${attr}=${q}${next}${q}`
    })
    return `<${name}${attrs}${selfClose ? '/' : ''}>`
  })
}

/** 动效块属性（markdown.ts MotionNode.attrs 的结构化约束在此单点定义） */
export interface MotionShape {
  body: string
  viewBox?: string
  still: string
  caption?: string
  /** 固定高画布（无 viewBox）：body 可放 attributeName="height" 的 animate 真实推低后文 */
  height?: number
}

/** 校验 markdown 解析出的原始 JSON 是否构成合法动效块；非法返回 null（调用方按段落保留原文）。
 *  可选字段容忍 null：tiptap getJSON 会把未设的可选 attr 输出为 null */
export function parseMotionAttrs(raw: unknown): { body: string; viewBox: string; still: string; caption: string; height?: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.body !== 'string' || typeof o.still !== 'string') return null
  if (o.caption != null && typeof o.caption !== 'string') return null
  if (o.viewBox != null && (typeof o.viewBox !== 'string' || !VIEWBOX_RE.test(o.viewBox))) return null
  if (o.height != null && (typeof o.height !== 'number' || !isFinite(o.height) || o.height <= 0 || o.height > 4000)) return null
  return {
    body: o.body,
    still: o.still,
    caption: o.caption ?? '',
    viewBox: o.viewBox ?? '0 0 480 190',
    ...(o.height != null ? { height: o.height } : {})
  }
}

/** 调色板令牌替换（{{accent}}/{{ink}}/{{bg}}/{{muted}}）；未知令牌留给 scanMotion 报错 */
export function substituteMotionTokens(body: string, palette: MotionPalette): string {
  return body.replace(TOKEN_RE, (_, key: string) => palette[key as keyof Omit<MotionPalette, 'fontFamily'>])
}

/**
 * 动效块 → 公众号可粘贴 SVG 片段。非法 body 返回 null（调用方降级为 still 静态文字）。
 * 根画布壳在此单点组装：width:100% 等比缩放、overflow:hidden、主题底色与字体栈。
 */
export function motionToSvg(attrs: MotionShape, opts: MotionSvgOptions): string | null {
  const p = opts.palette
  const body = substituteMotionTokens(attrs.body, p)
  const { ids, error } = scanMotion(body)
  if (error) return null
  if (!/^[A-Za-z0-9]+$/.test(opts.idPrefix)) return null
  // 几何字段二次校验（防注入）：编辑器粘贴/手改 attrs 可能绕过 parseMotionAttrs，
  // viewBox/height 直接拼进根 svg 属性，含引号/标签即判非法降级
  const viewBox = attrs.viewBox ?? '0 0 480 190'
  if (typeof viewBox !== 'string' || !VIEWBOX_RE.test(viewBox)) return null
  if (attrs.height !== undefined && (typeof attrs.height !== 'number' || !isFinite(attrs.height) || attrs.height <= 0 || attrs.height > 4000)) return null
  const inner = namespaceMotionIds(body, opts.idPrefix, ids)
  const fam = p.fontFamily.replace(/"/g, "'")
  const style = `display:block;width:100%;height:auto;overflow:hidden;background:${p.bg};font-family:${fam};`
  const geometry =
    attrs.height !== undefined
      ? `width="100%" height="${attrs.height}"`
      : `width="100%" viewBox="${viewBox}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" ${geometry} style="${style}">${inner}</svg>`
}