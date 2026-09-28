/**
 * 创作向导的步骤进度推导（纯函数，规格 docs/superpowers/specs/2026-09-28-creation-wizard-design.md §5）。
 * 完成判定全部来自工程事实、渲染时现算，零持久化向导状态——Agent 改文件、外部编辑、
 * 多窗口打开都如实反映，与选题看板「状态由工程推导」的哲学同源。
 */
import { FIG_SUGGEST_RE, splitFigDesc, type FigureGalleryNode, type FigureImageNode } from './markdown'

export type WizardStepId = 'ideas' | 'outline' | 'draft' | 'figures' | 'titlecover' | 'review' | 'export'

export interface WizardStep {
  id: WizardStepId
  label: string
  done: boolean
}

/** 推导所需的工程事实快照（App 渲染时现算，全部来自现有数据源） */
export interface WizardFacts {
  /** 已打开工程 */
  hasProject: boolean
  /** 贴图工程（meta.format === 'cards'）：步进器变 5 步、成文看卡片数 */
  isCards: boolean
  /** 本会话产出过大纲（脑暴出卡生成 / 直接出大纲 / 选题种子灌入） */
  outlineProduced: boolean
  /** 正文有实质内容（≥2 个非空行）：立项默认骨架只有一行标题，不算内容 */
  articleHasBody: boolean
  /** 贴图工程：卡片张数（文章工程忽略） */
  cardsCount: number
  /** 正文里残留的 fig-suggest 占位数（占位被替换或删除都算已处理，清零即配图步完成） */
  figSuggestCount: number
  hasCover: boolean
  hasReview: boolean
  hasExport: boolean
}

/**
 * 推导步进器步骤。文章工程 7 步；贴图工程 5 步（隐藏「配图」「导出」：
 * 卡片自带图文无逐图占位，产物即逐张 PNG 无整文导出形态）。
 */
export function deriveWizardSteps(facts: WizardFacts): WizardStep[] {
  const hasContent = facts.articleHasBody || facts.cardsCount > 0
  const draftDone = hasContent
  const steps: WizardStep[] = [
    // 选题/大纲只认「真内容」：手动新建的空工程（默认骨架不算内容）不被判为已过前两步，向导从选题开始
    { id: 'ideas', label: '选题', done: facts.outlineProduced || (facts.hasProject && hasContent) },
    { id: 'outline', label: '大纲', done: facts.hasProject && hasContent },
    { id: 'draft', label: facts.isCards ? '贴图' : '成文', done: draftDone }
  ]
  if (!facts.isCards) {
    steps.push(
      // 正文没有实质内容时谈不上「配图已处理完」，故加 articleHasBody 前置
      { id: 'figures', label: '配图', done: facts.articleHasBody && facts.figSuggestCount === 0 },
      { id: 'titlecover', label: '标题封面', done: facts.hasCover },
      { id: 'review', label: '审阅', done: facts.hasReview },
      { id: 'export', label: '导出', done: facts.hasExport }
    )
  } else {
    steps.push(
      { id: 'titlecover', label: '标题封面', done: facts.hasCover },
      { id: 'review', label: '审阅', done: facts.hasReview }
    )
  }
  return steps
}

/** 默认落点：第一个未完成步；全部完成落最后一步（打开工程即见待办） */
export function firstPendingStep(steps: WizardStep[]): number {
  const i = steps.findIndex((s) => !s.done)
  return i === -1 ? steps.length - 1 : i
}

export interface FigSuggestion {
  /** 画面描述（喂给配图管线的 prompt 素材） */
  prompt: string
  /** 图注（缺省回退描述） */
  caption: string
  /** 原始 desc（编辑器占位节点的 attrs，替换/定位用） */
  desc: string
  /** 占位所在行号（0 基；替换正文用） */
  line: number
}

/** 从 markdown 提取 fig-suggest 占位清单（按出现顺序）；配图步批量清单的数据源 */
export function parseFigSuggestions(md: string): FigSuggestion[] {
  const out: FigSuggestion[] = []
  const lines = md.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FIG_SUGGEST_RE)
    if (m) {
      const { prompt, caption } = splitFigDesc(m[1])
      out.push({ prompt, caption, desc: m[1], line: i })
    }
  }
  return out
}

/** 正文里已插入的单图（配图步「已插图」缩略图条的数据源） */
export interface FigureOccurrence {
  line: number
  src: string
  alt: string
  /** 紧随其后的 caption 注释；缺省 = 无图注 */
  caption: string
}

const IMG_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/
const CAPTION_LINE_RE = /^<!--\s*caption:\s*(.*?)\s*-->\s*$/

/** 提取正文里的单图（按出现顺序）；图集内部的图片行跳过（图集是一个整体，替换走正文） */
export function parseFigImages(md: string): FigureOccurrence[] {
  const out: FigureOccurrence[] = []
  const lines = md.split(/\r?\n/)
  let inGallery = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^<!--\s*gallery:\s/.test(line)) {
      inGallery = true
      continue
    }
    if (inGallery) {
      if (/^<!--\s*\/gallery\s*-->\s*$/.test(line)) inGallery = false
      continue
    }
    const m = line.match(IMG_LINE_RE)
    if (!m) continue
    const next = lines[i + 1]?.match(CAPTION_LINE_RE)
    out.push({ line: i, src: m[2], alt: m[1], caption: next?.[1] ?? '' })
  }
  return out
}

/** 占位/图片行替换成的新内容：单图属性（figureImage）或图集属性（figureGallery） */
export type FigReplacement = FigureImageNode['attrs'] | FigureGalleryNode['attrs']

/** 把 md 的第 lineIndex 行（占位或单图）替换为成图 markdown（序列化规则与 docToMd 同源） */
export function replaceFigSuggestion(md: string, lineIndex: number, fig: FigReplacement): string {
  const lines = md.split(/\r?\n/)
  if (lineIndex < 0 || lineIndex >= lines.length) return md
  let rep: string[]
  if ('images' in fig) {
    const body = fig.images.map((im) => `![${im.alt}](${im.src})`).join('\n')
    rep = [
      `<!-- gallery: ${fig.layout}${fig.frame ? ' ' + fig.frame : ''} -->`,
      body,
      ...(fig.caption ? [`<!-- caption: ${fig.caption} -->`] : []),
      '<!-- /gallery -->'
    ]
  } else {
    rep = [
      `![${fig.alt}](${fig.src})`,
      ...(fig.caption ? [`<!-- caption: ${fig.caption} -->`] : []),
      ...(fig.figureSource ? [`<!-- figure-source: ${fig.figureSource} -->`] : [])
    ]
  }
  lines.splice(lineIndex, 1, ...rep)
  return lines.join('\n')
}
