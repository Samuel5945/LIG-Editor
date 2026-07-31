import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { SkillInstallDirective, SkillResolveResult } from '@shared/types'
import { githubCandidates, nameFromRef, withMirrors, detectScriptDep } from '@shared/skillInstall'
import { getAppPaths } from './paths'
import { locateSkillSource, parseDescription, sanitizeSkillName } from './skillStore'

/**
 * 对话安装 Skill（M9 反馈迭代）：按指令取到 SKILL.md 内容做预览
 * 只取不落盘——确认卡片点「安装」后走 skillStore.saveSkill
 */

/** 下载单个 URL：10s 超时；返回 HTML 视为错误页（raw 直链只会是纯文本） */
async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (/^\s*<!doctype html|^\s*<html/i.test(text)) throw new Error('返回的是网页而非 markdown')
    if (!text.trim()) throw new Error('内容为空')
    return text
  } finally {
    clearTimeout(timer)
  }
}

/** 全部候选 URL（含镜像变体）并发竞速，首个成功者胜出；串行逐个等超时在候选变多后不可接受 */
async function fetchFirst(urls: string[]): Promise<{ content: string; origin: string }> {
  const all = urls.flatMap(withMirrors)
  try {
    return await Promise.any(
      all.map(async (url) => ({ content: await fetchText(url), origin: url }))
    )
  } catch (err) {
    const first = err instanceof AggregateError ? err.errors[0] : err
    throw new Error(
      `${all.length} 个候选地址全部下载失败（如 ${all[0]} → ${
        first instanceof Error ? first.message : first
      }），可尝试直接提供 SKILL.md 直链`
    )
  }
}

export async function resolveSkillInstall(d: SkillInstallDirective): Promise<SkillResolveResult> {
  let content: string
  let origin: string
  let name: string

  if (d.source === 'inline') {
    if (!d.name?.trim()) throw new Error('粘贴内容安装需要指定 Skill 名')
    if (!d.content?.trim()) throw new Error('没有取到粘贴的 SKILL.md 内容')
    content = d.content.trim()
    origin = '对话粘贴'
    name = d.name
  } else if (d.source === 'path') {
    if (!d.ref?.trim()) throw new Error('缺少本地路径')
    const located = locateSkillSource(d.ref.trim())
    content = readFileSync(located.mdFile, 'utf-8')
    origin = located.mdFile
    name = d.name?.trim() || located.name
  } else if (d.source === 'url') {
    if (!d.ref?.trim()) throw new Error('缺少下载链接')
    const got = await fetchFirst([d.ref.trim()])
    content = got.content
    origin = got.origin
    name = d.name?.trim() || nameFromRef(d.ref)
  } else {
    if (!d.ref?.trim()) throw new Error('缺少 GitHub 仓库引用')
    const candidates = githubCandidates(d.ref)
    if (candidates.length === 0)
      throw new Error(`无法识别 GitHub 引用「${d.ref}」，请提供 owner/repo 或 SKILL.md 直链`)
    const got = await fetchFirst(candidates)
    content = got.content
    origin = got.origin
    name = d.name?.trim() || nameFromRef(d.ref)
  }

  const clean = sanitizeSkillName(name, d.ref ?? name)
  return {
    name: clean,
    description: parseDescription(content),
    content,
    origin,
    exists: existsSync(join(getAppPaths().skills, clean, 'SKILL.md')),
    scriptDep: detectScriptDep(content)
  }
}
