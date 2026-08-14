import { describe, expect, it } from 'vitest'
import { mdToDoc } from '../markdown'
import { docToExportHtml, extractTitle, wrapExportPage } from '../exportHtml'
import { DEFAULT_THEME, CATEGORY_THEMES } from '../categoryThemes'

const TABLE_MD = `| 功能 | 免费版 |
| --- | --- |
| 模板 | 5 套 |
| 导出 | 无水印 |
`

describe('表格导出', () => {
  it('pipe 表格 → <table> 内联样式（表头 + 数据行）', () => {
    const html = docToExportHtml(mdToDoc(TABLE_MD), (src) => src)
    expect(html).toContain('<table style=')
    expect(html).toContain('<thead><tr><th style=')
    expect(html).toContain('<tbody>')
    expect(html).toContain('>5 套</td>')
    expect(html).not.toMatch(/class=/)
  })

  it('striped 主题输出斑马纹样式', () => {
    const striped = {
      ...DEFAULT_THEME,
      tableStyle: 'striped' as const,
      tableHeaderBg: '#f3f4f6',
      tableBorder: '#e0e0e0'
    }
    const html = docToExportHtml(mdToDoc(TABLE_MD), (src) => src, striped)
    expect(html).toContain('background:rgba(243,244,246,0.35)') // 斑马纹淡色
    expect(html).toContain('border:1px solid #e0e0e0')
  })

  it('plain 表格无边框样式', () => {
    const plain = { ...DEFAULT_THEME, tableStyle: 'plain' as const }
    const html = docToExportHtml(mdToDoc(TABLE_MD), (src) => src, plain)
    expect(html).toContain('border:0 none')
  })
})

describe('手动样式导出（span 字色/背景/字号）', () => {
  it('textStyle mark → 内联 span，bold 叠加时 strong 继承 span 色', () => {
    const md =
      '前<span style="color:#e63946;background-color:#fef3c7;font-size:18px">**重点**</span>后'
    const html = docToExportHtml(mdToDoc(md), (src) => src)
    expect(html).toContain('<span style="color:#e63946;background-color:#fef3c7;font-size:18px">')
    // 手动字色时 strong 不带主题色样式（继承 span 色），保留加粗标签
    expect(html).toContain('<strong>重点</strong>')
    expect(html).not.toContain('<strong style="')
  })

  it('仅字号：输出 font-size span', () => {
    const md = '<span style="font-size:20px">大标题感</span>'
    const html = docToExportHtml(mdToDoc(md), (src) => src)
    expect(html).toContain('<span style="font-size:20px">大标题感</span>')
  })

  it('正文默认字号 16px（主题 fontSize 生效）', () => {
    const html = docToExportHtml(mdToDoc('正文一行'), (src) => src, DEFAULT_THEME)
    expect(html).toContain('font-size:16px')
  })

  it('正文排列：indent 首行缩进 2em / flush 两端对齐 / center 居中', () => {
    const indent = docToExportHtml(mdToDoc('段落'), (src) => src, {
      ...DEFAULT_THEME,
      bodyAlign: 'indent'
    })
    expect(indent).toContain('text-indent:2em')
    expect(indent).toContain('text-align:justify')
    const flush = docToExportHtml(mdToDoc('段落'), (src) => src, {
      ...DEFAULT_THEME,
      bodyAlign: 'flush'
    })
    expect(flush).toContain('text-align:justify')
    expect(flush).not.toContain('text-indent')
    const center = docToExportHtml(mdToDoc('段落'), (src) => src, {
      ...DEFAULT_THEME,
      bodyAlign: 'center'
    })
    expect(center).toContain('text-align:center')
    // 默认不输出排列样式（保持左对齐现状）
    const plain = docToExportHtml(mdToDoc('段落'), (src) => src, DEFAULT_THEME)
    expect(plain).not.toContain('text-align:justify')
    expect(plain).not.toContain('text-indent')
  })

  it('标题字号缩放：headingFontSize 24 → H1 30 / H2 24 / H3 21', () => {
    const html = docToExportHtml(mdToDoc('# 大标题\n\n## 小节\n\n### 子节'), (src) => src, {
      ...DEFAULT_THEME,
      headingFontSize: 24
    })
    expect(html).toContain('font-size:30px') // H1 = 24+6
    expect(html).toContain('font-size:24px') // H2 = 24
    expect(html).toContain('font-size:21px') // H3 = 24-3
  })
})


