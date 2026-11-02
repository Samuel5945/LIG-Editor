import { Fragment, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { ModelInfo, ProviderConfig } from '@shared/types'
import { Icon } from '../ui/Icon'
import { Button, MenuItem, Popover, PopoverLabel } from '../ui/primitives'
import { DialogShell } from '../ui/DialogShell'

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
  // 管理显示过滤弹窗的目标供应商 id；null = 弹窗关着
  const [manageId, setManageId] = useState<string | null>(null)
  // 展开时量触发钮的视口坐标，浮层挂 body 走 fixed 定位——对话输入行是 chip-row 横滑容器
  // （overflow-x:auto 连带 overflow-y:auto），absolute 浮层留在行内会被整块裁掉：菜单「开」
  // 了却看不见、全屏遮罩还吃掉下一次点击（2026-11-02 CDP 实测复现，同 ThinkingSelect）。
  // 贴窗口右缘改右对齐（w-64=256px，1280 宽实测固定 left-0 菜单被裁出窗外），菜单限高滚动。
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null)
  const measure = (): void => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setAnchor({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }
  useLayoutEffect(() => {
    if (!open) return
    measure()
    // 浮层 fixed 定位后不再随行内布局走：窗口尺寸变化/任意容器滚动都跟着触发钮重定位
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])
  // flip 在 anchor 就绪后才参与定位；宽 256 + 右缘 8px 余量
  const flip = !!anchor && anchor.left + 256 > window.innerWidth - 8

  const keyed = providers.filter((p) => p.apiKey)
  // 显示过滤（providers[].shownModels）：菜单只列勾选的模型；会话选中与供应商默认模型始终保留，
  // 避免「正在用的模型」从菜单里消失（同 refreshProviderModels 保留当前选中值的约定）
  const visibleText = (p: ProviderConfig): ModelInfo[] => {
    const all = p.models?.text ?? []
    const s = p.shownModels
    if (!s || s.length === 0) return all
    const filtered = all.filter((m) => s.includes(m.id))
    for (const pinned of [value?.providerId === p.id ? value.modelId : null, p.textModel]) {
      if (pinned && !filtered.some((m) => m.id === pinned) && all.some((m) => m.id === pinned)) filtered.unshift({ id: pinned })
    }
    return filtered
  }
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
          style={
            direction === 'up'
              ? flip
                ? { right: window.innerWidth - anchor.right, bottom: window.innerHeight - anchor.top + 6 }
                : { left: anchor.left, bottom: window.innerHeight - anchor.top + 6 }
              : flip
                ? { right: window.innerWidth - anchor.right, top: anchor.bottom + 6 }
                : { left: anchor.left, top: anchor.bottom + 6 }
          }
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
            const list = allCount > 0 ? visibleText(p) : []
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

/**
 * 管理显示模型弹窗：勾选哪些文本模型进对话面板菜单（llm:setShownModels 落 llm.json，
 * 广播 settings:llmChanged 让各面板即时刷新）。只影响菜单展示——全选/全不选都等于不过滤（清字段）。
 */
function ShownModelsDialog({ provider, onClose }: { provider: ProviderConfig; onClose: () => void }): ReactElement {
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
          <span className="mr-auto text-[11px] text-ink-dim">
            显示 {picked.size} / 共 {all.length}；不勾任何 = 恢复全部显示
          </span>
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
