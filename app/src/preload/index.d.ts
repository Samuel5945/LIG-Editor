import type { PreloadApi } from './index'
// 公众号通道（wechat:*）的 IpcApi 模块增强：确保渲染进程类型面也看到新通道
import type {} from '../shared/wechatIpc'

declare global {
  interface Window {
    api: PreloadApi
  }
}

export {}
