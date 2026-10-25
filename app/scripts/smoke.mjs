/* 打包产物无头冒烟：起 --mcp 实例 → 经 bridge 实打关键链路 → 汇总 → 清场。
 *
 * 用法：
 *   node app/scripts/smoke.mjs                 # 冒烟 releases/win-unpacked/（dist 的直出目录）
 *   node app/scripts/smoke.mjs --exe <exe路径>  # 冒烟任意 exe（如安装版装好后的）
 *   node app/scripts/smoke.mjs --dev           # 冒烟开发态（app/node_modules 的 electron 跑未打包代码）
 *
 * 为什么要脚本化：离屏渲染（配图/贴图卡/封面）、printToPDF、sharp 全在主进程运行期才见真章，
 * Electron 大版本升级（31→44 那次）全靠这套手工冒烟兜底。冒烟链路：
 *   /health + /tools      → 能力核起来了、工具面数量未塌方
 *   render_preview        → captureAtContentSize 离屏截图（正文渲染链路）
 *   render_cover_template → renderHtmlFixed 固定画布 + sharp 超采样裁剪（封面链路）
 *   export_pdf            → 隐藏窗 printToPDF（交稿链路）
 *   save_outline          → 反推大纲落 outline.md、正文逐字不动（新增读写面兜底）
 * 冒烟工程即建即删（create_project → … → delete_project confirm），不碰真实工程。
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(fileURLToPath(import.meta.url), '..', '..', '..')
const APP = join(REPO, 'app')
const argv = process.argv.slice(2)
const DEV = argv.includes('--dev')
const EXE = DEV
  ? join(APP, 'node_modules', 'electron', 'dist', 'electron.exe')
  : argv[argv.indexOf('--exe') + 1] || join(REPO, 'releases', 'win-unpacked', '立格编辑器.exe')

if (!existsSync(EXE)) {
  console.error('✗ 找不到待冒烟的 exe：' + EXE + '（先 npm run dist，或用 --exe / --dev 指定）')
  process.exit(1)
}

const SMOKE_PROJECT = 'smoke-冒烟临时工程-' + Date.now().toString(36)
const ARTICLE = '# 冒烟标题\n\n一段正文，验证离屏渲染链路。'
const results = []
const ok = (name, detail) => results.push(['✓', name, detail])
const bad = (name, detail) => results.push(['✗', name, detail])

/** bridge.json 位置：安装态在 文档\立格编辑器\settings\，开发态在仓库 settings\（两处都探，先就绪者胜） */
const bridgeCandidates = () => [
  join(homedir(), 'Documents', '立格编辑器', 'settings', 'bridge.json'),
  join(REPO, 'settings', 'bridge.json')
]

async function waitBridge(timeoutMs) {
  // 起冒烟实例前先清残留（指向已退出进程的旧文件会探到错端口）
  for (const f of bridgeCandidates()) if (existsSync(f)) rmSync(f)
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    for (const f of bridgeCandidates()) {
      if (!existsSync(f)) continue
      try {
        const cfg = JSON.parse(readFileSync(f, 'utf8'))
        const r = await fetch(`http://127.0.0.1:${cfg.port}/health`, {
          headers: { Authorization: 'Bearer ' + cfg.token }
        })
        if (r.ok) return cfg
      } catch {
        /* 未就绪，继续等 */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

async function call(cfg, name, args) {
  const r = await fetch(`http://127.0.0.1:${cfg.port}/tool`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ name, arguments: args })
  })
  return await r.json()
}

const child = spawn(EXE, DEV ? [APP, '--mcp'] : ['--mcp'], { stdio: 'ignore' })
let cfg = null

