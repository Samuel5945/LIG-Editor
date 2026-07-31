/**
 * 对话修改正文指令（与 skill-install / cards-accent 同构：围栏指令块 → 确认卡片）
 * 模型输出 ```article-update 修改后的完整正文``` ，渲染层剥离后弹「应用到正文」确认卡
 */

const UPDATE_DIRECTIVE_RE = /```article-update\s*\n([\s\S]*?)\n?```/
/** 流式中途只出现开栏、还没等到闭栏：气泡先收起长文显示占位 */
const UPDATE_OPEN_RE = /```article-update\s*\n[\s\S]*$/

export interface ParsedArticleUpdate {
  /** 剥离指令块后的可见文本 */
  cleaned: string
  /** 修改后的完整正文 md；undefined = 无指令/内容为空（静默容错） */
  update?: string
  /** 流式中：指令块尚未闭合，界面显示生成中占位 */
  pending?: boolean
}

/** 解析模型回复里的 ```article-update 完整正文``` 指令块 */
export function parseArticleUpdate(text: string): ParsedArticleUpdate {
  const m = text.match(UPDATE_DIRECTIVE_RE)
  if (m) {
    const cleaned = text.replace(UPDATE_DIRECTIVE_RE, '').trimEnd()
    const update = m[1].trim()
    return update ? { cleaned, update } : { cleaned }
  }
  if (UPDATE_OPEN_RE.test(text)) {
    return { cleaned: text.replace(UPDATE_OPEN_RE, '').trimEnd(), pending: true }
  }
  return { cleaned: text }
}
