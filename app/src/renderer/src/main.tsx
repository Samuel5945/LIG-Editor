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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
