import { describe, expect, it } from 'vitest'
import { camelKey, expandWrapperCalls, normalizeToolArgs } from '../toolArgs'

/** set_theme 的真实形状（只留判定需要的键）：归一只能按 inputSchema 声明的合法键改 */
const setThemeSchema = {
  type: 'object',
  properties: {
    project: { type: 'string' },
    lineHeight: { type: 'number' },
    bodyFontSize: { type: 'number' },
    quoteStyle: { type: 'string' },
    h2Num: { type: 'string' },
    imgRadius: { type: 'number' }
  },
  required: ['project']
}

describe('camelKey', () => {
  it('蛇形转驼峰，已是驼峰原样', () => {
    expect(camelKey('line_height')).toBe('lineHeight')
    expect(camelKey('body_font_size')).toBe('bodyFontSize')
    expect(camelKey('accent')).toBe('accent')
    expect(camelKey('lineHeight')).toBe('lineHeight')
    expect(camelKey('h2_num')).toBe('h2Num')
  })
})

describe('normalizeToolArgs（文本协议入参归一）', () => {
  it('蛇形键改成 schema 认识的驼峰键（实测 line_height: 3 设了不生效就是这么丢的）', () => {
    const out = JSON.parse(normalizeToolArgs('{"project":"某工程","line_height":3}', setThemeSchema))
    expect(out).toEqual({ project: '某工程', lineHeight: 3 })
  })

  it('未知键不改名也不删（留给工具自己剔）', () => {
    const out = JSON.parse(normalizeToolArgs('{"project":"x","some_unknown":1}', setThemeSchema))
    expect(out).toEqual({ project: 'x', some_unknown: 1 })
  })

  it('合法驼峰键不被改动', () => {
    const out = JSON.parse(normalizeToolArgs('{"lineHeight":2.4,"quoteStyle":"card"}', setThemeSchema))
    expect(out).toEqual({ lineHeight: 2.4, quoteStyle: 'card' })
  })

  it('无 schema 时不动键，只还原 JSON 字符串形态的值', () => {
    const out = JSON.parse(normalizeToolArgs('{"line_height":"[1,2]"}'))
    expect(out).toEqual({ line_height: [1, 2] })
  })

  it('数组/对象写成 JSON 字符串时还原成结构（patch_article 类入参的老坑）', () => {
    const schema = { properties: { patches: { type: 'array' }, project: { type: 'string' } } }
    const out = JSON.parse(
      normalizeToolArgs('{"project":"x","patches":"[{\\"old\\":\\"甲\\",\\"new\\":\\"乙\\"}]"}', schema)
    )
    expect(out.patches).toEqual([{ old: '甲', new: '乙' }])
  })

  it('嵌套结构里的蛇形键与字符串值一起归一（save_ideas / set_titles 的 items 形态）', () => {
    const schema = { properties: { ideas: { type: 'array' }, titleText: { type: 'string' } } }
    const out = JSON.parse(
      normalizeToolArgs('{"ideas":"[{\\"title_text\\":\\"甲\\"}]","title_text":"乙"}', schema)
    )
    expect(out).toEqual({ ideas: [{ titleText: '甲' }], titleText: '乙' })
  })

  it('非法 JSON 原样返回，由工具报错而不是这里吞掉', () => {
    expect(normalizeToolArgs('{坏 JSON', setThemeSchema)).toBe('{坏 JSON')
    expect(normalizeToolArgs('', setThemeSchema)).toBe('{}')
  })

  it('普通字符串值不被误当 JSON（工程名里带方括号也不该被 parse）', () => {
    const out = JSON.parse(normalizeToolArgs('{"project":"[某] 工程"}', setThemeSchema))
    expect(out.project).toBe('[某] 工程')
  })
})

describe('expandWrapperCalls（调用被再包一层壳）', () => {
  it('tool_call 壳 + 体内写真名与参数 → 展开成真实调用（实测报「未知工具：tool_call」那条）', () => {
    const [c] = expandWrapperCalls([
      { name: 'tool_call', arguments: '{"name":"set_theme","arguments":{"project":"x","lineHeight":1.5}}' }
    ])
    expect(c.name).toBe('set_theme')
    expect(JSON.parse(c.arguments)).toEqual({ project: 'x', lineHeight: 1.5 })
  })

  it('arguments 写成 JSON 字符串也接得住', () => {
    const [c] = expandWrapperCalls([
      { name: 'invoke', arguments: '{"name":"set_theme","arguments":"{\\"project\\":\\"x\\"}"}' }
    ])
    expect(c.name).toBe('set_theme')
    expect(JSON.parse(c.arguments)).toEqual({ project: 'x' })
  })

  it('正常调用与认不出真名的壳一律原样返回（不编造工具名）', () => {
    const plain = [{ name: 'set_theme', arguments: '{"project":"x"}' }]
    expect(expandWrapperCalls(plain)).toEqual(plain)
    const bad = [{ name: 'tool_call', arguments: '{不是 JSON' }]
    expect(expandWrapperCalls(bad)).toEqual(bad)
    const noName = [{ name: 'tool_call', arguments: '{"arguments":{}}' }]
    expect(expandWrapperCalls(noName)).toEqual(noName)
    const nested = [{ name: 'tool_call', arguments: '{"name":"tool_call","arguments":{}}' }]
    expect(expandWrapperCalls(nested)).toEqual(nested)
  })
})
