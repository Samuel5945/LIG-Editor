import { THEME_FIELD_LABELS, THEME_NUM_RANGES } from './categoryThemes'
import { THEME_FIELD_SPECS, THEME_GROUPS, type ThemeFieldSpec } from './themeFields'

/**
 * Agent 手册（get_guide 工具的唯一正文来源）
 *
 * 为什么要单独一层：工具清单每次连接都全量下发（实测 27 个工具 18,404 字符，set_theme 一条占 25%），
 * 而「取值范围、枚举含义、流程编排」这些只在真要动那一轮才需要。清单里只留名字 + 一句话 +
 * 「先查手册」，长文按 topic 取，宿主每次请求就不必背着整本手册花钱。
 *
 * 排版字段表由 themeFields 元数据生成：面板、校验、工具描述、导出预览本来已共用这张表，
 * 手册再手抄一遍就是第五份真相（历史上「三处同改」的回归点就是这么来的）。
 */

export type AgentGuideTopic = 'pipeline' | 'markdown' | 'theme' | 'cards' | 'publish'

export const GUIDE_TOPICS: AgentGuideTopic[] = ['pipeline', 'markdown', 'theme', 'cards', 'publish']

export const GUIDE_LABELS: Record<AgentGuideTopic, string> = {
  pipeline: '创作全流程与工具编排',
  markdown: '正文 markdown 子集',
  theme: '排版字段表与取值口径',
  cards: '贴图卡组字段与出图流程',
  publish: '导出与公众号推送前置'
}

const kindValue = (f: ThemeFieldSpec): string => {
  const bits: string[] = []
  if (f.kind === 'color') bits.push('#rrggbb')
  if (f.kind === 'number') {
    const r = THEME_NUM_RANGES[f.key]
    bits.push(r ? `${r[0]}-${r[1]}${f.unit ?? ''}` : `数值${f.unit ?? ''}`)
  }
  if (f.options?.length) bits.push(f.options.map((o) => `${o.value}=${o.label}`).join(' | '))
  if (f.placeholder) bits.push(`例 ${f.placeholder}`)
  return bits.join('；')
}

/** 排版字段表：按面板分组列出键名、中文名、取值口径与单行提示 */
export function themeFieldGuide(): string {
  const lines: string[] = [
    'set_theme（单工程覆盖）与 save_theme_preset（整套分类主题）用的是同一批键；两者差别只在写入位置。',
    '语义：不传 = 保持盘上原值；传 null = 恢复「跟随分类主题」；显式值 = 覆盖。哨兵值（如 bodyBg:"none"、h2Num:"none"）是「显式关闭」，和 null 不是一回事。',
    '数值越界会被夹进区间，夹取结果写在返回的 hint 里——必须照实转述给作者，不能说成「已按你要的值设好」。',
    '非法值（色值不是 #rrggbb、枚举写了个不存在的形态）不落盘也不装成功，会进 ignoredKeys / droppedKeys。'
  ]
  for (const g of THEME_GROUPS) {
    const fields = THEME_FIELD_SPECS.filter((f) => f.group === g.id)
    if (!fields.length) continue
    lines.push(`\n【${g.label}】`)
    for (const f of fields) {
      const label = THEME_FIELD_LABELS[f.key] ?? f.key
      const value = kindValue(f)
      const sentinel = f.sentinel ? `另可传 ${f.sentinel.value}=${f.sentinel.label}` : ''
      const hint = f.hint ? `—— ${f.hint}` : ''
      lines.push(`- ${f.key}（${label}）${value ? `：${value}` : ''}${sentinel ? `；${sentinel}` : ''}${hint}`)
    }
  }
  lines.push('\n要点：accent 是唯一会「重链」其它字段的键——改了它，标题装饰色/引用边线/加粗词色会一起跟着变；' +
    '不想跟着变的字段要显式点名覆盖（headingColor / strongColor / quoteBorder / h2Border 等）。')
  return lines.join('\n')
}

