import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  ChatMessage,
  ChatSessionMeta,
  ChatToolSchema,
  ContentPart,
  SkillInstallDirective,
  SkillResolveResult,
  ToolCallInfo,
  WebSearchResult
} from '@shared/types'
import { buildToolSchemas } from '@shared/llmText'
import { extractInlineContent, parseSkillDirective } from '@shared/skillInstall'
import { cardsPlainText, parseAccentDirective } from '@shared/cards'
import { parseArticleUpdate } from '@shared/articleUpdate'
import { chatOnceWithTools } from '../copilot/llm'
import { chatContext, freeChatSystemPrompt, webContext } from '../copilot/prompts'
import { extractFileText } from '../copilot/material'
import { parseAccentIntent } from '@shared/accentIntent'

/** 从消息 content（可能是多模态数组）提取纯文本（渲染/标题/解析用） */
function contentText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; text: string }).text).join('')
}

// ---- chat-tools v1：对话副驾驶工具调用 ----

const PUSH_TOOLS = ['push_draft', 'push_cards']
const TOOL_ROUNDS_MAX = 6

interface ToolCardState {
  name: string
  argsSummary: string
  status: 'running' | 'done' | 'error'
  result?: string
}

const TOOL_LABELS: Record<string, string> = {
  list_projects: '查询工程列表',
  create_project: '新建工程',
  set_project_category: '迁移工程分类',
  get_project: '读取工程',
  read_article: '读取正文',
  write_article: '覆写正文',
  patch_article: '修改正文',
  save_ideas: '保存选题',
  save_review: '写入审阅报告',
  set_titles: '写入标题候选',
  set_theme: '调整排版参数',
  render_figure: '渲染图表',
  generate_image: 'AI 生图',
  import_image: '导入图片',
  set_cover: '设置封面',
  schedule_set: '设置排期',
  export_html: '导出 HTML',
  export_docx: '导出 Word',
  push_draft: '推送公众号草稿',
  push_cards: '推送贴图草稿'
}

/** 工具清单模块级缓存（静态）与不支持 tools 参数的供应商记忆（会话内降级） */
let cachedChatTools: ChatToolSchema[] | null = null
let chatToolsUnsupported = false

async function getChatTools(): Promise<ChatToolSchema[]> {
  if (chatToolsUnsupported) return []
  if (cachedChatTools) return cachedChatTools
  try {
    cachedChatTools = buildToolSchemas(await window.api.invoke('agent:listTools'))
  } catch {
    chatToolsUnsupported = true
  }
  return cachedChatTools ?? []
}

