import { useCallback, useRef, useState, type ReactElement } from 'react'
import { diffLines } from '@shared/lineDiff'
import { shouldSubmitOnEnter } from '@shared/imeEnter'
import { chatOnce } from '../copilot/llm'
import { modifyMessages } from '../copilot/prompts'
import { DialogShell } from '../ui/DialogShell'
import { Button, Chip, FIELD_SHELL_CLS } from '../ui/primitives'
import { Icon } from '../ui/Icon'

interface ModifyDialogProps {
  /** 编辑器选中的原文片段 */
  selection: string
  /** 挂载的 Skill 全文（可空） */
  skill: string | null
  onConfirm: (result: string) => void
  onClose: () => void
}

/** 常用指令预设：点一下即填入，省得每次现编（§5.11 指令预设胶囊化） */
const PRESETS = ['更口语化', '压缩到一半篇幅', '加个类比', '拆长句，一句一段', '去掉 AI 腔']

/** AI 修改弹窗：指令 → 流式改写预览 → 行级 diff（删除线+新增底色）→ 确认写回 */
export default function ModifyDialog({ selection, skill, onConfirm, onClose }: ModifyDialogProps): ReactElement {
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
    const { promise, abort } = chatOnce(modifyMessages(selection, inst, skill), (full) => setResult(full))
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
    <DialogShell
      icon="pencil"
      title="AI 修改选中内容"
      hint={`选中原文 ${selection.length} 字`}
      width={620}
      maxHeight="80vh"
      onClose={cancel}
      closeOnBackdrop={!running}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            取消
          </Button>
          <Button variant="pri" icon="check" onClick={() => onConfirm(result)} disabled={!done || !result}>
            应用修改
          </Button>
        </>
      }
    >
      <div className="selectable mb-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-panel-3 bg-panel p-2.5 text-xs leading-5 text-ink">
        {selection}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <Chip key={p} on={instruction === p} onClick={() => setInstruction(p)} className={running ? 'pointer-events-none opacity-45' : ''}>
            {p}
          </Chip>
        ))}
      </div>

      <div className="mb-3 flex gap-2">
        <span className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg ${FIELD_SHELL_CLS} px-2.5`}>
          <Icon name="sparkles" size={13} className="text-accent" />
          <input
            autoFocus
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (shouldSubmitOnEnter(e, { allowShift: true })) run()
            }}
            placeholder="修改指令，如：更口语化 / 压缩到一半篇幅 / 加个类比"
            className="h-[30px] min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-dim"
            disabled={running}
          />
        </span>
        <Button variant="pri" icon={running ? 'spinner' : 'brain'} onClick={run} disabled={!instruction.trim() || running}>
          {running ? '改写中…' : done ? '重新改写' : '开始改写'}
        </Button>
      </div>

      {error && (
        <p className="mb-2 break-all text-st-bad">
          <Icon name="xCircle" size={12} className="mr-1.5" />
          {error}
        </p>
      )}

      {running && result && (
        <div className="selectable mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-panel-3 bg-panel p-2.5 text-xs leading-5 text-ink">
          {result}
          <span className="animate-pulse">▌</span>
        </div>
      )}

      {diff && (
        <>
          <p className="mb-1 text-[11.5px] text-ink-dim">修改对比（红=删除，绿=新增）</p>
          <div className="selectable max-h-64 overflow-y-auto thin-scroll rounded-lg border border-panel-3 bg-panel p-2.5 text-xs leading-5">
            {diff.map((l, i) => (
              <div
                key={i}
                className={`rounded px-1 ${
                  l.type === 'del'
                    ? 'bg-st-bad/10 text-st-bad line-through'
                    : l.type === 'add'
                      ? 'bg-st-done/10 text-st-done'
                      : 'text-ink-dim'
                }`}
              >
                {l.text || ' '}
              </div>
            ))}
          </div>
        </>
      )}
    </DialogShell>
  )
}
