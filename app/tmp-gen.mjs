import { readFileSync, writeFileSync } from 'fs'

// 「生成器」：把含协议标签的测试源码写进测试文件（本脚本用拼接写法，避免标签干扰工具调用解析）
const open = '<' + 'tool_call>'
const close = '</' + 'tool_call>'
const fn = (n) => '<' + `function=${n}>`
const fnEnd = '</' + 'function>'
const par = (k, v) => '<' + `parameter=${k}>` + v + '</' + 'parameter>'

const patchesBlock = [
  open,
  fn('patch_article'),
  par('project', '自媒体推广实操清单'),
  par('patches', '[\n  {"old": "一、先想清楚：你推广的到底是什么", "new": "一、先定位：你到底在推什么"}\n]'),
  fnEnd,
  close
].join('\n')

const ideasBlock = [
  open,
  fn('save_ideas'),
  par(
    'ideas',
    '[{"title":"选题A","angle":"角度","audience":"人群","score":8,"reason":"正热"},{"title":"选题B","angle":"角度2","audience":"人群2","score":7,"reason":"差异化"}]'
  ),
  fnEnd,
  close
].join('\n')

const badBlock = [
  open,
  fn('write_article'),
  par('project', 'test'),
  par('content', '[注] 这段正文\n本身就是方括号开头且结尾]'),
  fnEnd,
  close
].join('\n')

const q = (s) => JSON.stringify(s)

const sharedTests = `
describe('parseXmlToolCalls · 结构化参数（数组型入参的成败点）', () => {
  it('多行 JSON 数组解析为数组（实测失败点：长文本保护曾把 patches 降级成字符串）', () => {
    const args = JSON.parse(parseTextToolCalls(${q(patchesBlock)}).calls[0].arguments) as {
      project: string
      patches: unknown
    }
    expect(args.project).toBe('自媒体推广实操清单')
    expect(Array.isArray(args.patches)).toBe(true)
    expect(args.patches).toEqual([{ old: '一、先想清楚：你推广的到底是什么', new: '一、先定位：你到底在推什么' }])
  })

  it('单行超长 JSON 数组（ideas/titles 的常见写法）同样解析为数组', () => {
    const args = JSON.parse(parseTextToolCalls(${q(ideasBlock)}).calls[0].arguments) as { ideas: unknown }
    expect(Array.isArray(args.ideas)).toBe(true)
    expect((args.ideas as { title: string }[]).map((i) => i.title)).toEqual(['选题A', '选题B'])
  })

  it('形状像 JSON 却解析不了时保留原文，正文不丢', () => {
    const args = JSON.parse(parseTextToolCalls(${q(badBlock)}).calls[0].arguments) as { content: unknown }
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
`

const p = 'src/shared/__tests__/chatTools.test.ts'
let body = readFileSync(p, 'utf8')
body = body.replace(
  "import { accumulateToolCalls, buildToolSchemas, parseTextToolCalls, parseToolCallFence } from '../llmText'",
  "import {\n  accumulateToolCalls,\n  buildToolSchemas,\n  coerceArrayArg,\n  parseTextToolCalls,\n  parseToolCallFence\n} from '../llmText'"
)
if (!body.includes('describe(\'parseXmlToolCalls · 结构化参数')) body += sharedTests
writeFileSync(p, body)
console.log('import patched:', body.includes('coerceArrayArg,'), 'appended:', body.includes('coerceArrayArg(undefined'))
