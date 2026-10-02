import { readFileSync, writeFileSync } from 'fs'

const tests = `
describe('导出类工具注册表', () => {
  it('export_pdf 必须是个工具——菜单有 export:pdf，但注册表缺它时对话只会退化成导 HTML 让用户自己打印', () => {
    const pdf = TOOLS.find((t) => t.name === 'export_pdf')
    expect(pdf?.inputSchema.required).toEqual(['project'])
    expect(pdf?.description).toContain('PDF')
  })

  it('三种交付出口都在：html / docx / pdf（清单注入时它们的第一句用途就是模型的决策依据）', () => {
    const names = TOOLS.filter((t) => t.name.startsWith('export_')).map((t) => t.name)
    expect(names).toEqual(['export_html', 'export_docx', 'export_pdf'])
    for (const n of names) expect(TOOLS.find((t) => t.name === n)?.inputSchema.required).toContain('project')
  })
})
`

const p = 'src/main/__tests__/chatToolArgs.test.ts'
let body = readFileSync(p, 'utf8')
if (!body.includes("describe('导出类工具注册表")) body += tests
writeFileSync(p, body)
console.log('appended:', body.includes('export_pdf 必须是个工具'))
