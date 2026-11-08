import { useState, type ReactElement } from 'react'
import type { ProviderConfig } from '@shared/types'
import { Button } from '../ui/primitives'
import { DialogShell } from '../ui/DialogShell'

/**
 * 管理显示模型弹窗：勾选哪些文本模型进对话面板菜单（llm:setShownModels 落 llm.json，
 * 广播 settings:llmChanged 让各面板即时刷新）。只影响菜单展示——全选/全不选都等于不过滤（清字段）。
 */
export function ShownModelsDialog({ provider, onClose }: { provider: ProviderConfig; onClose: () => void }): ReactElement {
  const all = provider.models?.text ?? []
  // 初始勾选 = 已保存的过滤集；没保存过 = 全部勾上（语义即「全部显示」）
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(provider.shownModels?.length ? provider.shownModels : all.map((m) => m.id))
  )
  const toggle = (id: string): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // 全选/全不选：全勾时按钮变「全不选」，其余状态一律「全选」（含空选 = 恢复全部显示）
  const toggleAll = (): void =>
    setPicked((prev) => (prev.size === all.length ? new Set<string>() : new Set(all.map((m) => m.id))))
  const save = (): void => {
    // 真子集才落 shownModels；全选/全不选清字段回「全部显示」
    const ids = all.filter((m) => picked.has(m.id)).map((m) => m.id)
    void window.api.invoke('llm:setShownModels', provider.id, ids.length > 0 && ids.length < all.length ? ids : null)
    onClose()
  }
  return (
    <DialogShell
      title={`管理显示模型 · ${provider.name}`}
      hint="只影响对话面板模型菜单的展示，不影响请求"
      icon="eye"
      width={440}
      onClose={onClose}
      footer={
        <>
          <span className="text-[11px] text-ink-dim">
            显示 {picked.size} / 共 {all.length}；不勾任何 = 恢复全部显示
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="mr-auto ml-3 rounded px-1 text-[11px] text-ink-dim transition-colors hover:text-accent"
          >
            {picked.size === all.length ? '全不选' : '全选'}
          </button>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="pri" icon="check" onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        {all.map((m) => (
          <label
            key={m.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-ink transition-colors hover:bg-panel-3"
            title={m.id}
          >
            <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} className="accent-accent" />
            <span className="min-w-0 truncate">{m.id}</span>
          </label>
        ))}
      </div>
    </DialogShell>
  )
}
