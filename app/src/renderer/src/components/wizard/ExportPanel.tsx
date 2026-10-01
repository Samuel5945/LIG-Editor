import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml, exportPageBg, extractTitle, wrapExportPage } from '@shared/exportHtml'
import { docToPlatformHtml, wrapPlatformPage, PLATFORM_LABELS } from '@shared/platformHtml'
import type { ArticleTheme } from '@shared/categoryThemes'
import type { PlatformId } from '@shared/types'
import type { PushDraftResult } from '@shared/wechatIpc'
import { Icon } from '../../ui/Icon'
import { Segmented, Button, Card, CollapseBar, Switch, useElementBox } from '../../ui/primitives'
import { withPreviewScrollCss } from '../../ui/previewScrollCss'

/**
 * 导出步工作面（创作向导「导出」步；自 ExportDialog 抽出，原弹窗壳已随页签体系退役）。
 * 稿 F（诊断 10）定稿形态：**左预览右操作双栏**——预览独立成卡并可切「竖屏（手机宽度）/ 横屏（桌面宽度）」，
 * 比例角标常驻；操作卡按「分发平台 → 发布配色 → 导出与推送 → 交稿」四组分层，
 * 主按钮只有「复制富文本」一个实心，三大段依据说明收进折叠条默认收起。
 * 中栏窄到放不下两栏时改上下堆叠，两边都不砍功能。
 * 预览与导出共用同一套内联样式模板，所见即所得。
 * 配色：预览跟随所选发布配色；发布（复制/推送）默认日间——日间排版推到公众号后，
 * 微信夜间自动变深（手调深色排版在公众号夜间无法显示）；夜间配色为算法变深版，
 * 主要用于 article.html 固定夜间导出（公众号不支持媒体查询，读者统一看一套）。
 */

export interface ExportPanelProps {
  project: string
  /** 工程目录绝对路径（预览图片走 asset:// 协议） */
  projectDir: string
  markdown: string
  /** 排版调性（分类调性解析结果）：预览与导出产物同源跟色 */
  theme?: ArticleTheme
  /** 所属分类（= 账号）：用于取账号预设里预选的分发平台 */
  category?: string
  /** 任一导出/复制/推送成功后通知（App 刷新 meta.lastExportAt，创作向导据此判定导出步完成） */
  onExported?: () => void
  onToast: (msg: string) => void
}

/** 发布配色二选一：公众号读者统一看一套（不支持媒体查询）；article.html 另有读者端自动昼夜 */
type PubVariant = 'day' | 'night'

