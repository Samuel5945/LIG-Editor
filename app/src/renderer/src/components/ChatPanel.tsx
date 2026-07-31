import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  ChatMessage,
  ChatSessionMeta,
  SkillInstallDirective,
  SkillResolveResult,
  WebSearchResult
} from '@shared/types'
import { extractInlineContent, parseSkillDirective } from '@shared/skillInstall'
import { cardsPlainText, parseAccentDirective } from '@shared/cards'
import { parseArticleUpdate } from '@shared/articleUpdate'
import { chatOnce } from '../copilot/llm'
import { chatContext, freeChatSystemPrompt, webContext } from '../copilot/prompts'

interface ChatPanelProps {
  project: string | null
  /** 当前正文（编辑器实时内容，工程上下文注入用） */
  article: string
  /** 工程形态：cards 时上下文改注入贴图文案 */
  format: 'article' | 'cards' | null
  /** 挂载的 Skill 全文（App 持有） */
  skill: string | null
  onToast: (msg: string) => void
  /** 对话安装 Skill 成功后通知 App 重拉挂载列表 */
  onSkillsChanged: () => void
  /** 对话换强调色确认后经 App 转发 CardsPanel.setAccent（仅贴图形态可用） */
  onApplyAccent?: (color: string | null) => Promise<void>
  /** 对话修改正文确认后经 App 写回编辑器（仅文章形态可用） */
  onApplyArticle?: (md: string) => void
  /** 空白态功能卡片：切到「脑暴创作」/「审阅」页签 */
  onGoBrainstorm: () => void
  onGoReview: () => void
}

/** 空白态功能卡片的预设提问（发送时自动附带工程上下文） */
const PRESET_INSPIRE =
  '今天有什么值得写的选题？结合当前日期给我 5 个灵感，每个用一句话说明切入角度和为什么现在写。'
const PRESET_TAGS =
  '根据工程上下文里的内容，推荐 10 个发布时适合带的话题标签（#xx 形式），按引流潜力排序，并说明前 3 个为什么合适。'

/** 对话安装 Skill 确认卡片的状态机（按 assistant 消息索引挂卡） */
interface InstallCard {
  status: 'resolving' | 'ready' | 'installing' | 'done' | 'error'
  directive: SkillInstallDirective
  result?: SkillResolveResult
  error?: string
}

/**
 * 纯对话面板：自由多轮对话 + 会话历史落 chat/*.json
 * 脑暴/生成在「脑暴」面板，审阅在「审阅」面板，标题在「标题/封面」tab——各自独立上下文，互不影响
 */
