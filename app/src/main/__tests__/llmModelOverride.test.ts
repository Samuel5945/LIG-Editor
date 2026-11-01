/**
 * 会话级模型覆盖（对话面板 ModelSelect）→ chatStart 的解析矩阵：
 * - providerId+modelId 都给：请求体 model = modelId，URL = 该供应商 baseUrl，thinking 按该模型目录下发
 * - 只给 providerId：model = 该供应商自己的 textModel
 * - providerId 指向不存在/没填 Key 的供应商：静默回退全局默认（防御，renderer 只列合法项）
 * - 不传 providerId：走全局 textProvider（回归钉）
 * 这层是「对话换模型不换全局默认」的唯一协议面，解析错一处就是把钱发给错误的供应商。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const broadcastMock = vi.fn()
vi.mock('../ipc', () => ({ broadcast: (...a: unknown[]) => broadcastMock(...a) }))

const PROVIDERS = [
  { id: 'global', name: '全局', baseUrl: 'https://global.example/v1', apiKey: 'k-global', textModel: 'global-plain' },
  { id: 'sens', name: '商汤', baseUrl: 'https://token.sensenova.cn/v1', apiKey: 'k-sens', textModel: 'deepseek-v4-flash' },
  { id: 'nokey', name: '没Key', baseUrl: 'https://nokey.example/v1', apiKey: '', textModel: 'nokey-model' }
]
vi.mock('../settingsStore', () => ({
  getLlmSettings: () => ({ providers: PROVIDERS, textProviderId: 'global' }) as never,
  getTextProvider: () => PROVIDERS.find((p) => p.id === 'global'),
  saveProviderModels: () => {}
}))

const fetchMock = vi.fn()
vi.mock('electron', () => ({
  net: { fetch: (...a: unknown[]) => fetchMock(...a) },
  // chatStart 链路上有零星 app.* 访问，测试里给个万能桩
  app: new Proxy({}, { get: (_t, k) => (k === 'getPath' ? () => '/tmp' : () => ({})) })
}))

import { chatStart } from '../llm'
import type { ChatMessage } from '@shared/types'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
/** 最小 SSE 应答：一帧内容 + [DONE]，body 走 async generator 供 for-await 消费 */
const sseResponse = (): { ok: true; status: 200; text: () => Promise<string>; body: AsyncIterable<Uint8Array> } => ({
  ok: true,
  status: 200,
  text: async () => '',
  body: (async function* () {
    yield enc('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')
    yield enc('data: [DONE]\n\n')
  })()
})

const msgs: ChatMessage[] = [{ role: 'user', content: '你好' }]

beforeEach(() => {
  broadcastMock.mockClear()
  fetchMock.mockClear()
  fetchMock.mockImplementation(async () => sseResponse())
})

const bodyOf = (callIdx = 0): { url: string; body: Record<string, unknown> } => {
  const [url, init] = fetchMock.mock.calls[callIdx] as [string, { body: string }]
  return { url, body: JSON.parse(init.body) as Record<string, unknown> }
}

describe('chatStart · 会话级模型覆盖', () => {
  it('providerId+modelId 都给：URL 与 model 走覆盖供应商，thinking 按该模型目录下发', async () => {
    await chatStart('r1', msgs, { providerId: 'sens', modelId: 'deepseek-v4-flash', thinking: 'high' })
    const { url, body } = bodyOf()
    expect(url).toBe('https://token.sensenova.cn/v1/chat/completions')
    expect(body.model).toBe('deepseek-v4-flash')
    expect(body.reasoning_effort).toBe('high')
    expect(broadcastMock).toHaveBeenCalledWith('llm:done', { requestId: 'r1', toolCalls: undefined })
  })

  it('只给 providerId：model 取该供应商自己的 textModel', async () => {
    await chatStart('r2', msgs, { providerId: 'sens' })
    const { url, body } = bodyOf()
    expect(url).toBe('https://token.sensenova.cn/v1/chat/completions')
    expect(body.model).toBe('deepseek-v4-flash')
  })

  it('providerId 不存在 / 没填 Key：静默回退全局默认', async () => {
    await chatStart('r3', msgs, { providerId: 'ghost', modelId: 'x' })
    expect(bodyOf()).toMatchObject({ url: 'https://global.example/v1/chat/completions' })
    expect(bodyOf().body.model).toBe('global-plain')

    await chatStart('r4', msgs, { providerId: 'nokey', modelId: 'nokey-model' })
    expect(bodyOf().url).toBe('https://global.example/v1/chat/completions')
    expect(bodyOf().body.model).toBe('global-plain')
  })

  it('不传 providerId：全局默认（回归钉）', async () => {
    await chatStart('r5', msgs, { thinking: 'high' })
    const { url, body } = bodyOf()
    expect(url).toBe('https://global.example/v1/chat/completions')
    expect(body.model).toBe('global-plain')
    // 全局模型无思考能力目录：不发思考参数
    expect(body.reasoning_effort).toBeUndefined()
  })
})
