import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { LlmSettings, LlmTestResult, ModelInfo, ProviderConfig } from '@shared/types'
import { imageFormatFor } from '@shared/imageFormats'
import { isRhythmProvider, providerSiteLinks } from '@shared/providerSites'

interface SettingsDialogProps {
  onClose: () => void
}

type SettingsTab = 'providers' | 'defaults'

/**
 * 模型接入设置（两个标签页，互相解耦）：
 * - 模型供应商：管理接入参数（BaseURL / Key / 模型 / 图像协议 / 测试连接）
 * - 默认模型：独立指定默认文本 LLM 与默认生图模型（含图像协议一键切换），不与供应商列表耦合
 */
export default function SettingsDialog({ onClose }: SettingsDialogProps): ReactElement {
  const [settings, setSettings] = useState<LlmSettings | null>(null)
  const [tab, setTab] = useState<SettingsTab>('providers')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)

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

  /** 置顶集合：基元律动默认恒置顶；其余供应商可手动置顶（均为纯展示，不影响默认模型） */
  const pinnedSet = new Set(settings?.pinnedIds ?? [])
  const isPinned = (p: { id: string; name: string; baseUrl: string }) =>
    isRhythmProvider(p) || pinnedSet.has(p.id)

  /** 展示顺序：基元律动恒首位 → 手动置顶 → 未置顶，各组内按用户拖拽保存的顺序 */
  const displayProviders = settings
    ? [...settings.providers].sort((a, b) => {
        const ra = isRhythmProvider(a) ? 0 : pinnedSet.has(a.id) ? 1 : 2
        const rb = isRhythmProvider(b) ? 0 : pinnedSet.has(b.id) ? 1 : 2
        if (ra !== rb) return ra - rb
        const order = settings.providerOrder ?? []
        const ia = order.indexOf(a.id)
        const ib = order.indexOf(b.id)
        return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
      })
    : []

  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  /** 拖拽落位：重排展示顺序；落在置顶行上 → 该项置顶，落在普通行上 → 取消置顶（基元律动恒置顶） */
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
      if (isPinned(target) && !isRhythmProvider(dragged)) nextPinned.add(dragId)
      if (!isPinned(target)) nextPinned.delete(dragId)
      setSettings({ ...settings, providerOrder: next, pinnedIds: [...nextPinned] })
    },
    [settings, dragId, displayProviders, isPinned]
  )

  /** 手动置顶 / 取消置顶（基元律动不可取消）；置顶时挪到置顶区末尾 */
  const togglePin = useCallback(
    (id: string) => {
      if (!settings) return
      const p = settings.providers.find((x) => x.id === id)
      if (!p || isRhythmProvider(p)) return
      const cur = new Set(settings.pinnedIds ?? [])
      if (cur.has(id)) {
        cur.delete(id)
        setSettings({ ...settings, pinnedIds: [...cur] })
        return
      }
      const display = displayProviders.map((x) => x.id).filter((x) => x !== id)
      let insertAt = display.findIndex((x) => {
        const q = settings.providers.find((pp) => pp.id === x)
        return !!q && !isRhythmProvider(q) && !cur.has(x)
      })
      if (insertAt === -1) insertAt = display.length
      display.splice(insertAt, 0, id)
      cur.add(id)
      setSettings({ ...settings, providerOrder: display, pinnedIds: [...cur] })
    },
    [settings, displayProviders]
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

  const addProvider = useCallback(() => {
    const p: ProviderConfig = {
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
      pinnedIds: settings.pinnedIds?.filter((id) => id !== selectedId)
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

  const runFetchModels = useCallback(async () => {
    if (!provider) return
    setFetchingModels(true)
    setModelsError(null)
    setModels([])
    const result = await window.api.invoke('llm:fetchModels', provider)
    if (result.ok) {
      setModels(result.models)
    } else {
      setModelsError(result.error ?? '未知错误')
    }
    setFetchingModels(false)
  }, [provider])

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

  const field = 'w-full rounded bg-panel px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-dim'
  const label = 'mb-1 mt-3 block text-[11px] text-ink-dim'
  const tabCls = (active: boolean) =>
    `rounded px-3 py-1 text-xs ${active ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'}`

  // 默认模型页：未指定默认供应商时与主进程一致回退到列表第一个
  const textProvider = settings.providers.find((p) => p.id === settings.textProviderId) ?? settings.providers[0] ?? null
  const imageProvider =
    settings.providers.find((p) => p.id === settings.imageProviderId) ?? settings.providers[0] ?? null
  const imageSpec = imageFormatFor(imageProvider?.imageApi)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div className="flex h-[520px] w-[720px] flex-col overflow-hidden rounded-xl border border-panel-3 bg-panel-2 shadow-2xl">
        {/* 顶部：标题 + 标签页 */}
        <div className="flex shrink-0 items-center border-b border-panel-3 px-4 py-2">
          <h2 className="text-sm font-bold">模型接入</h2>
          <div className="ml-4 flex gap-1">
            <button onClick={() => setTab('providers')} className={tabCls(tab === 'providers')}>
              模型供应商
            </button>
            <button onClick={() => setTab('defaults')} className={tabCls(tab === 'defaults')}>
              默认模型
            </button>
          </div>
          <button onClick={onClose} className="ml-auto rounded px-2 py-1 text-xs text-ink-dim hover:bg-panel-3">
            关闭 ✕
          </button>
        </div>

        {tab === 'providers' ? (
          <div className="flex min-h-0 flex-1">
            {/* 左：供应商列表 */}
            <aside className="flex w-44 shrink-0 flex-col border-r border-panel-3 bg-panel p-2">
              <p className="mb-2 px-1 text-xs font-bold">模型供应商</p>
              <div className="flex-1 overflow-auto">
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
                          setModels([])
                          setModelsError(null)
                        }}
                        draggable={!rhythm}
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
                          rhythm
                            ? '默认置顶（不可拖动）'
                            : pinned
                              ? '拖动排序；点 ◆ 取消置顶'
                              : '拖动调整顺序；点 ◇ 置顶'
                        }
                        className={`mb-1 flex w-full items-center rounded px-2 py-1.5 text-left text-xs ${
                          p.id === selectedId ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'
                        } ${rhythm ? '' : 'cursor-grab'} ${
                          dragId && overId === p.id && dragId !== p.id ? 'ring-1 ring-accent' : ''
                        } ${dragId === p.id ? 'opacity-50' : ''}`}
                      >
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!rhythm) togglePin(p.id)
                          }}
                          title={rhythm ? '默认置顶' : pinned ? '取消置顶' : '置顶'}
                          className={`mr-1 shrink-0 text-[10px] leading-none ${
                            pinned ? 'text-accent' : 'text-ink-dim opacity-40 hover:opacity-100'
                          } ${rhythm ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          {pinned ? '◆' : '◇'}
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
              <button
                onClick={addProvider}
                className="rounded border border-dashed border-panel-3 py-1.5 text-xs text-ink-dim hover:border-accent hover:text-accent"
              >
                + 添加
              </button>
            </aside>

            {/* 右：供应商编辑区 */}
            <div className="flex min-w-0 flex-1 flex-col p-4">
              {provider && (
                <div className="mt-1 flex-1 overflow-auto pr-1">
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

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={runFetchModels}
                      disabled={fetchingModels}
                      className="rounded border border-panel-3 px-2.5 py-1 text-[11px] text-ink-dim hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {fetchingModels ? '拉取中…' : '↓ 拉取可用模型'}
                    </button>
                    {modelsError && <span className="text-[11px] text-red-400">✗ {modelsError}</span>}
                  </div>

                  {models.length > 0 && (
                    <div className="mt-2 flex gap-3">
                      <div className="flex-1">
                        <label className="mb-1 block text-[11px] text-ink-dim">
                          从列表选文本模型（{models.length} 个）
                        </label>
                        <select
                          className={field}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) patchProviderById(provider.id, { textModel: e.target.value })
                          }}
                        >
                          <option value="">选择模型…</option>
                          {models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="mb-1 block text-[11px] text-ink-dim">从列表选图像模型</label>
                        <select
                          className={field}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) patchProviderById(provider.id, { imageModel: e.target.value })
                          }}
                        >
                          <option value="">选择模型…</option>
                          {models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

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
                      <button onClick={removeProvider} className="rounded px-2 py-1.5 text-xs text-red-400 hover:bg-panel-3">
                        删除此供应商
                      </button>
                    )}
                  </div>
                  {testResult && (
                    <p className={`mt-2 break-all text-xs ${testResult.ok ? 'text-green-500' : 'text-red-400'}`}>
                      {testResult.ok ? '✓ ' : '✗ '}
                      {testResult.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
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
        )}

        {/* 底部保存（两个标签页共用） */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-panel-3 px-4 py-3">
          {saveError && <span className="mr-auto break-all text-xs text-red-400">✗ 保存失败：{saveError}</span>}
          {savedFlash && <span className="text-xs text-green-500">✓ 已保存，正在关闭…</span>}
          <button onClick={save} className="rounded bg-accent px-4 py-1.5 text-xs text-white hover:opacity-90">
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
