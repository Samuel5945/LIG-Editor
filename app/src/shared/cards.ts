import { extractJsonArray } from './llmText'

/**
 * 贴图（图片卡片）领域模型与渲染模板（主/渲染进程共用）
 * - 工程内 cards.json 存卡片组；cards/card-N.png 为渲染产物
 * - 两种风格：wechat 公众号贴图（书面、克制）/ xhs 小红书贴图（口语、活泼）
 * - 统一 3:4 竖版 1242×1656，两平台通用
 */

export type CardFormat = 'wechat' | 'xhs'

export interface CardItem {
  /** 封面角标文案（仅封面卡生效）；空 = 平台默认文案 */
  tag?: string
  /** 卡片主标题（封面卡为大标题） */
  title: string
  /** 正文要点，\n 分行，支持 **加粗** */
  body: string
  /** AI 背图画面描述（不含文字元素）；空 = 纯排版底色 */
  bgPrompt: string
  /** 背图 assets/ 相对路径；空 = 未生成 */
  bgImage: string
  /** 背图透出强度 0-100（越大背图越清晰、文字遮罩越淡）；缺省 15 */
  bgOpacity?: number
  /** 深色底反白：背图偏深时底色变深、文字切浅色配色板 */
  dark?: boolean
  /** 文字缩放百分比 80-150（只缩放字号不动版式）；缺省 100 */
  fontScale?: number
  /** 渲染模式：layout 排版+背图（默认）/ ai 整张卡 AI 直接成图 */
  mode?: 'layout' | 'ai'
  /** AI 整卡成图 assets/ 相对路径（mode=ai 时的成品来源） */
  aiImage?: string
  /** 要点序号：内容卡每行前加 01/02 强调色编号（封面卡不生效） */
  numbered?: boolean
  /** 渲染产物 cards/ 相对路径；空 = 未渲染 */
  png: string
}

export interface CardDeck {
  format: CardFormat
  cards: CardItem[]
  /** 强调色（十六进制）：覆盖模板默认强调色（角标/色条/页码/加粗）；缺省 = 平台默认 */
  accent?: string
  /** 发布配文（含话题标签）：发图时直接复制粘贴；转平台后作废需重新生成 */
  caption?: string
}

export const CARD_W = 1242
export const CARD_H = 1656

export const CARD_FORMAT_LABEL: Record<CardFormat, string> = {
  wechat: '公众号贴图',
  xhs: '小红书贴图'
}

/** 模型输出 → 卡片数组（复用 JSON 容错提取），字段缺失补空；解析失败返回 null */
export function parseCardItems(text: string): CardItem[] | null {
  const arr = extractJsonArray<Record<string, unknown>>(text)
  if (!arr) return null
  const cards = arr
    .map((raw) => ({
      tag: typeof raw.tag === 'string' ? raw.tag.trim() : '',
      title: typeof raw.title === 'string' ? raw.title.trim() : '',
      body: typeof raw.body === 'string' ? raw.body.trim() : '',
      bgPrompt: typeof raw.bgPrompt === 'string' ? raw.bgPrompt.trim() : '',
      bgImage: '',
      png: ''
    }))
    .filter((c) => c.title || c.body)
  return cards.length ? cards : null
}

/** 卡片组 → 喂给模型的精简 JSON（只留文案字段，bgImage/png 是本地产物不外传） */
export function cardsPlainText(cards: CardItem[]): string {
  return JSON.stringify(
    cards.map(({ tag, title, body, bgPrompt }) => ({ tag: tag ?? '', title, body, bgPrompt })),
    null,
    2
  )
}

// ---------- 对话换强调色指令（与 skill-install 同构：围栏指令块 → 确认卡片） ----------

const ACCENT_DIRECTIVE_RE = /```cards-accent\s*\n([\s\S]*?)```/

export interface ParsedAccentDirective {
  /** 剥离指令块后的可见文本 */
  cleaned: string
  /** 十六进制色 = 换色；null = 恢复平台默认；undefined = 无指令/解析失败（静默容错） */
  accent?: string | null
}

/** 解析模型回复里的 ```cards-accent {"accent":"#…"|"default"}``` 指令块 */
export function parseAccentDirective(text: string): ParsedAccentDirective {
  const m = text.match(ACCENT_DIRECTIVE_RE)
  if (!m) return { cleaned: text }
  const cleaned = text.replace(ACCENT_DIRECTIVE_RE, '').trimEnd()
  try {
    const raw = JSON.parse(m[1].trim()) as Record<string, unknown>
    if (raw.accent === 'default') return { cleaned, accent: null }
    if (typeof raw.accent === 'string' && isHexColor(raw.accent)) {
      return { cleaned, accent: raw.accent.trim() }
    }
    return { cleaned }
  } catch {
    return { cleaned }
  }
}

// ---------- 卡片 HTML 模板（离屏渲染成 PNG） ----------

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 十六进制颜色校验（#rgb / #rrggbb） */
export function isHexColor(s: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim())
}

