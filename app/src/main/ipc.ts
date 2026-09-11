import { ipcMain, BrowserWindow, shell, app } from 'electron'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { IpcApi, IpcEvents, IpcEventChannel, McpAccessCard } from '@shared/types'
import { getAppPaths } from './paths'
import * as store from './projectStore'
import { watchProject, stopProjectWatch } from './watcher'
import { getLlmSettings, setLlmSettings } from './settingsStore'
import { testProvider, chatStart, abortChat, fetchModels } from './llm'
import { listSkills, readSkill, importSkill, setSkillEnabled, saveSkill, removeSkill } from './skillStore'
import { resolveSkillInstall } from './skillFetch'
import { webResearch, webSearch } from './webSearch'
import { generateImage } from './imageGen'
import { saveFigureHtml, readFigureHtml, renderFigure } from './figureRender'
import { readCards, writeCards, renderCard, readArchivedCards, writeArchivedCards } from './cardsStore'
import { renderCoverTemplate } from './coverStore'
import { exportArticleHtml, copyArticleRich, exportPlatformHtml } from './exporter'
import { exportDocx, exportPdf } from './docExport'
import type { PlatformId } from '@shared/types'
import { getWechatConfig, saveWechatConfig, setWechatBinding } from './wechatStore'
import { pushDraft, pushCards, invalidateToken, getPublicIp } from './wechatPublish'
import { listCustomThemes, saveCustomTheme, deleteCustomTheme, fetchUrlHtml } from './themeStore'
import { listCategoryPresets, saveCategoryPreset } from './categoryPresetStore'
import { openMdFile } from './projectStore'

/** 类型安全的 handle 注册：通道名与出入参由 IpcApi 单一来源约束 */
function handle<C extends keyof IpcApi>(
  channel: C,
  fn: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<ReturnType<IpcApi[C]>>
): void {
  ipcMain.handle(channel, (_evt, ...args) => fn(...(args as Parameters<IpcApi[C]>)))
}

// ---------- 拖拽/关联打开 .md 的转发队列 ----------
// 队列放在这里而不是 index.ts：md:takePending 通道要读它，放 index 会形成循环依赖。
// 渲染层挂载后先 invoke md:takePending 拉取积压（启动参数带来的文件），此后
// second-instance 的文件直接走 md:open-request 事件推送，两头都不丢。

/** 从命令行参数里筛出真实存在的 .md 文件路径（去重保序） */
export function extractMdPaths(argv: string[]): string[] {
  const out: string[] = []
  for (const arg of argv) {
    const p = resolve(arg)
    if (!/\.md$/i.test(p) || !existsSync(p)) continue
    if (!out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p)
  }
  return out
}

const pendingOpen = new Set<string>()
let rendererReady = false

/** 窗口就绪前入队，就绪后直接广播给渲染层打开 */
export function queueOrBroadcastMd(p: string): void {
  if (rendererReady) {
    broadcast('md:open-request', { absPath: p })
  } else {
    pendingOpen.add(p)
  }
}

