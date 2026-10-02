import type { ReactElement } from 'react'
import type { ArticleTheme } from '@shared/categoryThemes'
import ExportPanel from './wizard/ExportPanel'

/**
 * M7 导出弹窗：ExportPanel 的弹窗壳（遮罩 + 标题栏），面板体双用于创作向导「导出」步。
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

export default function ExportDialog({
  project,
  projectDir,
  markdown,
  theme,
  category,
  onToast,
  onClose
}: ExportDialogProps): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[88vh] w-[560px] flex-col rounded-lg border border-panel-3 bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-panel-3 px-4 py-2.5">
          <span className="text-sm text-ink">📤 导出（手机宽度预览）</span>
          <button onClick={onClose} className="text-ink-dim hover:text-ink">
            ✕
          </button>
        </div>

        <ExportPanel project={project} projectDir={projectDir} markdown={markdown} theme={theme} category={category} onToast={onToast} />
      </div>
    </div>
  )
}
