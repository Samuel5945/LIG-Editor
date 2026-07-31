import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi, IpcEvents, IpcEventChannel } from '../shared/types'

/** 渲染进程侧的类型安全调用面 */
const api = {
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
