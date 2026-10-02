const fs = require('fs')
const b = JSON.parse(fs.readFileSync('../settings/bridge.json', 'utf8'))
const ctFile = '../settings/customThemes.json'
const projFile = '../workspace/生活常识/test/project.json'
const snapCt = fs.readFileSync(ctFile, 'utf8')
const snapProj = fs.readFileSync(projFile, 'utf8')

async function call(name, args) {
  const r = await fetch(`http://127.0.0.1:${b.port}/tool`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + b.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args })
  })
  return (await r.json()).result
}

;(async () => {
  console.log('—— ① 模型那套自造键名，原样打给活实例 ——')
  const r1 = await call('save_theme_preset', {
    name: '探针·临时主题',
    theme: {
      accent: '#0a84ff',
      text_color: '#1f2933',
      font_family: 'PingFang SC, sans-serif',
      font_size: '16px',
      line_height: '1.85',
      paragraph_spacing: '1.4em',
      h2_color: '#0a84ff',
      quote_bg: '#f0f6ff'
    }
  })
  console.log('  返回:', JSON.stringify(r1).slice(0, 300))
  const saved = JSON.parse(fs.readFileSync(ctFile, 'utf8'))['探针·临时主题']
  console.log('  盘上主题:', JSON.stringify(saved))
  console.log('  口径检查（必须是 fontSize 而非 bodyFontSize）:', 'fontSize' in saved && !('bodyFontSize' in saved))

  console.log('—— ② 参数被包一层 theme:{} ——')
  const r2 = await call('set_theme', { project: 'test', theme: { lineHeight: 2.1 } })
  console.log('  返回:', JSON.stringify(r2))
  console.log('  盘上 meta.lineHeight:', JSON.parse(fs.readFileSync(projFile, 'utf8')).lineHeight)

  console.log('—— ③ 值不是数值（1.4em）——')
  const r3 = await call('set_theme', { project: 'test', pGap: '1.4em' })
  console.log('  返回:', JSON.stringify(r3))
  console.log('  盘上 meta.pGap:', JSON.parse(fs.readFileSync(projFile, 'utf8')).pGap)

  fs.writeFileSync(ctFile, snapCt, 'utf8')
  fs.writeFileSync(projFile, snapProj, 'utf8')
  console.log('已还原 customThemes.json 与 test/project.json')
})().catch((e) => {
  fs.writeFileSync(ctFile, snapCt, 'utf8')
  fs.writeFileSync(projFile, snapProj, 'utf8')
  console.error('失败，已还原:', e.message)
  process.exit(1)
})
