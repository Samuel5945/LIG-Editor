/**
 * 远程 MCP 设备通道协议 —— 设备侧（原本）
 *
 * ！！镜像文件！！
 * remote-mcp/src/protocol.ts 是本文件的手工镜像（消息方向相反，那边校验的是 parseDeviceMessage）。
 * 改协议必须两边同改，并跑 `cd remote-mcp && npm run smoke` 验证（冒烟会跑遍全部 5 个消息型）。
 * app 是 electron-vite 打的 CJS、remote-mcp 是独立 ESM 工程，两边互相 import 不到，只能镜像。
 *
 * 本文件刻意不 import ws / electron —— 纯类型 + 纯函数，协议改动可以脱离运行时审。
 *
 * 类型是文档不是契约：线上跑的是 JSON，收帧一律过 parseGatewayMessage 实际校验字段，
 * 不能依赖下面的 interface 提供安全性。
 */

/** 协议版本：hello/ready 互报，不一致直接拒绝，避免半新半旧的字段被误解 */
export const REMOTE_PROTOCOL = 1

/** 网关等设备 hello 的上限：已 upgrade 却不报身份的连接不能蹲在表里 */
export const HELLO_TIMEOUT_MS = 5000

/** 网关等设备 tool_result 的上限。只读三件套是毫秒级同步读盘，余量留给后续写工具与 LLM 工具 */
export const TOOL_CALL_TIMEOUT_MS = 120_000

/** 心跳间隔：NAT/杀软会掐长时间静默的连接；笔记本休眠后 socket 会静默死掉不发 FIN */
export const HEARTBEAT_MS = 30_000

/**
 * 工具元数据：字段与 capabilityCore.ToolDef 的前三项逐字对齐（不含 handler）。
 * 设备把 TOOLS 原样推给网关，网关不重写、不转换、不维护第二张工具表 ——
 * 与 resources/mcp-proxy.cjs 从 GET /tools 实时拉清单是同一个思路。
 */
export interface RemoteToolMeta {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

/** 设备（编辑器）→ 网关 */
export type DeviceMessage =
  | { type: 'hello'; protocol: number; deviceId: string; appVersion: string }
  | { type: 'tools'; tools: RemoteToolMeta[] }
  | { type: 'tool_result'; id: string; ok: true; result: unknown }
  | { type: 'tool_result'; id: string; ok: false; error: string }

/** 网关 → 设备 */
export type GatewayMessage =
  | { type: 'ready'; protocol: number; heartbeatMs: number }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * 收帧校验：脏帧返回 null（调用方记日志后丢弃，不断连接）。
 * 只校验帧的形状，不校验工具名是否存在 —— 未知工具是 capabilityCore.callTool 的
 * `未知工具：${name}`，走 tool_result {ok:false} 正常回给网关，不该在协议层拦掉。
 */
export function parseGatewayMessage(raw: string): GatewayMessage | null {
  let m: unknown
  try {
    m = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(m)) return null

  if (m.type === 'ready') {
    if (typeof m.protocol !== 'number') return null
    return {
      type: 'ready',
      protocol: m.protocol,
      heartbeatMs: typeof m.heartbeatMs === 'number' ? m.heartbeatMs : HEARTBEAT_MS
    }
  }

  if (m.type === 'tool_call') {
    if (typeof m.id !== 'string' || !m.id) return null
    if (typeof m.name !== 'string' || !m.name) return null
    return {
      type: 'tool_call',
      id: m.id,
      name: m.name,
      arguments: isObj(m.arguments) ? m.arguments : {}
    }
  }

  return null
}
