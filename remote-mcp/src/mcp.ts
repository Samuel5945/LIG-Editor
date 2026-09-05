import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import { dispatchToolCall, listRemoteTools } from './deviceRegistry.js'

/**
 * 网关的 MCP 面（Phase 1：只读闭环）
 *
 * 为什么用 SDK 的低阶 Server 而不是 McpServer：
 * McpServer.registerTool 的 inputSchema 只收 zod（server/zod-compat.d.ts:
 * AnySchema = z3.ZodTypeAny | z4.$ZodType，且全文件无 rawInputSchema 逃生口），
 * 而 app 侧 capabilityCore.TOOLS[].inputSchema 是手写 JSON Schema。换 McpServer 就得把
 * 23 个工具的 schema 全部重写成 zod —— 凭空多出第二张工具表，必然和唯一真源漂移。
 * 低阶 Server 允许自己接 ListToolsRequestSchema，把设备推来的 JSON Schema 原样塞进
 * tools 数组（MCP 规范里 Tool.inputSchema 本来就是 JSON Schema，SDK 的 ToolSchema 也是这么定义的）。
 *
 * 代价（都已实测）：
 * - Server 在 JSDoc 里标了 @deprecated（建议用 McpServer）。透传 JSON Schema 正是它说的
 *   「advanced use case」，弃用标记只是建议性的、无运行时警告。
 * - 必须显式声明 capabilities.tools，否则 server/index.js:231 在注册处理器时就抛
 *   「Server does not support tools」。
 * - tools/call 的返回值会被 server/index.js:130 用 CallToolResultSchema 复验，
 *   所以必须回 {content, isError} 信封，不能像 bridge.ts 那样回裸结果。
 *   但它不拿 inputSchema 校验 arguments（那是 McpServer 才做的），
 *   capabilityCore 自己的 str() 守卫仍是唯一入参校验，与本地通道行为一致。
 */

/**
 * Phase 1 白名单：只放只读三件套。
 * 设备推来的是 capabilityCore 的全量 23 个工具（含 write_article / push_draft），
 * 挡住写操作靠的就是这一个 Set —— 应用侧完全不知道自己正处在「只读模式」。
 * 后续加工具分级时，这里换成按 ToolDef.access 过滤，是单点改动。
 */
export const READ_ONLY_TOOLS = new Set(['list_projects', 'get_project', 'read_article'])

/**
 * 无状态模式：每个 POST 造一套新的 Server + Transport。
 * 这是 SDK 硬性要求 —— webStandardStreamableHttp.js:175 对复用无状态 transport 直接抛，
 * 而 Server.connect(transport) 是 1:1 绑定，所以 Server 也得是新的。
 * 工具表与设备连接都在 deviceRegistry 的模块级单例里，不挂在 Server 实例上，按请求新建不丢状态。
 */
export function createMcpServer(): Server {
  const server = new Server({ name: 'lig-remote-mcp', version: '0.1.0' }, {
    capabilities: { tools: {} }
  })

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: listRemoteTools(READ_ONLY_TOOLS).map((t) => ({
      name: t.name,
      description: t.description,
      // 原样透传：capabilityCore 把 properties 标成 Record<string, unknown>，
      // SDK 的 Tool 要 Record<string, object>（types.d.ts:2381）。同一份 JSON 的两种类型口径，
      // 运行时已由 parseDeviceMessage 逐字段校验过，这里只做类型对齐
      inputSchema: t.inputSchema as Tool['inputSchema']
    }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    if (!READ_ONLY_TOOLS.has(name)) {
      // 白名单外 → 协议级拒绝（工具压根没跑），不是工具执行失败
      throw new McpError(ErrorCode.InvalidParams, `工具 ${name} 未开放远程调用（Phase 1 只读闭环）`)
    }

    // dispatchToolCall 抛的是传输层问题（无在线设备 / 120s 未回 / 设备中途断开），
    // 直接冒泡成 JSON-RPC error；只有 capabilityCore 自己抛的才走 isError 内容
    const outcome = await dispatchToolCall(name, args ?? {})

    // 文本整形与 mcp-proxy.cjs 逐字一致 —— 刻意的，两个入口呈现工具输出的方式相同
    const text = outcome.ok
      ? typeof outcome.result === 'string'
        ? outcome.result
        : JSON.stringify(outcome.result, null, 2)
      : (outcome.error ?? '未知错误')

    return { content: [{ type: 'text' as const, text }], isError: !outcome.ok }
  })

  return server
}
