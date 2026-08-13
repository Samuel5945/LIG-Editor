import { app, BrowserWindow, Menu, net, protocol, shell } from 'electron'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { registerIpc } from './ipc'
import { watchWorkspace } from './watcher'
import { getAppPaths } from './paths'
import { startBridge, stopBridge } from './bridge'
import { seedBundledSkills } from './skillStore'
import { migrateWorkspaceLayout } from './projectStore'

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
    frame: false, // 无边框：去掉系统标题栏，顶栏由渲染层自绘（拖拽+窗口控制按钮）
    autoHideMenuBar: true,
    backgroundColor: '#1b1d23',
    title: '图文编辑器',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())
  // 菜单栏不可见但保留挂载（复制/粘贴/撤销等编辑快捷键依赖菜单角色）
  win.setMenuBarVisibility(false)

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
  migrateWorkspaceLayout() // 一次性：历史平铺工程挪入「未分类」，分类目录内工程补齐 meta.category
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
  // 只保留编辑/视图菜单的快捷键（菜单栏不显示）：复制粘贴、撤销、开发者工具等照常可用
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'viewMenu' }]))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => stopBridge())

app.on('window-all-closed', () => {
  if (!MCP_MODE && process.platform !== 'darwin') app.quit()
})
