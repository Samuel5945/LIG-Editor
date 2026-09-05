import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import {
  HEARTBEAT_MS,
  HELLO_TIMEOUT_MS,
  REMOTE_PROTOCOL,
  TOOL_CALL_TIMEOUT_MS,
  parseDeviceMessage,
  type DeviceMessage,
  type GatewayMessage,
  type RemoteToolMeta
} from './protocol.js'

/**
 * 设备注册表 —— 网关的全部状态都在这里（设备连接、在途调用、聚合工具表）。
 *
 * 这正是 MCP Server 能按请求新建（无状态）的前提：状态不挂在 Server 实例上，
 * 所以每个 POST /mcp 造一套新 Server + Transport 不丢任何东西。
 *
 * 本模块不含策略：只读白名单由 mcp.ts 传进来（见 listRemoteTools / snapshot 的入参）。
 */

interface DeviceConnection {
  deviceId: string
  ws: WebSocket
  appVersion: string
  /** 收到 tools 帧之前为空 —— 此刻 tools/list 就是空的，这是诚实的 */
  tools: RemoteToolMeta[]
  onlineAt: number
  /** 心跳探活用：上一轮 ping 没回 pong 就收割 */
  alive: boolean
}

interface PendingCall {
  deviceId: string
  name: string
  timer: NodeJS.Timeout
  resolve: (outcome: ToolCallOutcome) => void
  reject: (err: unknown) => void
}

export interface ToolCallOutcome {
  ok: boolean
  result?: unknown
  error?: string
}

const devices = new Map<string, DeviceConnection>()
const pending = new Map<string, PendingCall>()

let heartbeat: NodeJS.Timeout | null = null

function sendToDevice(conn: DeviceConnection, msg: GatewayMessage): boolean {
  if (conn.ws.readyState !== WebSocket.OPEN) return false
  conn.ws.send(JSON.stringify(msg))
  return true
}

/** Phase 1 只有一台设备，但这里就按「找一台提供该工具的在线设备」写，多设备时不用重写 */
function pickDeviceForTool(name: string): DeviceConnection | null {
  // Map 迭代是插入序 → 先上线者胜。换成显式设备定向或按能力加权路由只改这一个函数
  for (const conn of devices.values()) {
    if (conn.tools.some((t) => t.name === name)) return conn
  }
  return null
}

/** 聚合所有在线设备的工具，按名去重（多设备时结果确定）；白名单过滤是调用方的策略 */
export function listRemoteTools(whitelist: Set<string>): RemoteToolMeta[] {
  const seen = new Map<string, RemoteToolMeta>()
  for (const conn of devices.values()) {
    for (const t of conn.tools) {
      if (!whitelist.has(t.name) || seen.has(t.name)) continue
      seen.set(t.name, t)
    }
  }
  return [...seen.values()]
}

/**
 * 把一次 MCP tools/call 投递给设备并等结果。
 *
 * 两类失败刻意走两条路：
 * - 传输层问题（无在线设备 / 120 秒未回 / 设备中途断开 / socket 已不可用）→ 抛 McpError，
 *   变成 JSON-RPC error。工具压根没跑完，用 isError 会假称它跑了。
 * - 设备回 ok:false（capabilityCore 自己抛的，如工程名非法、ENOENT）→ 返回 outcome，
 *   由 mcp.ts 转成 isError:true 的文本内容。那才是「工具跑了但失败了」。
 */
