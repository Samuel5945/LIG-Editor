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
 *  两种写法都认——<function 标签包裹，以及「标签名即工具名」（含 mcp__server__ 前缀，取末段）；
 *  参数来自 <parameter=k… 子标签、标签属性（k="v"）或整段 JSON；
 *  值尝试 JSON.parse（对象/数组形状一律转类型），其余长文本与多行值保留字符串（防正文被类型化破坏）；
 *  零参数工具（list_projects 等）空标签也算一次调用——旧代码要求「至少一个参数」，把它们全丢了 */
export function parseXmlToolCalls(text: string): { calls: { name: string; arguments: string }[]; cleaned: string } {
  const calls: { name: string; arguments: string }[] = []
  const block = /<tool_call>([\s\S]*?)<\/tool_call>/g
  const attr = (s: string): string => {
    const m = /^(?:name\s*=\s*)?["']?\s*([^"']*?)\s*["']?$/.exec(s.trim())
    return (m ? m[1] : s.trim()).trim()
  }
  /** function 标签的名字写法：=> 前缀与 name="x" 两种都归一到裸名 */
  const tagName = (s: string): string => attr(s.replace(/^[=\s]+/, '').replace(/\s*$|\s*\/?>$/g, ''))
  /** mcp__workspace__list_projects → list_projects（模型以为自己在调 MCP 工具） */
  const norm = (n: string): string => {
    const cut = n.lastIndexOf('__')
    return n.startsWith('mcp__') && cut > 4 ? n.slice(cut + 2) : n
  }
  const parseParams = (body: string, attrs: string): Record<string, unknown> => {
    const args: Record<string, unknown> = {}
    const pre = /<parameter[\s=]([^>]+)>(([\s\S]*?))<\/parameter>/g
    let p: RegExpExecArray | null
    while ((p = pre.exec(body))) {
      const key = attr(p[1])
      const raw = p[2].trim()
      if (!key) continue
      // 结构化值（对象/数组）无视长度与换行照常解析：patches/ideas/titles 都是数组，
      // 按长文本处理会退化成字符串，工具侧 Array.isArray 判定直接失败
      const shaped = (raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))
      if (shaped || (!raw.includes('\n') && raw.length <= 60)) {
        try {
          args[key] = JSON.parse(raw)
        } catch {
          args[key] = raw
        }
      } else {
        args[key] = raw
      }
    }
    // 属性写法：<get_project project="x" />
    const at = /([\w-]+)\s*=\s*"([^"]*)"/g
    let a: RegExpExecArray | null
    while ((a = at.exec(attrs))) if (!(a[1] in args)) args[a[1]] = a[2]
    // 没有子标签也没有属性，但整段是 JSON 对象 → 当参数用
    if (!Object.keys(args).length && body.trim().startsWith('{')) {
      try {
        Object.assign(args, JSON.parse(body.trim()) as Record<string, unknown>)
      } catch {
        /* 非法 JSON 不当参数 */
      }
    }
    return args
  }
  const fnRe = /<function([\s=][^>]*)>(([\s\S]*?))<\/function>/g
  const tagRe = /<([A-Za-z][\w.-]*)((?:\s+[\w-]+\s*=\s*"[^"]*")*)\s*\/?>([\s\S]*?)(?:<\/\1>|$)/g
  let m: RegExpExecArray | null
  while ((m = block.exec(text))) {
    const body = m[1]
    let wrapped = false
    let f: RegExpExecArray | null
    fnRe.lastIndex = 0
    while ((f = fnRe.exec(body))) {
      const name = norm(tagName(f[1] ?? ''))
      if (!name) continue
      calls.push({ name, arguments: JSON.stringify(parseParams(f[2], '')) })
      wrapped = true
    }
    if (wrapped) continue
    let t: RegExpExecArray | null
    tagRe.lastIndex = 0
    while ((t = tagRe.exec(body))) {
      const name = norm(t[1])
      if (!name || name === 'parameter') continue
      calls.push({ name, arguments: JSON.stringify(parseParams(t[3], t[2] ?? '')) })
    }
  }
  return { calls, cleaned: calls.length ? text.replace(block, '').trim() : text }
}

/** 文本协议统一入口：XML 标签 + ```tool-call 围栏两种降级格式一起解析，cleaned 已剥离全部调用块 */
export function parseTextToolCalls(text: string): { calls: { name: string; arguments: string }[]; cleaned: string } {
  const xml = parseXmlToolCalls(text)
  const fence = parseToolCallFence(xml.cleaned)
  return { calls: [...xml.calls, ...fence.calls], cleaned: fence.cleaned }
}

/** 工具名单写进系统提示：走文本协议的模型收不到原生 tools schema，这是它获知「有哪些工具」的唯一途径。
 *  曾因此出过一次事故：模型看不见 export_docx，用户说「导出 word」它就把全文贴回对话 */
export function toolsInventory(tools: ChatToolSchema[]): string {
  if (!tools.length) return ''
  const brief = tools.map((t) => {
    const d = t.function.description.split(/[：:（(。；;]/)[0].trim()
    return `${t.function.name} ${d.slice(0, 24)}`
  })
  return `可用工具（名字 → 用途）：${brief.join(' / ')}。
凡是这些工具能做的事（改正文、写正文、排版、配图生图、设封面、导出、推送）都必须发起工具调用来完成，不能凭上下文里的正文自己复述——用户要 Word/HTML 时调 export_docx/export_html 并把返回的文件路径原样告知，绝不要把正文贴回对话代替文件。
清单里存在的能力就是编辑器已经提供的能力，绝不能回答「编辑器不支持」「只能手动复制到 Word」；不确定参数就按上面的名字直接发起调用，由工具返回的错误信息来纠正。`
}

/** 清单注入决策：只有「这个模型真的返回过原生 tool_calls」才敢省掉清单——
 *  不能拿「请求没报错」当判据：聚合供应商（基元律动/Agnes 这类）照单收下 tools 参数却从不回 tool_calls，
 *  此时不注入就等于模型完全不知道自己有什么工具，实测表现为回答「立格编辑器不支持导出 Word」并臆造 mcp__xxx 工具名 */
export function inventoryFor(
  registry: ChatToolSchema[],
  nativeTools: ChatToolSchema[],
  nativeProven: boolean
): string {
  return nativeTools.length && nativeProven ? '' : toolsInventory(registry)
}

/** 数组型入参归一（工具侧用）：模型经常把数组写成 JSON 字符串（文本协议必然如此，原生调用也常见），
 *  或只给一个对象当单项。能救的一律救成数组；救不动时把期望形状写进报错，让模型一次改对而不是反复瞎试 */
export function coerceArrayArg(value: unknown, key: string, example: string): unknown[] {
  let v = value
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) throw new Error(`${key} 不能为空，需传 JSON 数组：${example}`)
    try {
      v = JSON.parse(s)
    } catch {
      throw new Error(`${key} 不是合法 JSON 数组，请按 ${example} 重传`)
    }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) v = [v]
  if (!Array.isArray(v) || !v.length) throw new Error(`${key} 不能为空，需传 JSON 数组：${example}`)
  return v as unknown[]
}
