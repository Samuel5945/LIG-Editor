const fs = require('fs')

/** [文件, 原句, 新句]（逐条唯一匹配，匹配不到就报错退出，绝不静默跳过） */
const edits = [
  [
    'src/renderer/src/components/ChatPanel.tsx',
    `if (!window.confirm('删除当前会话？删除后不可恢复')) return`,
    `if (!(await confirmAction('删除当前会话？\\n会话文件将被移除，不可恢复。', { okLabel: '删除' }))) return`
  ],
  [
    'src/renderer/src/App.tsx',
    'if (!window.confirm(`删除选中的 ${names.length} 个工程？\\n整个文件夹（正文/素材/会话）将被移除，不可恢复。`)) return',
    'if (!(await confirmAction(`删除选中的 ${names.length} 个工程？\\n整个文件夹（正文/素材/会话）将被移除，不可恢复。`, { okLabel: \'删除\' }))) return'
  ],
  [
    'src/renderer/src/App.tsx',
    'if (!window.confirm(`删除工程「${name}」？\\n整个文件夹（正文/素材/会话）将被移除，不可恢复。`)) return',
    'if (!(await confirmAction(`删除工程「${name}」？\\n整个文件夹（正文/素材/会话）将被移除，不可恢复。`, { okLabel: \'删除\' }))) return'
  ],
  [
    'src/renderer/src/components/CardsPanel.tsx',
    'if (!window.confirm(`删除第 ${i + 1} 张卡片？`)) return',
    'if (!(await confirmAction(`删除第 ${i + 1} 张卡片？\\n该张成图与文案会一并移除。`, { okLabel: \'删除\' }))) return'
  ],
  [
    'src/renderer/src/components/CardsPanel.tsx',
    "if (!window.confirm('将卡片文案扩写成公众号文章，并把工程切换为文章形态（正文会被覆盖，卡片数据保留可随时切回），继续？')) return",
    "if (!(await confirmAction('将卡片文案扩写成公众号文章？\\n工程会切换为文章形态，正文被覆盖（卡片数据保留，可随时切回）。', { okLabel: '继续' }))) return"
  ],
  [
    'src/renderer/src/components/IdeaLibrary.tsx',
    'if (!window.confirm(`删除选题「${entry.title}」？`)) return',
    'if (!(await confirmAction(`删除选题「${entry.title}」？`, { okLabel: \'删除\' }))) return'
  ],
  [
    'src/renderer/src/components/IntegrationDialog.tsx',
    'if (!window.confirm(`删除 Skill「${s.name}」？\\n整个目录将被移除，不可恢复。`)) return',
    'if (!(await confirmAction(`删除 Skill「${s.name}」？\\n整个目录将被移除，不可恢复。`, { okLabel: \'删除\' }))) return'
  ],
  [
    'src/renderer/src/components/Sidebar.tsx',
    'if (!window.confirm(`删除 Skill「${name}」？整个目录将被移除，不可恢复。`)) return',
    'if (!(await confirmAction(`删除 Skill「${name}」？\\n整个目录将被移除，不可恢复。`, { okLabel: \'删除\' }))) return'
  ],
  [
    'src/renderer/src/components/wizard/CreationWizard.tsx',
    'if (hasContent && !window.confirm(`「${project}」已有正文，生成将覆盖，确定继续？`)) return',
    'if (hasContent && !(await confirmAction(`「${project}」已有正文，生成将覆盖，确定继续？`, { okLabel: \'覆盖生成\' }))) return'
  ],
  // deleteCard 的 useCallback 不是 async，await 前必须改
  [
    'src/renderer/src/components/CardsPanel.tsx',
    '    (i: number) => {\n      const cards = deckRef.current?.cards ?? []',
    '    async (i: number) => {\n      const cards = deckRef.current?.cards ?? []'
  ]
]

/** 每个被改到的文件补一条 import（锚在 react 那行之后） */
const imports = {
  'src/renderer/src/App.tsx': "import { confirmAction } from './confirm'",
  'src/renderer/src/components/ChatPanel.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/CardsPanel.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/IdeaLibrary.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/IntegrationDialog.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/Sidebar.tsx': "import { confirmAction } from '../confirm'",
  'src/renderer/src/components/wizard/CreationWizard.tsx': "import { confirmAction } from '../../confirm'"
}

const touched = new Set()
for (const [file, from, to] of edits) {
  let s = fs.readFileSync(file, 'utf8')
  const n = s.split(from).length - 1
  if (n !== 1) throw new Error(`${file}: 匹配 ${n} 次（要求恰好 1 次）→ ${from.slice(0, 60)}`)
  s = s.replace(from, to)
  fs.writeFileSync(file, s, 'utf8')
  touched.add(file)
  console.log('ok', file, '←', from.slice(0, 46))
}

for (const file of touched) {
  const want = imports[file]
  if (!want) continue
  let s = fs.readFileSync(file, 'utf8')
  if (s.includes('confirmAction')) continue
  const m = /^import .* from 'react'\r?$/m.exec(s)
  if (!m) throw new Error(`${file}: 找不到 react import 锚点`)
  // 直接在锚点后插入一行
  const at = s.indexOf(m[0]) + m[0].length
  const eol = m[0].includes('\r') ? '\r\n' : '\n'
  s = s.slice(0, at) + eol + want + s.slice(at)
  fs.writeFileSync(file, s, 'utf8')
  console.log('import →', file)
}