export function dispatchToolCall(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
  const conn = pickDeviceForTool(name)
  if (!conn) {
    // 最重要的不挂起保证：零设备时给干净的错误，而不是让调用方吊在那儿
    return Promise.reject(
      new McpError(ErrorCode.InternalError, `没有在线设备提供工具 ${name}（编辑器是否在运行、是否已连上网关）`)
    )
  }

  const id = randomUUID()
  return new Promise<ToolCallOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(
        new McpError(
          ErrorCode.InternalError,
          `工具 ${name} 在 ${TOOL_CALL_TIMEOUT_MS / 1000} 秒内未返回（设备 ${conn.deviceId}）`
        )
      )
    }, TOOL_CALL_TIMEOUT_MS)

    pending.set(id, { deviceId: conn.deviceId, name, timer, resolve, reject })

    // socket 在 pickDevice 之后可能已经不可用：立刻 reject，别让调用方白等满超时
    if (!sendToDevice(conn, { type: 'tool_call', id, name, arguments: args })) {
      clearTimeout(timer)
      pending.delete(id)
      reject(new McpError(ErrorCode.InternalError, `设备 ${conn.deviceId} 连接已不可用，工具 ${name} 未送达`))
    }
  })
}

/** 断线时立刻 reject 该设备所有 pending，否则调用方白等 120 秒（HTTP 客户端可能早自己超时了） */
function rejectDevicePending(deviceId: string, reason: string): void {
  for (const [id, call] of pending) {
    if (call.deviceId !== deviceId) continue
    clearTimeout(call.timer)
    pending.delete(id)
    call.reject(new McpError(ErrorCode.InternalError, `${reason}，工具 ${call.name} 未完成`))
  }
}

function attachDevice(deviceId: string, ws: WebSocket, appVersion: string): void {
  const prev = devices.get(deviceId)
  // 同 deviceId 重连要踢掉旧连接：应用重启时新 socket 常在旧 socket 的 close 事件之前到达，
  // 不做身份校验，旧连接的 close 会把新登记的那条摘掉
  if (prev && prev.ws !== ws) {
    console.log(`[remote-mcp] 设备 ${deviceId} 重连，踢掉旧连接`)
    prev.ws.terminate()
  }
  devices.set(deviceId, { deviceId, ws, appVersion, tools: [], onlineAt: Date.now(), alive: true })
}

function detachDevice(deviceId: string, ws: WebSocket): void {
  // 反向校验：只在这条 ws 仍是当前登记的那条时才摘除（重连场景下旧连接的 close 会晚到）
  if (devices.get(deviceId)?.ws !== ws) return
  devices.delete(deviceId)
  rejectDevicePending(deviceId, `设备 ${deviceId} 已断开`)
  console.log(`[remote-mcp] 设备离线 ${deviceId}`)
}

function resolvePending(msg: Extract<DeviceMessage, { type: 'tool_result' }>): void {
  const call = pending.get(msg.id)
  // 迟到的结果（已超时 / 已因断线 reject）：静默丢弃 + 记日志，绝不抛
  if (!call) {
    console.warn(`[remote-mcp] 收到未知 id 的 tool_result，丢弃（${msg.id}）`)
    return
  }
  clearTimeout(call.timer)
  pending.delete(msg.id)
  call.resolve(msg.ok ? { ok: true, result: msg.result } : { ok: false, error: msg.error })
}

/**
 * 接管一条已通过 upgrade 鉴权的设备连接，走完 hello → ready → tools 握手。
 *
 * tools 门控在 ready 之后（而不是连上就一起发）：网关若拒绝协议版本会立刻关连接，
 * 在途的 tools 帧白费且让日志含糊。门控还使重连重推与首推是同一条代码路径。
 */
