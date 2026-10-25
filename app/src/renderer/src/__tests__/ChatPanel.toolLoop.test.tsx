// @vitest-environment jsdom
/**
 * 对话副驾驶「工具循环」（chat-tools v1）交互测试：把主进程那一侧（llm:chatStart →
 * llm:stream/llm:done → agent:callTool）全部换成可编程桩，从界面发送一条消息，
 * 钉住循环的三条行为契约——
 * 1. 原生 tool_calls：执行 agent:callTool → 结果回填 API 历史 → 下一轮继续问模型；
 * 2. 工具连续失败两次：不再重试，注入「停止重试」提示并强制文字收尾（不死循环）；
 * 3. 推送类工具（push_draft）必须过确认卡：用户取消时不发 agent:callTool，
 *    「用户取消了推送」如实回填给模型。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import ChatPanel from '../components/ChatPanel'
import { installApiStub, installDomShims, type ApiStub } from './helpers/ipcStub'

installDomShims()

let api: ApiStub
const onToast = vi.fn()
/** 每轮 llm:chatStart 的 requestId（测试据此回 llm:stream / llm:done） */
let chatStarts: string[] = []

/** 往指定轮写一段流式文本并收尾（toolCalls 非空 = 模型要调工具） */
function finishRound(requestId: string, text: string, toolCalls?: { id: string; name: string; arguments: string }[]): void {
  if (text) api.emit('llm:stream', { requestId, delta: text })
  api.emit('llm:done', { requestId, ...(toolCalls ? { toolCalls } : {}) })
}

beforeEach(() => {
  api = installApiStub()
  chatStarts = []
  onToast.mockClear()
  api.on('settings:getLlm', () => ({
    providers: [{ id: 'p1', name: '测试供应商', baseUrl: 'https://api.test', textModel: 'test-model', apiKey: 'k' }],
    textProviderId: 'p1'
  }))
  api.on('chat:list', () => [])
  api.on('chat:write', () => true)
  api.on('llm:chatStart', (requestId: string) => {
    chatStarts.push(requestId)
  })
  api.on('agent:listTools', () => [
    {
      name: 'read_article',
      description: '读工程正文',
      parameters: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] }
    }
  ])
  render(
    h(ChatPanel, {
      project: '演示工程',
      article: '# 标题\n\n正文一句',
      format: 'article',
      skill: null,
      onToast,
      onSkillsChanged: () => {},
      onGoBrainstorm: () => {},
      onGoReview: () => {}
    })
  )
})

afterEach(cleanup)

/** 从界面发一条消息（走真实发送按钮，不走 preset 旁路） */
async function sendUser(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('自由对话，Enter 发送（可附带图片/文档）'), {
    target: { value: text }
  })
  fireEvent.click(screen.getByTitle('发送（Enter）'))
  await waitFor(() => expect(chatStarts.length).toBe(1))
}

