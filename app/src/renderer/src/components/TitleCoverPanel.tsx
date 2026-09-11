import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { ArticleTheme } from '@shared/categoryThemes'
import type { ProjectMeta, TitleCandidate } from '@shared/types'
import { cardsPlainText } from '@shared/cards'
import { COVER_SQUARE, COVER_TEMPLATES, COVER_WIDE } from '@shared/coverTemplates'
import { extractTitle } from '@shared/exportHtml'
import { UNCATEGORIZED } from '@shared/categories'
import { mdToDoc } from '@shared/markdown'
import { chatOnce, extractJsonArray } from '../copilot/llm'
import { coverPromptMessages, titleMessages } from '../copilot/prompts'

interface TitleCoverPanelProps {
  project: string
  meta: ProjectMeta
  /** 当前正文（AI 起标题用） */
  article: string
  skill: string | null
  /** 工程目录绝对路径（封面预览走 asset:// 协议，与贴图面板同法） */
  projectDir?: string
  /** 排版调性：模板封面取它的强调色，与文章观感同源 */
  theme?: ArticleTheme
  /** 封面写盘 / meta 变化后通知 App 重新拉 meta */
  onMetaUpdated: () => void
  /** 把选中的标题候选写回正文首行 H1（草稿标题取自正文 H1） */
  onApplyTitle: (title: string) => void
  onToast: (msg: string) => void
}

// 导出尺寸：公众号头图 2.35:1 与朋友圈分享 1:1
const WIDE = { w: COVER_WIDE.w, h: COVER_WIDE.h, rel: 'assets/cover-235.png' }
const SQUARE = { w: COVER_SQUARE.w, h: COVER_SQUARE.h, rel: 'assets/cover-11.png' }
/** 底图导出长边上限：够 1175 宽的封面用，又不把工程撑大 */
const BG_MAX_EDGE = 1920

/**
 * 标题/封面 tab：AI 起标题 + 标题候选（打分排序+应用/复制）
 * + 封面两条产出路径——① 选版式模板直接渲染（标题/副标题/可选底图 → 双比例成品）
 * ② AI 生图或导入图片后拖动裁剪。两条路出口相同（assets/cover-235.png 与 cover-11.png）
 */
