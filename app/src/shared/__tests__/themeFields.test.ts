import { describe, expect, it } from 'vitest'
import { THEME_FIELD_SPECS, THEME_GROUPS, themeFieldRange } from '../themeFields'
import { sanitizeThemePatch, THEME_NUM_RANGES, THEME_FIELD_LABELS, THEME_OVERRIDE_KEYS } from '../categoryThemes'

const keys = THEME_FIELD_SPECS.map((s) => s.key)

describe('THEME_FIELD_SPECS 与白名单同键同数', () => {
  it('34 个覆盖键逐个有 spec，既不重复也不漏（新增字段忘了配 spec 会在这条红）', () => {
    expect(keys.length).toBe(THEME_OVERRIDE_KEYS.length)
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual([...THEME_OVERRIDE_KEYS].sort())
  })

  it('每个字段都有中文名与分组，分组都在 THEME_GROUPS 里', () => {
    const groups = new Set(THEME_GROUPS.map((g) => g.id))
    for (const s of THEME_FIELD_SPECS) {
      expect(THEME_FIELD_LABELS[s.key], `${s.key} 缺中文名`).toBeTruthy()
      expect(groups.has(s.group), `${s.key} 分组未登记`).toBe(true)
    }
  })
})

describe('spec 与校验面一致（面板能选的，能力核必须真认）', () => {
  it('number 字段的限位都能从 THEME_NUM_RANGES 取到，且范围表里没有 spec 当不了 number 的键', () => {
    const numbers = THEME_FIELD_SPECS.filter((s) => s.kind === 'number').map((s) => s.key)
    for (const k of numbers) expect(themeFieldRange(k), `${k} 无范围`).toBeTruthy()
    expect(new Set(numbers).size).toBe(Object.keys(THEME_NUM_RANGES).length)
    for (const k of Object.keys(THEME_NUM_RANGES)) expect(numbers).toContain(k)
  })

  it('枚举候选逐个被 sanitize 原样接受，枚举外的值必被拒收（spec 与校验面不能有两套口径）', () => {
    const enums = THEME_FIELD_SPECS.filter((s) => s.kind === 'enum')
    expect(enums.length).toBe(10)
    for (const s of enums) {
      for (const o of s.options ?? []) {
        expect(sanitizeThemePatch({ [s.key]: o.value }), `${s.key}=${o.value}`).toEqual({ [s.key]: o.value })
      }
      if (s.sentinel)
        expect(sanitizeThemePatch({ [s.key]: s.sentinel.value }), `${s.key} 哨兵`).toEqual({ [s.key]: s.sentinel.value })
      expect(sanitizeThemePatch({ [s.key]: 'zzz-bogus' }), `${s.key} 竟接受了枚举外的值`).not.toHaveProperty(s.key)
    }
  })

  it('color 字段接受 #rgb/#rrggbb，拒收裸色名（面板取色器与校验同一口径）', () => {
    for (const s of THEME_FIELD_SPECS.filter((x) => x.kind === 'color')) {
      expect(sanitizeThemePatch({ [s.key]: '#0f766e' }), s.key).toHaveProperty(s.key)
      expect(sanitizeThemePatch({ [s.key]: 'red' }), s.key).not.toHaveProperty(s.key)
      expect(sanitizeThemePatch({ [s.key]: '#0f76' }), s.key).not.toHaveProperty(s.key)
    }
  })

  it('text 字段允许带单位字符串，空串拒收', () => {
    for (const s of THEME_FIELD_SPECS.filter((x) => x.kind === 'text')) {
      expect(sanitizeThemePatch({ [s.key]: '0.02em' }), s.key).toHaveProperty(s.key)
      expect(sanitizeThemePatch({ [s.key]: '   ' }), s.key).not.toHaveProperty(s.key)
    }
  })
})
