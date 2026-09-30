/**
 * 排版优化对话框的打包输出协议（spec 2026-09-30-ai-typography-design §6 / §8.3）
 * 钉死的是「向后兼容」：围栏缺省 / 坏 JSON / 非对象 → themePatch 缺省，正文行为与协议升级前一致；
 * 以及一条硬约束——<theme> 围栏不论解析成败都不得留在正文里（否则坏 JSON 会被当正文应用）。
 */
import { describe, expect, it } from 'vitest'
import { describeThemePatch, parseLayoutOutput, THEME_FIELD_LABELS } from '../layoutOutput'
import { THEME_OVERRIDE_KEYS } from '../categoryThemes'

const ARTICLE = '# 测试标题\n\n第一段。\n\n## 小标题\n\n第二段。'

describe('parseLayoutOutput（四态与兼容）', () => {
  it('无围栏 → 正文原样，themePatch 缺省（与升级前完全一致）', () => {
    const r = parseLayoutOutput(`${ARTICLE}\n`)
    expect(r.article).toBe(ARTICLE)
    expect(r.themePatch).toBeUndefined()
  })

  it('有围栏 → 正文剥净 + 视觉参数生效', () => {
    const r = parseLayoutOutput(`${ARTICLE}\n<theme>\n{ "lineHeight": 2.4, "quoteStyle": "card" }\n</theme>`)
    expect(r.article).toBe(ARTICLE)
    expect(r.themePatch).toEqual({ lineHeight: 2.4, quoteStyle: 'card' })
  })

  it('容忍围栏里再套 ```json 代码块与大小写标签', () => {
    const r = parseLayoutOutput(`${ARTICLE}\n<THEME>\n\`\`\`json\n{"pGap": 30}\n\`\`\`\n</THEME>`)
    expect(r.article).toBe(ARTICLE)
    expect(r.themePatch).toEqual({ pGap: 30 })
  })

  it('坏 JSON → themePatch 缺省，且围栏不残留在正文', () => {
    const r = parseLayoutOutput(`${ARTICLE}\n<theme>\n{ lineHeight: 2.4, }\n</theme>`)
    expect(r.themePatch).toBeUndefined()
    expect(r.article).toBe(ARTICLE)
    expect(r.article).not.toContain('<theme>')
  })

  it('围栏内是数组/标量 → 等同没给', () => {
    expect(parseLayoutOutput(`${ARTICLE}\n<theme>[1,2]</theme>`).themePatch).toBeUndefined()
    expect(parseLayoutOutput(`${ARTICLE}\n<theme>2.4</theme>`).themePatch).toBeUndefined()
  })

  it('字段全非法 → themePatch 缺省（不产生空补丁，界面上就不显示视觉块）', () => {
    const r = parseLayoutOutput(`${ARTICLE}\n<theme>{"bodyText":"灰色","quoteStyle":"bubble","unknownKey":1}</theme>`)
    expect(r.themePatch).toBeUndefined()
    expect(r.article).toBe(ARTICLE)
  })

  it('合法与非法混合 → 只保留合法键（非法值不进 meta）', () => {
    const r = parseLayoutOutput(`${ARTICLE}\n<theme>{"lineHeight":99,"bodyText":"grey","quoteBorder":"#14b8a6"}</theme>`)
    expect(r.themePatch).toEqual({ lineHeight: 3, quoteBorder: '#14b8a6' })
  })

  it('围栏夹在正文中间也能剥（模型不总在末尾输出）', () => {
    const r = parseLayoutOutput(`开头\n<theme>{"pGap":26}</theme>\n${ARTICLE}`)
    expect(r.themePatch).toEqual({ pGap: 26 })
    expect(r.article).toBe(`开头\n\n${ARTICLE}`)
    expect(r.article).not.toContain('theme')
  })

  it('两处围栏都剥掉，视觉参数取第一处（模型重复给不残留进正文）', () => {
    const r = parseLayoutOutput(`${ARTICLE}\n<theme>{"pGap":26}</theme>\n补充\n<theme>{"lineHeight":2}</theme>`)
    expect(r.themePatch).toEqual({ pGap: 26 })
    expect(r.article).toBe(`${ARTICLE}\n\n补充`)
    expect(r.article).not.toContain('theme')
  })

  it('空输入不炸', () => {
    expect(parseLayoutOutput('').article).toBe('')
    expect(parseLayoutOutput('   \n ').themePatch).toBeUndefined()
  })
})

describe('视觉参数中文名', () => {
  it('白名单 30 键逐个有中文名（新增字段忘了配标签会在这条红）', () => {
    const missing = THEME_OVERRIDE_KEYS.filter((k) => !THEME_FIELD_LABELS[k])
    expect(missing).toEqual([])
  })

  it('describeThemePatch 输出「中文名 = 值」，未知键原样露出便于发现协议漂移', () => {
    expect(describeThemePatch({ lineHeight: 2.4, quoteStyle: 'card' })).toEqual([
      { label: '行高', value: '2.4' },
      { label: '引用形态', value: 'card' }
    ])
    expect(describeThemePatch({ someFutureKey: 1 } as never)[0].label).toBe('someFutureKey')
  })
})
