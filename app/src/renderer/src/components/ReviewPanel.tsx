import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { WebSearchResult } from '@shared/types'
import { chatOnce } from '../copilot/llm'
import { reviewMessages, teardownMessages } from '../copilot/prompts'
import { ReasoningBlock } from './ReasoningBlock'
import { Icon } from '../ui/Icon'
import { Button, Segmented, Switch } from '../ui/primitives'

type PanelMode = 'review' | 'teardown'

interface ReviewPanelProps {
  project: string
  /** 当前正文（发起审阅/拆解用） */
  article: string
  skill: string | null
  /** BubbleMenu「AI 审阅」触发：自增即自动发起审阅 */
  runRequest: number
  /** BubbleMenu「拆解这段」触发：自增即切到拆解模式并发起 */
  teardownRequest: number
  /** 随 runRequest/teardownRequest 带入的选区文字：非空则只处理选段 */
  selection: string | null
  /** 点击「> 原文：…」引用行 → 编辑器定位；返回是否找到 */
  onLocate: (snippet: string) => boolean
  /** 「按报告优化正文」：把审阅报告全文交给 App 开修订弹窗（仅审阅模式） */
  onOptimize: (review: string) => void
  /** 报告写入成功后通知（创作向导的审阅步完成判定靠它重算；拆解不是流程状态，不触发） */
  onReviewSaved?: () => void
  onToast: (msg: string) => void
}

interface Section {
  title: string
  lines: string[]
}

const QUOTE_RE = /^>\s*原文[:：]\s*(.+)$/
const fileOf = (m: PanelMode): 'review.md' | 'teardown.md' => (m === 'review' ? 'review.md' : 'teardown.md')

/**
 * 分析面板（向导审阅步）：审阅找自己文章的问题，爆款拆解找（自己或对标的）文章为什么能火。
 * 两个模式各自落盘（review.md / teardown.md）、各自独立上下文一次性调用，分区展示同一套渲染；
 * 「> 原文：」引用行定位两边通用——拆解报告引用了正文片段同样可跳。
 */
