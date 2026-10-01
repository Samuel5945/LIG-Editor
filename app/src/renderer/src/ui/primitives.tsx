import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
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

/**
 * 观测元素可用宽高（导出步预览缩放要同时知道宽和高；hidden 挂载时读到 0，重新显示会再回调一次）。
 */
export function useElementBox<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(read)
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [])
  return [ref, box]
}

/**
 * 横向条带的单行测量（诊断 8）：一个 ResizeObserver 同时给出
 * - `overflow`：内容放不下 → 调用方置 `data-overflow="1"`，由 `.chip-row` 出右缘渐隐 + 横滑
 * - `narrow`：长标签放不下 → 调用方改用短名；短名仍放不下就不再降（交给横滑）
 *
 * 降级那一次读到的长标签自然宽作迟滞阈值，窗口变宽后自动回到长标签，避免临界宽度反复抖动。
 */
export function useFittingRow<T extends HTMLElement>(): { ref: React.RefObject<T>; narrow: boolean; overflow: boolean } {
  const ref = useRef<T>(null)
  const [narrow, setNarrow] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const longNatural = useRef(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = (): void => {
      const w = el.clientWidth
      const natural = el.scrollWidth
      if (w <= 0) return
      setOverflow(natural > w + 1)
      if (!narrow) {
        if (natural > w + 1) {
          longNatural.current = natural
          setNarrow(true)
        }
      } else if (longNatural.current && w >= longNatural.current + 1) {
        setNarrow(false)
      }
    }
    const ro = new ResizeObserver(check)
    ro.observe(el)
    check()
    return () => ro.disconnect()
  }, [narrow])
  return { ref, narrow, overflow }
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
      {icon && <Icon name={icon} size={14} className={icon === 'spinner' ? 'animate-spin' : undefined} />}
      {children}
    </button>
  )
}

/**
 * 三态按钮的**字符串**形态：弹窗里成片的 `className={btnGhost}` 直接拿这一份，
 * 不再各自手抄一套 rounded/border/hover（§4 按钮三态只有一套）。
 */
export const btnCls = (variant: BtnVariant = 'sec', size: BtnSize = 'sm'): string =>
  `${BTN_BASE} ${BTN_SIZE[size]} ${BTN_VARIANT[variant]}`

/**
 * 弹窗内单行输入 / 下拉的同一形态。跟 `FIELD_SHELL_CLS` 的分工：
 * 壳类是「带聚焦光晕的外壳」（里面装控件），这个是控件本体自己就是可见框。
 */
export const FIELD_CLS = 'rounded-lg border border-panel-3 bg-panel px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent'

/** 顶栏/工具行里的紧凑图标按钮（图标 13px，高 26） */export function IconButton({ icon, className = '', title, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName }): ReactElement {
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

// ---------------- 分段控件 ----------------

export interface SegmentedItem<T extends string> {
  value: T
  label: string
  icon?: IconName
  title?: string
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  items: SegmentedItem<T>[]
  value: T
  onChange: (v: T) => void
  /** 无障碍名（role=group），如「配图管线」 */
  ariaLabel: string
  title?: string
  /** md=26px 高（弹窗/页签）；sm=22px（工具行内嵌） */
  size?: 'md' | 'sm'
  className?: string
}

/**
 * 二选一 / 多选一的互斥分段控件（§4）。
 * 从 CardsPanel 版式切换、FigureDialog 三管线、ProjectWall 排序、SettingsDialog 外观三处
 * 手写的同款结构抽出来的单源——「当前段浮起白底 + 其余灰字」这套形态只在这里定义一次。
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  title,
  size = 'md',
  className = ''
}: SegmentedProps<T>): ReactElement {
  const btn =
    size === 'sm'
      ? 'h-[22px] rounded-md px-2.5 text-[11px]'
      : 'h-[26px] rounded-md px-3 text-[11.5px]'
  return (
    <span
      role="group"
      aria-label={ariaLabel}
      title={title}
      className={`inline-flex shrink-0 items-center rounded-lg bg-panel-3 p-0.5 ${className}`}
    >
      {items.map((it) => {
        const on = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            title={it.title}
            disabled={it.disabled}
            aria-pressed={on}
            onClick={() => !on && !it.disabled && onChange(it.value)}
            className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-100 ${btn} ${
              on
                ? 'bg-panel-2 font-semibold text-ink shadow-[0_1px_3px_rgba(0,0,0,.16)]'
                : 'text-ink-dim hover:text-ink disabled:opacity-45 disabled:hover:text-ink-dim'
            }`}
          >
            {it.icon && <Icon name={it.icon} size={12} />}
            {it.label}
          </button>
        )
      })}
    </span>
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
  const row = useFittingRow<HTMLDivElement>()
  return (
    <div ref={row.ref} data-overflow={row.overflow ? '1' : '0'} className={`chip-row flex flex-nowrap items-center gap-1.5 ${className}`}>
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
              <div className={`${POPOVER_CLS} absolute left-0 top-full z-50 mt-1 w-40 p-1`}>
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

// ---------------- 浮层壳（选项弹窗 / 右键菜单 / 工具条下拉） ----------------

/**
 * 浮层壳单源（§4 阴影两级 + §3.3 圆角 12）：所有「点外面即关」的小浮层——
 * 顶栏外观弹层、步进器步骤下拉、右键菜单、编辑器工具条下拉——共用同一只壳。
 * 定位与内边距（absolute/fixed + top/left + p-1/p-2）由调用方 className/style 传，
 * 壳本身只管圆角/描边/底色/阴影——避免 p-1 与 p-2 同权重互相覆盖。
 */
export const POPOVER_CLS = 'rounded-xl border border-panel-3 bg-panel-2 shadow-[0_4px_16px_rgba(0,0,0,.28)]'

export interface PopoverProps {
  children: ReactNode
  /** 点遮罩（含遮罩上右键）即关 */
  onClose: () => void
  /** 追加定位与宽度，如 `absolute right-0 top-full mt-1 w-48` */
  className?: string
  style?: CSSProperties
  /** 浮层自身右键也关掉（右键菜单场景：再点一次别处重开） */
  dismissOnContextMenu?: boolean
}

export function Popover({ children, onClose, className = '', style, dismissOnContextMenu }: PopoverProps): ReactElement {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={
          dismissOnContextMenu
            ? (e) => {
                e.preventDefault()
                onClose()
              }
            : undefined
        }
      />
      <div style={style} className={`${POPOVER_CLS} z-50 ${className}`}>
        {children}
      </div>
    </>
  )
}

