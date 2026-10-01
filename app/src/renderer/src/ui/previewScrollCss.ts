/**
 * 预览 iframe 滚动条规范（2026-10-01 滚动条专项）。
 * srcDoc iframe 是独立文档，页面全局 CSS 进不去——导出预览 / 主题导入预览里
 * 露出的 Chromium 默认粗灰滚动条就是这么来的。把同一套「内嵌细胶囊」样式
 * 注进预览 HTML：中立灰 alpha .42（日间白底与夜间深底上都成立），与主窗口同一档细胶囊。
 * ⚠ 这里也不能写 scrollbar-width / scrollbar-color——同 index.css，标准属性会让整个
 * 文档的 ::-webkit-scrollbar 失效，预览里就又是默认粗灰条（本次二修的起因）。
 * 只影响应用内预览，不写入任何真实导出产物（导出文件由 main 进程另行生成）。
 */
const PREVIEW_SCROLL_CSS = `<style>
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(128,132,140,.42);border:2.5px solid transparent;border-radius:999px;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:rgba(128,132,140,.72);border:2.5px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-button{display:none}
</style>`

export function withPreviewScrollCss(html: string): string {
  if (html.includes('</head>')) return html.replace('</head>', `${PREVIEW_SCROLL_CSS}</head>`)
  return PREVIEW_SCROLL_CSS + html
}
