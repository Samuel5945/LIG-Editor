import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { confirmAction } from './confirm'
import type { AppPaths, ArticleTheme, CustomThemeLibrary, IdeaCard, ProjectData, ProjectMeta, ProjectSummary, SkillInfo, UpdateCheckResult } from '@shared/types'
import { PROJECT_CATEGORIES, UNCATEGORIZED } from '@shared/categories'
import { resolveArticleTheme, sanitizeThemePatch, activeThemesView, CATEGORY_THEMES, THEME_OVERRIDE_KEYS, type ThemeOverrideKey } from '@shared/categoryThemes'
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
import TypographyPanel from './components/TypographyPanel'
import type { ThemeOverrides } from '@shared/themeFields'
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
import ProjectWall from './components/ProjectWall'
import ThemeLibrary, { type ThemeEntry } from './components/ThemeLibrary'
import { Icon, type IconName } from './ui/Icon'
import { Popover, MenuItem, PopoverLabel, Segmented, StatusDot, useFittingRow } from './ui/primitives'
import ArticleEditor, { type ArticleEditorHandle, type EditorSelection } from './editor/ArticleEditor'
import type { FigPipeline } from './editor/FigSuggest'
import { shouldAutoStart, startTour } from './components/onboardingTour'

/** 中栏页签（诊断 8/11）：⌂ 项目库常驻入口 + 这四页 */
type CenterTab = 'create' | 'ideas' | 'calendar' | 'themes'

/**
 * 页签清单一处定义：`label` 是长名，`short` 只在条带放不下时使用（诊断 8 的「选题看板→看板」）。
 * title 保留完整说法——降级的是标签文字，不是信息。
 */
const CENTER_TABS: { id: CenterTab; icon: IconName; label: string; short?: string; title: string }[] = [
  { id: 'create', icon: 'compass', label: '创作', title: '创作向导：选题 → 大纲 → 成文 → 配图 → 标题封面 → 审阅 → 导出' },
  {
    id: 'ideas',
    icon: 'bulb',
    label: '选题看板',
    short: '看板',
    title: '选题流转看板：待立项 / 已立项 / 已排期 / 已成稿，状态由对应工程推导'
  },
  { id: 'calendar', icon: 'calendar', label: '日历', title: '跨工程发布排期看板：拖拽工程卡片到日期即排期' },
  { id: 'themes', icon: 'layers', label: '主题库', title: '主题库：内置 / 导入 / 面板沉淀的集中入口，可预览与绑定分类' }
]

