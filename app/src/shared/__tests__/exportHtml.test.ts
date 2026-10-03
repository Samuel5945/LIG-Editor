import { describe, expect, it } from 'vitest'
import { mdToDoc, type ArticleDoc } from '../markdown'
import { docToExportHtml, exportPageBg, extractTitle, wrapExportPage, wrapExportPageDayNight } from '../exportHtml'
import { DEFAULT_THEME, CATEGORY_THEMES, wechatDarkColor } from '../categoryThemes'
import type { ArticleTheme } from '../types'

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

  it('嵌套 attrs mark（tiptap 结构）同样渲染字号 span', () => {
    // 模拟编辑器 getJSON 产物直接喂导出（防御：doc 结构不依赖 mdToDoc 单一来源）
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '重点',
              marks: [{ type: 'textStyle', attrs: { color: null, bg: null, fontSize: 18 } }]
            }
          ]
        }
      ]
    } as unknown as ArticleDoc
    const html = docToExportHtml(doc, (src) => src)
    expect(html).toContain('<span style="font-size:18px">重点</span>')
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

  it('深浅兜底：历史脏数据（浅粉底 + 浅灰字）导出正文强制深字', () => {
    const dirty = {
      ...DEFAULT_THEME,
      bodyBg: '#fff0f0', // 浅粉底
      bodyText: '#cbd5e1' // 浅灰字（误配）
    }
    const html = docToExportHtml(mdToDoc('正文一行'), (src) => src, dirty)
    expect(html).toContain('background-color:#fff0f0')
    expect(html).toContain('color:#333') // 浅底 → 深字兜底
    expect(html).not.toContain('color:#cbd5e1')
  })

  it('背景卡双层包裹：内层 section 承载 background-color/圆角/内边距（外层被公众号剥掉时卡片仍在）', () => {
    const html = docToExportHtml(mdToDoc('正文一行'), (src) => src, {
      ...DEFAULT_THEME,
      bodyBg: '#eef3fb',
      bodyRadius: 14,
      bodyPadding: '20px 22px'
    })
    // 外层只挂排版继承，紧跟的内层挂视觉卡片（font-family 值含引号，用非标签字符匹配外层）
    expect(html).toMatch(/^<section style="font-size:[^<>]*font-family:/)
    expect(html).toContain('><section style="background-color:#eef3fb;border-radius:14px;padding:20px 22px;">')
    // 无卡片主题不输出内层卡片 section
    const plain = docToExportHtml(mdToDoc('正文一行'), (src) => src, DEFAULT_THEME)
    expect(plain).not.toContain('background-color:')
  })

  it('深浅兜底：深底配浅字保持（不误伤正常主题）', () => {
    const ok = {
      ...DEFAULT_THEME,
      bodyBg: '#0d1526',
      bodyText: '#cbd5e1'
    }
    const html = docToExportHtml(mdToDoc('正文一行'), (src) => src, ok)
    expect(html).toContain('color:#cbd5e1')
  })

  it('配色变体：uiDark 传参切换昼夜配色（夜间=公众号逻辑自动变深）', () => {
    const life = CATEGORY_THEMES['生活常识']
    const day = docToExportHtml(mdToDoc('正文'), (src) => src, life, false)
    const night = docToExportHtml(mdToDoc('正文'), (src) => src, life, true)
    expect(day).toContain('background-color:#fffaf2') // 日间基础色
    expect(day).toContain('color:#3d3a34')
    expect(night).toContain(`background-color:${wechatDarkColor('#fffaf2')}`) // 夜间算法变深深暖卡
    expect(night).toContain(`color:${wechatDarkColor('#3d3a34', 'text')}`) // 深字翻转为近白浅字
  })

  it('读者端自动昼夜：双份配色 + prefers-color-scheme 切换', () => {
    const life = CATEGORY_THEMES['生活常识']
    const doc = mdToDoc('正文')
    const day = docToExportHtml(doc, (src) => src, life, false)
    const night = docToExportHtml(doc, (src) => src, life, true)
    const page = wrapExportPageDayNight(day, night, '标题')
    expect(page).toContain('art-day')
    expect(page).toContain('art-night')
    expect(page).toContain('@media (prefers-color-scheme: dark)')
    expect(page).toContain('background-color:#fffaf2') // 日间份（内层卡片段）
    expect(page).toContain(`background-color:${wechatDarkColor('#fffaf2')}`) // 夜间份（算法变深）
    // 默认显示日间，深色系统切夜间
    expect(page).toContain('.art-day{display:block}')
    expect(page).toContain('.art-night{display:none}')
  })

  it('高亮加粗字色按高亮底色亮度：淡黄底恒为深字（深卡夜间版不出现淡黄底白字）', () => {
    const life = CATEGORY_THEMES['生活常识'] // strongStyle=highlight, strongBg=#fef3c7 淡黄
    const night = docToExportHtml(mdToDoc('**重点**内容'), (src) => src, life, true)
    // 夜间版卡片算法变深，但高亮底仍是淡黄 #fef3c7 → 字色必须深色
    expect(night).toContain('background:#fef3c7')
    expect(night).toContain('color:#333')
    expect(night).not.toContain('background:#fef3c7;padding:1px 6px;border-radius:4px;font-weight:bold;color:#f5f5f4')
  })

  it('无卡片主题夜间配色：导出输出默认深底 + 浅字（不再白底浅字）', () => {
    const design = CATEGORY_THEMES['设计鉴赏'] // 无 bodyBg
    const html = docToExportHtml(mdToDoc('正文一行'), (src) => src, design, true)
    expect(html).toContain('background-color:#1e2126')
    expect(html).toContain('color:#cbd5e1')
    // 日间保持无背景 + 深字
    const day = docToExportHtml(mdToDoc('正文一行'), (src) => src, design, false)
    expect(day).not.toContain('background-color:#1e2126')
    expect(day).toContain('color:#333')
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

  it('图片主题字段：形态/边框/外间距/图注对齐按主题生效（缺省回经典）', () => {
    // 缺省：常规限高 + 居中图注 + 20px 图距
    expect(html).toContain('max-width:100%;max-height:420px;border-radius:4px;')
    expect(html).toContain('margin:20px 0;text-align:center;')
    expect(html).toMatch(/margin-top:8px;text-align:center;/)
    // 通栏撑满 + 柔和投影 + 左对齐图注 + 32px 图距
    const themed: ArticleTheme = {
      ...CATEGORY_THEMES['科技数码'],
      imgStyle: 'fullwidth',
      imgFrame: 'shadow',
      imgGap: 32,
      captionAlign: 'left'
    }
    const out = docToExportHtml(mdToDoc(SAMPLE), (src) => src, themed)
    expect(out).toContain('display:block;width:100%;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.14);')
    expect(out).toContain('margin:32px 0;text-align:center;') // 图区外间距跟 imgGap
    expect(out).toContain('margin-top:8px;text-align:left;') // 图注左对齐
    // 半宽居中 + 细边框（深浅底各自取色）
    const half: ArticleTheme = { ...CATEGORY_THEMES['科技数码'], imgStyle: 'half', imgFrame: 'line' }
    const outHalf = docToExportHtml(mdToDoc(SAMPLE), (src) => src, half)
    expect(outHalf).toContain('width:50%;border-radius:8px;border:1px solid rgba(0,0,0,0.08);')
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
    expect(out).not.toContain('#0d9488')
  })

  it('非法色/缺省回默认青绿（与编辑器一致，不再变灰）', () => {
    for (const bad of ['red', '#12345g']) {
      const out = docToExportHtml(mdToDoc(MD), (src) => src, { ...DEFAULT_THEME, accent: bad })
      expect(out).toContain('border-left:4px solid #0d9488;padding-left:12px;')
      expect(out).toMatch(/<span style="[^"]*background:#0d9488/)
      expect(out).not.toContain('#d9d9d9')
    }
    const out = docToExportHtml(mdToDoc(MD), (src) => src)
    expect(out).toContain('border-left:4px solid #0d9488;padding-left:12px;')
  })

  it('引用条颜色跟主题 quoteBorder（引用描边色），未设跟强调色——日报彩条范式的落点', () => {
    const themed = docToExportHtml(mdToDoc(MD), (src) => src, {
      ...DEFAULT_THEME,
      accent: '#e53935',
      quoteBorder: '#bbf7d0'
    })
    // 左条用描边色而非强调色（之前 quoteBorder 只在 dashcard 生效，leftbar 一直吃不到）
    expect(themed).toContain('border-left:4px solid #bbf7d0;border-top-right-radius:8px;')
    expect(themed).not.toContain('border-left:4px solid #e53935;border-top-right-radius')
    const fallback = docToExportHtml(mdToDoc(MD), (src) => src, { ...DEFAULT_THEME, accent: '#e53935' })
    expect(fallback).toContain('border-left:4px solid #e53935;border-top-right-radius:8px;')
  })
})

describe('docToExportHtml 分类排版调性（爆款范式）', () => {
  const MD = '# 标题\n\n## 小节\n\n### 子节\n\n**重点**正文。\n\n> 引用一句。\n\n---\n'

  it('科技数码（科技绿）：不垫色卡 + 衬线正文 + 青绿下划线 H1 + ① 纯文字 H2 + 圆角引用卡', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, CATEGORY_THEMES['科技数码'])
    expect(out).not.toContain('background-color:') // 旧浅蓝白容器已摘，正文直接铺页面底
    expect(out).toContain('color:#333') // 深色正文
    expect(out).toContain("font-family:'Source Han Serif SC'") // 衬线正文（字体栈单引号化：双引号会截断 style 属性）
    expect(out).toContain('border-bottom:3px solid #0d9488') // H1 下划线跟强调色
    expect(/<h2[^>]*>/.exec(out)?.[0]).not.toContain('background') // H2 纯文字，不再是色块
    expect(out).toContain('>① 小节</h2>') // 小节序号用 ①
    expect(out).toContain('transform:rotate(45deg)') // H3 菱形小标记
    expect(out).toContain('border-radius:12px;background:rgba(13,148,136,0.1)') // 引用圆角淡青卡
    expect(out).toContain('<strong style="font-weight:bold;color:#0d9488;">重点</strong>') // 加粗只换色不高亮
    expect(out).toContain('border-top:2px solid #e8e8e8;width:64px') // 短居中的分隔线
  })

  it('科技数码 夜间：卡片落默认深底，标题与下划线仍保持科技绿（分档判色）', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, CATEGORY_THEMES['科技数码'], true)
    expect(out).toContain('background-color:#1e2126') // 无卡片主题 → 夜间默认深底
    expect(out).toContain('color:#cbd5e1') // 正文走夜间浅字
    const h2 = /<h2 style="([^"]*)">/.exec(out)?.[1] ?? ''
    expect(h2).toContain('color:#0d9488') // 品牌色不被换成 #eef2f7 灰白
    expect(h2).not.toContain('#eef2f7')
  })

  it('生活常识：暖白卡片 + 胶囊 H1 + 高亮加粗', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, CATEGORY_THEMES['生活常识'])
    expect(out).toContain('background-color:#fffaf2')
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
    expect(out).toContain('border-left:4px solid #0d9488;padding-left:12px;')
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

  it('外壳背景跟随昼夜配色变体', () => {
    // 缺省日间白底（向后兼容）
    expect(wrapExportPage('<p>x</p>', 't')).toContain('background:#fff')
    // 夜间深底
    expect(wrapExportPage('<p>x</p>', 't', '#1e2126')).toContain('background:#1e2126')
    // 自动昼夜版：日间白底 + 媒体查询切深底
    const auto = wrapExportPageDayNight('<p>d</p>', '<p>n</p>', 't', '#fff', '#1e2126')
    expect(auto).toContain('body{background:#fff}')
    expect(auto).toContain('prefers-color-scheme: dark')
    expect(auto).toContain('body{background:#1e2126!important}')
  })
})

