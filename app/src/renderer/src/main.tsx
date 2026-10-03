import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 首帧前套用持久化的主题：跟随系统（默认，缺省键 = 旧版二值键迁移）按系统深浅，避免启动闪错色
{
  const mode = localStorage.getItem('ui-theme-mode') ?? localStorage.getItem('ui-theme')
  const preferLight =
    mode === 'light' || (mode !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches)
  if (preferLight) document.documentElement.classList.add('light')
}

// 渲染层崩溃可见化：应用没有 ErrorBoundary，任何渲染错误都会白屏——
// 把未捕获错误转发主进程终端（dev 下直接可见），别让白屏无话可说
const reportError = (label: string, err: unknown): void => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  window.api?.invoke('app:reportError', label + ': ' + detail).catch(() => {})
}
window.addEventListener('error', (e) => reportError('error', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
