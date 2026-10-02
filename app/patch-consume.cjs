const fs = require('fs')

function patch(file, jobs) {
  const raw = fs.readFileSync(file, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let s = raw
  const L = (...l) => l.join(eol)
  for (const [label, from, to] of jobs) {
    const f = L(...from)
    const t = L(...to)
    const n = s.split(f).length - 1
    if (n !== 1) throw new Error(`${file} · ${label}: 命中 ${n} 次（要 1 次）→ ${f.slice(0, 70)}`)
    s = s.replace(f, t)
    console.log('  ok', label)
  }
  fs.writeFileSync(file, s, 'utf8')
}

const Q = "'" // 单引号占位，避免模板串插值

console.log('导出端 exportHtml.ts')
patch('src/shared/exportHtml.ts', [
  ['quoteColor',
    ["  const quoteColor = dark ? " + Q + "#cbd5e1" + Q + " : " + Q + "#333" + Q],
    ["  const quoteColor =", "    t.quoteText && isHexColor(t.quoteText) ? t.quoteText.trim() : dark ? " + Q + "#cbd5e1" + Q + " : " + Q + "#333" + Q]],
  ['quoteBg',
    ["  const quoteBg = dark ? " + Q + "rgba(255,255,255,0.07)" + Q + " : " + Q + "#f7f7f7" + Q],
    ["  const quoteBg =", "    t.quoteBg && isHexColor(t.quoteBg) ? t.quoteBg.trim() : dark ? " + Q + "rgba(255,255,255,0.07)" + Q + " : " + Q + "#f7f7f7" + Q]],
  ['quoteTint',
    ["  const quoteTint = tint(c, 0.1)"],
    ["  const quoteTint = t.quoteBg && isHexColor(t.quoteBg) ? t.quoteBg.trim() : tint(c, 0.1)"]],
  ['dashcard 底色常量',
    ["    const qBorder = t.quoteBorder && isHexColor(t.quoteBorder) ? t.quoteBorder.trim() : tint(c, 0.55)"],
    ["    const qBorder = t.quoteBorder && isHexColor(t.quoteBorder) ? t.quoteBorder.trim() : tint(c, 0.55)",
      '    // 虚线卡默认白底/微亮底，作者指定引用底色时以指定为准',
      '    const dashcardBg =',
      "      t.quoteBg && isHexColor(t.quoteBg) ? t.quoteBg.trim() : dark ? " + Q + "rgba(255,255,255,0.05)" + Q + " : " + Q + "#ffffff" + Q]],
  ['dashcard 引用底色',
    ["border-radius:12px;background:${dark ? " + Q + "rgba(255,255,255,0.05)" + Q + " : " + Q + "#ffffff" + Q + "};color"],
    ["border-radius:12px;background:${dashcardBg};color"]],
  ['h2Bar',
    ["  const h2Style = t.h2Style ?? " + Q + "leftbar" + Q],
    ['  // H2 条色（竖条/下划线）可独立指定，缺省跟随强调色',
      "  const h2Bar = t.h2Border && isHexColor(t.h2Border) ? t.h2Border.trim() : c",
      "  const h2Style = t.h2Style ?? " + Q + "leftbar" + Q]],
  ['h2 underline', ["16px;border-bottom:2px solid ${c};"], ["16px;border-bottom:2px solid ${h2Bar};"]],
  ['h2 leftbar', ["16px;border-left:4px solid ${c};padding-left:12px;"], ["16px;border-left:4px solid ${h2Bar};padding-left:12px;"]],
  ['hr long',
    ["s.hr = `margin:44px 0;border:0 none;border-top:1px solid ${dark ? " + Q + "rgba(255,255,255,0.15)" + Q + " : " + Q + "#e5e5e5" + Q + "};width:100%;`"],
    ["s.hr = `margin:44px 0;border:0 none;border-top:1px solid ${t.hrColor && isHexColor(t.hrColor) ? t.hrColor.trim() : dark ? " + Q + "rgba(255,255,255,0.15)" + Q + " : " + Q + "#e5e5e5" + Q + "};width:100%;`"]],
  ['hr dot', ["s.hr = `margin:40px auto;border:0 none;border-top:4px dotted ${c};width:72px;`"],
    ["s.hr = `margin:40px auto;border:0 none;border-top:4px dotted ${t.hrColor && isHexColor(t.hrColor) ? t.hrColor.trim() : c};width:72px;`"]],
  ['hr line',
    ["s.hr = `margin:40px auto;border:0 none;border-top:2px solid ${dark ? " + Q + "rgba(255,255,255,0.2)" + Q + " : " + Q + "#e8e8e8" + Q + "};width:64px;`"],
    ["s.hr = `margin:40px auto;border:0 none;border-top:2px solid ${t.hrColor && isHexColor(t.hrColor) ? t.hrColor.trim() : dark ? " + Q + "rgba(255,255,255,0.2)" + Q + " : " + Q + "#e8e8e8" + Q + "};width:64px;`"]]
])

console.log('编辑器 ArticleEditor.tsx')
const ED = '            '
const IN = '              '
patch('src/renderer/src/editor/ArticleEditor.tsx', [
  ['quote-color',
    [ED + "vars['--article-quote-color'] = c.darkBg ? " + Q + "#cbd5e1" + Q + " : " + Q + "#333" + Q],
    [ED + "vars['--article-quote-color'] =",
      IN + "t.quoteText && isHexColor(t.quoteText) ? t.quoteText.trim() : c.darkBg ? " + Q + "#cbd5e1" + Q + " : " + Q + "#333" + Q]],
  ['card quote-bg',
    [IN + "vars['--article-quote-bg'] = `color-mix(in srgb, ${accent} 12%, transparent)`"],
    [IN + "vars['--article-quote-bg'] = t.quoteBg && isHexColor(t.quoteBg) ? t.quoteBg.trim() : `color-mix(in srgb, ${accent} 12%, transparent)`"]],
  ['dashcard quote-bg',
    [IN + "vars['--article-quote-bg'] = " + Q + "transparent" + Q],
    [IN + "vars['--article-quote-bg'] = t.quoteBg && isHexColor(t.quoteBg) ? t.quoteBg.trim() : " + Q + "transparent" + Q]],
  ['leftbar/quotes quote-bg',
    [ED + "} else if (quote === " + Q + "quotes" + Q + ") {", IN + "vars['--article-quote-mark'] = " + Q + "\u275D" + Q, ED + "}"],
    [ED + "} else if (quote === " + Q + "quotes" + Q + ") {", IN + "vars['--article-quote-mark'] = " + Q + "\u275D" + Q, ED + "}",
      ED + '// leftbar / quotes 的浅底同样允许整体换成作者指定的引用底色',
      ED + "if ((quote === " + Q + "leftbar" + Q + " || quote === " + Q + "quotes" + Q + ") && t.quoteBg && isHexColor(t.quoteBg))",
      IN + "vars['--article-quote-bg'] = t.quoteBg.trim()"]],
  ['h2 underline 条色',
    [IN + "vars['--article-h2-border'] = `2px solid ${accent}`"],
    [IN + "vars['--article-h2-border'] = `2px solid ${t.h2Border && isHexColor(t.h2Border) ? t.h2Border.trim() : accent}`"]],
  ['h2 leftbar 条色',
    [ED + "} else if (h2 === " + Q + "plain" + Q + ") {", IN + "vars['--article-h2-left'] = " + Q + "none" + Q, IN + "vars['--article-h2-pl'] = " + Q + "0" + Q, ED + "}"],
    [ED + "} else if (h2 === " + Q + "plain" + Q + ") {", IN + "vars['--article-h2-left'] = " + Q + "none" + Q, IN + "vars['--article-h2-pl'] = " + Q + "0" + Q, ED + "}",
      ED + '// leftbar 的竖条走 CSS 默认（accent），只有显式指定条色时才写变量',
      ED + "if (h2 === " + Q + "leftbar" + Q + " && t.h2Border && isHexColor(t.h2Border))",
      IN + "vars['--article-h2-left'] = `4px solid ${t.h2Border.trim()}`"]],
  ['hr dot 色',
    [IN + "vars['--article-hr-border'] = `4px dotted ${accent}`"],
    [IN + "vars['--article-hr-border'] = `4px dotted ${t.hrColor && isHexColor(t.hrColor) ? t.hrColor.trim() : accent}`"]],
  ['hr line/long 色',
    [ED + "} else if (hr === " + Q + "long" + Q + ") {", IN + "vars['--article-hr-w'] = " + Q + "100%" + Q, ED + "}"],
    [ED + "} else if (hr === " + Q + "long" + Q + ") {", IN + "vars['--article-hr-w'] = " + Q + "100%" + Q, ED + "}",
      ED + "if (hr !== " + Q + "dot" + Q + " && t.hrColor && isHexColor(t.hrColor))",
      IN + "vars['--article-hr-border'] = `${hr === " + Q + "long" + Q + " ? 1 : 2}px solid ${t.hrColor.trim()}`"]]
])
console.log('完成')
