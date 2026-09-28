import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { IpcApi, IpcEvents, IpcEventChannel } from '../shared/types'
// 公众号通道（wechat:*）经模块增强并入 IpcApi，类型引入不影响运行时
import type {} from '../shared/wechatIpc'

// 注意：preload 里不要在页面加载前调 webFrame.setZoomFactor——
// 隐藏窗口上改缩放因子会卡住 ready-to-show，窗口永远不显示（字号缩放由渲染层挂载后延迟套用）

/** 渲染进程侧的类型安全调用面 */
const api = {
  /** 界面字号档位切换（外观选项）：整页 webFrame 缩放 */
  setZoomFactor: (factor: number): void => {
    webFrame.setZoomFactor(factor)
  },
  invoke<C extends keyof IpcApi>(
    channel: C,
    ...args: Parameters<IpcApi[C]>
  ): Promise<Awaited<ReturnType<IpcApi[C]>>> {
    return ipcRenderer.invoke(channel, ...args)
  },
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEvents[C]) => void): () => void {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: IpcEvents[C]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

export type PreloadApi = typeof api

contextBridge.exposeInMainWorld('api', api)
