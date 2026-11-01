// @vitest-environment jsdom
/**
 * chatOnce / chatOnceWithTools → llm:chatStart 的参数组包钉：
 * - 会话级模型覆盖（providerId/modelId）与 thinking 一起透传进 IPC 第三参
 * - 全空不发 options（undefined = 主进程走全局默认，回归钉）
 * 这是「对话面板选的模型真的进请求」的协议链最后一环（主进程解析见 llmModelOverride.test）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chatOnce, chatOnceWithTools } from '../copilot/llm'
import { installApiStub, installDomShims } from './helpers/ipcStub'

installDomShims()

let api: ReturnType<typeof installApiStub>
const msgs = [{ role: 'user' as const, content: '你好' }]

beforeEach(() => {
  api = installApiStub()
  api.on('llm:chatStart', () => 'ok')
})
afterEach(() => vi.clearAllMocks())

describe('chatOnce* 参数组包', () => {
  it('覆盖模型 + 档位一起进 llm:chatStart 第三参', async () => {
    const { promise } = chatOnceWithTools(msgs, {
      providerId: 'agnes',
      modelId: 'agnes-3.0-flash',
      thinking: 'high'
    })
    api.emit('llm:stream', { requestId: api.callsOf('llm:chatStart')[0][0], delta: '好' })
    api.emit('llm:done', { requestId: api.callsOf('llm:chatStart')[0][0] })
    await promise
    const opts = api.callsOf('llm:chatStart')[0][2]
    expect(opts).toMatchObject({ providerId: 'agnes', modelId: 'agnes-3.0-flash', thinking: 'high' })
  })

  it('全空不发 options（跟随全局默认）', () => {
    chatOnce(msgs)
    expect(api.callsOf('llm:chatStart')[0][2]).toBeUndefined()
  })

  it('只给覆盖模型不给档位：thinking 字段缺省不发', () => {
    chatOnceWithTools(msgs, { providerId: 'sens', modelId: 'deepseek-v4-flash' })
    const opts = api.callsOf('llm:chatStart')[0][2] as Record<string, unknown>
    expect(opts.providerId).toBe('sens')
    expect(opts.modelId).toBe('deepseek-v4-flash')
    expect('thinking' in opts).toBe(false)
  })
})
