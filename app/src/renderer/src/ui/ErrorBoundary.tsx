import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './primitives'

/**
 * 渲染层兜底：App 任何一个面板/组件在渲染期抛错，到这里换一张可操作的错误页，
 * 不再整窗白屏。App.tsx 持有全局状态、单组件编排全部界面，一处抛错即全应用不可用，
 * 所以边界只包一层（包在最外层），错误信息给足「重载 + 复制详情」两条出路。
 *
 * 本地优先的事实顺带兜住人心：正文事实源是磁盘上的 article.md，界面崩了稿子也在，
 * 文案里直接说这句话。
 */
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 与 main.tsx 的 window error 监听同一条出口：转发主进程终端，dev 下直接可见
    window.api
      ?.invoke('app:reportError', `boundary: ${error.stack ?? error.message}\n${info.componentStack ?? ''}`)
      .catch(() => {})
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const detail = `${error.message}\n\n${error.stack ?? ''}`
    return (
      <div className="flex h-screen w-full items-center justify-center bg-panel p-6">
        <div className="w-full max-w-xl rounded-xl border border-panel-3 bg-panel-2 p-5 shadow-[0_4px_16px_rgba(0,0,0,.28)]">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
            界面出了点问题
          </div>
          <div className="mb-3 text-xs leading-5 text-ink-dim">
            某个面板渲染时崩溃了。正文都存在工程目录的 article.md 里，稿子没有丢；
            重新加载界面即可继续，若反复出现请复制错误详情反馈。
          </div>
          <pre className="mb-3 max-h-48 overflow-auto rounded-lg border border-panel-3 bg-panel p-2.5 text-xs leading-4 text-ink-dim whitespace-pre-wrap break-all">
            {detail}
          </pre>
          <div className="flex gap-2">
            <Button variant="pri" icon="refresh" onClick={() => location.reload()}>
              重新加载
            </Button>
            <Button
              icon="copy"
              onClick={() => navigator.clipboard?.writeText(detail).catch(() => {})}
            >
              复制错误详情
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
