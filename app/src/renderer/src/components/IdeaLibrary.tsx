import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { IdeaCard, IdeaEntry } from '@shared/types'

interface IdeaLibraryProps {
  /** 外部入库后自增，变化即自动刷新 */
  version: number
  /** 点「生成大纲」：把选题送进脑暴面板的大纲流程 */
  onMakeOutline: (card: IdeaCard) => void
  onToast: (msg: string) => void
}

/** 左栏选题库：展示全局 idea-inbox.md 的结构化条目，可生成大纲/删除 */
export default function IdeaLibrary({ version, onMakeOutline, onToast }: IdeaLibraryProps): ReactElement {
  const [ideas, setIdeas] = useState<IdeaEntry[]>([])

  const refresh = useCallback(async () => {
    try {
      setIdeas(await window.api.invoke('ideas:list'))
    } catch {
      // 库文件缺失/损坏时展示空列表
      setIdeas([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, version])

  const remove = useCallback(
    async (entry: IdeaEntry) => {
      if (!window.confirm(`删除选题「${entry.title}」？`)) return
      await window.api.invoke('ideas:remove', entry.index)
      onToast('已删除')
      void refresh()
    },
    [refresh, onToast]
  )

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2 text-xs">
      <div className="mb-1 flex items-center px-1">
        <span className="text-ink-dim">共 {ideas.length} 条（来自脑暴入库）</span>
        <button onClick={() => void refresh()} className="ml-auto rounded px-1.5 py-0.5 text-ink-dim hover:bg-panel-3" title="刷新">
          ⟳
        </button>
      </div>
      {ideas.length === 0 && <p className="px-1 py-3 text-center text-ink-dim">空空如也，去「脑暴」面板产出选题后点「入库」</p>}
      {ideas.map((it) => (
        <div key={`${it.index}-${it.title}`} className="group mb-1.5 rounded-lg border border-panel-3 bg-panel p-2">
          <div className="flex items-start gap-1.5">
            <span className={`shrink-0 rounded px-1 py-0.5 font-bold ${it.score >= 8 ? 'bg-green-950 text-green-400' : 'bg-panel-3 text-ink-dim'}`}>
              {it.score}
            </span>
            <p className="min-w-0 flex-1 font-bold text-ink">{it.title}</p>
          </div>
          {it.angle && <p className="mt-1 text-ink-dim">角度：{it.angle}</p>}
          {it.audience && <p className="text-ink-dim">读者：{it.audience}</p>}
          {it.reason && <p className="text-ink-dim">{it.reason}</p>}
          <div className="mt-1.5 flex gap-2">
            <button
              onClick={() => onMakeOutline({ title: it.title, angle: it.angle, audience: it.audience, score: it.score, reason: it.reason })}
              className="rounded bg-accent px-2 py-0.5 text-white hover:opacity-90"
            >
              生成大纲 →
            </button>
            <button onClick={() => void remove(it)} className="ml-auto rounded px-2 py-0.5 text-ink-dim opacity-0 hover:bg-panel-3 hover:text-red-400 group-hover:opacity-100">
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
