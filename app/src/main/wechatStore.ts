import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WechatSettings } from '@shared/wechat'
import { getAppPaths } from './paths'

/**
 * 公众号配置持久化：settings/wechat.json
 * appSecret 用 safeStorage（DPAPI）加密为 base64 存 appSecretEnc；不可用时明文存 appSecret 并标记
 * （加密策略同 settingsStore.ts 的 llm.json）
 */

interface DiskWechat {
  appId: string
  appSecretEnc?: string
  appSecret?: string // safeStorage 不可用时的降级明文
}

function wechatFile(): string {
  return join(getAppPaths().settings, 'wechat.json')
}

function encryptSecret(plain: string): Pick<DiskWechat, 'appSecretEnc' | 'appSecret'> {
  if (!plain) return { appSecretEnc: '' }
  if (safeStorage.isEncryptionAvailable()) {
    return { appSecretEnc: safeStorage.encryptString(plain).toString('base64') }
  }
  return { appSecret: plain }
}

function decryptSecret(d: DiskWechat): string {
  if (d.appSecretEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(d.appSecretEnc, 'base64'))
    } catch {
      return ''
    }
  }
  return d.appSecret ?? ''
}

export function getWechatSettings(): WechatSettings {
  const file = wechatFile()
  if (!existsSync(file)) return { appId: '', appSecret: '' }
  try {
    const disk = JSON.parse(readFileSync(file, 'utf-8')) as DiskWechat
    return { appId: disk.appId ?? '', appSecret: decryptSecret(disk) }
  } catch {
    return { appId: '', appSecret: '' }
  }
}

export function setWechatSettings(settings: WechatSettings): void {
  const disk: DiskWechat = { appId: settings.appId.trim(), ...encryptSecret(settings.appSecret.trim()) }
  writeFileSync(wechatFile(), JSON.stringify(disk, null, 2))
}
