import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import {
  COVER_SQUARE,
  COVER_WIDE,
  DEFAULT_FOCAL,
  NO_BG_TEMPLATES,
  coverHtml,
  squareCropRect,
  type CoverSize
} from '@shared/coverTemplates'
import { projectDir, readMeta, saveAsset, writeMeta, writeTracked } from './projectStore'
import { renderHtmlFixed } from './figureRender'
import { generateImage } from './imageGen'

/**
 * 封面模板渲染：模板 HTML 落 <工程>/covers/cover-wide.html，按 2 倍超采样离屏渲染一张 2.35:1 主图。
 * 产物 assets/cover-235.png 与 assets/cover-11.png——**方图不是第二版设计稿，是主图的裁剪**：
 * 公众号后台只采纳那一张 2.35:1 头图，信息流/分享位的 1:1 由它自己裁，
 * 所以我们另外排一版方图后台根本不用，只能反过来让主图的构图支持被裁出一张好看的 1:1。
 * 出口与拖动裁剪流程相同，下游（推送草稿取 cover.main、Word/PDF 交稿取 coverAbs）无需改动。
 * - covers/cover-wide.html 保留为源，Agent 可改后重渲染；不放 figures/（那里有 watcher 会自动重渲染）
 * - 底图以工程相对路径传入，模板内部自行拼 `../` 前缀（HTML 在 covers/ 下）
 * - 有底图时先取样决定字色：不在照片上压底色，而是让文字自己选白/深
 */

const OUT: Record<CoverSize, { w: number; h: number; rel: string }> = {
  wide: { w: COVER_WIDE.w, h: COVER_WIDE.h, rel: 'assets/cover-235.png' },
  square: { w: COVER_SQUARE.w, h: COVER_SQUARE.h, rel: 'assets/cover-11.png' }
}

/**
 * 主图离屏超采样倍数：版式 HTML 里锁死的是 1175×500，按 2 倍出图后
 * 主图降到 1175×500、方图从 1000×1000 的裁剪区降到 800×800，两步都是下采样。
 */
const SUPERSAMPLE = 2

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** 文字区在可见范围内的占比：与 coverTemplates 的左锚定 + 顶部遮罩留白保持一致 */
const TEXT_ZONE = { widthRatio: 0.55, topRatio: 0.2, heightRatio: 0.62 }
/** 亮度高于此值算浅底，改用深色字 */
const LIGHT_THRESHOLD = 0.62
/**
 * 亮度灰区：文字区落在这个区间里，深字浅字都不稳（不深不浅的杂乱底最坑），
 * panel='auto' 时自动开磨砂面板保底可读性
 */
const GRAY_ZONE = { lo: 0.4, hi: 0.68 }

/**
 * 「现场生底图」的构图约束：封面版式把文字锁在左区，所以底图必须右侧出主体、左侧安静。
 * 写死在这里而不是各调用方自己拼——工具面与界面共用一条路径，避免两侧口径再次漂移。
 */
const BG_COMPOSITION_HINT =
  '。构图要求：主体与视觉重心在画面右侧约三分之一处，左侧三分之二安静留白（渐变、虚化或同色系低对比细节），画面中不出现任何文字、字母或水印'

/**
 * 方图取景：比较底图左右半区的细节量（标准差当代理），主体在哪侧就取到哪侧的边。
 * 提示词要求主体偏右，但模型不保证听话——右半确实更热闹才取到边（1.0），
 * 左半反而更热闹时取最左（0.0），不再盲信构图约定把主体裁出 1:1。
 * 两侧差不多（平庸构图）也回 1.0：那是提示词约定的方向。
 * 为什么取到边而不是旧模型的 0.78：方图现在裁的是**合成后的主图**，而版式右侧那块方形画面区
 * 本来就正好是最右边一个满高正方形——取到边才落在设计留出的画面上，取 0.78 会把标题尾字带进方图。
 */
