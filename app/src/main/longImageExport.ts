import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml, exportPageBg } from '@shared/exportHtml'
import type { LongImageResult } from '@shared/types'
import { projectDir, readMeta, readTextFile, writeTracked } from './projectStore'
import { resolveThemeForExport } from './exporter'

/**
 * 整文长图 + 设计长图共用一套离屏管线：
 * - 文章源（exportLongImage）：article.md → 套排版主题的内联样式页（§9.1，与复制/推送/导出
 *   预览完全同源）→ 375 逻辑宽排版 + transform:scale(2) 出 750px 宽 2 倍超采样图（封面同款手法）
 * - 设计源（exportDesignLongImage）：AI 自写设计 HTML（全量 CSS：flex/grid/渐变/图文混排，
 *   无公众号净化约束）→ 750px 画布 1:1 出图，设计稿坐标即输出像素
 * - 公用核 renderHtmlToLongPngs：等字体/图片就绪 → 量整篇高与逐块边界 → 按块分段（切点取
 *   上限内最大块顶，不切字不切图）→ 滚屏逐段捕获
 * - 图片走工程内相对路径：临时渲染页落工程根（与 export_pdf 的 article.html 同款手法，
 *   writeTracked 避开 watcher 回环），不把图片 base64 进字符串，大图集不吃内存；渲染完即删
 * - 文章源配色固定日间（与 export_pdf / 推送默认同源）
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 文章源：内容排版逻辑宽（与导出预览竖屏一致，折行所见即所得）× 超采样 = 输出宽 */
const LAYOUT_W = 375
const SCALE = 2
const IMG_W = LAYOUT_W * SCALE
/** 设计源画布宽：与文章长图输出同宽（手机阅读 750 规格），设计稿坐标即输出像素 */
const DESIGN_W = 750
/** 单段最大输出高：留出余量稳在 Chromium 离屏纹理上限 16384 内 */
const SEG_MAX = 12288

/** 量测脚本：height = 包裹根缩放后包围盒底缘（scrollHeight 在内容矮于视口时会取到视口高，
 *  图下方拖白底，不能用）；blocks = 块容器直子元素的边界。
 *  depth=fragment（文章源）：钻到片段根（root>外壳>片段）并剥单子元素 section 链
 *  （root→page→card 多层包裹），块 = 最内层包裹的直子元素；
 *  depth=direct（设计源）：AI 顶层元素即块——设计稿结构自己管，不越权往里剥 */
function measureScript(depth: 'fragment' | 'direct'): string {
  const probe =
    depth === 'fragment'
      ? `let cur = root.firstElementChild ? root.firstElementChild.firstElementChild : null
  while (cur && cur.tagName === 'SECTION' && cur.children.length === 1 && cur.firstElementChild.tagName === 'SECTION') {
    cur = cur.firstElementChild
  }`
      : 'const cur = root'
  return `(() => {
  const root = document.getElementById('longimg-root')
  if (!root) return { height: 0, blocks: [] }
  ${probe}
  const blocks = cur
    ? [...cur.children]
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { top: Math.floor(r.top), bottom: Math.ceil(r.bottom) }
        })
        .filter((b) => b.bottom > b.top)
    : []
  return { height: Math.ceil(root.getBoundingClientRect().bottom), blocks }
})()`
}

/** 按块边界规划分段（输出像素坐标）：每段在上限内**取最大的块顶**作切点——段高恒 ≤ 上限，
 *  且永远切在块顶（不切字不切图）；某个 span 内一个块顶都没有（单块超上限）才在上限处硬切兜底。 */
function planSegments(
  total: number,
  blocks: { top: number; bottom: number }[],
  segMax: number
): { top: number; bottom: number }[] {
  const tops = [...new Set(blocks.map((b) => b.top).filter((t) => t > 0 && t < total))].sort((a, b) => a - b)
  const segs: { top: number; bottom: number }[] = []
  let start = 0
  while (start < total) {
    const cap = start + segMax
    if (total <= cap) {
      segs.push({ top: start, bottom: total })
      break
    }
    let cand = -1
    for (const t of tops) {
      if (t > cap) break
      if (t > start) cand = t
    }
    if (cand > start) {
      segs.push({ top: start, bottom: cand })
      start = cand
    } else {
      segs.push({ top: start, bottom: cap })
      start = cap
    }
  }
  return segs
}

/** capturePage 带 one-retry：Viz 快照偶发失败（UnknownVizError）等一拍再试一次；
 *  两次都空/败返回 null，由调用方报错。 */
async function captureWithRetry(win: BrowserWindow): Promise<Electron.NativeImage | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(600)
    try {
      const image = await win.webContents.capturePage()
      if (!image.isEmpty()) return image
    } catch {
      /* 落到重试 */
    }
  }
  return null
}

/** 长图离屏渲染公用核：absHtml 须落在工程根（assets/ 相对路径才可解析），视口宽 = width，
 *  量高分段后滚屏逐段捕获，返回逐段 PNG（未落盘）。depth 决定分段边界语义（见 measureScript） */
