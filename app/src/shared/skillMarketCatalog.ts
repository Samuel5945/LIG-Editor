import type { SkillMarketEntry } from './types'

/**
 * 内置市场目录（随包打底，离线可用）：官方预装 6 件套的收录元数据。
 * 刻意用 TS 模块而非 JSON 文件：类型检查盯得住，改收录就改这里；
 * 在线目录（配置源后拉取）与此处同形状，合并规则见 shared/skillMarket.ts。
 * 描述取自各 SKILL.md frontmatter 的首句，收录时人工核对。
 */
export const BUILTIN_MARKET_ENTRIES: SkillMarketEntry[] = [
  {
    name: 'wechat-viral-topic',
    description: '10万+爆款选题制造机：选题灵感、爆款标题、把热点做成文章/短视频/漫画/H5 全形态创作方案，附 12 心法与 8 维打分卡',
    category: '选题',
    recommended: true,
    official: true
  },
  {
    name: 'outline-architect',
    description: '文章大纲架构师：选题确定后、动笔前把选题和素材搭成可执行骨架，输出带功能标注、素材位与建议字数的分节大纲',
    category: '大纲',
    recommended: true,
    official: true
  },
  {
    name: 'khazix-writer',
    description: '数字生命卡兹克的公众号长文写作 skill：撰写/续写/扩写公众号文章、按素材出稿，个人写作风格方法论',
    category: '成文',
    recommended: true,
    official: true
  },
  {
    name: 'figure-card-copy',
    description: '配图与贴图卡片文案师：规划插图位、写贴图卡片文案、写 AI 生图提示词，对应本编辑器三种配图管线',
    category: '配图',
    recommended: true,
    official: true
  },
  {
    name: 'title-cover-polish',
    description: '标题与封面打磨师：生成/修改/评比标题、写封面大字与副标文案、标题 A/B 变体，带公式标注与多平台字数校验',
    category: '标题封面',
    recommended: true,
    official: true
  },
  {
    name: 'publish-precheck',
    description: '发布前审阅把关员：错别字标点、广告法违禁词、事实信源、排版规范、发布配置逐项过检，输出分级报告',
    category: '审阅',
    recommended: true,
    official: true
  }
]
