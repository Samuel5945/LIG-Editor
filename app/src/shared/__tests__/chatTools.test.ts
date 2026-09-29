/**
 * chat-tools v1 共享纯函数为什么要测这些：
 * accumulateToolCalls 的碎片合并规则（index 定位/覆盖 vs 拼接）决定模型要调的工具是否被正确还原；
 * buildToolSchemas 的提示词类过滤与 OpenAI function 映射决定暴露给对话模型的工具面。
 */
import type { ChatToolSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  accumulateToolCalls,
  buildToolSchemas,
  coerceArrayArg,
  parseTextToolCalls,
  parseToolCallFence,
  inventoryFor,
  toolsInventory
} from '../llmText'
import { freeChatSystemPrompt } from '../prompts'

describe('accumulateToolCalls', () => {
  it('单个工具分段到达：arguments 字符串拼接、id/name 覆盖', () => {
    const acc: { id: string; name: string; arguments: string }[] = []
    accumulateToolCalls(acc, [{ index: 0, id: 'call_1', function: { name: 'patch_article', arguments: '{"old":' } }])
    accumulateToolCalls(acc, [{ index: 0, function: { arguments: '"正文"' } }])
    accumulateToolCalls(acc, [{ index: 0, function: { arguments: '}' } }])
    expect(acc).toEqual([{ id: 'call_1', name: 'patch_article', arguments: '{"old":"正文"}' }])
  })

  it('多工具并行流式：按 index 定位互不串位', () => {
    const acc: { id: string; name: string; arguments: string }[] = []
    accumulateToolCalls(acc, [
      { index: 0, id: 'a', function: { name: 'get_project', arguments: '{"name":' } },
      { index: 1, id: 'b', function: { name: 'set_theme', arguments: '{"accent"' } }
    ])
    accumulateToolCalls(acc, [
      { index: 1, function: { arguments: ': "#ff0000"}' } },
      { index: 0, function: { arguments: '"test"}' } }
    ])
    expect(acc).toEqual([
      { id: 'a', name: 'get_project', arguments: '{"name":"test"}' },
      { id: 'b', name: 'set_theme', arguments: '{"accent": "#ff0000"}' }
    ])
  })

  it('缺 index 默认 0；空 acc 自动建槽', () => {
    const acc: { id: string; name: string; arguments: string }[] = []
    accumulateToolCalls(acc, [{ function: { name: 'read_article' } }])
    expect(acc).toEqual([{ id: '', name: 'read_article', arguments: '' }])
  })
})

describe('buildToolSchemas', () => {
  const list = [
    { name: 'list_projects', description: '列工程', parameters: { type: 'object', properties: {} } },
    { name: 'brainstorm_prompt', description: '脑暴提示词', parameters: { type: 'object', properties: {} } },
    { name: 'patch_article', description: '改正文', parameters: { type: 'object', properties: {} } },
    { name: 'titles_prompt', description: '标题提示词', parameters: { type: 'object', properties: {} } }
  ]

  it('排除提示词返回类，其余映射为 OpenAI function 格式', () => {
    const schemas = buildToolSchemas(list)
    expect(schemas.map((s) => s.function.name)).toEqual(['list_projects', 'patch_article'])
    expect(schemas[0]).toEqual({
      type: 'function',
      function: { name: 'list_projects', description: '列工程', parameters: { type: 'object', properties: {} } }
    })
  })
})

