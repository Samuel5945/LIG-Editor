import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { mdToDoc, docToMd, docToTiptap, type ArticleDoc } from '@shared/markdown'
import { isHexColor } from '@shared/cards'
import { DEFAULT_THEME, contrastText, isDarkColor, resolveEditorTheme, type ArticleTheme } from '@shared/categoryThemes'
import { SEQ_PREFIX } from '@shared/exportHtml'
import type { H1Style, H2Style, H2Num, H3Mark } from '@shared/types'
import { FigureImage, type FigureImageStorage } from './FigureImage'
import { FigSuggest, type FigSuggestStorage } from './FigSuggest'
import { FigureGallery } from './FigureGallery'
import ArticleTable from './ArticleTable'
import { TextStyleMark } from './TextStyleMark'

/** 工具栏快速换色预设：常用参考色，选不中用取色器自定义 */
const ACCENT_PRESETS: { color: string; name: string }[] = [
  { color: '#0d9488', name: '默认青绿' },
  { color: '#c9a227', name: '金' },
  { color: '#e63946', name: '红' },
  { color: '#ff6b35', name: '橙' },
  { color: '#16a085', name: '绿' },
  { color: '#7c5cff', name: '紫' },
  { color: '#e86fa4', name: '粉' },
  { color: '#4f8cff', name: '蓝' },
  { color: '#5b6470', name: '灰' }
]

/** 文章背景卡预设（浅色系，公众号昼夜安全：夜间由公众号逻辑自动变深，深底卡夜间无法显示） */
const BG_PRESETS: { color: string; name: string }[] = [
  { color: '#eef3fb', name: '浅蓝白' },
  { color: '#fffaf2', name: '暖白' },
  { color: '#fff0f0', name: '浅粉' },
  { color: '#f0fdf4', name: '浅绿' },
  { color: '#f5f3ff', name: '浅紫' },
  { color: '#f1f5f9', name: '浅灰' },
  { color: '#fdf6e3', name: '米黄' },
  { color: '#e6f7f4', name: '浅青' },
  { color: '#fff7e6', name: '杏色' },
  { color: '#eefaf1', name: '薄荷' }
]

/** 选区字色预设（正文/强调通用；白色常用于深底卡片上提亮文字） */
const TEXT_COLORS: { color: string; name: string }[] = [
  { color: '#ffffff', name: '白色' },
  { color: '#1a1a1a', name: '深黑' },
  { color: '#595959', name: '灰' },
  { color: '#e63946', name: '红' },
  { color: '#ff6b35', name: '橙' },
  { color: '#c9a227', name: '金' },
  { color: '#2bae85', name: '青绿' },
  { color: '#4f8cff', name: '蓝' },
  { color: '#7c5cff', name: '紫' },
  { color: '#e86fa4', name: '粉' }
]

/** 选区背景高亮预设（浅色系，保证黑字可读） */
const BG_COLORS: { color: string; name: string }[] = [
  { color: '#fef3c7', name: '浅黄' },
  { color: '#dcfce7', name: '浅绿' },
  { color: '#dbeafe', name: '浅蓝' },
  { color: '#fee2e2', name: '浅红' },
  { color: '#f3e8ff', name: '浅紫' },
  { color: '#ffedd5', name: '浅橙' },
  { color: '#ffe4e6', name: '浅粉' },
  { color: '#e2e8f0', name: '浅灰' }
]

/** 选区字号预设（px）：公众号正文 14-16 常规，17+ 强调 */
const FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24]

