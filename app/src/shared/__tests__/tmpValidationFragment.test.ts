import { writeFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { mdToDoc } from '../markdown'
import { docToPlatformHtml } from '../platformHtml'
import { resolveArticleTheme } from '../categoryThemes'

const MD = [
  '# 画像验证一级标题',
  '',
  '正文段落，带 **加粗强调** 与 <span style="color:#ff0000">手动红字</span>。',
  '',
  '## 01 二级标题（自动序号）',
  '',
  '### 三级标题',
  '',
  '> 引用一行，应出现平台灰竖条',
  '',
  '---',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 甲 | 1 |',
  '',
  '![验证图](https://www.baidu.com/img/PCtm_d9c8750bed0b3c7d089fa7d55720d6cf.png)',
  '<!-- caption: 单图图注应居中 -->',
  '',
  '<!-- gallery: swipe-h -->',
  '![图一](https://www.baidu.com/img/PCtm_d9c8750bed0b3c7d089fa7d55720d6cf.png)',
  '![图二](https://www.baidu.com/img/PCtm_d9c8750bed0b3c7d089fa7d55720d6cf.png)',
  '<!-- caption: 图集注应居中 -->',
  '<!-- /gallery -->',
  '',
  '　　全角空格缩进段'
].join('\n')

describe('validation fragment', () => {
  it('writes the toutiao fragment produced by the real code path', () => {
    const theme = resolveArticleTheme({ category: '未分类' }, [])
    const frag = docToPlatformHtml(mdToDoc(MD), (s) => s, theme, 'toutiao')
    writeFileSync(
      'C:/Users/PC/Desktop/qwen-0922-eval/artifacts/fragment-validation-toutiao.html',
      frag,
      'utf8'
    )
    expect(frag).toContain('<th><strong>列A</strong></th>')
  })
})
