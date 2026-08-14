import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { clipboard } from 'electron'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml, exportPageBg, extractTitle, wrapExportPage, wrapExportPageDayNight } from '@shared/exportHtml'
import { resolveArticleTheme } from '@shared/categoryThemes'
import { projectDir, readMeta, readTextFile, writeTracked } from './projectStore'

/**
 * M7 导出：article.md（唯一事实源）→ article.html 生成物 / 剪贴板富文本
 * 配色变体：'auto' 读者端自动昼夜（仅 article.html，媒体查询）；
 *           'day' 固定日间配色（浅卡深字）；'night' 固定夜间配色（深卡浅字）。
 * 公众号不支持媒体查询 → 复制/推送只用 day/night 二选一。
 */

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
}

/** 工程内相对图片 → dataURL；读不到时原样返回（导出不因单图缺失中断） */
function toDataUrl(dir: string, src: string): string {
  if (/^(data:|https?:)/.test(src)) return src
  const abs = join(dir, src.replace(/\//g, '\\'))
  if (!existsSync(abs)) return src
  const ext = (/\.[a-z0-9]+$/i.exec(src)?.[0] ?? '.png').toLowerCase()
  return `data:${MIME[ext] ?? 'image/png'};base64,${readFileSync(abs).toString('base64')}`
}

export type ExportVariant = 'auto' | 'day' | 'night'

/** 导出独立 article.html 到工程目录（图片保持相对路径，文件夹整体可迁移），返回绝对路径 */
export function exportArticleHtml(project: string, variant: ExportVariant = 'auto'): string {
  const doc = mdToDoc(readTextFile(project, 'article.md'))
  const theme = resolveArticleTheme(readMeta(project))
  const title = extractTitle(doc, project)
  let page: string
  if (variant === 'auto') {
    // 读者端自动昼夜：日间/夜间两套都生成，媒体查询切换（外壳背景同步随系统深浅切换）
    const day = docToExportHtml(doc, (src) => src, theme, false)
    const night = docToExportHtml(doc, (src) => src, theme, true)
    page = wrapExportPageDayNight(day, night, title, exportPageBg(theme, false), exportPageBg(theme, true))
  } else {
    const fragment = docToExportHtml(doc, (src) => src, theme, variant === 'night')
    page = wrapExportPage(fragment, title, exportPageBg(theme, variant === 'night'))
  }
  const target = join(projectDir(project), 'article.html')
  writeTracked(target, page)
  return target
}

/** 富文本复制：图片全部 dataURL 内嵌，粘贴公众号后台即带图带排版；配色固定 day/night 二选一 */
export function copyArticleRich(project: string, variant: 'day' | 'night' = 'day'): void {
  const dir = projectDir(project)
  const md = readTextFile(project, 'article.md')
  const doc = mdToDoc(md)
  const html = docToExportHtml(doc, (src) => toDataUrl(dir, src), resolveArticleTheme(readMeta(project)), variant === 'night')
  clipboard.write({ html, text: md })
}
