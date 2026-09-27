/**
 * 多平台分发适配（M11）：同一篇 article 按目标平台编辑器的粘贴净化规则输出对应形态的富文本
 *
 * 平台画像（画像在本文件单点调优）：
 * - wechat：委托 exportHtml.docToExportHtml（全内联样式 + 背景卡 + 装饰 + 自动序号），本模块不碰
 * - zhihu：语义化 HTML——知乎净化器只留结构（h1-h3/strong/blockquote/table/img），
 *   主动输出零内联样式的干净结构，避免残留垃圾 span/section；加粗强调统一 <strong>
 * - toutiao：语义化 HTML + 两处例外（图注居中、表头包 strong）。依据 2026-09-27 在 mp.toutiao.com 的
 *   26 条探针实测：先由用户在发布页目视判定，再取到**粘贴后的编辑器 DOM 与发布预览 DOM** 逐条核对。
 *   机制不是「过滤 CSS」而是「按计算后样式转成平台 schema 的 mark，CSS 本身丢弃」——
 *   `font-weight:bold` 变成 `<strong>`（探针 21 表头因此保住加粗），`font-style:italic` 无对应 mark 直接消失，
 *   `color` / `background-color` / `font-size` / `line-height` / `margin` / `padding` / `text-indent` / `border`
 *   全部丢弃；段落级 `text-align` 是唯一存活的内联样式。结构上还会被压平：`thead`/`th` → `tbody`/`td`
 *   （粘贴后 th 计数为 0），h1/h2/h3 → 同一个 `<h1 class="pgc-h-forward-slash">`，图片被抽成 `div.pgc-img`。
 *   引用左竖线与表格边框都由平台 CSS 渲染（不给样式的 16/20 与给了内联样式的 17/21 同形，所以
 *   「有竖线/有边框」不等于内联样式生效）。两处例外正是被压平之后仅剩的区分手段
 * - baijiahao：保守内联形态——保留标题/正文颜色、加粗、引用左条、分隔线、图片；去背景卡片、
 *   胶囊色块、圆角拼图等复杂装饰。**尚未实测**，沿用与头条分化前的 v1 画像，等它自己那一轮探针再改
 *
 * 通用规则：
 * - 主题 h2Num 自动序号保留为标题文本（01 / 一、…），手写序号剥除避免双号（与公众号导出同源）。
 *   头条侧这条尤其要紧：三级标题被压平成同一种，文本序号是唯一的层级信号
 * - 手动内联样式：字色/高亮保留（baijiahao）/剥除（zhihu、toutiao）；手动字号一律不给（平台统一正文字号）
 * - 图片走 resolveImg（复制 = dataURL 内嵌，导出文件 = 相对路径）。头条已端到端验证：粘贴时 dataURL 图与
 *   外链图都被转存到平台图床（`image-tt-private.toutiao.com`，`from=image_upload`），发布预览里是
 *   `p*-sign.toutiaoimg.com` 的 CDN 地址 → 不需要 dataURL 降级路径
 * - 图集：逐张竖排（平台不支持横滑容器/拼图），图注挂整组末张之后
 * - fig-suggest 占位卡不导出
 */
import type { ArticleDoc, BlockNode, FigureGalleryAttrs, InlineNode } from './markdown'
import { textStyleAttrs } from './markdown'
import type { ArticleTheme, PlatformId } from './types'
import { isHexColor } from './cards'
import { DEFAULT_THEME } from './categoryThemes'
import { docToExportHtml, SEQ_PREFIX } from './exportHtml'

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  wechat: '公众号',
  zhihu: '知乎',
  toutiao: '头条号',
  baijiahao: '百家号'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 与 exportHtml.toCnNum/h2NumText 同源（彼处未导出；不改动久经考验的公众号链路，此处复制维护） */
