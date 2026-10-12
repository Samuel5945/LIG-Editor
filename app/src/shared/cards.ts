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
  /** 上次渲染的整块缩字系数（页内溢出保护实测，1 = 未缩字）：排版模式渲染后由主进程回写，编辑区据此提示 */
  renderedZoom?: number
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

/**
 * 磁盘 JSON → 规范化 CardDeck：字段白名单重建，白名单外的字段一律丢弃，
 * 新增字段必须在这里透传（cards.json 是不可信外部数据，类型错误在这里拦下而不是炸渲染——
 * 字符串字段同样严判类型，"tag": 123 这类数字透传进模板会在转义时抛异常）。
 * 纯函数放 shared：主进程读盘的唯一闸口，单测可直接验证字段透传。
 */
export function normalizeDeck(raw: Partial<CardDeck>): CardDeck | null {
  if (!Array.isArray(raw.cards)) return null
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    format: raw.format === 'xhs' ? 'xhs' : 'wechat',
    accent: str(raw.accent) || undefined,
    caption: str(raw.caption) || undefined,
    cards: raw.cards.map((c) => ({
      tag: str(c?.tag),
      title: str(c?.title),
      body: str(c?.body),
      bgPrompt: str(c?.bgPrompt),
      bgImage: str(c?.bgImage),
      bgOpacity: typeof c?.bgOpacity === 'number' ? c.bgOpacity : undefined,
      dark: c?.dark === true ? true : undefined,
      fontScale: typeof c?.fontScale === 'number' ? c.fontScale : undefined,
      numbered: c?.numbered === true ? true : undefined,
      mode: c?.mode === 'ai' ? ('ai' as const) : undefined,
      aiImage: str(c?.aiImage),
      renderedZoom: typeof c?.renderedZoom === 'number' ? c.renderedZoom : undefined,
      png: str(c?.png)
    }))
  }
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
/** 是否为十六进制色值（3 位或 6 位）。入参按 unknown 收：meta/主题 JSON 是不可信外部数据，
 *  模型把色值写成数字/对象时这里必须判 false 而不是抛异常（曾因 123.trim() 让整篇导出崩掉） */
export function isHexColor(s: unknown): boolean {
  return typeof s === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim())
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

