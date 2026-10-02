const fs = require('fs')
const Q = "'"
function patch(file, jobs) {
  const raw = fs.readFileSync(file, 'utf8')
  const eol = raw.includes(Q + '\r\n') ? '\r\n' : '\n'
  const EOL = raw.includes('\r\n') ? '\r\n' : '\n'
  let s = raw
  const L = (...l) => l.join(EOL)
  for (const [label, from, to] of jobs) {
    const f = L(...from)
    const t = L(...to)
    const n = s.split(f).length - 1
    if (n !== 1) throw new Error(`${file} · ${label}: 命中 ${n} 次（要 1 次）→ ${f.slice(0, 70)}`)
    s = s.replace(f, t)
    console.log('  ok', label)
  }
  void eol
  fs.writeFileSync(file, s, 'utf8')
}

console.log('主进程 capabilityCore.ts')
patch('src/main/capabilityCore.ts', [
  ['projectArg 接受 name 别名',
    ["  const raw = str(a, " + Q + "project" + Q + ")"],
    ['  // 模型常把工程名写成 name（get_project / set_project_category 报「缺少参数 project」就是这么来的）：',
      '  // 只有没传 project 时才拿 name 顶上；name 作为业务字段的工具（save_theme_preset 等）不走这里，不受影响',
      "  const raw = str(a, " + Q + "project" + Q + ", false) || str(a, " + Q + "name" + Q + ", false)",
      "  if (!raw) throw new Error(" + Q + "缺少参数 project：需传工程名（workspace 下的目录名），也可传 dir（工程绝对路径）；可先用 list_projects 查询" + Q + ")"]],
  ['set_theme 引用色类属性',
    ["        quoteBorder: { type: [" + Q + "string" + Q + ", " + Q + "null" + Q + "], description: " + Q + "虚线引用卡边框色十六进制；null 跟随主题" + Q + " },"],
    ["        quoteBorder: { type: [" + Q + "string" + Q + ", " + Q + "null" + Q + "], description: " + Q + "虚线引用卡边框色十六进制；null 跟随主题" + Q + " },",
      "        quoteBg: { type: [" + Q + "string" + Q + ", " + Q + "null" + Q + "], description: " + Q + "引用区底色十六进制（不设=按强调色派生浅底）；null 跟随主题" + Q + " },",
      "        quoteText: { type: [" + Q + "string" + Q + ", " + Q + "null" + Q + "], description: " + Q + "引用文字色十六进制（不设=按背景亮度自适应）；null 跟随主题" + Q + " },",
      "        hrColor: { type: [" + Q + "string" + Q + ", " + Q + "null" + Q + "], description: " + Q + "分隔线颜色十六进制（不设=中性灰）；null 跟随主题" + Q + " },",
      "        h2Border: { type: [" + Q + "string" + Q + ", " + Q + "null" + Q + "], description: " + Q + "H2 左竖条/下划线颜色十六进制（不设=跟随强调色）；null 跟随主题" + Q + " },"]],
  ['set_theme HEX_KEYS 清单',
    ["        " + Q + "quoteBorder" + Q + ",", "        " + Q + "strongBg" + Q + ","],
    ["        " + Q + "quoteBorder" + Q + ",", "        " + Q + "quoteBg" + Q + ",", "        " + Q + "quoteText" + Q + ",", "        " + Q + "hrColor" + Q + ",", "        " + Q + "h2Border" + Q + ",", "        " + Q + "strongBg" + Q + ","]],
  ['set_theme 描述补新字段',
    ["传 null = 恢复默认（跟随分类主题）。数值字段越界会被夹到区间内"],
    ["引用底色 quoteBg / 引用文字色 quoteText / 分隔线颜色 hrColor / H2 条色 h2Border（均十六进制，不设则按强调色或中性灰派生）。传 null = 恢复默认（跟随分类主题）。数值字段越界会被夹到区间内"]],
  ['save_theme_preset 描述补新字段',
    ["quoteStyle·quoteBorder 引用 /"],
    ["quoteStyle·quoteBorder·quoteBg·quoteText 引用 / hrStyle·hrColor 分隔线 / h2Border H2 条色 /"]],
  ['save_theme_preset theme 键清单',
    ["tableStyle / tableHeaderBg / tableBorder / tableHeaderText / h2Bg。不要自造键名"],
    ["tableStyle / tableHeaderBg / tableBorder / tableHeaderText / h2Bg / quoteBg / quoteText / hrColor / h2Border。不要自造键名"]]
])

console.log('主进程 projectStore.ts')
patch('src/main/projectStore.ts', [
  ['readMeta 透传 +4',
    ["    quoteBorder: raw.quoteBorder,"],
    ["    quoteBorder: raw.quoteBorder,", "    quoteBg: raw.quoteBg,", "    quoteText: raw.quoteText,", "    hrColor: raw.hrColor,", "    h2Border: raw.h2Border,"]]
])
console.log('完成')
