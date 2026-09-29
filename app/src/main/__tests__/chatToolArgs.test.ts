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

describe('导出类工具注册表', () => {
  it('export_pdf 必须是个工具——菜单有 export:pdf，但注册表缺它时对话只会退化成导 HTML 让用户自己打印', () => {
    const pdf = TOOLS.find((t) => t.name === 'export_pdf')
    expect(pdf?.inputSchema.required).toEqual(['project'])
    expect(pdf?.description).toContain('PDF')
  })

  it('三种交付出口都在：html / docx / pdf（清单注入时它们的第一句用途就是模型的决策依据）', () => {
    const names = TOOLS.filter((t) => t.name.startsWith('export_')).map((t) => t.name)
    expect(names).toEqual(['export_html', 'export_docx', 'export_pdf'])
    for (const n of names) expect(TOOLS.find((t) => t.name === n)?.inputSchema.required).toContain('project')
  })
})

describe('工程名标点变体归一（2026-09-29 实测：模型把全角标点写成半角/「」，工具报 ENOENT 还让用户改名）', () => {
  const real = "月省千元不是梦：TokenRhythm如何用“自动选模”砍掉"
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lig-name-'))
    call('create_project', { name: real })
    call('write_article', { project: real, content: '# 标题\n\n正文第一段。' })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('半角冒号 + 直引号写法命中同一工程（原本直接被 assertSafeName 拒掉）', () => {
    const out = call('read_article', {
      project: '月省千元不是梦:TokenRhythm如何用"自动选模"砍掉'
    })
    expect(out).toContain('正文第一段')
  })

  it('「」替代全角引号也命中（早先会掉进兜底路径报 ENOENT workspace/<猜名>/project.json）', () => {
    expect(call('read_article', { project: '月省千元不是梦：TokenRhythm如何用「自动选模」砍掉' })).toContain('正文第一段')
  })

  it('真找不到的工程报候选名，不再吐文件系统错误', () => {
    expect(() => call('read_article', { project: '月省千元不是梦：Token砍掉' })).toThrow(/工程不存在/)
    expect(() => call('read_article', { project: '月省千元不是梦：Token砍掉' })).toThrow(/最接近的工程/)
  })
})
