import type { ReactElement } from 'react'
import type { FigSuggestion, FigureOccurrence } from '@shared/wizardProgress'
import type { FigPipeline } from '../../editor/FigSuggest'
import { Icon } from '../../ui/Icon'

/**
 * 创作向导·步 4「配图」：正文 fig-suggest 占位的批量清单。
 * 清单由正文实时推导（事实推导，规格 §5.4）：处理完自动消失、已插图进缩略图条；
 * 每行三个管线按钮与编辑器占位卡同款（配图弹窗按传入管线锁定面板，无内部切换），
 * 成品由 App 做正文行替换。
 */

export interface FigureChecklistProps {
  suggestions: FigSuggestion[]
  images: FigureOccurrence[]
  /** 工程目录绝对路径（缩略图走 asset:// 协议） */
  projectDir: string
  onProcess: (s: FigSuggestion, pipeline: FigPipeline) => void
  onReplaceImage: (img: FigureOccurrence) => void
  /** 去正文定位某个占位/图片（切步 3 并滚动） */
  onLocateInEditor: (snippet: string) => void
}

/** 缩略图地址：工程内相对路径 → asset:// 绝对地址（与导出预览同款解析） */
function assetUrl(projectDir: string, src: string): string {
  return 'asset://file/' + encodeURIComponent(`${projectDir}\\${src.replace(/\//g, '\\')}`)
}

export default function FigureChecklist({
  suggestions,
  images,
  projectDir,
  onProcess,
  onReplaceImage,
  onLocateInEditor
}: FigureChecklistProps): ReactElement {
  const total = suggestions.length + images.length
  const pct = total === 0 ? 100 : Math.round((images.length / total) * 100)

  return (
    <div className="mx-auto max-w-2xl">
      {/* 进度头 */}
      <div className="mb-3 flex items-center gap-3">
        <span className="shrink-0 text-ink">配图进度</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-panel-3">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-ink-dim">
          {images.length} / {total}
        </span>
      </div>

      {/* 待处理占位（行式清单） */}
      {suggestions.length === 0 ? (
        <div className="mb-3 rounded-lg border border-dashed border-panel-3 p-4 text-center text-ink-dim">
          {total === 0 ? (
            <>
              <p>正文里没有配图建议占位。</p>
              <p className="mt-1 text-[11px]">
                全文生成时会按内容自动插入 fig-suggest 占位；不需要配图可直接去下一步，想加图时在正文里另起一行写
                <code className="mx-1 rounded bg-panel-3 px-1">{'<!-- fig-suggest: 画面描述 | 图注 -->'}</code>
              </p>
            </>
          ) : (
            <>
              <Icon name="checkCircle" size={14} className="mr-1 text-st-done" />配图建议已全部处理完。
            </>
          )}
        </div>
      ) : (
        <div className="mb-3 space-y-1.5">
          {suggestions.map((s, i) => (
            <div key={`${s.line}-${i}`} className="rounded-lg border border-panel-3 bg-panel px-3 py-2">
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 font-bold text-accent">{images.length + i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink" title={s.prompt}>
                    {s.prompt}
                  </p>
                  <p className="truncate text-[11px] text-ink-dim" title={s.caption}>
                    图注：{s.caption}
                  </p>
                </div>
                <button
                  onClick={() => onLocateInEditor(s.prompt.slice(0, 12))}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-dim hover:bg-panel-3"
                  title="切到正文查看该占位"
                >
                  去正文
                </button>
              </div>
              {/* 三管线与编辑器占位卡同款：弹窗按管线锁定面板，进入前就得选 */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  onClick={() => onProcess(s, 'ai')}
                  className="rounded border border-panel-3 px-2 py-0.5 text-[11px] text-ink-dim hover:border-accent hover:text-accent"
                  title="AI 文生图 → 预览 → 插入正文"
                >
                  <Icon name="sparkles" size={12} className="mr-1" />AI 生图
                </button>
                <button
                  onClick={() => onProcess(s, 'code')}
                  className="rounded border border-panel-3 px-2 py-0.5 text-[11px] text-ink-dim hover:border-accent hover:text-accent"
                  title="AI 写 HTML 绘图 → 离屏渲染 PNG → 插入"
                >
                  <Icon name="chart" size={12} className="mr-1" />代码绘图
                </button>
                <button
                  onClick={() => onProcess(s, 'import')}
                  className="rounded border border-panel-3 px-2 py-0.5 text-[11px] text-ink-dim hover:border-accent hover:text-accent"
                  title="导入本地图片，可选抠图去背景"
                >
                  <Icon name="folder" size={12} className="mr-1" />导入图片
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 已插图缩略图条 */}
      {images.length > 0 && (
        <div className="rounded-lg border border-panel-3 bg-panel p-2.5">
          <p className="mb-1.5 text-[11px] text-ink-dim">已插图（{images.length}）— 点击缩略图可替换</p>
          <div className="flex flex-wrap gap-2">
            {images.map((img) => (
              <button
                key={img.line}
                onClick={() => onReplaceImage(img)}
                title={img.caption || img.alt || img.src}
                className="group relative h-16 w-24 overflow-hidden rounded border border-panel-3 bg-panel-3"
              >
                <img
                  src={assetUrl(projectDir, img.src)}
                  alt={img.alt}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-[11px] text-white group-hover:flex">
                  替换
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
