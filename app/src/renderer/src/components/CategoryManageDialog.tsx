import { useEffect, useState, type ReactElement } from 'react'
import type { CategoryPreset, CategoryPresetPatch, PlatformId, SkillInfo } from '@shared/types'
import { PLATFORM_LABELS } from '@shared/platformHtml'
import type { WechatConfig } from '@shared/wechatIpc'

/**
 * 分类管理弹窗：删除（隐藏）/ 恢复 / 重命名分类 / 账号预设（默认写作 Skill、默认分发平台、绑定的公众号）。
 * - 删除 = 隐藏：分类从列表消失，目录与工程保留，可在「已删除」里恢复（预设与自定义同机制）
 * - 重命名：目录 + 工程 meta + 自定义主题 + 账号预设 + 公众号绑定同步
 * - 「未分类」是兜底分类，不可删
 * - 账号预设（账号 = 分类）：分类级默认逐项即选即存，新建该分类的工程自动继承；
 *   公众号凭据本身在「设置 → 推送设置」里管，这里只选绑定哪个号
 */

interface Props {
  categories: string[]
  hidden: string[]
  /** 已安装 Skill 列表（账号预设下拉用） */
  skills: SkillInfo[]
  onClose: () => void
  onToast: (msg: string) => void
  /** 变更成功后刷新（重新拉分类/主题/工程列表） */
  onChanged: () => void
}

const btn =
  'rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap'
const btnDanger = 'rounded px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-950/50 disabled:opacity-40 whitespace-nowrap'
const inputCls =
  'min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-sky-600'

