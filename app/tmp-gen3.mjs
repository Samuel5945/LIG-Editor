import { readFileSync, writeFileSync } from 'fs'

const tests = `
describe('inventoryFor · 清单只在文本协议通路注入', () => {
  const mk = (name: string): ChatToolSchema => ({
    type: 'function',
    function: { name, description: '导出 Word 交稿稿', parameters: { type: 'object', properties: {} } }
  })
  const registry = [mk('export_docx'), mk('write_article')]

  it('模型能收原生 tools：schema 已下发，提示里不再重复列清单', () => {
    expect(inventoryFor(registry, registry)).toBe('')
  })

  it('走文本协议（原生清单为空）：必须列出工具名，否则模型不知道自己有什么工具', () => {
    const s = inventoryFor([], registry)
    expect(s).toContain('export_docx 导出 Word 交稿稿')
    expect(s).toContain('write_article 导出 Word 交稿稿')
  })

  it('注册表本身为空时不注入（纯文本对话不该出现工具名单）', () => {
    expect(inventoryFor([], [])).toBe('')
  })
})
`

const p = 'src/shared/__tests__/chatTools.test.ts'
let body = readFileSync(p, 'utf8')
body = body.replace('  toolsInventory\n} from', '  inventoryFor,\n  toolsInventory\n} from')
if (!body.includes("describe('inventoryFor")) body += tests
writeFileSync(p, body)
console.log('import patched:', body.includes('inventoryFor,'), '| appended:', body.includes('原生 tools：schema'))
