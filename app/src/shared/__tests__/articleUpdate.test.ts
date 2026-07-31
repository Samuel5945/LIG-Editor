import { describe, expect, it } from 'vitest'
import { parseArticleUpdate } from '../articleUpdate'

describe('parseArticleUpdate', () => {
  it('解析指令块并从可见文本剥离', () => {
    const md = '# 标题\n\n## 一、小节\n\n正文段落。'
    const text = `给小标题加了序号。\n\`\`\`article-update\n${md}\n\`\`\``
    const { cleaned, update, pending } = parseArticleUpdate(text)
    expect(update).toBe(md)
    expect(cleaned).toBe('给小标题加了序号。')
    expect(pending).toBeUndefined()
  })

  it('保留正文内的注释行与图片行', () => {
    const md = '段落一。\n\n<!-- fig-suggest: 画面 | 图注 -->\n\n![图](assets/a.png)'
    const { update } = parseArticleUpdate(`\`\`\`article-update\n${md}\n\`\`\``)
    expect(update).toBe(md)
  })

  it('指令块未闭合（流式中途）→ pending，可见文本收起长文', () => {
    const { cleaned, update, pending } = parseArticleUpdate(
      '改了两处。\n```article-update\n# 标题\n\n正文写到一半'
    )
    expect(pending).toBe(true)
    expect(update).toBeUndefined()
    expect(cleaned).toBe('改了两处。')
  })

  it('空指令块静默容错，无指令时原样透传', () => {
    expect(parseArticleUpdate('```article-update\n\n```').update).toBeUndefined()
    const plain = '普通回复，没有指令。'
    expect(parseArticleUpdate(plain)).toEqual({ cleaned: plain })
  })
})
