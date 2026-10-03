/**
 * project.json 的 meta 读写透传测试（PRD §14 点名的回归高发点：readMeta 白名单）
 *
 * 钉死的是「读—改—写往返不吞字段」：B 期排版视觉覆盖 20 字段曾必须逐个登记进 readMeta 白名单，
 * 漏一个的表现是——作者在编辑器里改 A 字段，writeMeta 把盘上的 B 字段静默清空（界面看着两个字段互相牵连）。
 * 这里用真实临时目录走 readMeta→writeMeta→readMeta，把 30 个覆盖键逐一过一遍。
 *
 * 同 categoryPresetStore.test.ts：只 mock 掉会牵进 electron 的 paths 与 safeStorage。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
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
  const dir = mkdtempSync(pjoin(tmpdir(), 'lig-meta-'))
  return { getAppPaths: () => ({ root: dir, workspace: dir, settings: dir }) }
})

import { getAppPaths } from '../paths'
import { readMeta, writeMeta } from '../projectStore'
import { THEME_OVERRIDE_KEYS } from '@shared/categoryThemes'

const PROJECT = '排版覆盖工程'
const metaFile = (): string => join(getAppPaths().workspace, PROJECT, 'project.json')

/** 视觉覆盖 30 键各给一个合法且互不相同的值 */
const ALL_OVERRIDES: Record<string, unknown> = {
  accent: '#0f766e',
  bodyFontSize: 17,
  headingFontSize: 21,
  bodyAlign: 'indent',
  headingAlign: 'left',
  h1Style: 'pill',
  h2Style: 'block',
  h2Num: '1.',
  h3Mark: 'dot',
  bodyBg: 'none',
  fontFamily: 'Serif, serif',
  lineHeight: 2.4,
  letterSpacing: '0.03em',
  pGap: 28,
  bodyText: '#222222',
  headingColor: '#333333',
  quoteStyle: 'card',
  quoteBorder: '#444444',
  quoteBg: '#fdf2f8',
  quoteText: '#831843',
  hrColor: '#7c3aed',
  h2Border: '#0ea5e9',
  hrStyle: 'dot',
  strongStyle: 'highlight',
  strongBg: '#555555',
  strongColor: '#666666',
  imgRadius: 0,
  bodyRadius: 14,
  bodyPadding: '20px 22px',
  tableStyle: 'striped',
  tableHeaderBg: '#777777',
  tableBorder: '#888888',
  tableHeaderText: '#999999',
  h2Bg: '#aaaaaa'
}

function seed(raw: Record<string, unknown>): void {
  mkdirSync(join(getAppPaths().workspace, PROJECT), { recursive: true })
  writeFileSync(metaFile(), JSON.stringify({ name: PROJECT, status: 'drafting', ...raw }), 'utf8')
}

describe('readMeta 排版覆盖透传', () => {
  it('盘上 30 个覆盖键逐个读出不丢（含 imgRadius=0 这种真值会踩的坑）', () => {
    seed(ALL_OVERRIDES)
    const m = readMeta(PROJECT) as unknown as Record<string, unknown>
    for (const k of THEME_OVERRIDE_KEYS) expect(m[k], `字段 ${k} 未在 readMeta 白名单里`).toBe(ALL_OVERRIDES[k])
  })

  it('读—改—写往返：改一个字段不得清空其余覆盖', () => {
    seed(ALL_OVERRIDES)
    const m = readMeta(PROJECT)
    writeMeta(PROJECT, { ...m, lineHeight: 1.9 })
    const back = readMeta(PROJECT) as unknown as Record<string, unknown>
    expect(back.lineHeight).toBe(1.9)
    for (const k of THEME_OVERRIDE_KEYS) {
      if (k === 'lineHeight') continue
      expect(back[k], `往返后字段 ${k} 被吞`).toBe(ALL_OVERRIDES[k])
    }
  })

  it('null 覆盖（作者显式恢复默认）写回后不再存在于盘上', () => {
    seed(ALL_OVERRIDES)
    const m = readMeta(PROJECT)
    writeMeta(PROJECT, { ...m, lineHeight: undefined })
    const disk = JSON.parse(readFileSync(metaFile(), 'utf8')) as Record<string, unknown>
    expect('lineHeight' in disk).toBe(false)
    expect(readMeta(PROJECT).accent).toBe('#0f766e')
  })

  it('外部工具写的缺字段 project.json → 容错读取，不炸也不编造值', () => {
    seed({ accent: '#e63946' })
    const m = readMeta(PROJECT)
    expect(m.accent).toBe('#e63946')
    expect(m.lineHeight).toBeUndefined()
    expect(m.quoteStyle).toBeUndefined()
    expect(m.h2Bg).toBeUndefined()
    expect(m.name).toBe(PROJECT)
  })
})

describe('THEME_OVERRIDE_KEYS 白名单自洽', () => {
  it('40 键且无重复（新增字段只加一处会在这条红）', () => {
    expect(THEME_OVERRIDE_KEYS).toHaveLength(40)
    expect(new Set(THEME_OVERRIDE_KEYS).size).toBe(40)
  })
})
