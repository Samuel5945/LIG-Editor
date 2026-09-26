/**
 * 工程资产清单（projectStore.listProjectAssets，左栏工作树数据源）为什么要测这些：
 * 树的计数与深链完全依赖这份清单——白名单外的文件（chat/、根目录内部文件、非图片）
 * 一旦漏进树就会误导用户去点不可编辑的东西；cards 两层结构与目录缺失的容错也在这里钉死。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AppPaths } from '@shared/types'

// projectStore 传递依赖 wechatStore（electron safeStorage）：与 store 系测试同款假实现
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => Buffer.from(b).toString().replace(/^enc:/, '')
  }
}))

// 工程目录定位走 ./paths 的临时目录（真实 fs 摆夹具，不做内存 fake）
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

import { listProjectAssets } from '../projectStore'
import { getAppPaths } from '../paths'

/** 在 workspace/<分类>/<工程>/ 下按约定摆一套工程目录 */
function makeProject(name: string, category: string, files: Record<string, string>): string {
  const projectDir = join(getAppPaths().workspace, category, name)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(projectDir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  writeFileSync(join(projectDir, 'project.json'), '{}')
  return projectDir
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lig-assets-'))
  mkdirSync(join(dir, 'workspace'), { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('listProjectAssets', () => {
  it('按白名单目录分组、过滤非图片与非 html，cards 收两层，相对路径正斜杠', () => {
    makeProject('荣耀新LOGO', '科技数码', {
      'assets/a.png': 'png',
      'assets/cover.webp': 'webp',
      'assets/note.txt': '不是图片',
      'figures/fig-01.html': '<svg/>',
      'figures/fig-2.html': '<svg/>',
      'figures/readme.md': '不是图表',
      'covers/cover-wide.html': '<div/>',
      'cards/xhs/card-1.png': 'png',
      'cards/xhs/card-2.png': 'png',
      'cards/wechat/card-1.png': 'png',
      'cards/stray.txt': 'cards 根下的散文件不算卡片',
      '交付/荣耀新LOGO-交稿.docx': 'docx',
      '交付/荣耀新LOGO-交稿.pdf': 'pdf',
      'chat/s1.json': '会话历史不入树',
      'article.md': '正文',
      'article.html': '导出物勿手改',
      'cards.json': '卡片组元数据不入树'
    })
    expect(listProjectAssets('荣耀新LOGO')).toEqual({
      figures: ['figures/fig-01.html', 'figures/fig-2.html'],
      assets: ['assets/a.png', 'assets/cover.webp'],
      covers: ['covers/cover-wide.html'],
      cards: ['cards/wechat/card-1.png', 'cards/xhs/card-1.png', 'cards/xhs/card-2.png'],
      deliveries: ['交付/荣耀新LOGO-交稿.docx', '交付/荣耀新LOGO-交稿.pdf']
    })
  })

  it('目录缺失时对应组为空数组（新建工程只有约定子目录）', () => {
    makeProject('新工程', '未分类', { 'article.md': '# 新工程' })
    expect(listProjectAssets('新工程')).toEqual({
      figures: [],
      assets: [],
      covers: [],
      cards: [],
      deliveries: []
    })
  })

  it('工程不存在时抛错', () => {
    expect(() => listProjectAssets('不存在的工程')).toThrow(/工程不存在/)
  })
})
