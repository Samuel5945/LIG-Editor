/**
 * 预览 iframe 滚动条规范（2026-10-01 滚动条专项；四修按页面深浅分档）。
 * srcDoc iframe 是独立文档，主窗口的全局 CSS 与 CSS 变量都进不去——导出预览 /
 * 主题导入预览里露出的 Chromium 默认粗灰条就是这么来的，得把同一套「内嵌细胶囊」注进去。
 *
 * iframe 读不到 `--scrollbar`，所以只能把颜色写死：浅页用深灰、深页（公众号夜间配色）
 * 用浅灰。用户指出的「导出预览夜间有问题」就是原来只给一支中立灰——压在夜读深底上看不见。
 * 静置 alpha .16、hover/active .34，与主窗口同一档（主窗口同值见 index.css 的 --sb-a）。
 *
 * ⚠ 这里也不能写 scrollbar-width / scrollbar-color：Chromium 一旦见到标准属性就整个文档
 * 停用 ::-webkit-scrollbar 自定义（二修的起因），预览里会退回默认粗灰条。
 *
 * 只影响应用内预览，不写入任何真实导出产物（导出文件由 main 进程另行生成）。
 */
function previewScrollCss(dark: boolean): string {
  const rgb = dark ? '176,184,198' : '104,112,124'
  return (
    '<style>' +
    '::-webkit-scrollbar{width:8px;height:8px}' +
    '::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}' +
    `::-webkit-scrollbar-thumb{background:rgba(${rgb},.16);border:2.5px solid transparent;border-radius:999px;background-clip:padding-box}` +
    `::-webkit-scrollbar-thumb:hover,::-webkit-scrollbar-thumb:active{background:rgba(${rgb},.34);border:2.5px solid transparent;background-clip:padding-box}` +
    '::-webkit-scrollbar-button{display:none}' +
    '</style>'
  )
}

/** @param dark 预览页是不是深底（公众号「夜间配色」变体）；平台预览与主题导入预览固定浅页 */
export function withPreviewScrollCss(html: string, dark = false): string {
  const css = previewScrollCss(dark)
  if (html.includes('</head>')) return html.replace('</head>', css + '</head>')
  return css + html
}
