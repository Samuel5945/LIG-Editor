import { readFileSync } from 'fs'
import { parseTextToolCalls } from './src/shared/llmText'

const j = JSON.parse(readFileSync('../settings/chat-temp/2026-09-29T04-38-35-425Z.json', 'utf8'))
const raw = j.messages[3].content
const r = parseTextToolCalls(raw)
console.log('calls:', r.calls.length, r.calls.map((c) => c.name))
console.log('cleaned:', JSON.stringify(r.cleaned.slice(0, 60)))
if (r.calls[0]) console.log('argsKeys:', Object.keys(JSON.parse(r.calls[0].arguments)))
