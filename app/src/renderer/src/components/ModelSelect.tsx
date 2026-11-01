import { Fragment, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { ProviderConfig } from '@shared/types'
import { Icon } from '../ui/Icon'
import { MenuItem, Popover, PopoverLabel } from '../ui/primitives'

export interface ModelSel {
  providerId: string
  modelId: string
}

/**
 * 会话级模型选择（ZCode 风格）：胶囊触发 + 按供应商分组的单选浮层——只列已填 Key 的供应商
 * 与其拉取到的模型缓存（llm.json providers[].models.text），无缓存的供应商出「拉取模型列表」项
 * 走 llm:fetchModels；首组「跟随全局默认」= 不覆盖（settings 里的 textProviderId/textModel）。
 * 贴窗口右缘自动改右对齐（对话面板胶囊行 1280 宽实测 left-0 菜单被裁出 27px），菜单限高滚动。
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
  // 展开时量一次触发钮位置：贴右缘改右对齐，防菜单被窗口裁掉（同 ThinkingSelect 的实测坑）
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [flip, setFlip] = useState(false)
  useLayoutEffect(() => {
    if (!open) return
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setFlip(r.left + 256 > window.innerWidth - 8) // w-64 = 256px
  }, [open])

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
      {open && (
        <Popover
          onClose={() => setOpen(false)}
          className={`absolute ${direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${flip ? 'right-0' : 'left-0'} z-50 w-64 max-h-[320px] overflow-y-auto p-1`}
        >
          <PopoverLabel>对话模型</PopoverLabel>
          <MenuItem active={!value} onClick={() => pick(null)}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">跟随全局默认</span>
              {defaultModelLabel && <span className="min-w-0 truncate text-[10.5px] text-ink-dim">{defaultModelLabel}</span>}
            </span>
          </MenuItem>
          {keyed.map((p) => (
            <Fragment key={p.id}>
              <PopoverLabel>{p.name}</PopoverLabel>
              {p.models?.text?.length ? (
                p.models.text.map((m) => (
                  <MenuItem
                    key={m.id}
                    active={value?.providerId === p.id && value?.modelId === m.id}
                    title={m.id}
                    onClick={() => pick({ providerId: p.id, modelId: m.id })}
                  >
                    <span className="block truncate">{m.id}</span>
                  </MenuItem>
                ))
              ) : (
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
            </Fragment>
          ))}
          {keyed.length === 0 && (
            <div className="px-2 py-1.5 text-[11px] text-ink-dim">没有已填 Key 的供应商——先到「模型接入」配置</div>
          )}
        </Popover>
      )}
    </span>
  )
}
