import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { applyCutout, CUTOUT_ALGOS, type CutoutAlgo, type RawImage } from '@shared/cutout'
import type { GalleryImage } from '@shared/markdown'
import { splitFigDesc } from '@shared/markdown'
import { imageFormatFor, type ImageFormatSpec } from '@shared/imageFormats'
import type { FigPipeline, FigureInsert } from '../editor/FigSuggest'
import { chatOnce } from '../copilot/llm'
import { figureHtmlMessages, imagePromptMessages } from '../copilot/prompts'

/**
 * 三配图管线弹窗（M6）：AI 生图 / 代码绘图 / 导入抠图（单图或多图轮播）
 * - 新建模式：来自 fig-suggest 占位卡，完成后 onDone(attrs) 原位替换为 figureImage/figureGallery
 * - 编辑模式（htmlRelPath 非空）：来自源码图「改源码重渲染」，完成后 onDone(null) 只刷新图片
 */

export interface FigureRequest {
  pipeline: FigPipeline
  desc: string
  /** code 编辑模式：已有 figures/*.html */
  htmlRelPath?: string
  onDone: (attrs: FigureInsert | null) => void
}

interface FigureDialogProps {
  project: string
  /** 工程目录绝对路径（预览 PNG 走 asset:// 协议） */
  projectDir: string
  /** 当前正文 markdown（优化提示词时回读语境） */
  article: string
  request: FigureRequest
  skill: string | null
  onClose: () => void
}

const PIPELINE_TITLE: Record<FigPipeline, string> = {
  ai: '✨ AI 生图',
  code: '📊 代码绘图',
  import: '📁 导入图片'
}

const btnPrimary =
  'rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap'
const btnGhost =
  'rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap'
const inputCls =
  'w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-600'
const selectCls =
  'rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-600'

export default function FigureDialog({
  project,
  projectDir,
  article,
  request,
  skill,
  onClose
}: FigureDialogProps): ReactElement {
  const assetUrl = useCallback(
    (rel: string) => 'asset://file/' + encodeURIComponent(`${projectDir}\\${rel.replace(/\//g, '\\')}`),
    [projectDir]
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[86vh] w-[720px] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-2.5">
          <span className="text-sm text-slate-200">
            {PIPELINE_TITLE[request.pipeline]}
            {request.htmlRelPath ? `（编辑 ${request.htmlRelPath}）` : ''}
          </span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {request.pipeline === 'ai' && (
            <AiPane project={project} article={article} request={request} skill={skill} />
          )}
          {request.pipeline === 'code' && (
            <CodePane project={project} request={request} skill={skill} assetUrl={assetUrl} />
          )}
          {request.pipeline === 'import' && <ImportPane project={project} request={request} />}
        </div>
      </div>
    </div>
  )
}

// ---------- 管线一：AI 生图 ----------

