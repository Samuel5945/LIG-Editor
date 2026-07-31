import { describe, expect, it } from 'vitest'
import { cardsCaptionMessages, chatContext, freeChatSystemPrompt } from '../prompts'

describe('chatContext', () => {
  it('空内容返回空串（不注入空块）', () => {
    expect(chatContext('article', '')).toBe('')
    expect(chatContext('cards', '  \n ')).toBe('')
  })

  it('正文/贴图各带对应标注，内容去首尾空白', () => {
    const a = chatContext('article', '\n# 标题\n正文段落\n')
    expect(a).toContain('正文 article.md')
    expect(a).toContain('<工程上下文')
    expect(a).toContain('# 标题\n正文段落')
    expect(a.endsWith('</工程上下文>\n')).toBe(true)

    const c = chatContext('cards', '格式：公众号贴图')
    expect(c).toContain('贴图卡片文案 cards.json')
  })
})

describe('freeChatSystemPrompt', () => {
  it('声明了工程上下文由系统自动附带，避免模型说没看到内容', () => {
    const p = freeChatSystemPrompt(null)
    expect(p).toContain('<工程上下文>')
    expect(p).toContain('不要说「没看到内容」')
  })
})

describe('cardsCaptionMessages', () => {
  it('携带卡片文案，要求话题标签且只输出纯文本', () => {
    const msgs = cardsCaptionMessages('[卡片JSON]', 'xhs', null)
    const user = msgs[1].content
    expect(user).toContain('[卡片JSON]')
    expect(user).toContain('#话题')
    expect(user).toContain('纯文本')
  })

  it('公众号/小红书标签数量与风格不同', () => {
    const xhs = cardsCaptionMessages('x', 'xhs', null)[1].content
    const wechat = cardsCaptionMessages('x', 'wechat', null)[1].content
    expect(xhs).toContain('8-10 个')
    expect(wechat).toContain('3-5 个')
  })
})
