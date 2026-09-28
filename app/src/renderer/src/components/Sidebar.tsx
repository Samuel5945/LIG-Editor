import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AppPaths, IdeaCard, ProjectAssets, ProjectSummary, SkillInfo } from '@shared/types'
import { UNCATEGORIZED } from '@shared/categories'
import { groupProjectsByCategory } from '@shared/workTree'
import HoverScrollName from './HoverScrollName'
import IdeaLibrary from './IdeaLibrary'

/** 状态圆点配色（树上不放状态文字/提示——省宽度给工程名，颜色即语义） */
const STATUS_COLOR: Record<string, string> = {
  ideating: 'bg-sky-400',
  drafting: 'bg-amber-400',
  reviewing: 'bg-violet-400',
  ready: 'bg-green-500'
}

interface SidebarProps {
  paths: AppPaths | null
  projects: ProjectSummary[]
  categories: string[]
  skills: SkillInfo[]
  /** 脑暴入库/日历立项后自增，驱动选题收件箱刷新（App 级共享版本号） */
  ideasVersion: number
  current: string | null
  /** 当前选中的分类（脑暴立项/新建工程的落档依据；'all' = 未指定） */
  filterCat: string
  categorizing: boolean
  /** 变化时重拉分类→公众号账号绑定（分类管理/推送设置变更后 bump） */
  bindingsVersion: number
  onOpenProject: (name: string) => void
  /** 打开工程并落到指定中栏页签（已是当前工程只切页签，不重载丢未保存稿） */
  onOpenProjectView: (name: string, tab: 'article' | 'titlecover') => void
  onCreateProject: (name: string, category?: string) => Promise<void>
  /** 返回是否成功，失败时行内重命名输入保持展开 */
  onRenameProject: (oldName: string, newName: string) => Promise<boolean>
  onDeleteProject: (name: string) => void
  onApplyCategory: (name: string, category: string) => void
  onAiCategorize: () => void
  onSkillsChanged: () => void
  onOpenCatManage: () => void
  onOpenIntegration: (tab: 'skill') => void
  onSetFilterCat: (cat: string) => void
  /** 选题收件箱条目「生成大纲」→ 送入脑暴面板（App 级回调） */
  onMakeOutline: (card: IdeaCard) => void
  onToast: (msg: string) => void
}

/** 用系统默认应用打开工程内文件/目录；rel 缺省打开目录本身，路径不存在时 toast 提示 */
function openPath(dir: string, rel: string | null, onToast: (msg: string) => void): void {
  const abs = rel ? `${dir}\\${rel.replace(/\//g, '\\')}` : dir
  window.api.invoke('export:openFile', abs).catch((err) => onToast(`打开失败：${err instanceof Error ? err.message : err}`))
}

function Chevron({ open }: { open: boolean }): ReactElement {
  return <span className="w-3 shrink-0 text-center text-ink-dim">{open ? '▾' : '▸'}</span>
}

const rowBase = 'group mb-0.5 flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-left'

/**
 * 左栏：工作树 / 选题库 双页签。
 * 「工作树」镜像 workspace 目录（分类→工程→正文/交付）作导航骨架，钉住 Skill 库节点；
 * 树只读，点击深链既有面板，状态/排期等推导值由 ProjectSummary 现场标注。资产计数来自
 * project:listAssets，展开的工程经 project:setWatchedProjects 按需监听，Agent 直改文件即自动刷新。
 * 「选题库」沿用原版整栏列表（idea-inbox.md），与树分开，切换页签不丢树的展开状态。
 */
