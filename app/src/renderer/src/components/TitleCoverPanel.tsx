import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { ProjectMeta, TitleCandidate } from '@shared/types'
import { cardsPlainText } from '@shared/cards'
import { chatOnce, extractJsonArray } from '../copilot/llm'
import { titleMessages } from '../copilot/prompts'

interface TitleCoverPanelProps {
  project: string
  meta: ProjectMeta
  /** 当前正文（AI 起标题用） */
  article: string
  skill: string | null
  /** 封面写盘 / meta 变化后通知 App 重新拉 meta */
  onMetaUpdated: () => void
  onToast: (msg: string) => void
}

// 导出尺寸：公众号头图 2.35:1 与朋友圈分享 1:1
const WIDE = { w: 1175, h: 500, rel: 'assets/cover-235.png' }
const SQUARE = { w: 800, h: 800, rel: 'assets/cover-11.png' }

/** 标题/封面 tab：AI 起标题（独立调用）+ 标题候选（打分排序+复制）+ 封面裁切器 */
export default function TitleCoverPanel({
  project,
  meta,
  article,
  skill,
  onMetaUpdated,
  onToast
}: TitleCoverPanelProps): ReactElement {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [wideOffset, setWideOffset] = useState(0.5)
  const [squareOffset, setSquareOffset] = useState(0.5)
  const [saving, setSaving] = useState(false)
  const [titling, setTitling] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const wideRef = useRef<HTMLCanvasElement>(null)
  const squareRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<(() => void) | null>(null)

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

  const pickImage = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => setImg(image)
    image.src = url
  }, [])

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

      {/* ---- 封面裁切 ---- */}
      <h3 className="mb-2 text-sm font-bold text-ink">封面图</h3>
      {meta.cover && (
        <p className="mb-2 text-green-500">✓ 已保存：{meta.cover.main} / {meta.cover.square}</p>
      )}
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
      <button
        onClick={() => fileRef.current?.click()}
        className="mb-3 rounded border border-dashed border-panel-3 px-3 py-1.5 text-ink-dim hover:border-accent hover:text-accent"
      >
        {img ? '换一张图片' : '选择封面原图'}
      </button>

      {img && (
        <div className="max-w-[560px]">
          <p className="mb-1 text-ink-dim">头图 2.35:1（{WIDE.w}×{WIDE.h}）</p>
          <canvas ref={wideRef} width={WIDE.w} height={WIDE.h} className="mb-1 w-full rounded border border-panel-3" />
          <input
            type="range" min={0} max={100} value={wideOffset * 100}
            onChange={(e) => setWideOffset(Number(e.target.value) / 100)}
            className="mb-3 w-full"
          />
          <p className="mb-1 text-ink-dim">方图 1:1（{SQUARE.w}×{SQUARE.h}）</p>
          <canvas ref={squareRef} width={SQUARE.w} height={SQUARE.h} className="mb-1 w-48 rounded border border-panel-3" />
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