const GUIDE_BODIES: Record<AgentGuideTopic, () => string> = {
  pipeline: () =>
    `创作流程（本应用不代跑 LLM：*_prompt 只给提示词，用你自己的模型跑完，再调落盘工具写回）
1 选题：brainstorm_prompt(material) → 模型出 5 张选题卡 JSON → save_ideas 入库
2 立项：schedule_idea(index,date) 从选题库立项并排期；或 create_project(name,category) 直接建一个
3 大纲：outline_prompt(project,ask,material) → 模型出大纲；正文已成稿要反推/维护大纲时：read_article 拿正文 → 忠实提炼（# 标题 + ## 小节，节下一句说明）→ save_outline 写 outline.md——只写大纲文件，绝不改 article.md
4 正文：article_prompt(project,outline) → 模型出 markdown 全文 → write_article 落盘（语法见 get_guide markdown）
5 配图：render_figure（代码画图，可复现）/ generate_image（AI 文生图）/ import_image（本机现成图）
6 排版：set_theme 改单个工程；整套存成分类主题用 save_theme_preset；先 list_themes 读现状，切换用 set_active_theme（字段表见 get_guide theme）
7 自查：render_preview 把成品截图发回给你自己看——改完再截一次对比，这是唯一能确认「设了到底有没有变化」的路径
8 审阅与标题：review_prompt → 模型 → save_review；titles_prompt → 模型 → set_titles
8.5 爆款拆解：teardown_prompt（传 article 拆外部文章，缺省拆当前正文）→ 模型 → save_teardown 写 teardown.md；用户要借骨架写新文时把「- 骨架：」行转成大纲调 save_outline
9 封面：render_cover_template（模板直出，中文不会糊）。只渲一张 2.35:1 主图，1:1 是从它裁出来的一段——后台只采纳横图，另外排一版方图它不认，所以构图要让右半单独裁出来也成立（focal 调取哪一段，panel 保底可读性，decor 关装饰，prompt 一步生底图）。要完全自主排版就手写 covers/*.html 再 render_cover_html
10 交付：export_html / export_docx / export_pdf / export_longimage / export_design_longimage / push_draft / push_cards（前置见 get_guide publish）
局部改动（改一句、某段压短、加序号、润色某节）用 patch_article 精准替换，别重写全文；只有整篇重写或大幅结构调整才 write_article。
状态由落盘动作自动推进，不用手动设：落正文→撰写，存审阅报告→审阅，出交付物或推送成功→已成稿。
风格方法论交给 Skill：list_skills 看有什么，save_skill 写一套，set_project_skill 挂到工程——挂载后 outline/article/review/titles 各提示词会自动带上它全文。`,

  markdown: () =>
    `正文 markdown 子集（write_article 覆写、patch_article 局部替换，都作用在 article.md）
标题 # 一级 / ## 二级 / ### 三级；段落之间空一行；**加粗**；> 引用；--- 分隔线；表格用标准管道语法（外观由主题的 tableStyle / tableHeaderBg / tableBorder 控制）。
图片：![alt](assets/x.png)，紧跟一行图注 <!-- caption: 图注文字 -->。
配图占位：<!-- fig-suggest: 详细画面描述 | 简短图注 -->——它是编辑器里的占位卡，导出时不出现；要真出图就 render_figure / generate_image 之后，把 ![alt](路径) 写回正文替换掉占位。
手动样式（与编辑器选中片段设置同源，编辑器和公众号导出都渲染）：
<span style="color:#e63946;background-color:#fef3c7;font-size:18px">文本</span>
color=字色，background-color=背景高亮，font-size=字号（12-24px），可叠加 **加粗**。整体配色优先用 set_theme，别逐段手写 span。
公众号动效（SVG/SMIL 无脚本，点击揭晓/对照切换/展开/自动动画才用，别为装饰硬加）：单独一行 <!-- motion: {"body":"…","still":"静态结论文字","caption":"图注","viewBox":"0 0 480 190"} -->，JSON 必须单行。
body 是 SVG 内片段（不含根 svg 标签）：可用 g/rect/circle/ellipse/line/path/text/tspan/defs/渐变/clipPath/use/animate/set/animateTransform；点击触发 begin="热区id.click"（热区=透明矩形 <rect x="0" y="0" width="480" height="190" fill="#000" fill-opacity="0" pointer-events="visiblePainted" id="go"/>），显隐用 <g visibility="hidden"><set attributeName="visibility" to="visible" begin="go.click" fill="freeze"/>…</g>，自动循环用 begin="0s" repeatCount="indefinite"，互斥切换=各组 visibility 初始一显多隐 + set 切。颜色一律写令牌 {{accent}}/{{ink}}/{{bg}}/{{muted}}（导出按当前主题解析，别写死色值）；文字用 <text> 并继承根画布字体。禁止 script/foreignObject/image/style 属性/on* 事件/外链 href/注释，文本里的 & 写成 &amp;。still 必填：动效内容的普通文字版，导出时始终小字随行（客户端剥 SVG 读者也有得读）；关键信息不能只藏在点击后。多块/多次复制的 id 冲突不用管，导出自动加前缀。真正增高展开：加 "height":58（根画布固定高、无 viewBox，坐标按手机宽容器设计），body 里放 <animate attributeName="height" from="58" to="187" begin="go.click" dur=".38s" fill="freeze"/> 直接推低后文。滚动吸附/长按/连续拖动是网页手势，公众号正文不成立，别做。写完用 render_preview 自查。
路径一律写工程内相对路径（assets/…），绝对路径不会被打包进导出物。`,

  theme: () => themeFieldGuide(),

  cards: () =>
    `贴图卡组（落盘 cards.json，画布统一 3:4 竖版 1242×1656，两种风格共用）
deck：format（wechat 公众号贴图=书面克制 / xhs 小红书贴图=口语活泼）、accent（#rrggbb，覆盖强调色）、caption（发布配文，转平台后作废需重生成）、cards（数组顺序即读者翻页顺序）。
每张卡：title（必填，封面卡是大标题）、body（必填，\\n 分行，支持 **加粗**）、tag（封面角标文案，仅封面卡生效，空=平台默认）、bgPrompt（AI 背图画面描述，空=纯排版底色）、bgImage（背图 assets/ 相对路径）、bgOpacity（0-100，越大背图越清晰、文字遮罩越淡，缺省 15）、dark（背图偏深时切浅色配色板）、fontScale（80-150，只缩字号不动版式）、mode（layout 排版+背图 / ai 整卡 AI 成图 / design 设计卡）、aiImage（mode=ai 时的成品图路径）、designHtml（mode=design 的卡面设计稿）、numbered（内容卡每行前加强调色序号，封面卡不生效）、png（渲染产物，别自己编，交 render_card 回写）。
设计卡（mode=design，排版放开）：designHtml 传 body 内 HTML 片段，全量 CSS 生效（flex/grid/渐变/色块/图文混排，无净化约束），画布 1242×1656 固定，正文建议 ≥30px；配图写 assets/ 相对路径直接嵌；同步内联 script 可用但禁动画/异步等待（截图只等 500ms）；无自动缩字保护，溢出自己控制并 render_preview target:card 自查。同一组里设计卡与排版卡可混排，推送/存档/互切不受影响。
流程：write_cards 建组（覆盖式，不是追加）→ render_card all:true 出图 → read_cards 核对 rendered_count → push_cards 推送（最多 20 张，要求全部已出图）。
转风格或大改前先 write_cards 带 archive:true 存一份（写到 cards-风格.json，当前 cards.json 不动），之后可用 read_cards 的 archive 读回对照。
落盘按字段白名单重建：白名单外的键会被丢弃，write_cards 返回的 droppedKeys 必须照实转述，不得声称已生效。
转风格前先 read_cards 存一份、或让作者在界面上转（存档在 cards-<format>.json，用 read_cards 的 archive 参数读）。`,

  publish: () =>
    `导出与推送前置
账号：应用「设置 → 推送设置」里一个公众号账号一条（AppID / AppSecret）；「哪个分类用哪个号」在分类管理里绑定，未绑定的分类走默认账号。
IP：本机公网 IP 必须已加入该公众号后台的 IP 白名单，每个账号各自加一遍（设置页「获取本机公网 IP」一键复制）。
push_draft：正文本地图片自动上传微信 CDN、封面传永久素材、draft/add 入草稿箱；variant 只能 day/night 二选一——公众号不吃 prefers-color-scheme，auto 只适合自有网页/博客的 export_html。
push_cards：贴图组的图片消息形态，需全部卡片已渲染、最多 20 张，配文取 deck.caption、标题取封面卡标题。
export_html：落工程根 article.html（公众号排版）或 article-<platform>.html（platform=zhihu/toutiao/baijiahao，按各平台编辑器的净化规则简化排版，图片仍是相对路径，作为多平台分发前的稿源）。
export_docx / export_pdf：落工程「交付/」目录，给甲方审稿用 docx（可继续编辑），存档打印用 pdf；两者成功即把工程推进「已成稿」。
export_longimage：整文竖图 PNG 落「交付/长图/」（750px 宽 2 倍超采样，与导出预览同源同折行），超长按段落边界自动分段、files 数组逐张返回；发朋友圈/小红书这类只收图的渠道用它。
export_design_longimage：AI 自由设计的精美竖图——传自写 HTML（全量 CSS：flex/grid/渐变/色块卡片/杂志式图文混排，无净化约束），750px 宽画布、设计坐标即输出像素，落「交付/长图/」。
设计长图口径：html 传 body 内片段（根容器自带背景色，别传完整文档）；工程配图写 assets/ 相对路径直接嵌；顶层块级元素是分段安全单元，整稿尽量控制在 12288px 高内（超了自动分段）；同步内联 script 可用但禁动画/异步等待（截图不等它）；字体用本机栈（Microsoft YaHei / PingFang SC / system-ui）；出图前可先 render_preview 看排版自查。设计贴图卡（mode=design）是同一思路的固定画布版，见 cards 段。
任何写操作后 GUI 会热载；推送/导出失败要如实报错误文本，不要说成「已入草稿」。`
}

/** 取一册手册正文；topic 不在册时返回 null（调用方负责报可查清单，别静默给空文本） */
export function agentGuide(topic: string): string | null {
  const hit = GUIDE_TOPICS.find((t) => t === topic)
  if (!hit) return null
  return GUIDE_BODIES[hit]()
}
