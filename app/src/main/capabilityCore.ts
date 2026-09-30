import { basename, isAbsolute, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { ArticleTheme, IdeaCard, TitleCandidate } from '@shared/types'
import { isHexColor } from '@shared/cards'
import {
  clampThemeNumbers,
  metaPatchToThemeKeys,
  normalizeThemeKeys,
  sanitizeThemePatchDetailed,
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
import * as store from './projectStore'
import { generateImage } from './imageGen'
import { renderFigure, saveFigureHtml } from './figureRender'
import { exportArticleHtml, exportPlatformHtml } from './exporter'
import { exportDocx, exportPdf } from './docExport'
import { pushCards, pushDraft } from './wechatPublish'
import { readSkill } from './skillStore'
import { saveCustomTheme } from './themeStore'
import { broadcast } from './ipc'

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
  handler: (args: Record<string, unknown>) => unknown
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

/** 正文已落盘但状态还停在脑暴时推进到撰写（原 generate 工具的职责） */
function ensureDrafting(project: string): void {
  const meta = store.readMeta(project)
  if (meta.status === 'ideating') {
    store.writeMeta(project, { ...meta, status: 'drafting' })
    notifyChange(project, 'project.json')
  }
}

const P = {
  project: { type: 'string', description: '工程名（workspace 下的目录名）；工程名含引号冒号等标点时可改传 dir' }
} as const

export const TOOLS: ToolDef[] = [
  {
    name: 'list_projects',
    description: '列出 workspace 下的全部图文工程（名称/状态/分类/更新时间）',
    inputSchema: { type: 'object', properties: {} },
    handler: () => store.listProjects()
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
    handler: (a) => store.setProjectCategory(projectArg(a), str(a, 'category'))
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
      '整体覆写 article.md 正文。markdown 子集：#/##/### 标题、段落、**加粗**、> 引用、--- 分隔线、![alt](assets/x.png) 图片（后跟 <!-- caption: 图注 -->）、<!-- fig-suggest: 详细画面描述 | 简短图注 --> 配图占位。手动样式（与编辑器选中片段设置同源）：<span style="color:#e63946;background-color:#fef3c7;font-size:18px">文本</span>——color 字色 / background-color 背景高亮 / font-size 字号（12-24px），可叠加 **加粗**，编辑器与公众号导出均渲染',
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
      '设置工程排版覆盖（写入 project.json，编辑器/导出/推送同源生效，与顶栏控件一致）。字段独立可传：accent 强调色 / bodyFontSize 正文字号 / headingFontSize 标题字号（H1=+6 H2=+0 H3=-3）/ bodyAlign 正文排列（indent 首行缩进 / flush 顶格两端对齐 / center 居中）/ headingAlign 标题排列（center 居中 / left 左）/ 标题版式四项 h1Style（bar 短横 / pill 胶囊色块字底 / underline 下划线）、h2Style（leftbar 左竖条 / block 色块标签 / underline 下划线 / plain 纯文字）、h2Num（H2 自动序号：01 / 1. / 1、 / 一、 / 壹、 / ① 圈号；none 显式关闭）、h3Mark（diamond 菱形 / dot 圆点 / none 无）/ bodyBg 文章背景卡（浅色系十六进制 #rrggbb；none 去卡片纯白底；夜间由公众号逻辑自动变深）。引用底色 quoteBg / 引用文字色 quoteText / 分隔线颜色 hrColor / H2 条色 h2Border（均十六进制，不设则按强调色或中性灰派生）。传 null = 恢复默认（跟随分类主题）。数值字段越界会被夹到区间内（行高 1.5-3 / 段距 0-48 / 圆角 0-40 / 字号 10-40），夹取结果写在返回的 hint 里，必须照实转述给用户，不要说成已按原值设置',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        accent: { type: ['string', 'null'], description: '强调色十六进制（#rrggbb）；null 恢复默认' },
        bodyFontSize: { type: ['number', 'null'], description: '正文字号 px（10-40）；null 跟随主题' },
        headingFontSize: { type: ['number', 'null'], description: '标题字号 px（12-40）；null 跟随主题' },
        bodyAlign: { type: ['string', 'null'], enum: ['indent', 'flush', 'center', null], description: '正文排列；null 跟随主题' },
        headingAlign: { type: ['string', 'null'], enum: ['center', 'left', null], description: '标题排列；null 跟随主题' },
        h1Style: { type: ['string', 'null'], enum: ['bar', 'pill', 'underline', null], description: 'H1 装饰；null 跟随主题' },
        h2Style: { type: ['string', 'null'], enum: ['leftbar', 'block', 'underline', 'plain', null], description: 'H2 装饰；null 跟随主题' },
        h2Num: { type: ['string', 'null'], enum: ['01', '1.', '1、', '一、', '壹、', '①', 'none', null], description: 'H2 自动序号格式；none 显式关闭；null 跟随主题' },
        h3Mark: { type: ['string', 'null'], enum: ['diamond', 'dot', 'none', null], description: 'H3 前缀标记；null 跟随主题' },
        bodyBg: { type: ['string', 'null'], description: '文章背景卡十六进制（#rrggbb，建议浅色系）；none 去卡片；null 跟随主题' },
        fontFamily: { type: ['string', 'null'], description: '正文字体栈（如 "Microsoft YaHei", sans-serif）；null 跟随主题' },
        lineHeight: { type: ['number', 'null'], description: '正文行高（1.5-3，非法值回落）；null 跟随主题' },
        letterSpacing: { type: ['string', 'number', 'null'], description: '字距（如 0.02em 或 0.5px；给裸数字按 px 处理）；null 跟随主题' },
        pGap: { type: ['number', 'null'], description: '段落间距 px（0-48）；null 跟随主题' },
        bodyText: { type: ['string', 'null'], description: '正文文字色十六进制；null 跟随主题' },
        headingColor: { type: ['string', 'null'], description: '标题文字色十六进制；显式设置后不随强调色重链；null 跟随主题' },
        quoteStyle: { type: ['string', 'null'], enum: ['leftbar', 'card', 'quotes', 'dashcard', null], description: '引用形态；null 跟随主题' },
        quoteBorder: { type: ['string', 'null'], description: '虚线引用卡边框色十六进制；null 跟随主题' },
        quoteBg: { type: ['string', 'null'], description: '引用区底色十六进制（不设=按强调色派生浅底）；null 跟随主题' },
        quoteText: { type: ['string', 'null'], description: '引用文字色十六进制（不设=按背景亮度自适应）；null 跟随主题' },
        hrColor: { type: ['string', 'null'], description: '分隔线颜色十六进制（不设=中性灰）；null 跟随主题' },
        h2Border: { type: ['string', 'null'], description: 'H2 左竖条/下划线颜色十六进制（不设=跟随强调色）；null 跟随主题' },
        hrStyle: { type: ['string', 'null'], enum: ['line', 'dot', 'long', null], description: '分隔线形态；null 跟随主题' },
        strongStyle: { type: ['string', 'null'], enum: ['color', 'highlight', 'plain', null], description: '加粗强调方式；null 跟随主题' },
        strongBg: { type: ['string', 'null'], description: '高亮加粗底色十六进制；null 跟随主题' },
        strongColor: { type: ['string', 'null'], description: '加粗强调色十六进制；显式设置后不随强调色重链；null 跟随主题' },
        imgRadius: { type: ['number', 'null'], description: '图片圆角 px（0-40）；null 跟随主题' },
        bodyRadius: { type: ['number', 'null'], description: '正文容器圆角 px（0-40）；null 跟随主题' },
        bodyPadding: { type: ['string', 'number', 'null'], description: '正文容器内边距（如 20px 22px；给裸数字按 px 处理）；null 跟随主题' },
        tableStyle: { type: ['string', 'null'], enum: ['bordered', 'striped', 'plain', null], description: '表格风格；null 跟随主题' },
        tableHeaderBg: { type: ['string', 'null'], description: '表头背景色十六进制；null 跟随主题' },
        tableBorder: { type: ['string', 'null'], description: '表格边框色十六进制；null 跟随主题' },
        tableHeaderText: { type: ['string', 'null'], description: '表头文字色十六进制；null 跟随主题' },
        h2Bg: { type: ['string', 'null'], description: 'H2 色块标签背景色十六进制；null 跟随主题' }
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
      const { values: ok, unknown: unmapped, invalid } = sanitizeThemePatchDetailed(bag)
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
      const reports = [...notes]
      if (ignoredKeys.length) reports.push(`不认识的参数已忽略：${ignoredKeys.join('、')}（可用键见本工具说明）`)
      if (droppedKeys.length)
        reports.push(`以下字段值不合法，未写入：${droppedKeys.join('、')}（色值要 #rrggbb、数值不带单位、枚举取说明里的形态）`)
      return reports.length ? { ok: true, hint: reports.join('；'), ignoredKeys, droppedKeys } : { ok: true }
    }
  },
  {
    name: 'save_theme_preset',
    description:
      '为分类设计并保存整套排版主题（写入自定义主题库，同名分类目录自动创建，保存即生效——该分类下打开工程即套用）。theme 为完整 ArticleTheme 主题对象：accent 必填（十六进制强调色）；常用字段 fontFamily 字体栈 / lineHeight 行高 1.5-3 / letterSpacing 字距 / fontSize 正文字号 / headingFontSize 标题字号 / bodyBg 正文背景卡（浅色系） / bodyRadius 圆角 / bodyPadding 内边距 / pGap 段间距 / h1Style·h2Style·h2Num·h3Mark 标题版式 / quoteStyle·quoteBorder·quoteBg·quoteText 引用 / hrStyle·hrColor 分隔线 / h2Border H2 条色 / hrStyle 分隔线 / strongStyle·strongBg·strongColor 加粗 / tableStyle·tableHeaderBg·tableBorder·tableHeaderText 表格 / imgRadius 图片圆角 / bodyText·headingColor·h2Bg 色系。非法或缺失字段自动回落默认调性',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '主题名（=分类名，将作为目录名自动创建）' },
        theme: {
          type: 'object',
          description:
            '完整排版主题对象，**键名必须严格用下面这些**（accent 必填）：accent / fontFamily / lineHeight(1.5-3) / letterSpacing / fontSize(10-40) / headingFontSize(10-40) / bodyAlign / headingAlign / h1Style / h2Style / h2Num / h3Mark / bodyBg / pGap(0-48) / bodyText / headingColor / quoteStyle / quoteBorder / hrStyle / strongStyle / strongBg / strongColor / imgRadius(0-40) / bodyRadius(0-40) / bodyPadding / tableStyle / tableHeaderBg / tableBorder / tableHeaderText / h2Bg / quoteBg / quoteText / hrColor / h2Border。不要自造键名（如 text_color / font_family / paragraph_spacing），系统会拒收并在结果里列出',
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
        throw new Error('缺少参数 name（主题名，同时作为分类目录名），形状：{"name":"主题名","theme":{"accent":"#7c3aed", ...}}')
      // 主题名也接受 category 写法（模型常把「给哪个分类」当成参数名），两者都缺才报错
      const themeRaw = (a.theme ?? {}) as Record<string, unknown>
      const { values, unknown, invalid } = sanitizeThemePatchDetailed(themeRaw)
      const patch = metaPatchToThemeKeys(values)
      if (!patch.accent)
        throw new Error(
          'theme.accent 必填（十六进制强调色），缺失则整套主题无法成立；theme 的键名须与工具说明一致'
        )
      if (!Object.keys(patch).length) throw new Error('theme 里没有一个可识别的键，请严格按工具说明的键名重发')
      saveCustomTheme(name, { ...(patch as ArticleTheme), origin: 'panel' })
      // 广播让工程树/设置即时感知新分类目录
      broadcast('workspace:changed', null)
      // 未识别的键必须照实报：否则模型拿着只落了 1 个字段的主题去描述整套排版（实测发生过）
      const applied = Object.keys(patch).length
      const dropped: string[] = []
      if (unknown.length) dropped.push(`键名不认识：${unknown.join('、')}`)
      if (invalid.length) dropped.push(`值不合法被丢弃：${invalid.join('、')}`)
      const hint = dropped.length
        ? `主题「${name}」已入库，但只写入 ${applied} 个字段；${dropped.join('；')}——需要的效果请改用工具说明里的键名与取值重发一次，未写入的部分不得向用户声称已生效`
        : `主题「${name}」已入库（共 ${applied} 个字段）；打开该分类下的工程即可套用`
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
      return { html_path: rel, png_path: png }
    }
  },
  {
    name: 'generate_image',
    description: 'AI 文生图并保存到工程 assets/，返回相对路径（正文引用写 ![alt](该路径)）',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        prompt: { type: 'string', description: '画面描述提示词' },
        path: { type: 'string', description: '保存相对路径（缺省 assets/gen-<时间戳>.png）' },
        ratio: { type: 'string', description: '宽高比（Agnes 支持 1:1/4:3/16:9/3:4/2.35:1 等，缺省 4:3）' }
      },
      required: ['project', 'prompt']
    },
    handler: async (a) => {
      const project = projectArg(a)
      const base64 = await generateImage(str(a, 'prompt'), { ratio: str(a, 'ratio', false) || undefined })
      const rel = str(a, 'path', false) || `assets/gen-${Date.now()}.png`
      return { path: store.saveAsset(project, rel, base64) }
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
      return { path: store.saveAsset(project, rel, base64) }
    }
  },
  {
    name: 'set_cover',
    description: '设置工程封面（写入 project.json）：main 为 2.35:1 主封面，square 为 1:1 方图',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        main: { type: 'string', description: '主封面相对路径（assets/ 内）' },
        square: { type: 'string', description: '1:1 方图相对路径（可选，缺省同 main）' }
      },
      required: ['project', 'main']
    },
    handler: (a) => {
      const project = projectArg(a)
      const main = str(a, 'main')
      if (!existsSync(join(store.projectDir(project), main))) throw new Error(`封面图不存在：${main}`)
      const meta = store.readMeta(project)
      store.writeMeta(project, { ...meta, cover: { main, square: str(a, 'square', false) || main } })
      return { ok: true }
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
      '把 article.md 导出为 HTML 文件，返回绝对路径。缺省导出 article.html（公众号排版）；variant 配色模式：auto 读者端自动昼夜（prefers-color-scheme 媒体查询，读者系统深色自动看夜间配色，适合部署自有网页/博客）/ day 固定日间配色（浅卡深字）/ night 固定夜间配色（日间排版按公众号夜间逻辑算法变深，深卡浅字）。公众号推送不支持媒体查询，若要复制到公众号请用 day/night 固定配色。platform 指定分发目标（zhihu/toutiao/baijiahao）时改为导出 article-<platform>.html 平台适配稿（按平台编辑器净化规则简化排版，图片相对路径），适合多平台分发前的稿源',
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
      '把工程推送到公众号草稿箱：正文本地图片自动上传微信 CDN，封面传永久素材，draft/add 入草稿。variant 配色（公众号读者统一看一套，二选一）：day 固定日间配色（浅卡深字，缺省；读者微信夜间会自动变深，推荐）/ night 固定夜间配色（算法变深深卡浅字，公众号夜间可能显示异常）。用哪个公众号按工程所属分类的绑定决定（未绑定走默认账号），账号在应用「设置 → 推送设置」里管理，且本机公网 IP 需已加入公众平台白名单',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        variant: { type: 'string', enum: ['day', 'night'], description: '发布配色（缺省 day）' }
      },
      required: ['project']
    },
    handler: (a) => pushDraft(projectArg(a), str(a, 'variant', false) === 'night' ? 'night' : 'day')
  },
  {
    name: 'push_cards',
    description:
      '把贴图组推送到公众号草稿箱（图片消息形态，读者可左右滑动看图）：每张卡片 PNG 传永久素材，配文用发布配文，标题取封面卡标题。需全部卡片已渲染、最多 20 张；AppID/AppSecret 与 IP 白名单要求同 push_draft',
    inputSchema: { type: 'object', properties: { project: P.project }, required: ['project'] },
    handler: (a) => pushCards(projectArg(a))
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

/** 按名执行工具（MCP tools/call 与 HTTP bridge 共用入口） */
export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`未知工具：${name}`)
  return tool.handler(args ?? {})
}

/** 对话副驾驶可执行工具清单（chat-tools v1）：排除提示词返回类——
 *  那批工具专为无头外部 Agent 设计（返回提示词、调用方自带模型），内部对话有自己的界面流 */
export function listExecTools(): { name: string; description: string; parameters: unknown }[] {
  return TOOLS.filter((t) => !t.name.endsWith('_prompt')).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema
  }))
}
