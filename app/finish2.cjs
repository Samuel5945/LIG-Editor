const fs = require('fs')

const f = 'src/renderer/src/components/CardsPanel.tsx'
const raw = fs.readFileSync(f, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
const lines = raw.split(/\r?\n/)

// 只改 deleteCard 那个回调：用上一行的 useCallback 声明定位（文件里有两处 (i: number) => { ）
const decl = lines.findIndex((l) => l.includes('const deleteCard = useCallback('))
if (decl < 0) throw new Error('找不到 deleteCard 声明')
if (!lines[decl + 1].startsWith('    (i: number) => {'))
  throw new Error(`deleteCard 下一行不是预期签名：${lines[decl + 1]}`)
lines[decl + 1] = lines[decl + 1].replace('    (i: number) => {', '    async (i: number) => {')
fs.writeFileSync(f, lines.join(eol), 'utf8')
console.log('deleteCard → async')

const imports = {
  'src/renderer/src/App.tsx': "import { confirmAction } from './confirm'",
  'src/renderer/src/components/ChatPanel.tsx': "import { confirmAction } from '../confirm'",
  [f]: "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/IdeaLibrary.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/IntegrationDialog.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/Sidebar.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/wizard/CreationWizard.tsx': "import { confirmAction } from '../../confirm'"
}

for (const [file, want] of Object.entries(imports)) {
  const s = fs.readFileSync(file, 'utf8')
  if (/^import \{ confirmAction \}/m.test(s)) {
    console.log('已有 import，跳过', file)
    continue
  }
  const e = s.includes('\r\n') ? '\r\n' : '\n'
  const L = s.split(/\r?\n/)
  const at = L.findIndex((l) => /^import .* from 'react'$/.test(l))
  if (at < 0) throw new Error(`${file}: 找不到 react import 锚点`)
  L.splice(at + 1, 0, want)
  fs.writeFileSync(file, L.join(e), 'utf8')
  console.log('import →', file)
}
