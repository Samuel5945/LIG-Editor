/**
 * docx 交稿导出测试：核心是「扫描」阶段的纯函数断言——标题抽取、结构映射、
 * 装饰段跳过、加粗强调上色、图片缺源占位、空文档报错；以及 docx 产物合法性
 * （能打包成合法 OOXML zip + document.xml 含标题/表格）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { mdToDoc } from '../../shared/markdown'
import { scanStructure, makeDocxDocument, packDocx } from '../docxExport'

function md(text: string): ReturnType<typeof mdToDoc> {
  return mdToDoc(text)
}

describe('scanStructure', () => {
  it('抽取首个 H1 作标题', () => {
    const doc = md('# 标题甲\n\n正文\n\n## 小节')
    const s = scanStructure(doc, '工程名')
    expect(s.title).toBe('标题甲')
    expect(s.blocks[0]).toMatchObject({ kind: 'title', align: 'center' })
  })

  it('无 H1 回退工程名', () => {
    const doc = md('## 只有小节\n\n正文')
    const s = scanStructure(doc, '我的工程')
    expect(s.title).toBe('我的工程')
    expect(s.blocks[0].kind).toBe('h2')
  })

  it('忽略 fig-suggest 占位卡，不产生 skip 误报', () => {
    const doc = md('# T\n\n<!-- fig-suggest: 画一张示意图 -->\n\n正文')
    const s = scanStructure(doc, '工程')
    expect(s.empty).toBe(false)
    expect(s.blocks.map((b) => b.kind)).not.toContain('skip')
  })

  it('全为 fig-suggest / 空 → empty', () => {
    expect(scanStructure(md(''), '工程').empty).toBe(true)
    expect(scanStructure(md('<!-- fig-suggest: x -->'), '工程').empty).toBe(true)
  })

  it('正文排列 indent → 段首行缩进', () => {
    const doc = md('# T\n\n一段正文')
    const s = scanStructure(doc, '工程', { bodyAlign: 'indent' })
    const p = s.blocks.find((b) => b.kind === 'p')
    expect(p?.firstLine).toBe(true)
  })

  it('正文居中排列 → 段 align center', () => {
    const doc = md('# T\n\n居中段')
    const s = scanStructure(doc, '工程', { bodyAlign: 'center' })
    const p = s.blocks.find((b) => b.kind === 'p')
    expect(p?.align).toBe('center')
  })

  it('加粗强调 color 上主题强调色，纯加粗不强上色', () => {
    const doc = md('# T\n\n强调 **关键字** 与普通加粗 **双加**')
    // 两处加粗都应上色（strongStyle=color 时全部 bold run 上色），手动字色优先的覆盖在下个用例
    const s = scanStructure(doc, '工程', { strongStyle: 'color', accent: '#ff0000' })
    const p = s.blocks.find((b) => b.kind === 'p')
    expect(p).toBeDefined()
    const boldRuns = p!.runs.filter((r) => r.bold)
    expect(boldRuns.length).toBeGreaterThan(0)
    for (const r of boldRuns) expect(r.color).toBe('#ff0000')
  })

  it('手动字色优先于主题强调色', () => {
    const doc = md('# T\n\n<span style="color:#00ff00">**绿加粗**</span>')
    const s = scanStructure(doc, '工程', { strongStyle: 'color', accent: '#ff0000' })
    const p = s.blocks.find((b) => b.kind === 'p')
    expect(p).toBeDefined()
    const r = p!.runs.find((x) => x.text.includes('绿加粗'))
    expect(r?.bold).toBe(true)
    expect(r?.color).toBe('#00ff00') // 不被主题红覆盖
  })

  it('纯序号装饰段跳过', () => {
    const doc = md('# T\n\n一、\n\n正文\n\n1、')
    const s = scanStructure(doc, '工程')
    expect(s.blocks.map((b) => b.kind)).toEqual(['title', 'skip', 'p', 'skip'])
  })

  it('图片相对路径解析：存在返回绝对路径 / 缺源占位', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lig-docx-'))
    writeFileSync(join(dir, 'a.png'), 'x')
    const doc = md('# T\n\n![alt](a.png)')
    const s = scanStructure(doc, '工程', {}, (rel) => {
      const abs = join(dir, rel)
      try {
        readFileSync(abs)
        return abs
      } catch {
        return undefined
      }
    })
    expect(s.blocks.find((b) => b.kind === 'image')?.imageAbs).toBe(join(dir, 'a.png'))

    const doc2 = md('# T\n\n![alt](missing.png)')
    const s2 = scanStructure(doc2, '工程', {}, () => undefined)
    const ph = s2.blocks.find((b) => b.kind === 'p')
    expect(ph?.runs[0].text).toContain('【图片')
  })

  it('表格结构透传', () => {
    const doc = md('# T\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
    const s = scanStructure(doc, '工程')
    const tb = s.blocks.find((b) => b.kind === 'table')
    expect(tb?.table?.header).toEqual(['列A', '列B'])
    expect(tb?.table?.rows).toEqual([
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('引用块内容合并为 quote 块', () => {
    const doc = md('# T\n\n> 第一句\n> 第二句')
    const s = scanStructure(doc, '工程')
    const q = s.blocks.find((b) => b.kind === 'quote')
    expect(q).toBeDefined()
    expect(q!.runs.map((r) => r.text).join('')).toContain('第二句')
  })
})

describe('docx 产物', () => {
  it('能打包成合法 OOXML，document.xml 含标题文本', async () => {
    const doc = md('# 交稿标题\n\n正文一段 **加粗**\n\n## 小节标题\n\n| H | V |\n| --- | --- |\n| 甲 | 1 |')
    const document = await makeDocxDocument(doc, tmpdir(), '工程', { accent: '#ff0000' })
    const buf = await packDocx(document)
    // docx = zip：头两个字节 PK
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    // 用 docx 同款 jszip 解包（转义检查 XML 内容）
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buf)
    const xmlFile = zip.file('word/document.xml')
    expect(xmlFile).not.toBeNull()
    const xml = await xmlFile!.async('string')
    expect(xml).toContain('交稿标题')
    expect(xml).toContain('加粗')
    expect(xml).toContain('小节标题')
    // 表格结构（w:tbl）与单元格文本
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('甲')
  })

  it('空正文抛错', async () => {
    await expect(makeDocxDocument(md(''), tmpdir(), '工程')).rejects.toThrow(/正文为空|没有可导出/)
  })

  it('真实 PNG 正文图 + 封面嵌入成功（media 进包、正文含绘图引用）', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    const dir = mkdtempSync(join(tmpdir(), 'lig-docx-img-'))
    writeFileSync(join(dir, 'fig.png'), png)
    writeFileSync(join(dir, 'cover.png'), png)
    const doc = md('# 带图标题\n\n正文\n\n![说明](fig.png)\n<!-- caption: 一张说明图 -->')
    // cover 走 makeDocxDocument 的 coverAbs 参数
    const document = await makeDocxDocument(doc, dir, '工程', {}, join(dir, 'cover.png'))
    const buf = await packDocx(document)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buf)
    // 图片媒体进包（正文图）
    const mediaFiles = Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && !n.endsWith('/'))
    expect(mediaFiles.length).toBeGreaterThanOrEqual(1)
    // document.xml 含图片关系引用（封面 + 正文图各一）+ 图注
    const xml = await zip.file('word/document.xml')!.async('string')
    const blips = (xml.match(/r:embed="rId\d+"/g) ?? []).length
    expect(blips).toBeGreaterThanOrEqual(2)
    expect(xml).toContain('图 1｜一张说明图') // 正文图注
    // 无封面时正文图照常嵌入
    const doc2 = await makeDocxDocument(md('# T\n\n![x](fig.png)'), dir, '工程')
    const zip2 = await JSZip.loadAsync(await packDocx(doc2))
    expect(Object.keys(zip2.files).filter((n) => n.startsWith('word/media/') && !n.endsWith('/')).length).toBe(1)
  })
})
