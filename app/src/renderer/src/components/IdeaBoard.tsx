import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { IdeaCard, IdeaEntry, IdeaStage, IdeaStageInfo, ProjectSummary } from '@shared/types'
import { IDEA_STAGES } from '@shared/ideaStage'
import { Icon } from '../ui/Icon'
import { StatusDot } from '../ui/primitives'
import { dotOfIdeaStage } from '../ui/status'

interface IdeaBoardProps {
  /** 外部入库后自增，变化即刷新（与左栏选题库共用同一版本号） */
  version: number
  /** 工程列表：作为刷新信号——选题状态由工程现实推导，工程变了看板就得重算 */
  projects: ProjectSummary[]
  onOpen: (project: string) => void
  /** 送脑暴面板出大纲 */
  onMakeOutline: (card: IdeaCard) => void
  /** 切到日历（待立项的选题在那里拖到日期即立项排期） */
  onGoSchedule: () => void
  onToast: (msg: string) => void
}

/**
 * 选题泳道看板：按「待立项 → 已立项 → 已排期 → 已成稿」四道泳道展示选题库。
 * 状态不落库、不手工维护，全部由是否存在对应工程推导（见 shared/ideaStage.ts），
 * 因此看板反映的是工程现实，不需要用户额外打勾。
 */
export default function IdeaBoard({
  version,
  projects,
  onOpen,
  onMakeOutline,
  onGoSchedule,
  onToast
}: IdeaBoardProps): ReactElement {
  const [ideas, setIdeas] = useState<IdeaEntry[]>([])
  const [stages, setStages] = useState<Record<number, IdeaStageInfo>>({})
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, st] = await Promise.all([
        window.api.invoke('ideas:list'),
        window.api.invoke('ideas:stages')
      ])
      setIdeas(list)
      setStages(st)
    } catch (err) {
      onToast(`选题看板加载失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => {
    void refresh()
  }, [refresh, version, projects])

  /** 按泳道分组。已排期那道按发布日先后排（先发的在上面），其余按评分降序 */
  const lanes = useMemo(() => {
    const map = new Map<IdeaStage, IdeaEntry[]>(IDEA_STAGES.map((s) => [s.id, []]))
    for (const idea of ideas) {
      const stage = stages[idea.index]?.stage ?? 'idle'
      map.get(stage)?.push(idea)
    }
    for (const [stage, list] of map) {
      list.sort((a, b) =>
        stage === 'scheduled'
          ? (stages[a.index]?.plannedAt ?? '').localeCompare(stages[b.index]?.plannedAt ?? '')
          : b.score - a.score
      )
    }
    return map
  }, [ideas, stages])

  const total = ideas.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-panel-3 px-4 text-xs text-ink-dim">
        <span className="text-ink">选题看板</span>
        <span>共 {total} 条（来自脑暴入库）</span>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          title="工程有变动后点这里重算状态"
          className="ml-auto rounded border border-panel-3 px-2 py-0.5 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {loading ? '重算中…' : '⟳ 重算状态'}
        </button>
      </div>

      <p className="shrink-0 px-4 py-2 text-[11px] leading-relaxed text-ink-dim">
        状态由「有没有对应的工程」推导，不用手工维护——在日历上把选题拖到某天即立项排期，工程写进审阅/可发布后自动进「已成稿」。
      </p>

      {total === 0 ? (
        <p className="px-4 py-10 text-center text-xs text-ink-dim">
          选题库是空的。去右栏「脑暴创作」产出选题并点「入库」，这里就会长出来。
        </p>
      ) : (
        <div className="thin-scroll flex min-h-0 flex-1 gap-2 overflow-x-auto p-4">
          {IDEA_STAGES.map((meta) => {
            const items = lanes.get(meta.id) ?? []
            return (
              <div
                key={meta.id}
                className="flex min-w-0 flex-1 basis-0 flex-col rounded-md border border-panel-3 bg-panel-2"
              >
                {/* 列头：状态色点 + 名称 + 计数（与工程行、封面墙同语义，§5.4）。
                    说明文字不占列头宽度——窄列下会被截成「还…」，改成整列头 title 悬停给出 */}
                <div className="flex shrink-0 items-center gap-1.5 border-b border-panel-3 px-2.5 py-2" title={meta.hint}>
                  <StatusDot status={dotOfIdeaStage(meta.id)} title={meta.hint} />
                  <span className="min-w-0 shrink truncate text-xs font-bold text-ink">{meta.label}</span>
                  <span className="shrink-0 rounded-full bg-panel-3 px-1.5 py-0.5 text-[10px] text-ink-dim">{items.length}</span>
                </div>
                <div className="thin-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
                  {items.length === 0 && <p className="px-1 py-6 text-center text-[11px] text-ink-dim">（空）</p>}
                  {items.map((idea) => {
                    const info = stages[idea.index]
                    return (
                      <div
                        key={idea.index}
                        className="group/idea rounded-xl border border-panel-3 bg-panel-2 p-2.5 shadow-[0_1px_6px_rgba(0,0,0,.18)] transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-accent"
                      >
                        <div className="flex items-start gap-1.5">
                          <p className="line-clamp-2 min-w-0 flex-1 text-xs font-bold leading-snug text-ink">{idea.title}</p>
                          {/* 评分徽标统一胶囊样式（与选题卡同款，§5.3/§5.4） */}
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                              idea.score >= 8 ? 'bg-accent/15 text-accent' : 'bg-panel-3 text-ink-dim'
                            }`}
                            title={`脑暴评分 ${idea.score}`}
                          >
                            {idea.score} 分
                          </span>
                        </div>
                        {idea.angle && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-ink-dim">角度：{idea.angle}</p>
                        )}
                        {info?.project && (
                          <div className="mt-1 space-y-0.5 text-[11px] text-ink-dim">
                            <p className="truncate" title={info.project}>
                              工程：<span className="text-ink">{info.project}</span>
                            </p>
                            {(info.plannedAt || info.category) && (
                              <p className="truncate">
                                {info.plannedAt && <span className="text-accent">{info.plannedAt}</span>}
                                {info.plannedAt && info.category && <span className="mx-1">·</span>}
                                {info.category}
                              </p>
                            )}
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover/idea:opacity-100 group-focus-within/idea:opacity-100">
                          {info?.project ? (
                            <button
                              onClick={() => onOpen(info.project as string)}
                              className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-white hover:brightness-110"
                            >
                              <Icon name="external" size={11} />
                              打开工程
                            </button>
                          ) : (
                            <button
                              onClick={onGoSchedule}
                              title="到日历把这条选题拖到某天，一步完成立项 + 排期"
                              className="inline-flex items-center gap-1 rounded-md border border-panel-3 px-2 py-0.5 text-[11px] text-ink-dim hover:border-accent hover:text-accent"
                            >
                              <Icon name="calendar" size={11} />
                              去日历排期
                            </button>
                          )}
                          <button
                            onClick={() =>
                              onMakeOutline({
                                title: idea.title,
                                angle: idea.angle,
                                audience: idea.audience,
                                score: idea.score,
                                reason: idea.reason
                              })
                            }
                            className="rounded px-2 py-0.5 text-[11px] text-ink-dim hover:bg-panel-3 hover:text-ink"
                          >
                            送脑暴
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
