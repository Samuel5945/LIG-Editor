import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { LlmSettings, LlmTestResult, ProviderConfig } from '@shared/types'
import { imageFormatFor } from '@shared/imageFormats'
import {
  DASHSCOPE_PROVIDER_SEED,
  SENSENOVA_PROVIDER_SEED,
  RHYTHM_PROVIDER_SEED,
  AGNES_PROVIDER_SEED,
  isRhythmProvider,
  providerSiteLinks
} from '@shared/providerSites'
import { contextBadge, hasImageInput, modelCapability } from '@shared/modelCatalog'
import { DialogShell } from '../ui/DialogShell'
import { Button, FIELD_CLS, Segmented, Popover, PopoverLabel, MenuItem } from '../ui/primitives'
import { Icon, type IconName } from '../ui/Icon'

/** 模板槽位形状：供应商 id/Key 之外的全套接入参数（四家内置种子的公共形状） */
type ProviderSeed = Omit<ProviderConfig, 'id' | 'apiKey'>

/** 「+ 添加」菜单里的内置模板：四家种子齐全（基元律动置顶展示位由种子数据自带） */
const PROVIDER_TEMPLATES: { label: string; hint: string; seed: ProviderSeed }[] = [
  { label: '商汤日日新', hint: 'Anthropic 兼容协议 · 文本 deepseek-v4-flash · 生图 u1.5-lite', seed: SENSENOVA_PROVIDER_SEED },
  { label: '阿里云百炼', hint: 'OpenAI 兼容 compatible-mode · 文本 qwen3.8-flash', seed: DASHSCOPE_PROVIDER_SEED },
  { label: '基元律动', hint: 'OpenAI 兼容 · 生图 wan2.7-image', seed: RHYTHM_PROVIDER_SEED },
  { label: 'Agnes AI', hint: 'OpenAI 兼容 + Agnes 档位生图 · 文本 agnes-2.5-flash', seed: AGNES_PROVIDER_SEED }
]

interface SettingsDialogProps {
  onClose: () => void
  /** 外观与版本：与顶栏「外观」菜单共用 App 里那一份状态，不另存一套偏好 */
  appearance: {
    mode: 'system' | 'light' | 'dark'
    onMode: (m: 'system' | 'light' | 'dark') => void
    scale: 's' | 'm' | 'l'
    onScale: (v: 's' | 'm' | 'l') => void
    version?: string
    onCheckUpdate?: () => void
  }
  /** Agent 接入 / Skill 库 / 推送设置仍在「一键接入」弹窗里，这里给明面入口 */
  onOpenIntegration: (tab?: 'mcp' | 'skill' | 'push') => void
}

type SettingsTab = 'providers' | 'defaults' | 'appearance' | 'about'

/** 左侧分组导航（§5.12：替代单页长滚） */
const SECTIONS: { id: SettingsTab; label: string; icon: IconName; hint: string }[] = [
  { id: 'providers', label: '模型供应商', icon: 'plug', hint: 'BaseURL / Key / 模型 / 测试连接' },
  { id: 'defaults', label: '默认模型与检索', icon: 'sliders', hint: '默认文本与生图模型、联网搜索源' },
  { id: 'appearance', label: '外观', icon: 'palette', hint: '日/夜间与界面字号，即时生效' },
  { id: 'about', label: '关于', icon: 'info', hint: '版本、更新与官网' }
]

/**
 * 模型接入设置（两个标签页，互相解耦）：
 * - 模型供应商：管理接入参数（BaseURL / Key / 模型 / 图像协议 / 测试连接）
 * - 默认模型：独立指定默认文本 LLM 与默认生图模型（含图像协议一键切换），不与供应商列表耦合
 */
