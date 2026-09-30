import { type ReactElement } from 'react'
import type { UpdateCheckResult, UpdateInfo } from '@shared/types'
import { DialogShell, DialogFooter } from '../ui/DialogShell'
import { Button } from '../ui/primitives'
import { Icon, type IconName } from '../ui/Icon'

interface UpdateDialogProps {
  result: UpdateCheckResult
  /** 手动检查（点顶栏按钮）= true：弹窗完整展示；启动静默检查弹的窗只差一个「忽略此版本」持久化 */
  onDismiss: (version: string) => void
  onClose: () => void
}

/** 下载入口：只渲染该源实际给出的链接，外链走主进程 setWindowOpenHandler → 系统浏览器 */
const DOWNLOADS: { key: keyof UpdateInfo['downloads']; label: string; sub: string; icon: IconName }[] = [
  { key: 'quark', label: '夸克网盘', sub: '免登录直连', icon: 'cloud' },
  { key: 'baidu', label: '百度网盘', sub: '会员不限速', icon: 'cloud' },
  { key: 'github', label: 'GitHub', sub: 'Releases 源', icon: 'github' },
  { key: 'site', label: '官网详情页', sub: '更新说明全文', icon: 'globe' }
]

/**
 * 版本更新弹窗（§5.11 统一壳）：提示式更新，不自动下载——网盘分发 + 国内网络 + portable 版
 * 都不适合静默升级。四个下载入口按 2×2 卡片排（图标 + 名称 + 一行说明），
 * 「忽略此版本」收进底栏左侧幽灵位。
 */
export default function UpdateDialog({ result, onDismiss, onClose }: UpdateDialogProps): ReactElement {
  const info = result.latest
  if (!info) return <></>
  const links = DOWNLOADS.filter((d) => info.downloads[d.key])

  return (
    <DialogShell
      icon="refresh"
      title={`发现新版本 v${info.version}`}
      hint={info.releaseDate ?? undefined}
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" className="mr-auto" onClick={() => onDismiss(info.version)} title="这个版本不再提示">
            忽略此版本
          </Button>
          <Button variant="sec" size="sm" onClick={onClose}>
            稍后再说
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2 text-xs text-ink-dim">
        <span>
          当前 v{result.currentVersion} <Icon name="chevronRight" size={11} className="mx-1 inline-block" /> 新版本{' '}
          <span className="font-bold text-ink">v{info.version}</span>
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold text-accent">
          {info.source === 'site' ? 'ligdesign.win' : 'GitHub Releases'}
        </span>
      </div>

      {info.notes && (
        <div className="mb-3 max-h-48 overflow-y-auto thin-scroll rounded-lg border border-panel-3 bg-panel p-3 text-xs leading-relaxed whitespace-pre-line text-ink-dim">
          {info.notes}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {links.map((d) => (
          <button
            key={d.key}
            onClick={() => window.open(info.downloads[d.key])}
            className="flex items-center gap-2.5 rounded-lg border border-panel-3 bg-panel px-3 py-2.5 text-left transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-accent"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
              <Icon name={d.icon} size={14} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold text-ink">{d.label}</span>
              <span className="block truncate text-[10.5px] text-ink-dim">{d.sub}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-dim">下载安装包后运行即可覆盖升级，设置与工程全部保留。</p>
    </DialogShell>
  )
}
