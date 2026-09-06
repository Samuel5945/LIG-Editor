/**
 * 交稿导出（Word）：article 文档 → 可继续编辑的 .docx
 *
 * 定位：与公众号排版导出（exportHtml）不同，交稿产物面向「甲方审稿 / 投稿存档 / 二次编辑」，
 * 因此不做营销装饰（编号贴纸/双色标题卡/分隔符/配图占位卡），只保留文章语义与可读性：
 *   - 标题 → Word 原生 Heading（可用导航窗格 / 大纲视图定位）
 *   - 正文 → 1.5 倍行距、两端对齐、可选首行缩进（干净可改）
 *   - 加粗 / 字色 / 高亮 / 手动字号 → 真实 run 属性（bold / color / shading / size）
 *   - 引用 → 左缩进 + 主题色左边线；分隔线 → 细底边线；表格 → Word 真表格
 *   - 图片 → 按实际像素插入（本地缺文件 / 网络图按占位段落跳过，不中断导出）
 *   - 封面（project.json cover.main）→ 文档首页整幅图（可选）
 *   - 忽略：fig-suggest 占位卡（工作过程产物）
 *
 * 中文规范：字号用磅（pt）体系——正文小四 12pt、标题逐级放大、图注小五 9pt；
 * 编辑器内联手动字号 px 按 16px=12pt 换算到 0.5pt。默认字体 eastAsia 微软雅黑、
 * ascii Calibri（Word 打开后按字体名匹配本机字体，不依赖随包安装）。
 *
 * 纯 Node 无 Electron 依赖，主进程 / 单测直接调用。图片尺寸用 sharp 异步取。
 */
import { existsSync, readFileSync } from 'fs'
import { join, normalize } from 'path'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from 'docx'
import type { ArticleDoc, InlineNode } from '../shared/markdown'
import { textStyleAttrs } from '../shared/markdown'
import { isHexColor } from '../shared/cards'

// ---------- 常量 ----------

const ASCII_FONT = 'Calibri'
const EA_FONT = '微软雅黑'
/** 正文基准字号 pt（小四） */
const BASE_PT = 12
/** 正文半磅值（docx size 单位是半磅：24 = 12pt） */
const BASE_HALF = BASE_PT * 2
/** A4 半磅宽高 */
const PAGE_W = 11906
const PAGE_H = 16838
/** 页边距 2.54cm（1440 twips） */
const PAGE_MARGIN = 1440
/** 内容可排宽度 twips */
const CONTENT_TWIPS = PAGE_W - PAGE_MARGIN * 2
/** 1px ≈ 15 twips @96dpi → 内容宽 px（图片最大宽） */
const CONTENT_PX = CONTENT_TWIPS / 15
/** 标题字色 / 正文颜色（docx 接受无 # 的 rrggbb） */
const HEADING_TEXT = '1f2937'
const BODY_TEXT = '333333'
const DEFAULT_ACCENT = '#2563eb'

/** #rrggbb → rrggbb；非法回退 fallback（无 #） */
function docxHex(hex: string | undefined | null, fallback: string): string {
  const h = hex?.trim()
  return h && isHexColor(h) ? h.slice(1) : fallback
}

/** 编辑器字号 px → pt：16px=12pt 基准，四舍五入到 0.5pt（Word 磅值需 0.5 的倍数） */
function pxToPt(px: number): number {
  const pt = (px * BASE_PT) / 16
  return Math.max(8, Math.min(36, Math.round(pt * 2) / 2))
}

/** 纯十六进制色带 # → run 的颜色/高亮属性值；不合法则 undefined（不覆盖主题） */
function runColor(hex: string | undefined): string | undefined {
  return hex && isHexColor(hex) ? hex.slice(1) : undefined
}

// ---------- 扫描结构（纯函数，供单测断言） ----------

export interface DocxRun {
  text: string
  bold?: boolean
  /** hex 字色（#rrggbb） */
  color?: string
  /** hex 高亮底（#rrggbb） */
  shading?: string
  /** 字号 pt */
  size?: number
  /** true = 该 run 后接段内换行（hardBreak） */
  break?: boolean
}

export interface DocxTable {
  header: string[]
  rows: string[][]
}

export interface StructBlock {
  kind: 'title' | 'h2' | 'h3' | 'p' | 'quote' | 'hr' | 'image' | 'table' | 'skip'
  runs: DocxRun[]
  align?: 'center' | 'left'
  /** 正文段首行缩进（bodyAlign=indent 时） */
  firstLine?: boolean
  /** kind=image：本地图绝对路径 */
  imageAbs?: string
  caption?: string
  table?: DocxTable
}

