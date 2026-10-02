import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { SkillInstallDirective, SkillResolveResult } from '@shared/types'
import {
  githubCandidates,
  githubRepoInfo,
  nameFromRef,
  pickSkillMdPaths,
  skillNameFromPath,
  withMirrors,
  detectScriptDep
} from '@shared/skillInstall'
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

/** 探测通道的响应形状：GitHub 仓库元信息 / GitHub 树 / jsdelivr flat 清单（三者字段都可选，一次转换全局通用） */
type ProbeJson = { default_branch?: string } & { tree?: { path?: string }[] } & { files?: { name?: string }[] }

/** 取 JSON（复用 fetchText 的超时/HTML 拒绝；GitHub API 出错时返回 JSON 错误体 + 非 200 状态） */
async function fetchJson(url: string): Promise<ProbeJson> {
  return JSON.parse(await fetchText(url)) as ProbeJson
}

/**
 * 仓库内 SKILL.md 目录探测（合集仓库自动列候选）：
 * GitHub Trees API 一次拿全树；墙内常见 403 限额/超时则退 jsdelivr 文件清单（不受 GitHub 限额）。
 * 只在既有候选竞速全部失败后调用，逐分支重试成本低。
 * 返回命中的具体分支名——blob 链接带上它，下载该候选时 jsdelivr 镜像变体才能参与竞速
 */
async function listRepoSkillFiles(owner: string, repo: string): Promise<{ branch: string; paths: string[] }> {
  const errors: string[] = []
  // 默认分支名：HEAD 游标 raw 认、jsdelivr 不认，拿到实名后竞速变体更全
  let head = 'HEAD'
  try {
    const meta = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`)
    if (meta.default_branch) head = meta.default_branch
  } catch {
    // 限额/被墙：保持 HEAD 游标，后面还有 jsdelivr 兜底
  }
  for (const branch of [...new Set([head, 'main', 'master'])]) {
    try {
      const res = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`)
      const picked = pickSkillMdPaths((res.tree ?? []).map((e) => e.path ?? ''))
      if (picked.length > 0) return { branch, paths: picked }
      errors.push(`api(${branch}) 无 SKILL.md`)
    } catch (err) {
      errors.push(`api(${branch}) ${err instanceof Error ? err.message : err}`)
    }
    try {
      const res = await fetchJson(`https://data.jsdelivr.com/v1/package/gh/${owner}/${repo}@${branch}/flat`)
      const picked = pickSkillMdPaths((res.files ?? []).map((f) => (f.name ?? '').replace(/^\//, '')))
      if (picked.length > 0) return { branch, paths: picked }
      errors.push(`jsdelivr(${branch}) 无 SKILL.md`)
    } catch (err) {
      errors.push(`jsdelivr(${branch}) ${err instanceof Error ? err.message : err}`)
    }
  }
  throw new Error(
    `仓库目录探测失败：${errors.slice(0, 2).join('；')}。GitHub API 可能限额或不可达，可直接提供某个 SKILL.md 的直链`
  )
}

/** 仓库内 SKILL.md 路径 → 可再解析的引用：blob 链接（githubCandidates 会还原成 raw 直链再走竞速） */
function blobRef(owner: string, repo: string, branch: string, path: string): string {
  return `https://github.com/${owner}/${repo}/blob/${branch}/${path}`
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
    let got: { content: string; origin: string }
    try {
      got = await fetchFirst(candidates)
    } catch (err) {
      // 仓库引用全部落空 → 合集仓库探测：列出仓库内全部 SKILL.md 供用户挑选
      const info = githubRepoInfo(d.ref)
      if (!info) throw err
      const { branch, paths } = await listRepoSkillFiles(info.owner, info.repo)
      if (paths.length === 1) {
        return resolveSkillInstall({ ...d, ref: blobRef(info.owner, info.repo, branch, paths[0]) })
      }
      return {
        name: sanitizeSkillName(d.name?.trim() || info.repo, d.ref),
        description: `合集仓库探测到 ${paths.length} 个 SKILL.md，请选择要安装的`,
        content: '',
        origin: `github.com/${info.owner}/${info.repo}`,
        exists: false,
        scriptDep: null,
        candidates: paths.map((p) => ({
          name: skillNameFromPath(p, info.repo),
          path: p,
          ref: blobRef(info.owner, info.repo, branch, p)
        }))
      }
    }
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
