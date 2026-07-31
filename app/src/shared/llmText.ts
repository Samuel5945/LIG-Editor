/** LLM 输出文本解析工具（渲染层与主进程能力核共用） */

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
