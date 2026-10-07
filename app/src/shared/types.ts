import type { CardDeck, CardFormat } from './cards'

/** 全局共享类型：领域模型 + IPC 契约（主/渲染进程共用） */

// ---------- 排版调性（分类排版，见 categoryThemes.ts 的预设与解析） ----------

/** H1 大标题装饰；banner 报头横幅 = 通栏色块 + 按底色自动对比字色（配 h1Bg，日报范式） */
export type H1Style = 'bar' | 'pill' | 'underline' | 'banner'
/** H2 小节标题装饰 */
export type H2Style = 'leftbar' | 'block' | 'underline' | 'plain'
/** H2 序号格式（按文档 h2 顺序自动编号） */
export type H2Num = '01' | '1.' | '1、' | '一、' | '壹、' | '①'
/** H3 子标题前缀标记 */
export type H3Mark = 'diamond' | 'dot' | 'none'
/** 引用形态 */
export type QuoteStyle = 'leftbar' | 'card' | 'quotes' | 'dashcard'
/** 分隔线形态 */
export type HrStyle = 'line' | 'dot' | 'long'
/** 加粗强调方式 */
export type StrongStyle = 'color' | 'highlight' | 'plain'
/** 图片形态：inset 常规（限高自适应）/ fullwidth 通栏撑满 / half 半宽居中 */
export type ImgStyle = 'inset' | 'fullwidth' | 'half'
/** 图片边框形态：none 无 / line 细边框 / shadow 柔和投影 */
export type ImgFrame = 'none' | 'line' | 'shadow'

export interface ArticleTheme {
  /**
   * 主题来源（仅主题库徽标用，排版解析不读它）：
   * import = 从文章 HTML 反向解析导入；panel = 排版面板/AI 沉淀；preset = 随包预装（可删，删后不复活）。
   * 缺省按内置或导入显示。
   */
  origin?: 'import' | 'panel' | 'preset'
  /** 强调色：H1 短横 / H2 竖条 / H3 菱形 / 引用边线 / 加粗词 */
  accent: string
  /** 正文字体族 */
  fontFamily: string
  /** 正文行高 */
  lineHeight: number
  /** 字距 */
  letterSpacing: string
  /** H1 对齐：center 仪式感居中 / left 干练左对齐 */
  headingAlign: 'center' | 'left'
  // ---- 结构级排版风格（爆款范式），缺省回退经典排版 ----
  /** 正文容器背景色（如深色卡片 / 暖白卡片）；不设则透明白底 */
  bodyBg?: string
  /** 页面纸底（纸感外壳，正文卡之下的纸色；日报「深纸底+浅卡」双层用）；不设=无纸层 */
  pageBg?: string
  /** 正文文字色（深底卡片需浅色文字） */
  bodyText?: string
  // 昼夜变体字段（bodyBgLight/bodyBgDark 等）已删除：只有一套日间排版，
  // 夜间由 resolveEditorTheme 按公众号逻辑自动变深（公众号夜间无法显示手调深色排版）
  /** 正文基准字号（px，缺省 16；AI 排版正文默认偏小，留白与节奏靠行高/字距撑） */
  fontSize?: number
  /** 标题基准字号（px，缺省 20；H1=+6 H2=+0 H3=-3，与经典导出 26/20/17 一致） */
  headingFontSize?: number
  /** 正文排列：indent 首行缩进 2em / flush 顶格两端对齐 / center 居中；缺省左对齐不缩进 */
  bodyAlign?: 'indent' | 'flush' | 'center'
  /** 标题文字色（卡片底色不同需显式指定，缺省按 bodyBg 深/浅自适应） */
  headingColor?: string
  /** 正文容器圆角 */
  bodyRadius?: number
  /** 正文容器内边距 */
  bodyPadding?: string
  /** H1 装饰：bar 经典短横 / pill 胶囊色块字底 / underline 下划线 / banner 报头横幅 */
  h1Style?: H1Style
  /** 报头横幅底色（配 h1Style: 'banner'；缺省=accent）；横幅字色按底色自动对比 */
  h1Bg?: string
  /** H2 装饰：leftbar 左竖条 / block 色块标签 / underline 下划线 / plain 纯文字 */
  h2Style?: H2Style
  /** H2 序号样式（导入排版复刻「01 标题」「一、标题」「① 标题」等范式；渲染按文档 h2 顺序自动编号） */
  h2Num?: H2Num
  /** H2 色块标签的背景色（配 h2Style: 'block'；缺省=accent） */
  h2Bg?: string
  /** H3 前缀：diamond 菱形 / dot 圆点 / none 无 */
  h3Mark?: H3Mark
  /** 引用形态：leftbar 左条浅底 / card 圆角卡片 / quotes 引号 / dashcard 虚线边框卡 */
  quoteStyle?: QuoteStyle
  /** dashcard 引用的边框色（虚线提示卡的彩色描边） */
  quoteBorder?: string
  /** 引用区底色（不设=按 accent 派生浅底；模型常写作 quote_bg / quote_background） */
  quoteBg?: string
  /** 引用文字色（不设=按昼夜与背景亮度自适应；常写作 quote_text_color） */
  quoteText?: string
  /** 分隔线颜色（不设=中性灰；常写作 divider_color / hr_color） */
  hrColor?: string
  /** H2 左条/下划线颜色（不设=跟随 accent；常写作 h2_border_color） */
  h2Border?: string
  /** 分隔线：line 居中短横 / dot 圆点列 / long 通栏细线 */
  hrStyle?: HrStyle
  /** 加粗强调：color 着色 / highlight 底色高亮 / plain 纯黑加粗 */
  strongStyle?: StrongStyle
  /** highlight 加粗的底色（配 strongStyle: 'highlight'） */
  strongBg?: string
  /** 加粗强调色（缺省=accent；文章常用专属强调色强调关键词） */
  strongColor?: string
  /** 表格风格：bordered 全边框 / striped 斑马纹 / plain 极简（无边框） */
  tableStyle?: 'bordered' | 'striped' | 'plain'
  /** 表头背景色 */
  tableHeaderBg?: string
  /** 表格边框色 */
  tableBorder?: string
  /** 表头文字色（缺省按表头背景亮度自适应） */
  tableHeaderText?: string
  /** 图片圆角 px */
  imgRadius?: number
  /** 图片形态：inset 常规（限高自适应）/ fullwidth 通栏撑满 / half 半宽居中 */
  imgStyle?: ImgStyle
  /** 图片边框形态：none 无 / line 细边框 / shadow 柔和投影 */
  imgFrame?: ImgFrame
  /** 图片区块外间距 px（图与上下文的呼吸距离） */
  imgGap?: number
  /** 图注排列：center 居中（默认）/ left 左对齐 */
  captionAlign?: 'center' | 'left'
  /** 段落间距 px */
  pGap?: number
}

