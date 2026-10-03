import { describe, expect, it } from 'vitest'
import {
  clampThemeNumbers,
  coerceHexColor,
  metaPatchToThemeKeys,
  migrateCustomThemes,
  normalizeThemeKeys,
  resolveArticleTheme,
  sanitizeThemePatch,
  sanitizeThemePatchDetailed,
  activeThemesView,
  THEME_NUM_RANGES,
  THEME_OVERRIDE_KEYS,
  DEFAULT_THEME
} from '../categoryThemes'
import type { ArticleTheme } from '../types'

/** 带独立标题色/加粗色的自定义主题（模拟导入排版产物） */
const customTheme: ArticleTheme = {
  ...DEFAULT_THEME,
  accent: '#35b378',
  headingColor: '#2bae85',
  strongColor: '#35b378',
  bodyText: '#595959',
  h2Bg: '#000000'
}

describe('resolveArticleTheme（强调色联动）', () => {
  it('未手动选强调色 → 主题原色不动', () => {
    const t = resolveArticleTheme({ category: '导入排版', accent: undefined }, { '导入排版': customTheme })
    expect(t.accent).toBe('#35b378')
    expect(t.headingColor).toBe('#2bae85')
    expect(t.strongColor).toBe('#35b378')
    expect(t.bodyText).toBe('#595959')
    expect(t.h2Bg).toBe('#000000')
  })

  it('手动选强调色 → 标题色/加粗色联动，正文与块背景保持', () => {
    const t = resolveArticleTheme({ category: '导入排版', accent: '#e63946' }, { '导入排版': customTheme })
    expect(t.accent).toBe('#e63946')
    expect(t.headingColor).toBe('#e63946') // 标题跟随新强调色
    expect(t.strongColor).toBe('#e63946') // 加粗跟随新强调色
    expect(t.bodyText).toBe('#595959') // 正文阅读色不变
    expect(t.h2Bg).toBe('#000000') // 黑块形态不变
  })

  it('恢复默认（accent 置空）→ 回到主题原色', () => {
    const t = resolveArticleTheme({ category: '导入排版', accent: undefined }, { '导入排版': customTheme })
    expect(t.accent).toBe('#35b378')
    expect(t.headingColor).toBe('#2bae85')
    expect(t.strongColor).toBe('#35b378')
  })

  it('带独立标题色的预设分类：选强调色后标题色同样联动', () => {
    const t = resolveArticleTheme({ category: '科技数码', accent: '#ff6b35' })
    expect(t.accent).toBe('#ff6b35')
    expect(t.headingColor).toBe('#ff6b35') // 分类主题的独立标题色也跟随
  })

  it('meta 排版覆盖：正文字号/标题字号/正文排列/标题排列', () => {
    const t = resolveArticleTheme({
      category: '科技数码',
      bodyFontSize: 18,
      headingFontSize: 24,
      bodyAlign: 'indent',
      headingAlign: 'left'
    })
    expect(t.fontSize).toBe(18)
    expect(t.headingFontSize).toBe(24)
    expect(t.bodyAlign).toBe('indent')
    expect(t.headingAlign).toBe('left')
  })

  it('meta 未覆盖时跟随主题默认（不覆盖也不丢失）', () => {
    const t = resolveArticleTheme({ category: '科技数码' })
    expect(t.fontSize).toBe(16) // 主题无 fontSize → 回退 DEFAULT_THEME
    expect(t.headingFontSize).toBe(20)
    expect(t.bodyAlign).toBeUndefined() // 默认无排列设置
    expect(t.headingAlign).toBe('left') // 科技数码主题自带左对齐
  })
})

