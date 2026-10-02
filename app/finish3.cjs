const fs = require('fs')

const imports = {
  'src/renderer/src/components/CardsPanel.tsx': "import { confirmAction } from '../confirm'",
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
  // react import 可能是多行解构，锚在「以 from 'react' 结尾」的那一行
  const at = L.findIndex((l) => /from 'react'$/.test(l))
  if (at < 0) throw new Error(`${file}: 找不到 react import 结尾行`)
  L.splice(at + 1, 0, want)
  fs.writeFileSync(file, L.join(e), 'utf8')
  console.log('import →', file)
}
