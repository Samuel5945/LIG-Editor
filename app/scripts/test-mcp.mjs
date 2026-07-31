// M8 冒烟测试：以 RUN_AS_NODE 跑 mcp-proxy.cjs，喂 initialize / tools/list / tools/call(list_projects)
// 代理会自动发现或拉起无头 bridge 实例；三个回包齐了即 PASS
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const electron = join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe')
const proxy = join(appDir, 'resources', 'mcp-proxy.cjs')

const child = spawn(electron, [proxy], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
child.stderr.on('data', (c) => process.stderr.write('[stderr] ' + c.toString('utf-8')))

const send = (o) => child.stdin.write(JSON.stringify(o) + '\n')
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_projects', arguments: {} } })

const seen = new Set()
let buf = ''
child.stdout.on('data', (c) => {
  buf += c.toString('utf-8')
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    seen.add(msg.id)
    if (msg.id === 2) {
      const names = msg.result.tools.map((t) => t.name)
      console.log(`id=2 tools/list → ${names.length} tools: ${names.join(', ')}`)
    } else {
      console.log(`id=${msg.id} → ${JSON.stringify(msg).slice(0, 260)}`)
    }
    if (seen.has(1) && seen.has(2) && seen.has(3)) finish(true)
  }
})

let done = false
function finish(pass) {
  if (done) return
  done = true
  console.log(pass ? 'MCP-SMOKE-PASS' : 'MCP-SMOKE-FAIL')
  child.stdin.end() // 代理收到 EOF 会顺带杀掉它拉起的无头实例
  setTimeout(() => {
    child.kill()
    process.exit(pass ? 0 : 1)
  }, 1200)
}
setTimeout(() => finish(false), 45000) // bridge 首启最多等 30s，整体兜底 45s
