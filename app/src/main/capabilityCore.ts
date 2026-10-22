import { basename, isAbsolute, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { ArticleTheme, IdeaCard, TitleCandidate } from '@shared/types'
import { CARD_H, CARD_W, isHexColor, type CardDeck, type CardFormat, type CardItem } from '@shared/cards'
import { COVER_SQUARE, COVER_TEMPLATES, COVER_WIDE } from '@shared/coverTemplates'
import { sanitizeProjectName } from '@shared/projectName'
import {
  clampThemeNumbers,
  metaPatchToThemeKeys,
  normalizeThemeKeys,
  sanitizeThemePatchDetailed,
  THEME_KEYS_HINT,
  THEME_OVERRIDE_KEYS
} from '@shared/categoryThemes'
import { ALL_CATEGORIES } from '@shared/categories'
import {
  brainstormMessages,
  fullArticleMessages,
  outlineMessages,
  reviewMessages,
  titleMessages
} from '@shared/prompts'
import { coerceArrayArg } from '@shared/llmText'
import { agentGuide, GUIDE_LABELS, GUIDE_TOPICS, type AgentGuideTopic } from '@shared/agentGuides'
import * as store from './projectStore'
import { generateImage } from './imageGen'
import { captureHtmlPreview, renderFigure, renderHtmlFixed, saveFigureHtml } from './figureRender'
import { readArchivedCards, readCards, renderCard, writeArchivedCards, writeCards } from './cardsStore'
import { renderCoverHtml, renderCoverTemplate } from './coverStore'
import { exportArticleHtml, exportPlatformHtml } from './exporter'
import { exportDocx, exportPdf } from './docExport'
import { pushCards, pushDraft } from './wechatPublish'
import { listSkills, parseDescription, readSkill, saveSkill } from './skillStore'
import { deleteTheme, listLibrary, saveTheme, setActiveTheme } from './themeStore'
import { broadcast, pauseProjectWatcher, resumeProjectWatcher } from './ipc'

/**
 * CapabilityCore（M8）：M2-M7 能力的无 UI 门面
 * - MCP（经 mcp-proxy 代理）与本地 HTTP bridge 共用这张工具注册表
 * - 工具入参用 JSON Schema 描述（MCP tools/list 直接下发）
 * - LLM 推理不在应用内代跑：xxx_prompt 工具只返回提示词消息组（含挂载 Skill），
 *   由调用方 Agent 用自己的模型执行，再调对应的 save/set/write 工具落盘
 * - 写文件后手动广播 file:external-change：GUI 同进程时编辑器能感知 Agent 改动
 *   （writeTracked 会抑制 watcher 回声，所以必须显式广播；无头模式没有窗口，广播是空操作）
 */

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  /** ctx.signal：调用方随请求带来的取消信号（目前只有 bridge 在 HTTP 客户端断开时中止，
   *  generate_image 用它中断在途生图——Agent 取消工具调用或代理超时不再白烧额度） */
  handler: (args: Record<string, unknown>, ctx?: ToolCallCtx) => unknown
  /** 只给外部 Agent 用：结果体量大或形态不适合塞进对话文本（如 render_preview 的 PNG base64），
   *  内部对话副驾驶的工具面按此排除——编辑器的实时预览本来就在作者眼前，再灌几百 KB base64 只是烧 token */
  headlessOnly?: boolean
}

export interface ToolCallCtx {
  signal?: AbortSignal
}

/** Agent 写完文件通知 GUI（若在运行）刷新 */
function notifyChange(project: string, file: string): void {
  broadcast('file:external-change', { project, file })
}

function str(args: Record<string, unknown>, key: string, required = true): string {
  const v = args[key]
  if (typeof v === 'string' && v.trim()) return v
  // 工程名被写成数字等非对象值时先转文本，别因类型差异判成缺参
  if (v !== null && v !== undefined && typeof v !== 'object' && String(v).trim()) return String(v).trim()
  if (required) {
    throw new Error(
      key === 'project'
        ? '缺少参数 project：需传工程名（workspace 下的目录名，落工程时用 create_project 返回的名字；可先 list_projects 查询）'
        : `缺少参数 ${key}`
    )
  }
  return ''
}

/** 工程名入参：先按标点归一匹配真实工程（模型常把全角 “” ： 写成半角或「」变体）。
 *  匹配不到就报候选名——早先会掉进 projectDir 的兜底路径，报出 ENOENT workspace/<猜名>/project.json，
 *  模型只能继续瞎猜（2026-09-29 实测：它把原因解释成「工具把特殊字符转成了方括号」，还让用户改名） */
function projectArg(a: Record<string, unknown>): string {
  const dir = str(a, 'dir', false)
  if (dir) {
    const byDir = store.matchProjectByDir(dir)
    if (byDir) return byDir
    throw new Error(
      `dir 没匹配到工程：${dir}。请原样传 list_projects / create_project 返回的 dir，或改传 project 工程名`
    )
  }
  // 模型常把工程名写成 name（get_project / set_project_category 报「缺少参数 project」就是这么来的）：
  // 只有没传 project 时才拿 name 顶上；name 作为业务字段的工具（save_theme_preset 等）不走这里，不受影响
  const raw = str(a, 'project', false) || str(a, 'name', false)
  if (!raw) throw new Error('缺少参数 project：需传工程名（workspace 下的目录名），也可传 dir（工程绝对路径）；可先用 list_projects 查询')
  const { hit, candidates } = store.matchProjectName(raw)
  if (hit) return hit
  const hint = candidates.length ? `最接近的工程：${candidates.join(' / ')}` : '先用 list_projects 查准确名字'
  throw new Error(
    `工程不存在：${raw}。标点变体已自动归一匹配过仍找不到——请改传 list_projects / create_project 返回的 dir（工程绝对路径）。提示：${hint}`
  )
}

/** 工程挂载了风格 Skill 时读出全文（注入系统提示） */
function projectSkill(project: string): string | null {
  try {
    const name = store.readMeta(project).style_skill
    return name ? readSkill(name) : null
  } catch {
    return null
  }
}

/** 正文已落盘但状态还停在脑暴时推进到撰写（原 generate 工具的职责）；审阅后又改稿则退回撰写 */
function ensureDrafting(project: string): void {
  if (store.advanceStatus(project, 'drafting')) notifyChange(project, 'project.json')
}

const P = {
  project: { type: 'string', description: '工程名（workspace 下的目录名）；工程名含引号冒号等标点时可改传 dir' }
} as const

/** 工程内相对路径 → 绝对路径：外部 Agent 的读文件/看图能力只认绝对路径，
 *  只给相对路径时它得先 list_projects 拿 root 再自己拼（实测多花两轮调用） */
function absOf(project: string, rel: string): string {
  return join(store.projectDir(project), rel)
}

/** 数字入参容错：模型常把下标写成 "2" 或 2.0，类型差异不该判成缺参 */
function num(a: Record<string, unknown>, key: string): number {
  const v = a[key]
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n)) throw new Error(`缺少参数 ${key}：需传数字下标（从 0 开始）`)
  return Math.trunc(n)
}

/** 破坏性操作门槛：外部 Agent 走 MCP 时没有应用内确认框，只能靠显式 confirm 把决定权交回作者 */
function requireConfirm(a: Record<string, unknown>, what: string): void {
  if (a.confirm === true || a.confirm === 'true' || a.confirm === 1) return
  throw new Error(`未执行「${what}」：这一步不可恢复。先把要删掉的具体内容和影响说给作者听，取得同意后再带 confirm:true 重发`)
}

/** 贴图风格入参：只认 wechat / xhs，其它写法直接报错列可选值，不静默按缺省走 */
function cardFormatArg(v: unknown, fallback: CardFormat): CardFormat {
  if (v === undefined || v === null || v === '') return fallback
  const s = String(v).trim()
  if (s === 'wechat' || s === 'xhs') return s
  throw new Error(`非法贴图风格：${s}（只能传 wechat 或 xhs）`)
}

