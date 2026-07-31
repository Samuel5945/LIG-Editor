import { join, normalize } from 'path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  rmSync
} from 'fs'
import { createHash } from 'crypto'
import type {
  ChatSession,
  ChatSessionMeta,
  IdeaCard,
  IdeaEntry,
  ProjectData,
  ProjectMeta,
  ProjectSummary,
  ProjectTextFile
} from '@shared/types'
import { getAppPaths } from './paths'

/** 工程目录约定（PRD §4）：article.md 为唯一事实源 */
const TEXT_FILES: ProjectTextFile[] = ['article.md', 'ideas.md', 'review.md']
const SUB_DIRS = ['assets', 'figures', 'chat'] as const

// ---------- 自写回声抑制 ----------
// 记录本进程最近一次写入各文件的内容哈希；watcher 收到事件后据此判断
// 是「自己的回声」还是外部（Agent/编辑器之外）的真实修改
const ownWrites = new Map<string, string>()

function hashOf(content: string): string {
  return createHash('sha1').update(content, 'utf-8').digest('hex')
}

export function isOwnWrite(filePath: string): boolean {
  const expected = ownWrites.get(filePath)
  if (!expected) return false
  try {
    return hashOf(readFileSync(filePath, 'utf-8')) === expected
  } catch {
    return false
  }
}

export function writeTracked(filePath: string, content: string): void {
  ownWrites.set(filePath, hashOf(content))
  writeFileSync(filePath, content, 'utf-8')
}

// ---------- 路径与校验 ----------

function assertSafeName(name: string): void {
  if (!name || /[\\/:*?"<>|]/.test(name) || name.includes('..')) {
    throw new Error(`非法工程名：${name}`)
  }
  // Windows 病态路径：结尾点/首尾空格的目录 Node 能写，但 Chromium 会把尾点规范化剥掉，asset:// 取图 404
  if (name !== name.trim() || name.endsWith('.')) {
    throw new Error(`非法工程名（首尾不能是空格，结尾不能是点）：${name}`)
  }
}

/** 工程名清洗：去非法字符、去首尾空白与结尾点（建工程前调用，与渲染层 sanitizeName 保持一致） */
export function sanitizeProjectName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\./g, '')
    .trim()
    .slice(0, 30)
    .replace(/[. ]+$/, '')
}

export function projectDir(name: string): string {
  assertSafeName(name)
  return join(getAppPaths().workspace, name)
}

function metaPath(name: string): string {
  return join(projectDir(name), 'project.json')
}

// ---------- meta 读写 ----------

export function readMeta(name: string): ProjectMeta {
  const raw = JSON.parse(readFileSync(metaPath(name), 'utf-8')) as Partial<ProjectMeta>
  // 容错：外部工具可能写出缺字段的 project.json
  return {
    name: raw.name ?? name,
    status: raw.status ?? 'ideating',
    topic: raw.topic,
    titles: raw.titles ?? [],
    cover: raw.cover,
    format: raw.format ?? 'article',
    style_skill: raw.style_skill,
    created_at: raw.created_at ?? new Date().toISOString(),
    updated_at: raw.updated_at ?? new Date().toISOString()
  }
}

export function writeMeta(name: string, meta: ProjectMeta): void {
  const next: ProjectMeta = { ...meta, name, updated_at: new Date().toISOString() }
  writeTracked(metaPath(name), JSON.stringify(next, null, 2) + '\n')
}

// ---------- 工程 CRUD ----------

