import type { ChatMessage, WebSearchResult } from './types'

/**
 * 副驾驶五能力提示词（M5；M8 移入 shared 供主进程无头能力核复用）
 * 输出契约尽量结构化：脑暴/标题走 JSON 围栏，生成/修改/审阅走受限 markdown 子集
 */

const SUBSET_RULES = `文章只允许使用以下 markdown 子集：
- 标题：# ## ###（最多三级）
- 段落与 **加粗**
- 引用：> 开头
- 分隔线：---
- 需要配图的位置插入单独一行：<!-- fig-suggest: 详细画面描述 | 简短图注 -->
  画面描述 30-60 字：写清主体、场景、构图视角、情绪氛围，紧扣所在段落内容，抽象概念落到具体可画的视觉元素；图注 10 字内
禁止使用列表、代码块、斜体、表格、链接。正文用中文口语化表达。`

export function systemPrompt(skillContent: string | null): string {
  const now = new Date()
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  let base = `你是一位公众号图文创作副驾驶，帮助作者脑暴选题、撰写文章、修改润色、审阅打磨、起标题。始终用中文回答，语言简洁不客套。
当前时间：${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${week} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}。涉及时效性内容请以此为准，不要使用训练数据里过时的时间认知。`
  if (skillContent) {
    base += `\n\n以下是挂载的写作风格 Skill，创作时必须遵循其中的风格与方法论：\n<skill>\n${skillContent}\n</skill>`
  }
  return base
}

/**
 * 自由对话专用系统提示：在通用提示基础上追加「对话安装 Skill」指令协议（M9 反馈迭代）
 * 模型识别到安装意图时输出 skill-install 指令块，渲染层解析后弹确认卡片落地执行
 */
export function freeChatSystemPrompt(skillContent: string | null): string {
  return `${systemPrompt(skillContent)}

每轮用户消息前可能自动附带 <工程上下文>（作者当前打开工程的正文或贴图卡片文案，系统自动附上，不是作者粘贴的）。回答与内容相关的问题时直接参考它，不要说「没看到内容」或让作者再发一遍。

你运行在「图文编辑器」桌面应用内，它有一个 Skill 技能库（skills/<名称>/SKILL.md）。当用户明确要求把某个 Skill 添加/安装/下载到编辑器时，先用一两句话说明这个 Skill 是什么，然后在回复最末尾单独输出一个指令块，格式严格如下（JSON 单行）：
\`\`\`skill-install
{"source":"github","ref":"owner/repo 或完整链接","name":"可选目录名"}
\`\`\`
规则：
- source 四选一：github（GitHub 仓库名或链接）/ url（指向 .md 文件的直链）/ path（用户给的本地绝对路径）/ inline（用户把 SKILL.md 内容直接粘在对话里）
- inline 时必须给 name（英文短横线小写）且不要复述粘贴内容，系统会直接取用户消息原文；其余来源必须给 ref
- 只在用户明确请求安装时输出指令块；闲聊提到某个 skill 不算；一次只输出一个指令块
- 输出指令块后不要再跟任何文字，系统会在界面上展示确认卡片由用户点击安装

当作者的工程是贴图形态（工程上下文是贴图卡片文案）且明确要求换贴图的强调色/配色（如「换成橙色系」「强调色改绿色」）时，用一句话说明选色理由，然后在回复最末尾单独输出：
\`\`\`cards-accent
{"accent":"#ff6b35"}
\`\`\`
规则：accent 只能是十六进制色值（#rrggbb）或字符串 default（恢复平台默认色）；只在用户明确要求换色时输出；一次只输出一个；输出后不要再跟文字，系统会展示确认卡片由用户点击应用。

当作者的工程是文章形态（工程上下文是正文 article.md）且明确要求修改正文（如「给小标题加序号」「把第二段改短」「润色一下」）时，先用一两句话说明改了什么，然后在回复最末尾单独输出指令块，里面是修改后的完整正文：
\`\`\`article-update
# 修改后的完整正文 markdown
\`\`\`
规则：
- 必须基于工程上下文里的正文输出修改后的全文，未改动的段落原样保留，不要只输出改动部分
- 只允许 markdown 子集：# ## ### 标题、段落与 **加粗**、> 引用、--- 分隔线；禁止列表/代码块/斜体/表格/链接
- 图片行（![…](…)）和注释行（<!-- caption/figure-source/gallery/fig-suggest … -->）逐字保留在原位置，不得增删改
- 只在用户明确要求修改正文时输出；讨论、提建议、问意见都不算；一次只输出一个指令块
- 输出指令块后不要再跟文字，系统会展示确认卡片由用户点击应用到编辑器`
}

