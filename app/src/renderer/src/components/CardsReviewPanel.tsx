import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { cardsPlainText } from '@shared/cards'
import { chatOnce } from '../copilot/llm'
import { cardsReviewMessages } from '../copilot/prompts'
import { Icon } from '../ui/Icon'
import { Button, CardTitle } from '../ui/primitives'

interface CardsReviewPanelProps {
  project: string
  skill: string | null
  /** 审阅前让中央贴图面板把未落盘的编辑先写盘 */
  onFlush: () => Promise<void>
  /** 「按报告优化文案」→ 贴图面板按报告逐条落实文案修改 */
  onOptimize: (review: string) => void
  /** 点「第 N 张」→ 贴图面板滚动定位到对应卡片（0 起） */
  onLocate: (index: number) => void
  /** 报告写入成功后通知（创作向导的审阅步完成判定靠它重算） */
  onReviewSaved?: () => void
  onToast: (msg: string) => void
}

interface Section {
  title: string
  lines: string[]
}

const CARD_HEAD_RE = /^###\s*(第\s*\d+\s*张.*)$/
const CARD_NO_RE = /第\s*(\d+)\s*张/

/**
 * 贴图审阅面板：贴图工程时替代正文审阅占右栏「审阅」页签
 * 逐张点评文案/排版密度/背图 → 写 cards-review.md → 分区展示 + 「第 N 张」定位滚动
 * 文案类建议可一键交给 AI 落实；排版类（字号/深色/拆卡）对照报告在卡片上手动调
 */
