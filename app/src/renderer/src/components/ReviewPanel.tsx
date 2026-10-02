import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { WebSearchResult } from '@shared/types'
import { chatOnce } from '../copilot/llm'
import { reviewMessages } from '../copilot/prompts'
import { Icon } from '../ui/Icon'
import { Button, CardTitle, Switch } from '../ui/primitives'

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
  /** 报告写入成功后通知（创作向导的审阅步完成判定靠它重算） */
  onReviewSaved?: () => void
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
  onReviewSaved,
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
        onReviewSaved?.()
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
      {/* 报告卡头部（稿 B 标注⑨）：操作从游离浮块收进卡头——主操作实心、次操作描边、
          联网开关带文字标签，一组右对齐；状态用胶囊，不靠裸文字提示 */}
      <div className="shrink-0 px-3 pt-3">
        <div className="rounded-xl border border-panel-3 bg-panel-2 p-3.5 shadow-[0_1px_6px_rgba(0,0,0,.18)]">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>审阅</CardTitle>
            {!streaming && !searching && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold text-accent">当前步骤</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {streaming ? (
                <Button size="sm" variant="sec" icon="square" onClick={() => abortRef.current?.()} className="text-st-bad">
                  停止
                </Button>
              ) : (
                <Button size="sm" variant="sec" icon="search" onClick={() => runReview()}>
                  {empty ? '全文审阅' : '重新审阅'}
                </Button>
              )}
              {!streaming && !empty && (
                <Button size="sm" variant="pri" icon="sparkles" onClick={() => onOptimize(reviewMd)} title="按审阅报告逐条修订正文，diff 确认后覆盖">
                  优化正文
                </Button>
              )}
              <Switch
                checked={webOn}
                onChange={setWebOn}
                label="联网审阅"
                title="先搜索最新资料再审，事实核验以搜索结果为准"
                disabled={streaming}
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-dim">
            <span className="inline-flex items-center gap-1.5">
              报告写入
              <span className="rounded border border-panel-3 bg-panel px-1.5 py-0.5 font-mono text-[11px]">review.md</span>
            </span>
            {searching ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-3 px-2.5 py-0.5 text-ink">
                <Icon name="globe" size={11} />
                联网检索最新资料中…
              </span>
            ) : streaming ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-3 px-2.5 py-0.5 text-ink">
                <Icon name="spinner" size={11} className="animate-spin" />
                审阅中…{scopeTip ? `（${scopeTip}）` : ''}
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
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="selectable thin-scroll min-h-0 flex-1 overflow-auto p-4 text-xs leading-5">
        {error && (
          <p className="mb-2 break-all text-st-bad">
            <Icon name="xCircle" size={12} className="mr-1.5" />{error}
          </p>
        )}

        {/* 流式过程预览 */}
        {streaming && (
          <div className="selectable whitespace-pre-wrap rounded-lg border border-panel-3 bg-panel p-3 leading-6 text-ink-dim">
            {streamText || '…'}
            <span className="animate-pulse">▌</span>
          </div>
        )}

        {!streaming && empty && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel-3 text-ink-dim">
              <Icon name="search" size={20} />
            </span>
            <p className="text-xs text-ink">还没有审阅报告</p>
            <p className="max-w-[320px] text-[11.5px] leading-relaxed text-ink-dim">
              点上方「全文审阅」发起一次独立上下文审阅（开联网会先检索最新资料），报告落 review.md 后可逐条跳转原文。
            </p>
          </div>
        )}

        {!streaming && missTip && <p className="mb-2 rounded bg-st-draft/10 px-2 py-1 text-st-draft">{missTip}</p>}
        {!streaming &&
          sections.map((sec, i) => (
            <section key={i} className="mb-3 rounded-xl border border-panel-3 bg-panel-2 p-3.5 shadow-[0_1px_6px_rgba(0,0,0,.18)]">
              {sec.title && (
                <h3 className="mb-2 text-[13.5px] font-bold leading-snug text-ink">
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
