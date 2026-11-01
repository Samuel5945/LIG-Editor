import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml, exportPageBg } from '@shared/exportHtml'
import type { LongImageResult } from '@shared/types'
import { projectDir, readMeta, readTextFile, writeTracked } from './projectStore'
import { resolveThemeForExport } from './exporter'

/**
 * 整文长图导出：article.md → 套排版主题的内联样式页（§9.1，与复制/推送/导出预览完全同源）
 * → 离屏渲染整文竖图 PNG，落工程「交付/长图/」
 * - 2 倍超采样：内容按 375 逻辑宽排版（与导出预览「竖屏」同宽，折行一致），最外层
 *   transform:scale(2) 出 750px 宽图——封面模板同款手法（离屏窗口 zoomFactor 实测不生效，不走）
 * - 超长自动分段：先量整篇高度与逐块（段落/标题/图片等块级元素）位置，切点永远落在
 *   块边界——不切字不切图；单段 ≤12288px 输出高，稳在 Chromium 离屏纹理上限 16384 内
 * - 图片走工程内相对路径：临时渲染页落工程根（与 export_pdf 的 article.html 同款手法，
 *   writeTracked 避开 watcher 回环），不把图片 base64 进字符串，大图集不吃内存；渲染完即删
 * - 配色固定日间（与 export_pdf / 推送默认同源）
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 内容排版逻辑宽：与导出预览竖屏（PHONE_W）一致，折行所见即所得 */
const LAYOUT_W = 375
/** 超采样倍数 */
const SCALE = 2
/** 输出图宽 = LAYOUT_W × SCALE */
const IMG_W = LAYOUT_W * SCALE
/** 单段最大输出高：留出余量稳在离屏纹理上限 16384 内 */
const SEG_MAX = 12288

/** 量测脚本：「逐块边界 + 整篇高」，全部取 transform 后的文档坐标（滚动在 0 时即视口坐标）。
 *  整篇高取 #longimg-root 缩放后包围盒底缘——scrollHeight 在内容矮于视口时会取到视口高，
 *  图下方会拖出一条白底，不能用。从包裹壳往里钻到内容最内层容器（root → page → card
 *  逐层剥，只剥单子元素 section 链），块 = 最内层容器的直子元素。 */
const MEASURE_SCRIPT = `(() => {
  const root = document.getElementById('longimg-root')
  if (!root) return { height: 0, blocks: [] }
  let cur = root.firstElementChild ? root.firstElementChild.firstElementChild : null
  while (cur && cur.tagName === 'SECTION' && cur.children.length === 1 && cur.firstElementChild.tagName === 'SECTION') {
    cur = cur.firstElementChild
  }
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

/** 按块边界规划分段（输出像素坐标）：每段在上限内**取最大的块顶**作切点——段高恒 ≤ 上限，
 *  且永远切在块顶（不切字不切图）；某个 span 内一个块顶都没有（单块超上限，如超 tall
 *  通栏图）才在上限处硬切兜底。 */
function planSegments(total: number, blocks: { top: number; bottom: number }[]): { top: number; bottom: number }[] {
  const tops = [...new Set(blocks.map((b) => b.top).filter((t) => t > 0 && t < total))].sort((a, b) => a - b)
  const segs: { top: number; bottom: number }[] = []
  let start = 0
  while (start < total) {
    const cap = start + SEG_MAX
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

/** 导出整文长图：返回产物相对路径/绝对路径/宽度/逐张高度/张数 */
export async function exportLongImage(project: string): Promise<LongImageResult> {
  const dir = projectDir(project)
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
  sweepStaleTmp(dir)
  // 临时渲染页必须落工程根：assets/ 相对路径图片才能被 file:// 加载
  const tmpHtml = join(dir, `.longimg-${Date.now().toString(36)}.html`)
  writeTracked(tmpHtml, page)
  const absFiles: string[] = []
  const heights: number[] = []
  try {
    const win = new BrowserWindow({
      show: false,
      width: IMG_W,
      height: 1200,
      webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false }
    })
    try {
      win.setContentSize(IMG_W, 1200)
      await win.loadFile(tmpHtml)
      // 等字体与全部图片就绪：图片高度参与排版，没解码完就量高会把分段切点量错
      await win.webContents.executeJavaScript(
        '(async () => {' +
          'if (document.fonts && document.fonts.ready) await document.fonts.ready;' +
          'await Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r })))' +
          '})()',
        true
      )
      await sleep(300)
      const m = (await win.webContents.executeJavaScript(MEASURE_SCRIPT, true)) as {
        height: number
        blocks: { top: number; bottom: number }[]
      }
      const segs = planSegments(m.height, m.blocks)
      if (!segs.length) throw new Error('正文为空，无法导出长图')
      const outDir = join(dir, '交付', '长图')
      mkdirSync(outDir, { recursive: true })
      const stem = `${readMeta(project).name}-长图`
      for (let i = 0; i < segs.length; i++) {
        const { top, bottom } = segs[i]
        const h = bottom - top
        win.setContentSize(IMG_W, h)
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
          throw new Error(`第 ${i + 1}/${segs.length} 段离屏截图失败（${IMG_W}×${h}）：页面可能过重，稍后重试或减少配图后分批导出`)
        }
        heights.push(h)
        const abs = join(outDir, `${segBase(i, segs.length, stem)}.png`)
        writeFileSync(abs, image.toPNG())
        absFiles.push(abs)
      }
    } finally {
      win.destroy()
    }
  } finally {
    try {
      if (existsSync(tmpHtml)) rmSync(tmpHtml)
    } catch {
      /* 删不掉留待 sweepStaleTmp 下次清理 */
    }
  }
  return {
    files: absFiles.map((_, i) => `交付/长图/${segBase(i, absFiles.length, `${readMeta(project).name}-长图`)}.png`),
    files_abs: absFiles,
    width: IMG_W,
    heights,
    count: absFiles.length
  }
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

/** 第 i 张的文件名主干（单张不带序号，分段从 01 起）——截图落盘与返回 rel 路径同一规则 */
function segBase(i: number, count: number, stem: string): string {
  return count > 1 ? `${stem}-${String(i + 1).padStart(2, '0')}` : stem
}
