// 远程 MCP 网关冒烟：用 SDK 的真 Client 走一遍 tools/list + tools/call，验只读闭环
//
// 为什么不用裸 fetch（app/scripts/test-mcp.mjs 那种零依赖写法在这里不适用）：
// 本设计的全部赌注在于「capabilityCore 的手写 JSON Schema 能被 SDK 的 ToolSchema 接受」，
// 而只有 Client 会拿 ListToolsResultSchema / CallToolResultSchema 复验网关的响应。
// 裸 fetch 会乐呵呵地打印一个真实客户端会拒绝的载荷，什么都证明不了。
//
// 前置：网关与编辑器都在跑（编辑器需 LIG_REMOTE_MCP=1），否则 preflight 直接失败并给出提示。
// 运行：NO_PROXY=127.0.0.1,localhost LIG_REMOTE_CLIENT_TOKEN=<token> npm run smoke
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'

const TOKEN = process.env.LIG_REMOTE_CLIENT_TOKEN ?? ''
const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`
const READ_ONLY = ['get_project', 'list_projects', 'read_article'] // 排序后与 /health 的 tools 对齐

let failures = 0
function check(label, cond, detail = '') {
  const tail = detail ? ` — ${detail}` : ''
  if (cond) {
    console.log(`ok   ${label}${tail}`)
  } else {
    failures += 1
    console.log(`FAIL ${label}${tail}`)
  }
  return cond
}

/** 工具结果统一是 {content:[{type:'text',text}], isError}；text 是字符串或 JSON 序列化后的对象 */
function textOf(res) {
  const first = res.content?.[0]
  return first?.type === 'text' ? first.text : null
}

async function preflight() {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error(`/health 返回 ${res.status}`)
  const health = await res.json()
  check('网关存活且有设备在线', health.devices >= 1, `devices=${health.devices} ids=${health.deviceIds.join(',')}`)
  if (health.devices < 1) {
    console.log('\n编辑器没连上网关。确认两边都在跑：')
    console.log('  网关：  LIG_REMOTE_CLIENT_TOKEN=... LIG_REMOTE_DEVICE_TOKEN=... npm run dev')
    console.log('  编辑器：LIG_REMOTE_MCP=1 LIG_REMOTE_DEVICE_TOKEN=... npm run dev   （在 app/ 下）')
    return null
  }
  // 核心不变量：设备推全量工具表，网关只放行白名单三个
  check(
    '设备推来全量工具表，网关只放行只读三件套',
    health.deviceTools > READ_ONLY.length && JSON.stringify(health.tools) === JSON.stringify(READ_ONLY),
    `设备推 ${health.deviceTools} 个，放行 ${health.tools.length} 个：${health.tools.join(',')}`
  )
  return health
}

async function main() {
  if (!TOKEN) {
    console.log('FAIL 缺少 LIG_REMOTE_CLIENT_TOKEN')
    process.exitCode = 1
    console.log('REMOTE-MCP-SMOKE-FAIL')
    return
  }

  if (!(await preflight())) {
    process.exitCode = 1
    console.log('REMOTE-MCP-SMOKE-FAIL')
    return
  }

  const client = new Client({ name: 'lig-remote-mcp-smoke', version: '0.1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }
  })

  try {
    // connect() 会跑 initialize。能走到这一步就说明无状态 + enableJsonResponse 的传输层是通的
    await client.connect(transport)
    check('initialize 握手成功', client.getServerVersion()?.name === 'lig-remote-mcp', JSON.stringify(client.getServerVersion()))

    // ---- 1. 工具清单：恰为只读三件套，且 schema 是设备原样推来的 ----
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    check('tools/list 恰为只读三件套', JSON.stringify(names) === JSON.stringify(READ_ONLY), names.join(','))

    // enum 是 capabilityCore 手写的，网关若重写过 schema 这里就会对不上
    const readArticle = tools.find((t) => t.name === 'read_article')
    const fileEnum = readArticle?.inputSchema?.properties?.file?.enum
    check(
      'read_article 的 file.enum 原样透传（证明网关没重写 schema）',
      JSON.stringify(fileEnum) === JSON.stringify(['article.md', 'ideas.md', 'review.md']),
      JSON.stringify(fileEnum)
    )

    // ---- 2. list_projects 返回真实工程 ----
    const listRes = await client.callTool({ name: 'list_projects', arguments: {} })
    check('list_projects 未标记错误', !listRes.isError, `isError=${!!listRes.isError}`)
    let projects = []
    try {
      projects = JSON.parse(textOf(listRes) ?? 'null')
    } catch {
      projects = []
    }
    if (!check('list_projects 返回真实工程', Array.isArray(projects) && projects.length >= 1, `${projects.length} 个`)) {
      throw new Error('拿不到工程列表，后续用例无从下手')
    }
    // 不断言顺序：listProjects() 按 updated_at 降序，首个取决于最近改动
    const p0 = projects[0]
    check(
      '工程条目形状来自 capabilityCore（name/dir/status/updated_at）',
      typeof p0?.name === 'string' && 'dir' in p0 && 'status' in p0 && 'updated_at' in p0,
      p0?.name
    )

    // ---- 3. get_project 拿到 meta + 正文 ----
    const target = p0.name
    const gpRes = await client.callTool({ name: 'get_project', arguments: { project: target } })
    let gp = null
    try {
      gp = JSON.parse(textOf(gpRes) ?? 'null')
    } catch {
      gp = null
    }
    check(
      'get_project 拿到 meta + 正文',
      !gpRes.isError && gp?.meta?.name === target && typeof gp?.article === 'string',
      `正文 ${gp?.article?.length ?? 0} 字`
    )

    const raRes = await client.callTool({ name: 'read_article', arguments: { project: target } })
    check('read_article 读到正文原文', !raRes.isError && typeof textOf(raRes) === 'string', `${textOf(raRes)?.length ?? 0} 字`)

    // ---- 4. 只读边界：写工具必须被白名单挡在协议层 ----
    // 断言子串而不是整条消息：SDK 的 McpError 构造器自带 "MCP error <code>: " 前缀，
    // 客户端收到网关的 error 后会再包一层，整条消息里前缀是重复的
    const blocked = await client
      .callTool({ name: 'write_article', arguments: { project: target, content: 'x' } })
      .then(() => null)
      .catch((err) => err)
    check(
      'write_article 被白名单挡成 InvalidParams（工具压根没跑）',
      blocked && blocked.code === ErrorCode.InvalidParams && String(blocked.message).includes('未开放远程调用'),
      blocked ? `code=${blocked.code} ${blocked.message}` : '竟然调用成功了'
    )

    // ---- 5. 错误传播：工具自己抛的走 isError 内容，不是 JSON-RPC error ----
    // readMeta 对不存在的工程直接 readFileSync → ENOENT（projectStore.ts:246）
    const missing = await client
      .callTool({ name: 'get_project', arguments: { project: '不存在的工程xyz' } })
      .then((r) => ({ kind: 'result', r }))
      .catch((e) => ({ kind: 'error', e }))
    check(
      '不存在的工程 → isError 文本内容，而非 JSON-RPC error',
      missing.kind === 'result' && missing.r.isError === true && typeof textOf(missing.r) === 'string',
      missing.kind === 'result' ? textOf(missing.r)?.slice(0, 80) : `抛了 ${missing.e.code}`
    )

    // ---- 6. 路径穿越：存储层已经挡住了，远程网关白捡这份防护 ----
    // assertSafeName（projectStore.ts:58-66）在建任何路径之前就拒 ".."
    const traversal = await client
      .callTool({ name: 'read_article', arguments: { project: '../../settings', file: 'article.md' } })
      .then((r) => ({ kind: 'result', r }))
      .catch((e) => ({ kind: 'error', e }))
    check(
      '路径穿越 ../../settings 被拒（isError，未泄任何文件）',
      traversal.kind === 'result' && traversal.r.isError === true && String(textOf(traversal.r)).includes('非法工程名'),
      traversal.kind === 'result' ? textOf(traversal.r)?.slice(0, 80) : `抛了 ${traversal.e.code}`
    )
  } finally {
    await client.close().catch(() => {})
  }

  // ---- 7. 鉴权：这一项用裸 fetch，SDK Client 会把 401 绕进 OAuth 逻辑，处理起来别扭 ----
  const anon = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  })
  check('无 token 打 /mcp → 401', anon.status === 401, `status=${anon.status}`)

  // 刻意不用 process.exit()：传输层句柄还在关闭途中强退会撞 libuv 的 UV_HANDLE_CLOSING 断言
  process.exitCode = failures === 0 ? 0 : 1
  console.log(failures === 0 ? 'REMOTE-MCP-SMOKE-PASS' : `REMOTE-MCP-SMOKE-FAIL（${failures}）`)
}

main().catch((err) => {
  console.log(`FAIL 冒烟脚本自身异常 — ${err?.message ?? err}`)
  process.exitCode = 1
  console.log('REMOTE-MCP-SMOKE-FAIL')
})