export default function ExportPanel({ project, projectDir, markdown, theme, category, onExported, onToast }: ExportPanelProps) {
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
  // 非公众号平台一律走语义化结构（头条另给图注居中与表头 strong；知乎/百家号零内联样式），白底桌面专栏宽。
  // 头条的预览会比实际发布页更素：实测它按计算后样式转 schema mark、丢弃 CSS，标题/引用/表格再套平台自己的样式
  const previewHtml = useMemo(() => {
    const doc = mdToDoc(markdown)
    const resolveAsset = (src: string): string =>
      /^(data:|https?:)/.test(src)
        ? src
        : 'asset://file/' + encodeURIComponent(`${projectDir}\\${src.replace(/\//g, '\\')}`)
    if (platform === 'wechat') {
      const fragment = docToExportHtml(doc, resolveAsset, theme, pubVariant === 'night')
      // 页面外壳背景跟随所选配色变体：夜间深底、日间白底/浅卡（与正文片段同源，整页一体）
      return withPreviewScrollCss(wrapExportPage(fragment, extractTitle(doc, project), exportPageBg(theme, pubVariant === 'night')))
    }
    const fragment = docToPlatformHtml(doc, resolveAsset, theme, platform)
    return withPreviewScrollCss(wrapPlatformPage(fragment, extractTitle(doc, project)))
  }, [markdown, projectDir, project, theme, pubVariant, platform])

  const copyRich = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.invoke('export:copyRich', { project, variant: pubVariant, platform })
      onExported?.()
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
  }, [busy, project, pubVariant, platform, onToast, onExported])

  const exportHtml = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const abs = await window.api.invoke('export:html', {
        project,
        variant: htmlAuto ? 'auto' : pubVariant
      })
      setExportedPath(abs)
      onExported?.()
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
  }, [busy, project, htmlAuto, pubVariant, onToast, onExported])

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
      onExported?.()
      onToast(`Word 交稿已导出（可编辑）：${abs}`)
    } catch (err) {
      onToast(`Word 导出失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }, [busy, project, onToast, onExported])

  /** 导出打印用 PDF（公众号日间排版，A4） */
  const exportPdf = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const abs = await window.api.invoke('export:pdf', project)
      setDocPath(abs)
      onExported?.()
      onToast(`PDF 交稿已导出（A4 打印）：${abs}`)
    } catch (err) {
      onToast(`PDF 导出失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }, [busy, project, onToast, onExported])

  /** 用系统默认应用打开交稿产物（Word/PDF） */
  const openDocFile = useCallback(async () => {
    if (!docPath) return
    try {
      await window.api.invoke('export:openFile', docPath)
    } catch (err) {
      onToast(`打开失败：${err instanceof Error ? err.message : err}`)
    }
  }, [docPath, onToast])

  /** 导出并推送草稿：结果展示在面板内（mediaId / 错误原因） */
  const pushDraft = useCallback(async () => {
    if (pushing || busy) return
    setPushing(true)
    setPushResult(null)
    try {
      const result = await window.api.invoke('wechat:push-draft', { project, variant: pubVariant })
      setPushResult(result)
      if (result.ok) onExported?.()
    } catch (err) {
      setPushResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setPushing(false)
    }
  }, [pushing, busy, project, pubVariant, onExported])

  const [rootRef, rootBox] = useElementBox<HTMLDivElement>()
  const [previewRef, previewBox] = useElementBox<HTMLDivElement>()
  /** 预览形态：竖屏 = 手机阅读宽度，横屏 = 桌面宽度（稿 F㉑，诊断 10「无竖/横屏切换」） */
  const [viewMode, setViewMode] = useState<'portrait' | 'landscape'>('portrait')
  const targetW = viewMode === 'portrait' ? PHONE_W : DESKTOP_W
  // 窄到放不下「预览 + 操作」两栏时改上下堆叠——预览不做二选一，操作也不藏
  const twoCol = rootBox.w >= TWO_COL_MIN
  // 预览按真实 CSS 宽渲染后整体缩放到卡内：缩放的是视图，行宽/折行仍等于发出去的样子
  const shot = previewBox.w > 0 && previewBox.h > 0 ? Math.min(1, previewBox.w / targetW) : 1
  const shotH = shot > 0 ? Math.round(previewBox.h / shot) : 0

  return (
    <div
      ref={rootRef}
      className={`min-h-0 flex-1 gap-3 p-4 ${
        twoCol
          ? viewMode === 'portrait'
            ? 'grid grid-rows-[minmax(0,1fr)] grid-cols-[minmax(230px,36%)_minmax(0,1fr)]'
            : 'grid grid-rows-[minmax(0,1fr)] grid-cols-[minmax(280px,54%)_minmax(0,1fr)]'
          : 'flex flex-col'
      }`}
    >
      {/* ================= 左卡 · 预览（稿 F㉑：不再居中漂浮，独立成卡 + 竖/横屏切换） ================= */}
      <Card className={`flex min-h-0 flex-col ${twoCol ? '' : 'h-[52%] min-h-[300px]'}`}>
        <div className="flex shrink-0 flex-nowrap items-center gap-2">
          <span className="min-w-0 truncate text-[13px] font-bold text-ink">预览</span>
          <Segmented
            className="ml-auto shrink-0"
            size="sm"
            ariaLabel="预览形态"
            value={viewMode}
            onChange={setViewMode}
            items={[
              { value: 'portrait', label: '竖屏', icon: 'phone', title: '按手机阅读宽度渲染' },
              { value: 'landscape', label: '横屏', icon: 'monitor', title: '按桌面宽度渲染' }
            ]}
          />
        </div>
        <div ref={previewRef} className="relative mt-2.5 min-h-0 flex-1 overflow-hidden rounded-lg bg-panel-3/40">
          <span className="absolute right-2 top-2 z-10 rounded-full bg-black/45 px-2 py-0.5 text-[10px] tabular-nums text-white">
            {targetW} × {shotH}
          </span>
          {/* 绝对定位：iframe 的高度由框子算出来，若让它参与常规流就会「框子撑高 → iframe 再撑高」无限长 */}
          <div className="absolute inset-0 flex justify-center">
            <div style={{ width: targetW * shot, height: previewBox.h }}>
              <iframe
                title="导出预览"
                srcDoc={previewHtml}
                sandbox=""
                className="rounded-md border border-panel-3 bg-white"
                style={{
                  width: targetW,
                  height: shotH,
                  transform: `scale(${shot})`,
                  transformOrigin: 'top left',
                  display: 'block'
                }}
              />
            </div>
          </div>
        </div>
        <p className="mt-1.5 shrink-0 text-center text-[10.5px] text-ink-dim">
          竖屏 = 手机阅读宽度 · 横屏 = 桌面宽度 · 缩放只为放下，折行仍是真实宽度
        </p>
      </Card>

      {/* ================= 右卡 · 操作（稿 F㉒：平台 → 配色 → 导出与推送 → 交稿，四组虚线分层） ================= */}
      <Card className="thin-scroll flex min-h-0 flex-col overflow-y-auto">
        <div className="border-b border-dashed border-panel-3 py-2.5 last:border-b-0">
          <GroupLabel>分发平台</GroupLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              ariaLabel="分发平台"
              value={platform}
              onChange={setPlatform}
              items={(Object.keys(PLATFORM_LABELS) as PlatformId[]).map((id) => ({
                value: id,
                label: PLATFORM_LABELS[id]
              }))}
            />
            {platform !== 'wechat' && <span className="text-[11px] text-ink-dim">走平台净化规则的简化排版，以粘贴后实际效果为准</span>}
          </div>
        </div>

        {platform === 'wechat' && (
          <div className="border-b border-dashed border-panel-3 py-2.5 last:border-b-0">
            <GroupLabel>发布配色</GroupLabel>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                size="sm"
                ariaLabel="发布配色"
                value={pubVariant}
                onChange={setPubVariant}
                title="公众号读者端只认一套配色（不支持媒体查询）"
                items={[
                  { value: 'day', label: '日间', icon: 'sun' },
                  { value: 'night', label: '夜间', icon: 'moon' }
                ]}
              />
              <Switch
                checked={htmlAuto}
                onChange={setHtmlAuto}
                label="article.html 读者端自动昼夜"
                title="只影响 article.html 导出：勾选按读者系统深浅自动配色，取消则固定用上面所选配色"
              />
            </div>
          </div>
        )}

        <div className="border-b border-dashed border-panel-3 py-2.5 last:border-b-0">
          <GroupLabel>导出与推送</GroupLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="pri" icon="copy" disabled={busy} onClick={copyRich}>
              {platform === 'wechat' ? '复制富文本（粘贴公众号）' : `复制（粘贴${PLATFORM_LABELS[platform]}）`}
            </Button>
            <Button variant="sec" icon="save" disabled={busy} onClick={exportHtml}>
              导出 article.html
            </Button>
            {exportedPath && (
              <Button variant="sec" icon="globe" onClick={openExported}>
                浏览器打开
              </Button>
            )}
            <Button variant="sec" icon={pushing ? 'spinner' : 'send'} disabled={pushing || busy} onClick={pushDraft}>
              {pushing ? '推送中…' : '导出并推送草稿'}
            </Button>
          </div>
          {pushResult && (
            <p className={`mt-2 break-all text-[11px] ${pushResult.ok ? 'text-st-done' : 'text-st-bad'}`}>
              <Icon name={pushResult.ok ? 'checkCircle' : 'xCircle'} size={12} className="mr-1.5" />
              {pushResult.ok ? (
                <>
                  草稿已推送到公众号{pushResult.accountName ? `「${pushResult.accountName}」` : ''}后台，mediaId：
                  {pushResult.mediaId ?? ''}
                </>
              ) : (
                `推送失败：${pushResult.error ?? '未知错误'}`
              )}
            </p>
          )}
        </div>

        <div className="border-b border-dashed border-panel-3 py-2.5 last:border-b-0">
          <GroupLabel>交稿 / 存档</GroupLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" icon="file" disabled={busy} onClick={exportWord}>
              导出 Word（可编辑）
            </Button>
            <Button variant="ghost" icon="printer" disabled={busy} onClick={exportPdf}>
              导出 PDF（A4 打印）
            </Button>
            {docPath && (
              <Button variant="ghost" icon="folderOpen" onClick={openDocFile}>
                打开
              </Button>
            )}
          </div>
        </div>

        {/* 稿 F㉓：三大段依据说明收进折叠条，默认收起——按钮不再埋在文字里 */}
        <CollapseBar className="mt-1" label="导出细节与平台差异（图片转存 / 粘贴净化规则 / 推送账号解析）">
          <p>
            复制富文本会把图片内嵌进剪贴板，直接粘贴到公众号正文区即可；横滑图集在手机端可左右滑动。
            推荐用日间配色：读者微信夜间会自动变深；夜间配色为算法变深版，在公众号夜间无法正常显示。
          </p>
          <p>
            article.html 勾选「读者端自动昼夜」时，部署到自有网页/博客后读者系统深色看夜间配色、浅色看日间配色；
            取消勾选则固定使用上面所选的发布配色。
          </p>
          <p>
            推送草稿用哪个公众号由工程所属分类的绑定决定（未绑定走默认账号），账号在「设置-推送设置」里管理，
            每个账号都要把本机公网 IP 加入公众平台 IP 白名单。非公众号平台走各自的净化规则：
            头条按计算后样式转 schema mark 并丢弃 CSS，知乎/百家号剥掉内联样式，所以预览比实际发布页更规整。
          </p>
          <p>交稿稿落在工程「交付」目录：Word 保留标题/正文/表格/图片结构，可在 Word/WPS 里继续改；PDF 为公众号日间排版按 A4 分页，适合发给甲方审阅。封面若已设置会放在文档首页。</p>
        </CollapseBar>
      </Card>
    </div>
  )
}

/** 两栏布局的最小中栏宽：低于它改上下堆叠 */
const TWO_COL_MIN = 620
/** 竖屏 = 手机阅读宽度（公众号正文实测最稳的一档） */
const PHONE_W = 375
/** 横屏 = 桌面专栏宽度 */
const DESKTOP_W = 720

/** 操作卡分组小标签（稿 F㉒） */
function GroupLabel({ children }: { children: ReactNode }): ReactElement {
  return <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-ink-dim">{children}</div>
}
