/**
 * 创作向进步度推导（shared/wizardProgress.ts）为什么要测这些：
 * 步骤完成判定是纯事实推导，向导 UI 只照它渲染——推导错一步，用户看到的进度就全错。
 * 这里钉死规格 §7 的全状态矩阵（未立项/文章各阶段/贴图 5 步/全完成）和占位解析的边界。
 */
import { describe, expect, it } from 'vitest'
import {
  deriveWizardSteps,
  firstPendingStep,
  parseFigImages,
  parseFigSuggestions,
  replaceFigSuggestion,
  type WizardFacts
} from '../wizardProgress'

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

  it('手动新建的空工程：选题/大纲未完成，从选题步开始（立项≠已过前两步，要有真内容）', () => {
    const steps = deriveWizardSteps(facts({ hasProject: true }))
    expect(steps[0].done).toBe(false)
    expect(steps[1].done).toBe(false)
    expect(firstPendingStep(steps)).toBe(0)
  })

  it('已有内容的工程：选题/大纲视为已完成；无占位时配图步也自动完成，落标题封面步', () => {
    const steps = deriveWizardSteps(facts({ hasProject: true, articleNonEmpty: true }))
    expect(steps[0].done).toBe(true)
    expect(steps[1].done).toBe(true)
    expect(firstPendingStep(steps)).toBe(4)
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
    expect(firstPendingStep(steps)).toBe(0)
  })

  it('卡片已生成即有内容：选题/大纲/贴图完成', () => {
    const steps = deriveWizardSteps(facts({ hasProject: true, isCards: true, cardsCount: 6 }))
    expect(steps[0].done).toBe(true)
    expect(steps[1].done).toBe(true)
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
      { prompt: '山间晨雾中的索道', caption: '晨雾索道', desc: '山间晨雾中的索道 | 晨雾索道', line: 2 },
      { prompt: '夜晚的城市天际线延时', caption: '城市夜景', desc: '夜晚的城市天际线延时 | 城市夜景', line: 4 }
    ])
  })

  it('描述里再含分隔符时按首个拆，剩余归图注', () => {
    const md = '<!-- fig-suggest: 对比图 A | B 两种方案 | 对比 -->'
    expect(parseFigSuggestions(md)[0]).toEqual({
      prompt: '对比图 A',
      caption: 'B 两种方案 | 对比',
      desc: '对比图 A | B 两种方案 | 对比',
      line: 0
    })
  })

  it('无分隔符的旧占位：图注回退为描述；全角分隔符兼容；CRLF 不影响', () => {
    const md = '<!-- fig-suggest: 素色背景特写 -->\r\n\r\n<!-- fig-suggest：全角不匹配整行注释，跳过 -->'
    const out = parseFigSuggestions(md)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ prompt: '素色背景特写', caption: '素色背景特写', desc: '素色背景特写', line: 0 })
  })

  it('占位解析带行号，CRLF 场景行号也正确', () => {
    const md = '# 标题\r\n\r\n<!-- fig-suggest: 甲 | 注一 -->\r\n正文\r\n<!-- fig-suggest: 乙 -->'
    const out = parseFigSuggestions(md)
    expect(out.map((s) => s.line)).toEqual([2, 4])
  })
})

describe('parseFigImages', () => {
  it('提取单图与紧随的图注；图集内部图片不单列', () => {
    const md = [
      '# 标题',
      '',
      '![甲](assets/a.png)',
      '<!-- caption: 图注甲 -->',
      '<!-- gallery: swipe-h -->',
      '![乙](assets/b.png)',
      '<!-- caption: 图注乙 -->',
      '<!-- /gallery -->',
      '',
      '![丙](assets/c.png)'
    ].join('\n')
    expect(parseFigImages(md)).toEqual([
      { line: 2, src: 'assets/a.png', alt: '甲', caption: '图注甲' },
      { line: 9, src: 'assets/c.png', alt: '丙', caption: '' }
    ])
  })
})

describe('replaceFigSuggestion', () => {
  const md = ['# 标题', '', '<!-- fig-suggest: 山间晨雾 | 晨雾 -->', '正文。'].join('\n')

  it('单图替换：占位行换成图片行 + 图注注释', () => {
    const out = replaceFigSuggestion(md, 2, {
      src: 'assets/fig-1.png',
      alt: '晨雾',
      caption: '晨雾',
      figureSource: ''
    })
    expect(out.split('\n')).toEqual([
      '# 标题',
      '',
      '![晨雾](assets/fig-1.png)',
      '<!-- caption: 晨雾 -->',
      '正文。'
    ])
  })

  it('图表源替换：带 figure-source 注释', () => {
    const out = replaceFigSuggestion(md, 2, {
      src: 'assets/fig-2.png',
      alt: '图表',
      caption: '',
      figureSource: 'figures/fig-2.html'
    })
    expect(out).toContain('![图表](assets/fig-2.png)')
    expect(out).toContain('<!-- figure-source: figures/fig-2.html -->')
    expect(out).not.toContain('<!-- caption:')
  })

  it('图集替换：占位一行换成 gallery 块', () => {
    const out = replaceFigSuggestion(md, 2, {
      images: [
        { src: 'assets/a.png', alt: '一' },
        { src: 'assets/b.png', alt: '二' }
      ],
      layout: 'grid',
      frame: '3:4',
      caption: '组图'
    })
    expect(out.split('\n')).toEqual([
      '# 标题',
      '',
      '<!-- gallery: grid 3:4 -->',
      '![一](assets/a.png)',
      '![二](assets/b.png)',
      '<!-- caption: 组图 -->',
      '<!-- /gallery -->',
      '正文。'
    ])
  })

  it('行号越界原样返回', () => {
    expect(replaceFigSuggestion(md, 99, { src: 'x', alt: '', caption: '', figureSource: '' })).toBe(md)
  })
})
