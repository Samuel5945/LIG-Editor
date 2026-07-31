import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ReactElement
} from 'react'
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/react'
import { mdToDoc, docToMd, type ArticleDoc } from '@shared/markdown'
import { isHexColor } from '@shared/cards'
import { FigureImage, type FigureImageStorage } from './FigureImage'
import { FigSuggest, type FigSuggestStorage } from './FigSuggest'
import { FigureGallery } from './FigureGallery'

export interface EditorSelection {
  from: number
  to: number
  text: string
}

/** App 层经 ref 驱动编辑器的命令式 API（AI 修改/审阅定位用） */
export interface ArticleEditorHandle {
  getSelection: () => EditorSelection | null
  /** 用 md 片段替换 doc 位置区间（AI 修改确认写回） */
  replaceRange: (from: number, to: number, md: string) => void
  /** 按原文摘录定位并滚动到视口（审阅报告跳转）；找不到返回 false */
  scrollToText: (snippet: string) => boolean
  /** 图表重渲染后刷新所有图片：bump 缓存版本并强制 NodeView 重渲染（M6） */
  refreshFigures: () => void
}

interface ArticleEditorProps {
  /** md 唯一事实源（App 持有） */
  markdown: string
  /** 工程目录绝对路径，用于解析图片相对路径 */
  projectDir: string
  /** 文章强调色（meta.accent）：排版装饰/加粗色跟随；缺省默认蓝 */
  accent?: string
  onChange: (md: string) => void
  /** 选区浮动条「AI 修改」：App 打开修改弹窗 */
  onAiModify?: () => void
  /** 选区浮动条「AI 审阅」：App 触发副驾驶审阅流 */
  onAiReview?: () => void
  /** 配图占位卡管线按钮：App 打开配图弹窗（M6） */
  onFigAction?: FigSuggestStorage['onAction']
  /** 源码图「改源码重渲染」：App 打开代码绘图弹窗编辑 figures/*.html，desc 为原图提示词（M6） */
  onEditFigureSource?: (figureSource: string, desc: string) => void
}

/**
 * TipTap 富文本编辑器（PRD 约束子集）
 * - 内部状态为 TipTap doc；对外只吞吐 md 字符串
 * - lastEmitted 防止 onChange → props.markdown 回流时循环 setContent
 */
