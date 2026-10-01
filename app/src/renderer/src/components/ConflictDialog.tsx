import { useMemo, useState } from 'react'
import { diffLines } from '@shared/lineDiff'
import { mergeDecision, mergeLines, mergedLineCount } from '@shared/lineMerge'
import { DialogShell } from '../ui/DialogShell'
import { Button } from '../ui/primitives'
import { Icon } from '../ui/Icon'

interface Props {
  file: string
  local: string
  external: string
  onKeepLocal: () => void
  onAcceptExternal: () => void
  /** 逐行合并后的全文（由调用方写盘并落基线） */
  onMerge: (text: string) => void
}

type Choice = 'local' | 'external' | 'merge'

/**
 * 外部修改与本地未保存内容冲突时的 diff 弹窗（§5.11）：
 * 三选项改「卡片单选」——保留本地 / 接受外部 / 逐行合并，配 diff 预览。
 * 逐行合并的默认值是并集（本地独有行留下、外部独有行收下），再允许逐行翻面；
 * 遮罩与 Esc 都不误选（三条路都有代价），Esc 等价于最保守的「保留本地」。
 */
export default function ConflictDialog({
  file,
  local,
  external,
  onKeepLocal,
  onAcceptExternal,
  onMerge
}: Props): JSX.Element {
  const lines = useMemo(() => diffLines(local, external), [local, external])
  const [choice, setChoice] = useState<Choice>('local')
  // 逐行开关：key = 行号，值 = 是否采纳该行（默认 del 行采纳本地、add 行采纳外部 = 并集）
  const [take, setTake] = useState<Record<number, boolean>>({})

  const dels = lines.filter((l) => l.type === 'del').length
  const adds = lines.filter((l) => l.type === 'add').length
  const on = (i: number): boolean => mergeDecision(lines[i], take[i])

  const merged = useMemo(() => mergeLines(lines, take), [lines, take])
  const mergedCount = useMemo(() => mergedLineCount(lines, take), [lines, take])

  const cards: { id: Choice; icon: 'save' | 'download' | 'wrench'; title: string; desc: string }[] = [
    { id: 'local', icon: 'save', title: '保留本地', desc: `以编辑器内容为准，写回磁盘覆盖外部改动（外部 ${adds} 行独有内容会丢）` },
    { id: 'external', icon: 'download', title: '接受外部', desc: `以磁盘版本为准，未保存的本地改动会丢（本地 ${dels} 行独有内容会丢）` },
    { id: 'merge', icon: 'wrench', title: '逐行合并', desc: '两边独有行都先收下（并集），再逐行翻面去掉不要的' }
  ]

  return (
    <DialogShell
      icon="alert"
      title={`检测到外部修改：${file}`}
      hint={`本地独有 ${dels} 行 · 外部独有 ${adds} 行`}
      width={760}
      maxHeight="86vh"
      onClose={onKeepLocal}
      closeOnBackdrop={false}
      footer={
        <>
          <span className="mr-auto inline-flex items-center gap-1.5 text-[11.5px] text-ink-dim">
            <Icon name="info" size={12} />
            {choice === 'merge' ? `合并结果 ${mergedCount} 行，可逐行调整` : '红色为本地独有行，绿色为外部独有行'}
          </span>
          <Button variant="ghost" onClick={onKeepLocal} title="不改动任何东西，先留着看">
            取消
          </Button>
          <Button
            variant="pri"
            icon={choice === 'merge' ? 'check' : choice === 'external' ? 'download' : 'save'}
            onClick={() => {
              if (choice === 'merge') onMerge(merged + (external.endsWith('\n') ? '\n' : ''))
              else if (choice === 'external') onAcceptExternal()
              else onKeepLocal()
            }}
          >
            {choice === 'merge' ? '应用合并结果' : choice === 'external' ? '接受外部' : '保留本地'}
          </Button>
        </>
      }
    >
      {/* 三选项卡片单选：一眼看清各条路会丢什么，而不是两个并排按钮 */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {cards.map((c) => (
          <button
            key={c.id}
            onClick={() => setChoice(c.id)}
            className={`rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color] duration-150 ${
              choice === c.id ? 'border-accent bg-accent/10' : 'border-panel-3 bg-panel hover:border-accent/50'
            }`}
          >
            <span className={`flex items-center gap-1.5 text-xs font-bold ${choice === c.id ? 'text-accent' : 'text-ink'}`}>
              <Icon name={c.icon} size={13} />
              {c.title}
              {choice === c.id && <Icon name="checkCircle" size={13} className="ml-auto text-accent" />}
            </span>
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-dim">{c.desc}</span>
          </button>
        ))}
      </div>

      <div className="selectable max-h-[46vh] overflow-y-auto thin-scroll rounded-lg border border-panel-3 bg-panel p-2 font-mono text-xs leading-5">
        {lines.map((line, i) => {
          const changed = line.type !== 'same'
          const keep = !changed || on(i)
          return (
            <div
              key={i}
              className={`flex items-start gap-2 rounded px-1.5 ${
                line.type === 'del'
                  ? 'bg-st-bad/10 text-st-bad'
                  : line.type === 'add'
                    ? 'bg-st-done/10 text-st-done'
                    : 'text-ink-dim'
              } ${changed && !keep ? 'opacity-40 line-through' : ''}`}
            >
              <span className="w-3 shrink-0 select-none text-center">{line.type === 'del' ? '-' : line.type === 'add' ? '+' : ' '}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line.text || ' '}</span>
              {changed && choice === 'merge' && (
                <button
                  onClick={() => setTake((prev) => ({ ...prev, [i]: !on(i) }))}
                  title={keep ? '去掉这一行' : '收下这一行'}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                    keep ? 'bg-accent/20 text-accent hover:bg-accent/30' : 'bg-panel-3 text-ink-dim hover:text-ink'
                  }`}
                >
                  {keep ? '保留' : '去掉'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </DialogShell>
  )
}