export default function ChatPanel({
  project,
  article,
  format,
  skill,
  onToast,
  onSkillsChanged,
  onApplyAccent,
  onApplyArticle,
  onGoBrainstorm,
  onGoReview
}: ChatPanelProps): ReactElement {
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [webOn, setWebOn] = useState(false)
  const [ctxOn, setCtxOn] = useState(true)
  const [searching, setSearching] = useState(false)
  const [cards, setCards] = useState<Record<number, InstallCard>>({})
  // 换强调色确认卡状态（按 assistant 消息索引挂卡）
  const [accentCards, setAccentCards] = useState<Record<number, 'applying' | 'done' | 'error'>>({})
  // 修改正文确认卡状态（按 assistant 消息索引挂卡）
  const [articleCards, setArticleCards] = useState<Record<number, 'done'>>({})
  const abortRef = useRef<(() => void) | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sessionCreatedRef = useRef<string | null>(null)

  // ---- 会话列表 / 切换 ----

  const refreshSessions = useCallback(async () => {
    if (!project) {
      setSessions([])
      return
    }
    setSessions(await window.api.invoke('chat:list', project))
  }, [project])

  useEffect(() => {
    // 切工程：重置会话上下文
    setSessionId(null)
    setMessages([])
    setCards({})
    setAccentCards({})
    setArticleCards({})
    sessionCreatedRef.current = null
    refreshSessions()
  }, [project, refreshSessions])

  const newSession = useCallback(() => {
    setSessionId(null)
    setMessages([])
    setCards({})
    setAccentCards({})
    setArticleCards({})
    sessionCreatedRef.current = null
  }, [])

  /** 删除当前会话：已落盘的删文件，未落盘的（临时对话）直接清空重开 */
  const deleteSession = useCallback(async () => {
    if (project && sessionId) {
      if (!window.confirm('删除当前会话？删除后不可恢复')) return
      try {
        await window.api.invoke('chat:delete', project, sessionId)
        onToast('会话已删除')
      } catch (err) {
        onToast(`删除失败：${err instanceof Error ? err.message : err}`)
      }
      refreshSessions()
    }
    newSession()
  }, [project, sessionId, onToast, refreshSessions, newSession])

  const loadSession = useCallback(
    async (id: string) => {
      if (!project || !id) return
      const s = await window.api.invoke('chat:read', project, id)
      setSessionId(s.id)
      setMessages(s.messages)
      setCards({})
      setAccentCards({})
      setArticleCards({})
      sessionCreatedRef.current = s.created_at
    },
    [project]
  )

  /** 每轮完成后把消息落盘 chat/<id>.json（无工程时不持久化） */
  const persist = useCallback(
    async (msgs: ChatMessage[]) => {
      if (!project || msgs.length === 0) return
      const now = new Date().toISOString()
      let id = sessionId
      if (!id) {
        id = now.replace(/[:.]/g, '-')
        setSessionId(id)
      }
      if (!sessionCreatedRef.current) sessionCreatedRef.current = now
      const firstUser = msgs.find((m) => m.role === 'user')
      await window.api.invoke('chat:write', project, {
        id,
        title: (firstUser?.content ?? '新会话').slice(0, 24),
        created_at: sessionCreatedRef.current,
        updated_at: now,
        messages: msgs
      })
      refreshSessions()
    },
    [project, sessionId, refreshSessions]
  )

  // 自动滚到底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  // ---- 对话安装 Skill：指令 → resolve 预览 → 确认卡片 → 安装 ----

  /** 发起 resolve：inline 来源从用户消息原文提取内容（不经模型复述） */
  const resolveCard = useCallback(async (idx: number, directive: SkillInstallDirective, userText: string) => {
    const d = { ...directive }
    if (d.source === 'inline') d.content = extractInlineContent(userText)
    setCards((prev) => ({ ...prev, [idx]: { status: 'resolving', directive: d } }))
    try {
      const result = await window.api.invoke('skill:resolve', d)
      setCards((prev) => ({ ...prev, [idx]: { status: 'ready', directive: d, result } }))
    } catch (err) {
      setCards((prev) => ({
        ...prev,
        [idx]: { status: 'error', directive: d, error: err instanceof Error ? err.message : String(err) }
      }))
    }
  }, [])

  const installCard = useCallback(
    async (idx: number) => {
      const card = cards[idx]
      if (card?.status !== 'ready' || !card.result || card.result.scriptDep) return
      setCards((prev) => ({ ...prev, [idx]: { ...card, status: 'installing' } }))
      try {
        const name = await window.api.invoke('skill:installResolved', card.result.name, card.result.content)
        setCards((prev) => ({ ...prev, [idx]: { ...card, status: 'done' } }))
        onToast(`✅ 已安装 Skill：${name}`)
        onSkillsChanged()
      } catch (err) {
        setCards((prev) => ({
          ...prev,
          [idx]: { ...card, status: 'error', error: err instanceof Error ? err.message : String(err) }
        }))
      }
    },
    [cards, onToast, onSkillsChanged]
  )

  /** 换强调色确认卡点「应用」：经 App 转发 CardsPanel 整组重渲 */
  const applyAccent = useCallback(
    async (idx: number, color: string | null) => {
      if (!onApplyAccent) return
      setAccentCards((prev) => ({ ...prev, [idx]: 'applying' }))
      try {
        await onApplyAccent(color)
        setAccentCards((prev) => ({ ...prev, [idx]: 'done' }))
      } catch (err) {
        setAccentCards((prev) => ({ ...prev, [idx]: 'error' }))
        onToast(`换色失败：${err instanceof Error ? err.message : err}`)
      }
    },
    [onApplyAccent, onToast]
  )

  /** 修改正文确认卡点「应用」：经 App 写回编辑器（md 唯一事实源，自动保存接管） */
  const applyArticle = useCallback(
    (idx: number, md: string) => {
      if (!onApplyArticle) return
      onApplyArticle(md)
      setArticleCards((prev) => ({ ...prev, [idx]: 'done' }))
      onToast('修改稿已应用到正文')
    },
    [onApplyArticle, onToast]
  )

  /** 索引 idx 之前最近一条用户消息原文（inline 内容提取用） */
  const userTextBefore = useCallback(
    (idx: number): string => {
      for (let i = idx - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].content
      return ''
    },
    [messages]
  )

  // ---- 发送一轮 ----

  /** 当轮自动附带的工程上下文：贴图工程喂卡片文案，否则喂正文（只拼 API 请求，不进可见历史） */
  const buildContext = useCallback(async (): Promise<string> => {
    if (!ctxOn || !project) return ''
    if (format === 'cards') {
      const deck = await window.api.invoke('cards:read', project)
      if (!deck?.cards.length) return ''
      const label = deck.format === 'xhs' ? '小红书' : '公众号'
      return chatContext('cards', `格式：${label}贴图，共 ${deck.cards.length} 张\n${cardsPlainText(deck.cards)}`)
    }
    // 正文过长时截断，避免每轮都把超长文章全量塞进请求
    return chatContext('article', article.slice(0, 8000))
  }, [ctxOn, project, format, article])

  const send = useCallback(
    async (preset?: string) => {
      const text = (preset ?? input).trim()
      if (!text || streaming) return
      if (!preset) setInput('')
      setError(null)
      setStreaming(true)
      // 开了联网：先搜再喂——结果只拼进当轮 API 请求，不进可见历史/落盘会话
      let web: WebSearchResult[] = []
      if (webOn) {
        setSearching(true)
        try {
          web = await window.api.invoke('web:search', text.slice(0, 80))
        } catch (err) {
          onToast(`联网搜索失败，已离线回答：${err instanceof Error ? err.message : err}`)
        } finally {
          setSearching(false)
        }
      }
      const ctx = await buildContext()
      const display = [...messages, { role: 'user', content: text } as ChatMessage]
      setMessages([...display, { role: 'assistant', content: '' }])
      const apiUser: ChatMessage = {
        role: 'user',
        content: `${ctx}${web.length > 0 ? `${webContext(web)}\n` : ''}${text}`
      }
      const api: ChatMessage[] = [
        { role: 'system', content: freeChatSystemPrompt(skill) },
        ...messages,
        apiUser
      ]
      const { promise, abort } = chatOnce(api, (full) => {
        setMessages([...display, { role: 'assistant', content: full }])
      })
      abortRef.current = abort
      try {
        const full = await promise
        const all = [...display, { role: 'assistant', content: full } as ChatMessage]
        setMessages(all)
        await persist(all)
        // 回复尾部带 skill-install 指令：自动发起预览，弹确认卡片
        const { directive } = parseSkillDirective(full)
        if (directive) resolveCard(all.length - 1, directive, text)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
    },
    [input, streaming, messages, skill, webOn, onToast, persist, resolveCard, buildContext]
  )

  const abort = useCallback(() => abortRef.current?.(), [])

  // ---- 渲染 ----

  return (
    <>
      {/* 会话条 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-panel-3 px-2 py-1.5 text-xs">
        <select
          value={sessionId ?? ''}
          onChange={(e) => (e.target.value ? loadSession(e.target.value) : newSession())}
          disabled={!project}
          className="min-w-0 flex-1 rounded bg-panel-3 px-1.5 py-1 text-ink outline-none disabled:opacity-50"
        >
          <option value="">{project ? '（当前会话）' : '未打开工程，不保存会话'}</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button onClick={newSession} title="新会话" className="shrink-0 rounded px-2 py-1 text-ink-dim hover:bg-panel-3">
          ＋
        </button>
        <button
          onClick={() => void deleteSession()}
          disabled={!project || (!sessionId && messages.length === 0)}
          title="删除当前会话"
          className="shrink-0 rounded px-2 py-1 text-ink-dim hover:bg-panel-3 hover:text-red-400 disabled:opacity-40"
        >
          🗑
        </button>
      </div>

      {/* 消息区 */}
      <div ref={listRef} className="selectable flex-1 overflow-auto p-3 text-xs">
        {messages.length === 0 && (
          <div>
            <p className="mb-2 text-ink-dim">
              自由对话，Enter 发送。默认自动带上当前正文/贴图内容，可用下方 📎 开关。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void send(PRESET_INSPIRE)}
                className="rounded-lg border border-panel-3 bg-panel-2 p-2.5 text-left hover:bg-panel-3"
              >
                <span className="font-medium text-ink">💡 今日灵感</span>
                <span className="mt-1 block leading-4 text-ink-dim">结合今天日期给 5 个选题灵感</span>
              </button>
              <button
                onClick={() => void send(PRESET_TAGS)}
                disabled={!project}
                title={project ? undefined : '先打开工程'}
                className="rounded-lg border border-panel-3 bg-panel-2 p-2.5 text-left hover:bg-panel-3 disabled:opacity-40"
              >
                <span className="font-medium text-ink">🏷 话题标签推荐</span>
                <span className="mt-1 block leading-4 text-ink-dim">按当前正文/贴图推荐发布标签</span>
              </button>
              <button
                onClick={onGoBrainstorm}
                className="rounded-lg border border-panel-3 bg-panel-2 p-2.5 text-left hover:bg-panel-3"
              >
                <span className="font-medium text-ink">🧠 脑暴选题</span>
                <span className="mt-1 block leading-4 text-ink-dim">去「脑暴创作」出选题和正文</span>
              </button>
              <button
                onClick={onGoReview}
                disabled={!project}
                title={project ? undefined : '先打开工程'}
                className="rounded-lg border border-panel-3 bg-panel-2 p-2.5 text-left hover:bg-panel-3 disabled:opacity-40"
              >
                <span className="font-medium text-ink">🔍 审阅打磨</span>
                <span className="mt-1 block leading-4 text-ink-dim">去「审阅」逐段/逐张点评</span>
              </button>
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          // assistant 消息剥离 skill-install / cards-accent / article-update 指令块，指令转为下方确认卡片
          const parsed = m.role === 'assistant' ? parseSkillDirective(m.content) : null
          const accentParsed = parsed ? parseAccentDirective(parsed.cleaned) : null
          const articleParsed = accentParsed ? parseArticleUpdate(accentParsed.cleaned) : null
          const card = cards[i]
          const accentState = accentCards[i]
          const articleState = articleCards[i]
          return (
            <div key={i} className={`mb-2 flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 leading-5 ${
                  m.role === 'user' ? 'bg-accent/20 text-ink' : 'bg-panel-3 text-ink'
                }`}
              >
                {(articleParsed ? articleParsed.cleaned : m.content) ||
                  (streaming && i === messages.length - 1 ? '…' : '')}
                {articleParsed?.pending && (
                  <span className="block text-ink-dim">✍ 正在生成修改稿…</span>
                )}
              </div>
              {articleParsed?.update !== undefined && (
                <div className="mt-1 max-w-[90%] rounded-lg border border-panel-3 bg-panel-2 px-2.5 py-2">
                  <p className="font-medium text-ink">📝 修改正文（{articleParsed.update.length} 字）</p>
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-ink-dim">
                    {articleParsed.update.slice(0, 120)}…
                  </p>
                  {format !== 'article' || !onApplyArticle ? (
                    <p className="mt-1 text-ink-dim">当前工程不是文章形态，无法应用</p>
                  ) : articleState === 'done' ? (
                    <p className="mt-1 text-ink">✅ 已应用到正文</p>
                  ) : (
                    <>
                      {article.length > 8000 && (
                        <p className="mt-1 text-amber-400">
                          ⚠ 当前正文较长，AI 可能只看到开头部分，应用前请确认结尾完整
                        </p>
                      )}
                      <button
                        onClick={() => applyArticle(i, articleParsed.update!)}
                        className="mt-1.5 rounded bg-accent px-3 py-1 text-white hover:opacity-90"
                      >
                        ✓ 应用到正文
                      </button>
                    </>
                  )}
                </div>
              )}
              {accentParsed?.accent !== undefined && (
                <div className="mt-1 max-w-[90%] rounded-lg border border-panel-3 bg-panel-2 px-2.5 py-2">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    🎨 换贴图强调色：
                    {accentParsed.accent ? (
                      <>
                        <span className="inline-block h-4 w-4 rounded-full border border-panel-3" style={{ background: accentParsed.accent }} />
                        {accentParsed.accent}
                      </>
                    ) : (
                      '恢复平台默认色'
                    )}
                  </p>
                  {format !== 'cards' || !onApplyAccent ? (
                    <p className="mt-1 text-ink-dim">当前工程不是贴图形态，无法应用</p>
                  ) : accentState === 'done' ? (
                    <p className="mt-1 text-ink">✅ 已应用，全组重渲完成</p>
                  ) : (
                    <button
                      onClick={() => void applyAccent(i, accentParsed.accent ?? null)}
                      disabled={accentState === 'applying'}
                      className="mt-1.5 rounded bg-accent px-3 py-1 text-white hover:opacity-90 disabled:opacity-40"
                    >
                      {accentState === 'applying' ? '应用中，整组重渲…' : '✓ 应用并重渲全组'}
                    </button>
                  )}
                </div>
              )}
              {parsed?.directive && (
                <div className="mt-1 max-w-[90%] rounded-lg border border-panel-3 bg-panel-2 px-2.5 py-2">
                  {!card && (
                    <button
                      onClick={() => resolveCard(i, parsed.directive!, userTextBefore(i))}
                      className="rounded bg-panel-3 px-2 py-1 text-ink hover:bg-panel"
                    >
                      📦 处理这个 Skill 安装请求
                    </button>
                  )}
                  {card?.status === 'resolving' && <p className="text-ink-dim">⏳ 正在获取 Skill…</p>}
                  {(card?.status === 'ready' || card?.status === 'installing') && card.result && (
                    <>
                      <p className="font-medium text-ink">📦 安装 Skill：{card.result.name}</p>
                      <p className="mt-0.5 break-all text-ink-dim">来源：{card.result.origin}</p>
                      {card.result.description && (
                        <p className="mt-0.5 text-ink-dim">{card.result.description}</p>
                      )}
                      <p className="mt-0.5 text-ink-dim">
                        {card.result.content.length} 字
                        {card.result.exists ? '　⚠ 将覆盖现有同名 Skill' : ''}
                      </p>
                      {card.result.scriptDep && (
                        <p className="mt-0.5 break-all text-red-400">
                          ⚠ 检测到依赖脚本执行（{card.result.scriptDep}），本应用只能注入提示词、无法执行脚本，已阻止安装
                        </p>
                      )}
                      <div className="mt-1.5 flex gap-2">
                        {!card.result.scriptDep && (
                          <button
                            onClick={() => installCard(i)}
                            disabled={card.status === 'installing'}
                            className="rounded bg-accent px-3 py-1 text-white hover:opacity-90 disabled:opacity-40"
                          >
                            {card.status === 'installing' ? '安装中…' : '✓ 安装'}
                          </button>
                        )}
                        <button
                          onClick={() =>
                            setCards((prev) => {
                              const next = { ...prev }
                              delete next[i]
                              return next
                            })
                          }
                          disabled={card.status === 'installing'}
                          className="rounded bg-panel-3 px-3 py-1 text-ink-dim hover:bg-panel disabled:opacity-40"
                        >
                          取消
                        </button>
                      </div>
                    </>
                  )}
                  {card?.status === 'done' && (
                    <p className="text-ink">✅ 已安装 Skill：{card.result?.name}</p>
                  )}
                  {card?.status === 'error' && (
                    <>
                      <p className="break-all text-red-400">✗ {card.error}</p>
                      <button
                        onClick={() => resolveCard(i, parsed.directive!, userTextBefore(i))}
                        className="mt-1 rounded bg-panel-3 px-2 py-1 text-ink hover:bg-panel"
                      >
                        重试
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {error && <p className="mt-1 break-all text-red-400">✗ {error}</p>}
        {searching && <p className="mt-1 text-ink-dim">🌐 联网搜索中…</p>}
      </div>

      {/* 输入区 */}
      <div className="border-t border-panel-3 p-2">
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="自由对话，Enter 发送"
          className="w-full resize-none rounded bg-panel-3 p-2 text-xs text-ink outline-none placeholder:text-ink-dim"
        />
        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            onClick={() => setWebOn((v) => !v)}
            title="联网搜索：开启后每轮先搜索再回答（时效性问题建议开）"
            className={`rounded px-2 py-1 text-xs ${webOn ? 'bg-accent/20 text-accent' : 'text-ink-dim hover:bg-panel-3'}`}
          >
            🌐 联网{webOn ? '：开' : ''}
          </button>
          <button
            onClick={() => setCtxOn((v) => !v)}
            disabled={!project}
            title="工程上下文：开启后每轮自动附带当前正文/贴图文案，AI 能直接回答内容相关问题"
            className={`mr-auto rounded px-2 py-1 text-xs disabled:opacity-40 ${ctxOn && project ? 'bg-accent/20 text-accent' : 'text-ink-dim hover:bg-panel-3'}`}
          >
            📎 上下文{ctxOn && project ? '：开' : ''}
          </button>
          {streaming ? (
            <button onClick={abort} className="rounded bg-panel-3 px-3 py-1 text-xs text-red-400 hover:bg-panel">
              停止
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim()}
              className="rounded bg-accent px-3 py-1 text-xs text-white hover:opacity-90 disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </>
  )
}