describe('parseToolCallFence', () => {
  it('提取围栏里的调用（arguments 统一为 JSON 字符串）并剥离围栏', () => {
    const text = '正在查询工程列表：\n```tool-call\n{"name": "list_projects", "arguments": {}}\n```\n请稍候。'
    const r = parseToolCallFence(text)
    expect(r.calls).toEqual([{ name: 'list_projects', arguments: '{}' }])
    expect(r.cleaned).toBe('正在查询工程列表：\n\n请稍候。')
  })

  it('arguments 为对象时转为字符串；多围栏全部提取', () => {
    const text = [
      '```tool-call',
      '{"name": "set_theme", "arguments": {"accent": "#7c3aed"}}',
      '```',
      '中间文字',
      '```tool-call',
      '{"name": "get_project", "arguments": {"name": "test"}}',
      '```'
    ].join('\n')
    const r = parseToolCallFence(text)
    expect(r.calls).toHaveLength(2)
    expect(r.calls[0]).toEqual({ name: 'set_theme', arguments: '{"accent":"#7c3aed"}' })
    expect(r.cleaned).not.toContain('tool-call')
  })

  it('无围栏原样返回；非法 JSON 围栏不当调用', () => {
    expect(parseToolCallFence('普通回复').calls).toEqual([])
    expect(parseToolCallFence('普通回复').cleaned).toBe('普通回复')
    const bad = '```tool-call\n不是 JSON\n```'
    const r = parseToolCallFence(bad)
    expect(r.calls).toEqual([])
    expect(r.cleaned).toBe(bad)
  })
})

describe('parseXmlToolCalls / parseTextToolCalls', () => {
  it('解析 XML 标签协议（实测模型自发格式）：多行正文完整进入 arguments', () => {
    const text = [
      '工程已建好，接着写全文。',
      '',
      '<tool_call>',
      '<function=write_article>',
      '<parameter=content>',
      '# 自媒体推广的5个实操动作',
      '',
      '## 一、先想清楚',
      '',
      '正文第一段。',
      '</parameter>',
      '</function>',
      '</tool_call>'
    ].join('\n')
    const r = parseTextToolCalls(text)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0].name).toBe('write_article')
    const args = JSON.parse(r.calls[0].arguments) as { content: string }
    expect(args.content).toBe('# 自媒体推广的5个实操动作\n\n## 一、先想清楚\n\n正文第一段。')
    expect(r.cleaned).toBe('工程已建好，接着写全文。')
  })

  it('多参数取值：数字/布尔转类型，长文本保留字符串', () => {
    const text = [
      '<tool_call>',
      '<function=schedule_set>',
      '<parameter=project>test</parameter>',
      '<parameter=date>2026-10-01</parameter>',
      '</function>',
      '</tool_call>'
    ].join('\n')
    const r = parseTextToolCalls(text)
    expect(JSON.parse(r.calls[0].arguments)).toEqual({ project: 'test', date: '2026-10-01' })
  })

  it('无标签文本原样返回', () => {
    expect(parseTextToolCalls('普通回复').calls).toEqual([])
    expect(parseTextToolCalls('普通回复').cleaned).toBe('普通回复')
  })
})

describe('parseXmlToolCalls · 属性形式兼容', () => {
  it('<function name="x"> 空格引号形式与 <function=x> 等价', () => {
    const a = parseTextToolCalls('<tool_call>\n<function name="get_project">\n<parameter=project>test</parameter>\n</function>\n</tool_call>')
    const b = parseTextToolCalls('<tool_call>\n<function=get_project>\n<parameter=project>test</parameter>\n</function>\n</tool_call>')
    expect(a.calls[0].name).toBe('get_project')
    expect(b.calls[0].name).toBe('get_project')
  })

  it('长文本/多行值不被 JSON 类型化破坏', () => {
    const text = [
      '<tool_call>',
      '<function=write_article>',
      '<parameter=content>',
      '## 标题',
      '',
      '正文含 <特殊> 字符与多行。',
      '</parameter>',
      '</function>',
      '</tool_call>'
    ].join('\n')
    const args = JSON.parse(parseTextToolCalls(text).calls[0].arguments) as { content: string }
    expect(args.content).toBe('## 标题\n\n正文含 <特殊> 字符与多行。')
  })
})