export interface StructResult {
  title: string
  blocks: StructBlock[]
  /** true = 没有可导出的正文（空工程 / 全是 fig-suggest / 纯装饰） */
  empty: boolean
}

/** 手工序号前缀（中文/大写/数字/圈号 + 顿号点空格） */
const SEQ_RE = /^(?:[一二三四五六七八九十百]{1,4}[、.．]|[壹贰叁肆伍陆柒捌玖拾]{1,4}[、.．]|\d{1,2}[.、．]|[①-⑳])/
/** 纯序号 / 纯 emoji 的「装饰段」：编辑器渲染语汇，交稿时跳过 */
function isDecorative(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (
    t.length <= 3 &&
    SEQ_RE.test(t) &&
    /^[\d一二三四五六七八九十百壹贰叁肆伍陆柒捌玖拾①-⑳、.．\s]+$/.test(t)
  )
    return true
  const m = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.exec(t)
  if (!m) return false
  return t.slice(m[0].length).trim().length === 0
}

function nodeText(n: InlineNode): string {
  return n.type === 'text' ? n.text : ' '
}

function inlineText(content: InlineNode[] | undefined): string {
  return (content ?? []).map(nodeText).join('').trim()
}

function toRuns(content: InlineNode[] | undefined): DocxRun[] {
  const out: DocxRun[] = []
  for (const n of content ?? []) {
    if (n.type === 'hardBreak') {
      const last = out[out.length - 1]
      if (last?.text) last.break = true
      continue
    }
    const bold = n.marks?.some((mk) => mk.type === 'bold')
    const ts = n.marks?.find((mk) => mk.type === 'textStyle')
    const a = ts ? textStyleAttrs(ts) : undefined
    const r: DocxRun = { text: n.text, bold: bold || undefined }
    if (a?.color && isHexColor(a.color)) r.color = a.color.trim()
    if (a?.bg && isHexColor(a.bg)) r.shading = a.bg.trim()
    if (a?.fontSize) r.size = pxToPt(a.fontSize)
    out.push(r)
  }
  return out
}

function runsHaveText(runs: DocxRun[]): boolean {
  return runs.some((r) => r.text.trim().length > 0)
}

function plainRuns(text: string): DocxRun[] {
  return text ? [{ text }] : []
}

export interface ScanTheme {
  accent?: string
  /** 正文排列：indent 首行缩进 / flush 两端对齐（顶格）/ center 全文居中 */
  bodyAlign?: 'indent' | 'flush' | 'center'
  strongStyle?: 'color' | 'highlight' | 'plain'
  strongColor?: string
  strongBg?: string
}

/** 主题加粗强调 → 交稿 run 真实属性（color 着色 / highlight 底色 / plain 纯黑）。显式手动字色优先不覆盖 */
function applyStrong(runs: DocxRun[], t: Required<ScanTheme>): void {
  if (t.strongStyle === 'plain') return
  for (const r of runs) {
    if (!r.bold || r.color) continue
    if (t.strongStyle === 'color') r.color = t.strongColor
    else if (t.strongStyle === 'highlight') r.shading = t.strongBg
  }
}

/**
 * 全文档结构扫描：md doc → 交稿中间结构。
 * 图片块只记录本地绝对路径（尺寸留给 build 阶段异步取）。
 * @param titleFallback 无 H1 时的文档标题（工程名）
 * @param resolveAbs md 图片相对路径 → 工程内绝对路径；返回 undefined 表示图源不可用
 */
