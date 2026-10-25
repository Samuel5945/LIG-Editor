import { useEffect, useState, type ReactElement } from 'react'
import { modelCapability, THINKING_LEVEL_LABEL, type ModelCapability } from '@shared/modelCatalog'
import type { ThinkingChoice } from '@shared/types'
import { Icon } from '../ui/Icon'
import { MenuItem, Popover, PopoverLabel } from '../ui/primitives'

/** 当前文本供应商的能力表（思考档位菜单等用）；取不到 = 空对象，与 ChatPanel 的 cap 同源 */
export function useTextModelCap(): ModelCapability {
  const [cap, setCap] = useState<ModelCapability>({})
  useEffect(() => {
    let alive = true
    window.api
      .invoke('settings:getLlm')
      .then((s) => {
        const p = s.providers.find((x: { id: string }) => x.id === s.textProviderId)
        if (alive && p) setCap(modelCapability(p, p.textModel))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return cap
}

/**
 * 思考档位展开选择菜单（替代旧的循环点击胶囊）：触发钮开一个单选浮层——
 * 跟随默认 / 关闭（支持 none 档的模型）/ 目录预置档位（商汤全档 none~max，qwen3.8 三档，
 * 纯开关模型只有跟随/开/关）。选择态单选高亮，模型不给档位概念时自动退化成开关菜单。
 * tone: pill=ChatPanel 工具行按钮形态，chip=面板头部胶囊形态；direction 决定浮层朝向。
 */
export function ThinkingSelect({
  cap,
  value,
  onChange,
  prefix = '思考',
  tone = 'chip',
  direction = 'down',
  compact = false,
  disabled = false,
  className = ''
}: {
  cap: ModelCapability
  value: ThinkingChoice
  onChange: (v: ThinkingChoice) => void
  /** 触发钮文案前缀（思考·深度 / 档位·跟随） */
  prefix?: string
  tone?: 'pill' | 'chip'
  direction?: 'up' | 'down'
  compact?: boolean
  disabled?: boolean
  className?: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  const reasoning = cap.reasoning
  const levels = reasoning?.levels
  const on = value === 'none' || value === false ? false : value === null ? (reasoning?.defaultOn ?? false) : true
  const cur =
    value === null
      ? '跟随'
      : value === false || value === 'none'
        ? '关'
        : typeof value === 'string'
          ? THINKING_LEVEL_LABEL[value]
          : '开'
  const title = !reasoning
    ? '当前模型不支持思考控制'
    : `思考档位：${
        value === null
          ? `跟随模型默认（当前默认${reasoning.defaultOn ? '开' : '关'}）`
          : value === false || value === 'none'
            ? '关闭思考'
            : typeof value === 'string'
              ? THINKING_LEVEL_LABEL[value]
              : '开（默认档）'
      }${levels ? '' : '（当前模型只支持开关）'}`
  const pick = (v: ThinkingChoice): void => {
    onChange(v)
    setOpen(false)
  }
  const triggerCls =
    tone === 'pill'
      ? `inline-flex h-[26px] shrink-0 items-center justify-center gap-1 rounded-md text-[11.5px] transition-colors disabled:opacity-40 ${
          compact ? 'w-[26px]' : 'px-2.5'
        } ${on ? 'bg-accent/20 font-semibold text-accent' : 'text-ink-dim hover:bg-panel-3 hover:text-ink'}`
      : `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] transition-colors disabled:opacity-40 ${
          on
            ? 'bg-accent/20 font-semibold text-accent'
            : 'bg-panel-2 text-ink-dim border border-panel-3 hover:text-ink hover:bg-panel-3'
        }`
  return (
    <span className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || !reasoning}
        title={title}
        aria-label={`${prefix}·${cur}`}
        className={triggerCls}
      >
        <Icon name="brain" size={12} />
        {!compact && (
          <>
            {prefix}·{cur}
            <Icon name={open ? (direction === 'up' ? 'chevronDown' : 'chevronUp') : direction === 'up' ? 'chevronUp' : 'chevronDown'} size={10} className="opacity-70" />
          </>
        )}
      </button>
      {open && (
        <Popover
          onClose={() => setOpen(false)}
          className={`absolute ${direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} left-0 z-50 w-44 p-1`}
        >
          <PopoverLabel>思考档位{levels ? '' : ' · 纯开关'}</PopoverLabel>
          <MenuItem active={value === null} onClick={() => pick(null)}>
            跟随模型默认（{reasoning?.defaultOn ? '默认开' : '默认关'}）
          </MenuItem>
          <MenuItem active={value === false || value === 'none'} onClick={() => pick(false)}>
            关闭思考
          </MenuItem>
          {levels
            ?.filter((l) => l !== 'none')
            .map((l) => (
              <MenuItem key={l} active={value === l} onClick={() => pick(l)}>
                {THINKING_LEVEL_LABEL[l]}
              </MenuItem>
            ))}
        </Popover>
      )}
    </span>
  )
}
