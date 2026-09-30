import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ToolLogCard, hhmm, type ToolCardState } from '../components/ToolLogCard'
import { TOOL_LABELS } from '../copilot/toolLabels'

const card = (over: Partial<ToolCardState> = {}): ToolCardState => ({
  name: 'set_theme',
  argsSummary: 'project: demo',
  status: 'done',
  at: new Date(2026, 8, 30, 18, 5).getTime(),
  ...over
})

describe('工具调用日志卡（UI/UX PRD §4 / 稿 A 标注⑤）', () => {
  it('默认折叠成一行摘要：次数 + 失败数，且折叠态也说明失败', () => {
    const html = renderToStaticMarkup(
      createElement(ToolLogCard, {
        cards: [card(), card({ name: 'save_theme_preset', status: 'error', result: 'category 参数缺失' }), card({ name: 'read_article' })]
      })
    )
    expect(html).toContain('工具调用')
    expect(html).toContain('3 次 · 1 失败')
    expect(html).toContain('1 次调用失败，展开看原因')
    // 折叠态不铺开行明细（展开才逐行）
    expect(html).not.toContain('调整排版参数')
  })

  it('执行中计入摘要，全成功时不出现失败字样', () => {
    const html = renderToStaticMarkup(createElement(ToolLogCard, { cards: [card(), card({ status: 'running' })] }))
    expect(html).toContain('2 次 · 执行中')
    expect(html).not.toContain('失败')
  })

  it('时间戳：无时刻的历史项留空，不显示假时间', () => {
    expect(hhmm(undefined)).toBe('')
    expect(hhmm(new Date(2026, 8, 30, 9, 5).getTime())).toBe('09:05')
  })

  it('工具中文名单源：每个可下发的工具都有中文名（漏一个就会在日志卡里露英文）', () => {
    const names = Object.keys(TOOL_LABELS)
    expect(names.length).toBeGreaterThan(15)
    for (const n of names) expect(TOOL_LABELS[n].length).toBeGreaterThan(1)
    expect(TOOL_LABELS.set_theme).toBe('调整排版参数')
    expect(TOOL_LABELS.save_theme_preset).toBe('保存分类主题')
  })
})
