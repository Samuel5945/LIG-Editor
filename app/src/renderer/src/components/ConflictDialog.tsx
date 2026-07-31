import { useMemo } from 'react'
import { diffLines } from '@shared/lineDiff'

interface Props {
  file: string
  local: string
  external: string
  onKeepLocal: () => void
  onAcceptExternal: () => void
}

/** 外部修改与本地未保存内容冲突时的 diff 弹窗（保留本地 / 接受外部） */
export default function ConflictDialog({
  file,
  local,
  external,
  onKeepLocal,
  onAcceptExternal
}: Props): JSX.Element {
  const lines = useMemo(() => diffLines(local, external), [local, external])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[80vh] w-[720px] flex-col rounded-lg border border-panel-3 bg-panel-2 shadow-xl">
        <header className="border-b border-panel-3 px-4 py-3">
          <h2 className="text-sm font-bold">检测到外部修改：{file}</h2>
          <p className="mt-1 text-xs text-ink-dim">
            该文件在编辑器之外被修改，而你有未保存的本地改动。红色为本地独有行，绿色为外部独有行。
          </p>
        </header>
        <div className="selectable min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className={
                line.type === 'del'
                  ? 'bg-red-900/40 text-red-300 line-through'
                  : line.type === 'add'
                    ? 'bg-green-900/40 text-green-300'
                    : 'text-ink-dim'
              }
            >
              <span className="mr-2 inline-block w-3 select-none text-center">
                {line.type === 'del' ? '-' : line.type === 'add' ? '+' : ' '}
              </span>
              {line.text || '\u00a0'}
            </div>
          ))}
        </div>
        <footer className="flex justify-end gap-2 border-t border-panel-3 px-4 py-3">
          <button
            onClick={onKeepLocal}
            className="rounded border border-panel-3 px-3 py-1.5 text-xs text-ink hover:bg-panel-3"
          >
            保留本地（覆盖外部修改）
          </button>
          <button
            onClick={onAcceptExternal}
            className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90"
          >
            接受外部（丢弃本地改动）
          </button>
        </footer>
      </div>
    </div>
  )
}
