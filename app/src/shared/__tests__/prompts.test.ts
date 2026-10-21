import { describe, expect, it } from 'vitest'
import {
  cardsCaptionMessages,
  chatContext,
  coverHtmlBriefMessages,
  coverHtmlMessages,
  coverPromptMessages,
  freeChatSystemPrompt
} from '../prompts'

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

describe('coverHtmlMessages（路径三：AI 写封面 HTML）', () => {
  const text = coverHtmlMessages('深色科技风，一台老电脑开机', null, null).map((m) => m.content).join('\n')

  it('画布按传入尺寸锁死，并禁掉整页高度写法', () => {
    expect(text).toContain('width:1175px;height:500px;margin:0;overflow:hidden')
    expect(text).toContain('禁止 height:100vh')
  })

  it('写清后台只采纳横图、1:1 从右侧裁走（否则模型会把关键信息放左下）', () => {
    expect(text).toContain('只采纳这一张横图')
    expect(text).toContain('从横图**右侧**裁走')
  })

  it('改一版时把上一版源码带进上下文', () => {
    const edit = coverHtmlMessages('标题再大一点', '<html>旧版</html>', null).map((m) => m.content).join('\n')
    expect(edit).toContain('<现有源码>')
    expect(edit).toContain('<html>旧版</html>')
  })
})

describe('coverHtmlBriefMessages（HTML 直渲那条路的「从正文提取」）', () => {
  const text = coverHtmlBriefMessages('# 标题\n\n正文', null, '#0d9488').map((m) => m.content).join('\n')

  it('出的是设计指令：要标题文案与配色，且明确不是生图提示词', () => {
    expect(text).toContain('封面设计指令')
    expect(text).toContain('不是生图提示词')
    expect(text).toContain('主标题文案')
    expect(text).toContain('#0d9488')
  })

  it('与生图那条分工不串：生图提示词禁止画面出现文字，设计指令反而要求写标题', () => {
    const gen = coverPromptMessages('# 标题\n\n正文', null).map((m) => m.content).join('\n')
    expect(gen).toContain('不出现任何文字')
    expect(text).not.toContain('不出现任何文字')
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