export function scanStructure(
  doc: ArticleDoc,
  titleFallback: string,
  theme: ScanTheme = {},
  resolveAbs?: (rel: string) => string | undefined
): StructResult {
  const accent = theme.accent && isHexColor(theme.accent) ? theme.accent.trim() : DEFAULT_ACCENT
  const t: Required<ScanTheme> = {
    accent,
    bodyAlign: theme.bodyAlign ?? 'flush',
    strongStyle: theme.strongStyle ?? 'color',
    strongColor: theme.strongColor && isHexColor(theme.strongColor) ? theme.strongColor.trim() : accent,
    strongBg: theme.strongBg && isHexColor(theme.strongBg) ? theme.strongBg.trim() : '#fef3c7'
  }
  // 标题：首个 H1 文本；无 H1 回退工程名
  let title = titleFallback
  for (const b of doc.content ?? []) {
    if (b.type === 'heading' && b.attrs.level === 1) {
      const h = inlineText(b.content)
      if (h) {
        title = h
        break
      }
    }
  }

  const blocks: StructBlock[] = []
  const bodyAlign = t.bodyAlign
  const headingAlign = bodyAlign === 'center' ? 'center' : 'left'
  const pushText = (runs: DocxRun[], kind: StructBlock['kind'], o: Partial<StructBlock> = {}): void => {
    blocks.push({ runs, kind, ...o })
  }
  const imgAbs = (rel: string): string | undefined => (resolveAbs ? resolveAbs(rel) : undefined)

  for (const b of doc.content ?? []) {
    switch (b.type) {
      case 'heading': {
        const level = Math.min(Math.max(b.attrs.level, 1), 3)
        const runs = toRuns(b.content)
        if (level === 1) pushText(runs, 'title', { align: 'center' })
        else pushText(runs, level === 2 ? 'h2' : 'h3', { align: headingAlign })
        break
      }
      case 'paragraph': {
        const full = inlineText(b.content)
        if (!full || isDecorative(full)) {
          blocks.push({ runs: [], kind: 'skip' })
          break
        }
        const runs = toRuns(b.content)
        applyStrong(runs, t)
        pushText(runs, 'p', {
          align: bodyAlign === 'center' ? 'center' : undefined,
          firstLine: bodyAlign === 'indent'
        })
        break
      }
      case 'blockquote': {
        const runs: DocxRun[] = []
        b.content.forEach((p, i) => {
          const pr = toRuns(p.content)
          applyStrong(pr, t)
          if (i > 0 && pr.length) pr[0].break = true
          runs.push(...pr)
        })
        if (runsHaveText(runs)) pushText(runs, 'quote')
        break
      }
      case 'horizontalRule':
        blocks.push({ runs: [], kind: 'hr' })
        break
      case 'figureImage': {
        const abs = b.attrs.src ? imgAbs(b.attrs.src) : undefined
        if (abs) pushText([], 'image', { imageAbs: abs, caption: b.attrs.caption || undefined })
        else
          pushText(
            plainRuns(
              `【图片：${b.attrs.alt || b.attrs.caption || '未命名图片'}（导出时未找到本地图片文件，请在正文插图）】`
            ),
            'p'
          )
        break
      }
      case 'figureGallery': {
        b.attrs.images.forEach((im, k) => {
          const abs = im.src ? imgAbs(im.src) : undefined
          if (abs) {
            // 图注只挂在整组最后一张图下，避免 grid/swipe 每张重复
            const cap = k === b.attrs.images.length - 1 ? b.attrs.caption : undefined
            pushText([], 'image', { imageAbs: abs, caption: cap })
          } else {
            pushText(
              plainRuns(`【图片：${im.alt || b.attrs.caption || `第 ${k + 1} 张`}（导出时未找到本地图片文件，请在正文插图）】`),
              'p'
            )
          }
        })
        break
      }
      case 'table': {
        const rows = b.attrs.rows
        if (!rows.length) break
        const [header, ...body] = rows
        pushText([], 'table', {
          table: {
            header: header.map((c) => c ?? ''),
            rows: body.map((r) => r.map((c) => c ?? ''))
          }
        })
        break
      }
      case 'figSuggest':
        break // 配图建议占位卡：工作过程产物，不导出
    }
  }

  const empty = !blocks.some((bl) => bl.kind !== 'skip')
  return { title, blocks, empty }
}

/** md 图片相对路径（如 assets/a.png）→ 工程内绝对路径；越界 / 不存在返回 undefined */
export function resolveProjectImage(projectDirAbs: string, rel: string): string | undefined {
  if (!rel || /^(?:https?:|data:)/.test(rel)) return undefined
  const root = normalize(projectDirAbs)
  const abs = normalize(join(root, rel.replace(/\//g, '\\')))
  if (!abs.toLowerCase().startsWith(root.toLowerCase() + '\\')) return undefined
  return existsSync(abs) ? abs : undefined
}

// ---------- 构建 docx ----------

interface Ctx {
  accentHex: string // rrggbb
  captionSeq: number
}

function titleParagraph(runs: DocxRun[]): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 300, line: 360, lineRule: LineRuleType.AUTO },
    children: runs.map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: true,
          size: 48, // 24pt
          color: runColor(r.color) ?? HEADING_TEXT,
          ...(r.break ? { break: 1 } : {})
        })
    )
  })
}

