import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { LlmSettings, ProviderConfig, ProviderModelCache, SearchSettings } from '@shared/types'
import {
  RHYTHM_PROVIDER_SEED,
  SENSENOVA_PROVIDER_SEED,
  DASHSCOPE_PROVIDER_SEED,
  isRhythmProvider,
  isSenseNovaProvider,
  isDashScopeProvider
} from '@shared/providerSites'
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
  /** 手动置顶的供应商 id（展示用） */
  pinnedIds?: string[]
  /** 被手动取消置顶的默认置顶供应商 id（展示用） */
  unpinnedIds?: string[]
  /** 一次性内置标记：已预置基元律动（用户删除后不复活） */
  rhythmSeeded?: boolean
  /** 一次性内置标记：已预置商汤日日新 + 阿里云百炼（用户删除后不复活） */
  presetsSeeded?: boolean
  search?: { provider: SearchSettings['provider']; apiKeyEnc?: string; apiKey?: string }
}

const DEFAULT_SEARCH: SearchSettings = { provider: 'none', apiKey: '' }

function settingsFile(): string {
  return join(getAppPaths().settings, 'llm.json')
}

/** 从 ZCode 的 provider 配置读商汤 API Key（与 ZCode 生图脚本同源），读不到返回空（用户在设置里手填） */
function readZCodeSenseNovaKey(): string {
  try {
    const cfg = join(homedir(), '.zcode', 'v2', 'config.json')
    if (!existsSync(cfg)) return ''
    const json = JSON.parse(readFileSync(cfg, 'utf-8')) as {
      provider?: Record<string, { name?: string; options?: { baseURL?: string; apiKey?: string } }>
    }
    for (const p of Object.values(json.provider ?? {})) {
      if (p.options?.baseURL?.includes('sensenova') || p.name === '商汤') return p.options?.apiKey ?? ''
    }
  } catch {
    // ZCode 配置不可读则留空
  }
  return ''
}

/** 首次运行预置：基元律动（展示置顶）+ Agnes AI（默认文本/生图）+ 商汤日日新 + 阿里云百炼 */
function presetSettings(): LlmSettings {
  const rhythm: ProviderConfig = { id: randomUUID(), apiKey: '', ...RHYTHM_PROVIDER_SEED }
  const agnes: ProviderConfig = {
    id: randomUUID(),
    name: 'Agnes AI',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    apiKey: '',
    textModel: 'agnes-2.5-flash',
    imageModel: 'agnes-image-2.1-flash',
    imageApi: 'agnes-images'
  }
  const sensenova: ProviderConfig = { id: randomUUID(), apiKey: readZCodeSenseNovaKey(), ...SENSENOVA_PROVIDER_SEED }
  const dashscope: ProviderConfig = { id: randomUUID(), apiKey: '', ...DASHSCOPE_PROVIDER_SEED }
  return {
    providers: [rhythm, agnes, sensenova, dashscope],
    textProviderId: agnes.id,
    imageProviderId: agnes.id,
    search: { ...DEFAULT_SEARCH }
  }
}

/** 一次性内置种子：存量配置没有基元律动时补入列表首位（纯展示预置，不动已指定的默认模型）。
 * 标记位保证只执行一次——用户手动删除后不会复活；
 * 默认供应商未指定（null 回退 providers[0]）时改指原首项，避免回退落到空 Key 的内置项 */
function seedRhythmOnce(disk: DiskSettings): boolean {
  if (disk.rhythmSeeded) return false
  disk.rhythmSeeded = true
  if (!disk.providers.some((p) => isRhythmProvider(p))) {
    const oldFirstId = disk.providers[0]?.id ?? null
    disk.providers = [{ id: randomUUID(), apiKeyEnc: '', ...RHYTHM_PROVIDER_SEED }, ...disk.providers]
    if (!disk.textProviderId && oldFirstId) disk.textProviderId = oldFirstId
    if (!disk.imageProviderId && oldFirstId) disk.imageProviderId = oldFirstId
  }
  return true
}

