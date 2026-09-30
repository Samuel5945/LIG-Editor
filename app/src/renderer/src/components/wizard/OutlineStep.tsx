import type { ReactElement } from 'react'
import type { CardFormat } from '@shared/cards'
import { Icon } from '../../ui/Icon'

/**
 * 创作向导·步 2「大纲」：大纲可编辑 + 工程名 + 立项出口。
 * 受控展示组件——outline/projName 与立项编排（流式成文/贴图生成）由向导壳层持有。
 */

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
          <textarea
            value={outline}
            onChange={(e) => setOutline(e.target.value)}
            rows={14}
            className="mb-2 w-full resize-y rounded bg-panel p-2 leading-5 text-ink outline-none"
          />
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
