import { useMemo, useState, type ReactElement } from 'react'
import type { ArticleTheme, CustomThemeLibrary } from '@shared/types'
import { CATEGORY_THEMES, isDarkColor } from '@shared/categoryThemes'
import { Icon } from '../ui/Icon'
import { Button, Chip, FIELD_SHELL_CLS, PickerButton, useFittingRow } from '../ui/primitives'

/**
 * 主题库（主 PRD §7.12 / UI/UX PRD §5.6，稿 C）：中栏第四页签。
 *
 * 位置定案放中栏不放左栏——主题卡由「样张预览」驱动，左栏 248px 放不下预览网格；
 * 左栏双页签是导航语义，主题库是管理语义。
 *
 * 数据视图层，不落新存储：内置 CATEGORY_THEMES + settings/customThemes.json（v2，一分类可挂多套）
 * 现算，套用关系由 active 指针决定（自定义 > 内置 > 默认，与 resolveArticleTheme 同口径），
 * 本组件只负责让人看见。样张不用色块猜：标题装饰 / 正文 / 引用 / 分隔线 / 加粗各取一段，按该主题真实取值渲染。
 */

export type ThemeSource = 'builtin' | 'import' | 'panel'

export interface ThemeEntry {
  name: string
  theme: ArticleTheme
  source: ThemeSource
  /** 自定义主题的归属分类（内置主题无此字段） */
  category?: string
  /** 该主题当前正被哪些分类套用（active 指针指过来） */
  boundTo: string[]
}

export interface ThemeLibraryProps {
  categories: string[]
  library: CustomThemeLibrary
  /** 当前打开的工程：有工程才允许「从当前工程沉淀」与「绑定」 */
  project: string | null
  projectCategory?: string
  onPreview: (entry: ThemeEntry | null) => void
  /** 绑定 = 把该主题设为分类当前套用（切 active 指针；自定义/内置都只是指过去，不复制不覆盖） */
  onBind: (category: string, entry: ThemeEntry) => void
  /** 解除该分类的套用（回到同名内置/默认调性），主题本体保留在库里 */
  onUnbind: (category: string) => void
  onDelete: (name: string) => void
  onImport: () => void
  /** 打开当前工程的排版面板（「从当前工程沉淀」入口） */
  onSaveFromProject: () => void
  onToast: (msg: string) => void
}

const SOURCE_BADGE: Record<ThemeSource, { label: string; cls: string }> = {
  builtin: { label: '内置', cls: 'bg-panel-3 text-ink-dim' },
  import: { label: '导入', cls: 'bg-[#EEF2FF] text-[#4C6FFF] dark:bg-accent/15 dark:text-accent' },
  panel: { label: '面板沉淀', cls: 'bg-accent/15 text-accent' }
}

