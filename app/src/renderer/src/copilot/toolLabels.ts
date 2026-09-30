/**
 * 工具中文名单源：模型侧工具名 → 作者看得懂的动作名。
 * 对话里的工具调用日志卡、推送确认卡、收尾提示共用这一张表（禁各处再抄一份）。
 */
export const TOOL_LABELS: Record<string, string> = {
  list_projects: '查询工程列表',
  create_project: '新建工程',
  set_project_category: '迁移工程分类',
  get_project: '读取工程',
  read_article: '读取正文',
  write_article: '覆写正文',
  patch_article: '修改正文',
  save_ideas: '保存选题',
  save_review: '写入审阅报告',
  set_titles: '写入标题候选',
  set_theme: '调整排版参数',
  save_theme_preset: '保存分类主题',
  render_figure: '渲染图表',
  generate_image: 'AI 生图',
  import_image: '导入图片',
  set_cover: '设置封面',
  schedule_set: '设置排期',
  export_html: '导出 HTML',
  export_docx: '导出 Word',
  export_pdf: '导出 PDF',
  push_draft: '推送公众号草稿',
  push_cards: '推送贴图草稿'
}
