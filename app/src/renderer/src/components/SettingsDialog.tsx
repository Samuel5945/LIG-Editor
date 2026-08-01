import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { LlmSettings, LlmTestResult, ModelInfo, ProviderConfig } from '@shared/types'

interface SettingsDialogProps {
  onClose: () => void
}

/** 模型接入设置：多供应商（BaseURL+Key+测试连接），文本/图像默认分开指定 */
export default function SettingsDialog({ onClose }: SettingsDialogProps): ReactElement {
  const [settings, setSettings] = useState<LlmSettings | null>(null)
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
      setSelectedId(s.providers[0]?.id ?? null)
    })
  }, [])

  const provider = settings?.providers.find((p) => p.id === selectedId) ?? null

  const patchProvider = useCallback(
    (patch: Partial<ProviderConfig>) => {
      if (!settings || !selectedId) return
      setSettings({
        ...settings,
        providers: settings.providers.map((p) => (p.id === selectedId ? { ...p, ...patch } : p))
      })
      setTestResult(null)
    },
    [settings, selectedId]
  )

  const addProvider = useCallback(() => {
    if (!settings) return
    const p: ProviderConfig = {
      id: crypto.randomUUID(),
      name: '新供应商',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      textModel: 'gpt-4o-mini',
      imageModel: 'dall-e-3',
      imageApi: 'openai-images'
    }
    setSettings({ ...settings, providers: [...settings.providers, p] })
    setSelectedId(p.id)
  }, [settings])

  const removeProvider = useCallback(() => {
    if (!settings || !selectedId || settings.providers.length <= 1) return
    const rest = settings.providers.filter((p) => p.id !== selectedId)
    setSettings({
      ...settings,
      providers: rest,
      textProviderId: settings.textProviderId === selectedId ? rest[0].id : settings.textProviderId,
      imageProviderId:
        settings.imageProviderId === selectedId ? rest[0].id : settings.imageProviderId
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

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div className="flex h-[520px] w-[720px] overflow-hidden rounded-xl border border-panel-3 bg-panel-2 shadow-2xl">
        {/* 左：供应商列表 */}
        <aside className="flex w-44 shrink-0 flex-col border-r border-panel-3 bg-panel p-2">
          <p className="mb-2 px-1 text-xs font-bold">模型供应商</p>
          <div className="flex-1 overflow-auto">
            {settings.providers.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedId(p.id)
                  setTestResult(null)
                  setModels([])
                  setModelsError(null)
                }}
                className={`mb-1 block w-full truncate rounded px-2 py-1.5 text-left text-xs ${
                  p.id === selectedId ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-3'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <button
            onClick={addProvider}
            className="rounded border border-dashed border-panel-3 py-1.5 text-xs text-ink-dim hover:border-accent hover:text-accent"
          >
            + 添加
          </button>
        </aside>

        {/* 右：编辑区 */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="flex items-center">
            <h2 className="text-sm font-bold">模型接入</h2>
            <button onClick={onClose} className="ml-auto rounded px-2 py-1 text-xs text-ink-dim hover:bg-panel-3">
              关闭 ✕
            </button>
          </div>

          {provider && (
            <div className="mt-1 flex-1 overflow-auto pr-1">
              <label className={label}>名称</label>
              <input className={field} value={provider.name} onChange={(e) => patchProvider({ name: e.target.value })} />

              <label className={label}>Base URL</label>
              <input className={field} value={provider.baseUrl} onChange={(e) => patchProvider({ baseUrl: e.target.value })} placeholder="https://apihub.agnes-ai.com/v1" />

              <label className={label}>API Key</label>
              <input
                className={field}
                type="password"
                value={provider.apiKey}
                onChange={(e) => patchProvider({ apiKey: e.target.value })}
                placeholder="sk-…（加密存储在本机）"
              />

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={label}>文本模型</label>
                  <input className={field} value={provider.textModel} onChange={(e) => patchProvider({ textModel: e.target.value })} />
                </div>
                <div className="flex-1">
                  <label className={label}>图像模型</label>
                  <input className={field} value={provider.imageModel} onChange={(e) => patchProvider({ imageModel: e.target.value })} />
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
                    <label className="mb-1 block text-[11px] text-ink-dim">从列表选文本模型（{models.length} 个）</label>
                    <select
                      className={field}
                      value=""
                      onChange={(e) => { if (e.target.value) patchProvider({ textModel: e.target.value }) }}
                    >
                      <option value="">选择模型…</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] text-ink-dim">从列表选图像模型</label>
                    <select
                      className={field}
                      value=""
                      onChange={(e) => { if (e.target.value) patchProvider({ imageModel: e.target.value }) }}
                    >
                      <option value="">选择模型…</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <label className={label}>图像调用格式</label>
              <select
                className={field}
                value={provider.imageApi}
                onChange={(e) => patchProvider({ imageApi: e.target.value as ProviderConfig['imageApi'] })}
              >
                <option value="openai-images">OpenAI images/generations</option>
                <option value="agnes-images">Agnes images（档位尺寸+比例）</option>
              </select>

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

              <div className="mt-4 border-t border-panel-3 pt-3">
                <p className="text-[11px] text-ink-dim">默认模型（文本 / 图像可用不同供应商）</p>
                <div className="mt-2 flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] text-ink-dim">文本默认</label>
                    <select
                      className={field}
                      value={settings.textProviderId ?? ''}
                      onChange={(e) => setSettings({ ...settings, textProviderId: e.target.value })}
                    >
                      {settings.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}（{p.textModel}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] text-ink-dim">图像默认</label>
                    <select
                      className={field}
                      value={settings.imageProviderId ?? ''}
                      onChange={(e) => setSettings({ ...settings, imageProviderId: e.target.value })}
                    >
                      {settings.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}（{p.imageModel}）
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-panel-3 pt-3">
                <p className="text-[11px] text-ink-dim">
                  联网搜索（全局）：默认免密内置；配搜索 API 后时效与摘要质量更高，API 失败自动降级免密
                </p>
                <div className="mt-2 flex gap-3">
                  <div className="w-40 shrink-0">
                    <label className="mb-1 block text-[11px] text-ink-dim">搜索源</label>
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
                      <label className="mb-1 block text-[11px] text-ink-dim">搜索 API Key</label>
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

            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-2 border-t border-panel-3 pt-3">
            {saveError && <span className="mr-auto break-all text-xs text-red-400">✗ 保存失败：{saveError}</span>}
            {savedFlash && <span className="text-xs text-green-500">✓ 已保存，正在关闭…</span>}
            <button onClick={save} className="rounded bg-accent px-4 py-1.5 text-xs text-white hover:opacity-90">
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
