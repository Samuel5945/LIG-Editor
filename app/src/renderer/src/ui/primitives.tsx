import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * 全局控件单源（UI/UX PRD §4）：按钮三态 / 胶囊 / 步骤条 / 状态圆点 / 开关 / 卡片壳。
 * 各界面禁自造变体——新增形态先回这里加，再逐界面替换。
 * 颜色一律走 index.css 的 CSS 变量（Tailwind 的 accent/panel/st-* ），禁写死色值。
 */

// ---------------- 尺寸测量 ----------------

/** 观测元素可用宽度（步骤条紧凑降级、胶囊条溢出渐隐都靠它，不用 window resize 猜） */
function useElWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// ---------------- 按钮 ----------------

export type BtnVariant = 'pri' | 'sec' | 'ghost'
export type BtnSize = 'md' | 'sm'

const BTN_BASE = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:cursor-default disabled:opacity-45'
const BTN_SIZE: Record<BtnSize, string> = {
  md: 'h-8 px-4 text-[13px]',
  sm: 'h-[30px] px-3 text-xs'
}
const BTN_VARIANT: Record<BtnVariant, string> = {
  // 主：primary 实心 + 主色投影；次：白底描边；幽灵：无框弱字
  pri: 'bg-accent text-white shadow-[0_2px_6px_rgba(0,0,0,.18)] hover:brightness-110',
  sec: 'bg-panel-2 text-ink-dim border border-panel-3 hover:border-accent hover:text-accent',
  ghost: 'text-ink-dim hover:bg-panel-3 hover:text-ink'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  size?: BtnSize
  icon?: IconName
  children?: ReactNode
}

export function Button({ variant = 'sec', size = 'md', icon, className = '', children, ...rest }: ButtonProps): ReactElement {
  return (
    <button {...rest} className={`${BTN_BASE} ${BTN_SIZE[size]} ${BTN_VARIANT[variant]} ${className}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  )
}

/** 顶栏/工具行里的紧凑图标按钮（图标 13px，高 26） */
export function IconButton({ icon, className = '', title, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName }): ReactElement {
  return (
    <button
      {...rest}
      title={title}
      className={`inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-xs text-ink-dim transition-colors hover:bg-panel-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      <Icon name={icon} size={13} />
      {rest.children}
    </button>
  )
}

// ---------------- 胶囊 ----------------

export interface ChipProps {
  on?: boolean
  icon?: IconName
  /** 右侧 ✕：可单独摘掉（上下文胶囊） */
  onClose?: () => void
  onClick?: () => void
  title?: string
  children?: ReactNode
  className?: string
}

/** 胶囊统一形态（§4 chip）：26-28px 高、999 圆角，开启态主色软底+主色字 */
export function Chip({ on, icon, onClose, onClick, title, children, className = '' }: ChipProps): ReactElement {
  const cls = on
    ? 'bg-accent/20 text-accent font-semibold border border-transparent'
    : 'bg-panel-2 text-ink-dim border border-panel-3 hover:text-ink hover:bg-panel-3'
  const body = (
    <>
      {icon && <Icon name={icon} size={12} />}
      <span className="truncate">{children}</span>
      {onClose && (
        <Icon
          name="x"
          size={11}
          className="opacity-60 hover:opacity-100"
          // 关闭热区由外层胶囊承担，这里只画图形
        />
      )}
    </>
  )
  return (
    <span
      role={onClick || onClose ? 'button' : undefined}
      tabIndex={onClick || onClose ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick()
      }}
      className={`inline-flex h-[26px] shrink-0 cursor-default select-none items-center gap-1.5 rounded-full px-2.5 text-[11.5px] transition-colors ${cls} ${className}`}
    >
      {body}
    </span>
  )
}

export function ChipGroup({ children, className = '' }: { children: ReactNode; className?: string }): ReactElement {
  const [ref, over] = useElWidth<HTMLDivElement>()
  return (
    <div
      ref={ref}
      data-overflow={over > 0 && ref.current && ref.current.scrollWidth > ref.current.clientWidth + 1 ? '1' : '0'}
      className={`chip-row flex flex-nowrap items-center gap-1.5 ${className}`}
    >
      {children}
    </div>
  )
}

// ---------------- 状态圆点（单源语义） ----------------

export type DotStatus = 'draft' | 'doing' | 'done'

const DOT_CLASS: Record<DotStatus, string> = {
  draft: 'bg-st-draft',
  doing: 'bg-st-doing',
  done: 'bg-st-done'
}

/** 6px 状态圆点：黄=草稿、蓝=进行中、绿=已成稿/已发布，全应用同一套（§3.1 约束） */
export function StatusDot({ status, className = '', title }: { status: DotStatus; className?: string; title?: string }): ReactElement {
  return <span title={title} className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[status]} ${className}`} />
}

export function StatusLegend({ className = '' }: { className?: string }): ReactElement {
  return (
    <div className={`flex items-center justify-center gap-3 text-[10.5px] text-ink-dim ${className}`}>
      <span className="inline-flex items-center gap-1">
        <StatusDot status="draft" />草稿
      </span>
      <span className="inline-flex items-center gap-1" title="选题中 / 审阅中的工程">
        <StatusDot status="doing" />进行中
      </span>
      <span className="inline-flex items-center gap-1" title="已成稿或已发布">
        <StatusDot status="done" />成稿
      </span>
    </div>
  )
}

// ---------------- 开关（必带文字标签） ----------------

export interface SwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  title?: string
  disabled?: boolean
}

/** 34×19 开关 + 文字标签，禁孤立裸开关（§4 Switch） */
export function Switch({ checked, onChange, label, title, disabled }: SwitchProps): ReactElement {
  return (
    <label
      className={`inline-flex select-none items-center gap-2 text-xs text-ink-dim ${disabled ? 'opacity-45' : 'cursor-default'}`}
      title={title}
    >
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative h-[19px] w-[34px] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-panel-3'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[15px] w-[15px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-all ${
            checked ? 'right-[2px]' : 'left-[2px]'
          }`}
        />
      </button>
    </label>
  )
}

