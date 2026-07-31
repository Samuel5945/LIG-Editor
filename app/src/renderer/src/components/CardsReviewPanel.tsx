import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { cardsPlainText } from '@shared/cards'
import { chatOnce } from '../copilot/llm'
import { cardsReviewMessages } from '../copilot/prompts'

interface CardsReviewPanelProps {
  project: string
  skill: string | null
  /** 审阅前让中央贴图面板把未落盘的编辑先写盘 */
  onFlush: () => Promise<void>
  /** 「按报告优化文案」→ 贴图面板按报告逐条落实文案修改 */
  onOptimize: (review: string) => void
  /** 点「第 N 张」→ 贴图面板滚动定位到对应卡片（0 起） */
  onLocate: (index: number) => void
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
      {/* 工具条：按钮一行，状态提示另起一行 */}
      <div className="shrink-0 border-b border-panel-3 px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {streaming ? (
            <button onClick={() => abortRef.current?.()} className="whitespace-nowrap rounded bg-panel-3 px-2 py-1 text-red-400 hover:bg-panel">
              ■ 停止
            </button>
          ) : (
            <button onClick={() => void runReview()} className="whitespace-nowrap rounded bg-accent px-2 py-1 text-white hover:opacity-90">
              {empty ? '🔍 审阅贴图' : '🔍 重新审阅'}
            </button>
          )}
          {!streaming && !empty && (
            <button
              onClick={() => onOptimize(reviewMd)}
              title="按报告逐条落实文案类修改；字号/深色这类排版建议用每张卡的滑杆和勾选手动调"
              className="whitespace-nowrap rounded bg-panel-3 px-2 py-1 text-ink hover:bg-panel"
            >
              ✨ 按报告优化文案
            </button>
          )}
        </div>
        <p className="mt-1 text-ink-dim">
          {streaming
            ? '逐张点评文案与排版中…'
            : '报告写入 cards-review.md；排版建议（字号/深色/拆卡）请在卡片上手动调'}
        </p>
      </div>

      <div ref={scrollRef} className="selectable min-h-0 flex-1 overflow-auto p-3 text-xs leading-5">
        {error && <p className="mb-2 break-all text-red-400">✗ {error}</p>}

        {/* 流式过程预览 */}
        {streaming && (
          <div className="whitespace-pre-wrap rounded bg-panel p-2 text-ink-dim">
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
