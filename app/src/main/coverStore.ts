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
 * - 有底图时先取样决定字色：不在照片上压底色，而是让文字自己选白/深
 */

const OUT: Record<CoverSize, { w: number; h: number; rel: string }> = {
  wide: { w: COVER_WIDE.w, h: COVER_WIDE.h, rel: 'assets/cover-235.png' },
  square: { w: COVER_SQUARE.w, h: COVER_SQUARE.h, rel: 'assets/cover-11.png' }
}

/** 文字区在可见范围内的占比：与 coverTemplates 的左锚定 + 顶部遮罩留白保持一致 */
const TEXT_ZONE = { widthRatio: 0.55, topRatio: 0.2, heightRatio: 0.62 }
/** 亮度高于此值算浅底，改用深色字 */
const LIGHT_THRESHOLD = 0.62

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

/**
 * 取文字落点区域的平均亮度（0-1）。
 * 按 CSS `cover` + 定位反推源图实际可见范围，再取其中文字压着的那一段求均值——
 * 直接看整图平均会被右侧主体带偏，而可读性只取决于文字底下那块。
 */
async function textZoneLuminance(absImg: string, size: CoverSize): Promise<number | null> {
  try {
    const { default: sharp } = await import('sharp')
    const meta = await sharp(absImg).metadata()
    const iw = meta.width ?? 0
    const ih = meta.height ?? 0
    if (!iw || !ih) return null
    const box = OUT[size]
    const scale = Math.max(box.w / iw, box.h / ih)
    const visW = box.w / scale
    const visH = box.h / scale
    // 与模板里的 background-position 对齐：头图居中、方图 78%
    const x0 = (iw - visW) * (size === 'wide' ? 0.5 : 0.78)
    const y0 = (ih - visH) * 0.5
    const left = Math.max(0, Math.min(iw - 1, Math.round(x0)))
    const top = Math.max(0, Math.min(ih - 1, Math.round(y0 + visH * TEXT_ZONE.topRatio)))
    const width = Math.max(1, Math.min(iw - left, Math.round(visW * TEXT_ZONE.widthRatio)))
    const height = Math.max(1, Math.min(ih - top, Math.round(visH * TEXT_ZONE.heightRatio)))
    const px = await sharp(absImg)
      .extract({ left, top, width, height })
      .removeAlpha()
      .resize(1, 1)
      .raw()
      .toBuffer()
    const [r, g, b] = px
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255
  } catch {
    // 读不到图（缺文件/解码失败）就退回白字，各版式无图时也是白字
    return null
  }
}

/** 渲染双比例封面并写入 project.json.cover（模板 id 一并记下，便于改标题后重渲染） */
export async function renderCoverTemplate(project: string, args: RenderCoverArgs): Promise<RenderedCover> {
  const dir = join(projectDir(project), 'covers')
  // 有底图时先取样定字色：浅底用深字，深底用白字——不压任何底色
  let lightText: boolean | undefined
  if (args.bg) {
    const lum = await textZoneLuminance(join(projectDir(project), args.bg), 'wide')
    lightText = lum === null ? true : lum < LIGHT_THRESHOLD
  }
  for (const size of ['wide', 'square'] as CoverSize[]) {
    const spec = OUT[size]
    const htmlAbs = join(dir, `cover-${size}.html`)
    // writeTracked 不建目录，首次渲染前目录还不存在
    mkdirSync(dir, { recursive: true })
    writeTracked(htmlAbs, coverHtml({ ...args, size, bgSrc: args.bg, lightText }))
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
