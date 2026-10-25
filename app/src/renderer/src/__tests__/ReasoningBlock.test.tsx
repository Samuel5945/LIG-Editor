// @vitest-environment jsdom
/**
 * 思考过程展示块（ReasoningBlock）的行为契约——它是对话面板与创作向导共用的「AI 在想什么」出口：
 * 1. 流式期间自动展开（思考模型的等待期里这就是唯一进度），完成后自动收起成一行摘要；
 * 2. 用户手动开关过就以用户为准，流结束不再自动切；
 * 3. 摘要带字数与进行中状态；空思考不占任何版面。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { createElement as h } from 'react'
import { ReasoningBlock } from '../components/ReasoningBlock'

afterEach(cleanup)

describe('ReasoningBlock（思考过程展示）', () => {
  it('流式：自动展开、标「思考中 · N 字」，正文可见', () => {
    render(h(ReasoningBlock, { text: '先分析一下问题', streaming: true }))
    expect(screen.getByText('思考中')).toBeTruthy()
    expect(screen.getByText('· 7 字')).toBeTruthy()
    expect(screen.getByText('先分析一下问题')).toBeTruthy()
  })

  it('完成：默认收起只剩摘要行，点开可见全文', () => {
    const { rerender } = render(h(ReasoningBlock, { text: '思考全文', streaming: true }))
    // 流结束 → 自动收起
    rerender(h(ReasoningBlock, { text: '思考全文，更长了', streaming: false }))
    expect(screen.getByText('思考过程')).toBeTruthy()
    expect(screen.queryByText('思考全文，更长了')).toBeNull()
    fireEvent.click(screen.getByText('思考过程'))
    expect(screen.getByText('思考全文，更长了')).toBeTruthy()
  })

  it('用户手动收起后，流结束不再自动展开（最后一次交互优先）', async () => {
    const { rerender } = render(h(ReasoningBlock, { text: '推理链', streaming: true }))
    fireEvent.click(screen.getByRole('button')) // 流式中用户手动收起
    expect(screen.queryByText('推理链')).toBeNull()
    await act(async () => {
      rerender(h(ReasoningBlock, { text: '推理链继续增长', streaming: false }))
    })
    expect(screen.queryByText('推理链继续增长')).toBeNull()
    expect(screen.getByText('· 7 字')).toBeTruthy()
  })

  it('空思考不渲染', () => {
    const { container } = render(h(ReasoningBlock, { text: '   ', streaming: true }))
    expect(container.firstElementChild).toBeNull()
  })
})

describe('ReasoningBlock · 思考档位标识', () => {
  it('high=「深度思考」、low=「快速思考」，流式与完成两个形态都带档位', () => {
    const { rerender } = render(h(ReasoningBlock, { text: '推理', streaming: true, level: 'high' }))
    expect(screen.getByText('深度思考中')).toBeTruthy()
    rerender(h(ReasoningBlock, { text: '推理完成稿', streaming: false, level: 'high' }))
    expect(screen.getByText('深度思考')).toBeTruthy()

    rerender(h(ReasoningBlock, { text: '略想', streaming: false, level: 'low' }))
    expect(screen.getByText('快速思考')).toBeTruthy()
  })

  it('不传 level 保持通用「思考过程」（跟随默认/其他面板不标档）', () => {
    render(h(ReasoningBlock, { text: '推理', streaming: false }))
    expect(screen.getByText('思考过程')).toBeTruthy()
    expect(screen.queryByText('深度思考')).toBeNull()
  })
})