/** 工具栏正文字号预设（px）：正文基准 14-18，缺省 16 */
const BODY_FONT_SIZES = [14, 15, 16, 17, 18]
/** 工具栏标题字号预设（px）：标题基准 17-24，缺省 20（H1=+6 H2=+0 H3=-3） */
const HEADING_FONT_SIZES = [17, 18, 20, 22, 24]
/** 正文排列三态：indent 首行缩进 / flush 顶格两端对齐 / center 居中 */
const BODY_ALIGNS: { value: 'indent' | 'flush' | 'center'; label: string }[] = [
  { value: 'indent', label: '缩进' },
  { value: 'flush', label: '顶格' },
  { value: 'center', label: '居中' }
]
/** 标题排列两态：center 居中 / left 左对齐 */
const HEADING_ALIGNS: { value: 'center' | 'left'; label: string }[] = [
  { value: 'center', label: '居中' },
  { value: 'left', label: '左' }
]
/** H1 装饰三态：bar 短横收尾 / pill 胶囊色块字底 / underline 下划线 */
const H1_STYLES: { value: H1Style; label: string }[] = [
  { value: 'bar', label: '短横' },
  { value: 'pill', label: '胶囊' },
  { value: 'underline', label: '下划线' }
]
/** H2 装饰四态：leftbar 左竖条 / block 色块标签 / underline 下划线 / plain 纯文字 */
const H2_STYLES: { value: H2Style; label: string }[] = [
  { value: 'leftbar', label: '左竖条' },
  { value: 'block', label: '色块' },
  { value: 'underline', label: '下划线' },
  { value: 'plain', label: '纯文字' }
]
/** H2 序号：none 显式关掉主题自带序号 / 其余按文档 h2 顺序自动编号 */
const H2_NUMS: { value: H2Num | 'none'; label: string }[] = [
  { value: 'none', label: '关' },
  { value: '01', label: '01' },
  { value: '1.', label: '1.' },
  { value: '1、', label: '1、' },
  { value: '一、', label: '一、' },
  { value: '壹、', label: '壹、' },
  { value: '①', label: '①' }
]
/** H3 前缀：diamond 菱形 / dot 圆点 / none 无 */
const H3_MARKS: { value: H3Mark; label: string }[] = [
  { value: 'diamond', label: '菱形' },
  { value: 'dot', label: '圆点' },
  { value: 'none', label: '无' }
]

/** 选区样式弹层：全屏透明层点击关闭 + 绝对定位面板（相对 BubbleMenu 容器，向上展开不挡选区） */
function StylePanel({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}): ReactElement {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-2xl">
        <p className="mb-1.5 text-[10px] text-slate-500">{title}</p>
        {children}
      </div>
    </>
  )
}

export interface EditorSelection {
  from: number
  to: number
  text: string
}

/** 工具栏排版下拉的分区：灰色小标题 + 选项格 */
function TypeSection({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="mb-1.5">
      <div className="px-1 pb-1 text-[10px] text-slate-500">{label}</div>
      {children}
    </div>
  )
}

/**
 * H2 手写序号遮罩：h2Num 序号启用时，把标题开头的手写序号（①/一、/01 等）隐藏，
 * 自动序号顶上——与导出端 blockToHtml 的「剥手写、注主题序号」同语义，预览即所见。
 * 非破坏：decoration 只隐藏不改 doc，关掉序号后手写序号原样回来。
 */
const h2MaskKey = new PluginKey('h2NumMask')
const H2NumMask = Extension.create({
  name: 'h2NumMask',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: h2MaskKey,
        state: {
          init: () => false,
          apply: (tr, val) => tr.getMeta(h2MaskKey) ?? val
        },
        props: {
          decorations(state) {
            if (!h2MaskKey.getState(state)) return DecorationSet.empty
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'heading' || node.attrs.level !== 2) return
              const first = node.content.firstChild
              if (!first || first.type.name !== 'text' || !first.text) return
              const m = SEQ_PREFIX.exec(first.text)
              if (m) decos.push(Decoration.inline(pos + 1, pos + 1 + m[0].length, { class: 'h2num-mask' }))
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty
          }
        }
      })
    ]
  }
})

