import { useMemo, useState, type ReactElement } from 'react'
import type { ProjectSummary } from '@shared/types'
import { UNCATEGORIZED } from '@shared/categories'
import { Icon } from '../ui/Icon'
import { Button, Chip, FIELD_SHELL_CLS, MenuItem, PickerButton, Popover, Segmented, StatusDot, useFittingRow } from '../ui/primitives'
import { dotOfStatus, PROJECT_STATUS_TEXT } from '../ui/status'
import { useTreeFlags } from '../ui/useTreeFlags'

/**
 * 工程封面墙（主 PRD §7.13 / UI/UX PRD §5.7，稿 D）：未打开工程时中栏的空态从空壳变成
 * 「以封面为视觉入口的工程网格」——工程视角的入口，与选题看板（选题视角）、日历（时间视角）并存。
 *
 * 卡片构成：封面图（文章取 meta.cover，贴图取首张卡片 PNG）；无封面用**分类主题色 + 标题占位**
 * 兜底并挂「待生成封面」角标，保证整墙视觉不塌；下方工程名 + 状态圆点（与工作树同语义单源）+ 排期 + 字数。
 * 顶条按 2026-09-30 定案分两行：第一行「搜索标题 + 排序」，第二行分类胶囊（强制单行，窄栏横滑不折行）。
 * 点击卡片 = 打开工程并进向导默认落点；右键 = 工程菜单（目录 / 置顶 / 归档，与左栏共用同一份偏好）。
 */

export interface ProjectWallProps {
  projects: ProjectSummary[]
  /** 分类清单（含「全部」由本组件自己加） */
  categories: string[]
  /** 初始分类筛选（跟左栏当前选中分类同步） */
  initialCat?: string
  /** 正在编辑的工程：卡片挂「编辑中」角标——从 ⌂ 回墙时能立刻认出自己从哪来（诊断 11） */
  current?: string
  /** 回创作向导：仅 ⌂ 主动回墙（钉住态）时给，无工程自动显示墙时不需要关闭 */
  onClose?: () => void
  onOpen: (name: string) => void
  /** 新建图文工程（名字由墙上内联输入，落当前选中分类） */
  onCreate: (name: string) => void
  /** 转去创作向导做无工程的脑暴/立项流程 */
  onBrainstorm: () => void
  /** 分类 → 主题强调色（无封面占位卡用它，与工程实际调性同源） */
  accentOf: (category?: string) => string
  onToast: (msg: string) => void
}

type SortKey = 'updated' | 'planned'

/** `short` 只在顶条放不下时使用（§4 长标签降级；title 里保留完整说法） */
const SORTS: { id: SortKey; label: string; short: string }[] = [
  { id: 'updated', label: '最近编辑', short: '更新' },
  { id: 'planned', label: '排期先后', short: '排期' }
]

function assetUrl(dir: string, rel: string): string {
  return 'asset://file/' + encodeURIComponent(`${dir}\\${rel.replace(/\//g, '\\')}`)
}

/** 主题色 → 带透明度的同色：只有 #rrggbb 能安全拼后缀，其它写法（#rgb/命名色/脏值）原样返回，
 *  避免拼出 '#abccc' 这种非法颜色让占位卡整块变透明 */
function tint(color: string, alphaHex: string): string {
  const c = (color || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c + alphaHex : c
}

/** 排期显示：当年只给「月-日」，跨年补年份 */
function shortDate(iso?: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!m || !d) return iso
  return new Date().getFullYear().toString() === y ? `${Number(m)}/${Number(d)}` : `${y}/${Number(m)}/${Number(d)}`
}