/** 一次性内置种子：补入商汤日日新 + 阿里云百炼（key 空/已从 ZCode 读到均可），不改变默认供应商 */
function seedPresetsOnce(disk: DiskSettings): boolean {
  if (disk.presetsSeeded) return false
  disk.presetsSeeded = true
  if (!disk.providers.some((p) => isSenseNovaProvider(p))) {
    disk.providers = [
      ...disk.providers,
      { id: randomUUID(), ...SENSENOVA_PROVIDER_SEED, ...encryptKey(readZCodeSenseNovaKey()) }
    ]
  }
  if (!disk.providers.some((p) => isDashScopeProvider(p))) {
    disk.providers = [...disk.providers, { id: randomUUID(), apiKeyEnc: '', ...DASHSCOPE_PROVIDER_SEED }]
  }
  return true
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
    // 一次性内置种子（落盘保留 apiKeyEnc 原样，不做解密/重加密往返）
    const seeded = seedRhythmOnce(disk)
    if (seedPresetsOnce(disk) || seeded) writeFileSync(file, JSON.stringify(disk, null, 2))
    return {
      providers: disk.providers.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        apiKey: decryptKey(p),
        textModel: p.textModel,
        imageModel: p.imageModel,
        imageApi: migrateImageApi(p.imageApi, p.baseUrl),
        api: p.api,
        models: p.models
      })),
      textProviderId: disk.textProviderId,
      imageProviderId: disk.imageProviderId,
      providerOrder: disk.providerOrder,
      pinnedIds: disk.pinnedIds,
      unpinnedIds: disk.unpinnedIds,
      search: disk.search
        ? { provider: disk.search.provider, apiKey: decryptKey(disk.search) }
        : { ...DEFAULT_SEARCH }
    }
  } catch {
    return presetSettings()
  }
}

export function setLlmSettings(settings: LlmSettings): void {
  // 承继既有内置标记：用户删掉内置供应商后保存，不能被读取端迁移重新加回
  let rhythmSeeded = false
  let presetsSeeded = false
  let diskModels: Record<string, ProviderModelCache> = {}
  try {
    const disk = JSON.parse(readFileSync(settingsFile(), 'utf-8')) as DiskSettings
    rhythmSeeded = disk.rhythmSeeded ?? false
    presetsSeeded = disk.presetsSeeded ?? false
    // 模型列表缓存合并保护：设置弹窗的旧快照不含（或晚于）磁盘上的新缓存时，保留磁盘版本
    for (const p of disk.providers) {
      if (p.models) diskModels[p.id] = p.models
    }
  } catch {
    rhythmSeeded = false
  }
  const disk: DiskSettings = {
    providers: settings.providers.map((p) => {
      const cached = diskModels[p.id]
      const incoming = p.models
      let models: ProviderModelCache | undefined = incoming
      if (cached && (!incoming || (cached.updatedAt ?? '') > (incoming.updatedAt ?? ''))) models = cached
      return {
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        textModel: p.textModel,
        imageModel: p.imageModel,
        imageApi: p.imageApi,
        api: p.api,
        models,
        ...encryptKey(p.apiKey)
      }
    }),
    textProviderId: settings.textProviderId,
    imageProviderId: settings.imageProviderId,
    providerOrder: settings.providerOrder,
    pinnedIds: settings.pinnedIds,
    unpinnedIds: settings.unpinnedIds,
    rhythmSeeded,
    presetsSeeded,
    search: { provider: settings.search?.provider ?? 'none', ...encryptKey(settings.search?.apiKey ?? '') }
  }
  writeFileSync(settingsFile(), JSON.stringify(disk, null, 2))
}

/** 只更新某供应商的模型列表缓存（不动 key 与其余字段，避免解密/重加密往返） */
export function saveProviderModels(providerId: string, models: ProviderModelCache): boolean {
  try {
    const file = settingsFile()
    if (!existsSync(file)) return false
    const disk = JSON.parse(readFileSync(file, 'utf-8')) as DiskSettings
    const p = disk.providers?.find((x) => x.id === providerId)
    if (!p) return false
    p.models = models
    writeFileSync(file, JSON.stringify(disk, null, 2))
    return true
  } catch {
    return false
  }
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
