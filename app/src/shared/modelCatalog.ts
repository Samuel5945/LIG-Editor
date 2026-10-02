/**
 * 模型能力目录：已知供应商模型的静态能力声明（上下文窗口/最大输出/输入模态/思考/生图），
 * 参照 ZCode 对 provider 模型的声明方式。数据来源：ZCode 商汤 provider 配置与其内置模板的
 * qwen 模型规则（contextWindow、inputFormat、reasoningLevel、maxOutputTokens）。
 * 未知模型返回空声明 —— 调用侧按「无能力信息」处理，保持与目录引入前相同的行为。
 */

import type { ContentPart, ModelInfo, ProviderConfig } from './types'

export interface ModelCapability {
  /** 上下文窗口（tokens） */
  contextWindow?: number
  /** 最大输出 tokens */
  maxOutput?: number
  /** 支持的输入模态；含 'image' = 可读图（vision 输入） */
  inputModalities?: ('text' | 'image')[]
  /** 思考（推理）能力 */
  reasoning?: {
    /** 默认开启思考 */
    defaultOn: boolean
    /**
     * OpenAI 兼容路径的思考控制参数：
     * - 'enable_thinking'：true/false 双向可开关（qwen3.5/3.6/3.7 系、qwen-plus/flash、qwen3-vl-plus）
     * - 'reasoning_effort'：开 = 发 effort 档位，关 = 不发参数（qwen3.8 系默认恒思考，无关闭档）
     * - 缺省 = 服务端默认（商汤 deepseek/kimi 系默认开思考，不提供关闭参数）
     * Anthropic 兼容路径统一走 thinking 块，不看此字段
     */
    openaiParam?: 'enable_thinking' | 'reasoning_effort'
  }
  /** 是否支持原生工具调用（function calling / tool use） */
  supportsTools?: boolean
  /** 生图模型（输出图像，不用于文本对话） */
  outputImage?: boolean
}

interface CatalogEntry {
  /** 模型 id 匹配（允许带日期/版本后缀，如 qwen3.7-max-2026-06-08） */
  match: RegExp
  cap: ModelCapability
}

const SENSENOVA_MODELS: CatalogEntry[] = [
  // deepseek 系一律按 v4 家族声明（实测列表含 deepseek-flash / deepseek-v4-flash / deepseek-v4-pro / deepseek-v4.1-flash）
  { match: /^deepseek/, cap: { contextWindow: 1_048_576, maxOutput: 65_536, inputModalities: ['text'], reasoning: { defaultOn: true }, supportsTools: true } },
  { match: /^kimi-k3/, cap: { contextWindow: 1_000_000, maxOutput: 131_072, inputModalities: ['text', 'image'], reasoning: { defaultOn: true }, supportsTools: true } },
  { match: /^glm-5/, cap: { contextWindow: 1_000_000, maxOutput: 65_536, inputModalities: ['text'], reasoning: { defaultOn: false }, supportsTools: true } },
  { match: /^sensenova-6\.8-flash-lite/, cap: { contextWindow: 262_144, maxOutput: 65_536, inputModalities: ['text', 'image'], supportsTools: true } },
  { match: /^sensenova-u1(?:\.5-lite|-fast)$/, cap: { outputImage: true } }
]

