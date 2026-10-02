const fs = require('fs')
const Q = "'"
function rep(file, jobs) {
  let s = fs.readFileSync(file, 'utf8')
  const EOL = s.includes('\r\n') ? '\r\n' : '\n'
  const L = (...l) => l.join(EOL)
  for (const [label, from, to] of jobs) {
    const f = L(...from)
    const t = L(...to)
    const n = s.split(f).length - 1
    if (n !== 1) throw new Error(`${file} · ${label}: 命中 ${n} 次 → ${f.slice(0, 60)}`)
    s = s.replace(f, t)
    console.log('  ok', label)
  }
  fs.writeFileSync(file, s, 'utf8')
}

rep('src/shared/__tests__/categoryThemes.test.ts', [
  ['白名单用例标题', ["  it(" + Q + "白名单 30 键逐键可写（新增字段忘了登记或取值不合法，会在这条红）" + Q + ", () => {"],
   ["  it(" + Q + "白名单 34 键逐键可写（新增字段忘了登记或取值不合法，会在这条红）" + Q + ", () => {"]],
  ['validProbe 补四键', ["      quoteBorder: " + Q + "#444444" + Q + ",",],
   ["      quoteBorder: " + Q + "#444444" + Q + ",", "      quoteBg: " + Q + "#fdf2f8" + Q + ",", "      quoteText: " + Q + "#831843" + Q + ",", "      hrColor: " + Q + "#7c3aed" + Q + ",", "      h2Border: " + Q + "#0ea5e9" + Q + ",",]],
  ['合法覆盖补四字段', ["      quoteStyle: " + Q + "card" + Q + ",", "      quoteBorder: " + Q + "#14b8a6" + Q + ",",],
   ["      quoteStyle: " + Q + "card" + Q + ",", "      quoteBorder: " + Q + "#14b8a6" + Q + ",", "      quoteBg: " + Q + "#fdf2f8" + Q + ",", "      quoteText: " + Q + "#831843" + Q + ",", "      hrColor: " + Q + "#7c3aed" + Q + ",", "      h2Border: " + Q + "#0ea5e9" + Q + ",",]],
  ['合法覆盖断言', ["      quoteBorder: " + Q + "#14b8a6" + Q + ",", "      hrStyle: " + Q + "dot" + Q + ",",],
   ["      quoteBorder: " + Q + "#14b8a6" + Q + ",", "      quoteBg: " + Q + "#fdf2f8" + Q + ",", "      quoteText: " + Q + "#831843" + Q + ",", "      hrColor: " + Q + "#7c3aed" + Q + ",", "      h2Border: " + Q + "#0ea5e9" + Q + ",", "      hrStyle: " + Q + "dot" + Q + ",",]],
  ['visualBase 补四键', ["  quoteBorder: " + Q + "#333333" + Q + ",",],
   ["  quoteBorder: " + Q + "#333333" + Q + ",", "  quoteBg: " + Q + "#eeeeee" + Q + ",", "  quoteText: " + Q + "#444444" + Q + ",", "  hrColor: " + Q + "#555555" + Q + ",", "  h2Border: " + Q + "#666666" + Q + ",",]],
  ['非法回落断言', ["    expect(withBase({ tableStyle: " + Q + "gradient" + Q + " as ArticleTheme[" + Q + "tableStyle" + Q + "] }).tableStyle).toBe(" + Q + "plain" + Q + ")",],
   ["    expect(withBase({ tableStyle: " + Q + "gradient" + Q + " as ArticleTheme[" + Q + "tableStyle" + Q + "] }).tableStyle).toBe(" + Q + "plain" + Q + ")",
    "    expect(withBase({ quoteBg: " + Q + "pink" + Q + " }).quoteBg).toBe(" + Q + "#eeeeee" + Q + ")",
    "    expect(withBase({ quoteText: " + Q + "#12345" + Q + " }).quoteText).toBe(" + Q + "#444444" + Q + ")",
    "    expect(withBase({ hrColor: " + Q + "  " + Q + " }).hrColor).toBe(" + Q + "#555555" + Q + ")",
    "    expect(withBase({ h2Border: 123 as unknown as string }).h2Border).toBe(" + Q + "#666666" + Q + ")",]]
])

rep('src/main/__tests__/projectMetaVisualPassthrough.test.ts', [
  ['ALL_OVERRIDES 补四键', ["  quoteBorder: " + Q + "#444444" + Q + ","],
   ["  quoteBorder: " + Q + "#444444" + Q + ",", "  quoteBg: " + Q + "#fdf2f8" + Q + ",", "  quoteText: " + Q + "#831843" + Q + ",", "  hrColor: " + Q + "#7c3aed" + Q + ",", "  h2Border: " + Q + "#0ea5e9" + Q + ","]],
  ['键数断言', ["    expect(THEME_OVERRIDE_KEYS).toHaveLength(30)", "    expect(new Set(THEME_OVERRIDE_KEYS).size).toBe(30)"],
   ["    expect(THEME_OVERRIDE_KEYS).toHaveLength(34)", "    expect(new Set(THEME_OVERRIDE_KEYS).size).toBe(34)"]]
])
console.log('测试更新完成')
