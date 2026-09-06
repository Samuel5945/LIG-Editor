import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactElement } from 'react'
import type { IdeaCard, IdeaEntry, ProjectStatus, ProjectSummary } from '@shared/types'
import { addMonths, monthMatrix, todayYmd, ymd, ymdLabel } from '@shared/calendar'

/**
 * 内容日历 / 排期看板（M12）：月历网格拖拽工程卡片排发布日期
 * - 数据零新增 IPC：复用 App 的 projects 状态（ProjectSummary.plannedAt）
 * - 拖拽：HTML5 原生 drag/drop（仓库无拖拽库）；chip draggable、日期格 onDrop
 * - 排期写入 project:setSchedule → onChanged 回调刷新 projects（App.refreshProjects）
 * - 点卡片打开工程；未排期清单在右侧，拖回即取消
 * - 选题库页签（M13）：选题拖到日期格 = 立项 + 排期一步到位（不消费选题，可多账号复用）
 */

interface CalendarBoardProps {
  projects: ProjectSummary[]
  categories: string[]
  current: string | null
  onOpen: (project: string) => void
  onSchedule: (project: string, date: string | null) => Promise<void>
  /** 外部入库后自增，变化即自动刷新选题 */
  ideasVersion: number
  onIdeasChanged: () => void
  /** 点选题 chip：送脑暴面板出大纲 */
  onMakeOutline: (card: IdeaCard) => void
  /** 选题拖到日期：立项 + 排期，返回新工程摘要（供 toast 展示） */
  onScheduleIdea: (index: number, date: string, category?: string) => Promise<ProjectSummary>
  onToast: (msg: string) => void
}

/** 状态 → 色点（对齐 App.STATUS_LABEL 语义：脑暴/撰写/审阅/可发布） */
const STATUS_DOT: Record<ProjectStatus, string> = {
  ideating: 'bg-slate-400',
  drafting: 'bg-sky-400',
  reviewing: 'bg-amber-400',
  ready: 'bg-emerald-400'
}

const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日']
/** 单格最多直接展示的卡片数，超出折叠为 +N */
const MAX_CHIPS = 4