export const TOOLS: ToolDef[] = [
  {
    name: 'list_projects',
    description: '列出 workspace 下的全部图文工程（名称/状态/分类/更新时间）',
    inputSchema: { type: 'object', properties: {} },
    handler: () => store.listProjects()
  },
  {
    name: 'get_guide',
    description:
      '取一本手册再动手：pipeline 全流程编排 / markdown 正文语法 / theme 排版字段与取值口径 / cards 贴图卡组 / publish 导出推送前置。不确定键名、取值范围或下一步该调哪个工具时先查这里，别凭印象造键名',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: GUIDE_TOPICS,
          description: '手册分段；省略时只返回可查清单（正文一册几百到几千字，按需一次取一册）'
        }
      }
    },
    handler: (a) => {
      const raw = str(a, 'topic', false)
      if (!raw)
        return {
          topics: GUIDE_TOPICS.map((t) => ({ topic: t, title: GUIDE_LABELS[t] })),
          hint: '带 topic 再调一次取正文；只取这一轮真要用的那册'
        }
      const guide = agentGuide(raw)
      if (!guide)
        throw new Error(`没有这本手册：${raw}（可查：${GUIDE_TOPICS.join(' / ')}）`)
      return { topic: raw, title: GUIDE_LABELS[raw as AgentGuideTopic], guide }
    }
  },
  {
    name: 'create_project',
    description: '新建图文工程（自动生成 project.json 与 article.md 等骨架文件），可指定分类目录',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工程名，将作为目录名' },
        category: {
          type: 'string',
          description: `所属分类（可选，缺省「未分类」）：${ALL_CATEGORIES.join(' / ')}，也支持自定义分类名`
        }
      },
      required: ['name']
    },
    handler: (a) => {
      const r = store.createProject(str(a, 'name'), str(a, 'category', false) || undefined)
      // 对话内立项：广播让工程树/向导立即看到新工程
      broadcast('workspace:changed', null)
      return r
    }
  },
  {
    name: 'set_project_category',
    description: '调整工程分类：工程目录迁移到 workspace/<分类>/ 下并更新元数据',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        category: { type: 'string', description: `目标分类：${ALL_CATEGORIES.join(' / ')} 或自定义分类名` }
      },
      required: ['project', 'category']
    },
    handler: async (a) => {
      const project = projectArg(a)
      // 工程目录整体迁移：先停监听、迁完按新路径重挂，与 IPC 的 project:setCategory 共用同一套收尾
      const was = await pauseProjectWatcher(project)
      const meta = store.setProjectCategory(project, str(a, 'category'))
      if (was) resumeProjectWatcher(project)
      broadcast('workspace:changed', null)
      return meta
    }
  },
  {
    name: 'get_project',
    description: '读取工程详情：project.json 元数据（状态/选题/标题候选/封面）+ article.md 正文全文',
    inputSchema: { type: 'object', properties: { project: P.project }, required: ['project'] },
    handler: (a) => {
      const project = projectArg(a)
      return { meta: store.readMeta(project), article: store.readTextFile(project, 'article.md') }
    }
  },
  {
    name: 'read_article',
    description: '读工程内文本文件原文（article.md 正文 / ideas.md 灵感 / review.md 审阅报告）',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        file: { type: 'string', enum: ['article.md', 'ideas.md', 'review.md'], description: '缺省 article.md' }
      },
      required: ['project']
    },
    handler: (a) => {
      const file = (str(a, 'file', false) || 'article.md') as 'article.md' | 'ideas.md' | 'review.md'
      return store.readTextFile(projectArg(a), file)
    }
  },
  {
    name: 'write_article',
    description:
      '整体覆写 article.md 正文。markdown 子集、图片图注、配图占位、手动字色底色字号的具体写法先调 get_guide 带 topic=markdown 取那一册；只改一句或某段压短请改用 patch_article，不要整篇重写',
    inputSchema: {
      type: 'object',
      properties: { project: P.project, content: { type: 'string', description: '正文 markdown 全文' } },
      required: ['project', 'content']
    },
    handler: (a) => {
      const project = projectArg(a)
      store.writeTextFile(project, 'article.md', str(a, 'content'))
      notifyChange(project, 'article.md')
      ensureDrafting(project)
      return { ok: true }
    }
  },
  {
    name: 'patch_article',
    description: '对 article.md 做精准补丁替换（不重写全文）。每个补丁的 old 必须与原文逐字一致且全文唯一',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        patches: {
          type: 'array',
          description: '替换对列表',
          items: {
            type: 'object',
            properties: { old: { type: 'string' }, new: { type: 'string' } },
            required: ['old', 'new']
          }
        }
      },
      required: ['project', 'patches']
    },
    handler: (a) => {
      const project = projectArg(a)
      // 数组归一（patches 常被写成 JSON 字符串），并兼容只给顶层 old/new 的单次替换
      const rawPatches =
        a.patches === undefined && (a.old !== undefined || a.new !== undefined)
          ? [{ old: a.old, new: a.new }]
          : coerceArrayArg(a.patches, 'patches', '[{"old":"原文唯一片段","new":"替换后文本"}]')
      const patches: { old: string; new: string }[] = []
      for (const item of rawPatches) {
        const p = item as { old?: unknown; new?: unknown }
        if (!p || typeof p.old !== 'string' || !p.old) throw new Error('补丁项缺少 old：需为原文片段，且与正文逐字一致')
        if (typeof p.new !== 'string') throw new Error('补丁项缺少 new：替换后的文本（删除该片段传空串）')
        patches.push({ old: p.old, new: p.new })
      }
      let article = store.readTextFile(project, 'article.md')
      const failed: { old: string; reason: string }[] = []
      let applied = 0
      for (const p of patches) {
        const first = article.indexOf(p.old)
        if (first < 0) {
          failed.push({ old: p.old.slice(0, 60), reason: '原文中找不到' })
        } else if (article.indexOf(p.old, first + 1) >= 0) {
          failed.push({ old: p.old.slice(0, 60), reason: '出现多次不唯一，请多包一句上下文' })
        } else {
          article = article.replace(p.old, p.new)
          applied++
        }
      }
      if (applied > 0) {
        store.writeTextFile(project, 'article.md', article)
        notifyChange(project, 'article.md')
        ensureDrafting(project)
      }
      return { applied, failed }
    }
  },
  {
    name: 'brainstorm_prompt',
    description:
      '取脑暴选题的提示词消息组（本应用不代跑 LLM）。请用你自己的模型执行 messages，产出 5 张选题卡 JSON 后调 save_ideas 入库',
    inputSchema: {
      type: 'object',
      properties: {
        material: { type: 'string', description: '素材原文（新闻/笔记/链接摘要等）' },
        ask: { type: 'string', description: '补充要求（可选）' }
      },
      required: ['material']
    },
    handler: (a) => ({
      messages: brainstormMessages(str(a, 'material'), str(a, 'ask', false), null),
      next: '用你自己的模型跑出 JSON 数组（title/angle/audience/score/reason），再调 save_ideas 存入全局选题库'
    })
  },
  {
    name: 'save_ideas',
    description: '把选题卡存入全局选题库（配合 brainstorm_prompt 使用）',
    inputSchema: {
      type: 'object',
      properties: {
        ideas: {
          type: 'array',
          description: '选题卡列表',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              angle: { type: 'string' },
              audience: { type: 'string' },
              score: { type: 'number' },
              reason: { type: 'string' }
            },
            required: ['title', 'angle', 'audience', 'score', 'reason']
          }
        }
      },
      required: ['ideas']
    },
    handler: (a) => {
      const ideas = coerceArrayArg(a.ideas, 'ideas', '[{"title":"选题","angle":"切入角度","audience":"目标人群","score":8,"reason":"为什么现在写"}]') as IdeaCard[]
      for (const c of ideas) {
        if (!c || typeof c.title !== 'string' || !c.title.trim()) throw new Error('每张选题卡必须有 title')
        store.addIdea(c)
      }
      return { saved: ideas.length }
    }
  },
  {
    name: 'outline_prompt',
    description:
      '取文章大纲的提示词消息组（含工程挂载的风格 Skill，本应用不代跑 LLM）。用你自己的模型跑出大纲后调 article_prompt 换全文提示词',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        ask: { type: 'string', description: '选题/写作要求' },
        material: { type: 'string', description: '参考素材（可选）' }
      },
      required: ['project', 'ask']
    },
    handler: (a) => {
      const project = projectArg(a)
      return {
        messages: outlineMessages(str(a, 'ask'), str(a, 'material', false), projectSkill(project)),
        next: '跑出大纲后调 article_prompt（传入大纲）取全文提示词'
      }
    }
  },
  {
    name: 'article_prompt',
    description:
      '用大纲换正文全文的提示词消息组（含风格 Skill，本应用不代跑 LLM）。用你自己的模型跑出 markdown 全文后调 write_article 落盘',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        outline: { type: 'string', description: '文章大纲（outline_prompt 那步的模型产出）' }
      },
      required: ['project', 'outline']
    },
    handler: (a) => ({
      messages: fullArticleMessages(str(a, 'outline'), projectSkill(projectArg(a))),
      next: '跑出 markdown 全文后调 write_article 写入 article.md'
    })
  },
  {
    name: 'review_prompt',
    description:
      '取审阅正文的提示词消息组（内含当前 article.md 全文与风格 Skill，本应用不代跑 LLM）。用你自己的模型跑出报告后调 save_review 落盘',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        selection: { type: 'string', description: '只审这一段（可选，缺省审全文）' }
      },
      required: ['project']
    },
    handler: (a) => {
      const project = projectArg(a)
      const article = store.readTextFile(project, 'article.md')
      if (!article.trim()) throw new Error('article.md 为空，先写正文再审阅')
      return {
        messages: reviewMessages(article, projectSkill(project), str(a, 'selection', false) || undefined),
        next: '跑出审阅报告后调 save_review 写入 review.md'
      }
    }
  },
  {
    name: 'save_review',
    description: '把审阅报告写入工程 review.md（配合 review_prompt 使用）',
    inputSchema: {
      type: 'object',
      properties: { project: P.project, report: { type: 'string', description: '审阅报告全文' } },
      required: ['project', 'report']
    },
    handler: (a) => {
      const project = projectArg(a)
      store.writeTextFile(project, 'review.md', str(a, 'report').trim() + '\n')
      notifyChange(project, 'review.md')
      // 审阅报告落盘 = 进审阅（选题看板「已成稿」的依据），与 UI 写 review.md 同规则（ipc project:writeFile）
      if (store.advanceStatus(project, 'reviewing')) notifyChange(project, 'project.json')
      return { ok: true }
    }
  },
  {
    name: 'titles_prompt',
    description:
      '取起标题的提示词消息组（内含当前正文与风格 Skill，本应用不代跑 LLM）。用你自己的模型跑出 6 个标题候选 JSON 后调 set_titles 落盘',
    inputSchema: { type: 'object', properties: { project: P.project }, required: ['project'] },
    handler: (a) => {
      const project = projectArg(a)
      const article = store.readTextFile(project, 'article.md')
      if (!article.trim()) throw new Error('article.md 为空，先写正文再起标题')
      return {
        messages: titleMessages(article, projectSkill(project)),
        next: '跑出 JSON 数组（text/score/reason）后调 set_titles 写入 project.json'
      }
    }
  },
  {
    name: 'set_titles',
    description: '把标题候选写入工程 project.json（配合 titles_prompt 使用）',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        titles: {
          type: 'array',
          description: '标题候选列表',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              score: { type: 'number' },
              reason: { type: 'string' }
            },
            required: ['text', 'score', 'reason']
          }
        }
      },
      required: ['project', 'titles']
    },
    handler: (a) => {
      const project = projectArg(a)
      const titles = coerceArrayArg(a.titles, 'titles', '[{"text":"标题","score":8,"reason":"为什么合适"}]') as TitleCandidate[]
      for (const t of titles) {
        if (!t || typeof t.text !== 'string' || !t.text.trim()) throw new Error('每个候选必须有 text')
      }
      const meta = store.readMeta(project)
      store.writeMeta(project, { ...meta, titles })
      notifyChange(project, 'project.json')
      return { ok: true }
    }
  },
  {
    name: 'set_theme',
    description:
      '设置工程排版覆盖（写 project.json，编辑器/导出/推送同源生效，与顶栏控件一致）。字段各自独立：不传=不动，传 null=恢复「跟随分类主题」；数值越界会被夹进区间、非法值不写入，夹取与丢弃都如实进 hint / ignoredKeys / droppedKeys，必须照实转述给作者。键位多、口径细，动手前先调 get_guide 带 topic=theme 取字段表，别凭印象造键名',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        accent: { type: ['string', 'null'], description: '强调色 #rrggbb；改它会重链标题装饰线/引用边线/加粗色' },
        bodyFontSize: { type: ['number', 'null'], description: '正文字号 10-40' },
        headingFontSize: { type: ['number', 'null'], description: '标题字号 12-40（H1+6/H2+0/H3-3）' },
        bodyAlign: { type: ['string', 'null'], enum: ['indent', 'flush', 'center', null] },
        headingAlign: { type: ['string', 'null'], enum: ['center', 'left', null] },
        h1Style: { type: ['string', 'null'], enum: ['bar', 'pill', 'underline', 'banner', null] },
        h1Bg: { type: ['string', 'null'], description: '报头横幅底色（配 h1Style=banner）' },
        h2Style: { type: ['string', 'null'], enum: ['leftbar', 'block', 'underline', 'plain', null] },
        h2Num: { type: ['string', 'null'], enum: ['01', '1.', '1、', '一、', '壹、', '①', 'none', null], description: 'H2 序号；none=显式关闭' },
        h3Mark: { type: ['string', 'null'], enum: ['diamond', 'dot', 'none', null] },
        bodyBg: { type: ['string', 'null'], description: '正文卡底色，浅色系；none=去卡纯白' },
        pageBg: { type: ['string', 'null'], description: '正文卡之下的纸底色' },
        fontFamily: { type: ['string', 'null'], description: '正文字体栈' },
        lineHeight: { type: ['number', 'null'], description: '行高 1.5-3' },
        letterSpacing: { type: ['string', 'number', 'null'], description: '字距；裸数字按 px' },
        pGap: { type: ['number', 'null'], description: '段间距 0-48' },
        bodyText: { type: ['string', 'null'] },
        headingColor: { type: ['string', 'null'], description: '设后不随 accent 重链' },
        quoteStyle: { type: ['string', 'null'], enum: ['leftbar', 'card', 'quotes', 'dashcard', null] },
        quoteBorder: { type: ['string', 'null'] },
        quoteBg: { type: ['string', 'null'], description: '不设=按 accent 派生浅底' },
        quoteText: { type: ['string', 'null'], description: '不设=按底色亮度自适应' },
        hrColor: { type: ['string', 'null'], description: '不设=中性灰' },
        h2Border: { type: ['string', 'null'] },
        hrStyle: { type: ['string', 'null'], enum: ['line', 'dot', 'long', null] },
        strongStyle: { type: ['string', 'null'], enum: ['color', 'highlight', 'plain', null] },
        strongBg: { type: ['string', 'null'] },
        strongColor: { type: ['string', 'null'], description: '设后不随 accent 重链' },
        imgRadius: { type: ['number', 'null'], description: '图片圆角 0-40' },
        imgStyle: { type: ['string', 'null'], enum: ['inset', 'fullwidth', 'half', null] },
        imgFrame: { type: ['string', 'null'], enum: ['none', 'line', 'shadow', null] },
        imgGap: { type: ['number', 'null'], description: '图片外间距 0-48' },
        captionAlign: { type: ['string', 'null'], enum: ['center', 'left', null] },
        bodyRadius: { type: ['number', 'null'], description: '正文容器圆角 0-40' },
        bodyPadding: { type: ['string', 'number', 'null'], description: '正文容器内边距；裸数字按 px' },
        tableStyle: { type: ['string', 'null'], enum: ['bordered', 'striped', 'plain', null] },
        tableHeaderBg: { type: ['string', 'null'] },
        tableBorder: { type: ['string', 'null'] },
        tableHeaderText: { type: ['string', 'null'] },
        h2Bg: { type: ['string', 'null'], description: 'H2 色块标签底色' }
      },
      required: ['project']
    },
    handler: (a) => {
      // 参数被包一层的写法（{"theme":{...}} / overrides / patch / params）先摊平：
      // 不摊平就是「工具返回成功、一个字段都没写」的静默假成功（实测命中过一轮 theme 包法）
      const bag = a as Record<string, unknown>
      for (const wrapKey of ['theme', 'overrides', 'patch', 'params']) {
        const inner = bag[wrapKey]
        if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue
        for (const [k, v] of Object.entries(inner as Record<string, unknown>)) if (!(k in bag)) bag[k] = v
        delete bag[wrapKey]
      }
      const project = projectArg(a)
      const meta = store.readMeta(project)
      // 数值越界的夹取说明照实报（作者要 1.4、口径下限 1.5，静默抬成 1.5 就是「设了没反应」）
      const { notes } = clampThemeNumbers(bag)
      // 写入一律过同一套校验：不合法的值不落脏盘、也不装成功。
      // 实测过 set_theme 传 h2Border: 123 → 旧实现把 123 原样写进 meta 并返回 ok，作者看到的就是「设了没变化」
      const { values: ok, unknown: unmapped, invalid, coerced } = sanitizeThemePatchDetailed(bag)
      const bag2 = meta as unknown as Record<string, unknown>
      // 写入必须以「归一后的键名」为准，不能拿原始键判：
      // 上一版按 `k in bag` 过滤，别名值（paragraphSpacing→pGap、cornerRadius→bodyRadius）虽然已在 ok 里备好，
      // 却因 bag 没有 pGap 这个键而一个字都没写、还返回干净的 ok——别名等于白做，17:36 实测抓到
      const norm = normalizeThemeKeys(bag)
      for (const [k, rawVal] of Object.entries(norm.patch)) {
        // null = 显式恢复默认；合法值用校验后的结果（夹取、去空格、补 px、枚举守卫）；非法值保持盘上原值不动
        if (rawVal === null) bag2[k] = undefined
        else if (k in ok) bag2[k] = (ok as Record<string, unknown>)[k]
      }
      store.writeMeta(project, meta)
      notifyChange(project, 'project.json')
      // name / dir 已被 projectArg 当作工程定位消费掉，不能再算「不认识的参数」
      const ignoredKeys = unmapped.filter((k) => k !== 'project' && k !== 'dir' && k !== 'name')
      // null 是「显式恢复默认」，走上面的清除分支，不能混进「值不合法未写入」——
      // 那样会把成功报成失败，和把失败报成成功一样误导作者
      const droppedKeys = invalid.filter((k) => k in norm.patch && norm.patch[k] !== null)
      const reports = [...notes, ...coerced]
      if (ignoredKeys.length) reports.push(`不认识的参数已忽略：${ignoredKeys.join('、')}（可用键与取值口径调 get_guide 带 topic=theme 取字段表）`)
      if (droppedKeys.length)
        reports.push(`以下字段值不合法，未写入：${droppedKeys.join('、')}（色值要 #rrggbb、数值不带单位、枚举取说明里的形态）`)
      return reports.length ? { ok: true, hint: reports.join('；'), ignoredKeys, droppedKeys } : { ok: true }
    }
  },
  {
    name: 'save_theme_preset',
    description:
      '为分类设计并保存整套排版主题（写入自定义主题库，一个分类可存多套，保存即激活为该分类当前主题）。name 是主题名、category 是归属分类（缺省与主题同名并自动建目录）、theme 是完整主题对象（accent 必填）。动手前先调 get_guide 带 topic=theme 取键名与取值口径；不认识或被丢弃的键会如实进 unknownKeys / droppedKeys，未写入的部分不得声称已生效',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '主题名（主题库里显示的名字；新主题与旧主题可并存）' },
        category: { type: 'string', description: '归属分类（保存即激活为该分类当前主题；缺省与主题同名，同名分类目录自动创建）' },
        theme: {
          type: 'object',
          description:
            '完整排版主题对象，键名严格照 get_guide 的 theme 段那批（accent 必填，其余可缺省）。色值传 #rrggbb 即可，rgb()/rgba()/8位hex/渐变串会自动转成 hex。不要自造键名（如 text_color / font_family / paragraph_spacing），不认识的键会在结果里照实列出',
          additionalProperties: false
        }
      },
      required: ['name', 'theme']
    },
    handler: (a) => {
      // 模型常把「给哪个分类」当参数名（category=科技数码），两者互为别名——
      // 只认 name 时实测连续两轮报「缺少参数 name」，第三轮才蒙对
      const name = str(a, 'name', false) || str(a, 'category', false)
      if (!name)
        throw new Error(
          '缺少参数 name（主题名；可选 category 指定归属分类，缺省与主题同名并自动创建分类目录），形状：{"name":"清新蓝调","theme":{"accent":"#7c3aed", ...}}'
        )
      // 主题名也接受 category 写法（模型常把「给哪个分类」当成参数名），两者都缺才报错。
      // theme 被整体二次编码成 JSON 字符串（双层编码是模型常见失误）时先救回对象
      let themeRaw: Record<string, unknown>
      let themeUnparsed = ''
      if (typeof a.theme === 'string') {
        try {
          themeRaw = JSON.parse(a.theme) as Record<string, unknown>
        } catch {
          themeRaw = {}
          themeUnparsed = a.theme
        }
      } else {
        themeRaw = (a.theme ?? {}) as Record<string, unknown>
      }
      const { values, unknown, invalid, coerced } = sanitizeThemePatchDetailed(themeRaw)
      const patch = metaPatchToThemeKeys(values)
      if (!patch.accent) {
        // 报错必须带上「实际收到了什么」：只说「accent 必填」时模型看不出自己错在哪，
        // 实测同一份参数原样重试两轮。accent 已支持 rgb()/渐变自动转换，走到这里说明真的没有可识别色
        const received = themeUnparsed
          ? `theme 是一段解析不成对象的文本：「${themeUnparsed.slice(0, 80)}」`
          : Object.keys(themeRaw).length
            ? `实际收到的 theme：${Object.entries(themeRaw)
                .map(([k, v]) =>
                  typeof v === 'string'
                    ? `${k}='${v.trim().slice(0, 50)}'`
                    : v !== null && typeof v === 'object'
                      ? `${k}=${Array.isArray(v) ? '[…]' : '{…}'}`
                      : `${k}=${String(v)}`
                )
                .join('、')}`
            : 'theme 是空对象'
        throw new Error(
          `theme.accent 缺失或不是可识别的色值，整套主题无法成立。${received}。可用键连取值口径：${THEME_KEYS_HINT}。色值类传 #rrggbb（rgb()/rgba()/8位hex/渐变串自动转换）；accent 必填、其余可缺省。形状示例：{"accent":"#7c3aed","lineHeight":1.8,"pGap":16}`
        )
      }
      if (!Object.keys(patch).length) throw new Error('theme 里没有一个可识别的键，请严格按工具说明的键名重发')
      // 归属分类缺省与主题同名（旧口径兼容）；保存即激活为该分类当前主题，同名主题覆盖更新
      const category = str(a, 'category', false) || name
      saveTheme(name, { ...(patch as ArticleTheme), origin: 'panel' }, category)
      // 广播让工程树/设置即时感知新分类目录
      broadcast('workspace:changed', null)
      // 未识别的键必须照实报：否则模型拿着只落了 1 个字段的主题去描述整套排版（实测发生过）
      const applied = Object.keys(patch).length
      const dropped: string[] = []
      if (unknown.length) dropped.push(`键名不认识：${unknown.join('、')}`)
      if (invalid.length) dropped.push(`值不合法被丢弃：${invalid.join('、')}`)
      let hint = dropped.length
        ? `主题「${name}」已入库到分类「${category}」，但只写入 ${applied} 个字段；${dropped.join('；')}——需要的效果请改用工具说明里的键名与取值重发一次，未写入的部分不得向用户声称已生效`
        : `主题「${name}」已入库（共 ${applied} 个字段）并套用到分类「${category}」；打开该分类下的工程即生效`
      // 宽进转换（渐变 accent → 取主色 hex）不是静默的：模型要能向作者转述「按什么生效」
      if (coerced.length) hint += `；${coerced.join('；')}`
      return { ok: true, name, appliedFields: applied, unknownKeys: unknown, droppedKeys: invalid, hint }
    }
  },
  {
    name: 'render_figure',
    description:
      '保存自包含单文件图表 HTML 并离屏渲染成 PNG（宽 900px，高度自然撑开）。传 html 新建/覆写；只传 path 则重渲染既有源码。返回 html 与 png 的工程内相对路径',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        html: { type: 'string', description: '完整单文件 HTML 源码（样式内联、无外部资源、无动画）' },
        path: { type: 'string', description: '图表源码相对路径（如 figures/fig-1.html），缺省自动编号' }
      },
      required: ['project']
    },
    handler: async (a) => {
      const project = projectArg(a)
      const html = str(a, 'html', false)
      let rel = str(a, 'path', false)
      if (html) rel = saveFigureHtml(project, html, rel || undefined)
      else if (!rel) throw new Error('html 与 path 至少提供一个')
      const png = await renderFigure(project, rel)
      // 绝对路径一并给：宿主的读图能力只认绝对路径，光给相对路径它还得自己拼 root
      return { html_path: rel, png_path: png, html_abs: absOf(project, rel), png_abs: absOf(project, png) }
    }
  },
  {
    name: 'render_preview',
    headlessOnly: true,
    description:
      '把工程成品截图回传给你自己看（正文排版 / 封面 / 单张贴图卡），改完排版再截一次对比——这是唯一能自证「设了到底有没有变化」的路径。target：article 正文（缺省）/ cover 封面 / card 贴图卡；返回 PNG，同时给绝对路径给能读本地文件的宿主',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        target: { type: 'string', enum: ['article', 'cover', 'card'], description: '截什么；缺省 article' },
        variant: { type: 'string', enum: ['day', 'night'], description: 'target=article 的配色，缺省 day（日间排版）' },
        width: { type: 'number', description: 'target=article 的截图宽度 320-1600，缺省 780（手机竖屏口径）' },
        index: { type: 'number', description: 'target=card 时的卡片下标，从 0 开始' }
      },
      required: ['project']
    },
    handler: async (a) => {
      const project = projectArg(a)
      const target = (str(a, 'target', false) || 'article') as 'article' | 'cover' | 'card'
      if (target === 'card') {
        const deck = readCards(project)
        if (!deck || !deck.cards.length) throw new Error('该工程没有贴图卡组：先 write_cards')
        const i = num(a, 'index')
        const card = deck.cards[i]
        if (!card)
          throw new Error(`卡片下标越界：${i}（本工程共 ${deck.cards.length} 张，合法范围 0-${deck.cards.length - 1}）`)
        if (!card.png) throw new Error(`第 ${i + 1} 张还没有 PNG：先 render_card index:${i}`)
        const absHtml = absOf(project, card.png.replace(/\.png$/i, '.html'))
        if (!existsSync(absHtml))
          throw new Error(`卡片源码不在：${card.png.replace(/\.png$/i, '.html')}（重新 render_card index:${i}）`)
        const { base64 } = await renderHtmlFixed(absHtml, CARD_W, CARD_H)
        return {
          target,
          index: i,
          png: card.png,
          png_abs: absOf(project, card.png),
          width: CARD_W,
          height: CARD_H,
          mime: 'image/png',
          image_base64: base64
        }
      }
      if (target === 'cover') {
        const meta = store.readMeta(project)
        if (!meta.cover?.main) throw new Error('该工程还没有封面：先 render_cover_template 出一套')
        const absHtml = absOf(project, 'covers/cover-wide.html')
        if (!existsSync(absHtml))
          throw new Error('封面源码不在（covers/cover-wide.html）：先 render_cover_template 出一套')
        const { base64 } = await renderHtmlFixed(absHtml, COVER_WIDE.w, COVER_WIDE.h)
        return {
          target,
          png: meta.cover.main,
          png_abs: absOf(project, meta.cover.main),
          width: COVER_WIDE.w,
          height: COVER_WIDE.h,
          mime: 'image/png',
          image_base64: base64
        }
      }
      const variant = (str(a, 'variant', false) || 'day') as 'day' | 'night'
      const rawW = a.width
      const w = typeof rawW === 'number' || (typeof rawW === 'string' && rawW.trim()) ? Number(rawW) : 780
      // 预览复用导出器：它会落一份 article.html（与 export_html 同一产物，下次导出覆盖），
      // 否则要另起一条「拼 HTML 不落盘」的分支，排版口径就有两份真相了
      const absHtml = exportArticleHtml(project, variant)
      const shot = await captureHtmlPreview(absHtml, Number.isFinite(w) ? w : 780)
      return {
        target,
        variant,
        html: 'article.html',
        html_abs: absHtml,
        width: shot.width,
        height: shot.height,
        mime: 'image/png',
        image_base64: shot.base64,
        hint: shot.height_capped
          ? `正文比截图上限还长，本次只截到 ${shot.height}px；看全篇请 export_html 后直接读 article.html`
          : undefined
      }
    }
  },
  {
    name: 'generate_image',
    description:
      'AI 生图并保存到工程 assets/，返回相对路径（正文引用写 ![alt](该路径)）。传 reference 则走图生图：基于工程内一张参考图重画，供应商各走自己的图生图契约（商汤 /images/edits、APIMart image_urls）；不支持的会报错并提示换模型。经 bridge 调用时客户端断开（取消工具调用/代理超时）即中止在途生图',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        prompt: { type: 'string', description: '画面描述提示词（图生图时写「改什么、保留什么」）' },
        path: { type: 'string', description: '保存相对路径（缺省 assets/gen-<时间戳>.png）' },
        ratio: { type: 'string', description: '宽高比（Agnes 支持 1:1/4:3/16:9/3:4/2.35:1 等，缺省 4:3）' },
        reference: {
          type: 'string',
          description: '参考图（工程内相对路径，如 assets/cover-bg.png）：传入即走图生图；当前供应商没有接图生图时会报错，换一个支持参考图的生图模型即可'
        },
        longEdge: { type: 'number', description: '商汤侧长边像素（缺省 1024；封面级画面传 2432）' }
      },
      required: ['project', 'prompt']
    },
    handler: async (a, ctx) => {
      const project = projectArg(a)
      // 参考图在主进程读成 data URI：商汤 edits 只收公网 URL 或带 data:image/...;base64, 前缀的串
      const refRel = str(a, 'reference', false)
      let reference: string | undefined
      if (refRel) {
        const abs = absOf(project, refRel)
        if (!existsSync(abs)) throw new Error(`参考图不存在：${refRel}（先 list_project_assets 看有哪些图）`)
        const ext = (abs.split('.').pop() ?? 'png').toLowerCase()
        const mime =
          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png'
        reference = `data:${mime};base64,${readFileSync(abs).toString('base64')}`
      }
      const base64 = await generateImage(
        str(a, 'prompt'),
        {
          ratio: str(a, 'ratio', false) || undefined,
          longEdge: typeof a.longEdge === 'number' ? a.longEdge : undefined,
          reference
        },
        ctx?.signal
      )
      const rel = str(a, 'path', false) || `assets/gen-${Date.now()}.png`
      const saved = store.saveAsset(project, rel, base64)
      return { path: saved, path_abs: absOf(project, saved) }
    }
  },
  {
    name: 'import_image',
    description: '把本机图片文件复制进工程 assets/，返回相对路径',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        source: { type: 'string', description: '图片绝对路径（png/jpg/webp/gif）' },
        path: { type: 'string', description: '保存相对路径（缺省 assets/<原文件名>）' }
      },
      required: ['project', 'source']
    },
    handler: (a) => {
      const project = projectArg(a)
      const source = str(a, 'source')
      if (!isAbsolute(source) || !existsSync(source)) throw new Error(`源文件不存在：${source}`)
      if (!/\.(png|jpe?g|webp|gif)$/i.test(source)) throw new Error('仅支持 png/jpg/webp/gif')
      const rel = str(a, 'path', false) || `assets/${basename(source)}`
      const base64 = readFileSync(source).toString('base64')
      const saved = store.saveAsset(project, rel, base64)
      return { path: saved, path_abs: absOf(project, saved) }
    }
  },
  {
    name: 'set_cover',
    description: '设置工程封面（写入 project.json）：main 为 2.35:1 主封面，square 为 1:1 方图。路径传工程内相对路径，也收 generate_image / import_image 刚返回的绝对路径',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        main: { type: 'string', description: '主封面路径（assets/ 内相对路径，或工程内绝对路径）' },
        square: { type: 'string', description: '1:1 方图路径（可选，缺省同 main）' }
      },
      required: ['project', 'main']
    },
    handler: (a) => {
      const project = projectArg(a)
      const main = relAsset(project, str(a, 'main'))
      const squareRaw = str(a, 'square', false)
      const square = squareRaw ? relAsset(project, squareRaw) : main
      if (!existsSync(join(store.projectDir(project), main))) throw new Error(`封面图不存在：${main}`)
      const meta = store.readMeta(project)
      store.writeMeta(project, { ...meta, cover: { main, square } })
      // 封面落盘必须广播：漏了这一步，作者改了封面但封面墙/预览还是旧图，看起来就像「设了没反应」
      notifyChange(project, 'project.json')
      broadcast('workspace:assets-changed', { project })
      return { ok: true, cover: { main, square }, main_abs: absOf(project, main), square_abs: absOf(project, square) }
    }
  },
  {
    name: 'schedule_set',
    description:
      '设置工程的发布排期（写入 project.json 的 plannedAt，内容日历看板按此聚合展示）。date 为本地日期 YYYY-MM-DD，null/不传 = 取消排期。适合 Agent 在文章完成后自动排期或按日历调整发布计划',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        date: { type: ['string', 'null'], description: '排期日期 YYYY-MM-DD；null 取消排期' }
      },
      required: ['project']
    },
    handler: (a) => {
      const project = projectArg(a)
      const date = a.date === undefined || a.date === null ? null : String(a.date)
      if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`非法排期日期（应为 YYYY-MM-DD）：${date}`)
      }
      const meta = store.readMeta(project)
      meta.plannedAt = date ?? undefined
      store.writeMeta(project, meta)
      notifyChange(project, 'project.json')
      return { ok: true, plannedAt: date ?? undefined }
    }
  },
  {
    name: 'export_html',
    description:
      '把 article.md 导出为 HTML 文件，返回绝对路径。variant 配色：auto 读者端自动昼夜（prefers-color-scheme，适合部署自有网页/博客）/ day 固定日间（浅卡深字）/ night 固定夜间；公众号不吃媒体查询，要贴公众号只能用 day 或 night。platform 传知乎/头条/百家号时改导出平台适配稿，适合多平台分发前拿稿源。推送与导出的完整口径见 get_guide 的 publish 段',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        variant: { type: 'string', enum: ['auto', 'day', 'night'], description: '配色模式（缺省 auto；仅公众号路径有效）' },
        platform: {
          type: 'string',
          enum: ['wechat', 'zhihu', 'toutiao', 'baijiahao'],
          description: '分发目标平台（缺省 wechat=公众号排版 article.html；其他平台落 article-<platform>.html）'
        }
      },
      required: ['project']
    },
    handler: (a) => {
      const project = projectArg(a)
      const platform = str(a, 'platform', false)
      const path =
        platform && platform !== 'wechat'
          ? exportPlatformHtml(project, platform as 'zhihu' | 'toutiao' | 'baijiahao')
          : exportArticleHtml(project, (str(a, 'variant', false) || 'auto') as 'auto' | 'day' | 'night')
      store.stampExported(project)
      return { path }
    }
  },
  {
    name: 'export_docx',
    description:
      '把工程导出为可编辑的 Word 交稿稿（标题/正文/表格/图片进 Word 原生结构，可继续编辑），落到工程「交付/」目录，返回绝对路径。适合代运营给甲方审稿、投稿存档、二次编辑；封面若已设置自动放文档首页',
    inputSchema: {
      type: 'object',
      properties: { project: P.project },
      required: ['project']
    },
    handler: async (a) => {
      const project = projectArg(a)
      const path = await exportDocx(project)
      store.stampExported(project)
      return { path }
    }
  },
  {
    name: 'export_pdf',
    description:
      '把工程导出为 PDF 交稿稿（与编辑器预览/推送同源的日间排版，经隐藏窗口 printToPDF 生成，A4 含背景色与图片），落到工程「交付/」目录，返回绝对路径。适合打印、投屏审稿、不可编辑的存档交付；要对方继续改就用 export_docx，要贴网页就用 export_html',
    inputSchema: {
      type: 'object',
      properties: { project: P.project },
      required: ['project']
    },
    handler: async (a) => {
      const project = projectArg(a)
      const path = await exportPdf(project)
      store.stampExported(project)
      return { path }
    }
  },
  {
    name: 'push_draft',
    description:
      '把工程推送到公众号草稿箱：正文本地图片自动上传微信 CDN，封面传永久素材，draft/add 入草稿。variant 配色二选一（缺省 day）。账号、分类绑定与本机公网 IP 白名单等前置条件先读 get_guide 的 publish 段；前置不满足时的失败文本要照实转述给作者，不要说成已入草稿',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        variant: { type: 'string', enum: ['day', 'night'], description: '发布配色（缺省 day）' }
      },
      required: ['project']
    },
    handler: async (a) => {
      const project = projectArg(a)
      const r = await pushDraft(project, str(a, 'variant', false) === 'night' ? 'night' : 'day')
      // 与 UI 推送同规：成功即盖章（顺带推进 ready）
      if (r.ok) store.stampExported(project)
      return r
    }
  },
  {
    name: 'push_cards',
    description:
      '把贴图组推送到公众号草稿箱（图片消息形态，读者可左右滑动看图）：每张卡片 PNG 传永久素材，配文用发布配文，标题取封面卡标题。需全部卡片已渲染、最多 20 张；AppID/AppSecret 与 IP 白名单要求同 push_draft',
    inputSchema: { type: 'object', properties: { project: P.project }, required: ['project'] },
    handler: async (a) => {
      const project = projectArg(a)
      const r = await pushCards(project)
      if (r.ok) store.stampExported(project)
      return r
    }
  },

  // ---- 贴图卡组编排（此前只有 push_cards：Agent 能推不能读、不能写、不能出图）----
  {
    name: 'read_cards',
    description:
      '读贴图卡组 cards.json：format/accent/caption 与每张卡的标题、正文、背景、模式、已渲染 PNG 路径。要改就先读再整体 write_cards 回写；archive 传 wechat/xhs 读那份风格的存档（转风格前的备份）',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        archive: { type: 'string', enum: ['wechat', 'xhs'], description: '读该风格的存档版；不传 = 读当前 cards.json' }
      },
      required: ['project']
    },
    handler: (a) => {
      const project = projectArg(a)
      const archive =
        a.archive === undefined || a.archive === null || a.archive === '' ? null : cardFormatArg(a.archive, 'wechat')
      const deck = archive ? readArchivedCards(project, archive) : readCards(project)
      if (!deck) {
        throw new Error(
          archive
            ? `没有 ${archive} 风格的存档（cards-${archive}.json 不存在）：当前卡组请不带 archive 调 read_cards`
            : '该工程还没有贴图卡组：先 write_cards 建组；不确定工程形态就看 get_project 的 meta.format'
        )
      }
      const rendered = deck.cards.filter((c) => c.png).length
      return {
        ...deck,
        card_count: deck.cards.length,
        rendered_count: rendered,
        root: store.projectDir(project),
        hint:
          rendered < deck.cards.length
            ? `${deck.cards.length - rendered} 张还没有 PNG：推送贴图草稿要求全部出图，调 render_card 带 all:true`
            : undefined
      }
    }
  },
  {
    name: 'write_cards',
    description:
      '整体写入贴图卡组 cards.json（覆盖式，传完整卡组而不是追加）。每张卡可带 title/body/tag/bgPrompt/bgImage/bgOpacity/dark/fontScale/numbered/mode/aiImage，字段口径见 get_guide 的 cards 段；写完不会自动出图，要 render_card。archive 传 true 则只存档到 cards-<format>.json（转风格前留原版），不动当前卡组',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        deck: {
          type: 'object',
          description: '完整卡组 {format, cards:[…], accent?, caption?}；把 format/cards/accent/caption 平铺在本层参数里也收',
          properties: {
            format: { type: 'string', enum: ['wechat', 'xhs'], description: '贴图风格：wechat 公众号长卡 / xhs 小红书方卡' },
            accent: { type: 'string', description: '整套卡强调色 #rrggbb' },
            caption: { type: 'string', description: '发布配文（push_cards 用的就是它）' },
            cards: { type: 'array', description: '卡片列表，数组顺序即读者翻页顺序', items: { type: 'object' } }
          },
          required: ['format', 'cards']
        },
        archive: { type: 'boolean', description: 'true = 写到 cards-风格.json 存档（wechat/xhs 各一份），不动当前 cards.json' }
      },
      required: ['project']
    },
    handler: (a) => {
      const project = projectArg(a)
      // deck 收在对象里也收在顶层：模型两种包法都出现过，只认一种就是等它猜
      const src = (a.deck && typeof a.deck === 'object' && !Array.isArray(a.deck) ? a.deck : a) as Record<string, unknown>
      const cardsRaw = coerceArrayArg(src.cards, 'cards', '[{"title":"这页讲什么","body":"正文两三句"}]') as CardItem[]
      const format = cardFormatArg(src.format, 'wechat')
      const deck: CardDeck = {
        format,
        cards: cardsRaw.map((c, i) => {
          if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`第 ${i + 1} 张卡片不是对象`)
          const item = c as unknown as CardItem
          if (!String(item.title ?? '').trim() && !String(item.body ?? '').trim())
            throw new Error(`第 ${i + 1} 张卡片 title 和 body 都是空的：贴图卡至少要留下一句看得懂的话`)
          return item
        }),
        accent: typeof src.accent === 'string' && src.accent.trim() ? src.accent.trim() : undefined,
        caption: typeof src.caption === 'string' && src.caption.trim() ? src.caption.trim() : undefined
      }
      if (deck.accent && !isHexColor(deck.accent)) throw new Error(`deck.accent 需要 #rrggbb，收到：${deck.accent}`)
      const asArchive = a.archive === true || a.archive === 'true'
      if (asArchive) writeArchivedCards(project, deck)
      else writeCards(project, deck)
      // 读回一次：落盘走字段白名单重建，不认识的键会被丢掉。不报就等于让 Agent 拿着被削过的卡组
      // 声称「按你要的排好了」——与 set_theme 的 unknownKeys 同一套诚信口径
      const back = asArchive ? readArchivedCards(project, deck.format) : readCards(project)
      const dropped: string[] = []
      deck.cards.forEach((c, i) => {
        const kept = back?.cards[i] as unknown as Record<string, unknown> | undefined
        if (!kept) return
        for (const k of Object.keys(c)) if (!(k in kept)) dropped.push(`第${i + 1}张.${k}`)
      })
      notifyChange(project, asArchive ? `cards-${deck.format}.json` : 'cards.json')
      broadcast('workspace:assets-changed', { project })
      const meta = store.readMeta(project)
      let marked: string | undefined
      if (!asArchive && meta.format !== 'cards') {
        // 与向导立项同规：卡组非空即贴图形态，封面墙据此决定取卡还是取文章封面
        store.writeMeta(project, { ...meta, format: 'cards' })
        notifyChange(project, 'project.json')
        marked = '工程已标记为贴图形态（format: cards）'
      }
      if (!asArchive) ensureDrafting(project)
      const hint = [
        asArchive
          ? `卡组已存档到 cards-${deck.format}.json，当前 cards.json 未改动（读回用 read_cards 的 archive）`
          : `${deck.cards.length} 张卡已写入 cards.json（${deck.format} 风格）；还没出图，render_card 带 all:true 一次渲染全部`,
        marked,
        dropped.length
          ? `以下字段不认识、已被丢弃，不得向作者声称已生效：${dropped.join('、')}（卡组字段口径见 get_guide 的 cards 段）`
          : undefined
      ]
        .filter(Boolean)
        .join('；')
      return { ok: true, format: deck.format, count: deck.cards.length, archived: asArchive, droppedKeys: dropped, hint }
    }
  },
  {
    name: 'render_card',
    description:
      '把贴图卡片渲染成 PNG（1242×1656 离屏截图，落 cards/风格/card-N.png 并回写该卡的 png 字段）。index 从 0 数；all 传 true 一次渲染全部卡片，push_cards 要求全部已出图',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        index: { type: 'number', description: '卡片下标，从 0 开始（不带 all 时必填）' },
        all: { type: 'boolean', description: 'true = 渲染卡组里所有卡片' }
      },
      required: ['project']
    },
    handler: async (a) => {
      const project = projectArg(a)
      const deck = readCards(project)
      if (!deck || !deck.cards.length) throw new Error('该工程没有可渲染的卡组：先 write_cards')
      const wantAll = a.all === true || a.all === 'true'
      const indexes = wantAll ? deck.cards.map((_, i) => i) : [num(a, 'index')]
      for (const i of indexes) {
        if (!Number.isInteger(i) || i < 0 || i >= deck.cards.length)
          throw new Error(`卡片下标越界：${i}（本工程共 ${deck.cards.length} 张，合法范围 0-${deck.cards.length - 1}）`)
      }
      const rendered: { index: number; png: string; png_abs: string }[] = []
      for (const i of indexes) {
        const png = await renderCard(project, i)
        rendered.push({ index: i, png, png_abs: absOf(project, png) })
      }
      notifyChange(project, 'cards.json')
      broadcast('workspace:assets-changed', { project })
      const missing = (readCards(project)?.cards ?? []).filter((c) => !c.png).length
      return {
        rendered,
        missing_png: missing,
        hint: missing ? `还有 ${missing} 张没有 PNG，push_cards 会被拦：再调一次 render_card all:true` : undefined
      }
    }
  },
  {
    name: 'render_cover_template',
    description:
      '用封面模板直出封面：只渲染一张 2.35:1 主图（assets/cover-235.png），返回的 1:1 方图（assets/cover-11.png）是从这张主图裁出来的一段——公众号后台只采纳 2.35:1 那一张，另外排一版方图它不认，所以构图要为「右半单独裁出来也好看」服务。template：split 左文右图 / magazine 杂志大字 / aurora 氛围渐变 / plain 大字版式 / left 左侧竖栏 / editorial 杂志留白；比 generate_image 出的图字准、可复现。传 prompt 可一步完成「AI 生底图 + 模板合成」（自动按 2.35:1 生图、左侧留白构图、字色与磨砂面板自适应）。结果自动写进 project.json 的 cover',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        template: { type: 'string', enum: COVER_TEMPLATES.map((t) => t.id), description: '版式 id（见本工具第一句）' },
        title: { type: 'string', description: '封面大字（按长度自动断行缩字；用 | 手动分行字号更大）' },
        subtitle: { type: 'string', description: '副标题（可选）' },
        accent: { type: 'string', description: '强调色 #rrggbb' },
        bg: {
          type: 'string',
          description: '底图工程内相对路径（可选，如 assets/cover-bg.png）；editorial 与 plain 是纯排印版式，传了也会被忽略（连 prompt 生图那一步都跳过）'
        },
        prompt: {
          type: 'string',
          description: '底图生图提示词（可选）：内部按 2.35:1 生图存 assets/ 并作为 bg 合成，与 bg 参数二选一'
        },
        brand: { type: 'string', description: '右下品牌行（可选，如 @LIG人生如戏）' },
        panel: {
          type: 'string',
          enum: ['frosted', 'none'],
          description: '文字区磨砂面板：缺省不铺；frosted 开一层磨砂（构图翻车、文字区不安静时的保底）；none 显式关'
        },
        decor: { type: 'boolean', description: '装饰元素开关（光晕/圆环/细线），缺省 true' },
        focal: {
          type: 'number',
          description:
            '1:1 方图从主图取哪一段：0=最左 / 0.5=居中 / 1=最右。缺省按版式定：照片类取到最右（方形画面区就在最右边），plain 大字版式取最左（通栏大字的开头才是主体）；有底图时还会按左右半区细节量自动改判'
        }
      },
      required: ['project', 'template', 'title', 'accent']
    },
    handler: async (a) => {
      const project = projectArg(a)
      const template = str(a, 'template')
      const ids = COVER_TEMPLATES.map((t) => t.id)
      if (!ids.includes(template)) throw new Error(`未知封面版式：${template}（可选：${ids.join(' / ')}）`)
      const accent = str(a, 'accent')
      if (!isHexColor(accent)) throw new Error(`accent 需要 #rrggbb，收到：${accent}`)
      const bg = str(a, 'bg', false)
      const prompt = str(a, 'prompt', false)
      if (bg && prompt) throw new Error('bg 与 prompt 二选一：已有底图传 bg，要现场生图传 prompt')
      if (bg && !existsSync(absOf(project, bg)))
        throw new Error(`底图不存在：${bg}（相对工程根的路径；先看 list_project_assets 有哪些图，或改用 prompt 现场生一张）`)
      const panelRaw = str(a, 'panel', false)
      const panel = panelRaw === 'frosted' || panelRaw === 'none' ? panelRaw : undefined
      // 现场生底图的构图约束不在这里拼——统一由 coverStore.renderCoverTemplate 处理，界面走同一条路
      const r = await renderCoverTemplate(project, {
        template,
        title: str(a, 'title'),
        subtitle: str(a, 'subtitle', false) || undefined,
        accent,
        bg: bg || undefined,
        prompt: prompt || undefined,
        brand: str(a, 'brand', false) || undefined,
        panel,
        decor: typeof a.decor === 'boolean' ? a.decor : undefined,
        focal: typeof a.focal === 'number' ? a.focal : undefined
      })
      notifyChange(project, 'project.json')
      broadcast('workspace:assets-changed', { project })
      return {
        ...r,
        main_abs: absOf(project, r.main),
        square_abs: absOf(project, r.square),
        ...(r.bg ? { bg_abs: absOf(project, r.bg) } : {})
      }
    }
  },
  {
    name: 'render_cover_html',
    description:
      '把自定义 HTML 直接渲染成封面 PNG（程序化封面入口：HTML/CSS/Canvas 任意排版，不落模板）。html 传工程内相对路径（如 covers/my-cover.html；可以是手改的 covers/cover-wide.html，本工具只截图、不重生成、不会覆盖手改）。只产出一张横图（assets/），**不另写方图文件**——后台只认这一张，1:1 由它自己裁；需要方图就从这张裁。产物落 assets/ 但不自动设为封面：确认满意后用 set_cover 写入 project.json',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        html: { type: 'string', description: '工程内相对路径的 HTML 文件（宽高需在 HTML 内联锁死）' },
        out: { type: 'string', description: 'PNG 落盘相对路径（缺省 assets/cover-custom-<时间戳>.png）' },
        width: { type: 'number', description: '画布宽度，缺省 1175（2.35:1 主图口径）' },
        height: { type: 'number', description: '画布高度，缺省 500' },
        focal: {
          type: 'number',
          description: '裁 1:1 时从横图取哪一段：0=最左 / 0.5=居中 / 1=最右，缺省取到最右'
        }
      },
      required: ['project', 'html']
    },
    handler: async (a) => {
      const project = projectArg(a)
      const html = str(a, 'html')
      const w = num(a, 'width') || COVER_WIDE.w
      const h = num(a, 'height') || COVER_WIDE.h
      if (w < 100 || w > 2400 || h < 100 || h > 2400) throw new Error(`尺寸超范围（100-2400）：${w}x${h}`)
      const r = await renderCoverHtml(project, {
        html,
        out: str(a, 'out', false) || undefined,
        width: Math.round(w),
        height: Math.round(h),
        focal: typeof a.focal === 'number' ? a.focal : undefined
      })
      broadcast('workspace:assets-changed', { project })
      return {
        ...r,
        path_abs: absOf(project, r.path),
        hint: '未设为封面：确认后用 set_cover 写入 project.json。方图不落盘——它是这张主图的裁剪，后台自己会裁'
      }
    }
  },

  // ---- 选题库读取与立项（此前只有 save_ideas：能写进库，读不出来也立不了项）----
  {
    name: 'list_ideas',
    description:
      '读全局选题库：每条带 index/标题/角度/人群/评分/理由，以及这条选题现在走到哪一步（idle 未立项 / projected 已立项 / scheduled 已排期 / ready 已成稿）与对应工程名',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const ideas = store.listIdeas()
      let stages: ReturnType<typeof store.listIdeaStages> | null = null
      let stageError: string | undefined
      try {
        stages = store.listIdeaStages()
      } catch (err) {
        // 任一工程 project.json 损坏时 store 直接抛：如实带出来，别让看板状态静默缺席
        stageError = err instanceof Error ? err.message : String(err)
      }
      return {
        count: ideas.length,
        ideas,
        stages,
        hint: stageError
          ? `阶段信息没算出来（有工程元数据读不出来）：${stageError}`
          : ideas.length
            ? '立项并排期用 schedule_idea（传 index + 日期）'
            : '选题库是空的：brainstorm_prompt 出提示词 → 自己的模型跑完 → save_ideas 入库'
      }
    }
  },
  {
    name: 'schedule_idea',
    description:
      '从选题库立项并排期：按 index 取那条选题，建工程（同名撞车自动加日期后缀）、写入内容日历排期、把选题画像落到 project.json；选题本身保留在库里不消耗',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '选题下标（list_ideas 返回的 index，从 0 开始）' },
        date: { type: 'string', description: '排期日期 YYYY-MM-DD' },
        category: { type: 'string', description: '目标分类（可选；缺省走分类级预设）' }
      },
      required: ['index', 'date']
    },
    handler: (a) => {
      const r = store.scheduleIdea(num(a, 'index'), str(a, 'date'), str(a, 'category', false) || undefined)
      broadcast('workspace:changed', null)
      return { ...r, hint: `已立项为工程「${r.name}」并排期 ${r.plannedAt}；选题仍留在库里，看板记为已排期` }
    }
  },

  // ---- 主题库读取与套用（此前只有 save_theme_preset：写得进、读不出、也切不了）----
  {
    name: 'list_themes',
    description:
      '读排版主题库：每套自定义主题的名字、归属分类、强调色、生效字段数，以及每个分类当前套用哪套（active 指针）。改主题前先读这个，别凭印象造主题名；detail=true 连完整主题对象一起给',
    inputSchema: {
      type: 'object',
      properties: { detail: { type: 'boolean', description: 'true = 每套附完整字段对象（体积大，只在逐字段对照已有主题时开）' } }
    },
    handler: (a) => {
      const lib = listLibrary()
      const themes = Object.entries(lib.themes).map(([name, entry]) => ({
        name,
        category: entry.category,
        accent: entry.theme.accent,
        fields: Object.keys(entry.theme).length,
        ...((a.detail === true || a.detail === 'true') ? { theme: entry.theme } : {})
      }))
      return {
        count: themes.length,
        themes,
        active: Object.entries(lib.active).map(([category, name]) => ({ category, name })),
        hint: themes.length
          ? '切换套用 set_active_theme；删除 delete_theme；整套改写先 list_themes detail:true 读回来再存'
          : '库里还没有自定义主题：save_theme_preset 存一套'
      }
    }
  },
  {
    name: 'set_active_theme',
    description:
      '切换某分类当前套用的排版主题（该分类下打开工程即生效）；name 传 null = 解绑、回落分类默认调性。主题名必须已存在，写错会连库里现有名字一起报出来',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '分类名（workspace 下的一级目录名）' },
        name: { type: ['string', 'null'], description: '主题名（list_themes 的 name）；null 解绑回默认' }
      },
      required: ['category']
    },
    handler: (a) => {
      const category = str(a, 'category')
      const raw = a.name
      const name = raw === null || raw === undefined || raw === '' ? null : String(raw)
      try {
        setActiveTheme(category, name)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (name && /主题不存在/.test(msg))
          throw new Error(`${msg}。库里现有主题：${Object.keys(listLibrary().themes).join(' / ') || '（空，先 save_theme_preset 存一套）'}`)
        throw err
      }
      broadcast('workspace:changed', null)
      return {
        ok: true,
        category,
        name,
        hint: name ? `分类「${category}」现在套用主题「${name}」` : `分类「${category}」已解绑主题，回落默认调性`
      }
    }
  },
  {
    name: 'delete_theme',
    description:
      '从主题库删一套自定义主题（同时解绑所有指向它的分类套用）。不可恢复，必须带 confirm:true；名字不存在时不报错，但会如实返回 deleted:false',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '主题名（list_themes 的 name）' },
        confirm: { type: 'boolean', description: '必须显式传 true：代表作者已同意删除' }
      },
      required: ['name']
    },
    handler: (a) => {
      const name = str(a, 'name')
      requireConfirm(a, `删除主题「${name}」`)
      const before = Object.keys(listLibrary().themes)
      deleteTheme(name)
      const after = Object.keys(listLibrary().themes)
      const deleted = before.includes(name) && !after.includes(name)
      return {
        deleted,
        name,
        hint: deleted
          ? `主题「${name}」已删除，库里剩 ${after.length} 套`
          : `主题「${name}」本来就不在库里，什么都没删（现有：${after.join(' / ') || '空'}）`
      }
    }
  },

  // ---- Skill 库读写（此前外部 Agent 只能在 *_prompt 结果里被动收到全文）----
  {
    name: 'list_skills',
    description:
      '列本机 Skill 库（注入系统提示的写作方法论文件）：名字/描述/绝对目录/是否启用。挂到工程用 set_project_skill，新建或改写用 save_skill',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const skills = listSkills()
      return {
        count: skills.length,
        skills,
        hint: skills.some((s) => !s.enabled) ? '有停用的 Skill：停用状态下不会被注入提示词，要用先启用或直接 save_skill 覆盖' : undefined
      }
    }
  },
  {
    name: 'save_skill',
    description:
      '新建或同名覆盖一个 Skill（content 传 SKILL.md 全文）。多工程复用同一套口径时，写成 Skill 比每次在对话里重复要求划算；存完用 set_project_skill 挂上',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill 名（即目录名，不能含路径分隔符、盘符冒号或 ..）' },
        content: { type: 'string', description: 'SKILL.md 全文（markdown）' }
      },
      required: ['name', 'content']
    },
    handler: (a) => {
      const name = str(a, 'name')
      if (/[\\/:*?"<>|]|\.\./.test(name)) throw new Error(`非法 Skill 名：${name}（不能含 \\ / : * ? " < > | 或 ..）`)
      const content = str(a, 'content')
      if (!content.trim()) throw new Error('content 为空：Skill 正文不能是空文件')
      const saved = saveSkill(name, content)
      const hit = listSkills().find((s) => s.name === saved)
      return {
        name: saved,
        dir: hit?.dir,
        description: parseDescription(content),
        hint: '挂载到工程用 set_project_skill；挂载后本工程的脑暴/大纲/全文/审阅/标题提示词会自动带上这套方法论全文'
      }
    }
  },
  {
    name: 'set_project_skill',
    description:
      '给工程挂载或换掉风格 Skill（写 project.json 的 style_skill）；skill 传 null = 取消挂载。挂载名必须来自 list_skills，写错会连可用名字一起报出来',
    inputSchema: {
      type: 'object',
      properties: { project: P.project, skill: { type: ['string', 'null'], description: 'Skill 名；null 取消挂载' } },
      required: ['project']
    },
    handler: (a) => {
      const project = projectArg(a)
      const raw = a.skill
      const skill = raw === null || raw === undefined || raw === '' ? null : String(raw)
      if (skill) {
        try {
          readSkill(skill)
        } catch {
          throw new Error(`Skill 不存在：${skill}。本机可用：${listSkills().map((s) => s.name).join(' / ') || '（空，先 save_skill 建一个）'}`)
        }
      }
      const meta = store.readMeta(project)
      store.writeMeta(project, { ...meta, style_skill: skill ?? undefined })
      notifyChange(project, 'project.json')
      return { ok: true, project, skill, hint: skill ? `已挂载风格 Skill「${skill}」` : '已取消挂载，本工程回到默认调性' }
    }
  },

  // ---- 工程治理（Agent 能造垃圾也能收：改名、删除、素材清单、同名歧义）----
  {
    name: 'rename_project',
    description:
      '重命名工程（目录同步改名）。非法字符会被清掉、超 30 字会被截断，所以后续调用一定要用返回的 name；旧名字当场失效，同分类撞名报错',
    inputSchema: {
      type: 'object',
      properties: { project: P.project, new_name: { type: 'string', description: '新工程名（也是新目录名）' } },
      required: ['project', 'new_name']
    },
    handler: async (a) => {
      const oldName = projectArg(a)
      const input = str(a, 'new_name')
      const target = sanitizeProjectName(input)
      if (!target) throw new Error(`新工程名清完非法字符后是空的：${input}`)
      const was = await pauseProjectWatcher(oldName)
      const meta = store.renameProject(oldName, target)
      if (was) resumeProjectWatcher(target)
      broadcast('workspace:changed', null)
      return {
        name: target,
        dir: store.projectDir(target),
        meta,
        hint: target !== input.trim() ? `名字按平台规则清洗过：「${input}」→「${target}」，请照清洗后的名字继续，不要说成原样改名` : undefined
      }
    }
  },
  {
    name: 'delete_project',
    description:
      '删除整个工程目录（正文、配图、交付物一起没，不可恢复）。必须带 confirm:true；只是不想现在发就改用 schedule_set 取消排期或换个分类，别删稿',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        confirm: { type: 'boolean', description: '必须显式传 true：代表作者已同意删除这个工程' }
      },
      required: ['project']
    },
    handler: async (a) => {
      const project = projectArg(a)
      requireConfirm(a, `删除工程「${project}」`)
      const dir = store.projectDir(project)
      await pauseProjectWatcher(project)
      store.deleteProject(project)
      const gone = !existsSync(dir)
      broadcast('workspace:changed', null)
      return {
        deleted: gone,
        project,
        dir,
        hint: gone ? undefined : `目录没删掉：${dir} 可能被其它程序占用，或它本来就不存在`
      }
    }
  },
  {
    name: 'list_project_assets',
    description:
      '列工程里已有的素材：assets 图片 / figures 图表 HTML / covers 封面 HTML / cards 卡片图 / 交付 产物，均为工程内相对路径，另附 root 绝对路径便于直接读文件',
    inputSchema: { type: 'object', properties: { project: P.project }, required: ['project'] },
    handler: (a) => {
      const project = projectArg(a)
      const r = store.listProjectAssets(project)
      const total = Object.values(r).reduce((n, list) => n + list.length, 0)
      return { ...r, root: store.projectDir(project), total, hint: total ? undefined : '这个工程还没有任何素材' }
    }
  },
  {
    name: 'find_duplicate_projects',
    description:
      '查同名工程：同一个名字散落在多个分类目录时，list_projects 会出现同名多条，按名字定位就有歧义。返回每组的绝对路径与更新时间，据此再决定改哪一个',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const groups = store.findDuplicateProjects()
      return {
        count: groups.length,
        groups,
        hint: groups.length ? `${groups.length} 组同名工程：这一批调用请带 dir（绝对路径）而不是 project 名` : '没有同名工程'
      }
    }
  }
]


/** 凡带 project 入参的工具一律自动多收 dir（工程绝对路径）：
 *  名字里的全角 “ ” ： 在不同模型手里会被写成半角或 「 」，而路径是稳定标识；
 *  加在这里而不是逐个工具改 schema，新增带 project 的工具自动继承 */
for (const t of TOOLS) {
  const props = t.inputSchema.properties as Record<string, unknown>
  if (props.project && !props.dir) {
    props.dir = {
      type: 'string',
      description: '工程绝对路径（list_projects / create_project 返回的 dir）；与 project 二选一，工程名带标点时优先用它'
    }
  }
}

/** 资源路径宽容：Agent 常把上一步返回的绝对路径原样传回 set_cover。
 *  工程内的绝对路径折成相对路径；工程外的事先说清楚怎么补救，不留「封面图不存在」这种没法执行的报错 */
function relAsset(project: string, p: string): string {
  const root = store.projectDir(project)
  const t = p.trim().replace(/\\/g, '/')
  if (!isAbsolute(p)) return t
  const prefix = root.replace(/\\/g, '/') + '/'
  if (t.toLowerCase().startsWith(prefix.toLowerCase())) {
    const rel = t.slice(prefix.length)
    if (!existsSync(join(root, rel))) throw new Error(`封面图不存在：${p}（已按工程内路径找过，文件不在盘上）`)
    return rel
  }
  throw new Error(`封面图不在本工程内：${p}。先 import_image 把它复制进 assets/，再传它返回的相对路径`)
}

/** 按名执行工具（MCP tools/call 与 HTTP bridge 共用入口） */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx?: ToolCallCtx
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`未知工具：${name}`)
  return tool.handler(args ?? {}, ctx)
}

/** 对话副驾驶可执行工具清单（chat-tools v1）：排除提示词返回类与 headlessOnly 类——
 *  前者专为无头外部 Agent 设计（返回提示词、调用方自带模型），内部对话有自己的界面流；
 *  后者的结果是大体积图片（render_preview），内部对话没有看图通道，作者本来就能直接看编辑器 */
export function listExecTools(): { name: string; description: string; parameters: unknown }[] {
  return TOOLS.filter((t) => !t.name.endsWith('_prompt') && !t.headlessOnly).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema
  }))
}