describe('parseXmlToolCalls · 结构化参数（数组型入参的成败点）', () => {
  it('多行 JSON 数组解析为数组（实测失败点：长文本保护曾把 patches 降级成字符串）', () => {
    const args = JSON.parse(parseTextToolCalls("<tool_call>\n<function=patch_article>\n<parameter=project>自媒体推广实操清单</parameter>\n<parameter=patches>[\n  {\"old\": \"一、先想清楚：你推广的到底是什么\", \"new\": \"一、先定位：你到底在推什么\"}\n]</parameter>\n</function>\n</tool_call>").calls[0].arguments) as {
      project: string
      patches: unknown
    }
    expect(args.project).toBe('自媒体推广实操清单')
    expect(Array.isArray(args.patches)).toBe(true)
    expect(args.patches).toEqual([{ old: '一、先想清楚：你推广的到底是什么', new: '一、先定位：你到底在推什么' }])
  })

  it('单行超长 JSON 数组（ideas/titles 的常见写法）同样解析为数组', () => {
    const args = JSON.parse(parseTextToolCalls("<tool_call>\n<function=save_ideas>\n<parameter=ideas>[{\"title\":\"选题A\",\"angle\":\"角度\",\"audience\":\"人群\",\"score\":8,\"reason\":\"正热\"},{\"title\":\"选题B\",\"angle\":\"角度2\",\"audience\":\"人群2\",\"score\":7,\"reason\":\"差异化\"}]</parameter>\n</function>\n</tool_call>").calls[0].arguments) as { ideas: unknown }
    expect(Array.isArray(args.ideas)).toBe(true)
    expect((args.ideas as { title: string }[]).map((i) => i.title)).toEqual(['选题A', '选题B'])
  })

  it('形状像 JSON 却解析不了时保留原文，正文不丢', () => {
    const args = JSON.parse(parseTextToolCalls("<tool_call>\n<function=write_article>\n<parameter=project>test</parameter>\n<parameter=content>[注] 这段正文\n本身就是方括号开头且结尾]</parameter>\n</function>\n</tool_call>").calls[0].arguments) as { content: unknown }
    expect(typeof args.content).toBe('string')
  })
})

describe('coerceArrayArg', () => {
  const shape = '[{"old":"原文","new":"替换"}]'
  it('数组的 JSON 字符串 → 数组；单个对象（含其字符串写法）→ 包成一项', () => {
    expect(coerceArrayArg('[{"old":"a","new":"b"}]', 'patches', shape)).toEqual([{ old: 'a', new: 'b' }])
    expect(coerceArrayArg({ old: 'a', new: 'b' }, 'patches', shape)).toEqual([{ old: 'a', new: 'b' }])
    expect(coerceArrayArg('{"old":"a","new":"b"}', 'patches', shape)).toEqual([{ old: 'a', new: 'b' }])
  })

  it('缺参/空白/空数组/非法 JSON 都报出期望形状，让模型一次改对', () => {
    expect(() => coerceArrayArg(undefined, 'patches', shape)).toThrow(/patches 不能为空/)
    expect(() => coerceArrayArg('   ', 'patches', shape)).toThrow(shape)
    expect(() => coerceArrayArg([], 'patches', shape)).toThrow(/需传 JSON 数组/)
    expect(() => coerceArrayArg('[old: a', 'patches', shape)).toThrow(/不是合法 JSON 数组/)
  })
})

