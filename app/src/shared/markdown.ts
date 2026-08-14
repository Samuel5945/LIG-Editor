/**
 * article.md ↔ TipTap 文档 JSON 双向转换（PRD §4 约束子集）
 * 子集：H1-H3 / 段落（含加粗、段内换行）/ 引用 / 图片+图注 / 图集轮播 / 分隔线
 * 图片扩展语法（紧跟图片行）：
 *   <!-- caption: 图注文字 -->
 *   <!-- figure-source: figures/fig-1.html -->
 * 图集语法（多图轮播，布局 swipe-h 左右滑 / grid 拼图，可选统一取景比）：
 *   <!-- gallery: swipe-h 3:4 -->
 *   ![alt](assets/a.png)
 *   ![alt](assets/b.png)
 *   <!-- caption: 图注 -->
 *   <!-- /gallery -->
 * 目标：子集内的文档「md → doc → md」往返无损
 */

// ---------- TipTap JSON 结构 ----------

export interface TextNode {
  type: 'text'
  text: string
  marks?: TextMark[]
}

/** 行内 mark：加粗 / 手动样式（字体色、背景高亮、字号） */
export type TextMark = { type: 'bold' } | TextStyleMark

/** 手动样式 mark：选中片段自定义字体色 / 背景高亮 / 字号（md 用内联 span style 往返） */
export interface TextStyleMark {
  type: 'textStyle'
  color?: string
  bg?: string
  fontSize?: number
}

export interface HardBreakNode {
  type: 'hardBreak'
}

export type InlineNode = TextNode | HardBreakNode

export interface ParagraphNode {
  type: 'paragraph'
  content?: InlineNode[]
}

export interface HeadingNode {
  type: 'heading'
  attrs: { level: number }
  content?: InlineNode[]
}

export interface BlockquoteNode {
  type: 'blockquote'
  content: ParagraphNode[]
}

export interface HorizontalRuleNode {
  type: 'horizontalRule'
}

export interface FigureImageNode {
  type: 'figureImage'
  attrs: {
    src: string
    alt: string
    caption: string
    figureSource: string
  }
}

/** 配图建议占位：<!-- fig-suggest: 描述 -->（M6 三管线入口） */
export interface FigSuggestNode {
  type: 'figSuggest'
  attrs: { desc: string }
}

/**
 * 拆分 fig-suggest 描述：「详细画面描述 | 简短图注」按首个分隔符（兼容全角｜）拆两段；
 * 无分隔符的旧占位两者同源
 */
export function splitFigDesc(desc: string): { prompt: string; caption: string } {
  const m = desc.match(/^(.*?)[|｜](.*)$/s)
  if (!m) return { prompt: desc.trim(), caption: desc.trim() }
  const prompt = m[1].trim()
  const caption = m[2].trim()
  return { prompt: prompt || caption, caption: caption || prompt }
}

// ---------- 图集轮播（多图导入） ----------

export interface GalleryImage {
  src: string
  alt: string
}

export interface FigureGalleryAttrs {
  /** 2-6 张图 */
  images: GalleryImage[]
  /** swipe-h 左右滑动轮播 | grid 拼图同时展示（旧文档遗留的 stack-v 按 grid 处理） */
  layout: string
  /** 统一取景框比例（如 3:4）；空 = 每张自适应 */
  frame: string
  caption: string
}

export interface FigureGalleryNode {
  type: 'figureGallery'
  attrs: FigureGalleryAttrs
}

/** 表格（GFM pipe 语法：首行表头 + 分隔行 + 数据行） */
export interface TableNode {
  type: 'table'
  attrs: { rows: string[][] }
}

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BlockquoteNode
  | HorizontalRuleNode
  | FigureImageNode
  | FigSuggestNode
  | FigureGalleryNode
  | TableNode

export interface ArticleDoc {
  type: 'doc'
  content: BlockNode[]
}

// ---------- 行内：md 文本 ↔ inline 节点 ----------

/**
 * 解析内联 `<span style="color:#f00;background-color:#ff0;font-size:18px">` 前缀。
 * 返回 { attrs, rest }；非 span 或 style 无可识别属性返回 null。
 */
function parseSpanStyle(text: string): { attrs: TextStyleMark; rest: string } | null {
  const m = /^<span\s+style=["']([^"']*)["']\s*>/i.exec(text)
  if (!m) return null
  const style: TextStyleMark = { type: 'textStyle' }
  const parts = m[1].split(';')
  for (const seg of parts) {
    const i = seg.indexOf(':')
    if (i < 0) continue
    const k = seg.slice(0, i).trim().toLowerCase()
    const v = seg.slice(i + 1).trim()
    if (!v) continue
    if (k === 'color') style.color = v
    else if (k === 'background-color' || k === 'background') style.bg = v
    else if (k === 'font-size') {
      const px = /^(\d+(?:\.\d+)?)px$/.exec(v)
      if (px) style.fontSize = Math.round(Number(px[1]))
    }
  }
  if (!style.color && !style.bg && !style.fontSize) return null
  return { attrs: style, rest: text.slice(m[0].length) }
}

