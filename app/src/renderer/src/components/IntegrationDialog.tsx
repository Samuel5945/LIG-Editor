import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { McpAccessCard, SkillInfo } from '@shared/types'
import type { WechatSettings } from '@shared/wechatIpc'

/**
 * 设置弹窗（原 M8 接入 / Skill 管理）
 * - 一键接入卡片：Codex config.toml / Qoder mcp.json 配置片段复制
 * - Skill 管理：列表启停（.disabled 标记）+ 按路径导入 SKILL.md
 * - 推送设置：公众号 AppID / AppSecret（草稿推送凭据）
 */

interface IntegrationDialogProps {
  onToast: (msg: string) => void
  /** Skill 列表有增删/启停后回调（App 刷新挂载下拉） */
  onSkillsChanged: () => void
  onClose: () => void
}

const btnGhost =
  'rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap'

export default function IntegrationDialog({
  onToast,
  onSkillsChanged,
  onClose
}: IntegrationDialogProps): ReactElement {
  const [tab, setTab] = useState<'mcp' | 'skill' | 'push'>('mcp')
  const [card, setCard] = useState<McpAccessCard | null>(null)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [importPath, setImportPath] = useState('')
  // 公众号推送凭据（独立存储，本页签单独保存）
  const [wechat, setWechat] = useState<WechatSettings>({ appId: '', appSecret: '' })
  // 公网 IP 查询（IP 白名单辅助）
  const [fetchingIp, setFetchingIp] = useState(false)
  const [ipResult, setIpResult] = useState<{ ok: boolean; text: string } | null>(null)

  const refreshSkills = useCallback(async () => {
    setSkills(await window.api.invoke('skill:list'))
  }, [])

  useEffect(() => {
    window.api.invoke('mcp:accessCard').then(setCard)
    window.api.invoke('wechat:get-settings').then(setWechat)
    void refreshSkills()
  }, [refreshSkills])

  const saveWechat = useCallback(async () => {
    try {
      await window.api.invoke('wechat:set-settings', wechat)
      onToast('公众号推送设置已保存')
    } catch (err) {
      onToast(`保存失败：${err instanceof Error ? err.message : err}`)
    }
  }, [wechat, onToast])

  const fetchPublicIp = useCallback(async () => {
    setFetchingIp(true)
    setIpResult(null)
    try {
      const res = await window.api.invoke('wechat:public-ip')
      if (res.ok && res.ip) {
        setIpResult({ ok: true, text: res.ip })
        await navigator.clipboard.writeText(res.ip)
        onToast(`公网 IP ${res.ip} 已复制到剪贴板`)
      } else {
        setIpResult({ ok: false, text: res.error ?? '获取失败' })
      }
    } catch (err) {
      setIpResult({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setFetchingIp(false)
    }
  }, [onToast])

  const copy = useCallback(
    async (label: string, text: string) => {
      await navigator.clipboard.writeText(text)
      onToast(`${label} 已复制`)
    },
    [onToast]
  )

  const toggleSkill = useCallback(
    async (s: SkillInfo) => {
      try {
        await window.api.invoke('skill:setEnabled', s.name, !s.enabled)
        await refreshSkills()
        onSkillsChanged()
        onToast(`「${s.name}」已${s.enabled ? '停用' : '启用'}`)
      } catch (err) {
        onToast(`操作失败：${err instanceof Error ? err.message : err}`)
      }
    },
    [refreshSkills, onSkillsChanged, onToast]
  )

  const deleteSkill = useCallback(
    async (s: SkillInfo) => {
      if (!window.confirm(`删除 Skill「${s.name}」？\n整个目录将被移除，不可恢复。`)) return
      try {
        await window.api.invoke('skill:remove', s.name)
        await refreshSkills()
        onSkillsChanged()
        onToast(`「${s.name}」已删除`)
      } catch (err) {
        onToast(`删除失败：${err instanceof Error ? err.message : err}`)
      }
    },
    [refreshSkills, onSkillsChanged, onToast]
  )

  const doImport = useCallback(async () => {
    const src = importPath.trim().replace(/^"|"$/g, '')
    if (!src) return
    try {
      const name = await window.api.invoke('skill:import', src)
      setImportPath('')
      await refreshSkills()
      onSkillsChanged()
      onToast(`Skill「${name}」已导入`)
    } catch (err) {
      onToast(`导入失败：${err instanceof Error ? err.message : err}`)
    }
  }, [importPath, refreshSkills, onSkillsChanged, onToast])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[85vh] w-[620px] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-700 px-4 py-2.5">
          <button
            onClick={() => setTab('mcp')}
            className={`rounded px-2.5 py-1 text-xs ${tab === 'mcp' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            🔌 Agent 接入
          </button>
          <button
            onClick={() => setTab('skill')}
            className={`rounded px-2.5 py-1 text-xs ${tab === 'skill' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            🧩 Skill 管理
          </button>
          <button
            onClick={() => setTab('push')}
            className={`rounded px-2.5 py-1 text-xs ${tab === 'push' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            📮 推送设置
          </button>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 text-xs text-slate-300">
          {tab === 'push' ? (
            <div className="space-y-3">
              <p className="text-slate-400">
                填入公众号开发者 AppID / AppSecret 后，可在导出弹窗一键推送草稿到公众号后台。
              </p>
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">AppID</label>
                <input
                  value={wechat.appId}
                  onChange={(e) => setWechat({ ...wechat, appId: e.target.value })}
                  placeholder="wx 开头的开发者 ID"
                  className="w-full rounded bg-slate-800 px-2.5 py-1.5 text-slate-200 outline-none placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">AppSecret</label>
                <input
                  type="password"
                  value={wechat.appSecret}
                  onChange={(e) => setWechat({ ...wechat, appSecret: e.target.value })}
                  placeholder="开发者密钥（加密存储在本机）"
                  className="w-full rounded bg-slate-800 px-2.5 py-1.5 text-slate-200 outline-none placeholder:text-slate-500"
                />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={saveWechat} className={btnGhost}>
                  💾 保存
                </button>
                <span className="text-[11px] text-slate-500">
                  两处都在公众平台「设置与开发-基本配置」获取
                </span>
              </div>

              <div className="space-y-2 rounded border border-slate-700 bg-slate-800/40 p-3">
                <p className="text-[11px] text-slate-400">
                  IP 白名单辅助：推送草稿需把本机公网 IP 加入公众平台「基本配置-IP 白名单」
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={fetchPublicIp} disabled={fetchingIp} className={btnGhost}>
                    {fetchingIp ? '查询中…' : '🌐 获取本机公网 IP'}
                  </button>
                  <button
                    onClick={() => window.open('https://developers.weixin.qq.com/platform')}
                    className={btnGhost}
                  >
                    🔗 前往微信开发者平台 ↗
                  </button>
                </div>
                {ipResult && (
                  <p className={`break-all text-[11px] ${ipResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                    {ipResult.ok ? `✓ 公网 IP：${ipResult.text}（已复制，粘贴到白名单即可）` : `✗ ${ipResult.text}`}
                  </p>
                )}
              </div>

              <p className="pt-2 text-center text-[11px] text-slate-400">欢迎关注公众号@LIG人生如戏 获取更新</p>
            </div>
          ) : tab === 'mcp' ? (
            card ? (
              <div data-tour="mcp-card" className="space-y-4">
                <p className="text-slate-400">
                  把本应用注册为外部 Agent（Codex / Qoder 等）的 MCP 工具：复制下方片段填进对应配置文件，
                  Agent 即可通过对话完成「建项目 → 生成正文 → 改图 → 导出」全流程。
                </p>
                <section>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-slate-200">Codex — ~/.codex/config.toml</span>
                    <button onClick={() => copy('Codex 片段', card.codexToml)} className={btnGhost}>
                      📋 复制
                    </button>
                  </div>
                  <pre className="selectable overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-5 text-emerald-300">
                    {card.codexToml}
                  </pre>
                </section>
                <section>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-slate-200">Qoder / Claude — mcp.json</span>
                    <button onClick={() => copy('mcp.json 片段', card.qoderJson)} className={btnGhost}>
                      📋 复制
                    </button>
                  </div>
                  <pre className="selectable overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-5 text-sky-300">
                    {card.qoderJson}
                  </pre>
                </section>
                <section>
                  <p className="text-slate-500">
                    进阶：本应用运行期间还开着本地 HTTP 桥（免二开进程），端口与 token 见
                    <span className="selectable mx-1 rounded bg-slate-950 px-1.5 py-0.5 text-[11px]">{card.bridgeFile}</span>
                    ，POST /tool 即可调用同一套工具。
                  </p>
                </section>
              </div>
            ) : (
              <p className="text-slate-500">正在生成接入配置…</p>
            )
          ) : (
            <div className="space-y-3">
              <p className="text-slate-400">
                Skill 是注入 AI 系统提示的方法论文件（SKILL.md）。停用后不出现在挂载下拉，内容保留可随时恢复。
              </p>
              {skills.length === 0 && <p className="text-slate-500">skills/ 目录下暂无 Skill</p>}
              {skills.map((s) => (
                <div key={s.name} className="flex items-center gap-3 rounded border border-slate-700 bg-slate-950/50 p-3">
                  <div className="min-w-0 flex-1">
                    <div className={`font-medium ${s.enabled ? 'text-slate-200' : 'text-slate-500 line-through'}`}>
                      {s.name}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500" title={s.description}>
                      {s.description || '（无描述）'}
                    </div>
                  </div>
                  <button onClick={() => toggleSkill(s)} className={btnGhost}>
                    {s.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    onClick={() => deleteSkill(s)}
                    className="shrink-0 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:border-red-500 hover:text-red-400"
                  >
                    删除
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <input
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') doImport()
                  }}
                  placeholder="粘贴 SKILL.md 文件或其所在文件夹的绝对路径"
                  className="min-w-0 flex-1 rounded bg-slate-800 px-2 py-1.5 text-slate-200 outline-none placeholder:text-slate-500"
                />
                <button onClick={doImport} disabled={!importPath.trim()} className={btnGhost}>
                  ⬇ 导入
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 关于 / 版本更新：任意标签页底部常驻 */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-700 px-4 py-2 text-[11px] text-slate-500">
          <span>立格编辑器 公测版 · @LIG人生如戏的图文创作平台</span>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/aqm857886159/Nomi"
              target="_blank"
              title="参考项目 Nomi：本地优先 + AI 副驾驶 + 无头能力核"
              className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-sky-300"
            >
              📖 Nomi
            </a>
            <button
              onClick={() => window.open('https://ligdesign.win/')}
              title="LIG 立格 Studio 品牌官网"
              className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-sky-300"
            >
              🌐 官网 ↗
            </button>
            <button
              onClick={() => window.open('https://pan.quark.cn/s/ddbcdaaaa634')}
              className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-sky-300"
            >
              📥 版本更新 ↗
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
