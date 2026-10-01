import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react'
import { Icon } from '../ui/Icon'
import { Button, Card, CardTitle, Chip, CollapseBar } from '../ui/primitives'
import type { ArticleTheme } from '@shared/categoryThemes'
import type { ProjectMeta, TitleCandidate } from '@shared/types'
import { cardsPlainText, hexToRgba } from '@shared/cards'
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
      // 杂志留白是纯文字底，不吃底图（见 shared/coverTemplates 的 editorial 分支）
      if (useBg && img && template !== 'editorial') {
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
  // 已采用的候选 = 正文首行 H1（「采用」写的就是它），用于给对应行挂「已采用」态
  const appliedTitle = article.trim() ? extractTitle(mdToDoc(article), '') : ''
  const accent = theme?.accent ?? DEFAULT_ACCENT

  return (
    <div className="selectable thin-scroll min-h-0 flex-1 overflow-auto p-4 text-xs">
      <div className="flex flex-col gap-3">
        {/* ================= 卡 1 · 标题候选（稿 E：一卡一事，主按钮只有一个） ================= */}
        <Card>
          <div className="flex flex-nowrap items-center gap-2">
            <CardTitle tag={titles.length ? `${titles.length} 个候选` : undefined}>标题候选</CardTitle>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {titling && <span className="text-ink-dim">基于{meta.format === 'cards' ? '贴图文案' : '正文'}生成中…</span>}
              {titling ? (
                <Button size="sm" variant="ghost" icon="x" onClick={() => abortRef.current?.()}>
                  停止
                </Button>
              ) : (
                <Button size="sm" variant="pri" icon="brain" onClick={runTitles}>
                  {titles.length ? '重新起标题' : 'AI 起标题'}
                </Button>
              )}
            </div>
          </div>

          {titleError && (
            <p className="mt-2 break-all text-st-bad">
              <Icon name="xCircle" size={12} className="mr-1.5" />
              {titleError}
            </p>
          )}

          {titles.length === 0 ? (
            <p className="mt-2.5 rounded-lg border border-dashed border-panel-3 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
              暂无候选。点「AI 起标题」，会基于{meta.format === 'cards' ? '贴图文案' : '正文'}起 6 个标题并打分，选一条写入正文首行。
            </p>
          ) : (
            <div className="mt-2.5 flex flex-col gap-2">
              {titles.map((t, i) => {
                const used = !!appliedTitle.trim() && t.text.trim() === appliedTitle.trim()
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                      used ? 'border-accent bg-accent/10' : 'border-panel-3 bg-panel hover:border-accent'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug text-ink">{t.text}</p>
                      {t.reason && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{t.reason}</p>}
                    </div>
                    <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-accent">
                      {t.score} 分
                    </span>
                    <Button
                      size="sm"
                      variant="sec"
                      disabled={used}
                      onClick={() => {
                        onApplyTitle(t.text)
                        onToast('已把标题写入正文首行')
                      }}
                    >
                      {used ? '已采用' : '采用'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="copy"
                      title="复制到剪贴板"
                      onClick={() => {
                        navigator.clipboard.writeText(t.text)
                        onToast('标题已复制')
                      }}
                    >
                      复制
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* 贴图工程只要标题不要封面：两张封面卡整块隐藏 */}
        {meta.format !== 'cards' && (
          <>
            {/* ============ 卡 2 · 封面（路径一：版式模板直出，不依赖模型） ============ */}
            <Card>
              <CardTitle tag="路径一 · 模板直出">封面</CardTitle>
              <div className="mt-3 grid grid-cols-[164px_minmax(0,1fr)] gap-4">
                {/* 左：四版式缩略卡（诊断 9：选版式不再靠脑补） */}
                <div className="grid grid-cols-2 gap-2 self-start" role="radiogroup" aria-label="封面版式">
                  {COVER_TEMPLATES.map((t) => (
                    <LayoutPick
                      key={t.id}
                      name={t.name}
                      hint={t.hint}
                      layoutId={t.id}
                      accent={accent}
                      on={template === t.id}
                      onPick={() => setTemplate(t.id)}
                    />
                  ))}
                </div>
                {/* 右：标题 / 副标题 / 底图 / 主按钮 */}
                <div className="flex min-w-0 flex-col gap-2">
                  <input
                    value={coverTitle}
                    onChange={(e) => setCoverTitle(e.target.value)}
                    placeholder="封面标题（缺省取最高分候选）"
                    aria-label="封面标题"
                    className="h-8 w-full rounded-lg border border-panel-3 bg-panel px-2.5 text-xs text-ink outline-none focus:border-accent"
                  />
                  <input
                    value={coverSubtitle}
                    onChange={(e) => setCoverSubtitle(e.target.value)}
                    placeholder="副标题（选填）"
                    aria-label="封面副标题"
                    className="h-8 w-full rounded-lg border border-panel-3 bg-panel px-2.5 text-xs text-ink outline-none focus:border-accent"
                  />
                  <label
                    className={`inline-flex items-center gap-1.5 text-[11.5px] ${
                      img && template !== 'editorial' ? 'cursor-pointer text-ink-dim' : 'cursor-default text-ink-dim opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={useBg && template !== 'editorial'}
                      disabled={!img || template === 'editorial'}
                      onChange={(e) => setUseBg(e.target.checked)}
                      className="accent-accent"
                    />
                    {template === 'editorial'
                      ? '此版式为纯文字底，不使用底图'
                      : img
                        ? '用当前图片作底图（存为 assets/cover-bg.png）'
                        : '用当前图片作底图（先在下方生成或导入一张图）'}
                  </label>
                  <div className="mt-1 flex flex-nowrap items-center gap-2">
                    <Chip icon="palette" title="封面强调色与文章排版调性同源">
                      强调色 {accent}
                    </Chip>
                    <Button
                      className="ml-auto shrink-0"
                      variant="pri"
                      icon="image"
                      disabled={rendering || !coverTitle.trim()}
                      onClick={renderTemplateCover}
                    >
                      {rendering ? '渲染中…' : '生成封面'}
                    </Button>
                  </div>
                </div>
              </div>

              {meta.cover && (
                <p className="mt-3 text-[11.5px] text-st-done">
                  <Icon name="checkCircle" size={12} className="mr-1.5" />
                  已保存：{meta.cover.main} / {meta.cover.square}
                  {meta.cover.template
                    ? `（模板：${COVER_TEMPLATES.find((t) => t.id === meta.cover?.template)?.name ?? meta.cover.template}）`
                    : ''}
                </p>
              )}

              {/* 成品预览：读盘上的封面文件（带版本号破缓存），比例角标常驻 */}
              {meta.cover && projectDir && (
                <div className="mt-2.5 flex flex-wrap items-start gap-2.5">
                  <RatioFrame
                    label="2.35:1 头图"
                    src={assetUrl(meta.cover.main)}
                    alt="头图预览"
                    className="w-[min(100%,420px)] aspect-[2.35]"
                  />
                  <RatioFrame label="1:1 方图" src={assetUrl(meta.cover.square)} alt="方图预览" className="w-[132px] aspect-square" />
                </div>
              )}

              <CollapseBar
                className="mt-3"
                label="版式与裁剪规则（文字锁左区 / 底图同化 / 字色自适应 / 双比例输出）"
              >
                <p>
                  左文右图版式把文字锁在左侧，右侧留一个方形画面区：在公众号后台设封面时把 1:1 裁剪框拖到右侧那块，
                  头条大图看文字、信息流缩略图看画面，两边都不牺牲。
                </p>
                <p>
                  字号受列宽硬约束（字号 ≤ 可用列宽 ÷ 最长一行字数），所以永远不会溢出画布；标题里用竖线 |
                  手动分行可以把字号撑得更大——行越短字越大，这是「1 秒可读」的唯一出路。顶部约 20% 让给标题遮罩，
                  文字块不进入。
                </p>
                <p>
                  压照片的文字用浅色还是深色由主进程取样照片文字区亮度算出（底图同化），不靠盖一层暗底——
                  那会在照片上凭空造出一块与照片对不上色的面板。
                </p>
                <p>
                  成品一次输出两张：{WIDE.w}×{WIDE.h}（2.35:1 头图）与 {SQUARE.w}×{SQUARE.h}
                  （1:1 朋友圈分享图），落在工程 assets/ 目录；右下角标注账号名（= 工程分类，未分类不标）。
                </p>
              </CollapseBar>
            </Card>

            {/* ============ 卡 3 · 封面（路径二：AI 生图 / 导入图片后裁剪） ============ */}
            <Card>
              <CardTitle tag="路径二 · AI 生图后裁剪">封面底图</CardTitle>
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
              <label className="mt-3 block text-[11.5px] text-ink-dim">封面生成提示词（可从正文提取，也可手写）</label>
              <textarea
                value={coverPrompt}
                onChange={(e) => setCoverPrompt(e.target.value)}
                rows={coverPrompt.length > 60 ? 4 : 3}
                readOnly={prompting}
                placeholder="想要一张什么样的封面…可手写，也可点「从正文提取提示词」让 AI 通读正文提取关键信息生成"
                className="mt-1 w-full rounded-lg border border-panel-3 bg-panel px-2.5 py-2 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent"
              />
              <div className="mt-2 flex flex-nowrap items-center gap-2">
                {prompting ? (
                  <Button size="sm" variant="ghost" icon="x" onClick={() => promptAbortRef.current?.()}>
                    停止
                  </Button>
                ) : (
                  <Button size="sm" variant="sec" icon="file" disabled={genning} onClick={extractCoverPrompt}>
                    从正文提取提示词
                  </Button>
                )}
                <Button size="sm" variant="sec" icon="upload" onClick={() => fileRef.current?.click()}>
                  {img ? '换一张图片' : '导入图片'}
                </Button>
                <Button
                  className="ml-auto shrink-0"
                  variant="pri"
                  icon="sparkles"
                  disabled={genning || prompting || !coverPrompt.trim()}
                  onClick={genCover}
                >
                  {genning ? '生成中…' : '生成封面底图'}
                </Button>
              </div>
              {prompting && <p className="mt-1.5 text-[11px] text-ink-dim">正在通读正文提取关键信息…</p>}
              {genning && <p className="mt-1.5 text-[11px] text-ink-dim">按提示词生成 21:9 横图，约一分钟</p>}

              {img ? (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-[11.5px] text-ink-dim">
                    头图 2.35:1（{WIDE.w}×{WIDE.h}）· 图上拖动选裁剪位置
                  </p>
                  <canvas
                    ref={wideRef}
                    width={WIDE.w}
                    height={WIDE.h}
                    onPointerDown={startCropDrag('wide', WIDE.w / WIDE.h)}
                    onPointerMove={moveCropDrag}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                    style={{ touchAction: 'none' }}
                    className="w-full max-w-[520px] cursor-grab touch-none rounded-lg border border-panel-3 active:cursor-grabbing"
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    aria-label="头图裁剪位置"
                    value={wideOffset * 100}
                    onChange={(e) => setWideOffset(Number(e.target.value) / 100)}
                    className="w-full max-w-[520px]"
                  />
                  <p className="mt-1 text-[11.5px] text-ink-dim">
                    方图 1:1（{SQUARE.w}×{SQUARE.h}）· 图上拖动选裁剪位置
                  </p>
                  <canvas
                    ref={squareRef}
                    width={SQUARE.w}
                    height={SQUARE.h}
                    onPointerDown={startCropDrag('square', 1)}
                    onPointerMove={moveCropDrag}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                    style={{ touchAction: 'none' }}
                    className="w-44 cursor-grab touch-none rounded-lg border border-panel-3 active:cursor-grabbing"
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    aria-label="方图裁剪位置"
                    value={squareOffset * 100}
                    onChange={(e) => setSquareOffset(Number(e.target.value) / 100)}
                    className="w-full max-w-[520px]"
                  />
                  <div className="mt-1">
                    <Button variant="pri" icon="save" disabled={saving} onClick={saveCovers}>
                      {saving ? '保存中…' : '保存两种封面'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-panel-3 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
                  还没有底图。生成或导入一张后，在预览上直接拖动选裁剪位置（也可用滑杆微调），一次保存 2.35:1 头图与 1:1 方图。
                </p>
              )}

              <CollapseBar className="mt-3" label="裁剪与保存（图上拖动 / 滑杆微调 / 双比例同时落盘）">
                <p>
                  裁剪按「短边吃满、长边滑动」计算：横图水平拖、竖图垂直拖，两个比例各有一套独立位置，
                  互不影响——头图取中段时，方图可以另取主体。
                </p>
                <p>
                  保存会一次写两张（{WIDE.rel} 与 {SQUARE.rel}）并把它们记进 meta.cover，
                  封面墙的卡片、导出 Word/PDF 的首页、推送草稿的封面都读这一份。
                </p>
                <p>
                  想用照片当封面又不想让文字压糊：先出底图，再回上方「封面」卡选「左文右图」版式并勾上底图，
                  文字锁在左区，照片只占右侧方形画面。
                </p>
              </CollapseBar>
            </Card>
          </>
        )}
      </div>
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


/** 强调色缺省值：工程还没解析出排版调性时用 §3.1 的 primary */
const DEFAULT_ACCENT = '#0d9488'

/** 比例角标常驻的成品预览框（§5.3：封面预览标注 2.35:1 / 1:1） */
function RatioFrame({
  label,
  src,
  alt,
  className = ''
}: {
  label: string
  src: string
  alt: string
  className?: string
}): ReactElement {
  return (
    <span className={`relative block shrink-0 overflow-hidden rounded-lg border border-panel-3 ${className}`}>
      <img src={src} alt={alt} className="h-full w-full object-cover" />
      <span className="absolute right-1.5 top-1.5 rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] text-white">{label}</span>
    </span>
  )
}

/**
 * 版式缩略卡（稿 E⑲，替代原来的四个纯文字链）：按各版式真实结构画出骨架——
 * 文字块 / 画面区 / 强调色竖条落位可见，选中态主色描边 + 光晕。
 * 纯 CSS，不做离屏渲染：缩略卡只表达「版式长什么样」，成品预览仍读盘上的真图。
 */
function LayoutPick({
  name,
  hint,
  layoutId,
  accent,
  on,
  onPick
}: {
  name: string
  hint: string
  layoutId: string
  accent: string
  on: boolean
  onPick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      title={hint}
      className={`rounded-lg border-2 p-1 transition-colors ${
        on ? 'border-accent bg-accent/10 shadow-[0_0_0_3px_rgb(var(--accent)/.16)]' : 'border-panel-3 bg-panel hover:border-accent'
      }`}
    >
      <span className="relative block h-11 overflow-hidden rounded" style={{ background: pickBackdrop(layoutId, accent) }}>
        {pickShapes(layoutId, accent).map((s, i) => (
          <span key={i} className="absolute block rounded" style={s} />
        ))}
      </span>
      <span className={`mt-1 block truncate text-center text-[10.5px] ${on ? 'font-semibold text-accent' : 'text-ink-dim'}`}>
        {name}
      </span>
    </button>
  )
}

/** 缩略卡底色：大字版式 / 左侧竖栏是强调色深底，其余走面板底（画面区自带颜色） */
function pickBackdrop(layoutId: string, accent: string): string {
  if (layoutId === 'plain' || layoutId === 'left') return hexToRgba(accent, 0.82) ?? accent
  return 'transparent'
}

/** 版式骨架：一组绝对定位条块，位置即真实版式里文字块 / 画面区 / 竖条的落位 */
function pickShapes(layoutId: string, accent: string): CSSProperties[] {
  const bar = (left: string, top: string, width: string, height: string, strong = true): CSSProperties => ({
    left,
    top,
    width,
    height,
    background: strong ? 'rgb(var(--ink)/.85)' : 'rgb(var(--ink)/.3)'
  })
  if (layoutId === 'split') {
    return [
      bar('7%', '20%', '44%', '14%'),
      bar('7%', '42%', '34%', '10%', false),
      {
        right: '0',
        top: '0',
        bottom: '0',
        width: '36%',
        background: `linear-gradient(120deg, ${accent}, ${hexToRgba(accent, 0.55) ?? accent})`
      }
    ]
  }
  if (layoutId === 'plain') {
    return [bar('9%', '24%', '62%', '22%'), bar('9%', '54%', '44%', '12%', false)]
  }
  if (layoutId === 'left') {
    return [
      { left: '0', top: '0', bottom: '0', width: '14%', background: accent },
      bar('26%', '26%', '52%', '16%', false),
      bar('26%', '50%', '36%', '10%', false)
    ]
  }
  // editorial（杂志留白）：浅底细线 + 深色字，无画面区
  return [
    bar('9%', '22%', '30%', '8%', false),
    bar('9%', '38%', '64%', '16%'),
    { left: '9%', top: '68%', width: '82%', height: '3%', background: 'rgb(var(--ink)/.25)' }
  ]
}
