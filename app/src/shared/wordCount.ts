/**
 * 正文字数口径单源（UI/UX PRD §5.3「本文 N 字」胶囊、§5.7 工程封面墙、导出步共用）。
 * 去掉 Markdown/HTML 标记后：CJK 每字记 1，连续西文/数字记 1 词。
 * 口径只在这里定义一次——渲染层实时统计与主进程列表统计必须调同一函数，
 * 否则会出现「列表 1200 字、打开后 1180 字」两套事实。
 */
export function countWords(md: string): number {
  const text = (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*`~|_-]+/g, ' ')
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const words = (text.match(/[A-Za-z0-9]+/g) || []).length
  return cjk + words
}
