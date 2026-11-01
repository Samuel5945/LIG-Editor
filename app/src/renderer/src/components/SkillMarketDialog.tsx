import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { MarketCatalogState, SkillMarketItem, SkillResolveResult } from '@shared/types'
import { filterMarketEntries, installDirective, marketCategories } from '@shared/skillMarket'
import { DialogShell, DialogFooter } from '../ui/DialogShell'
import { Icon } from '../ui/Icon'
import { Button, Chip, ChipGroup, EmptyState, FIELD_CLS, btnCls } from '../ui/primitives'

/**
 * Skill 市场（v1）：目录浏览 / 搜索过滤 / 预览安装，架在既有安装链路外的一层壳。
 * 目录 = 内置打底 + 在线刷新合并（skill:market:get 秒开不碰网；刷新才拉网），
 * 安装复用对话安装链路：skill:resolve 出预览 → 确认 → skill:installResolved 落盘，
 * 官方预装条目不经网络走包内复制（skill:market:resolveOfficial）。
 * 评分口径：编辑推荐档（人工标注）+ 已安装状态，不假装社区评分。
 */

interface SkillMarketDialogProps {
  installedNames: string[]
  /** 安装成功后通知外层重拉 Skill 库（左栏启停状态随之刷新） */
  onInstalled: () => void
  onToast: (msg: string) => void
  onClose: () => void
}

/** 详情态：当前查看的条目 + 解析中的预览（candidates = 合集来源转选择态） */
interface DetailState {
  item: SkillMarketItem
  resolving: boolean
  result: SkillResolveResult | null
  error: string
}

