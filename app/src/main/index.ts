import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { registerIpc } from './ipc'
import { watchWorkspace } from './watcher'
import { getAppPaths } from './paths'
import { startBridge, stopBridge } from './bridge'
import { seedBundledSkills } from './skillStore'

// --mcp：无头模式（由 resources/mcp-proxy.cjs 拉起）：只开 HTTP bridge 不开窗口
// Windows 下 Electron 主进程拿不到管道 stdin/stdout（electron#4218），MCP stdio 由纯 Node 代理承接后转 HTTP 进来
const MCP_MODE = process.argv.includes('--mcp')

// asset://file/<encodeURIComponent(绝对路径)> —— 渲染进程加载本地图片用（http 源不能直接读 file://）
protocol.registerSchemesAsPrivileged([
  { scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function registerAssetProtocol(): void {
  const workspace = normalize(getAppPaths().workspace).toLowerCase()
  protocol.handle('asset', (req) => {
    const filePath = normalize(decodeURIComponent(new URL(req.url).pathname.replace(/^\//, '')))
    // 只允许读 workspace 内的文件
    if (!filePath.toLowerCase().startsWith(workspace)) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#1b1d23',
    title: '图文编辑器',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 外链一律走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  seedBundledSkills() // 预装 Skill 铺入 <root>/skills（已存在不覆盖）；GUI 与无头模式都需要
  if (MCP_MODE) {
    // 无头模式：不开窗口不起 watcher，只挂 HTTP bridge 供代理转发（figure:render 的离屏窗口不受影响）
    startBridge()
    // 看门狗：代理被强杀（kill 没走到 shutdown）时自行退出，避免孤儿进程占端口
    const parentArg = process.argv.find((a) => a.startsWith('--parent-pid='))
    const parentPid = parentArg ? Number(parentArg.split('=')[1]) : 0
    if (parentPid > 0) {
      setInterval(() => {
        try {
          process.kill(parentPid, 0)
        } catch {
          app.quit()
        }
      }, 5000)
    }
    return
  }
  registerAssetProtocol()
  registerIpc()
  watchWorkspace()
  startBridge()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => stopBridge())

app.on('window-all-closed', () => {
  if (!MCP_MODE && process.platform !== 'darwin') app.quit()
})
