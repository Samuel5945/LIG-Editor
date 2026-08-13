import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppPaths, ArticleTheme, IdeaCard, ProjectData, ProjectMeta, ProjectSummary, SkillInfo } from '@shared/types'
import { PROJECT_CATEGORIES, UNCATEGORIZED } from '@shared/categories'
import { resolveArticleTheme } from '@shared/categoryThemes'
import { CARD_FORMAT_LABEL, parseCardItems, type CardFormat } from '@shared/cards'
import { chatOnce } from './copilot/llm'
import { cardsMessages, categoryMessages } from './copilot/prompts'
import ConflictDialog from './components/ConflictDialog'
import SettingsDialog from './components/SettingsDialog'
import IntegrationDialog from './components/IntegrationDialog'
import ChatPanel from './components/ChatPanel'
import BrainstormPanel, { type BrainstormSeed } from './components/BrainstormPanel'
import IdeaLibrary from './components/IdeaLibrary'
import ModifyDialog from './components/ModifyDialog'
import PolishDialog from './components/PolishDialog'
import FigureDialog, { type FigureRequest } from './components/FigureDialog'
import ExportDialog from './components/ExportDialog'
import ThemeImportDialog from './components/ThemeImportDialog'
import ReviewPanel from './components/ReviewPanel'
import CardsReviewPanel from './components/CardsReviewPanel'
import TitleCoverPanel from './components/TitleCoverPanel'
import CardsPanel, { type CardsPanelHandle } from './components/CardsPanel'
import ArticleEditor, { type ArticleEditorHandle, type EditorSelection } from './editor/ArticleEditor'

const STATUS_LABEL: Record<string, string> = {
  ideating: '脑暴中',
  drafting: '撰写中',
  reviewing: '审阅中',
  ready: '可发布'
}

