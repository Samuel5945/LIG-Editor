import { readFileSync, writeFileSync } from 'fs'

const open = '<' + 'tool_call>'
const close = '</' + 'tool_call>'
const fn = (n) => '<' + `function=${n}>`
const fnEnd = '</' + 'function>'
const par = (k, v) => '<' + `parameter=${k}>` + v + '</' + 'parameter>'
const tag = (n, inner = '') => '<' + `${n}>${inner}</${n}>`

const mcpBlock = [open, tag('mcp__workspace__list_projects'), close].join('\n')
const mcpArgs = [
  open,
  tag('mcp__lig__read_article', par('project', '自媒体推广实操清单')),
  close
].join('\n')
const attrCall = [open, '<' + 'get_project project="test" /' + '>', close].join('\n')
const jsonCall = [open, fn('set_titles'), '{"project":"test","titles":[{"text":"A","score":9,"reason":"r"}]}', fnEnd, close].join('\n')

const newTests = `
describe('parseXmlToolCalls · 模型自发格式收编', () => {
  it('标签名即工具名 + mcp__server__ 前缀归一：零参数工具也算一次调用', () => {
    const r = parseTextToolCalls(${JSON.stringify(mcpBlock)})
    expect(r.calls).toEqual([{ name: 'list_projects', arguments: '{}' }])
    expect(r.cleaned).toBe('')
  })

  it('同种写法带参数照常解析', () => {
    const args = JSON.parse(parseTextToolCalls(${JSON.stringify(mcpArgs)}).calls[0].arguments)
    expect(args).toEqual({ project: '自媒体推广实操清单' })
  })

  it('属性写法与整段 JSON 写法都能当参数', () => {
    expect(JSON.parse(parseTextToolCalls(${JSON.stringify(attrCall)}).calls[0].arguments)).toEqual({ project: 'test' })
    const j = JSON.parse(parseTextToolCalls(${JSON.stringify(jsonCall)}).calls[0].arguments) as { titles: unknown[] }
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
`

const p = 'src/shared/__tests__/chatTools.test.ts'
let body = readFileSync(p, 'utf8')
// 删掉旧的 inventoryFor 用例块（判据已换），换成新的
const start = body.indexOf("\ndescribe('inventoryFor")
if (start > 0) body = body.slice(0, start)
body = body.replace('  inventoryFor,\n', '  inventoryFor,\n')
body += newTests
writeFileSync(p, body)
console.log('旧块移除:', start > 0, '| 新用例写入:', body.includes('真的收到过原生 tool_calls'), '| parser 用例:', body.includes('mcp__server__'))
