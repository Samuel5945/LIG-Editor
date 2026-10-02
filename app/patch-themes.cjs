const fs = require('fs')
const f = 'src/shared/categoryThemes.ts'
const raw = fs.readFileSync(f, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
let s = raw

function rep(from, to, label) {
  const n = s.split(from).length - 1
  if (n !== 1) throw new Error(`${label}: 命中 ${n} 次（要 1 次）→ ${from.slice(0, 50)}`)
  s = s.replace(from, to)
  console.log('ok', label)
}
const L = (...lines) => lines.join(eol)

// 1) 白名单 +4（34 键）
rep(
  L("  'quoteBorder',"),
  L("  'quoteBorder',", "  'quoteBg',", "  'quoteText',", "  'hrColor',", "  'h2Border',"),
  'THEME_OVERRIDE_KEYS'
)
// 2) 中文名 +4
rep(
  L("  quoteBorder: '引用描边色',"),
  L("  quoteBorder: '引用描边色',", "  quoteBg: '引用底色',", "  quoteText: '引用文字色',", "  hrColor: '分隔线颜色',", "  h2Border: '二级标题条色',"),
  'THEME_FIELD_LABELS'
)
// 3) 别名：把模型实际写过的这几个补进映射
rep(
  L("  quote_border_color: 'quoteBorder',"),
  L(
    "  quote_border_color: 'quoteBorder',",
    "  quote_bg: 'quoteBg',",
    "  quote_background: 'quoteBg',",
    "  quote_color: 'quoteText',",
    "  quote_text_color: 'quoteText',",
    "  quote_text: 'quoteText',",
    "  divider_color: 'hrColor',",
    "  hr_color: 'hrColor',",
    "  h2_border_color: 'h2Border',",
    "  h2_accent_color: 'h2Border',"
  ),
  'THEME_KEY_ALIASES'
)
// 4) 校验面：四个色值走 hex
rep(L("  hex('quoteBorder')"), L("  hex('quoteBorder')", "  hex('quoteBg')", "  hex('quoteText')", "  hex('hrColor')", "  hex('h2Border')"), 'sanitize hex 列表')
// 5) resolve 的 Pick 白名单
rep(
  L("    | 'quoteBorder'"),
  L("    | 'quoteBorder'", "    | 'quoteBg'", "    | 'quoteText'", "    | 'hrColor'", "    | 'h2Border'"),
  'resolve Pick'
)
// 6) resolve 合并：未覆盖=沿用主题原值（消费端再按 accent/昼夜派生）
rep(
  L('  const quoteBorder = meta?.quoteBorder && isHexColor(meta.quoteBorder) ? meta.quoteBorder.trim() : base.quoteBorder'),
  L(
    '  const quoteBorder = meta?.quoteBorder && isHexColor(meta.quoteBorder) ? meta.quoteBorder.trim() : base.quoteBorder',
    '  const quoteBg = meta?.quoteBg && isHexColor(meta.quoteBg) ? meta.quoteBg.trim() : base.quoteBg',
    '  const quoteText = meta?.quoteText && isHexColor(meta.quoteText) ? meta.quoteText.trim() : base.quoteText',
    '  const hrColor = meta?.hrColor && isHexColor(meta.hrColor) ? meta.hrColor.trim() : base.hrColor',
    '  const h2Border = meta?.h2Border && isHexColor(meta.h2Border) ? meta.h2Border.trim() : base.h2Border'
  ),
  'resolve 合并'
)
// 7) 汇入 overrides 出口
rep(
  L('    fontFamily, lineHeight, letterSpacing, pGap, bodyText, headingColor, quoteStyle, quoteBorder,'),
  L(
    '    fontFamily, lineHeight, letterSpacing, pGap, bodyText, headingColor, quoteStyle, quoteBorder,',
    '    quoteBg, quoteText, hrColor, h2Border,'
  ),
  'overrides 出口'
)

fs.writeFileSync(f, s, 'utf8')
console.log('完成')