describe('resolveArticleTheme（标题版式覆盖）', () => {
  /** 带序号的自定义主题（模拟导入排版产物） */
  const numberedTheme: ArticleTheme = {
    ...DEFAULT_THEME,
    h1Style: 'pill',
    h2Style: 'block',
    h2Num: '01',
    h3Mark: 'dot'
  }

  it('meta 未覆盖 → 标题版式四项跟随主题', () => {
    const t = resolveArticleTheme({ category: '导入排版' }, { '导入排版': numberedTheme })
    expect(t.h1Style).toBe('pill')
    expect(t.h2Style).toBe('block')
    expect(t.h2Num).toBe('01')
    expect(t.h3Mark).toBe('dot')
  })

  it('meta 显式覆盖 → 覆盖主题版式', () => {
    const t = resolveArticleTheme(
      { category: '导入排版', h1Style: 'underline', h2Style: 'plain', h2Num: '①', h3Mark: 'none' },
      { '导入排版': numberedTheme }
    )
    expect(t.h1Style).toBe('underline')
    expect(t.h2Style).toBe('plain')
    expect(t.h2Num).toBe('①')
    expect(t.h3Mark).toBe('none')
  })

  it('h2Num 覆盖 none 哨兵 → 关掉主题自带序号（区别于未覆盖的跟随）', () => {
    const off = resolveArticleTheme({ category: '导入排版', h2Num: 'none' }, { '导入排版': numberedTheme })
    expect(off.h2Num).toBeUndefined()
    // 未覆盖时序号仍在
    const keep = resolveArticleTheme({ category: '导入排版' }, { '导入排版': numberedTheme })
    expect(keep.h2Num).toBe('01')
  })

  it('预设分类主题自带版式 → 原样保留（不被覆盖清掉）', () => {
    const t = resolveArticleTheme({ category: '科技数码' })
    expect(t.h1Style).toBeDefined()
    expect(t.h2Style).toBeDefined()
    expect(t.h3Mark).toBeDefined()
  })

  it('主题无版式字段（经典默认）→ 保持 undefined，由渲染层按缺省经典样式回退', () => {
    const t = resolveArticleTheme({ category: '科技数码' }, { 科技数码: DEFAULT_THEME })
    expect(t.h1Style).toBeUndefined()
    expect(t.h2Style).toBeUndefined()
    expect(t.h2Num).toBeUndefined()
    expect(t.h3Mark).toBeUndefined()
  })
})

describe('resolveArticleTheme（背景卡覆盖）', () => {
  it('meta 未覆盖 → 背景卡跟随主题', () => {
    const t = resolveArticleTheme({ category: '生活常识' })
    expect(t.bodyBg).toBe('#fffaf2')
    const plain = resolveArticleTheme({ category: '情感回忆' })
    expect(plain.bodyBg).toBeUndefined() // 情感回忆主题无卡片
  })

  it('meta hex 覆盖 → 背景卡换色；非法色值回落主题', () => {
    const t = resolveArticleTheme({ category: '生活常识', bodyBg: '#f0fdf4' })
    expect(t.bodyBg).toBe('#f0fdf4')
    const bad = resolveArticleTheme({ category: '生活常识', bodyBg: 'not-a-color' })
    expect(bad.bodyBg).toBe('#fffaf2')
  })

  it("meta bodyBg 'none' 哨兵 → 显式去卡片（区别于未覆盖的跟随）", () => {
    const off = resolveArticleTheme({ category: '生活常识', bodyBg: 'none' })
    expect(off.bodyBg).toBeUndefined()
    const keep = resolveArticleTheme({ category: '生活常识' })
    expect(keep.bodyBg).toBe('#fffaf2')
  })

  it('无卡片主题覆盖 hex → 有卡片（深浅字色由渲染层兜底自适应）', () => {
    const t = resolveArticleTheme({ category: '情感回忆', bodyBg: '#fff0f0' })
    expect(t.bodyBg).toBe('#fff0f0')
  })
})

// ---- B 期视觉层放开（20 新字段）：spec 2026-09-30-ai-typography-design §8.1 ----

/** 20 个新字段都给了主题原值，「回落主题默认」才测得出来（DEFAULT_THEME 里这些键是 undefined） */
const visualBase: ArticleTheme = {
  ...DEFAULT_THEME,
  fontFamily: 'serif-base',
  lineHeight: 1.8,
  letterSpacing: '0.05em',
  pGap: 20,
  bodyText: '#111111',
  headingColor: '#222222',
  quoteStyle: 'leftbar',
  quoteBorder: '#333333',
  quoteBg: '#eeeeee',
  quoteText: '#444444',
  hrColor: '#555555',
  h2Border: '#666666',
  hrStyle: 'line',
  strongStyle: 'color',
  strongBg: '#444444',
  strongColor: '#555555',
  imgRadius: 8,
  bodyRadius: 12,
  bodyPadding: '16px',
  tableStyle: 'plain',
  tableHeaderBg: '#666666',
  tableBorder: '#777777',
  tableHeaderText: '#888888',
  h2Bg: '#999999'
}

type VisualMeta = Parameters<typeof resolveArticleTheme>[0]

