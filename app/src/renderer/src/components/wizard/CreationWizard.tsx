import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { confirmAction } from '../../confirm'
import type { ContentPart, IdeaCard, ProjectMeta, WebSearchResult } from '@shared/types'
import { CARD_FORMAT_LABEL, parseCardItems, type CardFormat } from '@shared/cards'
import { sanitizeProjectName } from '@shared/projectName'
import {
  deriveWizardSteps,
  firstPendingStep,
  parseFigImages,
  parseFigSuggestions,
  type FigureOccurrence,
  type WizardFacts,
  type WizardStepId
} from '@shared/wizardProgress'
import { chatOnce, extractJsonArray } from '../../copilot/llm'
import { brainstormMessages, outlineMessages, fullArticleMessages, cardsMessages, teardownMessages } from '../../copilot/prompts'
import { ReasoningBlock } from '../ReasoningBlock'
import { extractFileText } from '../../copilot/material'
import type { FigPipeline } from '../../editor/FigSuggest'
import BrainstormIdeas from './BrainstormIdeas'
import type { Attachment } from './BrainstormIdeas'
import { Stepper } from '../../ui/primitives'
import { Icon } from '../../ui/Icon'
import OutlineStep from './OutlineStep'
import FigureChecklist from './FigureChecklist'

/** 从选题库/外部带入的种子：ts 变化即触发直接出大纲 */
export interface BrainstormSeed {
  card: IdeaCard
  ts: number
}

/** 脑暴会话阶段（步 1/2 专用）；writing=流式成文/贴图生成中，步进器横幅提示 */
type SessionPhase = 'input' | 'brainstorming' | 'outlining' | 'outline' | 'writing'

export interface CreationWizardProps {
  project: string | null
  meta: ProjectMeta | null
  article: string
  skill: string | null
  /** 当前筛选分类（= 账号）：立项时带上，新工程才能命中该账号的分类预设 */
  category?: string
  seed: BrainstormSeed | null
  /** 盘上有卡片组（cards.json 非空）：贴图步完成判定用 */
  hasCards: boolean
  /** 审阅报告存在性（App 按 format 查 review.md / cards-review.md） */
  reviewExists: boolean
  /** App 深链跳步（工作树/对话/审阅定位等），ts 变化即生效 */
  stepRequest: { id: WizardStepId; ts: number } | null
  /** 工程目录绝对路径（配图缩略图 asset:// 用） */
  projectDir: string
  /** 步 3/5/6/7 工作面由 App 组装（编辑器/标题封面/审阅/导出都吃 App 级状态与 ref） */
  draftBody: ReactNode
  titlecoverBody: ReactNode
  reviewBody: ReactNode
  exportBody: ReactNode
  /** 切到导出步先把未保存正文落盘（导出读磁盘文件） */
  onFlushArticle: () => Promise<void>
  onArticleGenerated: (md: string) => void
  onOpenProject: (name: string) => Promise<void>
  onProjectsChanged: () => void
  onIdeasChanged: () => void
  /** 配图步：占位「处理」（三管线任一）→ 开配图弹窗，成品由 App 做正文行替换 */
  onFigFromList: (pipeline: FigPipeline, desc: string, line: number) => void
  /** 配图步：缩略图「替换」→ 开导入管线替换该图行 */
  onFigReplaceImage: (img: FigureOccurrence) => void
  /** 配图步「去正文」→ 切成文步并滚动定位 */
  onLocateInEditor: (snippet: string) => void
  onToast: (msg: string) => void
}

/**
 * 创作向导（中栏主工作面）：顶部横向步进器（选题→大纲→成文→配图→标题封面→审阅→导出）+
 * 分步工作面。步骤完成状态全部由工程事实现算（shared/wizardProgress），零持久化向导状态。
 * 步 1/2 的脑暴会话编排在本壳层（原 BrainstormPanel 阶段机整体迁入）；步 3/5/6/7 工作面
 * 由 App 组装传入；全部工作面常驻挂载（hidden 保活），流式/编辑状态切步不丢——
 * 沿用原右栏三面板的保活模式。流式中途卸载向导时统一 abort。
 */