const SAMPLE = `# 荣耀换标：一个环的诞生

**荣耀**在 2026 年发布了新 LOGO。

> 设计不是画一个好看的形状。

![超椭圆](assets/03.png)
<!-- caption: 从直角到超椭圆 -->
<!-- figure-source: figures/fig-1.html -->

<!-- fig-suggest: 这里想要一张对比图 -->

<!-- gallery: swipe-h 3:4 -->
![图集 1](assets/a.png)
![图集 2](assets/b.png)
<!-- caption: 五代演变 -->
<!-- /gallery -->

---
`

describe('docToExportHtml（M7 导出模板）', () => {
  const html = docToExportHtml(mdToDoc(SAMPLE), (src) => src)

  it('全部样式内联、零 class', () => {
    expect(html).not.toMatch(/class=/)
    expect(html).toContain('<section style="')
  })

  it('标题/加粗/引用/图注/分隔线齐全', () => {
    expect(html).toMatch(/<h1 style="[^"]*">荣耀换标：一个环的诞生<\/h1><div style="[^"]*"><\/div>/)
    expect(html).toContain('<strong style=')
    expect(html).toContain('<blockquote style=')
    expect(html).toContain('>从直角到超椭圆</p>')
    expect(html).toContain('<hr style=')
  })

  it('fig-suggest 占位卡与 figure-source 注释不进导出', () => {
    expect(html).not.toContain('fig-suggest')
    expect(html).not.toContain('figures/fig-1.html')
  })

  it('swipe-h 图集导出为公众号横滑容器', () => {
    expect(html).toContain('overflow-x:scroll')
    expect(html).toContain('左右滑动查看 2 张')
    expect(html).toContain('aspect-ratio:3 / 4')
  })

  it('resolveImg 决定图片 src 形态', () => {
    const dataHtml = docToExportHtml(mdToDoc(SAMPLE), () => 'data:image/png;base64,xx')
    expect(dataHtml).not.toContain('assets/03.png')
    expect(dataHtml).toContain('data:image/png;base64,xx')
  })

  it('grid 拼图导出为 inline-block 网格', () => {
    const md = '<!-- gallery: grid 1:1 -->\n![a](assets/a.png)\n![b](assets/b.png)\n![c](assets/c.png)\n<!-- /gallery -->\n'
    const grid = docToExportHtml(mdToDoc(md), (src) => src)
    expect(grid).toContain('display:inline-block;width:32.00%')
    expect(grid).toContain('aspect-ratio:1 / 1')
  })

  it('旧文档遗留的 stack-v 按拼图导出（选项已废弃）', () => {
    const md = '<!-- gallery: stack-v 16:9 -->\n![a](assets/a.png)\n![b](assets/b.png)\n<!-- /gallery -->\n'
    const out = docToExportHtml(mdToDoc(md), (src) => src)
    expect(out).toContain('display:inline-block;width:49.00%')
    expect(out).toContain('aspect-ratio:16 / 9')
    expect(out).not.toContain('width:100%')
  })

  it('文本转义防注入', () => {
    const md = '正文 <script>alert(1)</script> 结束\n'
    const out = docToExportHtml(mdToDoc(md), (src) => src)
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
})

describe('docToExportHtml 强调色', () => {
  const MD = '## 小标题\n\n### 小小标题\n\n**重点**正文。\n\n> 引用一句。\n'

  it('合法色着到 H2竖条/H3菱形/引用边线/加粗', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, { ...DEFAULT_THEME, accent: '#e53935' })
    expect(out).toContain('border-left:4px solid #e53935;padding-left:12px;') // H2 竖条
    expect(out).toMatch(/<span style="[^"]*background:#e53935/) // H3 菱形
    expect(out).toContain('border-left:4px solid #e53935;') // 引用边线
    expect(out).toContain('color:#e53935') // 加粗词
    expect(out).not.toContain('#4f8cff')
  })

  it('非法色/缺省回默认蓝（与编辑器一致，不再变灰）', () => {
    for (const bad of ['red', '#12345g']) {
      const out = docToExportHtml(mdToDoc(MD), (src) => src, { ...DEFAULT_THEME, accent: bad })
      expect(out).toContain('border-left:4px solid #4f8cff;padding-left:12px;')
      expect(out).toMatch(/<span style="[^"]*background:#4f8cff/)
      expect(out).not.toContain('#d9d9d9')
    }
    const out = docToExportHtml(mdToDoc(MD), (src) => src)
    expect(out).toContain('border-left:4px solid #4f8cff;padding-left:12px;')
  })
})

