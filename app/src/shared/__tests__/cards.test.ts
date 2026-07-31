import { describe, it, expect } from 'vitest'
import {
  CARD_H,
  CARD_W,
  autoFontScale,
  cardHtml,
  cardsPlainText,
  hexToRgba,
  isHexColor,
  parseAccentDirective,
  parseCardItems,
  type CardItem
} from '../cards'

const card = (patch: Partial<CardItem> = {}): CardItem => ({
  title: '标题',
  body: '第一行\n第二行',
  bgPrompt: '',
  bgImage: '',
  png: '',
  ...patch
})

describe('parseCardItems', () => {
  it('围栏包裹的 JSON 数组能解析，产物字段补空', () => {
    const text = '```json\n[{"tag":"续航真相","title":"封面","body":"副标题","bgPrompt":"暖色渐变"}]\n```'
    const cards = parseCardItems(text)
    expect(cards).toHaveLength(1)
    expect(cards![0]).toEqual({ tag: '续航真相', title: '封面', body: '副标题', bgPrompt: '暖色渐变', bgImage: '', png: '' })
  })

  it('缺字段/非字符串字段兜底为空串', () => {
    const cards = parseCardItems('[{"title":"只有标题","bgPrompt":123}]')
    expect(cards![0].tag).toBe('')
    expect(cards![0].body).toBe('')
    expect(cards![0].bgPrompt).toBe('')
  })

  it('过滤 title 和 body 都为空的卡片；全空返回 null', () => {
    expect(parseCardItems('[{"title":"","body":""},{"title":"有效"}]')).toHaveLength(1)
    expect(parseCardItems('[{"bgPrompt":"只有背图描述"}]')).toBeNull()
  })

  it('非 JSON 输出返回 null', () => {
    expect(parseCardItems('抱歉，我无法生成')).toBeNull()
  })
})

describe('cardsPlainText', () => {
  it('只留文案字段，本地产物路径不外传，tag 缺省补空串', () => {
    const text = cardsPlainText([card({ bgImage: 'assets/b.png', png: 'cards/wechat/card-1.png' })])
    const parsed = JSON.parse(text) as Record<string, string>[]
    expect(parsed[0]).toEqual({ tag: '', title: '标题', body: '第一行\n第二行', bgPrompt: '' })
    expect(text).not.toContain('card-1.png')
  })
})

