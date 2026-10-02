/**
 * 供应商精选目录：内置供应商种子（基元律动）+ 置顶标识 + 官网跳转链接
 * 内置种子只做一次性展示预置；默认文本/生图模型与任何调用逻辑不受影响
 */

export interface ProviderSiteLink {
  label: string
  url: string
}

/** 内置供应商种子：基元律动（TokenRhythm）。
 * 生图默认 wan2.7-image（已实测可用，填 Key 即能生图）；文本模型留空，注册后自选 */
export const RHYTHM_PROVIDER_SEED = {
  name: '基元律动',
  baseUrl: 'https://tokenrhythm.studio/v1',
  textModel: '',
  imageModel: 'wan2.7-image',
  imageApi: 'openai-images' as const
}

/** 内置供应商种子：商汤日日新（SenseNova）。OpenAI 兼容与 Anthropic 兼容双协议同域同 Key，
 * 默认走 Anthropic 兼容（思考参数标准化）；生图端点固定 OpenAI images 风格。
 * 文本默认 deepseek-v4-flash（1M 上下文、思考模型）；Key 由 settingsStore 启动时从 ZCode 配置读取 */
export const SENSENOVA_PROVIDER_SEED = {
  name: '商汤日日新',
  baseUrl: 'https://token.sensenova.cn/v1',
  api: 'anthropic-messages' as const,
  textModel: 'deepseek-v4-flash',
  imageModel: 'sensenova-u1.5-lite',
  imageApi: 'openai-images' as const
}

/** 内置供应商种子：阿里云百炼（DashScope OpenAI 兼容模式）。无 OpenAI 风格生图端点，生图留空 */
export const DASHSCOPE_PROVIDER_SEED = {
  name: '阿里云百炼',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  api: 'openai-chat-completions' as const,
  textModel: 'qwen3.8-flash',
  imageModel: '',
  imageApi: 'openai-images' as const
}

/** 置顶供应商：基元律动（TokenRhythm）——默认置顶展示，不参与任何默认模型逻辑 */
export function isRhythmProvider(p: { name: string; baseUrl: string }): boolean {
  return p.baseUrl.includes('tokenrhythm.studio') || p.name.includes('基元律动')
}

export function isSenseNovaProvider(p: { name: string; baseUrl: string }): boolean {
  return p.baseUrl.includes('sensenova.cn') || p.name.includes('商汤')
}

export function isDashScopeProvider(p: { name: string; baseUrl: string }): boolean {
  return p.baseUrl.includes('dashscope.aliyuncs.com') || p.name.includes('百炼')
}

/** 已知供应商的生图模型目录（均已实测可用）：这些模型不在其 /v1/models 返回里，
 * 拉取模型列表时并入，保证「从列表选图像模型」能选到 */
export function knownImageModels(p: { name: string; baseUrl: string }): string[] {
  if (isRhythmProvider(p)) return ['wan2.7-image', 'qwen-image-2.0']
  if (isSenseNovaProvider(p)) return ['sensenova-u1.5-lite', 'sensenova-u1-fast']
  return []
}

export function isAgnesProvider(p: { name: string; baseUrl: string }): boolean {
  return /agnes-ai\.(com|cn)/i.test(p.baseUrl) || p.name.toLowerCase().includes('agnes')
}

/** 已知供应商的官网跳转链接（window.open → 系统浏览器）；未知供应商返回空 */
export function providerSiteLinks(p: { name: string; baseUrl: string } | null): ProviderSiteLink[] {
  if (!p) return []
  if (isRhythmProvider(p)) {
    return [{ label: '官网', url: 'https://tokenrhythm.studio/i/rf_tr_ZkWfacNv3IcOR5JNkY3jXQU0' }]
  }
  if (isSenseNovaProvider(p)) {
    return [
      { label: '开放平台', url: 'https://platform.sensenova.cn' },
      { label: '接口文档', url: 'https://platform.sensenova.cn/docs' }
    ]
  }
  if (isDashScopeProvider(p)) {
    return [
      { label: '控制台', url: 'https://bailian.console.aliyun.com' },
      { label: '接口文档', url: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope' }
    ]
  }
  if (isAgnesProvider(p)) {
    return [
      { label: '国际站', url: 'https://agnes-ai.com' },
      { label: '中国站', url: 'https://agnes-ai.cn' }
    ]
  }
  return []
}
