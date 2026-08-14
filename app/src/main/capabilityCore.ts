import { basename, isAbsolute, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { IdeaCard, TitleCandidate } from '@shared/types'
import { ALL_CATEGORIES } from '@shared/categories'
import {
  brainstormMessages,
  fullArticleMessages,
  outlineMessages,
  reviewMessages,
  titleMessages
} from '@shared/prompts'
import * as store from './projectStore'
import { generateImage } from './imageGen'
import { renderFigure, saveFigureHtml } from './figureRender'
import { exportArticleHtml } from './exporter'
import { pushCards, pushDraft } from './wechatPublish'
import { readSkill } from './skillStore'
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
  if (required) throw new Error(`缺少参数 ${key}`)
  return ''
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
  project: { type: 'string', description: '工程名（workspace 下的目录名）' }
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
    handler: (a) => store.createProject(str(a, 'name'), str(a, 'category', false) || undefined)
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
    handler: (a) => store.setProjectCategory(str(a, 'project'), str(a, 'category'))
  },
  {
    name: 'get_project',
    description: '读取工程详情：project.json 元数据（状态/选题/标题候选/封面）+ article.md 正文全文',
    inputSchema: { type: 'object', properties: { project: P.project }, required: ['project'] },
    handler: (a) => {
      const project = str(a, 'project')
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
      return store.readTextFile(str(a, 'project'), file)
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
      const project = str(a, 'project')
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
      const project = str(a, 'project')
      const patches = a.patches as { old: string; new: string }[]
      if (!Array.isArray(patches) || !patches.length) throw new Error('patches 不能为空')
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
      const ideas = a.ideas as IdeaCard[]
      if (!Array.isArray(ideas) || !ideas.length) throw new Error('ideas 不能为空')
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
      const project = str(a, 'project')
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
      messages: fullArticleMessages(str(a, 'outline'), projectSkill(str(a, 'project'))),
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
      const project = str(a, 'project')
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
      const project = str(a, 'project')
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
      const project = str(a, 'project')
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
      const project = str(a, 'project')
      const titles = a.titles as TitleCandidate[]
      if (!Array.isArray(titles) || !titles.length) throw new Error('titles 不能为空')
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
      '设置工程排版覆盖（写入 project.json，编辑器/导出/推送同源生效，与顶栏控件一致）。字段独立可传：accent 强调色 / bodyFontSize 正文字号 / headingFontSize 标题字号（H1=+6 H2=+0 H3=-3）/ bodyAlign 正文排列（indent 首行缩进 / flush 顶格两端对齐 / center 居中）/ headingAlign 标题排列（center 居中 / left 左）。传 null = 恢复默认（跟随分类主题）',
    inputSchema: {
      type: 'object',
      properties: {
        project: P.project,
        accent: { type: ['string', 'null'], description: '强调色十六进制（#rrggbb）；null 恢复默认' },
        bodyFontSize: { type: ['number', 'null'], description: '正文字号 px（10-40）；null 跟随主题' },
        headingFontSize: { type: ['number', 'null'], description: '标题字号 px（12-40）；null 跟随主题' },
        bodyAlign: { type: ['string', 'null'], enum: ['indent', 'flush', 'center', null], description: '正文排列；null 跟随主题' },
        headingAlign: { type: ['string', 'null'], enum: ['center', 'left', null], description: '标题排列；null 跟随主题' }
      },
      required: ['project']
    },
    handler: (a) => {
      const project = str(a, 'project')
      const meta = store.readMeta(project)
      // 有值覆盖 / null 恢复默认（写 undefined，JSON 序列化自动省略）/ 未传不动
      if (a.accent !== undefined) meta.accent = a.accent === null ? undefined : (a.accent as string)
      if (a.bodyFontSize !== undefined)
        meta.bodyFontSize = a.bodyFontSize === null ? undefined : (a.bodyFontSize as number)
      if (a.headingFontSize !== undefined)
        meta.headingFontSize = a.headingFontSize === null ? undefined : (a.headingFontSize as number)
      if (a.bodyAlign !== undefined)
        meta.bodyAlign = a.bodyAlign === null ? undefined : (a.bodyAlign as 'indent' | 'flush' | 'center')
      if (a.headingAlign !== undefined)
        meta.headingAlign = a.headingAlign === null ? undefined : (a.headingAlign as 'center' | 'left')
      store.writeMeta(project, meta)
      notifyChange(project, 'project.json')
      return { ok: true }
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
      const project = str(a, 'project')
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
      const project = str(a, 'project')
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
      const project = str(a, 'project')
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
      const project = str(a, 'project')
      const main = str(a, 'main')
      if (!existsSync(join(store.projectDir(project), main))) throw new Error(`封面图不存在：${main}`)
      const meta = store.readMeta(project)
      store.writeMeta(project, { ...meta, cover: { main, square: str(a, 'square', false) || main } })
      return { ok: true }
    }
  },
  {
    name: 'export_html',
    description: '把 article.md 导出为全内联样式的 article.html（公众号兼容排版），返回绝对路径',
    inputSchema: { type: 'object', properties: { project: P.project }, required: ['project'] },
    handler: (a) => ({ path: exportArticleHtml(str(a, 'project')) })
  },
  {
    name: 'push_draft',
    description:
      '把工程推送到公众号草稿箱：正文本地图片自动上传微信 CDN，封面传永久素材，draft/add 入草稿。需先配置 AppID/AppSecret（settings/wechat.json）且本机公网 IP 已加入公众平台白名单',
    inputSchema: { type: 'object', properties: { project: P.project }, required: ['project'] },
    handler: (a) => pushDraft(str(a, 'project'))
  },
  {
    name: 'push_cards',
    description:
      '把贴图组推送到公众号草稿箱（图片消息形态，读者可左右滑动看图）：每张卡片 PNG 传永久素材，配文用发布配文，标题取封面卡标题。需全部卡片已渲染、最多 20 张；AppID/AppSecret 与 IP 白名单要求同 push_draft',
    inputSchema: { type: 'object', properties: { project: P.project }, required: ['project'] },
    handler: (a) => pushCards(str(a, 'project'))
  }
]

/** 按名执行工具（MCP tools/call 与 HTTP bridge 共用入口） */
export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`未知工具：${name}`)
  return tool.handler(args ?? {})
}
