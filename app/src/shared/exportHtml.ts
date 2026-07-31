import type { ArticleDoc, BlockNode, FigureGalleryAttrs, InlineNode, ParagraphNode } from './markdown'
import { isHexColor } from './cards'

/**
 * article.md → 公众号可粘贴 HTML（M7 导出）
 * - 全部内联样式、零 class：公众号后台会剥掉 <style>/class，只认 style 属性
 * - 复刻荣耀文章排版：正文 16px/1.8、段间距、图注灰色小字居中、短分隔线
 * - 图集：swipe-h → 横滑容器（overflow-x:scroll，公众号兼容）；grid → inline-block 拼图
 *   （stack-v 选项已废弃，旧文档遗留的按拼图导出）
 * - fig-suggest 占位卡不导出
 * - resolveImg 决定图片 src 形态：相对路径（article.html）/ asset://（预览）/ dataURL（富文本复制）
 */

const S = {
  root: 'font-size:16px;line-height:1.8;color:#333;letter-spacing:0.4px;word-break:break-word;',
  h1: 'font-size:22px;font-weight:bold;color:#1a1a1a;line-height:1.4;margin:28px 0 18px;text-align:center;',
  h2: 'font-size:18px;font-weight:bold;color:#1a1a1a;line-height:1.5;margin:32px 0 14px;',
  h3: 'font-size:16px;font-weight:bold;color:#1a1a1a;line-height:1.5;margin:24px 0 12px;',
  p: 'font-size:16px;line-height:1.8;color:#333;margin:0 0 16px;text-align:justify;',
  strong: 'font-weight:bold;color:#111;',
  blockquote:
    'margin:20px 0;padding:12px 16px;border-left:3px solid #d9d9d9;background:#f7f7f7;color:#777;font-size:15px;line-height:1.8;',
  quoteP: 'margin:0 0 8px;font-size:15px;line-height:1.8;color:#777;',
  quotePLast: 'margin:0;font-size:15px;line-height:1.8;color:#777;',
  hr: 'margin:32px auto;border:0 none;border-top:1px solid #e8e8e8;width:64px;',
  figure: 'margin:20px 0;text-align:center;',
  img: 'max-width:100%;border-radius:6px;',
  caption: 'font-size:13px;color:#888;line-height:1.6;margin-top:8px;text-align:center;',
  swipeBox: 'overflow-x:scroll;white-space:nowrap;-webkit-overflow-scrolling:touch;',
  swipeImg: 'display:inline-block;width:80%;margin-right:8px;border-radius:6px;vertical-align:top;',
  hint: 'font-size:12px;color:#bbb;line-height:1.6;margin-top:6px;text-align:center;'
} as const

type Styles = { -readonly [K in keyof typeof S]: string }

