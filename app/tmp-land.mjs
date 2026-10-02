// 一次性脚本：把 12:38 那条临时对话里模型写好却没落盘的正文，经 bridge 的 write_article 落进工程
import { readFileSync } from 'fs'

const session = JSON.parse(readFileSync('../settings/chat-temp/2026-09-29T04-38-35-425Z.json', 'utf8'))
const raw = session.messages[3].content

// 标签用拼接取，避免本文件里出现真标签
const keyOpen = '<' + 'parameter=content>'
const keyClose = '</' + 'parameter>'
const start = raw.indexOf(keyOpen)
const end = raw.lastIndexOf(keyClose)
if (start < 0 || end < start) throw new Error('会话里没找到正文块')
const content = raw.slice(start + keyOpen.length, end).trim() + '\n'

const bridge = JSON.parse(readFileSync('../settings/bridge.json', 'utf8'))
const res = await fetch(`http://127.0.0.1:${bridge.port}/tool`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'write_article', arguments: { project: '自媒体推广实操清单', content } })
})
console.log('write_article ->', JSON.stringify(await res.json()))
console.log('落盘字节数:', Buffer.byteLength(content), '行数:', content.split('\n').length)

const after = JSON.parse(
  await (
    await fetch(`http://127.0.0.1:${bridge.port}/tool`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'get_project', arguments: { project: '自媒体推广实操清单' } })
    })
  ).json()
).result
console.log('status:', after.meta.status, '| 正文头两行:', after.article.split('\n').slice(0, 3).join(' / '))
