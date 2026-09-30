import { describe, it, expect } from 'vitest'
import { countWords } from '../wordCount'

/**
 * 字数口径单源回归（编辑器「本文 N 字」胶囊、工程封面墙、导出步共用同一函数）：
 * 锁两条语义——① Markdown/HTML 标记与代码块不计字；② CJK 逐字记 1、连续西文/数字记 1 词。
 * 有人把列表侧改成 s.length 或另抄一套正则，这里会立刻红。
 */
describe('countWords 字数口径', () => {
  it('标题井号、加粗星号、列表横线不计字', () => {
    expect(countWords('# 你好世界')).toBe(4)
    expect(countWords('**重点**与普通段落')).toBe(7)
    expect(countWords('- 列表项\n- 另一项')).toBe(6)
  })

  it('链接只算锚文本，图片整体不计，代码块不计', () => {
    expect(countWords('看[官网](https://example.com)吧')).toBe(4)
    expect(countWords('![](assets/a.png)图前文字')).toBe(4)
    expect(countWords('前\n```js\nconst a = 1\n```\n后')).toBe(2)
  })

  it('CJK 逐字记 1，连续西文/数字记 1 词', () => {
    expect(countWords('AI 提效 3 倍')).toBe(5) // AI + 3 各 1 词，提效倍 3 字
    expect(countWords('Hello world')).toBe(2)
    expect(countWords('GPT-5 发布')).toBe(4) // 连字符按标记剥掉 → GPT / 5 两个西文 token + 2 汉字
  })

  it('空输入与缺字段不炸（主进程列表侧可能传 undefined）', () => {
    expect(countWords('')).toBe(0)
    expect(countWords(undefined as unknown as string)).toBe(0)
  })
})
