import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { ProviderConfig, ThinkingChoice } from '@shared/types'
import { hasImageInput, modelCapability, THINKING_LEVEL_LABEL, type ModelCapability } from '@shared/modelCatalog'
import { Icon } from '../ui/Icon'
import { MenuItem, POPOVER_CLS, Popover } from '../ui/primitives'
import { popoverStyle, usePopoverAnchor } from '../ui/usePopoverAnchor'
import { ShownModelsDialog } from './ShownModelsDialog'
import { visibleTextModels } from './modelVisibility'
import { ThinkingSlider } from './ThinkingSlider'
import type { ModelSel } from './ModelSelect'

/**
 * 模型 × 思考强度统一浮层（ZCode 形态，2026-11-05 按参考图重做）：
 * 触发钮 `[📦 模型名 ∨]` → 一只浮层三段——
 *   ① 供应商行（📦 名称 + API 徽章 + ›）：点开左侧供应商子菜单（单选✓ + 管理模型）；
 *   ② 「模型」区：当前供应商的模型列表（视觉徽章 + 选中✓），受 shownModels 过滤；
 *   ③ 「思考强度」区：渐变滑杆（ThinkingSlider）+ Ctrl+T 徽章。
 * 浮层挂 body + fixed 视口坐标（chip-row 裁剪坑见 usePopoverAnchor）；w-72=288px。
 */