// ---------------- 步骤条 ----------------

export interface StepperItem {
  id: string
  label: string
  done: boolean
}

export interface StepperProps {
  items: StepperItem[]
  activeId: string
  onSelect: (id: string) => void
  /** 当前步正在流式生成：标签呼吸提示 */
  busyId?: string | null
  className?: string
}

/** 单步固定宽 + 连接线 flex 均分：任意宽度零滚动条；放不下时降级「n/7 步骤名 ▾」紧凑模式 */
const STEP_W = 62
const LINK_MIN = 8

export function Stepper({ items, activeId, onSelect, busyId, className = '' }: StepperProps): ReactElement {
  const [ref, w] = useElWidth<HTMLDivElement>()
  const [pickOpen, setPickOpen] = useState(false)
  const need = items.length * STEP_W + (items.length - 1) * LINK_MIN + 16
  const compact = w > 0 && w < need

  const activeIdx = Math.max(0, items.findIndex((s) => s.id === activeId))

  return (
    <div ref={ref} data-stepper className={`flex min-w-0 items-start px-1 py-2.5 ${className}`}>
      {compact ? (
        <div className="relative min-w-0">
          <button
            onClick={() => setPickOpen((v) => !v)}
            title="跳转到任一步骤"
            className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-panel-3 bg-panel-2 px-3 text-[11.5px] text-ink hover:bg-panel-3"
          >
            <span className="font-semibold text-accent">
              {activeIdx + 1}/{items.length}
            </span>
            <span className="truncate">{items[activeIdx]?.label}</span>
            <Icon name="chevronDown" size={11} className="text-ink-dim" />
          </button>
          {pickOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPickOpen(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-lg border border-panel-3 bg-panel-2 p-1 shadow-lg">
                {items.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onSelect(s.id)
                      setPickOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] hover:bg-panel-3 ${
                      s.id === activeId ? 'bg-accent/15 text-accent font-semibold' : 'text-ink-dim'
                    }`}
                  >
                    <span className="w-4 shrink-0 text-center text-[10.5px] opacity-70">{i + 1}</span>
                    {s.done ? <Icon name="check" size={12} className="text-st-done" /> : <span className="w-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        items.map((s, i) => {
          const active = s.id === activeId
          return (
            <div key={s.id} className="flex min-w-0 flex-1 items-start last:flex-none">
              <button
                onClick={() => onSelect(s.id)}
                title={s.done ? '已完成，点击回到该步' : '点击跳到该步'}
                className="group flex flex-none flex-col items-center gap-[5px] outline-none"
                style={{ width: STEP_W }}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold transition-all ${
                    s.done
                      ? 'border-transparent bg-accent text-white'
                      : active
                        ? 'border-transparent bg-accent text-white shadow-[0_0_0_4px_rgb(var(--accent)/.18)]'
                        : 'border-panel-3 bg-panel text-ink-dim group-hover:border-accent group-hover:text-accent'
                  }`}
                >
                  {s.done ? <Icon name="check" size={11} strokeWidth={3.2} /> : i + 1}
                </span>
                <span
                  className={`max-w-full truncate text-[11.5px] ${
                    active ? 'font-bold text-accent' : s.done ? 'font-semibold text-ink' : 'text-ink-dim'
                  } ${busyId === s.id ? 'animate-pulse' : ''}`}
                >
                  {s.label}
                </span>
              </button>
              {i < items.length - 1 && (
                <span className={`mt-[9px] h-[2px] min-w-[8px] flex-1 rounded-full ${s.done ? 'bg-accent' : 'bg-panel-3'}`} />
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// ---------------- 卡片壳 ----------------

export function Card({ children, className = '' }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <div className={`rounded-xl border border-panel-3 bg-panel-2 p-4 shadow-[0_1px_6px_rgba(0,0,0,.18)] ${className}`}>
      {children}
    </div>
  )
}

export function CardTitle({ children, tag, className = '' }: { children: ReactNode; tag?: string; className?: string }): ReactElement {
  return (
    <div className={`flex items-center gap-2 text-[13.5px] font-bold text-ink ${className}`}>
      <span className="min-w-0 truncate">{children}</span>
      {tag && <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold text-accent">{tag}</span>}
    </div>
  )
}

/** 空态：44px 圆角方块图标 + 两行说明 + 可选主按钮（§4 空态 / §6 三态必填） */
export function EmptyState({ icon, title, hint, action }: { icon: IconName; title: string; hint?: string; action?: ReactNode }): ReactElement {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel-3 text-ink-dim">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-xs text-ink">{title}</p>
      {hint && <p className="max-w-[280px] text-[11.5px] leading-relaxed text-ink-dim">{hint}</p>}
      {action}
    </div>
  )
}

/** 首帧后由调用方触发一次的挂载标记（避免 SSR/首屏闪烁判断散落在各组件里） */
export function useMounted(): boolean {
  const [m, setM] = useState(false)
  useEffect(() => setM(true), [])
  return m
}
