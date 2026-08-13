import { describe, expect, it } from 'vitest'
import { parseThemeFromHtml, trimHtmlForTheme } from '../themeParse'
import { contrastText, isDarkColor, CATEGORY_THEMES } from '../categoryThemes'

describe('parseThemeFromHtml（公众号 HTML → 排版调性）', () => {
  const HTML = `<!DOCTYPE html><html><head><title>科技美学：深空黑</title></head>
<body style="margin:0;background:#fff;">
<section style="background:#0d1526;color:#cbd5e1;border-radius:14px;padding:20px;font-family:'Cascadia Code',monospace;">
<h1 style="text-align:left;border-bottom:3px solid #22d3ee;padding-bottom:10px;">大标题</h1>
<h2 style="background:#22d3ee;border-radius:6px;padding:3px 14px;color:#0d1526;">小节</h2>
<p style="font-size:15px;line-height:1.95;letter-spacing:0.01em;margin:14px 0;color:#cbd5e1;"><strong style="color:#22d3ee;">重点</strong>正文</p>
<blockquote style="background:rgba(34,211,238,0.1);border-radius:12px;padding:14px 16px;">引用一句</blockquote>
<hr style="border-top:2px solid rgba(255,255,255,0.2);width:64px;">
<img src="x.png" style="border-radius:10px;">
</section>
</body></html>`

  it('提取背景卡片 / 强调色 / 标题装饰 / 引用 / 分隔线 / 圆角', () => {
    const { name, theme, summary } = parseThemeFromHtml(HTML)
    expect(name).toBe('科技美学：深空黑')
    expect(theme.bodyBg).toBe('#0d1526')
    expect(theme.bodyText).toBe('#cbd5e1')
    expect(theme.accent).toBe('#22d3ee')
    expect(theme.h1Style).toBe('underline')
    expect(theme.h2Style).toBe('block')
    expect(theme.quoteStyle).toBe('card')
    expect(theme.hrStyle).toBe('line')
    expect(theme.strongStyle).toBe('color')
    expect(theme.imgRadius).toBe(10)
    expect(theme.lineHeight).toBeCloseTo(1.95)
    expect(theme.headingAlign).toBe('left')
    expect(summary.length).toBeGreaterThan(0)
  })

  it('白底文章不产生背景卡片；加粗底色识别为高亮', () => {
    const plain = `<html><body>
<section style="color:#333;">
<h1 style="text-align:center;">标题</h1>
<h2 style="border-left:4px solid #e53935;padding-left:12px;">小节</h2>
<p style="line-height:2.13;color:#333;"><strong style="background:#fef3c7;">重点</strong></p>
<blockquote style="border-left:4px solid #e53935;background:#f7f7f7;">❝ 引用</blockquote>
</section></body></html>`
    const { theme } = parseThemeFromHtml(plain)
    expect(theme.bodyBg).toBeUndefined()
    expect(theme.accent).toBe('#e53935')
    expect(theme.h2Style).toBe('leftbar')
    expect(theme.strongStyle).toBe('highlight')
    expect(theme.strongBg).toBe('#fef3c7')
    expect(theme.quoteStyle).toBe('quotes')
    expect(theme.headingAlign).toBe('center')
  })

  it('空/无样式 HTML 回落默认调性', () => {
    const { theme } = parseThemeFromHtml('<html><body><p>只有文字</p></body></html>')
    expect(theme.bodyBg).toBeUndefined()
    expect(theme.accent).toBe('#4f8cff')
    expect(theme.h1Style).toBe('bar')
  })
})

describe('contrastText（色块前景自适应）', () => {
  it('亮底深字、暗底白字', () => {
    expect(contrastText('#f59e0b')).toBe('#2b2b2b') // 橙：白字看不清 → 深字
    expect(contrastText('#22d3ee')).toBe('#2b2b2b') // 荧光青 → 深字
    expect(contrastText('#2f7cf6')).toBe('#ffffff') // 深蓝 → 白字
    expect(contrastText('#d64550')).toBe('#ffffff') // 暖红 → 白字
    expect(contrastText('not-a-color')).toBe('#ffffff') // 非法回白
  })

  it('生活常识色块标题不再白字压橙底（对比度修复）', () => {
    const life = CATEGORY_THEMES['生活常识']
    expect(contrastText(life.accent)).toBe('#2b2b2b')
  })
})

describe('isDarkColor（背景亮度判断：暖白浅卡 ≠ 深色卡）', () => {
  it('深色卡判深、暖白/白底判浅', () => {
    expect(isDarkColor('#0d1526')).toBe(true) // 科技深藏蓝
    expect(isDarkColor('#fffaf2')).toBe(false) // 生活暖白
    expect(isDarkColor('#fff0f0')).toBe(false) // 导入的 Cherry Studio 浅红卡
    expect(isDarkColor('#f59e0b')).toBe(false) // 橙
    expect(isDarkColor('')).toBe(false) // 非法回浅
  })

  it('生活常识浅卡引用不再用浅灰字（dark 判断修复）', () => {
    // 导出端：生活常识卡片是暖白 → dark=false → 引用深字
    expect(CATEGORY_THEMES['生活常识'].bodyBg).toBeTruthy()
    expect(isDarkColor(CATEGORY_THEMES['生活常识'].bodyBg as string)).toBe(false)
  })
})

describe('trimHtmlForTheme（公众号 3MB 页面裁剪）', () => {
  it('提取 id=js_content 正文容器，砍掉 script/style/外围噪音', () => {
    const big = `<!DOCTYPE html><html><head><title>演示</title>
<style>.x{color:red}</style></head><body>
<script>window.__xxx = '巨大脚本'</script>
<div id="js_content" class="rich_media_content"><section style="background:#fff0f0;">
<h1 style="border-bottom:3px solid #ff5f5f;">标题</h1><p style="color:#333;">正文</p>
</section></div>
<script>window.__more = '尾部脚本'</script></body></html>`
    const trimmed = trimHtmlForTheme(big)
    expect(trimmed).toContain('js_content')
    expect(trimmed).toContain('border-bottom:3px solid #ff5f5f')
    expect(trimmed).not.toContain('<script')
    expect(trimmed).not.toContain('<style')
    expect(trimmed.length).toBeLessThan(big.length)
  })

  it('非公众号页面：去掉 script/style/注释', () => {
    const html = `<html><head><style>body{margin:0}</style></head>
<body><!-- 注释 --><p style="color:#333;">正文</p><script>var a=1</script></body></html>`
    const trimmed = trimHtmlForTheme(html)
    expect(trimmed).toContain('color:#333')
    expect(trimmed).not.toContain('<style')
    expect(trimmed).not.toContain('<script')
    expect(trimmed).not.toContain('<!--')
  })

  it('js_content 内含嵌套 div 也能配对闭合', () => {
    const html = `<div id="js_content"><section><div><p style="color:#111;">a</p></div></section></div><script>x</script>`
    const trimmed = trimHtmlForTheme(html)
    expect(trimmed).toContain('color:#111')
    expect(trimmed).toContain('</div>')
    expect(trimmed).not.toContain('<script')
  })
})
