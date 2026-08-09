import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { diffLines, diffChars, type DiffLine } from '@shared/lineDiff'
import { chatOnce } from '../copilot/llm'
import { polishLayoutMessages, applyReviewMessages } from '../copilot/prompts'

interface PolishDialogProps {
  /** 当前全文 */
  article: string
  skill: string | null
  /** 传入审阅报告则为「按审阅修订」模式，否则为排版优化 */
  review?: string
  onConfirm: (result: string) => void
  onClose: () => void
}

/** 全文优化弹窗：排版优化流式重写→行级 diff；按审阅报告出补丁本地精准覆盖→逐条字符级对比卡片 → 确认覆盖全文 */
export default function PolishDialog({ article, skill, review, onConfirm, onClose }: PolishDialogProps): ReactElement {
  const isReview = !!review?.trim()
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 修订模式：补丁应用统计与命中明细（失配项列出供人工处理；items 用于逐条对比展示）
  const [patchInfo, setPatchInfo] = useState<{ applied: number; failed: string[]; items: { old: string; new: string }[] } | null>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const [streamLen, setStreamLen] = useState(0)

  const run = useCallback(() => {
    setError(null)
    setResult('')
    setDone(false)
    setPatchInfo(null)
    setStreamLen(0)
    setRunning(true)
    const messages = isReview
      ? applyReviewMessages(article, review!, skill)
      : polishLayoutMessages(article, skill)
    const { promise, abort } = chatOnce(messages, (full) => {
      setStreamLen(full.length)
      if (!isReview) setResult(full)
    })
    abortRef.current = abort
    promise
      .then((full) => {
        if (isReview) {
          // 解补丁 → 本地逐条替换，不重写全文
          const patches = parsePatches(full)
          if (patches.length === 0) throw new Error('未解析到任何修订补丁，可重试')
          let text = article
          const failed: string[] = []
          const items: { old: string; new: string }[] = []
          let applied = 0
          for (const p of patches) {
            const idx = text.indexOf(p.old)
            if (idx < 0) {
              failed.push(p.old.slice(0, 24) + (p.old.length > 24 ? '…' : ''))
              continue
            }
            text = text.slice(0, idx) + p.new + text.slice(idx + p.old.length)
            applied++
            items.push(p)
          }
          if (applied === 0) throw new Error('补丁均未在正文中命中（正文可能已变动），可重试')
          setPatchInfo({ applied, failed, items })
          setResult(text)
        } else {
          setResult(full.trim() + '\n')
        }
        setDone(true)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setRunning(false)
        abortRef.current = null
      })
  }, [article, skill, review, isReview])

  // 打开即自动开跑
  const startedRef = useRef(false)
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true
      run()
    }
  }, [run])

  const cancel = useCallback(() => {
    abortRef.current?.()
    onClose()
  }, [onClose])

  // 行级全文对比只用于排版优化（整体重写）；审阅修订按补丁逐条展示，不再铺全文 diff
  const diff = done && !isReview ? diffLines(article, result) : null
  const changed = diff?.filter((l) => l.type !== 'same').length ?? 0
  // 只展示变化处前后各一行上下文，其余未变行折叠，不把全文铺出来
  const rows = diff ? collapseSame(diff) : null

  // 流式阶段只露尾部几行进度，不滚全文
  const streamTail = running && result ? result.split('\n').slice(-4).join('\n') : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[85vh] w-[680px] flex-col rounded-lg border border-panel-3 bg-panel-2 shadow-2xl">
        <div className="flex items-center border-b border-panel-3 px-4 py-2.5">
          <span className="text-sm font-bold">{isReview ? '按审阅报告优化正文' : '排版优化'}</span>
          <span className="ml-2 text-xs text-ink-dim">
            {isReview ? '逐条落实审阅建议，未点名部分不动' : '不改内容，只拆段/理结构/标重点'}
          </span>
          <button onClick={cancel} className="ml-auto text-xs text-ink-dim hover:text-ink">
            ✕ 关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 text-xs">
          {error && (
            <>
              <p className="mb-2 break-all text-red-400">✗ {error}</p>
              <button onClick={run} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90">
                重试
              </button>
            </>
          )}

          {running && (
            <div className="selectable whitespace-pre-wrap rounded bg-panel p-2 leading-5 text-ink-dim">
              {isReview ? (
                <>生成修订补丁中（只产出需修改的片段，不重写全文）…{streamLen > 0 && `已接收 ${streamLen} 字`}</>
              ) : (
                <>
                  {result && (
                    <p className="mb-1 text-[10px]">排版整理中…已生成 {result.length} 字，完成后只展示变化对比</p>
                  )}
                  {streamTail || '排版整理中…'}
                </>
              )}
              <span className="animate-pulse">▌</span>
            </div>
          )}

          {done && patchInfo && (
            <p className="mb-2 text-ink-dim">
              ✓ 已精准应用 {patchInfo.applied} 处修订
              {patchInfo.failed.length > 0 && (
                <span className="text-amber-400">；{patchInfo.failed.length} 处未命中原文已跳过：{patchInfo.failed.join('、')}</span>
              )}
            </p>
          )}

          {done && isReview && patchInfo && patchInfo.items.length > 0 && (
            <div className="max-h-[55vh] space-y-3 overflow-auto pr-1">
              <p className="text-ink-dim">逐条对比（红=删掉的内容，绿=新增的内容）：</p>
              {patchInfo.items.map((p, i) => (
                <div key={i} className="rounded border border-panel-3 bg-panel p-2.5">
                  <p className="mb-1.5 text-[10px] text-ink-dim">
                    修订 {i + 1} / {patchInfo.items.length}
                  </p>
                  <DiffPair oldText={p.old} newText={p.new} />
                </div>
              ))}
            </div>
          )}

          {rows && (
            <>
              <p className="mb-1 text-ink-dim">排版对比（红=原文，绿=新版，共 {changed} 行变化，未变部分已折叠）</p>
              <div className="selectable max-h-[55vh] overflow-auto rounded bg-panel p-2 leading-5">
                {rows.map((l, i) =>
                  l.type === 'skip' ? (
                    <div key={i} className="my-0.5 text-center text-[10px] text-ink-dim">
                      ⋯ 未变化的 {l.count} 行已折叠 ⋯
                    </div>
                  ) : (
                    <div
                      key={i}
                      className={
                        l.type === 'del'
                          ? 'bg-red-950/60 text-red-300 line-through'
                          : l.type === 'add'
                            ? 'bg-green-950/60 text-green-300'
                            : 'text-ink-dim'
                      }
                    >
                      {l.text || '\u00A0'}
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-panel-3 px-4 py-2.5">
          {done && (
            <button onClick={run} className="mr-auto rounded px-3 py-1.5 text-xs text-ink-dim hover:bg-panel-3">
              ↻ 重新生成
            </button>
          )}
          <button onClick={cancel} className="rounded px-3 py-1.5 text-xs text-ink-dim hover:bg-panel-3">
            取消
          </button>
          <button
            onClick={() => onConfirm(result)}
            disabled={!done || !result}
            className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-40"
          >
            {isReview ? '应用修订' : '应用新排版'}
          </button>
        </div>
      </div>
    </div>
  )
}

type DiffRow = DiffLine | { type: 'skip'; count: number }

/** 从模型输出中提取 {old,new} 补丁数组（容忍代码围栏/前后废话） */
function parsePatches(raw: string): { old: string; new: string }[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const arr = JSON.parse(raw.slice(start, end + 1)) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (p): p is { old: string; new: string } =>
        !!p && typeof (p as { old?: unknown }).old === 'string' && typeof (p as { new?: unknown }).new === 'string' &&
        (p as { old: string }).old.length > 0
    )
  } catch {
    return []
  }
}

/** 把连续未变行折叠成一条提示，变化处前后各保留 ctx 行上下文 */
function collapseSame(diff: DiffLine[], ctx = 1): DiffRow[] {
  const rows: DiffRow[] = []
  let i = 0
  while (i < diff.length) {
    if (diff[i].type !== 'same') {
      rows.push(diff[i])
      i++
      continue
    }
    let j = i
    while (j < diff.length && diff[j].type === 'same') j++
    // 行首的同段只留尾部上下文，行尾只留头部，中间段两头都留
    const lead = i === 0 ? 0 : ctx
    const trail = j === diff.length ? 0 : ctx
    if (j - i > lead + trail + 1) {
      for (let k = i; k < i + lead; k++) rows.push(diff[k])
      rows.push({ type: 'skip', count: j - i - lead - trail })
      for (let k = j - trail; k < j; k++) rows.push(diff[k])
    } else {
      for (let k = i; k < j; k++) rows.push(diff[k])
    }
    i = j
  }
  return rows
}

/** 单条修订对比：上行原文（红=删掉的字），下行新版（绿=新增的字），字符级 diff 精确到改动的字 */
function DiffPair({ oldText, newText }: { oldText: string; newText: string }): ReactElement {
  const segs = useMemo(() => diffChars(oldText, newText), [oldText, newText])
  return (
    <div className="space-y-1.5 text-xs leading-6">
      <div className="selectable whitespace-pre-wrap rounded border-l-2 border-red-500/70 bg-red-500/10 px-2.5 py-1.5">
        <span className="mr-1.5 select-none rounded bg-red-500/25 px-1 align-middle text-[10px] text-red-300">原</span>
        {segs
          .filter((s) => s.type !== 'add')
          .map((s, i) =>
            s.type === 'del' ? (
              <del key={i} className="rounded bg-red-500/25 px-0.5 text-red-300">
                {s.text}
              </del>
            ) : (
              <span key={i} className="text-ink">
                {s.text}
              </span>
            )
          )}
      </div>
      <div className="selectable whitespace-pre-wrap rounded border-l-2 border-green-500/70 bg-green-500/10 px-2.5 py-1.5">
        <span className="mr-1.5 select-none rounded bg-green-500/25 px-1 align-middle text-[10px] text-green-300">改</span>
        {segs
          .filter((s) => s.type !== 'del')
          .map((s, i) =>
            s.type === 'add' ? (
              <span key={i} className="rounded bg-green-500/25 px-0.5 text-green-300">
                {s.text}
              </span>
            ) : (
              <span key={i} className="text-ink">
                {s.text}
              </span>
            )
          )}
      </div>
    </div>
  )
}