const withBase = (meta: VisualMeta): ArticleTheme =>
  resolveArticleTheme({ category: 'B期', ...meta } as VisualMeta, { B期: visualBase })

describe('resolveArticleTheme（B 期 20 视觉字段：合法覆盖）', () => {
  it('逐字段覆盖生效并出现在最终主题里', () => {
    const t = withBase({
      fontFamily: '"LXGW WenKai", serif',
      lineHeight: 2.4,
      letterSpacing: '0.08em',
      pGap: 32,
      bodyText: '#2b2b2b',
      headingColor: '#0f766e',
      quoteStyle: 'card',
      quoteBorder: '#14b8a6',
      quoteBg: '#fdf2f8',
      quoteText: '#831843',
      hrColor: '#7c3aed',
      h2Border: '#0ea5e9',
      hrStyle: 'dot',
      strongStyle: 'highlight',
      strongBg: '#fde68a',
      strongColor: '#b45309',
      imgRadius: 20,
      bodyRadius: 18,
      bodyPadding: '22px 24px',
      tableStyle: 'striped',
      tableHeaderBg: '#0ea5e9',
      tableBorder: '#e5e7eb',
      tableHeaderText: '#ffffff',
      h2Bg: '#f0fdf4'
    })
    expect(t).toMatchObject({
      fontFamily: '"LXGW WenKai", serif',
      lineHeight: 2.4,
      letterSpacing: '0.08em',
      pGap: 32,
      bodyText: '#2b2b2b',
      headingColor: '#0f766e',
      quoteStyle: 'card',
      quoteBorder: '#14b8a6',
      quoteBg: '#fdf2f8',
      quoteText: '#831843',
      hrColor: '#7c3aed',
      h2Border: '#0ea5e9',
      hrStyle: 'dot',
      strongStyle: 'highlight',
      strongBg: '#fde68a',
      strongColor: '#b45309',
      imgRadius: 20,
      bodyRadius: 18,
      bodyPadding: '22px 24px',
      tableStyle: 'striped',
      tableHeaderBg: '#0ea5e9',
      tableBorder: '#e5e7eb',
      tableHeaderText: '#ffffff',
      h2Bg: '#f0fdf4'
    })
  })

  it('未覆盖的字段跟随主题，一个都不被清掉', () => {
    const t = withBase({ lineHeight: 2.2 })
    expect(t.lineHeight).toBe(2.2)
    expect(t.pGap).toBe(20)
    expect(t.imgRadius).toBe(8)
    expect(t.tableStyle).toBe('plain')
    expect(t.h2Bg).toBe('#999999')
    expect(t.fontFamily).toBe('serif-base')
  })

  it('0 是合法覆盖值，不被真值短路当成「未覆盖」（段间距 0 / 图片方角）', () => {
    const t = withBase({ pGap: 0, imgRadius: 0, bodyRadius: 0 })
    expect(t.pGap).toBe(0)
    expect(t.imgRadius).toBe(0)
    expect(t.bodyRadius).toBe(0)
  })
})

describe('resolveArticleTheme（B 期视觉字段：越界夹取与非法回落）', () => {
  it('数值越界夹到区间端点', () => {
    expect(withBase({ lineHeight: 9 }).lineHeight).toBe(3)
    expect(withBase({ lineHeight: 0.5 }).lineHeight).toBe(1.5)
    expect(withBase({ pGap: 400 }).pGap).toBe(48)
    expect(withBase({ imgRadius: 99 }).imgRadius).toBe(40)
    expect(withBase({ bodyRadius: -5 }).bodyRadius).toBe(0)
  })

  it('非法 hex / 枚举外值 / 空串 → 回落主题原值（不写坏覆盖）', () => {
    expect(withBase({ bodyText: 'deepgrey' }).bodyText).toBe('#111111')
    expect(withBase({ quoteBorder: '#12345' }).quoteBorder).toBe('#333333')
    expect(withBase({ h2Bg: 'red' }).h2Bg).toBe('#999999')
    expect(withBase({ quoteStyle: 'bubble' as ArticleTheme['quoteStyle'] }).quoteStyle).toBe('leftbar')
    expect(withBase({ hrStyle: 'wavy' as ArticleTheme['hrStyle'] }).hrStyle).toBe('line')
    expect(withBase({ strongStyle: 'glow' as ArticleTheme['strongStyle'] }).strongStyle).toBe('color')
    expect(withBase({ tableStyle: 'gradient' as ArticleTheme['tableStyle'] }).tableStyle).toBe('plain')
    expect(withBase({ quoteBg: 'pink' }).quoteBg).toBe('#eeeeee')
    expect(withBase({ quoteText: '#12345' }).quoteText).toBe('#444444')
    expect(withBase({ hrColor: '  ' }).hrColor).toBe('#555555')
    expect(withBase({ h2Border: 123 as unknown as string }).h2Border).toBe('#666666')
    expect(withBase({ fontFamily: '   ' }).fontFamily).toBe('serif-base')
    expect(withBase({ letterSpacing: '' }).letterSpacing).toBe('0.05em')
    expect(withBase({ bodyPadding: '  ' }).bodyPadding).toBe('16px')
  })

  it('NaN 不当覆盖（夹取前先 isFinite）', () => {
    expect(withBase({ lineHeight: Number.NaN }).lineHeight).toBe(1.8)
    expect(withBase({ pGap: Number.NaN }).pGap).toBe(20)
  })
})