describe('小节标题序号渲染（h2Num）', () => {
  const MD = '# 大标题\n\n## 第一节\n\n正文一\n\n## 第二节\n\n正文二\n'

  it('h2Num 01 → 小节按文档顺序带 01/02 前缀', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, { ...DEFAULT_THEME, h2Num: '01' })
    expect(out).toContain('>01 第一节<')
    expect(out).toContain('>02 第二节<')
  })

  it('h2Num 一、 → 中文序号（含十一以上进位）', () => {
    const md = Array.from({ length: 11 }, (_, i) => `## 第${i + 1}节\n\n正文`).join('\n')
    const out = docToExportHtml(mdToDoc(md), (src) => src, { ...DEFAULT_THEME, h2Num: '一、' })
    expect(out).toContain('>一、第1节<')
    expect(out).toContain('>十、第10节<')
    expect(out).toContain('>十一、第11节<')
  })

  it('h2Num ① → 圈号序号（①-⑳，超过 20 回落数字与编辑器 CSS fallback 同形）', () => {
    const md = Array.from({ length: 21 }, (_, i) => `## 第${i + 1}节\n\n正文`).join('\n')
    const out = docToExportHtml(mdToDoc(md), (src) => src, { ...DEFAULT_THEME, h2Num: '①' })
    expect(out).toContain('>① 第1节<')
    expect(out).toContain('>⑩ 第10节<')
    expect(out).toContain('>⑳ 第20节<')
    expect(out).toContain('>21 第21节<')
  })

  it('无 h2Num 不注入序号；居中标题 plain 小节文字居中', () => {
    const out = docToExportHtml(mdToDoc(MD), (src) => src, DEFAULT_THEME)
    expect(out).toContain('>第一节<')
    const centered = docToExportHtml(mdToDoc(MD), (src) => src, { ...DEFAULT_THEME, h2Style: 'plain' })
    expect(centered).toMatch(/<h2 style="[^"]*text-align:center[^"]*">第一节<\/h2>/)
  })
})