export default function TitleCoverPanel({
  project,
  meta,
  article,
  skill,
  projectDir,
  theme,
  onMetaUpdated,
  onApplyTitle,
  onToast
}: TitleCoverPanelProps): ReactElement {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [wideOffset, setWideOffset] = useState(0.5)
  const [squareOffset, setSquareOffset] = useState(0.5)
  const [saving, setSaving] = useState(false)
  const [titling, setTitling] = useState(false)
  const [genning, setGenning] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const wideRef = useRef<HTMLCanvasElement>(null)
  const squareRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<(() => void) | null>(null)
  // ---- 封面提示词：从正文提取关键信息（流式进输入框），也可手动输入/编辑 ----
  const [coverPrompt, setCoverPrompt] = useState('')
  const [prompting, setPrompting] = useState(false)
  const promptAbortRef = useRef<(() => void) | null>(null)
  // ---- 裁剪位置：预览上直接拖动（内容跟手） ----
  const dragRef = useRef<{ key: 'wide' | 'square'; x: number; y: number; start: number; axis: 'x' | 'y'; per: number } | null>(null)
  // ---- 模板封面：选版式 → 填标题 → 双比例直出（与拖动裁剪出口相同） ----
  const [template, setTemplate] = useState(() => meta.cover?.template ?? COVER_TEMPLATES[0].id)
  const [coverTitle, setCoverTitle] = useState('')
  const [coverSubtitle, setCoverSubtitle] = useState('')
  const [useBg, setUseBg] = useState(false)
  const [rendering, setRendering] = useState(false)
  // 渲染完成后自增，给 asset:// 预览加参破缓存（同贴图面板）
  const [pv, setPv] = useState(0)

  // 封面标题缺省取最高分候选；没有候选就取正文 H1。用户填过之后不再自动覆盖
  useEffect(() => {
    if (coverTitle.trim()) return
    const top = [...(meta.titles ?? [])].sort((a, b) => b.score - a.score)[0]?.text
    const h1 = article.trim() ? extractTitle(mdToDoc(article), '') : ''
    const next = (top || h1).trim()
    if (next) setCoverTitle(next)
  }, [meta.titles, article, coverTitle])

  const assetUrl = useCallback(
    (rel: string): string =>
      projectDir
        ? 'asset://file/' + encodeURIComponent(`${projectDir}\\${rel.replace(/\//g, '\\')}`) + `?v=${pv}`
        : '',
    [projectDir, pv]
  )

  useEffect(() => () => promptAbortRef.current?.(), [])

  // ---- AI 起标题（独立一次性调用，不进对话） ----

  const runTitles = useCallback(async () => {
    if (titling) return
    // 贴图工程正文为空，回退用卡片文案作为起标题的依据
    let source = article
    if (!source.trim() && meta.format === 'cards') {
      const deck = await window.api.invoke('cards:read', project)
      if (deck?.cards.length) source = cardsPlainText(deck.cards)
    }
    if (!source.trim()) {
      onToast(meta.format === 'cards' ? '卡片为空，先加几张贴图再起标题' : '正文为空，先写点内容再起标题')
      return
    }
    setTitleError(null)
    setTitling(true)
    const { promise, abort } = chatOnce(titleMessages(source, skill))
    abortRef.current = abort
    try {
      const full = await promise
      const titles = extractJsonArray<TitleCandidate>(full)
      if (!titles) {
        setTitleError('标题解析失败，请重试')
        return
      }
      const fresh = await window.api.invoke('project:readMeta', project)
      fresh.titles = titles.filter((t) => t.text && typeof t.score === 'number')
      await window.api.invoke('project:writeMeta', project, fresh)
      onMetaUpdated()
      onToast(`已生成 ${fresh.titles.length} 个标题候选`)
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : String(err))
    } finally {
      setTitling(false)
      abortRef.current = null
    }
  }, [titling, article, skill, project, meta.format, onMetaUpdated, onToast])

  const pickImage = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        setImg(image)
        setUseBg(true)
      }
      image.onerror = () => {
        URL.revokeObjectURL(url)
        onToast('图片加载失败，换一张 PNG/JPG 试试')
      }
      image.src = url
    },
    [onToast]
  )

  // ---- 封面提示词：LLM 通读正文提取关键信息，流式写进输入框供用户二次编辑 ----

  const extractCoverPrompt = useCallback(async () => {
    if (prompting) return
    // 与起标题同源：正文为空时贴图工程回退卡片文案
    let source = article
    if (!source.trim() && meta.format === 'cards') {
      const deck = await window.api.invoke('cards:read', project)
      if (deck?.cards.length) source = cardsPlainText(deck.cards)
    }
    if (!source.trim()) {
      onToast(meta.format === 'cards' ? '卡片为空，先加几张贴图再提取封面提示词' : '正文为空，先写点内容再提取封面提示词')
      return
    }
    setPrompting(true)
    const { promise, abort } = chatOnce(coverPromptMessages(source, skill), (full) => setCoverPrompt(full))
    promptAbortRef.current = abort
    try {
      const full = await promise
      setCoverPrompt(full.trim())
    } catch (err) {
      onToast(`封面提示词提取失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setPrompting(false)
      promptAbortRef.current = null
    }
  }, [prompting, article, meta.format, project, skill, onToast])

  // ---- 裁剪位置：预览画布上直接拖动（内容跟手），滑杆保留作微调 ----

  const startCropDrag = useCallback(
    (key: 'wide' | 'square', ratio: number) => (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!img) return
      const m = dragFactor(e.currentTarget, img, ratio)
      if (!m) return
      dragRef.current = {
        key,
        x: e.clientX,
        y: e.clientY,
        start: key === 'wide' ? wideOffset : squareOffset,
        axis: m.axis,
        per: m.per
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [img, wideOffset, squareOffset]
  )

  const moveCropDrag = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (!d) return
    const delta = d.axis === 'x' ? e.clientX - d.x : e.clientY - d.y
    const v = Math.min(1, Math.max(0, d.start - delta * d.per))
    if (d.key === 'wide') setWideOffset(v)
    else setSquareOffset(v)
  }, [])

  const endCropDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  // ---- AI 生成封面：按用户确认的提示词出 21:9 横图，生成后进同一套裁切保存流程 ----

  const genCover = useCallback(async () => {
    if (genning || prompting) return
    const prompt = coverPrompt.trim()
    if (!prompt) {
      onToast('请先输入封面提示词，或点「从正文提取提示词」')
      return
    }
    setGenning(true)
    try {
      // 1K + 21:9 实际出 1568×672，已够 1175×500 头图；2K 图床下载慢易超时
      const b64 = await window.api.invoke('image:generate', prompt, { size: '1K', ratio: '21:9' })
      const image = new Image()
      image.onload = () => {
        setImg(image)
        setUseBg(true)
        onToast('封面已生成，可拖动裁剪，也可直接用上方版式模板出图')
      }
      image.onerror = () => onToast('封面图片解码失败，请重试')
      image.src = `data:image/png;base64,${b64}`
    } catch (err) {
      onToast(`封面生成失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setGenning(false)
    }
  }, [genning, prompting, coverPrompt, onToast])

  // 预览重绘
  useEffect(() => {
    if (img && wideRef.current) drawCrop(wideRef.current, img, WIDE.w / WIDE.h, wideOffset)
  }, [img, wideOffset])
  useEffect(() => {
    if (img && squareRef.current) drawCrop(squareRef.current, img, 1, squareOffset)
  }, [img, squareOffset])

  const saveCovers = useCallback(async () => {
    if (!img || saving) return
    setSaving(true)
    try {
      await window.api.invoke('project:saveAsset', project, WIDE.rel, renderPng(img, WIDE.w, WIDE.h, wideOffset))
      await window.api.invoke('project:saveAsset', project, SQUARE.rel, renderPng(img, SQUARE.w, SQUARE.h, squareOffset))
      const fresh = await window.api.invoke('project:readMeta', project)
      fresh.cover = { main: WIDE.rel, square: SQUARE.rel }
      await window.api.invoke('project:writeMeta', project, fresh)
      onMetaUpdated()
      onToast('封面已保存到 assets/')
    } catch (err) {
      onToast(`封面保存失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setSaving(false)
    }
  }, [img, saving, project, wideOffset, squareOffset, onMetaUpdated, onToast])

  // ---- 模板封面：纯版式直出，或把当前图片存成 assets/cover-bg.png 当底图 ----

  const renderTemplateCover = useCallback(async () => {
    if (rendering) return
    const title = coverTitle.trim()
    if (!title) {
      onToast('先填封面标题')
      return
    }
    setRendering(true)
    try {
      let bg: string | undefined
      if (useBg && img) {
        bg = await window.api.invoke('project:saveAsset', project, 'assets/cover-bg.png', renderFullPng(img))
      }
      await window.api.invoke('cover:renderTemplate', {
        project,
        template,
        title,
        subtitle: coverSubtitle.trim() || undefined,
        accent: theme?.accent ?? '#0d9488',
        bg,
        // 账号 = 分类：右下角标注账号名；「未分类」没有账号含义，不标
        brand: meta.category && meta.category !== UNCATEGORIZED ? meta.category : undefined
      })
      setPv((v) => v + 1)
      onMetaUpdated()
      onToast('封面已按模板生成（2.35:1 + 1:1）')
    } catch (err) {
      onToast(`封面渲染失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setRendering(false)
    }
  }, [
    rendering,
    coverTitle,
    coverSubtitle,
    useBg,
    img,
    project,
    template,
    theme,
    meta.category,
    onMetaUpdated,
    onToast
  ])

  const titles = [...(meta.titles ?? [])].sort((a, b) => b.score - a.score)

  return (
    <div className="selectable flex-1 overflow-auto p-4 text-xs">
      {/* ---- 标题候选 ---- */}
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-bold text-ink">标题候选</h3>
        {titling ? (
          <button onClick={() => abortRef.current?.()} className="rounded bg-panel-3 px-2.5 py-1 text-red-400 hover:bg-panel">
            ■ 停止
          </button>
        ) : (
          <button onClick={runTitles} className="rounded bg-accent px-2.5 py-1 text-white hover:opacity-90">
            ✦ {titles.length ? '重新起标题' : 'AI 起标题'}
          </button>
        )}
        {titling && <span className="text-ink-dim">基于正文生成中…</span>}
      </div>
      {titleError && <p className="mb-2 break-all text-red-400">✗ {titleError}</p>}
      {titles.length === 0 ? (
        <p className="mb-4 text-ink-dim">暂无候选。点上方按钮，AI 会基于{meta.format === 'cards' ? '贴图文案' : '正文'}起 6 个标题并打分。</p>
      ) : (
        <div className="mb-4">
          {titles.map((t, i) => (
            <div key={i} className="mb-1.5 flex items-start gap-2 rounded bg-panel-2 px-2.5 py-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${t.score >= 8 ? 'bg-green-950 text-green-400' : 'bg-panel-3 text-ink-dim'}`}>
                {t.score}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink">{t.text}</p>
                <p className="mt-0.5 text-ink-dim">{t.reason}</p>
              </div>
              <button
                onClick={() => {
                  onApplyTitle(t.text)
                  onToast('已把标题写入正文首行')
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-accent hover:bg-panel-3"
              >
                ✓ 用这个
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(t.text)
                  onToast('标题已复制')
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-ink-dim hover:bg-panel-3 hover:text-ink"
              >
                复制
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---- 封面：两条产出路径，出口相同（assets/cover-235.png 与 cover-11.png） ---- */}
      <h3 className="mb-2 text-sm font-bold text-ink">封面图</h3>
      {meta.cover && (
        <p className="mb-2 text-green-500">
          ✓ 已保存：{meta.cover.main} / {meta.cover.square}
          {meta.cover.template ? `（模板：${COVER_TEMPLATES.find((t) => t.id === meta.cover?.template)?.name ?? meta.cover.template}）` : ''}
        </p>
      )}

      {/* ---- 路径一：版式模板直出（不依赖模型，改标题即可重渲染） ---- */}
      <p className="mb-1 text-ink-dim">① 选版式直接生成</p>
      <div className="mb-2 flex max-w-[560px] flex-wrap gap-1.5">
        {COVER_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTemplate(t.id)}
            title={t.hint}
            className={`rounded border px-2.5 py-1 ${
              template === t.id
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-panel-3 text-ink-dim hover:border-accent hover:text-accent'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>
      <input
        value={coverTitle}
        onChange={(e) => setCoverTitle(e.target.value)}
        placeholder="封面标题（缺省取最高分标题候选，没有候选就取正文首行）"
        className="mb-1.5 w-full max-w-[560px] rounded bg-panel px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-dim"
      />
      <input
        value={coverSubtitle}
        onChange={(e) => setCoverSubtitle(e.target.value)}
        placeholder="副标题（选填）"
        className="mb-1.5 w-full max-w-[560px] rounded bg-panel px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-dim"
      />
      <label className={`mb-2 flex items-center gap-1.5 ${img ? 'text-ink-dim' : 'text-ink-dim opacity-50'}`}>
        <input type="checkbox" checked={useBg} disabled={!img} onChange={(e) => setUseBg(e.target.checked)} />
        {img ? '用当前图片作底图（存为 assets/cover-bg.png）' : '用当前图片作底图（先在下方生成或导入一张图）'}
      </label>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          onClick={renderTemplateCover}
          disabled={rendering || !coverTitle.trim()}
          className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90 disabled:opacity-40"
        >
          {rendering ? '渲染中…' : '🖼 生成封面'}
        </button>
        {rendering && <span className="text-ink-dim">离屏渲染两种比例…</span>}
        <span className="text-ink-dim">强调色取自排版调性{theme?.accent ? `（${theme.accent}）` : ''}</span>
      </div>

      {/* 成品预览：读盘上的封面文件（带版本号破缓存） */}
      {meta.cover && projectDir && (
        <div className="mb-4 max-w-[560px]">
          <img src={assetUrl(meta.cover.main)} alt="头图预览" className="mb-1 w-full rounded border border-panel-3" />
          <img src={assetUrl(meta.cover.square)} alt="方图预览" className="w-32 rounded border border-panel-3" />
        </div>
      )}

      {/* ---- 路径二：AI 生图 / 导入图片 → 拖动裁剪 ---- */}
      <p className="mb-1 text-ink-dim">② 或：AI 生图 / 导入图片后拖动裁剪</p>
      <label className="mb-1 block text-ink-dim">封面生成提示词（从正文提取关键信息，可手动编辑）</label>
      <textarea
        value={coverPrompt}
        onChange={(e) => setCoverPrompt(e.target.value)}
        rows={coverPrompt.length > 60 ? 5 : 3}
        readOnly={prompting}
        placeholder="想要一张什么样的封面…可手写，也可点「从正文提取提示词」让 AI 通读正文提取关键信息生成"
        className="mb-2 w-full max-w-[560px] rounded bg-panel px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-dim"
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) pickImage(f)
          e.target.value = ''
        }}
      />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {prompting ? (
          <button onClick={() => promptAbortRef.current?.()} className="rounded bg-panel-3 px-3 py-1.5 text-red-400 hover:bg-panel">
            ■ 停止
          </button>
        ) : (
          <button
            onClick={extractCoverPrompt}
            disabled={genning}
            className="rounded border border-panel-3 px-3 py-1.5 text-ink-dim hover:border-accent hover:text-accent disabled:opacity-40"
          >
            ✦ 从正文提取提示词
          </button>
        )}
        <button
          onClick={genCover}
          disabled={genning || prompting || !coverPrompt.trim()}
          className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90 disabled:opacity-40"
        >
          {genning ? '生成中…' : '✨ 生成封面'}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded border border-dashed border-panel-3 px-3 py-1.5 text-ink-dim hover:border-accent hover:text-accent"
        >
          {img ? '换一张图片' : '导入图片'}
        </button>
        {prompting && <span className="text-ink-dim">正在通读正文提取关键信息…</span>}
        {genning && <span className="text-ink-dim">按提示词生成 21:9 横图，约一分钟</span>}
      </div>
      <p className="mb-3 max-w-[560px] text-[11px] text-ink-dim">
        生成或导入图片后，在下方预览上直接拖动选择裁剪位置（也可用滑杆微调），保存为 2.35:1 头图与 1:1 方图两种封面。
      </p>

      {img && (
        <div className="max-w-[560px]">
          <p className="mb-1 text-ink-dim">头图 2.35:1（{WIDE.w}×{WIDE.h}）· 图上拖动选裁剪位置</p>
          <canvas
            ref={wideRef}
            width={WIDE.w}
            height={WIDE.h}
            onPointerDown={startCropDrag('wide', WIDE.w / WIDE.h)}
            onPointerMove={moveCropDrag}
            onPointerUp={endCropDrag}
            onPointerCancel={endCropDrag}
            style={{ touchAction: 'none' }}
            className="mb-1 w-full cursor-grab rounded border border-panel-3 active:cursor-grabbing"
          />
          <input
            type="range" min={0} max={100} value={wideOffset * 100}
            onChange={(e) => setWideOffset(Number(e.target.value) / 100)}
            className="mb-3 w-full"
          />
          <p className="mb-1 text-ink-dim">方图 1:1（{SQUARE.w}×{SQUARE.h}）· 图上拖动选裁剪位置</p>
          <canvas
            ref={squareRef}
            width={SQUARE.w}
            height={SQUARE.h}
            onPointerDown={startCropDrag('square', 1)}
            onPointerMove={moveCropDrag}
            onPointerUp={endCropDrag}
            onPointerCancel={endCropDrag}
            style={{ touchAction: 'none' }}
            className="mb-1 w-48 cursor-grab rounded border border-panel-3 active:cursor-grabbing"
          />
          <input
            type="range" min={0} max={100} value={squareOffset * 100}
            onChange={(e) => setSquareOffset(Number(e.target.value) / 100)}
            className="mb-3 w-full"
          />
          <button
            onClick={saveCovers}
            disabled={saving}
            className="rounded bg-accent px-4 py-1.5 text-white hover:opacity-90 disabled:opacity-40"
          >
            {saving ? '保存中…' : '保存两种封面'}
          </button>
        </div>
      )}
    </div>
  )
}

/** 计算裁切源区域：短边吃满，长边按 offset(0-1) 滑动 */
function cropRect(img: HTMLImageElement, ratio: number, offset: number): { sx: number; sy: number; sw: number; sh: number } {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw / ih > ratio) {
    // 图更宽：吃满高，水平滑动
    const sw = ih * ratio
    return { sx: (iw - sw) * offset, sy: 0, sw, sh: ih }
  }
  // 图更高：吃满宽，垂直滑动
  const sh = iw / ratio
  return { sx: 0, sy: (ih - sh) * offset, sw: iw, sh }
}

/** 拖动裁剪度量：内容跟手。per = 指针每移动 1 显示像素对应的 offset 变化量；无可滑动余量返回 null */
function dragFactor(canvas: HTMLCanvasElement, img: HTMLImageElement, ratio: number): { axis: 'x' | 'y'; per: number } | null {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw / ih > ratio) {
    // 图更宽：裁剪窗水平滑动，显示宽=clientWidth 对应裁剪窗宽 sw 个图像像素
    const sw = ih * ratio
    const avail = iw - sw
    if (avail <= 0 || canvas.clientWidth <= 0) return null
    return { axis: 'x', per: sw / canvas.clientWidth / avail }
  }
  const sh = iw / ratio
  const avail = ih - sh
  if (avail <= 0 || canvas.clientHeight <= 0) return null
  return { axis: 'y', per: sh / canvas.clientHeight / avail }
}

function drawCrop(canvas: HTMLCanvasElement, img: HTMLImageElement, ratio: number, offset: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { sx, sy, sw, sh } = cropRect(img, ratio, offset)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
}

/** 按目标尺寸离屏渲染并导出 base64（不带 dataURL 前缀） */
function renderPng(img: HTMLImageElement, w: number, h: number, offset: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  drawCrop(canvas, img, w / h, offset)
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

/** 底图导出：整张源图不裁切，长边压到 BG_MAX_EDGE 以内（封面最宽 1175，够用又不撑大工程） */
function renderFullPng(img: HTMLImageElement): string {
  const scale = Math.min(1, BG_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}