describe('resolveArticleTheme（accent 重链与显式覆盖的优先级）', () => {
  it('显式 accent 且未覆盖 headingColor/strongColor → 两色跟随新 accent 重链', () => {
    const t = withBase({ accent: '#e63946' })
    expect(t.headingColor).toBe('#e63946')
    expect(t.strongColor).toBe('#e63946')
  })

  it('meta 显式覆盖 headingColor → 压过 accent 重链（作者点名要的颜色优先）', () => {
    const t = withBase({ accent: '#e63946', headingColor: '#0ea5e9' })
    expect(t.headingColor).toBe('#0ea5e9')
    expect(t.strongColor).toBe('#e63946')
  })

  it('meta 显式覆盖 strongColor → 同样压过重链；标题色仍跟随 accent', () => {
    const t = withBase({ accent: '#e63946', strongColor: '#111111' })
    expect(t.strongColor).toBe('#111111')
    expect(t.headingColor).toBe('#e63946')
  })

  it('非法 accent 不参与重链（回落主题 accent，两色保持主题原值）', () => {
    const t = withBase({ accent: 'crimson' })
    expect(t.accent).toBe(visualBase.accent)
    expect(t.headingColor).toBe('#222222')
    expect(t.strongColor).toBe('#555555')
  })

  it('bodyText/h2Bg 不参与 accent 重链（阅读色与块背景由作者独立掌控）', () => {
    const t = withBase({ accent: '#e63946' })
    expect(t.bodyText).toBe('#111111')
    expect(t.h2Bg).toBe('#999999')
  })
})

describe('sanitizeThemePatch（set_theme / save_theme_preset / 排版对话框共用校验面）', () => {
  it('未知键剔除，合法键保留（模型多写的字段不会进 meta）', () => {
    const p = sanitizeThemePatch({ lineHeight: 2.2, fontSizePx: 18, nonsense: 'x', bodyBg: '#fff' }) as Record<
      string,
      unknown
    >
    expect(p).toEqual({ lineHeight: 2.2, bodyBg: '#fff' })
  })

  it('数值夹取、hex 校验、枚举守卫与白名单同口径', () => {
    const p = sanitizeThemePatch({ lineHeight: 12, pGap: -8, bodyText: 'nope', quoteStyle: 'card' }) as Record<
      string,
      unknown
    >
    expect(p.lineHeight).toBe(3)
    expect(p.pGap).toBe(0)
    expect(p.bodyText).toBeUndefined()
    expect(p.quoteStyle).toBe('card')
  })

  it("bodyBg 与 h2Num 的 'none' 哨兵原样保留（哨兵语义不能被校验吃掉）", () => {
    const p = sanitizeThemePatch({ bodyBg: 'none', h2Num: 'none' }) as Record<string, unknown>
    expect(p.bodyBg).toBe('none')
    expect(p.h2Num).toBe('none')
  })

  it('0 不会被丢（真值判定老坑）', () => {
    expect(sanitizeThemePatch({ pGap: 0 })).toEqual({ pGap: 0 })
    expect(sanitizeThemePatch({ imgRadius: 0 })).toEqual({ imgRadius: 0 })
  })

  it('空串/真非数值不写入，但字符串数值要救得回来（模型爱写 "2.2" / "16px"）', () => {
    expect(sanitizeThemePatch({ fontFamily: '   ', lineHeight: 'tight', accent: 123 })).toEqual({})
    expect(sanitizeThemePatch({ lineHeight: '2.2', bodyFontSize: '16px' })).toEqual({
      lineHeight: 2.2,
      bodyFontSize: 16
    })
  })

  it('白名单 40 键逐键可写（新增字段忘了登记或取值不合法，会在这条红）', () => {
    const validProbe: Record<string, unknown> = {
      accent: '#0f766e',
      bodyFontSize: 17,
      headingFontSize: 21,
      bodyAlign: 'indent',
      headingAlign: 'left',
      h1Style: 'pill',
      h1Bg: '#1a1a2e',
      h2Style: 'block',
      h2Num: '1.',
      h3Mark: 'dot',
      bodyBg: 'none',
      pageBg: '#f5f1ea',
      fontFamily: 'Serif, serif',
      lineHeight: 2.2,
      letterSpacing: '0.03em',
      pGap: 24,
      bodyText: '#222222',
      headingColor: '#333333',
      quoteStyle: 'card',
      quoteBorder: '#444444',
      quoteBg: '#fdf2f8',
      quoteText: '#831843',
      hrColor: '#7c3aed',
      h2Border: '#0ea5e9',
      hrStyle: 'dot',
      strongStyle: 'highlight',
      strongBg: '#555555',
      strongColor: '#666666',
      imgRadius: 12,
      imgStyle: 'fullwidth',
      imgFrame: 'shadow',
      imgGap: 18,
      captionAlign: 'left',
      bodyRadius: 14,
      bodyPadding: '20px 22px',
      tableStyle: 'striped',
      tableHeaderBg: '#777777',
      tableBorder: '#888888',
      tableHeaderText: '#999999',
      h2Bg: '#aaaaaa'
    }
    expect(Object.keys(sanitizeThemePatch(validProbe)).sort()).toEqual([...THEME_OVERRIDE_KEYS].sort())
  })
})

