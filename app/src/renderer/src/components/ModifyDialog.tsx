import { useCallback, useRef, useState, type ReactElement } from 'react'
import { diffLines } from '@shared/lineDiff'
import { chatOnce } from '../copilot/llm'
import { modifyMessages } from '../copilot/prompts'

interface ModifyDialogProps {
  /** 编辑器选中的原文片段 */
  selection: string
  /** 挂载的 Skill 全文（可空） */
  skill: string | null
  onConfirm: (result: string) => void
  onClose: () => void
}

/** AI 修改弹窗：指令 → 流式改写预览 → 行级 diff（删除线+新增底色）→ 确认写回 */
export default function ModifyDialog({
  selection,
  skill,
  onConfirm,
  onClose
}: ModifyDialogProps): ReactElement {
  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  const run = useCallback(() => {
    const inst = instruction.trim()
    if (!inst || running) return
    setError(null)
    setResult('')
    setDone(false)
    setRunning(true)
    const { promise, abort } = chatOnce(modifyMessages(selection, inst, skill), (full) =>
      setResult(full)
    )
    abortRef.current = abort
    promise
      .then((full) => {
        setResult(full.trim())
        setDone(true)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setRunning(false)
        abortRef.current = null
      })
  }, [instruction, running, selection, skill])

  const cancel = useCallback(() => {
    abortRef.current?.()
    onClose()
  }, [onClose])

  const diff = done ? diffLines(selection, result) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-[620px] flex-col rounded-lg border border-panel-3 bg-panel-2 shadow-2xl">
        <div className="flex items-center border-b border-panel-3 px-4 py-2.5">
          <span className="text-sm font-bold">AI 修改选中内容</span>
          <button onClick={cancel} className="ml-auto text-xs text-ink-dim hover:text-ink">
            ✕ 关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 text-xs">
          {/* 原文 */}
          <p className="mb-1 text-ink-dim">选中原文（{selection.length} 字）</p>
          <div className="selectable mb-3 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-panel p-2 leading-5 text-ink">
            {selection}
          </div>

          {/* 指令 */}
          <div className="mb-3 flex gap-2">
            <input
              autoFocus
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') run()
              }}
              placeholder="修改指令，如：更口语化 / 压缩到一半篇幅 / 加个类比"
              className="min-w-0 flex-1 rounded bg-panel-3 px-2 py-1.5 text-ink outline-none placeholder:text-ink-dim"
              disabled={running}
            />
            <button
              onClick={run}
              disabled={!instruction.trim() || running}
              className="shrink-0 rounded bg-accent px-3 py-1.5 text-white hover:opacity-90 disabled:opacity-40"
            >
              {running ? '改写中…' : done ? '重新改写' : '开始改写'}
            </button>
          </div>

          {error && <p className="mb-2 break-all text-red-400">✗ {error}</p>}

          {/* 流式预览（完成前） */}
          {running && result && (
            <div className="selectable mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-panel p-2 leading-5 text-ink">
              {result}
              <span className="animate-pulse">▌</span>
            </div>
          )}

          {/* 完成后：行级 diff（删除线 + 新增底色） */}
          {diff && (
            <>
              <p className="mb-1 text-ink-dim">修改对比（红=删除，绿=新增）</p>
              <div className="selectable max-h-64 overflow-auto rounded bg-panel p-2 leading-5">
                {diff.map((l, i) => (
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
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-panel-3 px-4 py-2.5">
          <button onClick={cancel} className="rounded px-3 py-1.5 text-xs text-ink-dim hover:bg-panel-3">
            取消
          </button>
          <button
            onClick={() => onConfirm(result)}
            disabled={!done || !result}
            className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-40"
          >
            确认应用修改
          </button>
        </div>
      </div>
    </div>
  )
}