async function pickFocalX(absImg: string): Promise<number> {
  try {
    const { default: sharp } = await import('sharp')
    const meta = await sharp(absImg).metadata()
    const iw = meta.width ?? 0
    const ih = meta.height ?? 0
    if (!iw || !ih) return DEFAULT_FOCAL
    const half = Math.max(1, Math.floor(iw / 2))
    const [left, right] = await Promise.all([
      sharp(absImg).extract({ left: 0, top: 0, width: half, height: ih }).stats(),
      sharp(absImg).extract({ left: iw - half, top: 0, width: half, height: ih }).stats()
    ])
    const energy = (s: { channels: { stdev: number }[] }): number =>
      s.channels.reduce((acc, c) => acc + (c.stdev || 0), 0)
    const le = energy(left)
    const re = energy(right)
    if (le > re * 1.25) return 0
    return DEFAULT_FOCAL
  } catch {
    return DEFAULT_FOCAL
  }
}

export interface RenderCoverArgs {
  template: string
  title: string
  subtitle?: string
  accent: string
  /** 底图：工程相对路径（如 assets/cover-bg.png）；缺省 = 纯版式 */
  bg?: string
  /**
   * 现场生底图的提示词（与 bg 二选一）：按 2.35:1 生图落 assets/ 再当底图合成。
   * 构图约束见 BG_COMPOSITION_HINT——工具面与界面都走这里，不再各拼一份。
   */
  prompt?: string
  /** 右下角品牌行（通常传账号名 = 分类名） */
  brand?: string
  /** 文字区磨砂面板：auto（缺省，亮度灰区自动开）/ frosted / none；工程 cover.config.json 可给默认 */
  panel?: 'auto' | 'frosted' | 'none'
  /** 装饰元素开关（缺省 true） */
  decor?: boolean
  /**
   * 1:1 方图从主图取哪一段：0=最左（含标题），0.5=居中，1=最右。
   * 缺省按底图左右半区细节量自动判（主体在哪侧就往哪侧取到边），判不出回 DEFAULT_FOCAL（最右）。
   */
  focal?: number
}

/** 每工程封面默认配置：<工程>/covers/cover.config.json，字段被调用参数覆盖 */
interface CoverConfig {
  panel?: 'auto' | 'frosted' | 'none'
  decor?: boolean
  focal?: number
}

function readCoverConfig(project: string): CoverConfig {
  try {
    const abs = join(projectDir(project), 'covers', 'cover.config.json')
    if (!existsSync(abs)) return {}
    const raw = JSON.parse(readFileSync(abs, 'utf8')) as CoverConfig
    return {
      panel: raw.panel === 'frosted' || raw.panel === 'none' ? raw.panel : raw.panel === 'auto' ? 'auto' : undefined,
      decor: typeof raw.decor === 'boolean' ? raw.decor : undefined,
      focal: typeof raw.focal === 'number' && Number.isFinite(raw.focal) ? clamp01(raw.focal) : undefined
    }
  } catch {
    return {}
  }
}

