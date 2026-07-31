import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { IdeaCard, WebSearchResult } from '@shared/types'
import { CARD_FORMAT_LABEL, parseCardItems, type CardFormat } from '@shared/cards'
import { chatOnce, extractJsonArray } from '../copilot/llm'
import { brainstormMessages, outlineMessages, fullArticleMessages, cardsMessages } from '../copilot/prompts'
import { extractFileText } from '../copilot/material'

interface Attachment {
  name: string
  text: string
}

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
  seed: BrainstormSeed | null
  onArticleGenerated: (md: string) => void
  onOpenProject: (name: string) => Promise<void>
  onProjectsChanged: () => void
  onGoReview: () => void
  onGoTitles: () => void
  /** 入库后通知 App 刷新选题库 */
  onIdeasChanged: () => void
  onToast: (msg: string) => void
}

type Phase = 'input' | 'brainstorming' | 'outlining' | 'outline' | 'writing' | 'done'

/**
 * 脑暴工作流面板（独立上下文，不与对话互相影响）
 * 流程：素材/要求 → 选题卡 → 大纲（可编辑）→ 立项/写入工程 → 全文流式落编辑器 → 审阅/标题入口
 */
export default function BrainstormPanel({
  project,
  article,
  skill,
  seed,
  onArticleGenerated,
  onOpenProject,
  onProjectsChanged,
  onGoReview,
  onGoTitles,
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
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef(article)
  articleRef.current = article

  const material = attachments.map((a) => `【${a.name}】\n${a.text}`).join('\n\n---\n\n')

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [streamText])

  // ---- 素材投喂 ----

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return
      for (const f of Array.from(files)) {
        try {
          const text = await extractFileText(f)
          setAttachments((prev) => [...prev, { name: f.name, text }])
        } catch (err) {
          onToast(`${f.name} 解析失败：${err instanceof Error ? err.message : err}`)
        }
      }
    },
    [onToast]
  )

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
    const { promise, abort } = chatOnce(brainstormMessages(material, ask.trim(), skill, web), setStreamText)
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
  }, [ask, material, skill, onToast, searchWeb, attachments])

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
        setProjName(sanitizeName(h1?.[1] ?? defaultName))
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
    const name = sanitizeName(projName)
    if (!name) {
      onToast('请填写工程名')
      return
    }
    try {
      // 主进程会再清洗一道（如去结尾点），后续操作必须用它返回的最终名
      const created = await window.api.invoke('project:create', name)
      onProjectsChanged()
      await onOpenProject(created.name)
      await writeArticle(created.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [projName, onProjectsChanged, onOpenProject, writeArticle, onToast])

  /** 立项并生成贴图：建工程标记 cards 形态 → 大纲提炼卡片组 → 打开工程（贴图面板自动补渲 PNG） */
  const createCards = useCallback(
    async (format: CardFormat) => {
      const name = sanitizeName(projName)
      if (!name) {
        onToast('请填写工程名')
        return
      }
      setError(null)
      setStreamText('')
      setCardsFormat(format)
      setPhase('writing')
      try {
        const created = await window.api.invoke('project:create', name)
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
    [projName, outline, skill, onProjectsChanged, onOpenProject, onToast]
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

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div ref={scrollRef} className="selectable min-h-0 flex-1 overflow-auto p-3">
        {/* ---- 输入阶段：素材 + 要求 ---- */}
        {(phase === 'input' || phase === 'brainstorming') && (
          <>
            <p className="mb-2 text-ink-dim">
              投喂素材（txt/md/pdf）和要求 → 脑暴选题卡 → 生成大纲 → 立项写正文。全程独立上下文，不影响对话。
            </p>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.md,.pdf"
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <div className="mb-2 flex flex-wrap gap-1">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="rounded border border-dashed border-panel-3 px-2 py-1 text-ink-dim hover:border-accent hover:text-accent disabled:opacity-40"
              >
                📎 投喂素材
              </button>
              <button
                onClick={() => setWebOn((v) => !v)}
                disabled={busy}
                title="开启后先联网搜选题相关实时资讯，再喂给模型"
                className={`rounded px-2 py-1 disabled:opacity-40 ${webOn ? 'bg-accent text-white' : 'border border-dashed border-panel-3 text-ink-dim hover:border-accent hover:text-accent'}`}
              >
                🌐 联网{webOn ? '已开' : ''}
              </button>
              {attachments.map((a, i) => (
                <span key={i} className="flex items-center gap-1 rounded bg-panel-3 px-1.5 py-1 text-[10px] text-ink-dim">
                  {a.name}（{a.text.length}字）
                  <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="hover:text-red-400">
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <textarea
              rows={3}
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="补充要求 / 选题方向（脑暴可空，直接出大纲必填）"
              disabled={busy}
              className="mb-2 w-full resize-none rounded bg-panel-3 p-2 text-ink outline-none placeholder:text-ink-dim disabled:opacity-50"
            />
            <div className="mb-3 flex gap-2">
              {phase === 'brainstorming' ? (
                <button onClick={abort} className="rounded bg-panel-3 px-3 py-1.5 text-red-400 hover:bg-panel">
                  停止
                </button>
              ) : (
                <>
                  <button onClick={runBrainstorm} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90">
                    🧠 开始脑暴
                  </button>
                  <button
                    onClick={() => ask.trim() && runOutline(ask.trim(), ask.trim())}
                    disabled={!ask.trim()}
                    className="rounded bg-panel-3 px-3 py-1.5 text-ink hover:bg-panel disabled:opacity-40"
                    title="跳过脑暴，按要求直接出大纲"
                  >
                    直接出大纲
                  </button>
                </>
              )}
            </div>

            {/* 选题卡 */}
            {cards.map((c, i) => (
              <div key={i} className="mb-1.5 rounded-lg border border-panel-3 bg-panel p-2.5">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${c.score >= 8 ? 'bg-green-950 text-green-400' : 'bg-panel-3 text-ink-dim'}`}>
                    {c.score}
                  </span>
                  <p className="min-w-0 flex-1 text-[13px] font-bold text-ink">{c.title}</p>
                </div>
                <p className="mt-1 text-ink-dim">角度：{c.angle}</p>
                <p className="text-ink-dim">读者：{c.audience}</p>
                <p className="text-ink-dim">{c.reason}</p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    onClick={async () => {
                      await window.api.invoke('ideas:add', c)
                      onIdeasChanged()
                      onToast('已入选题库（左栏「选题库」可查看）')
                    }}
                    className="rounded bg-panel-3 px-2 py-0.5 text-ink hover:bg-panel-2"
                  >
                    入库
                  </button>
                  <button onClick={() => outlineFromCard(c)} className="rounded bg-accent px-2 py-0.5 text-white hover:opacity-90">
                    生成大纲 →
                  </button>
                </div>
              </div>
            ))}
          </>
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

        {/* ---- 大纲确认阶段 ---- */}
        {(phase === 'outlining' || phase === 'outline') && (
          <>
            <div className="mb-2 flex items-center">
              <span className="font-bold text-ink">{phase === 'outlining' ? '大纲生成中…' : '大纲（可直接编辑）'}</span>
              {phase === 'outlining' ? (
                <button onClick={abort} className="ml-auto rounded bg-panel-3 px-2 py-0.5 text-red-400 hover:bg-panel">
                  停止
                </button>
              ) : (
                <button onClick={reset} className="ml-auto rounded px-2 py-0.5 text-ink-dim hover:bg-panel-3">
                  ← 返回
                </button>
              )}
            </div>
            {phase === 'outline' && (
              <>
                <textarea
                  value={outline}
                  onChange={(e) => setOutline(e.target.value)}
                  rows={14}
                  className="mb-2 w-full resize-y rounded bg-panel p-2 leading-5 text-ink outline-none"
                />
                <div className="mb-2 flex items-center gap-2">
                  <span className="shrink-0 text-ink-dim">工程名</span>
                  <input
                    value={projName}
                    onChange={(e) => setProjName(e.target.value)}
                    className="min-w-0 flex-1 rounded bg-panel-3 px-2 py-1 text-ink outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={createAndWrite} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90" title="新建工程并生成公众号文章正文">
                    📄 公众号文章
                  </button>
                  <button onClick={() => createCards('wechat')} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90" title="新建工程并生成多张竖版公众号图片卡片">
                    🖼 公众号贴图
                  </button>
                  <button onClick={() => createCards('xhs')} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90" title="新建工程并生成小红书风图文卡片">
                    📕 小红书贴图
                  </button>
                  {project && (
                    <button onClick={writeToCurrent} className="rounded bg-panel-3 px-3 py-1.5 text-ink hover:bg-panel" title={`覆盖写入「${project}」的正文`}>
                      写入当前工程
                    </button>
                  )}
                </div>
              </>
            )}
          </>
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
          <div className="rounded bg-panel p-3 text-center">
            {cardsFormat ? (
              <>
                <p className="mb-3 text-green-500">✓ 卡片已生成，中央区可编辑文案、生成背图</p>
                <button onClick={reset} className="rounded bg-panel-3 px-3 py-1.5 text-ink hover:bg-panel">
                  再来一篇
                </button>
              </>
            ) : (
              <>
                <p className="mb-3 text-green-500">✓ 全文已生成，接下来可以：</p>
                <div className="flex justify-center gap-2">
                  <button onClick={onGoReview} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90">
                    去审阅
                  </button>
                  <button onClick={onGoTitles} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90">
                    起标题/封面
                  </button>
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

/** 选题标题 → 合法工程名（与主进程 sanitizeProjectName 一致：结尾点/空格是 Windows 病态路径，必须去掉） */
function sanitizeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\./g, '')
    .trim()
    .slice(0, 30)
    .replace(/[. ]+$/, '')
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