export default function CreationWizard({
  project,
  meta,
  article,
  skill,
  category,
  seed,
  hasCards,
  reviewExists,
  stepRequest,
  projectDir,
  draftBody,
  titlecoverBody,
  reviewBody,
  exportBody,
  onFlushArticle,
  onArticleGenerated,
  onOpenProject,
  onProjectsChanged,
  onIdeasChanged,
  onFigFromList,
  onFigReplaceImage,
  onLocateInEditor,
  onToast
}: CreationWizardProps): ReactElement {
  // ---- 脑暴会话（原 BrainstormPanel 壳层状态，逐项随迁） ----
  const [phase, setPhase] = useState<SessionPhase>('input')
  const [ask, setAsk] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [cards, setCards] = useState<IdeaCard[]>([])
  const [streamText, setStreamText] = useState('')
  // 当前流式生成的思考过程：思考模型「先想后答」的等待期里这是唯一进度，经 ReasoningBlock 展示
  const [streamReasoning, setStreamReasoning] = useState('')
  // 选题步「拆对标爆款」：粘贴对标 → 拆解 → 套路/骨架注入素材（素材会自动进脑暴与大纲的上下文）
  const [benchOpen, setBenchOpen] = useState(false)
  const [benchText, setBenchText] = useState('')
  const [benchBusy, setBenchBusy] = useState(false)
  const [benchStream, setBenchStream] = useState('')
  const [benchReasoning, setBenchReasoning] = useState('')
  const [outline, setOutline] = useState('')
  const [projName, setProjName] = useState('')
  const [error, setError] = useState<string | null>(null)
  // 非空 = 正在生成/已生成贴图卡片（writing 横幅文案随之切换）
  const [cardsFormat, setCardsFormat] = useState<CardFormat | null>(null)
  // 联网脑暴默认开：选题要追热点，先搜最新资料再出题
  const [webOn, setWebOn] = useState(true)
  const [searching, setSearching] = useState(false)
  const abortRef = useRef<(() => void) | null>(null)
  const scrollIdeasRef = useRef<HTMLDivElement>(null)
  const scrollOutlineRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef(article)
  articleRef.current = article

  const [activeId, setActiveId] = useState<WizardStepId>('ideas')

  const material = attachments.filter((a) => !a.dataUrl).map((a) => `【${a.name}】\n${a.text}`).join('\n\n---\n\n')
  const imageAttachments = attachments.filter((a) => a.dataUrl)

  /** 拆对标爆款：可复用套路段（含「- 骨架：」行）注入素材；有工程时完整报告顺手落 teardown.md */
  const runBenchmarkTeardown = useCallback(async () => {
    if (benchBusy || !benchText.trim()) return
    setBenchBusy(true)
    setBenchStream('')
    setBenchReasoning('')
    const { promise, abort } = chatOnce(teardownMessages(benchText, skill), setBenchStream, setBenchReasoning)
    abortRef.current = abort
    try {
      const full = await promise
      // 只注入可复用部分（脑暴要的是套路不是整份报告）；拿不到该分区时给报告尾部，宁多勿漏
      const m = /##\s*可复用套路[\s\S]*$/.exec(full)
      const digest = (m ? m[0] : full.slice(-800)).trim()
      setAttachments((prev) => [...prev, { name: '对标爆款拆解', text: digest }])
      if (project) {
        try {
          await window.api.invoke('project:writeFile', project, 'teardown.md', full.trim() + '\n')
        } catch {
          // 注入素材是主目标，落盘失败不阻断
        }
      }
      onToast('拆解完成：可复用套路与骨架已注入素材，脑暴/大纲自动带上')
      setBenchOpen(false)
    } catch (err) {
      onToast(`拆解失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBenchBusy(false)
      setBenchStream('')
      setBenchReasoning('')
      abortRef.current = null
    }
  }, [benchBusy, benchText, skill, project, onToast])

  // 流式预览自动滚底（两个会话步各自的滚动容器）
  useEffect(() => {
    scrollIdeasRef.current?.scrollTo({ top: scrollIdeasRef.current.scrollHeight })
    scrollOutlineRef.current?.scrollTo({ top: scrollOutlineRef.current.scrollHeight })
  }, [streamText])

  // 卸载清理：正在流式时关向导（不会发生——常驻挂载——但兜底不悬挂主进程生成）
  useEffect(() => () => abortRef.current?.(), [])

  // 大纲步预填 + 外部热载：工程已有 outline.md（AI 对话「从正文反推大纲」/外部 Agent 写入）时带进向导，
  // 作者接着拖拽重排、重新成文。只在当前大纲为空时带——作者动过（生成中/手动编辑）就不打扰
  useEffect(() => {
    if (!project) return
    const fillIfEmpty = (): void => {
      void window.api
        .invoke('project:readFile', project, 'outline.md')
        .then((md) => setOutline((prev) => (!prev.trim() && md.trim() ? md : prev)))
        .catch(() => {})
    }
    if (phase === 'outline') fillIfEmpty()
    const off = window.api.on('file:external-change', ({ project: p, file }) => {
      if (p === project && file === 'outline.md') fillIfEmpty()
    })
    return off
  }, [project, phase])

  // ---- 步骤事实推导（渲染现算，规格 §5.1） ----

  const isCards = meta?.format === 'cards'
  const figSuggestions = useMemo(() => parseFigSuggestions(article), [article])
  const figImages = useMemo(() => parseFigImages(article), [article])
  const facts: WizardFacts = {
    hasProject: !!project,
    isCards,
    outlineProduced: outline.trim().length > 0,
    // 默认骨架（一行 # 标题）不算内容：手动新建的空工程要从选题步开始
    articleHasBody: article.split(/\r?\n/).filter((l) => l.trim()).length > 1,
    cardsCount: hasCards ? 1 : 0,
    figSuggestCount: figSuggestions.length,
    // 贴图工程只要标题不要封面：该步完成判定改为「已有标题候选」
    hasCover: isCards ? (meta?.titles?.length ?? 0) > 0 : !!meta?.cover?.main,
    hasReview: reviewExists,
    hasExport: !!meta?.lastExportAt
  }
  const steps = deriveWizardSteps(facts)

  // 工程切换 → 默认落第一个未完成步（流式中不打扰）；未开工程落选题步
  const projRef = useRef(project)
  useEffect(() => {
    if (projRef.current === project) return
    projRef.current = project
    if (phase !== 'writing') setActiveId(steps[firstPendingStep(steps)].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  // App 深链跳步
  const stepReqTs = useRef(0)
  useEffect(() => {
    if (stepRequest && stepRequest.ts !== stepReqTs.current) {
      stepReqTs.current = stepRequest.ts
      setActiveId(stepRequest.id)
    }
  }, [stepRequest])

  // 切到导出步先把未保存正文落盘（导出/推送读磁盘 article.md）
  useEffect(() => {
    if (activeId === 'export') void onFlushArticle()
  }, [activeId, onFlushArticle])

  // ---- 素材投喂 / 联网搜索 / 脑暴 / 大纲 / 成文（原 BrainstormPanel 编排，随迁） ----

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return
      for (const f of Array.from(files)) {
        try {
          if (f.type.startsWith('image/')) {
            const dataUrl = await new Promise<string>((res) => {
              const r = new FileReader()
              r.onload = () => res(r.result as string)
              r.readAsDataURL(f)
            })
            setAttachments((prev) => [...prev, { name: f.name, text: '', dataUrl }])
          } else {
            const text = await extractFileText(f)
            setAttachments((prev) => [...prev, { name: f.name, text }])
          }
        } catch (err) {
          onToast(`${f.name} 解析失败：${err instanceof Error ? err.message : err}`)
        }
      }
    },
    [onToast]
  )

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, j) => j !== index))
  }, [])

  const searchWeb = useCallback(
    async (query: string): Promise<WebSearchResult[]> => {
      if (!webOn || !query.trim()) return []
      setSearching(true)
      try {
        return await window.api.invoke('web:search', query.slice(0, 80))
      } catch (err) {
        onToast(`联网搜索失败，已继续离线生成：${err instanceof Error ? err.message : err}`)
        return []
      } finally {
        setSearching(false)
      }
    },
    [webOn, onToast]
  )

  const runBrainstorm = useCallback(async () => {
    if (!ask.trim() && !material) {
      onToast('请先投喂素材或输入要求')
      return
    }
    setError(null)
    setStreamText('')
    setStreamReasoning('')
    setPhase('brainstorming')
    const web = await searchWeb(ask.trim() || attachments[0]?.name || '')
    const msgs = brainstormMessages(material, ask.trim(), skill, web)
    // 图片附件：把最后一条 user 消息转为多模态 ContentPart[]（vision）
    if (imageAttachments.length > 0) {
      const last = msgs[msgs.length - 1]
      const text = typeof last.content === 'string' ? last.content : ''
      const parts: ContentPart[] = [
        ...imageAttachments.map((img) => ({ type: 'image_url' as const, image_url: { url: img.dataUrl! } })),
        { type: 'text' as const, text }
      ]
      msgs[msgs.length - 1] = { ...last, content: parts }
    }
    const { promise, abort } = chatOnce(msgs, setStreamText, setStreamReasoning)
    abortRef.current = abort
    try {
      const full = await promise
      const parsed = extractJsonArray<IdeaCard>(full)
      if (parsed) {
        setCards(parsed.filter((c) => c && typeof c.title === 'string'))
        setStreamText('')
        setStreamReasoning('')
        setPhase('input')
      } else {
        setError('选题解析失败，可重试（原始输出保留在下方）')
        setPhase('input')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('input')
    } finally {
      abortRef.current = null
    }
  }, [ask, material, imageAttachments, skill, onToast, searchWeb, attachments])

  const runOutline = useCallback(
    async (topicAsk: string, defaultName: string) => {
      setError(null)
      setStreamText('')
      setStreamReasoning('')
      setPhase('outlining')
      setActiveId('outline')
      const web = await searchWeb(topicAsk)
      const { promise, abort } = chatOnce(outlineMessages(topicAsk, material, skill, web), setStreamText, setStreamReasoning)
      abortRef.current = abort
      try {
        const full = (await promise).trim()
        setOutline(full)
        // 工程名：优先大纲一级标题，否则选题标题
        const h1 = /^#\s+(.+)$/m.exec(full)
        setProjName(sanitizeProjectName(h1?.[1] ?? defaultName))
        setStreamText('')
        setStreamReasoning('')
        setPhase('outline')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('input')
        setActiveId('ideas')
      } finally {
        abortRef.current = null
      }
    },
    [material, skill, searchWeb]
  )

  const outlineFromCard = useCallback(
    (card: IdeaCard) => {
      void runOutline(`${card.title}（切入角度：${card.angle}；目标读者：${card.audience}）`, card.title)
    },
    [runOutline]
  )

  // 选题库「生成大纲」带入的种子
  const seededTs = useRef(0)
  useEffect(() => {
    if (seed && seed.ts !== seededTs.current) {
      seededTs.current = seed.ts
      outlineFromCard(seed.card)
    }
  }, [seed, outlineFromCard])

  /** 选题画像随立项落 project.json：选题看板按 topic 全等认关联（权威），工程名之后被改散也认得出。
   *  只补空缺不覆盖——日历拖拽立项已写下的关联不作数与否不该由这里翻案 */
  const stampTopic = useCallback(
    async (targetProject: string) => {
      if (!seed) return
      try {
        const metaNow = await window.api.invoke('project:readMeta', targetProject)
        if (metaNow.topic) return
        metaNow.topic = { angle: seed.card.angle, audience: seed.card.audience, source_material: [] }
        await window.api.invoke('project:writeMeta', targetProject, metaNow)
        onProjectsChanged()
      } catch {
        // 画像写失败不阻塞立项
      }
    },
    [seed, onProjectsChanged]
  )

  const writeArticle = useCallback(
    async (targetProject: string) => {
      setError(null)
      setStreamText('')
      setStreamReasoning('')
      setCardsFormat(null)
      setPhase('writing')
      setActiveId('draft')
      const { promise, abort } = chatOnce(fullArticleMessages(outline, skill), (full) => {
        onArticleGenerated(full)
        setStreamText(`已生成 ${full.length} 字…`)
      }, setStreamReasoning)
      abortRef.current = abort
      try {
        const full = await promise
        onArticleGenerated(full.trim() + '\n')
        // 状态推进：脑暴中 → 撰写中
        try {
          const metaNow = await window.api.invoke('project:readMeta', targetProject)
          if (metaNow.status === 'ideating') {
            metaNow.status = 'drafting'
            await window.api.invoke('project:writeMeta', targetProject, metaNow)
            onProjectsChanged()
          }
        } catch {
          // meta 更新失败不阻塞
        }
        setPhase('input')
        onToast('全文已生成到编辑器')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('outline')
        setActiveId('outline')
      } finally {
        abortRef.current = null
      }
    },
    [outline, skill, onArticleGenerated, onProjectsChanged, onToast]
  )

  /** 立项并生成正文：建工程（名字可改）→ 打开 → 流式写入 */
  const createAndWrite = useCallback(async () => {
    const name = sanitizeProjectName(projName)
    if (!name) {
      onToast('请填写工程名')
      return
    }
    try {
      // 主进程会再清洗一道（如去结尾点），后续操作必须用它返回的最终名
      const created = await window.api.invoke('project:create', name, category)
      await stampTopic(created.name)
      onProjectsChanged()
      await onOpenProject(created.name)
      await writeArticle(created.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [projName, category, onProjectsChanged, onOpenProject, writeArticle, onToast, stampTopic])

  /** 立项并生成贴图：建工程标记 cards 形态 → 大纲提炼卡片组 → 打开工程（贴图面板自动补渲 PNG） */
  const createCards = useCallback(
    async (format: CardFormat) => {
      const name = sanitizeProjectName(projName)
      if (!name) {
        onToast('请填写工程名')
        return
      }
      setError(null)
      setStreamText('')
      setStreamReasoning('')
      setCardsFormat(format)
      setPhase('writing')
      setActiveId('draft')
      try {
        const created = await window.api.invoke('project:create', name, category)
        const metaNow = await window.api.invoke('project:readMeta', created.name)
        metaNow.format = 'cards'
        metaNow.status = 'drafting'
        await window.api.invoke('project:writeMeta', created.name, metaNow)
        await stampTopic(created.name)
        onProjectsChanged()
        const { promise, abort } = chatOnce(cardsMessages(outline, '大纲', format, skill), (full) => {
          setStreamText(`已生成 ${full.length} 字…`)
        }, setStreamReasoning)
        abortRef.current = abort
        const parsed = parseCardItems(await promise)
        if (!parsed) throw new Error('卡片解析失败，可重试')
        await window.api.invoke('cards:write', created.name, { format, cards: parsed })
        await onOpenProject(created.name)
        setPhase('input')
        onToast(`已生成 ${parsed.length} 张${CARD_FORMAT_LABEL[format]}卡片，正在逐张渲染`)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('outline')
        setActiveId('outline')
      } finally {
        abortRef.current = null
      }
    },
    [projName, outline, skill, category, onProjectsChanged, onOpenProject, onToast, stampTopic]
  )

  /** 写入当前已打开工程（正文非空时确认覆盖） */
  const writeToCurrent = useCallback(async () => {
    if (!project) return
    const cur = articleRef.current.trim()
    // 新建工程的默认正文只有一行标题，不算「有内容」
    const hasContent = cur && cur.split('\n').filter((l) => l.trim()).length > 1
    if (hasContent && !(await confirmAction(`「${project}」已有正文，生成将覆盖，确定继续？`, { okLabel: '覆盖生成' }))) return
    // 老工程没挂选题画像时补上：这条大纲的正文写进了它，关联即成事实（已有画像不抢）
    await stampTopic(project)
    await writeArticle(project)
  }, [project, writeArticle, stampTopic])

  const abort = useCallback(() => {
    abortRef.current?.()
  }, [])

  const reset = useCallback(() => {
    setPhase('input')
    setCards([])
    setOutline('')
    setStreamText('')
    setStreamReasoning('')
    setCardsFormat(null)
    setError(null)
  }, [])

  const busy = phase === 'brainstorming' || phase === 'outlining' || phase === 'writing'
  const writing = phase === 'writing'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 步进器（步骤即导航：点哪步去哪步，完成态由工程事实推导）
          紧凑 Stepper：单步定宽 + 连接线 flex 均分，任意窗口宽度零横向滚动条；
          放不下时降级为「n/7 步骤名 ▾」下拉。字数/保存状态已挪到中栏页签行与底部状态栏。 */}
      <div data-tour="wizard-stepper" className="shrink-0 border-b border-panel-3 px-3">
        <Stepper
          items={steps.map((s) => ({ id: s.id, label: s.label, done: s.done }))}
          activeId={activeId}
          onSelect={(id) => setActiveId(id as WizardStepId)}
          busyId={writing ? 'draft' : null}
        />
      </div>

      {/* 流式横幅（writing 阶段全局可见，切步不断流） */}
      {writing && (
        <div className="flex shrink-0 items-center gap-2 border-b border-panel-3 bg-panel-2 px-4 py-1.5 text-xs">
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ink">
            <Icon name={cardsFormat ? 'image' : 'file'} size={13} />
            {cardsFormat ? `${CARD_FORMAT_LABEL[cardsFormat]}卡片生成中…` : '正文生成中，正在流式写入…'}
          </span>
          <span className="min-w-0 flex-1 truncate text-ink-dim">{streamText || '正在连接模型…'}</span>
          <button onClick={abort} className="shrink-0 rounded bg-panel-3 px-2 py-0.5 text-st-bad hover:bg-panel">
            停止
          </button>
        </div>
      )}

      {/* 思考过程（脑暴/大纲/正文/贴图任一流式生成期）：思考模型先想后答，这段就是等待期的进度 */}
      {(phase === 'brainstorming' || phase === 'outlining' || writing) && streamReasoning && (
        <ReasoningBlock text={streamReasoning} streaming className="mx-4 my-1.5 max-w-none" />
      )}

      {/* 步 1 选题（常驻挂载保活） */}
      <div className={`min-h-0 flex-1 flex-col ${activeId === 'ideas' ? 'flex' : 'hidden'}`}>
        <div ref={scrollIdeasRef} className="selectable thin-scroll min-h-0 flex-1 overflow-auto p-4 text-xs">
          {phase === 'input' || phase === 'brainstorming' ? (
            <BrainstormIdeas
              phase={phase === 'brainstorming' ? 'brainstorming' : 'input'}
              busy={busy}
              ask={ask}
              setAsk={setAsk}
              attachments={attachments}
              removeAttachment={removeAttachment}
              addFiles={addFiles}
              webOn={webOn}
              toggleWeb={() => setWebOn((v) => !v)}
              cards={cards}
              benchOpen={benchOpen}
              onToggleBench={() => setBenchOpen((v) => !v)}
              benchText={benchText}
              setBenchText={setBenchText}
              benchBusy={benchBusy}
              benchStream={benchStream}
              benchReasoning={benchReasoning}
              onRunBench={() => void runBenchmarkTeardown()}
              onIdeasChanged={onIdeasChanged}
              onToast={onToast}
              onRunBrainstorm={() => void runBrainstorm()}
              onDirectOutline={() => void runOutline(ask.trim(), ask.trim())}
              onOutlineFromCard={outlineFromCard}
              onAbort={abort}
            />
          ) : (
            <p className="text-ink-dim">选题阶段已跳过——回到本步可重新脑暴选题。</p>
          )}
          {searching && <p className="mb-2 rounded bg-panel p-2 text-ink-dim"><Icon name="globe" size={12} className="mr-1.5" />联网搜索中…</p>}
          {busy && !searching && !streamText && phase === 'brainstorming' && (
            <p className="mb-2 rounded bg-panel p-2 text-ink-dim">
              <Icon name="brain" size={12} className="mr-1.5" />模型思考中…<span className="animate-pulse">▌</span>
            </p>
          )}
          {/* 脑暴中不露 JSON 原文，只展示已产出的选题进度 */}
          {phase === 'brainstorming' && streamText && (
            <div className="rounded bg-panel p-2 leading-6 text-ink-dim">
              <p>
                <Icon name="bulb" size={12} className="mr-1.5" />选题产出中…<span className="animate-pulse">▌</span>
              </p>
              {streamTitles(streamText).map((t, i) => (
                <p key={i} className="truncate">
                  {i + 1}. {t}
                </p>
              ))}
            </div>
          )}
          {error && <p className="mt-2 break-all text-st-bad"><Icon name="xCircle" size={12} className="mr-1" />{error}</p>}
          {/* 解析失败时保留原始输出便于排查 */}
          {error && streamText && phase === 'input' && (
            <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-panel p-2 text-[10px] text-ink-dim">{streamText}</div>
          )}
        </div>
      </div>

      {/* 步 2 大纲（常驻挂载保活） */}
      <div className={`min-h-0 flex-1 flex-col ${activeId === 'outline' ? 'flex' : 'hidden'}`}>
        <div ref={scrollOutlineRef} className="selectable thin-scroll min-h-0 flex-1 overflow-auto p-4 text-xs">
          {phase === 'outlining' || phase === 'outline' ? (
            <OutlineStep
              phase={phase === 'outlining' ? 'outlining' : 'outline'}
              outline={outline}
              setOutline={setOutline}
              projName={projName}
              setProjName={setProjName}
              project={project}
              onCreateArticle={() => void createAndWrite()}
              onCreateCards={(format) => void createCards(format)}
              onWriteToCurrent={() => void writeToCurrent()}
              onAbort={abort}
              onBack={() => {
                reset()
                setActiveId('ideas')
              }}
            />
          ) : (
            <p className="text-ink-dim">尚无大纲——先在「选题」步脑暴出题或直接出大纲。</p>
          )}
          {phase === 'outlining' && streamText && (
            <div className="mt-2 whitespace-pre-wrap rounded bg-panel p-2 leading-5 text-ink-dim">
              {streamText}
              <span className="animate-pulse">▌</span>
            </div>
          )}
          {error && phase !== 'input' && <p className="mt-2 break-all text-st-bad"><Icon name="xCircle" size={12} className="mr-1" />{error}</p>}
        </div>
      </div>

      {/* 步 3 成文/贴图（App 组装，常驻挂载保活） */}
      <div className={`min-h-0 flex-1 flex-col ${activeId === 'draft' ? 'flex' : 'hidden'}`}>{draftBody}</div>

      {/* 步 4 配图（贴图工程无此步） */}
      {!isCards && (
        <div className={`min-h-0 flex-1 flex-col ${activeId === 'figures' ? 'flex' : 'hidden'}`}>
          <div className="selectable thin-scroll min-h-0 flex-1 overflow-auto p-4 text-xs">
            {project ? (
              <FigureChecklist
                suggestions={figSuggestions}
                images={figImages}
                projectDir={projectDir}
                onProcess={(s, pipeline) => onFigFromList(pipeline, s.desc, s.line)}
                onReplaceImage={onFigReplaceImage}
                onLocateInEditor={onLocateInEditor}
              />
            ) : (
              <LockCard />
            )}
          </div>
        </div>
      )}

      {/* 步 5 标题封面（App 组装） */}
      <div className={`min-h-0 flex-1 flex-col ${activeId === 'titlecover' ? 'flex' : 'hidden'}`}>{titlecoverBody}</div>

      {/* 步 6 审阅（App 组装） */}
      <div className={`min-h-0 flex-1 flex-col ${activeId === 'review' ? 'flex' : 'hidden'}`}>{reviewBody}</div>

      {/* 步 7 导出（贴图工程无此步；App 组装） */}
      {!isCards && <div className={`min-h-0 flex-1 flex-col ${activeId === 'export' ? 'flex' : 'hidden'}`}>{exportBody}</div>}
    </div>
  )
}

function LockCard(): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-dim">
      立项或打开工程后解锁此步
    </div>
  )
}

/** 从流式 JSON 里提已完成的选题标题，避免把原始代码直接展示给用户 */
function streamTitles(stream: string): string[] {
  const out: string[] = []
  const re = /"title"\s*:\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stream))) {
    if (m[1].trim()) out.push(m[1].trim())
  }
  return out
}
