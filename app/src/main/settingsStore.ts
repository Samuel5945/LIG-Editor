import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { LlmSettings, ProviderConfig, SearchSettings } from '@shared/types'
import { getAppPaths } from './paths'

/**
 * LLM 设置持久化：settings/llm.json
 * apiKey 用 safeStorage（DPAPI）加密为 base64 存 apiKeyEnc；不可用时明文存 apiKey 并标记
 */

interface DiskProvider extends Omit<ProviderConfig, 'apiKey'> {
  apiKeyEnc?: string
  apiKey?: string // safeStorage 不可用时的降级明文
}

interface DiskSettings {
  providers: DiskProvider[]
  textProviderId: string | null
  imageProviderId: string | null
  /** 供应商展示顺序（仅设置界面排序用，不影响默认模型） */
  providerOrder?: string[]
  search?: { provider: SearchSettings['provider']; apiKeyEnc?: string; apiKey?: string }
}

const DEFAULT_SEARCH: SearchSettings = { provider: 'none', apiKey: '' }

function settingsFile(): string {
  return join(getAppPaths().settings, 'llm.json')
}

/** 首次运行预置 Agnes AI（免费额度，OpenAI 兼容；国内版域名免代理直连） */
function presetSettings(): LlmSettings {
  const agnes: ProviderConfig = {
    id: randomUUID(),
    name: 'Agnes AI',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    apiKey: '',
    textModel: 'agnes-2.5-flash',
    imageModel: 'agnes-image-2.1-flash',
    imageApi: 'agnes-images'
  }
  return { providers: [agnes], textProviderId: agnes.id, imageProviderId: agnes.id, search: { ...DEFAULT_SEARCH } }
}

function encryptKey(plain: string): Pick<DiskProvider, 'apiKeyEnc' | 'apiKey'> {
  if (!plain) return { apiKeyEnc: '' }
  if (safeStorage.isEncryptionAvailable()) {
    return { apiKeyEnc: safeStorage.encryptString(plain).toString('base64') }
  }
  return { apiKey: plain }
}

function decryptKey(p: { apiKeyEnc?: string; apiKey?: string }): string {
  if (p.apiKeyEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(p.apiKeyEnc, 'base64'))
    } catch {
      return ''
    }
  }
  return p.apiKey ?? ''
}

/** 读取时归正 imageApi：apimart-images / agnes-images 原样保留；
 * 历史迁移——Agnes 域名下早期存盘的 openai-images（其端点禁止顶层 response_format）归正为 agnes-images；
 * 未知/缺省值按 baseUrl 域名回退 */
function migrateImageApi(api: string | undefined, baseUrl: string): ProviderConfig['imageApi'] {
  if (api === 'apimart-images' || api === 'agnes-images') return api
  if (/agnes-ai\.(com|cn)/.test(baseUrl)) return 'agnes-images'
  return 'openai-images'
}

export function getLlmSettings(): LlmSettings {
  const file = settingsFile()
  if (!existsSync(file)) {
    const preset = presetSettings()
    setLlmSettings(preset)
    return preset
  }
  try {
    const disk = JSON.parse(readFileSync(file, 'utf-8')) as DiskSettings
    return {
      providers: disk.providers.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        apiKey: decryptKey(p),
        textModel: p.textModel,
        imageModel: p.imageModel,
        imageApi: migrateImageApi(p.imageApi, p.baseUrl)
      })),
      textProviderId: disk.textProviderId,
      imageProviderId: disk.imageProviderId,
      providerOrder: disk.providerOrder,
      search: disk.search
        ? { provider: disk.search.provider, apiKey: decryptKey(disk.search) }
        : { ...DEFAULT_SEARCH }
    }
  } catch {
    return presetSettings()
  }
}

export function setLlmSettings(settings: LlmSettings): void {
  const disk: DiskSettings = {
    providers: settings.providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      textModel: p.textModel,
      imageModel: p.imageModel,
      imageApi: p.imageApi,
      ...encryptKey(p.apiKey)
    })),
    textProviderId: settings.textProviderId,
    imageProviderId: settings.imageProviderId,
    providerOrder: settings.providerOrder,
    search: { provider: settings.search?.provider ?? 'none', ...encryptKey(settings.search?.apiKey ?? '') }
  }
  writeFileSync(settingsFile(), JSON.stringify(disk, null, 2))
}

/** 取默认文本供应商（含解密后的 key） */
export function getTextProvider(): ProviderConfig | null {
  const s = getLlmSettings()
  return s.providers.find((p) => p.id === s.textProviderId) ?? s.providers[0] ?? null
}

/** 取默认图像供应商（M6 用） */
export function getImageProvider(): ProviderConfig | null {
  const s = getLlmSettings()
  return s.providers.find((p) => p.id === s.imageProviderId) ?? s.providers[0] ?? null
}

/** 取搜索配置（含解密后的 key） */
export function getSearchSettings(): SearchSettings {
  return getLlmSettings().search
}
