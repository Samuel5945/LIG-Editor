import type { ArticleDoc, BlockNode, FigureGalleryAttrs, InlineNode, ParagraphNode } from './markdown'
import { isHexColor } from './cards'
import { DEFAULT_THEME, contrastText, isDarkColor, resolveEditorTheme, type ArticleTheme } from './categoryThemes'

/**
 * article.md → 公众号可粘贴 HTML（M7 导出）
 * - 全部内联样式、零 class：公众号后台会剥掉 <style>/class，只认 style 属性
 * - 复刻荣耀文章排版：正文 16px/1.8、段间距、图注灰色小字居中、短分隔线
 * - 图集：swipe-h → 横滑容器（overflow-x:scroll，公众号兼容）；grid → inline-block 拼图
 *   （stack-v 选项已废弃，旧文档遗留的按拼图导出）
 * - fig-suggest 占位卡不导出
 * - resolveImg 决定图片 src 形态：相对路径（article.html）/ asset://（预览）/ dataURL（富文本复制）
 * - 排版调性：分类调性驱动结构级风格（背景卡片/标题装饰/引用形态/分隔线/加粗/圆角），
 *   默认调性输出与历史完全一致的经典排版
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

type Styles = { -readonly [K in keyof typeof S]: string } & {
  quoteMark: string
  imgR: string
  table: string
  th: string
  td: string
  tdStripe: string
  tdFirst: string
}

/** 强调色转淡色底（公众号客户端不认 color-mix，预计算 rgba；非法输入回默认蓝） */
function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(79,140,255,${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16},${(n >> 8) & 0xff},${n & 0xff},${alpha})`
}

/** 按排版调性着色与造型（与编辑器同源同构）；缺省/非法值回默认调性。
 * uiDark 提供时按昼夜变体（bodyBgLight/Dark 等）覆盖配色——导出预览跟随 UI；
 * 不传则固定主题基础色——导出文件/公众号草稿静态，不随读者昼夜切换。 */
function buildStyles(theme?: ArticleTheme, uiDark?: boolean): Styles {
  let t = theme ?? DEFAULT_THEME
  if (uiDark !== undefined) {
    // 昼夜变体覆盖：编辑器预览所见 = 编辑器正文区配色
    const c = resolveEditorTheme(t, uiDark)
    t = { ...t, bodyBg: c.bodyBg, bodyText: c.bodyText, headingColor: c.headingColor }
  }
  const s: Styles = {
    ...S,
    quoteMark: '',
    imgR: '4px',
    table: '',
    th: '',
    td: '',
    tdStripe: '',
    tdFirst: ''
  }
  const c = t.accent && isHexColor(t.accent) ? t.accent.trim() : DEFAULT_ACCENT
  const lh = t.lineHeight || 2.13
  // 按背景卡片实际亮度判断深/浅（不能用「有无卡片」——暖白卡也是浅色）
  const dark = !!t.bodyBg && isDarkColor(t.bodyBg)
  // 深浅兜底：背景与正文/标题亮度不匹配时强制修正（浅底必须深字、深底必须浅字）。
  // 兜底对象含历史导入产生的脏数据（浅粉底 #fff0f0 配浅灰字 #cbd5e1 等跨元素误配）
  const bodyTv = t.bodyText ?? (dark ? '#cbd5e1' : '#333')
  const textColor = t.bodyBg && isDarkColor(bodyTv) === dark ? (dark ? '#cbd5e1' : '#333') : bodyTv
  const headTv = t.headingColor ?? (dark ? '#eef2f7' : '#1a1a1a')
  const headingColor =
    t.bodyBg && isDarkColor(headTv) === dark ? (dark ? '#eef2f7' : '#1a1a1a') : headTv
  const subColor = headingColor
  // 引用/图注/提示不再用灰字：浅底深字、深底亮字，与正文同系靠背景块区分层次
  const quoteColor = dark ? '#cbd5e1' : '#333'
  const quoteBg = dark ? 'rgba(255,255,255,0.07)' : '#f7f7f7'
  const captionColor = dark ? '#b6c4d4' : '#555'
  const pGap = t.pGap ?? 16
  const imgR = t.imgRadius ?? 4
  // 正文基准字号：主题可调，缺省 16px（AI 排版默认 14-15px 偏小，正文以大字号为舒适）
  const baseSize = t.fontSize && t.fontSize >= 10 && t.fontSize <= 40 ? t.fontSize : 16
  // 标题基准字号：缺省 20（H1=+6 H2=+0 H3=-3，与经典导出 26/20/17 一致）
  const headingBase = t.headingFontSize && t.headingFontSize >= 12 && t.headingFontSize <= 40 ? t.headingFontSize : 20
  // 正文排列：indent 首行缩进 2em / flush 两端对齐 / center 居中；缺省左对齐不缩进
  const pAlign =
    t.bodyAlign === 'indent' ? 'text-align:justify;text-indent:2em;'
    : t.bodyAlign === 'flush' ? 'text-align:justify;'
    : t.bodyAlign === 'center' ? 'text-align:center;'
    : ''
  // 表格：边框色 / 表头背景 / 表头字色（按表头背景亮度自适应）/ 斑马纹
  const tableBorder = t.tableBorder && isHexColor(t.tableBorder) ? t.tableBorder.trim() : dark ? '#3a4a5e' : '#e5e7eb'
  const headerBg = t.tableHeaderBg && isHexColor(t.tableHeaderBg) ? t.tableHeaderBg.trim() : dark ? '#1e2b3d' : '#f3f4f6'
  const headerText =
    t.tableHeaderText && isHexColor(t.tableHeaderText)
      ? t.tableHeaderText.trim()
      : isDarkColor(headerBg)
        ? '#eef2f7'
        : '#1a1a1a'
  const tableStyle = t.tableStyle ?? 'bordered'

  // 正文容器：背景卡片（深色卡片 / 暖色卡片 / 透明白底）
  s.root = `font-size:${baseSize}px;line-height:${lh};color:${textColor};letter-spacing:${t.letterSpacing};word-break:break-word;font-family:${t.fontFamily};`
  if (t.bodyBg) {
    s.root += `background:${t.bodyBg};border-radius:${t.bodyRadius ?? 0}px;padding:${t.bodyPadding ?? '16px 18px'};`
  }
  s.p = `font-size:${baseSize}px;line-height:${lh};color:${textColor};margin:${pGap}px 0;${pAlign}`
  s.quoteP = `margin:4px 0;font-size:${baseSize}px;line-height:${lh};color:${quoteColor};`
  s.quotePLast = `margin:4px 0;font-size:${baseSize}px;line-height:${lh};color:${quoteColor};`
  s.caption = `font-size:12px;color:${captionColor};line-height:1.6;margin-top:8px;text-align:center;`
  s.hint = `font-size:12px;color:${captionColor};line-height:1.6;margin-top:6px;text-align:center;`
  s.img = `max-width:100%;max-height:420px;border-radius:${imgR}px;`
  s.swipeImg = `display:inline-block;width:80%;margin-right:8px;border-radius:${imgR}px;vertical-align:top;`
  s.imgR = `${imgR}px`
  s.quoteMark = ''
  s.strong = strongStyle(t, dark, c)
  // 表格：全边框 / 斑马纹 / 极简（plain 用底线分隔，无竖边框）
  s.table = `border-collapse:collapse;width:100%;margin:${pGap}px 0;font-size:14px;line-height:1.8;font-family:${t.fontFamily};`
  if (tableStyle === 'plain') {
    s.table += 'border:0 none;'
    s.th = `padding:10px 4px;text-align:left;font-weight:bold;color:${headerText};border-bottom:2px solid ${tableBorder};`
    s.td = `padding:9px 4px;color:${textColor};border-bottom:1px solid ${tableBorder};`
    s.tdStripe = ''
    s.tdFirst = ''
  } else {
    s.th = `padding:10px 12px;text-align:left;font-weight:bold;color:${headerText};background:${headerBg};border:1px solid ${tableBorder};`
    s.td = `padding:9px 12px;color:${textColor};border:1px solid ${tableBorder};`
    s.tdStripe = tableStyle === 'striped' ? `background:${tint(headerBg, 0.35)};` : ''
    s.tdFirst = ''
  }
  s.h1Wrap = `text-align:${t.headingAlign};`

  // H1 装饰：bar 经典短横 / pill 胶囊色块字底 / underline 下划线
  const h1Style = t.h1Style ?? 'bar'
  const h1Size = headingBase + 6
  if (h1Style === 'pill') {
    s.h1 = `font-size:${h1Size}px;font-weight:bold;color:${contrastText(c)};line-height:1.375;letter-spacing:0.025em;margin:32px 0 0;display:inline-block;background:${c};border-radius:9999px;padding:6px 22px;`
    s.h1Bar = 'display:none;'
  } else if (h1Style === 'underline') {
    s.h1 = `font-size:${h1Size}px;font-weight:bold;color:${headingColor};line-height:1.375;letter-spacing:0.025em;margin:32px 0 0;border-bottom:3px solid ${c};padding-bottom:10px;`
    if (t.headingAlign === 'left') s.h1 += 'display:inline-block;'
    s.h1Bar = 'display:none;'
  } else {
    s.h1 = `font-size:${h1Size}px;font-weight:bold;color:${headingColor};line-height:1.375;letter-spacing:0.025em;margin:32px 0 0;`
    const barMargin = t.headingAlign === 'left' ? 'margin:12px 0 0;' : 'margin:12px auto 0;'
    s.h1Bar = `width:48px;height:3px;border-radius:9999px;${barMargin}background:${c};`
  }

  // H2 装饰：leftbar 左竖条 / block 色块标签 / underline 下划线 / plain 纯文字
  const h2Style = t.h2Style ?? 'leftbar'
  if (h2Style === 'block') {
    const h2Bg = t.h2Bg && isHexColor(t.h2Bg) ? t.h2Bg : c
    // display:table 块级收缩 + margin auto 居中（公众号 webview 兼容）
    const h2Margin = t.headingAlign === 'center' ? '40px auto 16px' : '40px 0 16px'
    s.h2 = `font-size:${headingBase}px;font-weight:bold;color:${contrastText(h2Bg)};line-height:1.375;margin:${h2Margin};display:table;background:${h2Bg};border-radius:6px;padding:3px 14px;`
  } else if (h2Style === 'underline') {
    s.h2 = `font-size:${headingBase}px;font-weight:bold;color:${subColor};line-height:1.375;margin:40px 0 16px;border-bottom:2px solid ${c};padding-bottom:8px;`
  } else if (h2Style === 'plain') {
    s.h2 = `font-size:${headingBase}px;font-weight:bold;color:${subColor};line-height:1.375;margin:40px 0 16px;`
  } else {
    s.h2 = `font-size:${headingBase}px;font-weight:bold;color:${subColor};line-height:1.375;margin:40px 0 16px;border-left:4px solid ${c};padding-left:12px;`
  }

  // H3 前缀：diamond 菱形 / dot 圆点 / none 无
  s.h3 = `font-size:${Math.max(12, headingBase - 3)}px;font-weight:600;color:${subColor};line-height:1.375;margin:32px 0 12px;`
  const mark = t.h3Mark ?? 'diamond'
  if (mark === 'dot') {
    s.h3Diamond = `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:middle;background:${c};`
  } else if (mark === 'none') {
    s.h3Diamond = 'display:none;'
  } else {
    s.h3Diamond = `display:inline-block;width:8px;height:8px;border-radius:2px;transform:rotate(45deg);margin-right:8px;vertical-align:middle;background:${c};`
  }

  // 引用：leftbar 左条浅底 / card 圆角卡片 / quotes 引号 + 左条
  const quoteStyle = t.quoteStyle ?? 'leftbar'
  const quoteTint = tint(c, 0.1)
  if (quoteStyle === 'card') {
    s.blockquote = `margin:20px 0;padding:14px 16px;border-radius:12px;background:${quoteTint};color:${quoteColor};font-size:15px;line-height:${lh};`
  } else if (quoteStyle === 'quotes') {
    s.blockquote = `margin:20px 0;padding:12px 16px 12px 20px;border-left:4px solid ${c};border-top-right-radius:8px;border-bottom-right-radius:8px;background:${quoteTint};color:${quoteColor};font-size:15px;line-height:${lh};`
    s.quoteMark = `font-size:28px;line-height:1;color:${c};margin:0 0 2px;`
  } else {
    s.blockquote = `margin:20px 0;padding:8px 12px 8px 16px;border-left:4px solid ${c};border-top-right-radius:8px;border-bottom-right-radius:8px;background:${quoteBg};color:${quoteColor};font-size:15px;line-height:${lh};`
  }

  // 分隔线：line 居中短横 / dot 圆点列 / long 通栏细线
  const hrStyle = t.hrStyle ?? 'line'
  if (hrStyle === 'long') {
    s.hr = `margin:44px 0;border:0 none;border-top:1px solid ${dark ? 'rgba(255,255,255,0.15)' : '#e5e5e5'};width:100%;`
  } else if (hrStyle === 'dot') {
    s.hr = `margin:40px auto;border:0 none;border-top:4px dotted ${c};width:72px;`
  } else {
    s.hr = `margin:40px auto;border:0 none;border-top:2px solid ${dark ? 'rgba(255,255,255,0.2)' : '#e8e8e8'};width:64px;`
  }

  return s
}

/** 加粗强调：color 着色 / highlight 底色高亮 / plain 纯黑加粗；强调色可用专属 strongColor（缺省 accent） */
function strongStyle(t: ArticleTheme, dark: boolean, accent: string): string {
  const style = t.strongStyle ?? 'color'
  const strongColor = t.strongColor && isHexColor(t.strongColor) ? t.strongColor.trim() : accent
  if (style === 'plain') return 'font-weight:bold;'
  if (style === 'highlight') {
    const bg = t.strongBg && isHexColor(t.strongBg) ? t.strongBg : '#fef3c7'
    // 高亮字色按高亮底色自身亮度（不是卡片亮度）：淡黄 #fef3c7 上恒为深字，
    // 深色卡片夜间模式配淡黄高亮也不出「淡黄底白字」看不清
    return `font-weight:bold;color:${isDarkColor(bg) ? '#f5f5f4' : '#333'};background:${bg};padding:1px 6px;border-radius:4px;`
  }
  return `font-weight:bold;color:${strongColor};`
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
      const bold = n.marks?.some((mk) => mk.type === 'bold')
      const ts = n.marks?.find((mk) => mk.type === 'textStyle') as
        | { color?: string; bg?: string; fontSize?: number }
        | undefined
      // 手动样式 span：字色 / 背景高亮 / 字号（与编辑器所见同源）
      const styleParts: string[] = []
      if (ts?.color) styleParts.push(`color:${ts.color}`)
      if (ts?.bg) styleParts.push(`background-color:${ts.bg}`)
      if (ts?.fontSize) styleParts.push(`font-size:${ts.fontSize}px`)
      // 手动字色优先于主题 strongColor：有 color 时 strong 不带主题色样式（继承 span）
      const strongStyle = ts?.color ? '' : ` style="${s.strong}"`
      let inner = text
      if (bold) inner = `<strong${strongStyle}>${inner}</strong>`
      if (styleParts.length) inner = `<span style="${styleParts.join(';')}">${inner}</span>`
      return inner
    })
    .join('')
}

/** 取景比 "3:4" → aspect-ratio + object-fit 裁切样式（公众号不认时自然降级为原比例） */
function frameStyle(frame: string): string {
  return frame ? `aspect-ratio:${frame.replace(':', ' / ')};object-fit:cover;` : ''
}

function galleryToHtml(attrs: FigureGalleryAttrs, resolveImg: (src: string) => string, s: Styles): string {
  const { images, layout, frame, caption } = attrs
  if (!images.length) return ''
  const cap = caption ? `<p style="${s.caption}">${escapeHtml(caption)}</p>` : ''

  if (layout === 'grid' || layout === 'stack-v') {
    // 拼图：inline-block 网格（列数与编辑器 grid 一致）；旧文档遗留的 stack-v 同样按拼图导出
    const cols = images.length <= 2 || images.length === 4 ? 2 : 3
    const width = ((100 - 2 * (cols - 1)) / cols).toFixed(2)
    const defFrame = layout === 'stack-v' ? '16:9' : '1:1'
    const cells = images
      .map((im, k) => {
        const mr = k % cols === cols - 1 ? '0' : '2%'
        return `<img src="${escapeHtml(resolveImg(im.src))}" alt="${escapeHtml(im.alt)}" style="display:inline-block;width:${width}%;margin:0 ${mr} 6px 0;border-radius:${s.imgR};vertical-align:top;${frameStyle(frame || defFrame)}">`
      })
      .join('')
    return `<section style="${S.figure}"><section style="font-size:0;line-height:0;">${cells}</section>${cap}</section>`
  }

  // swipe-h：公众号经典横滑图集
  const items = images
    .map(
      (im) =>
        `<img src="${escapeHtml(resolveImg(im.src))}" alt="${escapeHtml(im.alt)}" style="${s.swipeImg}${frameStyle(frame)}">`
    )
    .join('')
  return `<section style="${S.figure}"><section style="${S.swipeBox}">${items}</section><p style="${s.hint}">← 左右滑动查看 ${images.length} 张 →</p>${cap}</section>`
}

function blockToHtml(block: BlockNode, resolveImg: (src: string) => string, s: Styles): string {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.attrs.level, 1), 3)
      const inner = inlineToHtml(block.content, s)
      if (level === 1) {
        // 大标题：bar 短横收尾 / pill 胶囊 / underline 下划线（公众号剥伪元素故用真实 DOM 还原）
        return `<section style="${s.h1Wrap}"><h1 style="${s.h1}">${inner}</h1><div style="${s.h1Bar}"></div></section>`
      }
      if (level === 3) {
        // 前缀标记：菱形 / 圆点 / 无
        return `<h3 style="${s.h3}"><span style="${s.h3Diamond}"></span>${inner}</h3>`
      }
      return `<h2 style="${s.h2}">${inner}</h2>`
    }
    case 'paragraph': {
      const inner = inlineToHtml(block.content, s)
      return inner.trim() ? `<p style="${s.p}">${inner}</p>` : ''
    }
    case 'blockquote': {
      // quotes 风格：首行前加大引号（公众号无伪元素，用真实字符还原）
      const paras = block.content
        .map(
          (p: ParagraphNode, i: number) =>
            `<p style="${i === block.content.length - 1 ? s.quotePLast : s.quoteP}">${inlineToHtml(p.content, s)}</p>`
        )
        .join('')
      const mark = s.quoteMark
        ? `<p style="${s.quoteMark}">❝</p>`
        : ''
      return `<blockquote style="${s.blockquote}">${mark}${paras}</blockquote>`
    }
    case 'horizontalRule':
      return `<hr style="${s.hr}">`
    case 'figureImage': {
      const { src, alt, caption } = block.attrs
      const cap = caption ? `<p style="${s.caption}">${escapeHtml(caption)}</p>` : ''
      return `<section style="${S.figure}"><img src="${escapeHtml(resolveImg(src))}" alt="${escapeHtml(alt)}" style="${s.img}">${cap}</section>`
    }
    case 'figureGallery':
      return galleryToHtml(block.attrs, resolveImg, s)
    case 'table': {
      const rows = block.attrs.rows
      if (rows.length === 0) return ''
      const [header, ...body] = rows
      const head = header.length
        ? `<thead><tr>${header.map((c) => `<th style="${s.th}">${escapeHtml(c)}</th>`).join('')}</tr></thead>`
        : ''
      const tbody = body.length
        ? `<tbody>${body
            .map(
              (r, ri) =>
                `<tr>${r
                  .map(
                    (c, ci) =>
                      `<td style="${s.td}${s.tdStripe && ri % 2 === 1 ? s.tdStripe : ''}${ci === 0 && s.tdFirst ? s.tdFirst : ''}">${escapeHtml(c)}</td>`
                  )
                  .join('')}</tr>`
            )
            .join('')}</tbody>`
        : ''
      return `<table style="${s.table}">${head}${tbody}</table>`
    }
    case 'figSuggest':
      return '' // 占位卡是工作过程产物，不导出
  }
}

/** doc → 正文片段 HTML（粘贴公众号用这段；不含 <html> 外壳）；theme 为排版调性（分类调性解析结果） */
export function docToExportHtml(
  doc: ArticleDoc,
  resolveImg: (src: string) => string,
  theme?: ArticleTheme,
  uiDark?: boolean
): string {
  const s = buildStyles(theme, uiDark)
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

/**
 * 读者端自动昼夜版页面：日间/夜间两套配色都内联，靠 prefers-color-scheme 切换显示。
 * 用于部署到自有网页/博客——读者系统深色自动看夜间配色、浅色看日间配色。
 * 注意：公众号渲染器不认媒体查询，推送/复制富文本请用固定配色（二选一）。
 */
export function wrapExportPageDayNight(dayFragment: string, nightFragment: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
.art-day{display:block}
.art-night{display:none}
@media (prefers-color-scheme: dark){
  .art-day{display:none!important}
  .art-night{display:block!important}
}
</style>
</head>
<body style="margin:0;background:#fff;">
<div style="max-width:677px;margin:0 auto;padding:20px 16px 48px;">
<div class="art-day">${dayFragment}</div>
<div class="art-night">${nightFragment}</div>
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
