/**
 * 封面模板 HTML 生成测试（纯函数，无 electron）。
 * 钉住的都是会直接毁掉成图的点：
 * - 画布尺寸必须锁死在两种比例上（离屏渲染按此截图，尺寸错了整张封面就废）
 * - 标题来自模型/用户输入，必须转义，否则一个 < 就能破版式
 * - 底图路径必须是相对 covers/ 的 `../` 前缀，错了就是白底
 * - 非法强调色要有兜底，不能把坏色值写进 HTML
 */
import { describe, expect, it } from 'vitest'
import {
  COVER_SQUARE,
  COVER_TEMPLATES,
  COVER_WIDE,
  coverHtml,
  escapeHtml,
  shade,
  titleFontSize
} from '../coverTemplates'

const base = { template: 'plain', size: 'wide' as const, title: '测试标题', accent: '#336699' }

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
    const withBg = coverHtml({ ...base, template: 'band', bgSrc: 'assets/cover-bg.png' })
    expect(withBg).toContain("url('../assets/cover-bg.png')")
    const noBg = coverHtml({ ...base, template: 'band' })
    expect(noBg).not.toContain('url(')
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
    const html = coverHtml({ ...base, template: 'ghost-template' })
    expect(html).toContain('测试标题')
  })

  it('非法强调色退回默认青，坏色值不会写进 HTML', () => {
    const html = coverHtml({ ...base, accent: 'rgb(1,2,3)' })
    expect(html).toContain('#0d9488')
    expect(html).not.toContain('rgb(1,2,3)')
  })

  it('品牌行可选：不传就不渲染', () => {
    expect(coverHtml({ ...base, brand: '科技数码' })).toContain('科技数码')
    expect(coverHtml(base)).not.toContain('class="brand"')
  })
})

describe('标题字号阶梯', () => {
  it('字数越多字号越小（不增），且方图比头图更大', () => {
    const lens = [4, 12, 13, 18, 19, 26, 27, 40]
    const wide = lens.map((n) => titleFontSize(n, 'wide'))
    const square = lens.map((n) => titleFontSize(n, 'square'))
    for (let i = 1; i < lens.length; i++) {
      expect(wide[i]).toBeLessThanOrEqual(wide[i - 1])
      expect(square[i]).toBeLessThanOrEqual(square[i - 1])
    }
    lens.forEach((n) => expect(titleFontSize(n, 'square')).toBeGreaterThan(titleFontSize(n, 'wide')))
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