export interface RenderedCover {
  main: string
  square: string
  /** 本次实际使用的底图（现场生图时新落盘的相对路径）；无底图则省略 */
  bg?: string
  /** 方图实际取景位置（0=最左含标题，1=最右），便于调用方判断要不要重裁 */
  focal: number
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

/**
 * 渲染双比例封面并写入 project.json.cover（模板 id 一并记下，便于改标题后重渲染）。
 * 底图两种来源：传 bg 用现成的图；传 prompt 先现场生一张 2.35:1 再合成——
 * 取样、字色、磨砂面板、方图取景这套判定只在这里做一次，工具面与界面共用。
 */
export async function renderCoverTemplate(project: string, args: RenderCoverArgs): Promise<RenderedCover> {
  const dir = join(projectDir(project), 'covers')
  const cfg = readCoverConfig(project)
  if (args.bg && args.prompt) throw new Error('bg 与 prompt 二选一：已有底图传 bg，要现场生图传 prompt')
  // 纯排印版式（editorial/plain）不吃底图：这里直接丢掉 bg，连现场生图那一步都跳过——
  // 不然传了 prompt 会白烧一次生图额度，渲出来却没有底图
  const noBg = NO_BG_TEMPLATES.includes(args.template)
  // prompt 一步路径固定落 assets/cover-bg.png（不带时间戳）：它是「当前封面底图」这个中间件，
  // 每次生成留一份只会把 assets/ 堆脏
  let bg = noBg ? undefined : args.bg
  if (!noBg && args.prompt?.trim()) {
    const base64 = await generateImage(`${args.prompt.trim()}${BG_COMPOSITION_HINT}`, { ratio: '2.35:1' })
    bg = saveAsset(project, 'assets/cover-bg.png', base64)
  }
  // 有底图时先取样定字色：浅底用深字，深底用白字——不压任何底色；
  // 同时分析左右半区细节量决定 1:1 方图取景侧（主体其实在左时不再盲信"主体偏右"的提示词约定）
  let lightText: boolean | undefined
  let lum: number | null = null
  let autoFocal: number | undefined
  if (bg) {
    const absBg = join(projectDir(project), bg)
    lum = await textZoneLuminance(absBg, 'wide')
    lightText = lum === null ? true : lum < LIGHT_THRESHOLD
    autoFocal = await pickFocalX(absBg)
  }
  // 磨砂面板解析：参数 > cover.config.json > auto；auto = 亮度灰区自动开。
  // aurora 例外：它自带左深右浅的暗部渐变（文字区恒近黑），再垫一块磨砂就是暗上加暗、还多一条边界；
  // 而且这里的亮度是**原图**取样，对 aurora 没意义——字色由模板自己定死为浅色（见 coverTemplates 的 aurora 分支）
  const panelPref = args.panel ?? cfg.panel ?? 'auto'
  const panel: 'frosted' | 'none' =
    panelPref === 'frosted'
      ? 'frosted'
      : panelPref === 'none'
        ? 'none'
        : args.template === 'aurora'
          ? 'none'
          : lum !== null && lum >= GRAY_ZONE.lo && lum <= GRAY_ZONE.hi
            ? 'frosted'
            : 'none'
  const decor = args.decor ?? cfg.decor ?? true
  // 1:1 取景：参数 > cover.config.json > 底图自动判 > 取到最右（版式留出的方形画面区/大字版式的首字水印都在最右）
  const focal = clamp01(args.focal ?? cfg.focal ?? autoFocal ?? DEFAULT_FOCAL)

  // 只渲一张 2.35:1 主图：公众号后台只认这张，1:1 是它的裁剪结果而不是第二版设计稿——
  // 另外排一版方图后台不采纳，产物再漂亮也只是自嗨，所以这里不再渲染 cover-square.html。
  // 按 SUPERSAMPLE 倍离屏出图：主图降采样到 1175×500 更锐，方图取满高一段再降到 800×800 同样是下采样，
  // 不会把 500px 的裁剪区放大成糊图。
  mkdirSync(dir, { recursive: true })
  const htmlAbs = join(dir, 'cover-wide.html')
  writeTracked(
    htmlAbs,
    coverHtml({ ...args, size: 'wide', bgSrc: bg, lightText, panel, decor, scale: SUPERSAMPLE })
  )
  // 上一版遗留的方图源文件：留着只会让 Agent 去编辑一个不再参与渲染的死文件
  const staleSquareHtml = join(dir, 'cover-square.html')
  if (existsSync(staleSquareHtml)) rmSync(staleSquareHtml)

  const hiWidth = OUT.wide.w * SUPERSAMPLE
  const hiHeight = OUT.wide.h * SUPERSAMPLE
  const { base64: hiPng } = await renderHtmlFixed(htmlAbs, hiWidth, hiHeight)
  const hi = Buffer.from(hiPng, 'base64')
  const { default: sharp } = await import('sharp')
  // capturePage 给的是「DIP × 设备像素比」：HiDPI 屏上请求 2350×1000 实收 4700×2000。
  // 裁剪一律按解码后的实测尺寸算，绝不拿请求尺寸猜——猜错就是把方图裁到左上角的文字区里。
  const hiSize = await sharp(hi).metadata()
  const main = await sharp(hi)
    .resize(OUT.wide.w, OUT.wide.h, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()
  saveAsset(project, OUT.wide.rel, main.toString('base64'))
  // 方图取「满高的一段」，横位置由 focal 决定（0=最左含标题，1=最右）
  const square = await sharp(hi)
    .extract(squareCropRect(hiSize.width ?? hiWidth, hiSize.height ?? hiHeight, focal))
    .resize(OUT.square.w, OUT.square.h, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()
  saveAsset(project, OUT.square.rel, square.toString('base64'))
  // 渲染耗时期间 meta 可能已被别处改写，回写前重读
  const fresh = readMeta(project)
  writeMeta(project, {
    ...fresh,
    cover: { main: OUT.wide.rel, square: OUT.square.rel, template: args.template }
  })
  return { main: OUT.wide.rel, square: OUT.square.rel, focal, ...(bg ? { bg } : {}) }
}

export interface RenderCoverHtmlArgs {
  /** 工程内相对路径的 HTML（宽高在 HTML 内锁死） */
  html: string
  /** PNG 落盘相对路径，缺省 assets/cover-custom-<时间戳>.png */
  out?: string
  width?: number
  height?: number
  /** 方图从主图取哪一段：0=最左，0.5=居中，1=最右；缺省取到最右 */
  focal?: number
}

/**
 * 自定义 HTML 直渲封面：Agent/作者手写的 covers/*.html（或任意工程内 html）截图落 assets/。
 * 与 renderCoverTemplate 刻意分开：这里**不重生成 HTML、不碰 project.json**——
 * 手改的源文件不会被覆盖，是否设为封面由调用方再用 set_cover 决定。
 * 方图遵循同一条平台事实：公众号后台不认第二张图，1:1 只能是长图的裁剪，
 * 所以横图（w>h）顺带从同一张高清渲染里裁一张 cover-11 口径的方图一起返回。
 */
export async function renderCoverHtml(
  project: string,
  args: RenderCoverHtmlArgs
): Promise<{ path: string; square?: string; focal: number; width: number; height: number }> {
  const absHtml = join(projectDir(project), args.html)
  if (!existsSync(absHtml))
    throw new Error(`HTML 不存在：${args.html}（相对工程根的路径，如 covers/my-cover.html）`)
  const w = Math.round(args.width ?? COVER_WIDE.w)
  const h = Math.round(args.height ?? COVER_WIDE.h)
  const focal = clamp01(args.focal ?? DEFAULT_FOCAL)
  // 手写 HTML 自己锁死画布尺寸，没有超采样可言（模板那条路的 scale 是版式自己套的 transform）
  const { base64: customPng } = await renderHtmlFixed(absHtml, w, h)
  const hi = Buffer.from(customPng, 'base64')
  const saved = saveAsset(project, args.out?.trim() || `assets/cover-custom-${Date.now()}.png`, hi.toString('base64'))
  const { default: sharp } = await import('sharp')
  // capturePage 返回的是「DIP × 设备像素比」：请求 1175×500 在 2x 屏上实收 2350×1000。
  // 尺寸一律回报实测值，别把请求值当成品尺寸告诉调用方，否则 Agent 会按错的口径判断清不清楚
  const size = await sharp(hi).metadata()
  const out = { path: saved, focal, width: size.width ?? w, height: size.height ?? h }
  if (w <= h) return out
  const crop = squareCropRect(out.width, out.height, focal)
  const cut = sharp(hi).extract(crop)
  // 裁剪区够 800 才降采样；不够就按原样落盘——放大只会糊，宁可给一张小一点的方图
  const square = await (crop.height >= OUT.square.h
    ? cut.resize(OUT.square.w, OUT.square.h, { kernel: sharp.kernel.lanczos3 })
    : cut
  )
    .png()
    .toBuffer()
  const squareRel = saved.replace(/\.png$/i, '') + '-11.png'
  return { ...out, square: saveAsset(project, squareRel, square.toString('base64')) }
}
