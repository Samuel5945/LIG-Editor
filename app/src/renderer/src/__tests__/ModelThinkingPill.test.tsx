// @vitest-environment jsdom
/**
 * 模型 × 思考统一浮层（ZCode 形态）的行为契约：
 * 1. 单触发钮开一只浮层：供应商行 + 模型列表（视觉徽章/选中✓）+ 思考强度滑杆；
 * 2. 供应商行点开子菜单（单选 + 跟随全局默认 + 管理模型）；选模型回调并收起；
 * 3. 滑杆离散吸附档位、键盘步进；浮层挂 body（portal，chip-row 裁剪坑）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { createElement as h } from 'react'
import { ModelThinkingPill } from '../components/ModelThinkingPill'
import { installApiStub } from './helpers/ipcStub'
import type { ProviderConfig } from '@shared/types'
import type { ModelCapability } from '@shared/modelCatalog'

afterEach(cleanup)

const providers: ProviderConfig[] = [
  { id: 'g', name: '全局商汤', baseUrl: 'https://x.example/v1', apiKey: 'k', textModel: 'glm-5.2', imageModel: '', imageApi: 'openai-images', models: { text: [{ id: 'glm-5.2' }, { id: 'qwen3.8-flash' }], image: [] } },
  { id: 'a', name: 'Agnes AI', baseUrl: 'https://a.example/v1', apiKey: 'k2', textModel: 'agnes-3.0', imageModel: '', imageApi: 'openai-images', models: { text: [{ id: 'agnes-3.0' }], image: [] } }
]
const cap: ModelCapability = {
  reasoning: { defaultOn: true, openaiParam: 'reasoning_effort', levels: ['none', 'low', 'medium', 'high'] }
} as ModelCapability

const props = (over: Partial<Parameters<typeof ModelThinkingPill>[0]> = {}) =>
  ({
    providers,
    defaultProviderId: 'g',
    defaultModelLabel: '全局商汤/glm-5.2',
    modelSel: null,
    onModelChange: vi.fn(),
    onFetchModels: vi.fn().mockResolvedValue(undefined),
    cap,
    thinkLevel: null,
    onThinkChange: vi.fn(),
    direction: 'up',
    ...over
  }) as Parameters<typeof ModelThinkingPill>[0]

const open = async (): Promise<HTMLElement> => {
  fireEvent.click(screen.getByLabelText(/^模型·/))
  const slider = await screen.findByRole('slider')
  return slider.closest('div[class*="shadow"]') as HTMLElement
}

describe('ModelThinkingPill 统一浮层', () => {
  it('一只浮层三段：供应商行 + 模型列表 + 思考滑杆；挂 body', async () => {
    render(h(ModelThinkingPill, props()))
    const panel = await open()
    expect(panel.parentElement).toBe(document.body)
    expect(within(panel).getByText('全局商汤')).toBeTruthy()
    expect(within(panel).getByText('模型')).toBeTruthy()
    expect(within(panel).getByText('glm-5.2')).toBeTruthy()
    expect(within(panel).getByText('思考强度')).toBeTruthy()
    expect(within(panel).getByRole('slider')).toBeTruthy()
  })

  it('选模型回调 {providerId, modelId} 并收起浮层', async () => {
    const onModelChange = vi.fn()
    render(h(ModelThinkingPill, props({ onModelChange })))
    const panel = await open()
    fireEvent.click(within(panel).getByText('qwen3.8-flash'))
    expect(onModelChange).toHaveBeenCalledWith({ providerId: 'g', modelId: 'qwen3.8-flash' })
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('供应商行点开子菜单：切供应商回调其默认模型；管理模型开弹窗', async () => {
    const api = installApiStub()
    api.on('llm:setShownModels', () => true)
    const onModelChange = vi.fn()
    render(h(ModelThinkingPill, props({ onModelChange })))
    const panel = await open()
    fireEvent.click(within(panel).getByTitle('切换供应商'))
    // 子菜单里选 Agnes → 覆盖到其默认模型
    fireEvent.click(await screen.findByText('Agnes AI'))
    expect(onModelChange).toHaveBeenCalledWith({ providerId: 'a', modelId: 'agnes-3.0' })
    // 再开：子菜单还开着（选供应商只关子菜单不关浮层？不——pickProvider 只关子菜单，
    // 浮层仍开），直接点供应商行重开子菜单 → 管理模型 → 弹窗
    const provBtn = screen.getByTitle('切换供应商')
    fireEvent.click(provBtn)
    fireEvent.click(await screen.findByText('管理模型'))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('滑杆键盘步进回调档位；模型不支持思考时无滑杆', async () => {
    const onThinkChange = vi.fn()
    const { rerender } = render(h(ModelThinkingPill, props({ onThinkChange, thinkLevel: 'low' })))
    await open()
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })
    expect(onThinkChange).toHaveBeenCalledWith('medium')
    rerender(h(ModelThinkingPill, props({ cap: {} })))
    // 浮层还开着（rerender 不关），直接断言滑杆消失、模型区仍在
    expect(await screen.findByText('模型')).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
  })
})