describe('clampThemeNumbers（越界夹取要如实报回，不静默改值）', () => {
  it('低于下限 → 抬到下限并给一句可转述的中文', () => {
    const r = clampThemeNumbers({ lineHeight: 1.4 })
    expect(r.values.lineHeight).toBe(1.5)
    expect(r.notes).toEqual(['行高只支持 1.5-3，你给的 1.4 已抬到 1.5'])
  })

  it('高于上限 → 压到上限', () => {
    const r = clampThemeNumbers({ lineHeight: 9, pGap: 400 })
    expect(r.values).toEqual({ lineHeight: 3, pGap: 48 })
    expect(r.notes).toEqual(['行高只支持 1.5-3，你给的 9 已压到 3', '段间距只支持 0-48，你给的 400 已压到 48'])
  })

  it('区间内不改值也不吱声', () => {
    const r = clampThemeNumbers({ lineHeight: 2.4, pGap: 0, imgRadius: 0 })
    expect(r.values).toEqual({ lineHeight: 2.4, pGap: 0, imgRadius: 0 })
    expect(r.notes).toEqual([])
  })

  it('null（恢复默认）与读不出数值的写法不参与夹取', () => {
    const r = clampThemeNumbers({ lineHeight: null, pGap: '宽松', imgRadius: Number.NaN })
    expect(r.values).toEqual({})
    expect(r.notes).toEqual([])
  })

  it('字符串数值照样夹取（"1.2" 与 "400px" 都得管住）', () => {
    const r = clampThemeNumbers({ lineHeight: '1.2', pGap: '400px' })
    expect(r.values).toEqual({ lineHeight: 1.5, pGap: 48 })
    expect(r.notes).toEqual([
      '行高只支持 1.5-3，你给的 1.2 已抬到 1.5',
      '段间距只支持 0-48，你给的 400 已压到 48'
    ])
  })

  it('区间表只含数值型覆盖键，且都在白名单内', () => {
    const keys = Object.keys(THEME_NUM_RANGES)
    expect(keys.every((k) => (THEME_OVERRIDE_KEYS as readonly string[]).includes(k))).toBe(true)
    expect(keys).toEqual(['bodyFontSize', 'headingFontSize', 'lineHeight', 'pGap', 'imgRadius', 'imgGap', 'bodyRadius'])
  })

  it('与 sanitizeThemePatch 同一口径（两条路夹出同一个值）', () => {
    const raw = { lineHeight: 1.2, pGap: 99, imgRadius: 60 }
    expect(clampThemeNumbers(raw).values).toEqual(sanitizeThemePatch(raw))
  })
})

