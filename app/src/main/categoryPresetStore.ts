import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CategoryPreset, CategoryPresetPatch, PlatformId, ProjectMeta } from '@shared/types'
import { PLATFORM_LABELS } from '@shared/platformHtml'
import { getAppPaths } from './paths'
import { readSkill } from './skillStore'

/**
 * 分类级账号预设（账号 = 分类）：settings/categoryPresets.json
 * 预设记录账号级默认（写作 Skill / 默认分发平台），新建工程时由
 * projectStore.createProject 注入，一次配置处处生效。无敏感信息，纯 JSON 不加密。
 * 分类重命名由 projectStore.renameCategory 调 renameCategoryPreset 同步 key；
 * 删除（隐藏）分类保留预设，恢复后仍生效。
 */

function presetsFile(): string {
  return join(getAppPaths().settings, 'categoryPresets.json')
}

/** 预设是否已无任何字段（决定要不要删 key） */
function isEmptyPreset(preset: CategoryPreset): boolean {
  return !preset.style_skill && !preset.default_platform
}

/**
 * 账号预设落到工程上的唯一规则：**只补工程缺失的字段，绝不覆盖已有值**。
 * - 新建工程：meta 是空白的，等价于「全部注入」
 * - 改分类：推送账号与排版调性都按分类现算、会立刻切换，风格不跟着走就是不一致；
 *   但用户已在工程上手选过的 Skill 不能被静默冲掉，所以只填空缺
 * 默认分发平台不落工程（按 meta.category 现算），故不在回填范围。
 */
export function presetFillFor(meta: ProjectMeta, preset?: CategoryPreset): Partial<ProjectMeta> {
  const fill: Partial<ProjectMeta> = {}
  if (preset?.style_skill && !meta.style_skill) fill.style_skill = preset.style_skill
  return fill
}

/** 读盘并剔除脏值：未知平台、空字符串与空条目一律丢弃（盘上 JSON 可被外部工具改坏） */
export function listCategoryPresets(): Record<string, CategoryPreset> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(presetsFile(), 'utf8'))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, CategoryPreset> = {}
  for (const [category, value] of Object.entries(raw as Record<string, Partial<CategoryPreset> | null>)) {
    if (!value || typeof value !== 'object') continue
    const preset: CategoryPreset = {}
    if (typeof value.style_skill === 'string' && value.style_skill) preset.style_skill = value.style_skill
    const platform = value.default_platform as PlatformId | undefined
    if (platform && PLATFORM_LABELS[platform]) preset.default_platform = platform
    if (!isEmptyPreset(preset)) out[category] = preset
  }
  return out
}

function writePresets(presets: Record<string, CategoryPreset>): void {
  writeFileSync(presetsFile(), JSON.stringify(presets, null, 2), 'utf8')
}

/**
 * 增量设置分类预设：patch 中字段为 null = 清除该项，缺省 = 保持原值。
 * 字段各自校验（Skill 必须已安装，平台必须是已知 id）；全部为空时顺手删掉整条。
 */
export function saveCategoryPreset(category: string, patch: CategoryPresetPatch): CategoryPreset {
  const presets = listCategoryPresets()
  const next: CategoryPreset = { ...presets[category] }
  if ('style_skill' in patch) {
    const skill = patch.style_skill
    if (!skill) {
      delete next.style_skill
    } else {
      try {
        readSkill(skill)
      } catch {
        throw new Error(`Skill 不存在：${skill}`)
      }
      next.style_skill = skill
    }
  }
  if ('default_platform' in patch) {
    const platform = patch.default_platform
    if (!platform) {
      delete next.default_platform
    } else if (!PLATFORM_LABELS[platform]) {
      throw new Error(`未知分发平台：${platform}`)
    } else {
      next.default_platform = platform
    }
  }
  if (isEmptyPreset(next)) {
    delete presets[category]
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
