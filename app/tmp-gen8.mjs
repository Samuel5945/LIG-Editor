import { readFileSync, writeFileSync } from 'fs'

const P = '月省千元不是梦：TokenRhythm如何用“自动选模”砍掉'

const tests = `
describe('工程名标点变体归一（2026-09-29 实测：模型把全角标点写成半角/「」，工具报 ENOENT 还让用户改名）', () => {
  const real = ${JSON.stringify(P)}
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lig-name-'))
    call('create_project', { name: real })
    call('write_article', { project: real, content: '# 标题\n\n正文第一段。' })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('半角冒号 + 直引号写法命中同一工程（原本直接被 assertSafeName 拒掉）', () => {
    const out = call('read_article', {
      project: '月省千元不是梦:TokenRhythm如何用"自动选模"砍掉'
    })
    expect(out).toContain('正文第一段')
  })

  it('「」替代全角引号也命中（早先会掉进兜底路径报 ENOENT workspace/<猜名>/project.json）', () => {
    expect(call('read_article', { project: '月省千元不是梦：TokenRhythm如何用「自动选模」砍掉' })).toContain('正文第一段')
  })

  it('真找不到的工程报候选名，不再吐文件系统错误', () => {
    expect(() => call('read_article', { project: '月省千元不是梦：Token砍掉' })).toThrow(/工程不存在/)
    expect(() => call('read_article', { project: '月省千元不是梦：Token砍掉' })).toThrow(/最接近的工程/)
  })
})
`

const p = 'src/main/__tests__/chatToolArgs.test.ts'
let body = readFileSync(p, 'utf8')
if (!body.includes('describe(\'工程名标点变体归一')) body += tests
writeFileSync(p, body)
console.log('appended:', body.includes('「」替代全角引号也命中'))