/** 样张缩略图：五段真实观感（标题装饰 / 正文 / 引用 / 分隔线 / 加粗），照主题取值渲染 */
function ThemeSwatch({ theme }: { theme: ArticleTheme }): ReactElement {
  const accent = theme.accent || '#0D9488'
  const body = theme.bodyText || 'currentColor'
  const bg = theme.bodyBg
  const h1 = theme.h1Style ?? 'bar'
  const centered = (theme.h1Style ? theme.headingAlign !== 'left' : theme.headingAlign === 'center')
  return (
    <div
      className="h-[104px] overflow-hidden border-b border-panel-3 px-4 py-3"
      style={{ background: theme.pageBg || bg || undefined, fontFamily: theme.fontFamily, lineHeight: theme.lineHeight || 1.9 }}
    >
      <div className={centered ? 'text-center' : 'text-left'}>
        <span
          className="inline-block text-[10.5px] font-bold"
          style={
            h1 === 'pill'
              ? { background: accent, color: '#fff', borderRadius: 999, padding: '2px 10px' }
              : h1 === 'underline'
                ? { borderBottom: `2px solid ${accent}`, paddingBottom: 2 }
                : h1 === 'banner'
                  ? { background: theme.h1Bg || accent, color: isDarkColor(theme.h1Bg || accent) ? '#f5f5f4' : '#333', padding: '3px 10px', width: '100%', textAlign: centered ? 'center' : 'left' }
                  : { color: theme.headingColor || undefined }
          }
        >
          标题装饰
        </span>
      </div>
      {h1 === 'bar' && (
        <div
          className="mt-1 h-[2px] w-8 rounded-full"
          style={{ background: accent, marginLeft: centered ? 'auto' : undefined, marginRight: centered ? 'auto' : undefined }}
        />
      )}
      <div className="mt-2 h-[5px] w-[92%] rounded-sm bg-slate-300/70" style={{ letterSpacing: theme.letterSpacing }} />
      <div className="mt-1.5 h-[5px] w-[70%] rounded-sm bg-slate-300/70" />
      <div
        className="mt-2 border-l-[3px] px-1.5 py-0.5 text-[9.5px]"
        style={{
          borderColor: theme.quoteBorder || accent,
          background: theme.quoteBg || 'rgb(148 163 184 / .12)',
          color: theme.quoteText || body,
          borderRadius: theme.quoteStyle === 'card' ? 6 : '0 4px 4px 0'
        }}
      >
        引用样式
      </div>
      <div
        className="mx-auto mt-2 h-[2px] w-[38%] rounded-full"
        style={{ background: theme.hrColor ? `linear-gradient(90deg, transparent, ${theme.hrColor}, transparent)` : `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <span
        className="mt-2 inline-block text-[9.5px] font-bold"
        style={{
          color: theme.strongColor || accent,
          background: theme.strongStyle === 'highlight' ? `${accent}33` : undefined,
          padding: theme.strongStyle === 'highlight' ? '1px 6px' : undefined,
          borderRadius: 3
        }}
      >
        加粗强调
      </span>
    </div>
  )
}

export default function ThemeLibrary({
  categories,
  library,
  project,
  projectCategory,
  onPreview,
  onBind,
  onUnbind,
  onDelete,
  onImport,
  onSaveFromProject,
  onToast
}: ThemeLibraryProps): ReactElement {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<string>('all')
  /** 顶条与筛选胶囊行的单行测量（降级与「全部筛选」入口的触发条件） */
  const bar = useFittingRow<HTMLDivElement>()
  const chips = useFittingRow<HTMLDivElement>()
  const [previewing, setPreviewing] = useState<string | null>(null)

  /**
   * 分类当前「实际生效」的主题名，与 resolveArticleTheme 的回退链同口径：
   * active 指针 → 同名内置主题兜底 → 无。内置分类不显式绑定时本就套用同名内置主题，
   * 显示上要把这份兜底算进去，不然内置分类在主题库里全显示「尚未套用」。
   */
  const effective = (c: string): string | undefined => {
    const p = library.active[c]
    if (p && (library.themes[p] || p in CATEGORY_THEMES)) return p
    return c in CATEGORY_THEMES ? c : undefined
  }

  /** 内置 + 自定义合并成一张表：同名时自定义覆盖内置（与 resolveArticleTheme 同口径）；
   *  套用关系按实际生效算——一个分类套哪套、一套主题被多少分类共享都在这读出来 */
  const entries = useMemo<ThemeEntry[]>(() => {
    const boundTo = (name: string): string[] => categories.filter((c) => effective(c) === name)
    const out: ThemeEntry[] = []
    for (const [name, theme] of Object.entries(CATEGORY_THEMES)) {
      if (library.themes[name]) continue
      out.push({ name, theme, source: 'builtin', boundTo: boundTo(name) })
    }
    for (const [name, { category, theme }] of Object.entries(library.themes)) {
      const source: ThemeSource = (theme as ArticleTheme & { origin?: ThemeSource }).origin ?? 'import'
      out.push({ name, theme, source, category, boundTo: boundTo(name) })
    }
    return out.sort((a, b) => (a.source === 'builtin' ? -1 : 1) - (b.source === 'builtin' ? -1 : 1) || a.name.localeCompare(b.name, 'zh'))
  }, [library, categories])

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return entries
      .filter((e) => filter === 'all' || (filter === 'builtin' ? e.source === 'builtin' : filter === 'custom' ? e.source !== 'builtin' : e.boundTo.includes(filter) || e.category === filter))
      .filter((e) => !kw || e.name.toLowerCase().includes(kw))
  }, [entries, q, filter])

  const preview = (e: ThemeEntry): void => {
    const next = previewing === e.name ? null : e.name
    setPreviewing(next)
    onPreview(next ? e : null)
  }

  const exportJson = async (e: ThemeEntry): Promise<void> => {
    const json = JSON.stringify(e.theme, null, 2)
    try {
      await navigator.clipboard.writeText(json)
      onToast(`已复制「${e.name}」主题 JSON（${Object.keys(e.theme).length} 个字段）`)
    } catch {
      onToast('复制失败，可改用「绑定到分类」')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶条：搜索 + 两个来源入口（导入 / 从当前工程沉淀）——三条来源在此集中可见。
          字号「大」+ 中栏窄时按 §4 降级：搜索框收窄、两只按钮退成纯图标（名称留 title 与 aria-label） */}
      <div ref={bar.ref} data-overflow={bar.overflow ? '1' : '0'} className="flex shrink-0 flex-nowrap items-center gap-2 px-4 pt-3">
        <span className="inline-flex shrink-0 items-baseline gap-1.5 text-[13.5px] font-bold text-ink">
          主题库
          <span className="text-[11.5px] font-normal text-ink-dim">{entries.length} 套</span>
        </span>
        <label
          className={`ml-auto inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg ${FIELD_SHELL_CLS} px-2.5 text-[12px] text-ink-dim ${
            bar.narrow ? 'w-[104px]' : 'w-[132px]'
          }`}
        >
          <Icon name="search" size={12} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索主题名"
            aria-label="搜索主题名"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-dim"
          />
        </label>
        <Button size="sm" variant="sec" icon="download" onClick={onImport} title="从文章导入：粘贴公众号 HTML 或链接，复用它的排版">
          {bar.narrow ? '' : '从文章导入'}
        </Button>
        <Button
          size="sm"
          variant="sec"
          icon="sliders"
          onClick={onSaveFromProject}
          disabled={!project}
          title={project ? '把当前工程的排版覆盖存成该分类的主题' : '先打开一个工程'}
        >
          {bar.narrow ? '' : '从当前工程沉淀'}
        </Button>
      </div>
      <div className="flex shrink-0 flex-nowrap items-center gap-2 px-4 py-2">
        <div ref={chips.ref} data-overflow={chips.overflow ? '1' : '0'} className="chip-row flex min-w-0 flex-1 flex-nowrap items-center gap-1.5">
          <Chip on={filter === 'all'} onClick={() => setFilter('all')} icon="layers">
            全部 {entries.length}
          </Chip>
          <Chip on={filter === 'builtin'} onClick={() => setFilter('builtin')} icon="package">
            内置 {entries.filter((e) => e.source === 'builtin').length}
          </Chip>
          <Chip on={filter === 'custom'} onClick={() => setFilter('custom')} icon="download">
            自定义 {entries.filter((e) => e.source !== 'builtin').length}
          </Chip>
          {categories.map((c) => (
            <Chip key={c} on={filter === c} onClick={() => setFilter(c)} icon="folder">
              {c}
            </Chip>
          ))}
        </div>
        {chips.overflow && (
          <PickerButton
            value={filter}
            label="全部筛选"
            icon="filter"
            align="right"
            onSelect={setFilter}
            items={[
              { value: 'all', label: `全部 ${entries.length}` },
              { value: 'builtin', label: `内置 ${entries.filter((e) => e.source === 'builtin').length}` },
              { value: 'custom', label: `自定义 ${entries.filter((e) => e.source !== 'builtin').length}` },
              ...categories.map((c) => ({ value: c, label: c, hint: `绑定到分类「${c}」的主题` }))
            ]}
          />
        )}
      </div>

      {previewing && (
        <div className="mx-4 mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-[11.5px] text-accent">
          <Icon name="eye" size={12} />
          正在预览「{previewing}」——只改编辑器观感，不写盘；退出即还原
          <button onClick={() => { setPreviewing(null); onPreview(null) }} className="ml-auto font-semibold hover:underline">
            退出预览
          </button>
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4">
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel-3 text-ink-dim">
              <Icon name="layers" size={20} />
            </span>
            <p className="text-xs text-ink">没有匹配的主题</p>
            <p className="max-w-[320px] text-[11.5px] leading-relaxed text-ink-dim">换个筛选条件，或从一篇文章里导入它的排版。</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(228px,1fr))] gap-3">
            {shown.map((e) => {
              const badge = SOURCE_BADGE[e.source]
              const bound = projectCategory ? effective(projectCategory) === e.name : false
              // 内置兜底态：分类没显式绑定、靠同名内置主题套用中——此时「解除绑定」无从谈起（解了也还是它）
              const builtinFloor =
                bound && e.source === 'builtin' && projectCategory != null && !library.active[projectCategory]
              return (
                <div
                  key={e.name}
                  className="overflow-hidden rounded-xl border border-panel-3 bg-panel-2 shadow-[0_1px_6px_rgba(0,0,0,.18)] transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-accent"
                >
                  <ThemeSwatch theme={e.theme} />
                  <div className="px-3 pb-1 pt-2">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{e.name}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-ink-dim">
                      {e.boundTo.length ? `已套用：${e.boundTo.join('、')}` : '尚未套用到分类'}
                      {e.category && e.category !== e.name ? ` · 归属「${e.category}」` : ''}
                      {` · ${Object.keys(e.theme).length} 项参数`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-0.5 px-2.5 pb-2">
                    <button
                      onClick={() => preview(e)}
                      className={`inline-flex h-[24px] items-center gap-1 rounded px-2 text-[11px] transition-colors ${
                        previewing === e.name ? 'bg-accent/15 font-semibold text-accent' : 'text-ink-dim hover:bg-panel-3'
                      }`}
                      title="不写盘试看效果"
                    >
                      <Icon name="eye" size={11} />
                      {previewing === e.name ? '退出预览' : '预览'}
                    </button>
                    {projectCategory && builtinFloor && (
                      <button
                        disabled
                        className="inline-flex h-[24px] items-center gap-1 rounded px-2 text-[11px] text-ink-dim opacity-60"
                        title="该分类的内置默认排版，本就套用中；换绑其他主题后，这里会出现「解除绑定」"
                      >
                        <Icon name="link" size={11} />
                        内置套用中
                      </button>
                    )}
                    {projectCategory && bound && !builtinFloor && (
                      <button
                        onClick={() => {
                          onUnbind(projectCategory)
                          onToast(`分类「${projectCategory}」已解除套用（主题保留在库里，可再绑回来）`)
                        }}
                        className="inline-flex h-[24px] items-center gap-1 rounded px-2 text-[11px] text-ink-dim hover:bg-panel-3 hover:text-ink"
                        title="解除该分类当前套用（主题保留在库里，可再绑回来）"
                      >
                        <Icon name="link" size={11} />
                        解除绑定
                      </button>
                    )}
                    {projectCategory && !bound && (
                      <button
                        onClick={() => {
                          onBind(projectCategory, e)
                          onToast(`已把「${e.name}」套到分类「${projectCategory}」`)
                        }}
                        className="inline-flex h-[24px] items-center gap-1 rounded px-2 text-[11px] text-ink-dim hover:bg-panel-3 hover:text-ink"
                        title={`把这套参数套到当前工程所属分类「${projectCategory}」`}
                      >
                        <Icon name="link" size={11} />
                        绑定
                      </button>
                    )}
                    <button
                      onClick={() => void exportJson(e)}
                      className="inline-flex h-[24px] items-center gap-1 rounded px-2 text-[11px] text-ink-dim hover:bg-panel-3 hover:text-ink"
                      title="复制主题 JSON（分享/备份）"
                    >
                      <Icon name="copy" size={11} />
                      导出
                    </button>
                    {e.source !== 'builtin' && (
                      <button
                        onClick={() => onDelete(e.name)}
                        className="ml-auto inline-flex h-[24px] items-center gap-1 rounded px-2 text-[11px] text-ink-dim hover:bg-[#FEF2F2] hover:text-st-bad"
                        title="删除自定义主题（内置不可删）"
                      >
                        <Icon name="trash" size={11} />
                        删除
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