/** 自定义主题库条目：主题独立命名并归属一个分类（v2 存储格式） */
export interface StoredThemeEntry {
  /** 归属分类（保存时自动创建同名目录；一个分类可挂多个主题） */
  category: string
  theme: ArticleTheme
}

/** 影子工程副本：同名工程目录中的一份（外部整目录复制产生，树里只显示按名索引到的那份） */
export interface ProjectCopyInfo {
  /** 副本目录绝对路径 */
  dir: string
  /** 归属分类（meta.category 缺失时按父目录名；根目录平铺 = UNCATEGORIZED） */
  category: string
  /** meta.updated_at（meta 损坏时缺失） */
  updatedAt?: string
}

/** 同名工程冲突（影子工程检测）：一名的多份副本 + 树里当前显示的那份 */
export interface DuplicateProjectInfo {
  name: string
  /** 按名索引解析到的目录（树里可见、可正常打开的那份） */
  activeDir: string
  copies: ProjectCopyInfo[]
}

/**
 * 自定义排版主题库（settings/customThemes.json，v2）：
 * 主题与分类解耦——一个分类可有多套主题，「当前套用哪套」由 active 指针决定，
 * 指针可指向自定义主题名，也可指向内置主题名（CATEGORY_THEMES 的键）；
 * 指针缺省/失效 = 回同名内置主题或默认调性。
 * v1（Record<分类名, 主题>，主题名即分类名）由 migrateCustomThemes 读时迁移。
 */
export interface CustomThemeLibrary {
  version: 2
  /** 主题名 → 条目（主题名全局唯一，保存同名即覆盖更新） */
  themes: Record<string, StoredThemeEntry>
  /** 分类 → 当前套用的主题名 */
  active: Record<string, string>
}

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
  /** 由封面模板渲染时记录模板 id（见 shared/coverTemplates.ts）；拖动裁剪产出时无此项 */
  template?: string
}