/** 对话自动附带的工程上下文块：正文或贴图文案（只拼当轮 API 请求，不进可见历史/落盘会话） */
export function chatContext(kind: 'article' | 'cards', body: string): string {
  if (!body.trim()) return ''
  const label = kind === 'article' ? '正文 article.md' : '贴图卡片文案 cards.json'
  return `<工程上下文 说明="作者当前打开工程的${label}，系统自动附带">
${body.trim()}
</工程上下文>
`
}

/** 联网搜索结果→提示词上下文块（空结果返回空串）；带发布时间/正文节选时一并呈现 */
export function webContext(results: WebSearchResult[]): string {
  if (results.length === 0) return ''
  const items = results
    .map((r, i) => {
      const date = r.date ? `（发布时间：${r.date}）` : '（发布时间未知）'
      const body = r.content ? `${r.snippet}\n页面正文节选：${r.content}` : r.snippet
      return `${i + 1}. ${r.title}${date}\n${body}\n来源：${r.url}`
    })
    .join('\n\n')
  return `\n<联网搜索结果>\n${items}\n</联网搜索结果>\n以上是刚刚检索到的实时资讯，优先基于它们回答时效性问题；引用时可注明来源。\n`
}

/** 脑暴：素材 → 选题卡 JSON（web 为可选联网搜索结果） */
export function brainstormMessages(
  material: string,
  userAsk: string,
  skill: string | null,
  web: WebSearchResult[] = []
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `请基于以下素材脑暴 5 个公众号选题。${userAsk ? `补充要求：${userAsk}` : ''}
${webContext(web)}
<素材>
${material || '（无素材，请根据补充要求与联网结果自由发挥）'}
</素材>

严格输出一个 \`\`\`json 围栏包裹的数组，每个元素形如：
{"title":"选题标题","angle":"切入角度","audience":"目标读者","score":8,"reason":"为什么可能爆"}
score 为 1-10 的爆款潜力分。围栏外不要输出任何其他文字。`
    }
  ]
}

/** 生成第一步：大纲（web 为可选联网搜索结果） */
export function outlineMessages(
  ask: string,
  material: string,
  skill: string | null,
  web: WebSearchResult[] = []
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `请为下面的选题写一份公众号文章大纲（只要大纲，不要正文）：

选题/要求：${ask}
${webContext(web)}${material ? `\n参考素材：\n${material}\n` : ''}
输出格式：markdown，一级标题为拟定文章标题，然后 4-8 个二级标题小节，每节下用一两句话说明写什么。`
    }
  ]
}

/** 生成第二步：按确认的大纲出全文（流式落编辑器） */
export function fullArticleMessages(outline: string, skill: string | null): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `请按以下大纲撰写完整的公众号文章。

<大纲>
${outline}
</大纲>

${SUBSET_RULES}

直接输出文章正文（以 # 文章标题开头），不要任何解释或围栏。全文 1500-3000 字，至少插入 3 处 fig-suggest 配图占位。`
    }
  ]
}

/** 修改：选中片段 + 指令 → 只回改写结果 */
export function modifyMessages(selection: string, instruction: string, skill: string | null): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `请按指令改写下面这段文字。只输出改写后的文字本身，不要解释、不要围栏、不要引号包裹。保持原有的 markdown 语法风格。

指令：${instruction}

<原文>
${selection}
</原文>`
    }
  ]
}

