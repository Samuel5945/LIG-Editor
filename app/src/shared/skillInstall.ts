import type { SkillInstallDirective } from './types'

/**
 * 对话安装 Skill 的指令协议（M9 反馈迭代）
 * 模型在自由对话回复末尾输出 ```skill-install 围栏 + 单行 JSON，
 * 渲染层解析出指令并把围栏从可见文本中剥离。
 * 本文件只放纯函数（渲染层与主进程共用，vitest 可测）。
 */

const DIRECTIVE_RE = /```skill-install\s*\n([\s\S]*?)```/

export interface ParsedSkillDirective {
  /** 剥离指令块后的可见文本 */
  cleaned: string
  /** 解析成功的指令；无指令块或 JSON 损坏时为 null（静默容错） */
  directive: SkillInstallDirective | null
}

export function parseSkillDirective(text: string): ParsedSkillDirective {
  const m = text.match(DIRECTIVE_RE)
  if (!m) return { cleaned: text, directive: null }
  const cleaned = text.replace(DIRECTIVE_RE, '').trimEnd()
  try {
    const raw = JSON.parse(m[1].trim()) as Record<string, unknown>
    const source = raw.source
    if (source !== 'github' && source !== 'url' && source !== 'path' && source !== 'inline') {
      return { cleaned, directive: null }
    }
    return {
      cleaned,
      directive: {
        source,
        ref: typeof raw.ref === 'string' ? raw.ref.trim() : undefined,
        name: typeof raw.name === 'string' ? raw.name.trim() : undefined
      }
    }
  } catch {
    return { cleaned, directive: null }
  }
}

/**
 * inline 来源取内容：不让模型复述（防篡改防丢字），
 * 直接取用户消息里最大的围栏代码块；没有围栏就取全文。
 */
export function extractInlineContent(userText: string): string {
  const blocks = [...userText.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1])
  if (blocks.length === 0) return userText.trim()
  return blocks.reduce((a, b) => (b.length > a.length ? b : a)).trim()
}

/** github.com 域名直连墙内不稳：每个候选 URL 追加加速镜像变体。
 *  raw 直链（分支为具体分支名时）额外追加 jsdelivr CDN 变体——墙内可达且不经 GitHub 限额 */
const GH_MIRRORS = ['https://ghproxy.net/', 'https://gh-proxy.com/']

export function withMirrors(url: string): string[] {
  if (!/^https:\/\/(raw\.)?github(usercontent)?\.com\//.test(url)) return [url]
  const extra: string[] = []
  const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/)
  // jsdelivr 不认 HEAD 之类的游标，只认具体分支/标签，命中不了就少一个变体（竞速容错）
  if (raw && raw[3] !== 'HEAD') extra.push(`https://cdn.jsdelivr.net/gh/${raw[1]}/${raw[2]}@${raw[3]}/${raw[4]}`)
  return [url, ...GH_MIRRORS.map((m) => m + url), ...extra]
}

/**
 * GitHub 引用 → 按优先级尝试的 SKILL.md 原始下载 URL 列表（不含镜像变体）
 * 支持：owner/repo、github.com 仓库链接、blob/raw 文件链接、raw.githubusercontent.com 直链
 * SKILL.md 不一定在仓库根：skill 仓库常见 skills/<名>/SKILL.md 布局（名多为去 -skill 后缀的仓库名）
 * 识别失败返回空数组（调用方报错提示用户给直链）
 */
export function githubCandidates(ref: string): string[] {
  const r = ref.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  if (/^https:\/\/raw\.githubusercontent\.com\//.test(r)) return [r]
  const blob = r.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/)
  if (blob) return [`https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`]
  const repo =
    r.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/) ?? r.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (!repo) return []
  const base = `https://raw.githubusercontent.com/${repo[1]}/${repo[2]}`
  const short = repo[2].replace(/-skill$/, '')
  const paths = ['SKILL.md', `skills/${repo[2]}/SKILL.md`]
  if (short !== repo[2]) paths.push(`skills/${short}/SKILL.md`)
  return ['HEAD', 'main', 'master'].flatMap((branch) => paths.map((p) => `${base}/${branch}/${p}`))
}

/** 从下载 URL / 仓库引用推导 Skill 名：文件名优先，SKILL.md 则取上级目录名 */
export function nameFromRef(ref: string): string {
  const clean = ref.trim().split(/[?#]/)[0].replace(/\/+$/, '').replace(/\.git$/, '')
  const parts = clean.split('/').filter(Boolean)
  let last = parts[parts.length - 1] ?? ''
  if (/^skill\.md$/i.test(last) && parts.length >= 2) last = parts[parts.length - 2]
  return last.replace(/\.md$/i, '')
}

/**
 * 仓库级 GitHub 引用 → owner/repo（供仓库内 SKILL.md 目录探测）。
 * 只认 owner/repo 短引用与仓库主页链接；blob/raw/raw 直链等文件级引用返回 null（无需探测）
 */
export function githubRepoInfo(ref: string): { owner: string; repo: string } | null {
  const r = ref.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  const repo = r.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/) ?? r.match(/^([\w.-]+)\/([\w.-]+)$/)
  return repo ? { owner: repo[1], repo: repo[2] } : null
}

/** 仓库全部文件路径 → SKILL.md 候选路径：过滤依赖/点目录/构建产物，浅层在前、同级按名排 */
export function pickSkillMdPaths(paths: string[]): string[] {
  return paths
    .filter((p) => /(^|\/)SKILL\.md$/i.test(p))
    .filter((p) => !/(^|\/)(node_modules|\.git|\.github|dist|build|venv|__pycache__)\//.test(p))
    .filter((p) => !/(^|\/)\./.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
}

/** SKILL.md 仓库路径 → 候选展示名：取 SKILL.md 所在目录名；仓库根 SKILL.md 用仓库名 */
export function skillNameFromPath(path: string, repo: string): string {
  const segs = path.split('/')
  const i = segs.findIndex((s) => /^SKILL\.md$/i.test(s))
  return i > 0 ? segs[i - 1] : repo
}

/**
 * 检测脚本型 Skill：SKILL.md 内容引用捆绑脚本或要求执行命令时返回命中描述，纯提示词型返回 null
 * 本应用的 Skill 机制只注入系统提示，无命令执行通道，此类 Skill 装了也无法工作，安装前阻断
 */
export function detectScriptDep(content: string): string | null {
  const patterns: [RegExp, string][] = [
    [/(?:^|[\s`"'(=])((?:\.\/)?scripts\/[\w./-]+)/m, '引用捆绑脚本'],
    [/\b(python3?(?:\.\d+)?\s+\S+\.py)/, '需要执行 Python 脚本'],
    [/\b((?:bash|sh|pwsh|powershell)\s+\S+\.(?:sh|ps1))/, '需要执行 shell 脚本'],
    [/\b(uv(?:x)?\s+run\s+\S+)/, '需要 uv 运行脚本']
  ]
  for (const [re, label] of patterns) {
    const m = content.match(re)
    if (m) return `${label}：${m[1].trim()}`
  }
  return null
}
