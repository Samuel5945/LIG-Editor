import { describe, expect, it } from 'vitest'
import { parseThemeFromHtml, trimHtmlForTheme } from '../themeParse'
import { contrastText, isDarkColor, resolveEditorTheme, wechatDarkColor, CATEGORY_THEMES, DEFAULT_THEME } from '../categoryThemes'

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
    expect(theme.accent).toBe('#0d9488')
    expect(theme.h1Style).toBe('bar')
  })

  it('深浅搭配校验：浅底配浅字 → 正文色修正为深字（防跨元素误配看不清）', () => {
    // 原文坑：浅粉卡片 #fff0f0 + 深色卡片上常见的浅灰字 #cbd5e1 → 浅底浅字
    const dirty = `<html><body>
<section style="background:#fff0f0;">
<p style="color:#cbd5e1;">浅粉底上的浅灰字</p>
<p style="color:#cbd5e1;">第二行</p>
</section></body></html>`
    const { theme } = parseThemeFromHtml(dirty)
    expect(theme.bodyBg).toBe('#fff0f0')
    expect(theme.bodyText).toBe('#333') // 浅底 → 强制深字
  })

  it('深浅搭配校验：深底配浅字保持；深底深字修正为浅字', () => {
    const ok = `<html><body>
<section style="background:#0d1526;">
<p style="color:#cbd5e1;">深底浅字正常</p>
</section></body></html>`
    expect(parseThemeFromHtml(ok).theme.bodyText).toBe('#cbd5e1')
    const bad = `<html><body>
<section style="background:#0d1526;">
<p style="color:#333;">深底深字看不清</p>
</section></body></html>`
    expect(parseThemeFromHtml(bad).theme.bodyText).toBe('#cbd5e1')
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

describe('resolveEditorTheme（日间基础色 / 夜间公众号逻辑自动变深，无手调深色变体）', () => {
  it('科技数码：日间浅蓝白卡 + 深字；夜间自动变深（深卡 + 浅字，保留色相）', () => {
    const tech = CATEGORY_THEMES['科技数码']
    const day = resolveEditorTheme(tech, false)
    expect(day.bodyBg).toBe('#eef3fb') // 日间基础色
    expect(day.darkBg).toBe(false)
    expect(day.bodyText).toBe('#333')
    const night = resolveEditorTheme(tech, true)
    expect(night.bodyBg).toBe(wechatDarkColor('#eef3fb')) // 公众号逻辑自动变深
    expect(night.darkBg).toBe(true)
    expect(night.bodyText).toBe(wechatDarkColor('#333', 'text')) // 深字翻转为近白浅字
    expect(night.headingColor).toBe(wechatDarkColor('#1a1a1a', 'text'))
  })

  it('生活常识：日间保持暖白卡深字；夜间自动变深（深暖卡 + 浅字）', () => {
    const life = CATEGORY_THEMES['生活常识']
    const day = resolveEditorTheme(life, false)
    expect(day.bodyBg).toBe('#fffaf2')
    expect(day.darkBg).toBe(false)
    expect(day.bodyText).toBe('#3d3a34')
    const night = resolveEditorTheme(life, true)
    expect(night.bodyBg).toBe(wechatDarkColor('#fffaf2'))
    expect(night.darkBg).toBe(true)
    expect(night.bodyText).toBe(wechatDarkColor('#3d3a34', 'text'))
  })

  it('无卡片主题：日间透明白底深字；夜间默认深底浅字', () => {
    const design = CATEGORY_THEMES['设计鉴赏'] // 无 bodyBg
    const day = resolveEditorTheme(design, false)
    expect(day.bodyBg).toBeUndefined()
    expect(day.darkBg).toBe(false)
    expect(day.bodyText).toBe('#333')
    const night = resolveEditorTheme(design, true)
    expect(night.bodyText).toBe('#cbd5e1')
  })

  it('夜间配色语义统一：无卡片给默认深底；浅卡自动变深；深色基础卡保持（防白底浅字不可读）', () => {
    const design = CATEGORY_THEMES['设计鉴赏'] // 无 bodyBg
    expect(resolveEditorTheme(design, true).bodyBg).toBe('#1e2126')
    expect(resolveEditorTheme(design, true).darkBg).toBe(true)
    // 浅粉底主题（导入排版）夜间自动变深（公众号逻辑）
    const lightCard = { ...DEFAULT_THEME, bodyBg: '#fff0f0', bodyText: '#333' }
    const c = resolveEditorTheme(lightCard, true)
    expect(c.bodyBg).toBe(wechatDarkColor('#fff0f0'))
    expect(c.darkBg).toBe(true)
    // 深色基础色主题（自定义深卡导入）夜间保持深卡（不套默认底）
    const darkCard = { ...DEFAULT_THEME, bodyBg: '#0d1526', bodyText: '#cbd5e1' }
    expect(resolveEditorTheme(darkCard, true).bodyBg).toBe('#0d1526')
  })

  it('脏数据兜底仍生效：浅底显式浅字被修正为深字', () => {
    const dirty = { ...DEFAULT_THEME, bodyBg: '#fff0f0', bodyText: '#cbd5e1' }
    const c = resolveEditorTheme(dirty, false)
    expect(c.bodyText).toBe('#333')
  })
})

describe('wechatDarkColor（公众号夜间逻辑：亮度翻转 + 降饱和，保留色相）', () => {
  it('浅底变深底、深字变浅字，非法输入原样返回', () => {
    const warmDark = wechatDarkColor('#fffaf2') // 暖白卡 → 深暖卡
    expect(isDarkColor(warmDark)).toBe(true)
    const coolDark = wechatDarkColor('#eef3fb') // 浅蓝白卡 → 深蓝黑卡
    expect(isDarkColor(coolDark)).toBe(true)
    expect(isDarkColor(wechatDarkColor('#3d3a34', 'text'))).toBe(false) // 深字 → 浅字
    expect(wechatDarkColor('#fffaf2')).toBe(wechatDarkColor('#fffaf2')) // 纯函数稳定
    expect(wechatDarkColor('not-a-color')).toBe('not-a-color') // 非法原样返回
  })

  it('文字方向反色到近白（线性翻转 #333 只会得 #ccc 偏灰看不清，公众号实际接近白）', () => {
    expect(wechatDarkColor('#333', 'text')).toBe('#e0e0e0') // L 0.2 → 夹到 0.88
    expect(wechatDarkColor('#1a1a1a', 'text')).toBe('#e5e5e5')
    expect(wechatDarkColor('#3d3a34', 'text')).toBe('#e2e1df') // 暖字 → 近白微暖（保留色相）
  })

  it('3 位缩写按展开后的 6 位处理（#333 曾被当非法色原样返回，夜间深字看不清）', () => {
    expect(isDarkColor('#333')).toBe(true)
    expect(isDarkColor('#fff')).toBe(false)
    expect(wechatDarkColor('#333', 'text')).toBe(wechatDarkColor('#333333', 'text'))
    // 缩写深字夜间翻转成近白（回归：此前 #333 不翻转直接渲染在深卡上）
    const night = resolveEditorTheme(CATEGORY_THEMES['科技数码'], true)
    expect(night.bodyText).toBe('#e0e0e0')
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

describe('parseThemeFromHtml v2（细节提取）', () => {
  it('标题/加粗/正文分色：强调色取标题与加粗的品牌色，而非杂元素', () => {
    const html = `<section>
<h2 style="color:#2bae85;">小节标题</h2>
<p style="color:#666;line-height:1.8;">正文 <strong style="color:rgb(53,179,120);">关键词</strong> 继续</p>
<a href="#" style="color:#1e6bb8;">外链</a>
</section>`
    const r = parseThemeFromHtml(html)
    // 标题色 + 加粗色是青绿系（品牌色），accent 与之同系而非链接蓝
    expect(r.theme.accent).toBe('#35b378') // strong rgb(53,179,120)
    expect(r.theme.headingColor).toBe('#2bae85')
    expect(r.theme.strongColor).toBe('#35b378')
    expect(r.theme.bodyText).toBe('#666666') // 正文灰保留
    expect(r.theme.strongStyle).toBe('color') // 无背景 → 不着色块
  })

  it('微信多图层复合背景不再误判为 highlight 黑底', () => {
    const html = `<section>
<p style="color:#333;">正文 <strong style="background:rgba(0, 0, 0, 0.4) rgba(0, 0, 0, 0.4) rgba(0, 0, 0, 0.4) rgb(53, 179, 120);color:#fff;">词</strong></p>
</section>`
    const r = parseThemeFromHtml(html)
    expect(r.theme.strongStyle).toBe('color')
    expect(r.theme.strongBg).toBeUndefined()
  })

  it('表格样式：表头背景 + 边框色 + 单元格底色 → bordered/striped', () => {
    const html = `<section>
<table style="border:1px solid #e0e0e0;">
<tr><th style="background:#f3f4f6;color:#111;">列A</th><th style="background:#f3f4f6;">列B</th></tr>
<tr><td style="border:1px solid #e0e0e0;color:#2c2c2c;">1</td><td style="border:1px solid #e0e0e0;">2</td></tr>
<tr><td style="background:#fafafa;border:1px solid #e0e0e0;">3</td><td style="background:#fafafa;border:1px solid #e0e0e0;">4</td></tr>
</table>
</section>`
    const r = parseThemeFromHtml(html)
    expect(r.theme.tableStyle).toBe('striped') // td 有非表头背景 → 斑马纹
    expect(r.theme.tableHeaderBg).toBe('#f3f4f6')
    expect(r.theme.tableBorder).toBe('#e0e0e0')
  })

  it('无表格的文章不产生表格字段', () => {
    const r = parseThemeFromHtml(`<section><p style="color:#333;">纯文本</p></section>`)
    expect(r.theme.tableStyle).toBeUndefined()
    expect(r.theme.tableHeaderBg).toBeUndefined()
  })

  it('纯色背景的 strong 仍正确判 highlight', () => {
    const html = `<section><p>正文 <strong style="background:#fef3c7;color:#333;">黄底加粗</strong></p></section>`
    const r = parseThemeFromHtml(html)
    expect(r.theme.strongStyle).toBe('highlight')
    expect(r.theme.strongBg).toBe('#fef3c7')
  })

  it('微信默认透明背景的 h2 不误判为 block 色块（保留文字色形态）', () => {
    const html = `<section>
<h2 style="background:none 0% 0% / auto no-repeat scroll padding-box border-box transparent;color:#2bae85;border-left:4px solid #2bae85;">小节标题</h2>
<p style="color:#666;">正文</p>
</section>`
    const r = parseThemeFromHtml(html)
    expect(r.theme.h2Style).not.toBe('block') // 透明背景 → 非色块
    expect(r.theme.h2Style).toBe('leftbar') // 有 border-left → 左竖条
    expect(r.theme.headingColor).toBe('#2bae85') // 标题文字色保留
  })

  it('无 h1 只有 h2 时，headingAlign 认 h2 的 text-align', () => {
    const html = `<section>
<h2 style="text-align:left;color:#2bae85;">左对齐小节</h2>
<p style="color:#666;">正文</p>
</section>`
    const r = parseThemeFromHtml(html)
    expect(r.theme.headingAlign).toBe('left')
  })

  it('h2 内部 span 色块（微信习惯）→ block + h2Bg，居中看 justify-content', () => {
    const html = `<section>
<h2 style="display:flex;justify-content:center;text-align:left;color:#2bae85;background:none 0% 0% / auto no-repeat scroll padding-box border-box transparent;"><span style="color:rgb(255,255,255);background:none 0% 0% / auto no-repeat scroll padding-box border-box rgb(0,0,0);padding:2px 10px;">色块标题</span></h2>
<p style="color:#666;">正文</p>
</section>`
    const r = parseThemeFromHtml(html)
    expect(r.theme.h2Style).toBe('block') // 色块在内部 span 上
    expect(r.theme.h2Bg).toBe('#000000') // 块背景是黑色
    expect(r.theme.headingAlign).toBe('center') // justify-content:center → 居中
    expect(r.theme.headingColor).toBe('#2bae85')
  })
})
