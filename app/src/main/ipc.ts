import { ipcMain, BrowserWindow, shell, app, dialog } from 'electron'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { IpcApi, IpcEvents, IpcEventChannel, McpAccessCard } from '@shared/types'
import { getAppPaths } from './paths'
import * as store from './projectStore'
import { watchProject, stopProjectWatch, setWatchedProjects, unwatchProjectAssets } from './watcher'
import { getLlmSettings, setLlmSettings } from './settingsStore'
import { testProvider, chatStart, abortChat, refreshProviderModels } from './llm'
import { listSkills, readSkill, importSkill, setSkillEnabled, saveSkill, removeSkill } from './skillStore'
import { resolveSkillInstall } from './skillFetch'
import { webResearch, webSearch } from './webSearch'
import { generateImage } from './imageGen'
import { saveFigureHtml, readFigureHtml, renderFigure } from './figureRender'
import { readCards, writeCards, renderCard, readArchivedCards, writeArchivedCards } from './cardsStore'
import { renderCoverHtml, renderCoverTemplate } from './coverStore'
import { exportArticleHtml, copyArticleRich, exportPlatformHtml } from './exporter'
import { exportDocx, exportPdf } from './docExport'
import type { PlatformId } from '@shared/types'
import { getWechatConfig, saveWechatConfig, setWechatBinding } from './wechatStore'
import { pushDraft, pushCards, invalidateToken, getPublicIp } from './wechatPublish'
import { listLibrary, saveTheme, setActiveTheme, deleteTheme, fetchUrlHtml } from './themeStore'
import { listCategoryPresets, saveCategoryPreset } from './categoryPresetStore'
import { openMdFile } from './projectStore'
import { checkForUpdate, dismissVersion } from './updateChecker'
import { callTool, listExecTools } from './capabilityCore'

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

/** 当前被 watcher 监听的工程（改名/删除/迁移分类时判断是否需要先停监听）。
 *  模块级而非 registerIpc 闭包内：MCP 能力核绕过 IPC 直调 store 做同样的目录变动时，
 *  必须复用同一套收尾，否则工程改完名，正打开着的那篇的热载监听还停在旧目录上 */
let watchedProject: string | null = null

/** 工程目录即将被改名/删除/迁移：先停监听并摘掉资产监听，返回原本是否在监听（调用方据此决定要不要重挂） */
export async function pauseProjectWatcher(name: string): Promise<boolean> {
  const was = watchedProject === name
  if (was) {
    await stopProjectWatch()
    watchedProject = null
  }
  unwatchProjectAssets(name)
  return was
}

/** 目录变动落定后按新路径重挂监听（仅当 pauseProjectWatcher 返回 true 才该调用） */
export function resumeProjectWatcher(name: string): void {
  watchProject(name, store.projectDir(name))
  watchedProject = name
}

