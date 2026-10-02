const fs = require('fs')
const path = require('path')
const b = JSON.parse(fs.readFileSync('../settings/bridge.json', 'utf8'))
const projDir = '../workspace/生活常识/test'
const meta = path.join(projDir, 'project.json')
const ctFile = '../settings/customThemes.json'
const snapMeta = fs.readFileSync(meta, 'utf8')
const snapCt = fs.readFileSync(ctFile, 'utf8')
const before = fs.existsSync(path.join(projDir, '交付')) ? fs.readdirSync(path.join(projDir, '交付')) : []

async function call(name, args) {
  const r = await fetch(`http://127.0.0.1:${b.port}/tool`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + b.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args })
  })
  return await r.json()
}

;(async () => {
  const m = () => JSON.parse(fs.readFileSync(meta, 'utf8'))
  console.log('① set_theme 四个新字段')
  console.log('  ', JSON.stringify(await call('set_theme', { project: 'test', quoteBg: '#fdf2f8', quoteText: '#831843', hrColor: '#7c3aed', h2Border: '#0ea5e9' })))
  console.log('   盘上:', JSON.stringify({ quoteBg: m().quoteBg, quoteText: m().quoteText, hrColor: m().hrColor, h2Border: m().h2Border }))

  console.log('② get_project 只传 name（project↔name 别名）')
  const g = await call('get_project', { name: 'test' })
  console.log('  ', g.ok ? 'ok，meta.name=' + g.result.meta.name : '仍失败: ' + g.error)

  console.log('③ save_theme_preset 用模型那套自造键（含 quote_bg / divider_color / h2_border_color）')
  const s3 = await call('save_theme_preset', {
    name: '探针·补全验证',
    theme: { accent: '#0a84ff', text_color: '#1f2933', font_family: 'PingFang SC', font_size: '16px', line_height: '1.85', quote_bg: '#f0f6ff', quote_text_color: '#0a84ff', divider_color: '#e5e7eb', h2_border_color: '#0a84ff', hover_shadow: '0 4px 12px rgba(0,0,0,.2)' }
  })
  console.log('  ', JSON.stringify(s3.result || s3.error).slice(0, 320))

  console.log('④ 崩溃回归：色值写成数字/对象')
  const s4 = await call('set_theme', { project: 'test', h2Border: 123, quoteBg: { a: 1 } })
  console.log('  ', JSON.stringify(s4.result || s4.error))
  console.log('   盘上未写脏值:', JSON.stringify({ h2Border: m().h2Border, quoteBg: m().quoteBg }))

  console.log('⑤ 导出 HTML 检查内联样式真的用上了这四个色')
  const ex = await call('export_html', { project: 'test' })
  const after = fs.existsSync(path.join(projDir, '交付')) ? fs.readdirSync(path.join(projDir, '交付')) : []
  const created = after.filter((f) => !before.includes(f))
  let found = []
  for (const f of created) {
    const html = fs.readFileSync(path.join(projDir, '交付', f), 'utf8')
    found = ['#fdf2f8', '#831843', '#7c3aed', '#0ea5e9'].filter((c) => html.includes(c))
    console.log('   新导出文件:', f, '| 命中色值:', found.join(' '))
    fs.rmSync(path.join(projDir, '交付', f))
  }
  if (!created.length) console.log('   （没有新增导出文件:', JSON.stringify(ex).slice(0, 120), ')')

  fs.writeFileSync(meta, snapMeta, 'utf8')
  fs.writeFileSync(ctFile, snapCt, 'utf8')
  console.log('已还原 test/project.json、customThemes.json，并删掉探针导出文件')
})().catch((e) => {
  fs.writeFileSync(meta, snapMeta, 'utf8')
  fs.writeFileSync(ctFile, snapCt, 'utf8')
  console.error('失败，已还原:', e.message)
  process.exit(1)
})
