/**
 * 远程 MCP 设备通道协议 —— 网关侧
 *
 * ！！镜像文件！！
 * 原本在 app/src/main/remote/remoteProtocol.ts，本文件是它的手工镜像（消息方向相反）。
 * 改协议必须两边同改，并跑 `npm run smoke` 验证（冒烟会跑遍全部 5 个消息型）。
 * app 是 electron-vite 打的 CJS、remote-mcp 是独立 ESM 工程，两边互相 import 不到，只能镜像。
 *
 * 类型是文档不是契约：线上跑的是 JSON，收帧一律过 parseDeviceMessage 实际校验字段，
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
 * 工具元数据：字段与 app 侧 capabilityCore.ToolDef 的前三项逐字对齐（不含 handler）。
 * 设备把 TOOLS 原样推给网关，网关不重写、不转换、不维护第二张工具表 ——
 * 与 app/resources/mcp-proxy.cjs 从 GET /tools 实时拉清单是同一个思路。
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
 * 逐项校验设备推来的工具定义 —— 这是跨网络边界的不可信输入，
 * 且这些 schema 会被原样塞进 MCP tools/list 交给远程客户端。
 */
function parseToolMeta(v: unknown): RemoteToolMeta | null {
  if (!isObj(v)) return null
  if (typeof v.name !== 'string' || !v.name) return null
  if (typeof v.description !== 'string') return null
  const schema = v.inputSchema
  if (!isObj(schema) || schema.type !== 'object') return null
  if (!isObj(schema.properties)) return null
  const required = schema.required
  if (required !== undefined && !(Array.isArray(required) && required.every((r) => typeof r === 'string'))) {
    return null
  }
  return {
    name: v.name,
    description: v.description,
    inputSchema: {
      type: 'object',
      properties: schema.properties,
      ...(required ? { required } : {})
    }
  }
}

/**
 * 收帧校验：脏帧返回 null（调用方记日志后丢弃）。
 * 只有 hello 的字段不合规才值得断连接（由调用方决定），其余一律丢弃不断链 ——
 * 网关版本不匹配时宁可少干一件事，也不要把整条设备通道掀了。
 */
export function parseDeviceMessage(raw: string): DeviceMessage | null {
  let m: unknown
  try {
    m = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(m)) return null

  if (m.type === 'hello') {
    if (typeof m.protocol !== 'number') return null
    if (typeof m.deviceId !== 'string' || !m.deviceId) return null
    return {
      type: 'hello',
      protocol: m.protocol,
      deviceId: m.deviceId,
      appVersion: typeof m.appVersion === 'string' ? m.appVersion : ''
    }
  }

  if (m.type === 'tools') {
    if (!Array.isArray(m.tools)) return null
    const tools: RemoteToolMeta[] = []
    for (const entry of m.tools) {
      const parsed = parseToolMeta(entry)
      // 单个工具定义畸形就整帧拒收：半份工具表会让白名单过滤结果不可预期
      if (!parsed) return null
      tools.push(parsed)
    }
    return { type: 'tools', tools }
  }

  if (m.type === 'tool_result') {
    if (typeof m.id !== 'string') return null
    if (m.ok === true) return { type: 'tool_result', id: m.id, ok: true, result: m.result }
    if (m.ok === false) {
      return { type: 'tool_result', id: m.id, ok: false, error: typeof m.error === 'string' ? m.error : '未知错误' }
    }
    return null
  }

  return null
}
