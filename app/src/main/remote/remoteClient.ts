import { app } from 'electron'
import { hostname } from 'os'
import { WebSocket } from 'ws'
import { TOOLS, callTool } from '../capabilityCore'
import { REMOTE_PROTOCOL, parseGatewayMessage, type DeviceMessage } from './remoteProtocol'

/**
 * 远程 MCP 设备端：编辑器主动出站拨号到网关，把 CapabilityCore 挂上去
 *
 * 为什么是出站：家用网络没有公网 IP、不开端口转发，只能让 Windows 这头拨出去。
 * 与 bridge.ts 的关系是并列而非替代 —— 桥服务同机 Agent（127.0.0.1 随机端口），
 * 这里服务远端 MCP 客户端（经网关）。两者共用 capabilityCore 这一张工具表。
 *
 * 无头模式（--mcp）刻意不接：mcp-proxy.cjs 仅在 GUI 未运行时才拉起 --mcp，且 index.ts
 * 在 MCP_MODE 下跳过单实例锁 —— 无头实例若也注册为设备，会用同一个 deviceId 把 GUI 的
 * 活连接顶掉（网关 attachDevice 对同 id 是驱逐语义），代理退出时设备表还会抖动。
 *
 * 环境变量（全部可选，未配 LIG_REMOTE_MCP=1 时本模块什么都不做）：
 *   LIG_REMOTE_MCP=1        启用闸门
 *   LIG_REMOTE_GATEWAY      网关设备通道，默认 ws://127.0.0.1:3000/device
 *   LIG_REMOTE_DEVICE_ID    设备标识，默认 os.hostname()
 *   LIG_REMOTE_DEVICE_TOKEN 设备 token，缺失则记 warning 不拨号（fail closed）
 */

interface RemoteConfig {
  url: string
  deviceId: string
  token: string
}

const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 30_000
const HANDSHAKE_TIMEOUT_MS = 10_000

let ws: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let attempt = 0
let config: RemoteConfig | null = null

/** 启用闸门放在这里而不是 index.ts：未配置的用户连其他变量都不读，index.ts 保持扁平的 startX() 列表 */
function readConfig(): RemoteConfig | null {
  if (process.env.LIG_REMOTE_MCP !== '1') return null
  const token = process.env.LIG_REMOTE_DEVICE_TOKEN ?? ''
  if (!token) {
    // 不去撞 401 死循环：缺 token 是配置错误，重试多少次都一样
    console.warn('[remote] LIG_REMOTE_MCP=1 但缺 LIG_REMOTE_DEVICE_TOKEN，不拨号')
    return null
  }
  return {
    url: process.env.LIG_REMOTE_GATEWAY || 'ws://127.0.0.1:3000/device',
    deviceId: process.env.LIG_REMOTE_DEVICE_ID || hostname(),
    token
  }
}

/** 未 OPEN 就静默丢弃：tool_call 是异步的，socket 可能中途死掉，网关那边已按断线 reject 掉 pending */
function send(sock: WebSocket, msg: DeviceMessage): void {
  if (sock.readyState !== WebSocket.OPEN) return
  sock.send(JSON.stringify(msg))
}

/** 每次连上（含重连）都重推全量工具表：网关不持久化，重连即完全恢复 */
function sendTools(sock: WebSocket): void {
  // 显式挑字段而不是整个 TOOLS：handler 是函数，不该出现在出网载荷里
  send(sock, {
    type: 'tools',
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
  })
}

async function handleToolCall(
  sock: WebSocket,
  id: string,
  name: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    send(sock, { type: 'tool_result', id, ok: true, result: await callTool(name, args) })
  } catch (err) {
    // 信封与 bridge.ts 逐字一致：工具跑了但失败 → ok:false，网关转成 isError 内容而非 JSON-RPC error
    send(sock, { type: 'tool_result', id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

function connect(): void {
  const cfg = config
  if (!cfg) return

  const sock = new WebSocket(cfg.url, {
    // token 走升级头而不是 hello 体内：网关能在 socket 建立之前就 401 掉
    headers: { Authorization: `Bearer ${cfg.token}` },
    handshakeTimeout: HANDSHAKE_TIMEOUT_MS
  })
  ws = sock

  sock.on('error', (err: Error) => {
    console.warn(`[remote] 网关连接错误：${err.message}`)
  })

  sock.on('open', () => {
    send(sock, {
      type: 'hello',
      protocol: REMOTE_PROTOCOL,
      deviceId: cfg.deviceId,
      appVersion: app.getVersion()
    })
  })

  sock.on('message', (data: Buffer) => {
    const msg = parseGatewayMessage(data.toString())
    if (!msg) {
      console.warn('[remote] 收到无法解析的网关帧，丢弃')
      return
    }

    if (msg.type === 'ready') {
      if (msg.protocol !== REMOTE_PROTOCOL) {
        console.error(`[remote] 网关协议版本 ${msg.protocol} 与本端 ${REMOTE_PROTOCOL} 不符，断开`)
        sock.close(1002, 'protocol mismatch')
        return
      }
      // heartbeatMs 本端不用：ws 客户端默认 autoPong，网关的 ping 由库自动应答
      attempt = 0
      console.log(`[remote] 已连上网关 ${cfg.url}（设备 ${cfg.deviceId}）`)
      sendTools(sock)
      return
    }

    void handleToolCall(sock, msg.id, msg.name, msg.arguments)
  })

  sock.on('close', () => {
    // 只认当前这条 socket：stopRemoteClient() 会先把 ws 置空，旧连接的 close 就不该再排重连
    if (ws !== sock) return
    ws = null
    scheduleReconnect()
  })
}

function scheduleReconnect(): void {
  if (!config || reconnectTimer) return
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS)
  // ±20% 抖动：多设备时避免网关重启后齐刷刷重连
  const delay = Math.round(base * (0.8 + Math.random() * 0.4))
  attempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

/** 幂等，与 startBridge() 同构。未启用（readConfig 返回 null）时是空操作 */
export function startRemoteClient(): void {
  if (ws || reconnectTimer) return
  config = readConfig()
  if (!config) return
  attempt = 0
  connect()
}

export function stopRemoteClient(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  const sock = ws
  // 先摘引用再 terminate：close 回调里的 `ws !== sock` 守卫因此不会再排一次重连
  ws = null
  config = null
  attempt = 0
  // terminate 而非 close：close 要等对端回关闭帧，进程可能先退出，
  // 网关那边会把设备当在线一直留到心跳收掉（最长 60 秒）
  sock?.terminate()
}
