import { useState, type ReactElement } from 'react'
import type { CardFormat } from '@shared/cards'
import { Icon } from '../../ui/Icon'

/**
 * 创作向导·步 2「大纲」：条目化编辑 + 拖拽重排 + 工程名 + 立项出口。
 * 受控展示组件——outline/projName 与立项编排（流式成文/贴图生成）由向导壳层持有。
 *
 * 条目模型（UI/UX PRD §5.3「条目卡片化，拖拽把手 hover 显现」）：标题行（#/##/…）开新条目，
 * 其后的说明行/空行归入该条目——拖动小节时说明跟着走，不会拖散。无标题的行各自成条
 * （纯编号/自由文本大纲退化为逐行拖拽，依然可用）。序列化恒用 \n split/join 精确往返，
 * 作者/AI 写出的原文形态一个不丢；成文提示词与工程名提取（/^#\s+/m）拿到同一份文本。
 */

/** 标题行判定：1-6 个 # 开头（#tag 这类正文中缀不受影响——锚定行首） */
const isHeadingLine = (line: string): boolean => /^#{1,6}(\s|$)/.test(line)

interface OutlineEntry {
  lines: string[]
}

function buildEntries(lines: string[]): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  let cur: OutlineEntry | null = null
  for (const line of lines) {
    if (isHeadingLine(line) || !cur) {
      cur = { lines: [line] }
      entries.push(cur)
    } else {
      cur.lines.push(line)
    }
  }
  return entries
}

/** 条目首行（标题行）的展示层级：# 级数-1 定缩进 */
function entryDepth(entry: OutlineEntry): number {
  const m = /^#+/.exec(entry.lines[0] ?? '')
  return m ? Math.max(0, m[0].length - 1) : 0
}

export interface OutlineStepProps {
  /** outlining=生成中（头部切「停止」）；outline=可编辑确认 */
  phase: 'outlining' | 'outline'
  outline: string
  setOutline: (v: string) => void
  projName: string
  setProjName: (v: string) => void
  /** 当前已打开工程（有值才显示「写入当前工程」） */
  project: string | null
  onCreateArticle: () => void
  onCreateCards: (format: CardFormat) => void
  onWriteToCurrent: () => void
  onAbort: () => void
  onBack: () => void
}

export default function OutlineStep({
  phase,
  outline,
  setOutline,
  projName,
  setProjName,
  project,
  onCreateArticle,
  onCreateCards,
  onWriteToCurrent,
  onAbort,
  onBack
}: OutlineStepProps): ReactElement {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  const entries = buildEntries(outline.replace(/\r\n?/g, '\n').split('\n'))
  const serialize = (list: OutlineEntry[]): string => list.flatMap((e) => e.lines).join('\n')

  const editLine = (entryIdx: number, lineIdx: number, v: string): void => {
    const next = entries.map((e, i) => (i === entryIdx ? { lines: e.lines.map((l, j) => (j === lineIdx ? v : l)) } : e))
    setOutline(serialize(next))
  }

  /** 拖拽落位：拖到目标条目上 = 顶到它的位置（目标及其后顺延；向上拖落在目标前、向下拖落在目标后） */
  const dropOn = (i: number): void => {
    if (dragIdx === null || dragIdx === i) return
    const next = [...entries]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(i, 0, moved)
    setOutline(serialize(next))
  }

  return (
    <>
      <div className="mb-2 flex items-center">
        <span className="font-bold text-ink">{phase === 'outlining' ? '大纲生成中…' : '大纲（可直接编辑）'}</span>
        {phase === 'outlining' ? (
          <button onClick={onAbort} className="ml-auto rounded bg-panel-3 px-2 py-0.5 text-st-bad hover:bg-panel">
            停止
          </button>
        ) : (
          <button onClick={onBack} className="ml-auto rounded px-2 py-0.5 text-ink-dim hover:bg-panel-3">
            <Icon name="chevronLeft" size={12} className="mr-1" />返回
          </button>
        )}
      </div>
      {phase === 'outline' && (
        <>
          <div className="thin-scroll mb-1 max-h-[340px] overflow-y-auto rounded bg-panel p-1.5">
            {entries.map((entry, i) => (
              <div
                key={i}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOverIdx(i)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropOn(i)
                  setDragIdx(null)
                  setOverIdx(null)
                }}
                onDragEnd={() => {
                  setDragIdx(null)
                  setOverIdx(null)
                }}
                className={`group mb-0.5 rounded px-1 py-0.5 ${dragIdx === i ? 'opacity-40' : 'hover:bg-panel-3'} ${
                  overIdx === i && dragIdx !== null && dragIdx !== i ? 'ring-1 ring-accent' : ''
                }`}
                style={{ marginLeft: entryDepth(entry) * 16 }}
              >
                {entry.lines.map((line, j) => (
                  <div key={j} className="flex items-center gap-1.5">
                    {j === 0 && (
                      <Icon
                        name="grip"
                        size={12}
                        className="shrink-0 cursor-grab text-ink-dim opacity-0 group-hover:opacity-100"
                      />
                    )}
                    {j > 0 && <span className="w-3 shrink-0" />}
                    <input
                      value={line}
                      onChange={(e) => editLine(i, j, e.target.value)}
                      placeholder={line.trim() === '' ? '空行' : ''}
                      className={`min-w-0 flex-1 bg-transparent text-xs leading-5 text-ink outline-none placeholder:text-ink-dim/60 ${
                        j === 0 && /^#\s/.test(line) ? 'font-bold' : ''
                      }`}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="mb-2 text-[11px] text-ink-dim">悬停出把手，拖动整节调整顺序（说明行随节走）；点文字可改写。一级标题（#）用作工程名。</p>
          <div className="mb-2 flex items-center gap-2">
            <span className="shrink-0 text-ink-dim">工程名</span>
            <input
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
              className="min-w-0 flex-1 rounded bg-panel-3 px-2 py-1 text-ink outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onCreateArticle} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90" title="新建工程并生成公众号文章正文">
              <Icon name="file" size={13} className="mr-1" />公众号文章
            </button>
            <button onClick={() => onCreateCards('wechat')} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90" title="新建工程并生成多张竖版公众号图片卡片">
              <Icon name="image" size={13} className="mr-1" />公众号贴图
            </button>
            <button onClick={() => onCreateCards('xhs')} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90" title="新建工程并生成小红书风图文卡片">
              <Icon name="layers" size={13} className="mr-1" />小红书贴图
            </button>
            {project && (
              <button onClick={onWriteToCurrent} className="rounded bg-panel-3 px-3 py-1.5 text-ink hover:bg-panel" title={`覆盖写入「${project}」的正文`}>
                写入当前工程
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}
