import { useRef, type ReactElement } from 'react'
import type { IdeaCard } from '@shared/types'

/**
 * 创作向导·步 1「选题」：素材投喂 + 要求 + 选题卡。
 * 受控展示组件——会话状态与编排（脑暴/出大纲的流式调用）由向导壳层持有，
 * 这里只渲染与上报操作，保证纯搬家不漂移。
 */

export interface Attachment {
  name: string
  text: string
  /** 图片附件的 dataURL（走 vision 多模态）；文档附件此字段为空 */
  dataUrl?: string
}

export interface BrainstormIdeasProps {
  /** input=可操作；brainstorming=流式出卡中（按钮切「停止」） */
  phase: 'input' | 'brainstorming'
  busy: boolean
  ask: string
  setAsk: (v: string) => void
  attachments: Attachment[]
  removeAttachment: (index: number) => void
  addFiles: (files: FileList | null) => void
  webOn: boolean
  toggleWeb: () => void
  cards: IdeaCard[]
  onIdeasChanged: () => void
  onToast: (msg: string) => void
  onRunBrainstorm: () => void
  /** 跳过脑暴，按当前要求直接出大纲 */
  onDirectOutline: () => void
  onOutlineFromCard: (card: IdeaCard) => void
  onAbort: () => void
}

export default function BrainstormIdeas({
  phase,
  busy,
  ask,
  setAsk,
  attachments,
  removeAttachment,
  addFiles,
  webOn,
  toggleWeb,
  cards,
  onIdeasChanged,
  onToast,
  onRunBrainstorm,
  onDirectOutline,
  onOutlineFromCard,
  onAbort
}: BrainstormIdeasProps): ReactElement {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <p className="mb-2 text-ink-dim">
        投喂素材（图片/txt/md/pdf）和要求 → 脑暴选题卡 → 生成大纲 → 立项写正文。全程独立上下文，不影响对话。
      </p>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".txt,.md,.pdf,image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="mb-2 flex flex-wrap gap-1">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded border border-dashed border-panel-3 px-2 py-1 text-ink-dim hover:border-accent hover:text-accent disabled:opacity-40"
        >
          📎 投喂素材
        </button>
        <button
          onClick={toggleWeb}
          disabled={busy}
          title="开启后先联网搜选题相关实时资讯，再喂给模型"
          className={`rounded px-2 py-1 disabled:opacity-40 ${webOn ? 'bg-accent text-white' : 'border border-dashed border-panel-3 text-ink-dim hover:border-accent hover:text-accent'}`}
        >
          🌐 联网{webOn ? '已开' : ''}
        </button>
        {attachments.map((a, i) => (
          <span key={i} className="flex items-center gap-1 rounded bg-panel-3 px-1.5 py-1 text-[10px] text-ink-dim">
            {a.dataUrl ? <img src={a.dataUrl} alt={a.name} className="h-6 w-6 rounded object-cover" /> : null}
            {a.dataUrl ? a.name : `${a.name}（${a.text.length}字）`}
            <button onClick={() => removeAttachment(i)} className="hover:text-red-400">
              ✕
            </button>
          </span>
        ))}
      </div>
      <textarea
        rows={3}
        value={ask}
        onChange={(e) => setAsk(e.target.value)}
        placeholder="补充要求 / 选题方向（脑暴可空，直接出大纲必填）"
        disabled={busy}
        className="mb-2 w-full resize-none rounded bg-panel-3 p-2 text-ink outline-none placeholder:text-ink-dim disabled:opacity-50"
      />
      <div className="mb-3 flex gap-2">
        {phase === 'brainstorming' ? (
          <button onClick={onAbort} className="rounded bg-panel-3 px-3 py-1.5 text-red-400 hover:bg-panel">
            停止
          </button>
        ) : (
          <>
            <button onClick={onRunBrainstorm} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90">
              🧠 开始脑暴
            </button>
            <button
              onClick={() => ask.trim() && onDirectOutline()}
              disabled={!ask.trim()}
              className="rounded bg-panel-3 px-3 py-1.5 text-ink hover:bg-panel disabled:opacity-40"
              title="跳过脑暴，按要求直接出大纲"
            >
              直接出大纲
            </button>
          </>
        )}
      </div>

      {/* 选题卡 */}
      {cards.map((c, i) => (
        <div key={i} className="mb-1.5 rounded-lg border border-panel-3 bg-panel p-2.5">
          <div className="flex items-start gap-2">
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${c.score >= 8 ? 'bg-green-950 text-green-400' : 'bg-panel-3 text-ink-dim'}`}
            >
              {c.score}
            </span>
            <p className="min-w-0 flex-1 text-[13px] font-bold text-ink">{c.title}</p>
          </div>
          <p className="mt-1 text-ink-dim">角度：{c.angle}</p>
          <p className="text-ink-dim">读者：{c.audience}</p>
          <p className="text-ink-dim">{c.reason}</p>
          <div className="mt-1.5 flex gap-2">
            <button
              onClick={async () => {
                await window.api.invoke('ideas:add', c)
                onIdeasChanged()
                onToast('已入选题库（左栏「选题库」可查看）')
              }}
              className="rounded bg-panel-3 px-2 py-0.5 text-ink hover:bg-panel-2"
            >
              入库
            </button>
            <button onClick={() => onOutlineFromCard(c)} className="rounded bg-accent px-2 py-0.5 text-white hover:opacity-90">
              生成大纲 →
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
