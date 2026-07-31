import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { clipboard } from 'electron'
import { mdToDoc } from '@shared/markdown'
import { docToExportHtml, extractTitle, wrapExportPage } from '@shared/exportHtml'
import { projectDir, readTextFile, writeTracked } from './projectStore'

/**
 * M7 导出：article.md（唯一事实源）→ article.html 生成物 / 剪贴板富文本
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

/** 导出独立 article.html 到工程目录（图片保持相对路径，文件夹整体可迁移），返回绝对路径 */
export function exportArticleHtml(project: string): string {
  const doc = mdToDoc(readTextFile(project, 'article.md'))
  const fragment = docToExportHtml(doc, (src) => src)
  const page = wrapExportPage(fragment, extractTitle(doc, project))
  const target = join(projectDir(project), 'article.html')
  writeTracked(target, page)
  return target
}

/** 富文本复制：图片全部 dataURL 内嵌，粘贴公众号后台即带图带排版 */
export function copyArticleRich(project: string): void {
  const dir = projectDir(project)
  const md = readTextFile(project, 'article.md')
  const doc = mdToDoc(md)
  const html = docToExportHtml(doc, (src) => toDataUrl(dir, src))
  clipboard.write({ html, text: md })
}