export interface ProjectMeta {
  name: string
  status: ProjectStatus
  topic?: TopicInfo
  titles: TitleCandidate[]
  cover?: CoverInfo
  /** 工程形态：article 文章（默认）/ cards 贴图（中央区显示贴图面板，风格存 cards.json） */
  format?: 'article' | 'cards'
  /** 所属分类（workspace 按分类分子文件夹存放；缺省 = 未分类） */
  category?: string
  /** 文章强调色（十六进制）：编辑器排版装饰与导出 HTML 同步跟随；缺省 = 默认蓝 */
  accent?: string
  /** 正文字号覆盖（px）：覆盖主题 fontSize；缺省跟随主题 */
  bodyFontSize?: number
  /** 标题字号覆盖（px）：覆盖主题 headingFontSize；缺省跟随主题 */
  headingFontSize?: number
  /** 正文排列覆盖：indent 缩进 / flush 顶格 / center 居中；缺省跟随主题 */
  bodyAlign?: 'indent' | 'flush' | 'center'
  /** 标题排列覆盖：center 居中 / left 左对齐；缺省跟随主题 */
  headingAlign?: 'center' | 'left'
  /** H1 装饰覆盖：bar 短横 / pill 胶囊 / underline 下划线 / banner 报头横幅；缺省跟随主题 */
  h1Style?: H1Style
  /** 报头横幅底色覆盖（十六进制）；缺省跟随主题 */
  h1Bg?: string
  /** H2 装饰覆盖：leftbar 左竖条 / block 色块标签 / underline 下划线 / plain 纯文字；缺省跟随主题 */
  h2Style?: H2Style
  /** H2 序号覆盖：H2Num 各格式；'none' 显式关掉主题自带序号；缺省跟随主题 */
  h2Num?: H2Num | 'none'
  /** H3 前缀覆盖：diamond 菱形 / dot 圆点 / none 无；缺省跟随主题 */
  h3Mark?: H3Mark
  /** 文章背景卡覆盖（十六进制）：覆盖主题 bodyBg；'none' 显式去卡片（透明白底）；缺省跟随主题 */
  bodyBg?: string
  /** 页面纸底覆盖（十六进制）：覆盖主题 pageBg；缺省跟随主题 */
  pageBg?: string
  // ---- 排版视觉覆盖扩展（B 期，20 字段）：缺省全部跟随主题；写值即覆盖，null/删除恢复（AI set_theme / 排版优化对话框 / 排版面板同源） ----
  /** 正文字体族覆盖 */
  fontFamily?: string
  /** 正文行高覆盖（1.5–3，越界夹取） */
  lineHeight?: number
  /** 字距覆盖（如 '0.02em'） */
  letterSpacing?: string
  /** 段落间距覆盖 px（0–48，越界夹取） */
  pGap?: number
  /** 正文文字色覆盖（十六进制） */
  bodyText?: string
  /** 标题文字色覆盖（十六进制）；显式设置后不再跟随 accent 重链 */
  headingColor?: string
  /** 引用形态覆盖：leftbar 左条浅底 / card 圆角卡片 / quotes 引号 / dashcard 虚线边框卡 */
  quoteStyle?: QuoteStyle
  /** 虚线引用卡边框色覆盖（十六进制） */
  quoteBorder?: string
  /** 引用区底色覆盖（十六进制）；不设=按 accent 派生浅底 */
  quoteBg?: string
  /** 引用文字色覆盖（十六进制）；不设=按昼夜自适应 */
  quoteText?: string
  /** 分隔线颜色覆盖（十六进制）；不设=中性灰 */
  hrColor?: string
  /** H2 左条/下划线色覆盖（十六进制）；不设=跟随 accent */
  h2Border?: string
  /** 分隔线形态覆盖：line 居中短横 / dot 圆点列 / long 通栏细线 */
  hrStyle?: HrStyle
  /** 加粗强调覆盖：color 着色 / highlight 底色高亮 / plain 纯黑加粗 */
  strongStyle?: StrongStyle
  /** 高亮加粗底色覆盖（十六进制） */
  strongBg?: string
  /** 加粗强调色覆盖（十六进制）；显式设置后不再跟随 accent 重链 */
  strongColor?: string
  /** 图片圆角覆盖 px（0–40，越界夹取） */
  imgRadius?: number
  /** 图片形态覆盖：inset 常规 / fullwidth 通栏撑满 / half 半宽居中 */
  imgStyle?: ImgStyle
  /** 图片边框覆盖：none 无 / line 细边框 / shadow 柔和投影 */
  imgFrame?: ImgFrame
  /** 图片区块外间距覆盖 px（0–48，越界夹取） */
  imgGap?: number
  /** 图注排列覆盖：center 居中 / left 左对齐 */
  captionAlign?: 'center' | 'left'
  /** 正文容器圆角覆盖 px（0–40，越界夹取） */
  bodyRadius?: number
  /** 正文容器内边距覆盖（如 '20px 22px'） */
  bodyPadding?: string
  /** 表格风格覆盖：bordered 全边框 / striped 斑马纹 / plain 极简 */
  tableStyle?: 'bordered' | 'striped' | 'plain'
  /** 表头背景色覆盖（十六进制） */
  tableHeaderBg?: string
  /** 表格边框色覆盖（十六进制） */
  tableBorder?: string
  /** 表头文字色覆盖（十六进制） */
  tableHeaderText?: string
  /** H2 色块标签背景色覆盖（十六进制，配 h2Style: 'block'） */
  h2Bg?: string
  /** 发布排期（本地日期 YYYY-MM-DD）：内容日历看板按此聚合；缺省 = 未排期 */
  plannedAt?: string
  /** 最近一次导出/复制/推送成功时刻（ISO）：创作向导「导出」步的完成事实源；缺省 = 从未导出 */
  lastExportAt?: string
  style_skill?: string
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  name: string
  dir: string
  status: ProjectStatus
  /** 所属分类（缺省 = 未分类） */
  category?: string
  updated_at: string
  /** 发布排期（YYYY-MM-DD；缺省 = 未排期，日历看板用） */
  plannedAt?: string
  /** 工程形态（封面墙按它决定取文章封面还是首张贴图卡） */
  format?: 'article' | 'cards'
  /** 封面/首张贴图的工程内相对路径（正斜杠）；无封面 = null，卡片走主题色占位 */
  cover?: string | null
  /** 正文字数（口径同 shared/wordCount，列表与编辑器同一个函数） */
  wordCount?: number
  /** 已有非空审阅报告（封面墙角标与向导完成判定共用） */
  hasReview?: boolean
  /** 最近一次导出时间（ISO；缺省 = 未导出） */
  exportedAt?: string
  /** 标题候选数（贴图工程「只要标题不要封面」的进度线索） */
  titlesCount?: number
}