/** #rrggbb → rgba(r,g,b,alpha)；#rgb 自动扩展；非法输入返回 null */
export function hexToRgba(hex: string, alpha: number): string | null {
  const h = hex.trim().replace(/^#/, '')
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) return null
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** 未手动调字号时按内容量自适应初值：内容少放大填空；溢出由页内脚本自动缩字兜底 */
export function autoFontScale(card: Pick<CardItem, 'title' | 'body'>): number {
  const lines = card.body.split('\n').filter((l) => l.trim()).length
  const chars = card.title.length + card.body.replace(/\s/g, '').length
  if (lines <= 2 && chars < 50) return 120
  if (lines <= 3 && chars < 90) return 110
  return 100
}

/** 正文行：转义后还原 **加粗** */
const bodyLines = (body: string): string[] =>
  body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => esc(l).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'))

export interface CardHtmlOptions {
  format: CardFormat
  /** 0 起，0 号为封面版式 */
  index: number
  total: number
  /** 背图 src（相对 cards/ 目录，如 ../assets/card-bg-1.png）；空 = 无背图 */
  bgSrc: string
  /** 强调色覆盖（十六进制）；空/非法 = 平台默认 */
  accent?: string
}

/** 生成单张卡片的自包含 HTML（1242×1656 固定画布，viewport 同尺寸截图） */
export function cardHtml(card: CardItem, opts: CardHtmlOptions): string {
  const { format, index, total, bgSrc } = opts
  const cover = index === 0
  const dark = Boolean(card.dark)
  // 强调色覆盖：非法值丢弃，回平台默认
  const accent = opts.accent && isHexColor(opts.accent) ? opts.accent.trim() : ''
  // 文字缩放：手动调过用手动值，否则按内容量自适应；溢出由页内脚本缩字兜底
  const scale = Math.min(150, Math.max(80, card.fontScale ?? autoFontScale(card)))
  const lines = bodyLines(card.body)
  const title = esc(card.title)
  const tag = esc(card.tag ?? '')
  const numbered = Boolean(card.numbered) && !cover
  const pageNo = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
  const inner =
    format === 'wechat'
      ? wechatInner(title, lines, cover, pageNo, dark, tag, scale, accent, numbered)
      : xhsInner(title, lines, cover, dark, tag, scale, accent, numbered)
  // 加粗词上强调色：重点词从正文里跳出来
  const boldColor =
    accent || (format === 'wechat' ? (dark ? '#d9ab5f' : '#b0803c') : dark ? '#ff5c85' : '#ff2e63')
  // 遮罩浓度由背图透出强度反算：bgOpacity 越大遮罩越淡、背图越清晰
  const seen = Math.min(100, Math.max(0, card.bgOpacity ?? 15))
  const veilAlpha = (1 - seen / 100).toFixed(2)
  const overlay =
    format === 'wechat'
      ? `rgba(${dark ? '24, 21, 17' : '246, 242, 234'}, ${veilAlpha})`
      : `rgba(${dark ? '26, 23, 31' : '255, 255, 255'}, ${veilAlpha})`
  const baseBg =
    format === 'wechat'
      ? dark
        ? '#221f1a'
        : '#f6f2ea'
      : dark
        ? 'linear-gradient(160deg, #2b2233 0%, #241f2b 52%, #1b2230 100%)'
        : 'linear-gradient(160deg, #ffe9ec 0%, #fff6e8 52%, #e8f3ff 100%)'
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${CARD_W}px; height: ${CARD_H}px; overflow: hidden; }
  body {
    position: relative;
    font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
    background: ${baseBg};
    -webkit-font-smoothing: antialiased;
  }
  b { color: ${boldColor}; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .veil { position: absolute; inset: 0; background: ${overlay}; }
  .stage { position: absolute; inset: 0; display: flex; flex-direction: column; }
</style>
</head>
<body>
${bgSrc ? `<img class="bg" src="${esc(bgSrc)}">` : ''}
${bgSrc ? '<div class="veil"></div>' : ''}
<div class="stage">
${inner}
</div>
<script>
  // 溢出保护：文字装不下时逐档缩小内容块（zoom 连同间距等比缩），截图前同步完成
  (function () {
    var box = document.querySelector('.stage').firstElementChild
    if (!box) return
    var z = 1
    while (box.scrollHeight > box.clientHeight && z > 0.6) {
      z -= 0.05
      box.style.zoom = z
    }
  })()
</script>
</body>
</html>
`
}

/** 公众号风：米白纸面、细框、衬线气质、无 emoji 装饰；dark 时切浅色字配深底 */
function wechatInner(
  title: string,
  lines: string[],
  cover: boolean,
  pageNo: string,
  dark: boolean,
  tag: string,
  scale: number,
  accent: string,
  numbered: boolean
): string {
  const fz = (n: number): number => Math.round((n * scale) / 100)
  const c = dark
    ? { frame: '#6f6552', eyebrow: '#c9b98f', title: '#f4efe4', sub: '#c9c0b0', accent: '#d9ab5f', divider: '#5a5342', body: '#e0d9c9' }
    : { frame: '#c8bda6', eyebrow: '#a4936f', title: '#26221c', sub: '#6f6555', accent: '#b0803c', divider: '#d9cfba', body: '#464035' }
  // 强调色覆盖着色点：封面色条/页码/要点序号；纸面框线与正文色不动，保住书面气质
  if (accent) c.accent = accent
  const frame = `margin: 56px; border: 3px solid ${c.frame}; flex: 1; display: flex; flex-direction: column; padding: 88px 96px;`
  if (cover) {
    return `<div style="${frame} justify-content: center; text-align: center;">
  <div style="font-size: ${fz(30)}px; letter-spacing: 14px; color: ${c.eyebrow}; margin-bottom: 72px;">${tag || '图 文 卡 片'}</div>
  <h1 style="font-size: ${fz(88)}px; line-height: 1.35; font-weight: 700; color: ${c.title};">${title}</h1>
  <div style="width: 120px; height: 4px; background: ${c.accent}; margin: 64px auto;"></div>
  ${lines.map((l) => `<p style="font-size: ${fz(38)}px; line-height: 1.8; color: ${c.sub};">${l}</p>`).join('\n  ')}
</div>`
  }
  const num = (k: number): string =>
    numbered
      ? `<span style="color: ${c.accent}; font-weight: 700; margin-right: 20px;">${String(k + 1).padStart(2, '0')}</span>`
      : ''
  // 内容卡整块垂直居中：行数少时不再堆在左上角
  return `<div style="${frame} justify-content: center;">
  <div style="display: flex; align-items: baseline; gap: 24px; margin-bottom: 56px;">
    <span style="font-size: ${fz(34)}px; color: ${c.accent}; font-weight: 700;">${pageNo}</span>
    <span style="flex: 1; height: 2px; background: ${c.divider};"></span>
  </div>
  <h2 style="font-size: ${fz(60)}px; line-height: 1.4; font-weight: 700; color: ${c.title}; margin-bottom: 56px;">${title}</h2>
  ${lines.map((l, k) => `<p style="font-size: ${fz(40)}px; line-height: 2; color: ${c.body}; margin-bottom: 20px;">${num(k)}${l}</p>`).join('\n  ')}
</div>`
}

/** 小红书风：暖渐变底、圆角内卡、高亮色（页码排序交给平台）；dark 时内卡变深、文字切浅色 */
function xhsInner(
  title: string,
  lines: string[],
  cover: boolean,
  dark: boolean,
  tag: string,
  scale: number,
  accent: string,
  numbered: boolean
): string {
  const fz = (n: number): number => Math.round((n * scale) / 100)
  const c = dark
    ? { cardBg: 'rgba(30, 27, 34, 0.88)', badge: '#ff5c85', title: '#f6f1ec', sub: '#b3a8a0', mark: 'rgba(255, 46, 99, 0.38)', bar: '#ff5c85', body: '#ddd3cc' }
    : { cardBg: 'rgba(255, 255, 255, 0.92)', badge: '#ff2e63', title: '#2b2320', sub: '#8a7a70', mark: '#ffd9e2', bar: '#ff2e63', body: '#4a413c' }
  // 强调色覆盖着色点：角标/色条/标题荧光笔划线（半透明衍生）
  if (accent) {
    c.badge = accent
    c.bar = accent
    c.mark = hexToRgba(accent, dark ? 0.38 : 0.3) ?? c.mark
  }
  const card = `margin: 64px; background: ${c.cardBg}; border-radius: 48px; box-shadow: 0 24px 64px rgba(160,110,90,0.18); flex: 1; display: flex; flex-direction: column; padding: 88px 84px;`
  const num = (k: number): string =>
    numbered
      ? `<span style="color: ${c.badge}; font-weight: 800; margin-right: 20px;">${String(k + 1).padStart(2, '0')}</span>`
      : ''
  return cover
    ? `<div style="${card} justify-content: center; text-align: center;">
  <div style="font-size: ${fz(34)}px; color: ${c.badge}; font-weight: 700; letter-spacing: 6px; margin-bottom: 56px;">✦ ${tag || '干货分享'} ✦</div>
  <h1 style="font-size: ${fz(92)}px; line-height: 1.3; font-weight: 800; color: ${c.title};">${title}</h1>
  <div style="margin-top: 64px;">
  ${lines.map((l) => `<p style="font-size: ${fz(40)}px; line-height: 1.8; color: ${c.sub};">${l}</p>`).join('\n  ')}
  </div>
</div>`
    : `<div style="${card} justify-content: center;">
  <h2 style="font-size: ${fz(62)}px; line-height: 1.4; font-weight: 800; color: ${c.title}; margin-bottom: 24px;">
    <span style="background: linear-gradient(transparent 62%, ${c.mark} 62%);">${title}</span>
  </h2>
  <div style="width: 88px; height: 8px; border-radius: 4px; background: ${c.bar}; margin-bottom: 48px;"></div>
  ${lines.map((l, k) => `<p style="font-size: ${fz(42)}px; line-height: 1.9; color: ${c.body}; margin-bottom: 22px;">${num(k)}${l}</p>`).join('\n  ')}
</div>`
}
