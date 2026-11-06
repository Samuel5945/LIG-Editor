import { Fragment, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { ProviderConfig } from '@shared/types'
import { Icon } from '../ui/Icon'
import { MenuItem, Popover, PopoverLabel } from '../ui/primitives'
import { popoverStyle, usePopoverAnchor } from '../ui/usePopoverAnchor'
import { ShownModelsDialog } from './ShownModelsDialog'
import { visibleTextModels } from './modelVisibility'

export interface ModelSel {
  providerId: string
  modelId: string
}

/**
 * 会话级模型选择（分组菜单形态，测试与潜在复用保留）：胶囊触发 + 按供应商分组的单选浮层——
 * 只列已填 Key 的供应商与其拉取到的模型缓存，无缓存出「拉取模型列表」项；首组「跟随全局默认」。
 * 对话面板现用 ModelThinkingPill 统一浮层（供应商行 + 模型列表 + 思考滑杆），不再用本组件。
 */
export function ModelSelect({
  providers,
  defaultModelLabel,
  value,
  onChange,
  onFetchModels,
  prefix = '模型',
  direction = 'down',
  compact = false,
  disabled = false,
  className = ''
}: {
  providers: ProviderConfig[]
  /** 全局默认的「供应商/模型」显示文案（跟随态 hint） */
  defaultModelLabel: string
  value: ModelSel | null
  onChange: (v: ModelSel | null) => void
  /** 拉取某供应商模型列表（llm:fetchModels + 刷新 providers）——宿主实现，组件只管 loading 态 */
  onFetchModels: (p: ProviderConfig) => Promise<void>
  prefix?: string
  direction?: 'up' | 'down'
  compact?: boolean
  disabled?: boolean
  className?: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [fetchingId, setFetchingId] = useState<string | null>(null)
  // 管理显示过滤弹窗的目标供应商 id；null = 弹窗关着
  const [manageId, setManageId] = useState<string | null>(null)
  // 浮层挂 body + fixed 视口坐标（chip-row 裁剪坑见 usePopoverAnchor）；w-64=256px
  const { triggerRef, anchor, flip } = usePopoverAnchor(open, 256)

  const keyed = providers.filter((p) => p.apiKey)
  const curProvider = value ? providers.find((p) => p.id === value.providerId) : undefined
  const cur = value ? value.modelId : '跟随'
  const title = `对话模型：${
    value
      ? curProvider
        ? `${curProvider.name} / ${value.modelId}`
        : value.modelId
      : `跟随全局默认${defaultModelLabel ? `（${defaultModelLabel}）` : ''}`
  }`
  const pick = (v: ModelSel | null): void => {
    onChange(v)
    setOpen(false)
  }
  const fetchFor = (p: ProviderConfig): void => {
    setFetchingId(p.id)
    void onFetchModels(p).finally(() => setFetchingId(null))
  }
  const triggerCls = `inline-flex h-[26px] shrink-0 min-w-0 max-w-full items-center justify-center gap-1 rounded-md text-[11.5px] transition-colors disabled:opacity-40 ${
    value
      ? 'bg-accent/20 font-semibold text-accent'
      : 'text-ink-dim hover:bg-panel-3 hover:text-ink'
  }`
  return (
    <span className={`relative shrink-0 min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={title}
        aria-label={`${prefix}·${cur}`}
        className={triggerCls}
      >
        <Icon name="package" size={12} />
        {!compact && (
          <>
            {prefix}·
            <span className="min-w-0 max-w-[120px] truncate">{cur}</span>
            <Icon
              name={open ? (direction === 'up' ? 'chevronDown' : 'chevronUp') : direction === 'up' ? 'chevronUp' : 'chevronDown'}
              size={10}
              className="shrink-0 opacity-70"
            />
          </>
        )}
      </button>
      {open && anchor && createPortal(
        <Popover
          onClose={() => setOpen(false)}
          className="fixed z-50 w-64 max-h-[320px] overflow-y-auto p-1"
          style={popoverStyle(anchor, flip, direction)}
        >
          <PopoverLabel>对话模型</PopoverLabel>
          <MenuItem active={!value} onClick={() => pick(null)}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">跟随全局默认</span>
              {defaultModelLabel && <span className="min-w-0 truncate text-[10.5px] text-ink-dim">{defaultModelLabel}</span>}
            </span>
          </MenuItem>
          {keyed.map((p) => {
            const allCount = p.models?.text?.length ?? 0
            const list = allCount > 0 ? visibleTextModels(p, value) : []
            return (
              <Fragment key={p.id}>
                <PopoverLabel>
                  {p.name}
                  {list.length !== allCount ? ` · 显示 ${list.length}/${allCount}` : ''}
                </PopoverLabel>
                {allCount > 0
                  ? list.map((m) => (
                      <MenuItem
                        key={m.id}
                        active={value?.providerId === p.id && value?.modelId === m.id}
                        title={m.id}
                        onClick={() => pick({ providerId: p.id, modelId: m.id })}
                      >
                        <span className="block truncate">{m.id}</span>
                      </MenuItem>
                    ))
                  : (
                    <MenuItem
                      title={fetchingId === p.id ? '正在拉取模型列表…' : `从 ${p.baseUrl} 拉取模型列表`}
                      onClick={() => fetchFor(p)}
                    >
                      <span className="inline-flex items-center gap-1.5 text-ink-dim">
                        <Icon name={fetchingId === p.id ? 'spinner' : 'refresh'} size={11} className={fetchingId === p.id ? 'animate-spin' : ''} />
                        {fetchingId === p.id ? '拉取中…' : '拉取模型列表…'}
                      </span>
                    </MenuItem>
                  )}
                {allCount > 0 && (
                  <MenuItem
                    title="勾选哪些模型进对话菜单（不影响请求与设置界面）"
                    onClick={() => {
                      setOpen(false)
                      setManageId(p.id)
                    }}
                  >
                    <span className="inline-flex items-center gap-1.5 text-ink-dim">
                      <Icon name="eye" size={11} />
                      管理显示模型…
                    </span>
                  </MenuItem>
                )}
              </Fragment>
            )
          })}
          {keyed.length === 0 && (
            <div className="px-2 py-1.5 text-[11px] text-ink-dim">没有已填 Key 的供应商——先到「模型接入」配置</div>
          )}
        </Popover>,
        document.body
      )}
      {manageId &&
        (() => {
          const p = providers.find((x) => x.id === manageId)
          return p ? <ShownModelsDialog provider={p} onClose={() => setManageId(null)} /> : null
        })()}
    </span>
  )
}
