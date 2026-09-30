import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { confirmAction } from './confirm'
import type { AppPaths, ArticleTheme, IdeaCard, ProjectData, ProjectMeta, ProjectSummary, SkillInfo, UpdateCheckResult } from '@shared/types'
import { PROJECT_CATEGORIES, UNCATEGORIZED } from '@shared/categories'
import { resolveArticleTheme, sanitizeThemePatch, type ThemeOverrideKey } from '@shared/categoryThemes'
import { CARD_FORMAT_LABEL, parseCardItems, type CardFormat } from '@shared/cards'
import { chatOnce } from './copilot/llm'
import { cardsMessages, categoryMessages } from './copilot/prompts'
import { replaceFigSuggestion, type FigureOccurrence, type WizardStepId } from '@shared/wizardProgress'
import ConflictDialog from './components/ConflictDialog'
import SettingsDialog from './components/SettingsDialog'
import IntegrationDialog from './components/IntegrationDialog'
import ChatPanel from './components/ChatPanel'
import CreationWizard, { type BrainstormSeed } from './components/wizard/CreationWizard'
import ModifyDialog from './components/ModifyDialog'
import PolishDialog from './components/PolishDialog'
import FigureDialog, { type FigureRequest } from './components/FigureDialog'
import ExportPanel from './components/wizard/ExportPanel'
import ThemeImportDialog from './components/ThemeImportDialog'
import CategoryManageDialog from './components/CategoryManageDialog'
import UpdateDialog from './components/UpdateDialog'
import ReviewPanel from './components/ReviewPanel'
import CardsReviewPanel from './components/CardsReviewPanel'
import TitleCoverPanel from './components/TitleCoverPanel'
import CardsPanel, { type CardsPanelHandle } from './components/CardsPanel'
import CalendarBoard from './components/CalendarBoard'
import IdeaBoard from './components/IdeaBoard'
import Sidebar from './components/Sidebar'
import ArticleEditor, { type ArticleEditorHandle, type EditorSelection } from './editor/ArticleEditor'
import type { FigPipeline } from './editor/FigSuggest'
import { shouldAutoStart, startTour } from './components/onboardingTour'