describe('工具循环（chat-tools v1）', () => {
  it('原生 tool_calls：执行工具 → 结果回填 → 下一轮文字收尾', async () => {
    api.on('agent:callTool', () => ({ ok: true, result: { length: 6 } }))
    await sendUser('帮我读一下正文')

    // 第一轮：模型要调 read_article
    await act(async () => {
      finishRound(chatStarts[0], '先读一下', [
        { id: 'c1', name: 'read_article', arguments: JSON.stringify({ project: '演示工程' }) }
      ])
    })
    await waitFor(() => expect(api.callsOf('agent:callTool').length).toBe(1))
    expect(api.callsOf('agent:callTool')[0][0]).toBe('read_article')

    // 第二轮：模型拿到结果后文字总结，循环结束
    await waitFor(() => expect(chatStarts.length).toBe(2))
    await act(async () => finishRound(chatStarts[1], '正文共 6 字，已读。'))
    await waitFor(() => expect(screen.getByText('正文共 6 字，已读。')).toBeTruthy())
    // 工具卡摘要如实计数：1 次、无失败（0 失败不显示失败段）
    expect(screen.getByText('1 次')).toBeTruthy()
  })

  it('工具连续失败两次：停止重试，强制文字收尾', async () => {
    api.on('agent:callTool', () => ({ ok: false, error: 'project 参数缺失' }))
    await sendUser('帮我读一下正文')

    // 第一轮失败
    await act(async () => {
      finishRound(chatStarts[0], '试试', [
        { id: 'c1', name: 'read_article', arguments: '{}' }
      ])
    })
    await waitFor(() => expect(api.callsOf('agent:callTool').length).toBe(1))
    // 第二轮再失败（连续两次）→ 注入「停止重试」并强制下一轮纯文本
    await waitFor(() => expect(chatStarts.length).toBe(2))
    await act(async () => {
      finishRound(chatStarts[1], '再试一次', [
        { id: 'c2', name: 'read_article', arguments: '{}' }
      ])
    })
    await waitFor(() => expect(api.callsOf('agent:callTool').length).toBe(2))
    // 第三轮：不再带 tools（强制文字收尾），也不再有第四轮
    await waitFor(() => expect(chatStarts.length).toBe(3))
    await act(async () => finishRound(chatStarts[2], '工具连续失败，需要你补工程名。'))
    await waitFor(() => expect(screen.getByText(/工具连续失败，需要你补工程名/)).toBeTruthy())
    const chatStartCalls = api.callsOf('llm:chatStart')
    expect(chatStartCalls.length).toBe(3)
    // 第三轮请求不再带 tools 参数
    expect((chatStartCalls[2][2] as { tools?: unknown[] } | undefined)?.tools).toBeUndefined()
    expect(chatStarts.length).toBe(3)
  })

  it('推送类工具必须过确认卡：取消时不执行，「用户取消了推送」如实回填', async () => {
    api.on('agent:callTool', () => ({ ok: true, result: { pushed: true } }))
    await sendUser('把这篇推到草稿箱')

    await act(async () => {
      finishRound(chatStarts[0], '好的，先确认', [
        { id: 'c1', name: 'push_draft', arguments: JSON.stringify({ project: '演示工程' }) }
      ])
    })
    // 确认卡出现（标题与按钮同名，取标题行），agent:callTool 尚未执行
    expect(await screen.findByText('确认推送：推送公众号草稿')).toBeTruthy()
    expect(api.callsOf('agent:callTool').length).toBe(0)

    // 点取消：不发调用，回填「用户取消了推送」给模型
    fireEvent.click(screen.getByText('取消'))
    await waitFor(() => expect(chatStarts.length).toBe(2))
    const round2 = api.callsOf('llm:chatStart')[1][1] as { role: string; content: string }[]
    const cancelMsg = round2.find((m) => m.role === 'tool' && m.content.includes('用户取消了推送'))
    expect(cancelMsg).toBeTruthy()
    await act(async () => finishRound(chatStarts[1], '已取消，未推送。'))
    await waitFor(() => expect(screen.getByText('已取消，未推送。')).toBeTruthy())
  })
})

describe('save_outline 深链', () => {
  it('大纲落盘成功后出「去大纲步」入口，点击回调跳转', async () => {
    api.on('agent:callTool', () => ({ ok: true, result: { file: 'outline.md' } }))
    const goOutline = vi.fn()
    cleanup() // 共享 beforeEach 已挂一份（无 onGoOutlineStep），这里换带深链回调的实例
    render(
      h(ChatPanel, {
        project: '演示工程',
        article: '# 标题',
        format: 'article',
        skill: null,
        onToast,
        onSkillsChanged: () => {},
        onGoBrainstorm: () => {},
        onGoReview: () => {},
        onGoOutlineStep: goOutline
      })
    )
    fireEvent.change(screen.getByPlaceholderText('自由对话，Enter 发送（可附带图片/文档）'), {
      target: { value: '反推大纲' }
    })
    fireEvent.click(screen.getByTitle('发送（Enter）'))
    await waitFor(() => expect(chatStarts.length).toBe(1))
    await act(async () => {
      finishRound(chatStarts[0], '整理中', [
        { id: 'c1', name: 'save_outline', arguments: JSON.stringify({ project: '演示工程', outline: '# 标题\n## 节' }) }
      ])
    })
    await waitFor(() => expect(chatStarts.length).toBe(2))
    await act(async () => finishRound(chatStarts[1], '已存好。'))
    const link = await screen.findByText(/去大纲步查看并拖拽重排/)
    fireEvent.click(link)
    expect(goOutline).toHaveBeenCalledTimes(1)
  })
})