function headingParagraph(
  runs: DocxRun[],
  level: 'h2' | 'h3',
  accentHex: string,
  align: 'center' | 'left'
): Paragraph {
  const sizeHalf = level === 'h2' ? 30 : 26 // 15pt / 13pt
  const children = runs.map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: true,
        size: sizeHalf,
        color: runColor(r.color) ?? HEADING_TEXT,
        ...(r.break ? { break: 1 } : {})
      })
  )
  return new Paragraph({
    children,
    heading: level === 'h2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    alignment: align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: {
      before: level === 'h2' ? 400 : 260,
      after: level === 'h2' ? 200 : 120,
      line: 360,
      lineRule: LineRuleType.AUTO
    },
    // H2 主题色左竖条（小节识别）；H3 无装饰
    ...(level === 'h2' ? { border: { left: { style: BorderStyle.SINGLE, size: 24, color: accentHex, space: 6 } } } : {}),
    indent: level === 'h2' ? { left: 140 } : undefined
  })
}

function bodyRun(r: DocxRun, baseHalf: number): TextRun {
  return new TextRun({
    text: r.text,
    bold: r.bold || undefined,
    size: r.size ? Math.round(r.size * 2) : baseHalf,
    color: r.color ? runColor(r.color) : undefined,
    shading: r.shading ? { type: ShadingType.CLEAR, fill: runColor(r.shading) ?? 'FFFF00', color: 'auto' } : undefined,
    ...(r.break ? { break: 1 } : {})
  })
}

function bodyParagraph(runs: DocxRun[], o: { align?: 'center'; firstLine?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: runs.map((r) => bodyRun(r, BASE_HALF)),
    alignment: o.align === 'center' ? AlignmentType.CENTER : AlignmentType.BOTH,
    spacing: { after: 160, line: 360, lineRule: LineRuleType.AUTO },
    indent: o.firstLine ? { firstLine: 480 } : undefined // 首行缩进 2 字符（≈24pt）
  })
}

function quoteParagraph(runs: DocxRun[], accentHex: string): Paragraph {
  return new Paragraph({
    children: runs.map((r) => bodyRun(r, BASE_HALF)),
    alignment: AlignmentType.BOTH,
    spacing: { before: 40, after: 200, line: 360, lineRule: LineRuleType.AUTO },
    indent: { left: 420 },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: accentHex, space: 8 } }
  })
}

function hrParagraph(): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 1 } }
  })
}

function captionParagraph(text: string, seq: number): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 200, line: 300, lineRule: LineRuleType.AUTO },
    children: [
      new TextRun({
        text: `图 ${seq}｜${text}`,
        size: 18, // 9pt
        color: '6B7280'
      })
    ]
  })
}

/** 图片类型：仅 PNG/JPG 可嵌入（docx 支持 gif/bmp，但编辑器图片基本是这两种） */
function imageTypeOf(absPath: string): 'png' | 'jpg' | undefined {
  if (/\.png$/i.test(absPath)) return 'png'
  if (/\.jpe?g$/i.test(absPath)) return 'jpg'
  return undefined
}

async function imageParagraphs(absPath: string, caption: string | undefined, ctx: Ctx): Promise<Paragraph[]> {
  const type = imageTypeOf(absPath)
  const buf = readFileSync(absPath)
  if (!type) {
    return [
      bodyParagraph(
        plainRuns(`【图片：${absPath.split(/[\\/]/).pop()} 为不支持的格式，请转存 PNG/JPG 后重新导出】`)
      )
    ]
  }
  const { default: sharp } = await import('sharp')
  const meta = await sharp(absPath).metadata()
  if (!meta.width || !meta.height) {
    return [bodyParagraph(plainRuns(`【图片：${absPath.split(/[\\/]/).pop()} 读取尺寸失败，导出时已跳过】`))]
  }
  const scale = Math.min(1, CONTENT_PX / meta.width)
  const w = Math.round(meta.width * scale)
  const h = Math.round(meta.height * scale)
  const out: Paragraph[] = [
    new Paragraph({
      children: [new ImageRun({ type, data: buf, transformation: { width: w, height: h } })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 60, line: 300, lineRule: LineRuleType.AUTO }
    })
  ]
  if (caption) {
    ctx.captionSeq += 1
    out.push(captionParagraph(caption, ctx.captionSeq))
  }
  return out
}