function toCnNum(n: number, upper: boolean): string {
  const d = upper
    ? ['', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
    : ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const t = upper ? '拾' : '十'
  if (n < 10) return d[n]
  if (n < 20) return n % 10 ? t + d[n % 10] : t
  return d[Math.floor(n / 10)] + t + (n % 10 ? d[n % 10] : '')
}

function h2NumText(kind: NonNullable<ArticleTheme['h2Num']>, n: number): string {
  switch (kind) {
    case '01':
      return `${String(n).padStart(2, '0')} `
    case '①':
      return n <= 20 ? `${String.fromCodePoint(0x2460 + n - 1)} ` : `${n} `
    case '1.':
      return `${n}. `
    case '1、':
      return `${n}、`
    case '一、':
      return `${toCnNum(n, false)}、`
    case '壹、':
      return `${toCnNum(n, true)}、`
  }
}

/** 纯序号/纯 emoji 的装饰段：编辑器渲染语汇，分发时跳过（与 docxExport.isDecorative 同规则） */
const SEQ_ONLY_RE = /^(?:[一二三四五六七八九十百]{1,4}[、.．]|[壹贰叁肆伍陆柒捌玖拾]{1,4}[、.．]|\d{1,2}[.、．]|[①-⑳])$/
function isDecorative(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.length <= 3 && /^[\d①-⑳]+$/.test(t)) return true // 裸编号段（01 / 3 / ⑫）
  if (SEQ_ONLY_RE.test(t)) return true // 带顿号/点的序号段（一、 / 1. / 壹、）
  const m = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.exec(t)
  return !!m && t.slice(m[0].length).trim().length === 0
}

function plainText(content: InlineNode[] | undefined): string {
  return (content ?? [])
    .map((n) => (n.type === 'text' ? n.text : ' '))
    .join('')
    .trim()
}

/** 标题手写序号剥除（与 docToExportHtml 同规则：纯文本标题才剥，避免误伤带样式内容） */
function stripSeq(content: InlineNode[] | undefined): InlineNode[] | undefined {
  if (!content?.length || !content.every((n) => n.type === 'text')) return content
  const first = content[0]
  if (first.type !== 'text') return content
  const m = SEQ_PREFIX.exec(first.text ?? '')
  if (!m) return content
  return content.map((n, i) => (i === 0 && n.type === 'text' ? { ...n, text: (n.text ?? '').slice(m[0].length) } : n))
}

// ---------- 语义化画像（知乎 / 头条号）：除对齐外零内联样式 ----------

interface SemanticOpts {
  /** 头条实测：段落级 `text-align` 是唯一存活的内联样式（探针 10/11，编辑器内与发布页 DOM 都只有它）。
   *  但图片会被平台抽成 `div.pgc-img`、连同包裹段的样式一起丢弃，所以只有**图注**值得居中——
   *  图注的字号与色值必被剥，居中是它与正文唯一的区分手段。知乎维持零内联样式契约，不给 */
  centerCaptions: boolean
  /** 头条把 `thead`/`th` 压平成 `tbody`/`td`（粘贴后编辑器内与发布页 DOM 里 th 计数均为 0），
   *  表头行只剩内容本身。实测探针 21 的 `font-weight:bold` 被转成了 bold mark（`<strong>`），
   *  而纯语义的 20 表头与内容行完全无异 → 表头的视觉区分只能靠 `<strong>` 保住。知乎保留 th 语义，不加 */
  markTableHeader: boolean
}

function semanticInline(content: InlineNode[] | undefined): string {
  if (!content) return ''
  return content
    .map((n) => {
      if (n.type === 'hardBreak') return '<br>'
      const text = escapeHtml(n.text)
      return n.marks?.some((mk) => mk.type === 'bold') ? `<strong>${text}</strong>` : text
    })
    .join('')
}

function semanticCaption(text: string, opts: SemanticOpts): string {
  const inner = escapeHtml(text)
  return opts.centerCaptions ? `<p style="text-align:center">${inner}</p>` : `<p>${inner}</p>`
}

function semanticImages(
  images: FigureGalleryAttrs['images'],
  caption: string,
  resolveImg: (src: string) => string,
  opts: SemanticOpts
): string {
  const imgs = images.map(
    (im) => `<p><img src="${escapeHtml(resolveImg(im.src))}" alt="${escapeHtml(im.alt)}"></p>`
  )
  if (caption) imgs.push(semanticCaption(caption, opts))
  return imgs.join('\n')
}

function semanticHtml(
  doc: ArticleDoc,
  resolveImg: (src: string) => string,
  theme: ArticleTheme,
  opts: SemanticOpts
): string {
  let h2Seq = 0
  const out: string[] = []
  for (const b of doc.content ?? []) {
    out.push(semanticBlock(b, resolveImg, theme, () => h2NumText(theme.h2Num!, ++h2Seq), opts))
  }
  return out.filter(Boolean).join('\n')
}

