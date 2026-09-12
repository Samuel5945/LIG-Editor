import { type ReactElement } from 'react'
import type { UpdateCheckResult, UpdateInfo } from '@shared/types'

interface UpdateDialogProps {
  result: UpdateCheckResult
  /** 手动检查（点顶栏按钮）= true：弹窗完整展示；启动静默检查弹的窗只差一个「忽略此版本」持久化 */
  onDismiss: (version: string) => void
  onClose: () => void
}

/** 新版本下载入口：只渲染该源实际给出的链接，外链走主进程 setWindowOpenHandler → 系统浏览器 */
const DOWNLOAD_LABELS: { key: keyof UpdateInfo['downloads']; label: string }[] = [
  { key: 'quark', label: '夸克网盘下载' },
  { key: 'baidu', label: '百度网盘下载' },
  { key: 'github', label: 'GitHub 下载' },
  { key: 'site', label: '官网详情页' }
]

/**
 * 版本更新弹窗：展示新版本号 / 更新说明 / 下载入口。
 * 提示式更新（不自动下载安装）：网盘分发 + 国内网络 + portable 版均不适合静默升级。
 */
export default function UpdateDialog({ result, onDismiss, onClose }: UpdateDialogProps): ReactElement {
  const info = result.latest
  if (!info) return <></>
  const links = DOWNLOAD_LABELS.filter((d) => info.downloads[d.key])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div className="flex w-[460px] flex-col overflow-hidden rounded-xl border border-panel-3 bg-panel-2 shadow-2xl">
        <div className="flex shrink-0 items-center border-b border-panel-3 px-4 py-2">
          <h2 className="text-sm font-bold">🎉 发现新版本 v{info.version}</h2>
          <button onClick={onClose} className="ml-auto rounded px-2 py-1 text-xs text-ink-dim hover:bg-panel-3">
            关闭 ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3 text-xs">
          <div className="flex items-center gap-2 text-ink-dim">
            <span>
              当前版本 v{result.currentVersion} → 新版本 <span className="font-bold text-ink">v{info.version}</span>
            </span>
            {info.releaseDate && <span className="ml-auto">{info.releaseDate}</span>}
          </div>

          {info.notes && (
            <div className="min-h-0 overflow-auto rounded-lg border border-panel-3 bg-panel p-3 leading-relaxed whitespace-pre-line">
              {info.notes}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {links.map((d) => (
              <button
                key={d.key}
                onClick={() => window.open(info.downloads[d.key])}
                className="rounded-lg border border-panel-3 bg-panel px-3 py-2 text-center font-bold hover:bg-panel-3"
              >
                {d.label}
              </button>
            ))}
          </div>

          <p className="text-ink-dim">
            下载安装包后运行即可覆盖升级（设置与工程保留）。更新来源：
            {info.source === 'site' ? 'ligdesign.win' : 'GitHub Releases'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-panel-3 px-4 py-2">
          <button
            onClick={() => onDismiss(info.version)}
            className="rounded px-2 py-1 text-xs text-ink-dim hover:bg-panel-3"
          >
            忽略此版本
          </button>
          <button onClick={onClose} className="ml-auto rounded bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-500">
            稍后再说
          </button>
        </div>
      </div>
    </div>
  )
}
