import { useRef, useState, type ReactElement } from 'react'
import { THINKING_LEVEL_LABEL, type ModelCapability } from '@shared/modelCatalog'
import type { ThinkingChoice, ThinkingLevel } from '@shared/types'

/**
 * 思考强度渐变滑杆（ZCode 形态）：绿→青→蓝渐变轨道 + 白色圆钮，离散吸附到模型档位。
 * 档位序 = 关闭 → 目录 levels（去 none）；纯开关模型只有 关闭/开 两档。
 * 「跟随模型默认」不在轨道上——由外部（Ctrl+T / 菜单项）表达，滑杆显示生效档位。
 * 键盘：←/→ 步进，Home/End 跳两端。
 *
 * 动效（2026-11-05 优化）：拖拽时圆钮连续跟手（不逐档跳），标签实时预览最近档，
 * 松手才提交 onChange 并弹性吸附（cubic-bezier 过冲回弹）；拖拽中圆钮放大+阴影加深；
 * 轨道各档带白色刻度点；标签切换淡入上浮。
 */
export function ThinkingSlider({
  cap,
  value,
  onChange
}: {
  cap: ModelCapability
  value: ThinkingChoice
  onChange: (v: ThinkingChoice) => void
}): ReactElement | null {
  const reasoning = cap.reasoning
  const trackRef = useRef<HTMLDivElement>(null)
  // 拖拽中的连续位置（0..1）；null = 没在拖，圆钮走档位吸附位
  const [dragPos, setDragPos] = useState<number | null>(null)
  if (!reasoning) return null

  // 轨道档位：levels 有则 关闭+levels（none 归到关闭位），纯开关模型 关闭/开
  const stops: ThinkingChoice[] = reasoning.levels
    ? [false, ...reasoning.levels.filter((l): l is ThinkingLevel => l !== 'none')]
    : [false, true]
  // 生效档位 → 轨道索引：跟随态按模型默认开/关落位
  const effective: ThinkingChoice =
    value === null ? (reasoning.defaultOn ? (stops.length > 2 ? stops[stops.length - 1] : true) : false) : value === 'none' ? false : value
  let idx = stops.findIndex((s) => s === effective)
  if (idx < 0) idx = reasoning.defaultOn ? stops.length - 1 : 0
  const stopLabel = (s: ThinkingChoice): string =>
    s === false || s === 'none' ? '关' : typeof s === 'string' ? THINKING_LEVEL_LABEL[s] : '开'
  // 拖拽中预览最近档（不带「跟随」前缀——拖了就是显式选择）；松手后回到受控值文案
  const previewIdx = dragPos === null ? idx : Math.round(dragPos * (stops.length - 1))
  const label = dragPos !== null ? stopLabel(stops[previewIdx]) : value === null ? `跟随（${stopLabel(stops[idx])}）` : stopLabel(stops[idx])
  const knobPct = stops.length > 1 ? ((dragPos ?? idx / (stops.length - 1)) * 100) : 0

  const ratioFromClientX = (clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return idx / Math.max(1, stops.length - 1)
    // 行程内缩半钮宽（mx-2.5=10px），与刻度/圆钮同坐标系
    const inset = 10
    const usable = r.width - inset * 2
    if (usable <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - r.left - inset) / usable))
  }
  const commitRatio = (ratio: number): void => {
    onChange(stops[Math.round(ratio * (stops.length - 1))])
  }

  return (
    <div className="px-3 pb-3 pt-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11.5px] text-ink-dim">思考强度</span>
        {/* key=label：档位变化时淡入上浮，拖拽预览跨档也有反馈 */}
        <span key={label} className="think-label-in text-[12px] font-semibold text-ink">{label}</span>
        <kbd className="ml-auto rounded bg-panel-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">Ctrl+T</kbd>
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label="思考强度"
        aria-valuemin={0}
        aria-valuemax={stops.length - 1}
        aria-valuenow={previewIdx}
        aria-valuetext={label}
        tabIndex={0}
        className="relative h-5 cursor-pointer touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-full"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragPos(ratioFromClientX(e.clientX))
        }}
        onPointerMove={(e) => {
          if (dragPos !== null) setDragPos(ratioFromClientX(e.clientX))
        }}
        onPointerUp={(e) => {
          if (dragPos === null) return
          commitRatio(ratioFromClientX(e.clientX))
          setDragPos(null)
        }}
        onPointerCancel={() => setDragPos(null)}
        onKeyDown={(e) => {
          const step = (i: number): void => onChange(stops[Math.max(0, Math.min(stops.length - 1, i))])
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            step(idx - 1)
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            step(idx + 1)
          } else if (e.key === 'Home') {
            e.preventDefault()
            step(0)
          } else if (e.key === 'End') {
            e.preventDefault()
            step(stops.length - 1)
          }
        }}
      >
        {/* 渐变轨道：绿→青→蓝（ZCode 同款）+ 中间档白色刻度点。
            两端不出点：圆钮行程内缩半个钮宽（mx-2.5），端点刻度会落在轨道圆角外像溢出的杂点 */}
        <div className="absolute inset-x-0 top-1/2 h-3.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500" />
        <div className="absolute inset-x-2.5 top-0 h-full">
          {stops.map((s, i) =>
            i === 0 || i === stops.length - 1 ? null : (
              <span
                key={String(s)}
                aria-hidden="true"
                className={`absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white transition-opacity duration-150 ${
                  i === previewIdx ? 'opacity-0' : 'opacity-45'
                }`}
                style={{ left: `${(i / (stops.length - 1)) * 100}%` }}
              />
            )
          )}
          {/* 圆钮：外层管位置（拖拽跟手无过渡 / 松手弹性吸附），内层管缩放反馈。
              行程与刻度同坐标系（内缩半钮宽），两端钮缘恰好贴轨道圆角端 */}
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${knobPct}%`,
              transition: dragPos !== null ? 'none' : 'left 240ms cubic-bezier(.34,1.56,.64,1)'
            }}
          >
            <div
              className={`h-[18px] w-[18px] rounded-full bg-white transition-[transform,box-shadow] duration-150 ${
                dragPos !== null
                  ? 'scale-125 shadow-[0_2px_8px_rgba(0,0,0,.45)]'
                  : 'scale-100 shadow-[0_1px_4px_rgba(0,0,0,.35)] hover:scale-110'
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
