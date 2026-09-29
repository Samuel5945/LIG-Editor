/**
 * chat-tools v1 共享纯函数为什么要测这些：
 * accumulateToolCalls 的碎片合并规则（index 定位/覆盖 vs 拼接）决定模型要调的工具是否被正确还原；
 * buildToolSchemas 的提示词类过滤与 OpenAI function 映射决定暴露给对话模型的工具面。
 */
import { describe, expect, it } from 'vitest'
import { accumulateToolCalls, buildToolSchemas, parseToolCallFence } from '../llmText'

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