export function registerIpc(): void {
  // 当前被 watcher 监听的工程（删工程时判断是否需要先停监听）
  let watchedProject: string | null = null

  handle('app:ping', () => 'pong')
  handle('app:getPaths', () => getAppPaths())
  // 拉取启动期间积压的拖拽/关联 .md：调用即视为渲染层已就绪，后续改走事件推送
  handle('md:takePending', () => {
    rendererReady = true
    const out = [...pendingOpen]
    pendingOpen.clear()
    return out
  })
  handle('md:openFile', (absPath) => openMdFile(absPath))

  // ---- 窗口控制（无边框自绘标题栏）----
  const targetWin = (): BrowserWindow | null =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  handle('win:minimize', () => targetWin()?.minimize())
  handle('win:toggleMaximize', () => {
    const w = targetWin()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  handle('win:close', () => targetWin()?.close())

  // ---- 工程管理（M2）----
  handle('project:list', () => store.listProjects())
  handle('project:listCategories', () => store.listCategories())
  handle('project:listHiddenCategories', () => store.listDisabledCategories())
  handle('project:deleteCategory', (name) => store.deleteCategory(name))
  handle('project:restoreCategory', (name) => store.restoreCategory(name))
  handle('project:renameCategory', async (oldName, newName) => {
    // 当前打开的工程若在被改名分类下，目录会迁移：先停监听，改名后按新路径重挂
    const p = watchedProject
    if (p) {
      await stopProjectWatch()
      watchedProject = null
    }
    store.renameCategory(oldName, newName)
    if (p) {
      watchProject(p, store.projectDir(p))
      watchedProject = p
    }
  })
  handle('project:create', (name, category) => store.createProject(name, category))
  handle('project:setCategory', async (project, category) => {
    // 正在监听的工程目录被迁移：先停监听，迁移后按新路径重新挂上
    const rewatching = watchedProject === project
    if (rewatching) {
      await stopProjectWatch()
      watchedProject = null
    }
    const meta = store.setProjectCategory(project, category)
    if (rewatching) {
      watchProject(project, store.projectDir(project))
      watchedProject = project
    }
    return meta
  })
  handle('project:delete', async (name) => {
    if (watchedProject === name) {
      await stopProjectWatch()
      watchedProject = null
    }
    store.deleteProject(name)
  })
  handle('project:rename', async (oldName, newName) => {
    // 正在监听的工程目录被改名：先停监听，改完后按新目录重挂（同 setCategory 模式）
    const rewatching = watchedProject === oldName
    if (rewatching) {
      await stopProjectWatch()
      watchedProject = null
    }
    const meta = store.renameProject(oldName, newName)
    if (rewatching) {
      watchProject(newName, store.projectDir(newName))
      watchedProject = newName
    }
    return meta
  })
  handle('project:open', (name) => {
    const data = store.openProject(name)
    watchProject(name, store.projectDir(name))
    watchedProject = name
    return data
  })
  handle('project:close', () => {
    void stopProjectWatch()
    watchedProject = null
  })
  handle('project:readFile', (project, file) => store.readTextFile(project, file))
  handle('project:writeFile', (project, file, content) => store.writeTextFile(project, file, content))
  handle('project:readMeta', (project) => store.readMeta(project))
  handle('project:writeMeta', (project, meta) => store.writeMeta(project, meta))

  handle('project:setSchedule', (project, date) => store.setSchedule(project, date))

  // ---- 模型接入（M4）----
  handle('settings:getLlm', () => getLlmSettings())
  handle('settings:setLlm', (settings) => setLlmSettings(settings))
  handle('llm:test', (provider) => testProvider(provider))
  handle('llm:chatStart', (requestId, messages) => {
    // 不 await：立即返回，增量走 llm:stream 事件
    void chatStart(requestId, messages)
  })
  handle('llm:abort', (requestId) => abortChat(requestId))
  handle('llm:fetchModels', (provider) => fetchModels(provider))

  // ---- 副驾驶（M5）----
  handle('chat:list', (project) => store.listChatSessions(project))
  handle('chat:read', (project, id) => store.readChatSession(project, id))
  handle('chat:write', (project, session) => store.writeChatSession(project, session))
  handle('chat:delete', (project, id) => store.deleteChatSession(project, id))
  handle('skill:list', () => listSkills())
  handle('skill:read', (name) => readSkill(name))

  // ---- Skill 管理 + MCP 接入（M8）----
  handle('skill:import', (sourcePath) => importSkill(sourcePath))
  handle('skill:setEnabled', (name, enabled) => setSkillEnabled(name, enabled))
  handle('skill:remove', (name) => removeSkill(name))
  // 对话安装 Skill：先 resolve 预览，确认卡片点安装后才落盘
  handle('skill:resolve', (directive) => resolveSkillInstall(directive))
  handle('skill:installResolved', (name, content) => saveSkill(name, content))
  handle('mcp:accessCard', () => buildAccessCard())

  handle('project:saveAsset', (project, relPath, base64) => store.saveAsset(project, relPath, base64))
  handle('cover:renderTemplate', (args) => renderCoverTemplate(args.project, args))
  handle('inbox:append', (text) => store.appendIdeaInbox(text))

  // ---- 全局选题库 ----
  handle('ideas:list', () => store.listIdeas())
  handle('ideas:stages', () => store.listIdeaStages())
  handle('ideas:add', (idea) => store.addIdea(idea))
  handle('ideas:remove', (index) => store.removeIdea(index))
  handle('ideas:schedule', (index, date, category) => store.scheduleIdea(index, date, category))

  // ---- 免密联网搜索 ----
  handle('web:search', (query, fresh) => webSearch(query, fresh))
  handle('web:research', (queries) => webResearch(queries))

  // ---- 三配图管线（M6）----
  handle('image:generate', (prompt, opts) => generateImage(prompt, opts))
  handle('figure:saveHtml', (project, html, relPath) => saveFigureHtml(project, html, relPath))
  handle('figure:readHtml', (project, relPath) => readFigureHtml(project, relPath))
  handle('figure:render', (project, htmlRelPath) => renderFigure(project, htmlRelPath))

  // ---- 导出（M7）：variant auto=读者端自动昼夜 / day / night（复制与推送只用 day/night）----
  // platform（M11 多平台分发）：缺省 wechat；知乎/头条/百家走 exportPlatformHtml 落 article-<platform>.html
  handle('export:html', ({ project, variant, platform }: { project: string; variant?: string; platform?: string }) => {
    if (platform && platform !== 'wechat') return exportPlatformHtml(project, platform as 'zhihu' | 'toutiao' | 'baijiahao')
    return exportArticleHtml(project, (variant as 'auto' | 'day' | 'night') ?? 'auto')
  })
  handle(
    'export:copyRich',
    ({ project, variant, platform }: { project: string; variant?: string; platform?: string }) =>
      copyArticleRich(project, variant === 'night' ? 'night' : 'day', (platform as PlatformId | undefined) ?? 'wechat')
  )
  handle('export:openFile', async (absPath) => {
    // 先校验存在：ShellExecute 对不存在的路径会弹 Windows 原生错误框，改走应用内提示
    if (!existsSync(absPath)) throw new Error(`路径不存在：${absPath}`)
    const err = await shell.openPath(absPath)
    if (err) throw new Error(err)
  })
  // ---- 交稿导出（M10）：可编辑 Word + 打印用 PDF，落到工程 <工程>/交付/ ----
  handle('export:docx', (project) => exportDocx(project))
  handle('export:pdf', (project) => exportPdf(project))

  // ---- 贴图卡片 ----
  handle('cards:read', (project) => readCards(project))
  handle('cards:write', (project, deck) => writeCards(project, deck))
  handle('cards:render', (project, index) => renderCard(project, index))
  handle('cards:archiveRead', (project, format) => readArchivedCards(project, format))
  handle('cards:archiveWrite', (project, deck) => writeArchivedCards(project, deck))

  // ---- 公众号推送（多账号：账号 = 分类，UI 接入层绑定，实现在 wechatStore / wechatPublish）----
  handle('wechat:get-config', () => getWechatConfig())
  handle('wechat:save-config', (config) => {
    saveWechatConfig(config)
    // 改密钥/增删账号后清 access_token 缓存，新凭据立即生效
    invalidateToken()
  })
  handle('wechat:set-binding', (category, accountId) => setWechatBinding(category, accountId))
  handle('wechat:push-draft', ({ project, variant }: { project: string; variant?: string }) =>
    pushDraft(project, variant === 'night' ? 'night' : 'day')
  )
  handle('wechat:push-cards', ({ project }) => pushCards(project))
  handle('wechat:public-ip', () => getPublicIp())

  // ---- 自定义排版主题库（导入 HTML/公众号链接复用排版）----
  handle('customTheme:list', () => listCustomThemes())
  handle('customTheme:save', (name, theme) => saveCustomTheme(name, theme))
  handle('customTheme:delete', (name) => deleteCustomTheme(name))
  handle('customTheme:fetchUrl', async (url) => fetchUrlHtml(url))

  // ---- 分类级账号预设（账号 = 分类：新工程自动继承账号级默认）----
  handle('categoryPreset:list', () => listCategoryPresets())
  handle('categoryPreset:set', (category, patch) => saveCategoryPreset(category, patch))
}

/** 生成一键接入卡片：MCP stdio 由纯 Node 代理脚本承接（Windows 下 Electron 主进程无管道 stdio） */
function buildAccessCard(): McpAccessCard {
  const command = process.execPath
  // 代理脚本：dev = <appDir>/resources/；打包 = <exe目录>/resources/（M9 用 extraResources 带入）
  const proxy = app.isPackaged
    ? join(process.resourcesPath, 'mcp-proxy.cjs')
    : join(app.getAppPath(), 'resources', 'mcp-proxy.cjs')
  const args = [proxy]
  const env = { ELECTRON_RUN_AS_NODE: '1' }
  // JSON 字符串转义与 TOML 基本字符串兼容（反斜杠路径安全）
  const codexToml = [
    '[mcp_servers.lig-editor]',
    `command = ${JSON.stringify(command)}`,
    `args = [${args.map((a) => JSON.stringify(a)).join(', ')}]`,
    'env = { ELECTRON_RUN_AS_NODE = "1" }'
  ].join('\n')
  const qoderJson = JSON.stringify({ mcpServers: { 'lig-editor': { command, args, env } } }, null, 2)
  return { command, args, env, codexToml, qoderJson, bridgeFile: join(getAppPaths().settings, 'bridge.json') }
}

/** 主进程 → 全部窗口广播事件 */
export function broadcast<C extends IpcEventChannel>(channel: C, payload: IpcEvents[C]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}
