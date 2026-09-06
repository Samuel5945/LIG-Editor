/**
 * 多平台分发适配（M11）：同一篇 article 按目标平台编辑器的粘贴净化规则输出对应形态的富文本
 *
 * 平台画像 v1（以主流编辑器粘贴行为为准，实际效果以平台为准；画像在本文件单点调优）：
 * - wechat：委托 exportHtml.docToExportHtml（全内联样式 + 背景卡 + 装饰 + 自动序号），本模块不碰
 * - zhihu：语义化 HTML——知乎净化器只留结构（h1-h3/strong/blockquote/table/img），
 *   主动输出零内联样式的干净结构，避免残留垃圾 span/section；加粗强调统一 <strong>
 * - toutiao / baijiahao：保守内联形态——保留标题/正文颜色、加粗、引用左条、分隔线、图片；
 *   去背景卡片、胶囊色块、圆角拼图等复杂装饰（净化器会打碎它们）。两平台 v1 共用同一画像，
 *   预留独立 id 以便后续分化
 *
 * 通用规则：
 * - 主题 h2Num 自动序号保留为标题文本（01 / 一、…），手写序号剥除避免双号（与公众号导出同源）
 * - 手动内联样式：字色/高亮保留（lite）/剥除（zhihu）；手动字号一律不给（平台统一正文字号）
 * - 图片走 resolveImg（复制 = dataURL 内嵌，平台粘贴时自动转存；导出文件 = 相对路径）
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

// ---------- 知乎：零内联样式的语义化结构 ----------

function zhihuInline(content: InlineNode[] | undefined): string {
  if (!content) return ''
  return content
    .map((n) => {
      if (n.type === 'hardBreak') return '<br>'
      const text = escapeHtml(n.text)
      return n.marks?.some((mk) => mk.type === 'bold') ? `<strong>${text}</strong>` : text
    })
    .join('')
}

function zhihuCaption(text: string): string {
  return `<p>${escapeHtml(text)}</p>`
}

function zhihuImages(images: FigureGalleryAttrs['images'], caption: string, resolveImg: (src: string) => string): string {
  const imgs = images.map((im) => `<p><img src="${escapeHtml(resolveImg(im.src))}" alt="${escapeHtml(im.alt)}"></p>`)
  if (caption) imgs.push(zhihuCaption(caption))
  return imgs.join('\n')
}

function zhihuHtml(doc: ArticleDoc, resolveImg: (src: string) => string, theme: ArticleTheme): string {
  let h2Seq = 0
  const out: string[] = []
  for (const b of doc.content ?? []) {
    out.push(zhihuBlock(b, resolveImg, theme, () => h2NumText(theme.h2Num!, ++h2Seq)))
  }
  return out.filter(Boolean).join('\n')
}

function zhihuBlock(
  b: BlockNode,
  resolveImg: (src: string) => string,
  theme: ArticleTheme,
  nextSeq: () => string
): string {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(Math.max(b.attrs.level, 1), 3)
      const tag = `h${level}`
      const autoNum = level === 2 && theme.h2Num ? nextSeq() : ''
      const content = level === 2 && theme.h2Num ? stripSeq(b.content) : b.content
      return `<${tag}>${autoNum}${zhihuInline(content)}</${tag}>`
    }
    case 'paragraph': {
      const text = plainText(b.content)
      if (!text || isDecorative(text)) return ''
      return `<p>${zhihuInline(b.content)}</p>`
    }
    case 'blockquote':
      return `<blockquote>${b.content.map((p) => `<p>${zhihuInline(p.content)}</p>`).join('')}</blockquote>`
    case 'horizontalRule':
      return '<hr>'
    case 'figureImage': {
      const img = `<p><img src="${escapeHtml(resolveImg(b.attrs.src))}" alt="${escapeHtml(b.attrs.alt)}"></p>`
      return b.attrs.caption ? img + zhihuCaption(b.attrs.caption) : img
    }
    case 'figureGallery':
      return zhihuImages(b.attrs.images, b.attrs.caption, resolveImg)
    case 'table': {
      const rows = b.attrs.rows
      if (!rows.length) return ''
      const [header, ...body] = rows
      const head = header.length
        ? `<thead><tr>${header.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`
        : ''
      const tbody = body.length
        ? `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
        : ''
      return `<table>${head}${tbody}</table>`
    }
    case 'figSuggest':
      return ''
  }
}

// ---------- 头条号 / 百家号：保守内联（保留颜色加粗，去卡片与复杂装饰） ----------

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
  return platform === 'zhihu' ? zhihuHtml(doc, resolveImg, t) : liteHtml(doc, resolveImg, t)
}

/** 平台适配片段 → 完整独立页面（article-<platform>.html 落盘 / 弹窗预览共用；白底桌面专栏宽）。
 *  img 约束挂页壳样式表而非片段：知乎画像保持零内联样式契约，大图不按原始像素撑爆视口 */
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
