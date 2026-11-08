import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useId, useMemo, useSyncExternalStore, type ReactElement } from 'react'
import type { MotionNode } from '@shared/markdown'
import { motionToSvg, scanMotion, substituteMotionTokens, type MotionPalette } from '@shared/motionSvg'
import { motionPaletteFor } from '@shared/exportHtml'
import { Icon } from '../ui/Icon'

/**
 * motion：公众号动效块（对应 md 单行 <!-- motion: {json} -->）
 * 编辑器里实时渲染 SVG/SMIL 预览（Chromium 原生支持，热区可点），调色板与导出同源。
 * 片段非法时显示具体校验错误 + still 静态文字，作者可让副驾驶按报错修复。
 */

export interface MotionStorage {
  palette: MotionPalette
  /** ArticleEditor 注入：主题/昼夜变化时换调色板并通知 NodeView 重渲染 */
  setPalette: (p: MotionPalette) => void
  subscribe: (cb: () => void) => () => void
}

function MotionView({ node, editor, deleteNode }: NodeViewProps): ReactElement {
  const storage = editor.storage.motion as MotionStorage
  const palette = useSyncExternalStore(storage.subscribe, () => storage.palette)
  const attrs = node.attrs as MotionNode['attrs']
  // 编辑器内 ID 命名空间按 NodeView 实例分配（SMIL 事件引用是 document 全局，同文多块/同块多份不能撞）
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const svg = useMemo(
    () => motionToSvg(attrs, { idPrefix: `e${uid}k`, palette }),
    [attrs, palette, uid]
  )
  const error = useMemo(
    () => (svg ? null : scanMotion(substituteMotionTokens(attrs.body, palette)).error ?? '动效片段为空'),
    [svg, attrs.body, palette]
  )

  return (
    <NodeViewWrapper className="my-3" data-drag-handle>
      <div className="overflow-hidden rounded-xl border border-panel-3 bg-panel-2">
        <div className="flex items-center gap-1.5 border-b border-panel-3 px-3 py-1.5">
          <Icon name="zap" size={12} className="text-accent" />
          <span className="text-[10.5px] text-ink-dim">公众号动效 · 点击画面可试</span>
          <button
            type="button"
            onClick={() => deleteNode()}
            className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-ink-dim hover:bg-panel-3 hover:text-st-bad"
            title="删除此动效块"
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
        {svg ? (
          <div contentEditable={false} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div contentEditable={false} className="px-3 py-2.5">
            <p className="mb-1 flex items-center gap-1 text-[11px] text-st-bad">
              <Icon name="warn" size={12} />
              未过校验，导出时只显示静态文字
            </p>
            <p className="text-[11px] text-ink-dim">{error}</p>
          </div>
        )}
        {(attrs.caption || attrs.still) && (
          <div contentEditable={false} className="border-t border-panel-3 px-3 py-1.5">
            {attrs.caption && <p className="text-[11px] text-ink-dim">{attrs.caption}</p>}
            {attrs.still && <p className="text-[11px] text-ink-dim">{attrs.still}</p>}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const MotionBlock = Node.create({
  name: 'motion',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      body: { default: '' },
      viewBox: { default: '0 0 480 190' },
      still: { default: '' },
      caption: { default: '' },
      height: { default: null }
    }
  },

  addStorage(): MotionStorage {
    const listeners = new Set<() => void>()
    const storage: MotionStorage = {
      palette: motionPaletteFor(),
      setPalette: (p) => {
        storage.palette = p
        listeners.forEach((cb) => cb())
      },
      subscribe: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      }
    }
    return storage
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-motion]',
        getAttrs: (el) => {
          try {
            return JSON.parse((el as HTMLElement).dataset.motionAttrs ?? '') as Record<string, unknown>
          } catch {
            return false
          }
        }
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-motion': '', 'data-motion-attrs': JSON.stringify(HTMLAttributes) }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MotionView)
  }
})