function semanticBlock(
  b: BlockNode,
  resolveImg: (src: string) => string,
  theme: ArticleTheme,
  nextSeq: () => string,
  opts: SemanticOpts
): string {
  switch (b.type) {
    case 'heading': {
      // 头条把 h1/h2/h3 一律压成同一个 <h1 class="pgc-h-forward-slash">（粘贴后 DOM 实测），层级差由平台统一给，
      // 所以主题的 h2Num 文本序号是头条侧唯一的层级信号，必须作为标题文本保留
      const level = Math.min(Math.max(b.attrs.level, 1), 3)
      const tag = `h${level}`
      const autoNum = level === 2 && theme.h2Num ? nextSeq() : ''
      const content = level === 2 && theme.h2Num ? stripSeq(b.content) : b.content
      return `<${tag}>${autoNum}${semanticInline(content)}</${tag}>`
    }
    case 'paragraph': {
      const text = plainText(b.content)
      if (!text || isDecorative(text)) return ''
      return `<p>${semanticInline(b.content)}</p>`
    }
    case 'blockquote':
      return `<blockquote>${b.content.map((p) => `<p>${semanticInline(p.content)}</p>`).join('')}</blockquote>`
    case 'horizontalRule':
      return '<hr>'
    case 'figureImage': {
      const img = `<p><img src="${escapeHtml(resolveImg(b.attrs.src))}" alt="${escapeHtml(b.attrs.alt)}"></p>`
      return b.attrs.caption ? img + semanticCaption(b.attrs.caption, opts) : img
    }
    case 'figureGallery':
      return semanticImages(b.attrs.images, b.attrs.caption, resolveImg, opts)
    case 'table': {
      const rows = b.attrs.rows
      if (!rows.length) return ''
      const [header, ...body] = rows
      const th = (c: string): string =>
        opts.markTableHeader ? `<th><strong>${escapeHtml(c)}</strong></th>` : `<th>${escapeHtml(c)}</th>`
      const head = header.length ? `<thead><tr>${header.map(th).join('')}</tr></thead>` : ''
      const tbody = body.length
        ? `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
        : ''
      return `<table>${head}${tbody}</table>`
    }
    case 'figSuggest':
      return ''
  }
}

// ---------- 百家号：保守内联（保留颜色加粗，去卡片与复杂装饰）——未实测，勿据此推广到其他平台 ----------

interface LiteCtx {
  accent: string
  strongStyle: 'color' | 'highlight' | 'plain'
  strongColor: string
}

function liteInline(content: InlineNode[] | undefined, ctx: LiteCtx): string {
  if (!content) return ''
  return content
    .map((n) => {
      if (n.type === 'hardBreak') return '<br>'
      const bold = n.marks?.some((mk) => mk.type === 'bold')
      const ts = n.marks?.find((mk) => mk.type === 'textStyle')
      const a = ts ? textStyleAttrs(ts) : undefined
      const text = escapeHtml(n.text)
      // 主题加粗强调：color → 强调色；highlight → 平台会剥底色，降级为强调色；手动字色优先
      const strongColor = a?.color && isHexColor(a.color) ? '' : ctx.strongStyle === 'plain' ? '' : ctx.strongColor
      const styleParts: string[] = []
      if (a?.color && isHexColor(a.color)) styleParts.push(`color:${a.color.trim()}`)
      if (a?.bg && isHexColor(a.bg)) styleParts.push(`background-color:${a.bg.trim()}`)
      const span = styleParts.length ? `<span style="${styleParts.join(';')}">${text}</span>` : text
      if (!bold) return span
      return strongColor ? `<strong style="color:${strongColor}">${span}</strong>` : `<strong>${span}</strong>`
    })
    .join('')
}

function liteHtml(doc: ArticleDoc, resolveImg: (src: string) => string, theme: ArticleTheme): string {
  const accent = theme.accent && isHexColor(theme.accent) ? theme.accent.trim() : '#0d9488'
  const strongColor =
    theme.strongColor && isHexColor(theme.strongColor) ? theme.strongColor.trim() : accent
  const ctx: LiteCtx = { accent, strongStyle: theme.strongStyle ?? 'color', strongColor }
  let h2Seq = 0
  const out: string[] = []
  for (const b of doc.content ?? []) {
    out.push(liteBlock(b, resolveImg, theme, ctx, () => h2NumText(theme.h2Num!, ++h2Seq)))
  }
  const body = out.filter(Boolean).join('\n')
  return `<div style="font-size:15px;line-height:1.8;color:#333;word-break:break-word;">\n${body}\n</div>`
}

function liteBlock(
  b: BlockNode,
  resolveImg: (src: string) => string,
  theme: ArticleTheme,
  ctx: LiteCtx,
  nextSeq: () => string
): string {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(Math.max(b.attrs.level, 1), 3)
      const autoNum = level === 2 && theme.h2Num ? nextSeq() : ''
      const content = level === 2 && theme.h2Num ? stripSeq(b.content) : b.content
      const inner = liteInline(content, ctx)
      if (level === 1)
        return `<h1 style="font-size:22px;font-weight:bold;color:#1a1a1a;text-align:center;margin:8px 0 24px;">${inner}</h1>`
      if (level === 2)
        return `<h2 style="font-size:19px;font-weight:bold;color:#1a1a1a;margin:28px 0 14px;">${autoNum}${inner}</h2>`
      return `<h3 style="font-size:17px;font-weight:600;color:#1a1a1a;margin:22px 0 10px;">${inner}</h3>`
    }
    case 'paragraph': {
      const text = plainText(b.content)
      if (!text || isDecorative(text)) return ''
      return `<p style="margin:14px 0;">${liteInline(b.content, ctx)}</p>`
    }
    case 'blockquote':
      return `<blockquote style="margin:16px 0;padding:6px 14px;border-left:4px solid ${ctx.accent};color:#555;">${b.content
        .map((p) => `<p style="margin:6px 0;">${liteInline(p.content, ctx)}</p>`)
        .join('')}</blockquote>`
    case 'horizontalRule':
      return '<hr style="border:none;border-top:1px solid #e5e5e5;margin:28px auto;width:80%;">'
    case 'figureImage': {
      const img = `<p style="text-align:center;margin:16px 0;"><img src="${escapeHtml(resolveImg(b.attrs.src))}" alt="${escapeHtml(b.attrs.alt)}" style="max-width:100%;"></p>`
      return b.attrs.caption ? img + liteCaption(b.attrs.caption) : img
    }
    case 'figureGallery': {
      const parts = b.attrs.images.map(
        (im) =>
          `<p style="text-align:center;margin:16px 0;"><img src="${escapeHtml(resolveImg(im.src))}" alt="${escapeHtml(im.alt)}" style="max-width:100%;"></p>`
      )
      if (b.attrs.caption) parts.push(liteCaption(b.attrs.caption))
      return parts.join('\n')
    }
    case 'table': {
      const rows = b.attrs.rows
      if (!rows.length) return ''
      const [header, ...body] = rows
      const td = 'border:1px solid #e5e5e5;padding:8px 10px;'
      const head = header.length
        ? `<thead><tr>${header
            .map((c) => `<th style="${td}background:#f7f7f7;font-weight:bold;">${escapeHtml(c)}</th>`)
            .join('')}</tr></thead>`
        : ''
      const tbody = body.length
        ? `<tbody>${body
            .map((r) => `<tr>${r.map((c) => `<td style="${td}">${escapeHtml(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody>`
        : ''
      return `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px;">${head}${tbody}</table>`
    }
    case 'figSuggest':
      return ''
  }
}

function liteCaption(text: string): string {
  return `<p style="text-align:center;font-size:12px;color:#888;margin:6px 0 16px;">${escapeHtml(text)}</p>`
}

// ---------- 入口 ----------

/**
 * doc → 平台适配 HTML 片段（不含页壳；复制到平台后台正文区用这段）。
 * wechat 委托 exportHtml.docToExportHtml（uiDark 仅公众号路径有意义）。
 */
export function docToPlatformHtml(
  doc: ArticleDoc,
  resolveImg: (src: string) => string,
  theme: ArticleTheme | undefined,
  platform: PlatformId,
  uiDark = false
): string {
  if (platform === 'wechat') return docToExportHtml(doc, resolveImg, theme, uiDark)
  const t = theme ?? DEFAULT_THEME
  if (platform === 'baijiahao') return liteHtml(doc, resolveImg, t)
  const toutiao = platform === 'toutiao'
  return semanticHtml(doc, resolveImg, t, { centerCaptions: toutiao, markTableHeader: toutiao })
}

/** 平台适配片段 → 完整独立页面（article-<platform>.html 落盘 / 弹窗预览共用；白底桌面专栏宽）。
 *  img 约束挂页壳样式表而非片段：语义化画像（知乎/头条）保持零内联视觉样式契约，
 *  大图不按原始像素撑爆视口 */
export function wrapPlatformPage(fragment: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>img{max-width:100%;height:auto;}</style>
</head>
<body style="margin:0;background:#fff;">
<div style="max-width:720px;margin:0 auto;padding:24px 20px 64px;">
${fragment}
</div>
</body>
</html>
`
}
