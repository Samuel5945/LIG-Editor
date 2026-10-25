// @vitest-environment jsdom
/**
 * 贴图卡组「整组渲染队列」交互测试（对应 4df8d9e 的可停队列）：
 * 钉住三条行为契约——
 * 1. 进度横幅如实计数（正在渲染 done+1 / total）；
 * 2. 「停止」只停剩余队列：在途那张渲完为止，之后的不再发起 cards:render，
 *    收尾 toast 明说剩余几张未渲染（可单张补渲）——不装作全部完成；
 * 3. 不停止时队列跑满、横幅消失。
 * 渲染在主进程串行队列里真实耗时，这里用「手动放行」的 cards:render 应答模拟逐张完成。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import CardsPanel from '../components/CardsPanel'
import { installApiStub, installDomShims, type ApiStub } from './helpers/ipcStub'
import type { CardDeck } from '@shared/cards'

installDomShims()

const deckOf = (pngs: string[]): CardDeck => ({
  format: 'wechat',
  accent: '#b0803c',
  cards: pngs.map((png, i) => ({
    title: `第 ${i + 1} 张标题`,
    body: '要点一\n要点二',
    bgPrompt: '',
    bgImage: '',
    png
  }))
})

/** cards:render 的手动放行门：每次调用挂起，release() 按调用顺序放行一张 */
const gate = {
  pending: [] as (() => void)[],
  release: (): void => {
    const r = gate.pending.shift()
    if (r) r()
  }
}

let api: ApiStub
const onToast = vi.fn()

function mount(deck: CardDeck): void {
  api.on('cards:read', () => deck)
  api.on('cards:render', () => new Promise<void>((r) => gate.pending.push(r)))
  api.on('cards:archiveRead', () => null)
  render(
    h(CardsPanel, {
      project: '演示工程',
      projectDir: 'D:\\workspace\\科技数码\\演示工程',
      skill: null,
      hasArticle: false,
      onArticleGenerated: () => {},
      onMetaUpdated: () => {},
      onDeckChanged: () => {},
      onToast
    })
  )
}

beforeEach(() => {
  api = installApiStub()
  gate.pending = []
  onToast.mockClear()
})

// vitest 未开 globals，RTL 的自动 cleanup 不会挂上——显式卸载，上一轮的横幅/按钮不留进下一轮
afterEach(cleanup)

describe('整组渲染队列（可停）', () => {
  it('首载缺 PNG 的卡自动进队列，横幅如实计数', async () => {
    mount(deckOf(['', '', '']))
    // 3 张全缺：第一张已发起渲染，横幅显示 1 / 3
    expect(await screen.findByText('正在渲染 1 / 3 张…')).toBeTruthy()
    expect(api.callsOf('cards:render').length).toBe(1)
  })

  it('「停止」只停剩余队列：在途一张渲完，之后的不再发起', async () => {
    mount(deckOf(['', '', '']))
    await screen.findByText('正在渲染 1 / 3 张…')
    // 放行第 1 张 → 计数推进到 2 / 3，第 2 张发起
    await act(async () => gate.release())
    expect(await screen.findByText('正在渲染 2 / 3 张…')).toBeTruthy()
    // 第 2 张在途时点停止
    fireEvent.click(screen.getByText('停止'))
    await act(async () => gate.release())
    // 第 3 张不再发起；收尾 toast 如实说剩余几张（「已停止」走 onToast，不进 DOM）
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('已停止渲染，剩余 1 张未渲染（可单张补渲）'))
    expect(api.callsOf('cards:render').length).toBe(2)
  })

  it('不停止时队列跑满，横幅消失', async () => {
    mount(deckOf(['', '', '']))
    await screen.findByText('正在渲染 1 / 3 张…')
    await act(async () => gate.release())
    await act(async () => gate.release())
    await act(async () => gate.release())
    expect(api.callsOf('cards:render').length).toBe(3)
    // 收尾重读 deck 后横幅清空，也没有「已停止」的误报
    expect(onToast).not.toHaveBeenCalledWith(expect.stringMatching(/已停止渲染/))
    expect(screen.queryByText(/正在渲染/)).toBeNull()
  })
})