async function renderHtmlToLongPngs(
  absHtml: string,
  width: number,
  depth: 'fragment' | 'direct',
  segMax = SEG_MAX
): Promise<{ pngs: Buffer[]; widths: number; heights: number[] }> {
  const win = new BrowserWindow({
    show: false,
    width,
    height: 1200,
    webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false }
  })
  try {
    win.setContentSize(width, 1200)
    await win.loadFile(absHtml)
    // 等字体与全部图片就绪：图片高度参与排版，没解码完就量高会把分段切点量错
    await win.webContents.executeJavaScript(
      '(async () => {' +
        'if (document.fonts && document.fonts.ready) await document.fonts.ready;' +
        'await Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r })))' +
        '})()',
      true
    )
    await sleep(300)
    const m = (await win.webContents.executeJavaScript(measureScript(depth), true)) as {
      height: number
      blocks: { top: number; bottom: number }[]
    }
    const segs = planSegments(m.height, m.blocks, segMax)
    if (!segs.length) throw new Error('页面内容为空，无法渲染长图')
    const pngs: Buffer[] = []
    const heights: number[] = []
    for (let i = 0; i < segs.length; i++) {
      const { top, bottom } = segs[i]
      const h = bottom - top
      win.setContentSize(width, h)
      if (top > 0) {
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${top})`, true)
        // 等滚屏后的重绘帧落进离屏缓冲
        await sleep(300)
      } else {
        await sleep(200)
      }
      const image = await captureWithRetry(win)
      if (!image) {
        // Viz 合成器快照失败（Electron 原样透传 UnknownVizError）：重试一次仍败多为页面过重/显存吃紧
        throw new Error(`第 ${i + 1}/${segs.length} 段离屏截图失败（${width}×${h}）：页面可能过重，稍后重试或减少配图后分批导出`)
      }
      heights.push(h)
      pngs.push(image.toPNG())
    }
    return { pngs, widths: width, heights }
  } finally {
    win.destroy()
  }
}

/** 清理历史残留的临时渲染页（上次导出中途崩溃会留下 .longimg-*.html），1 小时前的才清 */
function sweepStaleTmp(dir: string): void {
  try {
    const cutoff = Date.now() - 3600_000
    for (const f of readdirSync(dir)) {
      if (!f.startsWith('.longimg-') || !f.endsWith('.html')) continue
      const abs = join(dir, f)
      if (statSync(abs).mtimeMs < cutoff) rmSync(abs)
    }
  } catch {
    /* 清不掉不影响导出 */
  }
}

/** 写临时渲染页 → 公用核渲染 → PNG 组落「交付/长图/」→ 清临时页。
 *  单张不带序号，分段从 01 起；返回工程相对（正斜杠）与绝对路径。 */
async function runLongExport(
  project: string,
  tmpName: string,
  page: string,
  width: number,
  depth: 'fragment' | 'direct',
  stem: string
): Promise<LongImageResult> {
  const dir = projectDir(project)
  sweepStaleTmp(dir)
  const tmpHtml = join(dir, tmpName)
  writeTracked(tmpHtml, page)
  try {
    const r = await renderHtmlToLongPngs(tmpHtml, width, depth)
    const outDir = join(dir, '交付', '长图')
    mkdirSync(outDir, { recursive: true })
    const name = (i: number) => (r.pngs.length > 1 ? `${stem}-${String(i + 1).padStart(2, '0')}.png` : `${stem}.png`)
    const files_abs = r.pngs.map((png, i) => {
      const abs = join(outDir, name(i))
      writeFileSync(abs, png)
      return abs
    })
    return {
      files: files_abs.map((_, i) => `交付/长图/${name(i)}`),
      files_abs,
      width: r.widths,
      heights: r.heights,
      count: r.pngs.length
    }
  } finally {
    try {
      if (existsSync(tmpHtml)) rmSync(tmpHtml)
    } catch {
      /* 删不掉留待 sweepStaleTmp 下次清理 */
    }
  }
}

/** 导出整文长图（文章源）：返回产物相对路径/绝对路径/宽度/逐张高度/张数 */
export async function exportLongImage(project: string): Promise<LongImageResult> {
  const doc = mdToDoc(readTextFile(project, 'article.md'))
  const theme = resolveThemeForExport(readMeta(project))
  const fragment = docToExportHtml(doc, (src) => src, theme, false)
  // 页面外壳与导出预览（wrapExportPage）同构：375 视口下 max-width 不约束、留 20/16/48 留白
  const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  html { scrollbar-width: none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; width: 0; height: 0; }
</style>
</head>
<body style="margin:0;background:${exportPageBg(theme, false)};">
<div id="longimg-root" style="width:${LAYOUT_W}px;transform:scale(${SCALE});transform-origin:0 0;">
<div style="max-width:677px;margin:0 auto;padding:20px 16px 48px;">${fragment}</div>
</div>
</body>
</html>
`
  return runLongExport(
    project,
    `.longimg-${Date.now().toString(36)}.html`,
    page,
    IMG_W,
    'fragment',
    `${readMeta(project).name}-长图`
  )
}

/** 导出设计长图（设计源）：AI 自写设计 HTML → 750px 画布竖图。
 *  顶层元素即分段安全单元（手册建议按块拆顶层）；全量 CSS 生效，配图 assets/ 相对路径直接嵌 */
export async function exportDesignLongImage(project: string, html: string): Promise<LongImageResult> {
  const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  html { scrollbar-width: none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; width: 0; height: 0; }
</style>
</head>
<body style="margin:0;background:#fff;">
<div id="longimg-root" style="width:${DESIGN_W}px;">
${html}
</div>
</body>
</html>
`
  return runLongExport(
    project,
    `.longimg-design-${Date.now().toString(36)}.html`,
    page,
    DESIGN_W,
    'direct',
    `${readMeta(project).name}-设计`
  )
}
