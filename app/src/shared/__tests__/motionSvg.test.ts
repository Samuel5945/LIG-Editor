import { describe, expect, it } from 'vitest'
import {
  motionToSvg,
  namespaceMotionIds,
  parseMotionAttrs,
  scanMotion,
  substituteMotionTokens,
  type MotionPalette
} from '../motionSvg'
import { mdToDoc, docToMd } from '../markdown'
import { docToExportHtml } from '../exportHtml'
import { docToPlatformHtml } from '../platformHtml'
import { countWords } from '../wordCount'
import { DEFAULT_THEME } from '../categoryThemes'

const PALETTE: MotionPalette = {
  accent: '#0d9488',
  ink: '#333333',
  bg: '#ffffff',
  muted: '#555555',
  fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif"
}

/** 点击揭晓：热区 go 点击 → 隐藏组显现（社区格式的标准结构） */
const REVEAL =
  '<text x="40" y="90" font-size="24" fill="{{ink}}">先猜猜看</text>' +
  '<g visibility="hidden"><set attributeName="visibility" to="visible" begin="go.click" fill="freeze"/>' +
  '<text x="40" y="130" font-size="20" fill="{{accent}}">先说清楚给谁看</text></g>' +
  '<rect x="0" y="0" width="480" height="190" fill="#000" fill-opacity="0" pointer-events="visiblePainted" id="go"/>'

const OPTS = { idPrefix: 'm0k', palette: PALETTE }

describe('动效白名单校验', () => {
  it('合法 SMIL 揭晓片段通过并收集热区 id', () => {
    const r = scanMotion(substituteMotionTokens(REVEAL, PALETTE))
    expect(r.error).toBeNull()
    expect(r.ids).toEqual(['go'])
  })

  it.each([
    ['script', '<script>alert(1)</script>'],
    ['foreignObject', '<foreignObject><div>x</div></foreignObject>'],
    ['image 标签', '<image href="#go"/>'],
    ['style 属性', '<rect style="fill:red" id="go"/>'],
    ['on* 事件', '<rect onclick="alert(1)" id="go"/>'],
    ['外链 href', '<use href="https://evil.test/x#a"/>'],
    ['javascript 协议', '<rect fill="javascript:alert(1)"/>'],
    ['data 协议', '<rect fill="data:image/png;base64,x"/>'],
    ['注释', '<!-- x --><rect/>'],
    ['注释结束符', '<rect x="-->" />'],
    ['未知标签', '<blink>x</blink>'],
    ['未转义 &', '<text>A & B</text>'],
    ['未转义 < 属性', '<rect x="<1"/>'],
    ['重复 id', '<rect id="go"/><rect id="go"/>'],
    ['未知事件引用', '<set attributeName="visibility" to="visible" begin="ghost.click"/>'],
    ['未知 url 引用', '<rect fill="url(#ghost)"/>'],
    ['标签不配对', '<g><rect/></g></g>'],
    ['标签未闭合', '<g><rect/>'],
    ['无引号属性', '<rect x=1/>'],
    ['未知令牌', '<rect fill="{{nope}}"/>']
  ])('拒绝：%s', (_name, body) => {
    expect(scanMotion(body).error).not.toBeNull()
  })

  it('实体转义与渐变 url(#) 引用放行', () => {
    const body =
      '<defs><linearGradient id="g"><stop offset="0" stop-color="{{accent}}"/></linearGradient></defs>' +
      '<rect fill="url(#g)"/><text>A &amp; B &lt; C</text>'
    const r = scanMotion(substituteMotionTokens(body, PALETTE))
    expect(r.error).toBeNull()
    expect(r.ids).toEqual(['g'])
  })
})

describe('热区 ID 命名空间', () => {
  it('id / begin 事件列表（含偏移）/ url(#) / href 同步加前缀', () => {
    const body =
      '<defs><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
      '<rect fill="url(#grad)" id="go"/>' +
      '<set attributeName="visibility" to="visible" begin="go.click;go.click+0.3s" fill="freeze"/>' +
      '<use href="#go"/>'
    const out = namespaceMotionIds(body, 'm3k', ['grad', 'go'])
    expect(out).toContain('id="m3kgrad"')
    expect(out).toContain('id="m3kgo"')
    expect(out).toContain('url(#m3kgrad)')
    expect(out).toContain('begin="m3kgo.click;m3kgo.click+0.3s"')
    expect(out).toContain('href="#m3kgo"')
    expect(out).not.toContain('url(#grad)')
    expect(out).not.toContain('"go.click')
  })

  it('不同前缀互不冲突；纯时间 begin 不误伤', () => {
    const body = '<rect id="go"/><animate attributeName="opacity" from="0" to="1" begin="0s;go.click" dur="1s"/>'
    const a = namespaceMotionIds(body, 'm0k', ['go'])
    const b = namespaceMotionIds(body, 'm1k', ['go'])
    expect(a).toContain('begin="0s;m0kgo.click"')
    expect(b).toContain('begin="0s;m1kgo.click"')
    expect(a).not.toEqual(b)
  })
})

