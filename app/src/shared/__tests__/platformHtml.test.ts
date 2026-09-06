/**
 * 多平台分发适配测试（M11）：同一篇 md 在不同平台画像下的形态契约——
 * - zhihu：零内联样式（无 style= 属性、无 section/div 包裹）、语义标签齐全、自动序号替换手写序号
 * - toutiao/baijiahao：保守内联（保留 color、引用左条、表格边框）、无背景卡/装饰
 * - wechat：委托 exportHtml 原路径，输出与 docToExportHtml 逐字节一致（回归保证）
 * - 页壳 wrapPlatformPage：标题转义、720px 专栏宽
 */
import { describe, expect, it } from 'vitest'
import { mdToDoc } from '../markdown'
import { docToExportHtml } from '../exportHtml'
import { docToPlatformHtml, wrapPlatformPage, PLATFORM_LABELS } from '../platformHtml'
import type { ArticleTheme } from '../types'

const RESOLVE = (src: string): string => src

const SAMPLE_MD = [
  '# 大标题',
  '',
  '开场段落，带 **加粗强调** 与 <span style="color:#ff0000">红字</span>。',
  '',
  '01', // 纯序号装饰段：应跳过
  '',
  '## 01 手写序号小节', // 手写序号：启用自动序号时被替换
  '',
  '小节正文。',
  '',
  '> 引用内容一行',
  '',
  '---',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 甲 | 1 |',
  '',
  '<!-- gallery: swipe-h -->',
  '![图一](assets/a.png)',
  '![图二](assets/b.png)',
  '<!-- caption: 图集注 -->',
  '<!-- /gallery -->'
].join('\n')

const THEME: ArticleTheme = {
  accent: '#4a7c59',
  fontFamily: 'system-ui',
  lineHeight: 2,
  letterSpacing: '0.02em',
  headingAlign: 'center',
  h2Num: '01',
  strongStyle: 'color'
}

describe('知乎画像（zhihu）', () => {
  const html = docToPlatformHtml(mdToDoc(SAMPLE_MD), RESOLVE, THEME, 'zhihu')

  it('零内联样式：无 style 属性、无 section/div 包裹', () => {
    expect(html).not.toContain('style=')
    expect(html).not.toContain('<section')
    expect(html).not.toContain('<div')
    // 手动字色 span 一并剥除（知乎净化器会剥，主动不给垃圾标签）
    expect(html).not.toContain('<span')
  })

  it('语义标签齐全：h1/h2/strong/blockquote/hr/table/img', () => {
    expect(html).toContain('<h1>大标题</h1>')
    expect(html).toContain('<strong>加粗强调</strong>')
    expect(html).toContain('<blockquote><p>引用内容一行</p></blockquote>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<table><thead><tr><th>列A</th>')
    expect(html).toContain('<td>甲</td>')
    expect((html.match(/<img /g) ?? []).length).toBe(2) // 图集逐张竖排
  })

  it('自动序号替换手写序号（01 → 01 格式化，避免双号）', () => {
    expect(html).toContain('<h2>01 手写序号小节</h2>')
    expect(html).not.toContain('0101')
  })

  it('纯序号装饰段跳过、图注挂整组末尾一次', () => {
    expect(html).not.toContain('<p>01</p>')
    expect((html.match(/图集注/g) ?? []).length).toBe(1)
  })
})

describe('保守内联画像（toutiao / baijiahao）', () => {
  it.each(['toutiao', 'baijiahao'] as const)('%s：保留颜色与引用左条，去卡片装饰', (p) => {
    const html = docToPlatformHtml(mdToDoc(SAMPLE_MD), RESOLVE, THEME, p)
    expect(html).toContain('<h2 style=')
    expect(html).toContain('border-left:4px solid #4a7c59') // 引用主题色左条
    expect(html).toContain('border-collapse:collapse') // 表格保留边框
    expect(html).not.toContain('border-radius:9999px') // 无胶囊装饰
    // 无背景卡：bodyText/背景色容器不出现
    expect(html).not.toContain('background-color:#')
    expect((html.match(/<img /g) ?? []).length).toBe(2)
    // 自动序号同样替换手写序号
    expect(html).toContain('01 手写序号小节')
    expect(html).not.toContain('0101')
  })

  it('加粗强调走主题色（strongStyle=color），手动字色优先', () => {
    const doc = mdToDoc('# T\n\n强调 **关键词** 与 <span style="color:#123456">**手色**</span>')
    const html = docToPlatformHtml(doc, RESOLVE, THEME, 'toutiao')
    expect(html).toContain('<strong style="color:#4a7c59">关键词</strong>')
    expect(html).toContain('<span style="color:#123456">手色</span>') // 手动色不被主题色覆盖
  })
})

describe('公众号路径（wechat）回归', () => {
  it('与 docToExportHtml 逐字节一致', () => {
    const doc = mdToDoc(SAMPLE_MD)
    expect(docToPlatformHtml(doc, RESOLVE, THEME, 'wechat')).toBe(docToExportHtml(doc, RESOLVE, THEME, false))
  })

  it('uiDark 透传', () => {
    const doc = mdToDoc('# T\n\n正文')
    expect(docToPlatformHtml(doc, RESOLVE, THEME, 'wechat', true)).toBe(docToExportHtml(doc, RESOLVE, THEME, true))
  })
})

describe('页壳与常量', () => {
  it('wrapPlatformPage：标题转义 + 720px 专栏宽 + img 宽度约束', () => {
    const page = wrapPlatformPage('<p>正文</p>', '标题<甲>')
    expect(page).toContain('<title>标题&lt;甲&gt;</title>')
    expect(page).toContain('max-width:720px')
    expect(page).toContain('<p>正文</p>')
    expect(page).toContain('img{max-width:100%') // 大图不撑爆预览/导出页视口
  })

  it('PLATFORM_LABELS 四平台齐全', () => {
    expect(Object.keys(PLATFORM_LABELS)).toEqual(['wechat', 'zhihu', 'toutiao', 'baijiahao'])
  })
})
