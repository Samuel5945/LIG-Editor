// @vitest-environment jsdom
/**
 * 大纲步落地即带出（回归走查 2026-11-01 实锤的断点修复）：
 * 已立项工程从对话深链（save_outline 落盘后的「去大纲步查看并拖拽重排」）或手动切到大纲步时，
 * 会话相位还在 input——修复前永远落在「尚无大纲」空态，反推→重排闭环断在重排。
 * 修复后：磁盘有 outline.md 就直接进 outline 相位，条目可拖拽重排。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { createElement as h } from 'react'
import CreationWizard from '../components/wizard/CreationWizard'
import { installApiStub, installDomShims, type ApiStub } from './helpers/ipcStub'

installDomShims()

let api: ApiStub

const props = () =>
  ({
    project: '演示工程',
    meta: null,
    article: '# 标题\n\n正文一段',
    skill: null,
    seed: null,
    hasCards: false,
    reviewExists: false,
    stepRequest: { id: 'outline', ts: 1 },
    projectDir: '',
    draftBody: null,
    titlecoverBody: null,
    reviewBody: null,
    exportBody: null,
    onFlushArticle: () => Promise.resolve(),
    onArticleGenerated: vi.fn(),
    onOpenProject: () => Promise.resolve(),
    onProjectsChanged: vi.fn(),
    onIdeasChanged: vi.fn(),
    onFigFromList: vi.fn(),
    onFigReplaceImage: vi.fn(),
    onLocateInEditor: vi.fn(),
    onToast: vi.fn()
  }) as Parameters<typeof CreationWizard>[0]

beforeEach(() => {
  api = installApiStub()
  api.on('settings:getLlm', () => ({ providers: [], textProviderId: '' }))
  api.on('project:readFile', (_p: string, file: string) => (file === 'outline.md' ? '# 外部反推的大纲\n\n## 第一节\n说明一\n\n## 第二节\n说明二' : ''))
})

afterEach(cleanup)

describe('大纲步落地即带出', () => {
  it('已立项工程深链到大纲步：磁盘 outline.md 直接进相位展示可拖拽条目（不再落「尚无大纲」空态）', async () => {
    render(h(CreationWizard, props()))
    // 条目出现（标题 + 两个小节），且可拖拽
    expect(await screen.findByDisplayValue('# 外部反推的大纲')).toBeTruthy()
    expect(screen.getByDisplayValue('## 第一节')).toBeTruthy()
    expect(screen.getByDisplayValue('## 第二节')).toBeTruthy()
    const draggables = document.querySelectorAll('div[draggable="true"]')
    expect(draggables.length).toBe(3)
    // 不再是「尚无大纲」空态
    expect(screen.queryByText(/尚无大纲/)).toBeNull()
  })

  it('工程没有 outline.md 时维持「尚无大纲」引导（不硬造空相位）', async () => {
    api.on('project:readFile', (_p: string, file: string) => (file === 'outline.md' ? '' : ''))
    render(h(CreationWizard, props()))
    await screen.findByText(/尚无大纲/)
    expect(document.querySelectorAll('div[draggable="true"]').length).toBe(0)
  })
})