function safeParseArgs(argsJson: string): Record<string, unknown> {
  try {
    return JSON.parse(argsJson || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 参数摘要：一行键值串塞进工具卡 */
function argsSummary(argsJson: string): string {
  const args = safeParseArgs(argsJson)
  const keys = Object.keys(args)
  if (!keys.length) return ''
  return keys
    .map((k) => `${k}: ${String(args[k]).slice(0, 40)}`)
    .join(' · ')
    .slice(0, 120)
}

/** 工具结果摘要：成功给内容片段，失败给原因（超长截断，完整结果可展开） */
function summarizeToolResult(r: { ok: boolean; result?: unknown; error?: string }): string {
  if (!r.ok) return `失败：${r.error ?? '未知错误'}`
  const s = typeof r.result === 'string' ? r.result : JSON.stringify(r.result)
  return s || '（无返回内容）'
}

/** 工具守则：注入系统提示（当前工程 + 补丁优先 + 一次一个工具） */
function toolsGuardrail(project: string | null): string {
  return `\n\n<工具守则>\n${project ? `当前工程：「${project}」，涉及它的操作默认对它执行。` : '当前未打开工程；需要工程参数时先 list_projects 查询。'}\n改正文优先用 patch_article（old/new 精准替换）；仅在整体重写时用 write_article，且写前先读原文。\n一次只调用一个工具，等结果返回再决定下一步；结论要基于工具结果而非猜测。\n</工具守则>`
}

/** 经主进程执行单个工具，返回给模型的文本结果（成功给内容/失败给原因） */
async function runToolCall(tc: ToolCallInfo): Promise<string> {
  const r = await window.api.invoke('agent:callTool', tc.name, safeParseArgs(tc.arguments))
  return summarizeToolResult(r)
}

/** 工具调用卡：进行中转圈 / 完成 ✓ / 失败 ✗，可展开看完整结果 */
function ToolCardView({ card }: { card: ToolCardState }): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="max-w-[90%] rounded border border-panel-3 bg-panel-2 px-2 py-1 text-[11px]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left">
        <span>{card.status === 'running' ? '⏳' : card.status === 'done' ? '✅' : '✗'}</span>
        <span className="shrink-0 text-ink">{TOOL_LABELS[card.name] ?? card.name}</span>
        {card.argsSummary && <span className="min-w-0 flex-1 truncate text-ink-dim">{card.argsSummary}</span>}
        <span className={`shrink-0 text-ink-dim transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open && card.result && (
        <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-ink-dim">{card.result}</p>
      )}
    </div>
  )
}

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
  /** 对话换文章强调色确认后经 App 写 meta.accent（仅文章形态可用） */
  onApplyArticleAccent?: (color: string | null) => Promise<void>
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
  onApplyArticleAccent,
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
  // 工具调用卡（chat-tools v1，按 assistant 气泡索引挂卡）+ 推送确认卡
  const [toolCards, setToolCards] = useState<Record<number, ToolCardState[]>>({})
  const toolCardsRef = useRef<Record<number, ToolCardState[]>>({})
  const [pushConfirm, setPushConfirm] = useState<{ tool: string; summary: string; resolve: (ok: boolean) => void } | null>(null)
  // 附件：图片（dataURL 走 vision）+ 文档（提取文本拼入消息）
  const [attachImages, setAttachImages] = useState<{ name: string; dataUrl: string }[]>([])
  const [attachDocs, setAttachDocs] = useState<{ name: string; text: string }[]>([])
  const attachRef = useRef<HTMLInputElement>(null)
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
    setToolCards({})
    toolCardsRef.current = {}
    setPushConfirm(null)
    sessionCreatedRef.current = null
    refreshSessions()
  }, [project, refreshSessions])

  const newSession = useCallback(() => {
    setSessionId(null)
    setMessages([])
    setCards({})
    setAccentCards({})
    setArticleCards({})
    setToolCards({})
    toolCardsRef.current = {}
    setPushConfirm(null)
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
      setToolCards({})
      toolCardsRef.current = {}
      setPushConfirm(null)
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
        title: contentText(firstUser?.content ?? '新会话').slice(0, 24),
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

  /** 换强调色确认卡点「应用」：按工程形态分流——贴图整组重渲，文章写 meta.accent 即时跟色 */
  const applyAccent = useCallback(
    async (idx: number, color: string | null) => {
      const apply = format === 'cards' ? onApplyAccent : onApplyArticleAccent
      if (!apply) return
      setAccentCards((prev) => ({ ...prev, [idx]: 'applying' }))
      try {
        await apply(color)
        setAccentCards((prev) => ({ ...prev, [idx]: 'done' }))
      } catch (err) {
        setAccentCards((prev) => ({ ...prev, [idx]: 'error' }))
        onToast(`换色失败：${err instanceof Error ? err.message : err}`)
      }
    },
    [format, onApplyAccent, onApplyArticleAccent, onToast]
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
      for (let i = idx - 1; i >= 0; i--) if (messages[i].role === 'user') return contentText(messages[i].content)
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

  // ---- 附件处理 ----
  const addAttachments = useCallback(
    async (files: FileList | null) => {
      if (!files) return
      for (const f of Array.from(files)) {
        if (f.type.startsWith('image/')) {
          const dataUrl = await new Promise<string>((res) => {
            const r = new FileReader()
            r.onload = () => res(r.result as string)
            r.readAsDataURL(f)
          })
          setAttachImages((prev) => [...prev, { name: f.name, dataUrl }])
        } else if (/\.(txt|md|pdf)$/i.test(f.name)) {
          const text = await extractFileText(f)
          setAttachDocs((prev) => [...prev, { name: f.name, text }])
        } else {
          onToast(`不支持的文件类型：${f.name}（仅图片 / txt / md / pdf）`)
        }
      }
    },
    [onToast]
  )

  const send = useCallback(
    async (preset?: string) => {
      const text = (preset ?? input).trim()
      if (streaming) return
      if (!text && attachImages.length === 0 && attachDocs.length === 0) return
      // 纯换强调色指令：客户端直连，跳过 LLM（省 token + 即时生效）；拿不准则回落下方正常流程
      const accentIntent = parseAccentIntent(text)
      const accentApply = format === 'cards' ? onApplyAccent : onApplyArticleAccent
      if (accentIntent && accentApply) {
        if (!preset) setInput('')
        setError(null)
        setStreaming(true)
        const userMsg: ChatMessage = { role: 'user', content: text }
        setMessages([...messages, userMsg])
        try {
          await accentApply(accentIntent.color)
          const kind = format === 'cards' ? '贴图' : '文章'
          const reply = accentIntent.color
            ? `已把${kind}强调色改为 ${accentIntent.color}，排版/导出/推送同步跟色。`
            : `已恢复${kind}默认强调色。`
          const all = [...messages, userMsg, { role: 'assistant', content: reply } as ChatMessage]
          setMessages(all)
          await persist(all)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setStreaming(false)
        }
        return
      }
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
      // 文档附件：提取文本拼入上下文
      const docCtx = attachDocs.length > 0
        ? `<附件文档>\n${attachDocs.map((d) => `【${d.name}】\n${d.text}`).join('\n\n---\n\n')}\n</附件文档>\n`
        : ''
      // 可见消息：文本 + 图片数量提示
      const imgNote = attachImages.length > 0 ? ` [附 ${attachImages.length} 张图片]` : ''
      const display = [...messages, { role: 'user', content: text + imgNote } as ChatMessage]
      setMessages([...display, { role: 'assistant', content: '' }])
      // API 消息：有图片时走多模态 ContentPart[]，否则纯文本
      const textContent = `${ctx}${docCtx}${web.length > 0 ? `${webContext(web)}\n` : ''}${text}`
      let apiContent: string | ContentPart[]
      if (attachImages.length > 0) {
        apiContent = [
          ...attachImages.map((img) => ({ type: 'image_url' as const, image_url: { url: img.dataUrl } })),
          { type: 'text' as const, text: textContent }
        ]
      } else {
        apiContent = textContent
      }
      const apiUser: ChatMessage = { role: 'user', content: apiContent }
      // 发完清附件
      setAttachImages([])
      setAttachDocs([])
      const api: ChatMessage[] = [
        { role: 'system', content: freeChatSystemPrompt(skill) + toolsGuardrail(project) },
        ...messages,
        apiUser
      ]
      // 工具循环（chat-tools v1）：读类静默 / 写类结果卡 / 推送确认卡；最多 TOOL_ROUNDS_MAX 轮
      const bubbleIdx = display.length
      const history = [...api]
      const onDelta = (full: string): void => {
        setMessages([...display, { role: 'assistant', content: full } as ChatMessage])
      }
      const addToolCard = (tc: ToolCallInfo): number => {
        const list = toolCardsRef.current[bubbleIdx] ?? []
        const idx = list.length
        const next = {
          ...toolCardsRef.current,
          [bubbleIdx]: [...list, { name: tc.name, argsSummary: argsSummary(tc.arguments), status: 'running' as const }]
        }
        toolCardsRef.current = next
        setToolCards(next)
        return idx
      }
      const finishToolCard = (idx: number, ok: boolean, summary: string): void => {
        const list = [...(toolCardsRef.current[bubbleIdx] ?? [])]
        list[idx] = { ...list[idx], status: ok ? 'done' : 'error', result: summary.slice(0, 800) }
        const next = { ...toolCardsRef.current, [bubbleIdx]: list }
        toolCardsRef.current = next
        setToolCards(next)
      }
      const requestPushConfirm = (tc: ToolCallInfo): Promise<boolean> =>
        new Promise<boolean>((resolve) => {
          setPushConfirm({ tool: tc.name, summary: argsSummary(tc.arguments), resolve })
        })

      abortRef.current = null
      try {
        const tools = await getChatTools()
        let finalText = ''
        for (let round = 0; round < TOOL_ROUNDS_MAX; round++) {
          // 最后一轮不给工具：到达上限时模型只能文字总结
          const useTools = tools.length > 0 && round < TOOL_ROUNDS_MAX - 1
          const { promise, abort } = chatOnceWithTools(history, { tools: useTools ? tools : undefined, onDelta })
          abortRef.current = abort
          const res = await promise
          finalText = res.text
          if (!res.toolCalls?.length) break
          // 模型要调工具：assistant(tool_calls) 入 API 历史，逐个按确认分层执行
          history.push({
            role: 'assistant',
            content: res.text || '',
            tool_calls: res.toolCalls.map((t) => ({
              id: t.id,
              type: 'function' as const,
              function: { name: t.name, arguments: t.arguments }
            }))
          })
          for (const tc of res.toolCalls) {
            const cardIdx = addToolCard(tc)
            if (PUSH_TOOLS.includes(tc.name)) {
              // 外发动作：确认卡，用户点了才真正推送
              const ok = await requestPushConfirm(tc)
              if (!ok) {
                finishToolCard(cardIdx, false, '用户取消了推送')
                history.push({ role: 'tool', tool_call_id: tc.id, content: '用户取消了推送。' })
                continue
              }
            }
            const summary = await runToolCall(tc)
            finishToolCard(cardIdx, !summary.startsWith('失败：'), summary)
            history.push({ role: 'tool', tool_call_id: tc.id, content: summary })
          }
          if (round === TOOL_ROUNDS_MAX - 2) {
            // 下一轮到上限：要求模型文本总结，不再给工具
            history.push({ role: 'user', content: '请直接用文字总结以上操作的结果与结论，不要再调用工具。' })
          }
        }
        const all = [...display, { role: 'assistant', content: finalText } as ChatMessage]
        setMessages(all)
        await persist(all)
        // 回复尾部带 skill-install 指令：自动发起预览，弹确认卡片（降级路径的围栏协议照常生效）
        const { directive } = parseSkillDirective(finalText)
        if (directive) resolveCard(all.length - 1, directive, text)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        // 供应商不支持 tools 参数（报错带 tool 字样）：记住降级，后续回纯文本/围栏模式
        if (/tool/i.test(msg)) chatToolsUnsupported = true
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
    },
    [input, streaming, messages, skill, webOn, onToast, persist, resolveCard, buildContext, attachImages, attachDocs, format, onApplyAccent, onApplyArticleAccent]
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
          const mText = contentText(m.content)
          const parsed = m.role === 'assistant' ? parseSkillDirective(mText) : null
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
                {(articleParsed ? articleParsed.cleaned : mText) ||
                  (streaming && i === messages.length - 1 ? '…' : '')}
                {articleParsed?.pending && (
                  <span className="block text-ink-dim">✍ 正在生成修改稿…</span>
                )}
              </div>
              {toolCards[i]?.length ? (
                <div className="mt-1 flex w-full max-w-[90%] flex-col gap-1">
                  {toolCards[i].map((c, k) => (
                    <ToolCardView key={k} card={c} />
                  ))}
                </div>
              ) : null}
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
                    🎨 换{format === 'cards' ? '贴图' : '文章'}强调色：
                    {accentParsed.accent ? (
                      <>
                        <span className="inline-block h-4 w-4 rounded-full border border-panel-3" style={{ background: accentParsed.accent }} />
                        {accentParsed.accent}
                      </>
                    ) : (
                      '恢复默认色'
                    )}
                  </p>
                  {format === 'cards' ? (
                    !onApplyAccent ? (
                      <p className="mt-1 text-ink-dim">换色通道未就绪，无法应用</p>
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
                    )
                  ) : format === 'article' && onApplyArticleAccent ? (
                    accentState === 'done' ? (
                      <p className="mt-1 text-ink">✅ 已应用，编辑器与导出排版已跟色</p>
                    ) : (
                      <button
                        onClick={() => void applyAccent(i, accentParsed.accent ?? null)}
                        disabled={accentState === 'applying'}
                        className="mt-1.5 rounded bg-accent px-3 py-1 text-white hover:opacity-90 disabled:opacity-40"
                      >
                        {accentState === 'applying' ? '应用中…' : '✓ 应用到文章排版'}
                      </button>
                    )
                  ) : (
                    <p className="mt-1 text-ink-dim">当前未打开工程，无法应用</p>
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

      {/* 推送确认卡（chat-tools v1 外发动作）：用户点了才真正执行 */}
      {pushConfirm && (
        <div className="mx-2 mb-1 rounded border border-accent/60 bg-panel-2 p-2 text-xs">
          <p className="font-medium text-ink">🚀 确认推送：{TOOL_LABELS[pushConfirm.tool] ?? pushConfirm.tool}</p>
          <p className="mt-0.5 break-all text-ink-dim">{pushConfirm.summary || '（无参数摘要）'}</p>
          <div className="mt-1.5 flex gap-2">
            <button
              onClick={() => {
                pushConfirm.resolve(true)
                setPushConfirm(null)
              }}
              className="rounded bg-accent px-3 py-1 text-white hover:opacity-90"
            >
              ✓ 确认推送
            </button>
            <button
              onClick={() => {
                pushConfirm.resolve(false)
                setPushConfirm(null)
              }}
              className="rounded bg-panel-3 px-3 py-1 text-ink hover:bg-panel"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 输入区 */}
      <div className="border-t border-panel-3 p-2">
        {/* 附件预览条 */}
        {(attachImages.length > 0 || attachDocs.length > 0) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {attachImages.map((img, i) => (
              <span key={`img-${i}`} className="relative inline-block">
                <img src={img.dataUrl} alt={img.name} className="h-10 w-10 rounded border border-panel-3 object-cover" />
                <button
                  onClick={() => setAttachImages((prev) => prev.filter((_, k) => k !== i))}
                  className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] text-white"
                >
                  ✕
                </button>
              </span>
            ))}
            {attachDocs.map((doc, i) => (
              <span key={`doc-${i}`} className="inline-flex items-center gap-1 rounded bg-panel-3 px-1.5 py-0.5 text-[10px] text-ink-dim">
                📄 {doc.name.length > 12 ? doc.name.slice(0, 12) + '…' : doc.name}
                <button onClick={() => setAttachDocs((prev) => prev.filter((_, k) => k !== i))} className="text-red-400">✕</button>
              </span>
            ))}
          </div>
        )}
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
          placeholder="自由对话，Enter 发送（可附带图片/文档）"
          className="w-full resize-none rounded bg-panel-3 p-2 text-xs text-ink outline-none placeholder:text-ink-dim"
        />
        <input
          ref={attachRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.pdf"
          className="hidden"
          onChange={(e) => { void addAttachments(e.target.files); e.target.value = '' }}
        />
        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            onClick={() => attachRef.current?.click()}
            title="附带图片（走 vision）或文档（提取文本）"
            className="whitespace-nowrap rounded px-2 py-1 text-xs text-ink-dim hover:bg-panel-3"
          >
            📎 附件
          </button>
          <button
            onClick={() => setWebOn((v) => !v)}
            title="联网搜索：开启后每轮先搜索再回答（时效性问题建议开）；高亮 = 已开启"
            className={`whitespace-nowrap rounded px-2 py-1 text-xs ${webOn ? 'bg-accent/20 text-accent' : 'text-ink-dim hover:bg-panel-3'}`}
          >
            🌐 联网
          </button>
          <button
            onClick={() => setCtxOn((v) => !v)}
            disabled={!project}
            title="工程上下文：开启后每轮自动附带当前正文/贴图文案，AI 能直接回答内容相关问题；高亮 = 已开启"
            className={`mr-auto whitespace-nowrap rounded px-2 py-1 text-xs disabled:opacity-40 ${ctxOn && project ? 'bg-accent/20 text-accent' : 'text-ink-dim hover:bg-panel-3'}`}
          >
            📄 上下文
          </button>
          {streaming ? (
            <button onClick={abort} className="whitespace-nowrap rounded bg-panel-3 px-3 py-1 text-xs text-red-400 hover:bg-panel">
              停止
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim() && attachImages.length === 0 && attachDocs.length === 0}
              className="whitespace-nowrap rounded bg-accent px-3 py-1 text-xs text-white hover:opacity-90 disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </>
  )
}