/** 工程内直接可编辑的文本文件（约定文件名即 ID）；cards-review.md 按需创建不预建 */
export type ProjectTextFile = 'article.md' | 'ideas.md' | 'review.md' | 'cards-review.md'

/**
 * 工程内可入左栏工作树的资产清单（左栏工作树用，见 shared/workTree.ts）。
 * 相对路径一律正斜杠；只收白名单子目录（assets/figures/covers/cards/交付），
 * chat/、project.json、article.md 等内部文件永不入树。目录缺失 = 空数组。
 */
export interface ProjectAssets {
  /** figures/*.html 图表源（可改源码重渲染） */
  figures: string[]
  /** assets/ 下图片（扩展名白名单） */
  assets: string[]
  /** covers/*.html 封面模板渲染源 */
  covers: string[]
  /** cards/<format>/card-N.png 贴图卡片产物 */
  cards: string[]
  /** 交付/ 交稿产物（docx/pdf 等） */
  deliveries: string[]
}

/** 打开工程时一次性返回的数据 */
export interface ProjectData {
  meta: ProjectMeta
  article: string
}

/** 拖拽/关联打开的 .md → 工程定位结果 */
export interface OpenMdResult {
  /** open = 命中工程目录内已有工程；import = 已导入为新工程 */
  kind: 'open' | 'import'
  name: string
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
  /** 图像调用格式：标准 OpenAI images / Agnes images 变体 / APIMart 异步任务制（gpt-image-2、nano-banana） */
  imageApi: 'openai-images' | 'agnes-images' | 'apimart-images'
  /** 文本对话协议：OpenAI 兼容 chat/completions（缺省）或 Anthropic 兼容 messages。
   * 商汤等双协议供应商两个端点共用同一 baseUrl 与 Key；生图始终走 OpenAI images */
  api?: 'openai-chat-completions' | 'anthropic-messages'
  /** 已拉取的模型列表分类缓存（启动自动刷新与手动刷新共用，随 llm.json 落盘） */
  models?: ProviderModelCache
}

/** 每供应商模型列表缓存：文本/生图模型分列 */
export interface ProviderModelCache {
  text: ModelInfo[]
  image: ModelInfo[]
  /** 最近一次成功拉取时间（ISO 字符串），用于展示「上次拉取 xx 前」 */
  updatedAt?: string
}

/** 按协议分类后的模型列表（llm:fetchModels 返回；失败时 text/image 为回退的旧缓存） */
export interface ProviderModelsResult {
  ok: boolean
  text: ModelInfo[]
  image: ModelInfo[]
  /** 本次是否新拉取成功（false = 返回的是缓存或失败） */
  refreshed: boolean
  /** 缓存时间（ISO），来自落盘的 provider.models.updatedAt */
  updatedAt?: string
  error?: string
}

/** AI 生图可选参数。size/ratio 的语义随图像协议不同（UI 选项由 shared/imageFormats.ts 统一定义）：
 * - openai-images：只用 size 的精确像素尺寸（1024x1024 等），忽略 ratio
 * - agnes-images：size=尺寸档位 1K/2K/3K/4K，ratio=宽高比
 * - apimart-images：ratio=官方比例（1:1/16:9/21:9 等，作 size 下发），size=清晰度档位映射 resolution
 *   （APIMart 仅 1k/2k/4k，无 3K；nano-banana/imagen 无 resolution 字段） */