export default function ReviewPanel({
  project,
  article,
  skill,
  runRequest,
  teardownRequest,
  selection,
  onLocate,
  onOptimize,
  onReviewSaved,
  onToast
}: ReviewPanelProps): ReactElement {
  const [mode, setMode] = useState<PanelMode>('review')
  const [sections, setSections] = useState<Section[]>([])
  const [reportMd, setReportMd] = useState('')
  const [empty, setEmpty] = useState(true)
  const [missTip, setMissTip] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  // 分析流式的思考过程（思考模型先想后答）：生成期唯一进度，经共享 ReasoningBlock 展示
  const [streamReasoning, setStreamReasoning] = useState('')
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
  // 联网审阅：先搜最新资料再审，事实核验不凭旧训练数据（默认开）；拆机制不需要实时信息，拆解不开联网
  const [webOn, setWebOn] = useState(true)
  const webOnRef = useRef(webOn)
  webOnRef.current = webOn
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    try {
      const md = await window.api.invoke('project:readFile', project, fileOf(mode))
      setSections(parseSections(md))
      setReportMd(md)
      setEmpty(!md.trim())
    } catch {
      setSections([])
      setReportMd('')
      setEmpty(true)
    }
  }, [project, mode])

  useEffect(() => {
    load()
    // Agent/外部工具改报告文件时热载（当前模式对应的文件）
    const off = window.api.on('file:external-change', ({ project: p, file }) => {
      if (p === project && file === fileOf(mode)) load()
    })
    return () => off()
  }, [project, mode, load])

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
      setStreamReasoning('')
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
      const { promise, abort } = chatOnce(reviewMessages(current, skillRef.current, sel, web), setStreamText, setStreamReasoning)
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
        setStreamReasoning('')
        abortRef.current = null
      }
    },
    [streaming, project, load, onToast]
  )

  // ---- 发起爆款拆解（独立一次性调用；选段非空则只拆该段） ----

  const runTeardown = useCallback(
    async (sel?: string) => {
      if (streaming) return
      const target = sel?.trim() ? sel : articleRef.current
      if (!target.trim()) {
        onToast('正文为空，先写点内容再拆解')
        return
      }
      setError(null)
      setStreaming(true)
      setStreamText('')
      setStreamReasoning('')
      setScopeTip(sel?.trim() ? `只拆选段（${sel.trim().length} 字）` : null)
      const { promise, abort } = chatOnce(teardownMessages(target, skillRef.current), setStreamText, setStreamReasoning)
      abortRef.current = abort
      try {
        const full = await promise
        await window.api.invoke('project:writeFile', project, 'teardown.md', full.trim() + '\n')
        await load()
        onToast(sel?.trim() ? '选段拆解已写入 teardown.md' : '拆解报告已写入 teardown.md')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setStreaming(false)
        setStreamText('')
        setStreamReasoning('')
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
      setMode('review')
      runReview(selectionRef.current ?? undefined)
    }
  }, [runRequest, runReview])

  // BubbleMenu「拆解这段」触发：切到拆解模式再发起（mode 变化后 load 效应自动对准 teardown.md）
  const tornRef = useRef(0)
  useEffect(() => {
    if (teardownRequest > 0 && teardownRequest !== tornRef.current) {
      tornRef.current = teardownRequest
      setMode('teardown')
      runTeardown(selectionRef.current ?? undefined)
    }
  }, [teardownRequest, runTeardown])

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
            <Segmented
              size="sm"
              ariaLabel="分析模式"
              value={mode}
              onChange={(m) => setMode(m)}
              items={[
                { value: 'review', label: '审阅', icon: 'search', title: '找自己文章的问题：结构/事实/表达，报告落 review.md' },
                { value: 'teardown', label: '爆款拆解', icon: 'compass', title: '拆为什么能火：标题钩子/开头/骨架/节奏/受众，报告落 teardown.md' }
              ]}
            />
            {!streaming && !searching && mode === 'review' && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold text-accent">当前步骤</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {streaming ? (
                <Button size="sm" variant="sec" icon="square" onClick={() => abortRef.current?.()} className="text-st-bad">
                  停止
                </Button>
              ) : mode === 'review' ? (
                <Button size="sm" variant="sec" icon="search" onClick={() => runReview()}>
                  {empty ? '全文审阅' : '重新审阅'}
                </Button>
              ) : (
                <Button size="sm" variant="sec" icon="compass" onClick={() => runTeardown()}>
                  {empty ? '拆解当前正文' : '重新拆解'}
                </Button>
              )}
              {!streaming && !empty && mode === 'review' && (
                <Button size="sm" variant="pri" icon="sparkles" onClick={() => onOptimize(reportMd)} title="按审阅报告逐条修订正文，diff 确认后覆盖">
                  优化正文
                </Button>
              )}
              {mode === 'review' && (
                <Switch
                  checked={webOn}
                  onChange={setWebOn}
                  label="联网审阅"
                  title="先搜索最新资料再审，事实核验以搜索结果为准"
                  disabled={streaming}
                />
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-dim">
            <span className="inline-flex items-center gap-1.5">
              报告写入
              <span className="rounded border border-panel-3 bg-panel px-1.5 py-0.5 font-mono text-[11px]">{fileOf(mode)}</span>
            </span>
            {searching ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-3 px-2.5 py-0.5 text-ink">
                <Icon name="globe" size={11} />
                联网检索最新资料中…
              </span>
            ) : streaming ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-3 px-2.5 py-0.5 text-ink">
                <Icon name="spinner" size={11} className="animate-spin" />
                {mode === 'review' ? '审阅中' : '拆解中'}…{scopeTip ? `（${scopeTip}）` : ''}
              </span>
            ) : empty ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-st-draft/15 px-2.5 py-0.5 font-semibold text-st-draft">
                <Icon name="alert" size={11} />
                {mode === 'review' ? '尚未审阅 · 等待执行' : '尚无拆解报告 · 拆一篇试试'}
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

        {/* 思考过程（思考模型的等待期进度） */}
        {streaming && streamReasoning && <ReasoningBlock text={streamReasoning} streaming className="mb-2" />}

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
              <Icon name={mode === 'review' ? 'search' : 'compass'} size={20} />
            </span>
            <p className="text-xs text-ink">{mode === 'review' ? '还没有审阅报告' : '还没有拆解报告'}</p>
            <p className="max-w-[320px] text-[11.5px] leading-relaxed text-ink-dim">
              {mode === 'review'
                ? '点上方「全文审阅」发起一次独立上下文审阅（开联网会先检索最新资料），报告落 review.md 后可逐条跳转原文。'
                : '把当前正文当爆款复盘（或选中一段拆它的写法）：按标题钩子/开头三行/结构骨架/情绪节奏/选题受众六维拆为什么能火，套路与骨架直接可复用。'}
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