/** 把行内 mark 序列化为 md 片段（textStyle 用内联 span，bold 用 **） */
function inlineToMdNode(n: TextNode): string {
  const ts = n.marks?.find((mk): mk is TextStyleMark => mk.type === 'textStyle')
  const bold = n.marks?.some((mk) => mk.type === 'bold')
  let inner = bold ? `**${n.text}**` : n.text
  if (ts && (ts.color || ts.bg || ts.fontSize)) {
    const parts: string[] = []
    if (ts.color) parts.push(`color:${ts.color}`)
    if (ts.bg) parts.push(`background-color:${ts.bg}`)
    if (ts.fontSize) parts.push(`font-size:${ts.fontSize}px`)
    inner = `<span style="${parts.join(';')}">${inner}</span>`
  }
  return inner
}

/** 解析一段（可能多行）文本为 inline 节点；行间转 hardBreak */
export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'hardBreak' })
    // 内联 span 样式 + **bold** 混合切分；未闭合的按普通文本保留
    let rest = line
    while (rest.length > 0) {
      // span 不一定要在行首：先定位 <span，前面普通文本直接解析
      const spIdx = rest.indexOf('<span ')
      if (spIdx < 0) break
      if (spIdx > 0) {
        out.push(...parseInlineText(rest.slice(0, spIdx)))
        rest = rest.slice(spIdx)
      }
      const sp = parseSpanStyle(rest)
      if (!sp) {
        // 形如 <span 但不是可识别样式（如 <span leaf>）：按普通文本处理剩余
        out.push(...parseInlineText(rest))
        rest = ''
        break
      }
      const closeRe = /<\/span>/i
      const close = closeRe.exec(sp.rest)
      if (!close) {
        out.push({ type: 'text', text: rest })
        rest = ''
        break
      }
      const innerText = sp.rest.slice(0, close.index)
      const tail = sp.rest.slice(close.index + close[0].length)
      const innerNodes = parseInlineText(innerText)
      // 给 inner 的文本节点叠加 textStyle mark
      for (const nd of innerNodes) {
        if (nd.type === 'text') {
          const merged: TextMark[] = [...(nd.marks ?? []), sp.attrs]
          out.push({ ...nd, marks: merged })
        } else {
          out.push(nd)
        }
      }
      rest = tail
    }
    if (rest.length > 0) {
      out.push(...parseInlineText(rest))
    }
  })
  return out
}

