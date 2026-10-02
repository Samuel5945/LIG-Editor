import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { ContentPart, IdeaCard, WebSearchResult } from '@shared/types'
import { CARD_FORMAT_LABEL, parseCardItems, type CardFormat } from '@shared/cards'
import { sanitizeProjectName } from '@shared/projectName'
import { chatOnce, extractJsonArray } from '../copilot/llm'
import { brainstormMessages, outlineMessages, fullArticleMessages, cardsMessages } from '../copilot/prompts'
import { extractFileText } from '../copilot/material'
import BrainstormIdeas from './wizard/BrainstormIdeas'
import OutlineStep from './wizard/OutlineStep'
import type { Attachment } from './wizard/BrainstormIdeas'

/** 从选题库/外部带入的种子：ts 变化即触发直接出大纲 */
export interface BrainstormSeed {
  card: IdeaCard
  ts: number
}

interface BrainstormPanelProps {
  project: string | null
  /** 当前工程正文（判断「写入当前工程」是否需要覆盖确认） */
  article: string
  skill: string | null
  /** 当前筛选分类（= 账号）：立项时带上，新工程才能命中该账号的分类预设 */
  category?: string
  seed: BrainstormSeed | null
  onArticleGenerated: (md: string) => void
  onOpenProject: (name: string) => Promise<void>
  onProjectsChanged: () => void
  onGoReview: () => void
  onGoTitles: () => void
  /** 跳回正文页签（成文后去处理 fig-suggest 配图占位） */
  onGoArticle: () => void
  /** 入库后通知 App 刷新选题库 */
  onIdeasChanged: () => void
  onToast: (msg: string) => void
}

type Phase = 'input' | 'brainstorming' | 'outlining' | 'outline' | 'writing' | 'done'

/**
 * 脑暴工作流面板（独立上下文，不与对话互相影响）
 * 流程：素材/要求 → 选题卡 → 大纲（可编辑）→ 立项/写入工程 → 全文流式落编辑器 → 审阅/标题入口
 * 步 1/步 2 的 UI 已拆到 wizard/BrainstormIdeas、wizard/OutlineStep（受控展示组件），
 * 会话状态与编排留在本壳层——阶段 3 由 CreationWizard 原样接管这个角色。
 */
