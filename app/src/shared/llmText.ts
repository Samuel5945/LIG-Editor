/** LLM 输出文本解析工具（渲染层与主进程能力核共用） */
import type { ChatToolSchema } from './types'

/** 累积流式 tool_calls 碎片：按 index 合并，id/name 取值覆盖、arguments 字符串拼接。
 *  纯函数（主进程流解析与单测共用）；acc 由调用方持有、跨 chunk 复用 */
export function accumulateToolCalls(
  acc: { id: string; name: string; arguments: string }[],
  deltas: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
): void {
  for (const d of deltas) {
    const i = d.index ?? 0
    if (!acc[i]) acc[i] = { id: '', name: '', arguments: '' }
    if (d.id) acc[i].id = d.id
    if (d.function?.name) acc[i].name = d.function.name
    if (d.function?.arguments) acc[i].arguments += d.function.arguments
  }
}

/** 从模型输出提取 JSON 数组：优先 ```json 围栏，退化找首个平衡的 [...] */
export function extractJsonArray<T>(text: string): T[] | null {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/)
  const candidates: string[] = []
  if (fenced) candidates.push(fenced[1])
  const start = text.indexOf('[')
  if (start >= 0) {
    let depth = 0
    for (let i = start; i < text.length; i++) {
      if (text[i] === '[') depth++
      else if (text[i] === ']') {
        depth--
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1))
          break
        }
      }
    }
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as T[]
    } catch {
      // 尝试下一个候选
    }
  }
  return null
}

/** 工具清单 → OpenAI function 格式 schema；排除提示词返回类（内部对话有自己的界面流） */
export function buildToolSchemas(
  tools: { name: string; description: string; parameters: unknown }[]
): ChatToolSchema[] {
  return tools
    .filter((t) => !t.name.endsWith('_prompt'))
    .map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }))
}

/** 解析 assistant 文本里的 ```tool-call 围栏（不支持原生 function calling 的模型的工具调用协议）。
 *  返回围栏里的调用列表（arguments 统一为 JSON 字符串）与剥离围栏后的正文；无有效围栏返回空 */
export function parseToolCallFence(text: string): { calls: { name: string; arguments: string }[]; cleaned: string } {
  const calls: { name: string; arguments: string }[] = []
  const re = /```tool-call\s*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    try {
      const o = JSON.parse(m[1].trim()) as { name?: string; arguments?: unknown }
      if (typeof o.name === 'string' && o.name) {
        const args = typeof o.arguments === 'string' ? o.arguments : JSON.stringify(o.arguments ?? {})
        calls.push({ name: o.name, arguments: args })
      }
    } catch {
      // 非法 JSON 围栏不当调用处理
    }
  }
  return { calls, cleaned: calls.length ? text.replace(re, '').trim() : text }
}

/** 解析 XML 标签风格工具调用（Qwen/GLM 系模型在无原生 tools 环境下的自发协议）：
 *  <tool_call><function=名><parameter=键>值（可多行）</parameter>…</function></tool_call>
 *  值尝试 JSON.parse（数字/布尔/对象），失败保留字符串；正文多行内容由字符串承载 */
export function parseXmlToolCalls(text: string): { calls: { name: string; arguments: string }[]; cleaned: string } {
  const calls: { name: string; arguments: string }[] = []
  const re = /<tool_call>\s*<function=([^>\n]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const name = m[1].trim()
    const args: Record<string, unknown> = {}
    const pre = /<parameter=([^>\n]+)>([\s\S]*?)<\/parameter>/g
    let p: RegExpExecArray | null
    while ((p = pre.exec(m[2]))) {
      const key = p[1].trim()
      const raw = p[2].trim()
      try {
        args[key] = JSON.parse(raw)
      } catch {
        args[key] = raw
      }
    }
    if (name && Object.keys(args).length > 0) calls.push({ name, arguments: JSON.stringify(args) })
  }
  return { calls, cleaned: calls.length ? text.replace(re, '').trim() : text }
}

/** 文本协议统一入口：XML 标签 + ```tool-call 围栏两种降级格式一起解析，cleaned 已剥离全部调用块 */
export function parseTextToolCalls(text: string): { calls: { name: string; arguments: string }[]; cleaned: string } {
  const xml = parseXmlToolCalls(text)
  const fence = parseToolCallFence(xml.cleaned)
  return { calls: [...xml.calls, ...fence.calls], cleaned: fence.cleaned }
}
