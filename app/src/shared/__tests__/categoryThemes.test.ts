import { describe, expect, it } from 'vitest'
import { resolveArticleTheme, DEFAULT_THEME } from '../categoryThemes'
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
    const t = resolveArticleTheme({ category: '科技数码' })
    expect(t.bodyBg).toBe('#eef3fb')
    const plain = resolveArticleTheme({ category: '情感回忆' })
    expect(plain.bodyBg).toBeUndefined() // 情感回忆主题无卡片
  })

  it('meta hex 覆盖 → 背景卡换色；非法色值回落主题', () => {
    const t = resolveArticleTheme({ category: '科技数码', bodyBg: '#f0fdf4' })
    expect(t.bodyBg).toBe('#f0fdf4')
    const bad = resolveArticleTheme({ category: '科技数码', bodyBg: 'not-a-color' })
    expect(bad.bodyBg).toBe('#eef3fb')
  })

  it("meta bodyBg 'none' 哨兵 → 显式去卡片（区别于未覆盖的跟随）", () => {
    const off = resolveArticleTheme({ category: '科技数码', bodyBg: 'none' })
    expect(off.bodyBg).toBeUndefined()
    const keep = resolveArticleTheme({ category: '科技数码' })
    expect(keep.bodyBg).toBe('#eef3fb')
  })

  it('无卡片主题覆盖 hex → 有卡片（深浅字色由渲染层兜底自适应）', () => {
    const t = resolveArticleTheme({ category: '情感回忆', bodyBg: '#fff0f0' })
    expect(t.bodyBg).toBe('#fff0f0')
  })
})