/** 浮层内分区小标题（10.5px 灰字，与菜单行同一左缘） */
export function PopoverLabel({ children, className = '' }: { children: ReactNode; className?: string }): ReactElement {
  return <p className={`px-2.5 pb-1 pt-1.5 text-[10.5px] text-ink-dim ${className}`}>{children}</p>
}

export interface MenuItemProps {
  icon?: IconName
  children: ReactNode
  onClick: () => void
  title?: string
  /** danger=破坏性动作（删除/归档），底色走 st-bad 软底 */
  tone?: 'default' | 'danger'
  /** 当前项：主色软底 + 600 字重（单选菜单用） */
  active?: boolean
}

/** 菜单行单源：图标 12 + 文字 12/400，hover 浅底，禁各菜单再手写一套 px-3 py-1.5 */
export function MenuItem({ icon, children, onClick, title, tone = 'default', active }: MenuItemProps): ReactElement {
  const cls = active
    ? 'bg-accent/15 font-semibold text-accent'
    : tone === 'danger'
      ? 'text-st-bad hover:bg-st-bad/10'
      : 'text-ink hover:bg-panel-3'
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${cls}`}
    >
      {icon ? <Icon name={icon} size={12} className="shrink-0 opacity-80" /> : <span className="w-3 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

/** 选项格（编辑器工具条下拉这类「点一个值」的格子）：选中主色实心，未选灰字浅底 hover */
export function ChoiceTile({
  on,
  children,
  onClick,
  title,
  className = ''
}: {
  on: boolean
  children: ReactNode
  onClick: () => void
  title?: string
  className?: string
}): ReactElement {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-[11.5px] transition-colors ${
        on ? 'bg-accent font-semibold text-white' : 'text-ink-dim hover:bg-panel-3 hover:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * 输入框壳单源：描边 + 聚焦主色 3px 光晕。`field-shell` 这个类名同时是 CSS 的开关——
 * 壳已经画了聚焦环，壳内控件就不该再叠一层**无圆角**的矩形 outline（点进去会「变方」）。
 */
export const FIELD_SHELL_CLS =
  'field-shell border border-panel-3 bg-panel-2 transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgb(var(--accent)/.18)]'

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

export interface CollapseBarProps {
  /** 条上文字：一句话说清展开后是什么（如「版式与裁剪规则（文字锁左区 / 底图同化）」） */
  label: string
  children: ReactNode
  className?: string
}

/**
 * 说明折叠条（§5.3 二轮重构 / 稿 E⑳・稿 F㉓）：把规则长文从操作区里拿走，默认收起，
 * 要查依据时展开即有——工作面只剩「选择 + 按钮」，按钮不再淹在段落里。
 * 标题封面步与导出步共用这一只，禁各处手抄虚线条。
 */
export function CollapseBar({ label, children, className = '' }: CollapseBarProps): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-panel-3 bg-panel-3/40 px-3 py-2 text-left text-[11.5px] text-ink-dim transition-colors hover:text-ink"
      >
        <span className="min-w-0 flex-1">{label}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={11} className="shrink-0 opacity-70" />
      </button>
      {open && <div className="mt-2 space-y-1.5 px-1 text-[11.5px] leading-relaxed text-ink-dim">{children}</div>}
    </div>
  )
}