export default function ProjectWall({
  projects,
  categories,
  initialCat,
  current,
  onClose,
  onOpen,
  onCreate,
  onBrainstorm,
  accentOf,
  onToast
}: ProjectWallProps): ReactElement {
  const { pinned, archived, togglePin, toggleArchive } = useTreeFlags()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState(initialCat && initialCat !== 'all' ? initialCat : 'all')
  const [sort, setSort] = useState<SortKey>('updated')
  const [menu, setMenu] = useState<{ x: number; y: number; name: string } | null>(null)
  /** 顶条两行的单行测量：bar.narrow=第一行放不下（降级短名/纯图标），chips.overflow=分类胶囊放不下（补「全部分类」入口） */
  const bar = useFittingRow<HTMLDivElement>()
  const chips = useFittingRow<HTMLDivElement>()
  // 空态即入口：新建工程的名字在墙上内联收，不把人赶回左栏找按钮
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  const visible = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const list = projects
      .filter((p) => !archived.includes(p.name))
      .filter((p) => cat === 'all' || (p.category ?? UNCATEGORIZED) === cat)
      .filter((p) => !kw || p.name.toLowerCase().includes(kw))
    const rank = (p: ProjectSummary): number => (p.name === pinned[0] ? 0 : pinned.includes(p.name) ? 1 : 2)
    return [...list].sort((a, b) => {
      // 置顶工程在筛选结果内同样浮前（§7.13）
      const r = rank(a) - rank(b)
      if (r !== 0) return r
      if (sort === 'planned') {
        const av = a.plannedAt ?? '9999-12-31'
        const bv = b.plannedAt ?? '9999-12-31'
        if (av !== bv) return av.localeCompare(bv)
      }
      return b.updated_at.localeCompare(a.updated_at)
    })
  }, [projects, archived, pinned, cat, q, sort])

  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of projects) if (!archived.includes(p.name)) m.set(p.category ?? UNCATEGORIZED, (m.get(p.category ?? UNCATEGORIZED) ?? 0) + 1)
    return m
  }, [projects, archived])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶条第一行：搜索 + 排序（2026-09-30 定案：标题与排序一行，分类胶囊独立一行）。
          字号「大」+ 中栏窄时整行放不下，原先「脑暴新选题」会画到右栏上去（实测 right 1007 > main 929）：
          这里按 §4 逐级降级——搜索框收窄、排序换短名、两只按钮退成纯图标（名称留 title） */}
      <div ref={bar.ref} data-overflow={bar.overflow ? '1' : '0'} className="flex shrink-0 flex-nowrap items-center gap-2 px-4 pt-3">
        <span className="inline-flex shrink-0 items-baseline gap-1.5 text-[13.5px] font-bold text-ink">
          工程封面墙
          <span className="text-[11.5px] font-normal text-ink-dim">{visible.length} 篇</span>
        </span>
        {onClose && (
          <Button size="sm" variant="ghost" icon="compass" onClick={onClose} title="回到当前工程的创作向导">
            {bar.narrow ? '' : '返回创作'}
          </Button>
        )}
        {!creating && (
          <label
            className={`ml-auto inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg ${FIELD_SHELL_CLS} px-2.5 text-[12px] text-ink-dim ${
              bar.narrow ? 'w-[104px]' : 'w-[132px]'
            }`}
          >
            <Icon name="search" size={12} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题"
              aria-label="搜索工程标题"
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-dim"
            />
          </label>
        )}
        <Segmented
          ariaLabel="排序方式"
          value={sort}
          onChange={setSort}
          items={SORTS.map((s) => ({ value: s.id, label: bar.narrow ? s.short : s.label, title: s.label }))}
        />
        {creating ? (
          <span className="inline-flex shrink-0 items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) {
                  onCreate(draft.trim())
                  setCreating(false)
                  setDraft('')
                } else if (e.key === 'Escape') {
                  setCreating(false)
                  setDraft('')
                }
              }}
              placeholder="工程名，Enter 创建"
              aria-label="新工程名"
              className={`h-[30px] shrink-0 rounded-lg border border-panel-3 bg-panel-2 px-2.5 text-[12px] text-ink outline-none focus:border-accent ${
                bar.narrow ? 'w-[132px]' : 'w-[180px]'
              }`}
            />
            <Button size="sm" variant="sec" onClick={() => { setCreating(false); setDraft('') }}>取消</Button>
          </span>
        ) : (
          <>
            <Button size="sm" variant="sec" icon="plus" onClick={() => setCreating(true)} title="新建图文工程">
              {bar.narrow ? '' : '新建工程'}
            </Button>
            <Button size="sm" variant="pri" icon="brain" onClick={onBrainstorm} title="投喂素材脑暴选题，或直接出大纲">
              {bar.narrow ? '' : '脑暴新选题'}
            </Button>
          </>
        )}
      </div>
      {/* 顶条第二行：分类胶囊，强制单行（窄栏横滑 + 边缘渐隐，不折行堆叠）。
          放不下时补一只「全部分类」下拉——横滑只解决看得见，被滑出去的项得能选到 */}
      <div className="flex shrink-0 flex-nowrap items-center gap-2 px-4 py-2">
        <div ref={chips.ref} data-overflow={chips.overflow ? '1' : '0'} className="chip-row flex min-w-0 flex-1 flex-nowrap items-center gap-1.5">
          <Chip on={cat === 'all'} onClick={() => setCat('all')} icon="layers">
            全部 {projects.length - archived.length}
          </Chip>
          {categories.map((c) => (
            <Chip key={c} on={cat === c} onClick={() => setCat(c)} icon="folder" title={`分类「${c}」`}>
              {c} {catCounts.get(c) ?? 0}
            </Chip>
          ))}
        </div>
        {chips.overflow && (
          <PickerButton
            value={cat}
            label="全部分类"
            icon="filter"
            align="right"
            onSelect={setCat}
            items={[
              { value: 'all', label: `全部 ${projects.length - archived.length}`, hint: '显示所有未归档工程' },
              ...categories.map((c) => ({ value: c, label: `${c} ${catCounts.get(c) ?? 0}`, hint: `分类「${c}」` }))
            ]}
          />
        )}
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2.5 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel-3 text-ink-dim">
              <Icon name="image" size={20} />
            </span>
            <p className="text-xs text-ink">{projects.length === 0 ? '还没有工程' : '该筛选条件下没有工程'}</p>
            <p className="max-w-[320px] text-[11.5px] leading-relaxed text-ink-dim">
              {projects.length === 0 ? '先脑暴一轮选题再立项，或直接新建一个图文工程开始写。' : '换个分类或清空搜索试试；已归档的工程在左栏树尾「已归档」区。'}
            </p>
            {projects.length === 0 && (
              <div className="mt-1 flex gap-2">
                <Button size="sm" variant="pri" icon="brain" onClick={onBrainstorm}>
                  开始脑暴
                </Button>
                <Button size="sm" variant="sec" icon="plus" onClick={() => setCreating(true)}>
                  新建工程
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(216px,1fr))] gap-3.5">
            {visible.map((p) => {
              const accent = accentOf(p.category)
              return (
                <button
                  key={p.name}
                  onClick={() => onOpen(p.name)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, name: p.name })
                  }}
                  title={`${p.name}\n${PROJECT_STATUS_TEXT[p.status] ?? p.status}${p.plannedAt ? ` · 排期 ${p.plannedAt}` : ''}`}
                  className="group overflow-hidden rounded-xl border border-panel-3 bg-panel-2 text-left shadow-[0_1px_6px_rgba(0,0,0,.18)] transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-[2px] hover:border-accent hover:shadow-[0_4px_16px_rgba(0,0,0,.22)]"
                >
                  {p.cover ? (
                    <span className="relative block aspect-[2.35] overflow-hidden">
                      <img src={assetUrl(p.dir, p.cover)} alt={p.name} className="h-full w-full object-cover" />
                      <span className="absolute right-2 top-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] text-white">2.35:1</span>
                      {p.name === current && (
                        <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
                          编辑中
                        </span>
                      )}
                    </span>
                  ) : (
                    /* 无封面兜底：分类主题色 + 标题文字占位卡（版式复用封面模板的纯色底逻辑），整墙不塌 */
                    <span
                      className="relative flex aspect-[2.35] items-center justify-center overflow-hidden px-3.5"
                      style={{ background: `linear-gradient(135deg, ${accent} 0%, ${tint(accent, 'cc')} 55%, ${tint(accent, '88')} 100%)` }}
                    >
                      <span className="line-clamp-3 text-center text-[13.5px] font-bold leading-snug text-white [text-shadow:0_1px_4px_rgba(0,0,0,.3)]">
                        {p.name}
                      </span>
                      <span className="absolute right-2 top-2 rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-white">待生成封面</span>
                      {p.name === current && (
                        <span className="absolute left-2 top-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-semibold text-white">
                          编辑中
                        </span>
                      )}
                    </span>
                  )}
                  <span className="block px-3 py-2.5">
                    <span className="block truncate text-[12.5px] font-semibold text-ink">{p.name}</span>
                    <span className="mt-1.5 flex flex-nowrap items-center gap-1.5 text-[11px] text-ink-dim">
                      <StatusDot status={dotOfStatus(p.status)} title={PROJECT_STATUS_TEXT[p.status]} />
                      <span className="shrink-0">{PROJECT_STATUS_TEXT[p.status] ?? p.status}</span>
                      {p.plannedAt && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                          <Icon name="calendar" size={9} />
                          {shortDate(p.plannedAt)}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 tabular-nums">
                        {p.format === 'cards' ? `${p.titlesCount ?? 0} 个标题` : `${p.wordCount ?? 0} 字`}
                      </span>
                      {pinned.includes(p.name) && <Icon name="pin" size={10} className="shrink-0 opacity-70" title="已置顶" />}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 右键菜单：与左栏工程行菜单同三项（目录 / 置顶 / 归档），同一只浮层壳 */}
      {menu && (
        <Popover
          onClose={() => setMenu(null)}
          dismissOnContextMenu
          className="fixed w-44 p-1"
          style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 130) }}
        >
          <MenuItem
            icon="external"
            onClick={() => {
              const p = projects.find((x) => x.name === menu.name)
              if (p) void window.api.invoke('export:openFile', p.dir).catch(() => onToast('目录不存在或已被移除'))
              setMenu(null)
            }}
          >
            打开工程目录
          </MenuItem>
          <MenuItem
            icon="pin"
            onClick={() => {
              togglePin(menu.name)
              setMenu(null)
            }}
          >
            {pinned.includes(menu.name) ? '取消置顶' : '置顶'}
          </MenuItem>
          <MenuItem
            icon="archive"
            onClick={() => {
              toggleArchive(menu.name)
              onToast(archived.includes(menu.name) ? '已恢复到封面墙' : '已归档——左栏树尾「已归档」区可找回')
              setMenu(null)
            }}
          >
            {archived.includes(menu.name) ? '取消归档' : '归档'}
          </MenuItem>
        </Popover>
      )}
    </div>
  )
}
