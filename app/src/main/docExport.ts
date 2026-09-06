/**
 * 交稿导出编排（M10）：把文章同时交付为可编辑 Word + 打印用 PDF
 *
 * 产物约定：写入工程目录 <工程>/交付/<工程名>-交稿.docx / .pdf。
 *  - docx：语义化文档（标题/正文/表格/图片都进 Word 原生结构，可继续编辑）
 *  - pdf：复用公众号日间 article.html 排版经隐藏窗口 printToPDF（与预览同源），
 *    A4 分页 + 打印背景，给甲方 / 存档用
 *
 * 均为主进程能力：docx 由 docxExport 纯生成；pdf 需要 Electron BrowserWindow。
 */
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { mdToDoc } from '@shared/markdown'
import { projectDir, readMeta, readTextFile } from './projectStore'
import { resolveThemeForExport, exportArticleHtml } from './exporter'
import { makeDocxDocument, packDocx, resolveProjectImage } from './docxExport'

/** 工程正文排版调性 → 交稿主题（accent / 正文排列 / 强调形态），与推送同源 */
function themeForDelivery(project: string): {
  accent?: string
  bodyAlign?: 'indent' | 'flush' | 'center'
  strongStyle?: 'color' | 'highlight' | 'plain'
  strongColor?: string
  strongBg?: string
} {
  const t = resolveThemeForExport(readMeta(project))
  return {
    accent: t.accent,
    bodyAlign: t.bodyAlign,
    strongStyle: t.strongStyle,
    strongColor: t.strongColor,
    strongBg: t.strongBg
  }
}

/** 封面图绝对路径（meta.cover.main 为 assets/ 相对路径）；无封面返回 undefined */
function coverAbsOf(project: string): string | undefined {
  const meta = readMeta(project)
  const main = meta.cover?.main
  if (!main) return undefined
  return resolveProjectImage(projectDir(project), main)
}

function deliveryTarget(project: string, ext: 'docx' | 'pdf'): string {
  const meta = readMeta(project)
  const dir = join(projectDir(project), '交付')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${meta.name}-交稿.${ext}`)
}

/** 导出可编辑 Word：返回落盘绝对路径 */
export async function exportDocx(project: string): Promise<string> {
  const dir = projectDir(project)
  const meta = readMeta(project)
  const doc = mdToDoc(readTextFile(project, 'article.md'))
  const document = await makeDocxDocument(
    doc,
    dir,
    meta.name,
    themeForDelivery(project),
    coverAbsOf(project)
  )
  const target = deliveryTarget(project, 'docx')
  writeFileSync(target, await packDocx(document))
  return target
}

/** 导出 PDF：复用公众号日间 article.html 排版 → A4 printToPDF；返回落盘绝对路径 */
export async function exportPdf(project: string): Promise<string> {
  // article.html 放工程根（图片相对路径 assets/… 才能被加载）；不预先存在的话导出完清理
  const articlePath = join(projectDir(project), 'article.html')
  const preExisted = existsSync(articlePath)
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, backgroundThrottling: false }
  })
  try {
    // 复用 exporter 的日间 article.html（已落盘），保证 PDF 与复制/推送/预览同源同排版
    exportArticleHtml(project, 'day')
    await win.loadFile(articlePath)
    await win.webContents.executeJavaScript(
      'document.fonts ? document.fonts.ready.then(() => true) : true',
      true
    )
    // 等图片解码与字体稳定再打印，避免首屏白图
    await new Promise((r) => setTimeout(r, 400))
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.55, bottom: 0.55, left: 0.5, right: 0.5 }
    })
    const target = deliveryTarget(project, 'pdf')
    writeFileSync(target, pdf)
    return target
  } finally {
    win.destroy()
    if (!preExisted && existsSync(articlePath)) rmSync(articlePath)
  }
}
