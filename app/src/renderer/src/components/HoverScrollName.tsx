import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'

/**
 * 左栏项目名：容器内超长截断，悬停时按实际溢出量横向滚动显示全名。
 * 溢出距离悬停时测量（--scroll-dist），不溢出时为 0、动画等效静止。
 * 需配 index.css 的 .name-scroll-box / .name-scroll-text / @keyframes name-scroll，
 * 且父级带 Tailwind group 类（group:hover 触发滚动）。
 */
export default function HoverScrollName({ name }: { name: string }): ReactElement {
  const boxRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [dist, setDist] = useState(0)

  const measure = (): void => {
    const box = boxRef.current
    const text = textRef.current
    if (!box || !text) return
    const d = Math.max(0, text.scrollWidth - box.clientWidth)
    setDist((prev) => (prev === d ? prev : d))
  }

  // 挂载先按静止布局兜底测一次，保证任何姿势的首次悬停都能滚动；
  // 之后悬停进入名称区时等行内按钮显隐（group-hover 布局变化）稳定后再精测
  useLayoutEffect(measure, [name])
  const measureSettled = (): void => {
    requestAnimationFrame(measure)
  }

  return (
    <span ref={boxRef} className="name-scroll-box min-w-0 flex-1" onMouseEnter={measureSettled}>
      <span
        ref={textRef}
        className="name-scroll-text"
        style={{ '--scroll-dist': `${-dist}px`, '--scroll-dur': `${dist / 25 + 2}s` } as CSSProperties}
      >
        {name}
      </span>
    </span>
  )
}
