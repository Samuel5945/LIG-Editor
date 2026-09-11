/**
 * 分类级账号预设（账号 = 分类）存储测试。
 * 核心是**多字段后的 GC 语义**：旧实现只看 style_skill 是否为空来决定删不删整条预设，
 * 补了第二个字段后若不同步改，「只配了默认平台」的账号会被静默抹掉——这里钉死。
 * 其余覆盖：增量写入互不覆盖、字段各自校验、盘上脏值读取时剔除、重命名迁移 key。
 *
 * 走真实临时目录（与 docxExport.test.ts 同法），只 mock 掉会牵进 electron 的 paths 与 skillStore。
 */
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../paths', async () => {
  const { mkdtempSync } = await import('fs')
  const { join: pjoin } = await import('path')
  const { tmpdir } = await import('os')
  const dir = mkdtempSync(pjoin(tmpdir(), 'lig-preset-'))
  return { getAppPaths: () => ({ root: dir, workspace: dir, settings: dir }) }
})

vi.mock('../skillStore', () => ({
  readSkill: (name: string) => {
    if (name !== 'khazix-writer' && name !== 'wechat-viral-topic') throw new Error(`Skill 不存在：${name}`)
    return { name }
  }
}))

import { getAppPaths } from '../paths'
import {
  deleteCategoryPreset,
  listCategoryPresets,
  renameCategoryPreset,
  saveCategoryPreset
} from '../categoryPresetStore'
import type { PlatformId } from '@shared/types'

const presetFile = (): string => join(getAppPaths().settings, 'categoryPresets.json')
const writeRaw = (value: unknown): void => writeFileSync(presetFile(), JSON.stringify(value), 'utf8')
const readRaw = (): unknown => JSON.parse(readFileSync(presetFile(), 'utf8'))

beforeEach(() => {
  try {
    unlinkSync(presetFile())
  } catch {
    // 首轮尚无该文件，正常
  }
})

describe('分类级账号预设', () => {
  it('文件不存在时降级为空预设', () => {
    expect(listCategoryPresets()).toEqual({})
  })

  it('只配默认平台也能存住（回归：旧实现会因 style_skill 为空而删掉整条预设）', () => {
    saveCategoryPreset('科技数码', { default_platform: 'zhihu' })
    expect(listCategoryPresets()['科技数码']).toEqual({ default_platform: 'zhihu' })
    expect(readRaw()).toEqual({ 科技数码: { default_platform: 'zhihu' } })
  })

  it('增量写入互不覆盖，未提及字段保持原值', () => {
    saveCategoryPreset('科技数码', { style_skill: 'khazix-writer' })
    saveCategoryPreset('科技数码', { default_platform: 'toutiao' })
    expect(listCategoryPresets()['科技数码']).toEqual({
      style_skill: 'khazix-writer',
      default_platform: 'toutiao'
    })
  })

  it('清除单个字段保留其余；清空最后一项才删除整条', () => {
    saveCategoryPreset('生活常识', { style_skill: 'khazix-writer', default_platform: 'baijiahao' })
    saveCategoryPreset('生活常识', { style_skill: null })
    expect(listCategoryPresets()['生活常识']).toEqual({ default_platform: 'baijiahao' })
    saveCategoryPreset('生活常识', { default_platform: null })
    expect(listCategoryPresets()['生活常识']).toBeUndefined()
    expect(readRaw()).toEqual({})
  })

  it('未知平台与未安装 Skill 各自报错，且不产生任何落盘', () => {
    expect(() => saveCategoryPreset('科技数码', { default_platform: 'douyin' as PlatformId })).toThrow(/未知分发平台/)
    expect(() => saveCategoryPreset('科技数码', { style_skill: 'ghost-skill' })).toThrow(/Skill 不存在/)
    expect(listCategoryPresets()).toEqual({})
    expect(() => readFileSync(presetFile(), 'utf8')).toThrow()
  })

  it('盘上手写脏值读取时剔除：空串、未知平台、非对象条目', () => {
    writeRaw({
      科技数码: { style_skill: '', default_platform: 'douyin' },
      生活常识: { style_skill: 'khazix-writer', default_platform: 'zhihu' },
      坏条目: null,
      也坏: 'x'
    })
    expect(listCategoryPresets()).toEqual({
      生活常识: { style_skill: 'khazix-writer', default_platform: 'zhihu' }
    })
  })

  it('分类重命名迁移 key；新名已有预设则保留原值不覆盖', () => {
    saveCategoryPreset('旧名', { default_platform: 'zhihu' })
    renameCategoryPreset('旧名', '新名')
    expect(listCategoryPresets()).toEqual({ 新名: { default_platform: 'zhihu' } })

    saveCategoryPreset('A', { default_platform: 'zhihu' })
    saveCategoryPreset('B', { style_skill: 'khazix-writer' })
    renameCategoryPreset('A', 'B')
    expect(listCategoryPresets()['B']).toEqual({ style_skill: 'khazix-writer' })
    expect(listCategoryPresets()['A']).toBeUndefined()
  })

  it('显式删除预设只动目标分类', () => {
    saveCategoryPreset('科技数码', { default_platform: 'zhihu' })
    saveCategoryPreset('生活常识', { style_skill: 'khazix-writer' })
    deleteCategoryPreset('科技数码')
    expect(listCategoryPresets()).toEqual({ 生活常识: { style_skill: 'khazix-writer' } })
  })
})
