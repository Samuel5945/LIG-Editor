import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { confirmAction } from '../confirm'
import { ToolLogCard, type ToolCardState } from './ToolLogCard'
import { TOOL_LABELS } from '../copilot/toolLabels'
import { Icon, type IconName } from '../ui/Icon'
import { Button, Chip, FIELD_SHELL_CLS, IconButton, useFittingRow } from '../ui/primitives'
import type {
  ChatMessage,
  ChatSessionMeta,
  ChatToolSchema,
  ContentPart,
  SkillInstallDirective,
  SkillResolveResult,
  ToolCallInfo,
  ToolTraceEntry,
  WebSearchResult
} from '@shared/types'
import { buildToolSchemas, inventoryFor, parseTextToolCalls } from '@shared/llmText'
import { estimateTokens, hasImageInput, modelCapability, type ModelCapability } from '@shared/modelCatalog'
import { expandWrapperCalls, normalizeToolArgs } from '@shared/toolArgs'
import { extractInlineContent, parseSkillDirective } from '@shared/skillInstall'
import { cardsPlainText, parseAccentDirective } from '@shared/cards'
import { parseArticleUpdate } from '@shared/articleUpdate'
import { chatOnceWithTools, type ChatRoundResult } from '../copilot/llm'
import { chatContext, freeChatSystemPrompt, webContext } from '../copilot/prompts'
import { extractFileText } from '../copilot/material'
import { parseAccentIntent } from '@shared/accentIntent'
import { shouldSubmitOnEnter } from '@shared/imeEnter'

/** 从消息 content（可能是多模态数组）提取纯文本（渲染/标题/解析用） */
function contentText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; text: string }).text).join('')
}

/** 按模型上下文窗口裁剪历史（预算取窗口一半，给回复和系统提示留空间）：
 * 只在 user 消息边界落刀——assistant(tool_calls) 与其后 tool 结果成组，从中间截断会被 API 拒收。
 * 无目录声明的模型（未知窗口）不裁剪，保持引入目录前的行为 */
