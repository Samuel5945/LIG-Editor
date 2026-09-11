/**
 * 公众号多账号配置存储测试。
 * 风险集中在这几处，逐条钉死：
 * - 旧版单账号结构（v0.5.0 及以前）读取时必须迁移，且迁移出的 id 稳定（否则既有绑定失配）
 * - 「只改绑定」的路径不能让密文经 safeStorage 往返——解密失败会把密钥覆写成空
 * - 解析顺序：分类绑定 > 默认账号 > 首个账号，且指向已删账号的绑定要被剔除
 *
 * 走真实临时目录（同 categoryPresetStore.test.ts），mock 掉 electron 的 safeStorage 与 paths。
 */
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`, 'utf8'),
    decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, '')
  }
}))

vi.mock('../paths', async () => {
  const { mkdtempSync } = await import('fs')
  const { join: pjoin } = await import('path')
  const { tmpdir } = await import('os')
  const dir = mkdtempSync(pjoin(tmpdir(), 'lig-wechat-'))
  return { getAppPaths: () => ({ root: dir, workspace: dir, settings: dir }) }
})

import { getAppPaths } from '../paths'
import {
  getWechatConfig,
  renameWechatBinding,
  resolveWechatAccount,
  saveWechatConfig,
  setWechatBinding
} from '../wechatStore'

const wechatFile = (): string => join(getAppPaths().settings, 'wechat.json')
const writeRaw = (value: unknown): void => writeFileSync(wechatFile(), JSON.stringify(value), 'utf8')
const readRaw = (): Record<string, unknown> => JSON.parse(readFileSync(wechatFile(), 'utf8'))
const enc = (plain: string): string => Buffer.from(`enc:${plain}`, 'utf8').toString('base64')

beforeEach(() => {
  try {
    unlinkSync(wechatFile())
  } catch {
    // 首轮尚无该文件，正常
  }
})

describe('公众号多账号配置', () => {
  it('文件不存在时返回空配置', () => {
    expect(getWechatConfig()).toEqual({ accounts: [], defaultAccountId: null, bindings: {} })
  })

  it('旧版单账号结构迁移为一个默认账号，name 回落为 appId', () => {
    writeRaw({ appId: 'wx_old', appSecretEnc: enc('s3cret') })
    const config = getWechatConfig()
    expect(config.accounts).toEqual([{ id: 'legacy', name: 'wx_old', appId: 'wx_old', appSecret: 's3cret' }])
    expect(config.defaultAccountId).toBe('legacy')
    expect(config.bindings).toEqual({})
  })

  it('迁移出的 id 每次读取都稳定（否则既有绑定会失配）', () => {
    writeRaw({ appId: 'wx_old', appSecretEnc: enc('s') })
    expect(getWechatConfig().accounts[0].id).toBe(getWechatConfig().accounts[0].id)
  })

  it('保存多账号后落成新结构：无顶层 appId，且密钥不以明文出现在文件里', () => {
    saveWechatConfig({
      accounts: [
        { id: 'a1', name: '主号', appId: 'wx_a', appSecret: 'plain-a' },
        { id: 'a2', name: '小号', appId: 'wx_b', appSecret: 'plain-b' }
      ],
      defaultAccountId: 'a2',
      bindings: {}
    })
    const raw = readRaw() as { appId?: string; defaultAccountId: string; accounts: unknown[] }
    expect(raw.appId).toBeUndefined()
    expect(raw.defaultAccountId).toBe('a2')
    expect(raw.accounts).toHaveLength(2)
    expect(readFileSync(wechatFile(), 'utf8')).not.toContain('plain-a')
    expect(getWechatConfig().accounts[0]).toEqual({ id: 'a1', name: '主号', appId: 'wx_a', appSecret: 'plain-a' })
  })

  it('保存时丢弃无 appId 的账号，空 id 补发新 id', () => {
    saveWechatConfig({
      accounts: [
        { id: '', name: '待填', appId: 'wx_ok', appSecret: 's' },
        { id: 'x', name: '空号', appId: '  ', appSecret: 's' }
      ],
      defaultAccountId: 'x',
      bindings: {}
    })
    const config = getWechatConfig()
    expect(config.accounts).toHaveLength(1)
    expect(config.accounts[0].appId).toBe('wx_ok')
    expect(config.accounts[0].id).not.toBe('')
    // 默认账号指向的 x 已不存在 → 回落到唯一账号
    expect(config.defaultAccountId).toBe(config.accounts[0].id)
  })

  it('解析顺序：分类绑定 > 默认账号 > 首个账号；无账号返回 null', () => {
    saveWechatConfig({
      accounts: [
        { id: 'a1', name: 'A', appId: 'wx_a', appSecret: 's' },
        { id: 'a2', name: 'B', appId: 'wx_b', appSecret: 's' }
      ],
      defaultAccountId: 'a1',
      bindings: {}
    })
    setWechatBinding('科技数码', 'a2')
    expect(resolveWechatAccount('科技数码')?.id).toBe('a2')
    expect(resolveWechatAccount('未配置的分类')?.id).toBe('a1')
    expect(resolveWechatAccount()?.id).toBe('a1')

    saveWechatConfig({ accounts: [], defaultAccountId: null, bindings: {} })
    expect(resolveWechatAccount('科技数码')).toBeNull()
  })

  it('只改绑定不动密文（密文不经 safeStorage 往返）', () => {
    saveWechatConfig({
      accounts: [{ id: 'a1', name: 'A', appId: 'wx_a', appSecret: 's' }],
      defaultAccountId: 'a1',
      bindings: {}
    })
    const before = readRaw() as { accounts: { appSecretEnc?: string }[] }
    const cipherBefore = before.accounts[0].appSecretEnc
    expect(cipherBefore).toBeTruthy()

    setWechatBinding('生活常识', 'a1')
    const after = readRaw() as { accounts: { appSecretEnc?: string }[]; bindings: Record<string, string> }
    expect(after.accounts[0].appSecretEnc).toBe(cipherBefore)
    expect(after.bindings).toEqual({ 生活常识: 'a1' })

    // 解绑：传 null 或指向不存在的账号都清掉该分类
    setWechatBinding('生活常识', null)
    expect((readRaw() as { bindings: Record<string, string> }).bindings).toEqual({})
    setWechatBinding('科技数码', 'a1')
    setWechatBinding('科技数码', 'ghost')
    expect((readRaw() as { bindings: Record<string, string> }).bindings).toEqual({})
  })

  it('盘上指向已不存在账号的绑定读取时被剔除', () => {
    writeRaw({
      accounts: [{ id: 'a1', name: 'A', appId: 'wx_a', appSecretEnc: enc('s') }],
      defaultAccountId: 'a1',
      bindings: { 科技数码: 'a1', 生活常识: 'ghost' }
    })
    expect(getWechatConfig().bindings).toEqual({ 科技数码: 'a1' })
  })

  it('分类重命名迁移绑定 key；新名已有绑定则保留原值不覆盖', () => {
    saveWechatConfig({
      accounts: [
        { id: 'a1', name: 'A', appId: 'wx_a', appSecret: 's' },
        { id: 'a2', name: 'B', appId: 'wx_b', appSecret: 's' }
      ],
      defaultAccountId: 'a1',
      bindings: {}
    })
    setWechatBinding('旧名', 'a1')
    renameWechatBinding('旧名', '新名')
    expect(getWechatConfig().bindings).toEqual({ 新名: 'a1' })

    setWechatBinding('A 类', 'a1')
    setWechatBinding('B 类', 'a2')
    renameWechatBinding('A 类', 'B 类')
    expect(getWechatConfig().bindings).toEqual({ 新名: 'a1', 'B 类': 'a2' })
  })
})
