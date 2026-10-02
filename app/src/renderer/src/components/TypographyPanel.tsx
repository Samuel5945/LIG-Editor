import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Icon } from '../ui/Icon'
import type { ArticleTheme } from '@shared/types'
import { isHexColor } from '@shared/cards'
import { THEME_FIELD_LABELS } from '@shared/categoryThemes'
import { DialogShell } from '../ui/DialogShell'
import { THEME_FIELD_SPECS, THEME_GROUPS, themeFieldRange, type ThemeFieldSpec, type ThemeOverrides } from '@shared/themeFields'

interface TypographyPanelProps {
  open: boolean
  onClose: () => void
  /** 当前生效主题（meta 覆盖已合并进来）：面板上「现在是多少」读这里 */
  theme: ArticleTheme
  /** 工程 meta 上的显式覆盖原值：用来标出「已覆盖 / 跟随主题」 */
  overrides: ThemeOverrides
  /** 没开工程时整面板只读 */
  project: string | null
  category?: string
  /** 写 meta：值覆盖、null 恢复跟随主题 */
  onApply: (patch: ThemeOverrides) => void
  /** 把当前生效整套排版存成分类主题（分类级调性此前只能靠导入/对话生成） */
  onSavePreset?: (name: string) => Promise<void>
  /** 打开中栏「主题库」页签（§5.10：沉淀完直接去库里看效果） */
  onOpenThemeLibrary?: () => void
}

/**
 * 全量排版面板：34 个工程覆盖字段逐个有旋钮。
 * 控件类型、分组、范围、候选全部来自 THEME_FIELD_SPECS——与能力核校验同一份表，
 * 面板能选出来的值，工具侧必然认（themeFields.test.ts 钉着这条）。
 */