/** 审阅：全文或选段 → 结构化报告（写入 review.md）；web 为可选联网搜索结果，事实核验以它为准 */
export function reviewMessages(
  article: string,
  skill: string | null,
  selection?: string,
  web: WebSearchResult[] = []
): ChatMessage[] {
  const factRule = web.length > 0
    ? '事实核验以上方联网搜索结果为准，但搜索结果本身也可能滞后或互相冲突：留意每条结果里的发布时间，优先采信时间最新的；若结果与文章说法冲突且无法确认孰新孰旧，不要断言文章有错，标注「建议人工核实」并附上冲突双方的说法与来源。'
    : '你的训练数据可能滞后，对时效性事实（版本号、发布时间、最新数据）不要断言有错，标注「建议人工核实」即可。'
  if (selection?.trim()) {
    return [
      { role: 'system', content: systemPrompt(skill) },
      {
        role: 'user',
        content: `请只审阅以下选段（摘自一篇公众号文章，全文其余部分不用管），输出结构化审阅报告。
${webContext(web)}
<选段>
${selection}
</选段>

${factRule}
输出 markdown 报告，第一行为「# 选段审阅报告」，必须包含这些二级标题分区：## 总评、## 问题清单、## 修改建议。
指出具体问题时，先用单独一行「> 原文：摘录的原文片段」引用（摘录 10-30 字，必须与选段逐字一致），再给出问题说明与改法。总评给出 1-10 分。`
      }
    ]
  }
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `请审阅以下公众号文章，输出结构化审阅报告。
${webContext(web)}
<文章>
${article}
</文章>

${factRule}
输出 markdown 报告，必须包含这些二级标题分区：## 总评、## 结构问题、## 事实与逻辑、## 风格与表达、## 修改建议。
指出具体问题时，先用单独一行「> 原文：摘录的原文片段」引用（摘录 10-30 字，必须与原文逐字一致），再给出问题说明与改法。总评给出 1-10 分。`
    }
  ]
}

/** 标题：全文 → 候选打分 JSON（入 project.json） */
export function titleMessages(article: string, skill: string | null): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `请为以下公众号文章起 6 个标题候选并打分。

<文章>
${article.slice(0, 4000)}
</文章>

严格输出一个 \`\`\`json 围栏包裹的数组，每个元素形如：
{"text":"标题","score":8.5,"reason":"好在哪/风险"}
score 为 1-10 分（可一位小数），按分数从高到低排列。围栏外不要输出任何其他文字。`
    }
  ]
}

/** 排版优化：不改内容，只整理排版（段落/小标题/重点加粗/分隔） */
export function polishLayoutMessages(article: string, skill: string | null): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `请对以下公众号文章做【排版优化】，要求：
- 不改写内容本身：不增删观点与事实，不换词造句（错别字可修）
- 长段拆短：每段不超过 3-4 行，一段只说一件事
- 结构清晰：合理增补/调整 ## 二级标题与 ### 三级标题，节奏拖沓处可加 --- 分隔线
- 重点突出：关键句用 **加粗**，金句可改成 > 引用，但全文加粗不超过 8 处
- 保留所有 <!-- fig-suggest: ... --> 占位行与图片语法，位置可微调到更合适的段落间

${SUBSET_RULES}

<文章>
${article}
</文章>

直接输出排版后的全文（以 # 文章标题开头），不要任何解释或围栏。`
    }
  ]
}

/** 按审阅报告修订：只输出「原文→替换」补丁对，本地精准覆盖，不重写全文 */
export function applyReviewMessages(article: string, review: string, skill: string | null): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `请根据审阅报告，为以下公众号文章生成精准修订补丁。不要重写全文，只针对报告点名的问题输出修改对。要求：
- 输出严格的 JSON 数组，每项为 {"old": "待替换的原文片段", "new": "替换后的片段"}
- old 必须与文章逐字一致（含标点与 markdown 语法），且在全文中唯一；若有重复风险就多包一句上下文
- 逐条落实报告指出的问题；无法核实的事实问题改为稳妥表述；报告未点名的部分不要出补丁
- 保留 <!-- fig-suggest: ... --> 占位行与图片语法，除非报告明确要求修改
- new 仅限排版子集：标题/段落/**加粗**/图片，不引入列表、代码块等其它语法

<文章>
${article}
</文章>

<审阅报告>
${review}
</审阅报告>

只输出 JSON 数组本身（以 [ 开头、] 结尾），不要任何解释或代码围栏。`
    }
  ]
}

