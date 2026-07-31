import { describe, it, expect } from 'vitest'
import { mdToDoc, docToMd, parseInline, inlineToMd, splitFigDesc } from '../markdown'

const SAMPLE = `# 荣耀换标：一个环的诞生

**荣耀**在 2026 年发布了新 LOGO，这一次是一个环。
业界哗然。

## 从直角到超椭圆

> 设计不是画一个好看的形状，
> 而是回答一个问题。
>
> —— 原研哉

![超椭圆五段序列](assets/03-rounded-corner.png)
<!-- caption: 从 n=∞ 的直角到 n=3 的超椭圆 -->
<!-- figure-source: figures/fig-1.html -->

---

### 尾声

一个环，**两百万**，三个月。
`

describe('md ↔ doc 往返', () => {
  it('样例文章往返无损', () => {
    expect(docToMd(mdToDoc(SAMPLE))).toBe(SAMPLE)
  })

  it('二次往返稳定（幂等）', () => {
    const once = docToMd(mdToDoc(SAMPLE))
    expect(docToMd(mdToDoc(once))).toBe(once)
  })

  it('图集轮播块往返无损', () => {
    const md = `前文。

<!-- gallery: swipe-h 3:4 -->
![图集 1](assets/import-1-1.png)
![图集 2](assets/import-1-2.png)
<!-- caption: 两张实拍 -->
<!-- /gallery -->

后文。
`
    expect(docToMd(mdToDoc(md))).toBe(md)
    const doc = mdToDoc(md)
    expect(doc.content[1]).toEqual({
      type: 'figureGallery',
      attrs: {
        images: [
          { alt: '图集 1', src: 'assets/import-1-1.png' },
          { alt: '图集 2', src: 'assets/import-1-2.png' }
        ],
        layout: 'swipe-h',
        frame: '3:4',
        caption: '两张实拍'
      }
    })
  })

  it('图集无取景比/无图注也往返无损', () => {
    const md = `<!-- gallery: stack-v -->
![a](assets/a.png)
![b](assets/b.png)
<!-- /gallery -->
`
    expect(docToMd(mdToDoc(md))).toBe(md)
  })
})

describe('mdToDoc 块级解析', () => {
  it('标题层级截断到 3', () => {
    const doc = mdToDoc('##### 深层标题')
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } })
  })

  it('图片带 caption 与 figure-source', () => {
    const doc = mdToDoc(
      '![alt文字](assets/a.png)\n<!-- caption: 图注 -->\n<!-- figure-source: figures/fig-2.html -->'
    )
    expect(doc.content[0]).toEqual({
      type: 'figureImage',
      attrs: { src: 'assets/a.png', alt: 'alt文字', caption: '图注', figureSource: 'figures/fig-2.html' }
    })
  })

  it('图片无注释也可独立成块', () => {
    const doc = mdToDoc('前文\n\n![x](a.png)\n\n后文')
    expect(doc.content.map((b) => b.type)).toEqual(['paragraph', 'figureImage', 'paragraph'])
  })

  it('fig-suggest 占位解析为独立块且往返无损', () => {
    const md = '段落一\n\n<!-- fig-suggest: 五代 LOGO 演变时间轴 -->\n\n段落二\n'
    const doc = mdToDoc(md)
    expect(doc.content[1]).toEqual({ type: 'figSuggest', attrs: { desc: '五代 LOGO 演变时间轴' } })
    expect(docToMd(doc)).toBe(md)
  })

  it('紧贴段落的 fig-suggest 不被并入段落', () => {
    const doc = mdToDoc('正文行\n<!-- fig-suggest: 配图 -->')
    expect(doc.content.map((b) => b.type)).toEqual(['paragraph', 'figSuggest'])
  })

  it('引用内空行分段', () => {
    const doc = mdToDoc('> 第一段\n>\n> 第二段')
    const quote = doc.content[0]
    expect(quote.type).toBe('blockquote')
    if (quote.type === 'blockquote') {
      expect(quote.content).toHaveLength(2)
    }
  })

  it('段内换行转 hardBreak', () => {
    const doc = mdToDoc('第一行\n第二行')
    const para = doc.content[0]
    if (para.type === 'paragraph') {
      expect(para.content).toEqual([
        { type: 'text', text: '第一行' },
        { type: 'hardBreak' },
        { type: 'text', text: '第二行' }
      ])
    } else {
      throw new Error('应为段落')
    }
  })
})

describe('行内加粗', () => {
  it('加粗解析与还原', () => {
    const inline = parseInline('前**中间**后')
    expect(inline).toEqual([
      { type: 'text', text: '前' },
      { type: 'text', text: '中间', marks: [{ type: 'bold' }] },
      { type: 'text', text: '后' }
    ])
    expect(inlineToMd(inline)).toBe('前**中间**后')
  })

  it('未闭合 ** 按普通文本保留', () => {
    const inline = parseInline('价格**99')
    expect(inlineToMd(inline)).toBe('价格**99')
  })
})

describe('splitFigDesc 拆分占位描述', () => {
  it('「画面描述 | 图注」按首个竖线拆两段', () => {
    expect(splitFigDesc('俯拍视角的环形 LOGO 悬浮在深色背景上 | 荣耀新环')).toEqual({
      prompt: '俯拍视角的环形 LOGO 悬浮在深色背景上',
      caption: '荣耀新环'
    })
  })

  it('兼容全角分隔符｜', () => {
    expect(splitFigDesc('时间轴长图｜演变史')).toEqual({ prompt: '时间轴长图', caption: '演变史' })
  })

  it('无分隔符的旧占位两者同源', () => {
    expect(splitFigDesc(' 五代 LOGO 演变时间轴 ')).toEqual({
      prompt: '五代 LOGO 演变时间轴',
      caption: '五代 LOGO 演变时间轴'
    })
  })

  it('只拆首个分隔符，后续竖线归图注', () => {
    expect(splitFigDesc('a | b | c')).toEqual({ prompt: 'a', caption: 'b | c' })
  })

  it('某一侧为空时回退到另一侧', () => {
    expect(splitFigDesc('只有描述 |')).toEqual({ prompt: '只有描述', caption: '只有描述' })
    expect(splitFigDesc('| 只有图注')).toEqual({ prompt: '只有图注', caption: '只有图注' })
  })
})
