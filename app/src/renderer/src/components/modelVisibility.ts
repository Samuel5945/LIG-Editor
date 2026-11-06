import type { ModelInfo, ProviderConfig } from '@shared/types'
import type { ModelSel } from './ModelSelect'

/**
 * 显示过滤（providers[].shownModels）：菜单只列勾选的模型；会话选中与供应商默认模型始终保留，
 * 避免「正在用的模型」从菜单里消失（同 refreshProviderModels 保留当前选中值的约定）。
 * ModelSelect（旧分组菜单）与 ModelThinkingPill（统一浮层）共用。
 */
export function visibleTextModels(p: ProviderConfig, value: ModelSel | null): ModelInfo[] {
  const all = p.models?.text ?? []
  const s = p.shownModels
  if (!s || s.length === 0) return all
  const filtered = all.filter((m) => s.includes(m.id))
  for (const pinned of [value?.providerId === p.id ? value.modelId : null, p.textModel]) {
    if (pinned && !filtered.some((m) => m.id === pinned) && all.some((m) => m.id === pinned)) filtered.unshift({ id: pinned })
  }
  return filtered
}
