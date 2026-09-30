import { useEffect, type ReactElement, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * 统一弹窗壳（UI/UX PRD §4 弹窗壳 / §5.11）：12px 圆角 + 标题栏（名称 + 关闭）+ 内容区 +
 * 底部按钮条（右对齐：取消幽灵 + 主操作）。此前 9 个弹窗各写一套（z-40/z-50、半透黑 50/60、
 * rounded-lg/xl、有的点遮罩能关有的不能），本组件把这些一次性收口。
 *
 * 键盘：Esc 即关（§6 键盘约束）；需要「未保存改动先确认」的调用方把 onClose 写成带确认的回调即可。
 */
export interface DialogShellProps {
  title: ReactNode
  /** 标题下的一行说明（也可用 children 自带） */
  hint?: ReactNode
  icon?: IconName
  /** 面板宽度（px 或任意 CSS 宽度值） */
  width?: number | string
  /** 面板最大高度，超出走内容区滚动 */
  maxHeight?: string
  onClose: () => void
  /** 点遮罩是否关闭：破坏性/有未保存改动的弹窗应传 false，由按钮决定去留 */
  closeOnBackdrop?: boolean
  children: ReactNode
  /** 底部按钮条；不传则不渲染底栏 */
  footer?: ReactNode
  /** 内容区样式覆盖：双栏预览这类要贴边的弹窗传 'p-0'，默认带内边距 */
  bodyClass?: string
  /** 面板样式追加（如固定高度 h-[86vh]） */
  panelClass?: string
}

export function DialogShell({
  title,
  hint,
  icon,
  width = 560,
  maxHeight = '85vh',
  onClose,
  closeOnBackdrop = true,
  children,
  footer,
  bodyClass = 'px-4 py-3.5',
  panelClass = ''
}: DialogShellProps): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ width: typeof width === 'number' ? `min(${width}px, 92vw)` : width, maxHeight }}
        className={`flex w-full flex-col overflow-hidden rounded-xl border border-panel-3 bg-panel-2 shadow-[0_4px_16px_rgba(0,0,0,.28)] ${panelClass}`}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-panel-3 px-4 py-3">
          {icon && <Icon name={icon} size={14} className="text-accent" />}
          <h2 className="min-w-0 truncate text-[13.5px] font-bold text-ink">{title}</h2>
          {hint && <p className="min-w-0 flex-1 truncate text-[11.5px] text-ink-dim">{hint}</p>}
          <button
            onClick={onClose}
            title="关闭（Esc）"
            className="ml-auto inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-panel-3 hover:text-ink"
          >
            <Icon name="x" size={13} />
          </button>
        </header>
        <div className={`thin-scroll min-h-0 flex-1 overflow-y-auto ${bodyClass}`}>{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </div>
    </div>
  )
}

/** 底部按钮条：右对齐，取消走幽灵、主操作走实心（§4 弹窗壳） */
export function DialogFooter({ children, className = '' }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <footer className={`flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-panel-3 bg-panel px-4 py-2.5 ${className}`}>
      {children}
    </footer>
  )
}