describe('docToExportHtml 分类排版调性（爆款范式）', () => {
  const MD = '# 标题\n\n## 小节\n\n### 子节\n\n**重点**正文。\n\n> 引用一句。\n\n---\n'

  it('科技数码：深色卡片 + 荧光青 + 色块 H2 + 等宽字体', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, CATEGORY_THEMES['科技数码'])
    expect(out).toContain('background:#0d1526') // 深色容器
    expect(out).toContain('color:#cbd5e1') // 浅色正文
    expect(out).toContain('border-radius:14px') // 容器圆角
    expect(out).toContain('border-bottom:3px solid #22d3ee') // H1 下划线
    expect(out).toContain('background:#22d3ee;border-radius:6px;padding:3px 14px') // H2 色块
    expect(out).toContain('background:rgba(34,211,238,0.1)') // 引用淡青卡片
    expect(out).toContain('font-family:"Cascadia Code"') // 等宽字体
  })

  it('生活常识：暖白卡片 + 胶囊 H1 + 高亮加粗', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, CATEGORY_THEMES['生活常识'])
    expect(out).toContain('background:#fffaf2')
    expect(out).toContain('border-radius:9999px;padding:6px 22px') // H1 胶囊
    expect(out).toContain('background:#fef3c7;padding:1px 6px') // 高亮加粗
  })

  it('哲学思考：纯文字 H2 + 通栏细线 + 引号引用', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, CATEGORY_THEMES['哲学思考'])
    const h2 = out.match(/<h2 style="([^"]*)">小节<\/h2>/)
    expect(h2?.[1]).not.toContain('border-left') // H2 无竖条
    expect(out).toContain('border-top:1px solid #e5e5e5;width:100%') // 通栏细线
    expect(out).toContain('❝') // 引号标记
    expect(out).toMatch(/<span style="display:none;"/) // H3 无前缀
  })

  it('默认调性输出经典排版（结构字段缺省回退）', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, DEFAULT_THEME)
    expect(out).not.toContain('background:#0d1526')
    expect(out).toContain('border-left:4px solid #4f8cff;padding-left:12px;')
  })
})

describe('wrapExportPage / extractTitle', () => {
  it('抽首个 H1 作页面标题；缺失回退工程名', () => {
    expect(extractTitle(mdToDoc(SAMPLE), '兜底')).toBe('荣耀换标：一个环的诞生')
    expect(extractTitle(mdToDoc('无标题正文\n'), '兜底')).toBe('兜底')
  })

  it('外壳是独立完整页面', () => {
    const page = wrapExportPage('<p>x</p>', '标题<注入>')
    expect(page).toContain('<!DOCTYPE html>')
    expect(page).toContain('<title>标题&lt;注入&gt;</title>')
    expect(page).toContain('max-width:677px')
  })
})
