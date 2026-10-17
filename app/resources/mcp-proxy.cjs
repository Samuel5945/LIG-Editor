#!/usr/bin/env node
/**
 * MCP stdio 代理（M8）：外部 Agent（Codex/Qoder）→ 本代理 → 立格编辑器 HTTP bridge
 *
 * 为什么需要代理：Windows 下 Electron 主进程拿不到管道 stdin/stdout（Chromium 接管句柄，
 * electron#4218），stdio MCP 无法直接跑在 Electron 里。本脚本用
 * `ELECTRON_RUN_AS_NODE=1 electron.exe mcp-proxy.cjs` 以纯 Node 方式运行，
 * 承接 MCP JSON-RPC(换行分隔)，转发到应用的 127.0.0.1 HTTP bridge：
 * - GUI 已在运行 → 直连现成 bridge（settings/bridge.json 里的 port/token）
 * - GUI 不在 → 拉起无头实例（--mcp，只开 bridge 不开窗口），退出时带走
 */
'use strict'
const { spawn, execFileSync } = require('child_process')
const { existsSync, readFileSync, renameSync, unlinkSync } = require('fs')
const { dirname, join, resolve } = require('path')
const { homedir } = require('os')
const http = require('http')
const readline = require('readline')

const log = (msg) => process.stderr.write(`[mcp-proxy] ${msg}\n`)

// 单次工具调用上限：贴图/正文渲染要开离屏窗口、push_draft 要逐张传微信 CDN，
// 但「不设超时」等于桥一旦卡住宿主就永久干等——给个可调的上限，超时就如实报错
const CALL_TIMEOUT_MS = Number(process.env.LIG_MCP_TIMEOUT_MS) || 300000
// 存活探测必须短：发现阶段要连续试好几次，长超时会让首次调用慢到像挂住
const PROBE_TIMEOUT_MS = Number(process.env.LIG_MCP_PROBE_TIMEOUT_MS) || 3000

// ---- 路径推导：packaged 时本文件在 <exe目录>/resources/（与 app.asar 同级），dev 时在 <appDir>/resources/ ----
const here = __dirname
const packaged = existsSync(join(here, 'app.asar'))
const appDir = packaged ? null : dirname(here)

/** 系统「文档」目录：纯 Node 拿不到 app.getPath('documents')，用 PowerShell 查已知文件夹（兼容 OneDrive 重定向） */
function documentsDir() {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', "[Environment]::GetFolderPath('MyDocuments')"],
      { encoding: 'utf-8', timeout: 10000, windowsHide: true }
    ).trim()
    if (out) return out
  } catch {
    // 查询失败退化到默认位置
  }
  return join(homedir(), 'Documents')
}

// 应用根：打包态 = 「文档\立格编辑器」（不能用安装目录，覆盖安装会清空）；dev 态 = app 目录的上级（与 paths.ts 一致）。
// 2026-08 应用改名（图文编辑器 → 立格编辑器）：与 paths.ts 同步做一次性数据目录迁移，搬不动（旧实例占用）就继续用旧目录
function packagedRoot() {
  const next = join(documentsDir(), '立格编辑器')
  const prev = join(documentsDir(), '图文编辑器')
  if (!existsSync(next) && existsSync(prev)) {
    try {
      renameSync(prev, next)
    } catch {
      return prev
    }
  }
  return next
}
const root =
  process.env.LIG_ROOT || process.env.TUWEN_ROOT || (packaged ? packagedRoot() : resolve(appDir, '..'))
const bridgeFile = join(root, 'settings', 'bridge.json')

// ---- bridge 发现 / 拉起 ----

let child = null

function readBridge() {
  try {
    return JSON.parse(readFileSync(bridgeFile, 'utf-8'))
  } catch {
    return null
  }
}

function httpJson(method, path, cfg, body, timeoutMs) {
  const timeout = timeoutMs === undefined ? CALL_TIMEOUT_MS : timeoutMs
  return new Promise((resolvePromise, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: cfg.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${cfg.token}`
        },
        timeout
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolvePromise(JSON.parse(raw))
          } catch (err) {
            reject(new Error(`bridge 响应不是 JSON：${raw.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error(`bridge ${Math.round(timeout / 1000)} 秒内没返回（渲染或推送可能还在跑）：需要更久就设环境变量 LIG_MCP_TIMEOUT_MS`))
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function alive(cfg) {
  if (!cfg) return Promise.resolve(false)
  return httpJson('GET', '/health', cfg, null, PROBE_TIMEOUT_MS).then(
    (r) => r && r.ok === true,
    () => false
  )
}

/** 残留 bridge.json 清理：代理被强杀时无头实例走不到 will-quit，端口和 token 会留在盘上。
 *  只在「pid 确实已经不在了」时删——GUI 还活着时 /health 偶发失败不能把它的桥信息抹掉 */
function pruneStaleBridge(cfg) {
  if (!cfg || !cfg.pid) return
  try {
    process.kill(cfg.pid, 0)
    return // 进程还在：只是端口换了或暂时没应答，不动文件
  } catch {
    // pid 已退出，文件是墓碑
  }
  try {
    unlinkSync(bridgeFile)
    log(`已清掉残留 bridge.json（pid=${cfg.pid} 已退出）`)
  } catch {
    // 删不掉不阻塞：下面会拉起新实例覆盖写回
  }
}

function spawnHeadless() {
  // process.execPath 就是 electron.exe / 打包后的应用 exe；子进程要去掉 RUN_AS_NODE 才是完整 Electron
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const args = packaged ? [] : [appDir]
  args.push('--mcp', `--parent-pid=${process.pid}`)
  log(`拉起无头实例：${process.execPath} ${args.join(' ')}`)
  child = spawn(process.execPath, args, { env, stdio: 'ignore', detached: false })
  child.on('exit', (code) => log(`无头实例退出 code=${code}`))
}

let bridgePromise = null
function ensureBridge() {
  if (!bridgePromise) {
    bridgePromise = (async () => {
      let cfg = readBridge()
      if (await alive(cfg)) {
        log(`复用运行中的 bridge :${cfg.port}`)
        return cfg
      }
      pruneStaleBridge(cfg)
      const before = cfg ? cfg.started_at : null
      spawnHeadless()
      // 轮询 bridge.json 刷新 + 健康检查（首启含 Electron 初始化，宽限 30s）
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 300))
        cfg = readBridge()
        if (cfg && cfg.started_at !== before && (await alive(cfg))) {
          log(`bridge 就绪 :${cfg.port}`)
          return cfg
        }
      }
      throw new Error('bridge 30 秒内未就绪，请检查应用是否能正常启动')
    })()
    bridgePromise.catch(() => (bridgePromise = null)) // 失败允许重试
  }
  return bridgePromise
}

