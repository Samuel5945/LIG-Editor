import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { diffLines, diffChars, type DiffLine } from '@shared/lineDiff'
import { describeThemePatch, parseLayoutOutput } from '@shared/layoutOutput'
import type { ArticleTheme, ProjectMeta } from '@shared/types'
import { chatOnce } from '../copilot/llm'
import { polishLayoutMessages, applyReviewMessages } from '../copilot/prompts'
import { DialogShell } from '../ui/DialogShell'
import { Button } from '../ui/primitives'
import { Icon } from '../ui/Icon'

interface PolishDialogProps {
  /** 当前全文 */
  article: string
  skill: string | null
  /** 传入审阅报告则为「按审阅修订」模式，否则为排版优化 */
  review?: string
  /** 当前生效的排版调性（视觉层基线）：传入才允许模型打包给出视觉参数补丁 */
  theme?: ArticleTheme | null
  /** 工程现有排版微调数（>0 说明有覆盖压着主题，对齐模式应用时会清空它们） */
  overrideCount?: number
  /** 确认应用：排版全文 + 可选视觉参数覆盖（仅排版优化模式会给第二参）；alignTheme = 应用时清空工程微调、视觉完全跟随主题 */
  onConfirm: (result: string, themePatch?: Partial<ProjectMeta>, only?: 'layout' | 'visual', alignTheme?: boolean) => void
  onClose: () => void
}

