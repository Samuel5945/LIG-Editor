import { randomUUID } from 'crypto'
import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WechatAccount, WechatConfig } from '@shared/wechat'
import { getAppPaths } from './paths'

/**
 * 公众号配置持久化：settings/wechat.json（多账号）
 * - appSecret 用 safeStorage（DPAPI）加密为 appSecretEnc；不可用时明文存 appSecret
 *   （加密策略同 settingsStore.ts 的 llm.json）
 * - 旧版单账号结构 { appId, appSecretEnc } 读取时迁移为「一个 id=legacy 的默认账号 + 无绑定」，
 *   不需要一次性迁移脚本，首次保存即落成新结构
 * - 只改绑定的路径直接改写盘上结构、不让密文经 safeStorage 往返：省一次加解密，
 *   更避免「解密失败 → 密文被空值覆写」把密钥抹掉
 */

interface DiskAccount {
  id?: string
  name?: string
  appId?: string
  appSecretEnc?: string
  /** safeStorage 不可用时的降级明文 */
  appSecret?: string
}

interface DiskWechat {
  accounts?: DiskAccount[]
  defaultAccountId?: string
  bindings?: Record<string, string>
  // ---- 旧版单账号字段（读取时迁移；新结构写盘后不再出现）----
  appId?: string
  appSecretEnc?: string
  appSecret?: string
}

/** 旧版单账号迁移后的固定 id：必须稳定，否则每次读取换 id 会让既有绑定失配 */
const LEGACY_ID = 'legacy'

interface NormalizedDisk {
  accounts: DiskAccount[]
  defaultAccountId: string
  bindings: Record<string, string>
}

function wechatFile(): string {
  return join(getAppPaths().settings, 'wechat.json')
}

function encryptSecret(plain: string): Pick<DiskAccount, 'appSecretEnc' | 'appSecret'> {
  if (!plain) return { appSecretEnc: '' }
  if (safeStorage.isEncryptionAvailable()) {
    return { appSecretEnc: safeStorage.encryptString(plain).toString('base64') }
  }
  return { appSecret: plain }
}

function decryptSecret(d: DiskAccount): string {
  if (d.appSecretEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(d.appSecretEnc, 'base64'))
    } catch {
      return ''
    }
  }
  return d.appSecret ?? ''
}

function readDisk(): DiskWechat {
  if (!existsSync(wechatFile())) return {}
  try {
    const parsed = JSON.parse(readFileSync(wechatFile(), 'utf-8')) as DiskWechat
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeDisk(disk: DiskWechat): void {
  writeFileSync(wechatFile(), JSON.stringify(disk, null, 2) + '\n', 'utf-8')
}

/**
 * 规范化盘上结构：补旧版迁移、丢弃无 id 或无 appId 的账号、剔除指向已不存在账号的绑定。
 * 不触碰 safeStorage —— 密文字段原样保留，供只改绑定的路径安全往返。
 */
function normalizeDisk(disk: DiskWechat): NormalizedDisk {
  const accounts: DiskAccount[] = []
  for (const a of Array.isArray(disk.accounts) ? disk.accounts : []) {
    if (!a || typeof a !== 'object') continue
    const id = (a.id ?? '').trim()
    const appId = (a.appId ?? '').trim()
    if (!id || !appId) continue
    accounts.push({ ...a, id, appId, name: (a.name ?? '').trim() })
  }
  const legacyAppId = (disk.appId ?? '').trim()
  if (accounts.length === 0 && legacyAppId) {
    accounts.push({
      id: LEGACY_ID,
      name: '',
      appId: legacyAppId,
      appSecretEnc: disk.appSecretEnc,
      appSecret: disk.appSecret
    })
  }
  const ids = new Set(accounts.map((a) => a.id))
  const bindings: Record<string, string> = {}
  for (const [category, accountId] of Object.entries(disk.bindings ?? {})) {
    if (typeof accountId === 'string' && ids.has(accountId)) bindings[category] = accountId
  }
  const preferred = (disk.defaultAccountId ?? '').trim()
  return {
    accounts,
    defaultAccountId: ids.has(preferred) ? preferred : (accounts[0]?.id ?? ''),
    bindings
  }
}

/** 读取全量配置（AppSecret 已解密，供推送设置表单与推送取用） */
export function getWechatConfig(): WechatConfig {
  const disk = normalizeDisk(readDisk())
  return {
    accounts: disk.accounts.map((a) => ({
      id: a.id as string,
      name: a.name || (a.appId as string),
      appId: a.appId as string,
      appSecret: decryptSecret(a)
    })),
    defaultAccountId: disk.defaultAccountId || null,
    bindings: disk.bindings
  }
}

/** 全量保存账号列表与默认账号：空 id 补发新 id，重复 id 与无 appId 的账号丢弃 */
export function saveWechatConfig(config: WechatConfig): void {
  const accounts: DiskAccount[] = []
  const ids = new Set<string>()
  for (const a of config.accounts) {
    const appId = a.appId.trim()
    if (!appId) continue
    let id = a.id.trim() || randomUUID()
    while (ids.has(id)) id = randomUUID()
    ids.add(id)
    accounts.push({ id, name: a.name.trim(), appId, ...encryptSecret(a.appSecret.trim()) })
  }
  const bindings: Record<string, string> = {}
  for (const [category, accountId] of Object.entries(config.bindings ?? {})) {
    if (ids.has(accountId)) bindings[category] = accountId
  }
  const preferred = config.defaultAccountId ?? ''
  writeDisk({
    accounts,
    defaultAccountId: ids.has(preferred) ? preferred : (accounts[0]?.id ?? ''),
    bindings
  })
}

/** 分类绑定账号：accountId 传 null 或账号不存在 = 解绑（回退默认账号）；不触碰密文 */
export function setWechatBinding(category: string, accountId: string | null): void {
  const disk = normalizeDisk(readDisk())
  if (accountId !== null && disk.accounts.some((a) => a.id === accountId)) {
    disk.bindings[category] = accountId
  } else {
    delete disk.bindings[category]
  }
  writeDisk(disk)
}

/** 分类重命名时同步绑定 key（无绑定静默；新名已有绑定则保留原值不覆盖） */
export function renameWechatBinding(oldName: string, newName: string): void {
  const disk = normalizeDisk(readDisk())
  if (!disk.bindings[oldName]) return
  if (!disk.bindings[newName]) disk.bindings[newName] = disk.bindings[oldName]
  delete disk.bindings[oldName]
  writeDisk(disk)
}

/** 分类 → 账号：先查绑定，再回退默认账号，最后退回首个账号；无账号返回 null */
export function resolveWechatAccount(category?: string): WechatAccount | null {
  const config = getWechatConfig()
  const pick = (id: string | null | undefined): WechatAccount | null =>
    config.accounts.find((a) => a.id === id) ?? null
  const bound = category ? config.bindings[category] : null
  return pick(bound) ?? pick(config.defaultAccountId) ?? config.accounts[0] ?? null
}
