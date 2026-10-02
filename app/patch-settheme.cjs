const fs = require('fs')
const f = 'src/main/capabilityCore.ts'
const Q = "'"
const s = fs.readFileSync(f, 'utf8')
const EOL = s.includes('\r\n') ? '\r\n' : '\n'

const startAnchor = '      const { values: nums, notes } = clampThemeNumbers(a as Record<string, unknown>)'
const endAnchor = '      return reports.length ? { ok: true, hint: reports.join(' + Q + '；' + Q + '), ignoredKeys: unknown } : { ok: true }'
const i = s.indexOf(startAnchor)
const j = s.indexOf(endAnchor)
if (i < 0 || j < 0 || j <= i) throw new Error('锚点没找到：i=' + i + ' j=' + j)

const block = [
  '      // 数值越界的夹取说明照实报（作者要 1.4、口径下限 1.5，静默抬成 1.5 就是「设了没反应」）',
  '      const { notes } = clampThemeNumbers(bag)',
  '      // 写入一律过同一套校验：不合法的值不落脏盘、也不装成功。',
  '      // 实测过 set_theme 传 h2Border: 123 → 旧实现把 123 原样写进 meta 并返回 ok，作者看到的就是「设了没变化」',
  '      const { values: ok, unknown: unmapped, invalid } = sanitizeThemePatchDetailed(bag)',
  '      const bag2 = meta as unknown as Record<string, unknown>',
  '      for (const k of THEME_OVERRIDE_KEYS) {',
  '        if (!(k in bag) || bag[k] === undefined) continue',
  '        // null = 显式恢复默认；合法值用校验后的结果（夹取、去空格、枚举守卫）；非法值保持盘上原值不动',
  '        if (bag[k] === null) bag2[k] = undefined',
  '        else if (k in ok) bag2[k] = ok[k]',
  '      }',
  '      store.writeMeta(project, meta)',
  '      notifyChange(project, ' + Q + 'project.json' + Q + ')',
  "      const ignoredKeys = unmapped.filter((k) => k !== 'project' && k !== 'dir')",
  '      const droppedKeys = invalid.filter((k) => k in bag)',
  '      const reports = [...notes]',
  '      if (ignoredKeys.length) reports.push(`不认识的参数已忽略：${ignoredKeys.join(' + Q + '、' + Q + ')}（可用键见本工具说明）`)',
  '      if (droppedKeys.length)',
  '        reports.push(`以下字段值不合法，未写入：${droppedKeys.join(' + Q + '、' + Q + ')}（色值要 #rrggbb、数值不带单位、枚举取说明里的形态）`)',
  '      return reports.length ? { ok: true, hint: reports.join(' + Q + '；' + Q + '), ignoredKeys, droppedKeys } : { ok: true }'
].join(EOL)

fs.writeFileSync(f, s.slice(0, i) + block + s.slice(j + endAnchor.length), 'utf8')
console.log('set_theme 写入段已换成「校验后写入 + 如实回报」，替换长度', j + endAnchor.length - i, '→', block.length)
