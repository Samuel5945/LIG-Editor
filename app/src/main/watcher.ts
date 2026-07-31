import chokidar, { type FSWatcher } from 'chokidar'
import { relative } from 'path'
import { broadcast } from './ipc'
import { isOwnWrite } from './projectStore'
import { renderFigure } from './figureRender'
import { getAppPaths } from './paths'

let projectWatcher: FSWatcher | null = null

/** 监听当前打开的工程目录：外部修改（Agent/编辑器之外）推送渲染进程 */
export function watchProject(name: string, dir: string): void {
  void stopProjectWatch()
  projectWatcher = chokidar.watch(dir, {
    ignoreInitial: true,
    depth: 2,
    // Windows 下 fs.watch 会锁住目录导致用户无法在资源管理器删除工程，改用轮询
    usePolling: true,
    interval: 800,
    binaryInterval: 1500,
    // 等写入稳定再触发，避免外部工具分段写文件时读到半截内容
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  })
  projectWatcher.on('all', (event, filePath) => {
    if (event === 'addDir' || event === 'unlinkDir') return
    if ((event === 'change' || event === 'add') && isOwnWrite(filePath)) return
    const rel = relative(dir, filePath).replace(/\\/g, '/')
    broadcast('file:external-change', { project: name, file: rel })
    // 外部（Agent/编辑器）改了图表源码 → 自动重渲染并通知渲染层刷新图片
    if ((event === 'change' || event === 'add') && /^figures\/[^/]+\.html$/.test(rel)) {
      renderFigure(name, rel)
        .then((png) => broadcast('figure:rendered', { project: name, html: rel, png }))
        .catch((err) => console.error(`自动重渲染失败 ${rel}:`, err))
    }
  })
}

export function stopProjectWatch(): Promise<void> {
  const w = projectWatcher
  projectWatcher = null
  return w ? w.close() : Promise.resolve()
}

let workspaceWatcher: FSWatcher | null = null

/** 监听 workspace 顶层：工程新增/删除时通知渲染进程刷新列表 */
export function watchWorkspace(): void {
  if (workspaceWatcher) return
  workspaceWatcher = chokidar.watch(getAppPaths().workspace, {
    ignoreInitial: true,
    depth: 1,
    // 同上：轮询避免锁住 workspace 及其下工程目录
    usePolling: true,
    interval: 1000
  })
  workspaceWatcher.on('all', (event, filePath) => {
    // 只关心工程标志文件 project.json 的出现/消失，以及顶层目录增删
    if (event === 'addDir' || event === 'unlinkDir' || filePath.endsWith('project.json')) {
      broadcast('workspace:changed', null)
    }
  })
}
