import { app } from 'electron'

/**
 * API 请求统一 UA（纯 ASCII）。
 * Electron 默认 UA 携带中文应用名「立格编辑器」，Chromium 网络栈不校验头值直接发出；
 * 商汤等 gRPC-gateway 网关会把 User-Agent 转发为 grpcgateway-user-agent，
 * 非 ASCII 值直接 500（实测：中文 UA → 500 internal_server_error，ASCII UA → 200）。
 * 因此所有打向模型供应商的请求都要覆盖这个头，禁止使用默认 UA。
 */
export function apiUserAgent(): string {
  return `LIG-Editor/${app.getVersion()}`
}

/** 429 限流的用户可读提示（服务端原文是生硬的 JSON） */
export function friendlyHttpError(status: number, text: string): string {
  if (status !== 429) return `HTTP ${status}：${text}`
  return (
    '已触发供应商限流（TPM/RPM 超额：每分钟 token/请求数到顶）。' +
    '通常 1 分钟内自动恢复；思考模型每轮消耗较大，可关闭「思考」或换轻量模型（如 sensenova-6.8-flash-lite）降低消耗。'
  )
}
