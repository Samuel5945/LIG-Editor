import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml, extractTitle, wrapExportPage } from '@shared/exportHtml'
import type { PushDraftResult } from '@shared/wechatIpc'

/**
 * M7 导出弹窗：手机宽度实时预览 + 复制富文本 / 导出 article.html
 * 预览与导出共用同一套内联样式模板，所见即所得
 */

interface ExportDialogProps {
  project: string
  /** 工程目录绝对路径（预览图片走 asset:// 协议） */
  projectDir: string
  markdown: string
  onToast: (msg: string) => void
  onClose: () => void
}

const btnPrimary =
  'rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap'
const btnGhost =
  'rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap'

export default function ExportDialog({
  project,
  projectDir,
  markdown,
  onToast,
  onClose
}: ExportDialogProps): ReactElement {
  const [busy, setBusy] = useState(false)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  // 推送草稿状态：null=未推 / pushing / 结果
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<PushDraftResult | null>(null)

  // 预览页：图片解析为 asset:// 绝对地址，其余与导出产物完全一致
  const previewHtml = useMemo(() => {
    const doc = mdToDoc(markdown)
    const fragment = docToExportHtml(doc, (src) =>
      /^(data:|https?:)/.test(src)
        ? src
        : 'asset://file/' + encodeURIComponent(`${projectDir}\\${src.replace(/\//g, '\\')}`)
    )
    return wrapExportPage(fragment, extractTitle(doc, project))
  }, [markdown, projectDir, project])

  const copyRich = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.invoke('export:copyRich', project)
      onToast('已复制富文本，去公众号后台正文区直接粘贴')
    } catch (err) {
      onToast(`复制失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }, [busy, project, onToast])

  const exportHtml = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const abs = await window.api.invoke('export:html', project)
      setExportedPath(abs)
      onToast('article.html 已导出到工程目录')
    } catch (err) {
      onToast(`导出失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }, [busy, project, onToast])

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
      const result = await window.api.invoke('wechat:push-draft', { project })
      setPushResult(result)
    } catch (err) {
      setPushResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setPushing(false)
    }
  }, [pushing, busy, project])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[88vh] w-[560px] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-2.5">
          <span className="text-sm text-slate-200">📤 导出（手机宽度预览）</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        {/* 手机宽度预览：375px 视口，白底还原公众号阅读环境 */}
        <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-hidden bg-slate-950/60 p-4">
          <iframe
            title="导出预览"
            srcDoc={previewHtml}
            sandbox=""
            className="h-full w-[375px] shrink-0 rounded-lg border border-slate-700 bg-white"
          />
        </div>

        <div className="shrink-0 border-t border-slate-700 px-4 py-3">
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
                : `✗ 推送失败：${pushResult.error ?? '未知错误'}（常见原因：本机 IP 不在公众号后台 IP 白名单 / AppSecret 填错）`}
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            复制富文本会把图片内嵌进剪贴板，直接粘贴到公众号正文区即可；横滑图集在手机端可左右滑动。
          </p>
        </div>
      </div>
    </div>
  )
}
