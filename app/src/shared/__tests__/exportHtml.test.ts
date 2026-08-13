import { describe, expect, it } from 'vitest'
import { mdToDoc } from '../markdown'
import { docToExportHtml, extractTitle, wrapExportPage } from '../exportHtml'
import { DEFAULT_THEME } from '../categoryThemes'

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
