// @vitest-environment jsdom
/**
 * 分析面板（ReviewPanel 泛化「审阅 | 爆款拆解」）的行为契约：
 * 1. 分段切换两模式：按钮/文件落点（review.md ↔ teardown.md）随模式换，审阅独有控件（联网/优化正文）不漏到拆解模式；
 * 2. BubbleMenu「拆解这段」触发链：teardownRequest 自增 → 切拆解模式 → 带选段发起 → 流式收尾写 teardown.md。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import ReviewPanel from '../components/ReviewPanel'
import { installApiStub, installDomShims, type ApiStub } from './helpers/ipcStub'

installDomShims()

let api: ApiStub
const onToast = vi.fn()
let chatStarts: string[] = []
const files: Record<string, string> = { 'review.md': '', 'teardown.md': '' }
const writes: { file: string; content: string }[] = []

const props = (over: Partial<Parameters<typeof ReviewPanel>[0]> = {}) =>
  ({
    project: '演示工程',
    article: '# 标题\n\n正文一段',
    skill: null,
    runRequest: 0,
    teardownRequest: 0,
    selection: null,
    onLocate: () => true,
    onOptimize: () => {},
    onToast,
    ...over
  }) as Parameters<typeof ReviewPanel>[0]

beforeEach(() => {
  api = installApiStub()
  chatStarts = []
  writes.length = 0
  onToast.mockClear()
  files['review.md'] = ''
  files['teardown.md'] = ''
  api.on('project:readFile', (_p: string, file: string) => files[file] ?? '')
  api.on('project:writeFile', (_p: string, file: string, content: string) => {
    writes.push({ file, content })
    files[file] = content
  })
  api.on('llm:chatStart', (requestId: string) => chatStarts.push(requestId))
})

afterEach(cleanup)

describe('分析面板双模式', () => {
  it('默认审阅；切「爆款拆解」后按钮与文件落点换成 teardown.md，联网开关不再出现', async () => {
    render(h(ReviewPanel, props()))
    expect(await screen.findByText('全文审阅')).toBeTruthy()
    expect(screen.getByText('review.md')).toBeTruthy()
    expect(screen.getByText('联网审阅')).toBeTruthy()

    fireEvent.click(screen.getByText('爆款拆解'))
    expect(await screen.findByText('拆解当前正文')).toBeTruthy()
    expect(screen.getByText('teardown.md')).toBeTruthy()
    expect(screen.queryByText('联网审阅')).toBeNull()
    expect(screen.queryByText('优化正文')).toBeNull()
  })

  it('「拆解这段」触发链：带选段发起 → 流式收尾写 teardown.md、toast 如实', async () => {
    const { rerender } = render(h(ReviewPanel, props()))
    await screen.findByText('全文审阅')
    // BubbleMenu 点「拆解这段」：App 递增 teardownRequest 并带选区
    rerender(h(ReviewPanel, props({ teardownRequest: 1, selection: '开头这三行为什么留人' })))
    await waitFor(() => expect(chatStarts.length).toBe(1))
    // 发出的消息带选段原文（拆解对象是选中段落）
    const msgs = api.callsOf('llm:chatStart')[0][1] as { role: string; content: unknown }[]
    expect(JSON.stringify(msgs)).toContain('开头这三行为什么留人')

    await act(async () => {
      api.emit('llm:stream', { requestId: chatStarts[0], delta: '# 爆款拆解\n## 标题与钩子\n数字+悬念' })
      api.emit('llm:done', { requestId: chatStarts[0] })
    })
    await waitFor(() => expect(writes).toEqual([{ file: 'teardown.md', content: '# 爆款拆解\n## 标题与钩子\n数字+悬念\n' }]))
    expect(onToast).toHaveBeenCalledWith('选段拆解已写入 teardown.md')
  })
})

describe('拆解档位与外部文章', () => {
  it('档位循环：跟随→深度后发起，请求带 thinking: high', async () => {
    render(h(ReviewPanel, props()))
    fireEvent.click(await screen.findByText('爆款拆解'))
    const levelChip = await screen.findByText(/档位·跟随/)
    fireEvent.click(levelChip)
    expect(screen.getByText(/档位·深度/)).toBeTruthy()
    fireEvent.click(screen.getByText('拆解当前正文'))
    await waitFor(() => expect(chatStarts.length).toBe(1))
    const opts = api.callsOf('llm:chatStart')[0][2] as { thinking?: string }
    expect(opts?.thinking).toBe('high')
  })

  it('粘贴外部文章：面板内展示、不落盘（writes 保持空）、toast 如实标注', async () => {
    render(h(ReviewPanel, props()))
    fireEvent.click(await screen.findByText('爆款拆解'))
    fireEvent.click(screen.getByText('拆外部文章'))
    const ta = screen.getByPlaceholderText(/粘贴对标爆款全文/) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '# 对标爆款标题\n\n钩子开头' } })
    fireEvent.click(screen.getByText('拆解粘贴的文章'))
    await waitFor(() => expect(chatStarts.length).toBe(1))
    await act(async () => {
      api.emit('llm:stream', { requestId: chatStarts[0], delta: '# 爆款拆解\n## 标题与钩子\n数字+悬念' })
      api.emit('llm:done', { requestId: chatStarts[0] })
    })
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('外部文章拆解完成（仅面板展示，未落盘）'))
    expect(writes).toEqual([])
    expect(screen.getByText('teardown.md（外部文章 · 未落盘）')).toBeTruthy()
    expect(screen.getByText('标题与钩子')).toBeTruthy()
  })
})

describe('拆解报告可发现性（项4）', () => {
  it('工程已有 teardown.md 时，审阅模式头部出「有拆解报告 · 查看」，点击切到拆解模式并展示报告', async () => {
    files['teardown.md'] = '# 爆款拆解\n## 标题与钩子\n数字+悬念'
    render(h(ReviewPanel, props()))
    const pill = await screen.findByText('有拆解报告 · 查看')
    fireEvent.click(pill)
    // 切模式后读 teardown.md：分区展示 + 文件落点对准
    expect(await screen.findByText('标题与钩子')).toBeTruthy()
    expect(screen.queryByText('teardown.md（外部文章 · 未落盘）')).toBeNull()
    // 项9：拆解模式的徽章如实标注
    expect(screen.getByText('拆解 · 不计流程状态')).toBeTruthy()
  })
})
