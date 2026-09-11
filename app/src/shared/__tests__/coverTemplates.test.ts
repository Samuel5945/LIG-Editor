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
  coverHtml,
  escapeHtml,
  shade,
  splitTitleLines,
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

  it('底图按 covers/ 下的相对路径拼接；无底图时不引用任何图片', () => {
    for (const t of COVER_TEMPLATES.filter((x) => x.id !== 'editorial')) {
      const withBg = coverHtml({ ...base, template: t.id, bgSrc: 'assets/cover-bg.png' })
      expect(withBg).toContain("url('../assets/cover-bg.png')")
      expect(coverHtml({ ...base, template: t.id })).not.toContain('url(')
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

  it('品牌行可选：不传就不渲染', () => {
    expect(coverHtml({ ...base, brand: '科技数码' })).toContain('科技数码')
    expect(coverHtml(base)).not.toContain('class="brand"')
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
