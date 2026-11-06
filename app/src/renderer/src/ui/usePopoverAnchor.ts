import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

export interface PopoverAnchor {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * 浮层锚点单源（ThinkingSelect / ModelSelect / ModelThinkingPill 共用）：
 * 展开时量触发钮的视口坐标，浮层挂 body 走 fixed 定位——对话输入行是 chip-row 横滑容器
 * （overflow-x:auto 连带 overflow-y:auto），absolute 浮层留在行内会被整块裁掉：菜单「开」
 * 了却看不见、全屏遮罩还吃掉下一次点击（2026-11-02 CDP 实测复现「思考按钮点了没反应」）。
 * 贴窗口右缘改右对齐（width + 右缘 8px 余量）；resize/任意容器滚动（capture）跟随重定位。
 */
export function usePopoverAnchor(
  open: boolean,
  width: number
): { triggerRef: RefObject<HTMLButtonElement>; anchor: PopoverAnchor | null; flip: boolean } {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const measure = (): void => {
      const r = triggerRef.current?.getBoundingClientRect()
      if (r) setAnchor({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])
  const flip = !!anchor && anchor.left + width > window.innerWidth - 8
  return { triggerRef, anchor, flip }
}

/** 锚点 + 朝向 → fixed 定位 style（up=向上展开贴触发钮顶缘，down=向下贴底缘；间距 6px） */
export function popoverStyle(anchor: PopoverAnchor, flip: boolean, direction: 'up' | 'down'): CSSProperties {
  const edge = flip ? { right: window.innerWidth - anchor.right } : { left: anchor.left }
  return direction === 'up'
    ? { ...edge, bottom: window.innerHeight - anchor.top + 6 }
    : { ...edge, top: anchor.bottom + 6 }
}
