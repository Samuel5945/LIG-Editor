import { readFileSync, writeFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { mdToDoc } from '../markdown'
import { docToPlatformHtml, wrapPlatformPage } from '../platformHtml'
import { resolveArticleTheme } from '../categoryThemes'
import { extractTitle } from '../exportHtml'

const PROJ =
  'C:/Users/PC/Desktop/tuwen-editor/workspace/未分类/2026系统升级大比拼：MagicOS 11 vs 鸿蒙7'
const OUT = 'C:/Users/PC/Desktop/qwen-0922-eval/artifacts'

const FULL_SAMPLE = [
  '# 一级标题',
  '',
  '正文段落，带 **加粗** 与 <span style="color:#ff0000">手动红字</span>。',
  '',
  '## 01 二级标题（自动序号）',
  '',
  '> 引用一行',
  '',
  '---',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 甲 | 1 |',
  '',
  '![单图](assets/a.png)',
  '<!-- caption: 单图图注 -->',
  '',
  '<!-- gallery: swipe-h -->',
  '![图一](assets/b.png)',
  '![图二](assets/c.png)',
  '<!-- caption: 图集注 -->',
  '<!-- /gallery -->'
].join('\n')

describe('artifact dump', () => {
  it('writes real-project and full-sample artifacts for all three platforms', () => {
    const doc = mdToDoc(readFileSync(`${PROJ}/article.md`, 'utf8'))
    const meta = JSON.parse(readFileSync(`${PROJ}/project.json`, 'utf8'))
    const theme = resolveArticleTheme(meta, [])
    const title = extractTitle(doc, meta.name)
    for (const p of ['toutiao', 'zhihu', 'baijiahao'] as const) {
      writeFileSync(
        `${OUT}/article-${p}.html`,
        wrapPlatformPage(docToPlatformHtml(doc, (s) => s, theme, p), title),
        'utf8'
      )
    }
    const sampleDoc = mdToDoc(FULL_SAMPLE)
    const sampleTheme = resolveArticleTheme({ category: '未分类' }, [])
    for (const p of ['toutiao', 'zhihu', 'baijiahao'] as const) {
      writeFileSync(
        `${OUT}/sample-${p}.html`,
        wrapPlatformPage(docToPlatformHtml(sampleDoc, (s) => s, sampleTheme, p), '全块类型样本'),
        'utf8'
      )
    }
    expect(docToPlatformHtml(sampleDoc, (s) => s, sampleTheme, 'baijiahao')).toBe(
      docToPlatformHtml(sampleDoc, (s) => s, sampleTheme, 'zhihu')
    )
  })
})