export default function SettingsDialog({ onClose, appearance, onOpenIntegration }: SettingsDialogProps): ReactElement {
  const [settings, setSettings] = useState<LlmSettings | null>(null)
  const [tab, setTab] = useState<SettingsTab>('providers')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  useEffect(() => {
    window.api.invoke('settings:getLlm').then((s) => {
      setSettings(s)
      // 初始选中跟随展示顺序（置顶供应商优先）
      const first = [...s.providers].sort(
        (a, b) => Number(isRhythmProvider(a)) - Number(isRhythmProvider(b))
      )[0]
      setSelectedId(first?.id ?? null)
    })
  }, [])

  const provider = settings?.providers.find((p) => p.id === selectedId) ?? null

  /** 置顶状态：基元律动默认置顶（可手动取消，记 unpinnedIds）；其余默认不置顶（可手动置顶，记 pinnedIds）。
   * 均为纯展示，不影响默认模型 */
  const pinnedSet = new Set(settings?.pinnedIds ?? [])
  const unpinnedSet = new Set(settings?.unpinnedIds ?? [])
  const isPinned = (p: { id: string; name: string; baseUrl: string }) =>
    isRhythmProvider(p) ? !unpinnedSet.has(p.id) : pinnedSet.has(p.id)

  /** 展示层级：基元律动置顶时恒首位(0) → 手动置顶(1) → 未置顶(2) */
  const rankOf = (p: ProviderConfig) => {
    if (isRhythmProvider(p)) return unpinnedSet.has(p.id) ? 2 : 0
    return pinnedSet.has(p.id) ? 1 : 2
  }

  /** 展示顺序：按层级分组，各组内按用户拖拽保存的顺序 */
  const displayProviders = settings
    ? [...settings.providers].sort((a, b) => {
        const ra = rankOf(a)
        const rb = rankOf(b)
        if (ra !== rb) return ra - rb
        const order = settings.providerOrder ?? []
        const ia = order.indexOf(a.id)
        const ib = order.indexOf(b.id)
        return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
      })
    : []

  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  /** 拖拽落位：重排展示顺序；落在置顶行上 → 该项置顶，落在普通行上 → 取消置顶
   * （基元律动默认置顶，取消记 unpinnedIds；其余记 pinnedIds） */
  const onDropProvider = useCallback(
    (targetId: string) => {
      if (!settings || !dragId || dragId === targetId) return
      const display = displayProviders.map((p) => p.id)
      const target = settings.providers.find((p) => p.id === targetId)
      const dragged = settings.providers.find((p) => p.id === dragId)
      if (!display.includes(dragId) || !target || !dragged) return
      const next = display.filter((id) => id !== dragId)
      next.splice(next.indexOf(targetId), 0, dragId)
      const nextPinned = new Set(settings.pinnedIds ?? [])
      const nextUnpinned = new Set(settings.unpinnedIds ?? [])
      if (isRhythmProvider(dragged)) {
        if (isPinned(target)) nextUnpinned.delete(dragId)
        else nextUnpinned.add(dragId)
      } else {
        if (isPinned(target)) nextPinned.add(dragId)
        else nextPinned.delete(dragId)
      }
      setSettings({ ...settings, providerOrder: next, pinnedIds: [...nextPinned], unpinnedIds: [...nextUnpinned] })
    },
    [settings, dragId, displayProviders, isPinned]
  )

  /** 手动置顶 / 取消置顶：基元律动默认置顶，切换记 unpinnedIds；其余记 pinnedIds，置顶时挪到置顶区末尾 */
  const togglePin = useCallback(
    (id: string) => {
      if (!settings) return
      const p = settings.providers.find((x) => x.id === id)
      if (!p) return
      if (isRhythmProvider(p)) {
        const cur = new Set(settings.unpinnedIds ?? [])
        if (cur.has(id)) cur.delete(id)
        else cur.add(id)
        setSettings({ ...settings, unpinnedIds: [...cur] })
        return
      }
      const cur = new Set(settings.pinnedIds ?? [])
      if (cur.has(id)) {
        cur.delete(id)
        setSettings({ ...settings, pinnedIds: [...cur] })
        return
      }
      const display = displayProviders.map((x) => x.id).filter((x) => x !== id)
      let insertAt = display.findIndex((x) => {
        const q = settings.providers.find((pp) => pp.id === x)
        return !!q && rankOf(q) === 2
      })
      if (insertAt === -1) insertAt = display.length
      display.splice(insertAt, 0, id)
      cur.add(id)
      setSettings({ ...settings, providerOrder: display, pinnedIds: [...cur] })
    },
    [settings, displayProviders, rankOf]
  )

  /** 当前选中供应商的官网跳转（仅已知供应商，系统浏览器打开） */
  const siteLinks = providerSiteLinks(provider)

  /** 按 id 打补丁（供应商页与默认模型页共用；函数式更新避免两页互相覆盖） */
  const patchProviderById = useCallback((id: string | null, patch: Partial<ProviderConfig>) => {
    if (!id) return
    setSettings((prev) => {
      if (!prev) return prev
      return { ...prev, providers: prev.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
    })
    setTestResult(null)
  }, [])

  /** 新增供应商槽位：template 传种子则整套带入（含协议/默认模型），Key 一律留待用户粘贴 */
  const addProvider = useCallback((template?: ProviderSeed) => {
    const p: ProviderConfig = template
      ? { id: crypto.randomUUID(), apiKey: '', ...template }
      : {
          id: crypto.randomUUID(),
          name: '新供应商',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          textModel: 'gpt-4o-mini',
          imageModel: 'dall-e-3',
          imageApi: 'openai-images'
        }
    setSettings((prev) => (prev ? { ...prev, providers: [...prev.providers, p] } : prev))
    setSelectedId(p.id)
    setAddMenuOpen(false)
  }, [])

  const removeProvider = useCallback(() => {
    if (!settings || !selectedId || settings.providers.length <= 1) return
    const rest = settings.providers.filter((p) => p.id !== selectedId)
    setSettings({
      ...settings,
      providers: rest,
      textProviderId: settings.textProviderId === selectedId ? rest[0].id : settings.textProviderId,
      imageProviderId: settings.imageProviderId === selectedId ? rest[0].id : settings.imageProviderId,
      providerOrder: settings.providerOrder?.filter((id) => id !== selectedId),
      pinnedIds: settings.pinnedIds?.filter((id) => id !== selectedId),
      unpinnedIds: settings.unpinnedIds?.filter((id) => id !== selectedId)
    })
    setSelectedId(rest[0].id)
  }, [settings, selectedId])

  const runTest = useCallback(async () => {
    if (!provider) return
    setTesting(true)
    setTestResult(null)
    const result = await window.api.invoke('llm:test', provider)
    setTestResult(result)
    setTesting(false)
  }, [provider])

  /** 拉取模型列表：主进程拉取 → 按文本/生图分类 → 落盘缓存；结果同步进本地状态（保存时随设置落盘）。
   * 失败时主进程返回旧缓存（refreshed=false），界面保留上次列表并显示错误 */
  const runFetchModels = useCallback(async () => {
    if (!provider) return
    setFetchingModels(true)
    setModelsError(null)
    const result = await window.api.invoke('llm:fetchModels', provider)
    if (result.ok) {
      patchProviderById(provider.id, {
        models: { text: result.text, image: result.image, updatedAt: result.updatedAt }
      })
    } else {
      setModelsError(result.error ?? '未知错误')
    }
    setFetchingModels(false)
  }, [provider, patchProviderById])

  const save = useCallback(async () => {
    if (!settings) return
    setSaveError(null)
    try {
      await window.api.invoke('settings:setLlm', settings)
      setSavedFlash(true)
      // 给用户一个明确反馈后自动关闭弹窗
      setTimeout(onClose, 800)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [settings, onClose])

  if (!settings) return <></>

  const field = `w-full ${FIELD_CLS}`
  const label = 'mb-1 mt-3 block text-[11px] text-ink-dim'
  const tabCls = (active: boolean) =>
    `rounded px-3 py-1 text-xs ${active ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`

  /** 模型选项后的能力徽章（目录有声明才显示） */
  const capLabel = (id: string): string => {
    if (!provider) return ''
    const c = modelCapability(provider, id)
    const parts = [contextBadge(c), hasImageInput(c) ? '读图' : '', c.reasoning ? '思考' : ''].filter(Boolean)
    return parts.length ? `（${parts.join('·')}）` : ''
  }

  /** 「上次拉取 xx 前」（模型列表缓存时间） */
  const relativeTime = (iso: string): string => {
    const ms = Date.now() - new Date(iso).getTime()
    if (Number.isNaN(ms)) return ''
    const min = Math.floor(ms / 60_000)
    if (min < 1) return '刚刚'
    if (min < 60) return `${min} 分钟前`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} 小时前`
    return `${Math.floor(h / 24)} 天前`
  }

  // 预设模板进「+ 添加」弹出菜单（addMenuOpen 状态在组件顶部 hook 区——早退 return 之后不许再挂 hook）：
  // 新建槽位即带全套接入参数（协议/URL/默认模型），不再出现在编辑区——那里点一下会覆盖正在编辑的
  // 供应商，看着像切换实际是覆盖（误点即改配置）。四家内置种子齐全：商汤（Anthropic 兼容 + 双协议
  // 同域）与百炼（compatible-mode）参数不显然最值得模板化，基元律动/Agnes 一并纳入保持口径一致；
  // Key 一律自行粘贴（商汤首启种子已自动从 ZCode 配置带入）

  // 默认模型页：未指定默认供应商时与主进程一致回退到列表第一个
  const textProvider = settings.providers.find((p) => p.id === settings.textProviderId) ?? settings.providers[0] ?? null
  const imageProvider =
    settings.providers.find((p) => p.id === settings.imageProviderId) ?? settings.providers[0] ?? null
  const imageSpec = imageFormatFor(imageProvider?.imageApi)

  return (
    <DialogShell
      icon="settings"
      title="设置"
      hint={SECTIONS.find((x) => x.id === tab)?.hint}
      width={820}
      maxHeight="88vh"
      panelClass="h-[560px]"
      bodyClass="p-0"
      onClose={onClose}
      footer={
        tab === 'providers' || tab === 'defaults' ? (
          <>
            {saveError && (
              <span className="mr-auto break-all text-xs text-st-bad">
                <Icon name="xCircle" size={12} className="mr-1.5" />
                保存失败：{saveError}
              </span>
            )}
            {savedFlash && (
              <span className="text-xs text-st-done">
                <Icon name="checkCircle" size={12} className="mr-1.5" />
                已保存，正在关闭…
              </span>
            )}
            <Button variant="pri" icon="save" onClick={save}>
              保存
            </Button>
          </>
        ) : (
          <span className="mr-auto text-[11px] text-ink-dim">外观与关于页无需保存</span>
        )
      }
    >
      <div className="flex min-h-0 flex-1">
        {/* 左侧分组导航（§5.12）：替代原来挤在标题栏上的两个标签 */}
        <nav className="flex w-[176px] shrink-0 flex-col gap-0.5 border-r border-panel-3 bg-panel p-2">
          {SECTIONS.map((x) => (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              title={x.hint}
              className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                tab === x.id ? 'bg-accent/15 font-semibold text-accent' : 'text-ink-dim hover:bg-panel-3 hover:text-ink'
              }`}
            >
              <Icon name={x.icon} size={13} />
              <span className="min-w-0 truncate">{x.label}</span>
            </button>
          ))}
          <button
            onClick={() => onOpenIntegration()}
            title="Agent 接入 / Skill 库 / 推送设置在「一键接入」里管"
            className="mt-2 flex items-start gap-2 rounded-md border border-dashed border-panel-3 px-2.5 py-2 text-left text-xs text-ink-dim hover:border-accent hover:text-accent"
          >
            <Icon name="wrench" size={13} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              Agent 接入 / Skill / 推送
              <span className="mt-0.5 block text-[10px] leading-4">在「一键接入」里管</span>
            </span>
            <Icon name="external" size={10} className="mt-0.5" />
          </button>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
        {tab === 'providers' ? (
          <div className="flex min-h-0 flex-1">
            {/* 左：供应商列表 */}
            <aside data-tour="provider-list" className="flex w-44 shrink-0 flex-col border-r border-panel-3 bg-panel p-2">
              <p className="mb-2 px-1 text-xs font-bold">模型供应商</p>
              {/* min-h-0：flex 项默认不肯缩到内容以下，供应商多了会把下方/外层裁掉 */}
              <div className="min-h-0 flex-1 overflow-auto">
                {displayProviders.map((p, i) => {
                  const pinned = isPinned(p)
                  const rhythm = isRhythmProvider(p)
                  const showDivider = i > 0 && !pinned && isPinned(displayProviders[i - 1])
                  return (
                    <div key={p.id}>
                      {showDivider && <div className="mb-1 border-t border-panel-3" />}
                      <button
                        onClick={() => {
                          setSelectedId(p.id)
                          setTestResult(null)
                          setModelsError(null)
                        }}
                        draggable
                        onDragStart={() => setDragId(p.id)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setOverId(p.id)
                        }}
                        onDragLeave={() => setOverId((v) => (v === p.id ? null : v))}
                        onDrop={(e) => {
                          e.preventDefault()
                          onDropProvider(p.id)
                          setDragId(null)
                          setOverId(null)
                        }}
                        onDragEnd={() => {
                          setDragId(null)
                          setOverId(null)
                        }}
                        title={
                          pinned
                            ? rhythm
                              ? '默认置顶；拖动排序，点图钉可取消置顶'
                              : '拖动排序；点图钉取消置顶'
                            : '拖动调整顺序；点图钉置顶'
                        }
                        className={`mb-1 flex w-full cursor-grab items-center rounded px-1.5 py-1.5 text-left text-xs ${
                          p.id === selectedId ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'
                        } ${dragId && overId === p.id && dragId !== p.id ? 'ring-1 ring-accent' : ''} ${
                          dragId === p.id ? 'opacity-50' : ''
                        }`}
                      >
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePin(p.id)
                          }}
                          title={pinned ? (rhythm ? '取消置顶（默认置顶）' : '取消置顶') : '置顶'}
                          className={`mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-sm leading-none hover:bg-panel-3 ${
                            pinned ? 'text-accent' : 'text-ink-dim opacity-50 hover:opacity-100'
                          }`}
                        >
                          {pinned ? '' : ''}
                        </span>
                        <span className="truncate">{p.name}</span>
                        {settings.textProviderId === p.id && (
                          <span className="ml-1 shrink-0 rounded bg-panel-3 px-1 text-[10px] text-accent">文本</span>
                        )}
                        {settings.imageProviderId === p.id && (
                          <span className="ml-1 shrink-0 rounded bg-panel-3 px-1 text-[10px] text-accent">生图</span>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="relative">
                <button
                  onClick={() => setAddMenuOpen((v) => !v)}
                  className="w-full rounded border border-dashed border-panel-3 py-1.5 text-xs text-ink-dim hover:border-accent hover:text-accent"
                >
                  + 添加
                </button>
                {addMenuOpen && (
                  <Popover onClose={() => setAddMenuOpen(false)} className="absolute bottom-full left-0 z-50 mb-1 w-64 p-1">
                    <PopoverLabel>从模板添加（参数整套带入，Key 自行粘贴）</PopoverLabel>
                    <MenuItem icon="plus" onClick={() => addProvider()}>
                      空白（自定义）
                    </MenuItem>
                    {PROVIDER_TEMPLATES.map(({ label, hint, seed }) => (
                      <MenuItem key={seed.name} icon="plug" onClick={() => addProvider(seed)} title={hint}>
                        {label}
                      </MenuItem>
                    ))}
                  </Popover>
                )}
              </div>
            </aside>

            {/* 右：供应商编辑区 */}
            <div className="flex min-w-0 flex-1 flex-col p-4">
              {provider && (
                <div className="mt-1 min-h-0 flex-1 overflow-auto pr-1">
                  <label className={label}>名称</label>
                  <input
                    className={field}
                    value={provider.name}
                    onChange={(e) => patchProviderById(provider.id, { name: e.target.value })}
                  />
                  {siteLinks.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-ink-dim">官网：</span>
                      {siteLinks.map((l) => (
                        <button
                          key={l.url}
                          onClick={() => window.open(l.url)}
                          className="text-[11px] text-accent hover:underline"
                        >
                          {l.label} ↗
                        </button>
                      ))}
                    </div>
                  )}

                  <label className={label}>Base URL</label>
                  <input
                    className={field}
                    value={provider.baseUrl}
                    onChange={(e) => patchProviderById(provider.id, { baseUrl: e.target.value })}
                    placeholder="https://apihub.agnes-ai.com/v1"
                  />

                  <label className={label}>对话协议</label>
                  <select
                    className={field}
                    value={provider.api ?? 'openai-chat-completions'}
                    onChange={(e) => patchProviderById(provider.id, { api: e.target.value as ProviderConfig['api'] })}
                  >
                    <option value="openai-chat-completions">OpenAI 兼容（POST /chat/completions）</option>
                    <option value="anthropic-messages">Anthropic 兼容（POST /messages，思考参数标准化）</option>
                  </select>
                  <p className="mt-1 text-[11px] text-ink-dim">
                    商汤等双协议供应商两个端点共用同一 Base URL 与 Key；生图始终走 OpenAI images
                  </p>

                  <label className={label}>API Key</label>
                  <input
                    className={field}
                    type="password"
                    value={provider.apiKey}
                    onChange={(e) => patchProviderById(provider.id, { apiKey: e.target.value })}
                    placeholder="sk-…（加密存储在本机）"
                  />

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={label}>文本模型</label>
                      <input
                        className={field}
                        value={provider.textModel}
                        onChange={(e) => patchProviderById(provider.id, { textModel: e.target.value })}
                      />
                    </div>
                    <div className="flex-1">
                      <label className={label}>图像模型</label>
                      <input
                        className={field}
                        value={provider.imageModel}
                        onChange={(e) => patchProviderById(provider.id, { imageModel: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={runFetchModels}
                      disabled={fetchingModels}
                      className="rounded border border-panel-3 px-2.5 py-1 text-[11px] text-ink-dim hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {fetchingModels ? '拉取中…' : '↓ 刷新模型列表'}
                    </button>
                    {provider.models?.updatedAt && (
                      <span className="text-[11px] text-ink-dim">
                        上次拉取：{relativeTime(provider.models.updatedAt)}（每次启动自动刷新）
                      </span>
                    )}
                    {modelsError && (
                      <span className="text-[11px] text-st-bad">
                        <Icon name="x" size={12} className="mr-1.5" />
                        {modelsError}
                      </span>
                    )}
                  </div>

                  {(() => {
                    const cached = provider.models
                    if (!cached || (cached.text.length === 0 && cached.image.length === 0)) return null
                    return (
                      <div className="mt-2 flex gap-3">
                        <div className="flex-1">
                          <label className="mb-1 block text-[11px] text-ink-dim">
                            从列表选文本模型（{cached.text.length} 个）
                          </label>
                          <select
                            className={field}
                            value=""
                            onChange={(e) => {
                              if (e.target.value) patchProviderById(provider.id, { textModel: e.target.value })
                            }}
                          >
                            <option value="">选择模型…</option>
                            {cached.text.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.id}
                                {capLabel(m.id)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="mb-1 block text-[11px] text-ink-dim">
                            从列表选图像模型（{cached.image.length} 个）
                          </label>
                          <select
                            className={field}
                            value=""
                            onChange={(e) => {
                              if (e.target.value) patchProviderById(provider.id, { imageModel: e.target.value })
                            }}
                          >
                            <option value="">选择模型…</option>
                            {cached.image.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.id}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )
                  })()}

                  <label className={label}>图像调用格式</label>
                  <select
                    className={field}
                    value={provider.imageApi}
                    onChange={(e) =>
                      patchProviderById(provider.id, { imageApi: e.target.value as ProviderConfig['imageApi'] })
                    }
                  >
                    <option value="openai-images">OpenAI images/generations</option>
                    <option value="agnes-images">Agnes images（档位尺寸+比例）</option>
                    <option value="apimart-images">APIMart 异步任务（gpt-image-2 / nano-banana）</option>
                  </select>
                  <p className="mt-1 text-[11px] text-ink-dim">{imageFormatFor(provider.imageApi).hint}</p>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={runTest}
                      disabled={testing}
                      className="rounded bg-panel-3 px-3 py-1.5 text-xs hover:bg-panel disabled:opacity-50"
                    >
                      {testing ? '测试中…' : '测试连接'}
                    </button>
                    {settings.providers.length > 1 && (
                      <button onClick={removeProvider} className="rounded px-2 py-1.5 text-xs text-st-bad hover:bg-panel-3">
                        删除此供应商
                      </button>
                    )}
                  </div>
                  {testResult && (
                    <p className={`mt-2 break-all text-xs ${testResult.ok ? 'text-st-done' : 'text-st-bad'}`}>
                      {testResult.ok ? ' ' : ' '}
                      {testResult.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : tab === 'defaults' ? (
          /* 默认模型页：与供应商列表解耦，直接指定文本/生图的默认供应商+模型 */
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <p className="text-xs font-bold text-ink">默认文本模型（对话 / 写作 / 脑暴）</p>
            <div className="mt-2 flex gap-3">
              <div className="flex-1">
                <label className={label}>供应商</label>
                <select
                  className={field}
                  value={settings.textProviderId ?? ''}
                  onChange={(e) => setSettings({ ...settings, textProviderId: e.target.value || null })}
                >
                  <option value="">未指定（默认用列表第一个）</option>
                  {displayProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className={label}>模型（{textProvider?.name ?? '—'}）</label>
                <input
                  className={field}
                  value={textProvider?.textModel ?? ''}
                  disabled={!textProvider}
                  onChange={(e) => textProvider && patchProviderById(textProvider.id, { textModel: e.target.value })}
                />
              </div>
            </div>

            <p className="mt-5 border-t border-panel-3 pt-4 text-xs font-bold text-ink">
              默认生图模型（配图 / 封面 / 卡片）
            </p>
            <div className="mt-2 flex gap-3">
              <div className="flex-1">
                <label className={label}>供应商</label>
                <select
                  className={field}
                  value={settings.imageProviderId ?? ''}
                  onChange={(e) => setSettings({ ...settings, imageProviderId: e.target.value || null })}
                >
                  <option value="">未指定（默认用列表第一个）</option>
                  {displayProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className={label}>图像模型（{imageProvider?.name ?? '—'}）</label>
                <input
                  className={field}
                  value={imageProvider?.imageModel ?? ''}
                  disabled={!imageProvider}
                  onChange={(e) => imageProvider && patchProviderById(imageProvider.id, { imageModel: e.target.value })}
                />
              </div>
            </div>

            <label className={label}>图像调用格式（决定生图界面的尺寸/比例选项）</label>
            <select
              className={field}
              value={imageProvider?.imageApi ?? 'agnes-images'}
              disabled={!imageProvider}
              onChange={(e) =>
                imageProvider &&
                patchProviderById(imageProvider.id, { imageApi: e.target.value as ProviderConfig['imageApi'] })
              }
            >
              <option value="openai-images">OpenAI images/generations</option>
              <option value="agnes-images">Agnes images（档位尺寸+比例）</option>
              <option value="apimart-images">APIMart 异步任务（gpt-image-2 / nano-banana）</option>
            </select>
            <p className="mt-1 text-[11px] text-ink-dim">当前格式：{imageSpec.hint}</p>

            <p className="mt-5 border-t border-panel-3 pt-4 text-xs font-bold text-ink">联网搜索（全局）</p>
            <p className="mt-1 text-[11px] text-ink-dim">默认免密内置；配搜索 API 后时效与摘要质量更高，API 失败自动降级免密</p>
            <div className="mt-2 flex gap-3">
              <div className="w-44 shrink-0">
                <label className={label}>搜索源</label>
                <select
                  className={field}
                  value={settings.search.provider}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      search: { ...settings.search, provider: e.target.value as LlmSettings['search']['provider'] }
                    })
                  }
                >
                  <option value="none">免密内置（DDG/Bing）</option>
                  <option value="bocha">博查 Web Search</option>
                  <option value="tavily">Tavily</option>
                </select>
              </div>
              {settings.search.provider !== 'none' && (
                <div className="flex-1">
                  <label className={label}>搜索 API Key</label>
                  <input
                    className={field}
                    type="password"
                    value={settings.search.apiKey}
                    onChange={(e) => setSettings({ ...settings, search: { ...settings.search, apiKey: e.target.value } })}
                    placeholder="加密存储在本机"
                  />
                </div>
              )}
            </div>
          </div>
        ) : tab === 'appearance' ? (
          /* 外观（§5.12）：三分段 + 字号三档，改一处即生效（沿用 App 里那份主题状态） */
          <div className="min-h-0 flex-1 overflow-y-auto thin-scroll p-4">
            <p className="mb-1 text-xs font-bold text-ink">主题</p>
            <p className="mb-2 text-[11px] text-ink-dim">跟随系统会随 Windows 深浅色自动切换；界面字号即时生效。</p>
            <Segmented
              ariaLabel="主题模式"
              value={appearance.mode}
              onChange={appearance.onMode}
              items={[
                { value: 'system', label: '跟随系统' },
                { value: 'light', label: '日间' },
                { value: 'dark', label: '夜间' }
              ]}
            />
            <p className="mb-1 mt-5 text-xs font-bold text-ink">界面字号</p>
            <Segmented
              ariaLabel="界面字号"
              value={appearance.scale}
              onChange={appearance.onScale}
              items={[
                { value: 's', label: '小' },
                { value: 'm', label: '中' },
                { value: 'l', label: '大' }
              ]}
            />
          </div>
        ) : (
          /* 关于：版本 / 检查更新 / 分发入口（与顶栏「版本更新」同一套结果） */
          <div className="min-h-0 flex-1 overflow-y-auto thin-scroll p-4 text-xs">
            <p className="mb-1 text-xs font-bold text-ink">关于立格编辑器</p>
            <p className="leading-relaxed text-ink-dim">
              @LIG人生如戏的图文创作平台公测版。当前版本 <span className="font-mono text-ink">v{appearance.version ?? '—'}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="sec" icon="refresh" onClick={appearance.onCheckUpdate}>
                检查更新
              </Button>
              <Button size="sm" variant="sec" icon="globe" onClick={() => window.open('https://ligdesign.win/')}>
                官网
              </Button>
              <Button size="sm" variant="sec" icon="download" onClick={() => window.open('https://pan.quark.cn/s/1cb400aa407b')}>
                网盘下载
              </Button>
            </div>
            <p className="mt-4 leading-relaxed text-ink-dim">
              设置与工程数据都在本机：模型 Key 加密存储，工程正文即 Markdown 文件，删掉工程目录即彻底移除。
            </p>
          </div>
        )}
        </div>
      </div>
    </DialogShell>
  )
}