describe('toolsInventory · 走文本协议时模型怎么知道有工具', () => {
  const mk = (name: string, description: string): ChatToolSchema => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties: {} } }
  })

  it('清单里点名 export_docx 等交付类工具，并禁止用贴全文代替', () => {
    const s = toolsInventory([
      mk('export_docx', '把工程导出为可编辑的 Word 交稿稿，落到工程「交付/」目录，返回绝对路径'),
      mk('write_article', '整体覆写 article.md 正文')
    ])
    expect(s).toContain('export_docx 把工程导出为可编辑的 Word 交稿稿')
    expect(s).toContain('write_article 整体覆写 article.md 正文')
    expect(s).toMatch(/绝不要把正文贴回对话代替文件/)
  })

  it('用途描述截到首个分隔符，长描述不把提示词撑爆', () => {
    const s = toolsInventory([mk('set_theme', '设置工程排版覆盖（写入 project.json）。字段独立可传：accent 强调色' + '。'.repeat(400))])
    expect(s.split('\n')[0].length).toBeLessThan(200)
  })

  it('没有工具时不给清单（纯文本对话不该出现工具名单）', () => {
    expect(toolsInventory([])).toBe('')
  })
})

describe('freeChatSystemPrompt · 工具在场时改正文走补丁', () => {
  it('有工具：局部改动交给 patch_article，全文围栏只留给整篇重写', () => {
    const s = freeChatSystemPrompt(null, { toolsAvailable: true })
    expect(s).toMatch(/局部改动（改一句、某段压短、加序号、润色某节）一律改用 patch_article/)
    expect(s).not.toMatch(/不要只输出改动部分/)
  })

  it('无工具：保留 article-update 全文围栏契约（确认卡是唯一通路）', () => {
    const s = freeChatSystemPrompt(null)
    expect(s).toMatch(/必须基于工程上下文里的正文输出修改后的全文，未改动的段落原样保留，不要只输出改动部分/)
    expect(s).not.toMatch(/一律改用 patch_article/)
  })
})

describe('parseXmlToolCalls · 模型自发格式收编', () => {
  it('标签名即工具名 + mcp__server__ 前缀归一：零参数工具也算一次调用', () => {
    const r = parseTextToolCalls("<tool_call>\n<mcp__workspace__list_projects></mcp__workspace__list_projects>\n</tool_call>")
    expect(r.calls).toEqual([{ name: 'list_projects', arguments: '{}' }])
    expect(r.cleaned).toBe('')
  })

  it('同种写法带参数照常解析', () => {
    const args = JSON.parse(parseTextToolCalls("<tool_call>\n<mcp__lig__read_article><parameter=project>自媒体推广实操清单</parameter></mcp__lig__read_article>\n</tool_call>").calls[0].arguments)
    expect(args).toEqual({ project: '自媒体推广实操清单' })
  })

  it('属性写法与整段 JSON 写法都能当参数', () => {
    expect(JSON.parse(parseTextToolCalls("<tool_call>\n<get_project project=\"test\" />\n</tool_call>").calls[0].arguments)).toEqual({ project: 'test' })
    const j = JSON.parse(parseTextToolCalls("<tool_call>\n<function=set_titles>\n{\"project\":\"test\",\"titles\":[{\"text\":\"A\",\"score\":9,\"reason\":\"r\"}]}\n</function>\n</tool_call>").calls[0].arguments) as { titles: unknown[] }
    expect(j.titles).toEqual([{ text: 'A', score: 9, reason: 'r' }])
  })
})

describe('inventoryFor · 注入判据是「真的收到过原生 tool_calls」', () => {
  const reg = [
    { type: 'function', function: { name: 'export_docx', description: '导出 Word 交稿稿', parameters: {} } },
    { type: 'function', function: { name: 'write_article', description: '覆写正文', parameters: {} } }
  ] as never[]

  it('已证实原生通路可用：清单不重复下发', () => {
    expect(inventoryFor(reg, reg, true)).toBe('')
  })

  it('供应商收下 tools 却从不返回调用：未证实就必须列工具名', () => {
    const s = inventoryFor(reg, reg, false)
    expect(s).toContain('export_docx 导出 Word 交稿稿')
    expect(s).toContain('write_article 覆写正文')
  })

  it('文本协议通路（原生清单为空）同样注入；空注册表不注入', () => {
    expect(inventoryFor(reg, [], false)).toContain('export_docx')
    expect(inventoryFor([], [], false)).toBe('')
  })
})