export default function CategoryManageDialog({
  categories,
  hidden,
  skills,
  onClose,
  onToast,
  onChanged
}: Props): ReactElement {
  // 正在重命名的分类 + 输入值；正在确认删除的分类
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 账号预设（分类 → 默认 Skill / 默认平台），挂载时自取
  const [presets, setPresets] = useState<Record<string, CategoryPreset>>({})
  // 公众号账号与绑定（绑定只读账号列表，凭据本身在设置-推送设置里管）
  const [wechat, setWechat] = useState<WechatConfig>({ accounts: [], defaultAccountId: null, bindings: {} })
  useEffect(() => {
    window.api
      .invoke('categoryPreset:list')
      .then(setPresets)
      .catch(() => setPresets({}))
    window.api
      .invoke('wechat:get-config')
      .then(setWechat)
      .catch(() => setWechat({ accounts: [], defaultAccountId: null, bindings: {} }))
  }, [])

  /** 设置分类绑定的公众号账号：accountId 传 null = 解绑（回退默认账号） */
  const doSetBinding = (category: string, accountId: string | null, accountName: string): void => {
    void run(async () => {
      await window.api.invoke('wechat:set-binding', category, accountId)
      setWechat(await window.api.invoke('wechat:get-config'))
      onToast(accountId ? `「${category}」将推送到公众号「${accountName}」` : `「${category}」已解绑，回退默认账号`)
    })
  }

  /** 设置账号预设：单字段增量提交、即选即存；字段传 null = 清除该项 */
  const doSetPreset = (category: string, patch: CategoryPresetPatch, toast: string): void => {
    void run(async () => {
      await window.api.invoke('categoryPreset:set', category, patch)
      setPresets(await window.api.invoke('categoryPreset:list'))
      onToast(toast)
    })
  }

  const run = async (fn: () => Promise<void> | void): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      onToast(`操作失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  const doRename = (oldName: string): void => {
    const newName = renameValue.trim()
    if (!newName || newName === oldName) {
      setRenaming(null)
      return
    }
    void run(async () => {
      await window.api.invoke('project:renameCategory', oldName, newName)
      setRenaming(null)
      setRenameValue('')
      onToast(`分类「${oldName}」已重命名为「${newName}」`)
      onChanged()
    })
  }

  const doDelete = (name: string): void => {
    void run(async () => {
      await window.api.invoke('project:deleteCategory', name)
      setConfirmDel(null)
      onToast(`分类「${name}」已删除（工程与目录保留，可在下方恢复）`)
      onChanged()
    })
  }

  const doRestore = (name: string): void => {
    void run(async () => {
      await window.api.invoke('project:restoreCategory', name)
      onToast(`分类「${name}」已恢复`)
      onChanged()
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[80vh] w-[560px] overflow-auto rounded-xl border border-panel-3 bg-panel-2 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">分类管理</h2>
          <button onClick={onClose} className="rounded px-1.5 text-ink-dim hover:bg-panel-3" title="关闭">
            ✕
          </button>
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-ink-dim">
          删除 = 隐藏：分类下的工程与目录全部保留，随时可恢复。重命名会同步移动工程目录并更新自定义排版、账号预设与公众号绑定。
          每个分类即一个账号，可配账号级默认：新建工程自动挂载的写作 Skill、导出时预选的分发平台、推送草稿用的公众号（凭据在「设置 → 推送设置」里管，这里只选绑哪个号）。
        </p>

        {/* 可见分类 */}
        <div className="mb-2 text-[11px] font-semibold text-ink-dim">当前分类</div>
        <div className="mb-3 space-y-1">
          {categories.map((c) => {
            const isUncat = c === '未分类'
            return (
              <div key={c} className="flex flex-col gap-1 rounded bg-panel px-2 py-1">
                <div className="flex items-center gap-1.5">
                  {renaming === c ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') doRename(c)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        placeholder="新分类名"
                        className={inputCls}
                      />
                      <button onClick={() => doRename(c)} disabled={!renameValue.trim() || busy} className={btn}>
                        保存
                      </button>
                      <button onClick={() => setRenaming(null)} className={btn}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{c}</span>
                      {!isUncat && (
                        <>
                          <button
                            onClick={() => {
                              setRenaming(c)
                              setRenameValue(c)
                            }}
                            disabled={busy}
                            title="重命名分类"
                            className={btn}
                          >
                            ✏️ 重命名
                          </button>
                          {confirmDel === c ? (
                            <>
                              <button onClick={() => doDelete(c)} disabled={busy} className={btnDanger}>
                                确认删除？
                              </button>
                              <button onClick={() => setConfirmDel(null)} className={btn}>
                                取消
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmDel(c)}
                              disabled={busy}
                              title="删除分类（工程保留，可恢复）"
                              className={btnDanger}
                            >
                              🗑 删除
                            </button>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
                {/* 账号预设：新建该分类工程时自动继承的账号级默认（即选即存，随分类重命名迁移） */}
                <div className="flex gap-1">
                  <select
                    value={presets[c]?.style_skill ?? ''}
                    onChange={(e) => {
                      const skill = e.target.value || null
                      doSetPreset(
                        c,
                        { style_skill: skill },
                        skill ? `「${c}」的新工程将自动挂载「${skill}」` : `已清除「${c}」的 Skill 预设`
                      )
                    }}
                    disabled={busy}
                    title="账号预设：新建该分类工程时自动挂载此写作风格"
                    className="min-w-0 flex-1 rounded border border-panel-3 bg-panel-2 px-1 py-0.5 text-[10px] text-ink-dim outline-none"
                  >
                    <option value="">Skill：无（新工程不自动挂载）</option>
                    {skills
                      .filter((s) => s.enabled || presets[c]?.style_skill === s.name)
                      .map((s) => (
                        <option key={s.name} value={s.name}>
                          Skill：{s.name}
                        </option>
                      ))}
                  </select>
                  <select
                    value={presets[c]?.default_platform ?? ''}
                    onChange={(e) => {
                      const platform = (e.target.value || null) as PlatformId | null
                      doSetPreset(
                        c,
                        { default_platform: platform },
                        platform
                          ? `「${c}」导出时默认选「${PLATFORM_LABELS[platform]}」`
                          : `已清除「${c}」的默认平台（回到公众号）`
                      )
                    }}
                    disabled={busy}
                    title="账号预设：该分类工程打开导出框时预选的分发平台（缺省 = 公众号）"
                    className="min-w-0 shrink-0 rounded border border-panel-3 bg-panel-2 px-1 py-0.5 text-[10px] text-ink-dim outline-none"
                  >
                    <option value="">平台：默认（公众号）</option>
                    {(Object.keys(PLATFORM_LABELS) as PlatformId[]).map((p) => (
                      <option key={p} value={p}>
                        平台：{PLATFORM_LABELS[p]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={wechat.bindings[c] ?? ''}
                    onChange={(e) => {
                      const accountId = e.target.value || null
                      const account = wechat.accounts.find((a) => a.id === accountId)
                      doSetBinding(c, accountId, account?.name ?? '')
                    }}
                    disabled={busy || wechat.accounts.length === 0}
                    title={
                      wechat.accounts.length === 0
                        ? '还没有公众号账号：到「设置 → 推送设置」添加'
                        : '该分类推送草稿时用哪个公众号（缺省 = 默认账号）'
                    }
                    className="min-w-0 shrink-0 rounded border border-panel-3 bg-panel-2 px-1 py-0.5 text-[10px] text-ink-dim outline-none disabled:opacity-50"
                  >
                    <option value="">
                      {wechat.accounts.length === 0 ? '公众号：未配置' : '公众号：默认账号'}
                    </option>
                    {wechat.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        公众号：{a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
          {categories.length === 0 && <div className="px-1 text-[11px] text-ink-dim">（暂无分类）</div>}
        </div>

        {/* 已删除（隐藏）分类 */}
        <div className="mb-2 text-[11px] font-semibold text-ink-dim">已删除（可恢复）</div>
        <div className="space-y-1">
          {hidden.map((c) => (
            <div key={c} className="flex items-center gap-1.5 rounded bg-panel px-2 py-1 opacity-70">
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{c}</span>
              <button onClick={() => doRestore(c)} disabled={busy} className={btn}>
                ↩ 恢复
              </button>
            </div>
          ))}
          {hidden.length === 0 && <div className="px-1 text-[11px] text-ink-dim">（无）</div>}
        </div>
      </div>
    </div>
  )
}
