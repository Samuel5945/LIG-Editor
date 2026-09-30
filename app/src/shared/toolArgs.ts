/**
 * 文本协议入参归一（三种降级写法共用）：
 * 1) JSON 值里的 key 常写成蛇形（line_height / body_font_size），而能力核按 inputSchema 的驼峰名取值——
 *    不归一的表现是工具返回成功、meta 却没写，作者看到「参数设了没生效」，比报错更难查。
 *    只有「驼峰键不存在且蛇形对应驼峰是合法键」才改名，模型多写的未知键仍旧原样留着被工具剔掉。
 * 2) 数组/对象写成 JSON 字符串（见 fixValue）：文本协议没有类型，模型爱加引号。
 * 3) 整个调用再包一层壳（工具名解析成 tool_call / invoke，真名在参数里）——见 expandWrapperCalls。
 */

/** 蛇形 → 驼峰（已是驼峰则原样） */
export function camelKey(k: string): string {
  return k.replace(/[-_]([a-zA-Z0-9])/g, (_m, c: string) => c.toUpperCase())
}

/** 值形态归一：数组/对象写成 JSON 字符串时还原 */
function fixValue(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (s.length > 1 && ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}')))) {
    try {
      return JSON.parse(s)
    } catch {
      return v
    }
  }
  return v
}

function propsOf(schema: unknown): Record<string, unknown> | undefined {
  const s = schema as { properties?: Record<string, unknown> } | undefined
  return s && typeof s === 'object' ? s.properties : undefined
}

/**
 * 递归归一：某层声明了 properties 就按它判合法键，没声明就沿用外层的键集
 * （theme 这类只写了 type:object 的字段拿不到内部 schema，靠排版侧的别名表兜）。
 */
function walk(node: unknown, schema: unknown, inherited: Set<string>): unknown {
  if (Array.isArray(node)) {
    const items = (schema as { items?: unknown } | undefined)?.items
    return node.map((x) => walk(x, items, inherited))
  }
  if (!node || typeof node !== 'object') return node
  const childProps = propsOf(schema)
  const legal = childProps ? new Set(Object.keys(childProps)) : inherited
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const key = legal.has(k) || !legal.has(camelKey(k)) ? k : camelKey(k)
    out[key] = walk(fixValue(v), childProps?.[key], legal)
  }
  return out
}

/**
 * 按工具 inputSchema 归一入参：非法 JSON 字符串还原成数组/对象、蛇形键改成合法驼峰键。
 * 解析失败原样返回（交给工具报「参数不是合法 JSON」，不吞错）。
 */
export function normalizeToolArgs(argsJson: string, schema?: unknown): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsJson || '{}')
  } catch {
    return argsJson
  }
  return JSON.stringify(walk(parsed, schema, new Set(Object.keys(propsOf(schema) ?? {}))))
}

/** 外层壳工具名：模型把「一次调用」又包了一层时，解析器只能取到壳名 */
const WRAPPER_NAMES = /^(tool_call|tool-call|invoke|call|function_call|function)$/i

/**
 * 展开被再包一层的调用：解析器取到的名字是 tool_call / invoke，真名与参数在其 JSON 体里。
 * 不展开的表现是「未知工具：tool_call」——实测命中过（模型把 `{"name":...,"arguments":{...}}`
 * 整体塞进标签，名字归到了壳上，参数反而完整）。认不出真名时原样返回，交给工具自己报错。
 */
export function expandWrapperCalls<T extends { name: string; arguments: string }>(calls: T[]): T[] {
  const out: T[] = []
  for (const c of calls) {
    if (!WRAPPER_NAMES.test(c.name.trim())) {
      out.push(c)
      continue
    }
    let body: Record<string, unknown>
    try {
      body = JSON.parse(c.arguments || '{}') as Record<string, unknown>
    } catch {
      out.push(c)
      continue
    }
    const real = typeof body.name === 'string' ? body.name.trim() : ''
    if (!real || WRAPPER_NAMES.test(real)) {
      out.push(c)
      continue
    }
    const inner = body.arguments ?? body.args ?? body.params
    out.push({ ...c, name: real, arguments: typeof inner === 'string' ? inner : JSON.stringify(inner ?? {}) })
  }
  return out
}