describe('normalizeThemeKeys（模型自造键名先映射，映射不了的必须报出来）', () => {
  it('实测那套自造键名：能映射的全映射，映射不了的进 unknown', () => {
    const r = normalizeThemeKeys({
      accent: '#7c3aed',
      text_color: '#1f2933',
      font_family: 'PingFang SC, sans-serif',
      font_size: '16px',
      line_height: '1.85',
      paragraph_spacing: '1.4em',
      h2_color: '#0a84ff',
      quote_bg: '#f0f6ff',
      divider_gradient: '#7c3aed'
    })
    expect(r.patch).toEqual({
      accent: '#7c3aed',
      bodyText: '#1f2933',
      fontFamily: 'PingFang SC, sans-serif',
      bodyFontSize: '16px',
      lineHeight: '1.85',
      pGap: '1.4em',
      headingColor: '#0a84ff',
      quoteBg: '#f0f6ff'
    })
    // 主题里没有「引用底色 / 渐变分隔线」这两个形态，只能如实说没做，不能装成功
    // quote_bg / quote_text_color 已有对应字段；divider_gradient 这种「产品里没有的形态」必须报出来
    expect(r.unknown).toEqual(['divider_gradient'])
  })

  it('显式白名单键优先于别名（同时给 fontSize 与 bodyFontSize 时不互相覆盖）', () => {
    const r = normalizeThemeKeys({ bodyFontSize: 17, fontSize: 15 })
    expect(r.patch).toEqual({ bodyFontSize: 17 })
  })

  it('未知键不会被静默丢弃，蛇形通用键也能落到驼峰', () => {
    expect(normalizeThemeKeys({ img_radius: 12 }).patch).toEqual({ imgRadius: 12 })
    expect(normalizeThemeKeys({ nonsense: 1 }).unknown).toEqual(['nonsense'])
  })
})

describe('metaPatchToThemeKeys（存主题库前换回主题口径，否则编辑器读不到）', () => {
  it('meta 的 bodyFontSize 映射成主题的 fontSize', () => {
    const t = metaPatchToThemeKeys({ bodyFontSize: 17, lineHeight: 2.2, accent: '#7c3aed' })
    expect(t).toEqual({ fontSize: 17, lineHeight: 2.2, accent: '#7c3aed' })
  })

  it('主题已有 fontSize 时不被 meta 口径覆盖', () => {
    expect(metaPatchToThemeKeys({ bodyFontSize: 17, fontSize: 15 } as never).fontSize).toBe(15)
  })

  it('其余键原样带走', () => {
    expect(metaPatchToThemeKeys({ quoteStyle: 'card', h2Bg: '#eee' })).toEqual({ quoteStyle: 'card', h2Bg: '#eee' })
  })
})

describe('sanitizeThemePatchDetailed（工具层如实回报的底层）', () => {
  it('别名叫来的值同样过校验：字符串数值夹取、坏色值进 invalid、映射不到的进 unknown', () => {
    const r = sanitizeThemePatchDetailed({
      accent: '#7c3aed',
      line_height: '1.85',
      text_color: 'grey',
      quote_bg: '#f0f6ff',
      shadow_color: '#000'
    })
    expect(r.values).toEqual({ accent: '#7c3aed', lineHeight: 1.85, quoteBg: '#f0f6ff' })
    // invalid 报的是归一后的规范键名——模型照着重发时才用得上正确的键
    expect(r.invalid).toEqual(['bodyText'])
    expect(r.unknown).toEqual(['shadow_color'])
  })

  it('非字符串色值不炸（模型写 123 / 对象时判非法，而不是把导出渲染整个搞崩）', () => {
    expect(sanitizeThemePatch({ h2Border: 123, quoteBg: {}, hrColor: null, quoteText: [] })).toEqual({})
    expect(resolveArticleTheme({ category: 'B期', h2Border: 123 as never }, { B期: visualBase }).h2Border).toBe('#666666')
  })

  it('只认出一个 accent 时如实返回其余未知键（就是那次「整套主题其实只有 1 个字段」的形状）', () => {
    const r = sanitizeThemePatchDetailed({ accent: '#0066ff', secondary_color: '#5f6b7a', h3_style: 'plain-bold' })
    expect(Object.keys(r.values)).toEqual(['accent'])
    expect(r.unknown).toEqual(['secondary_color', 'h3_style'])
  })

  it('sanitizeThemePatch 语义不变：仍只返回合法覆盖键值', () => {
    expect(sanitizeThemePatch({ text_color: '#222222', nope: 1 })).toEqual({ bodyText: '#222222' })
  })
})

