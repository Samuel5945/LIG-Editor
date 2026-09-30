import { useState, type ReactElement } from 'react'
import { Icon } from '../ui/Icon'
import { TOOL_LABELS } from '../copilot/toolLabels'

/** 一轮回答里的一次工具调用（会话落盘 toolTrace 复用同一形状） */
export interface ToolCardState {
  name: string
  argsSummary: string
  status: 'running' | 'done' | 'error'
  /** 发起时刻（日志卡行尾时间戳）；会话留痕恢复的历史项可能没有 */
  at?: number
  result?: string
}

/** 时刻 → HH:MM（无时刻的历史项留空，不显示假时间） */
export function hhmm(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 工具调用日志卡（UI/UX PRD §4 工具调用日志卡 / 稿 A 标注⑤）：
 * 一次回答里的多次调用收进一张卡——头部扳手 + 「工具调用」+ 次数徽标（含失败数），
 * 逐行「状态图标 / 工具名 / 等宽参数 / 时间戳」，失败行标红并附返回原因；
 * 默认折叠成一行摘要，折叠态也直接说明失败条数，避免「不展开就不知道没成」。
 */
export function ToolLogCard({ cards }: { cards: ToolCardState[] }): ReactElement {
  const [open, setOpen] = useState(false)
  const failed = cards.filter((c) => c.status === 'error').length
  const running = cards.some((c) => c.status === 'running')
  const summary = `${cards.length} 次${failed ? ` · ${failed} 失败` : ''}${running ? ' · 执行中' : ''}`
  return (
    <div className="mb-2 w-full max-w-[92%] overflow-hidden rounded-xl border border-panel-3 bg-panel-2">
      <button
        onClick={() => setOpen((v) => !v)}
        title={open ? '收起工具调用明细' : '展开工具调用明细'}
        className="flex w-full items-center gap-2 bg-panel px-3 py-2 text-left text-[11.5px] font-semibold text-ink-dim hover:bg-panel-3"
      >
        <Icon name="wrench" size={12} />
        <span>工具调用</span>
        <span className="rounded-full bg-panel-3 px-2 py-0.5 text-[10.5px] font-normal text-ink-dim">{summary}</span>
        <Icon name="chevronRight" size={11} className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div>
          {cards.map((c, k) => (
            <div key={k} className="flex flex-wrap items-center gap-x-2 border-t border-panel px-3 py-1.5 text-[11.5px]">
              {c.status === 'running' ? (
                <Icon name="spinner" size={12} className="animate-spin text-accent" />
              ) : c.status === 'done' ? (
                <Icon name="check" size={12} className="text-st-done" />
              ) : (
                <Icon name="x" size={12} className="text-st-bad" />
              )}
              <span className={c.status === 'error' ? 'text-st-bad' : 'text-ink'}>{TOOL_LABELS[c.name] ?? c.name}</span>
              {c.argsSummary && <span className="min-w-0 truncate font-mono text-[10.5px] text-ink-dim">{c.argsSummary}</span>}
              <span className="ml-auto shrink-0 pl-2 text-[10.5px] text-ink-dim">{hhmm(c.at)}</span>
              {c.status === 'error' && c.result && (
                <p className="w-full break-words font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-st-bad">{c.result}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {!open && failed > 0 && (
        <p className="border-t border-panel px-3 py-1.5 text-[10.5px] text-st-bad">
          <Icon name="warn" size={11} className="mr-1.5" />
          {failed} 次调用失败，展开看原因
        </p>
      )}
    </div>
  )
}
