/**
 * 排版优化对话框的输出协议（§6：文本层 + 视觉层打包一次出）
 *
 * 模型输出 = 排版后的全文 markdown，末尾**可选**追加一个 <theme> 围栏，里面是视觉参数 JSON
 * （字段取 meta 覆盖白名单子集）。围栏剥离后交给确认卡片：正文走原 diff 流程，
 * 视觉参数走 handleApplyTypography 落 meta——两半同源，作者点一次「应用」就打包生效。
 *
 * 向后兼容是硬要求：没有围栏 / 围栏里是坏 JSON / 不是对象 → themePatch 缺省，
 * 调用方行为与协议升级前完全一致（正文照旧，什么都不多做）。
 */
import { sanitizeThemePatch, THEME_FIELD_LABELS, type ThemeOverrideKey } from './categoryThemes'
import type { ProjectMeta } from './types'

/** 字段中文名表住在 categoryThemes（数值夹取区间与它同处一套口径），这里转发给对话框用 */
export { THEME_FIELD_LABELS }
export type { ThemeOverrideKey }

export interface ParsedLayoutOutput {
  /** 剥掉视觉参数围栏后的排版全文 */
  article: string
  /** 视觉参数覆盖；undefined = 模型没给视觉层意见（或给了但非法，按没给处理） */
  themePatch?: Partial<ProjectMeta>
}

/** 视觉参数围栏：容忍围栏代码块包裹（```json ... ```）与前后空行；剥离时清掉所有出现（模型可能重复给） */
const THEME_BLOCK_RE = /<theme>([\s\S]*?)<\/theme>/i
const THEME_BLOCK_ALL_RE = /<theme>[\s\S]*?<\/theme>/gi

/** 剥掉可能的 ``` 包裹，取出裸 JSON 文本 */
function unwrapFence(inner: string): string {
  return inner
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim()
}

/** 解析排版优化输出：全文 + 可选 <theme> 视觉参数 */
export function parseLayoutOutput(text: string): ParsedLayoutOutput {
  const raw = text ?? ''
  const m = THEME_BLOCK_RE.exec(raw)
  if (!m) return { article: raw.trim() }
  // 围栏是随全文一起吐出的指令块，无论解析成不成都不该留在正文里（否则坏 JSON 被当正文应用）；
  // 模型偶尔会分多处输出，这里把所有围栏一并剥掉，视觉参数取第一处
  const cleaned = raw.replace(THEME_BLOCK_ALL_RE, '').trim()
  let candidate: unknown
  try {
    candidate = JSON.parse(unwrapFence(m[1]))
  } catch {
    return { article: cleaned }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { article: cleaned }
  const patch = sanitizeThemePatch(candidate as Record<string, unknown>)
  if (!Object.keys(patch).length) return { article: cleaned }
  return { article: cleaned, themePatch: patch }
}

/** 把覆盖补丁转成「中文名 = 值」列表（未知键原样露出，便于发现协议漂移） */
export function describeThemePatch(patch: Partial<ProjectMeta>): { label: string; value: string }[] {
  return Object.entries(patch).map(([k, v]) => ({
    label: THEME_FIELD_LABELS[k as ThemeOverrideKey] ?? k,
    value: v === null ? '恢复默认' : String(v)
  }))
}
