/* 发 GitHub Release 的唯一入口：把「附件必须随创建一起上传」变成机器约束。
 *
 * 用法：
 *   node app/scripts/ship-release.mjs 0.9.1              预检通过后真发
 *   node app/scripts/ship-release.mjs 0.9.1 --dry-run    只跑预检并打印将要执行的命令
 *   node app/scripts/ship-release.mjs --verify 0.9.1     只核对已发出去的 release
 *
 * 为什么要写成脚本：GitHub 的 release 一经发布就是 immutable，事后 gh release upload 会 422
 * Cannot upload assets to an immutable release；为了补附件把 release 删掉，该 tag 名又被永久占用
 * （422 tag_name was used by an immutable release，v0.9.0 那次烧掉了裸 0.9.0）。
 * 也就是说「先建 release 再传安装包」这条路在协议层不存在，只能一条命令带齐——那就把它钉成一步。
 *
 * 顺序前提（docs/release.md 发版五步）：bump 版本 → npm run dist → 传网盘 → 本脚本 → 最后翻官网 update.json。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OWNER_REPO = 'Samuel5945/LIG-Editor'
const TITLE_PREFIX = '立格编辑器'
const MIN_EXE_BYTES = 50 * 1024 * 1024 // 安装包约 99MiB，明显小于这个数一定是拿错了产物

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const VERIFY_ONLY = argv.includes('--verify')
const VER = argv.find((a) => !a.startsWith('--'))

const fails = []
const notes = []
let LOCAL_ASSETS = []

const ok = (m) => console.log('  ✓ ' + m)
const bad = (m) => fails.push(m)
const say = (m) => notes.push(m)

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20, ...opts })
  return { code: r.status === null ? 1 : r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function exePath(kind, ver) {
  return path.join(REPO, 'releases', `LIG-Editor-${kind}-${ver}.exe`)
}

function localAssets(ver) {
  return ['setup', 'portable']
    .map((kind) => {
      const file = exePath(kind, ver)
      if (!fs.existsSync(file)) return null
      const size = fs.statSync(file).size
      return { kind, file, name: path.basename(file), size, digest: 'sha256:' + sha256(file) }
    })
    .filter(Boolean)
}

function releaseExists(tag) {
  const r = sh('gh', ['api', `repos/${OWNER_REPO}/releases/tags/${tag}`])
  if (r.code === 0) {
    try {
      return { state: 'exists', json: JSON.parse(r.out) }
    } catch {
      return { state: 'exists', json: null }
    }
  }
  const msg = (r.err || r.out || '').toLowerCase()
  if (msg.includes('not found')) return { state: 'absent' }
  return { state: 'error', msg: r.err || r.out }
}

function preflight() {
  console.log('预检 ' + (VER || '(缺版本号)') + (DRY ? '  [dry-run]' : ''))
  if (!/^\d+\.\d+\.\d+$/.test(VER || '')) {
    console.error('  ✗ 版本号要写成 x.y.z（不带 v 前缀），例如 0.9.1；tag 由脚本自动补 v')
    return null
  }
  const tag = 'v' + VER

  // 1) 版本必须先 bump 到 package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'app', 'package.json'), 'utf8'))
  if (pkg.version !== VER) bad(`app/package.json 的 version 是 ${pkg.version}，与要发的 ${VER} 不一致（先 bump 再发）`)
  else ok(`app/package.json version = ${pkg.version}`)

  // 2) 两个安装包都要在，且大小像真产物
  const assets = localAssets(VER)
  for (const a of assets) {
    if (a.size < MIN_EXE_BYTES) bad(`${a.kind} 安装包只有 ${a.size} 字节，不像 npm run dist 的产物`)
    else ok(`${a.kind} ${a.size.toLocaleString('en-US')} 字节`)
  }
  if (assets.length !== 2) bad('缺安装包：setup 与 portable 两个都得在 releases/ 里（先 cd app && npm run dist）')

  // 3) 正文：必须贴网盘链接（应用侧「发布完成」判定靠它），且别带内部备注
  const candidates = [
    path.join(REPO, 'releases', `RELEASE_BODY-${VER}.md`),
    path.join(REPO, 'releases', `RELEASE_NOTES-${VER}.md`)
  ]
  const body = candidates.find((p) => fs.existsSync(p))
  if (!body) bad(`找不到正文文件 releases/RELEASE_BODY-${VER}.md 或 RELEASE_NOTES-${VER}.md`)
  else {
    const text = fs.readFileSync(body, 'utf8')
    if (!/pan\.quark\.cn|pan\.baidu\.com/.test(text)) bad('正文没有夸克/百度网盘链接——缺了不会触发应用内更新提醒')
    else ok('正文含网盘链接')
    if (/发版物料/.test(text)) say('正文里还留着「发版物料」内部备注，公开前建议删掉（不阻断）')
    ok('正文 ' + path.basename(body))
  }

  // 4) tag 只能打在已推到远端 master 的提交上（v0.7.0 先建后推，tag 指到了旧提交）
  sh('git', ['fetch', '-q', 'origin', 'master'])
  const head = sh('git', ['rev-parse', 'HEAD']).out
  const remoteMaster = (sh('git', ['ls-remote', 'origin', 'refs/heads/master']).out.split(/\s+/)[0] || '')
  if (!remoteMaster) bad('读不到远端 master，先确认网络与 git/gh 凭证')
  else if (head !== remoteMaster && sh('git', ['merge-base', '--is-ancestor', head, remoteMaster]).code !== 0)
    bad(`本地 HEAD ${head.slice(0, 7)} 还没进远端 master ${remoteMaster.slice(0, 7)}：先 git push origin HEAD:master 再发`)
  else ok(`tag 将落在远端 master 顶端 ${remoteMaster.slice(0, 7)}`)

  // 5) tag 已存在则必须落在 master 顶端；已有 release 一律停手（删了就等于烧名字）
  const peeled = sh('git', ['ls-remote', 'origin', `refs/tags/${tag}^{}`]).out.split(/\s+/)[0] || ''
  const tagCommit = peeled || (sh('git', ['ls-remote', 'origin', `refs/tags/${tag}`]).out.split(/\s+/)[0] || '')
  if (tagCommit && remoteMaster && tagCommit !== remoteMaster)
    bad(`远端已有 ${tag} 且指向 ${tagCommit.slice(0, 7)}，不是 master 顶端；tag 名不能复用，请人工核对`)
  else if (tagCommit) ok(`沿用已存在的 ${tag}（落在 master 顶端）`)
  else say(`将新建 annotated tag ${tag} 于 ${remoteMaster ? remoteMaster.slice(0, 7) : 'master 顶端'} 并推送`)

  const rel = releaseExists(tag)
  if (rel.state === 'exists') {
    const j = rel.json || {}
    bad(`release ${tag} 已存在（id ${j.id}，assets ${(j.assets || []).length} 个）。本脚本不覆盖也不删除 release——删过一次，那个 tag 名就永久作废了`)
  } else if (rel.state === 'error') bad(`gh 查 release 失败：${rel.msg}`)
  else ok(`release ${tag} 尚不存在`)

  return { tag, assets, body, remoteMaster, tagCommit }
}

function report(tag) {
  const r = sh('gh', ['api', `repos/${OWNER_REPO}/releases/tags/${tag}`])
  if (r.code !== 0) {
    console.error('读不到 release ' + tag + '：' + (r.err || r.out))
    return false
  }
  const j = JSON.parse(r.out)
  const remote = j.assets || []
  console.log(`\n核对 ${j.tag_name}  ${j.html_url}`)
  let all = true
  for (const local of LOCAL_ASSETS) {
    const hit = remote.find((a) => a.name === local.name)
    if (!hit) {
      console.log(`  ✗ ${local.name} 在 release 上找不到`)
      all = false
      continue
    }
    const sizeOk = hit.size === local.size
    const digestOk = String(hit.digest || '').toLowerCase() === local.digest.toLowerCase()
    console.log(`  ${sizeOk && digestOk ? '✓' : '✗'} ${local.name}  size ${hit.size}${sizeOk ? '' : ' != ' + local.size}  ${digestOk ? 'sha256 一致' : 'sha256 不一致'}`)
    if (!sizeOk || !digestOk) all = false
  }
  const latest = sh('gh', ['api', `repos/${OWNER_REPO}/releases/latest`])
  if (latest.code === 0) {
    try {
      console.log('  latest 指向 ' + JSON.parse(latest.out).tag_name)
    } catch {}
  }
  return all
}

if (VERIFY_ONLY) {
  if (!/^\d+\.\d+\.\d+$/.test(VER || '')) {
    console.error('用法：node app/scripts/ship-release.mjs --verify 0.9.1')
    process.exit(2)
  }
  LOCAL_ASSETS = localAssets(VER)
  if (!LOCAL_ASSETS.length) {
    console.error(`releases/ 里没有 ${VER} 的安装包，无法比对`)
    process.exit(2)
  }
  process.exit(report('v' + VER) ? 0 : 1)
}

const ctx = preflight()
if (!ctx) {
  console.error('\n版本号不合法，未做任何改动。')
  process.exit(2)
}
for (const n of notes) console.log('  · ' + n)
if (fails.length) {
  console.error('\n预检未通过，未创建任何 tag / release：')
  for (const f of fails) console.error('  ✗ ' + f)
  console.error('\n这个脚本的存在理由就是不许「先建 release 再补附件」，所以它不会替你分两步走。')
  process.exit(1)
}

const cmdArgs = [
  'release',
  'create',
  ctx.tag,
  ...(ctx.tagCommit ? ['--verify-tag'] : []),
  '--title',
  `${TITLE_PREFIX} ${VER}`,
  '--notes-file',
  ctx.body,
  ...ctx.assets.map((a) => a.file)
]
console.log('\n将执行： gh ' + cmdArgs.join(' ').replaceAll(REPO + path.sep, '').replaceAll(REPO, ''))

if (DRY) {
  console.log('\ndry-run：什么都没发。')
  process.exit(0)
}

if (!ctx.tagCommit) {
  const t = sh('git', ['tag', '-a', ctx.tag, '-m', `${TITLE_PREFIX} ${VER}`, ctx.remoteMaster])
  if (t.code !== 0) {
    console.error('建 tag 失败：' + (t.err || t.out))
    process.exit(1)
  }
  const p = sh('git', ['push', '-q', 'origin', ctx.tag])
  if (p.code !== 0) {
    console.error('推 tag 失败：' + (p.err || p.out))
    process.exit(1)
  }
  console.log('  ✓ 已推送 ' + ctx.tag)
}

const created = sh('gh', cmdArgs, { stdio: 'inherit' })
if (created.code !== 0) {
  console.error('\ngh release create 失败（exit ' + created.code + '）。')
  console.error('若报 422 tag_name was used by an immutable release：这个 tag 名以前发过 release 又被删过，已永久作废，只能换写法，别试图复用。')
  process.exit(created.code || 1)
}

LOCAL_ASSETS = ctx.assets
const good = report(ctx.tag)
if (!good) {
  console.error('\n⚠️ release 已公开但附件与本地不一致，而它 immutable、补传不了：只能整条换 tag 名重发，并在 docs/release.md 记一笔。')
  process.exit(1)
}
console.log('\n✓ 附件与本地逐字一致。下一步：把 docs/site/lig-editor-update.json 同步到官网并 push main，应用内提醒才正式上线。')
