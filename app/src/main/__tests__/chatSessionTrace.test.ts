/**
 * 会话落盘为什么要测 toolTrace：
 * 工具调用留痕是排查「模型没调工具 / 调了失败 / 调成功却声称没做」的唯一现场——
 * 一旦有人在 writeChatSession 里"精简"字段或 ChatPanel 少传，历史就再次退化成靠文件 mtime 反推。
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AppPaths, ChatSession } from '@shared/types'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => Buffer.from(b).toString().replace(/^enc:/, '')
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

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

import { readChatSession, writeChatSession } from '../projectStore'

const P = '自媒体推广实操清单'

describe('chat 会话的 toolTrace 往返', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lig-trace-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('toolTrace 随会话原样落盘读回，键仍是 assistant 气泡下标', () => {
    const s: ChatSession = {
      id: '2026-09-29T09-00-00-000Z',
      title: '导出word',
      created_at: '2026-09-29T09:00:00.000Z',
      updated_at: '2026-09-29T09:00:00.000Z',
      messages: [
        { role: 'user', content: '导出word' },
        { role: 'assistant', content: 'Word 已导出：…' }
      ],
      toolTrace: {
        '1': [
          { name: 'export_docx', argsSummary: 'project: 自媒体推广实操清单', status: 'done', result: '{"path":"…docx"}' },
          { name: 'patch_article', argsSummary: 'project: X', status: 'error', result: '失败：缺少参数 project' }
        ]
      }
    }
    writeChatSession(P, s)
    const back = readChatSession(P, s.id)
    expect(back.toolTrace?.['1'].map((t) => [t.name, t.status])).toEqual([
      ['export_docx', 'done'],
      ['patch_article', 'error']
    ])
    expect(back.toolTrace?.['1'][1].result).toContain('缺少参数 project')
  })

  it('没有工具调用的会话不写 toolTrace 字段（老会话文件结构不变）', () => {
    const s: ChatSession = {
      id: '2026-09-29T09-01-00-000Z',
      title: '闲聊',
      created_at: '2026-09-29T09:01:00.000Z',
      updated_at: '2026-09-29T09:01:00.000Z',
      messages: [{ role: 'user', content: '你好' }]
    }
    writeChatSession(P, s)
    expect(readChatSession(P, s.id).toolTrace).toBeUndefined()
  })
})
