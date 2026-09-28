/**
 * 创作向导的步骤进度推导（纯函数，规格 docs/superpowers/specs/2026-09-28-creation-wizard-design.md §5）。
 * 完成判定全部来自工程事实、渲染时现算，零持久化向导状态——Agent 改文件、外部编辑、
 * 多窗口打开都如实反映，与选题看板「状态由工程推导」的哲学同源。
 */
import { FIG_SUGGEST_RE, splitFigDesc } from './markdown'

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
  /** 正文非空（贴图工程忽略此值，改看 cardsCount） */
  articleNonEmpty: boolean
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
  const draftDone = facts.isCards ? facts.cardsCount > 0 : facts.articleNonEmpty
  const steps: WizardStep[] = [
    { id: 'ideas', label: '选题', done: facts.outlineProduced || facts.hasProject },
    { id: 'outline', label: '大纲', done: facts.hasProject },
    { id: 'draft', label: facts.isCards ? '贴图' : '成文', done: draftDone }
  ]
  if (!facts.isCards) {
    steps.push(
      // 正文尚未写出时谈不上「配图已处理完」，故加 articleNonEmpty 前置
      { id: 'figures', label: '配图', done: facts.articleNonEmpty && facts.figSuggestCount === 0 },
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
}

/** 从 markdown 提取 fig-suggest 占位清单（按出现顺序）；配图步批量清单的数据源 */
export function parseFigSuggestions(md: string): FigSuggestion[] {
  const out: FigSuggestion[] = []
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(FIG_SUGGEST_RE)
    if (m) {
      const { prompt, caption } = splitFigDesc(m[1])
      out.push({ prompt, caption, desc: m[1] })
    }
  }
  return out
}
