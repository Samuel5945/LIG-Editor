import chokidar, { type FSWatcher } from 'chokidar'
import { relative } from 'path'
import { existsSync } from 'fs'
import { broadcast } from './ipc'
import { isOwnWrite, projectDir as resolveDir } from './projectStore'
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

/** 监听 workspace 顶层：工程新增/删除时通知渲染进程刷新列表
 * depth 2：分类布局下 project.json 位于 workspace/<分类>/<工程>/ 第二层 */
export function watchWorkspace(): void {
  if (workspaceWatcher) return
  workspaceWatcher = chokidar.watch(getAppPaths().workspace, {
    ignoreInitial: true,
    depth: 2,
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

// ---------- 左栏工作树的按需资产监听 ----------
// 树上展开哪个工程就监听哪个（渲染层以展开集合差量同步），与编辑器热载的
// 单例 projectWatcher 互不干扰；树刷新不要求低延迟，轮询间隔放宽省 CPU。

const assetWatchers = new Map<string, FSWatcher>()

function stopAssetWatch(name: string): void {
  const w = assetWatchers.get(name)
  if (!w) return
  assetWatchers.delete(name)
  void w.close()
}

/** 以展开的工程集合做差量挂/卸；names 之外的已有监听一律卸掉 */
export function setWatchedProjects(names: string[]): void {
  const want = new Set(names)
  for (const name of [...assetWatchers.keys()]) {
    if (!want.has(name)) stopAssetWatch(name)
  }
  for (const name of want) {
    if (assetWatchers.has(name)) continue
    const dir = watchedAssetDir(name)
    if (!dir) continue
    const w = chokidar.watch(dir, {
      ignoreInitial: true,
      depth: 2,
      usePolling: true,
      interval: 1500,
      binaryInterval: 3000,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
    })
    w.on('all', (event, filePath) => {
      // 目录增删不单独报——文件 add/unlink 事件本身就会让树重新计数
      if (event === 'addDir' || event === 'unlinkDir') return
      if ((event === 'change' || event === 'add') && isOwnWrite(filePath)) return
      broadcast('workspace:assets-changed', { project: name })
    })
    assetWatchers.set(name, w)
  }
}

/** 工程目录定位复用 projectStore 的缓存；目录已不在（删除/迁移中）返回 null 跳过 */
function watchedAssetDir(name: string): string | null {
  try {
    const dir = resolveDir(name)
    return dir && existsSync(dir) ? dir : null
  } catch {
    return null
  }
}

/** 工程被删除/改名/迁移分类时调用，避免继续监听已失效路径 */
export function unwatchProjectAssets(name: string): void {
  stopAssetWatch(name)
}