export default function CardsReviewPanel({
  project,
  skill,
  onFlush,
  onOptimize,
  onLocate,
  onReviewSaved,
  onToast
}: CardsReviewPanelProps): ReactElement {
  const [sections, setSections] = useState<Section[]>([])
  const [reviewMd, setReviewMd] = useState('')
  const [empty, setEmpty] = useState(true)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const skillRef = useRef(skill)
  skillRef.current = skill

  const load = useCallback(async () => {
    try {
      const md = await window.api.invoke('project:readFile', project, 'cards-review.md')
      setSections(parseSections(md))
      setReviewMd(md)
      setEmpty(!md.trim())
    } catch {
      setSections([])
      setReviewMd('')
      setEmpty(true)
    }
  }, [project])

  useEffect(() => {
    load()
    // Agent/外部工具改 cards-review.md 时热载
    const off = window.api.on('file:external-change', ({ project: p, file }) => {
      if (p === project && file === 'cards-review.md') load()
    })
    return () => off()
  }, [project, load])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [streamText])

  /** 发起贴图审阅（独立一次性调用，不经过对话面板） */
  const runReview = useCallback(async () => {
    if (streaming) return
    await onFlush()
    const deck = await window.api.invoke('cards:read', project)
    if (!deck?.cards.length) {
      onToast('还没有卡片，先生成或新建贴图再审阅')
      return
    }
    setError(null)
    setStreaming(true)
    setStreamText('')
    const { promise, abort } = chatOnce(
      cardsReviewMessages(cardsPlainText(deck.cards), deck.format, skillRef.current),
      setStreamText
    )
    abortRef.current = abort
    try {
      const full = await promise
      await window.api.invoke('project:writeFile', project, 'cards-review.md', full.trim() + '\n')
      await load()
      onReviewSaved?.()
      onToast('审阅报告已写入 cards-review.md')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStreaming(false)
      setStreamText('')
      abortRef.current = null
    }
  }, [streaming, project, onFlush, load, onToast])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 报告卡头部（与文章审阅页同构，稿 B 标注⑨）：主次按钮 + 状态胶囊右对齐归组 */}
      <div className="shrink-0 px-3 pt-3">
        <div className="rounded-xl border border-panel-3 bg-panel-2 p-3.5 shadow-[0_1px_6px_rgba(0,0,0,.18)]">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>贴图审阅</CardTitle>
            {!streaming && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold text-accent">当前步骤</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {streaming ? (
                <Button size="sm" variant="sec" icon="square" onClick={() => abortRef.current?.()} className="text-st-bad">
                  停止
                </Button>
              ) : (
                <Button size="sm" variant="sec" icon="search" onClick={() => void runReview()}>
                  {empty ? '审阅贴图' : '重新审阅'}
                </Button>
              )}
              {!streaming && !empty && (
                <Button
                  size="sm"
                  variant="pri"
                  icon="sparkles"
                  onClick={() => onOptimize(reviewMd)}
                  title="按报告逐条落实文案类修改；字号/深色这类排版建议用每张卡的滑杆和勾选手动调"
                >
                  按报告优化文案
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-dim">
            <span className="inline-flex items-center gap-1.5">
              报告写入
              <span className="rounded border border-panel-3 bg-panel px-1.5 py-0.5 font-mono text-[11px]">cards-review.md</span>
            </span>
            {streaming ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-3 px-2.5 py-0.5 text-ink">
                <Icon name="spinner" size={11} className="animate-spin" />
                逐张点评文案与排版中…
              </span>
            ) : empty ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-st-draft/15 px-2.5 py-0.5 font-semibold text-st-draft">
                <Icon name="alert" size={11} />
                尚未审阅 · 等待执行
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-st-done/15 px-2.5 py-0.5 font-semibold text-st-done">
                <Icon name="checkCircle" size={11} />
                已有报告
              </span>
            )}
            <span className="text-ink-dim">排版建议（字号/深色/拆卡）请在卡片上手动调</span>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="selectable thin-scroll min-h-0 flex-1 overflow-auto p-4 text-xs leading-5">
        {error && (
          <p className="mb-2 break-all text-st-bad">
            <Icon name="xCircle" size={12} className="mr-1.5" />
            {error}
          </p>
        )}

        {/* 流式过程预览 */}
        {streaming && (
          <div className="whitespace-pre-wrap rounded-lg border border-panel-3 bg-panel p-3 leading-6 text-ink-dim">
            {streamText || '…'}
            <span className="animate-pulse">▌</span>
          </div>
        )}

        {!streaming && empty && (
          <p className="py-6 text-center text-ink-dim">暂无审阅报告，点上方按钮逐张点评贴图。</p>
        )}

        {!streaming &&
          sections.map((sec, i) => (
            <section key={i} className="mb-3">
              {sec.title && (
                <h3 className="mb-1 border-b border-panel-3 pb-1 text-[13px] font-bold text-ink">
                  {sec.title}
                </h3>
              )}
              {sec.lines.map((line, j) => {
                const head = CARD_HEAD_RE.exec(line.trim())
                if (head) {
                  const no = Number(CARD_NO_RE.exec(head[1])?.[1] ?? 0)
                  return (
                    <button
                      key={j}
                      onClick={() => onLocate(Math.max(0, no - 1))}
                      title="点击定位到对应卡片"
                      className="my-1 block w-full rounded border-l-2 border-accent bg-panel px-2 py-1 text-left font-bold text-ink hover:bg-panel-3"
                    >
                      {head[1]} → 定位
                    </button>
                  )
                }
                if (!line.trim()) return null
                return (
                  <p key={j} className="mb-1 whitespace-pre-wrap text-ink-dim">
                    {line}
                  </p>
                )
              })}
            </section>
          ))}
      </div>
    </div>
  )
}

function parseSections(md: string): Section[] {
  const out: Section[] = []
  let cur: Section = { title: '', lines: [] }
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^##\s+([^#].*)$/.exec(line)
    if (h) {
      if (cur.title || cur.lines.some((l) => l.trim())) out.push(cur)
      cur = { title: h[1].trim(), lines: [] }
    } else {
      cur.lines.push(line)
    }
  }
  if (cur.title || cur.lines.some((l) => l.trim())) out.push(cur)
  return out
}
