/**
 * 封面模板 HTML 生成测试（纯函数，无 electron）。
 * 钉住的都是会直接毁掉成图的点：
 * - 画布尺寸必须锁死在两种比例上（离屏渲染按此截图，尺寸错了整张封面就废）
 * - 标题来自模型/用户输入，必须转义，否则一个 < 就能破版式
 * - **字号受列宽硬约束**：最长一行 × 字号 不得超过文字列宽，否则文字溢出画布
 * - **文字必须锁在左区**（右侧方形区留给可单独裁成 1:1 缩略图的画面）
 * - 底图路径必须是相对 covers/ 的 `../` 前缀，错了就是白底
 */
import { describe, expect, it } from 'vitest'
import {
  COVER_SQUARE,
  COVER_TEMPLATES,
  COVER_WIDE,
  DEFAULT_FOCAL,
  NO_BG_TEMPLATES,
  coverHtml,
  escapeHtml,
  shade,
  splitTitleLines,
  squareCropRect,
  titleFontSize
} from '../coverTemplates'

const base = { template: 'split', size: 'wide' as const, title: '测试标题', accent: '#336699' }
/** 头图文字可用列宽 = (1175 - 500) - 2*56 = 563 */
const WIDE_COL = COVER_WIDE.w - COVER_WIDE.h - 112
/** 方图无右区，列宽 = 800 - 2*56 = 688 */
const SQUARE_COL = COVER_SQUARE.w - 112