export default function BrainstormPanel({
  project,
  article,
  skill,
  category,
  seed,
  onArticleGenerated,
  onOpenProject,
  onProjectsChanged,
  onGoReview,
  onGoTitles,
  onGoArticle,
  onIdeasChanged,
  onToast
}: BrainstormPanelProps): ReactElement {
  const [phase, setPhase] = useState<Phase>('input')
  const [ask, setAsk] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [cards, setCards] = useState<IdeaCard[]>([])
  const [streamText, setStreamText] = useState('')
  const [outline, setOutline] = useState('')
  const [projName, setProjName] = useState('')
  const [error, setError] = useState<string | null>(null)
  // 非空 = 正在生成/已生成贴图卡片（writing/done 阶段文案与完成动作随之切换）
  const [cardsFormat, setCardsFormat] = useState<CardFormat | null>(null)
  // 联网脑暴默认开：选题要追热点，先搜最新资料再出题
  const [webOn, setWebOn] = useState(true)
  const [searching, setSearching] = useState(false)
  const abortRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef(article)
  articleRef.current = article

  const material = attachments.filter((a) => !a.dataUrl).map((a) => `【${a.name}】\n${a.text}`).join('\n\n---\n\n')
  const imageAttachments = attachments.filter((a) => a.dataUrl)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [streamText])

  // ---- 素材投喂 ----

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

  // ---- 联网搜索（开关开启时先搜再喂，失败降级为不带结果） ----

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

  // ---- 脑暴 → 选题卡 ----

  const runBrainstorm = useCallback(async () => {
    if (!ask.trim() && !material) {
      onToast('请先投喂素材或输入要求')
      return
    }
    setError(null)
    setStreamText('')
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
    const { promise, abort } = chatOnce(msgs, setStreamText)
    abortRef.current = abort
    try {
      const full = await promise
      const parsed = extractJsonArray<IdeaCard>(full)
      if (parsed) {
        setCards(parsed.filter((c) => c && typeof c.title === 'string'))
        setStreamText('')
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

  // ---- 大纲（来自选题卡 / 直接要求 / 选题库种子） ----

  const runOutline = useCallback(
    async (topicAsk: string, defaultName: string) => {
      setError(null)
      setStreamText('')
      setPhase('outlining')
      const web = await searchWeb(topicAsk)
      const { promise, abort } = chatOnce(outlineMessages(topicAsk, material, skill, web), setStreamText)
      abortRef.current = abort
      try {
        const full = (await promise).trim()
        setOutline(full)
        // 工程名：优先大纲一级标题，否则选题标题
        const h1 = /^#\s+(.+)$/m.exec(full)
        setProjName(sanitizeProjectName(h1?.[1] ?? defaultName))
        setStreamText('')
        setPhase('outline')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase(cards.length ? 'input' : 'input')
      } finally {
        abortRef.current = null
      }
    },
    [material, skill, cards.length, searchWeb]
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

  // ---- 全文生成 ----

  const writeArticle = useCallback(
    async (targetProject: string) => {
      setError(null)
      setStreamText('')
      setCardsFormat(null)
      setPhase('writing')
      const { promise, abort } = chatOnce(fullArticleMessages(outline, skill), (full) => {
        onArticleGenerated(full)
        setStreamText(`已生成 ${full.length} 字…`)
      })
      abortRef.current = abort
      try {
        const full = await promise
        onArticleGenerated(full.trim() + '\n')
        // 状态推进：脑暴中 → 撰写中
        try {
          const meta = await window.api.invoke('project:readMeta', targetProject)
          if (meta.status === 'ideating') {
            meta.status = 'drafting'
            await window.api.invoke('project:writeMeta', targetProject, meta)
            onProjectsChanged()
          }
        } catch {
          // meta 更新失败不阻塞
        }
        setPhase('done')
        onToast('全文已生成到编辑器')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('outline')
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
      onProjectsChanged()
      await onOpenProject(created.name)
      await writeArticle(created.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [projName, category, onProjectsChanged, onOpenProject, writeArticle, onToast])

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
      setCardsFormat(format)
      setPhase('writing')
      try {
        const created = await window.api.invoke('project:create', name, category)
        const meta = await window.api.invoke('project:readMeta', created.name)
        meta.format = 'cards'
        meta.status = 'drafting'
        await window.api.invoke('project:writeMeta', created.name, meta)
        onProjectsChanged()
        const { promise, abort } = chatOnce(cardsMessages(outline, '大纲', format, skill), (full) => {
          setStreamText(`已生成 ${full.length} 字…`)
        })
        abortRef.current = abort
        const parsed = parseCardItems(await promise)
        if (!parsed) throw new Error('卡片解析失败，可重试')
        await window.api.invoke('cards:write', created.name, { format, cards: parsed })
        await onOpenProject(created.name)
        setPhase('done')
        onToast(`已生成 ${parsed.length} 张${CARD_FORMAT_LABEL[format]}卡片，正在逐张渲染`)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('outline')
      } finally {
        abortRef.current = null
      }
    },
    [projName, outline, skill, category, onProjectsChanged, onOpenProject, onToast]
  )

  /** 写入当前已打开工程（正文非空时确认覆盖） */
  const writeToCurrent = useCallback(async () => {
    if (!project) return
    const cur = articleRef.current.trim()
    // 新建工程的默认正文只有一行标题，不算「有内容」
    const hasContent = cur && cur.split('\n').filter((l) => l.trim()).length > 1
    if (hasContent && !window.confirm(`「${project}」已有正文，生成将覆盖，确定继续？`)) return
    await writeArticle(project)
  }, [project, writeArticle])

  const abort = useCallback(() => {
    abortRef.current?.()
  }, [])

  const reset = useCallback(() => {
    setPhase('input')
    setCards([])
    setOutline('')
    setStreamText('')
    setCardsFormat(null)
    setError(null)
  }, [])

  const busy = phase === 'brainstorming' || phase === 'outlining' || phase === 'writing'

  // 正文里的建议配图位数量（全文提示词会按「至少 3 处」插入 fig-suggest 占位）
  const figSpots = (article.match(/<!--\s*fig-suggest:/g) ?? []).length

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div ref={scrollRef} className="selectable min-h-0 flex-1 overflow-auto p-3">
        {/* ---- 输入阶段：素材 + 要求（wizard/BrainstormIdeas） ---- */}
        {(phase === 'input' || phase === 'brainstorming') && (
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
            onIdeasChanged={onIdeasChanged}
            onToast={onToast}
            onRunBrainstorm={() => void runBrainstorm()}
            onDirectOutline={() => void runOutline(ask.trim(), ask.trim())}
            onOutlineFromCard={outlineFromCard}
            onAbort={abort}
          />
        )}

        {/* ---- 过程反馈：搜索 / 思考 / 流式预览 ---- */}
        {searching && <p className="mb-2 rounded bg-panel p-2 text-ink-dim">🌐 联网搜索中…</p>}
        {busy && !searching && !streamText && phase !== 'writing' && (
          <p className="mb-2 rounded bg-panel p-2 text-ink-dim">
            🤔 模型思考中…<span className="animate-pulse">▌</span>
          </p>
        )}
        {/* 脑暴中不露 JSON 原文，只展示已产出的选题进度 */}
        {phase === 'brainstorming' && streamText && (
          <div className="rounded bg-panel p-2 leading-6 text-ink-dim">
            <p>
              💡 选题产出中…<span className="animate-pulse">▌</span>
            </p>
            {streamTitles(streamText).map((t, i) => (
              <p key={i} className="truncate">
                {i + 1}. {t}
              </p>
            ))}
          </div>
        )}
        {phase === 'outlining' && streamText && (
          <div className="whitespace-pre-wrap rounded bg-panel p-2 leading-5 text-ink-dim">
            {streamText}
            <span className="animate-pulse">▌</span>
          </div>
        )}

        {/* ---- 大纲确认阶段（wizard/OutlineStep） ---- */}
        {(phase === 'outlining' || phase === 'outline') && (
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
            onBack={reset}
          />
        )}

        {/* ---- 正文/卡片生成中 ---- */}
        {phase === 'writing' && (
          <div className="rounded bg-panel p-3 text-center">
            <p className="mb-2 text-ink">
              {cardsFormat ? `🖼 ${CARD_FORMAT_LABEL[cardsFormat]}卡片生成中…` : '✍️ 正文生成中，正在流式写入编辑器…'}
            </p>
            <p className="mb-2 text-ink-dim">{streamText || '正在连接模型…'}</p>
            <button onClick={abort} className="rounded bg-panel-3 px-3 py-1 text-red-400 hover:bg-panel">
              停止
            </button>
          </div>
        )}

        {/* ---- 完成 ---- */}
        {phase === 'done' && (
          <div className="rounded bg-panel p-3">
            {cardsFormat ? (
              <div className="text-center">
                <p className="mb-3 text-green-500">✓ 卡片已生成，中央区可编辑文案、生成背图</p>
                <button onClick={reset} className="rounded bg-panel-3 px-3 py-1.5 text-ink hover:bg-panel">
                  再来一篇
                </button>
              </div>
            ) : (
              <>
                <p className="mb-2 text-center text-green-500">✓ 全文已生成，接下来：</p>
                <div className="mb-3 space-y-2">
                  <StepRow
                    n="①"
                    label="配图"
                    desc={
                      figSpots > 0
                        ? `正文已标出 ${figSpots} 处建议配图位，点文中卡片选管线出图并原位替换`
                        : '正文里暂无建议配图位，需要的话在正文里自行插 fig-suggest 占位'
                    }
                    actionLabel="去配图"
                    onGo={onGoArticle}
                  />
                  <StepRow
                    n="②"
                    label="标题与封面"
                    desc="起标题候选（可一键写入正文首行）；封面用版式模板直出，或生图/导入后裁剪"
                    actionLabel="去标题/封面"
                    onGo={onGoTitles}
                  />
                  <StepRow
                    n="③"
                    label="审阅"
                    desc="整篇过一遍：结构节奏、事实存疑、敏感词、配图与图注"
                    actionLabel="去审阅"
                    onGo={onGoReview}
                  />
                </div>
                <div className="text-center">
                  <button onClick={reset} className="rounded bg-panel-3 px-3 py-1.5 text-ink hover:bg-panel">
                    再来一篇
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {error && <p className="mt-2 break-all text-red-400">✗ {error}</p>}
        {/* 解析失败时保留原始输出便于排查 */}
        {error && streamText && phase === 'input' && (
          <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-panel p-2 text-[10px] text-ink-dim">{streamText}</div>
        )}
      </div>
    </div>
  )
}

/** 完成阶段的一步：序号 + 标题 + 说明 + 直达按钮 */
function StepRow({
  n,
  label,
  desc,
  actionLabel,
  onGo
}: {
  n: string
  label: string
  desc: string
  actionLabel: string
  onGo: () => void
}): ReactElement {
  return (
    <div className="flex items-start gap-2 rounded border border-panel-3 bg-panel-2 px-2.5 py-2">
      <span className="shrink-0 font-bold text-accent">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-ink">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{desc}</p>
      </div>
      <button
        onClick={onGo}
        className="shrink-0 rounded bg-accent px-2.5 py-1 text-[11px] text-white hover:opacity-90"
      >
        {actionLabel}
      </button>
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