export function handleDeviceConnection(ws: WebSocket): void {
  let deviceId: string | null = null

  const helloTimer = setTimeout(() => {
    // 防止已 upgrade 但未报身份的 socket 蹲在连接表里
    console.warn('[remote-mcp] 连接 5 秒内未报身份，终止')
    ws.terminate()
  }, HELLO_TIMEOUT_MS)

  ws.on('pong', () => {
    const conn = deviceId !== null ? devices.get(deviceId) : undefined
    if (conn && conn.ws === ws) conn.alive = true
  })

  ws.on('message', (data: Buffer) => {
    const msg = parseDeviceMessage(data.toString('utf-8'))
    if (!msg) {
      console.warn('[remote-mcp] 收到无法解析的设备帧，丢弃')
      return
    }

    if (msg.type === 'hello') {
      if (deviceId !== null) return // 重复 hello 忽略，不重置已登记状态
      if (msg.protocol !== REMOTE_PROTOCOL) {
        console.warn(`[remote-mcp] 协议版本不符（设备 ${msg.protocol} / 网关 ${REMOTE_PROTOCOL}），拒绝`)
        ws.close(1002, 'protocol mismatch')
        return
      }
      clearTimeout(helloTimer)
      deviceId = msg.deviceId
      attachDevice(msg.deviceId, ws, msg.appVersion)
      const conn = devices.get(msg.deviceId)
      if (conn) sendToDevice(conn, { type: 'ready', protocol: REMOTE_PROTOCOL, heartbeatMs: HEARTBEAT_MS })
      console.log(`[remote-mcp] 设备上线 ${msg.deviceId}（编辑器 ${msg.appVersion}）`)
      return
    }

    // hello 之前到达的 tools / tool_result 是协议违规
    if (deviceId === null) {
      console.warn(`[remote-mcp] 握手前收到 ${msg.type}，关闭连接`)
      ws.close(1002, 'unexpected message before hello')
      return
    }

    if (msg.type === 'tools') {
      const conn = devices.get(deviceId)
      if (!conn || conn.ws !== ws) return
      conn.tools = msg.tools
      console.log(`[remote-mcp] 设备 ${deviceId} 推送 ${msg.tools.length} 个工具`)
      return
    }

    resolvePending(msg)
  })

  ws.on('close', () => {
    clearTimeout(helloTimer)
    if (deviceId !== null) detachDevice(deviceId, ws)
  })

  ws.on('error', (err: Error) => {
    console.warn(`[remote-mcp] 设备连接错误：${err.message}`)
  })
}

/**
 * 心跳收割（非可选）：家用网络/笔记本休眠会让 socket 静默死掉而不发 FIN。
 * 不主动探活的话，这种僵尸设备会一直显示在线，每次 tools/call 都要白等满 120 秒超时。
 * 最坏检出 = 2 × HEARTBEAT_MS（60 秒）。ws 在设备侧自动回 pong，编辑器无需写代码。
 */
export function startHeartbeat(): void {
  if (heartbeat) return
  heartbeat = setInterval(() => {
    for (const conn of devices.values()) {
      if (!conn.alive) {
        console.warn(`[remote-mcp] 设备 ${conn.deviceId} 心跳超时，收割`)
        conn.ws.terminate()
        continue
      }
      conn.alive = false
      conn.ws.ping()
    }
  }, HEARTBEAT_MS)
}

export function stopHeartbeat(): void {
  if (!heartbeat) return
  clearInterval(heartbeat)
  heartbeat = null
}

/** 进程退出时拆掉所有设备连接，让它们立刻重连而不是等心跳收割 */
export function closeAllDevices(): void {
  for (const conn of devices.values()) {
    rejectDevicePending(conn.deviceId, '网关正在关闭')
    conn.ws.terminate()
  }
  devices.clear()
}

/** /health 用：让操作者能区分「网关坏了」和「只是没有设备在线」 */
export function snapshot(whitelist: Set<string>): {
  devices: number
  deviceIds: string[]
  pendingCalls: number
  deviceTools: number
  tools: string[]
} {
  // deviceTools 是白名单过滤之前的总数：本设计的不变量是「设备推全量、网关只放行白名单」，
  // 少了这个数就只能看见放行的 3 个，分不清设备到底推没推全
  const pushed = new Set<string>()
  for (const conn of devices.values()) {
    for (const t of conn.tools) pushed.add(t.name)
  }
  return {
    devices: devices.size,
    deviceIds: [...devices.keys()],
    pendingCalls: pending.size,
    deviceTools: pushed.size,
    tools: listRemoteTools(whitelist).map((t) => t.name).sort()
  }
}
