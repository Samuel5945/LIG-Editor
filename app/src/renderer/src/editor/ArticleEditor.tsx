import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/react'
import { mdToDoc, docToMd, type ArticleDoc } from '@shared/markdown'
import { isHexColor } from '@shared/cards'
import { DEFAULT_THEME, contrastText, isDarkColor, type ArticleTheme } from '@shared/categoryThemes'
import { FigureImage, type FigureImageStorage } from './FigureImage'
import { FigSuggest, type FigSuggestStorage } from './FigSuggest'
import { FigureGallery } from './FigureGallery'

/** 工具栏快速换色预设：常用参考色，选不中用取色器自定义 */
const ACCENT_PRESETS: { color: string; name: string }[] = [
  { color: '#4f8cff', name: '默认蓝' },
  { color: '#c9a227', name: '金' },
  { color: '#e63946', name: '红' },
  { color: '#ff6b35', name: '橙' },
  { color: '#16a085', name: '绿' },
  { color: '#7c5cff', name: '紫' },
  { color: '#e86fa4', name: '粉' },
  { color: '#5b6470', name: '灰' }
]

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
  /** 工程名（project:saveAsset 存图用） */
  project: string
  /** 工程目录绝对路径，用于解析图片相对路径 */
  projectDir: string
  /** 文章强调色（meta.accent）：排版装饰/加粗色跟随；缺省默认蓝 */
  accent?: string
  /** 排版调性（分类调性解析结果）：字体/行高/字距/标题对齐/强调色注入编辑器 */
  theme?: ArticleTheme
  onChange: (md: string) => void
  /** 选区浮动条「AI 修改」：App 打开修改弹窗 */
  onAiModify?: () => void
  /** 选区浮动条「AI 审阅」：App 触发副驾驶审阅流 */
  onAiReview?: () => void
  /** 配图占位卡管线按钮：App 打开配图弹窗（M6） */
  onFigAction?: FigSuggestStorage['onAction']
  /** 源码图「改源码重渲染」：App 打开代码绘图弹窗编辑 figures/*.html，desc 为原图提示词（M6） */
  onEditFigureSource?: (figureSource: string, desc: string) => void
  /** 工具栏快速换强调色：null = 恢复默认蓝 */
  onAccentChange?: (color: string | null) => void
}

/**
 * TipTap 富文本编辑器（PRD 约束子集）
 * - 内部状态为 TipTap doc；对外只吞吐 md 字符串
 * - lastEmitted 防止 onChange → props.markdown 回流时循环 setContent
 */