/** AI 生图提示词优化（M9 反馈）：回读正文定位语境，把简短配图描述扩写成详细无歧义的文生图提示词 */
export function imagePromptMessages(desc: string, article: string, skill: string | null): ChatMessage[] {
  const context = article.trim()
    ? `这张图是下面文章的配图，先通读正文、定位这张图所在的语境，让画面呼应文章主题与该段落内容：

<正文>
${article.trim()}
</正文>

`
    : ''
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `${context}请把下面这句配图描述扩写成一段详细的文生图提示词（100-200 字）：

<描述>
${desc}
</描述>

要求：
- 写清主体（是什么、数量、动作）、场景环境、构图视角、艺术风格、光线与配色、材质细节
- 消除歧义：多义词换成具体表述，抽象概念落到具体可画的视觉元素
- 画面中不要出现文字、字幕、水印（生图模型渲染文字容易出错）
- 风格与公众号配图定位协调：干净、现代、主体突出
- 只输出提示词本身一段话，不要解释、不要引号、不要围栏`
    }
  ]
}

/** 代码绘图（M6）：配图描述 → 自包含单文件 HTML（离屏渲染成 PNG 插入正文） */
export function figureHtmlMessages(desc: string, prevHtml: string | null, skill: string | null): ChatMessage[] {
  const task = prevHtml
    ? `请按以下要求修改现有图表 HTML：${desc}\n\n<现有源码>\n${prevHtml}\n</现有源码>`
    : `请为公众号文章配图编写一个图表页面：${desc}`
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `${task}

硬性要求：
- 输出完整的单文件 HTML（<!DOCTYPE html> 开头），样式全部内联，不引用任何外部资源（无 CDN、无网络字体、无外链图片），需要绘图能力用原生 Canvas/SVG/CSS 手写
- 画布尺寸固定：body 零边距（margin:0），根容器宽 900px，高度由内容自然撑开（目标 500–750px，接近 4:3 到 16:10 的横图），背景用浅色或深色纯色块，保证截图后直接可用
- 严禁 height:100vh / min-height:100vh / 整页垂直居中；内容从顶部自然向下排，图形区域要填满根容器宽度，不留大片空白；图例放顶部或底部横排，不要挤在右侧窄列
- 中文字体声明用系统字体栈（"Microsoft YaHei", sans-serif）；数据标注清晰可读，配色克制协调
- 所有动画禁用（页面加载完即为最终画面，会被离屏截图）
- 只输出 HTML 源码本身，不要任何解释或代码围栏`
    }
  ]
}

// ---------- 贴图（图片卡片）三向互转 ----------

const CARD_STYLE_RULES: Record<'wechat' | 'xhs', string> = {
  wechat:
    '风格：公众号图片消息。文案书面、克制、有信息量，不用 emoji、不带话题标签，尾卡用一句总结或金句收束',
  xhs: '风格：小红书图文。文案口语化、热情直接，适当用 emoji，封面标题要有钩子感，尾卡正文最后一行放 3-5 个话题标签（#开头、空格分隔）'
}

const CARD_JSON_RULES = `输出 JSON 数组，每张卡片一个对象：
[{"tag": "封面角标", "title": "卡片标题", "body": "正文要点，\\n 分行", "bgPrompt": "背图画面描述"}]
- 第一张是封面卡：title 为主标题（≤20 字），body 为一两行副标题；tag 为 4-8 字角标，紧扣主题（如「续航真相」「硬核科普」），忌用「干货分享」这类万能词；其余卡 tag 留空串
- 中间 4-7 张内容卡：每张一个要点，title ≤16 字，body 2-5 短行、全卡 ≤80 字，重点词用 **加粗**
- 最后一张是尾卡：总结收束
- bgPrompt：20-40 字的抽象/场景画面描述，不含任何文字元素，整组色调风格统一；背图只是氛围底图，不承担信息
只输出 JSON 数组本身（以 [ 开头、] 结尾），不要任何解释或代码围栏。`

/** 贴图生成：大纲或文章全文 → 卡片组 JSON */
export function cardsMessages(
  source: string,
  sourceKind: '大纲' | '文章',
  format: 'wechat' | 'xhs',
  skill: string | null
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `请把下面这份${sourceKind}提炼成一组图片卡片（竖版 3:4，逐张翻看）：

<${sourceKind}>
${source}
</${sourceKind}>

${CARD_STYLE_RULES[format]}

${CARD_JSON_RULES}`
    }
  ]
}

/** 贴图 → 文章：卡片文案扩写成完整公众号正文（进现有编辑器流程） */
export function cardsToArticleMessages(cardsText: string, skill: string | null): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `下面是一组图片卡片的文案（按顺序），请扩写成一篇完整的公众号文章，保持原有观点与结构，补充过渡、例证与细节：

<卡片文案>
${cardsText}
</卡片文案>

${SUBSET_RULES}

直接输出文章正文（以 # 文章标题开头），不要任何解释或围栏。全文 1500-3000 字，至少插入 3 处 fig-suggest 配图占位。`
    }
  ]
}