/** 排版选项格：等宽小按钮、选中高亮；高亮值 = 覆盖值或主题回退值（与面板所见一致） */
function TypeOptions<T extends string | number>({
  options,
  value,
  cols,
  onPick
}: {
  options: { value: T; label: string }[]
  value: T | undefined
  cols: number
  onPick: (v: T) => void
}): ReactElement {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onPick(o.value)}
          className={`rounded px-1 py-1 text-xs ${value === o.value ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
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
  /** 编辑器所在 UI 主题（深色/日间）：无背景卡片的分类按此选正文深浅色，避免日间浅底灰字 */
  uiDark?: boolean
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
  /** 项目显式排版覆盖（meta 同名字段）：字号/排列 + 标题版式四项 + 背景卡，undefined = 跟随主题 */
  typography?: {
    bodyFontSize?: number
    headingFontSize?: number
    bodyAlign?: 'indent' | 'flush' | 'center'
    headingAlign?: 'center' | 'left'
    h1Style?: H1Style
    h2Style?: H2Style
    /** 'none' = 显式关掉主题自带序号（与 undefined「跟随主题」语义不同） */
    h2Num?: H2Num | 'none'
    h3Mark?: H3Mark
    /** hex 覆盖主题背景卡；'none' 显式去卡片（透明白底）；undefined 跟随主题 */
    bodyBg?: string
  }
  /** 工具栏排版设置：patch 值 null = 恢复默认（跟随主题） */
  onTypographyChange?: (patch: {
    bodyFontSize?: number | null
    headingFontSize?: number | null
    bodyAlign?: 'indent' | 'flush' | 'center' | null
    headingAlign?: 'center' | 'left' | null
    h1Style?: H1Style | null
    h2Style?: H2Style | null
    h2Num?: H2Num | 'none' | null
    h3Mark?: H3Mark | null
    bodyBg?: string | null
  }) => void
}

/**
 * TipTap 富文本编辑器（PRD 约束子集）
 * - 内部状态为 TipTap doc；对外只吞吐 md 字符串
 * - lastEmitted 防止 onChange → props.markdown 回流时循环 setContent
 */
const ArticleEditor = forwardRef<ArticleEditorHandle, ArticleEditorProps>(function ArticleEditor(
  { markdown, project, projectDir, accent, theme, uiDark, typography, onChange, onAiModify, onAiReview, onFigAction, onEditFigureSource, onAccentChange, onTypographyChange },
  ref
): ReactElement {
  const lastEmitted = useRef(markdown)
  const [accentOpen, setAccentOpen] = useState(false)
  /** 工具栏背景卡弹层：预设浅色 / 自定义 / 无卡片 / 跟随主题 */
  const [bgOpen, setBgOpen] = useState(false)
  /** 选区样式弹层：color 字色 / bg 背景高亮 / size 字号 */
  const [stylePop, setStylePop] = useState<'color' | 'bg' | 'size' | null>(null)
  /** 工具栏排版弹层：body 正文（字号/排列）/ heading 标题（字号/排列/装饰版式/序号/前缀） */
  const [typePop, setTypePop] = useState<'body' | 'heading' | null>(null)

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
      FigureGallery,
      ArticleTable,
      TextStyleMark,
      H2NumMask
    ],
    content: docToTiptap(mdToDoc(markdown)),
    onUpdate({ editor }) {
      const md = docToMd(editor.getJSON() as ArticleDoc)
      lastEmitted.current = md
      onChange(md)
    }
  })

  // h2Num 开/关 → 下发遮罩开关 meta（独立小事务不动文档，不触发 onChange）；
  // doc 变化时 decorations 按最新 state 自动重算，无需干预
  const h2NumActive = Boolean(theme?.h2Num)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (h2MaskKey.getState(editor.state) === h2NumActive) return
    editor.view.dispatch(editor.state.tr.setMeta(h2MaskKey, h2NumActive))
  }, [editor, h2NumActive])

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
        // mdToDoc 产出扁平 mark，转 tiptap 嵌套 attrs 再插入（否则字色/字号 attrs 全丢）
        const blocks = docToTiptap(mdToDoc(md.trim())).content as JSONContent[]
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
      editor.commands.setContent(docToTiptap(mdToDoc(markdown)))
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
              style={{ background: accent && isHexColor(accent) ? accent : '#0d9488' }}
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
                      (accent ?? '#0d9488').toLowerCase() === p.color ? 'ring-2 ring-white' : ''
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
                    value={accent && isHexColor(accent) ? accent : '#0d9488'}
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
        {/* 背景卡快速换色：hex 覆盖主题 / none 去卡片（白底）/ null 跟随主题；夜间由公众号逻辑自动变深 */}
        {(() => {
          const bgOv = typography?.bodyBg
          const effBg = bgOv === 'none' ? undefined : bgOv && isHexColor(bgOv) ? bgOv : theme?.bodyBg
          const bgNone = bgOv === 'none' || (bgOv === undefined && !theme?.bodyBg)
          return (
            <div className="relative">
              <button
                type="button"
                onClick={() => setBgOpen((v) => !v)}
                title="文章背景卡片颜色（公众号夜间自动变深）"
                className="flex items-center gap-1 rounded px-2 py-0.5 text-slate-300 hover:bg-slate-700"
              >
                <span
                  className="inline-block h-3 w-3 rounded-full border border-slate-500"
                  style={{ background: effBg ?? 'transparent' }}
                />
                背景
              </button>
              {bgOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
                  <div className="grid grid-cols-5 gap-1">
                    {BG_PRESETS.map((p) => (
                      <button
                        key={p.color}
                        type="button"
                        title={p.name}
                        onClick={() => {
                          onTypographyChange?.({ bodyBg: p.color })
                          setBgOpen(false)
                        }}
                        className={`h-5 w-5 rounded-full border border-slate-600 ${
                          effBg?.toLowerCase() === p.color ? 'ring-2 ring-white' : ''
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
                        value={effBg && isHexColor(effBg) ? effBg : '#eef3fb'}
                        onChange={(e) => onTypographyChange?.({ bodyBg: e.target.value })}
                        className="h-6 w-8 cursor-pointer rounded border border-slate-600 bg-transparent"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        onTypographyChange?.({ bodyBg: 'none' })
                        setBgOpen(false)
                      }}
                      className={`rounded border px-2 py-1 text-[10px] hover:bg-slate-700 ${
                        bgNone ? 'border-sky-500 text-sky-300' : 'border-slate-600 text-slate-300'
                      }`}
                    >
                      无卡片（白底）
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onTypographyChange?.({ bodyBg: null })
                        setBgOpen(false)
                      }}
                      className="rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700"
                    >
                      跟随主题
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
        {/* 排版：正文（字号/排列）与标题（字号/排列/装饰版式/序号/前缀）两个分区下拉。
            覆盖值落 meta（null = 跟随主题），resolveArticleTheme 合并后编辑器/导出/推送同源生效 */}
        {(() => {
          const t = theme ?? DEFAULT_THEME
          const bodySize = typography?.bodyFontSize ?? t.fontSize ?? 16
          const headingSize = typography?.headingFontSize ?? t.headingFontSize ?? 20
          const bodyAlign = typography?.bodyAlign ?? t.bodyAlign ?? 'flush'
          const headingAlign = typography?.headingAlign ?? t.headingAlign ?? 'center'
          // 版式高亮值：覆盖优先，否则显示解析后的主题值（含 h2Num 的 'none' 显式关闭态）
          const h1Cur = typography?.h1Style ?? t.h1Style
          const h2Cur = typography?.h2Style ?? t.h2Style
          const h2NumCur = typography?.h2Num ?? t.h2Num
          const h3Cur = typography?.h3Mark ?? t.h3Mark
          const typeBtn = 'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700'
          const typePanel =
            'absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl'
          const typeReset =
            'mt-0.5 block w-full rounded border border-slate-600 px-2 py-1 text-left text-[10px] text-slate-400 hover:bg-slate-700'
          return (
            <>
              <div className="relative">
                <button type="button" title="正文排版：字号 / 排列（覆盖主题，导出同步）" onClick={() => setTypePop(typePop === 'body' ? null : 'body')} className={typeBtn}>
                  正文 {bodySize} <span className="text-[8px] text-slate-500">▾</span>
                </button>
                {typePop === 'body' && (
                  <div className={typePanel}>
                    <TypeSection label="字号">
                      <TypeOptions
                        options={BODY_FONT_SIZES.map((n) => ({ value: n, label: `${n}px` }))}
                        value={bodySize}
                        cols={5}
                        onPick={(n) => { onTypographyChange?.({ bodyFontSize: n }); setTypePop(null) }}
                      />
                    </TypeSection>
                    <TypeSection label="排列">
                      <TypeOptions
                        options={BODY_ALIGNS}
                        value={bodyAlign}
                        cols={3}
                        onPick={(v) => { onTypographyChange?.({ bodyAlign: v }); setTypePop(null) }}
                      />
                    </TypeSection>
                    <button type="button" onClick={() => { onTypographyChange?.({ bodyFontSize: null, bodyAlign: null }); setTypePop(null) }} className={typeReset}>
                      恢复默认（跟随主题）
                    </button>
                  </div>
                )}
              </div>
              <div className="relative">
                <button type="button" title="标题排版：字号 / 排列 / 装饰版式 / 序号 / 前缀（覆盖主题，导出同步）" onClick={() => setTypePop(typePop === 'heading' ? null : 'heading')} className={typeBtn}>
                  标题 {headingSize} <span className="text-[8px] text-slate-500">▾</span>
                </button>
                {typePop === 'heading' && (
                  <div className={typePanel}>
                    <TypeSection label="字号">
                      <TypeOptions
                        options={HEADING_FONT_SIZES.map((n) => ({ value: n, label: `${n}px` }))}
                        value={headingSize}
                        cols={5}
                        onPick={(n) => { onTypographyChange?.({ headingFontSize: n }); setTypePop(null) }}
                      />
                    </TypeSection>
                    <TypeSection label="排列">
                      <TypeOptions
                        options={HEADING_ALIGNS}
                        value={headingAlign}
                        cols={2}
                        onPick={(v) => { onTypographyChange?.({ headingAlign: v }); setTypePop(null) }}
                      />
                    </TypeSection>
                    <TypeSection label="H1 装饰">
                      <TypeOptions
                        options={H1_STYLES}
                        value={h1Cur}
                        cols={3}
                        onPick={(v) => { onTypographyChange?.({ h1Style: v }); setTypePop(null) }}
                      />
                    </TypeSection>
                    <TypeSection label="H2 装饰">
                      <TypeOptions
                        options={H2_STYLES}
                        value={h2Cur}
                        cols={4}
                        onPick={(v) => { onTypographyChange?.({ h2Style: v }); setTypePop(null) }}
                      />
                    </TypeSection>
                    <TypeSection label="H2 序号">
                      <TypeOptions
                        options={H2_NUMS}
                        value={h2NumCur}
                        cols={4}
                        onPick={(v) => { onTypographyChange?.({ h2Num: v }); setTypePop(null) }}
                      />
                    </TypeSection>
                    <TypeSection label="H3 前缀">
                      <TypeOptions
                        options={H3_MARKS}
                        value={h3Cur}
                        cols={3}
                        onPick={(v) => { onTypographyChange?.({ h3Mark: v }); setTypePop(null) }}
                      />
                    </TypeSection>
                    <button type="button" onClick={() => { onTypographyChange?.({ headingFontSize: null, headingAlign: null, h1Style: null, h2Style: null, h2Num: null, h3Mark: null }); setTypePop(null) }} className={typeReset}>
                      恢复默认（跟随主题）
                    </button>
                  </div>
                )}
              </div>
            </>
          )
        })()}
        <span className="ml-auto text-[10px] text-slate-500">Ctrl+Z 撤销 · Ctrl+Y 重做 · Ctrl+B 加粗</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {/* 选区浮动指令条：加粗 + 手动样式（字色/背景高亮/字号）+ AI 指令 */}
        <BubbleMenu
          editor={editor}
          tippyOptions={{
            duration: 100,
            // BubbleMenu 隐藏（点外部/选区清空）时同步收回样式面板，避免下次选中又冒出来
            onHidden: () => setStylePop(null)
          }}
        >
          <div className="relative flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-1.5 py-1 shadow-xl">
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs font-bold ${
                editor.isActive('bold')
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              B
            </button>
            {/* 字色 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setStylePop(stylePop === 'color' ? null : 'color')}
                title="字体颜色"
                className="flex h-6 items-center justify-center gap-1 rounded px-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <span
                  className="inline-block h-3 w-3 rounded-full border border-slate-500"
                  style={{
                    background:
                      (editor.getAttributes('textStyle').color as string | undefined) ?? '#e2e4ea'
                  }}
                />
                A
              </button>
              {stylePop === 'color' && (
                <StylePanel title="字体颜色" onClose={() => setStylePop(null)}>
                  <div className="grid grid-cols-5 gap-1.5">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c.color}
                        type="button"
                        title={c.name}
                        onClick={() => {
                          editor.chain().focus().setTextStyle({ color: c.color }).run()
                          setStylePop(null)
                        }}
                        className={`h-6 w-6 rounded border ${
                          editor.isActive('textStyle', { color: c.color })
                            ? 'border-sky-400 ring-1 ring-sky-400'
                            : 'border-slate-600'
                        }`}
                        style={{ background: c.color }}
                      />
                    ))}
                  </div>
                  <label className="mt-2 flex cursor-pointer items-center gap-2 rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700">
                    自定义
                    <input
                      type="color"
                      value={(editor.getAttributes('textStyle').color as string | undefined) ?? '#e63946'}
                      onChange={(e) => {
                        editor.chain().focus().setTextStyle({ color: e.target.value }).run()
                        setStylePop(null)
                      }}
                      className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().setTextStyle({ color: null }).run()
                      setStylePop(null)
                    }}
                    className="mt-2 w-full rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700"
                  >
                    恢复默认（跟随主题色）
                  </button>
                </StylePanel>
              )}
            </div>
            {/* 背景高亮 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setStylePop(stylePop === 'bg' ? null : 'bg')}
                title="背景高亮"
                className="flex h-6 items-center justify-center gap-1 rounded px-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-slate-500"
                  style={{
                    background:
                      (editor.getAttributes('textStyle').bg as string | undefined) ?? 'transparent'
                  }}
                />
                高亮
              </button>
              {stylePop === 'bg' && (
                <StylePanel title="背景高亮" onClose={() => setStylePop(null)}>
                  <div className="grid grid-cols-4 gap-1.5">
                    {BG_COLORS.map((c) => (
                      <button
                        key={c.color}
                        type="button"
                        title={c.name}
                        onClick={() => {
                          editor.chain().focus().setTextStyle({ bg: c.color }).run()
                          setStylePop(null)
                        }}
                        className={`h-6 w-8 rounded border ${
                          editor.isActive('textStyle', { bg: c.color })
                            ? 'border-sky-400 ring-1 ring-sky-400'
                            : 'border-slate-600'
                        }`}
                        style={{ background: c.color }}
                      />
                    ))}
                  </div>
                  <label className="mt-2 flex cursor-pointer items-center gap-2 rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700">
                    自定义
                    <input
                      type="color"
                      defaultValue="#fef3c7"
                      onChange={(e) => {
                        editor.chain().focus().setTextStyle({ bg: e.target.value }).run()
                        setStylePop(null)
                      }}
                      className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().setTextStyle({ bg: null }).run()
                      setStylePop(null)
                    }}
                    className="mt-2 w-full rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700"
                  >
                    清除高亮
                  </button>
                </StylePanel>
              )}
            </div>
            {/* 字号 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setStylePop(stylePop === 'size' ? null : 'size')}
                title="字号"
                className="flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                {(editor.getAttributes('textStyle').fontSize as number | undefined) ?? '字号'}
              </button>
              {stylePop === 'size' && (
                <StylePanel title="字号（px）" onClose={() => setStylePop(null)}>
                  <div className="flex max-h-56 flex-col gap-0.5 overflow-auto">
                    <button
                      type="button"
                      onClick={() => {
                        editor.chain().focus().setTextStyle({ fontSize: null }).run()
                        setStylePop(null)
                      }}
                      className="mb-1 rounded border border-slate-600 px-2 py-0.5 text-left text-[10px] text-slate-400 hover:bg-slate-700"
                    >
                      跟随正文默认
                    </button>
                    {FONT_SIZES.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          editor.chain().focus().setTextStyle({ fontSize: n }).run()
                          setStylePop(null)
                        }}
                        className={`rounded px-2 py-0.5 text-left ${
                          editor.isActive('textStyle', { fontSize: n })
                            ? 'bg-sky-600 text-white'
                            : 'text-slate-300 hover:bg-slate-700'
                        }`}
                        style={{ fontSize: Math.min(n, 20) }}
                      >
                        {n}px
                      </button>
                    ))}
                  </div>
                </StylePanel>
              )}
            </div>
            {/* 清除手动样式（保留加粗） */}
            <button
              type="button"
              onClick={() => editor.chain().focus().unsetTextStyle().run()}
              title="清除全部手动样式（字色/高亮/字号，保留加粗）"
              className="flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs text-slate-400 hover:bg-red-900/60 hover:text-red-200"
            >
              ×
            </button>
            <div className="mx-0.5 h-4 w-px bg-slate-700" />
            <button
              type="button"
              onClick={() => onAiModify?.()}
              className="flex h-6 items-center rounded px-2 text-xs text-slate-300 hover:bg-slate-700"
            >
              AI 修改
            </button>
            <button
              type="button"
              onClick={() => onAiReview?.()}
              className="flex h-6 items-center rounded px-2 text-xs text-slate-300 hover:bg-slate-700"
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
            // 昼夜配色解析（纯函数）：日间=主题基础色；夜间=公众号逻辑自动变深
            // （浅卡变深卡、深字变浅字，无卡片主题给默认深底；内置深浅兜底防脏数据）
            const c = resolveEditorTheme(t, uiDark !== false)
            const vars: Record<string, string> = {
              '--article-accent': accent,
              '--article-font': t.fontFamily,
              '--article-lh': String(t.lineHeight),
              '--article-ls': t.letterSpacing,
              '--article-h-align': t.headingAlign,
              // 结构级：背景卡片 / 段距 / 图片圆角 / 标题色
              '--article-body-bg': c.bodyBg ?? 'transparent',
              '--article-body-text': c.bodyText,
              '--article-body-radius': `${t.bodyRadius ?? 0}px`,
              '--article-body-pad': t.bodyPadding ?? '',
              '--article-p-gap': `${t.pGap ?? 16}px`,
              '--article-img-radius': `${t.imgRadius ?? 4}px`,
              '--article-font-size': `${t.fontSize ?? 16}px`,
              // 标题字号：H1=基准+6 / H2=基准 / H3=基准-3（与导出 26/20/17 同源）
              '--article-h1-size': `${(t.headingFontSize ?? 20) + 6}px`,
              '--article-h2-size': `${t.headingFontSize ?? 20}px`,
              '--article-h3-size': `${Math.max(12, (t.headingFontSize ?? 20) - 3)}px`,
              // 正文排列：indent 首行缩进 / flush 顶格两端对齐 / center 居中
              '--article-p-align': t.bodyAlign === 'center' ? 'center' : t.bodyAlign === 'flush' ? 'justify' : 'left',
              '--article-p-indent': t.bodyAlign === 'indent' ? '2em' : '0',
              '--article-heading-color': c.headingColor,
              // 图注：深底浅字 / 浅底深字（不用灰字）
              '--article-caption-color': c.darkBg ? '#cbd5e1' : '#555'
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
              const h2Bg = t.h2Bg && isHexColor(t.h2Bg) ? t.h2Bg : accent
              vars['--article-h2-bg'] = h2Bg
              vars['--article-h2-color'] = contrastText(h2Bg)
              vars['--article-h2-left'] = 'none'
              vars['--article-h2-pad'] = '3px 14px'
              vars['--article-h2-radius'] = '6px'
              // display:table 块级收缩，配合 margin auto 实现居中（公众号最稳方案）
              vars['--article-h2-display'] = 'table'
              vars['--article-h2-margin'] = t.headingAlign === 'center' ? '40px auto 16px' : '40px 0 16px'
            } else if (h2 === 'underline') {
              vars['--article-h2-border'] = `2px solid ${accent}`
              vars['--article-h2-left'] = 'none'
              vars['--article-h2-pad'] = '0 0 8px'
            } else if (h2 === 'plain') {
              vars['--article-h2-left'] = 'none'
              vars['--article-h2-pl'] = '0'
            }
            // H2 文字排列：plain/underline 跟随标题排列（block 自带居中、leftbar 竖条保持左）
            if (t.headingAlign === 'center' && (h2 === 'plain' || h2 === 'underline')) {
              vars['--article-h2-text-align'] = 'center'
            }
            // 小节序号（导入排版「01 标题」范式）：CSS counter 表达式按序号样式注入，
            // 与导出端 h2NumText 同形（公众号剥伪元素，导出由 blockToHtml 注真实文本）。
            // 标题手写序号由 H2NumMask 扩展隐藏、自动序号顶上（与导出端剥除+注入同语义）
            if (t.h2Num) {
              vars['--article-h2-num'] = {
                '01': 'counter(h2num, decimal-leading-zero) " "',
                // 圈号：h2circled 在 index.css 用 @counter-style 定义（①-⑳，超出回落数字）
                '①': 'counter(h2num, h2circled) " "',
                '1.': 'counter(h2num) ". "',
                '1、': 'counter(h2num) "、"',
                '一、': 'counter(h2num, simp-chinese-informal) "、"',
                '壹、': 'counter(h2num, simp-chinese-formal) "、"'
              }[t.h2Num]
            }
            // H3 前缀：dot 圆点 / none 无（diamond 用 CSS 默认菱形）
            const mark = t.h3Mark ?? 'diamond'
            if (mark === 'dot') vars['--article-mark-radius'] = '50%'
            else if (mark === 'none') vars['--article-mark-display'] = 'none'
            // 引用：card 圆角卡片 / quotes 引号（leftbar 用 CSS 默认左条）
            const quote = t.quoteStyle ?? 'leftbar'
            // 引用文字色按背景实际亮度：深底 → 浅字；浅色卡片 → 深字（不用灰字）
            vars['--article-quote-color'] = c.darkBg ? '#cbd5e1' : '#333'
            if (quote === 'card') {
              vars['--article-quote-left'] = 'none'
              vars['--article-quote-radius'] = '12px'
              vars['--article-quote-pad'] = '14px 16px'
              vars['--article-quote-bg'] = `color-mix(in srgb, ${accent} 12%, transparent)`
            } else if (quote === 'dashcard') {
              // 虚线边框提示卡：彩色 dashed 描边 + 透明底（导出端同形态）
              vars['--article-quote-left'] = 'none'
              vars['--article-quote-radius'] = '12px'
              vars['--article-quote-pad'] = '14px 16px'
              vars['--article-quote-border'] = `1px dashed ${t.quoteBorder && isHexColor(t.quoteBorder) ? t.quoteBorder : accent}`
              vars['--article-quote-bg'] = 'transparent'
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
              const strongBg = t.strongBg && isHexColor(t.strongBg) ? t.strongBg : '#fef3c7'
              vars['--article-strong-bg'] = strongBg
              // 高亮字色按高亮底色自身亮度（与导出端 strongStyle 同源）：
              // 淡黄 #fef3c7 上恒为深字，夜间深卡配淡黄高亮也不出「白字混底」看不清
              vars['--article-strong-color'] = isDarkColor(strongBg) ? '#f5f5f4' : '#333'
              vars['--article-strong-pad'] = '1px 6px'
              vars['--article-strong-radius'] = '4px'
            } else if (strong === 'plain') {
              vars['--article-strong-color'] = 'inherit'
            } else if (t.strongColor && isHexColor(t.strongColor)) {
              // color 样式 + 专属加粗强调色（文章常 strong 用独立品牌色）
              vars['--article-strong-color'] = t.strongColor
            }
            // 表格：边框 / 表头背景 / 表头字色（按表头背景亮度）
            if (t.tableStyle) {
              const border = t.tableBorder && isHexColor(t.tableBorder) ? t.tableBorder : c.darkBg ? '#3a4a5e' : '#e5e7eb'
              const hbg =
                t.tableHeaderBg && isHexColor(t.tableHeaderBg) ? t.tableHeaderBg : c.darkBg ? '#1e2b3d' : '#f3f4f6'
              vars['--article-table-border'] = border
              vars['--article-table-header-bg'] = hbg
              vars['--article-table-header-text'] =
                t.tableHeaderText && isHexColor(t.tableHeaderText)
                  ? t.tableHeaderText
                  : isDarkColor(hbg)
                    ? '#eef2f7'
                    : '#1a1a1a'
              vars['--article-table-stripe'] = t.tableStyle === 'striped' ? '1' : '0'
              // 斑马纹底色：striped 用表头色的淡色，其余透明
              vars['--article-table-stripe-bg'] =
                t.tableStyle === 'striped'
                  ? `color-mix(in srgb, ${hbg} 40%, transparent)`
                  : 'transparent'
            }
            return vars as CSSProperties
          })()}
        />
      </div>
    </div>
  )
})

export default ArticleEditor
