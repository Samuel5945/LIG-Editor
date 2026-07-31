import { basename, join } from 'path'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { app } from 'electron'
import type { SkillInfo } from '@shared/types'
import { getAppPaths } from './paths'

/**
 * Skill 系统（M5 最小版 → M8 管理版）：skills/<name>/SKILL.md
 * 挂载 = 把 SKILL.md 全文注入对话系统提示
 * 停用 = 目录内放 .disabled 标记文件（不删内容，可随时恢复）
 */

/** 从 SKILL.md 头部提取描述：优先 YAML frontmatter 的 description，退化取首个非标题段落 */
export function parseDescription(md: string): string {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (fm) {
    const desc = fm[1].match(/^description:\s*(.+)$/m)
    if (desc) return desc[1].trim().slice(0, 120)
  }
  for (const line of md.split('\n')) {
    const t = line.trim()
    if (t && !t.startsWith('#') && !t.startsWith('---')) return t.slice(0, 120)
  }
  return ''
}

/**
 * 首启种子复制：把随包预装的 Skill（extraResources → resources/skills）铺到 <root>/skills
 * 已存在同名目录时不覆盖（用户可能改过内容或停用过）
 */
export function seedBundledSkills(): void {
  const source = app.isPackaged
    ? join(process.resourcesPath, 'skills')
    : join(app.getAppPath(), 'resources', 'skills')
  if (!existsSync(source)) return
  const { skills } = getAppPaths()
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const md = join(source, entry.name, 'SKILL.md')
    const target = join(skills, entry.name)
    if (!existsSync(md) || existsSync(target)) continue
    mkdirSync(target, { recursive: true })
    copyFileSync(md, join(target, 'SKILL.md'))
  }
}

export function listSkills(): SkillInfo[] {
  const { skills } = getAppPaths()
  if (!existsSync(skills)) return []
  const out: SkillInfo[] = []
  for (const entry of readdirSync(skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const mdPath = join(skills, entry.name, 'SKILL.md')
    if (!existsSync(mdPath)) continue
    try {
      out.push({
        name: entry.name,
        description: parseDescription(readFileSync(mdPath, 'utf-8')),
        dir: join(skills, entry.name),
        enabled: !existsSync(join(skills, entry.name, '.disabled'))
      })
    } catch {
      // 读取失败的 skill 跳过
    }
  }
  return out
}

export function readSkill(name: string): string {
  if (/[\\/:*?"<>|]|\.\./.test(name)) throw new Error(`非法 Skill 名：${name}`)
  return readFileSync(join(getAppPaths().skills, name, 'SKILL.md'), 'utf-8')
}

/** 启用/停用：用 .disabled 标记文件开关，停用的 Skill 不出现在挂载列表 */
export function setSkillEnabled(name: string, enabled: boolean): void {
  if (/[\\/:*?"<>|]|\.\./.test(name)) throw new Error(`非法 Skill 名：${name}`)
  const flag = join(getAppPaths().skills, name, '.disabled')
  if (enabled) {
    if (existsSync(flag)) unlinkSync(flag)
  } else {
    writeFileSync(flag, '', 'utf-8')
  }
}

/** 删除 Skill：整目录移除，不可恢复（渲染层弹确认后才调） */
export function removeSkill(name: string): void {
  if (/[\\/:*?"<>|]|\.\./.test(name)) throw new Error(`非法 Skill 名：${name}`)
  const dir = join(getAppPaths().skills, name)
  if (!existsSync(dir)) throw new Error(`Skill 不存在：${name}`)
  rmSync(dir, { recursive: true, force: true })
}

/**
 * 导入 Skill：接受「含 SKILL.md 的文件夹」或「单个 .md 文件」的绝对路径
 * 复制进 skills/<名称>/SKILL.md（同名覆盖），返回 Skill 名
 */
export function importSkill(sourcePath: string): string {
  const { mdFile, name } = locateSkillSource(sourcePath)
  const dir = join(getAppPaths().skills, name)
  mkdirSync(dir, { recursive: true })
  copyFileSync(mdFile, join(dir, 'SKILL.md'))
  return name
}

/** 本地路径 → SKILL.md 文件位置 + 清洗后的 Skill 名（importSkill 与对话安装共用） */
export function locateSkillSource(sourcePath: string): { mdFile: string; name: string } {
  if (!existsSync(sourcePath)) throw new Error(`路径不存在：${sourcePath}`)
  let mdFile: string
  let name: string
  if (existsSync(join(sourcePath, 'SKILL.md'))) {
    mdFile = join(sourcePath, 'SKILL.md')
    name = basename(sourcePath)
  } else if (/\.md$/i.test(sourcePath)) {
    mdFile = sourcePath
    name = basename(sourcePath, '.md').replace(/^SKILL$/i, basename(join(sourcePath, '..')))
  } else {
    throw new Error('请选择含 SKILL.md 的文件夹，或单个 markdown 文件')
  }
  return { mdFile, name: sanitizeSkillName(name, sourcePath) }
}

/** Skill 名清洗：非法字符换短横线，空名报错 */
export function sanitizeSkillName(name: string, origin: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, '-').trim()
  if (!clean || clean === '.' || clean === '..') throw new Error(`无法推导 Skill 名：${origin}`)
  return clean
}

/** 对话安装确认后落盘：写 skills/<name>/SKILL.md（同名覆盖），返回最终名 */
export function saveSkill(name: string, content: string): string {
  const clean = sanitizeSkillName(name, name)
  const dir = join(getAppPaths().skills, clean)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
  return clean
}
