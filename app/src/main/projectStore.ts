import { join, normalize, basename } from 'path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  rmSync
} from 'fs'
import { createHash } from 'crypto'
import type {
  ChatSession,
  ChatSessionMeta,
  IdeaCard,
  IdeaEntry,
  OpenMdResult,
  ProjectData,
  ProjectMeta,
  ProjectSummary,
  ProjectTextFile
} from '@shared/types'
import { UNCATEGORIZED, PROJECT_CATEGORIES, isKnownCategory } from '@shared/categories'
import { getAppPaths } from './paths'
import { listCustomThemes, saveCustomThemes } from './themeStore'
import { listCategoryPresets, renameCategoryPreset } from './categoryPresetStore'

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

// 目录布局：workspace/<分类>/<工程名>/（分类子文件夹）；兼容历史平铺 workspace/<工程名>/。
// 工程名全局唯一，按名字解析实际目录；缓存随增删/迁移失效。
const dirCache = new Map<string, string>()

/** 全量扫描 workspace（根目录遗留工程 + 分类子目录一层），返回 工程名 → 目录 */
function scanProjectDirs(): Map<string, string> {
  const { workspace } = getAppPaths()
  const found = new Map<string, string>()
  if (!existsSync(workspace)) return found
  for (const entry of readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const top = join(workspace, entry.name)
    if (existsSync(join(top, 'project.json'))) {
      found.set(entry.name, top)
      continue
    }
    // 分类目录：再向下扫一层
    for (const sub of readdirSync(top, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const dir = join(top, sub.name)
      if (existsSync(join(dir, 'project.json'))) found.set(sub.name, dir)
    }
  }
  return found
}

function refreshDirCache(): Map<string, string> {
  const all = scanProjectDirs()
  dirCache.clear()
  for (const [k, v] of all) dirCache.set(k, v)
  return all
}

/** 按工程名解析实际目录；不存在返回 null */
function resolveDir(name: string): string | null {
  assertSafeName(name)
  const cached = dirCache.get(name)
  if (cached && existsSync(join(cached, 'project.json'))) return cached
  return refreshDirCache().get(name) ?? null
}

export function projectDir(name: string): string {
  const dir = resolveDir(name)
  if (dir) return dir
  assertSafeName(name)
  // 兜底：尚未落盘的场景（如创建前拼路径），按平铺惯例给 workspace/<名>
  return join(getAppPaths().workspace, name)
}

// ---------- 分类（预设 + 自定义：workspace 顶层目录即分类文件夹） ----------

/** 被隐藏（删除）的分类：settings/disabledCategories.json，预设与自定义分类共用同一机制 */
function disabledFile(): string {
  return join(getAppPaths().settings, 'disabledCategories.json')
}

/** 被隐藏的分类列表（「删除」= 隐藏：目录与工程保留，恢复后原样归位） */
export function listDisabledCategories(): string[] {
  try {
    const raw = JSON.parse(readFileSync(disabledFile(), 'utf-8'))
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeDisabledCategories(list: string[]): void {
  writeFileSync(disabledFile(), JSON.stringify(list, null, 2) + '\n', 'utf-8')
}

/** 分类名校验：预设分类直接可用；自定义需为安全目录名且不与现有工程名冲突 */
function assertCategoryName(category: string): void {
  if (
    !category ||
    /[\\/:*?"<>|]/.test(category) ||
    category.includes('..') ||
    category !== category.trim() ||
    category.endsWith('.')
  ) {
    throw new Error(`非法分类名：${category}`)
  }
  if (category === UNCATEGORIZED || (PROJECT_CATEGORIES as readonly string[]).includes(category)) return
  if (resolveDir(category)) throw new Error(`不能以工程名作为分类名：${category}`)
}

/** 全部可用分类：预设 + 未分类 + workspace 顶层自定义分类文件夹（按文件夹发现），隐藏分类不显示 */
export function listCategories(): string[] {
  const { workspace } = getAppPaths()
  const disabled = new Set(listDisabledCategories())
  const cats = new Set<string>()
  for (const c of [...PROJECT_CATEGORIES, UNCATEGORIZED]) {
    if (!disabled.has(c)) cats.add(c)
  }
  if (existsSync(workspace)) {
    for (const entry of readdirSync(workspace, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      // 顶层目录：含 project.json 的是工程目录，其余都是分类文件夹
      if (!existsSync(join(workspace, entry.name, 'project.json')) && !disabled.has(entry.name)) {
        cats.add(entry.name)
      }
    }
  }
  return [...cats]
}

/** 删除分类（= 隐藏）：分类从列表消失，目录与工程原样保留，恢复后归位。未分类兜底不可删。 */
export function deleteCategory(name: string): void {
  assertCategoryName(name)
  if (name === UNCATEGORIZED) throw new Error('「未分类」是兜底分类，不能删除')
  const disabled = listDisabledCategories()
  if (!disabled.includes(name)) writeDisabledCategories([...disabled, name])
}

/** 恢复被删除（隐藏）的分类 */
export function restoreCategory(name: string): void {
  writeDisabledCategories(listDisabledCategories().filter((x) => x !== name))
}

/** 重命名分类：分类目录改名 + 目录内工程 meta.category 同步 + 隐藏列表/自定义主题同步。
 * 预设分类重命名后即成为自定义分类（新名不再被预设覆盖）。 */
export function renameCategory(oldName: string, newName: string): void {
  if (oldName === newName) return
  assertCategoryName(oldName)
  assertCategoryName(newName)
  if (newName === UNCATEGORIZED) throw new Error('「未分类」是兜底分类，不能作为新分类名')
  if ((PROJECT_CATEGORIES as readonly string[]).includes(newName)) {
    throw new Error(`分类名冲突：「${newName}」是预设分类`)
  }
  if (resolveDir(newName)) throw new Error(`不能以工程名作为分类名：${newName}`)
  // 自定义主题同名冲突（重名会把新分类名的主题覆盖掉）
  const themes = listCustomThemes()
  if (themes[newName]) throw new Error(`分类名冲突：已有自定义主题「${newName}」`)

  const { workspace } = getAppPaths()
  const oldDir = join(workspace, oldName)
  const newDir = join(workspace, newName)
  if (existsSync(oldDir)) {
    if (existsSync(newDir)) throw new Error(`分类「${newName}」已存在`)
    renameSync(oldDir, newDir)
    dirCache.clear()
  }
  // 目录内工程 meta.category 同步（按实际所在目录判定，兼容 meta 缺失的工程）
  for (const [name, dir] of refreshDirCache()) {
    const folder = dir.slice(normalize(workspace).length).split(/[\\/]/).filter(Boolean)
    if (folder[0] !== oldName) continue
    const meta = readMeta(name)
    if (meta.category === oldName) writeMeta(name, { ...meta, category: newName })
  }
  // 隐藏列表同步
  const disabled = listDisabledCategories()
  if (disabled.includes(oldName)) {
    writeDisabledCategories(disabled.map((x) => (x === oldName ? newName : x)))
  }
  // 自定义主题同步
  if (themes[oldName]) {
    themes[newName] = themes[oldName]
    delete themes[oldName]
    saveCustomThemes(themes)
  }
  // 账号预设同步（多账号骨架：预设 key 随分类重命名迁移）
  renameCategoryPreset(oldName, newName)
}

function metaPath(name: string): string {
  return join(projectDir(name), 'project.json')
}

// ---------- meta 读写 ----------

export function readMeta(name: string): ProjectMeta {
  const raw = JSON.parse(readFileSync(metaPath(name), 'utf-8')) as Partial<ProjectMeta>
  // 容错：外部工具可能写出缺字段的 project.json。
  // 字段必须全量透传：排版覆盖四项（正文字号/标题字号/两排列）曾被白名单漏掉——
  // 改标题字号时 readMeta→writeMeta 往返会把盘上的正文字号覆盖值清空，
  // 界面上表现为「正文字号和标题字号互相牵连/被重置」，导出也读不到覆盖值
  return {
    name: raw.name ?? name,
    status: raw.status ?? 'ideating',
    topic: raw.topic,
    titles: raw.titles ?? [],
    cover: raw.cover,
    format: raw.format ?? 'article',
    category: raw.category ?? UNCATEGORIZED,
    accent: raw.accent,
    bodyFontSize: raw.bodyFontSize,
    headingFontSize: raw.headingFontSize,
    bodyAlign: raw.bodyAlign,
    headingAlign: raw.headingAlign,
    h1Style: raw.h1Style,
    h2Style: raw.h2Style,
    h2Num: raw.h2Num,
    h3Mark: raw.h3Mark,
    bodyBg: raw.bodyBg,
    plannedAt: raw.plannedAt,
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
  const all = refreshDirCache()
  const out: ProjectSummary[] = []
  for (const [name, dir] of all) {
    try {
      const meta = readMeta(name)
      out.push({
        name,
        dir,
        status: meta.status,
        category: meta.category ?? UNCATEGORIZED,
        updated_at: meta.updated_at,
        plannedAt: meta.plannedAt
      })
    } catch {
      // project.json 损坏的目录跳过，不阻塞列表
    }
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function createProject(name: string, category?: string): ProjectSummary {
  name = sanitizeProjectName(name)
  assertSafeName(name)
  if (resolveDir(name)) throw new Error(`工程已存在：${name}`)
  let cat = UNCATEGORIZED
  if (category?.trim()) {
    assertCategoryName(category.trim())
    cat = category.trim()
  }
  const dir = join(getAppPaths().workspace, cat, name)
  mkdirSync(dir, { recursive: true })
  for (const sub of SUB_DIRS) mkdirSync(join(dir, sub), { recursive: true })

  const now = new Date().toISOString()
  const meta: ProjectMeta = { name, status: 'ideating', titles: [], category: cat, created_at: now, updated_at: now }
  // 账号预设注入（账号 = 分类）：分类配了默认写作 Skill 的新工程自动挂载——
  // 手动新建 / 日历选题立项 / Agent create_project 三条路都走这里，单点生效。
  // 默认分发平台不入 project.json：与排版调性同理，按 meta.category 现算即可全账号即时生效
  const preset = listCategoryPresets()[cat]
  if (preset?.style_skill) meta.style_skill = preset.style_skill
  writeTracked(join(dir, 'project.json'), JSON.stringify(meta, null, 2) + '\n')
  writeTracked(join(dir, 'article.md'), `# ${name}\n\n`)
  writeTracked(join(dir, 'ideas.md'), `# 选题脑暴：${name}\n\n`)
  writeTracked(join(dir, 'review.md'), `# 审阅报告：${name}\n\n（尚未审阅）\n`)
  dirCache.set(name, dir)
  return { name, dir, status: meta.status, category: cat, updated_at: now }
}

/** 删除整个工程目录（渲染层已确认；删当前工程前应先停 watcher） */
export function deleteProject(name: string): void {
  const dir = resolveDir(name)
  dirCache.delete(name)
  if (!dir || !existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

/** 切换分类：工程目录迁移到 workspace/<分类>/<工程名>/，并更新 meta.category。
 * 预设与自定义分类均可；目标已有同名工程则拒绝；目录已在正确分类下只更新 meta。 */
export function setProjectCategory(name: string, category: string): ProjectMeta {
  assertCategoryName(category)
  const dir = resolveDir(name)
  if (!dir) throw new Error(`工程不存在：${name}`)
  const { workspace } = getAppPaths()
  const target = join(workspace, category, name)
  if (normalize(dir).toLowerCase() !== normalize(target).toLowerCase()) {
    if (existsSync(target)) throw new Error(`分类「${category}」下已有同名工程：${name}`)
    mkdirSync(join(workspace, category), { recursive: true })
    renameSync(dir, target)
    // 旧分类目录空了就顺手清掉；但绑定自定义主题的分类是用户主动保存的排版资产，
    // 保留空目录防止「导入排版的分类随项目移出而消失」（主题仍在 customThemes.json）
    try {
      const parent = normalize(join(dir, '..'))
      if (parent.toLowerCase() !== normalize(workspace).toLowerCase() && readdirSync(parent).length === 0) {
        const catName = normalize(parent).split(/[\\/]/).pop() ?? ''
        if (!listCustomThemes()[catName]) {
          rmSync(parent, { recursive: true, force: true })
        }
      }
    } catch {
      // 清理失败不影响迁移结果
    }
    dirCache.set(name, target)
  }
  const next: ProjectMeta = { ...readMeta(name), category }
  writeMeta(name, next)
  return next
}

/** 设置发布排期（内容日历看板）：date 为 YYYY-MM-DD 本地日期，null 取消排期。
 * 只写 meta 不动目录；writeMeta 自动盖 updated_at（列表/看板随之刷新）。 */
export function setSchedule(name: string, date: string | null): ProjectMeta {
  const dir = resolveDir(name)
  if (!dir) throw new Error(`工程不存在：${name}`)
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`非法排期日期（应为 YYYY-MM-DD）：${date}`)
  }
  const next: ProjectMeta = { ...readMeta(name), plannedAt: date ?? undefined }
  writeMeta(name, next)
  return next
}

/** 选题拖拽立项（内容日历）：选题 → 工程（带 topic 画像）+ 排期，一步到位。
 *  选题保留在库中不消费——同一选题可给多个账号（分类）重复排期，删除走左栏选题库。 */
export function scheduleIdea(index: number, date: string, category?: string): ProjectSummary {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`非法排期日期（应为 YYYY-MM-DD）：${date}`)
  }
  const idea = listIdeas().find((it) => it.index === index)
  if (!idea) throw new Error(`选题不存在（index=${index}），可能已被删除，请刷新选题库`)
  // 工程名全局唯一：同一选题多账号复用（不同分类重复排期）时追加排期月日后缀
  const base = sanitizeProjectName(idea.title)
  let name = base
  if (resolveDir(name)) name = sanitizeProjectName(`${base} ${date.slice(5).replace('-', '')}`)
  if (resolveDir(name)) throw new Error(`同名工程已存在：${name}（请改名后再排期）`)
  const created = createProject(name, category || undefined)
  const meta = readMeta(created.name)
  writeMeta(created.name, {
    ...meta,
    status: 'ideating',
    topic: { angle: idea.angle, audience: idea.audience, source_material: [] },
    plannedAt: date
  })
  return { ...created, plannedAt: date }
}

/** 重命名工程：目录留在原分类下改名 + meta.name 同步。工程名全局唯一；
 * 仅大小写变化的改名放行（Windows 同目录不同大小写视为同一目录，不算冲突）。 */
export function renameProject(oldName: string, newName: string): ProjectMeta {
  newName = sanitizeProjectName(newName)
  assertSafeName(newName)
  const dir = resolveDir(oldName)
  if (!dir) throw new Error(`工程不存在：${oldName}`)
  if (oldName === newName) return readMeta(oldName)
  const target = join(dir, '..', newName)
  const caseOnly = normalize(target).toLowerCase() === normalize(dir).toLowerCase()
  if (!caseOnly && (existsSync(target) || resolveDir(newName))) {
    throw new Error(`工程已存在：${newName}`)
  }
  renameSync(dir, target)
  dirCache.delete(oldName)
  dirCache.set(newName, target)
  const next: ProjectMeta = { ...readMeta(newName), name: newName }
  writeMeta(newName, next)
  return next
}

/** 启动时一次性布局迁移：
 * - 历史平铺在 workspace 根的工程挪进「未分类」目录
 * - 已在分类目录里但 meta 没写 category 的工程按所在目录补齐 */
export function migrateWorkspaceLayout(): void {
  const { workspace } = getAppPaths()
  if (!existsSync(workspace)) return
  // 1) 根目录遗留工程 → 未分类/
  for (const entry of readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (isKnownCategory(entry.name)) continue // 分类目录本身不动
    const top = join(workspace, entry.name)
    if (!existsSync(join(top, 'project.json'))) continue
    const target = join(workspace, UNCATEGORIZED, entry.name)
    if (existsSync(target)) continue // 同名冲突保持现状，人工处理
    mkdirSync(join(workspace, UNCATEGORIZED), { recursive: true })
    renameSync(top, target)
  }
  dirCache.clear()
  // 2) 分类目录里的工程补齐 meta.category
  for (const [name, dir] of refreshDirCache()) {
    const folder = dir.slice(normalize(workspace).length).split(/[\\/]/).filter(Boolean)
    if (folder.length < 2) continue
    const cat = folder[0]
    if (!isKnownCategory(cat)) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf-8')) as Partial<ProjectMeta>
      if (raw.category !== cat) writeMeta(name, { ...readMeta(name), category: cat })
    } catch {
      // 损坏的 meta 跳过
    }
  }
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

// ---------- 拖拽/关联打开 .md（文件→工程） ----------

/** 工程内直接可编辑的 md 文件名（拖拽到图标时这些文件会定位到所属工程） */
const PROJECT_MD_FILES = ['article.md', 'ideas.md', 'review.md', 'cards-review.md']

/** 把拖拽/关联打开的 .md 定位到工程：workspace 内命中已有工程则直接打开，
 * 外部 md 导入为新工程（article.md 内容拷贝进 workspace/未分类/<同名>/）。
 * Windows 下拖到图标 / 双击关联文件时，路径经命令行参数进入主进程。 */
export function openMdFile(absPath: string): OpenMdResult {
  const mdPath = normalize(absPath)
  if (!/\.md$/i.test(mdPath)) throw new Error('只支持打开 Markdown（.md）文件')
  if (!existsSync(mdPath)) throw new Error(`文件不存在：${absPath}`)

  // 1) 按真实扫描结果定位工程（兼容分类/平铺两种布局，名字取目录原始大小写）
  const fileName = basename(mdPath)
  if (PROJECT_MD_FILES.includes(fileName)) {
    for (const [name, dir] of refreshDirCache()) {
      if (normalize(join(dir, fileName)).toLowerCase() === mdPath.toLowerCase()) {
        return { kind: 'open', name }
      }
    }
  }

  // 2) 未命中现有工程：导入成新工程（同名冲突自动追加序号 `-2`、`-3`…）
  const base = basename(mdPath, '.md').slice(0, 30).replace(/[. ]+$/, '') || '未命名'
  let name = sanitizeProjectName(base) || '未命名'
  if (resolveDir(name)) {
    let i = 2
    while (resolveDir(`${name}-${i}`)) i++
    name = `${name}-${i}`
  }
  const summary = createProject(name, UNCATEGORIZED)
  writeTracked(join(summary.dir, 'article.md'), readFileSync(mdPath, 'utf-8'))
  return { kind: 'import', name }
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
