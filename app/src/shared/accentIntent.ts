/**
 * 纯换强调色意图识别（客户端直连，跳过 LLM）
 * - 命中条件（保守，宁可回落 LLM 也不误判内容需求）：
 *   短消息（≤24 字）+ 换色动词 + 明确目标色（hex 或中文色名）或恢复默认意图
 *   且不含「非强调色对象」（封面/图片…）与「内容改造动词」（润色/重写/扩写…）
 * - 命中 → 直接写 meta 换色，省掉整轮 LLM 往返（含上下文注入的长正文），即时生效
 * - 未命中 → 返回 null，回落原有 LLM + cards-accent 指令流程
 */

/** 常用中文色名 → hex（取相对克制、适合排版的色值） */
const COLOR_NAMES: Record<string, string> = {
  金色: '#c9a227',
  金黄: '#c9a227',
  金: '#c9a227',
  红色: '#e63946',
  大红: '#e63946',
  红: '#e63946',
  橙色: '#ff6b35',
  橘色: '#ff6b35',
  橙: '#ff6b35',
  橘: '#ff6b35',
  黄色: '#e6b800',
  黄: '#e6b800',
  墨绿: '#1f6f54',
  绿色: '#16a085',
  绿: '#16a085',
  天蓝: '#4f8cff',
  蓝色: '#4f8cff',
  蓝: '#4f8cff',
  紫色: '#7c5cff',
  紫: '#7c5cff',
  粉红: '#e86fa4',
  粉色: '#e86fa4',
  粉: '#e86fa4',
  青色: '#1fa8a0',
  青: '#1fa8a0',
  咖啡色: '#8a5a34',
  咖啡: '#8a5a34',
  棕色: '#a97142',
  棕: '#a97142',
  灰色: '#5b6470',
  灰: '#5b6470',
  黑色: '#2b2b2b',
  黑: '#2b2b2b'
}

const CHANGE_VERB = /改|换|设为|设置|调成|调为|变成|变为|改成|换成|改为|用/
const RESTORE = /默认|恢复|还原|去掉|取消|重置/
/** 出现说明换的不是强调色（封面/图片等），回落 LLM */
const NON_ACCENT_TARGET = /封面|图片|图像|头像|背景图|logo|图标|配图/
/** 出现说明夹带内容改造需求，回落 LLM 一并处理 */
const CONTENT_EDIT = /改写|重写|润色|优化|扩写|缩写|翻译|删除|删掉|加一段|增加|减少|补充|梳理|续写|改结构|调整结构/

export interface AccentIntent {
  /** 目标 hex 色值；null = 恢复默认 */
  color: string | null
}

/** 识别纯换色指令；拿不准返回 null（回落 LLM） */
export function parseAccentIntent(rawText: string): AccentIntent | null {
  const text = rawText.trim()
  if (!text || text.length > 24) return null
  if (!CHANGE_VERB.test(text) && !RESTORE.test(text)) return null
  if (NON_ACCENT_TARGET.test(text)) return null
  if (CONTENT_EDIT.test(text)) return null

  if (RESTORE.test(text)) return { color: null }

  const hex = text.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/)
  if (hex) return { color: hex[0].toLowerCase() }

  // 中文色名：长词优先，避免「金色」被拆成「金」
  for (const name of Object.keys(COLOR_NAMES).sort((a, b) => b.length - a.length)) {
    if (text.includes(name)) return { color: COLOR_NAMES[name] }
  }
  return null
}