describe('封面模板 HTML', () => {
  it('两种比例都把画布尺寸锁死', () => {
    const wide = coverHtml({ ...base, size: 'wide' })
    expect(wide).toContain(`width: ${COVER_WIDE.w}px`)
    expect(wide).toContain(`height: ${COVER_WIDE.h}px`)
    const square = coverHtml({ ...base, size: 'square' })
    expect(square).toContain(`width: ${COVER_SQUARE.w}px`)
    expect(square).toContain(`height: ${COVER_SQUARE.h}px`)
  })

  it('标题与副标题经 HTML 转义，注入标签不成立', () => {
    const html = coverHtml({ ...base, title: '<script>alert(1)</script>', subtitle: 'a & "b"' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; &quot;b&quot;')
  })

  it('底图按 covers/ 下的相对路径拼接；无底图时不引用底图路径', () => {
    for (const t of COVER_TEMPLATES.filter((x) => !NO_BG_TEMPLATES.includes(x.id))) {
      const withBg = coverHtml({ ...base, template: t.id, bgSrc: 'assets/cover-bg.png' })
      expect(withBg).toContain("url('../assets/cover-bg.png')")
      // 注意不能断言不含 'url('：aurora 的噪点是内联 SVG data-uri 装饰，与底图无关
      expect(coverHtml({ ...base, template: t.id })).not.toContain("url('../")
    }
  })

  it('杂志留白是纯文字版式：给了底图也绝不引用（深色字压照片会崩对比度）', () => {
    const html = coverHtml({ ...base, template: 'editorial', bgSrc: 'assets/cover-bg.png' })
    expect(html).not.toContain('url(')
    expect(html).toContain('测试标题')
  })

  it('每个模板在两种比例下都能出图（不抛错且尺寸正确）', () => {
    for (const t of COVER_TEMPLATES) {
      for (const size of ['wide', 'square'] as const) {
        const html = coverHtml({ ...base, template: t.id, size })
        expect(html).toContain(`width: ${size === 'wide' ? COVER_WIDE.w : COVER_SQUARE.w}px`)
        expect(html.length).toBeGreaterThan(400)
      }
    }
  })

  it('未声明的模板 id 退回大字版式而不是抛错', () => {
    expect(coverHtml({ ...base, template: 'ghost-template' })).toContain('测试标题')
  })

  it('旧「底部色带」id 仍可渲染（老工程重渲染不报错）', () => {
    expect(coverHtml({ ...base, template: 'band' })).toContain('测试标题')
  })

  it('非法强调色不写进 HTML，输出仍是合法十六进制色', () => {
    const html = coverHtml({ ...base, accent: 'rgb(1,2,3)' })
    expect(html).not.toContain('rgb(1,2,3)')
    expect(html).toMatch(/#[0-9a-fA-F]{6}/)
  })

  it('分类名只出现在文字块顶部，底部不再放品牌行（杂志那两套此前同一句写了两遍）', () => {
    for (const tpl of COVER_TEMPLATES) {
      const html = coverHtml({ ...base, template: tpl.id, brand: '哲学思考' })
      expect(html).toContain('哲学思考')
      expect(html.split('哲学思考').length - 1).toBe(1)
      expect(html).not.toContain('bottom:30px')
      expect(html).not.toContain('class="brand"')
    }
  })

  it('品牌行可选：不传就不渲染', () => {
    expect(coverHtml({ ...base, brand: '科技数码' })).toContain('科技数码')
    expect(coverHtml(base)).not.toContain('class="brand"')
  })

  it('超采样只套一层 transform：画布翻倍，版式坐标仍按 1× 写', () => {
    const html = coverHtml({ ...base, scale: 2 })
    expect(html).toContain(`width: ${COVER_WIDE.w * 2}px`)
    expect(html).toContain(`height: ${COVER_WIDE.h * 2}px`)
    expect(html).toContain(`width:${COVER_WIDE.w}px;height:${COVER_WIDE.h}px;transform:scale(2);transform-origin:0 0`)
    // 不套 scale 时不该出现这层壳
    expect(coverHtml(base)).not.toContain('transform:scale')
  })

  it('文字块锁左区：宽度不超过「画布宽 − 画布高」', () => {
    const html = coverHtml({ ...base, title: '八个字的标题测试' })
    const m = /width:(\d+)px;display:flex;flex-direction:column/.exec(html)
    expect(m).not.toBeNull()
    expect(Number(m?.[1])).toBe(COVER_WIDE.w - COVER_WIDE.h)
  })
})

describe('标题折行与字号', () => {
  it('半角/全角 | 都按手动分行处理', () => {
    expect(splitTitleLines('好主题|别死在封面上')).toEqual(['好主题', '别死在封面上'])
    expect(splitTitleLines('好主题｜别死在封面上')).toEqual(['好主题', '别死在封面上'])
  })

  it('没写分隔符时按标点贪心折行，行首不留孤立标点', () => {
    const lines = splitTitleLines('手机主题换到飞起，电脑桌面却丑了20年？这个工具终于让它能换皮肤了')
    expect(lines.length).toBeGreaterThan(1)
    lines.forEach((l) => {
      expect(l.length).toBeLessThanOrEqual(9)
      expect(/^[，。！？；：、]/.test(l)).toBe(false)
    })
    // 折完拼回去不该丢字
    expect(lines.join('')).toBe('手机主题换到飞起，电脑桌面却丑了20年？这个工具终于让它能换皮肤了')
  })

  it('空标题退回「未命名」而不是产出空白封面', () => {
    expect(splitTitleLines('   ')).toEqual(['未命名'])
  })

  it('字号受列宽硬约束：可达行宽内（≤9 字）永不超出文字列', () => {
    // splitTitleLines 最多产出 9 字一行，超出部分由它折行，故只需断言可达范围
    for (const len of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(titleFontSize(len, 1, 'wide') * len).toBeLessThanOrEqual(WIDE_COL)
      expect(titleFontSize(len, 1, 'square') * len).toBeLessThanOrEqual(SQUARE_COL)
    }
  })

  it('折行产出的每一行都落在列宽约束内', () => {
    const long = '手机主题换到飞起，电脑桌面却丑了20年？这个工具终于让它能换皮肤了'
    const lines = splitTitleLines(long)
    const fs = titleFontSize(Math.max(...lines.map((l) => l.length)), lines.length, 'wide')
    expect(Math.max(...lines.map((l) => l.length)) * fs).toBeLessThanOrEqual(WIDE_COL)
  })

  it('行短字号大、行长字号小；行数多再收一档', () => {
    expect(titleFontSize(4, 1, 'wide')).toBeGreaterThan(titleFontSize(8, 1, 'wide'))
    expect(titleFontSize(8, 1, 'wide')).toBeGreaterThan(titleFontSize(8, 4, 'wide'))
  })

  it('方图字号大于头图（同字数下画面更高，字可以更大）', () => {
    for (const len of [4, 6, 8]) {
      expect(titleFontSize(len, 1, 'square')).toBeGreaterThan(titleFontSize(len, 1, 'wide'))
    }
  })

  it('字号有下限，极长标题也不会缩到不可读', () => {
    expect(titleFontSize(40, 8, 'wide')).toBeGreaterThanOrEqual(34)
  })
})

describe('方图裁剪：1:1 只能是主图的一段', () => {
  it('满高取段：focal=0 取最左、1 取最右、0.5 居中', () => {
    expect(squareCropRect(2350, 1000, 0)).toEqual({ left: 0, top: 0, width: 1000, height: 1000 })
    expect(squareCropRect(2350, 1000, 1)).toEqual({ left: 1350, top: 0, width: 1000, height: 1000 })
    expect(squareCropRect(2350, 1000, 0.5)).toEqual({ left: 675, top: 0, width: 1000, height: 1000 })
  })

  it('focal 越界夹回 0-1，NaN 回落到缺省取到最右', () => {
    expect(squareCropRect(2350, 1000, 5)).toEqual(squareCropRect(2350, 1000, 1))
    expect(squareCropRect(2350, 1000, -3)).toEqual(squareCropRect(2350, 1000, 0))
    expect(squareCropRect(2350, 1000, NaN)).toEqual(squareCropRect(2350, 1000, 1))
  })

  it('非横图画布不放大：取满宽、垂直居中那一段', () => {
    expect(squareCropRect(800, 1200, 0.5)).toEqual({ left: 0, top: 200, width: 800, height: 800 })
  })
})

describe('磨砂面板与装饰开关', () => {
  it('面板只在「有底图 + 显式 frosted」时铺；无底图或 panel=none 一律不铺', () => {
    expect(coverHtml({ ...base, bgSrc: 'assets/cover-bg.png', panel: 'frosted' })).toContain('backdrop-filter')
    expect(coverHtml({ ...base, panel: 'frosted' })).not.toContain('backdrop-filter')
    expect(coverHtml({ ...base, bgSrc: 'assets/cover-bg.png', panel: 'none' })).not.toContain('backdrop-filter')
  })

  it('magazine 有底图时磨砂面板是默认件（不传 panel 也铺）', () => {
    expect(coverHtml({ ...base, template: 'magazine', bgSrc: 'assets/cover-bg.png' })).toContain('backdrop-filter')
  })

  it('aurora 有底图时字色恒浅：亮底图判出的深字压在暗部上就是黑压黑', () => {
    const onBrightPhoto = coverHtml({ ...base, template: 'aurora', bgSrc: 'assets/cover-bg.png', lightText: false })
    expect(onBrightPhoto).toContain('#f4f6fb')
    expect(onBrightPhoto).not.toContain('#1f2937')
  })

  it('aurora 的暗部渐变要盖满文字列（到 45% 处仍 ≥0.78），否则白字压在亮底上对比不够', () => {
    const html = coverHtml({ ...base, template: 'aurora', bgSrc: 'assets/cover-bg.png' })
    expect(html).toContain('rgba(10,14,23,0.9) 0%')
    expect(html).toContain('rgba(10,14,23,0.78) 45%')
    expect(html).toContain('rgba(10,14,23,0.35) 70%')
  })

  it('装饰横线不越进方图裁剪区：1:1 从最右裁满高一段，线横贯过去缩略图里就凭空多一条', () => {
    // 杂志刊眉双线收在文字列（1175−500−2×56 = 563），页脚装饰同列右对齐
    const mag = coverHtml({ ...base, template: 'magazine' })
    expect(mag).toContain('left:56px;width:563px;top:26px')
    expect(mag).not.toContain('right:56px;top:26px')
    expect(mag).not.toContain('right:56px;bottom:36px')
    // 极光地平线画到文字列右界（1175−500 = 675）后淡出
    const au = coverHtml({ ...base, template: 'aurora' })
    expect(au).toContain('left:0;width:675px;top:76%')
    expect(au).not.toContain('left:0;right:0;top:76%')
  })

  it('大字版式是纯排印：传了底图也不引用照片，且排版与左文右图不同（底部对齐 + 无标记色条）', () => {
    const plain = coverHtml({ ...base, template: 'plain', bgSrc: 'assets/cover-bg.png', lightText: false })
    expect(plain).not.toContain("url('../")
    expect(plain).toContain('justify-content:center')
    expect(plain).not.toContain('width:88px;height:8px')
    expect(plain).not.toContain('backdrop-filter')
    const split = coverHtml({ ...base, template: 'split', bgSrc: 'assets/cover-bg.png' })
    expect(split).toContain("url('../")
    expect(split).toContain('width:88px;height:8px')
  })

  it('短标题时大字版式比左列字大一档；两者都守「字号 × 行宽 ≤ 列宽」', () => {
    const posterCol = COVER_WIDE.w - COVER_WIDE.h - 56
    const leftCol = titleFontSize(4, 1, 'wide')
    const poster = titleFontSize(4, 1, 'wide', { colW: posterCol, cap: 150 })
    expect(poster).toBeGreaterThan(leftCol)
    expect(poster * 4).toBeLessThanOrEqual(posterCol)
  })

  it('六套版式各有排版，不再共用同一个左列文字块', () => {
    const of = (template: string) => coverHtml({ ...base, template })
    const split = of('split')
    // 左文右图：贴左 + 色条，是其余套式的基准
    expect(split).toContain('width:88px;height:8px')
    expect(split).not.toContain('border-left')
    expect(split).not.toContain('text-align:center')
    // 左侧竖栏：标题等高竖线勾边，不放色条
    const left = of('left')
    expect(left).toContain('border-left:3px solid')
    expect(left).not.toContain('width:88px;height:8px')
    // 氛围渐变：块内水平居中，标记与品牌行同中轴
    const aurora = of('aurora')
    expect(aurora).toContain('text-align:center')
    expect(aurora).toContain('width:10px;height:10px')
    // 大字版式：自动挑断行的紧行高满格排字
    expect(of('plain')).toContain('line-height:1.06')
    // 杂志大字与杂志留白各有各的 kicker 语言
    expect(of('magazine')).toContain('letter-spacing:6px')
    expect(of('editorial')).toContain('letter-spacing:4px')
  })

  it('纯排印名单单源：editorial 与 plain 都不吃底图', () => {
    expect(NO_BG_TEMPLATES).toEqual(['editorial', 'plain'])
  })

  it('大字版式：文字盒右界钉在方图起点，且自动挑断行把字放到最大', () => {
    const long = '自媒体推广的5个实操动作，把流量从0推到10万粉'
    const plain = coverHtml({ ...base, template: 'plain', title: long })
    // 675 = 1175 − 500：越过这条线的像素会被默认取景裁进方图
    expect(plain).toContain(`left:0;top:0;bottom:0;width:${COVER_WIDE.w - COVER_WIDE.h}px`)
    const fs = Number(/<h1 style="font-size:(\d+)px/.exec(plain)?.[1] ?? 0)
    // 照照片版式「每行 ≤9 字」排只有 68px；自动挑到 6 字一行才能吃满这格
    expect(fs).toBeGreaterThanOrEqual(85)
    // 真不变量是「字的右边缘不越方图起点」：行尾悬挂的标点可以超出列宽，但不能超出文字盒
    const widest = Math.max(...[...plain.matchAll(/class="line">([^<]*)</g)].map((m) => m[1].length))
    expect(56 + fs * widest).toBeLessThanOrEqual(COVER_WIDE.w - COVER_WIDE.h)
  })

  it('decor=false 摘掉光晕/圆环，标题与底色不受影响', () => {
    expect(coverHtml({ ...base, template: 'aurora' })).toContain('radial-gradient')
    const off = coverHtml({ ...base, template: 'aurora', decor: false })
    expect(off).not.toContain('radial-gradient')
    expect(off).toContain('测试标题')
  })
})

describe('色彩工具', () => {
  it('shade 加深/减淡到边界，amount=0 保持原色', () => {
    expect(shade('#ffffff', -1)).toBe('#000000')
    expect(shade('#000000', 1)).toBe('#ffffff')
    expect(shade('#336699', 0)).toBe('#336699')
  })

  it('escapeHtml 覆盖五个字符', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})