/** 强调色着色点（与编辑器排版同构）：H2 竖条 / H3 短条 / 引用边线 / 加粗词；缺省/非法色用默认灰黑 */
function buildStyles(accent?: string): Styles {
  const s: Styles = { ...S }
  if (!accent || !isHexColor(accent)) return s
  const c = accent.trim()
  s.h2 = `${S.h2}border-left:4px solid ${c};padding-left:10px;`
  s.h3 = `${S.h3}border-left:3px solid ${c};padding-left:8px;`
  s.blockquote = S.blockquote.replace('#d9d9d9', c)
  s.strong = `font-weight:bold;color:${c};`
  return s
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineToHtml(content: InlineNode[] | undefined, s: Styles): string {
  if (!content) return ''
  return content
    .map((n) => {
      if (n.type === 'hardBreak') return '<br>'
      const text = escapeHtml(n.text)
      return n.marks?.some((mk) => mk.type === 'bold') ? `<strong style="${s.strong}">${text}</strong>` : text
    })
    .join('')
}

/** 取景比 "3:4" → aspect-ratio + object-fit 裁切样式（公众号不认时自然降级为原比例） */
function frameStyle(frame: string): string {
  return frame ? `aspect-ratio:${frame.replace(':', ' / ')};object-fit:cover;` : ''
}

function galleryToHtml(attrs: FigureGalleryAttrs, resolveImg: (src: string) => string): string {
  const { images, layout, frame, caption } = attrs
  if (!images.length) return ''
  const cap = caption ? `<p style="${S.caption}">${escapeHtml(caption)}</p>` : ''

  if (layout === 'grid' || layout === 'stack-v') {
    // 拼图：inline-block 网格（列数与编辑器 grid 一致）；旧文档遗留的 stack-v 同样按拼图导出
    const cols = images.length <= 2 || images.length === 4 ? 2 : 3
    const width = ((100 - 2 * (cols - 1)) / cols).toFixed(2)
    const defFrame = layout === 'stack-v' ? '16:9' : '1:1'
    const cells = images
      .map((im, k) => {
        const mr = k % cols === cols - 1 ? '0' : '2%'
        return `<img src="${escapeHtml(resolveImg(im.src))}" alt="${escapeHtml(im.alt)}" style="display:inline-block;width:${width}%;margin:0 ${mr} 6px 0;border-radius:6px;vertical-align:top;${frameStyle(frame || defFrame)}">`
      })
      .join('')
    return `<section style="${S.figure}"><section style="font-size:0;line-height:0;">${cells}</section>${cap}</section>`
  }

  // swipe-h：公众号经典横滑图集
  const items = images
    .map(
      (im) =>
        `<img src="${escapeHtml(resolveImg(im.src))}" alt="${escapeHtml(im.alt)}" style="${S.swipeImg}${frameStyle(frame)}">`
    )
    .join('')
  return `<section style="${S.figure}"><section style="${S.swipeBox}">${items}</section><p style="${S.hint}">← 左右滑动查看 ${images.length} 张 →</p>${cap}</section>`
}

function blockToHtml(block: BlockNode, resolveImg: (src: string) => string, s: Styles): string {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.attrs.level, 1), 3)
      const style = level === 1 ? s.h1 : level === 2 ? s.h2 : s.h3
      return `<h${level} style="${style}">${inlineToHtml(block.content, s)}</h${level}>`
    }
    case 'paragraph': {
      const inner = inlineToHtml(block.content, s)
      return inner.trim() ? `<p style="${s.p}">${inner}</p>` : ''
    }
    case 'blockquote': {
      const paras = block.content
        .map(
          (p: ParagraphNode, i: number) =>
            `<p style="${i === block.content.length - 1 ? s.quotePLast : s.quoteP}">${inlineToHtml(p.content, s)}</p>`
        )
        .join('')
      return `<blockquote style="${s.blockquote}">${paras}</blockquote>`
    }
    case 'horizontalRule':
      return `<hr style="${s.hr}">`
    case 'figureImage': {
      const { src, alt, caption } = block.attrs
      const cap = caption ? `<p style="${S.caption}">${escapeHtml(caption)}</p>` : ''
      return `<section style="${S.figure}"><img src="${escapeHtml(resolveImg(src))}" alt="${escapeHtml(alt)}" style="${S.img}">${cap}</section>`
    }
    case 'figureGallery':
      return galleryToHtml(block.attrs, resolveImg)
    case 'figSuggest':
      return '' // 占位卡是工作过程产物，不导出
  }
}

/** doc → 正文片段 HTML（粘贴公众号用这段；不含 <html> 外壳）；accent 为文章强调色（meta.accent） */
export function docToExportHtml(doc: ArticleDoc, resolveImg: (src: string) => string, accent?: string): string {
  const s = buildStyles(accent)
  const body = (doc.content ?? [])
    .map((b) => blockToHtml(b, resolveImg, s))
    .filter(Boolean)
    .join('\n')
  return `<section style="${s.root}">\n${body}\n</section>`
}

/** 片段 → 完整独立页面（article.html / 手机预览） */
export function wrapExportPage(fragment: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;background:#fff;">
<div style="max-width:677px;margin:0 auto;padding:20px 16px 48px;">
${fragment}
</div>
</body>
</html>
`
}

/** 从文档抽标题（首个 H1，用作导出页 <title>） */
export function extractTitle(doc: ArticleDoc, fallback: string): string {
  for (const b of doc.content ?? []) {
    if (b.type === 'heading' && b.attrs.level === 1) {
      const t = (b.content ?? [])
        .map((n) => (n.type === 'text' ? n.text : ' '))
        .join('')
        .trim()
      if (t) return t
    }
  }
  return fallback
}
