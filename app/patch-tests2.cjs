const fs = require('fs')
const Q = "'"
function rep(file, jobs) {
  let s = fs.readFileSync(file, 'utf8')
  const EOL = s.includes('\r\n') ? '\r\n' : '\n'
  const L = (...l) => l.join(EOL)
  for (const [label, from, to, expect = 1] of jobs) {
    const f = L(...from)
    const t = L(...to)
    const n = s.split(f).length - 1
    if (n !== expect) throw new Error(`${file} · ${label}: 命中 ${n} 次（要 ${expect}）→ ${f.slice(0, 60)}`)
    s = s.split(f).join(t)
    console.log('  ok', label, '×' + n)
  }
  fs.writeFileSync(file, s, 'utf8')
}

const four = (ind) => [
  ind + "quoteBg: " + Q + "#fdf2f8" + Q + ",",
  ind + "quoteText: " + Q + "#831843" + Q + ",",
  ind + "hrColor: " + Q + "#7c3aed" + Q + ",",
  ind + "h2Border: " + Q + "#0ea5e9" + Q + ","
]

rep('src/shared/__tests__/categoryThemes.test.ts', [
  ['白名单用例标题', ["  it(" + Q + "白名单 30 键逐键可写（新增字段忘了登记或取值不合法，会在这条红）" + Q + ", () => {"],
   ["  it(" + Q + "白名单 34 键逐键可写（新增字段忘了登记或取值不合法，会在这条红）" + Q + ", () => {"]],
  // 入参对象与 toMatchObject 断言两处同形，一起补
  ['合法覆盖（入参+断言两处）', ["      quoteStyle: " + Q + "card" + Q + ",", "      quoteBorder: " + Q + "#14b8a6" + Q + ","],
   ["      quoteStyle: " + Q + "card" + Q + ",", "      quoteBorder: " + Q + "#14b8a6" + Q + ",", ...four('      ')], 2],
  ['validProbe 补四键', ["      quoteBorder: " + Q + "#444444" + Q + ",",],
   ["      quoteBorder: " + Q + "#444444" + Q + ",", ...four('      ')]],
  ['visualBase 补四键', ["  quoteBorder: " + Q + "#333333" + Q + ",",],
   ["  quoteBorder: " + Q + "#333333" + Q + ",", "  quoteBg: " + Q + "#eeeeee" + Q + ",", "  quoteText: " + Q + "#444444" + Q + ",", "  hrColor: " + Q + "#555555" + Q + ",", "  h2Border: " + Q + "#666666" + Q + ",",]],
  ['非法回落断言', ["    expect(withBase({ tableStyle: " + Q + "gradient" + Q + " as ArticleTheme[" + Q + "tableStyle" + Q + "] }).tableStyle).toBe(" + Q + "plain" + Q + ")",],
   ["    expect(withBase({ tableStyle: " + Q + "gradient" + Q + " as ArticleTheme[" + Q + "tableStyle" + Q + "] }).tableStyle).toBe(" + Q + "plain" + Q + ")",
    "    expect(withBase({ quoteBg: " + Q + "pink" + Q + " }).quoteBg).toBe(" + Q + "#eeeeee" + Q + ")",
    "    expect(withBase({ quoteText: " + Q + "#12345" + Q + " }).quoteText).toBe(" + Q + "#444444" + Q + ")",
    "    expect(withBase({ hrColor: " + Q + "  " + Q + " }).hrColor).toBe(" + Q + "#555555" + Q + ")",
    "    expect(withBase({ h2Border: 123 as unknown as string }).h2Border).toBe(" + Q + "#666666" + Q + ")",]],
  // 新增别名带来的期望变化：quote_bg / quote_text_color 现在能被认出来了
  ['自造键名用例期望', ["    expect(r.unknown).toEqual([" + Q + "quote_bg" + Q + ", " + Q + "divider_gradient" + Q + "])"],
   ["    // quote_bg / quote_text_color 已有对应字段；divider_gradient 这种「产品里没有的形态」必须报出来",
    "    expect(r.unknown).toEqual([" + Q + "divider_gradient" + Q + "])"]],
  // 输入里已有 quote_bg，现在能映射出来 → 期望对象补上 quoteBg
  ['自造键名用例 patch 期望', ["      headingColor: " + Q + "#0a84ff" + Q + "", "    })"],
   ["      headingColor: " + Q + "#0a84ff" + Q + ",", "      quoteBg: " + Q + "#f0f6ff" + Q + "", "    })"]]
])

rep('src/main/__tests__/projectMetaVisualPassthrough.test.ts', [
  ['ALL_OVERRIDES 补四键', ["  quoteBorder: " + Q + "#444444" + Q + ","], ["  quoteBorder: " + Q + "#444444" + Q + ",", ...four('  ')]],
  ['键数断言', ["    expect(THEME_OVERRIDE_KEYS).toHaveLength(30)", "    expect(new Set(THEME_OVERRIDE_KEYS).size).toBe(30)"],
   ["    expect(THEME_OVERRIDE_KEYS).toHaveLength(34)", "    expect(new Set(THEME_OVERRIDE_KEYS).size).toBe(34)"]]
])

rep('src/shared/__tests__/exportHtml.test.ts', [
  ['hr 断言修正（dot 是 dotted 不是 solid）',
   ["      expect(html, hrStyle).toContain(" + Q + "solid #7c3aed" + Q + ")",
    "      if (hrStyle === " + Q + "dot" + Q + ") expect(html, hrStyle).toContain(" + Q + "dotted #7c3aed" + Q + ")"],
   ["      expect(html, hrStyle).toContain(" + Q + "#7c3aed" + Q + ")",
    "      expect(html, hrStyle).toContain(hrStyle === " + Q + "dot" + Q + " ? " + Q + "dotted #7c3aed" + Q + " : " + Q + "solid #7c3aed" + Q + ")"]]
])
console.log('测试更新完成')