/** 三栏工作台：左 项目/选题库，中 编辑器/标题封面，右 对话/脑暴/审阅（互相独立不串扰） */
export default function App(): JSX.Element {
  const [paths, setPaths] = useState<AppPaths | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  const [article, setArticle] = useState('')
  const [saved, setSaved] = useState('')
  const [conflict, setConflict] = useState<{ file: string; external: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  // M8 接入 / Skill 管理弹窗
  const [showIntegration, setShowIntegration] = useState(false)
  // 版本更新：updateResult 非空 = 弹窗；updateCurrent 拿来在按钮 title 里展示当前版本号
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateCurrent, setUpdateCurrent] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  // 外观：主题（跟随系统/日间/夜间，默认跟随系统）+ 界面字号（小/中/大），本地持久化
  const [themeMode, setThemeModeState] = useState<'system' | 'light' | 'dark'>(() => {
    const v = localStorage.getItem('ui-theme-mode') ?? localStorage.getItem('ui-theme')
    return v === 'light' ? 'light' : v === 'dark' ? 'dark' : 'system'
  })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  const theme: 'dark' | 'light' = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode
  // 套用主题类：跟随系统时系统切换深浅即实时换肤
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])
  const setThemeMode = useCallback((m: 'system' | 'light' | 'dark') => {
    setThemeModeState(m)
    localStorage.setItem('ui-theme-mode', m)
  }, [])
  // 界面字号：整页缩放（webFrame zoomFactor，preload 首帧前先套用避免闪烁）；出厂默认中号
  const [uiScale, setUiScale] = useState<'s' | 'm' | 'l'>(() => {
    const v = localStorage.getItem('ui-scale')
    return v === 's' || v === 'l' ? v : 'm'
  })
  useEffect(() => {
    const factor = uiScale === 'm' ? 1.1 : uiScale === 'l' ? 1.2 : 1
    localStorage.setItem('ui-scale', uiScale)
    localStorage.setItem('ui-zoom', String(factor))
    // 延迟到窗口显示后再套缩放：隐藏页面上提前改缩放因子会卡住 ready-to-show，窗口出不来
    const t = setTimeout(() => window.api.setZoomFactor(factor), 300)
    return () => clearTimeout(t)
  }, [uiScale])
  const [showAppearance, setShowAppearance] = useState(false)
  // 新手引导：首启自动弹出（localStorage 记忆），顶栏「帮助」可随时重看
  const tourHandlers = useMemo(
    () => ({ openSettings: () => setShowSettings(true), openIntegration: () => setShowIntegration(true) }),
    []
  )
  useEffect(() => {
    if (shouldAutoStart()) startTour(tourHandlers)
  }, [tourHandlers])
  // M5 副驾驶；中栏 = 创作向导（主工作面）+ 两个跨工程页签
  const [centerTab, setCenterTab] = useState<'create' | 'calendar' | 'ideas'>('create')
  // 向导深链跳步（工作树/对话/审阅定位等）：ts 变化即生效（仿 reviewRequest 模式）
  const [stepRequest, setStepRequest] = useState<{ id: WizardStepId; ts: number } | null>(null)
  // 分栏：拖拽调宽 + 可折叠，偏好本地记忆
  const [leftW, setLeftW] = useState(() => {
    const v = Number(localStorage.getItem('lig-pane-left-w'))
    return Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, 180), 420) : 240
  })
  const [rightW, setRightW] = useState(() => {
    const v = Number(localStorage.getItem('lig-pane-right-w'))
    return Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, 260), 640) : 320
  })
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem('lig-pane-left-collapsed') === '1')
  const [rightCollapsed, setRightCollapsed] = useState(() => localStorage.getItem('lig-pane-right-collapsed') === '1')
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
  // 文章转贴图：展开风格选择 / 转换进行中
  const [showConvert, setShowConvert] = useState(false)
  const [converting, setConverting] = useState(false)
  // 工程内存有卡片数据：文章形态下显示「回到贴图」回退入口
  const [hasCards, setHasCards] = useState(false)
  // 脑暴入库后自增，驱动选题库自动刷新
  const [ideasVersion, setIdeasVersion] = useState(0)
  // 审阅报告写入后自增：驱动 review.md / cards-review.md 存在性重查（向导审阅步完成判定）
  const [reviewVersion, setReviewVersion] = useState(0)
  const [reviewExists, setReviewExists] = useState(false)
  // 项目分类：选中分类（工作树上点分类节点设置；脑暴立项/新建工程落此分类，'all' = 未指定）
  const [filterCat, setFilterCat] = useState<string>('all')
  const [categorizing, setCategorizing] = useState(false)
  const [categories, setCategories] = useState<string[]>(() => [...PROJECT_CATEGORIES, UNCATEGORIZED])
  // 自定义排版主题库（settings/customThemes.json）：分类调性打底时的最高优先覆盖
  const [customThemes, setCustomThemes] = useState<Record<string, ArticleTheme>>({})
  // 导入排版弹窗（粘贴 HTML / 公众号链接复用排版）
  const [showThemeImport, setShowThemeImport] = useState(false)
  // 分类管理弹窗 + 已删除（隐藏）分类列表
  const [showCatManage, setShowCatManage] = useState(false)
  /** 分类管理弹窗变更后要在左栏树展开的分类（at 作触发键，同名连续操作也能再触发一次） */
  const [revealCat, setRevealCat] = useState<{ name: string; at: number } | null>(null)
  const [hiddenCats, setHiddenCats] = useState<string[]>([])
  // 设置弹窗初始页签（左栏 Skill 库「导入」直达 skill 页）
  const [integrationTab, setIntegrationTab] = useState<'mcp' | 'skill' | 'push'>('mcp')
  // 分类→公众号账号绑定徽标：分类管理/推送设置变更后 bump 重拉
  const [bindingsVersion, setBindingsVersion] = useState(0)
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
    window.api.invoke('project:listHiddenCategories').then(setHiddenCats)
  }, [])

  const refreshMeta = useCallback(async () => {
    const name = currentRef.current
    if (!name) return
    setMeta(await window.api.invoke('project:readMeta', name))
  }, [])

  /** 分类管理变更后的统一刷新：分类/隐藏列表/工程/主题全量重拉，失效的筛选回落「全部」；绑定徽标同步重拉 */
  const refreshAfterCategoryChange = useCallback((reveal?: string) => {
    // 重命名/恢复分类后让左栏树展开该分类（折叠态下用户会以为工程消失了）
    if (reveal) setRevealCat({ name: reveal, at: Date.now() })
    setBindingsVersion((v) => v + 1)
    void window.api.invoke('project:listCategories').then((cats) => {
      setCategories(cats)
      setFilterCat((f) => (f === 'all' || cats.includes(f) ? f : 'all'))
    })
    void window.api.invoke('project:listHiddenCategories').then(setHiddenCats)
    window.api.invoke('project:list').then(setProjects)
    window.api.invoke('customTheme:list').then(setCustomThemes)
    void refreshMeta()
  }, [refreshMeta])

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
      setCenterTab('create')
      // 不切向导步骤：脑暴立项后向导自己停在成文步看流式
      await mountSkill(data.meta.style_skill ?? '', false)
    },
    [mountSkill]
  )

  /** 新建工程（左栏工作树行内/底部输入调用）。主进程会清洗工程名（如去结尾点），
   *  打开时用返回的最终名；分类由树上的落点决定（未指定 = 未分类） */
  const createProjectNamed = useCallback(
    async (name: string, category?: string) => {
      if (!name.trim()) return
      try {
        const created = await window.api.invoke('project:create', name, category)
        refreshProjects()
        await openProject(created.name)
      } catch (err) {
        setToast(String(err instanceof Error ? err.message : err))
      }
    },
    [openProject, refreshProjects]
  )

  /** 批量删除（工作树批量管理）：一次确认，逐个移除；单个失败不阻塞其余 */
  const deleteProjects = useCallback(
    async (names: string[]) => {
      if (names.length === 0) return
      if (!(await confirmAction(`删除选中的 ${names.length} 个工程？\n整个文件夹（正文/素材/会话）将被移除，不可恢复。`, { okLabel: '删除' }))) return
      let ok = 0
      for (const name of names) {
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
          ok++
        } catch {
          // 单个失败继续删其余，最后汇总提示
        }
      }
      refreshProjects()
      setToast(ok === names.length ? `已删除 ${ok} 个工程` : `已删除 ${ok}/${names.length} 个（其余删除失败）`)
    },
    [refreshProjects]
  )

  /** 删除工程（确认后整目录移除；删当前工程先关闭） */
  const deleteProject = useCallback(
    async (name: string) => {
      if (!(await confirmAction(`删除工程「${name}」？\n整个文件夹（正文/素材/会话）将被移除，不可恢复。`, { okLabel: '删除' }))) return
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

  /** 重命名工程：目录原地改名 + meta 同步（主进程完成）。本地文件联动：
   *  当前工程有未保存正文时先冲刷到旧目录再改名，改名后 current/meta/列表全部
   *  切到新名接管，自动保存与监听（watcher）随 IPC 内部停挂重挂，不丢不串。
   *  返回是否成功：失败时左栏行内输入保持展开供修正 */
  const renameProject = useCallback(
    async (oldName: string, raw: string): Promise<boolean> => {
      const trimmed = raw.trim()
      if (!trimmed) return false
      try {
        if (currentRef.current === oldName && articleRef.current !== savedRef.current) {
          await window.api.invoke('project:writeFile', oldName, 'article.md', articleRef.current)
          setSaved(articleRef.current)
        }
        const m = await window.api.invoke('project:rename', oldName, trimmed)
        if (currentRef.current === oldName) {
          setCurrent(m.name)
          currentRef.current = m.name
          setMeta(m)
        }
        // 乐观更新列表（目录末段即工程名），随后以主进程扫描结果校准
        setProjects((prev) =>
          prev.map((p) => (p.name === oldName ? { ...p, name: m.name, dir: p.dir.replace(/[^\\\/]+$/, m.name) } : p))
        )
        refreshProjects()
        setToast(`工程已重命名：「${oldName}」→「${m.name}」，本地文件夹已同步改名`)
        return true
      } catch (err) {
        setToast(`重命名失败：${err instanceof Error ? err.message : err}`)
        return false
      }
    },
    [refreshProjects]
  )

  // ---- 项目分类：手动切换 + AI 推荐；文件夹随分类迁移 workspace/<分类>/<工程名>/ ----

  const applyCategory = useCallback(
    async (name: string, category: string) => {
      try {
        const m = await window.api.invoke('project:setCategory', name, category)
        if (currentRef.current === name) setMeta(m)
        refreshProjects()
        setToast(`「${name}」已归入「${category}」，文件夹已同步移动；排版调性与推送账号按新分类生效`)
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

  // ---- 版本更新检查：启动 8 秒后静默查一次（不打扰）；顶栏按钮手动查必有反馈 ----
  const checkUpdate = useCallback(async (manual: boolean) => {
    setCheckingUpdate(true)
    try {
      const result = await window.api.invoke('update:check')
      setUpdateCurrent(result.currentVersion)
      if (result.status === 'available' && result.latest) {
        // 静默检查对点过「忽略此版本」的不再打扰；手动检查始终弹窗
        if (manual || result.latest.version !== result.skippedVersion) setUpdateResult(result)
      } else if (manual) {
        setToast(
          result.status === 'up-to-date'
            ? `当前已是最新版本 v${result.currentVersion}`
            : (result.message ?? '检查更新失败，请稍后重试')
        )
      }
    } catch {
      if (manual) setToast('检查更新失败，请稍后重试')
    } finally {
      setCheckingUpdate(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void checkUpdate(false), 8000)
    return () => clearTimeout(t)
  }, [checkUpdate])

  const dismissUpdate = useCallback(async (version: string) => {
    await window.api.invoke('update:dismiss', version)
    setUpdateResult(null)
    setToast(`已忽略 v${version}，发布更新版本时会再提醒`)
  }, [])

  // ---- 拖拽/关联打开 .md：双击 md 文件或拖到应用图标，主进程经此转交路径 ----
  // 先注册监听再拉取积压：takePending 触发后主进程的二次实例改走推送，两段不能有空窗
  useEffect(() => {
    const openedRecently = new Map<string, number>()
    const openExternal = async (absPath: string): Promise<void> => {
      try {
        // 积压拉取与实时推送可能在启动瞬间交叠：同路径 5 秒内只打开一次，防外部 md 被导入成多份
        const key = absPath.toLowerCase()
        const now = Date.now()
        if (now - (openedRecently.get(key) ?? 0) < 5000) return
        openedRecently.set(key, now)
        // 切走前先冲刷当前工程的未保存正文，避免丢稿（与导出前冲刷同一模式）
        const cur = currentRef.current
        if (cur && articleRef.current !== savedRef.current) {
          await window.api.invoke('project:writeFile', cur, 'article.md', articleRef.current)
          setSaved(articleRef.current)
        }
        const r = await window.api.invoke('md:openFile', absPath)
        if (r.kind === 'import') {
          // 新工程先落进左栏列表（currentDir 由列表派生），再打开
          setProjects(await window.api.invoke('project:list'))
          setToast(`已导入为工程「${r.name}」`)
        }
        await openProject(r.name)
      } catch (err) {
        setToast(`打开失败：${err instanceof Error ? err.message : err}`)
      }
    }
    const off = window.api.on('md:open-request', ({ absPath }) => void openExternal(absPath))
    void window.api
      .invoke('md:takePending')
      .then((paths) => paths.reduce((chain, p) => chain.then(() => openExternal(p)), Promise.resolve()))
    return off
  }, [openProject])

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
    setCenterTab('create')
    setStepRequest({ id: 'review', ts: Date.now() })
    setReviewRequest((n) => n + 1)
  }, [])

  /** 全文生成流式落编辑器（唯一事实源是 md 字符串，直接覆盖；向导自己停在成文步） */
  const handleArticleGenerated = useCallback((md: string) => {
    setArticle(md)
  }, [])

  /** 选题库「生成大纲」→ 送入创作向导大纲流程 */
  const handleMakeOutline = useCallback((card: IdeaCard) => {
    setBrainstormSeed({ card, ts: Date.now() })
    setCenterTab('create')
  }, [])

  /** 左栏工作树深链：打开工程并落到向导对应步；已是当前工程只跳步（不重载丢未保存稿） */
  const openProjectView = useCallback(
    async (name: string, tab: 'article' | 'titlecover') => {
      if (currentRef.current !== name) await openProject(name)
      setCenterTab('create')
      setStepRequest({ id: tab === 'article' ? 'draft' : 'titlecover', ts: Date.now() })
    },
    [openProject]
  )

  /** 审阅引用行 → 向导切成文步并定位（编辑器常驻挂载，兜底轮询等挂载完成再滚） */
  const handleLocate = useCallback((snippet: string): boolean => {
    setCenterTab('create')
    setStepRequest({ id: 'draft', ts: Date.now() })
    void (async () => {
      for (let t = 0; t < 20 && !editorRef.current; t++) {
        await new Promise((r) => setTimeout(r, 50))
      }
      editorRef.current?.scrollToText(snippet)
    })()
    return true
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

  /** 排版覆盖落 meta：30 键全量口径（与 set_theme / readMeta 同一白名单）。
   *  值先过 sanitizeThemePatch——未知键剔除、hex 校验、数值夹取、枚举守卫，非法值等同「不动」；
   *  null 是作者显式表态，删掉覆盖恢复主题默认；未出现的键一律不碰 */
  const handleApplyTypography = useCallback(
    async (patch: Partial<Record<ThemeOverrideKey, string | number | null>>) => {
      if (!currentRef.current) throw new Error('先打开工程')
      const m = await window.api.invoke('project:readMeta', currentRef.current)
      const bag = m as unknown as Record<string, unknown>
      const clean = sanitizeThemePatch(patch as Record<string, unknown>) as Record<string, unknown>
      for (const k of Object.keys(patch)) {
        if (patch[k as ThemeOverrideKey] === null) bag[k] = undefined
        else if (clean[k] !== undefined) bag[k] = clean[k]
      }
      await window.api.invoke('project:writeMeta', currentRef.current, m)
      setMeta(m)
    },
    []
  )

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

  // ---- 创作向导·配图步（清单/缩略图复用配图弹窗，成品做正文行替换） ----

  /** 清单「处理」：管线与描述交给配图弹窗（与编辑器占位卡同款，弹窗按管线锁面板），成品替换正文对应占位行 */
  const handleFigFromList = useCallback((pipeline: FigPipeline, desc: string, line: number) => {
    setFigRequest({
      pipeline,
      desc,
      onDone: (attrs) => {
        setFigRequest(null)
        if (!attrs) return
        setArticle((prev) => replaceFigSuggestion(prev, line, attrs))
        setToast('配图已插入正文')
      }
    })
  }, [])

  /** 缩略图「替换」：重开导入管线，成品替换正文对应图片行 */
  const handleFigReplaceImage = useCallback((img: FigureOccurrence) => {
    setFigRequest({
      pipeline: 'import',
      desc: img.caption || img.alt,
      onDone: (attrs) => {
        setFigRequest(null)
        if (!attrs) return
        setArticle((prev) => replaceFigSuggestion(prev, img.line, attrs))
        setToast('已替换配图')
      }
    })
  }, [])

  // ---- 导出（向导步 7 激活时先落盘） ----

  /** 把未保存正文落盘：导出/推送读的是磁盘 article.md */
  const flushArticle = useCallback(async () => {
    const name = currentRef.current
    if (!name || articleRef.current === savedRef.current) return
    await window.api.invoke('project:writeFile', name, 'article.md', articleRef.current)
    setSaved(articleRef.current)
  }, [])

  // ---- 分栏拖拽调宽 / 折叠 ----

  const startPaneDrag = useCallback(
    (which: 'left' | 'right') =>
      (e: ReactPointerEvent) => {
        e.preventDefault()
        const startX = e.clientX
        const startW = which === 'left' ? leftW : rightW
        const min = which === 'left' ? 180 : 260
        const max = which === 'left' ? 420 : 640
        let cur = startW
        const onMove = (ev: PointerEvent) => {
          cur = Math.min(Math.max(startW + (which === 'left' ? ev.clientX - startX : startX - ev.clientX), min), max)
          ;(which === 'left' ? setLeftW : setRightW)(cur)
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          localStorage.setItem(which === 'left' ? 'lig-pane-left-w' : 'lig-pane-right-w', String(cur))
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      },
    [leftW, rightW]
  )

  const toggleLeftCollapse = useCallback(() => {
    setLeftCollapsed((v) => {
      localStorage.setItem('lig-pane-left-collapsed', v ? '0' : '1')
      return !v
    })
  }, [])

  const toggleRightCollapse = useCallback(() => {
    setRightCollapsed((v) => {
      localStorage.setItem('lig-pane-right-collapsed', v ? '0' : '1')
      return !v
    })
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

  // 审阅报告存在性：向导「审阅」步完成判定的事实源（写入成功/外部变更后重查）
  useEffect(() => {
    if (!current) {
      setReviewExists(false)
      return
    }
    const file = meta?.format === 'cards' ? 'cards-review.md' : 'review.md'
    let alive = true
    window.api
      .invoke('project:readFile', current, file)
      .then((md) => {
        if (alive) setReviewExists(Boolean(md.trim()))
      })
      .catch(() => {
        if (alive) setReviewExists(false)
      })
    return () => {
      alive = false
    }
  }, [current, reviewVersion, meta?.format])

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
        <span className="text-sm font-bold">立格编辑器</span>
        <span className="text-xs text-ink-dim">@LIG人生如戏的图文创作平台公测版</span>
        <div data-tour="topbar-actions" className="ml-auto flex items-center gap-2 text-xs text-ink-dim">
          <div className="relative">
            <button
              onClick={() => setShowAppearance((v) => !v)}
              title="外观：主题（跟随系统/日间/夜间）与界面字号"
              className="rounded px-2 py-1 hover:bg-panel-3"
            >
              🎨 外观
            </button>
            {showAppearance && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowAppearance(false)} />
                <div className="no-drag absolute right-0 top-full z-50 mt-1 w-48 rounded border border-panel-3 bg-panel-2 p-2 shadow-lg">
                  <p className="mb-1 text-[10px] text-ink-dim">主题</p>
                  <div className="mb-2 flex overflow-hidden rounded border border-panel-3 text-[11px]">
                    {([['system', '跟随系统'], ['light', '☀ 日间'], ['dark', '☾ 夜间']] as const).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => setThemeMode(v)}
                        className={`flex-1 whitespace-nowrap px-1 py-1 ${themeMode === v ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-3'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mb-1 text-[10px] text-ink-dim">界面字号</p>
                  <div className="flex overflow-hidden rounded border border-panel-3 text-[11px]">
                    {([['s', '小'], ['m', '中'], ['l', '大']] as const).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => setUiScale(v)}
                        className={`flex-1 px-1 py-1 ${uiScale === v ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-3'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setShowSettings(true)} className="rounded px-2 py-1 hover:bg-panel-3">
            模型接入
          </button>
          <button onClick={() => setShowIntegration(true)} className="rounded px-2 py-1 hover:bg-panel-3">
            设置
          </button>
          <button
            onClick={() => startTour(tourHandlers)}
            title="重新播放新手引导"
            className="rounded px-2 py-1 hover:bg-panel-3"
          >
            ❓ 帮助
          </button>
          <button
            onClick={() => void checkUpdate(true)}
            disabled={checkingUpdate}
            title={updateCurrent ? `检查更新（当前版本 v${updateCurrent}）` : '检查更新：有新版本时给出网盘/GitHub 下载入口'}
            className="rounded px-2 py-1 hover:bg-panel-3 disabled:opacity-50"
          >
            {checkingUpdate ? '检查中…' : '🔄 版本更新'}
          </button>
          <button
            onClick={() => window.open('https://ligdesign.win/')}
            title="LIG 立格 Studio 品牌官网：设计 · 工具 · 桌面美学"
            className="rounded px-2 py-1 hover:bg-panel-3"
          >
            🌐 官网
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
        {/* 左栏（分栏可折叠：宽度由 App 持有，收起时 w-0 隐藏不卸载，工作树状态不丢） */}
        <div
          className={`flex min-h-0 shrink-0 overflow-hidden ${leftCollapsed ? 'w-0' : ''}`}
          style={leftCollapsed ? undefined : { width: leftW }}
        >
        <Sidebar
          width={leftW}
          paths={paths}
          projects={projects}
          categories={categories}
          skills={skills}
          ideasVersion={ideasVersion}
          current={current}
          filterCat={filterCat}
          categorizing={categorizing}
          bindingsVersion={bindingsVersion}
          onOpenProject={(name) => void openProject(name)}
          onOpenProjectView={(name, tab) => void openProjectView(name, tab)}
          onCreateProject={createProjectNamed}
          onRenameProject={renameProject}
          onDeleteProject={(name) => void deleteProject(name)}
          onDeleteProjects={(names) => void deleteProjects(names)}
          onApplyCategory={(name, category) => void applyCategory(name, category)}
          onAiCategorize={() => void aiCategorize()}
          onSkillsChanged={refreshSkills}
          revealCategory={revealCat}
          onOpenCatManage={() => setShowCatManage(true)}
          onOpenIntegration={(tab) => {
            setIntegrationTab(tab)
            setShowIntegration(true)
          }}
          onSetFilterCat={setFilterCat}
          onMakeOutline={handleMakeOutline}
          onToast={setToast}
        />
        </div>

        {/* 分栏拖拽条（左）：拖拽调宽 / 双击或按钮收起左栏 */}
        <div
          onPointerDown={startPaneDrag('left')}
          onDoubleClick={toggleLeftCollapse}
          title="拖拽调宽 · 双击收起左栏"
          className="group/rs relative w-px shrink-0 cursor-col-resize bg-panel-3 transition-colors hover:bg-accent"
        >
          <span className="absolute inset-y-0 -left-1 -right-1" />
          <button
            onClick={toggleLeftCollapse}
            title={leftCollapsed ? '展开左栏' : '收起左栏'}
            className="absolute left-1/2 top-8 -translate-x-1/2 rounded bg-panel-3 px-1 py-1 text-[10px] text-ink-dim hover:text-ink"
          >
            {leftCollapsed ? '❯' : '❮'}
          </button>
        </div>

        {/* 中栏：创作向导（主工作面）/ 选题看板 / 日历 */}
        <main className="flex min-w-0 flex-1 flex-col bg-panel">
          <div data-tour="center-toolbar" className="flex h-9 shrink-0 items-center gap-2 border-b border-panel-3 px-4 text-xs text-ink-dim">
            <button
              onClick={() => setCenterTab('create')}
              title="创作向导：选题 → 大纲 → 成文 → 配图 → 标题封面 → 审阅 → 导出"
              className={`rounded px-2 py-0.5 ${centerTab === 'create' ? 'bg-panel-3 text-ink' : 'hover:bg-panel-3'}`}
            >
              🧭 创作
            </button>
            <button
              onClick={() => setCenterTab('ideas')}
              title="选题流转看板：待立项 / 已立项 / 已排期 / 已成稿，状态由对应工程推导"
              className={`rounded px-2 py-0.5 ${centerTab === 'ideas' ? 'bg-panel-3 text-ink' : 'hover:bg-panel-3'}`}
            >
              💡 选题看板
            </button>
            <button
              onClick={() => setCenterTab('calendar')}
              title="跨工程发布排期看板：拖拽工程卡片到日期即排期"
              className={`rounded px-2 py-0.5 ${centerTab === 'calendar' ? 'bg-panel-3 text-ink' : 'hover:bg-panel-3'}`}
            >
              📅 日历
            </button>
          </div>
          {centerTab === 'calendar' ? (
            <CalendarBoard
              projects={projects}
              categories={categories}
              current={current}
              onOpen={(name) => void openProject(name)}
              onSchedule={async (name, date) => {
                await window.api.invoke('project:setSchedule', name, date)
                refreshProjects()
                if (name === current) void refreshMeta()
              }}
              ideasVersion={ideasVersion}
              onIdeasChanged={() => setIdeasVersion((v) => v + 1)}
              onMakeOutline={handleMakeOutline}
              onScheduleIdea={async (index, date, category) =>
                window.api.invoke('ideas:schedule', index, date, category)
              }
              onToast={setToast}
            />
          ) : centerTab === 'ideas' ? (
            <IdeaBoard
              version={ideasVersion}
              projects={projects}
              onOpen={(name) => void openProject(name)}
              onMakeOutline={handleMakeOutline}
              onGoSchedule={() => setCenterTab('calendar')}
              onToast={setToast}
            />
          ) : null}
          {/* 向导常驻挂载（hidden 保活）：流式/编辑器/贴图渲染状态切页签不丢——沿用原右栏三面板模式 */}
          <div className={`min-h-0 flex-1 flex-col ${centerTab === 'create' ? 'flex' : 'hidden'}`}>
            <CreationWizard
              project={current}
              meta={meta}
              article={article}
              skill={skillContent}
              category={filterCat === 'all' ? undefined : filterCat}
              seed={brainstormSeed}
              hasCards={hasCards}
              reviewExists={reviewExists}
              stepRequest={stepRequest}
              projectDir={currentDir}
              headerRight={
                current ? (
                  <>
                    {wordCount > 0 && <span className="mr-2 text-ink-dim">{wordCount} 字</span>}
                    <span className={dirty ? 'text-amber-400' : 'text-green-500'}>
                      {dirty ? '● 未保存' : '✓ 已保存'}
                    </span>
                  </>
                ) : (
                  <span className="text-ink-dim">未打开工程</span>
                )
              }
              draftBody={
                current ? (
                  meta?.format === 'cards' ? (
                    <>
                      {cardsInfo && (
                        <div className="shrink-0 border-b border-panel-3 px-4 py-1.5 text-xs text-ink-dim">
                          {CARD_FORMAT_LABEL[cardsInfo.format]} · {cardsInfo.count} 张 · 1242×1656
                        </div>
                      )}
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
                    </>
                  ) : (
                    <>
                      {/* 步内工具条：排版优化/排版导入/转贴图（导出在步 7，不设重复入口） */}
                      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-panel-3 px-4 py-1.5 text-xs text-ink-dim">
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
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto">
                        <ArticleEditor
                          key={current}
                          ref={editorRef}
                          project={current}
                          markdown={article}
                          projectDir={currentDir}
                          accent={articleTheme.accent}
                          theme={articleTheme}
                          typography={meta ?? undefined}
                          uiDark={theme === 'dark'}
                          onChange={setArticle}
                          onAiModify={handleAiModify}
                          onAiReview={handleAiReview}
                          onFigAction={handleFigAction}
                          onEditFigureSource={handleEditFigureSource}
                          onAccentChange={handleApplyArticleAccent}
                          onTypographyChange={handleApplyTypography}
                        />
                      </div>
                    </>
                  )
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-ink-dim">立项或打开工程后解锁此步</div>
                )
              }
              titlecoverBody={
                current && meta ? (
                  <TitleCoverPanel
                    key={current}
                    project={current}
                    meta={meta}
                    article={article}
                    skill={skillContent}
                    projectDir={currentDir}
                    theme={articleTheme}
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
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-ink-dim">立项或打开工程后解锁此步</div>
                )
              }
              reviewBody={
                current ? (
                  meta?.format === 'cards' ? (
                    <CardsReviewPanel
                      project={current}
                      skill={skillContent}
                      onFlush={async () => {
                        await cardsRef.current?.flush()
                      }}
                      onOptimize={(review) => {
                        setStepRequest({ id: 'draft', ts: Date.now() })
                        void cardsRef.current?.refine(review)
                      }}
                      onLocate={(i) => {
                        setStepRequest({ id: 'draft', ts: Date.now() })
                        cardsRef.current?.scrollToCard(i)
                      }}
                      onReviewSaved={() => setReviewVersion((v) => v + 1)}
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
                      onReviewSaved={() => setReviewVersion((v) => v + 1)}
                      onToast={setToast}
                    />
                  )
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-ink-dim">立项或打开工程后解锁此步</div>
                )
              }
              exportBody={
                current && currentDir ? (
                  <ExportPanel
                    project={current}
                    projectDir={currentDir}
                    markdown={article}
                    theme={articleTheme}
                    category={meta?.category}
                    onExported={() => void refreshMeta()}
                    onToast={setToast}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-ink-dim">立项或打开工程后解锁此步</div>
                )
              }
              onFlushArticle={flushArticle}
              onArticleGenerated={handleArticleGenerated}
              onOpenProject={openProject}
              onProjectsChanged={refreshProjects}
              onIdeasChanged={() => setIdeasVersion((v) => v + 1)}
              onFigFromList={handleFigFromList}
              onFigReplaceImage={handleFigReplaceImage}
              onLocateInEditor={handleLocate}
              onToast={setToast}
            />
          </div>
        </main>

        {/* 分栏拖拽条（右）：拖拽调宽 / 双击或按钮收起右栏 */}
        <div
          onPointerDown={startPaneDrag('right')}
          onDoubleClick={toggleRightCollapse}
          title="拖拽调宽 · 双击收起右栏"
          className="group/rs relative w-px shrink-0 cursor-col-resize bg-panel-3 transition-colors hover:bg-accent"
        >
          <span className="absolute inset-y-0 -left-1 -right-1" />
          <button
            onClick={toggleRightCollapse}
            title={rightCollapsed ? '展开右栏' : '收起右栏'}
            className="absolute left-1/2 top-8 -translate-x-1/2 rounded bg-panel-3 px-1 py-1 text-[10px] text-ink-dim hover:text-ink"
          >
            {rightCollapsed ? '❮' : '❯'}
          </button>
        </div>

        {/* 右栏（分栏可折叠：收起时 w-0 隐藏不卸载，对话流式状态不丢） */}
        <div
          className={`flex min-h-0 shrink-0 overflow-hidden ${rightCollapsed ? 'w-0' : ''}`}
          style={rightCollapsed ? undefined : { width: rightW }}
        >
        {/* 右栏：AI 对话副驾驶（脑暴/审阅已并入中栏创作向导） */}
        <aside className="flex min-h-0 w-full min-w-0 flex-col border-l border-panel-3 bg-panel-2">
          <div data-tour="right-tabs" className="flex h-9 shrink-0 items-center gap-1 border-b border-panel-3 px-3 text-xs">
            <span className="text-ink">对话</span>
            {/* Skill 挂载：注入系统提示（作用范围=对话；向导各步按任务类型自动推荐挂载） */}
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
          {/* 常驻挂载保住流式状态 */}
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatPanel
              project={current}
              article={article}
              format={meta?.format ?? null}
              skill={skillContent}
              onToast={setToast}
              onSkillsChanged={refreshSkills}
              onCustomThemesChanged={() => {
                void window.api.invoke('customTheme:list').then(setCustomThemes)
              }}
              onApplyAccent={async (color) => {
                // 贴图面板在向导贴图步常驻挂载：等 ref 就绪再应用
                setCenterTab('create')
                for (let t = 0; t < 20 && !cardsRef.current; t++) {
                  await new Promise((r) => setTimeout(r, 50))
                }
                if (!cardsRef.current) throw new Error('贴图面板未就绪，请切到贴图步再试')
                await cardsRef.current.setAccent(color)
              }}
              onApplyArticleAccent={handleApplyArticleAccent}
              onApplyArticle={(md) => {
                // 对话修改稿写回唯一事实源，跳到向导成文步给作者看结果（自动保存/撤销照常接管）
                setCenterTab('create')
                setStepRequest({ id: 'draft', ts: Date.now() })
                setArticle(md)
              }}
              onGoBrainstorm={() => {
                setCenterTab('create')
                setStepRequest({ id: 'ideas', ts: Date.now() })
              }}
              onGoReview={() => {
                setCenterTab('create')
                setStepRequest({ id: 'review', ts: Date.now() })
              }}
            />
          </div>
        </aside>
        </div>
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
          theme={articleTheme}
          onConfirm={(result, themePatch) => {
            setArticle(result)
            setPolish(null)
            if (!themePatch) {
              setToast(polish.review ? '审阅修订已应用' : '新排版已应用')
              return
            }
            // 打包应用：正文进编辑器（唯一事实源，自动保存接管），视觉参数落 meta 后调性即时重算
            void handleApplyTypography(themePatch).then(
              () => setToast('新排版与视觉参数已应用'),
              (err) => setToast(`排版已应用，视觉参数失败：${err instanceof Error ? err.message : err}`)
            )
          }}
          onClose={() => setPolish(null)}
        />
      )}

      {/* 模型接入设置 */}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

      {/* 版本更新弹窗（启动静默检查 / 顶栏手动检查共用） */}
      {updateResult && (
        <UpdateDialog
          result={updateResult}
          onDismiss={(v) => void dismissUpdate(v)}
          onClose={() => setUpdateResult(null)}
        />
      )}

      {/* 设置（接入 / Skill / 推送）：initialTab 供左栏 Skill 库「导入」直达 */}
      {showIntegration && (
        <IntegrationDialog
          initialTab={integrationTab}
          onToast={setToast}
          onSkillsChanged={refreshSkills}
          onClose={() => {
            setShowIntegration(false)
            // 推送页签可能改过账号/绑定：关弹窗统一刷新工作树的账号徽标
            setBindingsVersion((v) => v + 1)
          }}
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

      {/* 分类管理弹窗（删除/恢复/重命名） */}
      {showCatManage && (
        <CategoryManageDialog
          categories={categories}
          hidden={hiddenCats}
          skills={skills}
          onClose={() => setShowCatManage(false)}
          onToast={setToast}
          onChanged={refreshAfterCategoryChange}
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
