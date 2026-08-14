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
})
