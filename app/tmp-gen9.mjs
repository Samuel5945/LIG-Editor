import { readFileSync, writeFileSync } from 'fs'

// 1) projectStore：按绝对路径匹配工程名
const p1 = 'src/main/projectStore.ts'
let s1 = readFileSync(p1, 'utf8')
s1 = s1.replace(
  "import { join, normalize, basename, extname } from 'path'",
  "import { join, normalize, resolve, basename, extname } from 'path'"
)
const byDir = `/** 按绝对路径找工程名：工具入参允许直接给 dir，绕开工程名标点在各模型手里走形的问题 */
export function matchProjectByDir(dir: string): string | null {
  const cut = (s: string): string => s.replace(/[\\\\/]+$/, '').toLowerCase()
  const want = cut(resolve(dir))
  const all = [...refreshDirCache().entries()]
  const exact = all.find(([, d]) => cut(d) === want)
  if (exact) return exact[0]
  // 允许只给尾段（<分类>/<工程>），唯一命中才算数
  const tail = cut(dir)
  const byTail = all.filter(([, d]) => cut(d).endsWith(tail))
  return byTail.length === 1 ? byTail[0][0] : null
}

`
const anchor1 = 'export function projectDir(name: string): string {'
if (!s1.includes(anchor1)) throw new Error('projectStore 锚点没找到')
s1 = s1.replace(anchor1, byDir + anchor1)
writeFileSync(p1, s1)

// 2) capabilityCore：projectArg 优先吃 dir；所有带 project 的工具自动多出 dir 入参
const p2 = 'src/main/capabilityCore.ts'
let s2 = readFileSync(p2, 'utf8')

const oldHead = `function projectArg(a: Record<string, unknown>): string {
  const raw = str(a, 'project')`
const newHead = `function projectArg(a: Record<string, unknown>): string {
  const dir = str(a, 'dir', false)
  if (dir) {
    const byDir = store.matchProjectByDir(dir)
    if (byDir) return byDir
    throw new Error(
      \`dir 没匹配到工程：\${dir}。请原样传 list_projects / create_project 返回的 dir，或改传 project 工程名\`
    )
  }
  const raw = str(a, 'project')`
if (!s2.includes(oldHead)) throw new Error('projectArg 锚点没找到')
s2 = s2.replace(oldHead, newHead)

s2 = s2.replace(
  `  project: { type: 'string', description: '工程名（workspace 下的目录名）' }`,
  `  project: { type: 'string', description: '工程名（workspace 下的目录名）；工程名含引号冒号等标点时可改传 dir' }`
)

const loop = `
/** 凡带 project 入参的工具一律自动多收 dir（工程绝对路径）：
 *  名字里的全角 “ ” ： 在不同模型手里会被写成半角或 「 」，而路径是稳定标识；
 *  加在这里而不是逐个工具改 schema，新增带 project 的工具自动继承 */
for (const t of TOOLS) {
  const props = t.inputSchema.properties as Record<string, unknown>
  if (props.project && !props.dir) {
    props.dir = {
      type: 'string',
      description: '工程绝对路径（list_projects / create_project 返回的 dir）；与 project 二选一，工程名带标点时优先用它'
    }
  }
}
`
const anchor2 = '/** 按名执行工具（MCP tools/call 与 HTTP bridge 共用入口） */'
if (!s2.includes(anchor2)) throw new Error('callTool 注释锚点没找到')
s2 = s2.replace(anchor2, loop + '\n' + anchor2)
writeFileSync(p2, s2)

console.log('projectStore:', s1.includes('matchProjectByDir'), '| capabilityCore:', s2.includes('props.dir'), '| dir 优先:', s2.includes("str(a, 'dir', false)"))