describe('别名表的驼峰口语与长度单位（14:xx 实跑复盘：paragraphSpacing/cornerRadius/letterSpacing 数字被误判不认识）', () => {
  it('驼峰口语键也命中（此前只登记蛇形，paragraph_spacing 能认、paragraphSpacing 不能认）', () => {
    expect(normalizeThemeKeys({ paragraphSpacing: 24 }).patch).toEqual({ pGap: 24 })
    expect(normalizeThemeKeys({ cornerRadius: 12 }).patch).toEqual({ bodyRadius: 12 })
    expect(normalizeThemeKeys({ paraSpacing: 20 }).patch).toEqual({ pGap: 20 })
    expect(normalizeThemeKeys({ letterSpace: '0.05em' }).patch).toEqual({ letterSpacing: '0.05em' })
    expect(normalizeThemeKeys({ line_spacing: 2.2 }).patch).toEqual({ lineHeight: 2.2 })
    expect(normalizeThemeKeys({ radius: 8 }).patch).toEqual({ bodyRadius: 8 })
    expect(normalizeThemeKeys({ image_radius: 6, pictureRadius: 7 }).patch).toEqual({ imgRadius: 6 })
  })

  it('长度类字段给裸数字时按 px 补齐（letterSpacing / bodyPadding）', () => {
    expect(sanitizeThemePatch({ letterSpacing: 0.5, bodyPadding: 20 })).toEqual({
      letterSpacing: '0.5px',
      bodyPadding: '20px'
    })
    // 已带单位的字符串原样保留，不重复加 px
    expect(sanitizeThemePatch({ letterSpacing: '0.04em', bodyPadding: '18px 20px' })).toEqual({
      letterSpacing: '0.04em',
      bodyPadding: '18px 20px'
    })
  })

  it('字体栈给数字仍算非法（不能凭空补 px 成字体名）', () => {
    expect(sanitizeThemePatch({ fontFamily: 12 })).toEqual({})
  })
})

describe('coerceHexColor（宽进：模型爱写的色值形态收敛成 #rrggbb）', () => {
  it('合法 3/6 位 hex 原样通过（形态与大小写都不动）', () => {
    expect(coerceHexColor('#7c3aed')).toBe('#7c3aed')
    expect(coerceHexColor('#FFF')).toBe('#FFF')
  })

  it('8 位丢 alpha（主题库不存透明度）；4 位残缺串不截断兜底', () => {
    expect(coerceHexColor('#7C3AED80')).toBe('#7c3aed')
    expect(coerceHexColor('#abcd')).toBeUndefined()
  })

  it('rgb()/rgba() 换算成 hex（逗号与空格分隔都认）', () => {
    expect(coerceHexColor('rgb(124, 58, 237)')).toBe('#7c3aed')
    expect(coerceHexColor('rgba(124,58,237,0.5)')).toBe('#7c3aed')
    expect(coerceHexColor('rgb(124 58 237)')).toBe('#7c3aed')
  })

  it('渐变/多色串取第一个可识别色（取主色是最接近作者意图的落点）', () => {
    expect(coerceHexColor('linear-gradient(135deg, #a78bfa, #7c3aed)')).toBe('#a78bfa')
    expect(coerceHexColor('linear-gradient(90deg, rgb(1,2,3), #fff)')).toBe('#010203')
  })

  it('救不动的仍返回 undefined（语义化色名/残缺串不猜）', () => {
    expect(coerceHexColor('紫色')).toBeUndefined()
    expect(coerceHexColor('crimson')).toBeUndefined()
    expect(coerceHexColor('#12345')).toBeUndefined() // 5 位残缺不是截成 3 位的理由
    expect(coerceHexColor('')).toBeUndefined()
    expect(coerceHexColor(123)).toBeUndefined()
  })
})

