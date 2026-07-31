import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { WebSearchResult } from '@shared/types'
import { chatOnce } from '../copilot/llm'
import { reviewMessages } from '../copilot/prompts'

interface ReviewPanelProps {
  project: string
  /** 当前正文（发起审阅用） */
  article: string
  skill: string | null
  /** BubbleMenu「AI 审阅」触发：自增即自动发起审阅 */
  runRequest: number
  /** 随 runRequest 带入的选区文字：非空则只审选段，空则全文 */
  selection: string | null
  /** 点击「> 原文：…」引用行 → 编辑器定位；返回是否找到 */
  onLocate: (snippet: string) => boolean
  /** 「按报告优化正文」：把审阅报告全文交给 App 开修订弹窗 */
  onOptimize: (review: string) => void
  onToast: (msg: string) => void
}

interface Section {
  title: string
  lines: string[]
}

const QUOTE_RE = /^>\s*原文[:：]\s*(.+)$/

/**
 * 审阅面板：独立上下文发起全文审阅（流式）→ 写 review.md → 分区展示 + 引用行定位跳转
 * 不经过对话面板，与对话/脑暴互不影响
 */
export default function ReviewPanel({
  project,
  article,
  skill,
  runRequest,
  selection,
  onLocate,
  onOptimize,
  onToast
}: ReviewPanelProps): ReactElement {
  const [sections, setSections] = useState<Section[]>([])
  const [reviewMd, setReviewMd] = useState('')
  const [empty, setEmpty] = useState(true)
  const [missTip, setMissTip] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef(article)
  articleRef.current = article
  const skillRef = useRef(skill)
  skillRef.current = skill
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const [scopeTip, setScopeTip] = useState<string | null>(null)
  // 联网审阅：先搜最新资料再审，事实核验不凭旧训练数据（默认开）
  const [webOn, setWebOn] = useState(true)
  const webOnRef = useRef(webOn)
  webOnRef.current = webOn
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    try {
      const md = await window.api.invoke('project:readFile', project, 'review.md')
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
    // Agent/外部工具改 review.md 时热载
    const off = window.api.on('file:external-change', ({ project: p, file }) => {
      if (p === project && file === 'review.md') load()
    })
    return () => off()
  }, [project, load])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [streamText])

  // ---- 发起审阅（独立一次性调用） ----

  const runReview = useCallback(
    async (sel?: string) => {
      if (streaming) return
      const current = articleRef.current
      if (!sel?.trim() && !current.trim()) {
        onToast('正文为空，先写点内容再审阅')
        return
      }
      setError(null)
      setStreaming(true)
      setStreamText('')
      setScopeTip(sel?.trim() ? `只审选段（${sel.trim().length} 字）` : null)
      // 开了联网：主进程深度检索（多查询+新闻源+深抓正文；配了搜索 API 则走 API），失败降级离线审
      let web: WebSearchResult[] = []
      if (webOnRef.current) {
        setSearching(true)
        const title = /^#\s+(.+)$/m.exec(current)?.[1]?.trim() ?? current.slice(0, 40)
        const now = new Date()
        const ym = `${now.getFullYear()}年${now.getMonth() + 1}月`
        const queries = [
          `${title} ${ym} 最新`.slice(0, 80),
          sel?.trim() ? sel.trim().slice(0, 60) : `${title} 发布 进展`.slice(0, 80)
        ]
        try {
          web = await window.api.invoke('web:research', queries)
        } catch {
          // 主进程内部已逐路容错，这里只兜 IPC 异常
        }
        if (web.length === 0) onToast('联网搜索无结果或失败，已离线审阅')
        setSearching(false)
      }
      const { promise, abort } = chatOnce(reviewMessages(current, skillRef.current, sel, web), setStreamText)
      abortRef.current = abort
      try {
        const full = await promise
        await window.api.invoke('project:writeFile', project, 'review.md', full.trim() + '\n')
        await load()
        onToast(sel?.trim() ? '选段审阅报告已写入 review.md' : '审阅报告已写入 review.md')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setStreaming(false)
        setStreamText('')
        abortRef.current = null
      }
    },
    [streaming, project, load, onToast]
  )

  // BubbleMenu「AI 审阅」触发（选区非空则只审选段）
  const ranRef = useRef(0)
  useEffect(() => {
    if (runRequest > 0 && runRequest !== ranRef.current) {
      ranRef.current = runRequest
      runReview(selectionRef.current ?? undefined)
    }
  }, [runRequest, runReview])

  const locate = (snippet: string): void => {
    setMissTip(onLocate(snippet) ? null : '未在正文中找到该片段（可能已被修改）')
  }

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
            <button onClick={() => runReview()} className="whitespace-nowrap rounded bg-accent px-2 py-1 text-white hover:opacity-90">
              {empty ? '🔍 全文审阅' : '🔍 重新审阅'}
            </button>
          )}
          {!streaming && !empty && (
            <button
              onClick={() => onOptimize(reviewMd)}
              title="按审阅报告逐条修订正文，diff 确认后覆盖"
              className="whitespace-nowrap rounded bg-panel-3 px-2 py-1 text-ink hover:bg-panel"
            >
              ✦ 优化正文
            </button>
          )}
          <button
            onClick={() => setWebOn((v) => !v)}
            title="联网审阅：先搜索最新资料再审，事实核验以搜索结果为准"
            className={`ml-auto whitespace-nowrap rounded px-2 py-1 ${webOn ? 'bg-accent/20 text-accent' : 'text-ink-dim hover:bg-panel-3'}`}
          >
            🌐{webOn ? ' 开' : ' 关'}
          </button>
        </div>
        <p className="mt-1 text-ink-dim">
          {searching
            ? '🌐 联网搜索最新资料中…'
            : streaming
              ? `审阅中…${scopeTip ? `（${scopeTip}）` : ''}`
              : '报告写入 review.md'}
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
          <p className="py-6 text-center text-ink-dim">暂无审阅报告，点上方按钮发起全文审阅。</p>
        )}

        {!streaming && missTip && <p className="mb-2 rounded bg-amber-950/60 px-2 py-1 text-amber-300">{missTip}</p>}
        {!streaming &&
          sections.map((sec, i) => (
            <section key={i} className="mb-3">
              {sec.title && (
                <h3 className="mb-1 border-b border-panel-3 pb-1 text-[13px] font-bold text-ink">
                  {sec.title}
                </h3>
              )}
              {sec.lines.map((line, j) => {
                const q = QUOTE_RE.exec(line.trim())
                if (q) {
                  return (
                    <button
                      key={j}
                      onClick={() => locate(q[1].trim())}
                      title="点击定位到正文"
                      className="my-1 block w-full rounded border-l-2 border-accent bg-panel px-2 py-1 text-left text-ink hover:bg-panel-3"
                    >
                      「{q[1].trim()}」→ 定位
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
    const h = /^##\s+(.+)$/.exec(line)
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
