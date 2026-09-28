import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { IpcApi, IpcEvents, IpcEventChannel } from '../shared/types'
// 公众号通道（wechat:*）经模块增强并入 IpcApi，类型引入不影响运行时
import type {} from '../shared/wechatIpc'

// 首帧前套用持久化的界面缩放（外观选项的字号档位：小 1.0 / 中 1.1 / 大 1.2），避免启动闪变
{
  const zoom = Number(localStorage.getItem('ui-zoom'))
  if (Number.isFinite(zoom) && zoom > 0) webFrame.setZoomFactor(zoom)
}

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