export default function Sidebar(props: SidebarProps): ReactElement {
  const {
    paths,
    projects,
    categories,
    skills,
    ideasVersion,
    current,
    filterCat,
    categorizing,
    bindingsVersion,
    onOpenProject,
    onOpenProjectView,
    onCreateProject,
    onRenameProject,
    onDeleteProject,
    onApplyCategory,
    onAiCategorize,
    onSkillsChanged,
    onOpenCatManage,
    onOpenIntegration,
    onSetFilterCat,
    onMakeOutline,
    onToast
  } = props

  // null = 全部分类展开（首次使用的默认态，直到手动折叠才落具体清单）
  // 左栏页签：工作树 / 选题库（选题库沿用原版整栏列表，与树分开）
  const [leftTab, setLeftTab] = useState<'tree' | 'ideas'>('tree')
  const [openCats, setOpenCats] = useState<string[] | null>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const [openGroups, setOpenGroups] = useState<string[]>([])
  const [skillsOpen, setSkillsOpen] = useState(false)
  // 置顶工程（渲染层本地偏好，不入 project.json，避开 readMeta 白名单坑）
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('lig-tree-pinned') ?? '[]')
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  // 工程行右键菜单：{ x, y } 视口坐标 + 工程名
  const [menu, setMenu] = useState<{ x: number; y: number; name: string } | null>(null)
  const [assets, setAssets] = useState<Record<string, ProjectAssets>>({})
  // creatingFor：null 关闭；'' 底部全局新建（落当前选中分类）；其余 = 该分类行内新建
  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [renamingFor, setRenamingFor] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  // 当前工程的行内「新建分类」输入（原左栏交互平移）
  const [newCatFor, setNewCatFor] = useState<string | null>(null)
  const [newCatName, setNewCatName] = useState('')
  const [wechatBadge, setWechatBadge] = useState<{ byCat: Record<string, string>; defaultName: string | null }>({
    byCat: {},
    defaultName: null
  })

  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const groups = groupProjectsByCategory(projects, categories, pinned)

  const toggleCat = useCallback(
    (cat: string) => {
      setOpenCats((prev) => {
        const base = prev ?? categories
        return base.includes(cat) ? base.filter((c) => c !== cat) : [...base, cat]
      })
    },
    [categories]
  )

  const toggleProject = useCallback((name: string) => {
    setExpanded((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }, [])

  const toggleGroup = useCallback((key: string) => {
    setOpenGroups((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }, [])

  // 分类展开态记忆（null 期间不落盘，保持「全开」默认）
  useEffect(() => {
    if (openCats) localStorage.setItem('lig-tree-open-cats', JSON.stringify(openCats))
  }, [openCats])

  // 置顶记忆 + 盘上已不存在的置顶项顺手清掉
  useEffect(() => {
    localStorage.setItem('lig-tree-pinned', JSON.stringify(pinned))
  }, [pinned])
  useEffect(() => {
    setPinned((prev) => {
      const next = prev.filter((n) => projects.some((p) => p.name === n))
      return next.length === prev.length ? prev : next
    })
  }, [projects])
  const togglePin = useCallback((name: string) => {
    setPinned((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }, [])

  // 当前打开的工程自动展开资产节点
  useEffect(() => {
    if (!current) return
    setExpanded((prev) => (prev.includes(current) ? prev : [...prev, current]))
  }, [current])

  // 工程被删除/改名后清掉失效的展开项
  useEffect(() => {
    setExpanded((prev) => {
      const next = prev.filter((n) => projects.some((p) => p.name === n))
      return next.length === prev.length ? prev : next
    })
  }, [projects])

  const refreshAssets = useCallback(async (name: string) => {
    try {
      const a = await window.api.invoke('project:listAssets', name)
      setAssets((prev) => ({ ...prev, [name]: a }))
    } catch {
      // 工程已不存在：丢弃缓存
      setAssets((prev) => {
        if (!(name in prev)) return prev
        const { [name]: _drop, ...rest } = prev
        return rest
      })
    }
  }, [])

  // 展开的工程：拉资产清单 + 主进程差量挂监听（Agent 直改文件 → workspace:assets-changed）。
  // 监听同步带「布局签名」：工程迁移分类后目录变了而名字没变，签名变化触发重挂
  const layoutKey = useMemo(() => projects.map((p) => `${p.category ?? ''}/${p.name}`).join('¦'), [projects])
  const expandedKey = expanded.join('¦')
  useEffect(() => {
    for (const name of expandedRef.current) void refreshAssets(name)
    void window.api.invoke('project:setWatchedProjects', expandedRef.current)
  }, [expandedKey, layoutKey, refreshAssets])

  useEffect(() => {
    const offAssets = window.api.on('workspace:assets-changed', ({ project }) => {
      if (expandedRef.current.includes(project)) void refreshAssets(project)
    })
    const offWs = window.api.on('workspace:changed', () => {
      for (const name of expandedRef.current) void refreshAssets(name)
    })
    return () => {
      offAssets()
      offWs()
    }
  }, [refreshAssets])

  // 分类 → 绑定公众号账号徽标（只标显式绑定，不把默认账号伪装成绑定）
  useEffect(() => {
    window.api
      .invoke('wechat:get-config')
      .then((c) => {
        const byId = new Map(c.accounts.map((a) => [a.id, a.name]))
        const byCat: Record<string, string> = {}
        for (const [cat, id] of Object.entries(c.bindings)) {
          const name = byId.get(id)
          if (name) byCat[cat] = name
        }
        setWechatBadge({ byCat, defaultName: c.defaultAccountId ? byId.get(c.defaultAccountId) ?? null : null })
      })
      .catch(() => {})
  }, [bindingsVersion])

  const createIn = useCallback(
    (category?: string) => {
      const name = newName.trim()
      if (!name) return
      if (category) setOpenCats((prev) => (prev && !prev.includes(category) ? [...prev, category] : prev))
      setCreatingFor(null)
      setNewName('')
      void onCreateProject(name, category)
    },
    [newName, onCreateProject]
  )

  const submitRename = useCallback(
    async (oldName: string) => {
      if (await onRenameProject(oldName, renameVal)) {
        setRenamingFor(null)
        setRenameVal('')
      }
    },
    [onRenameProject, renameVal]
  )

  const toggleSkill = useCallback(
    async (name: string, enabled: boolean) => {
      await window.api.invoke('skill:setEnabled', name, !enabled)
      onSkillsChanged()
    },
    [onSkillsChanged]
  )

  const removeSkill = useCallback(
    async (name: string) => {
      if (!window.confirm(`删除 Skill「${name}」？整个目录将被移除，不可恢复。`)) return
      await window.api.invoke('skill:remove', name)
      onSkillsChanged()
      onToast('已删除')
    },
    [onSkillsChanged, onToast]
  )

  /** 工程节点展开后的子行：只留 正文 + 交付（其余资产收敛为工程行上的计数角标） */
  const renderAssetRows = (p: ProjectSummary): ReactElement => {
    const a = assets[p.name]
    if (!a) {
      return <div className="mb-0.5 py-1 pl-11 text-[11px] text-ink-dim">读取中…</div>
    }
    const devKey = `${p.name}::交付`
    return (
      <>
        <div onClick={() => onOpenProjectView(p.name, 'article')} className={`${rowBase} pl-8 text-ink-dim hover:bg-panel-3`} title="打开正文编辑器">
          {/* 空占位列与交付行的展开箭头同宽，保证两行图标对齐 */}
          <span className="w-3 shrink-0" />
          <span>📄</span>
          <span className="min-w-0 flex-1 truncate">正文</span>
        </div>
        <div onClick={() => toggleGroup(devKey)} className={`${rowBase} pl-8 text-ink-dim hover:bg-panel-3`} title="Word/PDF 交稿产物，点击文件直接打开">
          <Chevron open={openGroups.includes(devKey)} />
          <span>📦</span>
          <span className="min-w-0 flex-1 truncate">交付{a.deliveries.length > 0 && ` (${a.deliveries.length})`}</span>
        </div>
        {openGroups.includes(devKey) &&
          (a.deliveries.length === 0 ? (
            <p className="py-0.5 pl-11 text-[11px] text-ink-dim">（暂无，导出 Word/PDF 后落在这里）</p>
          ) : (
            a.deliveries.map((rel) => (
              <div
                key={rel}
                onClick={() => openPath(p.dir, rel, onToast)}
                className={`${rowBase} pl-11 text-ink-dim hover:bg-panel-3 hover:text-ink`}
                title="用系统默认应用打开"
              >
                <span className="min-w-0 flex-1 truncate">{rel}</span>
              </div>
            ))
          ))}
      </>
    )
  }

  const renderProjectRow = (p: ProjectSummary): ReactElement => {
    const isCurrent = p.name === current
    const isPinned = pinned.includes(p.name)
    const a = assets[p.name]
    const cat = p.category ?? UNCATEGORIZED
    const isOpen = expanded.includes(p.name)
    const imgCount = a?.assets.length ?? 0
    const figCount = a?.figures.length ?? 0
    return (
      <div key={p.name}>
        {renamingFor === p.name ? (
          <div className="mb-0.5 py-1 pl-5 pr-2">
            <div className="flex w-full items-center gap-1">
              <input
                autoFocus
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitRename(p.name)
                  if (e.key === 'Escape') {
                    setRenamingFor(null)
                    setRenameVal('')
                  }
                }}
                placeholder="新工程名（文件夹同步改名）"
                className="min-w-0 flex-1 rounded bg-panel px-1.5 py-1 text-[11px] text-ink outline-none placeholder:text-ink-dim"
              />
              <button
                onClick={() => void submitRename(p.name)}
                disabled={!renameVal.trim()}
                title="确认重命名"
                className="shrink-0 rounded bg-accent px-1.5 py-1 text-[11px] text-white disabled:opacity-40"
              >
                改
              </button>
              <button
                onClick={() => {
                  setRenamingFor(null)
                  setRenameVal('')
                }}
                className="shrink-0 rounded bg-panel px-1.5 py-1 text-[11px] text-ink-dim hover:text-ink"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => onOpenProject(p.name)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, name: p.name })
            }}
            className={`${rowBase} relative pl-5 ${isCurrent ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`}
          >
            <span
              onClick={(e) => {
                e.stopPropagation()
                toggleProject(p.name)
              }}
              title="展开/收起工程"
              className="w-3 shrink-0 text-center text-ink-dim"
            >
              {isOpen ? '▾' : '▸'}
            </span>
            <span className="min-w-0 flex-1">
              <HoverScrollName name={p.name} />
            </span>
            {isPinned && <span className="shrink-0 text-[10px]" title="已置顶">📌</span>}
            {/* 资产计数一枚角标，只显示数量占优的一类（明细进 tooltip）——
                大计数（如配图 24）时多枚角标会把行顶爆、日期被裁，这里保证徽标区恒窄 */}
            {(imgCount > 0 || figCount > 0) && (
              <span
                className="shrink-0 rounded bg-panel px-1 py-0.5 text-[10px] text-ink-dim"
                title={
                  imgCount && figCount
                    ? `配图 ${imgCount} 张 · 图表源 ${figCount} 个（外部改动实时反映）`
                    : imgCount
                      ? `配图 ${imgCount} 张`
                      : `图表源 ${figCount} 个（外部改动实时反映）`
                }
              >
                {imgCount >= figCount ? `🖼${imgCount}` : `📈${figCount}`}
              </span>
            )}
            {p.plannedAt && (
              <span className="shrink-0 rounded bg-panel px-1 py-0.5 text-[10px] text-accent" title={`排期：${p.plannedAt}`}>
                📅{p.plannedAt.slice(5)}
              </span>
            )}
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[p.status] ?? 'bg-panel-3'}`} />
            {/* 悬停动作浮层：绝对定位不占布局宽度——名称永不被挤出，行尾也不再跳动 */}
            <span
              className={`absolute right-1 hidden items-center gap-0.5 rounded px-0.5 group-hover:flex ${
                isCurrent ? 'bg-panel-3' : 'bg-panel-2'
              }`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setRenamingFor(p.name)
                  setRenameVal(p.name)
                }}
                title="重命名工程（本地文件夹同步改名）"
                className="rounded px-1 py-0.5 text-[11px] text-ink hover:bg-panel hover:text-accent"
              >
                ✏️
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteProject(p.name)
                }}
                title="删除工程"
                className="rounded px-1 py-0.5 text-[11px] text-ink hover:bg-panel hover:text-red-400"
              >
                🗑
              </button>
            </span>
          </div>
        )}
        {isCurrent && !renamingFor && (
          <div className="py-0.5 pl-8 pr-2">
            <div className="flex items-center gap-1">
              <select
                value={cat}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__new__') {
                    setNewCatFor(p.name)
                    setNewCatName('')
                    return
                  }
                  onApplyCategory(p.name, v)
                }}
                title="切换分类（工程文件夹随之移动到对应分类目录）"
                className="min-w-0 flex-1 rounded bg-panel px-1.5 py-1 text-[11px] text-ink outline-none"
              >
                {[...new Set([cat, ...categories])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__new__">＋ 新建分类…</option>
              </select>
              <button
                onClick={onAiCategorize}
                disabled={categorizing}
                title="AI 通读正文推荐分类"
                className="shrink-0 rounded bg-panel px-1.5 py-1 text-[11px] text-accent hover:bg-panel-2 disabled:opacity-40"
              >
                {categorizing ? '判断中…' : '✦ AI'}
              </button>
            </div>
            {newCatFor === p.name && (
              <div className="mt-1 flex items-center gap-1">
                <input
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newCatName.trim()) {
                      onApplyCategory(p.name, newCatName.trim())
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
                    onApplyCategory(p.name, newCatName.trim())
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
        )}
        {isOpen && !renamingFor && renderAssetRows(p)}
      </div>
    )
  }

  return (
    <aside data-tour="left-pane" className="flex w-60 shrink-0 flex-col border-r border-panel-3 bg-panel-2">
      <nav className="flex items-center gap-1 border-b border-panel-3 p-2 text-xs">
        <button
          onClick={() => setLeftTab('tree')}
          className={`rounded px-2.5 py-1 ${leftTab === 'tree' ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`}
        >
          工作树
        </button>
        <button
          onClick={() => setLeftTab('ideas')}
          className={`rounded px-2.5 py-1 ${leftTab === 'ideas' ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`}
        >
          选题库
        </button>
        {leftTab === 'tree' && (
          <button
            onClick={onOpenCatManage}
            title="分类管理：删除（隐藏）/ 恢复 / 重命名"
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-3"
          >
            ⚙️ 管理
          </button>
        )}
      </nav>
      {leftTab === 'ideas' ? (
        <IdeaLibrary version={ideasVersion} onMakeOutline={onMakeOutline} onToast={onToast} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-2 text-xs">
        {/* 钉住：Skill 库（skills/ 目录，轻量启停；导入走设置弹窗） */}
        <div className={rowBase} onClick={() => setSkillsOpen((v) => !v)}>
          <Chevron open={skillsOpen} />
          <span>🧩</span>
          <span className="min-w-0 flex-1 truncate text-ink">Skill 库 ({skills.length})</span>
        </div>
        {skillsOpen && (
          <>
            {skills.length === 0 && <p className="py-1 pl-8 text-[11px] text-ink-dim">skills/ 目录下暂无 Skill</p>}
            {skills.map((s) => (
              <div key={s.name} className={`${rowBase} pl-8`} title={s.description}>
                <span className={`min-w-0 flex-1 truncate ${s.enabled ? 'text-ink-dim' : 'text-ink-dim/50 line-through'}`}>
                  {s.name}
                </span>
                <button
                  onClick={() => void toggleSkill(s.name, s.enabled)}
                  className="hidden shrink-0 rounded px-1 text-[10px] text-ink-dim hover:text-accent group-hover:block"
                >
                  {s.enabled ? '停用' : '启用'}
                </button>
                <button
                  onClick={() => void removeSkill(s.name)}
                  className="hidden shrink-0 rounded px-1 text-ink-dim hover:text-red-400 group-hover:block"
                >
                  🗑
                </button>
              </div>
            ))}
            <button
              onClick={() => onOpenIntegration('skill')}
              className="mb-1 w-full rounded border border-dashed border-panel-3 py-1.5 pl-6 text-left text-ink-dim hover:border-accent hover:text-accent"
            >
              ＋ 导入 Skill…
            </button>
          </>
        )}
        {/* 分类 → 工程 → 资产 */}
        {groups.map((g) => {
          const badge = wechatBadge.byCat[g.category]
          const isOpen = openCats === null || openCats.includes(g.category)
          return (
            <div key={g.category} className="mt-1">
              <div
                onClick={() => {
                  toggleCat(g.category)
                  onSetFilterCat(g.category)
                }}
                className={`${rowBase} ${filterCat === g.category ? 'text-ink' : 'text-ink-dim'} hover:bg-panel-3`}
                title={
                  badge
                    ? `分类「${g.category}」绑定公众号：${badge}；点击选中后新建工程/脑暴立项落此分类`
                    : `点击展开；选中后新建工程/脑暴立项落此分类${wechatBadge.defaultName ? `（未绑定，推送走默认账号 ${wechatBadge.defaultName}）` : ''}`
                }
              >
                <Chevron open={isOpen} />
                <span>📁</span>
                <span className={`min-w-0 flex-1 truncate ${filterCat === g.category ? 'font-bold' : ''}`}>{g.category}</span>
                {badge && (
                  <span className="shrink-0 rounded bg-panel px-1 py-0.5 text-[10px] text-accent" title={`绑定公众号：${badge}`}>
                    {badge}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setCreatingFor(g.category)
                    setNewName('')
                  }}
                  title={`在「${g.category}」下新建工程`}
                  className="hidden shrink-0 rounded px-1 text-ink-dim hover:text-accent group-hover:block"
                >
                  ＋
                </button>
              </div>
              {isOpen && (
                <>
                  {g.projects.length === 0 && creatingFor !== g.category && (
                    <p className="py-0.5 pl-8 text-[11px] text-ink-dim">暂无工程</p>
                  )}
                  {g.projects.map(renderProjectRow)}
                  {creatingFor === g.category && (
                    <div className="flex gap-1 py-1 pl-5 pr-2">
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') createIn(g.category)
                          if (e.key === 'Escape') {
                            setCreatingFor(null)
                            setNewName('')
                          }
                        }}
                        placeholder="工程名"
                        className="min-w-0 flex-1 rounded bg-panel px-1.5 py-1 text-[11px] text-ink outline-none placeholder:text-ink-dim"
                      />
                      <button onClick={() => createIn(g.category)} className="shrink-0 rounded bg-accent px-2 text-white">
                        建
                      </button>
                      <button
                        onClick={() => {
                          setCreatingFor(null)
                          setNewName('')
                        }}
                        className="shrink-0 rounded bg-panel px-2 text-ink-dim hover:text-ink"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
        {/* 底部全局新建：落当前选中分类（与旧列表行为一致） */}
        {creatingFor === '' ? (
          <div className="mt-2 flex gap-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createIn(filterCat === 'all' ? undefined : filterCat)
                if (e.key === 'Escape') {
                  setCreatingFor(null)
                  setNewName('')
                }
              }}
              placeholder={filterCat === 'all' ? '工程名（落未分类）' : `工程名（落「${filterCat}」）`}
              className="min-w-0 flex-1 rounded bg-panel-3 px-2 py-1.5 text-ink outline-none placeholder:text-ink-dim"
            />
            <button onClick={() => createIn(filterCat === 'all' ? undefined : filterCat)} className="shrink-0 rounded bg-accent px-2 text-white">
              建
            </button>
            <button
              onClick={() => {
                setCreatingFor(null)
                setNewName('')
              }}
              className="shrink-0 rounded bg-panel-3 px-2 text-ink-dim hover:text-ink"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setCreatingFor('')
              setNewName('')
            }}
            className="mt-2 w-full rounded border border-dashed border-panel-3 py-2 text-ink-dim hover:border-accent hover:text-accent"
          >
            + 新建图文工程
          </button>
        )}
        </div>
      )}
      {/* 工程右键菜单：打开工程目录 / 置顶（点击遮罩或再次右键关闭） */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 min-w-36 rounded border border-panel-3 bg-panel-2 py-1 text-xs shadow-lg"
            style={{ left: menu.x, top: Math.min(menu.y, window.innerHeight - 90) }}
          >
            <button
              onClick={() => {
                const p = projects.find((x) => x.name === menu.name)
                if (p) openPath(p.dir, null, onToast)
                setMenu(null)
              }}
              className="block w-full px-3 py-1.5 text-left text-ink hover:bg-panel-3"
            >
              📂 打开工程目录
            </button>
            <button
              onClick={() => {
                togglePin(menu.name)
                setMenu(null)
              }}
              className="block w-full px-3 py-1.5 text-left text-ink hover:bg-panel-3"
            >
              📌 {pinned.includes(menu.name) ? '取消置顶' : '置顶'}
            </button>
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
  )
}