function trimHistory(msgs: ChatMessage[], cap: ModelCapability): ChatMessage[] {
  if (!cap.contextWindow) return msgs
  const budget = cap.contextWindow * 0.5
  const hasSystem = msgs.length > 0 && msgs[0].role === 'system'
  const head = hasSystem ? msgs.slice(0, 1) : []
  const body = hasSystem ? msgs.slice(1) : msgs
  const suffix: number[] = new Array(body.length + 1).fill(0)
  for (let i = body.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + estimateTokens(body[i].content)
  if (suffix[0] <= budget) return msgs
  for (let i = 0; i < body.length; i++) {
    if (body[i].role === 'user' && suffix[i] <= budget) return [...head, ...body.slice(i)]
  }
  return msgs
}

// ---- chat-tools v1：对话副驾驶工具调用 ----

const PUSH_TOOLS = ['push_draft', 'push_cards']
const TOOL_ROUNDS_MAX = 6

/** 工具注册表缓存（静态，与供应商无关）+ 按「baseUrl|模型」记忆原生 tools 参数不被接受。
 *  两件事必须分开：模型不接受原生 tools ≠ 没有工具——文本协议（围栏/XML 标签）照样由本渲染层执行，
 *  所以清单仍要写进系统提示。早先是一个全局布尔，任何报错就把工具整体关掉且界面毫无提示
 *  （「导出 word」模型看不见 export_docx、于是把全文贴回对话，就是这么来的） */
let cachedChatTools: ChatToolSchema[] | null = null
let nativeToolsRejected = ''
// 原生通路「被证实」的模型：真的收到过 tool_calls 才算。
// 聚合供应商常收下 tools 参数却从不返回调用，只看有没有报错会把「未证实」当成「可用」，
// 于是不注入清单——模型就对工具一无所知（实测回答「立格编辑器不支持导出 Word」）
let nativeProvenKey = ''
// 上一次带原生 tools 试探的时刻：拒收后每隔一段时间自动再试一次（供应商可能后续支持）
let nativeProbeAt = 0

/** 当前文本模型标识：原生工具支持按它记忆，换供应商/换模型自动重新试探 */
async function currentModelKey(): Promise<string> {
  try {
    const s = await window.api.invoke('settings:getLlm')
    const p = s.providers.find((x: { id: string }) => x.id === s.textProviderId)
    return p ? `${p.baseUrl}|${p.textModel}` : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 工具清单（发给 API 的原生 tools 参数用；文本协议模式下同样靠它生成提示里的名单） */
const schemaByName = new Map<string, unknown>()

async function getToolRegistry(): Promise<ChatToolSchema[]> {
  if (cachedChatTools) return cachedChatTools
  try {
    cachedChatTools = buildToolSchemas(await window.api.invoke('agent:listTools'))
    for (const t of cachedChatTools) schemaByName.set(t.function.name, t.function.parameters)
  } catch {
    // 取不到清单（主进程异常等）就当没有工具，本轮纯文本
  }
  return cachedChatTools ?? []
}

/** 该模型是否还能发原生 tools */
function nativeToolsFor(all: ChatToolSchema[], modelKey: string): ChatToolSchema[] {
  return nativeToolsRejected && nativeToolsRejected === modelKey ? [] : all
}

/** 供应商拒绝 tools 参数（报错带 tool 字样）：只记当前这个模型 */
function markNativeToolsRejected(modelKey: string): void {
  nativeToolsRejected = modelKey
}

/** 收到过原生 tool_calls = 这个模型的原生通路确实通 */
function markNativeProven(modelKey: string): void {
  nativeProvenKey = modelKey
}

function nativeProven(modelKey: string): boolean {
  return nativeProvenKey === modelKey
}

/** 清掉降级记忆重新试探（界面标记点击用） */
function resetNativeTools(): void {
  nativeToolsRejected = ''
  nativeProvenKey = ''
}

function safeParseArgs(argsJson: string): Record<string, unknown> {
  try {
    return JSON.parse(argsJson || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 参数摘要：一行键值串塞进工具卡。对象/数组转 JSON——String() 会变成没信息量的「[object Object]」 */
function argsSummary(argsJson: string): string {
  const args = safeParseArgs(argsJson)
  const keys = Object.keys(args)
  if (!keys.length) return ''
  const fmt = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? '')
  return keys
    .map((k) => `${k}: ${fmt(args[k]).slice(0, 40)}`)
    .join(' · ')
    .slice(0, 120)
}

/** 工具结果摘要：成功给内容片段，失败给原因（超长截断，完整结果可展开） */
function summarizeToolResult(r: { ok: boolean; result?: unknown; error?: string }): string {
  if (!r.ok) return `失败：${r.error ?? '未知错误'}`
  const s = typeof r.result === 'string' ? r.result : JSON.stringify(r.result)
  return s || '（无返回内容）'
}

/** 工具守则：注入系统提示（当前工程 + 补丁优先 + 一次一个工具 + 围栏降级协议）。
 *  inventory 由调用方按通路决定——原生 tools 能下发的模型不再重复列清单 */
function toolsGuardrail(project: string | null, inventory: string): string {
  return `\n\n<工具守则>\n${project ? `当前工程：「${project}」，涉及它的操作默认对它执行，但每个调用仍要显式带上 project=「${project}」。` : '当前未打开工程：需要工程参数时先 list_projects 查询，或先 create_project 立项再用它返回的工程名；写入类工具（write_article / patch_article / set_titles 等）一律要显式带 project，省略即失败。'}\n改正文优先用 patch_article（patches 传数组：[{"old":"原文唯一片段","new":"替换后文本"}]，old 须与正文逐字一致且全文唯一）；新写的整篇文章落成正文用 write_article（必须同时带 project 与 content），写前先读原文；已有正文的局部改动只用 patch_article，整篇重写或大幅调整走 article-update 围栏由作者在确认卡片里应用。\\n工程名照抄 list_projects / create_project 返回的 name 即可，标点变体（半角冒号、引号换成「」等）系统会自动归一匹配；名字里带奇怪标点时改传 dir（工程绝对路径）最稳。\n排版类请求分两层，两层常要连用：文本结构（分段、小标题、加粗、引用）用 patch_article，视觉参数（行距、字距、字体、段间距、引用形态、分隔线形态、加粗形态、圆角、内边距、表格样式、各类配色——set_theme 的 30 个字段全覆盖）用 set_theme；作者说「排版太挤」「不够醒目」「换个气质」时先看视觉层能不能解决，不要只动文字。\n作者要为某个分类设计整套排版主题 → 输出完整主题 JSON 调 save_theme_preset（accent 必填十六进制，其余字段按白名单口径给），保存即生效，该分类下的工程自动套用。\n工具返回里带 hint / ignoredKeys / unknownKeys 时（数值被夹取、键名不认识被忽略、只写入部分字段），必须把这些原样转述给用户，禁止把部分生效说成整套完成；用户给的值被改动过时，明确说出「你要的是 X，实际按 Y 生效」。\n一次只调用一个工具，等结果返回再决定下一步；结论要基于工具结果而非猜测。${inventory}\n用户想把你脑暴/撰写的内容落成工程：create_project（起简洁工程名）→ write_article 写入全文，完成后明确告知用户已落到哪个工程；只想存选题灵感时用 save_ideas。\n工具结果未确认成功前，不得声称已完成写入；工具失败时按返回的原因改正参数再试一次，仍失败就如实说明哪一步没做成、需要用户补什么，不得说「已完成」。\n若无法原生调用工具，改用文本协议发起（每次一个）：\n\`\`\`tool-call\n{"name": "工具名", "arguments": { 参数 }}\n\`\`\`\n或 <tool_call><function=工具名><parameter=参数名>值（可多行）</parameter></function></tool_call>。\n</工具守则>`
}

/** 经主进程执行单个工具，返回给模型的文本结果（成功给内容/失败给原因） */
async function runToolCall(tc: ToolCallInfo): Promise<string> {
  const r = await window.api.invoke('agent:callTool', tc.name, safeParseArgs(tc.arguments))
  return summarizeToolResult(r)
}

/**
 * 输入框内的工具胶囊（§5.9 输入区整合）：开启态主色软底。
 * `compact` 由胶囊行的单行测量给出——右栏窄到放不下「图标+文字」时退成纯图标胶囊
 * （名称留在 title 里），这样最后一只胶囊不会被右缘的发送键切掉一半。
 */
function ToolPill({
  icon,
  on,
  disabled,
  compact,
  onClick,
  title,
  children
}: {
  icon: IconName
  on?: boolean
  disabled?: boolean
  compact?: boolean
  onClick: () => void
  title?: string
  children: ReactNode
}): ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={typeof children === 'string' ? children : undefined}
      className={`inline-flex h-[26px] shrink-0 items-center justify-center gap-1.5 rounded-md text-[11.5px] transition-colors disabled:opacity-40 ${
        compact ? 'w-[26px]' : 'px-2.5'
      } ${on ? 'bg-accent/20 font-semibold text-accent' : 'text-ink-dim hover:bg-panel-3 hover:text-ink'}`}
    >
      <Icon name={icon} size={12} />
      {!compact && children}
    </button>
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
  /** AI 生成整套主题入库（save_theme_preset 成功）后通知 App 重拉自定义主题列表，主题库即时生效 */
  onCustomThemesChanged?: () => void
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
  status: 'resolving' | 'candidates' | 'ready' | 'installing' | 'done' | 'error'
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
  onCustomThemesChanged,
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
  /** 输入框内工具胶囊行的单行测量：narrow=右栏太窄，胶囊退成纯图标（§4 长标签降级） */
  const pillsRow = useFittingRow<HTMLDivElement>()
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
  // 会话桶：默认跟当前工程走；「临时」切换后看向临时对话桶（settings/chat-temp/，与主进程 TEMP_CHAT_KEY 对应）
  const [tempMode, setTempMode] = useState(false)
  const chatBucket = !project || tempMode ? '__temp__' : project
  // 附件：图片（dataURL 走 vision）+ 文档（提取文本拼入消息）
  const [attachImages, setAttachImages] = useState<{ name: string; dataUrl: string }[]>([])
  const [attachDocs, setAttachDocs] = useState<{ name: string; text: string }[]>([])
  const attachRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sessionCreatedRef = useRef<string | null>(null)
  // 当前文本供应商：思考开关/读图 gating/能力徽章/上下文裁剪都按它的模型目录声明走
  const [textProvider, setTextProvider] = useState<{ name: string; baseUrl: string; textModel: string } | null>(null)
  // 思考开关：null = 跟随模型目录默认；仅模型声明了思考能力时显示
  const [thinkOn, setThinkOn] = useState<boolean | null>(null)
  // 当前回复的流式思考过程（完成后随消息落盘，历史渲染走 m.reasoning）
  const [streamReasoning, setStreamReasoning] = useState('')
  const cap: ModelCapability = textProvider ? modelCapability(textProvider, textProvider.textModel) : {}
  // addAttachments 的 useCallback 依赖里不放 cap（对象每次渲染重建），经 ref 取最新值
  const capRef = useRef(cap)
  capRef.current = cap

  // 供应商变化（设置里改模型/换 Key 后）即时刷新能力声明
  useEffect(() => {
    const load = (): void => {
      void window.api
        .invoke('settings:getLlm')
        .then((s) => {
          const p = s.providers.find((x) => x.id === s.textProviderId) ?? s.providers[0] ?? null
          setTextProvider(p ? { name: p.name, baseUrl: p.baseUrl, textModel: p.textModel } : null)
        })
        .catch(() => {})
    }
    load()
    return window.api.on('settings:llmChanged', load)
  }, [])

  // ---- 会话列表 / 切换 ----

  const refreshSessions = useCallback(async () => {
    setSessions(await window.api.invoke('chat:list', chatBucket))
  }, [chatBucket])

  useEffect(() => {
    // 切工程：退出临时桶视角并重置会话上下文
    setTempMode(false)
    setSessionId(null)
    setMessages([])
    setCards({})
    setAccentCards({})
    setArticleCards({})
    setToolCards({})
    toolCardsRef.current = {}
    setPushConfirm(null)
    sessionCreatedRef.current = null
  }, [project])

  useEffect(() => {
    // 切会话桶（工程 ↔ 临时对话）：清空当前会话状态并加载目标桶的会话列表
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
  }, [chatBucket, refreshSessions])

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
    if (sessionId) {
      if (!(await confirmAction('删除当前会话？\n会话文件将被移除，不可恢复。', { okLabel: '删除' }))) return
      try {
        await window.api.invoke('chat:delete', chatBucket, sessionId)
        onToast('会话已删除')
      } catch (err) {
        onToast(`删除失败：${err instanceof Error ? err.message : err}`)
      }
      refreshSessions()
    }
    newSession()
  }, [chatBucket, sessionId, onToast, refreshSessions, newSession])

  const loadSession = useCallback(
    async (id: string) => {
      if (!id) return
      const s = await window.api.invoke('chat:read', chatBucket, id)
      setSessionId(s.id)
      setMessages(s.messages)
      setCards({})
      setAccentCards({})
      setArticleCards({})
      // 历史工具卡一并复原（切走再切回来也能看到当时调了什么工具）
      const restored: Record<number, ToolCardState[]> = {}
      for (const [idx, list] of Object.entries(s.toolTrace ?? {})) {
        const n = Number(idx)
        if (!Number.isInteger(n)) continue
        restored[n] = list.map((t) => ({
          name: t.name,
          argsSummary: t.argsSummary,
          status: t.status,
          result: t.result
        }))
      }
      setToolCards(restored)
      toolCardsRef.current = restored
      setPushConfirm(null)
      sessionCreatedRef.current = s.created_at
    },
    [chatBucket]
  )

  /** 每轮完成后把消息落盘 chat/<id>.json（无工程走临时对话桶 settings/chat-temp/） */
  const persist = useCallback(
    async (msgs: ChatMessage[]) => {
      if (msgs.length === 0) return
      const now = new Date().toISOString()
      let id = sessionId
      if (!id) {
        id = now.replace(/[:.]/g, '-')
        setSessionId(id)
      }
      if (!sessionCreatedRef.current) sessionCreatedRef.current = now
      const firstUser = msgs.find((m) => m.role === 'user')
      // 工具调用留痕随会话落盘（进行中的项不存）：事后能分清「没调工具」「调了失败」「调成功却撒谎」
      const trace: Record<string, ToolTraceEntry[]> = {}
      for (const [idx, list] of Object.entries(toolCardsRef.current)) {
        const settled = list.filter((c) => c.status !== 'running')
        if (settled.length)
          trace[idx] = settled.map((c) => ({
            name: c.name,
            argsSummary: c.argsSummary,
            status: c.status === 'error' ? ('error' as const) : ('done' as const),
            result: c.result
          }))
      }
      await window.api.invoke('chat:write', chatBucket, {
        id,
        title: contentText(firstUser?.content ?? '新会话').slice(0, 24),
        created_at: sessionCreatedRef.current,
        updated_at: now,
        messages: msgs,
        toolTrace: Object.keys(trace).length ? trace : undefined
      })
      refreshSessions()
    },
    [chatBucket, sessionId, refreshSessions]
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
      // 合集仓库：resolve 返回候选列表（content 为空），转候选选择态，点选后拿候选 ref 重走 resolve
      setCards((prev) => ({
        ...prev,
        [idx]: { status: result.candidates?.length ? 'candidates' : 'ready', directive: d, result }
      }))
    } catch (err) {
      setCards((prev) => ({
        ...prev,
        [idx]: { status: 'error', directive: d, error: err instanceof Error ? err.message : String(err) }
      }))
    }
  }, [])

  /** 候选选择态点选：用该候选的 blob 链接重新 resolve（走单文件解析链路出预览） */
  const pickCandidate = useCallback(
    (idx: number, card: InstallCard, ref: string) => {
      void resolveCard(idx, { ...card.directive, ref }, '')
    },
    [resolveCard]
  )

  const cancelCard = useCallback((idx: number) => {
    setCards((prev) => {
      const next = { ...prev }
      delete next[idx]
      return next
    })
  }, [])

  const installCard = useCallback(
    async (idx: number) => {
      const card = cards[idx]
      if (card?.status !== 'ready' || !card.result || card.result.scriptDep) return
      setCards((prev) => ({ ...prev, [idx]: { ...card, status: 'installing' } }))
      try {
        const name = await window.api.invoke('skill:installResolved', card.result.name, card.result.content)
        setCards((prev) => ({ ...prev, [idx]: { ...card, status: 'done' } }))
        onToast(`已安装 Skill：${name}`)
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

  /** 当轮自动附带的工程上下文：贴图工程喂卡片文案，否则喂正文（只拼 API 请求，不进可见历史）。
   *  正文按模型上下文窗口截断（窗口 60% 折算字符数，中文 1 token≈1.6 字符）；未知窗口保持 8000 字符现状 */
  const buildContext = useCallback(
    async (cap: ModelCapability): Promise<string> => {
      if (!ctxOn || !project) return ''
      if (format === 'cards') {
        const deck = await window.api.invoke('cards:read', project)
        if (!deck?.cards.length) return ''
        const label = deck.format === 'xhs' ? '小红书' : '公众号'
        return chatContext('cards', `格式：${label}贴图，共 ${deck.cards.length} 张\n${cardsPlainText(deck.cards)}`)
      }
      const maxChars = cap.contextWindow ? Math.max(8000, Math.floor((cap.contextWindow * 0.6) / 1.6)) : 8000
      return chatContext('article', article.slice(0, maxChars))
    },
    [ctxOn, project, format, article]
  )

  // ---- 附件处理 ----
  const addAttachments = useCallback(
    async (files: FileList | null) => {
      if (!files) return
      for (const f of Array.from(files)) {
        if (f.type.startsWith('image/')) {
          // 模型目录声明了输入模态但不带 image：直接拦下，免得请求发出去才报错
          const c = capRef.current
          if (c.inputModalities && !hasImageInput(c)) {
            onToast(`当前模型不支持读图（vision），已跳过：${f.name}`)
            continue
          }
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
      setStreamReasoning('')
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
      const ctx = await buildContext(cap)
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
      // 工具通路全自动：清单注入的判据是「这个模型真的返回过原生 tool_calls」，不是「请求没报错」；
      // 被记为拒收后每 10 分钟再自动试一次原生（供应商可能后续支持），
      // 试错的那一次由循环里的静默重试兜住，用户不需要看到任何状态
      const modelKey = await currentModelKey()
      const registry = await getToolRegistry()
      if (nativeToolsRejected === modelKey && Date.now() - nativeProbeAt > 600_000) resetNativeTools()
      const native = nativeToolsFor(registry, modelKey)
      if (native.length) nativeProbeAt = Date.now()
      const proven = nativeProven(modelKey)
      const api: ChatMessage[] = [
        {
          role: 'system',
          content:
            freeChatSystemPrompt(skill, { toolsAvailable: registry.length > 0 }) +
            toolsGuardrail(project, inventoryFor(registry, native, proven))
        },
        ...messages,
        apiUser
      ]
      // 思考开关（null=模型目录默认）与历史裁剪：超窗口的旧消息按 user 边界成段丢弃
      const thinkingOn = thinkOn ?? cap.reasoning?.defaultOn ?? false
      const history = [...trimHistory(api, cap)]
      // 工具循环（chat-tools v1）：读类静默 / 写类结果卡 / 推送确认卡；最多 TOOL_ROUNDS_MAX 轮
      const bubbleIdx = display.length
      const onDelta = (full: string): void => {
        setMessages([...display, { role: 'assistant', content: full } as ChatMessage])
      }
      const onReasoning = (full: string): void => setStreamReasoning(full)
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
      // 最后一轮的文本/思考提升到 try 外：失败落盘（保留现场）时 catch 里也能拿到
      let lastText = ''
      let lastReasoning = ''
      try {
        let forceTextOnly = false
        let toolFails = 0
        // 本轮各工具的最后一次结果（同名工具以最后一次为准，改对了就不算失败）：
        // 收尾时据此如实标注未落盘，防模型声称完成
        const outcomes = new Map<string, boolean>()
        for (let round = 0; round < TOOL_ROUNDS_MAX; round++) {
          // 最后一轮不给工具：到达上限时模型只能文字总结；连续失败后也强制文字收尾
          const useTools = native.length > 0 && !forceTextOnly && round < TOOL_ROUNDS_MAX - 1
          const ask = (withTools: boolean): Promise<ChatRoundResult> => {
            const r = chatOnceWithTools(history, {
              tools: withTools ? native : undefined,
              thinking: thinkingOn,
              onDelta,
              onReasoning
            })
            abortRef.current = r.abort
            return r.promise
          }
          let res: ChatRoundResult
          try {
            res = await ask(useTools)
          } catch (err) {
            const em = err instanceof Error ? err.message : String(err)
            // 原生 tools 被这个供应商拒收：本轮静默改走文本协议重试——不打断用户，也不需要他看到状态
            if (!useTools || !/tool/i.test(em)) throw err
            markNativeToolsRejected(modelKey)
            res = await ask(false)
          }
          // 非原生路径：部分供应商不支持 tools 参数，模型以文本协议（XML 标签 / ```tool-call 围栏）发起调用——收编执行
          const textCalls = res.toolCalls?.length
            ? { calls: [] as ToolCallInfo[], cleaned: res.text }
            : parseTextToolCalls(res.text)
          if (res.toolCalls?.length && !nativeProven(modelKey)) markNativeProven(modelKey)
          if (res.reasoning) lastReasoning = res.reasoning
          // 入参统一归一后再入历史与执行（原生与文本协议两条路同一口径）：
          // 模型爱写 line_height / 把数组写成 JSON 字符串，不归一的表现是工具报成功而 meta 没写
          const roundCalls: ToolCallInfo[] = expandWrapperCalls(
            res.toolCalls?.length
              ? res.toolCalls
              : textCalls.calls.map((c, k) => ({ id: `text_${round}_${k}`, name: c.name, arguments: c.arguments }))
          ).map((tc) => ({ ...tc, arguments: normalizeToolArgs(tc.arguments, schemaByName.get(tc.name)) }))
          lastText = textCalls.cleaned
          if (!roundCalls.length) break
          // 模型要调工具：assistant(tool_calls) 入 API 历史，逐个按确认分层执行
          history.push({
            role: 'assistant',
            content: lastText || '',
            tool_calls: roundCalls.map((t) => ({
              id: t.id,
              type: 'function' as const,
              function: { name: t.name, arguments: t.arguments }
            }))
          })
          for (const tc of roundCalls) {
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
            const ok = !summary.startsWith('失败：')
            finishToolCard(cardIdx, ok, summary)
            // AI 生成的整套主题入库：立刻让 App 重拉自定义主题列表，
            // 作者不用重开应用就能在该分类的调性下拉里看到它（新分类目录也会随 workspace:changed 出现）
            if (ok && tc.name === 'save_theme_preset') onCustomThemesChanged?.()
            history.push({ role: 'tool', tool_call_id: tc.id, content: summary })
            if (!PUSH_TOOLS.includes(tc.name)) outcomes.set(tc.name, ok)
            // 连续两次工具失败：停止重试，让模型向用户询问缺失信息而不是死循环
            toolFails = ok ? 0 : toolFails + 1
            if (toolFails >= 2) {
              history.push({
                role: 'user',
                content: '工具连续失败。请停止重试，直接向用户说明哪里出了问题、需要用户提供什么信息。'
              })
              forceTextOnly = true
              break
            }
          }
          if (round === TOOL_ROUNDS_MAX - 2) {
            // 下一轮到上限：要求模型文本总结，不再给工具
            history.push({ role: 'user', content: '请直接用文字总结以上操作的结果与结论，不要再调用工具。' })
            forceTextOnly = true
          }
        }
        // 仍有工具以失败收尾：相关内容并未写入，明确标注（模型在这一环最容易声称「已完成」）
        const stillFailing = [...outcomes]
          .filter(([, ok]) => !ok)
          .map(([name]) => TOOL_LABELS[name] ?? name)
        // 更荒唐的一类：一个工具都没跑却声称做完了（实测回答「小结已扩充」而正文一字未变）。
        // 判据只能靠措辞 + 本轮零工具调用，宁可多标一句也别让假完成蒙过去
        const claimsWrite =
          /(正文|小结|标题|文章|工程|贴图|卡片|文件)/.test(lastText) &&
          /((已|已经)[^。\n]{0,8}(扩充|修改|改好|改完|润色|调整|更新|改写|重写|写入|落盘|落入|落到|存进|保存|加上|加好))|(写入成功|导出成功|已落入|已保存到)/.test(
            lastText
          )
        const emittedBlock = /```(article-update|tool-call|skill-install|cards-accent)/.test(lastText)
        const notes: string[] = []
        if (stillFailing.length) notes.push(`注意：本轮仍有工具失败（${stillFailing.join('、')}），相关内容未确认写入工程。`)
        else if (claimsWrite && outcomes.size === 0 && !emittedBlock)
          notes.push('注意：本轮没有执行任何工具，也没有产出修改稿卡片——上述「已完成」不可信，内容并未落到工程。')
        const note = notes.length ? `${lastText.trim() ? '\n\n' : ''}${notes.join('\n')}` : ''
        const all = [
          ...display,
          { role: 'assistant', content: lastText + note, ...(lastReasoning ? { reasoning: lastReasoning } : {}) } as ChatMessage
        ]
        setMessages(all)
        await persist(all)
        // 回复尾部带 skill-install 指令：自动发起预览，弹确认卡片（降级路径的围栏协议照常生效）
        const { directive } = parseSkillDirective(lastText)
        if (directive) resolveCard(all.length - 1, directive, text)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        // 供应商拒收 tools 参数（报错带 tool 字样）：只记当前这个模型，工具转文本协议
        if (/tool/i.test(msg)) markNativeToolsRejected(modelKey)
        // 失败也落盘：保留现场供取证 + 已生成的部分文本与思考
        if (lastText || lastReasoning) {
          try {
            await persist([
              ...display,
              { role: 'assistant', content: lastText, ...(lastReasoning ? { reasoning: lastReasoning } : {}) } as ChatMessage
            ])
          } catch {
            // 落盘失败不掩盖原错误
          }
        }
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
    },
    [input, streaming, messages, skill, webOn, onToast, persist, resolveCard, buildContext, attachImages, attachDocs, format, onApplyAccent, onApplyArticleAccent, onCustomThemesChanged, cap, thinkOn]
  )

  const abort = useCallback(() => abortRef.current?.(), [])


  // ---- 渲染 ----

  return (
    <>
      {/* 会话条（稿 A 标注④）：临时=可切换上下文胶囊，会话选择=圆角下拉，新建/删除收成图标按钮 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-panel-3 px-3 py-2 text-xs">
        <Chip
          on={chatBucket === '__temp__' && !!project}
          icon="message"
          onClick={() => setTempMode((v) => !v)}
          title="临时对话：不落在任何工程下的会话（存于本机 settings）"
          className="shrink-0"
        >
          临时
        </Chip>
        <select
          value={sessionId ?? ''}
          onChange={(e) => (e.target.value ? loadSession(e.target.value) : newSession())}
          className="h-[26px] min-w-0 flex-1 rounded-full border border-panel-3 bg-panel-2 px-2.5 text-[11.5px] text-ink outline-none disabled:opacity-50"
        >
          <option value="">{chatBucket === '__temp__' ? '临时对话' : '当前会话'}</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <IconButton icon="plus" onClick={newSession} title="新会话" className="shrink-0 px-1.5" />
        <IconButton
          icon="trash"
          onClick={() => void deleteSession()}
          disabled={!project || (!sessionId && messages.length === 0)}
          title="删除当前会话"
          className="shrink-0 px-1.5 hover:text-st-bad"
        />
      </div>

      {/* 消息区：min-h-0 是必须的——flex 项默认 min-height:auto 不肯缩到内容以下，
          长会话会把下方输入区顶出右栏（外层 overflow-hidden 直接裁掉），表现就是「切换会话后对话框点不动」 */}
      <div ref={listRef} className="selectable thin-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 text-xs">
        {messages.length === 0 && (
          <div>
            <p className="mb-2 text-ink-dim">
              自由对话，Enter 发送。默认自动带上当前正文/贴图内容，可用下方「附件」胶囊。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void send(PRESET_INSPIRE)}
                className="rounded-lg border border-panel-3 bg-panel-2 p-2.5 text-left hover:bg-panel-3"
              >
                <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><Icon name="bulb" size={12} className="text-accent" />今日灵感</span>
                <span className="mt-1 block leading-4 text-ink-dim">结合今天日期给 5 个选题灵感</span>
              </button>
              <button
                onClick={() => void send(PRESET_TAGS)}
                disabled={!project}
                title={project ? undefined : '先打开工程'}
                className="rounded-lg border border-panel-3 bg-panel-2 p-2.5 text-left hover:bg-panel-3 disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><Icon name="tag" size={12} className="text-accent" />话题标签推荐</span>
                <span className="mt-1 block leading-4 text-ink-dim">按当前正文/贴图推荐发布标签</span>
              </button>
              <button
                onClick={onGoBrainstorm}
                className="rounded-lg border border-panel-3 bg-panel-2 p-2.5 text-left hover:bg-panel-3"
              >
                <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><Icon name="brain" size={12} className="text-accent" />脑暴选题</span>
                <span className="mt-1 block leading-4 text-ink-dim">去「脑暴创作」出选题和正文</span>
              </button>
              <button
                onClick={onGoReview}
                disabled={!project}
                title={project ? undefined : '先打开工程'}
                className="rounded-lg border border-panel-3 bg-panel-2 p-2.5 text-left hover:bg-panel-3 disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><Icon name="search" size={12} className="text-accent" />审阅打磨</span>
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
              {m.role === 'assistant' &&
                (m.reasoning || (streaming && i === messages.length - 1 && streamReasoning)) && (
                  <details className="max-w-[92%] rounded-lg border border-panel-3 bg-panel-2 px-2.5 py-1.5 text-[11px] text-ink-dim">
                    <summary className="cursor-pointer select-none">
                      {streaming && i === messages.length - 1 && !mText ? '思考中…' : '思考过程'}
                    </summary>
                    <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
                      {m.reasoning || streamReasoning}
                    </div>
                  </details>
                )}
              <div
                className={`max-w-[92%] break-words whitespace-pre-wrap px-3 py-2 text-[12.5px] leading-relaxed ${
                  m.role === 'user' ? 'rounded-[12px_4px_12px_12px] bg-accent/15 text-ink' : 'rounded-[4px_12px_12px_12px] bg-panel-3 text-ink'
                }`}
              >
                {(articleParsed ? articleParsed.cleaned : mText) ||
                  (streaming && i === messages.length - 1 ? '…' : '')}
                {articleParsed?.pending && (
                  <span className="block text-ink-dim"><Icon name="pencil" size={12} className="mr-1" />正在生成修改稿…</span>
                )}
              </div>
              {toolCards[i]?.length ? <ToolLogCard cards={toolCards[i]} /> : null}
              {articleParsed?.update !== undefined && (
                <div className="mt-1 max-w-[90%] rounded-lg border border-panel-3 bg-panel-2 px-2.5 py-2">
                  <p className="flex items-center gap-1.5 font-semibold text-ink"><Icon name="file" size={12} className="text-accent" />修改正文（{articleParsed.update.length} 字）</p>
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-ink-dim">
                    {articleParsed.update.slice(0, 120)}…
                  </p>
                  {format !== 'article' || !onApplyArticle ? (
                    <p className="mt-1 text-ink-dim">当前工程不是文章形态，无法应用</p>
                  ) : articleState === 'done' ? (
                    <p className="mt-1 flex items-center gap-1.5 text-st-done"><Icon name="checkCircle" size={12} className="" />已应用到正文</p>
                  ) : (
                    <>
                      {article.length > 8000 && (
                        <p className="mt-1 text-st-draft">
                          <Icon name="alert" size={12} className="mr-1" />当前正文较长，AI 可能只看到开头部分，应用前请确认结尾完整
                        </p>
                      )}
                      <button
                        onClick={() => applyArticle(i, articleParsed.update!)}
                        className="mt-1.5 rounded bg-accent px-3 py-1 text-white hover:opacity-90"
                      >
                        应用到正文
                      </button>
                    </>
                  )}
                </div>
              )}
              {accentParsed?.accent !== undefined && (
                <div className="mt-1 max-w-[90%] rounded-lg border border-panel-3 bg-panel-2 px-2.5 py-2">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    <Icon name="palette" size={12} className="mr-1" />换{format === 'cards' ? '贴图' : '文章'}强调色：
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
                      <p className="mt-1 flex items-center gap-1.5 text-st-done"><Icon name="checkCircle" size={12} className="" />已应用，全组重渲完成</p>
                    ) : (
                      <button
                        onClick={() => void applyAccent(i, accentParsed.accent ?? null)}
                        disabled={accentState === 'applying'}
                        className="mt-1.5 rounded bg-accent px-3 py-1 text-white hover:opacity-90 disabled:opacity-40"
                      >
                        {accentState === 'applying' ? '应用中，整组重渲…' : '应用并重渲全组'}
                      </button>
                    )
                  ) : format === 'article' && onApplyArticleAccent ? (
                    accentState === 'done' ? (
                      <p className="mt-1 flex items-center gap-1.5 text-st-done"><Icon name="checkCircle" size={12} className="" />已应用，编辑器与导出排版已跟色</p>
                    ) : (
                      <button
                        onClick={() => void applyAccent(i, accentParsed.accent ?? null)}
                        disabled={accentState === 'applying'}
                        className="mt-1.5 rounded bg-accent px-3 py-1 text-white hover:opacity-90 disabled:opacity-40"
                      >
                        {accentState === 'applying' ? '应用中…' : '应用到文章排版'}
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
                      <Icon name="package" size={12} className="mr-1" />处理这个 Skill 安装请求
                    </button>
                  )}
                  {card?.status === 'resolving' && <p className="flex items-center gap-1.5 text-ink-dim"><Icon name="spinner" size={12} className="mr-0 animate-spin" />正在获取 Skill…</p>}
                  {card?.status === 'candidates' && card.result?.candidates && (
                    <>
                      <p className="flex items-center gap-1.5 font-semibold text-ink"><Icon name="package" size={12} className="" />合集仓库发现 {card.result.candidates.length} 个 Skill，选择要安装的：</p>
                      <div className="mt-1 max-h-56 space-y-1 overflow-y-auto pr-1">
                        {card.result.candidates.map((c) => (
                          <button
                            key={c.ref}
                            onClick={() => pickCandidate(i, card, c.ref)}
                            className="block w-full rounded bg-panel-3 px-2 py-1 text-left text-ink hover:bg-panel"
                          >
                            {c.name}
                            <span className="ml-1.5 break-all text-[11px] text-ink-dim">{c.path}</span>
                          </button>
                        ))}
                      </div>
                      <div className="mt-1.5 flex gap-2">
                        <button
                          onClick={() => cancelCard(i)}
                          className="rounded bg-panel-3 px-3 py-1 text-ink-dim hover:bg-panel"
                        >
                          取消
                        </button>
                      </div>
                    </>
                  )}
                  {(card?.status === 'ready' || card?.status === 'installing') && card.result && (
                    <>
                      <p className="flex items-center gap-1.5 font-semibold text-ink"><Icon name="package" size={12} className="" />安装 Skill：{card.result.name}</p>
                      <p className="mt-0.5 break-all text-ink-dim">来源：{card.result.origin}</p>
                      {card.result.description && (
                        <p className="mt-0.5 text-ink-dim">{card.result.description}</p>
                      )}
                      <p className="mt-0.5 text-ink-dim">
                        {card.result.content.length} 字
                        {card.result.exists ? '（已存在同名 Skill，装完会覆盖）' : ''}
                      </p>
                      {card.result.scriptDep && (
                        <p className="mt-0.5 break-all text-st-bad">
                          <Icon name="alert" size={12} className="mr-1" />检测到依赖脚本执行（{card.result.scriptDep}），本应用只能注入提示词、无法执行脚本，已阻止安装
                        </p>
                      )}
                      <div className="mt-1.5 flex gap-2">
                        {!card.result.scriptDep && (
                          <button
                            onClick={() => installCard(i)}
                            disabled={card.status === 'installing'}
                            className="rounded bg-accent px-3 py-1 text-white hover:opacity-90 disabled:opacity-40"
                          >
                            {card.status === 'installing' ? '安装中…' : '安装'}
                          </button>
                        )}
                        <button
                          onClick={() => cancelCard(i)}
                          disabled={card.status === 'installing'}
                          className="rounded bg-panel-3 px-3 py-1 text-ink-dim hover:bg-panel disabled:opacity-40"
                        >
                          取消
                        </button>
                      </div>
                    </>
                  )}
                  {card?.status === 'done' && (
                    <p className="flex items-center gap-1.5 text-st-done"><Icon name="checkCircle" size={12} className="" />已安装 Skill：{card.result?.name}</p>
                  )}
                  {card?.status === 'error' && (
                    <>
                      <p className="break-all text-st-bad"><Icon name="xCircle" size={12} className="mr-1" />{card.error}</p>
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
        {error && <p className="mt-1 break-all text-st-bad"><Icon name="xCircle" size={12} className="mr-1" />{error}</p>}
        {searching && <p className="mt-1 text-ink-dim"><Icon name="globe" size={12} className="mr-1" />联网搜索中…</p>}
      </div>

      {/* 推送确认卡（chat-tools v1 外发动作）：用户点了才真正执行 */}
      {pushConfirm && (
        <div className="mx-3 mb-1.5 rounded-xl border border-accent/50 bg-panel-2 p-3 shadow-[0_4px_16px_rgba(0,0,0,.18)]">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
            <Icon name="send" size={13} className="text-accent" />
            确认推送：{TOOL_LABELS[pushConfirm.tool] ?? pushConfirm.tool}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-ink-dim">{pushConfirm.summary || '（无参数摘要）'}</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="pri"
              icon="check"
              onClick={() => {
                pushConfirm.resolve(true)
                setPushConfirm(null)
              }}
            >
              确认推送
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                pushConfirm.resolve(false)
                setPushConfirm(null)
              }}
            >
              取消
            </Button>
          </div>
        </div>
      )}

      {/* 输入区（shrink-0：附件预览条再高也不许被压，消息区该让的是自己那一份高度） */}
      <div className="shrink-0 border-t border-panel-3 p-2">
        {/* 附件预览条 */}
        {(attachImages.length > 0 || attachDocs.length > 0) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {attachImages.map((img, i) => (
              <span key={`img-${i}`} className="relative inline-block">
                <img src={img.dataUrl} alt={img.name} className="h-10 w-10 rounded border border-panel-3 object-cover" />
                <button
                  onClick={() => setAttachImages((prev) => prev.filter((_, k) => k !== i))}
                  className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-st-bad text-white"
                >
                  <Icon name="x" size={8} />
                </button>
              </span>
            ))}
            {attachDocs.map((doc, i) => (
              <span key={`doc-${i}`} className="inline-flex items-center gap-1 rounded bg-panel-3 px-1.5 py-0.5 text-[10px] text-ink-dim">
                <Icon name="file" size={12} className="mr-1" /> {doc.name.length > 12 ? doc.name.slice(0, 12) + '…' : doc.name}
                <button onClick={() => setAttachDocs((prev) => prev.filter((_, k) => k !== i))} className="text-st-bad"><Icon name="x" size={10} /></button>
              </span>
            ))}
          </div>
        )}
        {/* 输入框壳（稿 A 标注⑥）：附件/联网/上下文并进框内工具胶囊行，聚焦主色描边 + 3px 光晕 */}
        <div className={`rounded-xl ${FIELD_SHELL_CLS} bg-panel-2`}>
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // 组合中的 Enter 是「确认候选词上屏」，不是提交：早先按 e.key==='Enter' 直接发送，
            // 中文打一句按回车确认候选，半截拼音就被当成消息发出去并清空输入框（表现为「对话框偶尔打不了字」）
            if (!shouldSubmitOnEnter(e)) return
            e.preventDefault()
            void send()
          }}
          placeholder="自由对话，Enter 发送（可附带图片/文档）"
          className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-xs leading-relaxed text-ink outline-none placeholder:text-ink-dim"
        />
        <input
          ref={attachRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.pdf"
          className="hidden"
          onChange={(e) => { void addAttachments(e.target.files); e.target.value = '' }}
        />
        {/* 工具胶囊行与上方文字同一 12px 列；发送/停止键在滚动区外面，永远点得到。
            右栏窄到放不下「图标+文字」时整行退成纯图标胶囊（§4 长标签降级同一套规则），
            名称留在 title 与 aria-label 里——这样最后一只「上下文」不会再被发送键切掉一半。
            行首第一个是「附件」，行内不展示模型目录能力徽章（上下文/读图/思考） */}
        <div className="flex min-w-0 items-center gap-1 px-3 pb-2.5">
          <div ref={pillsRow.ref} data-overflow={pillsRow.overflow ? '1' : '0'} className="chip-row flex min-w-0 flex-1 items-center gap-1">
            <ToolPill
              compact={pillsRow.narrow}
              icon="clip"
              onClick={() => attachRef.current?.click()}
              title={
                cap.inputModalities && !hasImageInput(cap)
                  ? '当前模型不支持读图（vision），仅可附带文档（提取文本）'
                  : '附带图片（走 vision）或文档（提取文本）'
              }
            >
              附件
            </ToolPill>
            <ToolPill
              compact={pillsRow.narrow}
              on={webOn}
              icon="globe"
              onClick={() => setWebOn((v) => !v)}
              title="联网搜索：开启后每轮先搜索再回答（时效性问题建议开）"
            >
              联网
            </ToolPill>
            <ToolPill
              compact={pillsRow.narrow}
              on={ctxOn && !!project}
              disabled={!project}
              icon="book"
              onClick={() => setCtxOn((v) => !v)}
              title="工程上下文：开启后每轮自动附带当前正文/贴图文案，AI 能直接回答内容相关问题"
            >
              上下文
            </ToolPill>
            {cap.reasoning && (
              <ToolPill
                compact={pillsRow.narrow}
                on={thinkOn ?? cap.reasoning.defaultOn}
                icon="brain"
                onClick={() => setThinkOn(!(thinkOn ?? cap.reasoning!.defaultOn))}
                title={`模型思考：${(thinkOn ?? cap.reasoning.defaultOn) ? '已开启' : '已关闭'}，开启后模型先推理再回答，耗时略增`}
              >
                思考
              </ToolPill>
            )}
          </div>
          {streaming ? (
            <button
              onClick={abort}
              title="停止生成"
              className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-panel-3 text-st-bad hover:bg-panel"
            >
              <Icon name="square" size={13} />
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim() && attachImages.length === 0 && attachDocs.length === 0}
              title="发送（Enter）"
              className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-accent text-white hover:brightness-110 disabled:opacity-40"
            >
              <Icon name="send" size={14} />
            </button>
          )}
        </div>
        </div>
      </div>
    </>
  )
}