const DASHSCOPE_MODELS: CatalogEntry[] = [
  // qwen3.8 系：思考恒开（openai-compat 下用 reasoning_effort 调档，无关闭档）
  { match: /^qwen3\.8-(?:max|flash)/, cap: { contextWindow: 1_000_000, maxOutput: 131_072, inputModalities: ['text', 'image'], reasoning: { defaultOn: true, openaiParam: 'reasoning_effort' }, supportsTools: true } },
  { match: /^qwen3\.7-(?:plus|flash)/, cap: { contextWindow: 1_000_000, maxOutput: 131_072, inputModalities: ['text', 'image'], reasoning: { defaultOn: true, openaiParam: 'enable_thinking' }, supportsTools: true } },
  { match: /^qwen3\.7-max/, cap: { contextWindow: 1_000_000, maxOutput: 131_072, inputModalities: ['text'], reasoning: { defaultOn: true, openaiParam: 'enable_thinking' }, supportsTools: true } },
  { match: /^qwen3\.6-(?:plus|flash)/, cap: { contextWindow: 1_000_000, maxOutput: 65_536, inputModalities: ['text', 'image'], reasoning: { defaultOn: true, openaiParam: 'enable_thinking' }, supportsTools: true } },
  { match: /^qwen3\.5-(?:plus|flash)/, cap: { contextWindow: 1_000_000, maxOutput: 65_536, inputModalities: ['text', 'image'], reasoning: { defaultOn: true, openaiParam: 'enable_thinking' }, supportsTools: true } },
  { match: /^qwen3-vl-plus/, cap: { contextWindow: 262_144, maxOutput: 32_768, inputModalities: ['text', 'image'], reasoning: { defaultOn: true, openaiParam: 'enable_thinking' }, supportsTools: true } },
  { match: /^qwen3-max/, cap: { contextWindow: 262_144, maxOutput: 65_536, inputModalities: ['text'], supportsTools: true } },
  { match: /^qwen-plus/, cap: { contextWindow: 1_000_000, maxOutput: 32_768, inputModalities: ['text'], reasoning: { defaultOn: true, openaiParam: 'enable_thinking' }, supportsTools: true } },
  { match: /^qwen-flash/, cap: { contextWindow: 1_000_000, maxOutput: 32_768, inputModalities: ['text'], reasoning: { defaultOn: true, openaiParam: 'enable_thinking' }, supportsTools: true } }
]

function tableForProvider(baseUrl: string): CatalogEntry[] {
  const url = baseUrl.toLowerCase()
  if (url.includes('sensenova.cn')) return SENSENOVA_MODELS
  if (url.includes('dashscope.aliyuncs.com')) return DASHSCOPE_MODELS
  return []
}

/** 未知供应商时按模型名前缀跨表兜底（qwen/deepseek/kimi 系模型能力大体随模型本体） */
function tableForModelId(modelId: string): CatalogEntry[] | null {
  if (/^qwen/.test(modelId)) return DASHSCOPE_MODELS
  if (/^(?:deepseek|kimi|sensenova)/.test(modelId)) return SENSENOVA_MODELS
  return null
}

export function modelCapability(provider: Pick<ProviderConfig, 'baseUrl'>, modelId: string): ModelCapability {
  const entry = tableForProvider(provider.baseUrl)?.find((e) => e.match.test(modelId))
  if (entry) return entry.cap
  const fallback = tableForModelId(modelId)?.find((e) => e.match.test(modelId))
  return fallback?.cap ?? {}
}

/** 生图模型关键词（目录未收录时的启发式兜底；视频生成模型一并归入生图列，不可作文本对话） */
const IMAGE_MODEL_RE = /image|dall[-_]?e|flux|seedream|seedance|cogview|wan\d|stable-diffusion|sd3|hidream|kolors|irag|photon/i

/** 把拉取到的模型 id 列表按 文本/生图 分列：目录 outputImage 命中或关键词命中 → 生图，其余 → 文本 */
export function classifyModels(provider: Pick<ProviderConfig, 'baseUrl'>, ids: string[]): { text: ModelInfo[]; image: ModelInfo[] } {
  const text: ModelInfo[] = []
  const image: ModelInfo[] = []
  for (const id of ids) {
    const cap = modelCapability(provider, id)
    if (cap.outputImage || (!cap.contextWindow && !cap.inputModalities && IMAGE_MODEL_RE.test(id))) {
      image.push({ id })
    } else {
      text.push({ id })
    }
  }
  const byId = (a: ModelInfo, b: ModelInfo): number => a.id.localeCompare(b.id)
  return { text: text.sort(byId), image: image.sort(byId) }
}

/** 上下文窗口展示徽章：1048576 → 「1M」、262144 → 「256K」；未声明返回空 */
export function contextBadge(cap: ModelCapability): string {
  if (!cap.contextWindow) return ''
  if (cap.contextWindow >= 1_000_000) return `${Math.round(cap.contextWindow / 100_000) / 10}M`
  return `${Math.round(cap.contextWindow / 1024)}K`
}

export function hasImageInput(cap: ModelCapability): boolean {
  return cap.inputModalities?.includes('image') ?? false
}

/** 估算消息内容的 token 数：中文为主按 ~1.6 字符/token 粗估（图片按固定级别计，忽略不计）。
 * 截断/压缩阈值都基于这个粗估，不追求精确 */
export function estimateTokens(content: string | ContentPart[]): number {
  const chars =
    typeof content === 'string'
      ? content.length
      : content.reduce((s, p) => s + (p.type === 'text' ? p.text.length : 0), 0)
  return Math.ceil(chars / 1.6)
}