export function listProjects(): ProjectSummary[] {
  const { workspace } = getAppPaths()
  if (!existsSync(workspace)) return []
  const out: ProjectSummary[] = []
  for (const entry of readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!existsSync(join(workspace, entry.name, 'project.json'))) continue
    try {
      const meta = readMeta(entry.name)
      out.push({
        name: entry.name,
        dir: join(workspace, entry.name),
        status: meta.status,
        updated_at: meta.updated_at
      })
    } catch {
      // project.json 损坏的目录跳过，不阻塞列表
    }
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function createProject(name: string): ProjectSummary {
  name = sanitizeProjectName(name)
  const dir = projectDir(name)
  if (existsSync(join(dir, 'project.json'))) throw new Error(`工程已存在：${name}`)
  mkdirSync(dir, { recursive: true })
  for (const sub of SUB_DIRS) mkdirSync(join(dir, sub), { recursive: true })

  const now = new Date().toISOString()
  const meta: ProjectMeta = { name, status: 'ideating', titles: [], created_at: now, updated_at: now }
  writeTracked(join(dir, 'project.json'), JSON.stringify(meta, null, 2) + '\n')
  writeTracked(join(dir, 'article.md'), `# ${name}\n\n`)
  writeTracked(join(dir, 'ideas.md'), `# 选题脑暴：${name}\n\n`)
  writeTracked(join(dir, 'review.md'), `# 审阅报告：${name}\n\n（尚未审阅）\n`)
  return { name, dir, status: meta.status, updated_at: now }
}

/** 删除整个工程目录（渲染层已确认；删当前工程前应先停 watcher） */
export function deleteProject(name: string): void {
  const dir = projectDir(name)
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

export function openProject(name: string): ProjectData {
  // 兼容外部工具建的工程：缺子目录/文本文件时补齐
  const dir = projectDir(name)
  for (const sub of SUB_DIRS) mkdirSync(join(dir, sub), { recursive: true })
  for (const f of TEXT_FILES) {
    if (!existsSync(join(dir, f))) writeTracked(join(dir, f), '')
  }
  return { meta: readMeta(name), article: readTextFile(name, 'article.md') }
}

// ---------- 文本文件读写 ----------

export function readTextFile(name: string, file: ProjectTextFile): string {
  const p = join(projectDir(name), file)
  return existsSync(p) ? readFileSync(p, 'utf-8') : ''
}

export function writeTextFile(name: string, file: ProjectTextFile, content: string): void {
  writeTracked(join(projectDir(name), file), content)
  // 正文变更同步 touched updated_at，让列表排序反映最近编辑
  try {
    writeMeta(name, readMeta(name))
  } catch {
    // meta 缺失不阻塞正文保存
  }
}

// ---------- 会话历史（M5：chat/*.json） ----------

function chatDir(name: string): string {
  const dir = join(projectDir(name), 'chat')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function listChatSessions(name: string): ChatSessionMeta[] {
  const out: ChatSessionMeta[] = []
  for (const f of readdirSync(chatDir(name))) {
    if (!f.endsWith('.json')) continue
    try {
      const s = JSON.parse(readFileSync(join(chatDir(name), f), 'utf-8')) as ChatSession
      out.push({ id: s.id, title: s.title, created_at: s.created_at, updated_at: s.updated_at })
    } catch {
      // 损坏会话文件跳过
    }
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function readChatSession(name: string, id: string): ChatSession {
  if (/[\\/:*?"<>|]|\.\./.test(id)) throw new Error(`非法会话 id：${id}`)
  return JSON.parse(readFileSync(join(chatDir(name), `${id}.json`), 'utf-8')) as ChatSession
}

export function writeChatSession(name: string, session: ChatSession): void {
  if (/[\\/:*?"<>|]|\.\./.test(session.id)) throw new Error(`非法会话 id：${session.id}`)
  const next: ChatSession = { ...session, updated_at: new Date().toISOString() }
  writeTracked(join(chatDir(name), `${session.id}.json`), JSON.stringify(next, null, 2) + '\n')
}

export function deleteChatSession(name: string, id: string): void {
  if (/[\\/:*?"<>|]|\.\./.test(id)) throw new Error(`非法会话 id：${id}`)
  rmSync(join(chatDir(name), `${id}.json`), { force: true })
}

// ---------- 二进制资产（M5：封面等） ----------

/** 保存 base64 资产到工程内相对路径；限制写入不得逃逸工程目录 */
export function saveAsset(name: string, relPath: string, base64: string): string {
  const dir = projectDir(name)
  const target = normalize(join(dir, relPath))
  if (!target.toLowerCase().startsWith(normalize(dir).toLowerCase() + '\\')) {
    throw new Error(`非法资产路径：${relPath}`)
  }
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, Buffer.from(base64, 'base64'))
  return relPath.replace(/\\/g, '/')
}

// ---------- 全局选题库（idea-inbox.md 结构化读写） ----------
// 库文件用统一的卡片块格式，块之间以 --- 分隔，便于结构化解析与增删：
//   ## 标题
//   - 角度：...
//   - 读者：...
//   - 评分：8
//   - 理由：...

function ideaToBlock(idea: IdeaCard): string {
  return `## ${idea.title}\n- 角度：${idea.angle}\n- 读者：${idea.audience}\n- 评分：${idea.score}\n- 理由：${idea.reason}\n`
}

function parseIdeaBlock(block: string, index: number): IdeaEntry | null {
  const titleM = /^##\s+(.+)$/m.exec(block)
  if (!titleM) return null
  const field = (label: string): string => {
    const m = new RegExp(`^-\\s*${label}[：:]\\s*(.+)$`, 'm').exec(block)
    return m ? m[1].trim() : ''
  }
  const score = Number(field('评分'))
  return {
    index,
    title: titleM[1].trim(),
    angle: field('角度'),
    audience: field('读者'),
    score: Number.isFinite(score) ? score : 0,
    reason: field('理由')
  }
}

/** 读全局选题库为结构化条目列表（按 ## 分块） */
export function listIdeas(): IdeaEntry[] {
  const file = getAppPaths().ideaInbox
  if (!existsSync(file)) return []
  const raw = readFileSync(file, 'utf-8')
  const blocks = raw.split(/^##\s+/m).slice(1).map((b) => '## ' + b)
  const out: IdeaEntry[] = []
  blocks.forEach((b, i) => {
    const e = parseIdeaBlock(b, i)
    if (e) out.push(e)
  })
  return out
}

/** 追加一张选题卡到全局库（结构化块格式） */
export function addIdea(idea: IdeaCard): void {
  const file = getAppPaths().ideaInbox
  if (!existsSync(file) || !readFileSync(file, 'utf-8').trim()) {
    writeFileSync(file, '# 选题收件箱\n\n', 'utf-8')
  }
  const cur = readFileSync(file, 'utf-8')
  writeFileSync(file, `${cur.trimEnd()}\n\n${ideaToBlock(idea)}`, 'utf-8')
}

/** 按段序号删除一条选题 */
export function removeIdea(index: number): void {
  const file = getAppPaths().ideaInbox
  if (!existsSync(file)) return
  const raw = readFileSync(file, 'utf-8')
  const head = raw.split(/^##\s+/m)[0]
  const blocks = raw.split(/^##\s+/m).slice(1)
  if (index < 0 || index >= blocks.length) return
  blocks.splice(index, 1)
  const body = blocks.map((b) => '## ' + b.trimEnd()).join('\n\n')
  writeFileSync(file, head.trimEnd() + (body ? '\n\n' + body + '\n' : '\n'), 'utf-8')
}

// ---------- 全局选题收件箱（兼容旧接口：纯追加文本） ----------

export function appendIdeaInbox(text: string): void {
  const file = getAppPaths().ideaInbox
  if (!existsSync(file)) writeFileSync(file, '# 选题收件箱\n\n', 'utf-8')
  appendFileSync(file, text.endsWith('\n') ? text : text + '\n', 'utf-8')
}