export interface ImageGenOptions {
  /** openai：1024x1024 等；agnes：1K/2K/3K/4K；apimart：清晰度档位（映射 1k/2k/4k） */
  size?: string
  /** agnes / apimart 专用宽高比；apimart 作 size 比例字段下发 */
  ratio?: string
}

export interface LlmSettings {
  providers: ProviderConfig[]
  /** 文本/图像默认供应商分开指定 */
  textProviderId: string | null
  imageProviderId: string | null
  /** 供应商展示顺序（仅设置界面排序用，不影响默认模型与任何调用） */
  providerOrder?: string[]
  /** 手动置顶的供应商 id（展示用；基元律动默认置顶，无需入列） */
  pinnedIds?: string[]
  /** 被手动取消置顶的默认置顶供应商 id（基元律动默认置顶，取消后记在这里） */
  unpinnedIds?: string[]
  /** 联网搜索配置：默认免密内置，可选搜索 API 提升时效与质量 */
  search: SearchSettings
}

export interface SearchSettings {
  /** none=免密内置（DDG/Bing 抓取）；tavily/bocha 需 API Key */
  provider: 'none' | 'tavily' | 'bocha'
  /** 主进程落盘时 safeStorage 加密 */
  apiKey: string
}

/** OpenAI 多模态内容片段（vision 图片 + 纯文本） */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** 模型发起的工具调用（流式碎片累积后的完整形状，function calling） */
export interface ToolCallInfo {
  id: string
  name: string
  /** JSON 字符串形式的调用参数 */
  arguments: string
}