describe('根画布组装', () => {
  it('viewBox 模式：width100% 等比缩放 + 主题底色字体 + 令牌已解析', () => {
    const svg = motionToSvg({ body: REVEAL, still: 's' }, OPTS)!
    expect(svg).toContain('viewBox="0 0 480 190"')
    expect(svg).toContain('width="100%"')
    expect(svg).toContain('background:#ffffff')
    expect(svg).toContain('fill="#0d9488"')
    expect(svg).toContain('m0kgo.click')
    expect(svg).not.toContain('{{')
    expect(svg).not.toContain('<script')
  })

  it('height 模式：固定高画布无 viewBox，body 的 height 动画直达根画布', () => {
    const body =
      '<animate attributeName="height" from="58" to="187" begin="go.click" dur=".38s" fill="freeze"/>' +
      '<rect x="0" y="0" width="240" height="51" fill="#000" fill-opacity="0" pointer-events="visiblePainted" id="go"/>'
    const svg = motionToSvg({ body, still: 's', height: 58 }, OPTS)!
    expect(svg).toContain('height="58"')
    expect(svg).not.toContain('viewBox')
    expect(svg).toContain('attributeName="height"')
  })

  it('非法 body 返回 null（调用方静态降级）', () => {
    expect(motionToSvg({ body: '<script>x</script>', still: 's' }, OPTS)).toBeNull()
  })
})

describe('motion 块 markdown 往返', () => {
  const md = `# 标题\n\n<!-- motion: ${JSON.stringify({ body: REVEAL, still: '静态答案', caption: '图注' })} -->\n\n后文段落。`

  it('解析为 motion 块且往返结构无损', () => {
    const doc = mdToDoc(md)
    expect(doc.content[1].type).toBe('motion')
    const back = mdToDoc(docToMd(doc))
    expect(back).toEqual(doc)
    expect(docToMd(doc)).toContain('<!-- motion: {')
  })

  it('motion 行不被相邻段落吞并', () => {
    const doc = mdToDoc(`段落甲\n<!-- motion: ${JSON.stringify({ body: REVEAL, still: 's' })} -->\n段落乙`)
    expect(doc.content.map((b) => b.type)).toEqual(['paragraph', 'motion', 'paragraph'])
  })

  it('非法 JSON / 缺 still 按段落保留原文（不丢数据）', () => {
    const bad = '<!-- motion: {not json} -->'
    expect(mdToDoc(bad).content[0].type).toBe('paragraph')
    const noStill = `<!-- motion: ${JSON.stringify({ body: REVEAL })} -->`
    expect(mdToDoc(noStill).content[0].type).toBe('paragraph')
  })

  it('parseMotionAttrs 容忍 tiptap 的 null 可选字段', () => {
    const a = parseMotionAttrs({ body: REVEAL, still: 's', caption: null, viewBox: null, height: null })
    expect(a).not.toBeNull()
    expect(a!.caption).toBe('')
    expect(a!.viewBox).toBe('0 0 480 190')
    expect(a!.height).toBeUndefined()
  })
})

describe('动效导出', () => {
  const motionMd = (body: string, still = '静态答案'): string =>
    `<!-- motion: ${JSON.stringify({ body, still, caption: '图注' })} -->`

  it('公众号 HTML 含 SVG + still 静态文字 + 图注', () => {
    const html = docToExportHtml(mdToDoc(motionMd(REVEAL)), (s) => s, DEFAULT_THEME)
    expect(html).toContain('<svg xmlns=')
    expect(html).toContain('m0kgo.click')
    expect(html).toContain('静态答案')
    expect(html).toContain('图注')
    expect(html).not.toMatch(/class=/)
  })

  it('同文两块 ID 前缀不同（事件引用不串）', () => {
    const doc = mdToDoc(motionMd(REVEAL) + '\n\n' + motionMd(REVEAL))
    const html = docToExportHtml(doc, (s) => s, DEFAULT_THEME)
    expect(html).toContain('m0kgo.click')
    expect(html).toContain('m1kgo.click')
  })

  it('非法 body 静态降级：无 SVG，still 仍在', () => {
    const html = docToExportHtml(mdToDoc(motionMd('<script>x</script>')), (s) => s, DEFAULT_THEME)
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('<script')
    expect(html).toContain('静态答案')
  })

  it('语义化平台（知乎）只留 still，不输出 SVG', () => {
    const html = docToPlatformHtml(mdToDoc(motionMd(REVEAL)), (s) => s, DEFAULT_THEME, 'zhihu')
    expect(html).not.toContain('<svg')
    expect(html).toContain('<p>静态答案</p>')
  })

  it('motion 行不计入正文字数', () => {
    expect(countWords(motionMd(REVEAL))).toBe(0)
    expect(countWords('正文一段。')).toBeGreaterThan(0)
  })
})