export function SkillMarketDialog({ installedNames, onInstalled, onToast, onClose }: SkillMarketDialogProps): ReactElement {
  const [catalog, setCatalog] = useState<MarketCatalogState | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [installing, setInstalling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  /** 本会话装过的条目（外层 skills 重拉可能有延迟，本地先标记保证状态如实） */
  const [justInstalled, setJustInstalled] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api
      .invoke('skill:market:get')
      .then(setCatalog)
      .catch((err) => onToast(`市场目录读取失败：${err instanceof Error ? err.message : err}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categories = useMemo(() => (catalog ? marketCategories(catalog.items) : []), [catalog])
  const filtered = useMemo(
    () => (catalog ? filterMarketEntries(catalog.items, query, category) : []),
    [catalog, query, category]
  )
  const isInstalled = (name: string): boolean => installedNames.includes(name) || justInstalled.has(name)

  const doRefresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      setCatalog(await window.api.invoke('skill:market:refresh'))
    } catch (err) {
      onToast(`刷新失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setRefreshing(false)
    }
  }

  const openConfig = async (): Promise<void> => {
    try {
      const cfg = await window.api.invoke('skill:market:getConfig')
      setUrlDraft(cfg.catalogUrl)
      setConfigOpen(true)
    } catch (err) {
      onToast(`读取配置失败：${err instanceof Error ? err.message : err}`)
    }
  }

  const saveConfig = async (): Promise<void> => {
    await window.api.invoke('skill:market:setConfig', urlDraft)
    setConfigOpen(false)
    onToast('目录源已保存，正在刷新')
    await doRefresh()
  }

  /** 进详情即出预览：官方条目走包内复制，其余按 ref 形态走既有解析链路 */
  const resolveItem = async (item: SkillMarketItem, candidateRef?: string): Promise<void> => {
    try {
      let result: SkillResolveResult
      if (!candidateRef && item.official) {
        result = await window.api.invoke('skill:market:resolveOfficial', item.name)
      } else {
        const d = candidateRef ? { source: 'github' as const, ref: candidateRef, name: item.name } : installDirective(item)
        if (!d) throw new Error('条目没有可用的安装来源（ref 缺失或无法识别）')
        result = await window.api.invoke('skill:resolve', d)
      }
      // 只写回仍在看的这个条目，快速换条目时不串台
      setDetail((cur) => (cur && cur.item.name === item.name ? { ...cur, resolving: false, result } : cur))
    } catch (err) {
      setDetail((cur) =>
        cur && cur.item.name === item.name
          ? { ...cur, resolving: false, error: err instanceof Error ? err.message : String(err) }
          : cur
      )
    }
  }

  const openDetail = (item: SkillMarketItem): void => {
    setDetail({ item, resolving: true, result: null, error: '' })
    void resolveItem(item)
  }

  const doInstall = async (): Promise<void> => {
    const result = detail?.result
    if (!result) return
    setInstalling(true)
    try {
      const final = await window.api.invoke('skill:installResolved', result.name, result.content)
      onToast(`已安装 Skill：${final}`)
      setJustInstalled((s) => new Set(s).add(final))
      onInstalled()
      setDetail(null) // 回列表，条目上的「已安装」角标立刻可见
    } catch (err) {
      onToast(`安装失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <DialogShell
      title="Skill 市场"
      icon="package"
      width={720}
      maxHeight="82vh"
      onClose={onClose}
      bodyClass="flex min-h-0 flex-1 flex-col p-0"
      hint={catalog?.onlineAt ? `在线目录 · ${new Date(catalog.onlineAt).toLocaleString()}` : '内置精选目录'}
    >
      {/* 工具条：搜索 + 分类胶囊 + 源设置/刷新 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-panel-3 px-4 py-2.5">
        <div className="relative">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称或描述"
            className={`${FIELD_CLS} w-48 pl-8`}
          />
        </div>
        <ChipGroup className="min-w-0 flex-1">
          <Chip on={category === ''} onClick={() => setCategory('')}>
            全部
          </Chip>
          {categories.map((c) => (
            <Chip key={c} on={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </ChipGroup>
        <Button variant="ghost" size="sm" icon="settings" onClick={() => void openConfig()} title="目录源设置">
          源
        </Button>
        <Button variant="sec" size="sm" icon="refresh" onClick={() => void doRefresh()} disabled={refreshing}>
          {refreshing ? '刷新中…' : '刷新'}
        </Button>
      </div>

      {/* 目录源配置行（默认收起） */}
      {configOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-panel-3 bg-panel px-4 py-2">
          <span className="shrink-0 text-[11px] text-ink-dim">目录源 URL</span>
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="在线目录 JSON 直链（raw / jsdelivr 均可）；留空 = 仅内置目录"
            className={`${FIELD_CLS} min-w-0 flex-1`}
          />
          <Button variant="sec" size="sm" onClick={() => void saveConfig()} disabled={refreshing}>
            保存并刷新
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfigOpen(false)}>
            取消
          </Button>
        </div>
      )}

      {/* 状态如实提示条：未配置源 / 拉取失败回退缓存 / 纯离线 */}
      {catalog?.offlineReason && (
        <p className="flex items-start gap-1.5 border-b border-panel-3 px-4 py-2 text-[11.5px] leading-relaxed text-ink-dim">
          <Icon
            name={catalog.offline ? 'info' : 'alert'}
            size={13}
            className={`mt-0.5 shrink-0 ${catalog.offline ? '' : 'text-st-bad'}`}
          />
          <span className="min-w-0 break-all">{catalog.offlineReason}</span>
        </p>
      )}

      {!catalog ? (
        <p className="flex flex-1 items-center justify-center gap-1.5 text-ink-dim">
          <Icon name="spinner" size={13} className="animate-spin" />
          正在读取目录…
        </p>
      ) : detail ? (
        /* ---- 详情/预览 ---- */
        <>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setDetail(null)} className={btnCls('ghost', 'sm')}>
                <Icon name="chevronLeft" size={12} />
                返回列表
              </button>
              <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-ink-dim">
                {detail.item.official && <span className="rounded bg-accent/15 px-1 py-0.5 text-accent">官方</span>}
                {detail.item.recommended && (
                  <span className="flex items-center gap-0.5 text-accent">
                    <Icon name="star" size={11} />
                    编辑推荐
                  </span>
                )}
                <span>{detail.item.category}</span>
              </span>
            </div>
            <h3 className="mt-2 truncate text-[15px] font-bold text-ink">{detail.item.name}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">{detail.item.description || '（暂无描述）'}</p>
            {detail.resolving && (
              <p className="mt-3 flex items-center gap-1.5 text-ink-dim">
                <Icon name="spinner" size={13} className="animate-spin" />
                正在获取 SKILL.md…
              </p>
            )}
            {detail.error && (
              <p className="mt-3 flex items-start gap-1.5 break-all text-st-bad">
                <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
                {detail.error}
              </p>
            )}
            {detail.result?.candidates?.length ? (
              <div className="mt-3">
                <p className="flex items-center gap-1.5 font-semibold text-ink">
                  <Icon name="package" size={12} />
                  该来源发现 {detail.result.candidates.length} 个 Skill，选择要安装的：
                </p>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {detail.result.candidates.map((c) => (
                    <button
                      key={c.path}
                      onClick={() => void resolveItem(detail.item, c.ref)}
                      className="truncate rounded-lg border border-panel-3 bg-panel px-2.5 py-1.5 text-left text-[12px] text-ink transition-colors hover:border-accent hover:text-accent"
                      title={c.path}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {detail.result && !detail.result.candidates?.length ? (
              <>
                <p className="mt-2 text-[11px] text-ink-dim">
                  来源：{detail.result.origin} · {detail.result.content.length} 字
                  {detail.result.exists ? '（已存在同名 Skill，装完会覆盖）' : ''}
                </p>
                {detail.result.scriptDep && (
                  <p className="mt-1 break-all text-st-bad">
                    <Icon name="alert" size={12} className="mr-1" />
                    检测到依赖脚本执行（{detail.result.scriptDep}），本应用只能注入提示词、无法执行脚本，已阻止安装
                  </p>
                )}
                <pre className="thin-scroll mt-2 max-h-[46vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-panel-3 bg-panel p-2.5 text-[11px] leading-relaxed text-ink">
                  {detail.result.content}
                </pre>
              </>
            ) : null}
          </div>
          {detail.result && !detail.result.candidates?.length && (
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={onClose}>
                关闭
              </Button>
              {!detail.result.scriptDep && (
                <Button variant="pri" size="sm" icon="download" onClick={() => void doInstall()} disabled={installing}>
                  {installing ? '安装中…' : detail.result.exists ? '覆盖安装' : '安装'}
                </Button>
              )}
            </DialogFooter>
          )}
        </>
      ) : (
        /* ---- 目录列表 ---- */
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid items-stretch gap-2 sm:grid-cols-2">
            {filtered.map((item) => {
              const installed = isInstalled(item.name)
              return (
                <button
                  key={`${item.origin}:${item.name}`}
                  onClick={() => openDetail(item)}
                  className="rounded-lg border border-panel-3 bg-panel px-3 py-2.5 text-left transition-colors hover:border-accent/60"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{item.name}</span>
                    {item.official && <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent">官方</span>}
                    <span className="ml-auto shrink-0 text-[10px] text-ink-dim">{item.category}</span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-[11.5px] leading-relaxed text-ink-dim">
                    {item.description || '（暂无描述）'}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5">
                    {item.recommended && (
                      <span className="flex items-center gap-0.5 text-[10.5px] text-accent" title="编辑推荐：收录时人工标注">
                        <Icon name="star" size={11} />
                        编辑推荐
                      </span>
                    )}
                    {installed ? (
                      <span className="flex items-center gap-0.5 text-[10.5px] text-st-done">
                        <Icon name="checkCircle" size={11} />
                        已安装
                      </span>
                    ) : (
                      <span className="text-[10.5px] text-ink-dim">未安装</span>
                    )}
                    {item.origin === 'online' && <span className="ml-auto text-[10px] text-ink-dim/70">在线</span>}
                  </span>
                </button>
              )
            })}
          </div>
          {filtered.length === 0 && <EmptyState icon="search" title="没有匹配的 Skill" hint="换个关键词或分类试试" />}
        </div>
      )}
    </DialogShell>
  )
}
