import { useMemo, useState, type ReactElement } from 'react'
import { parseThemeFromHtml, type ParsedTheme } from '@shared/themeParse'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml } from '@shared/exportHtml'
import type { ArticleTheme } from '@shared/types'

/**
 * 🎨 导入排版弹窗：粘贴公众号文章 HTML 或链接 → 本地启发式提取排版调性 →
 * 迷你预览确认 → 命名保存为「自定义主题 + 同名分类」，当前工程切到该分类即套用。
 */

interface Props {
  onClose: () => void
  onSaved: (name: string) => void
  onToast: (msg: string) => void
}

/** 预览用固定样例，不依赖当前工程 */
const SAMPLE = `# 导入排版预览

这是**加粗重点**与普通正文，用来查看字距与行距的节奏。

## 小节标题

> 引用一句金句，看看引用形态。

---

收尾：**排版即气质**。
`

const btnPrimary =
  'rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap'
const btnGhost =
  'rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap'
const inputCls =
  'w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-600'

export default function ThemeImportDialog({ onClose, onSaved, onToast }: Props): ReactElement {
  const [html, setHtml] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [parsed, setParsed] = useState<ParsedTheme | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchUrl = async (): Promise<void> => {
    if (!url.trim() || busy) return
    setBusy(true)
    try {
      const text = await window.api.invoke('customTheme:fetchUrl', url.trim())
      setHtml(text)
      onToast(`已抓取 ${text.length.toLocaleString()} 字符，正在解析排版…`)
    } catch (err) {
      onToast(`抓取失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  const parse = (): void => {
    if (!html.trim()) {
      onToast('先粘贴 HTML 或输入链接抓取')
      return
    }
    try {
      const p = parseThemeFromHtml(html)
      setParsed(p)
      setName(p.name)
    } catch (err) {
      onToast(`解析失败：${err instanceof Error ? err.message : err}`)
    }
  }

  const previewHtml = useMemo(() => {
    if (!parsed) return ''
    const fragment = docToExportHtml(mdToDoc(SAMPLE), (src) => src, parsed.theme)
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#e2e8f0;padding:12px;">
<div style="max-width:375px;margin:0 auto;">${fragment}</div>
</body></html>`
  }, [parsed])

  const save = async (): Promise<void> => {
    if (!parsed || !name.trim() || saving) return
    setSaving(true)
    try {
      const theme: ArticleTheme = { ...parsed.theme }
      await window.api.invoke('customTheme:save', name.trim(), theme)
      onSaved(name.trim())
      onToast(`已保存主题「${name.trim()}」，把工程切到该分类即可套用`)
      onClose()
    } catch (err) {
      onToast(`保存失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[86vh] w-[760px] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-2.5">
          <span className="text-sm text-slate-200">🎨 导入排版（粘贴 HTML / 公众号链接）</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左：输入 + 解析结果 */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void fetchUrl()}
                placeholder="公众号文章链接（可选）"
                className={inputCls}
              />
              <button onClick={() => void fetchUrl()} disabled={busy || !url.trim()} className={btnGhost}>
                {busy ? '抓取中…' : '抓取'}
              </button>
            </div>
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder="把公众号文章的 HTML 源码粘贴到这里（微信编辑器里选「复制」→ 粘贴到文本文件后复制源码，或直接用网页另存）&#10;&#10;也可以直接粘贴链接抓取。"
              className="min-h-0 flex-1 resize-none rounded border border-slate-700 bg-slate-800 p-2 font-mono text-[11px] leading-relaxed text-slate-300 outline-none focus:border-sky-600"
            />
            <div className="flex gap-2">
              <button onClick={parse} disabled={!html.trim() || busy} className={btnPrimary}>
                🔍 解析排版
              </button>
              {parsed && (
                <>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="主题/分类名"
                    className={`${inputCls} max-w-[220px]`}
                  />
                  <button onClick={() => void save()} disabled={saving || !name.trim()} className={btnPrimary}>
                    {saving ? '保存中…' : '💾 保存为主题'}
                  </button>
                </>
              )}
            </div>
            {parsed && (
              <div className="shrink-0 rounded border border-slate-700 bg-slate-800/60 p-2 text-[11px] leading-relaxed text-slate-300">
                <p className="mb-1 text-slate-400">识别到的排版：</p>
                {parsed.summary.map((s) => (
                  <p key={s} className="text-slate-300">
                    · {s}
                  </p>
                ))}
                <p className="mt-1 text-slate-500">保存后自动建同名分类，把工程切到该分类即套用（也可在对话里让 AI 直接导入）。</p>
              </div>
            )}
          </div>

          {/* 右：手机宽度迷你预览 */}
          <div className="flex w-[380px] shrink-0 flex-col border-l border-slate-700">
            <p className="shrink-0 border-b border-slate-700 px-3 py-1.5 text-[11px] text-slate-500">
              预览（375px）
            </p>
            <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-slate-950/60 p-2">
              {previewHtml ? (
                <iframe title="排版预览" srcDoc={previewHtml} sandbox="" className="w-[375px] shrink-0 rounded border border-slate-700 bg-white" />
              ) : (
                <p className="mt-8 text-xs text-slate-600">解析后这里显示排版效果</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
