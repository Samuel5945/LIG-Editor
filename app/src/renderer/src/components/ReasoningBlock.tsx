import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Icon } from '../ui/Icon'

/**
 * 思考过程展示块（对话面板与创作向导流式生成共用）。
 * 行为约定：
 * - 流式期间自动展开、跟随滚到最新一行——思考模型「先想后答」的等待期里，思考过程就是唯一的进度；
 * - 流结束后自动收起成一行摘要（字数可感知思考量），点开随时回看；
 * - 用户手动开关过就以用户为准，此后不再自动展开/收起（生成→完成之间不打断阅读）。
 */
export function ReasoningBlock({
  text,
  streaming = false,
  className = ''
}: {
  text: string
  streaming?: boolean
  className?: string
}): ReactElement | null {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const open = userOpen ?? streaming

  useEffect(() => {
    if (streaming && open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [text, streaming, open])

  if (!text.trim()) return null
  return (
    <div
      className={`max-w-[92%] rounded-lg border border-panel-3 bg-panel-2 px-2.5 py-1.5 text-[11px] text-ink-dim ${className}`}
    >
      <button
        onClick={() => setUserOpen(!open)}
        className="flex w-full cursor-pointer select-none items-center gap-1.5 text-left"
        aria-expanded={open}
      >
        {streaming && <Icon name="spinner" size={12} className="animate-spin shrink-0 text-accent" />}
        <span className="shrink-0 font-medium">{streaming ? '思考中' : '思考过程'}</span>
        <span className="shrink-0 opacity-70">· {text.length} 字</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} className="ml-auto shrink-0" />
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="thin-scroll mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed"
        >
          {text}
        </div>
      )}
    </div>
  )
}
