import { readFileSync, writeFileSync } from 'fs'

const p = 'src/main/capabilityCore.ts'
let s = readFileSync(p, 'utf8')

// 先替换既有调用点，再插入 helper——顺序反了会把 helper 里的 str(a,'project') 也换掉，变成自我递归
const count = (s.match(/str\(a, 'project'\)/g) || []).length
s = s.split(`str(a, 'project')`).join('projectArg(a)')

const helper = `/** 工程名入参：先按标点归一匹配真实工程（模型常把全角 “” ： 写成半角或「」变体）。
 *  匹配不到就报候选名——早先会掉进 projectDir 的兜底路径，报出 ENOENT workspace/<猜名>/project.json，
 *  模型只能继续瞎猜（2026-09-29 实测：它把原因解释成「工具把特殊字符转成了方括号」，还让用户改名） */
function projectArg(a: Record<string, unknown>): string {
  const raw = str(a, 'project')
  const { hit, candidates } = store.matchProjectName(raw)
  if (hit) return hit
  const hint = candidates.length ? \`最接近的工程：\${candidates.join(' / ')}\` : '先用 list_projects 查准确名字'
  throw new Error(
    \`工程不存在：\${raw}。工程名必须原样使用 list_projects / create_project 返回的 name（全角标点不要换成半角或「」）。提示：\${hint}\`
  )
}

`

const anchor = `/** 工程挂载了风格 Skill 时读出全文（注入系统提示） */`
if (!s.includes(anchor)) throw new Error('没定位到 projectSkill 锚点')
s = s.replace(anchor, helper + anchor)
writeFileSync(p, s)
console.log('替换调用点:', count, '| helper 内保留 str:', s.includes("const raw = str(a, 'project')"))
