import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 首帧前套用持久化的主题（默认深色），避免日间模式启动闪黑
if (localStorage.getItem('ui-theme') === 'light') document.documentElement.classList.add('light')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