/** 贴图互转：公众号风 ⇄ 小红书风文案改写（张数不变，bgPrompt 照抄保留背图） */
export function cardsRestyleMessages(
  cardsText: string,
  target: 'wechat' | 'xhs',
  skill: string | null
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `下面是一组图片卡片文案，请改写成另一种平台风格，张数与顺序不变，每张的 bgPrompt 原样照抄：

<卡片文案>
${cardsText}
</卡片文案>

${CARD_STYLE_RULES[target]}

${CARD_JSON_RULES}`
    }
  ]
}

/** 贴图审阅：逐张点评文案与排版密度 → 结构化报告（写入 cards-review.md） */
export function cardsReviewMessages(
  cardsText: string,
  format: 'wechat' | 'xhs',
  skill: string | null
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `下面是一组图片卡片文案（竖版 3:4，逐张翻看），请逐张审阅并输出结构化报告。

<卡片文案>
${cardsText}
</卡片文案>

${CARD_STYLE_RULES[format]}

审阅维度：
- 文案：封面钩子够不够、角标是否贴题、每张要点是否精炼有记忆点、前后是否重复拗口、尾卡收束是否有力
- 排版密度：单张正文超过 5 行或 80 字会拥挤，建议拆卡或删减；只有 1-2 短行会显得空、字小，应建议「文字大小调到 120-150%」或补一行要点
- 背图：bgPrompt 是否与该卡内容呼应、整组色调是否统一；画面偏暗的应建议勾选「深色底反白」

输出 markdown 报告，第一行为「# 贴图审阅报告」，必须包含这些二级标题分区：## 总评、## 逐张点评、## 修改建议。
逐张点评里每张用「### 第 N 张」开头（第 1 张是封面），没问题的张一句带过；排版类建议（文字大小/深色反白/拆卡）要明确写出可直接手动操作的做法。总评给出 1-10 分。`
    }
  ]
}

/** 贴图 → 发布配文：按平台风格生成带话题标签的发图文案（纯文本，发布时直接复制） */
export function cardsCaptionMessages(
  cardsText: string,
  format: 'wechat' | 'xhs',
  skill: string | null
): ChatMessage[] {
  const style =
    format === 'xhs'
      ? '小红书笔记风：口语活泼、适当用 emoji，正文 80-150 字，结尾另起一行给 8-10 个 #话题 标签（空格分隔，热门与长尾搭配）'
      : '公众号发图风：书面克制、不用 emoji 堆砌，正文 60-120 字，结尾另起一行给 3-5 个 #话题 标签（空格分隔）'
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `下面是一组即将发布的图片卡片文案（按顺序），请为这次发图写一段发布配文：

<卡片文案>
${cardsText}
</卡片文案>

要求：
- ${style}
- 开头一句要能勾住人，点出看完这组图的收获；不复述卡片原句
- 话题标签紧贴内容主题，不编造不相关的热词
- 只输出配文本身（纯文本，不要 markdown 标记、不要代码块、不要任何解释）`
    }
  ]
}

/** 贴图 AI 优化：平台风格不变，逐张润色标题/要点，封面角标换成贴题文案；带审阅报告则逐条落实 */
export function cardsRefineMessages(
  cardsText: string,
  format: 'wechat' | 'xhs',
  skill: string | null,
  review?: string
): ChatMessage[] {
  const task = review?.trim()
    ? `请按下面的审阅报告逐条落实文案类修改（排版类建议如文字大小、深色反白由作者手动处理，不用管），报告未点名的张保持原样；张数与顺序不变，每张的 bgPrompt 原样照抄：

<审阅报告>
${review.trim()}
</审阅报告>`
    : `请在不改变平台风格的前提下逐张优化：标题更抓人、要点更精炼有记忆点，修正拗口或重复的表达；张数与顺序不变，每张的 bgPrompt 原样照抄：`
  return [
    { role: 'system', content: systemPrompt(skill) },
    {
      role: 'user',
      content: `下面是一组图片卡片文案。${task}

<卡片文案>
${cardsText}
</卡片文案>

${CARD_STYLE_RULES[format]}

${CARD_JSON_RULES}`
    }
  ]
}