export function registerIpc(): void {
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

  /** 破坏性操作确认：带父窗口的原生问答框。
   *  渲染层 window.confirm 在 Windows 上关掉后焦点不回到 BrowserWindow，
   *  之后页面里点了没反应（切出窗口再切回才恢复）——删除会话实测命中，故统一走这里 */
  handle('dialog:confirm', async (message, title, okLabel) => {
    const w = targetWin()
    if (!w) return false
    // message 是加粗主句，换行后的说明放 detail，免得原生框里挤成一段
    const [head, ...rest] = message.split('\n')
    const { response } = await dialog.showMessageBox(w, {
      type: 'warning',
      title: title ?? '需要确认',
      message: head,
      detail: rest.join('\n').trim() || undefined,
      buttons: [okLabel ?? '确定', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    return response === 0
  })

  // ---- 工程管理（M2）----
  handle('app:reportError', (message) => console.error('[renderer]', message))
  handle('project:list', () => store.listProjects())
  handle('project:listDuplicates', () => store.findDuplicateProjects())
  handle('project:listCategories', () => store.listCategories())
  handle('project:listHiddenCategories', () => store.listDisabledCategories())
  handle('project:deleteCategory', (name) => store.deleteCategory(name))
  handle('project:listPurgedCategories', () => store.listPurgedCategories())
  handle('project:categoryPurgeInfo', (name) => store.categoryPurgeInfo(name))
  handle('project:purgeCategory', (name) => store.purgeCategory(name))
  handle('project:restoreCategory', (name) => store.restoreCategory(name))
  handle('project:renameCategory', async (oldName, newName) => {
    // 当前打开的工程若在被改名分类下，目录会迁移：先停监听，改名后按新路径重挂
    const p = watchedProject
    if (p) await pauseProjectWatcher(p)
    store.renameCategory(oldName, newName)
    if (p) resumeProjectWatcher(p)
  })
  handle('project:create', (name, category) => store.createProject(name, category))
  handle('project:setCategory', async (project, category) => {
    // 正在监听的工程目录被迁移：先停监听，迁移后按新路径重新挂上
    const was = await pauseProjectWatcher(project)
    const meta = store.setProjectCategory(project, category)
    if (was) resumeProjectWatcher(project)
    return meta
  })
  handle('project:delete', async (name) => {
    await pauseProjectWatcher(name)
    store.deleteProject(name)
  })
  handle('project:rename', async (oldName, newName) => {
    // 正在监听的工程目录被改名：先停监听，改完后按新目录重挂（同 setCategory 模式）
    const was = await pauseProjectWatcher(oldName)
    const meta = store.renameProject(oldName, newName)
    if (was) resumeProjectWatcher(newName)
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
  handle('project:writeFile', (project, file, content) => {
    const r = store.writeTextFile(project, file, content)
    // 审阅报告落盘 = 进审阅（选题看板「已成稿」的依据），与会话路径 save_review 同规则
    if (file === 'review.md' && store.advanceStatus(project, 'reviewing')) {
      broadcast('file:external-change', { project, file: 'project.json' })
    }
    return r
  })
  handle('project:readMeta', (project) => store.readMeta(project))
  handle('project:writeMeta', (project, meta) => store.writeMeta(project, meta))
  // ---- 左栏工作树：资产清单 + 按需监听 ----
  handle('project:listAssets', (project) => store.listProjectAssets(project))
  handle('project:setWatchedProjects', (names) => setWatchedProjects(names))

  handle('project:setSchedule', (project, date) => store.setSchedule(project, date))

  // ---- 模型接入（M4）----
  handle('settings:getLlm', () => getLlmSettings())
  handle('settings:setLlm', (settings) => {
    setLlmSettings(settings)
    // 通知各面板重拉供应商信息（能力声明/模型缓存可能已变）
    broadcast('settings:llmChanged', null)
  })
  handle('llm:test', (provider) => testProvider(provider))
  handle('llm:chatStart', (requestId, messages, options) => {
    // 不 await：立即返回，增量走 llm:stream 事件（思考过程在 reasoning 字段）
    void chatStart(requestId, messages, options)
  })
  handle('llm:abort', (requestId) => abortChat(requestId))
  // 拉取并按文本/生图分类落盘缓存；失败回退旧缓存
  handle('llm:fetchModels', (provider) => refreshProviderModels(provider))

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
  // ---- 对话副驾驶工具调用（chat-tools v1）：能力核工具暴露给内部对话 ----
  handle('agent:listTools', () => listExecTools())
  handle('agent:callTool', async (name: string, args: Record<string, unknown>) => {
    try {
      return { ok: true, result: await callTool(name, args) }
    } catch (err) {
      // 错误不抛：作为 tool 结果回传给模型，由它自行解释或换路
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  handle('project:saveAsset', (project, relPath, base64) => store.saveAsset(project, relPath, base64))
  handle('cover:renderTemplate', (args) => renderCoverTemplate(args.project, args))
  // 自定义 HTML 直渲：作者/Agent 手写的 covers/*.html 走这里出图，界面不重生成它的源文件
  handle('cover:renderHtml', ({ project, ...args }) => renderCoverHtml(project, args))
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
  // 生图请求注册表：渲染层传 reqId + 点「停止」经 image:cancel 中断主进程侧 fetch
  // （信号跨进程传不了，按 reqId 在主进程建 controller；用完即摘，防泄漏）
  const imageGenControllers = new Map<string, AbortController>()
  handle('image:generate', async (prompt, opts, reqId) => {
    if (!reqId) return generateImage(prompt, opts)
    const controller = new AbortController()
    imageGenControllers.set(reqId, controller)
    try {
      return await generateImage(prompt, opts, controller.signal)
    } finally {
      imageGenControllers.delete(reqId)
    }
  })
  handle('image:cancel', (reqId) => {
    const controller = imageGenControllers.get(reqId)
    if (!controller) return false
    controller.abort()
    return true
  })
  handle('figure:saveHtml', (project, html, relPath) => saveFigureHtml(project, html, relPath))
  handle('figure:readHtml', (project, relPath) => readFigureHtml(project, relPath))
  handle('figure:render', (project, htmlRelPath) => renderFigure(project, htmlRelPath))

  // ---- 导出（M7）：variant auto=读者端自动昼夜 / day / night（复制与推送只用 day/night）----
  // platform（M11 多平台分发）：缺省 wechat；知乎/头条/百家走 exportPlatformHtml 落 article-<platform>.html
  handle('export:html', ({ project, variant, platform }: { project: string; variant?: string; platform?: string }) => {
    const r =
      platform && platform !== 'wechat'
        ? exportPlatformHtml(project, platform as 'zhihu' | 'toutiao' | 'baijiahao')
        : exportArticleHtml(project, (variant as 'auto' | 'day' | 'night') ?? 'auto')
    store.stampExported(project)
    return r
  })
  handle(
    'export:copyRich',
    ({ project, variant, platform }: { project: string; variant?: string; platform?: string }) => {
      const r = copyArticleRich(
        project,
        variant === 'night' ? 'night' : 'day',
        (platform as PlatformId | undefined) ?? 'wechat'
      )
      store.stampExported(project)
      return r
    }
  )
  handle('export:openFile', async (absPath) => {
    // 先校验存在：ShellExecute 对不存在的路径会弹 Windows 原生错误框，改走应用内提示
    if (!existsSync(absPath)) throw new Error(`路径不存在：${absPath}`)
    const err = await shell.openPath(absPath)
    if (err) throw new Error(err)
  })
  // ---- 交稿导出（M10）：可编辑 Word + 打印用 PDF，落到工程 <工程>/交付/ ----
  handle('export:docx', (project) => {
    const r = exportDocx(project)
    store.stampExported(project)
    return r
  })
  handle('export:pdf', (project) => {
    const r = exportPdf(project)
    store.stampExported(project)
    return r
  })

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
  handle('wechat:push-draft', async ({ project, variant }: { project: string; variant?: string }) => {
    const r = await pushDraft(project, variant === 'night' ? 'night' : 'day')
    if (r.ok) store.stampExported(project)
    return r
  })
  handle('wechat:push-cards', async ({ project }) => {
    const r = await pushCards(project)
    if (r.ok) store.stampExported(project)
    return r
  })
  handle('wechat:public-ip', () => getPublicIp())

  // ---- 自定义排版主题库（v2：主题独立命名，分类挂多套，active 指针定当前套用）----
  handle('customTheme:list', () => listLibrary())
  handle('customTheme:save', (name, theme, category) => saveTheme(name, theme, category))
  handle('customTheme:setActive', (category, name) => setActiveTheme(category, name ?? null))
  handle('customTheme:delete', (name) => deleteTheme(name))
  handle('customTheme:fetchUrl', async (url) => fetchUrlHtml(url))

  // ---- 分类级账号预设（账号 = 分类：新工程自动继承账号级默认）----
  handle('categoryPreset:list', () => listCategoryPresets())
  handle('categoryPreset:set', (category, patch) => saveCategoryPreset(category, patch))

  // ---- 版本更新检测（提示式，不做自动更新）----
  handle('update:check', () => checkForUpdate())
  handle('update:dismiss', (version) => dismissVersion(version))
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