const ArticleEditor = forwardRef<ArticleEditorHandle, ArticleEditorProps>(function ArticleEditor(
  { markdown, project, projectDir, accent, theme, onChange, onAiModify, onAiReview, onFigAction, onEditFigureSource, onAccentChange },
  ref
): ReactElement {
  const lastEmitted = useRef(markdown)
  const [accentOpen, setAccentOpen] = useState(false)

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

  // ---- 自由插入图片 ----
  const fileInput = useRef<HTMLInputElement>(null)

  const insertImage = useCallback(
    async (file: File) => {
      if (!editor || !file.type.startsWith('image/')) return
      const buf = await file.arrayBuffer()
      const b64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ''))
      const ext = file.name.replace(/^.*\./, '').toLowerCase() || 'png'
      const relPath = await window.api.invoke(
        'project:saveAsset', project, `assets/import-${Date.now()}.${ext}`, b64
      )
      editor
        .chain()
        .focus()
        .insertContent({ type: 'figureImage', attrs: { src: relPath, alt: file.name, caption: '', figureSource: '' } })
        .run()
    },
    [editor, project]
  )

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
        <div className="mx-1 h-4 w-px bg-slate-700" />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          title="在光标处插入本地图片"
          className="rounded px-2 py-0.5 text-slate-300 hover:bg-slate-700"
        >
          🖼 插入图片
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void insertImage(f)
            e.target.value = ''
          }}
        />
        {/* 强调色快速换色 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setAccentOpen((v) => !v)}
            title="快速修改文章强调色"
            className="flex items-center gap-1 rounded px-2 py-0.5 text-slate-300 hover:bg-slate-700"
          >
            <span
              className="inline-block h-3 w-3 rounded-full border border-slate-500"
              style={{ background: accent && isHexColor(accent) ? accent : '#4f8cff' }}
            />
            强调色
          </button>
          {accentOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
              <div className="grid grid-cols-8 gap-1">
                {ACCENT_PRESETS.map((p) => (
                  <button
                    key={p.color}
                    type="button"
                    title={p.name}
                    onClick={() => {
                      onAccentChange?.(p.color)
                      setAccentOpen(false)
                    }}
                    className={`h-5 w-5 rounded-full border border-slate-600 ${
                      (accent ?? '#4f8cff').toLowerCase() === p.color ? 'ring-2 ring-white' : ''
                    }`}
                    style={{ background: p.color }}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="flex flex-1 items-center gap-1 text-[10px] text-slate-400">
                  自定义
                  <input
                    type="color"
                    value={accent && isHexColor(accent) ? accent : '#4f8cff'}
                    onChange={(e) => onAccentChange?.(e.target.value)}
                    className="h-6 w-8 cursor-pointer rounded border border-slate-600 bg-transparent"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    onAccentChange?.(null)
                    setAccentOpen(false)
                  }}
                  className="rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700"
                >
                  恢复默认
                </button>
              </div>
            </div>
          )}
        </div>
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
          // 分类调性变量注入：缺省回 CSS 内置默认值（默认调性），结构级风格与导出 HTML 同源
          style={(() => {
            const t = theme ?? DEFAULT_THEME
            const accent = isHexColor(t.accent) ? t.accent : DEFAULT_THEME.accent
            const headingColor = t.headingColor ?? (t.bodyBg ? '#eef2f7' : '')
            const vars: Record<string, string> = {
              '--article-accent': accent,
              '--article-font': t.fontFamily,
              '--article-lh': String(t.lineHeight),
              '--article-ls': t.letterSpacing,
              '--article-h-align': t.headingAlign,
              // 结构级：背景卡片 / 段距 / 图片圆角 / 标题色
              '--article-body-bg': t.bodyBg ?? 'transparent',
              '--article-body-text': t.bodyText ?? '',
              '--article-body-radius': `${t.bodyRadius ?? 0}px`,
              '--article-body-pad': t.bodyPadding ?? '',
              '--article-p-gap': `${t.pGap ?? 16}px`,
              '--article-img-radius': `${t.imgRadius ?? 4}px`,
              '--article-heading-color': headingColor
            }
            if (t.headingAlign === 'left') vars['--article-bar-left'] = '0'
            // H1 装饰：pill 胶囊色块 / underline 下划线（bar 用 CSS 默认短横）
            const h1 = t.h1Style ?? 'bar'
            if (h1 === 'pill') {
              vars['--article-h1-bg'] = accent
              vars['--article-h1-color'] = contrastText(accent)
              vars['--article-h1-display'] = 'inline-block'
              vars['--article-h1-pad'] = '6px 22px'
              vars['--article-h1-radius'] = '9999px'
              vars['--article-h1-bar'] = 'none'
            } else if (h1 === 'underline') {
              vars['--article-h1-border'] = `3px solid ${accent}`
              vars['--article-h1-pad'] = '0 0 10px'
              vars['--article-h1-bar'] = 'none'
              if (t.headingAlign === 'left') vars['--article-h1-display'] = 'inline-block'
            }
            // H2 装饰：block 色块标签 / underline 下划线 / plain 纯文字（leftbar 用 CSS 默认竖条）
            const h2 = t.h2Style ?? 'leftbar'
            if (h2 === 'block') {
              vars['--article-h2-bg'] = accent
              vars['--article-h2-color'] = contrastText(accent)
              vars['--article-h2-left'] = 'none'
              vars['--article-h2-pad'] = '3px 14px'
              vars['--article-h2-radius'] = '6px'
              vars['--article-h2-display'] = 'inline-block'
            } else if (h2 === 'underline') {
              vars['--article-h2-border'] = `2px solid ${accent}`
              vars['--article-h2-left'] = 'none'
              vars['--article-h2-pad'] = '0 0 8px'
            } else if (h2 === 'plain') {
              vars['--article-h2-left'] = 'none'
              vars['--article-h2-pl'] = '0'
            }
            // H3 前缀：dot 圆点 / none 无（diamond 用 CSS 默认菱形）
            const mark = t.h3Mark ?? 'diamond'
            if (mark === 'dot') vars['--article-mark-radius'] = '50%'
            else if (mark === 'none') vars['--article-mark-display'] = 'none'
            // 引用：card 圆角卡片 / quotes 引号（leftbar 用 CSS 默认左条）
            const quote = t.quoteStyle ?? 'leftbar'
            // 引用文字色按背景实际亮度：编辑器默认深底面板 → 浅字；浅色卡片 → 深字（不用灰字）
            const darkBg = t.bodyBg ? isDarkColor(t.bodyBg) : true
            vars['--article-quote-color'] = darkBg ? '#cbd5e1' : '#333'
            if (quote === 'card') {
              vars['--article-quote-left'] = 'none'
              vars['--article-quote-radius'] = '12px'
              vars['--article-quote-pad'] = '14px 16px'
              vars['--article-quote-bg'] = `color-mix(in srgb, ${accent} 12%, transparent)`
            } else if (quote === 'quotes') {
              vars['--article-quote-mark'] = '❝'
            }
            // 分隔线：dot 圆点列 / long 通栏细线（line 用 CSS 默认短横）
            const hr = t.hrStyle ?? 'line'
            if (hr === 'dot') {
              vars['--article-hr-border'] = `4px dotted ${accent}`
              vars['--article-hr-w'] = '72px'
            } else if (hr === 'long') {
              vars['--article-hr-w'] = '100%'
            }
            // 加粗：highlight 底色高亮 / plain 纯加粗（color 用 CSS 默认着色）
            const strong = t.strongStyle ?? 'color'
            if (strong === 'highlight') {
              vars['--article-strong-bg'] = t.strongBg && isHexColor(t.strongBg) ? t.strongBg : '#fef3c7'
              vars['--article-strong-color'] = t.bodyBg ? '#f5f5f4' : '#333'
              vars['--article-strong-pad'] = '1px 6px'
              vars['--article-strong-radius'] = '4px'
            } else if (strong === 'plain') {
              vars['--article-strong-color'] = 'inherit'
            }
            return vars as CSSProperties
          })()}
        />
      </div>
    </div>
  )
})

export default ArticleEditor
