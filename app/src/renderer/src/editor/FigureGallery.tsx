import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useRef, useState, type MouseEvent, type ReactElement, type UIEvent } from 'react'
import type { FigureGalleryAttrs, GalleryImage } from '@shared/markdown'
import { figureInsertNode, type FigureInsert } from './FigSuggest'
import type { FigureImageStorage } from './FigureImage'

/**
 * figureGallery：多图图集的原子块节点（M6 多图导入）
 * 对应 md：<!-- gallery: 布局 取景比 --> + 图片行 + <!-- /gallery -->
 * 布局：swipe-h 左右滑动轮播（scroll-snap）| grid 拼图同时展示；旧文档的 stack-v 按拼图渲染（选项已废弃）
 */

const FRAMES = ['', '3:4', '1:1', '4:3', '16:9'] as const
const LAYOUTS = [
  ['swipe-h', '左右滑动'],
  ['grid', '拼图']
] as const

function GalleryView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps): ReactElement {
  const { images, layout, frame, caption } = node.attrs as FigureGalleryAttrs
  // 复用 figureImage 的路径解析与缓存穿透版本
  const imgStorage = editor.storage.figureImage as FigureImageStorage
  const [index, setIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const resolve = (src: string): string =>
    imgStorage.resolveSrc(src) + (imgStorage.version ? `?v=${imgStorage.version}` : '')
  const aspect = frame ? frame.replace(':', ' / ') : undefined
  // 除左右滑动外均按拼图渲染（含旧文档遗留的 stack-v）
  const isGrid = layout !== 'swipe-h'
  // 拼图列数：2张两列；4张 2×2；其余三列（朋友圈式）；取景框默认 1:1
  const gridCols = images.length <= 2 || images.length === 4 ? 2 : 3
  const gridAspect = (frame || '1:1').replace(':', ' / ')

  const onScroll = (e: UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    const ratio = el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth)
    setIndex(Math.min(images.length - 1, Math.round(ratio * (images.length - 1))))
  }

  /** 图集整体替换：同类型改属性；换成单图时整节点替换 */
  const replaceSelf = (attrs: FigureInsert): void => {
    if ('images' in attrs) {
      updateAttributes(attrs)
    } else {
      const pos = getPos()
      editor
        .chain()
        .focus()
        .insertContentAt({ from: pos, to: pos + node.nodeSize }, figureInsertNode(attrs))
        .run()
    }
  }

  /** 删除第 k 张；剩 1 张时退化为单图节点 */
  const removeImage = (k: number): void => {
    const rest = images.filter((_, i) => i !== k)
    if (rest.length >= 2) {
      updateAttributes({ images: rest })
      setIndex(0)
    } else {
      replaceSelf({ src: rest[0].src, alt: rest[0].alt, caption, figureSource: '' })
    }
  }

  /** 第 k 张与相邻一张交换顺序 */
  const moveImage = (k: number, dir: -1 | 1): void => {
    const j = k + dir
    if (j < 0 || j >= images.length) return
    const next = [...images]
    ;[next[k], next[j]] = [next[j], next[k]]
    updateAttributes({ images: next })
  }

  /** 点击图集空白/图片区域时显式选中节点（滚动容器会拦截默认选中） */
  const selectSelf = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).closest('button,input')) return
    editor.commands.setNodeSelection(getPos())
  }

  const opBtn =
    'whitespace-nowrap rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-sky-600 hover:text-sky-400'

  return (
    <NodeViewWrapper className="my-4" data-drag-handle>
      <figure
        className={`rounded-lg p-1 transition-shadow ${selected ? 'ring-2 ring-sky-600' : ''}`}
        contentEditable={false}
        onClick={selectSelf}
      >
        {isGrid ? (
          /* 拼图：全部同时展示的等宽网格，统一取景裁切 */
          <div
            className="grid gap-1.5 rounded-lg bg-slate-800/30 p-2"
            style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
          >
            {images.map((im, k) => (
              <img
                key={k}
                src={resolve(im.src)}
                alt={im.alt}
                className="w-full rounded shadow-lg"
                style={{ aspectRatio: gridAspect, objectFit: 'cover' }}
              />
            ))}
          </div>
        ) : (
          /* 左右滑动轮播：横向 snap，卡片占 78% 宽露出下一张边缘 */
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-lg bg-slate-800/30 p-2"
          >
            {images.map((im, k) => (
              <div key={k} className="w-[78%] shrink-0 snap-center">
                <img
                  src={resolve(im.src)}
                  alt={im.alt}
                  className="w-full rounded shadow-lg"
                  style={aspect ? { aspectRatio: aspect, objectFit: 'cover' } : { objectFit: 'contain' }}
                />
              </div>
            ))}
          </div>
        )}
        {/* 页码圆点 + 滑动提示（拼图全部可见，无需页码） */}
        {!isGrid && (
          <div className="mt-1.5 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              {images.map((_, k) => (
                <span
                  key={k}
                  className={`inline-block h-1.5 w-1.5 rounded-full ${k === index ? 'bg-sky-500' : 'bg-slate-600'}`}
                />
              ))}
            </span>
            <span className="tabular-nums">
              {index + 1}/{images.length}
            </span>
            <span>左右滑动</span>
          </div>
        )}
        <figcaption className="mt-1 text-center text-xs text-slate-400">
          <input
            value={caption}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
            placeholder="点击输入图注…"
            className="w-full bg-transparent text-center outline-none placeholder:text-slate-600"
          />
        </figcaption>
        {selected && (
          <>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-[11px]">
              {LAYOUTS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => updateAttributes({ layout: id })}
                  title={id === 'grid' ? '多图同时展示的拼图网格' : '左右滑动轮播'}
                  className={`${opBtn} ${layout === id ? 'border-sky-600 text-sky-400' : ''}`}
                >
                  {label}
                </button>
              ))}
              {FRAMES.map((f) => (
                <button
                  key={f || 'auto'}
                  type="button"
                  onClick={() => updateAttributes({ frame: f })}
                  title={f ? `统一 ${f} 取景框（裁切填满）` : '每张按原比例自适应'}
                  className={`${opBtn} ${frame === f ? 'border-sky-600 text-sky-400' : ''}`}
                >
                  {f || '自适应'}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  imgStorage.onRegenerate('import', {
                    desc: caption || images[0]?.alt || '',
                    replace: replaceSelf
                  })
                }
                title="重新选择图片，整体替换本图集"
                className={opBtn}
              >
                📁 重新导入
              </button>
            </div>
            {/* 逐张管理：调序 / 删除 */}
            <div className="mt-1.5 flex flex-wrap items-start justify-center gap-2">
              {images.map((im, k) => (
                <div key={k} className="flex flex-col items-center gap-0.5">
                  <img
                    src={resolve(im.src)}
                    alt={im.alt}
                    className={`h-12 rounded border object-cover ${k === index ? 'border-sky-600' : 'border-slate-700'}`}
                  />
                  <div className="flex items-center gap-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => moveImage(k, -1)}
                      disabled={k === 0}
                      title="前移一位"
                      className={`${opBtn} disabled:opacity-30`}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      onClick={() => removeImage(k)}
                      title={images.length === 2 ? '删除后剩 1 张，自动退化为单图' : '删除这张'}
                      className={`${opBtn} hover:border-red-500 hover:text-red-400`}
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(k, 1)}
                      disabled={k === images.length - 1}
                      title="后移一位"
                      className={`${opBtn} disabled:opacity-30`}
                    >
                      ▶
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </figure>
    </NodeViewWrapper>
  )
}

export const FigureGallery = Node.create({
  name: 'figureGallery',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      images: { default: [] as GalleryImage[] },
      layout: { default: 'swipe-h' },
      frame: { default: '' },
      caption: { default: '' }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-figure-gallery]',
        getAttrs: (el) => {
          try {
            return JSON.parse((el as HTMLElement).getAttribute('data-attrs') ?? '') as FigureGalleryAttrs
          } catch {
            return null
          }
        }
      }
    ]
  },

  renderHTML({ node }) {
    const attrs = node.attrs as FigureGalleryAttrs
    return [
      'div',
      { 'data-figure-gallery': '', 'data-attrs': JSON.stringify(attrs) },
      `图集（${attrs.images.length} 张）`
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(GalleryView)
  }
})
