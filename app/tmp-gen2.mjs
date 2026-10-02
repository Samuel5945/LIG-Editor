import { readFileSync, writeFileSync } from 'fs'

const tests = `
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
    expect(s.split('\\n')[0].length).toBeLessThan(200)
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
`

const p = 'src/shared/__tests__/chatTools.test.ts'
let body = readFileSync(p, 'utf8')
body = body.replace(
  "import { describe, expect, it } from 'vitest'",
  "import type { ChatToolSchema } from '@shared/types'\nimport { describe, expect, it } from 'vitest'"
)
body = body.replace(
  "  parseToolCallFence\n} from '../llmText'",
  "  parseToolCallFence,\n  toolsInventory\n} from '../llmText'\nimport { freeChatSystemPrompt } from '../prompts'"
)
if (!body.includes("describe('toolsInventory")) body += tests
writeFileSync(p, body)
console.log('type import:', body.includes('ChatToolSchema }'), '| fn import:', body.includes('toolsInventory\n}'), '| appended:', body.includes('局部改动（改一句'))
