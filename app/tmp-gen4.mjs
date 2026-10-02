import { readFileSync, writeFileSync } from 'fs'

const L = '<'
const G = '>'
const SL = '</'
const p1 = L + 'tool_call>'
const p1c = SL + 'tool_call>'
const p2 = L + 'function'
const p2c = SL + 'function>'
const p3 = L + 'parameter'
const p3c = SL + 'parameter>'

// 目标：替换 llmText.ts 里 parseXmlToolCalls 整块（从它的 doc 注释到下一个 doc 注释之前）
const code = `/** 解析 XML 标签风格工具调用（Qwen/GLM 系模型在无原生 tools 环境下的自发协议）：
 *  两种写法都认——${p2} 标签包裹，以及「标签名即工具名」（含 mcp__server__ 前缀，取末段）；
 *  参数来自 ${p3}=k… 子标签、标签属性（k="v"）或整段 JSON；
 *  值尝试 JSON.parse（对象/数组形状一律转类型），其余长文本与多行值保留字符串（防正文被类型化破坏）；
 *  零参数工具（list_projects 等）空标签也算一次调用——旧代码要求「至少一个参数」，把它们全丢了 */
export function parseXmlToolCalls(text: string): { calls: { name: string; arguments: string }[]; cleaned: string } {
  const calls: { name: string; arguments: string }[] = []
  const block = /${p1}([\\s\\S]*?)${p1c.replace('/', '\\/')}/g
  const attr = (s: string): string => {
    const m = /^(?:name\\s*=\\s*)?["']?\\s*([^"']*?)\\s*["']?$/.exec(s.trim())
    return (m ? m[1] : s.trim()).trim()
  }
  /** function 标签的名字写法：=${G} 前缀与 name="x" 两种都归一到裸名 */
  const tagName = (s: string): string => attr(s.replace(/^[=\\s]+/, '').replace(/\\s*$|\\s*\\/?>$/g, ''))
  /** mcp__workspace__list_projects → list_projects（模型以为自己在调 MCP 工具） */
  const norm = (n: string): string => {
    const cut = n.lastIndexOf('__')
    return n.startsWith('mcp__') && cut > 4 ? n.slice(cut + 2) : n
  }
  const parseParams = (body: string, attrs: string): Record<string, unknown> => {
    const args: Record<string, unknown> = {}
    const pre = /${p3}[\\s=]([^>]+)>(([\\s\\S]*?))${p3c.replace('/', '\\/')}/g
    let p: RegExpExecArray | null
    while ((p = pre.exec(body))) {
      const key = attr(p[1])
      const raw = p[2].trim()
      if (!key) continue
      // 结构化值（对象/数组）无视长度与换行照常解析：patches/ideas/titles 都是数组，
      // 按长文本处理会退化成字符串，工具侧 Array.isArray 判定直接失败
      const shaped = (raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))
      if (shaped || (!raw.includes('\\n') && raw.length <= 60)) {
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
    const at = /([\\w-]+)\\s*=\\s*"([^"]*)"/g
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
  const fnRe = /${p2}([\\s=][^>]*)>(([\\s\\S]*?))${p2c.replace('/', '\\/')}/g
  const tagRe = /${L}([A-Za-z][\\w.-]*)((?:\\s+[\\w-]+\\s*=\\s*"[^"]*")*)\\s*\\/?>([\\s\\S]*?)(?:${SL}\\1>|$)/g
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

`

const p = 'src/shared/llmText.ts'
const src = readFileSync(p, 'utf8')
const start = src.indexOf('/** 解析 XML 标签风格工具调用')
const end = src.indexOf('/** 文本协议统一入口')
if (start < 0 || end < 0 || end <= start) throw new Error('没定位到 parseXmlToolCalls 区块')
writeFileSync(p, src.slice(0, start) + code + src.slice(end))
console.log('替换字节:', end - start, '→', code.length)
