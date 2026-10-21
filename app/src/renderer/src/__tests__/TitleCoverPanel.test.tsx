/**
 * 封面面板静态渲染测试：钉住这条流程的界面契约——
 * 三条路收成一个分段选择（默认那条一步出图），细节收进「更多」，说明长文不留在界面上。
 * 上一版就是版式加到 6 套、参数加到 panel/decor/focal，界面却一个控件都没补，作者以为功能没做；
 * 再上一版是三张卡互相依赖（先去下面生成底图，再回上面勾选），这里都按断言钉住。
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import TitleCoverPanel from '../components/TitleCoverPanel'
import type { ProjectMeta } from '@shared/types'

const noop = (): void => undefined

const meta = {
  title: '关机再开机为什么能修好90%的问题',
  category: '科技数码',
  format: 'article',
  cover: { main: 'assets/cover-235.png', square: 'assets/cover-11.png', template: 'magazine' }
} as unknown as ProjectMeta

const html = renderToStaticMarkup(
  h(TitleCoverPanel, {
    project: '关机再开机为什么能修好90%的问题',
    meta,
    article: '# 标题\n\n正文',
    skill: null,
    projectDir: 'D:\\workspace\\科技数码\\demo',
    onMetaUpdated: noop,
    onApplyTitle: noop,
    onToast: noop
  })
)

describe('封面面板与工具面口径对齐', () => {
  it('三条路收成分段选择，不再三张卡来回翻', () => {
    expect(html).toContain('aria-label="封面怎么来"')
    for (const m of ['模板直出', '照片裁剪', 'HTML 直渲']) expect(html).toContain(m)
    // 三张旧卡标题不该还在（同一条事实不画三遍）
    for (const gone of ['路径一 · 模板直出', '路径二 · AI 生图后裁剪', '路径三 · HTML 直渲', '三条路选一条']) {
      expect(html).not.toContain(gone)
    }
  })

  it('默认那条路一步出图：版式可选、底图来源三档、一个主按钮', () => {
    for (const name of ['左文右图', '杂志大字', '氛围渐变', '大字版式', '左侧竖栏', '杂志留白']) {
      expect(html).toContain(name)
    }
    expect(html).toContain('aria-label="封面版式"')
    expect(html).toContain('aria-label="底图来源"')
    for (const b of ['不用底图', 'AI 生成底图', '用工程里的图']) expect(html).toContain(b)
    expect(html).toContain('生成封面')
    // 标题输入框自带「| 分行字更大」这条唯一有用的排印提示
    expect(html).toContain('用 | 分行，行越短字越大')
  })

  it('面板/装饰/取景收进「更多」，不摊在主流程上', () => {
    expect(html).toContain('更多：磨砂面板 / 装饰 / 方图取景')
    // 折叠未展开时这些控件不在面上（收起的是输入控件，不是事实）
    expect(html).not.toContain('aria-label="文字区磨砂面板"')
    expect(html).not.toContain('aria-label="方图取景"')
  })

  it('卡片里不再堆设计说明长文（依据归 docs/PRD.md，界面只留可操作项）', () => {
    for (const gone of ['版式与裁剪规则', '裁剪与保存', '这条路给谁用', '底图同化', '短边吃满']) {
      expect(html).not.toContain(gone)
    }
  })
})
