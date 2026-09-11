import { mkdirSync } from 'fs'
import { join } from 'path'
import { COVER_SQUARE, COVER_WIDE, coverHtml, type CoverSize } from '@shared/coverTemplates'
import { projectDir, readMeta, saveAsset, writeMeta, writeTracked } from './projectStore'
import { renderHtmlFixed } from './figureRender'

/**
 * 封面模板渲染：模板 HTML 落 <工程>/covers/，两种比例各渲染一次，
 * 产物写回 assets/cover-235.png 与 assets/cover-11.png——与拖动裁剪流程共用同一出口，
 * 下游（推送草稿取 cover.main、Word/PDF 交稿取 coverAbs）无需任何改动。
 * - covers/*.html 保留为源，Agent 可改后重渲染；不放 figures/（那里有 watcher 会自动重渲染）
 * - 底图以工程相对路径传入，模板内部自行拼 `../` 前缀（HTML 在 covers/ 下）
 */

const OUT: Record<CoverSize, { w: number; h: number; rel: string }> = {
  wide: { w: COVER_WIDE.w, h: COVER_WIDE.h, rel: 'assets/cover-235.png' },
  square: { w: COVER_SQUARE.w, h: COVER_SQUARE.h, rel: 'assets/cover-11.png' }
}

export interface RenderCoverArgs {
  template: string
  title: string
  subtitle?: string
  accent: string
  /** 底图：工程相对路径（如 assets/cover-bg.png）；缺省 = 纯版式 */
  bg?: string
  /** 右下角品牌行（通常传账号名 = 分类名） */
  brand?: string
}

export interface RenderedCover {
  main: string
  square: string
}

/** 渲染双比例封面并写入 project.json.cover（模板 id 一并记下，便于改标题后重渲染） */
export async function renderCoverTemplate(project: string, args: RenderCoverArgs): Promise<RenderedCover> {
  const dir = join(projectDir(project), 'covers')
  for (const size of ['wide', 'square'] as CoverSize[]) {
    const spec = OUT[size]
    const htmlAbs = join(dir, `cover-${size}.html`)
    // writeTracked 不建目录，首次渲染前目录还不存在
    mkdirSync(dir, { recursive: true })
    writeTracked(htmlAbs, coverHtml({ ...args, size, bgSrc: args.bg }))
    const base64 = await renderHtmlFixed(htmlAbs, spec.w, spec.h)
    saveAsset(project, spec.rel, base64)
  }
  // 渲染耗时期间 meta 可能已被别处改写，回写前重读
  const fresh = readMeta(project)
  writeMeta(project, {
    ...fresh,
    cover: { main: OUT.wide.rel, square: OUT.square.rel, template: args.template }
  })
  return { main: OUT.wide.rel, square: OUT.square.rel }
}