const ArticleEditor = forwardRef<ArticleEditorHandle, ArticleEditorProps>(function ArticleEditor(
  { markdown, projectDir, accent, onChange, onAiModify, onAiReview, onFigAction, onEditFigureSource },
  ref
): ReactElement {
  const lastEmitted = useRef(markdown)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // 子集之外的能力全部关闭
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false
      }),
      FigureImage,
      FigSuggest,
      FigureGallery
    ],
    content: mdToDoc(markdown),
    onUpdate({ editor }) {
      const md = docToMd(editor.getJSON() as ArticleDoc)
      lastEmitted.current = md
      onChange(md)
    }
  })

  useImperativeHandle(
    ref,
    () => ({
      getSelection() {
        if (!editor) return null
        const { from, to, empty } = editor.state.selection
        if (empty) return null
        return { from, to, text: editor.state.doc.textBetween(from, to, '\n') }
      },
      replaceRange(from, to, md) {
        if (!editor) return
        const blocks = mdToDoc(md.trim()).content as JSONContent[]
        if (blocks.length === 0) {
          editor.chain().focus().deleteRange({ from, to }).run()
          return
        }
        // 选区未跨段 + 结果只有一个段落 → 插行内内容融回原段，避免把所在段拆出新行
        const $from = editor.state.doc.resolve(from)
        const $to = editor.state.doc.resolve(to)
        const sameBlock = $from.sameParent($to) && $from.parent.isTextblock
        const inline =
          sameBlock && blocks.length === 1 && blocks[0].type === 'paragraph'
            ? (blocks[0].content ?? [])
            : null
        editor
          .chain()
          .focus()
          .deleteRange({ from, to })
          .insertContentAt(from, inline && inline.length > 0 ? inline : blocks)
          .run()
      },
      scrollToText(snippet) {
        if (!editor || !snippet) return false
        let found = -1
        editor.state.doc.descendants((node, pos) => {
          if (found >= 0) return false
          if (node.isText && node.text && node.text.includes(snippet)) {
            found = pos + node.text.indexOf(snippet)
            return false
          }
          return true
        })
        if (found < 0) return false
        editor.commands.setTextSelection({ from: found, to: found + snippet.length })
        const dom = editor.view.domAtPos(found)
        const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return true
      },
      refreshFigures() {
        if (!editor) return
        const storage = editor.storage.figureImage as FigureImageStorage
        storage.version = Date.now()
        // setNodeMarkup（同 attrs）触发 NodeView 重渲染，拿到新 version 的 ?v= 链接
        const tr = editor.state.tr
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'figureImage') tr.setNodeMarkup(pos, undefined, { ...node.attrs })
          return true
        })
        if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false))
      }
    }),
    [editor]
  )

  // 图片相对路径 → asset:// 协议（主进程限 workspace 内供图）；源码图编辑回调一并注入
  useEffect(() => {
    if (!editor) return
    const storage = editor.storage.figureImage as FigureImageStorage
    storage.resolveSrc = (src) =>
      /^[a-z][a-z0-9+.-]*:/i.test(src)
        ? src
        : 'asset://file/' + encodeURIComponent(`${projectDir}\\${src.replace(/\//g, '\\')}`)
    storage.onEditSource = (figureSource, desc) => onEditFigureSource?.(figureSource, desc)
    // 选中图片的「重新配图」：复用配图弹窗通道走对应管线，成图后原位替换
    storage.onRegenerate = (pipeline, ctx) => onFigAction?.(pipeline, ctx)
  }, [editor, projectDir, onEditFigureSource, onFigAction])

  // 配图占位卡的管线动作透传 App
  useEffect(() => {
    if (!editor) return
    const storage = editor.storage.figSuggest as FigSuggestStorage
    storage.onAction = (pipeline, ctx) => onFigAction?.(pipeline, ctx)
  }, [editor, onFigAction])

  // 外部 md 变化（热载/接受外部/切换工程）→ 重置编辑器内容
  useEffect(() => {
    if (!editor) return
    if (markdown !== lastEmitted.current) {
      lastEmitted.current = markdown
      editor.commands.setContent(mdToDoc(markdown))
    }
  }, [editor, markdown])

  // dev 调试句柄：DevTools 控制台可用 __editor 驱动/检查文档
  useEffect(() => {
    if (editor && import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__editor = editor
    }
  }, [editor])

  if (!editor) return <div className="p-6 text-sm text-slate-500">编辑器加载中…</div>

  return (
    <div className="flex h-full flex-col">
      {/* 编辑工具条：撤销/重做可见入口 + 快捷键提示 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-800 px-3 py-1 text-xs">
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="撤销（Ctrl+Z）"
          className="rounded px-2 py-0.5 text-slate-300 hover:bg-slate-700 disabled:opacity-30"
        >
          ↩ 撤销
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="重做（Ctrl+Y 或 Ctrl+Shift+Z）"
          className="rounded px-2 py-0.5 text-slate-300 hover:bg-slate-700 disabled:opacity-30"
        >
          ↪ 重做
        </button>
        <span className="ml-auto text-[10px] text-slate-500">Ctrl+Z 撤销 · Ctrl+Y 重做 · Ctrl+B 加粗</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {/* 选区浮动指令条 */}
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-1.5 py-1 shadow-xl">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`rounded px-2 py-0.5 text-xs font-bold ${
              editor.isActive('bold')
                ? 'bg-sky-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            B
          </button>
          <div className="mx-0.5 h-4 w-px bg-slate-700" />
          <button
            type="button"
            onClick={() => onAiModify?.()}
            className="rounded px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
          >
            AI 修改
          </button>
          <button
            type="button"
            onClick={() => onAiReview?.()}
            className="rounded px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
          >
            AI 审阅
          </button>
        </div>
      </BubbleMenu>
        <EditorContent
          editor={editor}
          className="article-editor selectable h-full"
          // 强调色变量注入：非法/缺省不设，CSS 回 var 默认蓝
          style={
            accent && isHexColor(accent)
              ? ({ '--article-accent': accent } as CSSProperties)
              : undefined
          }
        />
      </div>
    </div>
  )
})

export default ArticleEditor