export default function TypographyPanel({
  open,
  onClose,
  theme,
  overrides,
  project,
  category,
  onApply,
  onSavePreset,
  onOpenThemeLibrary
}: TypographyPanelProps): ReactElement | null {
  // 草稿只给「边打字边预览」的字段用（滑杆/文本框），失焦或松手才落盘，免得每敲一下就写 project.json
  const [draft, setDraft] = useState<Record<string, string | number>>({})
  const [presetName, setPresetName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setDraft({})
  }, [open])

  const byGroup = useMemo(
    () => THEME_GROUPS.map((g) => ({ ...g, fields: THEME_FIELD_SPECS.filter((s) => s.group === g.id) })),
    []
  )

  if (!open) return null
  const disabled = !project

  const cur = (s: ThemeFieldSpec): string | number | undefined => {
    const d = draft[s.key]
    if (d !== undefined) return d
    const ov = overrides[s.key]
    if (ov !== null && ov !== undefined) return ov
    return (theme as unknown as Record<string, string | number | undefined>)[s.key]
  }
  const overridden = (s: ThemeFieldSpec): boolean => overrides[s.key] !== undefined && overrides[s.key] !== null
  const commit = (key: string, v: string | number | null): void => {
    setDraft((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
    onApply({ [key]: v } as ThemeOverrides)
  }

  return (
    <DialogShell
      icon="sliders"
      title="全量排版"
      hint={project ? `工程「${project}」· 分类「${category ?? '未分类'}」` : '未打开工程'}
      width={720}
      maxHeight="88vh"
      bodyClass="p-0"
      onClose={onClose}
    >

        <div className="selectable thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            {byGroup.map((g) => (
              <section key={g.id}>
                <h4 className="mb-1.5 border-b border-panel-3 pb-1 text-[11px] font-bold text-ink">{g.label}</h4>
                <div className="space-y-1.5">
                  {g.fields.map((s) => (
                    <Row
                      key={s.key}
                      spec={s}
                      value={cur(s)}
                      overridden={overridden(s)}
                      disabled={disabled}
                      onCommit={(v) => commit(s.key, v)}
                      onDraft={(v) => setDraft((d) => ({ ...d, [s.key]: v }))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-panel-3 bg-panel px-4 py-2.5 text-xs">
          <button
            onClick={() => onApply(Object.fromEntries(THEME_FIELD_SPECS.map((s) => [s.key, null])) as ThemeOverrides)}
            disabled={disabled}
            className="rounded px-2.5 py-1 text-ink-dim hover:bg-panel-3 disabled:opacity-40"
            title="清掉本工程全部排版覆盖，整套回到分类主题"
          >
            <Icon name="undo" size={12} className="mr-1.5" />全部跟随主题
          </button>
          {onSavePreset && (
            <div className="ml-auto flex items-center gap-1.5">
              {saveMsg && <span className="max-w-[220px] truncate text-ink-dim">{saveMsg}</span>}
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={category ? `主题名（存入「${category}」）` : '主题名'}
                disabled={disabled || saving}
                className="w-36 rounded bg-panel-3 px-2 py-1 text-ink outline-none placeholder:text-ink-dim disabled:opacity-40"
                title="把当前生效的整套排版存成一套主题（存入当前工程的分类；一个分类可挂多套主题，可在主题库里切换）"
              />
              <button
                onClick={() => {
                  const name = presetName.trim() || category || ''
                  if (!name) {
                    setSaveMsg('先填主题名')
                    return
                  }
                  setSaving(true)
                  setSaveMsg(null)
                  void onSavePreset(name).then(
                    () => {
                      setSaving(false)
                      setSaveMsg(`已存为主题「${name}」`)
                    },
                    (err: unknown) => {
                      setSaving(false)
                      setSaveMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`)
                    }
                  )
                }}
                disabled={disabled || saving}
                className="rounded bg-accent px-2.5 py-1 text-white hover:opacity-90 disabled:opacity-40"
              >
                {saving ? '保存中…' : '存为主题'}
              </button>
            </div>
          )}
          {onOpenThemeLibrary && (
            <button
              onClick={onOpenThemeLibrary}
              title="浏览内置 / 导入 / 面板沉淀的全部主题，可预览与绑定分类"
              className={onSavePreset ? 'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-ink-dim hover:bg-panel-3' : 'ml-auto inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-ink-dim hover:bg-panel-3'}
            >
              <Icon name="layers" size={12} />
              打开主题库
            </button>
          )}
        </div>
    </DialogShell>
  )
}

/** 单行控件：形态由 spec.kind 决定，右侧统一给「跟随主题」退路 */
function Row({
  spec,
  value,
  overridden,
  disabled,
  onCommit,
  onDraft
}: {
  spec: ThemeFieldSpec
  value: string | number | undefined
  overridden: boolean
  disabled: boolean
  onCommit: (v: string | number | null) => void
  onDraft: (v: string | number) => void
}): ReactElement {
  const label = THEME_FIELD_LABELS[spec.key]
  const range = spec.kind === 'number' ? themeFieldRange(spec.key) : undefined
  return (
    <div className="flex items-center gap-2" title={spec.hint}>
      <span className="w-[86px] shrink-0 text-ink-dim">{label}</span>
      {spec.kind === 'enum' && (
        <select
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onCommit(e.target.value)}
          className="min-w-0 flex-1 rounded bg-panel-3 px-1.5 py-1 text-ink outline-none disabled:opacity-40"
        >
          <option value="">跟随主题</option>
          {(spec.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {spec.sentinel && <option value={spec.sentinel.value}>{spec.sentinel.label}</option>}
        </select>
      )}
      {spec.kind === 'color' && (
        <>
          <input
            type="color"
            disabled={disabled || typeof value !== 'string' || !isHexColor(value)}
            value={typeof value === 'string' && isHexColor(value) ? value : '#888888'}
            onChange={(e) => onCommit(e.target.value)}
            className="h-6 w-7 shrink-0 cursor-pointer rounded border border-panel-3 bg-transparent disabled:opacity-40"
          />
          <input
            value={value ?? ''}
            disabled={disabled}
            placeholder={spec.sentinel ? `或 ${spec.sentinel.value}` : '#rrggbb'}
            onChange={(e) => onDraft(e.target.value)}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== 'none' && !isHexColor(v)) onCommit('')
              else if (v) onCommit(v)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="min-w-0 flex-1 rounded bg-panel-3 px-1.5 py-1 font-mono text-ink outline-none disabled:opacity-40"
          />
        </>
      )}
      {spec.kind === 'number' && range && (
        <>
          <input
            type="range"
            min={range[0]}
            max={range[1]}
            step={spec.step ?? 1}
            disabled={disabled}
            value={typeof value === 'number' ? value : range[0]}
            onChange={(e) => onDraft(Number(e.target.value))}
            onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
            onDoubleClick={() => typeof value === 'number' && onCommit(range[0] === value ? range[1] : range[0])}
            className="min-w-0 flex-1"
          />
          <span className="w-[52px] shrink-0 text-right font-mono text-ink">
            {typeof value === 'number' ? `${value}${spec.unit ?? ''}` : '—'}
          </span>
        </>
      )}
      {spec.kind === 'text' && (
        <input
          value={value ?? ''}
          disabled={disabled}
          placeholder={spec.placeholder}
          onChange={(e) => onDraft(e.target.value)}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v) onCommit(v)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 rounded bg-panel-3 px-1.5 py-1 font-mono text-ink outline-none placeholder:text-ink-dim disabled:opacity-40"
        />
      )}
      <button
        onClick={() => onCommit(null)}
        disabled={disabled || !overridden}
        title={overridden ? '恢复跟随分类主题' : '当前已跟随分类主题'}
        className="shrink-0 rounded px-1 py-0.5 text-[10px] text-ink-dim hover:bg-panel-3 disabled:opacity-30"
      >
        {overridden ? '↺' : '·'}
      </button>
    </div>
  )
}
