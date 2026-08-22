import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { getAppPaths } from './paths'
import { callTool, TOOLS } from './capabilityCore'

/**
 * 本地 HTTP bridge（M8）：GUI 运行期间把 CapabilityCore 暴露在 127.0.0.1 随机端口
 * 外部 Agent 读 settings/bridge.json 拿 {port, token} 后即可调用（GUI 在场时优先走桥，避免二开 Electron 实例）
 * - GET  /health           存活探测
 * - GET  /tools            工具清单（同 MCP tools/list）
 * - POST /tool             {name, arguments} → {ok, result|error}
 * 鉴权：Authorization: Bearer <token>
 */

let server: Server | null = null

function bridgeFile(): string {
  return join(getAppPaths().settings, 'bridge.json')
}

export function startBridge(): void {
  if (server) return
  const token = randomBytes(24).toString('hex')

  server = createServer((req, res) => {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    if (req.url === '/health') {
      reply(200, { ok: true, app: 'LIG-Editor' })
      return
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      reply(401, { ok: false, error: 'token 无效，读取 settings/bridge.json 获取' })
      return
    }
    if (req.method === 'GET' && req.url === '/tools') {
      reply(200, { ok: true, tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
      return
    }
    if (req.method === 'POST' && req.url === '/tool') {
      let raw = ''
      req.on('data', (c: Buffer) => {
        raw += c.toString('utf-8')
        if (raw.length > 32 * 1024 * 1024) req.destroy() // 防超大请求体
      })
      req.on('end', () => {
        void (async () => {
          try {
            const { name, arguments: args } = JSON.parse(raw) as { name: string; arguments?: Record<string, unknown> }
            reply(200, { ok: true, result: await callTool(name, args ?? {}) })
          } catch (err) {
            reply(200, { ok: false, error: err instanceof Error ? err.message : String(err) })
          }
        })()
      })
      return
    }
    reply(404, { ok: false, error: 'not found' })
  })

  // 端口 0 = 系统分配随机空闲端口；只绑回环地址
  server.listen(0, '127.0.0.1', () => {
    const addr = server?.address()
    if (!addr || typeof addr === 'string') return
    writeFileSync(
      bridgeFile(),
      JSON.stringify({ port: addr.port, token, pid: process.pid, started_at: new Date().toISOString() }, null, 2),
      'utf-8'
    )
  })
}

/** 退出时关桥并删 bridge.json（避免外部 Agent 连到残留端口） */
export function stopBridge(): void {
  server?.close()
  server = null
  try {
    if (existsSync(bridgeFile())) unlinkSync(bridgeFile())
  } catch {
    // 删除失败不阻塞退出
  }
}
