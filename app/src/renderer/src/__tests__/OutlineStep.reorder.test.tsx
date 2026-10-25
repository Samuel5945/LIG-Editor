// @vitest-environment jsdom
/**
 * 大纲步（OutlineStep）条目化重排的行为契约（UI/UX PRD §5.3 遗留缺口的落地）：
 * 1. 拖拽重排只挪位置不改内容——序列化用 \n 精确往返，原文形态（# 级数、空行）一个不丢；
 * 2. 向下拖落在目标后面、向上拖落在目标前面（与设置页供应商列表同一手感）；
 * 3. 行内直接改写文字走同一个 setOutline。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createElement as h } from 'react'
import OutlineStep from '../components/wizard/OutlineStep'

const OUTLINE = '# 拟定标题\n## 第一节\n先讲背景\n## 第二节\n再给方案'

const mount = (): { setOutline: ReturnType<typeof vi.fn> } => {
  const setOutline = vi.fn()
  render(
    h(OutlineStep, {
      phase: 'outline',
      outline: OUTLINE,
      setOutline,
      projName: '演示',
      setProjName: () => {},
      project: null,
      onCreateArticle: () => {},
      onCreateCards: () => {},
      onWriteToCurrent: () => {},
      onAbort: () => {},
      onBack: () => {}
    })
  )
  return { setOutline }
}

/** 条目行输入框（最后一个 textbox 是工程名，不算） */
const rows = (): HTMLInputElement[] =>
  screen.getAllByRole('textbox').slice(0, -1) as HTMLInputElement[]

afterEach(cleanup)

describe('大纲条目拖拽重排', () => {
  it('向下拖：条目落到目标行后面，内容逐字保留', () => {
    const { setOutline } = mount()
    const list = rows()
    fireEvent.dragStart(list[1]) // ## 第一节
    fireEvent.dragOver(list[3]) // ## 第二节
    fireEvent.drop(list[3])
    expect(setOutline).toHaveBeenCalledWith('# 拟定标题\n## 第二节\n再给方案\n## 第一节\n先讲背景')
  })

  it('向上拖：条目落到目标行前面', () => {
    const { setOutline } = mount()
    const list = rows()
    fireEvent.dragStart(list[3]) // ## 第二节（含其说明行一起手动拖时各自独立；这里拖标题行）
    fireEvent.dragOver(list[0])
    fireEvent.drop(list[0])
    expect(setOutline).toHaveBeenCalledWith('## 第二节\n再给方案\n# 拟定标题\n## 第一节\n先讲背景')
  })

  it('行内改写走 setOutline，其余行原样（含空行不丢）', () => {
    const setOutline = vi.fn()
    render(
      h(OutlineStep, {
        phase: 'outline',
        outline: '# 标题\n\n## 第一节\n说明',
        setOutline,
        projName: '',
        setProjName: () => {},
        project: null,
        onCreateArticle: () => {},
        onCreateCards: () => {},
        onWriteToCurrent: () => {},
        onAbort: () => {},
        onBack: () => {}
      })
    )
    fireEvent.change(rows()[2], { target: { value: '## 改过的第一节' } })
    expect(setOutline).toHaveBeenCalledWith('# 标题\n\n## 改过的第一节\n说明')
  })
})