describe('cardHtml', () => {
  it('固定画布尺寸与页面骨架', () => {
    const html = cardHtml(card(), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(html).toContain(`width: ${CARD_W}px`)
    expect(html).toContain(`height: ${CARD_H}px`)
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  it('标题转义、正文分行且 **加粗** 还原为 <b>', () => {
    const html = cardHtml(card({ title: 'a<b>&c', body: '重点 **词** 强调\n\n第二行' }), {
      format: 'wechat',
      index: 1,
      total: 3,
      bgSrc: ''
    })
    expect(html).toContain('a&lt;b&gt;&amp;c')
    expect(html).toContain('重点 <b>词</b> 强调')
    expect(html).toContain('第二行')
  })

  it('公众号风：0 号封面版式无页码，内容卡带页码', () => {
    const coverHtml = cardHtml(card(), { format: 'wechat', index: 0, total: 7, bgSrc: '' })
    const bodyHtml = cardHtml(card(), { format: 'wechat', index: 1, total: 7, bgSrc: '' })
    expect(coverHtml).not.toContain('01 / 07')
    expect(bodyHtml).toContain('02 / 07')
  })

  it('小红书风：不再输出底部页码圆点（排序交给平台）', () => {
    const html = cardHtml(card(), { format: 'xhs', index: 2, total: 5, bgSrc: '' })
    expect(html).not.toContain('border-radius: 8px')
  })

  it('背图透出强度反算遮罩浓度，缺省 15', () => {
    const strong = cardHtml(card({ bgOpacity: 40 }), { format: 'wechat', index: 1, total: 3, bgSrc: '../assets/b.png' })
    expect(strong).toContain('rgba(246, 242, 234, 0.60)')
    const fallback = cardHtml(card(), { format: 'xhs', index: 1, total: 3, bgSrc: '../assets/b.png' })
    expect(fallback).toContain('rgba(255, 255, 255, 0.85)')
  })

  it('封面角标：有 tag 用自定义文案，留空兜底平台默认', () => {
    const custom = cardHtml(card({ tag: '续航真相' }), { format: 'xhs', index: 0, total: 3, bgSrc: '' })
    expect(custom).toContain('✦ 续航真相 ✦')
    const fallbackXhs = cardHtml(card(), { format: 'xhs', index: 0, total: 3, bgSrc: '' })
    expect(fallbackXhs).toContain('✦ 干货分享 ✦')
    const fallbackWechat = cardHtml(card(), { format: 'wechat', index: 0, total: 3, bgSrc: '' })
    expect(fallbackWechat).toContain('图 文 卡 片')
  })

  it('深色底反白：底色变深、文字切浅色配色板', () => {
    const wcDark = cardHtml(card({ dark: true }), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(wcDark).toContain('#221f1a')
    expect(wcDark).toContain('#f4efe4')
    const xhsDark = cardHtml(card({ dark: true }), { format: 'xhs', index: 1, total: 3, bgSrc: '' })
    expect(xhsDark).toContain('rgba(30, 27, 34, 0.88)')
    // 遮罩也切深色：不再用浅色 rgba 基底
    const wcDarkBg = cardHtml(card({ dark: true }), { format: 'wechat', index: 1, total: 3, bgSrc: '../assets/b.png' })
    expect(wcDarkBg).toContain('rgba(24, 21, 17, 0.85)')
  })

  it('文字大小：fontScale 手动值优先，未设按内容量自适应，超界夹取到 80-150', () => {
    // 默认卡内容少（2 行 8 字）→ 自适应 120，h2 60×1.2=72
    const base = cardHtml(card(), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(base).toContain('font-size: 72px')
    const big = cardHtml(card({ fontScale: 150 }), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(big).toContain('font-size: 90px')
    // 200 超上限按 150 算，50 低于下限按 80 算
    const over = cardHtml(card({ fontScale: 200 }), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(over).toContain('font-size: 90px')
    const under = cardHtml(card({ fontScale: 50 }), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(under).toContain('font-size: 48px')
  })

  it('内容卡整块垂直居中，不再堆在左上角', () => {
    const wc = cardHtml(card(), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(wc).toContain('justify-content: center')
    const xhs = cardHtml(card(), { format: 'xhs', index: 1, total: 3, bgSrc: '' })
    expect(xhs).toContain('justify-content: center')
  })

  it('bgSrc 非空时插入背图与遮罩，空则不插', () => {
    const withBg = cardHtml(card(), { format: 'xhs', index: 0, total: 3, bgSrc: '../assets/card-bg-1.png' })
    const noBg = cardHtml(card(), { format: 'xhs', index: 0, total: 3, bgSrc: '' })
    expect(withBg).toContain('<img class="bg" src="../assets/card-bg-1.png">')
    expect(withBg).toContain('class="veil"')
    expect(noBg).not.toContain('class="bg"')
    expect(noBg).not.toContain('class="veil"')
  })

  it('强调色覆盖：公众号页码/色条、小红书角标/色条/划线跟随，非法值回默认', () => {
    const wc = cardHtml(card(), { format: 'wechat', index: 1, total: 3, bgSrc: '', accent: '#16a085' })
    expect(wc).toContain('color: #16a085')
    expect(wc).not.toContain('#b0803c')
    const xhs = cardHtml(card(), { format: 'xhs', index: 1, total: 3, bgSrc: '', accent: '#16a085' })
    expect(xhs).toContain('background: #16a085')
    // 标题荧光笔划线用半透明衍生色
    expect(xhs).toContain('rgba(22, 160, 133, 0.3)')
    const bad = cardHtml(card(), { format: 'wechat', index: 1, total: 3, bgSrc: '', accent: 'red' })
    expect(bad).toContain('#b0803c')
  })

  it('加粗词上强调色：b 选择器用覆盖色，缺省用平台默认色', () => {
    const custom = cardHtml(card(), { format: 'wechat', index: 1, total: 3, bgSrc: '', accent: '#ff6b35' })
    expect(custom).toContain('b { color: #ff6b35; }')
    const wcDefault = cardHtml(card(), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(wcDefault).toContain('b { color: #b0803c; }')
    const xhsDark = cardHtml(card({ dark: true }), { format: 'xhs', index: 1, total: 3, bgSrc: '' })
    expect(xhsDark).toContain('b { color: #ff5c85; }')
  })

  it('要点序号：内容卡每行前加 01/02 编号，封面卡不生效', () => {
    const body = cardHtml(card({ numbered: true }), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(body).toContain('>01</span>第一行')
    expect(body).toContain('>02</span>第二行')
    const cover = cardHtml(card({ numbered: true }), { format: 'xhs', index: 0, total: 3, bgSrc: '' })
    expect(cover).not.toContain('>01</span>')
  })

  it('溢出保护：页内自带缩字脚本', () => {
    const html = cardHtml(card(), { format: 'wechat', index: 1, total: 3, bgSrc: '' })
    expect(html).toContain('scrollHeight > box.clientHeight')
    expect(html).toContain('style.zoom')
  })
})

describe('autoFontScale', () => {
  it('内容越少字号初值越大，内容多保持 100', () => {
    expect(autoFontScale({ title: '短', body: '一行' })).toBe(120)
    expect(autoFontScale({ title: '标题', body: '第一行要点内容\n第二行要点内容\n第三行要点内容' })).toBe(110)
    expect(autoFontScale({ title: '标题', body: '要点\n'.repeat(6) })).toBe(100)
    expect(autoFontScale({ title: '标题', body: '很长的要点内容一直写'.repeat(12) })).toBe(100)
  })
})

describe('颜色工具', () => {
  it('isHexColor 校验 #rgb/#rrggbb，拒绝其它', () => {
    expect(isHexColor('#ff6b35')).toBe(true)
    expect(isHexColor('#f63')).toBe(true)
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor('#ff6b3')).toBe(false)
    expect(isHexColor('')).toBe(false)
  })

  it('hexToRgba 转换与非法入参容错', () => {
    expect(hexToRgba('#ff2e63', 0.38)).toBe('rgba(255, 46, 99, 0.38)')
    expect(hexToRgba('#f63', 1)).toBe('rgba(255, 102, 51, 1)')
    expect(hexToRgba('oops', 0.5)).toBeNull()
  })
})

describe('parseAccentDirective', () => {
  it('解析指令块并从可见文本剥离', () => {
    const text = '橙色更有活力。\n```cards-accent\n{"accent":"#ff6b35"}\n```'
    const { cleaned, accent } = parseAccentDirective(text)
    expect(accent).toBe('#ff6b35')
    expect(cleaned).toBe('橙色更有活力。')
  })

  it('default 表示恢复平台默认（accent 为 null）', () => {
    const { accent } = parseAccentDirective('好的。\n```cards-accent\n{"accent":"default"}\n```')
    expect(accent).toBeNull()
  })

  it('无指令/非法色值/JSON 损坏都静默容错（accent 为 undefined）', () => {
    expect(parseAccentDirective('普通回复').accent).toBeUndefined()
    expect(parseAccentDirective('```cards-accent\n{"accent":"红色"}\n```').accent).toBeUndefined()
    expect(parseAccentDirective('```cards-accent\n{oops\n```').accent).toBeUndefined()
    // 剥离仍生效，坏指令不污染可见文本
    expect(parseAccentDirective('回复\n```cards-accent\n{oops\n```').cleaned).toBe('回复')
  })
})