/** 带重试的 bridge 调用：连接类错误（实例被重启/替换）时重新发现一次 */
async function callBridge(method, path, body) {
  let cfg = await ensureBridge()
  try {
    return await httpJson(method, path, cfg, body)
  } catch (err) {
    const code = err && err.code
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') {
      log(`bridge 连接失效（${code}），重新发现…`)
      bridgePromise = null
      cfg = await ensureBridge()
      return httpJson(method, path, cfg, body)
    }
    throw err
  }
}

// ---- MCP JSON-RPC（stdio，换行分隔）----

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
const sendErr = (id, code, message) => send({ id, error: { code, message } })

async function handle(req) {
  const id = req.id === undefined ? null : req.id
  switch (req.method) {
    case 'initialize': {
      const cfg = readBridge()
      send({
        id,
        result: {
          protocolVersion: (req.params && req.params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {} },
          // 版本读 bridge.json（实例启动时写 app.getVersion()）：早先硬编码 0.3.0，
          // 宿主报出来的服务版本和实际装的版本从此没关系
          serverInfo: { name: 'LIG-Editor', version: (cfg && cfg.version) || 'unknown' }
        }
      })
      return
    }
    case 'ping':
      send({ id, result: {} })
      return
    case 'tools/list': {
      const r = await callBridge('GET', '/tools')
      if (!r.ok) throw new Error(r.error || 'bridge /tools 失败')
      send({ id, result: { tools: r.tools } })
      return
    }
    case 'tools/call': {
      const r = await callBridge('POST', '/tool', {
        name: req.params && req.params.name,
        arguments: (req.params && req.params.arguments) || {}
      })
      if (!r.ok) {
        send({ id, result: { content: [{ type: 'text', text: String(r.error) }], isError: true } })
        return
      }
      const res = r.result
      // 结果里带 image_base64（render_preview 一类）时拆成 image + text 两个内容块：
      // 只有 text 通道时宿主拿到的是几百 KB 的 base64 字符串而不是图，等于没法自查排版
      if (res && typeof res === 'object' && typeof res.image_base64 === 'string') {
        const mime = res.mime || 'image/png'
        const rest = { ...res }
        delete rest.image_base64
        delete rest.mime
        send({
          id,
          result: {
            content: [
              { type: 'image', data: res.image_base64, mimeType: mime },
              { type: 'text', text: JSON.stringify(rest, null, 2) }
            ],
            isError: false
          }
        })
        return
      }
      const text = typeof res === 'string' ? res : JSON.stringify(res, null, 2)
      send({ id, result: { content: [{ type: 'text', text }], isError: false } })
      return
    }
    case 'resources/list':
      send({ id, result: { resources: [] } })
      return
    case 'prompts/list':
      send({ id, result: { prompts: [] } })
      return
    default:
      if (req.id !== undefined && req.id !== null) sendErr(id, -32601, `method not found: ${req.method}`)
  }
}

/** 失败回包：工具调用按 MCP 约定回 isError 内容（模型才能读到错误文本并改路），其余走 JSON-RPC error */
function replyErr(req, err) {
  const id = req && req.id !== undefined ? req.id : null
  const message = String((err && err.message) || err)
  if (req && req.method === 'tools/call') {
    send({ id, result: { content: [{ type: 'text', text: message }], isError: true } })
  } else {
    sendErr(id, -32000, message)
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  const text = line.trim()
  if (!text) return
  let req
  try {
    req = JSON.parse(text)
  } catch {
    sendErr(null, -32700, 'parse error')
    return
  }
  if (Array.isArray(req)) {
    // 批量请求（JSON-RPC 数组）：逐条各自回包，一条失败不牵连其余
    Promise.all(req.map((one) => handle(one).catch((err) => replyErr(one, err))))
    return
  }
  handle(req).catch((err) => replyErr(req, err))
})

function shutdown() {
  if (child && !child.killed) child.kill()
  process.exit(0)
}
rl.on('close', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

log(`LIG-Editor MCP proxy ready (root=${root})`)