describe('sanitizeThemePatchDetailed 宽进回报（accent 写成渐变不再打回重试）', () => {
  it('渐变 accent 转成主色 hex，转换说明进 coerced（静默改值=「设了没反应」）', () => {
    const r = sanitizeThemePatchDetailed({ accent: 'linear-gradient(135deg, #a78bfa, #7c3aed)' })
    expect(r.values.accent).toBe('#a78bfa')
    expect(r.coerced).toEqual([
      '强调色：linear-gradient(135deg, #a78bfa, #7c3aed) 不是 #rrggbb 十六进制，已按 #a78bfa 生效'
    ])
    expect(r.invalid).toEqual([])
  })

  it('rgb() 写法的任意色字段同样宽进（与 set_theme 共用同一口径）', () => {
    expect(sanitizeThemePatch({ bodyText: 'rgb(34, 34, 34)', bodyBg: 'rgba(240, 253, 244, 1)' })).toEqual({
      bodyText: '#222222',
      bodyBg: '#f0fdf4'
    })
  })

  it('真救不动的仍进 invalid（crimson 之类语义化色名不猜）', () => {
    const r = sanitizeThemePatchDetailed({ accent: 'crimson' })
    expect(r.values).toEqual({})
    expect(r.invalid).toEqual(['accent'])
    expect(r.coerced).toEqual([])
  })
})

describe('migrateCustomThemes（v1 主题名=分类名 → v2 独立命名+active 指针）', () => {
  it('v1 平铺映射迁移：每个主题同名归入原分类并激活，套用结果与迁移前一致', () => {
    const lib = migrateCustomThemes({ 生活常识: { accent: '#7c3aed' }, 科技数码: { accent: '#0ea5e9' } })
    expect(lib.version).toBe(2)
    expect(lib.themes['生活常识']).toEqual({ category: '生活常识', theme: { accent: '#7c3aed' } })
    expect(lib.active).toEqual({ 生活常识: '生活常识', 科技数码: '科技数码' })
    expect(activeThemesView(lib)['生活常识']).toEqual({ accent: '#7c3aed' })
  })

  it('v2 原样通过（缺字段补空），损坏输入给空库', () => {
    const v2 = { version: 2, themes: { A: { category: 'X', theme: { accent: '#111111' } } }, active: { X: 'A' } }
    expect(migrateCustomThemes(v2)).toEqual(v2)
    expect(migrateCustomThemes({ version: 2 })).toEqual({ version: 2, themes: {}, active: {} })
    expect(migrateCustomThemes(null)).toEqual({ version: 2, themes: {}, active: {} })
    expect(migrateCustomThemes('garbage')).toEqual({ version: 2, themes: {}, active: {} })
  })
})

describe('activeThemesView（分类 → 当前套用主题，指针可指向自定义或内置）', () => {
  const builtin = { 科技数码: { accent: '#2563eb' } } as unknown as Record<string, ArticleTheme>

  it('指针指向自定义主题取自定义；指向内置名取内置；指向不存在的名字不进视图', () => {
    const lib = migrateCustomThemes({
      version: 2,
      themes: { 清新蓝: { category: '生活常识', theme: { accent: '#7c3aed' } } },
      active: { 生活常识: '清新蓝', 科技数码: '科技数码', 未分类: '幽灵主题' }
    })
    expect(activeThemesView(lib, builtin)).toEqual({
      生活常识: { accent: '#7c3aed' },
      科技数码: { accent: '#2563eb' }
    })
  })

  it('一个分类一套当前套用；一套主题可被多个分类共享', () => {
    const lib = migrateCustomThemes({
      version: 2,
      themes: { 共享: { category: '科技数码', theme: { accent: '#0f766e' } } },
      active: { 科技数码: '共享', 生活常识: '共享' }
    })
    const view = activeThemesView(lib)
    expect(view['科技数码']).toEqual({ accent: '#0f766e' })
    expect(view['生活常识']).toEqual({ accent: '#0f766e' })
  })

  it('必填字段缺失的导入主题回落默认（留白口径）——不再把 undefined 传进导出端 .replace 白屏', () => {
    const lib = migrateCustomThemes({
      version: 2,
      themes: { 缺字段: { category: '缺字段', theme: { accent: '#6d5cff', bodyBg: '#ffffff' } as ArticleTheme } },
      active: { 缺字段: '缺字段' }
    })
    const t = resolveArticleTheme({ category: '缺字段' }, activeThemesView(lib))
    expect(t.accent).toBe('#6d5cff') // 主题给了的字段原样保留
    expect(t.fontFamily).toBe(DEFAULT_THEME.fontFamily) // 缺了的回落默认调性
    expect(t.lineHeight).toBe(DEFAULT_THEME.lineHeight)
    expect(t.letterSpacing).toBe(DEFAULT_THEME.letterSpacing)
    expect(t.headingAlign).toBe(DEFAULT_THEME.headingAlign)
  })
})
