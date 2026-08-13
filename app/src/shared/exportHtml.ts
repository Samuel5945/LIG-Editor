import type { ArticleDoc, BlockNode, FigureGalleryAttrs, InlineNode, ParagraphNode } from './markdown'
import { isHexColor } from './cards'
import { DEFAULT_THEME, type ArticleTheme } from './categoryThemes'

/**
 * article.md → 公众号可粘贴 HTML（M7 导出）
 * - 全部内联样式、零 class：公众号后台会剥掉 <style>/class，只认 style 属性
 * - 复刻荣耀文章排版：正文 16px/1.8、段间距、图注灰色小字居中、短分隔线
 * - 图集：swipe-h → 横滑容器（overflow-x:scroll，公众号兼容）；grid → inline-block 拼图
 *   （stack-v 选项已废弃，旧文档遗留的按拼图导出）
 * - fig-suggest 占位卡不导出
 * - resolveImg 决定图片 src 形态：相对路径（article.html）/ asset://（预览）/ dataURL（富文本复制）
 */

/** 默认强调色：与编辑器 --article-accent 缺省值一致（index.css），未设/非法色时推送不再变灰 */
const DEFAULT_ACCENT = '#4f8cff'

/**
 * 排版规格与编辑器 index.css 的 .article-editor .ProseMirror 对齐（字号/行高/间距/装饰同构）。
 * 颜色按白底适配（编辑器是深底浅字，公众号是白底深字）；H1 下划线短横 / H3 菱形在编辑器里是
 * 伪元素，公众号会剥掉伪元素，改由 blockToHtml 用真实 DOM 元素还原同样形状。
 */
const S = {
  root: 'font-size:15px;line-height:2.13;color:#333;letter-spacing:0.02em;word-break:break-word;',
  h1Wrap: 'text-align:center;',
  h1: 'font-size:26px;font-weight:bold;color:#1a1a1a;line-height:1.375;letter-spacing:0.025em;margin:32px 0 0;',
  h1Bar: 'width:48px;height:3px;border-radius:9999px;margin:12px auto 0;',
  h2: 'font-size:20px;font-weight:bold;color:#1a1a1a;line-height:1.375;margin:40px 0 16px;',
  h3: 'font-size:17px;font-weight:600;color:#1a1a1a;line-height:1.375;margin:32px 0 12px;',
  h3Diamond:
    'display:inline-block;width:8px;height:8px;border-radius:2px;transform:rotate(45deg);margin-right:8px;vertical-align:middle;',
  p: 'font-size:15px;line-height:2.13;color:#333;margin:16px 0;',
  strong: 'font-weight:bold;',
  blockquote:
    'margin:20px 0;padding:8px 12px 8px 16px;border-left:4px solid #4f8cff;border-top-right-radius:8px;border-bottom-right-radius:8px;background:#f7f7f7;color:#777;font-size:15px;line-height:2.13;',
  quoteP: 'margin:4px 0;font-size:15px;line-height:2.13;color:#777;',
  quotePLast: 'margin:4px 0;font-size:15px;line-height:2.13;color:#777;',
  hr: 'margin:40px auto;border:0 none;border-top:2px solid #e8e8e8;width:64px;',
  figure: 'margin:20px 0;text-align:center;',
  img: 'max-width:100%;max-height:420px;border-radius:4px;',
  caption: 'font-size:12px;color:#888;line-height:1.6;margin-top:8px;text-align:center;',
  swipeBox: 'overflow-x:scroll;white-space:nowrap;-webkit-overflow-scrolling:touch;',
  swipeImg: 'display:inline-block;width:80%;margin-right:8px;border-radius:6px;vertical-align:top;',
  hint: 'font-size:12px;color:#bbb;line-height:1.6;margin-top:6px;text-align:center;'
} as const

type Styles = { -readonly [K in keyof typeof S]: string }

/** 按排版调性着色（与编辑器同源同构）：强调色（H1 短横 / H2 竖条 / H3 菱形 / 引用边线 / 加粗词）
 * + 字体/行高/字距/标题对齐；缺省/非法值回默认调性 */
function buildStyles(theme?: ArticleTheme): Styles {
  const t = theme ?? DEFAULT_THEME
  const s: Styles = { ...S }
  const c = t.accent && isHexColor(t.accent) ? t.accent.trim() : DEFAULT_ACCENT
  const lh = t.lineHeight || 2.13
  s.root = `font-size:15px;line-height:${lh};color:#333;letter-spacing:${t.letterSpacing};word-break:break-word;font-family:${t.fontFamily};`
  s.p = `font-size:15px;line-height:${lh};color:#333;margin:16px 0;`
  s.quoteP = `margin:4px 0;font-size:15px;line-height:${lh};color:#777;`
  s.quotePLast = `margin:4px 0;font-size:15px;line-height:${lh};color:#777;`
  s.blockquote = S.blockquote.replace('line-height:2.13', `line-height:${lh}`).replace('#4f8cff', c)
  s.h1Wrap = `text-align:${t.headingAlign};`
  // 左对齐调性：短横靠左；居中的保持 auto 居中
  const barMargin = t.headingAlign === 'left' ? 'margin:12px 0 0;' : 'margin:12px auto 0;'
  s.h1Bar = `width:48px;height:3px;border-radius:9999px;${barMargin}background:${c};`
  s.h2 = `${S.h2}border-left:4px solid ${c};padding-left:12px;`
  s.h3Diamond = `${S.h3Diamond}background:${c};`
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
      const inner = inlineToHtml(block.content, s)
      if (level === 1) {
        // 居中大标题 + 强调色短横收尾（复刻编辑器 h1::after，公众号剥伪元素故用真实块）
        return `<section style="${s.h1Wrap}"><h1 style="${s.h1}">${inner}</h1><div style="${s.h1Bar}"></div></section>`
      }
      if (level === 3) {
        // 强调色菱形前缀（复刻编辑器 h3::before）
        return `<h3 style="${s.h3}"><span style="${s.h3Diamond}"></span>${inner}</h3>`
      }
      return `<h2 style="${s.h2}">${inner}</h2>`
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

/** doc → 正文片段 HTML（粘贴公众号用这段；不含 <html> 外壳）；theme 为排版调性（分类调性解析结果） */
export function docToExportHtml(doc: ArticleDoc, resolveImg: (src: string) => string, theme?: ArticleTheme): string {
  const s = buildStyles(theme)
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