try {
  cfg = await waitBridge(20000)
  if (!cfg) throw new Error('20 秒内 bridge 未就绪（应用没起来，或 --mcp 分支挂了）')
  ok('无头启动 + /health', `pid ${cfg.pid}，版本 ${cfg.version}`)

  // 工具面：GET /tools 报数量；塌方（<45）说明注册表加载出了问题
  const tr = await fetch(`http://127.0.0.1:${cfg.port}/tools`, {
    headers: { Authorization: 'Bearer ' + cfg.token }
  })
  const toolCount = (await tr.json())?.tools?.length ?? 0
  toolCount >= 45
    ? ok('工具面注册', `${toolCount} 个工具`)
    : bad('工具面注册', `只有 ${toolCount} 个工具（预期 ≥45）`)

  let r = await call(cfg, 'create_project', { name: SMOKE_PROJECT })
  if (!r.ok) throw new Error('create_project 失败：' + r.error)
  r = await call(cfg, 'write_article', { project: SMOKE_PROJECT, content: ARTICLE })
  if (!r.ok) throw new Error('write_article 失败：' + r.error)

  // ① 正文离屏截图（captureAtContentSize：两轮量尺寸 + capturePage）
  r = await call(cfg, 'render_preview', { project: SMOKE_PROJECT, target: 'article' })
  r.ok && r.result?.image_base64?.length > 1000
    ? ok('render_preview 离屏截图', `${r.result.width}×${r.result.height}`)
    : bad('render_preview 离屏截图', JSON.stringify(r).slice(0, 120))

  // ② 封面管线（renderHtmlFixed 固定画布 + sharp 超采样出图与裁剪）；纯排版版式不烧生图额度
  r = await call(cfg, 'render_cover_template', {
    project: SMOKE_PROJECT,
    template: 'editorial',
    title: '冒烟标题',
    accent: '#b0803c',
    subtitle: '冒烟副题'
  })
  r.ok && r.result?.main
    ? ok('render_cover_template 封面', `${r.result.main} + ${r.result.square}（focal=${r.result.focal}）`)
    : bad('render_cover_template 封面', JSON.stringify(r).slice(0, 120))

  // ③ 交稿链路（隐藏窗 printToPDF）
  r = await call(cfg, 'export_pdf', { project: SMOKE_PROJECT })
  r.ok && r.result?.path
    ? ok('export_pdf 交稿', String(r.result.path).split('\\').pop())
    : bad('export_pdf 交稿', JSON.stringify(r).slice(0, 120))

  // ④ 反推大纲（save_outline 只写 outline.md；正文必须逐字未动）
  r = await call(cfg, 'save_outline', { project: SMOKE_PROJECT, outline: '# 冒烟标题\n## 第一节\n说明' })
  const back = r.ok ? await call(cfg, 'read_article', { project: SMOKE_PROJECT, file: 'outline.md' }) : { ok: false }
  const articleKept = (await call(cfg, 'read_article', { project: SMOKE_PROJECT })).result === ARTICLE
  r.ok && back.ok && articleKept
    ? ok('save_outline 反推大纲', 'outline.md 回读一致，正文未动')
    : bad('save_outline 反推大纲', '写入/回读/正文保全有一环失败')
} catch (err) {
  bad('冒烟中断', err instanceof Error ? err.message : String(err))
} finally {
  if (cfg) {
    try {
      await call(cfg, 'delete_project', { project: SMOKE_PROJECT, confirm: true })
    } catch {
      /* 删除失败不影响结论输出，目录名带时间戳可人工清理 */
    }
  }
  // 杀进程树（utility 子进程一起带走），再清残留 bridge.json
  if (child.pid) {
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
    } catch {
      child.kill()
    }
  }
  for (const f of bridgeCandidates()) if (existsSync(f)) rmSync(f)
}

let failed = 0
for (const [mark, name, detail] of results) {
  if (mark === '✗') failed++
  console.log(`  ${mark} ${name} — ${detail}`)
}
console.log(failed === 0 ? '冒烟通过：启动 / 工具面 / 离屏 / 封面 / PDF / 大纲全绿' : `冒烟失败：${failed} 项未过`)
process.exit(failed === 0 ? 0 : 1)