describe('dashcard 引用渲染（虚线边框提示卡）', () => {
  it('导出输出 1px dashed 边框 + 边框色', () => {
    const theme = { ...DEFAULT_THEME, quoteStyle: 'dashcard' as const, quoteBorder: '#bbf7d0' }
    const out = docToExportHtml(mdToDoc('> 提示卡内容'), (src) => src, theme)
    expect(out).toContain('border:1px dashed #bbf7d0')
    expect(out).toContain('border-radius:12px')
  })

  it('无边框色时回退强调色淡描边；非 dashcard 引用不受影响', () => {
    const out = docToExportHtml(mdToDoc('> 引用'), (src) => src, { ...DEFAULT_THEME, quoteStyle: 'dashcard' as const })
    expect(out).toMatch(/border:1px dashed rgba\(13,148,136,0\.55\)/)
    const leftbar = docToExportHtml(mdToDoc('> 引用'), (src) => src, DEFAULT_THEME)
    expect(leftbar).toContain('border-left:4px solid #0d9488')
    expect(leftbar).not.toContain('dashed')
  })
})


describe('小节序号：标题已自带序号时替换为主题序号格式', () => {
  it('手写「一、」+ 主题 1、 → 输出 1、2、（替换而非保留/叠加）', () => {
    const md = '# 标题\n\n## 一、开篇\n\n正文\n\n## 二、展开\n\n正文\n'
    const out = docToExportHtml(mdToDoc(md), (src) => src, { ...DEFAULT_THEME, h2Num: '1、' })
    expect(out).toContain('>1、开篇<')
    expect(out).toContain('>2、展开<')
    expect(out).not.toContain('一、开篇')
    expect(out).not.toContain('>1、一、开篇<')
  })

  it('无序号标题正常编号；已带「01 」标题替换为自动编号', () => {
    const md = '# 标题\n\n## 普通小节\n\n正文\n\n## 01 已编号\n\n正文\n'
    const out = docToExportHtml(mdToDoc(md), (src) => src, { ...DEFAULT_THEME, h2Num: '01' })
    expect(out).toContain('>01 普通小节<')
    expect(out).toContain('>02 已编号<') // 手写 01 被剥掉，注入自动序号 02
    expect(out).not.toContain('>01 01 已编号<')
  })
})

