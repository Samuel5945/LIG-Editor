import { readFileSync, writeFileSync } from 'fs'

const p = 'src/shared/__tests__/chatTools.test.ts'
const s = readFileSync(p, 'utf8')
// 恢复被改坏的用例标题：第二个标签写法应为 < + function=x + >
const fnEq = '<' + 'function name="x">'
const fnShort = '<' + 'function=x>'
const bad = fnEq + ' 等价'
const good = fnShort + ' 等价'
const out = s.replace(bad, good)
writeFileSync(p, out)
console.log('replaced:', out !== s)
