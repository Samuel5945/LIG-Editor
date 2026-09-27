/**
 * 多平台分发适配测试（M11）：同一篇 md 在不同平台画像下的形态契约——
 * - zhihu：零内联样式（无 style= 属性、无 section/div 包裹）、语义标签齐全、自动序号替换手写序号
 * - toutiao：语义化 + 仅 text-align:center（2026-09-27 发布页实测：对齐存活，其余内联视觉属性全剥离）
 * - baijiahao：保守内联（保留 color、引用左条、表格边框）、无背景卡/装饰——未实测，沿用分化前的 v1 画像
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

describe('头条画像（toutiao）：语义化 + 媒体居中', () => {
  // 依据 2026-09-27 mp.toutiao.com 发布页 26 条探针实测：只有 text-align 存活
  const html = docToPlatformHtml(mdToDoc(SAMPLE_MD), RESOLVE, THEME, 'toutiao')

  it('除 text-align 外零内联样式：字号/行高/段距/颜色/底色/边框/缩进一律不给', () => {
    expect(html.replace(/style="text-align:center"/g, '')).not.toContain('style=')
    expect(html).not.toContain('font-size') // 08 剥离
    expect(html).not.toContain('line-height') // 09 剥离
    expect(html).not.toContain('margin:') // 12 剥离
    expect(html).not.toContain('text-indent') // 14 剥离
    expect(html).not.toContain('border-left') // 17：竖线是平台原生的，给了也同形
    expect(html).not.toContain('border-collapse') // 21：边框是平台原生的
    expect(html).not.toContain('background') // 07 剥离
    expect(html).not.toContain('<div') // 24：外壳三项样式全被剥 = 空壳
    expect(html).not.toContain('<span') // 06 剥离 → 手动色主动剥掉，不留垃圾标签
    expect(html).toContain('红字') // 剥标签不剥文字
  })

  it('语义标签齐全且裸出：h1/h2/strong/blockquote/hr/table/img 由平台原生样式渲染', () => {
    expect(html).toContain('<h1>大标题</h1>')
    expect(html).toContain('<h2>01 手写序号小节</h2>') // 标题走平台样式表，不给 inline
    expect(html).toContain('<strong>加粗强调</strong>')
    expect(html).toContain('<blockquote><p>引用内容一行</p></blockquote>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<table><thead><tr><th>列A</th>')
    expect(html).not.toContain('0101')
    expect(html).not.toContain('<p>01</p>') // 纯序号装饰段跳过
  })

  it('图片与图注居中（10/11 text-align 存活，是头条侧唯一的排版杠杆）', () => {
    expect((html.match(/<p style="text-align:center"><img /g) ?? []).length).toBe(2)
    // 图注的字号色值都会被剥，居中是它与正文唯一的区分手段
    expect(html).toContain('<p style="text-align:center">图集注</p>')
    expect((html.match(/图集注/g) ?? []).length).toBe(1)
  })

  it('手动字色与主题色加粗都不给：strong 裸出', () => {
    const doc = mdToDoc('# T\n\n强调 **关键词** 与 <span style="color:#123456">**手色**</span>')
    const out = docToPlatformHtml(doc, RESOLVE, THEME, 'toutiao')
    expect(out).toContain('<strong>关键词</strong>')
    expect(out).not.toContain('#4a7c59') // 主题色加粗在头条是白给
    expect(out).not.toContain('#123456') // 手动色同样白给
    expect(out).toContain('<strong>手色</strong>')
  })
})

describe('百家号画像（baijiahao）：保守内联，未实测沿用 v1', () => {
  it('保留颜色与引用左条，去卡片装饰', () => {
    const html = docToPlatformHtml(mdToDoc(SAMPLE_MD), RESOLVE, THEME, 'baijiahao')
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
    const html = docToPlatformHtml(doc, RESOLVE, THEME, 'baijiahao')
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
