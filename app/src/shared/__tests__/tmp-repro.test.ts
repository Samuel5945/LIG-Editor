// 临时取证脚本（跑完删除）：复现 2026-09-29 临时对话落工程的两处失败
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { parseTextToolCalls } from '../llmText'

const SESSION = 'C:/Users/PC/Desktop/tuwen-editor/settings/chat-temp/2026-09-29T04-38-35-425Z.json'

describe('repro-tmp', () => {
  it('实际落盘文本的解析结果', () => {
    const j = JSON.parse(readFileSync(SESSION, 'utf8')) as { messages: { content: string }[] }
    const raw = j.messages[3].content
    const r = parseTextToolCalls(raw)
    console.log('[msg3] calls=', r.calls.length, r.calls.map((c) => c.name))
    console.log('[msg3] cleaned head=', JSON.stringify(r.cleaned.slice(0, 40)))
    if (r.calls[0]) console.log('[msg3] argsKeys=', Object.keys(JSON.parse(r.calls[0].arguments)))
    expect(true).toBe(true)
  })

  it('patch_article 的 patches 数组参数', () => {
    const open = '<' + 'tool_call>\n<' + 'function=patch_article>\n'
    const p1 = '<' + 'parameter=project>自媒体推广实操清单</' + 'parameter>\n'
    const p2 =
      '<' +
      'parameter=patches>[\n  {"old": "一、先想清楚", "new": "一、先定位"}\n]</' +
      'parameter>\n'
    const close = '</' + 'function>\n</' + 'tool_call>'
    const r = parseTextToolCalls(open + p1 + p2 + close)
    const args = JSON.parse(r.calls[0].arguments) as Record<string, unknown>
    console.log('[patch] typeof patches=', typeof args.patches, args.patches)
    expect(Array.isArray(args.patches)).toBe(true)
  })
})
