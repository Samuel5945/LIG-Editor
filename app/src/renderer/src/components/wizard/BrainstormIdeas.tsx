import { useRef, type ReactElement } from 'react'
import type { IdeaCard } from '@shared/types'
import { Icon } from '../../ui/Icon'
import { Button, Chip, ChipGroup } from '../../ui/primitives'

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
      <p className="mb-2 leading-relaxed text-ink-dim">
        投喂素材（图片/txt/md/pdf）和要求，AI 逐条出选题卡。<b className="text-ink">全程独立上下文，不影响右侧对话。</b>
      </p>
      {/* 流程胶囊条：单行不折行，窄栏横滑隐藏滚动条（§4 chip 定案） */}
      <ChipGroup className="mb-3">
        <Chip>投喂素材</Chip>
        <Icon name="chevronRight" size={11} className="shrink-0 text-ink-dim" />
        <Chip>脑暴选题卡</Chip>
        <Icon name="chevronRight" size={11} className="shrink-0 text-ink-dim" />
        <Chip>生成大纲</Chip>
        <Icon name="chevronRight" size={11} className="shrink-0 text-ink-dim" />
        <Chip>立项写正文</Chip>
      </ChipGroup>
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
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button variant="sec" size="sm" icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>
          投喂素材
        </Button>
        <Chip on={webOn} icon="globe" onClick={busy ? undefined : toggleWeb} title="开启后先联网搜选题相关实时资讯，再喂给模型">
          联网{webOn ? '已开' : '未开'}
        </Chip>
        {attachments.map((a, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-2.5 py-1 text-[10.5px] text-ink-dim">
            {a.dataUrl ? <img src={a.dataUrl} alt={a.name} className="h-6 w-6 rounded object-cover" /> : null}
            <span className="max-w-[120px] truncate">{a.dataUrl ? a.name : `${a.name}（${a.text.length}字）`}</span>
            <button onClick={() => removeAttachment(i)} title="移除该附件" className="text-ink-dim hover:text-st-bad">
              <Icon name="x" size={11} />
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
        className="mb-2 w-full resize-none rounded-lg bg-panel-2 p-3 text-ink outline-none placeholder:text-ink-dim disabled:opacity-50"
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {phase === 'brainstorming' ? (
          <Button variant="sec" size="md" icon="square" onClick={onAbort} className="text-st-bad">
            停止脑暴
          </Button>
        ) : (
          <>
            <Button variant="pri" icon="brain" onClick={onRunBrainstorm}>
              开始脑暴
            </Button>
            <Button
              variant="sec"
              onClick={() => ask.trim() && onDirectOutline()}
              disabled={!ask.trim()}
              title="跳过脑暴，按要求直接出大纲"
            >
              直接出大纲
            </Button>
          </>
        )}
      </div>

      {/* 选题卡：评分徽标统一胶囊样式（§5.3） */}
      {cards.map((c, i) => (
        <div key={i} className="mb-2 rounded-xl border border-panel-3 bg-panel-2 p-3 shadow-[0_1px_6px_rgba(0,0,0,.18)]">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[13.5px] font-bold leading-snug text-ink">{c.title}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                c.score >= 8 ? 'bg-accent/15 text-accent' : 'bg-panel-3 text-ink-dim'
              }`}
              title={`脑暴评分 ${c.score}`}
            >
              {c.score} 分
            </span>
          </div>
          <p className="mt-1.5 text-ink-dim">角度：{c.angle}</p>
          <p className="text-ink-dim">读者：{c.audience}</p>
          <p className="mt-0.5 leading-relaxed text-ink-dim">{c.reason}</p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="sec"
              size="sm"
              icon="save"
              onClick={async () => {
                await window.api.invoke('ideas:add', c)
                onIdeasChanged()
                onToast('已入选题库（左栏「选题库」可查看）')
              }}
            >
              入库
            </Button>
            <Button variant="pri" size="sm" icon="bulb" onClick={() => onOutlineFromCard(c)}>
              生成大纲
            </Button>
          </div>
        </div>
      ))}
    </>
  )
}