describe('小节序号：符号序号（①②）也替换为主题格式', () => {
  it('「① 标题」+ h2Num 01 → 输出 01/02（符号序号被替换，不再双重）', () => {
    const md = '# 标题\n\n## ① 遮罩系统重构\n\n正文\n\n## ② 字母定位器\n\n正文\n'
    const out = docToExportHtml(mdToDoc(md), (src) => src, { ...DEFAULT_THEME, h2Num: '01' })
    expect(out).toContain('>01 遮罩系统重构<')
    expect(out).toContain('>02 字母定位器<')
    expect(out).not.toContain('①')
  })

  it('「✨ 图标开头」标题不误判为序号，正常自动编号', () => {
    const md = '# 标题\n\n## ✨ 核心功能\n\n正文\n'
    const out = docToExportHtml(mdToDoc(md), (src) => src, { ...DEFAULT_THEME, h2Num: '01' })
    expect(out).toContain('>01 ✨ 核心功能<')
  })
})

describe('引用底色 / 引用字色 / 分隔线颜色 / H2 条色覆盖（补全的四个视觉字段）', () => {
  const MD = '# 标题\n\n> 引用一句话\n\n---\n\n## 小节标题\n\n正文一句\n'
  const withTheme = (t: Partial<typeof DEFAULT_THEME>) =>
    docToExportHtml(mdToDoc(MD), (src) => src, { ...DEFAULT_THEME, ...t })

  it('quoteStyle 各形态都吃 quoteBg，quoteText 覆盖引用文字色', () => {
    for (const quoteStyle of ['leftbar', 'card', 'quotes', 'dashcard'] as const) {
      const html = withTheme({ quoteStyle, quoteBg: '#fdf2f8', quoteText: '#831843' })
      expect(html, quoteStyle).toContain('background:#fdf2f8')
      expect(html, quoteStyle).toContain('color:#831843')
    }
  })

  it('不给 quoteBg 时保持原派生（card 用强调色淡底，不被覆盖逻辑改坏）', () => {
    const html = withTheme({ quoteStyle: 'card' })
    expect(html).not.toContain('#fdf2f8')
    expect(html).toMatch(/blockquote style=[^>]*background:rgba|background:rgb|background:#/)
  })

  it('hrColor 覆盖三种分隔线形态的线色', () => {
    for (const hrStyle of ['line', 'dot', 'long'] as const) {
      const html = withTheme({ hrStyle, hrColor: '#7c3aed' })
      expect(html, hrStyle).toContain('#7c3aed')
      expect(html, hrStyle).toContain(hrStyle === 'dot' ? 'dotted #7c3aed' : 'solid #7c3aed')
    }
  })

  it('h2Border 覆盖左竖条与下划线，block 色块不受影响', () => {
    expect(withTheme({ h2Style: 'leftbar', h2Border: '#0ea5e9' })).toContain('border-left:4px solid #0ea5e9')
    expect(withTheme({ h2Style: 'underline', h2Border: '#0ea5e9' })).toContain('border-bottom:2px solid #0ea5e9')
    const block = withTheme({ h2Style: 'block', h2Border: '#0ea5e9', h2Bg: '#111111' })
    expect(block).not.toContain('border-left:4px solid #0ea5e9')
  })

  it('非法色值不生效（回落派生色），不往导出里塞脏值', () => {
    const html = withTheme({ quoteStyle: 'card', quoteBg: '粉色', hrColor: 'nope', h2Border: '' })
    expect(html).not.toContain('粉色')
    expect(html).not.toContain('nope')
  })
})

describe('报头横幅与页面纸底（日报口径）', () => {
  it('h1Style banner → 通栏色块 + 按底色自动对比字色，缺省底跟强调色', () => {
    const md = ['# 把碑刻装进字库', '', '正文一段'].join('\n')
    const banner = docToExportHtml(mdToDoc(md), (src) => src, {
      ...DEFAULT_THEME,
      h1Style: 'banner',
      h1Bg: '#1a1a2e'
    })
    expect(banner).toContain('background:#1a1a2e')
    expect(banner).toContain('color:#ffffff')
    expect(banner).toContain('padding:24px 20px')
    // 缺省底色跟强调色
    const fallback = docToExportHtml(mdToDoc(md), (src) => src, { ...DEFAULT_THEME, h1Style: 'banner' })
    expect(fallback).toContain(`background:${DEFAULT_THEME.accent}`)
  })

  it('pageBg → 纸底-卡片三层包裹；无卡片时纸底单层；无纸底维持原双层', () => {
    const md = ['# 标题', '', '正文'].join('\n')
    const both = docToExportHtml(mdToDoc(md), (src) => src, {
      ...DEFAULT_THEME,
      pageBg: '#eceae4',
      bodyBg: '#f7f5f1'
    })
    // 根（排版继承）> 纸底 > 卡片
    expect(both.indexOf('background-color:#eceae4')).toBeGreaterThan(both.indexOf('font-size'))
    expect(both.indexOf('background-color:#f7f5f1')).toBeGreaterThan(both.indexOf('background-color:#eceae4'))
    const paperOnly = docToExportHtml(mdToDoc(md), (src) => src, { ...DEFAULT_THEME, pageBg: '#eceae4' })
    expect(paperOnly).toContain('background-color:#eceae4')
    expect(paperOnly).not.toContain('background-color:undefined')
    const plain = docToExportHtml(mdToDoc(md), (src) => src, DEFAULT_THEME)
    expect(plain).not.toContain('background-color:#eceae4')
  })

  it('exportPageBg 优先纸底，其次卡片色', () => {
    const t = { ...DEFAULT_THEME, pageBg: '#eceae4', bodyBg: '#f7f5f1' }
    expect(exportPageBg(t, false)).toBe('#eceae4')
    expect(exportPageBg({ ...DEFAULT_THEME, bodyBg: '#f7f5f1' }, false)).toBe('#f7f5f1')
    expect(exportPageBg(undefined, false)).toBe('#fff')
  })
})
