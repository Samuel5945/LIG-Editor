/**
 * 对话落工程链路的工具入参容错（capabilityCore）为什么要测这些：
 * 2026-09-29 实测：临时对话里模型用文本协议落工程，patch_article 的 patches 被写成 JSON 字符串、
 * 又把单次替换写成顶层 old/new，还漏过 project——三种笔误全部报「参数为空/缺参」，
 * 连续失败后对话只能停下来问用户。这里钉死：能救的笔误一律救活，救不动的报错要说清期望形状。
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AppPaths } from '@shared/types'

// capabilityCore 传递依赖整层主进程模块（ipc 广播、导出、生图、微信存储）：给全套空壳桩
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'lig-test', getAppPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { writeText: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  shell: { openPath: async () => '' },
  net: { fetch: async () => ({}) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => Buffer.from(b).toString().replace(/^enc:/, '')
  }
}))

// 工程目录走临时目录真实 fs（与 store 系测试同款做法，不做内存 fake）
let dir = ''
vi.mock('../paths', () => ({
  getAppPaths: (): AppPaths => ({
    root: dir,
    workspace: join(dir, 'workspace'),
    skills: join(dir, 'skills'),
    settings: join(dir, 'settings'),
    ideaInbox: join(dir, 'idea-inbox.md')
  })
}))

import { TOOLS } from '../capabilityCore'

function call(name: string, args: Record<string, unknown>): unknown {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`工具未注册：${name}`)
  return tool.handler(args)
}

const P = '自媒体推广实操清单'

describe('patch_article 入参容错', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lig-chat-args-'))
    call('create_project', { name: P })
    call('write_article', { project: P, content: '# 清单\n\n## 一、先想清楚：你推广的到底是什么\n\n正文。\n' })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('patches 写成 JSON 字符串（文本协议的必然形态）照样落盘', () => {
    const r = call('patch_article', {
      project: P,
      patches: '[{"old":"一、先想清楚：你推广的到底是什么","new":"一、先定位：你到底在推什么"}]'
    }) as { applied: number; failed: unknown[] }
    expect(r.applied).toBe(1)
    expect(r.failed).toEqual([])
    expect(call('read_article', { project: P })).toContain('一、先定位')
  })

  it('只给顶层 old/new 的单次替换也认（模型最常见的写法）', () => {
    const r = call('patch_article', { project: P, old: '正文。', new: '正文改好了。' }) as { applied: number }
    expect(r.applied).toBe(1)
    expect(call('read_article', { project: P })).toContain('正文改好了')
  })

  it('单个补丁对象包成一项；补丁项缺 old/new 时报错说清要什么', () => {
    const r = call('patch_article', {
      project: P,
      patches: { old: '正文。', new: '换掉。' }
    }) as { applied: number }
    expect(r.applied).toBe(1)
    expect(() => call('patch_article', { project: P, patches: [{ new: '只有新文本' }] })).toThrow(/缺少 old/)
  })

  it('漏 project 与 patches 为空：报错带工程名来源与期望形状，不是一句「不能为空」', () => {
    expect(() => call('patch_article', { patches: '[]' })).toThrow(/缺少参数 project/)
    expect(() => call('patch_article', { project: P })).toThrow(/需传 JSON 数组/)
    expect(() => call('patch_article', { project: P, patches: '[old: 正文' })).toThrow(/不是合法 JSON 数组/)
  })

  it('正文写入后工程状态从脑暴推进到撰写（落工程链路别停在 ideating）', () => {
    expect((call('get_project', { project: P }) as { meta: { status: string } }).meta.status).toBe('drafting')
  })
})

describe('set_titles / save_ideas 入参容错', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lig-chat-args-'))
    call('create_project', { name: P })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('titles 的 JSON 字符串写法落进 project.json', () => {
    call('set_titles', {
      project: P,
      titles: '[{"text":"标题一","score":8,"reason":"直白"},{"text":"标题二","score":7,"reason":"悬念"}]'
    })
    const meta = (call('get_project', { project: P }) as { meta: { titles: { text: string }[] } }).meta
    expect(meta.titles.map((t) => t.text)).toEqual(['标题一', '标题二'])
  })

  it('ideas 的 JSON 字符串写法入库；空数组按期望形状报错', () => {
    expect(call('save_ideas', {
      ideas: '[{"title":"选题","angle":"角度","audience":"人群","score":8,"reason":"现在写"}]'
    })).toEqual({ saved: 1 })
    expect(() => call('save_ideas', { ideas: '[]' })).toThrow(/ideas 不能为空/)
  })
})
