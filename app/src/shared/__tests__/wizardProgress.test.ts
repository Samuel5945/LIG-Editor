/**
 * 创作向进步度推导（shared/wizardProgress.ts）为什么要测这些：
 * 步骤完成判定是纯事实推导，向导 UI 只照它渲染——推导错一步，用户看到的进度就全错。
 * 这里钉死规格 §7 的全状态矩阵（未立项/文章各阶段/贴图 5 步/全完成）和占位解析的边界。
 */
import { describe, expect, it } from 'vitest'
import { deriveWizardSteps, firstPendingStep, parseFigSuggestions, type WizardFacts } from '../wizardProgress'

const facts = (over: Partial<WizardFacts> = {}): WizardFacts => ({
  hasProject: false,
  isCards: false,
  outlineProduced: false,
  articleNonEmpty: false,
  cardsCount: 0,
  figSuggestCount: 0,
  hasCover: false,
  hasReview: false,
  hasExport: false,
  ...over
})

describe('deriveWizardSteps · 文章工程七步', () => {
  it('未立项：全部未完成，默认落选题步', () => {
    const steps = deriveWizardSteps(facts())
    expect(steps.map((s) => [s.id, s.done])).toEqual([
      ['ideas', false],
      ['outline', false],
      ['draft', false],
      ['figures', false],
      ['titlecover', false],
      ['review', false],
      ['export', false]
    ])
    expect(firstPendingStep(steps)).toBe(0)
  })

  it('会话内出了大纲但未立项：选题步即完成', () => {
    const steps = deriveWizardSteps(facts({ outlineProduced: true }))
    expect(steps[0]).toEqual({ id: 'ideas', label: '选题', done: true })
    expect(firstPendingStep(steps)).toBe(1)
  })

  it('已立项空正文：选题/大纲完成，落成文步', () => {
    const steps = deriveWizardSteps(facts({ hasProject: true }))
    expect(firstPendingStep(steps)).toBe(2)
  })

  it('正文非空但有残留占位：成文完成、配图未完成', () => {
    const steps = deriveWizardSteps(facts({ hasProject: true, articleNonEmpty: true, figSuggestCount: 3 }))
    expect(firstPendingStep(steps)).toBe(3)
  })

  it('占位清零配图即完成——最终插几张图由用户决定，删除占位也算已处理', () => {
    const steps = deriveWizardSteps(facts({ hasProject: true, articleNonEmpty: true, figSuggestCount: 0 }))
    expect(firstPendingStep(steps)).toBe(4)
  })

  it('封面/审阅/导出按各自事实推进（配图完成以正文存在为前提）', () => {
    const base = { hasProject: true, articleNonEmpty: true }
    expect(firstPendingStep(deriveWizardSteps(facts({ ...base, hasCover: true })))).toBe(5)
    expect(firstPendingStep(deriveWizardSteps(facts({ ...base, hasCover: true, hasReview: true })))).toBe(6)
  })

  it('全部完成落最后一步（导出）', () => {
    const steps = deriveWizardSteps(
      facts({
        hasProject: true,
        articleNonEmpty: true,
        hasCover: true,
        hasReview: true,
        hasExport: true
      })
    )
    expect(firstPendingStep(steps)).toBe(6)
  })
})

describe('deriveWizardSteps · 贴图工程五步', () => {
  it('隐藏配图与导出步，成文步改名贴图，完成看卡片数', () => {
    const steps = deriveWizardSteps(facts({ hasProject: true, isCards: true }))
    expect(steps.map((s) => s.id)).toEqual(['ideas', 'outline', 'draft', 'titlecover', 'review'])
    expect(steps[2]).toEqual({ id: 'draft', label: '贴图', done: false })
    expect(firstPendingStep(steps)).toBe(2)
  })

  it('卡片已生成即贴图步完成', () => {
    const steps = deriveWizardSteps(facts({ hasProject: true, isCards: true, cardsCount: 6 }))
    expect(steps[2].done).toBe(true)
  })
})

describe('parseFigSuggestions', () => {
  it('无占位返回空数组', () => {
    expect(parseFigSuggestions('# 标题\n\n正文一段。')).toEqual([])
  })

  it('按出现顺序提取，描述与图注按首个分隔符拆分', () => {
    const md = [
      '# 标题',
      '',
      '<!-- fig-suggest: 山间晨雾中的索道 | 晨雾索道 -->',
      '正文。',
      '<!-- fig-suggest: 夜晚的城市天际线延时 | 城市夜景 -->'
    ].join('\n')
    expect(parseFigSuggestions(md)).toEqual([
      { prompt: '山间晨雾中的索道', caption: '晨雾索道', desc: '山间晨雾中的索道 | 晨雾索道' },
      { prompt: '夜晚的城市天际线延时', caption: '城市夜景', desc: '夜晚的城市天际线延时 | 城市夜景' }
    ])
  })

  it('描述里再含分隔符时按首个拆，剩余归图注', () => {
    const md = '<!-- fig-suggest: 对比图 A | B 两种方案 | 对比 -->'
    expect(parseFigSuggestions(md)[0]).toEqual({
      prompt: '对比图 A',
      caption: 'B 两种方案 | 对比',
      desc: '对比图 A | B 两种方案 | 对比'
    })
  })

  it('无分隔符的旧占位：图注回退为描述；全角分隔符兼容；CRLF 不影响', () => {
    const md = '<!-- fig-suggest: 素色背景特写 -->\r\n\r\n<!-- fig-suggest：全角不匹配整行注释，跳过 -->'
    const out = parseFigSuggestions(md)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ prompt: '素色背景特写', caption: '素色背景特写', desc: '素色背景特写' })
  })
})
