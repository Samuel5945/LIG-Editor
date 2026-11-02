// @vitest-environment jsdom
/**
 * 思考档位选择菜单的行为契约：
 * 1. 菜单挂 document.body（portal + fixed 定位）——宿主行是 chip-row 横滑容器时 absolute
 *    浮层会被整块裁掉（2026-11-02「思考按钮点了没反应」实测根因），回归就盯这条挂载位置；
 * 2. 档位列表按 cap.reasoning.levels 出（none 档不重复出「关闭思考」），选择回调并收起。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createElement as h } from 'react'
import { ThinkingSelect } from '../components/ThinkingSelect'
import type { ModelCapability } from '@shared/modelCatalog'
import type { ThinkingChoice } from '@shared/types'

afterEach(cleanup)

const cap: ModelCapability = {
  contextWindow: 1_000_000,
  reasoning: { defaultOn: true, openaiParam: 'reasoning_effort', levels: ['none', 'minimal', 'low', 'medium', 'high'] }
} as ModelCapability

const renderPill = (onChange = vi.fn(), value: ThinkingChoice = null): void => {
  render(
    h(
      'div',
      { 'data-overflow': '1', className: 'chip-row' }, // 模拟对话输入行的横滑裁剪容器
      h(ThinkingSelect, { cap, value, onChange, tone: 'pill', direction: 'up' })
    )
  )
}

const open = async (): Promise<void> => {
  fireEvent.click(screen.getByLabelText(/^思考·/))
  await screen.findByText('思考档位')
}

describe('ThinkingSelect 档位菜单', () => {
  it('菜单挂 body（portal）而不是留在 chip-row 裁剪容器里，定位走 fixed', async () => {
    renderPill()
    await open()
    const menu = screen.getByText('思考档位').closest('div[class*="shadow"]') as HTMLElement
    expect(menu).toBeTruthy()
    // 挂载点：直接挂在 body 下（portal），不落在 data-overflow 裁剪容器内
    expect(menu.parentElement).toBe(document.body)
    expect(menu.closest('[data-overflow]')).toBeNull()
    // fixed 定位 + 视口坐标内联样式（jsdom 无布局，坐标存在性即可）
    expect(/\bfixed\b/.test(menu.className)).toBe(true)
    expect(menu.style.left).not.toBe('')
  })

  it('档位按 levels 出且 none 不重复，选择回调 onChange 并收起菜单', async () => {
    const onChange = vi.fn()
    renderPill(onChange)
    await open()
    expect(screen.getByText('最低')).toBeTruthy()
    expect(screen.getByText('关闭思考')).toBeTruthy() // false 分支单独出，none 档不重复出
    expect(screen.queryByText('关闭')).toBeNull()
    fireEvent.click(screen.getByText('高'))
    expect(onChange).toHaveBeenCalledWith('high')
    // 收起：菜单从 body 移除
    expect(screen.queryByText('思考档位')).toBeNull()
  })
})
