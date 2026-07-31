import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { basename, join, normalize } from 'path'
import { projectDir, saveAsset, writeTracked } from './projectStore'

/**
 * 代码绘图（M6 管线二）：figures/*.html 用离屏 BrowserWindow 渲染成 PNG 存入 assets/
 * - saveFigureHtml：写入（或覆盖）图表源码，返回 figures/fig-N.html 相对路径
 * - renderFigure：加载 HTML → 等字体/脚本稳定 → 按内容实际尺寸截图 → assets/fig-N.png
 * 渲染串行排队，避免同时开多个离屏窗口
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let chain: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}

/** 工程内 figures/ 下一个可用编号：fig-1.html、fig-2.html… */
function nextFigureName(project: string): string {
  const dir = join(projectDir(project), 'figures')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  let max = 0
  for (const f of readdirSync(dir)) {
    const m = /^fig-(\d+)\.html$/.exec(f)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `fig-${max + 1}.html`
}

/** 校验并返回 figures/*.html 的绝对路径（防逃逸） */
function resolveFigurePath(project: string, relPath: string): string {
  const dir = projectDir(project)
  const abs = normalize(join(dir, relPath))
  const inFigures = abs.toLowerCase().startsWith(normalize(join(dir, 'figures')).toLowerCase() + '\\')
  if (!inFigures || !abs.toLowerCase().endsWith('.html')) {
    throw new Error(`非法图表路径：${relPath}`)
  }
  return abs
}

/** 保存图表 HTML 源码；relPath 缺省时新建 figures/fig-N.html。带 own-write 标记避免 watcher 回环 */
export function saveFigureHtml(project: string, html: string, relPath?: string): string {
  const rel = relPath ?? `figures/${nextFigureName(project)}`
  const abs = resolveFigurePath(project, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeTracked(abs, html)
  return rel.replace(/\\/g, '/')
}

/** 读图表 HTML 源码（「改源码重渲染」编辑用） */
export function readFigureHtml(project: string, relPath: string): string {
  const abs = resolveFigurePath(project, relPath)
  if (!existsSync(abs)) throw new Error(`图表文件不存在：${relPath}`)
  return readFileSync(abs, 'utf-8')
}

/** 离屏渲染 figures/*.html → assets/<同名>.png，返回 PNG 相对路径 */
export function renderFigure(project: string, htmlRelPath: string): Promise<string> {
  const abs = resolveFigurePath(project, htmlRelPath)
  if (!existsSync(abs)) throw new Error(`图表文件不存在：${htmlRelPath}`)
  return enqueue(() => renderOnce(project, abs))
}

async function renderOnce(project: string, absHtml: string): Promise<string> {
  const win = new BrowserWindow({
    show: false,
    width: 920,
    height: 700,
    webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false }
  })
  try {
    await win.loadFile(absHtml)
    // 等字体就绪 + 给图表库（ECharts/D3 等）一点绘制时间
    await win.webContents.executeJavaScript(
      'document.fonts ? document.fonts.ready.then(() => true) : true',
      true
    )
    await sleep(600)
    // 量内容真实边界（body 直子元素包围盒，而非 scrollWidth：后者永远≥视口，会留白）
    const measure = async (): Promise<{ w: number; h: number }> =>
      (await win.webContents.executeJavaScript(MEASURE_SCRIPT, true)) as { w: number; h: number }
    // 两轮：先按内容定宽，重排后再定高，避免响应式内容换行导致高度失真
    const first = await measure()
    win.setContentSize(clamp(first.w, 320, 1600), clamp(first.h, 200, 2400))
    await sleep(200)
    const final = await measure()
    win.setContentSize(clamp(final.w, 320, 1600), clamp(final.h, 200, 2400))
    await sleep(200)
    const image = await win.webContents.capturePage()
    const pngRel = `assets/${basename(absHtml, '.html')}.png`
    return saveAsset(project, pngRel, image.toPNG().toString('base64'))
  } finally {
    win.destroy()
  }
}

/** 固定画布离屏渲染（贴图卡片用）：不量内容尺寸，直接按给定视口截图，返回 PNG base64 */
export function renderHtmlFixed(absHtml: string, width: number, height: number): Promise<string> {
  return enqueue(async () => {
    const win = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false }
    })
    try {
      win.setContentSize(width, height)
      await win.loadFile(absHtml)
      await win.webContents.executeJavaScript(
        'document.fonts ? document.fonts.ready.then(() => true) : true',
        true
      )
      // 等背图解码绘制稳定
      await sleep(500)
      const image = await win.webContents.capturePage()
      return image.toPNG().toString('base64')
    } finally {
      win.destroy()
    }
  })
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** 内容尺寸 = body 直子元素包围盒右/下缘 + 对称的 body 边距；子元素量不到时回退 scroll 尺寸 */
const MEASURE_SCRIPT = `(() => {
  const b = document.body
  let right = 0, bottom = 0
  if (b) for (const el of b.children) {
    const r = el.getBoundingClientRect()
    right = Math.max(right, r.right)
    bottom = Math.max(bottom, r.bottom)
  }
  if (right < 10 || bottom < 10) {
    return {
      w: Math.ceil(document.documentElement.scrollWidth),
      h: Math.ceil(document.documentElement.scrollHeight)
    }
  }
  const cs = b ? getComputedStyle(b) : null
  const ml = cs ? parseFloat(cs.marginLeft) || 0 : 0
  const mt = cs ? parseFloat(cs.marginTop) || 0 : 0
  return { w: Math.ceil(right + ml), h: Math.ceil(bottom + mt) }
})()`
