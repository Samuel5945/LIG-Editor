import { readFileSync, writeFileSync } from 'fs'

const P = '月省千元不是梦：TokenRhythm如何用“自动选模”砍掉'

const tests = `
describe('dir 作为一等入参（工程名标点不再参与匹配）', () => {
  const real = ${JSON.stringify(P)}
  let projDir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lig-dir-'))
    projDir = String((call('create_project', { name: real }) as { dir: string }).dir)
    call('write_article', { project: real, content: '# 标题\\n\\n正文第一段。' })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('带 project 的工具自动多出 dir 入参（新增工具继承，不必逐个改 schema）', () => {
    const withProject = TOOLS.filter((t) => 'project' in (t.inputSchema.properties as Record<string, unknown>))
    expect(withProject.length).toBeGreaterThan(15)
    expect(withProject.every((t) => 'dir' in (t.inputSchema.properties as Record<string, unknown>))).toBe(true)
    // 没有 project 入参的工具（list_projects / create_project / save_ideas）不该多出 dir
    expect('dir' in (TOOLS.find((t) => t.name === 'list_projects')!.inputSchema.properties as object)).toBe(false)
  })

  it('只给 dir 就能读到老文件——project 传成乱名字也不影响', () => {
    expect(call('read_article', { dir: projDir })).toContain('正文第一段')
    expect(call('read_article', { dir: projDir, project: '完全不相干的猜名' })).toContain('正文第一段')
  })

  it('尾段写法（只给分类/工程那一段）唯一命中才认；dir 匹配不到时报清楚该传什么', () => {
    expect(call('read_article', { dir: real })).toContain('正文第一段')
    expect(() => call('read_article', { dir: projDir + 'X' })).toThrow(/dir 没匹配到工程/)
  })

  it('create_project / list_projects 返回 dir，模型才有稳定标识可用', () => {
    const list = call('list_projects', {}) as { name: string; dir: string }[]
    expect(list.find((p) => p.name === real)?.dir).toBe(projDir)
  })
})
`

const p = 'src/main/__tests__/chatToolArgs.test.ts'
let body = readFileSync(p, 'utf8')
if (!body.includes("describe('dir 作为一等入参")) body += tests
writeFileSync(p, body)
console.log('appended:', body.includes('只给 dir 就能读到老文件'))
