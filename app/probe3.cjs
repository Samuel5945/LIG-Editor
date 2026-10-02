const fs = require('fs')
const path = require('path')
const b = JSON.parse(fs.readFileSync('../settings/bridge.json', 'utf8'))
const meta = path.join('../workspace/生活常识/test/project.json')
const snap = fs.readFileSync(meta, 'utf8')
const call = async (name, args) => {
  const r = await fetch(`http://127.0.0.1:${b.port}/tool`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + b.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args })
  })
  return (await r.json()).result
}
const m = () => {
  const x = JSON.parse(fs.readFileSync(meta, 'utf8'))
  return { quoteBg: x.quoteBg, hrColor: x.hrColor, h2Border: x.h2Border, quoteStyle: x.quoteStyle, h2Num: x.h2Num, bodyBg: x.bodyBg, lineHeight: x.lineHeight, pGap: x.pGap }
}
;(async () => {
  console.log('① 四个新色值写入（校验后写入路径）', JSON.stringify(await call('set_theme', { name: 'test', quoteBg: '#fdf2f8', hrColor: '#7c3aed', h2Border: '#0ea5e9' })), JSON.stringify(m()))
  console.log('② none 哨兵仍生效', JSON.stringify(await call('set_theme', { project: 'test', h2Num: 'none', bodyBg: 'none' })), JSON.stringify(m()))
  console.log('③ 坏色值：报出来且不写脏盘', JSON.stringify(await call('set_theme', { project: 'test', h2Border: 123, quoteBg: { a: 1 } })))
  console.log('   盘上:', JSON.stringify(m()))
  console.log('④ 字符串数值救回', JSON.stringify(await call('set_theme', { project: 'test', lineHeight: '2.4', pGap: '28px' })), JSON.stringify(m()))
  console.log('⑤ 越界夹取仍带说明', JSON.stringify(await call('set_theme', { project: 'test', lineHeight: 9 })))
  console.log('⑥ 枚举外值：报出来、不动', JSON.stringify(await call('set_theme', { project: 'test', quoteStyle: 'bubble' })), '盘上 quoteStyle =', m().quoteStyle)
  console.log('⑦ null 显式清除', JSON.stringify(await call('set_theme', { project: 'test', quoteBg: null, hrColor: null, h2Border: null })), JSON.stringify(m()))
  fs.writeFileSync(meta, snap, 'utf8')
  console.log('已还原 test/project.json')
})().catch((e) => {
  fs.writeFileSync(meta, snap, 'utf8')
  console.error('失败，已还原:', e.message)
  process.exit(1)
})