/** 对话工具的 OpenAI function 格式 schema（capabilityCore 的 inputSchema 映射而来） */
export interface ChatToolSchema {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

/** 一次流式对话的请求选项：tools 非空走 function calling；thinking 控制思考开关（缺省按模型目录默认） */
export interface ChatStartOptions {
  tools?: ChatToolSchema[]
  thinking?: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** 纯文本 或 多模态片段数组（含图片时走 OpenAI vision 格式） */
  content: string | ContentPart[]
  /** assistant 消息的思考过程（reasoning/reasoning_content/thinking_delta 归一），随会话落盘 */
  reasoning?: string
  /** assistant 消息携带的工具调用；对应结果以 role:'tool' 消息回填（chat-tools v1） */
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  /** role='tool' 消息对应的 tool_calls 项 id */
  tool_call_id?: string
}

export interface LlmTestResult {
  ok: boolean
  message: string
}

/** GET /v1/models 返回的单个模型条目 */
export interface ModelInfo {
  id: string
  /** 部分供应商返回所属组织 */
  owned_by?: string
}

/** 拉取模型列表结果 */
export interface FetchModelsResult {
  ok: boolean
  models: ModelInfo[]
  error?: string
}

// ---------- 副驾驶（M5） ----------

/** 会话摘要（chat/*.json 文件名即 id） */
export interface ChatSessionMeta {
  id: string
  title: string
  created_at: string
  updated_at: string
}

/** 工具调用留痕（chat-tools v1 反馈迭代）：随会话落盘，记录这一轮模型到底调了哪些工具、
 *  参数摘要与成败结果——此前会话 json 只存可见文本，排查「没调工具」还是「调了失败」只能靠工程文件 mtime 反推 */
export interface ToolTraceEntry {
  name: string
  argsSummary: string
  status: 'done' | 'error'
  result?: string
}

export interface ChatSession extends ChatSessionMeta {
  messages: ChatMessage[]
  /** assistant 气泡在 messages 中的下标 → 该轮工具调用留痕 */
  toolTrace?: Record<string, ToolTraceEntry[]>
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

/** 对话安装 Skill：合集仓库里的单个 SKILL.md 候选（仓库引用探测出多个时由用户挑选） */
export interface SkillInstallCandidate {
  /** 候选展示名：SKILL.md 上级目录名（仓库根 SKILL.md 用仓库名） */
  name: string
  /** 仓库内相对路径（正斜杠，如 skills/xxx/SKILL.md） */
  path: string
  /** 点选后重新 resolve 用的引用：该候选的 GitHub blob 链接（走既有单文件解析链路） */
  ref: string
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
  /** 非空=仓库引用探测出多个 SKILL.md（合集仓库），此时 content 为空串，
   *  渲染层转候选选择态，点选候选拿其 ref 重新 resolve */
  candidates?: SkillInstallCandidate[]
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

/**
 * 选题流转状态。**不落库文件**——它本来就是「有没有被用起来」的副产品：
 * 给 idea-inbox.md 加一个手工状态字段，等于多维护一份会与工程现实脱节的标记。
 */
export type IdeaStage = 'idle' | 'projected' | 'scheduled' | 'ready'

/** 选题的状态推导结果（含命中的工程，便于在看板上直接打开） */
export interface IdeaStageInfo {
  stage: IdeaStage
  project?: string
  category?: string
  plannedAt?: string
}

/** 推导状态的输入：工程的匹配特征（主进程从各工程 meta 组出） */
export interface IdeaProjectRef {
  name: string
  status: ProjectStatus
  category?: string
  plannedAt?: string
  /** project.json 的 topic：日历立项由机器写入，是权威关联 */
  topicAngle?: string
  topicAudience?: string
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

// ---------- 多平台分发（M11，见 shared/platformHtml.ts 的平台画像） ----------

/** 分发目标平台：各平台编辑器粘贴净化规则不同，导出/复制按平台画像输出对应形态 */
export type PlatformId = 'wechat' | 'toutiao' | 'zhihu' | 'baijiahao'

/** 分类级账号预设：「账号 = 分类」，新建工程自动继承的账号级默认 */
export interface CategoryPreset {
  /** 新工程自动挂载的写作 Skill 名；缺省 = 不挂载 */
  style_skill?: string
  /** 该账号的默认分发平台：导出框打开时预选；缺省 = 公众号 */
  default_platform?: PlatformId
}

/** 预设增量写入载荷：字段显式传 null = 清除该项，缺省 = 保持原值 */
export type CategoryPresetPatch = { [K in keyof CategoryPreset]?: CategoryPreset[K] | null }

// ---------- 版本更新检测 ----------

/** 更新信息来自哪个源：site = 官网 lig-editor-update.json，github = GitHub Releases */
export type UpdateSource = 'site' | 'github'

/** 一处更新源解析出的新版本信息 */
export interface UpdateInfo {
  /** 远端最新版本号（x.y.z，不带 v 前缀） */
  version: string
  /** 更新说明：官网源为 JSON notes 数组，GitHub 源取 release 正文 */
  notes?: string
  /** 发布日期（YYYY-MM-DD，取不到为空） */
  releaseDate?: string
  downloads: {
    quark?: string
    baidu?: string
    github?: string
    site?: string
  }
  source: UpdateSource
}

/** update:check 的返回：status=available 时 latest 为已就绪源中版本更高者 */
export interface UpdateCheckResult {
  status: 'available' | 'up-to-date' | 'error'
  currentVersion: string
  latest?: UpdateInfo
  /** 用户点过「忽略此版本」的版本号；手动检查时弹窗仍应展示 */
  skippedVersion?: string
  /** status=error 时的提示语 */
  message?: string
}

// ---------- IPC 契约 ----------
// 所有 invoke 通道集中定义；主进程 handle 与渲染进程调用共享此单一来源

/** 彻底删除分类前的受影响清单：分类目录下会被一并删掉的工程与挂在该分类名下的自定义主题 */
export interface CategoryPurgeInfo {
  projects: string[]
  themes: string[]
}

export interface IpcApi {
  'app:getPaths': () => AppPaths
  'app:ping': () => string
  /** 破坏性操作的确认：主进程弹**父窗口模态**的原生问答框。
   *  替代渲染层 window.confirm——后者不带父窗口，Windows 上关掉后焦点不回 BrowserWindow，
   *  表现是之后页面里点了没反应（切到别的窗口再切回来才恢复），删除会话就是这么撞出来的 */
  'dialog:confirm': (message: string, title?: string, okLabel?: string) => Promise<boolean>
  /** 拖拽/关联打开的 .md：workspace 内命中已有工程则打开，外部 md 导入为新工程 */
  'md:openFile': (absPath: string) => OpenMdResult
  /** 渲染层挂载后拉取启动期积压的 .md 路径（此后改走 md:open-request 推送） */
  'md:takePending': () => string[]
  // ---- 窗口控制（无边框自绘标题栏）----
  'win:minimize': () => void
  'win:toggleMaximize': () => void
  'win:close': () => void
  /** 扫描 workspace 全部含 project.json 的工程（含各分类子目录） */
  /** 渲染层未捕获错误上报（dev 终端可见）——应用无 ErrorBoundary，白屏时靠它自证 */
  'app:reportError': (message: string) => void
  'project:list': () => ProjectSummary[]
  /** 影子工程检测：同名工程目录存在于多个分类（树里只显示一份，多出的不可见） */
  'project:listDuplicates': () => DuplicateProjectInfo[]
  'project:create': (name: string, category?: string) => ProjectSummary
  /** 删除整个工程目录（渲染层需先确认；删当前工程前先 project:close） */
  'project:delete': (name: string) => void
  /** 重命名工程：目录原地改名（留在原分类下）+ meta.name 同步，返回新 meta */
  'project:rename': (oldName: string, newName: string) => ProjectMeta
  /** 切换分类：工程目录迁移到 workspace/<分类>/ 下并更新 meta，返回新 meta */
  'project:setCategory': (project: string, category: string) => ProjectMeta
  /** 设置发布排期（YYYY-MM-DD 本地日期；null 取消排期），返回新 meta */
  'project:setSchedule': (project: string, date: string | null) => ProjectMeta
  /** 全部可用分类：预设 + 未分类 + workspace 顶层自定义分类文件夹（不含已删除/隐藏的） */
  'project:listCategories': () => string[]  /** 已删除（隐藏）的分类：可在管理里恢复 */
  'project:listHiddenCategories': () => string[]
  /** 删除分类（= 隐藏：目录与工程保留，恢复后归位）；未分类不可删 */
  'project:deleteCategory': (name: string) => void
  /** 彻底删除已隐藏的分类：目录+工程+该分类的主题/预设/绑定一并删除，不可恢复（调用方须先确认） */
  'project:purgeCategory': (name: string) => void
  /** 彻底删除的分类名留痕：预设分类名写死在代码里，靠这份清单才不会再出现（同名目录重建则重新放行） */
  'project:listPurgedCategories': () => string[]
  /** 彻底删除前的受影响清单：该分类目录下会被一并删除的工程与自定义主题，供确认框点名 */
  'project:categoryPurgeInfo': (name: string) => CategoryPurgeInfo
  /** 恢复被隐藏的分类 */
  'project:restoreCategory': (name: string) => void
  /** 重命名分类：目录 + 工程 meta + 自定义主题同步；预设重命名后成为自定义分类 */
  'project:renameCategory': (oldName: string, newName: string) => void
  /** 打开工程：返回 meta+正文，并让主进程开始监听该工程目录 */
  'project:open': (name: string) => ProjectData
  'project:close': () => void
  'project:readFile': (project: string, file: ProjectTextFile) => string
  'project:writeFile': (project: string, file: ProjectTextFile, content: string) => void
  'project:readMeta': (project: string) => ProjectMeta
  'project:writeMeta': (project: string, meta: ProjectMeta) => void
  /** 工程内可入树的资产清单（白名单目录，相对路径正斜杠；见 ProjectAssets） */
  'project:listAssets': (project: string) => ProjectAssets
  /** 左栏工作树按需监听：以展开的工程全量集合做差量挂/卸，变化推 workspace:assets-changed */
  'project:setWatchedProjects': (names: string[]) => void
  // ---- 模型接入（M4）----
  'settings:getLlm': () => LlmSettings
  'settings:setLlm': (settings: LlmSettings) => void
  /** 用给定配置试连（不要求先保存） */
  'llm:test': (provider: ProviderConfig) => LlmTestResult
  /** 发起流式对话；增量通过 llm:stream 事件推送。options.tools 非空时走 function calling；thinking 控制思考开关 */
  'llm:chatStart': (requestId: string, messages: ChatMessage[], options?: ChatStartOptions) => void
  'llm:abort': (requestId: string) => void
  /** 拉取供应商模型列表（GET /v1/models）→ 按文本/生图分类 → 落盘缓存；失败时返回旧缓存 */
  'llm:fetchModels': (provider: ProviderConfig) => ProviderModelsResult
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
  // ---- 对话副驾驶工具调用（chat-tools v1）----
  /** 可执行工具清单（排除提示词返回类），OpenAI function 格式参数由渲染层映射 */
  'agent:listTools': () => { name: string; description: string; parameters: unknown }[]
  /** 执行对话工具：错误不抛，转 { ok:false, error } 由渲染层作为 tool 结果回传给模型 */
  'agent:callTool': (name: string, args: Record<string, unknown>) => { ok: boolean; result?: unknown; error?: string }
  /** 保存二进制资产（base64）到工程相对路径，返回相对路径 */
  'project:saveAsset': (project: string, relPath: string, base64: string) => string
  /**
   * 用模板渲染双比例封面（1175×500 与 800×800）并写入 project.json.cover，
   * 与拖动裁剪流程共用同一出口；模板见 shared/coverTemplates.ts。
   * bg 为工程相对路径（如 assets/cover-bg.png），缺省 = 纯版式
   */
  'cover:renderTemplate': (args: {
    project: string
    template: string
    title: string
    subtitle?: string
    accent: string
    bg?: string
    brand?: string
  }) => { main: string; square: string }
  /** 无工程上下文时脑暴选题入库到全局 idea-inbox.md */
  'inbox:append': (text: string) => void
  // ---- 全局选题库（idea-inbox.md 结构化读写）----
  'ideas:list': () => IdeaEntry[]
  /** 每条选题的流转状态（index → 推导结果）：泳道看板一次取全，推导逻辑在 shared/ideaStage.ts */
  'ideas:stages': () => Record<number, IdeaStageInfo>
  'ideas:add': (idea: IdeaCard) => void
  'ideas:remove': (index: number) => void
  /** 选题拖拽立项：按 index 找选题 → 建工程（标题清洗后为名，带 topic 画像）→ 写排期。
   *  不消费选题（保留库中，可多账号复用）；返回新建工程摘要 */
  'ideas:schedule': (index: number, date: string, category?: string) => ProjectSummary
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
  /** 导出 article.html 到工程目录（图片保持相对路径），返回绝对路径；variant 配色模式。
   *  platform（M11 多平台分发）非 wechat 时改为落 article-<platform>.html 平台适配稿 */
  'export:html': (args: { project: string; variant?: 'auto' | 'day' | 'night'; platform?: PlatformId }) => string
  /** 富文本复制到剪贴板（text/html 图片 dataURL 内嵌 + 纯文本 md 兜底）；variant 配色二选一。
   *  platform 指定分发目标（缺省 wechat；知乎/头条/百家按平台画像输出净化友好形态） */
  'export:copyRich': (args: { project: string; variant?: 'day' | 'night'; platform?: PlatformId }) => void
  /** 用系统默认应用（浏览器）打开导出的文件 */
  'export:openFile': (absPath: string) => void
  /** 导出可继续编辑的 Word 到工程「交付/」目录，返回绝对路径 */
  'export:docx': (project: string) => string
  /** 导出打印用 PDF（公众号日间排版，A4）到工程「交付/」目录，返回绝对路径 */
  'export:pdf': (project: string) => string
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
  // ---- 自定义排版主题库（导入 HTML/公众号链接复用排版）----
  'customTheme:list': () => CustomThemeLibrary
  /** 保存主题：upsert（同名覆盖）并激活到 category（缺省 = 主题原归属，再缺省 = 与主题同名，自动建分类目录） */
  'customTheme:save': (name: string, theme: ArticleTheme, category?: string) => void
  /** 切换分类当前套用的主题：name 可指向自定义主题名或内置主题名；null = 解绑（回同名内置/默认调性） */
  'customTheme:setActive': (category: string, name: string | null) => void
  /** 删除主题（引用它的分类自动解绑） */
  'customTheme:delete': (name: string) => void
  /** 抓取链接 HTML（导入公众号文章排版） */
  'customTheme:fetchUrl': (url: string) => string
  // ---- 分类级账号预设（账号 = 分类：新工程自动继承）----
  'categoryPreset:list': () => Record<string, CategoryPreset>
  /** 增量设置分类预设：字段传 null = 清除该项，未提及 = 保持原值；整条空了删除该分类预设 */
  'categoryPreset:set': (category: string, patch: CategoryPresetPatch) => CategoryPreset
  // ---- 版本更新检测（双源：官网 update.json 优先，GitHub Releases 兜底）----
  /** 检查新版本：8s 超时，任一源可用即有结果；全部失败返回 status=error */
  'update:check': () => UpdateCheckResult
  /** 忽略指定版本：之后启动静默检查不再弹该版本（手动检查不受影响） */
  'update:dismiss': (version: string) => void
}

export type IpcChannel = keyof IpcApi

// ---------- 主进程 → 渲染进程事件 ----------

export interface IpcEvents {
  /** 外部（Agent/其他工具）修改了工程文件；file 为相对工程目录的正斜杠路径 */
  'file:external-change': { project: string; file: string }
  /** workspace 顶层有工程新增/删除 */
  'workspace:changed': null
  /** 模型接入设置已保存（渲染层各面板即时重拉供应商/模型能力声明） */
  'settings:llmChanged': null
  /** 用户把 .md 拖到应用图标 / 双击关联文件，应用已在运行：absPath 为文件绝对路径 */
  'md:open-request': { absPath: string }
  /** 流式对话增量片段 */
  'llm:stream': { requestId: string; delta: string; reasoning?: string }
  /** 流式对话结束；error 非空表示异常终止。toolCalls 非空 = 模型发起了工具调用，等待渲染层执行后回填下一轮 */
  'llm:done': { requestId: string; error?: string; toolCalls?: ToolCallInfo[] }
  /** figures/*.html 被外部修改后自动重渲染完成；png 为新图相对路径 */
  'figure:rendered': { project: string; html: string; png: string }
  /** 左栏工作树监听的工程内资产有增删改（Agent 直改/导入等）；渲染层刷新该工程资产节点 */
  'workspace:assets-changed': { project: string }
}

export type IpcEventChannel = keyof IpcEvents