export default function CalendarBoard({
  projects,
  categories,
  current,
  onOpen,
  onSchedule,
  ideasVersion,
  onIdeasChanged,
  onMakeOutline,
  onScheduleIdea,
  onToast
}: CalendarBoardProps): ReactElement {
  const today = todayYmd()
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month0: d.getMonth() }
  })
  const [category, setCategory] = useState<string>('')
  // 拖拽中的工程名（dataTransfer 之外留一份，drop 目标校验用）
  const [dragging, setDragging] = useState<string | null>(null)
  // aside 页签：未排期工程 / 选题库
  const [asideTab, setAsideTab] = useState<'unscheduled' | 'ideas'>('unscheduled')
  // 选题库（ideas:list + version 驱动刷新，镜像左栏 IdeaLibrary 模式）
  const [ideas, setIdeas] = useState<IdeaEntry[]>([])
  useEffect(() => {
    let alive = true
    window.api
      .invoke('ideas:list')
      .then((list) => {
        if (alive) setIdeas(list)
      })
      .catch(() => {
        if (alive) setIdeas([])
      })
    return () => {
      alive = false
    }
  }, [ideasVersion])

  const filtered = useMemo(
    () => (category ? projects.filter((p) => (p.category ?? '未分类') === category) : projects),
    [projects, category]
  )

  /** ymd → 当日工程（按状态推进度排序：ready > reviewing > drafting > ideating，同状态按名） */
  const byDay = useMemo(() => {
    const rank: Record<ProjectStatus, number> = { ready: 0, reviewing: 1, drafting: 2, ideating: 3 }
    const map = new Map<string, ProjectSummary[]>()
    for (const p of filtered) {
      if (!p.plannedAt) continue
      const list = map.get(p.plannedAt) ?? []
      list.push(p)
      map.set(p.plannedAt, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name))
    }
    return map
  }, [filtered])

  const unscheduled = useMemo(
    () => filtered.filter((p) => !p.plannedAt),
    [filtered]
  )

  const weeks = useMemo(() => monthMatrix(cursor.year, cursor.month0), [cursor])

  const move = async (project: string, date: string | null): Promise<void> => {
    try {
      await onSchedule(project, date)
    } catch (err) {
      onToast(`排期失败：${err instanceof Error ? err.message : err}`)
    }
  }

  /** 选题立项排期：成功 toast 带新工程名与日期（失败原因明确提示，如重名/选题已删） */
  const moveIdea = async (index: number, date: string): Promise<void> => {
    try {
      const created = await onScheduleIdea(index, date, category || undefined)
      onToast(`已立项并排期：${created.name}（${ymdLabel(date)}）`)
      onIdeasChanged()
    } catch (err) {
      onToast(`立项失败：${err instanceof Error ? err.message : err}`)
    }
  }

  /** drop 分流：dataTransfer `idea:<index>` = 选题立项；纯文本 = 工程排期/改期/取消 */
  const dropOn = (date: string | null) => async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    const payload = e.dataTransfer.getData('text/plain') || dragging
    setDragging(null)
    if (!payload) return
    if (payload.startsWith('idea:')) {
      if (date === null) return // 拖回未排期区对选题无意义
      await moveIdea(Number(payload.slice(5)), date)
      return
    }
    const p = projects.find((x) => x.name === payload)
    if (p?.plannedAt === date) return // 原地拖放不写盘
    await move(payload, date)
  }

  const chip = (p: ProjectSummary, onUnschedule = false): ReactElement => (
    <div
      key={p.name}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', p.name)
        e.dataTransfer.effectAllowed = 'move'
        setDragging(p.name)
      }}
      onDragEnd={() => setDragging(null)}
      onClick={() => onOpen(p.name)}
      title={`${p.name}（${p.plannedAt ?? '未排期'}）— 点击打开，拖拽调排期`}
      className={`group flex cursor-grab items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight hover:bg-sky-500/10 ${
        p.name === current ? 'bg-sky-500/15 ring-1 ring-sky-500/40' : 'bg-panel-3'
      } ${dragging === p.name ? 'opacity-40' : ''}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[p.status] ?? 'bg-slate-400'}`} />
      <span className="truncate text-ink">{p.name}</span>
      {onUnschedule && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            void move(p.name, null)
          }}
          title="取消排期"
          className="ml-auto hidden shrink-0 px-0.5 text-ink-dim hover:text-red-400 group-hover:block"
        >
          ×
        </button>
      )}
    </div>
  )

  /** 选题 chip：分数徽章 + 标题；拖到日期立项排期，点击送脑暴出大纲 */
  const ideaChip = (it: IdeaEntry): ReactElement => (
    <div
      key={`idea-${it.index}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', `idea:${it.index}`)
        e.dataTransfer.effectAllowed = 'move'
        setDragging(`idea:${it.index}`)
      }}
      onDragEnd={() => setDragging(null)}
      onClick={() =>
        onMakeOutline({ title: it.title, angle: it.angle, audience: it.audience, score: it.score, reason: it.reason })
      }
      title={`${it.title}（角度：${it.angle || '未填'}）— 拖到日期格立项排期；点击送脑暴出大纲`}
      className={`flex cursor-grab items-center gap-1.5 rounded px-1 py-0.5 text-[10px] leading-tight hover:bg-accent/10 ${
        dragging === `idea:${it.index}` ? 'opacity-40' : 'bg-panel-3'
      }`}
    >
      <span
        className={`shrink-0 rounded px-1 py-0.5 font-bold ${
          it.score >= 8 ? 'bg-green-950 text-green-400' : 'bg-panel text-ink-dim'
        }`}
      >
        {it.score}
      </span>
      <span className="truncate text-ink">{it.title}</span>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 头部：月份切换 + 分类筛选 + 统计 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-panel-3 px-4 text-xs text-ink-dim">
        <button
          onClick={() => setCursor((c) => addMonths(c.year, c.month0, -1))}
          className="rounded px-1.5 py-0.5 hover:bg-panel-3"
          title="上个月"
        >
          ‹
        </button>
        <span className="w-24 text-center text-ink">
          {cursor.year} 年 {cursor.month0 + 1} 月
        </span>
        <button
          onClick={() => setCursor((c) => addMonths(c.year, c.month0, 1))}
          className="rounded px-1.5 py-0.5 hover:bg-panel-3"
          title="下个月"
        >
          ›
        </button>
        <button
          onClick={() => {
            const d = new Date()
            setCursor({ year: d.getFullYear(), month0: d.getMonth() })
          }}
          className="rounded px-1.5 py-0.5 hover:bg-panel-3"
        >
          今天
        </button>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          title="按分类（账号/品牌）筛选"
          className="ml-2 rounded bg-panel-3 px-1.5 py-0.5 text-ink-dim outline-none"
        >
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="ml-auto">
          已排 {filtered.filter((p) => p.plannedAt).length} · 未排 {unscheduled.length}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 月历网格 */}
        <div className="flex min-w-0 flex-1 flex-col p-2">
          <div className="grid grid-cols-7 gap-px pb-1 text-center text-[10px] text-ink-dim">
            {WEEK_DAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded bg-panel-3">
            {weeks.flat().map((d) => {
              const key = ymd(d)
              const inMonth = d.getMonth() === cursor.month0
              const list = byDay.get(key) ?? []
              const shown = list.slice(0, MAX_CHIPS)
              const hidden = list.length - shown.length
              return (
                <div
                  key={key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={dropOn(key)}
                  className={`flex min-h-0 flex-col gap-0.5 overflow-hidden p-1 ${
                    inMonth ? 'bg-panel' : 'bg-panel-2'
                  }`}
                >
                  <span
                    className={`shrink-0 text-[10px] leading-none ${
                      key === today
                        ? 'rounded bg-accent px-1 font-bold text-white'
                        : inMonth
                          ? 'text-ink-dim'
                          : 'text-ink-dim/40'
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {shown.map((p) => chip(p, true))}
                  {hidden > 0 && <span className="px-1 text-[9px] text-ink-dim">+{hidden} 篇</span>}
                </div>
              )
            })}
          </div>
        </div>

        {/* 右栏：未排期工程 / 选题库，都可拖入月历（选题 = 立项 + 排期） */}
        <aside
          className="flex w-60 shrink-0 flex-col border-l border-panel-3 bg-panel-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={dropOn(null)}
        >
          <div className="flex shrink-0 gap-1 border-b border-panel-3 px-2 py-1.5 text-xs">
            <button
              onClick={() => setAsideTab('unscheduled')}
              className={`rounded px-2 py-0.5 ${asideTab === 'unscheduled' ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`}
            >
              🗂 未排期 {unscheduled.length}
            </button>
            <button
              onClick={() => setAsideTab('ideas')}
              className={`rounded px-2 py-0.5 ${asideTab === 'ideas' ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`}
            >
              💡 选题库 {ideas.length}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {asideTab === 'unscheduled' ? (
              <>
                {unscheduled.length === 0 && (
                  <p className="px-1 py-4 text-center text-[11px] text-ink-dim">全部工程都已排期</p>
                )}
                {unscheduled.map((p) => chip(p))}
              </>
            ) : (
              <>
                {ideas.length === 0 && (
                  <p className="px-1 py-4 text-center text-[11px] text-ink-dim">
                    空空如也，去「脑暴」面板产出选题后点「入库」
                  </p>
                )}
                {ideas.map(ideaChip)}
              </>
            )}
          </div>
          <div className="shrink-0 border-t border-panel-3 px-3 py-1.5 text-[10px] text-ink-dim">
            {asideTab === 'unscheduled'
              ? '拖到日期格排期，拖回此处取消'
              : `拖到日期格 = 立项 + 排期${category ? `（分类：${category}）` : ''}；点击选题送脑暴出大纲`}
          </div>
        </aside>
      </div>
    </div>
  )
}
