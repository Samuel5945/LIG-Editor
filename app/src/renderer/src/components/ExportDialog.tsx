import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml, extractTitle, wrapExportPage } from '@shared/exportHtml'
import type { ArticleTheme } from '@shared/categoryThemes'
import type { PushDraftResult } from '@shared/wechatIpc'

/**
 * M7 导出弹窗：手机宽度实时预览 + 复制富文本 / 导出 article.html / 推送草稿
 * 预览与导出共用同一套内联样式模板，所见即所得。
 * 配色：预览跟随编辑器 UI 昼夜；发布（复制/推送）固定 day/night 二选一
 * （公众号读者统一看一套，不支持媒体查询）；article.html 可选读者端自动昼夜。
 */

interface ExportDialogProps {
  project: string
  /** 工程目录绝对路径（预览图片走 asset:// 协议） */
  projectDir: string
  markdown: string
  /** 排版调性（分类调性解析结果）：预览与导出产物同源跟色 */
  theme?: ArticleTheme
  /** 编辑器 UI 是否深色：预览跟随昼夜（与编辑器正文区所见一致） */
  uiDark?: boolean
  onToast: (msg: string) => void
  onClose: () => void
}

/** 发布配色二选一：公众号读者统一看一套（不支持媒体查询）；article.html 另有读者端自动昼夜 */
type PubVariant = 'day' | 'night'

const btnPrimary =
  'rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap'
const btnGhost =
  'rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap'
const segBtn = (active: boolean) =>
  `px-2.5 py-1 text-[11px] ${active ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`

export default function ExportDialog({
  project,
  projectDir,
  markdown,
  theme,
  uiDark,
  onToast,
  onClose
}: ExportDialogProps): ReactElement {
  const [busy, setBusy] = useState(false)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  // 推送草稿状态：null=未推 / pushing / 结果
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<PushDraftResult | null>(null)
  // 发布配色（复制/推送固定用）；article.html 默认读者端自动昼夜。
  // 初始值跟随编辑器 UI 昼夜：夜间 UI 默认「夜间配色」，打开弹窗预览与正文区一致
  const [pubVariant, setPubVariant] = useState<PubVariant>(uiDark ? 'night' : 'day')
  const [htmlAuto, setHtmlAuto] = useState(true)

  // 预览页：图片解析为 asset:// 绝对地址，配色跟随发布配色选择（所见即所得——
  // 复制/推送/固定导出的是哪套配色，预览就显示哪套）
  const previewHtml = useMemo(() => {
    const doc = mdToDoc(markdown)
    const fragment = docToExportHtml(
      doc,
      (src) =>
        /^(data:|https?:)/.test(src)
          ? src
          : 'asset://file/' + encodeURIComponent(`${projectDir}\\${src.replace(/\//g, '\\')}`),
      theme,
      pubVariant === 'night'
    )
    return wrapExportPage(fragment, extractTitle(doc, project))
  }, [markdown, projectDir, project, theme, pubVariant])

  const copyRich = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.invoke('export:copyRich', { project, variant: pubVariant })
      onToast(`已复制富文本（${pubVariant === 'night' ? '夜间配色' : '日间配色'}），去公众号后台正文区直接粘贴`)
    } catch (err) {
      onToast(`复制失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }, [busy, project, pubVariant, onToast])

  const exportHtml = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const abs = await window.api.invoke('export:html', {
        project,
        variant: htmlAuto ? 'auto' : pubVariant
      })
      setExportedPath(abs)
      onToast(
        htmlAuto
          ? 'article.html 已导出（读者端自动昼夜：系统深色看夜间配色）'
          : `article.html 已导出（固定${pubVariant === 'night' ? '夜间' : '日间'}配色）`
      )
    } catch (err) {
      onToast(`导出失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }, [busy, project, htmlAuto, pubVariant, onToast])

  const openExported = useCallback(async () => {
    if (!exportedPath) return
    try {
      await window.api.invoke('export:openFile', exportedPath)
    } catch (err) {
      onToast(`打开失败：${err instanceof Error ? err.message : err}`)
    }
  }, [exportedPath, onToast])

  /** 导出并推送草稿：结果展示在弹窗内（mediaId / 错误原因） */
  const pushDraft = useCallback(async () => {
    if (pushing || busy) return
    setPushing(true)
    setPushResult(null)
    try {
      const result = await window.api.invoke('wechat:push-draft', { project, variant: pubVariant })
      setPushResult(result)
    } catch (err) {
      setPushResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setPushing(false)
    }
  }, [pushing, busy, project, pubVariant])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[88vh] w-[560px] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-2.5">
          <span className="text-sm text-slate-200">📤 导出（手机宽度预览）</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        {/* 手机宽度预览：375px 视口，配色跟随编辑器 UI 昼夜（与正文区所见一致） */}
        <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-hidden bg-slate-950/60 p-4">
          <iframe
            title="导出预览"
            srcDoc={previewHtml}
            sandbox=""
            className="h-full w-[375px] shrink-0 rounded-lg border border-slate-700 bg-white"
          />
        </div>

        <div className="shrink-0 border-t border-slate-700 px-4 py-3">
          {/* 发布配色：公众号读者统一看一套（不支持媒体查询），二选一 */}
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span>发布配色：</span>
            <div className="flex overflow-hidden rounded border border-slate-600">
              <button type="button" onClick={() => setPubVariant('day')} className={segBtn(pubVariant === 'day')}>
                ☀️ 日间
              </button>
              <button
                type="button"
                onClick={() => setPubVariant('night')}
                className={`${segBtn(pubVariant === 'night')} border-l border-slate-600`}
              >
                🌙 夜间
              </button>
            </div>
            <label className="ml-1 flex cursor-pointer items-center gap-1 text-slate-400">
              <input
                type="checkbox"
                checked={htmlAuto}
                onChange={(e) => setHtmlAuto(e.target.checked)}
                className="accent-sky-500"
              />
              article.html 读者端自动昼夜
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={copyRich} disabled={busy} className={btnPrimary}>
              📋 复制富文本（粘贴公众号）
            </button>
            <button onClick={exportHtml} disabled={busy} className={btnGhost}>
              💾 导出 article.html
            </button>
            {exportedPath && (
              <button onClick={openExported} className={btnGhost}>
                🌐 浏览器打开
              </button>
            )}
            <button onClick={pushDraft} disabled={pushing || busy} className={btnPrimary}>
              {pushing ? '推送中…' : '🚀 导出并推送草稿'}
            </button>
          </div>
          {pushResult && (
            <p className={`mt-2 break-all text-[11px] ${pushResult.ok ? 'text-green-500' : 'text-red-400'}`}>
              {pushResult.ok
                ? `✓ 草稿已推送到公众号后台，mediaId：${pushResult.mediaId ?? ''}`
                : `✗ 推送失败：${pushResult.error ?? '未知错误'}`}
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            复制富文本会把图片内嵌进剪贴板，直接粘贴到公众号正文区即可；横滑图集在手机端可左右滑动。复制/推送用所选发布配色（公众号读者统一看到该配色）。
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            article.html 勾选「读者端自动昼夜」时，部署到自有网页/博客后读者系统深色自动看夜间配色、浅色看日间配色；取消勾选则固定使用所选发布配色。
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            推送草稿前需在「设置-推送设置」填好 AppID/AppSecret，并把本机公网 IP 加入公众平台 IP 白名单；封面在「标题/封面」页设置。
          </p>
        </div>
      </div>
    </div>
  )
}