function cellParagraphs(text: string): Paragraph[] {
  return text
    ? [bodyParagraph(plainRuns(text))]
    : [new Paragraph({ children: [new TextRun({ text: '', size: 18 })] })]
}

function tableToDocx(table: DocxTable): Table {
  const { header, rows } = table
  const maxCols = Math.max(1, header.length, ...rows.map((r) => r.length))
  const colTwips = Math.floor(CONTENT_TWIPS / maxCols)
  const border = { style: BorderStyle.SINGLE, size: 4, color: '9CA3AF' }
  const mkCell = (text: string, isHead: boolean): TableCell =>
    new TableCell({
      children: cellParagraphs(text),
      shading: isHead ? { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      verticalAlign: VerticalAlign.CENTER,
      borders: { top: border, bottom: border, left: border, right: border }
    })
  return new Table({
    rows: [
      new TableRow({ tableHeader: true, children: Array.from({ length: maxCols }, (_, i) => mkCell(header[i] ?? '', true)) }),
      ...rows.map(
        (r) => new TableRow({ children: Array.from({ length: maxCols }, (_, i) => mkCell(r[i] ?? '', false)) })
      )
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: maxCols }, () => colTwips)
  })
}

async function coverParagraph(absPath: string): Promise<Paragraph | null> {
  try {
    const type = imageTypeOf(absPath)
    if (!type) return null
    const { default: sharp } = await import('sharp')
    const meta = await sharp(absPath).metadata()
    const buf = readFileSync(absPath)
    if (!meta.width || !meta.height) return null
    const scale = Math.min(1, (CONTENT_PX * 0.92) / meta.width)
    return new Paragraph({
      children: [
        new ImageRun({ type, data: buf, transformation: { width: Math.round(meta.width * scale), height: Math.round(meta.height * scale) } })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 }
    })
  } catch {
    return null // 封面缺失/异常不阻断正文
  }
}

/**
 * 生成 .docx Document。
 * @param projectDirAbs 工程目录绝对路径（正文图片基于它解析）
 * @param titleFallback 无 H1 时的标题（工程名）
 */
export async function makeDocxDocument(
  doc: ArticleDoc,
  projectDirAbs: string,
  titleFallback: string,
  theme: ScanTheme = {},
  coverAbs?: string
): Promise<Document> {
  const struct = scanStructure(doc, titleFallback, theme, (rel) => resolveProjectImage(projectDirAbs, rel))
  if (struct.empty) throw new Error('正文为空，没有可导出的内容（请先在编辑器中写入正文）')
  const accentHex = docxHex(theme.accent, '2563eb')
  const ctx: Ctx = { accentHex, captionSeq: 0 }
  const children: (Paragraph | Table)[] = []
  const cover = coverAbs ? await coverParagraph(coverAbs) : null
  if (cover) children.push(cover)
  for (const b of struct.blocks) {
    switch (b.kind) {
      case 'title':
        children.push(titleParagraph(b.runs))
        break
      case 'h2':
      case 'h3':
        children.push(headingParagraph(b.runs, b.kind, accentHex, b.align === 'center' ? 'center' : 'left'))
        break
      case 'p':
        if (runsHaveText(b.runs))
          children.push(bodyParagraph(b.runs, { align: b.align === 'center' ? 'center' : undefined, firstLine: b.firstLine }))
        break
      case 'quote':
        if (runsHaveText(b.runs)) children.push(quoteParagraph(b.runs, accentHex))
        break
      case 'hr':
        children.push(hrParagraph())
        break
      case 'image':
        if (b.imageAbs) children.push(...(await imageParagraphs(b.imageAbs, b.caption, ctx)))
        break
      case 'table':
        if (b.table) children.push(tableToDocx(b.table))
        break
      case 'skip':
        break
    }
  }

  return new Document({
    creator: '立格编辑器',
    title: struct.title,
    styles: {
      default: {
        document: {
          run: { font: { ascii: ASCII_FONT, eastAsia: EA_FONT, hAnsi: ASCII_FONT }, size: BASE_HALF, color: BODY_TEXT },
          paragraph: { spacing: { after: 160, line: 360, lineRule: LineRuleType.AUTO } }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN }
          }
        },
        children
      }
    ]
  })
}

/** 序列化 docx → Buffer（落盘用） */
export async function packDocx(doc: Document): Promise<Buffer> {
  return Packer.toBuffer(doc)
}
