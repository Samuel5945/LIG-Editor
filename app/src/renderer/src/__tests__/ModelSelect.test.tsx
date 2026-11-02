// @vitest-environment jsdom
/**
 * 会话级模型选择菜单（ZCode 风格分组）的行为契约：
 * 1. 只列已填 Key 的供应商；每组列其拉取到的模型缓存，选中项高亮；
 * 2. 「跟随全局默认」= 不覆盖（value null），选中后 onChange 带出 {providerId, modelId}；
 * 3. 无缓存 Key 供应商出「拉取模型列表」项并回调宿主；没填 Key 的供应商整组不出现。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { createElement as h } from 'react'
import { ModelSelect } from '../components/ModelSelect'
import { installApiStub } from './helpers/ipcStub'
import type { ProviderConfig } from '@shared/types'

const p = (over: Partial<ProviderConfig>): ProviderConfig =>
  ({ id: over.id ?? 'x', name: over.name ?? '供应商', baseUrl: 'https://x.example/v1', ...over }) as ProviderConfig

const providers: ProviderConfig[] = [
  p({ id: 'global', name: '全局商汤', apiKey: 'k', textModel: 'deepseek-v4-flash', models: { text: [{ id: 'deepseek-v4-flash' }, { id: 'sensenova-6.8-flash-lite' }], image: [] } }),
  p({ id: 'agnes', name: 'Agnes AI', apiKey: 'k2', textModel: 'agnes-3.0-flash', models: { text: [{ id: 'agnes-3.0-flash' }, { id: 'agnes-2.5-pro' }], image: [] } }),
  p({ id: 'stale', name: '没拉过', apiKey: 'k3', textModel: 'x' }),
  p({ id: 'nokey', name: '没Key', textModel: 'y' })
]

const props = (over: Partial<Parameters<typeof ModelSelect>[0]> = {}) =>
  ({
    providers,
    defaultModelLabel: '全局商汤/deepseek-v4-flash',
    value: null,
    onChange: vi.fn(),
    onFetchModels: vi.fn().mockResolvedValue(undefined),
    direction: 'up',
    ...over
  }) as Parameters<typeof ModelSelect>[0]

afterEach(cleanup)

const open = async (): Promise<void> => {
  fireEvent.click(screen.getByLabelText(/^模型·/))
  await screen.findByText('对话模型')
}

describe('ModelSelect 分组菜单', () => {
  it('按供应商分组列出已填 Key 的模型；没 Key 的整组不出现', async () => {
    render(h(ModelSelect, props()))
    await open()
    expect(screen.getByText('全局商汤')).toBeTruthy()
    expect(screen.getByText('Agnes AI')).toBeTruthy()
    expect(screen.getByText('deepseek-v4-flash')).toBeTruthy()
    expect(screen.getByText('sensenova-6.8-flash-lite')).toBeTruthy()
    expect(screen.queryByText('没Key')).toBeNull()
    // 没拉过缓存的 Key 供应商出「拉取」项而不是模型列表
    expect(screen.getByText('拉取模型列表…')).toBeTruthy()
  })

  it('选中模型回调 {providerId, modelId}；「跟随全局默认」回调 null 且 hint 显示全局默认', async () => {
    const onChange = vi.fn()
    render(h(ModelSelect, props({ onChange })))
    await open()
    expect(screen.getByText('全局商汤/deepseek-v4-flash')).toBeTruthy()
    fireEvent.click(screen.getByText('agnes-2.5-pro'))
    expect(onChange).toHaveBeenCalledWith({ providerId: 'agnes', modelId: 'agnes-2.5-pro' })

    render(h(ModelSelect, props({ onChange, value: { providerId: 'agnes', modelId: 'agnes-2.5-pro' } })))
    fireEvent.click(screen.getByLabelText('模型·agnes-2.5-pro'))
    await screen.findByText('对话模型')
    fireEvent.click(screen.getByText('跟随全局默认'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('选中态高亮：value 命中的模型 MenuItem 带 active；触发钮显示模型名', async () => {
    render(h(ModelSelect, props({ value: { providerId: 'global', modelId: 'deepseek-v4-flash' } })))
    fireEvent.click(screen.getByLabelText('模型·deepseek-v4-flash'))
    await screen.findByText('对话模型')
    // getByTitle 避开「跟随默认」hint 里的同名文本歧义
    const item = screen.getByTitle('deepseek-v4-flash').closest('button') as HTMLButtonElement
    expect(/text-accent/.test(item.className)).toBe(true)
    // 没选中的模型不高亮
    const idle = screen.getByTitle('sensenova-6.8-flash-lite').closest('button') as HTMLButtonElement
    expect(/text-accent/.test(idle.className)).toBe(false)
  })

  it('无缓存供应商点「拉取」回调宿主，拉取期间显示进行中文案', async () => {
    const onFetchModels = vi.fn(() => new Promise<void>((r) => setTimeout(r, 50)))
    render(h(ModelSelect, props({ onFetchModels })))
    await open()
    fireEvent.click(screen.getByText('拉取模型列表…'))
    expect(onFetchModels).toHaveBeenCalledWith(providers[2])
    expect(await screen.findByText('拉取中…')).toBeTruthy()
    await screen.findByText('拉取模型列表…')
  })

  it('菜单挂 body（portal）而不是留在 chip-row 裁剪容器里——absolute 留行内会被整块裁掉', async () => {
    render(
      h('div', { 'data-overflow': '1', className: 'chip-row' }, h(ModelSelect, props()))
    )
    await open()
    const menu = screen.getByText('对话模型').closest('div[class*="shadow"]') as HTMLElement
    expect(menu).toBeTruthy()
    expect(menu.parentElement).toBe(document.body)
    expect(menu.closest('[data-overflow]')).toBeNull()
    expect(/\bfixed\b/.test(menu.className)).toBe(true)
    expect(menu.style.left).not.toBe('')
  })

  it('shownModels 过滤菜单：只列勾选模型，组标题带计数', async () => {
    const filtered = providers.map((p) => (p.id === 'global' ? { ...p, shownModels: ['deepseek-v4-flash'] } : p))
    render(h(ModelSelect, props({ providers: filtered })))
    await open()
    expect(screen.getByText('deepseek-v4-flash')).toBeTruthy()
    expect(screen.queryByText('sensenova-6.8-flash-lite')).toBeNull()
    // 没配过滤的供应商不受影响
    expect(screen.getByText('agnes-3.0-flash')).toBeTruthy()
    expect(screen.getByText(/显示 1\/2/)).toBeTruthy()
  })

  it('会话选中 / 供应商默认模型被过滤掉时仍保留在菜单里（正在用的不消失）', async () => {
    const filtered = providers.map((p) => (p.id === 'global' ? { ...p, shownModels: ['deepseek-v4-flash'] } : p))
    render(
      h(ModelSelect, props({ providers: filtered, value: { providerId: 'global', modelId: 'sensenova-6.8-flash-lite' } }))
    )
    await open()
    // 触发钮也显示选中模型名，限定到浮层里查
    const menu = screen.getByText('对话模型').closest('div[class*="shadow"]') as HTMLElement
    expect(within(menu).getByText('sensenova-6.8-flash-lite')).toBeTruthy()
    expect(within(menu).getByText('deepseek-v4-flash')).toBeTruthy()
  })

  it('管理弹窗：取消勾选后保存落 llm:setShownModels 真子集，全不选=清字段 null', async () => {
    const api = installApiStub()
    api.on('llm:setShownModels', () => true)
    render(h(ModelSelect, props()))
    await open()
    fireEvent.click(screen.getAllByText('管理显示模型…')[0])
    const dlg = await screen.findByRole('dialog')
    expect(dlg.textContent).toContain('管理显示模型 · 全局商汤')
    // 初始全部勾上（= 全部显示）
    fireEvent.click(screen.getByLabelText('sensenova-6.8-flash-lite'))
    fireEvent.click(screen.getByText('保存'))
    expect(api.callsOf('llm:setShownModels')[0]).toEqual(['global', ['deepseek-v4-flash']])
    // 全不选 = 不过滤：第一次点管理时菜单已收起（弹窗接管），重开菜单再进一次
    fireEvent.click(screen.getByLabelText(/^模型·/))
    await screen.findByText('对话模型')
    fireEvent.click(screen.getAllByText('管理显示模型…')[0])
    await screen.findByRole('dialog')
    // 全不选 = 不过滤：两个都取消
    fireEvent.click(screen.getByLabelText('deepseek-v4-flash'))
    fireEvent.click(screen.getByLabelText('sensenova-6.8-flash-lite'))
    fireEvent.click(screen.getByText('保存'))
    expect(api.callsOf('llm:setShownModels')[1]).toEqual(['global', null])
  })
})