// 衬线点缀字体栈（公众号风眉标/页码）：只引用系统或用户已安装字体的**字体名**，仓库不内嵌任何
// 字体文件，无 redistribution 授权问题（宋体系与 Georgia 为 Windows/macOS 系统自带）；
// 全部缺席时回退系统 serif，不影响版式成立。
const SERIF_FONT = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif'
const NUM_FONT = 'Georgia, "Times New Roman", serif'

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
  // 公众号纸面加一层同调性的顶部渐晕（强调色衍生、极淡），纯平底色不再发闷
  const paper = dark ? '#221f1a' : '#f6f2ea'
  const baseBg =
    format === 'wechat'
      ? `radial-gradient(130% 100% at 50% 0%, ${hexToRgba(accent || (dark ? '#d9ab5f' : '#b0803c'), dark ? 0.08 : 0.06) ?? paper} 0%, rgba(0, 0, 0, 0) 55%), ${paper}`
      : dark
        ? 'linear-gradient(160deg, #2b2233 0%, #241f2b 52%, #1b2230 100%)'
        : 'linear-gradient(160deg, #ffe9ec 0%, #fff6e8 52%, #e8f3ff 100%)'
  // 背图按透出强度反向虚化：默认 15% 时虚成柔焦底，文字必清晰；拉满则原样透出
  const blur = Math.round((1 - seen / 100) * 60) / 10
  const bgStyle =
    blur > 0.2 ? ` style="filter: blur(${blur}px) saturate(0.94); transform: scale(1.06);"` : ''
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${CARD_W}px; height: ${CARD_H}px; overflow: hidden; }
  body {
    position: relative;
    font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
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
${bgSrc ? `<img class="bg" src="${esc(bgSrc)}"${bgStyle}>` : ''}
${bgSrc ? '<div class="veil"></div>' : ''}
<div class="stage">
${inner}
</div>
<script>
  // 溢出保护：文字装不下时逐档缩小内容块（zoom 连同间距等比缩），截图前同步完成；
  // 最终系数挂在 window.__cardZoom 上，主进程截图后回读并写回 cards.json（编辑区据此提示「已缩字」）
  (function () {
    var box = document.querySelector('.stage').firstElementChild
    if (!box) return
    var z = 1
    while (box.scrollHeight > box.clientHeight && z > 0.6) {
      z -= 0.05
      box.style.zoom = z
    }
    window.__cardZoom = z
  })()
</script>
</body>
</html>
`
}

/**
 * 公众号风：米白纸面 + 四角框线（书页角标）+ 页眉页脚细线，衬在纸面渐晕上；
 * 书面、克制、无 emoji 装饰。dark 时切浅色字配深底。
 * 版式骨架：外框 56px 留白 → 页眉（页码/眉标）→ 垂直居中的正文区 → 页脚饰线。
 */
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
    ? { tick: '#6f6552', eyebrow: '#c9b98f', title: '#f4efe4', sub: '#c9c0b0', accent: '#d9ab5f', line: '#5a5342', body: '#e0d9c9' }
    : { tick: '#c8bda6', eyebrow: '#a4936f', title: '#26221c', sub: '#6f6555', accent: '#b0803c', line: '#d9cfba', body: '#464035' }
  // 强调色覆盖着色点：角框线/页码/短划/菱形饰/要点序号（角框走半透明衍生压饱和度，保住书面气质）；正文色不动
  if (accent) {
    c.accent = accent
    c.tick = hexToRgba(accent, dark ? 0.6 : 0.5) ?? accent
  }
  // 四角 L 形框线：比整圈边框轻，报纸版式的「页角」意象
  const tick = (pos: string, edge: string): string =>
    `<i style="position: absolute; ${pos}; width: 64px; height: 64px; ${edge}: 3px solid ${c.tick};"></i>`
  const ticks = `${tick('left: 0; top: 0', 'border-left')} ${tick('right: 0; top: 0', 'border-right')} ${tick('left: 0; bottom: 0', 'border-left')} ${tick('right: 0; bottom: 0', 'border-right')}`
  const frame = `position: relative; margin: 56px; flex: 1; display: flex; flex-direction: column; padding: 96px 100px;`
  // 线—菱形—线分隔饰：比一根光秃秃的色条更有「印刷品」的完成度
  const diamondRule = (w: number, d: number): string =>
    `<div style="display: flex; align-items: center; gap: 20px;">
    <span style="width: ${w}px; height: 1px; background: ${c.line};"></span>
    <span style="width: ${d}px; height: ${d}px; background: ${c.accent}; transform: rotate(45deg);"></span>
    <span style="width: ${w}px; height: 1px; background: ${c.line};"></span>
  </div>`
  const num = (k: number): string =>
    numbered
      ? `<span style="color: ${c.accent}; font-weight: 700; margin-right: 20px; letter-spacing: 2px;">${String(k + 1).padStart(2, '0')}</span>`
      : ''
  if (cover) {
    // 封面：眉标（线—字—线，衬线字提升书面气）+ 大标题 + 菱形分隔 + 副题，整体居中
    return `<div style="${frame} align-items: center;">
  ${ticks}
  <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
    <div style="display: flex; align-items: center; gap: 32px; margin-bottom: 72px;">
      <span style="width: 72px; height: 1px; background: ${c.line};"></span>
      <span style="font-family: ${SERIF_FONT}; font-size: ${fz(30)}px; letter-spacing: 14px; margin-right: -14px; color: ${c.eyebrow};">${tag || '图 文 卡 片'}</span>
      <span style="width: 72px; height: 1px; background: ${c.line};"></span>
    </div>
    <h1 style="font-size: ${fz(96)}px; line-height: 1.32; font-weight: 700; letter-spacing: 2px; color: ${c.title};">${title}</h1>
    <div style="margin: 64px 0 56px;">${diamondRule(96, 12)}</div>
    ${lines.map((l) => `<p style="font-size: ${fz(38)}px; line-height: 1.9; color: ${c.sub};">${l}</p>`).join('\n  ')}
  </div>
</div>`
  }
  // 内容卡：页眉页码压顶（衬线数字更有刊物页码的完成度），正文区垂直居中，页脚饰线收底
  return `<div style="${frame}">
  ${ticks}
  <div style="display: flex; align-items: baseline; gap: 24px; margin-bottom: 48px;">
    <span style="font-family: ${NUM_FONT}; font-size: ${fz(34)}px; color: ${c.accent}; font-weight: 700; letter-spacing: 3px;">${pageNo}</span>
    <span style="flex: 1; height: 1px; background: ${c.line};"></span>
  </div>
  <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
    <h2 style="font-size: ${fz(60)}px; line-height: 1.4; font-weight: 700; color: ${c.title}; margin-bottom: 20px;">${title}</h2>
    <div style="width: 64px; height: 5px; background: ${c.accent}; margin-bottom: 56px;"></div>
    ${lines.map((l, k) => `<p style="font-size: ${fz(40)}px; line-height: 1.95; color: ${c.body}; margin-bottom: 20px;">${num(k)}${l}</p>`).join('\n  ')}
  </div>
  <div style="display: flex; justify-content: center;">${diamondRule(140, 8)}</div>
</div>`
}

/**
 * 小红书风：暖渐变底 + 圆角内卡，卡面四角加同调性的虚线圆/色点涂鸦，
 * 角标装进药丸章、要点序号装进圆角色块——网感、活泼但不闹。dark 时内卡变深、文字切浅色。
 */
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
  const card = `margin: 64px; background: ${c.cardBg}; border-radius: 48px; box-shadow: 0 32px 80px rgba(160,110,90,0.2); flex: 1; display: flex; flex-direction: column; padding: 96px 88px; position: relative; overflow: hidden;`
  // 角部涂鸦：虚线圆 + 实色点 + 出血色晕，都从色条色半透明衍生，与强调色联动
  const decor = `
  <span style="position: absolute; right: -70px; top: -70px; width: 220px; height: 220px; border: 3px dashed ${hexToRgba(c.bar, dark ? 0.45 : 0.35) ?? c.bar}; border-radius: 50%;"></span>
  <span style="position: absolute; right: 110px; top: 130px; width: 16px; height: 16px; border-radius: 50%; background: ${hexToRgba(c.bar, 0.5) ?? c.bar};"></span>
  <span style="position: absolute; left: -50px; bottom: -50px; width: 160px; height: 160px; border-radius: 50%; background: ${hexToRgba(c.bar, dark ? 0.2 : 0.12) ?? c.bar};"></span>`
  const num = (k: number): string =>
    numbered
      ? `<span style="display: inline-block; vertical-align: -6px; width: ${fz(52)}px; height: ${fz(52)}px; line-height: ${fz(52)}px; border-radius: 14px; background: ${hexToRgba(c.badge, dark ? 0.22 : 0.12) ?? 'transparent'}; color: ${c.badge}; font-weight: 800; font-size: ${fz(30)}px; text-align: center; margin-right: 24px;">${String(k + 1).padStart(2, '0')}</span>`
      : ''
  return cover
    ? `<div style="${card} justify-content: center; text-align: center;">
  ${decor}
  <div style="position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
    <div style="display: inline-flex; background: ${hexToRgba(c.badge, dark ? 0.16 : 0.1) ?? 'transparent'}; border-radius: 999px; padding: 18px 48px; margin-bottom: 64px;">
      <span style="font-size: ${fz(32)}px; color: ${c.badge}; font-weight: 700; letter-spacing: 6px; margin-right: -6px;">✦ ${tag || '干货分享'} ✦</span>
    </div>
    <h1 style="font-size: ${fz(92)}px; line-height: 1.3; font-weight: 800; color: ${c.title};">${title}</h1>
    <div style="width: 120px; height: 10px; border-radius: 5px; background: ${c.bar}; margin-top: 56px;"></div>
    <div style="margin-top: 56px;">
    ${lines.map((l) => `<p style="font-size: ${fz(40)}px; line-height: 1.8; color: ${c.sub};">${l}</p>`).join('\n  ')}
    </div>
  </div>
</div>`
    : `<div style="${card} justify-content: center;">
  ${decor}
  <div style="position: relative; flex: 1; display: flex; flex-direction: column; justify-content: center;">
    <h2 style="font-size:${fz(62)}px; line-height: 1.4; font-weight: 800; color: ${c.title}; margin-bottom: 24px;">
      <span style="background: linear-gradient(transparent 62%, ${c.mark} 62%);">${title}</span>
    </h2>
    <div style="width: 88px; height: 8px; border-radius: 4px; background: ${c.bar}; margin-bottom: 48px;"></div>
    ${lines.map((l, k) => `<p style="font-size:${fz(42)}px; line-height: 1.9; color: ${c.body}; margin-bottom: 24px;">${num(k)}${l}</p>`).join('\n  ')}
  </div>
</div>`
}

// ---------- 生图提示词组装（面向商汤 u1.5 系的中文结构化写法：约束前置、短句分号相连） ----------

/**
 * 平台 × 深浅的兜底调性词：**只在 bgPrompt 缺省时注入**。贴图生成契约（prompts.ts）要求
 * bgPrompt 自带「整组色调风格统一」的画面描述——bgPrompt 有值时再叠加这里的色相词会自相矛盾，
 * 还会把公众号浅色卡锁死在米白暖纸里，蓝绿青等色彩世界全出不来。
 */
const CARD_TONE: Record<CardFormat, { light: string; dark: string }> = {
  wechat: {
    light: '米白暖纸调、低饱和、柔和漫射光、安静克制的书面质感',
    dark: '深棕暗调、沉稳内敛、局部微光、夜读氛围'
  },
  xhs: {
    light: '柔粉奶油调、明快温暖、轻盈通透的生活感',
    dark: '深紫夜调、朦胧霓虹微光、安静的氛围感'
  }
}

/**
 * 卡背图生图提示词。原则：**色相交给 bgPrompt，功能约束由模板兜底**——
 * - 有 bgPrompt：只补与色相无关的品质词（构图留白/柔光/细腻）保文字可读性；
 *   深色卡加明度提示（亮图压深遮罩会发灰，功能性），浅色卡才压低对比（深色卡的夜色氛围需要光比）。
 * - 无 bgPrompt：退回平台兜底调性，保证永不出空 prompt。
 */
export function buildCardBgPrompt(card: Pick<CardItem, 'bgPrompt' | 'dark'>, format: CardFormat): string {
  const subject = card.bgPrompt.trim()
  const parts: string[] = ['竖版 3:4 氛围背景图']
  if (subject) {
    parts.push(
      `画面：${subject}`,
      '构图简洁、大块面，主体靠画面边缘，中部留出大面积柔和负空间供文字排布',
      '光线柔和、质感细腻',
      card.dark ? '整体明度压暗、夜色氛围' : '低饱和、整体低对比'
    )
  } else {
    parts.push(
      CARD_TONE[format][card.dark ? 'dark' : 'light'],
      '构图简洁，主体靠画面边缘，中部留出大面积柔和负空间供文字排布'
    )
  }
  parts.push('画面中不得出现任何文字、字母、数字、标志或水印')
  return parts.join('；')
}

/** AI 整卡成图提示词：文字直接画进图里，逐级交代版式、字号层级与禁乱码约束 */
export function buildAiCardPrompt(card: Pick<CardItem, 'title' | 'body' | 'bgPrompt'>, format: CardFormat): string {
  const points = card.body
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('；')
  const style = card.bgPrompt.trim() || CARD_TONE[format].light
  return [
    `设计一张竖版 3:4 中文图文卡片成品，把以下文字直接排版进画面`,
    `标题「${card.title}」用大号醒目字体${points ? `；要点「${points}」逐行排版，字号明显小于标题` : ''}`,
    `视觉风格：${style}`,
    `版式层级分明、留白充足、文字与背景融合自然`,
    `汉字必须清晰可读、无错字、无乱码；除上述文案外画面中不出现任何其它文字、标志或水印`
  ].join('；')
}
