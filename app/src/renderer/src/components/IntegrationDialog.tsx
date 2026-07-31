import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { McpAccessCard, SkillInfo } from '@shared/types'

/**
 * M8 接入 / Skill 管理弹窗
 * - 一键接入卡片：Codex config.toml / Qoder mcp.json 配置片段复制
 * - Skill 管理：列表启停（.disabled 标记）+ 按路径导入 SKILL.md
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
  const [tab, setTab] = useState<'mcp' | 'skill'>('mcp')
  const [card, setCard] = useState<McpAccessCard | null>(null)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [importPath, setImportPath] = useState('')

  const refreshSkills = useCallback(async () => {
    setSkills(await window.api.invoke('skill:list'))
  }, [])

  useEffect(() => {
    window.api.invoke('mcp:accessCard').then(setCard)
    void refreshSkills()
  }, [refreshSkills])

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
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 text-xs text-slate-300">
          {tab === 'mcp' ? (
            card ? (
              <div className="space-y-4">
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
      </div>
    </div>
  )
}
