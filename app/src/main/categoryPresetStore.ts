import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CategoryPreset } from '@shared/types'
import { getAppPaths } from './paths'
import { readSkill } from './skillStore'

/**
 * 分类级账号预设（多账号骨架）：settings/categoryPresets.json
 * 「账号 = 分类」——预设记录账号级默认（当前仅写作 Skill），新建工程时由
 * projectStore.createProject 注入，一次配置处处生效。无敏感信息，纯 JSON 不加密。
 * 分类重命名由 projectStore.renameCategory 调 renameCategoryPreset 同步 key；
 * 删除（隐藏）分类保留预设，恢复后仍生效。
 */

function presetsFile(): string {
  return join(getAppPaths().settings, 'categoryPresets.json')
}

export function listCategoryPresets(): Record<string, CategoryPreset> {
  try {
    const raw = JSON.parse(readFileSync(presetsFile(), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function writePresets(presets: Record<string, CategoryPreset>): void {
  writeFileSync(presetsFile(), JSON.stringify(presets, null, 2), 'utf8')
}

/** 设置分类预设：skill 为 null 清除该字段（整条空了顺手删 key）；Skill 必须已安装 */
export function saveCategoryPreset(category: string, skill: string | null): CategoryPreset {
  const presets = listCategoryPresets()
  const next: CategoryPreset = { ...presets[category] }
  if (skill === null) {
    delete next.style_skill
  } else {
    try {
      readSkill(skill)
    } catch {
      throw new Error(`Skill 不存在：${skill}`)
    }
    next.style_skill = skill
  }
  if (!next.style_skill) {
    if (presets[category]) delete presets[category]
  } else {
    presets[category] = next
  }
  writePresets(presets)
  return next
}

/** 分类重命名时同步预设 key（无旧预设时静默；新名已有预设则保留原值不覆盖） */
export function renameCategoryPreset(oldName: string, newName: string): void {
  const presets = listCategoryPresets()
  if (!presets[oldName]) return
  if (!presets[newName]) presets[newName] = presets[oldName]
  delete presets[oldName]
  writePresets(presets)
}

/** 删除分类预设（当前无调用方——隐藏分类保留预设；留作显式清理入口） */
export function deleteCategoryPreset(category: string): void {
  const presets = listCategoryPresets()
  if (category in presets) {
    delete presets[category]
    writePresets(presets)
  }
}
