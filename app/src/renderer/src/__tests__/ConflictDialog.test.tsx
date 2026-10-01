import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import ConflictDialog from '../components/ConflictDialog'

const noop = (): void => undefined

const html = renderToStaticMarkup(
  h(ConflictDialog, {
    file: 'article.md',
    local: '# 标题\n本地独有段落\n收尾',
    external: '# 标题\n外部独有段落\n收尾',
    onKeepLocal: noop,
    onAcceptExternal: noop,
    onMerge: noop
  })
)

describe('冲突弹窗三选项（UI/UX PRD §5.11）', () => {
  it('三张选项卡片单选，各自写清会丢什么', () => {
    expect(html).toContain('保留本地')
    expect(html).toContain('接受外部')
    expect(html).toContain('逐行合并')
    expect(html).toContain('本地独有 1 行 · 外部独有 1 行')
  })

  it('走统一弹窗壳：role=dialog + 标题带文件名 + 关闭按钮提示 Esc', () => {
    expect(html).toContain('role="dialog"')
    expect(html).toContain('检测到外部修改：article.md')
    expect(html).toContain('关闭（Esc）')
  })

  it('diff 预览按状态色单源（本地独有=danger、外部独有=success），不是硬写红绿', () => {
    expect(html).toContain('bg-st-bad/10')
    expect(html).toContain('bg-st-done/10')
    expect(html).toContain('本地独有段落')
    expect(html).toContain('外部独有段落')
  })

  it('默认单选「保留本地」：主按钮不是合并，逐行开关尚未出现', () => {
    expect(html).not.toContain('应用合并结果')
    expect(html).not.toContain('收下这一行')
    expect(html).not.toContain('去掉这一行')
    expect(html).toContain('>取消<')
  })
})
