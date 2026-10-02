const fs = require('fs')

/** CRLF 安全：逐行处理，不跨行匹配 */
function editLine(file, findLineStart, makeLine) {
  const raw = fs.readFileSync(file, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  let hits = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(findLineStart)) {
      lines[i] = makeLine(lines[i])
      hits++
    }
  }
  if (hits !== 1) throw new Error(`${file}: 锚点 ${findLineStart} 命中 ${hits} 次`)
  fs.writeFileSync(file, lines.join(eol), 'utf8')
  console.log('ok', file)
}

// deleteCard 的 useCallback 回调要 async 才能 await
editLine('src/renderer/src/components/CardsPanel.tsx', '    (i: number) => {', (l) =>
  l.replace('    (i: number) => {', '    async (i: number) => {')
)

const imports = {
  'src/renderer/src/App.tsx': "import { confirmAction } from './confirm'",
  'src/renderer/src/components/ChatPanel.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/CardsPanel.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/IdeaLibrary.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/IntegrationDialog.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/Sidebar.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/wizard/CreationWizard.tsx': "import { confirmAction } from '../../confirm'"
}

for (const [file, want] of Object.entries(imports)) {
  const raw = fs.readFileSync(file, 'utf8')
  if (raw.includes('confirmAction')) {
    console.log('已有 import，跳过', file)
    continue
  }
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  const at = lines.findIndex((l) => /^import .* from 'react'$/.test(l))
  if (at < 0) throw new Error(`${file}: 找不到 react import 锚点`)
  lines.splice(at + 1, 0, want)
  fs.writeFileSync(file, lines.join(eol), 'utf8')
  console.log('import →', file)
}
