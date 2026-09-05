import http from 'node:http'
import type { NextFunction, Request, Response } from 'express'
import { WebSocketServer } from 'ws'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { READ_ONLY_TOOLS, createMcpServer } from './mcp.js'
import {
  closeAllDevices,
  handleDeviceConnection,
  snapshot,
  startHeartbeat,
  stopHeartbeat
} from './deviceRegistry.js'

/**
 * 立格编辑器远程 MCP 网关（Phase 1：本地只读闭环）
 *
 * 两条通道，两个 token：
 * - POST   /mcp    对外说 MCP（StreamableHTTP 无状态 + JSON 响应），鉴权 LIG_REMOTE_CLIENT_TOKEN
 * - GET    /device 编辑器设备端出站拨号进来的 WebSocket，鉴权 LIG_REMOTE_DEVICE_TOKEN
 * - GET    /health 免鉴权存活探测（对齐 app 侧 bridge.ts 的 /health）
 *
 * 为什么方向是「设备往外连」：家用网络没有公网 IP、不开端口转发，只能由 Windows 侧主动出站。
 * 网关永远不碰文件系统，能力全在编辑器进程里经 CapabilityCore 执行。
 *
 * 环境变量（Phase 1 用纯 shell 环境变量，不读 .env）：
 *   PORT                     监听端口，缺省 3000
 *   LIG_REMOTE_CLIENT_TOKEN  MCP 客户端 → 网关的 Bearer token，缺则拒绝启动
 *   LIG_REMOTE_DEVICE_TOKEN  编辑器 → 网关的 Bearer token，缺则拒绝启动
 *
 * 只绑 127.0.0.1：Phase 1 是本地闭环。createMcpExpressApp 会附带一层 Host 头校验
 * （DNS rebinding 防护 —— 没有它，任意网页都能借回环上的网关读工程正文），
 * 但那层中间件只管 Express 路由；WebSocket 的 upgrade 事件走裸 http.Server，
 * 完全绕过 Express，必须自己校验。
 *
 * 已知接缝：express.json() 默认上限 100kb（bridge.ts 是 32MB）。Phase 1 入参只有
 * {project, file} 无所谓，但后续开放 write_article 时整篇文章作为参数发过来一定会撞，
 * 届时换成 express() + express.json({limit:'32mb'}) + localhostHostValidation()。
 */

const PORT = Number(process.env.PORT) || 3000
const CLIENT_TOKEN = process.env.LIG_REMOTE_CLIENT_TOKEN ?? ''
const DEVICE_TOKEN = process.env.LIG_REMOTE_DEVICE_TOKEN ?? ''

// 宁可起不来，也不要起一个无鉴权的网关：本机任意进程都能读走工程正文
if (!CLIENT_TOKEN || !DEVICE_TOKEN) {
  console.error('[remote-mcp] 缺少 LIG_REMOTE_CLIENT_TOKEN 或 LIG_REMOTE_DEVICE_TOKEN，拒绝启动')
  process.exit(1)
}

const app = createMcpExpressApp({ host: '127.0.0.1' })

/** MCP 客户端 → 网关（对外通道）。字符串直比与 bridge.ts 一致；回环上的 48-hex token 够用 */
const clientGate = (req: Request, res: Response, next: NextFunction): void => {
  if (req.headers.authorization !== `Bearer ${CLIENT_TOKEN}`) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized' }, id: null })
    return
  }
  next()
}

const methodNotAllowed = (_req: Request, res: Response): void => {
  // 无状态网关不提供 GET SSE 流（SDK 客户端正常流程也从不发 GET），规范要求这种情况回 405；
  // 无 session 时 DELETE 同样无意义
  res.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
  })
}

app.get('/health', (_req, res) => {
  // 让操作者能区分「网关坏了」和「只是没有设备在线」
  res.json({ ok: true, gateway: 'lig-remote-mcp', ...snapshot(READ_ONLY_TOOLS) })
})

app.post('/mcp', clientGate, async (req: Request, res: Response) => {
  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // 无状态：不下发 mcp-session-id，不做会话校验
    enableJsonResponse: true // 回 application/json 而非 SSE，curl 可直读，排障成本骤降
  })
  // 不设这个钩子，每请求新建的 Server / transport 会泄漏
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  try {
    await server.connect(transport)
    // body 已被 createMcpExpressApp 里的 express.json() 预解析，作第三参传进去避免二次读流
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error('[remote-mcp] MCP 请求处理失败', err)
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  }
})

app.get('/mcp', clientGate, methodNotAllowed)
app.delete('/mcp', clientGate, methodNotAllowed)

// maxPayload 4MB：tools 帧约 8KB、长文章的 tool_result 约 200KB，4MB 宽裕且能挡住失控帧
const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 })

wss.on('connection', (ws) => handleDeviceConnection(ws))

// 必须显式建 http.Server（而不是 app.listen()），才能在 listen 之前挂上 upgrade
const httpServer = http.createServer(app)

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (pathname !== '/device') {
    socket.destroy()
    return
  }
  // token 走升级头而非 hello 体内：网关能在 socket 建立之前就 401 掉，
  // 未鉴权的连接根本不进 devices Map
  if (req.headers.authorization !== `Bearer ${DEVICE_TOKEN}`) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  // noServer + 手工 upgrade：ws 8 里 verifyClient 已废弃，这是官方推荐的替代写法
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

startHeartbeat()

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`[remote-mcp] 网关就绪 http://127.0.0.1:${PORT}/mcp（设备通道 /device）`)
})

let closing = false

function shutdown(signal: string): void {
  if (closing) return
  closing = true
  console.log(`[remote-mcp] 收到 ${signal}，关闭中`)
  stopHeartbeat()
  // 先拆设备连接：让编辑器立刻看到断开并重连，而不是等心跳把它收割掉
  closeAllDevices()
  wss.close()
  httpServer.close(() => process.exit(0))
  // 兜底：有连接不肯关也要退出
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