/** 三栏工作台：左 项目/选题库，中 编辑器/标题封面，右 对话/脑暴/审阅（互相独立不串扰） */
export default function App(): JSX.Element {
  const [paths, setPaths] = useState<AppPaths | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  const [article, setArticle] = useState('')
  const [saved, setSaved] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [conflict, setConflict] = useState<{ file: string; external: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  // M8 接入 / Skill 管理弹窗
  const [showIntegration, setShowIntegration] = useState(false)
  // 主题：深色为默认，日间可切换（localStorage 持久化，main.tsx 首帧前已套用）
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('ui-theme') === 'light' ? 'light' : 'dark'
  )
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('light', next === 'light')
      localStorage.setItem('ui-theme', next)
      return next
    })
  }, [])
  // M5 副驾驶
  const [leftTab, setLeftTab] = useState<'projects' | 'ideas'>('projects')
  const [centerTab, setCenterTab] = useState<'article' | 'titlecover'>('article')
  const [rightTab, setRightTab] = useState<'chat' | 'create' | 'review'>('chat')
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [skillName, setSkillName] = useState('')
  const [skillContent, setSkillContent] = useState<string | null>(null)
  const [modifySel, setModifySel] = useState<EditorSelection | null>(null)
  const [reviewRequest, setReviewRequest] = useState(0)
  const [reviewSelection, setReviewSelection] = useState<string | null>(null)
  const [brainstormSeed, setBrainstormSeed] = useState<BrainstormSeed | null>(null)
  // 全文优化弹窗：{} 排版优化，{ review } 按审阅报告修订
  const [polish, setPolish] = useState<{ review?: string } | null>(null)
  // 三配图管线弹窗（M6）
  const [figRequest, setFigRequest] = useState<FigureRequest | null>(null)
  // 导出弹窗（M7）
  const [showExport, setShowExport] = useState(false)
  // 文章转贴图：展开风格选择 / 转换进行中
  const [showConvert, setShowConvert] = useState(false)
  const [converting, setConverting] = useState(false)
  // 工程内存有卡片数据：文章形态下显示「回到贴图」回退入口
  const [hasCards, setHasCards] = useState(false)
  // 脑暴入库后自增，驱动选题库自动刷新
  const [ideasVersion, setIdeasVersion] = useState(0)
  // 项目分类：筛选条件（all = 全部）、可用分类列表（预设 + 自定义）与 AI 分类进行中
  const [filterCat, setFilterCat] = useState<string>('all')
  const [categorizing, setCategorizing] = useState(false)
  const [categories, setCategories] = useState<string[]>(() => [...PROJECT_CATEGORIES, UNCATEGORIZED])
  // 新建分类内联输入（Electron 不支持 window.prompt，用行内输入框代替）
  const [newCatFor, setNewCatFor] = useState<string | null>(null)
  const [newCatName, setNewCatName] = useState('')
  // 自定义排版主题库（settings/customThemes.json）：分类调性打底时的最高优先覆盖
  const [customThemes, setCustomThemes] = useState<Record<string, ArticleTheme>>({})
  // 导入排版弹窗（粘贴 HTML / 公众号链接复用排版）
  const [showThemeImport, setShowThemeImport] = useState(false)
  const editorRef = useRef<ArticleEditorHandle>(null)
  // 贴图面板句柄：右栏贴图审阅的落盘/优化/定位经这里转发
  const cardsRef = useRef<CardsPanelHandle>(null)
  // 贴图统计（格式/张数）：由 CardsPanel 上报，显示在中栏页签行
  const [cardsInfo, setCardsInfo] = useState<{ format: CardFormat; count: number } | null>(null)

  // 事件监听里要读最新值，用 ref 镜像避免闭包过期
  const currentRef = useRef(current)
  currentRef.current = current
  const articleRef = useRef(article)
  articleRef.current = article
  const savedRef = useRef(saved)
  savedRef.current = saved

  const dirty = article !== saved

  /** 排版调性：自定义主题 > 分类调性 > 默认（meta 变化即时跟换） */
  const articleTheme = useMemo(() => resolveArticleTheme(meta, customThemes), [meta, customThemes])

  /** 当前工程真实目录（分类布局后在 workspace/<分类>/<工程名>/，不能再用 workspace 根拼接） */
  const currentDir = useMemo(() => projects.find((p) => p.name === current)?.dir ?? '', [projects, current])

  /** 正文字数：去掉 Markdown/HTML 标记后，CJK 每字记 1、连续西文数字记 1 词 */
  const wordCount = useMemo(() => {
    const text = article
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#>*`~|_-]+/g, ' ')
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
    const words = (text.match(/[A-Za-z0-9]+/g) || []).length
    return cjk + words
  }, [article])

  const refreshProjects = useCallback(() => {
    window.api.invoke('project:list').then(setProjects)
    window.api.invoke('project:listCategories').then(setCategories)
  }, [])

  const refreshMeta = useCallback(async () => {
    const name = currentRef.current
    if (!name) return
    setMeta(await window.api.invoke('project:readMeta', name))
  }, [])

  const refreshSkills = useCallback(() => {
    window.api.invoke('skill:list').then(setSkills)
  }, [])

  useEffect(() => {
    window.api.invoke('app:getPaths').then(setPaths)
    refreshSkills()
    refreshProjects()
    window.api.invoke('customTheme:list').then(setCustomThemes)
  }, [refreshProjects, refreshSkills])

  // ---- Skill 挂载：读 SKILL.md 全文注入系统提示；随工程持久化到 meta.style_skill ----

  const mountSkill = useCallback(
    async (name: string, persistToMeta = true) => {
      setSkillName(name)
      if (!name) {
        setSkillContent(null)
      } else {
        try {
          setSkillContent(await window.api.invoke('skill:read', name))
        } catch (err) {
          setSkillContent(null)
          setSkillName('')
          setToast(`Skill 读取失败：${err instanceof Error ? err.message : err}`)
          return
        }
      }
      const project = currentRef.current
      if (persistToMeta && project) {
        const m = await window.api.invoke('project:readMeta', project)
        m.style_skill = name || undefined
        await window.api.invoke('project:writeMeta', project, m)
        setMeta(m)
      }
    },
    []
  )

  // ---- 打开 / 新建 ----

  const openProject = useCallback(
    async (name: string) => {
      const data: ProjectData = await window.api.invoke('project:open', name)
      setCurrent(name)
      currentRef.current = name
      setMeta(data.meta)
      setArticle(data.article)
      setSaved(data.article)
      setConflict(null)
      setCenterTab('article')
      // 不动 rightTab：脑暴面板立项后还要继续生成正文，不能被切走
      await mountSkill(data.meta.style_skill ?? '', false)
    },
    [mountSkill]
  )

  const createProject = useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    try {
      // 主进程会清洗工程名（如去结尾点），打开时用返回的最终名
      const created = await window.api.invoke('project:create', name)
      setCreating(false)
      setNewName('')
      refreshProjects()
      await openProject(created.name)
    } catch (err) {
      setToast(String(err instanceof Error ? err.message : err))
    }
  }, [newName, openProject, refreshProjects])

  /** 删除工程（确认后整目录移除；删当前工程先关闭） */
  const deleteProject = useCallback(
    async (name: string) => {
      if (!window.confirm(`删除工程「${name}」？\n整个文件夹（正文/素材/会话）将被移除，不可恢复。`)) return
      try {
        if (currentRef.current === name) {
          await window.api.invoke('project:close')
          setCurrent(null)
          currentRef.current = null
          setMeta(null)
          setArticle('')
          setSaved('')
          setConflict(null)
        }
        await window.api.invoke('project:delete', name)
        refreshProjects()
        setToast(`已删除「${name}」`)
      } catch (err) {
        setToast(`删除失败：${err instanceof Error ? err.message : err}`)
      }
    },
    [refreshProjects]
  )

  // ---- 项目分类：手动切换 + AI 推荐；文件夹随分类迁移 workspace/<分类>/<工程名>/ ----

  const shownProjects = useMemo(
    () => projects.filter((p) => filterCat === 'all' || (p.category ?? UNCATEGORIZED) === filterCat),
    [projects, filterCat]
  )

  const applyCategory = useCallback(
    async (name: string, category: string) => {
      try {
        const m = await window.api.invoke('project:setCategory', name, category)
        if (currentRef.current === name) setMeta(m)
        refreshProjects()
        setToast(`「${name}」已归入「${category}」，文件夹已同步移动`)
      } catch (err) {
        setToast(`分类失败：${err instanceof Error ? err.message : err}`)
      }
    },
    [refreshProjects]
  )

  const aiCategorize = useCallback(async () => {
    const name = currentRef.current
    if (!name || categorizing) return
    // 优先用正文判断；正文为空退回工程名
    const source = articleRef.current.trim() || name
    setCategorizing(true)
    try {
      const { promise } = chatOnce(categoryMessages(source, skillContent))
      const full = await promise
      const guess = full.trim()
      const cat = categories.find((c) => guess.includes(c)) ?? UNCATEGORIZED
      await applyCategory(name, cat)
    } catch (err) {
      setToast(`AI 分类失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setCategorizing(false)
    }
  }, [categorizing, skillContent, categories, applyCategory])

  // ---- 自动保存（2s 防抖；太短会让外部冲突窗口过窄）----

  useEffect(() => {
    if (!current || !dirty) return
    const timer = setTimeout(async () => {
      await window.api.invoke('project:writeFile', current, 'article.md', article)
      setSaved(article)
      refreshProjects()
    }, 2000)
    return () => clearTimeout(timer)
  }, [article, current, dirty, refreshProjects])

  // ---- 外部修改热载 / 冲突处理 ----

  useEffect(() => {
    const offFile = window.api.on('file:external-change', async ({ project, file }) => {
      if (project !== currentRef.current) return
      if (file === 'project.json') {
        refreshProjects()
        refreshMeta()
        return
      }
      if (file !== 'article.md') return
      const external = await window.api.invoke('project:readFile', project, 'article.md')
      if (external === articleRef.current) {
        // 内容一致（例如外部写入了与本地相同的文本），静默同步基线
        setSaved(external)
        return
      }
      if (articleRef.current === savedRef.current) {
        // 本地无未保存改动 → 3 秒内热载
        setArticle(external)
        setSaved(external)
        setToast('article.md 已从外部更新，已热载')
      } else {
        setConflict({ file, external })
      }
    })
    const offWs = window.api.on('workspace:changed', () => refreshProjects())
    return () => {
      offFile()
      offWs()
    }
  }, [refreshProjects, refreshMeta])

  // toast 自动消失
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const resolveKeepLocal = useCallback(async () => {
    if (!current || !conflict) return
    await window.api.invoke('project:writeFile', current, 'article.md', articleRef.current)
    setSaved(articleRef.current)
    setConflict(null)
    setToast('已保留本地版本并写回磁盘')
  }, [current, conflict])

  const resolveAcceptExternal = useCallback(() => {
    if (!conflict) return
    setArticle(conflict.external)
    setSaved(conflict.external)
    setConflict(null)
    setToast('已接受外部版本')
  }, [conflict])

  // ---- 副驾驶联动 ----

  /** BubbleMenu「AI 修改」：取选区开修改弹窗 */
  const handleAiModify = useCallback(() => {
    const sel = editorRef.current?.getSelection()
    if (!sel || !sel.text.trim()) {
      setToast('请先在正文中选中一段文字')
      return
    }
    setModifySel(sel)
  }, [])

  /** BubbleMenu「AI 审阅」：有选区只审选段，无选区审全文 */
  const handleAiReview = useCallback(() => {
    const sel = editorRef.current?.getSelection()
    setReviewSelection(sel?.text.trim() ? sel.text : null)
    setRightTab('review')
    setReviewRequest((n) => n + 1)
  }, [])

  /** 脑暴完成「去审阅」→ 强制全文审阅 */
  const handleFullReview = useCallback(() => {
    setReviewSelection(null)
    setRightTab('review')
    setReviewRequest((n) => n + 1)
  }, [])

  /** 全文生成流式落编辑器（唯一事实源是 md 字符串，直接覆盖） */
  const handleArticleGenerated = useCallback((md: string) => {
    setCenterTab('article')
    setArticle(md)
  }, [])

  /** 选题库「生成大纲」→ 送入脑暴面板大纲流程 */
  const handleMakeOutline = useCallback((card: IdeaCard) => {
    setBrainstormSeed({ card, ts: Date.now() })
    setRightTab('create')
  }, [])

  /** 审阅引用行 → 编辑器定位 */
  const handleLocate = useCallback((snippet: string): boolean => {
    setCenterTab('article')
    return editorRef.current?.scrollToText(snippet) ?? false
  }, [])

  // ---- 三配图管线（M6）----

  /** 占位卡管线按钮 → 开配图弹窗；完成后把占位卡原位替换成 figureImage */
  const handleFigAction = useCallback<NonNullable<Parameters<typeof ArticleEditor>[0]['onFigAction']>>(
    (pipeline, ctx) => {
      setFigRequest({
        pipeline,
        desc: ctx.desc,
        onDone: (attrs) => {
          if (attrs) ctx.replace(attrs)
          setFigRequest(null)
          setToast('配图已插入正文')
        }
      })
    },
    []
  )

  /** 文章强调色落 meta.accent：编辑器 CSS 变量即时跟色，导出/推送同源读色；null = 恢复默认 */
  const handleApplyArticleAccent = useCallback(async (color: string | null) => {
    if (!currentRef.current) throw new Error('先打开工程')
    const m = await window.api.invoke('project:readMeta', currentRef.current)
    m.accent = color ?? undefined
    await window.api.invoke('project:writeMeta', currentRef.current, m)
    setMeta(m)
  }, [])

  /** 源码图「改源码重渲染」→ 代码绘图弹窗编辑模式；完成后只刷图不插节点 */
  const handleEditFigureSource = useCallback((figureSource: string, desc: string) => {
    setFigRequest({
      pipeline: 'code',
      desc,
      htmlRelPath: figureSource,
      onDone: () => {
        editorRef.current?.refreshFigures()
        setFigRequest(null)
        setToast('图表已重渲染')
      }
    })
  }, [])

  // 外部（Agent）改 figures/*.html → 主进程自动重渲完毕 → 刷新正文图片
  useEffect(() => {
    return window.api.on('figure:rendered', ({ project, html }) => {
      if (project !== currentRef.current) return
      editorRef.current?.refreshFigures()
      setToast(`图表 ${html} 已自动重渲染`)
    })
  }, [])

  // ---- 导出（M7）----

  /** 打开导出弹窗前先把未保存正文落盘，主进程导出读的是磁盘 article.md */
  const handleOpenExport = useCallback(async () => {
    const name = currentRef.current
    if (!name) return
    if (articleRef.current !== savedRef.current) {
      await window.api.invoke('project:writeFile', name, 'article.md', articleRef.current)
      setSaved(articleRef.current)
    }
    setShowExport(true)
  }, [])

  // 形态切换/转换后刷新：有 cards.json 才露出「回到贴图」回退入口
  useEffect(() => {
    if (!current) {
      setHasCards(false)
      return
    }
    window.api
      .invoke('cards:read', current)
      .then((d) => setHasCards(Boolean(d?.cards.length)))
      .catch(() => setHasCards(false))
  }, [current, meta?.format])

  /** 回退：不重新生成，只切回贴图形态（article.md 与 cards.json 各自保留） */
  const backToCards = useCallback(async () => {
    const name = currentRef.current
    if (!name) return
    const m = await window.api.invoke('project:readMeta', name)
    m.format = 'cards'
    await window.api.invoke('project:writeMeta', name, m)
    setMeta(m)
    setToast('已切回贴图形态，正文保留，贴图面板「回到文章」可随时切回来')
  }, [])

  /** 文章 → 贴图：正文提炼卡片组 → cards.json → 工程切 cards 形态（贴图面板自动逐张渲染） */
  const convertToCards = useCallback(
    async (format: CardFormat) => {
      const name = currentRef.current
      if (!name || !articleRef.current.trim()) return
      const label = CARD_FORMAT_LABEL[format]
      setConverting(true)
      try {
        const { promise } = chatOnce(cardsMessages(articleRef.current, '文章', format, skillContent), (full) =>
          setToast(`${label}卡片生成中…已生成 ${full.length} 字`)
        )
        const parsed = parseCardItems(await promise)
        if (!parsed) throw new Error('卡片解析失败，请重试')
        await window.api.invoke('cards:write', name, { format, cards: parsed })
        const m = await window.api.invoke('project:readMeta', name)
        m.format = 'cards'
        await window.api.invoke('project:writeMeta', name, m)
        setMeta(m)
        setToast(`已生成 ${parsed.length} 张${label}卡片，正在逐张渲染`)
      } catch (err) {
        setToast(`转贴图失败：${err instanceof Error ? err.message : err}`)
      } finally {
        setConverting(false)
      }
    },
    [skillContent]
  )

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏（无边框自绘标题栏：整条可拖拽移动窗口，右侧窗口控制按钮） */}
      <header className="app-drag flex h-11 shrink-0 items-center gap-3 border-b border-panel-3 bg-panel-2 pl-4">
        <span className="text-sm font-bold">图文编辑器</span>
        <span className="text-xs text-ink-dim">@LIG人生如戏的图文创作平台公测版</span>
        <div className="ml-auto flex items-center gap-2 text-xs text-ink-dim">
          <button onClick={toggleTheme} title="切换深色 / 日间模式" className="rounded px-2 py-1 hover:bg-panel-3">
            {theme === 'dark' ? '☀ 日间' : '☾ 深色'}
          </button>
          <button onClick={() => setShowSettings(true)} className="rounded px-2 py-1 hover:bg-panel-3">
            模型接入
          </button>
          <button onClick={() => setShowIntegration(true)} className="rounded px-2 py-1 hover:bg-panel-3">
            设置
          </button>
        </div>
        <div className="flex h-full items-stretch">
          <button
            onClick={() => void window.api.invoke('win:minimize')}
            title="最小化"
            className="w-11 text-sm text-ink-dim hover:bg-panel-3"
          >
            ─
          </button>
          <button
            onClick={() => void window.api.invoke('win:toggleMaximize')}
            title="最大化 / 还原"
            className="w-11 text-sm text-ink-dim hover:bg-panel-3"
          >
            ▢
          </button>
          <button
            onClick={() => void window.api.invoke('win:close')}
            title="关闭"
            className="w-11 text-sm text-ink-dim hover:bg-red-600 hover:text-white"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左栏：项目 / 选题库 */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-panel-3 bg-panel-2">
          <nav className="flex gap-1 border-b border-panel-3 p-2 text-xs">
            <button
              onClick={() => setLeftTab('projects')}
              className={`rounded px-2.5 py-1 ${leftTab === 'projects' ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`}
            >
              项目
            </button>
            <button
              onClick={() => setLeftTab('ideas')}
              className={`rounded px-2.5 py-1 ${leftTab === 'ideas' ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`}
            >
              选题库
            </button>
          </nav>
          {leftTab === 'ideas' ? (
            <IdeaLibrary version={ideasVersion} onMakeOutline={handleMakeOutline} onToast={setToast} />
          ) : (
            <>
              <div className="flex flex-wrap gap-1 border-b border-panel-3 p-2">
                {['all', ...categories].map((c) => (
                  <button
                    key={c}
                    onClick={() => setFilterCat(c)}
                    title={c === 'all' ? '显示全部项目' : `只看「${c}」`}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      filterCat === c ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-3'
                    }`}
                  >
                    {c === 'all' ? '全部' : c}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-auto p-2 text-xs">
                {shownProjects.length === 0 && (
                  <p className="mb-2 px-1 text-ink-dim">
                    {projects.length === 0 ? '暂无项目' : '该分类下暂无项目'}
                  </p>
                )}
                {shownProjects.map((p) => {
                  const cat = p.category ?? UNCATEGORIZED
                  const isCurrent = p.name === current
                  return (
                    <div
                      key={p.name}
                      onClick={() => openProject(p.name)}
                      className={`group mb-1 cursor-pointer rounded px-2 py-1.5 text-left ${
                        isCurrent ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'
                      }`}
                    >
                      <div className="flex w-full items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        {cat !== UNCATEGORIZED && (
                          <span
                            className="shrink-0 rounded bg-panel px-1 py-0.5 text-[10px] text-accent"
                            title={`分类：${cat}`}
                          >
                            {cat}
                          </span>
                        )}
                        <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[10px] group-hover:hidden">
                          {STATUS_LABEL[p.status] ?? p.status}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteProject(p.name)
                          }}
                          title="删除工程"
                          className="hidden shrink-0 rounded px-1 text-ink-dim hover:text-red-400 group-hover:block"
                        >
                          🗑
                        </button>
                      </div>
                      {isCurrent && (
                        <div className="mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={cat}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v === '__new__') {
                                // Electron 不支持 window.prompt：展开行内输入框新建分类
                                setNewCatFor(p.name)
                                setNewCatName('')
                                return
                              }
                              void applyCategory(p.name, v)
                            }}
                            title="切换分类（工程文件夹随之移动到对应分类目录）；底部可新建自定义分类"
                            className="min-w-0 flex-1 rounded bg-panel px-1.5 py-1 text-[11px] text-ink outline-none"
                          >
                            {categories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                            <option value="__new__">＋ 新建分类…</option>
                          </select>
                          <button
                            onClick={() => void aiCategorize()}
                            disabled={categorizing}
                            title="AI 通读正文推荐分类"
                            className="shrink-0 rounded bg-panel px-1.5 py-1 text-[11px] text-accent hover:bg-panel-2 disabled:opacity-40"
                          >
                            {categorizing ? '判断中…' : '✦ AI'}
                          </button>
                        </div>
                      )}
                      {isCurrent && newCatFor === p.name && (
                        <div className="mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={newCatName}
                            onChange={(e) => setNewCatName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newCatName.trim()) {
                                void applyCategory(p.name, newCatName.trim())
                                setNewCatFor(null)
                                setNewCatName('')
                              }
                              if (e.key === 'Escape') {
                                setNewCatFor(null)
                                setNewCatName('')
                              }
                            }}
                            placeholder="新分类名（自动建 workspace/<分类>/ 文件夹）"
                            className="min-w-0 flex-1 rounded bg-panel px-1.5 py-1 text-[11px] text-ink outline-none placeholder:text-ink-dim"
                          />
                          <button
                            onClick={() => {
                              if (!newCatName.trim()) return
                              void applyCategory(p.name, newCatName.trim())
                              setNewCatFor(null)
                              setNewCatName('')
                            }}
                            disabled={!newCatName.trim()}
                            className="shrink-0 rounded bg-accent px-1.5 py-1 text-[11px] text-white disabled:opacity-40"
                          >
                            建
                          </button>
                          <button
                            onClick={() => {
                              setNewCatFor(null)
                              setNewCatName('')
                            }}
                            className="shrink-0 rounded bg-panel px-1.5 py-1 text-[11px] text-ink-dim hover:text-ink"
                          >
                            取消
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
                {creating ? (
                <div className="mt-2 flex gap-1">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createProject()
                      if (e.key === 'Escape') setCreating(false)
                    }}
                    placeholder="工程名"
                    className="min-w-0 flex-1 rounded bg-panel-3 px-2 py-1.5 text-ink outline-none placeholder:text-ink-dim"
                  />
                  <button onClick={createProject} className="shrink-0 rounded bg-accent px-2 text-white">
                    建
                  </button>
                  <button
                    onClick={() => {
                      setCreating(false)
                      setNewName('')
                    }}
                    className="shrink-0 rounded bg-panel-3 px-2 text-ink-dim hover:text-ink"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="mt-2 w-full rounded border border-dashed border-panel-3 py-2 text-ink-dim hover:border-accent hover:text-accent"
                >
                  + 新建图文工程
                </button>
              )}
              </div>
            </>
          )}
          {paths && (
            <footer
              onClick={() => window.api.invoke('export:openFile', paths.workspace).catch(() => {})}
              title={`点击打开工作区文件夹\n${paths.workspace}`}
              className="cursor-pointer truncate border-t border-panel-3 p-2 text-[10px] text-ink-dim hover:bg-panel-3 hover:text-ink"
            >
              📂 {paths.workspace}
            </footer>
          )}
        </aside>

        {/* 中栏：正文编辑器 / 标题封面 */}
        <main className="flex min-w-0 flex-1 flex-col bg-panel">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-panel-3 px-4 text-xs text-ink-dim">
            <button
              onClick={() => setCenterTab('article')}
              className={`rounded px-2 py-0.5 ${centerTab === 'article' ? 'bg-panel-3 text-ink' : 'hover:bg-panel-3'}`}
            >
              {meta?.format === 'cards' ? '贴图' : '正文'}
            </button>
            {current && centerTab === 'article' && meta?.format === 'cards' && cardsInfo && (
              <span className="whitespace-nowrap text-ink-dim">
                {CARD_FORMAT_LABEL[cardsInfo.format]} · {cardsInfo.count} 张 · 1242×1656
              </span>
            )}
            <button
              onClick={() => setCenterTab('titlecover')}
              disabled={!current}
              className={`rounded px-2 py-0.5 ${centerTab === 'titlecover' ? 'bg-panel-3 text-ink' : 'hover:bg-panel-3'} disabled:opacity-40`}
            >
              标题/封面
            </button>
            {current && centerTab === 'article' && meta?.format !== 'cards' && (
              <>
                <button
                  onClick={() => setPolish({})}
                  disabled={!article.trim()}
                  className="rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40"
                >
                  ✦ 排版优化
                </button>
                <button
                  onClick={() => setShowThemeImport(true)}
                  title="粘贴公众号 HTML 或链接，复用它的排版"
                  className="rounded px-2 py-0.5 hover:bg-panel-3"
                >
                  🎨 排版
                </button>
                <button
                  onClick={handleOpenExport}
                  disabled={!article.trim()}
                  className="rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40"
                >
                  📤 导出
                </button>
                <button
                  onClick={() => setShowConvert((v) => !v)}
                  disabled={!article.trim() || converting}
                  title="把正文提炼成多张竖版图片卡片，工程切换为贴图形态"
                  className="rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40"
                >
                  {converting ? '转贴图中…' : '🖼 转贴图'}
                </button>
                {showConvert && !converting && (
                  <>
                    <button
                      onClick={() => {
                        setShowConvert(false)
                        void convertToCards('wechat')
                      }}
                      className="rounded bg-panel-3 px-2 py-0.5 text-ink hover:bg-panel"
                    >
                      → 公众号贴图
                    </button>
                    <button
                      onClick={() => {
                        setShowConvert(false)
                        void convertToCards('xhs')
                      }}
                      className="rounded bg-panel-3 px-2 py-0.5 text-ink hover:bg-panel"
                    >
                      → 小红书贴图
                    </button>
                  </>
                )}
                {hasCards && !converting && (
                  <button
                    onClick={backToCards}
                    title="不重新生成，直接切回已有卡片组；正文保留可随时切回来"
                    className="rounded px-2 py-0.5 hover:bg-panel-3"
                  >
                    ↩ 回到贴图
                  </button>
                )}
              </>
            )}
            {current && centerTab === 'titlecover' && meta?.format !== 'cards' && (
              <button
                onClick={handleOpenExport}
                disabled={!article.trim()}
                className="rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40"
              >
                📤 导出
              </button>
            )}
            <span className="ml-auto">
              {current ? (
                <>
                  {wordCount > 0 && <span className="mr-2">{wordCount} 字</span>}
                  {current}
                  <span className={dirty ? 'ml-2 text-amber-400' : 'ml-2 text-green-500'}>
                    {dirty ? '● 未保存' : '✓ 已保存'}
                  </span>
                </>
              ) : (
                '未打开工程'
              )}
            </span>
          </div>
          {current ? (
            centerTab === 'article' ? (
              meta?.format === 'cards' ? (
                <CardsPanel
                  key={current}
                  ref={cardsRef}
                  project={current}
                  projectDir={currentDir}
                  skill={skillContent}
                  hasArticle={Boolean(article.trim())}
                  onArticleGenerated={handleArticleGenerated}
                  onMetaUpdated={refreshMeta}
                  onDeckChanged={setCardsInfo}
                  onToast={setToast}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <ArticleEditor
                    key={current}
                    ref={editorRef}
                    project={current}
                    markdown={article}
                    projectDir={currentDir}
                    accent={meta?.accent}
                    theme={articleTheme}
                    onChange={setArticle}
                    onAiModify={handleAiModify}
                    onAiReview={handleAiReview}
                    onFigAction={handleFigAction}
                    onEditFigureSource={handleEditFigureSource}
                    onAccentChange={handleApplyArticleAccent}
                  />
                </div>
              )
            ) : (
              meta && (
                <TitleCoverPanel
                  project={current}
                  meta={meta}
                  article={article}
                  skill={skillContent}
                  onMetaUpdated={refreshMeta}
                  onApplyTitle={(title) => {
                    // 草稿标题取自正文 H1：替换首个非空行的 H1，没有则前插
                    setArticle((md) => {
                      const lines = md.split('\n')
                      const i = lines.findIndex((l) => l.trim())
                      if (i >= 0 && lines[i].trim().startsWith('# ')) {
                        lines[i] = `# ${title}`
                        return lines.join('\n')
                      }
                      return `# ${title}\n\n${md}`
                    })
                  }}
                  onToast={setToast}
                />
              )
            )
          ) : (
            <div className="selectable flex flex-1 items-center justify-center text-sm text-ink-dim">
              打开或新建一个图文工程开始创作
            </div>
          )}
        </main>

        {/* 右栏：AI 副驾驶（对话 / 脑暴创作 / 审阅，三面板互相独立） */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-panel-3 bg-panel-2">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-panel-3 px-3 text-xs">
            <button
              onClick={() => setRightTab('chat')}
              className={`rounded px-2 py-0.5 ${rightTab === 'chat' ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`}
            >
              对话
            </button>
            <button
              onClick={() => setRightTab('create')}
              className={`rounded px-2 py-0.5 ${rightTab === 'create' ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`}
            >
              脑暴创作
            </button>
            <button
              onClick={() => setRightTab('review')}
              disabled={!current}
              className={`rounded px-2 py-0.5 ${rightTab === 'review' ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'} disabled:opacity-40`}
            >
              审阅
            </button>
            {/* Skill 挂载：注入系统提示 */}
            <select
              value={skillName}
              onChange={(e) => mountSkill(e.target.value)}
              title={skills.find((s) => s.name === skillName)?.description ?? '挂载写作风格 Skill'}
              className="ml-auto max-w-[120px] rounded bg-panel-3 px-1.5 py-0.5 text-ink-dim outline-none"
            >
              <option value="">无 Skill</option>
              {skills
                .filter((s) => s.enabled || s.name === skillName)
                .map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          {/* 三面板常驻挂载（隐藏不卸载，保住各自流式中的状态，互不影响） */}
          <div className={`min-h-0 flex-1 flex-col ${rightTab === 'chat' ? 'flex' : 'hidden'}`}>
            <ChatPanel
              project={current}
              article={article}
              format={meta?.format ?? null}
              skill={skillContent}
              onToast={setToast}
              onSkillsChanged={refreshSkills}
              onApplyAccent={async (color) => {
                // 贴图面板只在中栏「正文」页签挂载：先切过去，等 ref 就绪再应用
                setCenterTab('article')
                for (let t = 0; t < 20 && !cardsRef.current; t++) {
                  await new Promise((r) => setTimeout(r, 50))
                }
                if (!cardsRef.current) throw new Error('贴图面板未就绪，请切到贴图页再试')
                await cardsRef.current.setAccent(color)
              }}
              onApplyArticleAccent={handleApplyArticleAccent}
              onApplyArticle={(md) => {
                // 对话修改稿写回唯一事实源，切到正文页给作者看结果（自动保存/撤销照常接管）
                setCenterTab('article')
                setArticle(md)
              }}
              onGoBrainstorm={() => setRightTab('create')}
              onGoReview={() => setRightTab('review')}
            />
          </div>
          <div className={`min-h-0 flex-1 flex-col ${rightTab === 'create' ? 'flex' : 'hidden'}`}>
            <BrainstormPanel
              project={current}
              article={article}
              skill={skillContent}
              seed={brainstormSeed}
              onArticleGenerated={handleArticleGenerated}
              onOpenProject={openProject}
              onProjectsChanged={refreshProjects}
              onGoReview={handleFullReview}
              onGoTitles={() => setCenterTab('titlecover')}
              onIdeasChanged={() => setIdeasVersion((v) => v + 1)}
              onToast={setToast}
            />
          </div>
          {current && (
            <div className={`min-h-0 flex-1 flex-col ${rightTab === 'review' ? 'flex' : 'hidden'}`}>
              {meta?.format === 'cards' ? (
                <CardsReviewPanel
                  project={current}
                  skill={skillContent}
                  onFlush={async () => {
                    await cardsRef.current?.flush()
                  }}
                  onOptimize={(review) => {
                    setCenterTab('article')
                    void cardsRef.current?.refine(review)
                  }}
                  onLocate={(i) => {
                    setCenterTab('article')
                    cardsRef.current?.scrollToCard(i)
                  }}
                  onToast={setToast}
                />
              ) : (
                <ReviewPanel
                  project={current}
                  article={article}
                  skill={skillContent}
                  runRequest={reviewRequest}
                  selection={reviewSelection}
                  onLocate={handleLocate}
                  onOptimize={(review) => setPolish({ review })}
                  onToast={setToast}
                />
              )}
            </div>
          )}
        </aside>
      </div>

      {/* 外部修改冲突弹窗 */}
      {conflict && (
        <ConflictDialog
          file={conflict.file}
          local={article}
          external={conflict.external}
          onKeepLocal={resolveKeepLocal}
          onAcceptExternal={resolveAcceptExternal}
        />
      )}

      {/* AI 修改弹窗 */}
      {modifySel && (
        <ModifyDialog
          selection={modifySel.text}
          skill={skillContent}
          onConfirm={(result) => {
            editorRef.current?.replaceRange(modifySel.from, modifySel.to, result)
            setModifySel(null)
            setToast('修改已应用')
          }}
          onClose={() => setModifySel(null)}
        />
      )}

      {/* 全文优化弹窗（排版优化 / 按审阅报告修订） */}
      {polish && current && (
        <PolishDialog
          article={article}
          skill={skillContent}
          review={polish.review}
          onConfirm={(result) => {
            setArticle(result)
            setPolish(null)
            setToast(polish.review ? '审阅修订已应用' : '新排版已应用')
          }}
          onClose={() => setPolish(null)}
        />
      )}

      {/* 模型接入设置 */}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

      {/* 设置（接入 / Skill / 推送） */}
      {showIntegration && (
        <IntegrationDialog
          onToast={setToast}
          onSkillsChanged={refreshSkills}
          onClose={() => setShowIntegration(false)}
        />
      )}

      {/* 三配图管线弹窗（M6） */}
      {figRequest && current && paths && (
        <FigureDialog
          project={current}
          projectDir={currentDir}
          article={article}
          request={figRequest}
          skill={skillContent}
          onClose={() => setFigRequest(null)}
        />
      )}

      {/* 导出弹窗（M7） */}
      {showExport && current && paths && (
        <ExportDialog
          project={current}
          projectDir={currentDir}
          markdown={article}
          theme={articleTheme}
          onToast={setToast}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* 导入排版弹窗（复用公众号/网页排版） */}
      {showThemeImport && (
        <ThemeImportDialog
          onClose={() => setShowThemeImport(false)}
          onToast={setToast}
          onSaved={async (name) => {
            setCustomThemes(await window.api.invoke('customTheme:list'))
            refreshProjects()
            setFilterCat(name)
          }}
        />
      )}

      {/* 轻提示 */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded bg-panel-3 px-4 py-2 text-xs text-ink shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
