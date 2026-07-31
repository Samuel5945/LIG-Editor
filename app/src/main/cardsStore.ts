import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { CARD_H, CARD_W, cardHtml, type CardDeck, type CardFormat } from '@shared/cards'
import { projectDir, saveAsset, writeTracked } from './projectStore'
import { renderHtmlFixed } from './figureRender'

/**
 * 贴图卡片存储与渲染（cards.json + cards/格式/card-N.html|png）
 * - readCards/writeCards：卡片组落盘（own-write 标记避免 watcher 回环）
 * - 存档 cards-格式.json：转风格前备份原版，支持零成本互切
 * - renderCard：模板注入 → cards/格式/card-N.html → 固定 1242×1656 离屏截图 → 同目录 PNG
 */

function cardsPath(project: string): string {
  return join(projectDir(project), 'cards.json')
}

/** 非当前格式的存档文件：转风格/互切时读写 */
function archivePath(project: string, format: CardFormat): string {
  return join(projectDir(project), `cards-${format}.json`)
}

/** 磁盘 JSON → 规范化 CardDeck（字段白名单重建，新增字段必须在这里透传） */
function normalizeDeck(raw: Partial<CardDeck>): CardDeck | null {
  if (!Array.isArray(raw.cards)) return null
  return {
    format: raw.format === 'xhs' ? 'xhs' : 'wechat',
    accent: typeof raw.accent === 'string' && raw.accent ? raw.accent : undefined,
    caption: typeof raw.caption === 'string' && raw.caption ? raw.caption : undefined,
    cards: raw.cards.map((c) => ({
      tag: c?.tag ?? '',
      title: c?.title ?? '',
      body: c?.body ?? '',
      bgPrompt: c?.bgPrompt ?? '',
      bgImage: c?.bgImage ?? '',
      bgOpacity: typeof c?.bgOpacity === 'number' ? c.bgOpacity : undefined,
      dark: c?.dark === true ? true : undefined,
      fontScale: typeof c?.fontScale === 'number' ? c.fontScale : undefined,
      numbered: c?.numbered === true ? true : undefined,
      mode: c?.mode === 'ai' ? ('ai' as const) : undefined,
      aiImage: c?.aiImage ?? '',
      png: c?.png ?? ''
    }))
  }
}

export function readCards(project: string): CardDeck | null {
  const file = cardsPath(project)
  if (!existsSync(file)) return null
  return normalizeDeck(JSON.parse(readFileSync(file, 'utf-8')) as Partial<CardDeck>)
}

export function writeCards(project: string, deck: CardDeck): void {
  writeTracked(cardsPath(project), JSON.stringify(deck, null, 2) + '\n')
}

/** 读某格式的存档版；没存过返回 null */
export function readArchivedCards(project: string, format: CardFormat): CardDeck | null {
  const file = archivePath(project, format)
  if (!existsSync(file)) return null
  return normalizeDeck(JSON.parse(readFileSync(file, 'utf-8')) as Partial<CardDeck>)
}

/** 把一份 deck 存档到 cards-格式.json（转风格/互切前保留原版） */
export function writeArchivedCards(project: string, deck: CardDeck): void {
  writeTracked(archivePath(project, deck.format), JSON.stringify(deck, null, 2) + '\n')
}

/** 渲染第 index 张卡片，更新 cards.json 里的 png 字段并返回相对路径 */
export async function renderCard(project: string, index: number): Promise<string> {
  const deck = readCards(project)
  if (!deck || !deck.cards[index]) throw new Error(`卡片不存在：#${index + 1}`)
  const card = deck.cards[index]
  let base64: string
  if (card.mode === 'ai' && card.aiImage) {
    // AI 整卡成图：不走排版模板，直接把成图拷贝为产物
    base64 = readFileSync(join(projectDir(project), card.aiImage)).toString('base64')
  } else {
    const html = cardHtml(card, {
      format: deck.format,
      index,
      total: deck.cards.length,
      accent: deck.accent,
      // 背图相对 cards/格式/ 目录引用工程内 assets/
      bgSrc: card.bgImage ? `../../${card.bgImage}` : ''
    })
    // 两种格式各自一套产物目录，互切时不会覆盖对方的 PNG
    const dir = join(projectDir(project), 'cards', deck.format)
    const htmlAbs = join(dir, `card-${index + 1}.html`)
    // writeTracked 不建目录，首次渲染前目录还不存在
    mkdirSync(dir, { recursive: true })
    writeTracked(htmlAbs, html)
    base64 = await renderHtmlFixed(htmlAbs, CARD_W, CARD_H)
  }
  const pngRel = saveAsset(project, `cards/${deck.format}/card-${index + 1}.png`, base64)
  // 渲染期间文案可能又改了，回写前重读最新 deck
  const latest = readCards(project)
  if (latest?.cards[index]) {
    latest.cards[index].png = pngRel
    writeCards(project, latest)
  }
  return pngRel
}
