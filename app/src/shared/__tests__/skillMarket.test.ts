import { describe, it, expect } from 'vitest'
import { parseCatalog, mergeCatalogs, filterMarketEntries, marketCategories, installDirective } from '../skillMarket'
import type { SkillMarketEntry } from '../types'

describe('parseCatalog（容错解析，永不抛错）', () => {
  it('合法目录解析出条目，字段归一', () => {
    const c = parseCatalog(
      '{"version":2,"entries":[{"name":" a ","description":"描述","category":"选题","recommended":true,"ref":"o/r"},{"name":"b"}]}'
    )
    expect(c).not.toBeNull()
    expect(c?.version).toBe(2)
    expect(c?.entries[0]).toEqual({
      name: 'a',
      description: '描述',
      category: '选题',
      recommended: true,
      ref: 'o/r',
      official: false
    })
    // 非官方且没 ref 的条目装不了，直接丢弃
    expect(c?.entries).toHaveLength(1)
  })

  it('HTML / 损坏 JSON / 非对象 / entries 非数组 → null', () => {
    expect(parseCatalog('<!doctype html><html></html>')).toBeNull()
    expect(parseCatalog('{source:github}')).toBeNull()
    expect(parseCatalog('"just a string"')).toBeNull()
    expect(parseCatalog('{"entries":"no"}')).toBeNull()
  })

  it('残缺条目逐条丢弃，好的保留；official 条目允许没 ref', () => {
    const c = parseCatalog(
      '{"entries":[{"description":"没名字"},{"name":"官方件","official":true},{"name":42},{"name":"好的","ref":"o/r"}]}'
    )
    expect(c?.entries.map((e) => e.name)).toEqual(['官方件', '好的'])
    expect(c?.entries[0].ref).toBeUndefined()
  })

  it('描述截断 200 字，缺分类归「其他」，recommended 仅认 true', () => {
    const c = parseCatalog(
      `{"entries":[{"name":"x","ref":"o/x","description":"${'长'.repeat(300)}"},{"name":"y","ref":"o/y","recommended":"yes"}]}`
    )
    expect(c?.entries[0].description).toHaveLength(200)
    expect(c?.entries[0].category).toBe('其他')
    expect(c?.entries[1].recommended).toBe(false)
  })
})

const BUILTIN: SkillMarketEntry[] = [
  { name: 'official-a', description: '旧描述', category: '选题', recommended: true, official: true },
  { name: 'official-b', description: '另一件', category: '成文', official: true }
]

describe('mergeCatalogs（同名在线覆盖、位置稳定）', () => {
  it('无在线目录时全部标 builtin', () => {
    const items = mergeCatalogs(BUILTIN, null)
    expect(items.map((i) => i.origin)).toEqual(['builtin', 'builtin'])
  })

  it('同名条目以在线元数据为准（含 official 降级为可引用 ref 的在线版），槽位保持', () => {
    const online = {
      entries: [
        { name: 'official-a', description: '新描述', category: '选题', recommended: true, ref: 'o/new-a', official: false }
      ]
    }
    const items = mergeCatalogs(BUILTIN, online)
    expect(items).toHaveLength(2) // 不追加，只覆盖
    expect(items[0]).toMatchObject({ name: 'official-a', description: '新描述', ref: 'o/new-a', official: false, origin: 'online' })
    expect(items[1].name).toBe('official-b')
  })

  it('在线独有条目按序追加在后，标 online', () => {
    const items = mergeCatalogs(BUILTIN, {
      entries: [
        { name: 'z-extra', description: '', category: '效率', ref: 'o/z' },
        { name: 'a-extra', description: '', category: '效率', ref: 'o/a' }
      ]
    })
    expect(items.map((i) => i.name)).toEqual(['official-a', 'official-b', 'z-extra', 'a-extra'])
    expect(items.slice(2).map((i) => i.origin)).toEqual(['online', 'online'])
  })
})

describe('filterMarketEntries / marketCategories', () => {
  const items = mergeCatalogs(BUILTIN, {
    entries: [{ name: 'web-writer', description: '网络成文助手', category: '成文', ref: 'o/w' }]
  })

  it('关键词匹配名称或描述，不区分大小写', () => {
    expect(filterMarketEntries(items, 'WRITER', '').map((i) => i.name)).toEqual(['web-writer'])
    // 「成文」只命中 web-writer 的描述；official-b 名为英文、描述是「另一件」，不因分类同名而误中
    expect(filterMarketEntries(items, '成文', '').map((i) => i.name)).toEqual(['web-writer'])
    expect(filterMarketEntries(items, '  官方  ', '')).toHaveLength(0) // 名称描述里没有这三个字
  })

  it('分类过滤可与关键词叠加；空串 = 全部', () => {
    expect(filterMarketEntries(items, '', '成文')).toHaveLength(2)
    expect(filterMarketEntries(items, 'official', '成文')).toHaveLength(1)
    expect(filterMarketEntries(items, '', '不存在的分类')).toHaveLength(0)
  })

  it('分类清单按首现顺序去重', () => {
    expect(marketCategories(items)).toEqual(['选题', '成文'])
  })
})

describe('installDirective（条目 → 既有安装链路）', () => {
  it('官方条目走包内复制通道，返回 null', () => {
    expect(installDirective({ name: 'a', ref: undefined, official: true })).toBeNull()
  })

  it('GitHub 形（blob/raw 直链、owner/repo 短引）走 github 源', () => {
    expect(installDirective({ name: 'a', ref: 'owner/repo', official: false })).toEqual({
      source: 'github',
      ref: 'owner/repo',
      name: 'a'
    })
    expect(installDirective({ name: 'a', ref: 'https://github.com/o/r/blob/main/SKILL.md', official: false })?.source).toBe('github')
    expect(installDirective({ name: 'a', ref: 'https://raw.githubusercontent.com/o/r/main/SKILL.md', official: false })?.source).toBe(
      'github'
    )
  })

  it('其余 https 直链走 url 源；识别不了返回 null；无 ref 同样 null', () => {
    expect(installDirective({ name: 'a', ref: 'https://cdn.example.com/SKILL.md', official: false })?.source).toBe('url')
    expect(installDirective({ name: 'a', ref: 'ftp://x/y', official: false })).toBeNull()
    expect(installDirective({ name: 'a', ref: undefined, official: false })).toBeNull()
  })
})
