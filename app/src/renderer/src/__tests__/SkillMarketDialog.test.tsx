// @vitest-environment jsdom
/**
 * Skill 市场弹窗（v1）交互测试：主进程侧全部换成可编程桩，钉住四条行为契约——
 * 1. 目录列表渲染内置+在线条目，已安装/未安装状态如实，离线原因明示；
 * 2. 搜索框即时过滤目录；
 * 3. 官方条目走 skill:market:resolveOfficial 出预览，安装走既有 skill:installResolved 落盘并通知左栏；
 * 4. 检出脚本依赖的条目阻断安装（与对话安装确认卡同一口径），在线 ref 走 skill:resolve 链路。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { createElement as h } from 'react'
import { SkillMarketDialog } from '../components/SkillMarketDialog'
import { installApiStub, installDomShims, type ApiStub } from './helpers/ipcStub'
import type { MarketCatalogState } from '@shared/types'

installDomShims()

let api: ApiStub
const onToast = vi.fn()
const onInstalled = vi.fn()
const onClose = vi.fn()

const CATALOG: MarketCatalogState = {
  items: [
    { name: 'demo-skill', description: '官方演示条目', category: '选题', recommended: true, official: true, origin: 'builtin' },
    { name: 'web-skill', description: '来自网络的条目', category: '效率', ref: 'owner/web-repo', origin: 'online' }
  ],
  offline: true,
  onlineAt: null,
  offlineReason: '未配置在线目录源，展示内置精选目录'
}

const OFFICIAL_PREVIEW = {
  name: 'demo-skill',
  description: '官方演示条目',
  content: '# 官方演示 SKILL 正文',
  origin: '官方预装包',
  exists: false,
  scriptDep: null
}

beforeEach(() => {
  api = installApiStub()
  onToast.mockClear()
  onInstalled.mockClear()
  onClose.mockClear()
  api.on('skill:market:get', () => CATALOG)
  api.on('skill:market:getConfig', () => ({ catalogUrl: '' }))
  api.on('skill:market:refresh', () => ({ ...CATALOG, offline: false, onlineAt: '2026-11-01T10:00:00.000Z' }))
  api.on('skill:market:resolveOfficial', () => OFFICIAL_PREVIEW)
  api.on('skill:resolve', () => ({
    name: 'web-skill',
    description: '来自网络的条目',
    content: '# 网络 SKILL 正文',
    origin: 'https://raw.githubusercontent.com/owner/web-repo/HEAD/SKILL.md',
    exists: false,
    scriptDep: null
  }))
  api.on('skill:installResolved', (name: string) => name)
  render(
    h(SkillMarketDialog, {
      installedNames: ['demo-skill'],
      onInstalled,
      onToast,
      onClose
    })
  )
})

afterEach(cleanup)

describe('目录列表', () => {
  it('渲染内置+在线条目；已安装/未安装状态如实；离线原因明示不静默', async () => {
    expect(await screen.findByText('demo-skill')).toBeTruthy()
    expect(screen.getByText('web-skill')).toBeTruthy()
    expect(screen.getByText('已安装')).toBeTruthy()
    expect(screen.getByText('未安装')).toBeTruthy()
    expect(screen.getByText(/未配置在线目录源/)).toBeTruthy()
    expect(screen.getByText(/编辑推荐/)).toBeTruthy()
  })

  it('搜索框即时过滤（名称与描述，不分大小写）', async () => {
    await screen.findByText('demo-skill')
    fireEvent.change(screen.getByPlaceholderText('搜索名称或描述'), { target: { value: '网络' } })
    expect(screen.queryByText('demo-skill')).toBeNull()
    expect(screen.getByText('web-skill')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('搜索名称或描述'), { target: { value: 'zzz-不存在的词' } })
    expect(screen.getByText('没有匹配的 Skill')).toBeTruthy()
  })
})

describe('官方条目：包内解析 → 预览 → 安装', () => {
  it('点卡片出预览（resolveOfficial），确认后走 installResolved 并通知左栏刷新', async () => {
    fireEvent.click(await screen.findByText('demo-skill'))
    const installBtn = await screen.findByRole('button', { name: '安装' })
    expect(await screen.findByText('# 官方演示 SKILL 正文')).toBeTruthy()
    expect(api.callsOf('skill:market:resolveOfficial')).toHaveLength(1)
    // 主进程报未装过 → 无覆盖警示，主按钮是「安装」而非「覆盖安装」
    expect(screen.queryByText(/装完会覆盖/)).toBeNull()

    fireEvent.click(installBtn)
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('已安装 Skill：demo-skill'))
    expect(api.callsOf('skill:installResolved')[0]).toEqual(['demo-skill', '# 官方演示 SKILL 正文'])
    expect(onInstalled).toHaveBeenCalled()
    // 装完回列表，状态角标翻成已安装（本地即时标记）
    await waitFor(() => expect(screen.getAllByText('已安装').length).toBeGreaterThanOrEqual(1))
  })

  it('同名已存在（主进程报 exists）→ 主按钮转「覆盖安装」并带覆盖警示', async () => {
    api.on('skill:market:resolveOfficial', () => ({ ...OFFICIAL_PREVIEW, exists: true }))
    fireEvent.click(await screen.findByText('demo-skill'))
    expect(await screen.findByText(/已存在同名 Skill，装完会覆盖/)).toBeTruthy()
    expect(await screen.findByRole('button', { name: '覆盖安装' })).toBeTruthy()
  })

  it('脚本依赖条目阻断安装：没有安装按钮，警示文案与对话安装卡同口径', async () => {
    api.on('skill:market:resolveOfficial', () => ({ ...OFFICIAL_PREVIEW, scriptDep: '需要执行 Python 脚本：run.py' }))
    fireEvent.click(await screen.findByText('demo-skill'))
    expect(await screen.findByText(/检测到依赖脚本执行/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull()
  })
})

describe('在线条目：走既有 skill:resolve 链路', () => {
  it('github 短引用按 source=github 交给解析链路（吃镜像竞速）', async () => {
    fireEvent.click(await screen.findByText('web-skill'))
    expect(await screen.findByText('# 网络 SKILL 正文')).toBeTruthy()
    expect(api.callsOf('skill:resolve')[0][0]).toEqual({ source: 'github', ref: 'owner/web-repo', name: 'web-skill' })
  })

  it('解析失败：详情内如实展示错误，不崩不静默', async () => {
    api.on('skill:resolve', () => {
      throw new Error('5 个候选地址全部下载失败')
    })
    fireEvent.click(await screen.findByText('web-skill'))
    expect(await screen.findByText(/5 个候选地址全部下载失败/)).toBeTruthy()
  })
})