/** 全文优化弹窗：排版优化流式重写→行级 diff；按审阅报告出补丁本地精准覆盖→逐条字符级对比卡片 → 确认覆盖全文 */
export default function PolishDialog({
  article,
  skill,
  review,
  theme,
  overrideCount,
  onConfirm,
  onClose
}: PolishDialogProps): ReactElement {
  const isReview = !!review?.trim()
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 主题对齐（默认开）：视觉层以分类主题为准，模型只重排文字结构；应用时清空压住主题的工程微调
  const [alignTheme, setAlignTheme] = useState(true)
  // 排版优化打包输出的视觉参数（<theme> 围栏解析而来；undefined = 模型认为视觉层不用动）
  const [themePatch, setThemePatch] = useState<Partial<ProjectMeta> | undefined>(undefined)
  // 修订模式：补丁应用统计与命中明细（失配项列出供人工处理；items 用于逐条对比展示）
  const [patchInfo, setPatchInfo] = useState<{ applied: number; failed: string[]; items: { old: string; new: string }[] } | null>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const [streamLen, setStreamLen] = useState(0)
  // 排版结构与视觉参数分两组，可分别勾选应用（§5.11：不想动哪组就不勾）
  const [pickLayout, setPickLayout] = useState(true)
  const [pickVisual, setPickVisual] = useState(true)

  const run = useCallback(() => {
    setError(null)
    setResult('')
    setDone(false)
    setPatchInfo(null)
    setThemePatch(undefined)
    setStreamLen(0)
    setRunning(true)
    const messages = isReview
      ? applyReviewMessages(article, review!, skill)
      : polishLayoutMessages(article, skill, theme, alignTheme)
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
          // 全文 + 可选视觉参数一次打包：围栏剥掉后正文照旧走 diff，视觉参数进确认区预览
          const parsed = parseLayoutOutput(full)
          setResult(parsed.article + '\n')
          setThemePatch(parsed.themePatch)
        }
        setDone(true)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setRunning(false)
        abortRef.current = null
      })
  }, [article, skill, review, theme, isReview, alignTheme])

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
    <DialogShell
      icon={isReview ? 'search' : 'sparkles'}
      title={isReview ? '按审阅报告优化正文' : '排版优化'}
      hint={isReview ? '逐条落实审阅建议，未点名部分不动' : '不改内容，只拆段/理结构/标重点'}
      width={680}
      maxHeight="85vh"
      onClose={cancel}
      closeOnBackdrop={!running}
      footer={
        <>
          {done && (
            <Button variant="ghost" onClick={run} className="mr-auto" icon="refresh">
              重新生成
            </Button>
          )}
          <Button variant="ghost" onClick={cancel}>
            取消
          </Button>
          <Button
            variant="pri"
            icon="check"
            onClick={() => {
              // 对齐模式：视觉参数一律不落（模型也不会给），应用时由 App 清空工程微调
              if (alignTheme && !isReview) {
                onConfirm(result, undefined, undefined, true)
                return
              }
              pickVisual && !pickLayout
                ? onConfirm(result, themePatch, 'visual')
                : onConfirm(result, pickVisual ? themePatch : undefined)
            }}
            disabled={!done || !result || (!pickLayout && !(pickVisual && themePatch))}
          >
            {isReview ? '应用所选修订' : '应用所选'}
          </Button>
        </>
      }
    >

        <div className="min-h-0 flex-1 overflow-auto p-4 text-xs">
          {!isReview && theme && (
            <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-lg border border-panel-3 bg-panel px-3 py-2 text-[11px] leading-relaxed text-ink-dim">
              <input
                type="checkbox"
                checked={alignTheme}
                onChange={(e) => setAlignTheme(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>
                <b className="text-ink">视觉完全跟随主题</b>
                ：本次只重排文字结构，模型不改视觉参数；应用时清空工程的排版微调
                {overrideCount ? `（当前 ${overrideCount} 项微调正压着主题）` : '（本工程当前没有微调）'}
                ，让分类主题完整生效。
              </span>
            </label>
          )}
          {done && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              {[
                {
                  on: pickLayout,
                  toggle: () => setPickLayout((v) => !v),
                  icon: 'layout' as const,
                  title: isReview ? '结构修订' : '排版结构',
                  desc: isReview
                    ? `按报告改 ${patchInfo?.items.length ?? 0} 处，未点名部分不动`
                    : `全文重排，产出 ${result.length} 字`
                },
                {
                  on: pickVisual && !!themePatch,
                  toggle: () => themePatch && setPickVisual((v) => !v),
                  icon: 'palette' as const,
                  title: '视觉参数',
                  desc: themePatch
                    ? `${describeThemePatch(themePatch).length} 项（行距/字色/标题形态等）`
                    : '模型判断本篇视觉层不用动'
                }
              ].map((g) => (
                <button
                  key={g.title}
                  onClick={g.toggle}
                  disabled={!themePatch && g.icon === 'palette'}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-45 ${
                    g.on ? 'border-accent bg-accent/10' : 'border-panel-3 bg-panel hover:border-accent/50'
                  }`}
                >
                  <span className={`flex items-center gap-1.5 text-xs font-bold ${g.on ? 'text-accent' : 'text-ink'}`}>
                    <Icon name={g.icon} size={12} />
                    {g.title}
                    <Icon name={g.on ? 'checkCircle' : 'circle'} size={13} className={`ml-auto ${g.on ? 'text-accent' : 'text-ink-dim'}`} />
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-ink-dim">{g.desc}</span>
                </button>
              ))}
            </div>
          )}
          {error && (
            <>
              <p className="mb-2 break-all text-st-bad"><Icon name="xCircle" size={12} className="mr-1.5" />{error}</p>
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
              <Icon name="checkCircle" size={12} className="mr-1.5 text-st-done" />已精准应用 {patchInfo.applied} 处修订
              {patchInfo.failed.length > 0 && (
                <span className="text-st-draft">；{patchInfo.failed.length} 处未命中原文已跳过：{patchInfo.failed.join('、')}</span>
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
                          ? 'bg-st-bad/10 text-st-bad line-through'
                          : l.type === 'add'
                            ? 'bg-st-done/10 text-st-done'
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
          {done && themePatch && (
            <div className="mt-3 rounded-xl border border-panel-3 bg-panel p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
                <Icon name="palette" size={12} className="text-accent" />
                视觉参数清单
                <span className={`ml-auto text-[10.5px] font-normal ${pickVisual ? 'text-accent' : 'text-ink-dim'}`}>
                  {pickVisual ? '将随本次应用' : '已取消勾选，不会应用'}
                </span>
              </p>
              <table className="mt-2 w-full table-fixed border-collapse text-[11px]">
                <tbody>
                  {Array.from({ length: Math.ceil(describeThemePatch(themePatch).length / 2) }, (_, r) => (
                    <tr key={r} className="border-t border-panel first:border-t-0">
                      {describeThemePatch(themePatch)
                        .slice(r * 2, r * 2 + 2)
                        .map((f) => (
                          <td key={f.label} className="w-1/2 gap-2 py-1 pr-4 align-baseline">
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="w-20 shrink-0 text-ink-dim">{f.label}</span>
                              <span className="min-w-0 flex-1 truncate text-ink" title={f.value}>
                                {f.value}
                              </span>
                            </span>
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1.5 text-[10px] leading-4 text-ink-dim">
                只改列出的这几项，其余排版沿用当前调性；不想动视觉层就取消上方「视觉参数」勾选。
              </p>
            </div>
          )}
        </div>
    </DialogShell>
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
      <div className="selectable whitespace-pre-wrap rounded border-l-2 border-st-bad/70 bg-st-bad/10 px-2.5 py-1.5">
        <span className="mr-1.5 select-none rounded bg-st-bad/20 px-1 align-middle text-[10px] text-st-bad">原</span>
        {segs
          .filter((s) => s.type !== 'add')
          .map((s, i) =>
            s.type === 'del' ? (
              <del key={i} className="rounded bg-st-bad/20 px-0.5 text-st-bad">
                {s.text}
              </del>
            ) : (
              <span key={i} className="text-ink">
                {s.text}
              </span>
            )
          )}
      </div>
      <div className="selectable whitespace-pre-wrap rounded border-l-2 border-st-done/70 bg-st-done/10 px-2.5 py-1.5">
        <span className="mr-1.5 select-none rounded bg-st-done/20 px-1 align-middle text-[10px] text-st-done">改</span>
        {segs
          .filter((s) => s.type !== 'del')
          .map((s, i) =>
            s.type === 'add' ? (
              <span key={i} className="rounded bg-st-done/20 px-0.5 text-st-done">
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