export function ModelThinkingPill({
  providers,
  defaultProviderId,
  defaultModelLabel,
  modelSel,
  onModelChange,
  onFetchModels,
  cap,
  thinkLevel,
  onThinkChange,
  compact = false,
  direction = 'up'
}: {
  providers: ProviderConfig[]
  /** 全局默认文本供应商 id（跟随态浮层展示它的模型列表） */
  defaultProviderId: string | null
  /** 全局默认「供应商/模型」文案（跟随态 hint） */
  defaultModelLabel: string
  modelSel: ModelSel | null
  onModelChange: (v: ModelSel | null) => void
  onFetchModels: (p: ProviderConfig) => Promise<void>
  cap: ModelCapability
  thinkLevel: ThinkingChoice
  onThinkChange: (v: ThinkingChoice) => void
  compact?: boolean
  direction?: 'up' | 'down'
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [provOpen, setProvOpen] = useState(false)
  const [manageId, setManageId] = useState<string | null>(null)
  const [fetchingId, setFetchingId] = useState<string | null>(null)
  const { triggerRef, anchor, flip } = usePopoverAnchor(open, 288)
  const provRowRef = useRef<HTMLButtonElement>(null)
  // 子菜单锚点用 layout effect 同步量：同一帧内 provOpen 与坐标一起就绪，避免闪一帧空菜单
  const [provAnchor, setProvAnchor] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null)
  useLayoutEffect(() => {
    if (!provOpen) return
    const r = provRowRef.current?.getBoundingClientRect()
    if (r) setProvAnchor({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
  }, [provOpen])

  const keyed = providers.filter((p) => p.apiKey)
  // 浮层当前展示的供应商：会话覆盖优先，跟随态 = 全局默认
  const curProvider =
    (modelSel ? keyed.find((p) => p.id === modelSel.providerId) : null) ??
    keyed.find((p) => p.id === defaultProviderId) ??
    keyed[0] ??
    null
  const curModelId = modelSel?.modelId ?? curProvider?.textModel ?? ''
  const models = curProvider ? visibleTextModels(curProvider, modelSel) : []
  const allCount = curProvider?.models?.text?.length ?? 0

  // 供应商子菜单锚点：量供应商行，子菜单放浮层左侧（贴左缘放不下就放右侧）
  const subLeft = provAnchor ? (provAnchor.left - 184 >= 8 ? provAnchor.left - 184 : provAnchor.right + 6) : 0

  const pickModel = (modelId: string): void => {
    if (!curProvider) return
    onModelChange({ providerId: curProvider.id, modelId })
    setOpen(false)
    setProvOpen(false)
  }
  const pickProvider = (p: ProviderConfig): void => {
    // 切供应商 = 会话覆盖到该供应商默认模型（跟随全局语义只在「跟随全局默认」项）
    onModelChange({ providerId: p.id, modelId: p.textModel })
    setProvOpen(false)
  }
  const fetchFor = (p: ProviderConfig): void => {
    setFetchingId(p.id)
    void onFetchModels(p).finally(() => setFetchingId(null))
  }

  const triggerTitle = `对话模型：${curProvider ? `${curProvider.name} / ${curModelId}` : '未配置'}${modelSel ? '' : '（跟随全局默认）'}；思考：${
    thinkLevel === null ? '跟随' : thinkLevel === false || thinkLevel === 'none' ? '关' : typeof thinkLevel === 'string' ? THINKING_LEVEL_LABEL[thinkLevel] : '开'
  }`
  return (
    <span className="relative shrink-0 min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setProvOpen(false)
        }}
        title={triggerTitle}
        aria-label={`模型·${curModelId || '未配置'}`}
        className={`inline-flex h-[26px] min-w-0 max-w-full items-center gap-1 rounded-md border border-panel-3 bg-panel-2 px-2 text-[11.5px] transition-colors hover:bg-panel-3 ${
          modelSel ? 'font-semibold text-accent' : 'text-ink-dim hover:text-ink'
        }`}
      >
        <Icon name="package" size={12} className="shrink-0" />
        {!compact && <span className="min-w-0 max-w-[110px] truncate">{curModelId || '模型'}</span>}
        <Icon name={open ? 'chevronDown' : 'chevronUp'} size={10} className="shrink-0 opacity-70" />
      </button>

      {open && anchor && createPortal(
        <Popover
          onClose={() => {
            setOpen(false)
            setProvOpen(false)
          }}
          className="fixed z-50 w-72 max-h-[420px] overflow-y-auto"
          style={popoverStyle(anchor, flip, direction)}
        >
          {/* ① 供应商行：点开左侧子菜单 */}
          <button
            ref={provRowRef}
            type="button"
            onClick={() => setProvOpen((v) => !v)}
            className="flex w-full items-center gap-2 border-b border-panel-3 px-3 py-2.5 text-left transition-colors hover:bg-panel-3"
            title="切换供应商"
          >
            <Icon name="package" size={14} className="shrink-0 text-ink-dim" />
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{curProvider?.name ?? '未配置供应商'}</span>
            <span className="shrink-0 rounded-full bg-panel-3 px-1.5 py-0.5 text-[9.5px] font-semibold text-ink-dim">API</span>
            <Icon name={provOpen ? 'chevronDown' : 'chevronRight'} size={12} className="ml-auto shrink-0 text-ink-dim" />
          </button>

          {/* ② 模型列表 */}
          <div className="p-1">
            <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] text-ink-dim">
              模型{allCount > 0 && models.length !== allCount ? ` · 显示 ${models.length}/${allCount}` : ''}
            </p>
            {models.length > 0 ? (
              models.map((m) => {
                const active = m.id === curModelId
                const vision = hasImageInput(modelCapability(curProvider!, m.id))
                return (
                  <button
                    key={m.id}
                    type="button"
                    title={m.id}
                    onClick={() => pickModel(m.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                      active ? 'font-semibold text-ink' : 'text-ink hover:bg-panel-3'
                    }`}
                  >
                    <span className="min-w-0 truncate">{m.id}</span>
                    {vision && (
                      <span className="shrink-0 rounded-full border border-panel-3 px-1.5 py-px text-[9.5px] text-ink-dim">视觉</span>
                    )}
                    {active && <Icon name="check" size={13} className="ml-auto shrink-0 text-ink-dim" />}
                  </button>
                )
              })
            ) : curProvider ? (
              <MenuItem
                title={fetchingId === curProvider.id ? '正在拉取模型列表…' : `从 ${curProvider.baseUrl} 拉取模型列表`}
                onClick={() => fetchFor(curProvider)}
              >
                <span className="inline-flex items-center gap-1.5 text-ink-dim">
                  <Icon name={fetchingId === curProvider.id ? 'spinner' : 'refresh'} size={11} className={fetchingId === curProvider.id ? 'animate-spin' : ''} />
                  {fetchingId === curProvider.id ? '拉取中…' : '拉取模型列表…'}
                </span>
              </MenuItem>
            ) : (
              <div className="px-2 py-1.5 text-[11px] text-ink-dim">没有已填 Key 的供应商——先到「模型接入」配置</div>
            )}
          </div>

          {/* ③ 思考强度滑杆 */}
          {cap.reasoning && (
            <div className="border-t border-panel-3">
              <ThinkingSlider cap={cap} value={thinkLevel} onChange={onThinkChange} />
            </div>
          )}
        </Popover>,
        document.body
      )}

      {/* 供应商子菜单：浮层左侧，单选✓ + 跟随全局默认 + 管理模型 */}
      {open && provOpen && provAnchor && createPortal(
        <div
          className={`fixed z-[60] w-44 max-h-[300px] overflow-y-auto p-1 ${POPOVER_CLS}`}
          style={{ left: subLeft, top: Math.max(8, provAnchor.top - 4) }}
        >
          {keyed.map((p) => (
            <MenuItem key={p.id} active={p.id === curProvider?.id} onClick={() => pickProvider(p)}>
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon name="package" size={11} className="shrink-0 opacity-70" />
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0 rounded-full bg-panel-3 px-1 py-px text-[9px] text-ink-dim">API</span>
              </span>
            </MenuItem>
          ))}
          <div className="mx-1 my-1 border-t border-panel-3" />
          <MenuItem active={!modelSel} onClick={() => { onModelChange(null); setProvOpen(false) }}>
            跟随全局默认
          </MenuItem>
          <MenuItem
            onClick={() => {
              setProvOpen(false)
              setOpen(false)
              setManageId(curProvider?.id ?? null)
            }}
          >
            管理模型
          </MenuItem>
        </div>,
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