/** 三栏工作台：左 项目/选题库，中 编辑器/标题封面，右 对话/脑暴/审阅（互相独立不串扰） */
export default function App(): JSX.Element {
  const [paths, setPaths] = useState<AppPaths | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  const [article, setArticle] = useState('')
  const [saved, setSaved] = useState('')
  /** 正文基线最近一次变化时刻（自动保存落盘 / 外部热载 / 切工程），底部状态栏显示用 */
  const [savedAt, setSavedAt] = useState(() => Date.now())
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
  const [centerTab, setCenterTab] = useState<CenterTab>('create')
  /** 主题库里的「预览」：只覆盖编辑器观感，不写盘、退出即还原（§5.6） */
  const [themePreview, setThemePreview] = useState<{ name: string; theme: ArticleTheme } | null>(null)
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
  /** 封面墙让位给创作向导的开关（无工程时默认显示封面墙，主 PRD §7.13） */
  const [wallOff, setWallOff] = useState(() => localStorage.getItem('lig-wall-off') === '1')
  /** ⌂ 常驻入口按下后把封面墙钉住（诊断 11：一进向导就再也回不去墙，等于开屏广告） */
  const [wallPinned, setWallPinned] = useState(false)
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
  // 「全量排版」面板（34 项控件）；面板本体在这里挂，编辑器工具条只给入口按钮
  const [showTypography, setShowTypography] = useState(false)
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
  // 自定义排版主题库（settings/customThemes.json v2）：主题独立命名，一个分类可挂多套，
  // 「分类当前套用哪套」由 active 指针决定。resolveArticleTheme 消费的仍是派生视图
  // 「分类 → 当前套用主题」，主题库页签才需要全量结构
  const [themeLib, setThemeLib] = useState<CustomThemeLibrary>({ version: 2, themes: {}, active: {} })
  const customThemes = useMemo(() => activeThemesView(themeLib), [themeLib])
  /** 任何主题写入后重拉全量库（绑定/解绑/保存/删除/AI 入库共用） */
  const reloadThemes = useCallback(async () => {
    setThemeLib(await window.api.invoke('customTheme:list'))
  }, [])
  // 导入排版弹窗（粘贴 HTML / 公众号链接复用排版）
  const [showThemeImport, setShowThemeImport] = useState(false)
  // 成文步工具条「排版」合并下拉：整套主题快选 + 导入排版 + 主题库入口
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
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
  /** 影子工程提示一次标记（refreshProjects 每次变更都会跑，别重复打扰） */
  const dupToastShown = useRef(false)

  const dirty = article !== saved

  useEffect(() => setSavedAt(Date.now()), [saved])

  /** 排版调性：自定义主题 > 分类调性 > 默认（meta 变化即时跟换）。
   *  预览 = 临时把「当前分类的主题」换成预览的那套（注入派生视图再走同一条解析链）。
   *  预览的意义是看主题真实观感：预览主题**显式定义**的字段压过工程微调——
   *  否则残留的 accent/标题字色微调会把预览也压成「换了主题颜色纹丝不动」；
   *  主题没定义的字段仍跟工程微调，预览态下正文字号/标题字号按钮照常即点即生效。
   *  没开工程（或工程无分类）时退回全局铺预览主题的旧行为，只看观感 */
  const articleTheme = useMemo(() => {
    if (!themePreview) return resolveArticleTheme(meta, customThemes)
    const cat = meta?.category
    if (!cat || !meta) return { ...resolveArticleTheme(null, customThemes), ...themePreview.theme }
    const defined = new Set(Object.keys(themePreview.theme))
    // 覆盖键与主题字段几乎同名，唯一异名 bodyFontSize↔fontSize（resolveArticleTheme 的映射口径）
    const metaForPreview = Object.fromEntries(
      Object.entries(meta).filter(([k]) => !defined.has(k === 'bodyFontSize' ? 'fontSize' : k))
    ) as ProjectMeta
    return resolveArticleTheme(metaForPreview, { ...customThemes, [cat]: themePreview.theme })
  }, [meta, customThemes, themePreview])

  /** 分类调性的强调色：封面墙无封面占位卡用它，保证「墙上看到的颜色」= 该分类工程实际颜色 */
  const accentOf = useCallback(
    (category?: string) => resolveArticleTheme(category ? { category } : null, customThemes).accent,
    [customThemes]
  )

  /**
   * 中栏创作页签显示封面墙：未打开工程且用户没主动让位（原逻辑），
   * 或按下 ⌂ 主动回墙（诊断 11）——钉住时不受「已打开工程」与让位开关限制。
   */
  const showWall = centerTab === 'create' && (wallPinned || (!current && !wallOff))

  /** 页签行单行测量（诊断 8）：narrow=长标签放不下改短名，overflow=短标签仍放不下→横滑渐隐 */
  const tabsRow = useFittingRow<HTMLDivElement>()

  /** 切中栏页签：回到「创作」即退出钉墙状态（⌂ 才是回墙的入口，页签职责单一） */
  const selectCenterTab = useCallback((id: CenterTab): void => {
    setCenterTab(id)
    if (id === 'create') setWallPinned(false)
  }, [])

  /** ⌂ 回项目库：钉住封面墙，并清掉「用户已让位给向导」的本地开关（否则点了没反应） */
  const goWall = useCallback((): void => {
    setCenterTab('create')
    setWallPinned(true)
    setWallOff(false)
    localStorage.removeItem('lig-wall-off')
  }, [])

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
    // 影子工程检测（启动/刷新时静默跑，无显式入口）：发现同名工程多份副本才提示一次，
    // 树里按工程名去重只显示一份，多出的不可见——不提醒的话只能等移动/改名碰撞才发现
    void window.api
      .invoke('project:listDuplicates')
      .then((dups) => {
        if (!dups.length || dupToastShown.current) return
        dupToastShown.current = true
        const first = dups[0]
        const cats = [...new Set(first.copies.map((c) => c.category || '未分类'))].join(' / ')
        setToast(
          dups.length === 1
            ? `发现同名工程「${first.name}」在多个分类下（${cats}），树里只显示其中一份；建议在文件管理器合并或删除多余副本`
            : `发现 ${dups.length} 个工程存在同名副本（如「${first.name}」，${cats} 等）；树里只显示其中一份，建议在文件管理器合并或删除多余副本`
        )
      })
      .catch(() => {})
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
    void reloadThemes()
    void refreshMeta()
  }, [refreshMeta, reloadThemes])

  const refreshSkills = useCallback(() => {
    window.api.invoke('skill:list').then(setSkills)
  }, [])

  useEffect(() => {
    window.api.invoke('app:getPaths').then(setPaths)
    refreshSkills()
    refreshProjects()
    void reloadThemes()
  }, [refreshProjects, refreshSkills, reloadThemes])

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
      // 预览跟「看主题」这个动作走：换工程即退——不退的话预览会跨分类「隐形生效」，
      // 作者以为新分类的排版变了，其实还压着上一次预览的那套
      setThemePreview(null)
      // 从墙上/树里点开工程就退出「钉住封面墙」，否则开完工程还停在墙上
      setWallPinned(false)
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

  /** 清单里含当前打开的工程就关掉编辑器：主进程停掉目录监听，整个分类目录在 Windows 上才删得动。
   *  删单个/批量工程也走这里，免得两处各自清一套编辑态。 */
  const closeIfOpen = useCallback(async (names: string[]) => {
    const cur = currentRef.current
    if (!cur || !names.includes(cur)) return
    await window.api.invoke('project:close')
    setCurrent(null)
    currentRef.current = null
    setMeta(null)
    setArticle('')
    setSaved('')
    setConflict(null)
    // 工程都没了，预览无从附着：一并退掉
    setThemePreview(null)
  }, [])

  /** 批量删除（工作树批量管理）：一次确认，逐个移除；单个失败不阻塞其余 */
  const deleteProjects = useCallback(
    async (names: string[]) => {
      if (names.length === 0) return
      if (!(await confirmAction(`删除选中的 ${names.length} 个工程？\n整个文件夹（正文/素材/会话）将被移除，不可恢复。`, { okLabel: '删除' }))) return
      let ok = 0
      for (const name of names) {
        try {
          await closeIfOpen([name])
          await window.api.invoke('project:delete', name)
          ok++
        } catch {
          // 单个失败继续删其余，最后汇总提示
        }
      }
      refreshProjects()
      setToast(ok === names.length ? `已删除 ${ok} 个工程` : `已删除 ${ok}/${names.length} 个（其余删除失败）`)
    },
    [closeIfOpen, refreshProjects]
  )

  /** 删除工程（确认后整目录移除；删当前工程先关闭） */
  const deleteProject = useCallback(
    async (name: string) => {
      if (!(await confirmAction(`删除工程「${name}」？\n整个文件夹（正文/素材/会话）将被移除，不可恢复。`, { okLabel: '删除' }))) return
      try {
        await closeIfOpen([name])
        await window.api.invoke('project:delete', name)
        refreshProjects()
        setToast(`已删除「${name}」`)
      } catch (err) {
        setToast(`删除失败：${err instanceof Error ? err.message : err}`)
      }
    },
    [closeIfOpen, refreshProjects]
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

  /** 逐行合并：弹窗算好的全文写盘并落基线，编辑器与磁盘同源（冲突就此了结） */
  const resolveMerge = useCallback(
    async (text: string) => {
      if (!current) return
      const next = text.endsWith(String.fromCharCode(10)) ? text : text + String.fromCharCode(10)
      await window.api.invoke('project:writeFile', current, 'article.md', next)
      setArticle(next)
      setSaved(next)
      setConflict(null)
      setToast('已按逐行合并结果写回 article.md')
    },
    [current]
  )

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

  /** 把当前工程生效的整套排版存成主题（存入当前工程的分类；一分类可挂多套主题，不覆盖旧的）。
   *  分类级调性此前只有「导入公众号文章」和「对话生成」两条路，作者手工调好的排版没法沉淀成分类主题 */
  const handleSaveThemePreset = useCallback(
    async (name: string) => {
      const category = meta?.category ?? name
      await window.api.invoke('customTheme:save', name, { ...articleTheme, origin: 'panel' }, category)
      await reloadThemes()
      setToast(`已把当前排版存为主题「${name}」（分类「${category}」）`)
    },
    [articleTheme, meta, reloadThemes]
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

  /** 成文工具条「主题」快选：写分类 active 指针，编辑器/导出/推送同源切换 */
  const handleQuickTheme = useCallback(
    async (name: string | null) => {
      const cat = meta?.category
      if (!cat) return
      await window.api.invoke('customTheme:setActive', cat, name)
      await reloadThemes()
      setToast(name ? `已切换主题「${name}」` : '已解除主题绑定，回到默认调性')
    },
    [meta, reloadThemes]
  )

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
              <Icon name="palette" size={13} className="mr-1" />外观
            </button>
            {showAppearance && (
              <Popover onClose={() => setShowAppearance(false)} className="no-drag absolute right-0 top-full mt-1 w-48 p-2">
                <PopoverLabel>主题</PopoverLabel>
                <Segmented
                  className="mb-2"
                  size="sm"
                  ariaLabel="主题模式"
                  value={themeMode}
                  onChange={setThemeMode}
                  items={[
                    { value: 'system', label: '跟随系统' },
                    { value: 'light', label: '日间' },
                    { value: 'dark', label: '夜间' }
                  ]}
                />
                <PopoverLabel className="px-0">界面字号</PopoverLabel>
                <Segmented
                  size="sm"
                  ariaLabel="界面字号"
                  value={uiScale}
                  onChange={setUiScale}
                  items={[
                    { value: 's', label: '小' },
                    { value: 'm', label: '中' },
                    { value: 'l', label: '大' }
                  ]}
                />
              </Popover>
            )}
          </div>
          <button onClick={() => setShowSettings(true)} className="rounded px-2 py-1 hover:bg-panel-3">
            <Icon name="plug" size={13} className="mr-1" />模型接入
          </button>
          <button onClick={() => setShowIntegration(true)} className="inline-flex items-center rounded px-2 py-1 hover:bg-panel-3">
            <Icon name="settings" size={13} className="mr-1" />设置
          </button>
          <button
            onClick={() => startTour(tourHandlers)}
            title="重新播放新手引导"
            className="rounded px-2 py-1 hover:bg-panel-3"
          >
            <Icon name="help" size={13} className="mr-1" />帮助
          </button>
          <button
            onClick={() => void checkUpdate(true)}
            disabled={checkingUpdate}
            title={updateCurrent ? `检查更新（当前版本 v${updateCurrent}）` : '检查更新：有新版本时给出网盘/GitHub 下载入口'}
            className="rounded px-2 py-1 hover:bg-panel-3 disabled:opacity-50"
          >
            {checkingUpdate ? '检查中…' : <><Icon name="refresh" size={13} className="mr-1" />版本更新</>}
          </button>
          <button
            onClick={() => window.open('https://ligdesign.win/')}
            title="LIG 立格 Studio 品牌官网：设计 · 工具 · 桌面美学"
            className="rounded px-2 py-1 hover:bg-panel-3"
          >
            <Icon name="globe" size={13} className="mr-1" />官网
          </button>
        </div>
        <div className="flex h-full items-stretch">
          <button
            onClick={() => void window.api.invoke('win:minimize')}
            title="最小化"
            className="w-11 text-sm text-ink-dim hover:bg-panel-3"
          >
            <Icon name="minimize" size={13} />
          </button>
          <button
            onClick={() => void window.api.invoke('win:toggleMaximize')}
            title="最大化 / 还原"
            className="w-11 text-sm text-ink-dim hover:bg-panel-3"
          >
            <Icon name="maximize" size={13} />
          </button>
          <button
            onClick={() => void window.api.invoke('win:close')}
            title="关闭"
            className="w-11 text-sm text-ink-dim hover:bg-st-bad hover:text-white"
          >
            <Icon name="x" size={13} />
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
          onCategoriesChanged={() => void refreshProjects()}
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
            {leftCollapsed ? <Icon name="chevronRight" size={12} /> : <Icon name="chevronLeft" size={12} />}
          </button>
        </div>

        {/* 中栏：创作向导（主工作面）/ 选题看板 / 日历 */}
        <main className="flex min-w-0 flex-1 flex-col bg-panel">
          {/* 中栏页签行（诊断 8/11）：⌂ 项目库常驻入口 + 四页签 + 右端字数胶囊。
              整条强制单行：放不下时长标签先降短名（选题看板→看板），仍放不下则横滑 + 右缘渐隐，绝不折行；
              字数胶囊钉在条带外，不随页签滚走 */}
          <div data-tour="center-toolbar" className="flex h-[42px] shrink-0 items-center gap-2 border-b border-panel-3 px-4">
            <button
              onClick={goWall}
              title="工程封面墙：所有工程的视觉入口（与选题看板、日历三视角并存）"
              aria-label="项目库"
              aria-pressed={showWall}
              className={`inline-flex h-7 shrink-0 items-center rounded-md border px-2 transition-colors ${
                showWall
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-panel-3 text-ink-dim hover:border-accent hover:text-accent'
              }`}
            >
              <Icon name="home" size={13} />
            </button>
            <div
              ref={tabsRow.ref}
              data-overflow={tabsRow.overflow ? '1' : '0'}
              className="chip-row flex min-w-0 flex-1 flex-nowrap items-center gap-1"
            >
              {CENTER_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectCenterTab(t.id)}
                  title={t.title}
                  className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs transition-colors ${
                    centerTab === t.id ? 'bg-accent/15 font-semibold text-accent' : 'text-ink-dim hover:bg-panel-3 hover:text-ink'
                  }`}
                >
                  <Icon name={t.icon} size={13} />
                  {tabsRow.narrow && t.short ? t.short : t.label}
                </button>
              ))}
            </div>
            {current && wordCount > 0 && (
              <span className="shrink-0 rounded-full bg-panel-3 px-2.5 py-0.5 text-[11.5px] text-ink-dim" title="当前正文字数（不含标记）">
                本文 {wordCount} 字
              </span>
            )}
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
          ) : centerTab === 'themes' ? (
            <ThemeLibrary
              categories={categories}
              library={themeLib}
              project={current}
              projectCategory={current && meta ? meta.category ?? UNCATEGORIZED : undefined}
              activePreview={themePreview?.name ?? null}
              onPreview={(entry) => {
                setThemePreview(entry ? { name: entry.name, theme: entry.theme } : null)
                // 预览的意义是看真实排版：有工程时点「预览」直接跳导出步——手机宽度预览按主题
                // 完整渲染标题装饰/引用/分隔线，比编辑器里看观感更接近发布效果（导出预览与编辑器
                // 同吃 articleTheme，预览态两处同步）。贴图工程没有导出步，退回成文步看卡片；
                // 退出预览（entry=null）不跳，人停在哪就留在哪
                if (entry && current) {
                  selectCenterTab('create')
                  setStepRequest({ id: meta?.format === 'cards' ? 'draft' : 'export', ts: Date.now() })
                }
              }}
              onBind={async (category, entry) => {
                // 绑定 = 切换该分类的 active 指针（自定义/内置都只是指过去），不动主题库里的其他主题
                await window.api.invoke('customTheme:setActive', category, entry.name)
                await reloadThemes()
                if (current) void refreshMeta()
              }}
              onUnbind={async (category) => {
                await window.api.invoke('customTheme:setActive', category, null)
                await reloadThemes()
                if (current) void refreshMeta()
              }}
              onDelete={async (name) => {
                await window.api.invoke('customTheme:delete', name)
                await reloadThemes()
                if (themePreview?.name === name) setThemePreview(null)
                if (current) void refreshMeta()
              }}
              onImport={() => setShowThemeImport(true)}
              onSaveFromProject={() => {
                setCenterTab('create')
                setShowTypography(true)
              }}
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
          {/* 工程封面墙（主 PRD §7.13）：未打开工程时中栏不再是空壳，打开后 ⌂ 也能随时回墙（诊断 11）。
              向导仍常驻挂载，只是 hidden 保活——脑暴/生成的流式状态不因切到墙上而断 */}
          {showWall && (
            <ProjectWall
              projects={projects}
              categories={categories}
              initialCat={filterCat}
              current={current ?? undefined}
              onClose={wallPinned ? () => setWallPinned(false) : undefined}
              onOpen={(name) => void openProject(name)}
              onCreate={(name) => void createProjectNamed(name, filterCat === 'all' ? undefined : filterCat)}
              onBrainstorm={() => {
                setWallPinned(false)
                setWallOff(true)
                localStorage.setItem('lig-wall-off', '1')
              }}
              accentOf={accentOf}
              onToast={setToast}
            />
          )}
          {/* 向导常驻挂载（hidden 保活）：流式/编辑器/贴图渲染状态切页签不丢——沿用原右栏三面板模式 */}
          <div className={`min-h-0 flex-1 flex-col ${centerTab === 'create' && !showWall ? 'flex' : 'hidden'}`}>
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
                          <Icon name="sparkles" size={13} className="mr-1" />排版优化
                        </button>
                        {/* 排版合并入口：整套主题快选（点选即切，写分类 active 指针）+ 导入排版 + 主题库。
                            与「排版优化」并排——优化重写正文，这里换视觉层，两层常连用 */}
                        <div className="relative">
                          <button
                            onClick={() => setThemeMenuOpen((v) => !v)}
                            title="快捷切换整套主题 / 导入排版 / 打开主题库"
                            className="rounded px-2 py-0.5 hover:bg-panel-3"
                          >
                            <Icon name="palette" size={13} className="mr-1" />排版
                          </button>
                          {themeMenuOpen && (
                            <Popover onClose={() => setThemeMenuOpen(false)} className="absolute left-0 top-full z-50 mt-1 w-72 p-1">
                              {(() => {
                                const cat = meta?.category ?? null
                                // 当前实际生效的主题名：active 指针 → 同名内置兜底（与 resolveArticleTheme 回退链一致）
                                const current = cat
                                  ? (themeLib.active[cat] && (themeLib.themes[themeLib.active[cat]] || themeLib.active[cat] in CATEGORY_THEMES)
                                      ? themeLib.active[cat]
                                      : cat in CATEGORY_THEMES
                                        ? cat
                                        : undefined)
                                  : undefined
                                const items: { name: string; accent: string; home?: string; custom: boolean }[] = []
                                if (cat) {
                                  if (cat in CATEGORY_THEMES && !themeLib.themes[cat])
                                    items.push({ name: cat, accent: CATEGORY_THEMES[cat].accent, custom: false })
                                  for (const [n, e] of Object.entries(themeLib.themes)) {
                                    if (e.category === cat || themeLib.active[cat] === n)
                                      items.push({ name: n, accent: e.theme.accent, home: e.category, custom: true })
                                  }
                                }
                                return (
                                  <>
                                    <PopoverLabel>套用到分类「{cat ?? '—'}」</PopoverLabel>
                                    {items.length ? (
                                      <div className="max-h-60 space-y-0.5 overflow-y-auto">
                                        {items.map((it) => (
                                          <button
                                            key={it.name}
                                            type="button"
                                            onClick={() => {
                                              setThemeMenuOpen(false)
                                              void handleQuickTheme(it.name)
                                            }}
                                            title={current === it.name ? '当前套用的主题' : '切换到这套排版（编辑器/导出/推送同步生效）'}
                                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                                              current === it.name ? 'bg-accent/15 font-semibold text-accent' : 'text-ink hover:bg-panel-3'
                                            }`}
                                          >
                                            <span
                                              className="inline-block h-3 w-3 shrink-0 rounded-full border border-panel-3"
                                              style={{ background: it.accent }}
                                            />
                                            <span className="min-w-0 flex-1 truncate">{it.name}</span>
                                            {it.home && it.home !== it.name && (
                                              <span className="shrink-0 text-[10px] text-ink-dim">归属「{it.home}」</span>
                                            )}
                                            {it.custom && (
                                              <span className="shrink-0 rounded-full bg-panel-3 px-1 py-px text-[9px] text-ink-dim">自定义</span>
                                            )}
                                            {current === it.name && <Icon name="check" size={11} />}
                                          </button>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="px-2.5 py-2 text-[11px] leading-relaxed text-ink-dim">
                                        {cat ? '该分类还没有主题：从文章导入一套，或在对话里让 AI 生成。' : '先打开工程（有分类才能套用主题）。'}
                                      </p>
                                    )}
                                    <div className="my-1 h-px bg-panel-3" />
                                    <MenuItem
                                      icon="undo"
                                      onClick={() => {
                                        setThemeMenuOpen(false)
                                        // 旧文章的排版微调会压住主题（「应用了主题却显示不全」的原因）：
                                        // 一键清空全部微调，让分类当前绑定的主题完整生效
                                        void handleApplyTypography(
                                          Object.fromEntries(
                                            THEME_OVERRIDE_KEYS.map((k) => [k, null])
                                          ) as Partial<Record<ThemeOverrideKey, null>>
                                        ).then(() => setToast('已清空排版微调，本工程视觉完全跟随主题'))
                                      }}
                                      title="清掉本工程全部排版覆盖，分类主题的每个字段都完整生效"
                                    >
                                      清空微调，完全跟随主题
                                    </MenuItem>
                                    <MenuItem
                                      icon="download"
                                      onClick={() => {
                                        setThemeMenuOpen(false)
                                        setShowThemeImport(true)
                                      }}
                                      title="粘贴公众号 HTML 或链接，复用它的排版"
                                    >
                                      导入排版…
                                    </MenuItem>
                                    <MenuItem
                                      icon="layers"
                                      onClick={() => {
                                        setThemeMenuOpen(false)
                                        setCenterTab('themes')
                                      }}
                                    >
                                      在主题库中浏览全部
                                    </MenuItem>
                                  </>
                                )
                              })()}
                            </Popover>
                          )}
                        </div>
                        <button
                          onClick={() => setShowConvert((v) => !v)}
                          disabled={!article.trim() || converting}
                          title="把正文提炼成多张竖版图片卡片，工程切换为贴图形态"
                          className="rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40"
                        >
                          {converting ? '转贴图中…' : <><Icon name="image" size={13} className="mr-1" />转贴图</>}
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
                            <Icon name="undo" size={13} className="mr-1" />回到贴图
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
                          typography={(meta ?? {}) as ThemeOverrides}
                          onOpenTypography={() => setShowTypography(true)}
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
          {/* 底部状态栏（§5.1）：左=当前工作区路径，右=当前文档 + 保存状态与时间 */}
          <footer className="flex h-[26px] shrink-0 items-center gap-3 border-t border-panel-3 bg-panel-2 px-3.5 text-[10.5px] text-ink-dim">
            <button
              onClick={() => {
                if (paths) void window.api.invoke('export:openFile', paths.workspace).catch(() => {})
              }}
              title={`点击打开工作区文件夹\n${paths?.workspace ?? ''}`}
              className="inline-flex min-w-0 items-center gap-1.5 font-mono hover:text-ink"
            >
              <Icon name="folder" size={11} />
              <span className="truncate">{paths?.workspace ?? '工作区未就绪'}</span>
            </button>
            <span className="ml-auto inline-flex min-w-0 items-center gap-2">
              {current ? (
                <>
                  <span className="truncate">
                    {filterCat && filterCat !== 'all' ? `${filterCat} / ` : ''}
                    {current}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5">
                    <StatusDot status={dirty ? 'draft' : 'done'} />
                    {dirty ? '未保存' : `已自动保存 ${new Date(savedAt).toTimeString().slice(0, 5)}`}
                  </span>
                </>
              ) : (
                <span className="shrink-0">未打开工程</span>
              )}
            </span>
          </footer>
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
            {rightCollapsed ? <Icon name="chevronLeft" size={12} /> : <Icon name="chevronRight" size={12} />}
          </button>
        </div>

        {/* 右栏（分栏可折叠：收起时 w-0 隐藏不卸载，对话流式状态不丢） */}
        <div
          className={`flex min-h-0 shrink-0 overflow-hidden ${rightCollapsed ? 'w-0' : ''}`}
          style={rightCollapsed ? undefined : { width: rightW }}
        >
        {/* 右栏：AI 对话副驾驶（脑暴/审阅已并入中栏创作向导） */}
        <aside className="flex min-h-0 w-full min-w-0 flex-col border-l border-panel-3 bg-panel-2">
          <div data-tour="right-tabs" className="flex h-9 shrink-0 items-center gap-2 border-b border-panel-3 px-3 text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold text-ink">
              <Icon name="message" size={13} className="text-accent" />
              对话
            </span>
            {/* Skill 挂载（§5.9 头部降噪）：圆角下拉 + 当前挂载状态点，一眼看出这轮对话带不带风格 */}
            <select
              value={skillName}
              onChange={(e) => mountSkill(e.target.value)}
              title={skills.find((s) => s.name === skillName)?.description ?? '挂载写作风格 Skill：注入系统提示，作用范围=对话'}
              className={`ml-auto h-[26px] max-w-[150px] shrink min-w-0 truncate rounded-full border bg-panel-2 px-2.5 text-[11.5px] outline-none ${
                skillName ? 'border-accent/60 font-semibold text-accent' : 'border-panel-3 text-ink-dim'
              }`}
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
                void reloadThemes()
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
          onMerge={(text) => void resolveMerge(text)}
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
      <TypographyPanel
        open={showTypography}
        onClose={() => setShowTypography(false)}
        theme={articleTheme}
        overrides={(meta ?? {}) as ThemeOverrides}
        project={current}
        category={meta?.category}
        onApply={handleApplyTypography}
        onSavePreset={handleSaveThemePreset}
        onOpenThemeLibrary={() => {
          setShowTypography(false)
          setCenterTab('themes')
        }}
      />

      {polish && current && (
        <PolishDialog
          article={article}
          skill={skillContent}
          review={polish.review}
          theme={articleTheme}
          overrideCount={
            meta ? THEME_OVERRIDE_KEYS.filter((k) => meta[k] !== undefined && meta[k] !== null).length : 0
          }
          onConfirm={(result, themePatch, only, alignTheme) => {
            // only=visual：正文一个字都不动，只落视觉参数
            if (only !== 'visual') setArticle(result)
            setPolish(null)
            if (only === 'visual') {
              void handleApplyTypography(themePatch ?? {}).then(
                () => setToast('视觉参数已应用，正文未改动'),
                (err) => setToast('视觉参数应用失败：' + String(err instanceof Error ? err.message : err))
              )
              return
            }
            // 主题对齐：清空全部工程排版微调——旧文章的旧覆盖正是「主题显示不全」的原因，
            // 清掉后分类绑定的主题完整生效；正文重排结果照常进编辑器
            if (alignTheme) {
              void handleApplyTypography(
                Object.fromEntries(THEME_OVERRIDE_KEYS.map((k) => [k, null])) as Partial<Record<ThemeOverrideKey, null>>
              ).then(
                () => setToast('排版已应用：工程微调已清空，视觉完全跟随主题'),
                (err) => setToast(`排版已应用，清空微调失败：${err instanceof Error ? err.message : err}`)
              )
              return
            }
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
      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          appearance={{
            mode: themeMode,
            onMode: setThemeMode,
            scale: uiScale,
            onScale: setUiScale,
            version: updateCurrent ?? undefined,
            onCheckUpdate: () => void checkUpdate(true)
          }}
          onOpenIntegration={(t) => {
            setShowSettings(false)
            if (t) setIntegrationTab(t)
            setShowIntegration(true)
          }}
        />
      )}

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
          categories={categories}
          defaultCategory={meta?.category ?? undefined}
          onClose={() => setShowThemeImport(false)}
          onToast={setToast}
          onSaved={async (name, category) => {
            await reloadThemes()
            refreshProjects()
            setFilterCat(category || name)
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
          onCloseProjects={closeIfOpen}
          onOpenThemeLibrary={() => {
            setShowCatManage(false)
            setCenterTab('themes')
          }}
        />
      )}

      {/* 轻提示 */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded bg-panel-3 px-4 py-2 text-xs text-ink shadow-lg">
          {toast}
        </div>
      )}
      {/* 预览全局浮标：主题库页签里已有横幅，切到其他页签（成文/导出…）预览仍在生效——
          不能让它「隐形」：常驻一枚浮标说明预览对象，随手可退；比主题库横幅高一行避开 toast */}
      {themePreview && centerTab !== 'themes' && (
        <div className="fixed bottom-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-accent/50 bg-accent/10 px-3.5 py-1.5 text-[11.5px] text-accent shadow-[0_4px_16px_rgba(0,0,0,.28)]">
          <Icon name="eye" size={12} className="shrink-0" />
          正在预览主题「{themePreview.name}」——只改观感不写盘
          <button onClick={() => setThemePreview(null)} className="shrink-0 font-semibold hover:underline">
            退出预览
          </button>
        </div>
      )}
    </div>
  )
}
