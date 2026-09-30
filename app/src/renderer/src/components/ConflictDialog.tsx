import { useMemo } from 'react'
import { diffLines } from '@shared/lineDiff'
import { DialogShell } from '../ui/DialogShell'
import { Button } from '../ui/primitives'
import { Icon } from '../ui/Icon'

interface Props {
  file: string
  local: string
  external: string
  onKeepLocal: () => void
  onAcceptExternal: () => void
}

/**
 * 外部修改与本地未保存内容冲突时的 diff 弹窗（保留本地 / 接受外部）。
 * 统一壳（§5.11）：遮罩与 Esc 都不关——两条路都有代价，必须显式选一条；
 * diff 配色走状态色单源（删除=danger 浅底+删除线，新增=success 浅底，§5.10）。
 */
export default function ConflictDialog({ file, local, external, onKeepLocal, onAcceptExternal }: Props): JSX.Element {
  const lines = useMemo(() => diffLines(local, external), [local, external])
  const dels = lines.filter((l) => l.type === 'del').length
  const adds = lines.filter((l) => l.type === 'add').length

  return (
    <DialogShell
      icon="alert"
      title={`检测到外部修改：${file}`}
      hint={`本地独有 ${dels} 行 · 外部独有 ${adds} 行`}
      width={720}
      maxHeight="80vh"
      onClose={onKeepLocal}
      closeOnBackdrop={false}
      footer={
        <>
          <span className="mr-auto inline-flex items-center gap-1.5 text-[11.5px] text-ink-dim">
            <Icon name="info" size={12} />
            红色为本地独有行，绿色为外部独有行
          </span>
          <Button variant="sec" onClick={onKeepLocal} title="以编辑器里的内容为准，写回磁盘覆盖外部修改">
            保留本地
          </Button>
          <Button variant="pri" onClick={onAcceptExternal} title="以磁盘上的外部版本为准，未保存的本地改动会丢失">
            接受外部
          </Button>
        </>
      }
    >
      <div className="selectable -mx-1.5 font-mono text-xs leading-5">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={`flex gap-2 rounded px-1.5 ${
              line.type === 'del'
                ? 'bg-st-bad/10 text-st-bad line-through'
                : line.type === 'add'
                  ? 'bg-st-done/10 text-st-done'
                  : 'text-ink-dim'
            }`}
          >
            <span className="w-3 shrink-0 select-none text-center">{line.type === 'del' ? '-' : line.type === 'add' ? '+' : ' '}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line.text || ' '}</span>
          </div>
        ))}
      </div>
    </DialogShell>
  )
}
