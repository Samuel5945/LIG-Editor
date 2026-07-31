import type { CardDeck, CardFormat } from './cards'

/** 全局共享类型：领域模型 + IPC 契约（主/渲染进程共用） */

// ---------- 领域模型（PRD §4） ----------

export type ProjectStatus = 'ideating' | 'drafting' | 'reviewing' | 'ready'

export interface TopicInfo {
  angle: string
  audience: string
  source_material: string[]
}

export interface TitleCandidate {
  text: string
  score: number
  reason: string
}

export interface CoverInfo {
  main: string // assets/cover-235.png（2.35:1）
  square: string // assets/cover-11.png（1:1）
}

export interface ProjectMeta {
  name: string
  status: ProjectStatus
  topic?: TopicInfo
  titles: TitleCandidate[]
  cover?: CoverInfo
  /** 工程形态：article 文章（默认）/ cards 贴图（中央区显示贴图面板，风格存 cards.json） */
  format?: 'article' | 'cards'
  style_skill?: string
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  name: string
  dir: string
  status: ProjectStatus
  updated_at: string
}

/** 工程内直接可编辑的文本文件（约定文件名即 ID）；cards-review.md 按需创建不预建 */
export type ProjectTextFile = 'article.md' | 'ideas.md' | 'review.md' | 'cards-review.md'

/** 打开工程时一次性返回的数据 */
export interface ProjectData {
  meta: ProjectMeta
  article: string
}

/** 应用根目录布局（workspace/skills/settings 与 docs 同级） */
export interface AppPaths {
  root: string
  workspace: string
  skills: string
  settings: string
  ideaInbox: string
}

// ---------- 模型接入（M4） ----------

export interface ProviderConfig {
  id: string
  name: string
  baseUrl: string
  /** 渲染层明文往返；主进程落盘时 safeStorage 加密 */
  apiKey: string
  textModel: string
  imageModel: string
  /** 图像调用格式：标准 OpenAI images / Agnes images 变体（size档位+ratio+return_base64） */
  imageApi: 'openai-images' | 'agnes-images'
}

/** AI 生图可选参数（Agnes 档位式尺寸 + 宽高比；标准 OpenAI 只用 size） */
export interface ImageGenOptions {
  /** Agnes：1K/2K/3K/4K；OpenAI：1024x1024 等精确尺寸 */
  size?: string
  /** Agnes 专用：1:1 / 4:3 / 16:9 / 3:4 / 9:16 / 2:3 / 3:2 / 21:9 */
  ratio?: string
}

export interface LlmSettings {
  providers: ProviderConfig[]
  /** 文本/图像默认供应商分开指定 */
  textProviderId: string | null
  imageProviderId: string | null
  /** 联网搜索配置：默认免密内置，可选搜索 API 提升时效与质量 */
  search: SearchSettings
}

