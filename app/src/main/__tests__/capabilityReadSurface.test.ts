/**
 * 能力核读侧对称与新增工具面（缺口一/二/三一起钉）
 *
 * 为什么要钉：2026-09-29 那次「菜单/IPC 有能力 ≠ 对话有能力」的教训（export_pdf 漏在注册表里，
 * 对话只能教用户 Ctrl+P）同样发生在 MCP 侧——贴图卡组、封面模板、选题库、主题库、Skill 库
 * 都只有 IPC 或只有写入口，外部 Agent 读不到就编排不了。这里把「有读、有写、报错不静默」钉成测试。
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppPaths } from '@shared/types'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'lig-test',
    getAppPath: () => tmpdir(),
    getVersion: () => 'test'
  },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { writeText: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  shell: { openPath: async () => '' },
  net: { fetch: async () => ({}) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => Buffer.from(b).toString().replace(/^enc:/, '')
  }
}))

let dir = ''
vi.mock('../paths', () => ({
  getAppPaths: (): AppPaths => ({
    root: dir,
    workspace: join(dir, 'workspace'),
    skills: join(dir, 'skills'),
    settings: join(dir, 'settings'),
    ideaInbox: join(dir, 'idea-inbox.md')
  })
}))

import { listExecTools, TOOLS } from '../capabilityCore'
import * as store from '../projectStore'

function call(name: string, args: Record<string, unknown>): any {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`工具未注册：${name}`)
  return tool.handler(args)
}

const names = () => TOOLS.map((t) => t.name)
const P = '读侧对称验证工程'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lig-capability-surface-'))
  // 真实启动时 paths.ts 会把这三个目录建出来；测试里 mock 了 paths，就得自己补
  for (const d of ['workspace', 'settings', 'skills']) mkdirSync(join(dir, d), { recursive: true })
  call('create_project', { name: P })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('工具面覆盖', () => {
  it('IPC 已有的能力都进了注册表（贴图/封面/选题/主题/Skill/工程治理）', () => {
    for (const n of [
      'read_cards',
      'write_cards',
      'render_card',
      'render_cover_template',
      'list_ideas',
      'schedule_idea',
      'list_themes',
      'set_active_theme',
      'delete_theme',
      'list_skills',
      'save_skill',
      'set_project_skill',
      'rename_project',
      'delete_project',
      'list_project_assets',
      'find_duplicate_projects',
      'get_guide',
      'render_preview'
    ])
      expect(names()).toContain(n)
  })

  it('带 project 的新工具自动收 dir；零参数工具不被加 dir', () => {
    const props = (t: (typeof TOOLS)[number]): Record<string, unknown> => t.inputSchema.properties as Record<string, unknown>
    for (const t of TOOLS.filter((x) => props(x).project)) expect('dir' in props(t), t.name + ' 应自动带 dir').toBe(true)
    expect(names()).toContain('list_projects')
    expect('dir' in props(TOOLS.find((t) => t.name === 'list_projects') as (typeof TOOLS)[number])).toBe(false)
  })

  it('内部对话拿不到 render_preview（base64 不进对话），外部 Agent 拿得到', () => {
    const exec = listExecTools().map((t) => t.name)
    expect(exec).not.toContain('render_preview')
    expect(exec).toContain('read_cards')
    expect(exec).toContain('get_guide')
    for (const t of exec) expect(t.endsWith('_prompt')).toBe(false)
  })
})

describe('贴图卡组读写', () => {
  it('没建过卡组时 read_cards 说清下一步，而不是返回 null 让模型猜', () => {
    expect(() => call('read_cards', { project: P })).toThrow(/还没有贴图卡组/)
  })

  it('write_cards 落盘后可读回，白名单外的字段如实报 droppedKeys', () => {
    const r = call('write_cards', {
      project: P,
      deck: {
        format: 'xhs',
        accent: '#7c3aed',
        caption: '配图发小红书',
        cards: [
          { title: '封面卡', body: '三句话讲完', bgPrompt: '纯色底' },
          { title: '第二张', body: '要点一\n要点二', numbered: true, myOwnField: 'x' }
        ]
      }
    })
    expect(r.ok).toBe(true)
    expect(r.count).toBe(2)
    expect(r.droppedKeys).toEqual(['第2张.myOwnField'])
    const back = call('read_cards', { project: P })
    expect(back.format).toBe('xhs')
    expect(back.card_count).toBe(2)
    expect(back.rendered_count).toBe(0)
    expect(back.hint).toMatch(/还没有 PNG|全部已出图|render_card/)
    // 与向导立项同规：有卡组即贴图形态
    expect(store.readMeta(P).format).toBe('cards')
  })

  it('archive:true 只写存档、不动当前卡组，读回走 read_cards 的 archive', () => {
    call('write_cards', { project: P, deck: { format: 'wechat', cards: [{ title: '线上版', body: 'a' }] } })
    const r = call('write_cards', {
      project: P,
      archive: true,
      deck: { format: 'xhs', cards: [{ title: '存档版', body: 'b' }] }
    })
    expect(r.archived).toBe(true)
    expect(call('read_cards', { project: P }).cards[0].title).toBe('线上版')
    expect(call('read_cards', { project: P, archive: 'xhs' }).cards[0].title).toBe('存档版')
    expect(() => call('read_cards', { project: P, archive: 'wechat' })).toThrow(/存档/)
  })

  it('卡片下标越界时报出合法范围（0 基）', async () => {
    call('write_cards', { project: P, cards: [{ title: '只有一张', body: '正文' }] })
    await expect(call('render_card', { project: P, index: 5 })).rejects.toThrow(/0-0/)
  })

  it('空数组与空卡片都拦得住', () => {
    // 空数组在数组归一层就被拦（口径与其它数组入参一致），轮不到卡组校验那一步
    expect(() => call('write_cards', { project: P, deck: { format: 'wechat', cards: [] } })).toThrow(/不能为空/)
    expect(() =>
      call('write_cards', { project: P, deck: { format: 'wechat', cards: [{ title: '', body: '   ' }] } })
    ).toThrow(/第 1 张/)
  })
})

describe('主题库与 Skill 库', () => {
  it('list_themes 默认不回主题对象，detail 才回', () => {
    call('save_theme_preset', { name: '清新蓝调', category: '科技数码', theme: { accent: '#2563eb', lineHeight: 1.8 } })
    const lite = call('list_themes', {})
    expect(lite.count).toBe(1)
    expect(lite.themes[0].theme).toBeUndefined()
    expect(lite.themes[0].fields).toBeGreaterThan(1)
    expect(lite.active[0]).toEqual({ category: '科技数码', name: '清新蓝调' })
    const full = call('list_themes', { detail: true })
    expect(full.themes[0].theme.accent).toBe('#2563eb')
  })

  it('主题名写错时把库里现有的名字一起报出来', () => {
    expect(() => call('set_active_theme', { category: '科技数码', name: '不存在的气质' })).toThrow(/库里现有主题/)
  })

  it('删除主题必须显式 confirm；名字不存在不得谎报 deleted', () => {
    expect(() => call('delete_theme', { name: '清新蓝调' })).toThrow(/未执行/)
    const r = call('delete_theme', { name: '清新蓝调', confirm: true })
    expect(r.deleted).toBe(false)
    expect(r.hint).toMatch(/本来就不在库里/)
  })

  it('save_skill 存的挂载名可读回；挂不存在的 Skill 会列可用名', () => {
    call('save_skill', { name: '口语短句', content: '# 口语短句\n\n每句不超过 15 字。' })
    const list = call('list_skills', {})
    expect(list.skills.map((s: { name: string }) => s.name)).toContain('口语短句')
    call('set_project_skill', { project: P, skill: '口语短句' })
    expect(store.readMeta(P).style_skill).toBe('口语短句')
    expect(() => call('set_project_skill', { project: P, skill: '没这本' })).toThrow(/本机可用：/)
    call('set_project_skill', { project: P, skill: null })
    expect(store.readMeta(P).style_skill).toBeUndefined()
  })
})

describe('选题库读取与立项', () => {
  it('save_ideas 之后能 list 出来，并按 index 立项排期', () => {
    call('save_ideas', {
      ideas: [{ title: '选题甲', angle: '反常识', audience: '自媒体新人', score: 8, reason: '正当季' }]
    })
    const r = call('list_ideas', {})
    expect(r.count).toBe(1)
    expect(r.ideas[0].index).toBe(0)
    const created = call('schedule_idea', { index: 0, date: '2026-11-02' })
    expect(created.plannedAt).toBe('2026-11-02')
    expect(call('list_projects', {}).map((p: { name: string }) => p.name)).toContain(created.name)
    expect(() => call('schedule_idea', { index: 0, date: '11-02' })).toThrow(/非法排期日期/)
  })
})

describe('工程治理', () => {
  it('改名会清洗名字并如实说清洗了什么，旧名当场失效', async () => {
    const r = await call('rename_project', {
      project: P,
      new_name: '带 / 非法字符的很长很长很长很长很长很长很长很长很长很长名字'
    })
    expect(r.name).not.toContain('/')
    expect(r.hint).toMatch(/清洗过/)
    expect(() => call('get_project', { project: P })).toThrow(/工程不存在/)
    expect(() => call('get_project', { dir: r.dir })).not.toThrow()
  })

  it('删除工程必须 confirm；删完如实回报目录是否真的没了', async () => {
    await expect(call('delete_project', { project: P })).rejects.toThrow(/未执行/)
    const r = await call('delete_project', { project: P, confirm: true })
    expect(r.deleted).toBe(true)
    expect(call('list_projects', {})).toHaveLength(0)
  })

  it('素材清单与同名工程查询在空仓库上不炸，并给出可读的 hint', () => {
    const a = call('list_project_assets', { project: P })
    expect(a.total).toBe(0)
    expect(a.hint).toMatch(/还没有任何素材/)
    expect(a.root).toBe(store.projectDir(P))
    expect(call('find_duplicate_projects', {}).count).toBe(0)
  })

  it('set_cover 收工程内绝对路径时折成相对路径存（Agent 常把上一步返回的路径原样传回）', () => {
    const assets = join(store.projectDir(P), 'assets')
    mkdirSync(assets, { recursive: true })
    writeFileSync(join(assets, 'cover.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
    const r = call('set_cover', { project: P, main: join(assets, 'cover.png') })
    expect(r.cover.main).toBe('assets/cover.png')
    expect(r.main_abs).toBe(join(store.projectDir(P), 'assets/cover.png'))
    expect(store.readMeta(P).cover?.main).toBe('assets/cover.png')
    expect(() => call('set_cover', { project: P, main: join(tmpdir(), 'outside.png') })).toThrow(/不在本工程内/)
  })
})

describe('get_guide 手册', () => {
  it('省略 topic 只给目录；theme 册由元数据单源生成，覆盖 schema 里易漏的字段', () => {
    const idx = call('get_guide', {})
    expect(idx.topics.map((t: { topic: string }) => t.topic)).toEqual([
      'pipeline',
      'markdown',
      'theme',
      'cards',
      'publish'
    ])
    const theme = call('get_guide', { topic: 'theme' }).guide as string
    for (const key of ['accent', 'lineHeight', 'imgStyle', 'imgFrame', 'imgGap', 'captionAlign', 'h2Num'])
      expect(theme).toContain(key)
    expect(call('get_guide', { topic: 'cards' }).guide).toContain('bgOpacity')
  })

  it('没有的手册如实报错并列出可查清单', () => {
    expect(() => call('get_guide', { topic: 'nope' })).toThrow(/可查：pipeline/)
  })
})

describe('save_outline（从成文反推大纲）', () => {
  it('写入 outline.md 可经 read_article 回读，且绝不碰 article.md 与状态机', async () => {
    call('write_article', { project: P, content: '# 标题\n\n正文一段' })
    const articleBefore = call('read_article', { project: P })
    const statusBefore = store.readMeta(P).status

    const r = await call('save_outline', { project: P, outline: '# 标题\n## 第一节\n说明' })
    expect(r).toEqual({ ok: true, file: 'outline.md' })
    expect(call('read_article', { project: P, file: 'outline.md' })).toBe('# 标题\n## 第一节\n说明\n')
    // 成文一个字没动（这是反推大纲的红线），选题状态机也不因大纲落盘推进
    expect(call('read_article', { project: P })).toBe(articleBefore)
    expect(store.readMeta(P).status).toBe(statusBefore)
  })

  it('get_guide 的 pipeline 册写明反推口径：只写 outline.md、绝不改 article.md', () => {
    const guide = call('get_guide', { topic: 'pipeline' }).guide as string
    expect(guide).toContain('save_outline')
    expect(guide).toContain('绝不改 article.md')
  })
})

describe('爆款拆解双工具（teardown_prompt / save_teardown）', () => {
  it('teardown_prompt：传 article 拆外部文章；不传读工程正文；两边都空如实报错', async () => {
    const ext = await call('teardown_prompt', { project: P, article: '# 外部爆款\n\n正文' })
    expect(ext.messages[1].content).toContain('# 外部爆款')
    expect(ext.next).toContain('save_teardown')

    await call('write_article', { project: P, content: '# 工程正文\n\n一段' })
    const own = await call('teardown_prompt', { project: P })
    expect(own.messages[1].content).toContain('# 工程正文')

    // 正文为空且未传 article：没有可拆解的内容，报错别装成功（新建工程自带 # 标题 骨架行，先清空）
    call('create_project', { name: P + '-空' })
    store.writeTextFile(P + '-空', 'article.md', '')
    expect(() => call('teardown_prompt', { project: P + '-空' })).toThrow(/没有可拆解/)
  })

  it('save_teardown 写入可回读，绝不碰 article.md 与状态机', async () => {
    call('write_article', { project: P, content: '# 标题\n\n正文一段' })
    const articleBefore = call('read_article', { project: P })
    const statusBefore = store.readMeta(P).status

    const r = await call('save_teardown', { project: P, report: '# 爆款拆解\n## 标题与钩子\n数字+悬念' })
    expect(r).toEqual({ ok: true, file: 'teardown.md' })
    expect(call('read_article', { project: P, file: 'teardown.md' })).toBe('# 爆款拆解\n## 标题与钩子\n数字+悬念\n')
    expect(call('read_article', { project: P })).toBe(articleBefore)
    expect(store.readMeta(P).status).toBe(statusBefore)
  })
})
