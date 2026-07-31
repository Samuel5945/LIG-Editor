import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import type { ReactElement } from 'react'
import type { FigureGalleryAttrs } from '@shared/markdown'

/**
 * figSuggest：配图建议占位块（对应 md 单行 <!-- fig-suggest: 描述 -->）
 * M6 三配图管线的入口卡片：AI 生图 / 代码绘图 / 导入图片
 */

export type FigPipeline = 'ai' | 'code' | 'import'

/** 占位 → 成图后写回的图片属性 */
export interface FigureAttrs {
  src: string
  alt: string
  caption: string
  figureSource: string
}

/** 配图成品：单图或多图图集（多图导入时产出） */
export type FigureInsert = FigureAttrs | FigureGalleryAttrs

/** 成品 → 待插入的 TipTap 节点 JSON */
export function figureInsertNode(p: FigureInsert): { type: string; attrs: FigureInsert } {
  return 'images' in p ? { type: 'figureGallery', attrs: p } : { type: 'figureImage', attrs: p }
}

export interface FigSuggestStorage {
  /** App 注入：点击管线按钮 → 打开配图弹窗；replace 把占位换成成图/图集 */
  onAction: (
    pipeline: FigPipeline,
    ctx: { desc: string; replace: (attrs: FigureInsert) => void }
  ) => void
}

function FigSuggestView({ node, editor, getPos, deleteNode, updateAttributes }: NodeViewProps): ReactElement {
  const { desc } = node.attrs as { desc: string }
  const storage = editor.storage.figSuggest as FigSuggestStorage

  const fire = (pipeline: FigPipeline): void => {
    storage.onAction(pipeline, {
      desc,
      replace: (attrs) => {
        const pos = getPos()
        editor
          .chain()
          .focus()
          .insertContentAt({ from: pos, to: pos + node.nodeSize }, figureInsertNode(attrs))
          .run()
      }
    })
  }

  const btn = 'rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 hover:border-sky-500 hover:text-sky-400'

  return (
    <NodeViewWrapper className="my-3" data-drag-handle>
      <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/40 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="shrink-0">🖼 配图建议：</span>
          <input
            value={desc}
            onChange={(e) => updateAttributes({ desc: e.target.value })}
            placeholder="描述这张图画什么…"
            className="min-w-0 flex-1 bg-transparent text-slate-300 outline-none placeholder:text-slate-600"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => fire('ai')} className={btn} title="AI 文生图 → 预览 → 插入正文">
            ✨ AI 生图
          </button>
          <button type="button" onClick={() => fire('code')} className={btn} title="AI 写 HTML 绘图 → 离屏渲染 PNG → 插入">
            📊 代码绘图
          </button>
          <button type="button" onClick={() => fire('import')} className={btn} title="导入本地图片，可选抠图去背景">
            📁 导入图片
          </button>
          <button
            type="button"
            onClick={() => deleteNode()}
            className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-700 hover:text-red-400"
            title="删除此配图占位"
          >
            🗑
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export const FigSuggest = Node.create({
  name: 'figSuggest',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return { desc: { default: '' } }
  },

  addStorage(): FigSuggestStorage {
    return { onAction: () => undefined }
  },

  parseHTML() {
    return [{ tag: 'div[data-fig-suggest]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-fig-suggest': '' }, `配图建议：${HTMLAttributes.desc ?? ''}`]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigSuggestView)
  }
})
