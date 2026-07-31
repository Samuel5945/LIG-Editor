import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useEffect, useState, type ReactElement } from 'react'
import type { FigPipeline, FigureAttrs, FigureInsert } from './FigSuggest'
import { figureInsertNode } from './FigSuggest'

/**
 * figureImage：图片 + 图注 + figure-source 的原子块节点
 * 对应 md：![alt](src) + <!-- caption --> + <!-- figure-source --> 注释
 */

export interface FigureImageStorage {
  /** 相对路径 → 可展示 URL（由 ArticleEditor 注入工程目录解析） */
  resolveSrc: (src: string) => string
  /** 图片缓存穿透版本：重渲染后 bump，url 附 ?v= 让 <img> 重新拉取 */
  version: number
  /** 「改源码重渲染」：App 打开代码绘图弹窗编辑 figures/*.html，desc 为原图提示词（M6） */
  onEditSource: (figureSource: string, desc: string) => void
  /** 「重新配图」：App 打开对应管线弹窗，成图后原位替换（多图导入时换成图集节点） */
  onRegenerate: (pipeline: FigPipeline, ctx: { desc: string; replace: (attrs: FigureInsert) => void }) => void
}

function FigureImageView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps): ReactElement {
  const { src, alt, caption, figureSource } = node.attrs as {
    src: string
    alt: string
    caption: string
    figureSource: string
  }
  const storage = editor.storage.figureImage as FigureImageStorage
  const [broken, setBroken] = useState(false)

  // src 或重渲染版本变化时重试加载
  useEffect(() => setBroken(false), [src, storage.version])

  const displaySrc = storage.resolveSrc(src) + (storage.version ? `?v=${storage.version}` : '')

  const fire = (pipeline: FigPipeline): void =>
    storage.onRegenerate(pipeline, {
      desc: alt || caption,
      replace: (attrs) => {
        if ('images' in attrs) {
          // 多图图集：节点类型变了，整体替换
          const pos = getPos()
          editor
            .chain()
            .focus()
            .insertContentAt({ from: pos, to: pos + node.nodeSize }, figureInsertNode(attrs))
            .run()
        } else {
          updateAttributes(attrs)
        }
      }
    })

  const opBtn =
    'whitespace-nowrap rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-sky-600 hover:text-sky-400'

  return (
    <NodeViewWrapper className="my-4" data-drag-handle>
      <figure
        className={`rounded-lg border p-2 transition-colors ${
          selected ? 'border-sky-500 bg-sky-500/5' : 'border-transparent'
        }`}
      >
        {broken ? (
          <div className="flex h-32 items-center justify-center rounded bg-slate-800 text-xs text-slate-500">
            图片未找到：{src}
          </div>
        ) : (
          <img
            src={displaySrc}
            alt={alt}
            className="mx-auto max-h-[420px] rounded"
            draggable={false}
            onError={() => setBroken(true)}
          />
        )}
        {/* 图注：灰色小字，可直接编辑 */}
        <figcaption className="mt-2 text-center">
          <input
            value={caption}
            placeholder="点击添加图注…"
            onChange={(e) => updateAttributes({ caption: e.target.value })}
            className="w-full bg-transparent text-center text-xs text-slate-400 outline-none placeholder:text-slate-600"
          />
        </figcaption>
        {figureSource ? (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-500">
            <span className="rounded bg-slate-800 px-1.5 py-0.5">源码图 {figureSource}</span>
            <button
              type="button"
              onClick={() => storage.onEditSource(figureSource, alt || caption)}
              title="修改 HTML 源码后离屏重渲染"
              className={opBtn}
            >
              改源码重渲染
            </button>
            {selected && (
              <>
                <button type="button" onClick={() => fire('ai')} title="改用 AI 生图替换本图" className={opBtn}>
                  ✨ AI 生图
                </button>
                <button type="button" onClick={() => fire('import')} title="导入本地图片替换本图" className={opBtn}>
                  📁 导入替换
                </button>
              </>
            )}
          </div>
        ) : (
          selected && (
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-[11px]">
              <button type="button" onClick={() => fire('ai')} title="重新 AI 生图并替换本图" className={opBtn}>
                🔄 重新生成
              </button>
              <button type="button" onClick={() => fire('code')} title="改用代码绘图替换本图" className={opBtn}>
                📊 代码绘图
              </button>
              <button type="button" onClick={() => fire('import')} title="导入本地图片替换本图" className={opBtn}>
                📁 导入替换
              </button>
            </div>
          )
        )}
      </figure>
    </NodeViewWrapper>
  )
}

export const FigureImage = Node.create({
  name: 'figureImage',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      caption: { default: '' },
      figureSource: { default: '' }
    }
  },

  addStorage(): FigureImageStorage {
    return { resolveSrc: (src) => src, version: 0, onEditSource: () => {}, onRegenerate: () => {} }
  },

  parseHTML() {
    return [{ tag: 'figure[data-figure-image]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'figure',
      { 'data-figure-image': '' },
      ['img', { src: HTMLAttributes.src, alt: HTMLAttributes.alt }],
      ['figcaption', {}, HTMLAttributes.caption ?? '']
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureImageView)
  }
})