export interface SearchSettings {
  /** none=免密内置（DDG/Bing 抓取）；tavily/bocha 需 API Key */
  provider: 'none' | 'tavily' | 'bocha'
  /** 主进程落盘时 safeStorage 加密 */
  apiKey: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmTestResult {
  ok: boolean
  message: string
}

// ---------- 副驾驶（M5） ----------

/** 会话摘要（chat/*.json 文件名即 id） */
export interface ChatSessionMeta {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ChatSession extends ChatSessionMeta {
  messages: ChatMessage[]
}

/** skills/ 目录下可挂载的风格/能力 Skill（SKILL.md 为内容主体） */
export interface SkillInfo {
  name: string
  description: string
  dir: string
  /** false = 目录内有 .disabled 标记，挂载列表隐藏 */
  enabled: boolean
}

/** 对话安装 Skill：模型输出的 skill-install 指令（M9 反馈迭代） */
export interface SkillInstallDirective {
  source: 'github' | 'url' | 'path' | 'inline'
  /** github 仓库/链接、md 直链、本地路径；inline 时省略 */
  ref?: string
  /** 目标 Skill 名；inline 必填，其余可由 ref 推导 */
  name?: string
  /** inline 的 SKILL.md 内容（渲染层从用户消息提取，不经模型复述） */
  content?: string
}

/** 对话安装 Skill：预览结果（只取内容不落盘，确认后才安装） */
export interface SkillResolveResult {
  name: string
  description: string
  content: string
  /** 来源展示文案：成功的下载 URL / 本地路径 / 「对话粘贴」 */
  origin: string
  /** 同名 Skill 已存在，安装将覆盖 */
  exists: boolean
  /** 非空=检出脚本执行依赖（命中描述），本应用无法执行此类 Skill，卡片阻断安装 */
  scriptDep: string | null
}

/** MCP 一键接入卡片（M8）：给外部 Agent 的注册配置片段 */
export interface McpAccessCard {
  /** MCP server 启动命令（electron/应用 exe，以 RUN_AS_NODE 跑代理脚本） */
  command: string
  args: string[]
  /** 必需环境变量（ELECTRON_RUN_AS_NODE=1） */
  env: Record<string, string>
  /** Codex config.toml 片段 */
  codexToml: string
  /** Qoder/Claude 等 mcp.json 片段 */
  qoderJson: string
  /** HTTP bridge 配置文件绝对路径（GUI 运行时有效） */
  bridgeFile: string
}

/** 脑暴产出的选题卡（入库到全局选题库 idea-inbox.md） */
export interface IdeaCard {
  title: string
  angle: string
  audience: string
  score: number
  reason: string
}

/** 选题库条目：index 为在库文件中的段序号（删除用） */
export interface IdeaEntry extends IdeaCard {
  index: number
}

/** 联网搜索结果（主进程抓取，注入提示词给模型读） */
export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  /** 发布时间（新闻源/页面元信息提取，可能缺失） */
  date?: string
  /** 深抓的页面正文节选（仅 web:research 对 top 结果填充） */
  content?: string
}

// ---------- IPC 契约 ----------
// 所有 invoke 通道集中定义；主进程 handle 与渲染进程调用共享此单一来源

export interface IpcApi {
  'app:getPaths': () => AppPaths
  'app:ping': () => string
  /** 扫描 workspace 下所有含 project.json 的工程 */
  'project:list': () => ProjectSummary[]
  'project:create': (name: string) => ProjectSummary
  /** 删除整个工程目录（渲染层需先确认；删当前工程前先 project:close） */
  'project:delete': (name: string) => void
  /** 打开工程：返回 meta+正文，并让主进程开始监听该工程目录 */
  'project:open': (name: string) => ProjectData
  'project:close': () => void
  'project:readFile': (project: string, file: ProjectTextFile) => string
  'project:writeFile': (project: string, file: ProjectTextFile, content: string) => void
  'project:readMeta': (project: string) => ProjectMeta
  'project:writeMeta': (project: string, meta: ProjectMeta) => void
  // ---- 模型接入（M4）----
  'settings:getLlm': () => LlmSettings
  'settings:setLlm': (settings: LlmSettings) => void
  /** 用给定配置试连（不要求先保存） */
  'llm:test': (provider: ProviderConfig) => LlmTestResult
  /** 发起流式对话；增量通过 llm:stream 事件推送 */
  'llm:chatStart': (requestId: string, messages: ChatMessage[]) => void
  'llm:abort': (requestId: string) => void
  // ---- 副驾驶（M5）----
  'chat:list': (project: string) => ChatSessionMeta[]
  'chat:read': (project: string, id: string) => ChatSession
  'chat:write': (project: string, session: ChatSession) => void
  'chat:delete': (project: string, id: string) => void
  'skill:list': () => SkillInfo[]
  /** 读 Skill 的 SKILL.md 全文（挂载时注入系统提示） */
  'skill:read': (name: string) => string
  // ---- Skill 管理 + MCP 接入（M8）----
  /** 导入 Skill：含 SKILL.md 的文件夹或单 .md 文件的绝对路径，返回 Skill 名 */
  'skill:import': (sourcePath: string) => string
  'skill:setEnabled': (name: string, enabled: boolean) => void
  /** 删除 Skill：整目录移除，不可恢复 */
  'skill:remove': (name: string) => void
  /** 对话安装 Skill：按指令取到 SKILL.md 内容并预览，不落盘 */
  'skill:resolve': (directive: SkillInstallDirective) => SkillResolveResult
  /** 对话安装 Skill：确认后写入 skills/<name>/SKILL.md，返回清洗后的最终名 */
  'skill:installResolved': (name: string, content: string) => string
  /** 生成外部 Agent 一键接入配置（Codex/Qoder 片段） */
  'mcp:accessCard': () => McpAccessCard
  /** 保存二进制资产（base64）到工程相对路径，返回相对路径 */
  'project:saveAsset': (project: string, relPath: string, base64: string) => string
  /** 无工程上下文时脑暴选题入库到全局 idea-inbox.md */
  'inbox:append': (text: string) => void
  // ---- 全局选题库（idea-inbox.md 结构化读写）----
  'ideas:list': () => IdeaEntry[]
  'ideas:add': (idea: IdeaCard) => void
  'ideas:remove': (index: number) => void
  /** 免密联网搜索（主进程 net.fetch 走系统代理，DDG 优先 Bing 兜底；fresh 限近一个月） */
  'web:search': (query: string, fresh?: boolean) => WebSearchResult[]
  /** 审阅级深度检索：多查询+新闻源+深抓正文；配了搜索 API 则走 API */
  'web:research': (queries: string[]) => WebSearchResult[]
  // ---- 三配图管线（M6）----
  /** AI 生图：返回图片 base64（不落盘，预览确认后经 project:saveAsset 入 assets/） */
  'image:generate': (prompt: string, opts?: ImageGenOptions) => string
  /** 保存图表 HTML 源码；relPath 缺省时新建 figures/fig-N.html，返回相对路径 */
  'figure:saveHtml': (project: string, html: string, relPath?: string) => string
  /** 读图表 HTML 源码（改源码重渲染编辑用） */
  'figure:readHtml': (project: string, relPath: string) => string
  /** 离屏渲染 figures/*.html → assets/<同名>.png，返回 PNG 相对路径 */
  'figure:render': (project: string, htmlRelPath: string) => string
  // ---- 导出（M7）----
  /** 导出内联样式 article.html 到工程目录（图片保持相对路径），返回绝对路径 */
  'export:html': (project: string) => string
  /** 富文本复制到剪贴板（text/html 图片 dataURL 内嵌 + 纯文本 md 兑底） */
  'export:copyRich': (project: string) => void
  /** 用系统默认应用（浏览器）打开导出的文件 */
  'export:openFile': (absPath: string) => void
  // ---- 贴图卡片 ----
  /** 读取工程 cards.json；不存在返回 null */
  'cards:read': (project: string) => CardDeck | null
  'cards:write': (project: string, deck: CardDeck) => void
  /** 离屏渲染第 index 张卡片为 PNG，返回 cards/ 相对路径 */
  'cards:render': (project: string, index: number) => string
  /** 读某格式的存档版（cards-格式.json）；没存过返回 null */
  'cards:archiveRead': (project: string, format: CardFormat) => CardDeck | null
  /** 把一份 deck 存档（转风格/互切前保留原版） */
  'cards:archiveWrite': (project: string, deck: CardDeck) => void
}

export type IpcChannel = keyof IpcApi

// ---------- 主进程 → 渲染进程事件 ----------

export interface IpcEvents {
  /** 外部（Agent/其他工具）修改了工程文件；file 为相对工程目录的正斜杠路径 */
  'file:external-change': { project: string; file: string }
  /** workspace 顶层有工程新增/删除 */
  'workspace:changed': null
  /** 流式对话增量片段 */
  'llm:stream': { requestId: string; delta: string }
  /** 流式对话结束；error 非空表示异常终止 */
  'llm:done': { requestId: string; error?: string }
  /** figures/*.html 被外部修改后自动重渲染完成；png 为新图相对路径 */
  'figure:rendered': { project: string; html: string; png: string }
}

export type IpcEventChannel = keyof IpcEvents
