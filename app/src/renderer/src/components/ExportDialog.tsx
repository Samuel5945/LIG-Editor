import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml, exportPageBg, extractTitle, wrapExportPage } from '@shared/exportHtml'
import { docToPlatformHtml, wrapPlatformPage, PLATFORM_LABELS } from '@shared/platformHtml'
import type { ArticleTheme } from '@shared/categoryThemes'
import type { PlatformId } from '@shared/types'
import type { PushDraftResult } from '@shared/wechatIpc'

/**
 * M7 导出弹窗：手机宽度实时预览 + 复制富文本 / 导出 article.html / 推送草稿
 * 预览与导出共用同一套内联样式模板，所见即所得。
 * 配色：预览跟随所选发布配色；发布（复制/推送）默认日间——日间排版推到公众号后，
 * 微信夜间自动变深（手调深色排版在公众号夜间无法显示）；夜间配色为算法变深版，
 * 主要用于 article.html 固定夜间导出（公众号不支持媒体查询，读者统一看一套）。
 */

interface ExportDialogProps {
  project: string
  /** 工程目录绝对路径（预览图片走 asset:// 协议） */
  projectDir: string
  markdown: string
  /** 排版调性（分类调性解析结果）：预览与导出产物同源跟色 */
  theme?: ArticleTheme
  /** 所属分类（= 账号）：用于取账号预设里预选的分发平台 */
  category?: string
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
  category,
  onToast,
  onClose
}: ExportDialogProps): ReactElement {
  const [busy, setBusy] = useState(false)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  // 交稿产物路径（Word/PDF 导出后展示打开按钮）
  const [docPath, setDocPath] = useState<string | null>(null)
  // 推送草稿状态：null=未推 / pushing / 结果
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<PushDraftResult | null>(null)
  // 发布配色（复制/推送固定用）；article.html 默认读者端自动昼夜。
  // 默认固定日间：日间排版推到公众号后，微信夜间会自动变深（推荐工作流）；
  // 夜间配色为算法变深版，主要用于 article.html 固定夜间导出
  const [pubVariant, setPubVariant] = useState<PubVariant>('day')
  const [htmlAuto, setHtmlAuto] = useState(true)
  // 分发目标平台（M11 多平台分发）：影响「复制富文本」与预览形态；公众号推送始终走公众号画像
  const [platform, setPlatform] = useState<PlatformId>('wechat')
  // 账号（分类）预设了默认平台则预选它，省掉每次导出重挑一遍
  useEffect(() => {
    if (!category) return
    let alive = true
    window.api
      .invoke('categoryPreset:list')
      .then((presets) => {
        const preset = presets[category]?.default_platform
        if (alive && preset) setPlatform(preset)
      })
      .catch(() => {
        // 预设读不到就维持公众号，不打扰
      })
    return () => {
      alive = false
    }
  }, [category])

  // 预览页：图片解析为 asset:// 绝对地址，配色跟随发布配色选择（所见即所得——
  // 复制/推送/固定导出的是哪套配色，预览就显示哪套）；
  // 非公众号平台按平台画像渲染（知乎零样式语义结构 / 头条·百家保守内联），白底桌面专栏宽
  const previewHtml = useMemo(() => {
    const doc = mdToDoc(markdown)
    const resolveAsset = (src: string): string =>
      /^(data:|https?:)/.test(src)
        ? src
        : 'asset://file/' + encodeURIComponent(`${projectDir}\\${src.replace(/\//g, '\\')}`)
    if (platform === 'wechat') {
      const fragment = docToExportHtml(doc, resolveAsset, theme, pubVariant === 'night')
      // 页面外壳背景跟随所选配色变体：夜间深底、日间白底/浅卡（与正文片段同源，整页一体）
      return wrapExportPage(fragment, extractTitle(doc, project), exportPageBg(theme, pubVariant === 'night'))
    }
    const fragment = docToPlatformHtml(doc, resolveAsset, theme, platform)
    return wrapPlatformPage(fragment, extractTitle(doc, project))
  }, [markdown, projectDir, project, theme, pubVariant, platform])

  const copyRich = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.invoke('export:copyRich', { project, variant: pubVariant, platform })
      onToast(
        platform === 'wechat'
          ? `已复制富文本（${pubVariant === 'night' ? '夜间配色' : '日间配色'}），去公众号后台正文区直接粘贴`
          : `已复制${PLATFORM_LABELS[platform]}适配格式，去${PLATFORM_LABELS[platform]}后台正文区直接粘贴（以平台实际效果为准）`
      )
    } catch (err) {
      onToast(`复制失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }, [busy, project, pubVariant, platform, onToast])

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

  /** 导出可编辑 Word 到工程「交付/」目录（甲方审稿 / 存档二次编辑） */
  const exportWord = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const abs = await window.api.invoke('export:docx', project)
      setDocPath(abs)
      onToast(`Word 交稿已导出（可编辑）：${abs}`)
    } catch (err) {
      onToast(`Word 导出失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }, [busy, project, onToast])

  /** 导出打印用 PDF（公众号日间排版，A4） */
  const exportPdf = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const abs = await window.api.invoke('export:pdf', project)
      setDocPath(abs)
      onToast(`PDF 交稿已导出（A4 打印）：${abs}`)
    } catch (err) {
      onToast(`PDF 导出失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }, [busy, project, onToast])

  /** 用系统默认应用打开交稿产物（Word/PDF） */
  const openDocFile = useCallback(async () => {
    if (!docPath) return
    try {
      await window.api.invoke('export:openFile', docPath)
    } catch (err) {
      onToast(`打开失败：${err instanceof Error ? err.message : err}`)
    }
  }, [docPath, onToast])

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

        {/* 预览：公众号 375px 手机宽（配色跟随发布配色）；其他平台 720px 桌面专栏宽（白底） */}
        <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-hidden bg-slate-950/60 p-4">
          <iframe
            title="导出预览"
            srcDoc={previewHtml}
            sandbox=""
            className={
              platform === 'wechat'
                ? 'h-full w-[375px] shrink-0 rounded-lg border border-slate-700 bg-white'
                : 'h-full w-[720px] max-w-full shrink-0 rounded-lg border border-slate-700 bg-white'
            }
          />
        </div>

        <div className="shrink-0 border-t border-slate-700 px-4 py-3">
          {/* 分发目标平台（M11）：影响复制富文本与预览；推送草稿始终走公众号 */}
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span>分发平台：</span>
            <div className="flex overflow-hidden rounded border border-slate-600">
              {(Object.keys(PLATFORM_LABELS) as PlatformId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPlatform(id)}
                  className={`${segBtn(platform === id)} ${id !== 'wechat' ? 'border-l border-slate-600' : ''}`}
                >
                  {PLATFORM_LABELS[id]}
                </button>
              ))}
            </div>
            {platform !== 'wechat' && (
              <span className="text-slate-500">适配平台净化规则的简化排版，以实际粘贴效果为准</span>
            )}
          </div>

          {/* 发布配色：公众号读者统一看一套（不支持媒体查询），二选一。
              仅公众号路径有意义（知乎/头条/百家只有日间形态），选其他平台时隐藏 */}
          {platform === 'wechat' && (
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
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={copyRich} disabled={busy} className={btnPrimary}>
              {platform === 'wechat' ? '📋 复制富文本（粘贴公众号）' : `📋 复制（粘贴${PLATFORM_LABELS[platform]}）`}
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

          {/* 交稿 / 存档：给甲方审稿、投稿存档、二次编辑（Word 可编辑 / PDF A4 打印） */}
          <div className="mt-3 rounded border border-dashed border-slate-600 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={exportWord} disabled={busy} className={btnGhost}>
                📄 导出 Word（可编辑）
              </button>
              <button onClick={exportPdf} disabled={busy} className={btnGhost}>
                🖨 导出 PDF（A4 打印）
              </button>
              {docPath && (
                <button onClick={openDocFile} className={btnGhost}>
                  📂 打开
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              交稿稿落在工程「交付」目录：Word 保留标题/正文/表格/图片结构，可直接在 Word/WPS 里继续改；
              PDF 为公众号日间排版按 A4 分页，适合发给甲方审阅。封面若已设置会放在文档首页。
            </p>
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            复制富文本会把图片内嵌进剪贴板，直接粘贴到公众号正文区即可；横滑图集在手机端可左右滑动。推荐用日间配色：读者微信夜间会自动变深；夜间配色（算法变深版）在公众号夜间无法正常显示。
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            article.html 勾选「读者端自动昼夜」时，部署到自有网页/博客后读者系统深色自动看夜间配色（算法变深）、浅色看日间配色；取消勾选则固定使用所选发布配色。
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            推送草稿前需在「设置-推送设置」填好 AppID/AppSecret，并把本机公网 IP 加入公众平台 IP 白名单；封面在「标题/封面」页设置。
          </p>
        </div>
      </div>
    </div>
  )
}
