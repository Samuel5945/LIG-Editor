/**
 * 主题资产合规校验（随包预装包 + 未分类兜底调性）。
 *
 * 为什么测：主题字段是「写错不报错」的——未知键被 sanitize 静默剔掉、越界值被夹取，
 * 表现是「盘上明明写了，排版却没变」。随包 daily.json 是纯 JSON 文件，没有 TypeScript
 * 帮忙挡枚举拼写，只能靠这条对账。
 *
 * 另钉两条口径：
 * 1. 未分类（新建工程不选分类就落它）已转正成设计过的调性，不再是裸 DEFAULT_THEME；
 * 2. 夜间只覆盖 bodyBg/bodyText/headingColor 三项（exportHtml buildStyles），
 *    引用底色/引用字色/表格边框/表头字色这几格写死浅值就会在深卡上留一块亮板，
 *    所以兜底调性必须留空走自适应（卡片引用退 tint(accent,.1)，边框深浅各自取色）。
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { CATEGORY_THEMES, DEFAULT_THEME, sanitizeThemePatchDetailed } from '../categoryThemes'
import type { ArticleTheme } from '@shared/types'

const themesDir = fileURLToPath(new URL('../../../resources/themes/', import.meta.url))

/** 不参与夜间变深的字段：兜底调性里必须留空 */
const NO_HARD_CODE = ['quoteBg', 'quoteText', 'tableBorder', 'tableHeaderText'] as const

const check = (theme: ArticleTheme): { unknown: string[]; invalid: string[]; coerced: string[]; kept: number } => {
  // origin 是主题库徽标字段，不属 40 项排版口径，先摘掉再对账
  const { origin, ...rest } = theme as ArticleTheme & { origin?: string }
  const r = sanitizeThemePatchDetailed(rest as unknown as Record<string, unknown>)
  return {
    unknown: r.unknown,
    invalid: r.invalid,
    coerced: r.coerced,
    kept: Object.keys(r.values).length + (origin ? 1 : 0)
  }
}

describe('随包预装主题包', () => {
  it('打包源目录存在且每套字段全过白名单', () => {
    expect(existsSync(themesDir), `找不到随包主题目录 ${themesDir}`).toBe(true)
    const files = readdirSync(themesDir).filter((n) => n.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    let total = 0
    for (const f of files) {
      const pack = JSON.parse(readFileSync(join(themesDir, f), 'utf8')) as {
        themes: Record<string, { category: string; theme: ArticleTheme }>
      }
      for (const [name, entry] of Object.entries(pack.themes)) {
        const r = check(entry.theme)
        expect(r.unknown, `${f} / ${name} 未知键`).toEqual([])
        expect(r.invalid, `${f} / ${name} 非法值`).toEqual([])
        expect(r.coerced, `${f} / ${name} 越界被夹取`).toEqual([])
        expect(r.kept, `${f} / ${name} 生效字段数（低于 20 说明写漏了）`).toBeGreaterThan(20)
        expect(entry.category, `${f} / ${name} 缺归属分类`).toBeTruthy()
        total++
      }
    }
    // 日报八套是随包资产的数量口径：少了就是打包源被动过
    expect(total).toBe(8)
  })
})

describe('未分类兜底调性', () => {
  const unc = CATEGORY_THEMES['未分类'] as ArticleTheme

  it('已转正：不再是裸 DEFAULT_THEME，且走最新双层表面口径', () => {
    expect(unc).not.toBe(DEFAULT_THEME)
    expect(unc.pageBg).toBeTruthy() // 纸底
    expect(unc.bodyBg).toBeTruthy() // 正文卡
    expect(unc.h1Style).toBe('banner') // 报头横幅
    expect(check(unc).kept).toBeGreaterThan(25)
  })

  it('字段全合法（枚举拼写、色值、数值区间）', () => {
    const r = check(unc)
    expect(r.unknown).toEqual([])
    expect(r.invalid).toEqual([])
    expect(r.coerced).toEqual([])
  })

  it('不参与夜间变深的字段一律留空，靠自适应取色', () => {
    for (const k of NO_HARD_CODE) {
      expect(unc[k as keyof ArticleTheme], `未分类调性不该写死 ${k}（夜间会是一块亮板）`).toBeUndefined()
    }
  })
})
