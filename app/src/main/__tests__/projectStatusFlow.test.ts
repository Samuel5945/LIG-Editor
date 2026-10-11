/**
 * 工程状态机测试（PRD §status：ideating → drafting → reviewing → ready）。
 *
 * 钉死的是转移白名单：状态是工程现实的结果（正文落盘/审阅落盘/交付物产出），
 * advanceStatus 之外不允许跳步与倒挂——reviewing 退回 drafting 是「审阅后又改稿」，
 * ready 是终态（已推平台的草稿不因本地改动撤销）。选题看板「已成稿」泳道吃这两个状态。
 *
 * 同 projectMetaVisualPassthrough.test.ts：只 mock 掉会牵进 electron 的 paths 与 safeStorage。
 */
import { describe, expect, it, vi } from 'vitest'

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
  const dir = mkdtempSync(pjoin(tmpdir(), 'lig-status-'))
  return { getAppPaths: () => ({ root: dir, workspace: dir, settings: dir }) }
})

import { advanceStatus, createProject, readMeta, stampExported } from '../projectStore'

let seq = 0
/** 每个用例独立工程：paths mock 是文件级单例临时目录，同名 createProject 会撞车 */
function setup(): string {
  const name = `状态机工程${++seq}`
  createProject(name)
  return name
}

describe('工程状态机 advanceStatus', () => {
  it('新建工程停在 ideating；ideating 可直达 drafting/reviewing/ready', () => {
    const NAME = setup()
    expect(readMeta(NAME).status).toBe('ideating')
    expect(advanceStatus(NAME, 'drafting')).toBe(true)
    expect(readMeta(NAME).status).toBe('drafting')
  })

  it('drafting → reviewing（审阅报告落盘）→ ready（交付物产出）全链走通', () => {
    const NAME = setup()
    advanceStatus(NAME, 'drafting')
    expect(advanceStatus(NAME, 'reviewing')).toBe(true)
    expect(readMeta(NAME).status).toBe('reviewing')
    expect(advanceStatus(NAME, 'ready')).toBe(true)
    expect(readMeta(NAME).status).toBe('ready')
  })

  it('审阅后又改稿：reviewing → drafting 退回放行', () => {
    const NAME = setup()
    advanceStatus(NAME, 'drafting')
    advanceStatus(NAME, 'reviewing')
    expect(advanceStatus(NAME, 'drafting')).toBe(true)
    expect(readMeta(NAME).status).toBe('drafting')
  })

  it('ready 是终态：不再随本地改动回退', () => {
    const NAME = setup()
    advanceStatus(NAME, 'drafting')
    advanceStatus(NAME, 'ready')
    for (const to of ['ideating', 'drafting', 'reviewing', 'ready'] as const) {
      expect(advanceStatus(NAME, to)).toBe(false)
    }
    expect(readMeta(NAME).status).toBe('ready')
  })

  it('原地转移不算推进', () => {
    const NAME = setup()
    expect(advanceStatus(NAME, 'ideating')).toBe(false)
  })

  it('工程不存在时照常抛错：调用方（写文/写审阅/盖章）都先保证了工程存在', () => {
    expect(() => advanceStatus('不存在的工程', 'drafting')).toThrow()
  })

  it('stampExported 顺带推进 ready：导出/推送成功即可发布', () => {
    const NAME = setup()
    advanceStatus(NAME, 'drafting')
    stampExported(NAME)
    expect(readMeta(NAME).status).toBe('ready')
    expect(readMeta(NAME).lastExportAt).toBeTruthy()
  })

  it('ideating 直接导出同样视为可发布（导出即事实，不强制先过 drafting）', () => {
    const NAME = setup()
    stampExported(NAME)
    expect(readMeta(NAME).status).toBe('ready')
  })
})