function AiPane({
  project,
  article,
  request,
  skill
}: {
  project: string
  article: string
  request: FigureRequest
  skill: string | null
}): ReactElement {
  // 占位描述拆成长画面描述（生图提示词）与短图注
  const seed = splitFigDesc(request.desc)
  const [prompt, setPrompt] = useState(seed.prompt)
  const [caption, setCaption] = useState(seed.caption)
  // 按当前图像供应商协议渲染尺寸/比例选项（Agnes 档位+比例 / APIMart 15 比例+清晰度 / OpenAI 像素）
  const [spec, setSpec] = useState<ImageFormatSpec>(() => imageFormatFor(null))
  const [size, setSize] = useState(spec.defaultSize)
  const [ratio, setRatio] = useState(spec.defaultRatio)
  const [b64, setB64] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  useEffect(() => () => abortRef.current?.(), [])

  // 读图像供应商协议 → 切换格式规格（读失败保持 Agnes 默认格式）
  useEffect(() => {
    window.api
      .invoke('settings:getLlm')
      .then((s) => {
        const p = s.providers.find((x) => x.id === s.imageProviderId)
        setSpec(imageFormatFor(p?.imageApi))
      })
      .catch(() => {})
  }, [])

  // 规格变化后夹取非法值：当前 size/ratio 不在新规格选项里 → 用该规格默认值
  useEffect(() => {
    if (!spec.sizes.some((o) => o.value === size)) setSize(spec.defaultSize)
    if (spec.ratios.length > 0 && !spec.ratios.some((o) => o.value === ratio)) setRatio(spec.defaultRatio)
  }, [spec, size, ratio])

  /** 内置 LLM 回读正文定位语境，把简短描述扩写成详细无歧义的生图提示词，流式写回描述框 */
  const polish = useCallback(() => {
    const desc = prompt.trim()
    if (!desc || polishing || busy) return
    setError(null)
    setPolishing(true)
    const { promise, abort } = chatOnce(imagePromptMessages(desc, article, skill), (full) => setPrompt(full))
    abortRef.current = abort
    promise
      .then((full) => setPrompt(full.trim()))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setPolishing(false)
        abortRef.current = null
      })
  }, [prompt, polishing, busy, article, skill])

  const generate = useCallback(async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      setB64(await window.api.invoke('image:generate', prompt.trim(), { size, ratio }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [prompt, busy, size, ratio])

  const insert = useCallback(async () => {
    if (!b64) return
    const rel = await window.api.invoke('project:saveAsset', project, `assets/ai-${Date.now()}.png`, b64)
    request.onDone({ src: rel, alt: seed.caption, caption: caption.trim(), figureSource: '' })
  }, [b64, project, request, caption, seed.caption])

  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs text-slate-400">画面描述（生图提示词）</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={polishing || prompt.length > 80 ? 6 : 3}
        readOnly={polishing}
        className={inputCls}
        placeholder="想要一张什么样的配图…可先写一句话再点「AI 优化描述」扩写成详细提示词"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-400">{spec.sizeLabel}</label>
        <select value={size} onChange={(e) => setSize(e.target.value)} className={selectCls}>
          {spec.sizes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {spec.ratios.length > 0 && (
          <>
            <label className="text-xs text-slate-400">比例</label>
            <select value={ratio} onChange={(e) => setRatio(e.target.value)} className={selectCls}>
              {spec.ratios.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          onClick={polish}
          disabled={polishing || busy || !prompt.trim()}
          title="用内置模型把描述扩写成详细无歧义的生图提示词"
          className={btnGhost}
        >
          {polishing ? '优化中…' : '🪄 AI 优化描述'}
        </button>
        <button onClick={generate} disabled={busy || polishing || !prompt.trim()} className={btnPrimary}>
          {busy ? `生成中…（${spec.waitHint}）` : b64 ? '🔄 重新生成' : '✨ 生成图片'}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">{spec.hint}</p>
      {error && <div className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-400">{error}</div>}
      {b64 && (
        <>
          <img
            src={`data:image/png;base64,${b64}`}
            alt="生成预览"
            className="max-h-[340px] self-center rounded border border-slate-700"
          />
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-xs text-slate-400">图注</label>
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="图片底部的文字标注，可留空；插入后在正文里也能改"
              className={inputCls}
            />
            <button onClick={insert} className={btnPrimary}>
              ✓ 插入正文
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------- 管线二：代码绘图 ----------

function CodePane({
  project,
  request,
  skill,
  assetUrl
}: {
  project: string
  request: FigureRequest
  skill: string | null
  assetUrl: (rel: string) => string
}): ReactElement {
  const editMode = Boolean(request.htmlRelPath)
  const seed = splitFigDesc(request.desc)
  const [instruction, setInstruction] = useState(editMode ? '' : seed.prompt)
  const [rewrite, setRewrite] = useState(false) // 编辑模式：不基于现有源码全新重写
  const [html, setHtml] = useState('')
  const [htmlRel, setHtmlRel] = useState<string | null>(request.htmlRelPath ?? null)
  const [pngRel, setPngRel] = useState<string | null>(null)
  const [previewV, setPreviewV] = useState(0)
  const [streaming, setStreaming] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  // 编辑模式：载入现有源码
  useEffect(() => {
    if (!request.htmlRelPath) return
    window.api
      .invoke('figure:readHtml', project, request.htmlRelPath)
      .then(setHtml)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [project, request.htmlRelPath])

  useEffect(() => () => abortRef.current?.(), [])

  const aiGenerate = useCallback(() => {
    const inst = instruction.trim()
    if (!inst || streaming) return
    setError(null)
    setStreaming(true)
    const { promise, abort } = chatOnce(
      figureHtmlMessages(inst, editMode && html && !rewrite ? html : null, skill),
      (full) => setHtml(stripFence(full))
    )
    abortRef.current = abort
    promise
      .then((full) => setHtml(stripFence(full).trim()))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setStreaming(false)
        abortRef.current = null
      })
  }, [instruction, streaming, editMode, html, rewrite, skill])

  const renderPreview = useCallback(async () => {
    if (!html.trim() || rendering) return
    setRendering(true)
    setError(null)
    try {
      const rel = await window.api.invoke('figure:saveHtml', project, html, htmlRel ?? undefined)
      setHtmlRel(rel)
      const png = await window.api.invoke('figure:render', project, rel)
      setPngRel(png)
      setPreviewV(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRendering(false)
    }
  }, [html, rendering, project, htmlRel])

  const finish = useCallback(() => {
    if (editMode) {
      request.onDone(null) // 只刷新：png 路径没变，App bump 版本即可
    } else if (pngRel && htmlRel) {
      request.onDone({ src: pngRel, alt: seed.caption, caption: seed.caption, figureSource: htmlRel })
    }
  }, [editMode, pngRel, htmlRel, request, seed.caption])

  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs text-slate-400">
        {editMode ? '修改要求（AI 改写源码，也可直接手改下方代码）' : '图表描述（AI 生成自包含 HTML）'}
      </label>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={2}
        className={inputCls}
        placeholder={
          editMode
            ? rewrite
              ? '描述想要的图表，AI 丢弃现有源码从零重画…'
              : '例：把柱状图配色换成暖色系…'
            : '例：2020-2026 年国产手机出货量柱状图…'
        }
      />
      {editMode && (
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={rewrite}
            onChange={(e) => {
              setRewrite(e.target.checked)
              // 勾选全新重写时预填原图提示词，方便在其基础上补充构图要求
              if (e.target.checked && !instruction.trim() && seed.prompt) setInstruction(seed.prompt)
            }}
          />
          全新重写（不基于现有源码，适合构图彻底推倒重来）
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={aiGenerate} disabled={streaming || !instruction.trim()} className={btnPrimary}>
          {streaming ? '生成中…' : editMode ? (rewrite ? '🤖 AI 重写源码' : '🤖 AI 改写源码') : '🤖 AI 生成图表'}
        </button>
        <button onClick={renderPreview} disabled={rendering || streaming || !html.trim()} className={btnGhost}>
          {rendering ? '渲染中…' : '🖼 渲染预览'}
        </button>
        <button onClick={finish} disabled={editMode ? !previewV : !pngRel} className={btnPrimary}>
          {editMode ? '✓ 完成' : '✓ 插入正文'}
        </button>
      </div>
      {error && <div className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-400">{error}</div>}
      <textarea
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        rows={10}
        spellCheck={false}
        className={`${inputCls} font-mono text-[11px] leading-relaxed`}
        placeholder="AI 生成的 HTML 源码会出现在这里，可直接手改后重新渲染…"
      />
      {pngRel && previewV > 0 && (
        <img
          src={`${assetUrl(pngRel)}?v=${previewV}`}
          alt="渲染预览"
          className="max-h-[300px] self-center rounded border border-slate-700"
        />
      )}
    </div>
  )
}

/** 去掉模型偶发的 ```html 围栏 */
function stripFence(text: string): string {
  const m = /```(?:html)?\s*\n([\s\S]*?)(?:```\s*)?$/.exec(text.trim())
  return m ? m[1] : text
}

// ---------- 管线三：导入 + 抠图（单图）/ 多图轮播 ----------

const MAX_IMPORT_EDGE = 1600
const MAX_GALLERY = 6

/** 多图项：处理后的画布 + 缩略图 + 宽高比 */
interface MultiItem {
  cv: HTMLCanvasElement
  url: string
  ratio: number
}

/** 按图片比例推荐图集构图：全竖/全横/方图/混排各有最优布局与取景框 */
function recommendComposition(ratios: number[]): { layout: string; frame: string; reason: string } {
  const n = ratios.length
  const portraits = ratios.filter((r) => r < 0.9).length
  const landscapes = ratios.filter((r) => r > 1.15).length
  if (portraits === n)
    return { layout: 'swipe-h', frame: '3:4', reason: '全部竖图 → 左右滑动并排翻阅，统一 3:4 取景最饱满' }
  if (landscapes === n)
    return n <= 2
      ? { layout: 'grid', frame: '16:9', reason: '全部横图 → 并排拼图一眼看全，统一 16:9 取景' }
      : { layout: 'grid', frame: '4:3', reason: '横图较多 → 拼图同时展示一目了然，统一 4:3 取景' }
  if (portraits === 0 && landscapes === 0)
    return { layout: 'grid', frame: '1:1', reason: '接近方图 → 拼图网格同时展示，1:1 取景整齐划一' }
  return n <= 4
    ? { layout: 'grid', frame: '1:1', reason: '横竖混排且张数不多 → 拼图 + 1:1 取景抹平比例差异，同时展示' }
    : { layout: 'swipe-h', frame: '1:1', reason: '横竖混排且张数多 → 统一 1:1 取景避免高度跳动，左右滑动浏览' }
}

/** 文件 → 缩到 1600px 内的画布 */
async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_IMPORT_EDGE / Math.max(bitmap.width, bitmap.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(bitmap.width * scale)
  cv.height = Math.round(bitmap.height * scale)
  cv.getContext('2d')!.drawImage(bitmap, 0, 0, cv.width, cv.height)
  return cv
}

function ImportPane({ project, request }: { project: string; request: FigureRequest }): ReactElement {
  const seed = splitFigDesc(request.desc)
  const [raw, setRaw] = useState<RawImage | null>(null) // 单图抠图模式
  const [multi, setMulti] = useState<MultiItem[]>([]) // 多图轮播模式
  const [layout, setLayout] = useState('swipe-h')
  const [frame, setFrame] = useState('')
  const [reason, setReason] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [algo, setAlgo] = useState<CutoutAlgo>('none')
  const [param, setParam] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** 选 1 张进抠图流程；多选（或多图模式下追加）进轮播流程，上限 6 张 */
  const loadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      try {
        if (files.length === 1 && multi.length === 0) {
          const cv = await fileToCanvas(files[0])
          const data = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height)
          setRaw({ width: cv.width, height: cv.height, data: data.data })
          setError(null)
          return
        }
        const room = MAX_GALLERY - multi.length
        const items: MultiItem[] = []
        for (const f of files.slice(0, room)) {
          const cv = await fileToCanvas(f)
          items.push({ cv, url: cv.toDataURL('image/jpeg', 0.8), ratio: cv.width / cv.height })
        }
        setMulti((prev) => [...prev, ...items].slice(0, MAX_GALLERY))
        setReason(null)
        setError(files.length > room ? `最多 ${MAX_GALLERY} 张，多余的已忽略` : null)
      } catch {
        setError('图片读取失败，请换一张试试')
      }
    },
    [multi.length]
  )

  // 算法/参数变化 → 重算并画到预览 canvas（透明区棋盘格由 CSS 背景显示）
  useEffect(() => {
    if (!raw || !canvasRef.current) return
    const timer = setTimeout(() => {
      const out = applyCutout(raw, algo, param)
      const cv = canvasRef.current!
      cv.width = out.width
      cv.height = out.height
      // 拷贝一份：ImageData 要求底层是纯 ArrayBuffer（非 SharedArrayBuffer 泛型）
      cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
    }, 120)
    return () => clearTimeout(timer)
  }, [raw, algo, param])

  const pickAlgo = useCallback((id: CutoutAlgo) => {
    setAlgo(id)
    setParam(CUTOUT_ALGOS.find((a) => a.id === id)!.defaultValue)
  }, [])

  const insert = useCallback(async () => {
    const cv = canvasRef.current
    if (!cv || !raw) return
    const b64 = cv.toDataURL('image/png').split(',')[1]
    const rel = await window.api.invoke('project:saveAsset', project, `assets/import-${Date.now()}.png`, b64)
    request.onDone({ src: rel, alt: seed.caption, caption: seed.caption, figureSource: '' })
  }, [raw, project, request, seed.caption])

  /** 多图：逐张落盘 assets/ → 插入 figureGallery 轮播节点 */
  const insertGallery = useCallback(async () => {
    if (multi.length < 2 || busy) return
    setBusy(true)
    try {
      const ts = Date.now()
      const images: GalleryImage[] = []
      for (let k = 0; k < multi.length; k++) {
        const b64 = multi[k].cv.toDataURL('image/png').split(',')[1]
        const rel = await window.api.invoke('project:saveAsset', project, `assets/import-${ts}-${k + 1}.png`, b64)
        images.push({ src: rel, alt: `${seed.caption || '图集'} ${k + 1}` })
      }
      request.onDone({ images, layout, frame, caption: seed.caption })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }, [multi, busy, layout, frame, project, request, seed.caption])

  const algoMeta = CUTOUT_ALGOS.find((a) => a.id === algo)!

  return (
    <div className="flex flex-col gap-3">
      {multi.length > 0 ? (
        <>
          {/* 多图轮播模式：缩略图 + 布局/取景选择 + 智能推荐 */}
          <div className="flex flex-wrap items-start gap-2">
            {multi.map((it, k) => (
              <div key={k} className="relative">
                <img
                  src={it.url}
                  alt={`第 ${k + 1} 张`}
                  className="h-20 rounded border border-slate-700 object-cover"
                />
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] tabular-nums text-slate-300">
                  {it.ratio >= 1 ? `横 ${it.ratio.toFixed(2)}` : `竖 ${it.ratio.toFixed(2)}`}
                </span>
                <button
                  onClick={() => setMulti((p) => p.filter((_, i) => i !== k))}
                  title="移除这张"
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[10px] text-slate-300 hover:bg-red-600 hover:text-white"
                >
                  ✕
                </button>
              </div>
            ))}
            {multi.length < MAX_GALLERY && (
              <button
                onClick={() => fileRef.current?.click()}
                title="继续添加图片"
                className="flex h-20 w-14 items-center justify-center rounded border-2 border-dashed border-slate-700 text-xl text-slate-500 hover:border-sky-600 hover:text-sky-400"
              >
                ＋
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="whitespace-nowrap text-slate-400">布局</span>
            <select value={layout} onChange={(e) => setLayout(e.target.value)} className={selectCls}>
              <option value="swipe-h">左右滑动轮播</option>
              <option value="grid">拼图同时展示</option>
            </select>
            <span className="whitespace-nowrap text-slate-400">取景框</span>
            <select value={frame} onChange={(e) => setFrame(e.target.value)} className={selectCls}>
              <option value="">自适应</option>
              {['3:4', '1:1', '4:3', '16:9'].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                const rec = recommendComposition(multi.map((m) => m.ratio))
                setLayout(rec.layout)
                setFrame(rec.frame)
                setReason(rec.reason)
              }}
              title="根据各张图的横竖比例推荐布局与取景框"
              className={btnGhost}
            >
              ✨ 智能推荐构图
            </button>
          </div>
          {reason && <div className="rounded bg-sky-900/30 px-3 py-2 text-xs text-sky-300">{reason}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={insertGallery} disabled={multi.length < 2 || busy} className={btnPrimary}>
              {busy ? '保存中…' : `✓ 生成图集并插入正文（${multi.length} 张）`}
            </button>
            <button
              onClick={() => {
                setMulti([])
                setReason(null)
              }}
              className={btnGhost}
            >
              清空重选
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            图集支持 2-6 张，插入后可在正文内滑动预览、切换轮播/拼图布局；多图不做抠图，需要抠图请单张导入。
          </p>
        </>
      ) : !raw ? (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void loadFiles(Array.from(e.dataTransfer.files))
          }}
          className="flex h-40 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-700 text-xs text-slate-500 hover:border-sky-600 hover:text-sky-400"
        >
          点击选择或拖入图片（PNG/JPG/WebP）；多选 2-6 张自动生成轮播
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-400">抠图算法：</span>
            {CUTOUT_ALGOS.map((a) => (
              <button
                key={a.id}
                onClick={() => pickAlgo(a.id)}
                title={a.label}
                className={`whitespace-nowrap rounded px-2 py-1 ${
                  algo === a.id ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          {algo !== 'none' && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span className="whitespace-nowrap">{algoMeta.paramLabel}</span>
              <input
                type="range"
                min={algoMeta.min}
                max={algoMeta.max}
                step={algoMeta.step}
                value={param}
                onChange={(e) => setParam(Number(e.target.value))}
                className="flex-1 accent-sky-500"
              />
              <span className="w-10 text-right tabular-nums text-slate-300">{param.toFixed(2)}</span>
            </label>
          )}
          {/* 棋盘格底：透明区可视化 */}
          <div
            className="self-center rounded border border-slate-700 p-1"
            style={{
              background:
                'repeating-conic-gradient(#2a2e39 0% 25%, #1b1d23 0% 50%) 0 0 / 16px 16px'
            }}
          >
            <canvas ref={canvasRef} className="max-h-[340px] max-w-full" style={{ objectFit: 'contain' }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={insert} className={btnPrimary}>
              ✓ 保存并插入正文
            </button>
            <button onClick={() => setRaw(null)} className={btnGhost}>
              换一张
            </button>
          </div>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          void loadFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {error && <div className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-400">{error}</div>}
    </div>
  )
}