/** 无 span 的普通行内解析：**bold** 切分；未闭合的 ** 按普通文本保留 */
function parseInlineText(text: string): InlineNode[] {
  const out: InlineNode[] = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    out.push({ type: 'text', text: m[1], marks: [{ type: 'bold' }] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

export function inlineToMd(content: InlineNode[] | undefined): string {
  if (!content) return ''
  return content
    .map((n) => {
      if (n.type === 'hardBreak') return '\n'
      return inlineToMdNode(n)
    })
    .join('')
}

// ---------- md → doc ----------

const IMG_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/
const CAPTION_RE = /^<!--\s*caption:\s*(.*?)\s*-->\s*$/
const FIG_SOURCE_RE = /^<!--\s*figure-source:\s*(.*?)\s*-->\s*$/
const FIG_SUGGEST_RE = /^<!--\s*fig-suggest:\s*(.*?)\s*-->\s*$/
const GALLERY_START_RE = /^<!--\s*gallery:\s*([\w-]+)(?:\s+(\d+:\d+))?\s*-->\s*$/
const GALLERY_END_RE = /^<!--\s*\/gallery\s*-->\s*$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/
const HR_RE = /^(-{3,}|\*{3,})\s*$/

// ---------- 表格（GFP pipe 语法） ----------

/** 表格行：以 | 开头且以 | 结尾（含前后空白） */
function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}

/** 分隔行：|---|:---:|---|（纯 - : | 空格组成） */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && /-/.test(line)
}

/** 表格起始：当前行是表格行（是否为表头由分隔行决定） */
function isTableStart(line: string): boolean {
  return isTableRow(line) && !isTableSeparator(line)
}

/** 拆表格行：去首尾 |，按 | 切分并 trim */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

export function mdToDoc(md: string): ArticleDoc {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: BlockNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    // 标题
    const h = HEADING_RE.exec(line)
    if (h) {
      blocks.push({
        type: 'heading',
        attrs: { level: Math.min(h[1].length, 3) },
        content: parseInline(h[2])
      })
      i++
      continue
    }

    // 分隔线
    if (HR_RE.test(line.trim())) {
      blocks.push({ type: 'horizontalRule' })
      i++
      continue
    }

    // 引用块：连续 > 行；「> 」空行分段
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      const paras: ParagraphNode[] = []
      let buf: string[] = []
      const flush = (): void => {
        if (buf.length) {
          paras.push({ type: 'paragraph', content: parseInline(buf.join('\n')) })
          buf = []
        }
      }
      for (const ql of quoteLines) {
        if (ql.trim() === '') flush()
        else buf.push(ql)
      }
      flush()
      blocks.push({ type: 'blockquote', content: paras })
      continue
    }

    // 表格：GFM pipe 语法（首行表头 + 分隔行 + 数据行）
    if (isTableStart(line)) {
      const rows: string[][] = []
      let header: string[] | null = null
      let k = i
      let first = true
      while (k < lines.length && isTableRow(lines[k])) {
        const cells = splitTableRow(lines[k])
        if (first && k + 1 < lines.length && isTableSeparator(lines[k + 1])) {
          header = cells
          k += 2
          first = false
          continue
        }
        rows.push(cells)
        k++
        first = false
      }
      const tableRows = header ? [header, ...rows] : rows
      if (tableRows.length > 0) {
        blocks.push({ type: 'table', attrs: { rows: tableRows } })
        i = k
        continue
      }
    }

    // 配图建议占位（独立成行）
    const sug = FIG_SUGGEST_RE.exec(line)
    if (sug) {
      blocks.push({ type: 'figSuggest', attrs: { desc: sug[1] } })
      i++
      continue
    }

    // 图集轮播块：起止注释之间收集图片行与图注
    const gal = GALLERY_START_RE.exec(line)
    if (gal) {
      const images: GalleryImage[] = []
      let caption = ''
      i++
      while (i < lines.length && !GALLERY_END_RE.test(lines[i])) {
        const im = IMG_RE.exec(lines[i])
        if (im) images.push({ alt: im[1], src: im[2] })
        else {
          const cap = CAPTION_RE.exec(lines[i])
          if (cap) caption = cap[1]
        }
        i++
      }
      if (i < lines.length) i++ // 吃掉 <!-- /gallery -->
      blocks.push({
        type: 'figureGallery',
        attrs: { images, layout: gal[1], frame: gal[2] ?? '', caption }
      })
      continue
    }

    // 图片（独立成行）+ 紧随的 caption / figure-source 注释
    const img = IMG_RE.exec(line)
    if (img) {
      let caption = ''
      let figureSource = ''
      i++
      while (i < lines.length) {
        const cap = CAPTION_RE.exec(lines[i])
        if (cap) {
          caption = cap[1]
          i++
          continue
        }
        const fig = FIG_SOURCE_RE.exec(lines[i])
        if (fig) {
          figureSource = fig[1]
          i++
          continue
        }
        break
      }
      blocks.push({
        type: 'figureImage',
        attrs: { src: img[2], alt: img[1], caption, figureSource }
      })
      continue
    }

    // 段落：连续非空普通行合并（行间 hardBreak），遇块级语法行终止
    const buf: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING_RE.test(lines[i]) &&
      !HR_RE.test(lines[i].trim()) &&
      !lines[i].startsWith('>') &&
      !IMG_RE.test(lines[i]) &&
      !FIG_SUGGEST_RE.test(lines[i]) &&
      !GALLERY_START_RE.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', content: parseInline(buf.join('\n')) })
  }

  return { type: 'doc', content: blocks }
}

// ---------- doc → md ----------

export function docToMd(doc: ArticleDoc): string {
  const parts: string[] = []

  for (const block of doc.content ?? []) {
    switch (block.type) {
      case 'heading':
        parts.push('#'.repeat(block.attrs.level) + ' ' + inlineToMd(block.content))
        break
      case 'paragraph': {
        const text = inlineToMd(block.content)
        if (text.trim() !== '') parts.push(text)
        break
      }
      case 'blockquote': {
        const inner = block.content
          .map((p) => inlineToMd(p.content))
          .join('\n\n')
        parts.push(
          inner
            .split('\n')
            .map((l) => (l === '' ? '>' : '> ' + l))
            .join('\n')
        )
        break
      }
      case 'horizontalRule':
        parts.push('---')
        break
      case 'figureImage': {
        const { src, alt, caption, figureSource } = block.attrs
        let s = `![${alt}](${src})`
        if (caption) s += `\n<!-- caption: ${caption} -->`
        if (figureSource) s += `\n<!-- figure-source: ${figureSource} -->`
        parts.push(s)
        break
      }
      case 'figSuggest':
        parts.push(`<!-- fig-suggest: ${block.attrs.desc} -->`)
        break
      case 'figureGallery': {
        const { images, layout, frame, caption } = block.attrs
        const body = images.map((im) => `![${im.alt}](${im.src})`).join('\n')
        let s = `<!-- gallery: ${layout}${frame ? ' ' + frame : ''} -->\n${body}`
        if (caption) s += `\n<!-- caption: ${caption} -->`
        s += '\n<!-- /gallery -->'
        parts.push(s)
        break
      }
      case 'table': {
        const rows = block.attrs.rows
        if (rows.length === 0) break
        // 首行作表头 + 分隔行，其余数据行
        const header = rows[0]
        const body = rows.slice(1)
        const sep = header.map(() => '---').join(' | ')
        parts.push(
          ['| ' + header.join(' | ') + ' |', '| ' + sep + ' |', ...body.map((r) => '| ' + r.join(' | ') + ' |')].join(
            '\n'
          )
        )
        break
      }
    }
  }

  return parts.join('\n\n') + (parts.length ? '\n' : '')
}
