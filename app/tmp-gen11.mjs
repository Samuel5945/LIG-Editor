import { readFileSync, writeFileSync } from 'fs'

const p = 'src/renderer/src/components/ChatPanel.tsx'
let s = readFileSync(p, 'utf8')
const steps = []

// 1) 模块级：加自动重探的时间戳
const s1old = `let nativeProvenKey = ''`
const s1new = `let nativeProvenKey = ''
// 上一次带原生 tools 试探的时刻：拒收后每隔一段时间自动再试一次（供应商可能后续支持）
let nativeProbeAt = 0`
if (s.includes(s1old)) { s = s.replace(s1old, s1new); steps.push('probeAt') }

// 2) 删掉界面状态
const s2old = `  // 工具通路：native=原生 tools / text=模型拒收原生参数，改走文本协议（工具照样能执行）
  // / none=拿不到工具清单。降级必须看得见，否则会表现为「模型有工具却没用」
  const [toolMode, setToolMode] = useState<'native' | 'text' | 'none'>('native')
`
if (s.includes(s2old)) { s = s.replace(s2old, ''); steps.push('state') }

// 3) catch 里不再 setState（静默重试已接管）
const s3old = `        if (/tool/i.test(msg)) {
          markNativeToolsRejected(modelKey)
          setToolMode(registry.length ? 'text' : 'none')
        }`
const s3new = `        if (/tool/i.test(msg)) markNativeToolsRejected(modelKey)`
if (s.includes(s3old)) { s = s.replace(s3old, s3new); steps.push('catch') }

// 4) 删掉手动重探回调
const i4 = s.indexOf('  /** 降级标记的重新试探')
const j4 = s.indexOf('}, [onToast])', i4)
if (i4 > 0 && j4 > i4) { s = s.slice(0, i4) + s.slice(j4 + '}, [onToast])'.length + 1); steps.push('reprobe') }

// 5) 删掉会话条上的标记按钮
const i5 = s.indexOf('        {toolMode !== ')
const j5 = s.indexOf('        )}', i5)
if (i5 > 0 && j5 > i5) { s = s.slice(0, i5) + s.slice(j5 + '        )}'.length + 1); steps.push('chip') }

// 6) 引入轮次结果类型（静默重试要用显式类型）
const s6old = `import { chatOnceWithTools } from '../copilot/llm'`
const s6new = `import { chatOnceWithTools, type ChatRoundResult } from '../copilot/llm'`
if (s.includes(s6old)) { s = s.replace(s6old, s6new); steps.push('type') }

writeFileSync(p, s)
console.log('完成:', steps.join(', '))
console.log('残留 toolMode 引用:', (s.match(/toolMode|setToolMode|reprobeTools/g) || []).length)
