import { app } from 'electron'
import { join, resolve } from 'path'
import { existsSync, mkdirSync, renameSync } from 'fs'
import type { AppPaths } from '@shared/types'

/**
 * 应用根目录（workspace/skills/settings 的父级）
 * - 开发态：app.getAppPath() = ...\本地工程目录\app → 取上级
 * - portable EXE：运行时解压到临时目录，execPath 不可靠，用 PORTABLE_EXECUTABLE_DIR（exe 同级，随身携带）
 * - 安装版：「文档\立格编辑器」——绝不能放安装目录，NSIS 覆盖安装/卸载会清空整个目录导致工程丢失
 * - 可用 LIG_ROOT 环境变量覆盖（旧名 TUWEN_ROOT 仍兼容）
 */
export function resolveRoot(): string {
  if (process.env.LIG_ROOT || process.env.TUWEN_ROOT) {
    return process.env.LIG_ROOT || (process.env.TUWEN_ROOT as string)
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR
  if (app.isPackaged) {
    // 2026-08 应用改名（图文编辑器 → 立格编辑器）：老安装版数据在 文档\图文编辑器，
    // 新版首启时整体搬到 文档\立格编辑器（workspace/settings/skills 原样保留，不丢数据）。
    // 搬不动（旧实例占用等）就继续用旧目录，宁可目录名不一致也不能让用户看到空工作区。
    const next = join(app.getPath('documents'), '立格编辑器')
    const prev = join(app.getPath('documents'), '图文编辑器')
    if (!existsSync(next) && existsSync(prev)) {
      try {
        renameSync(prev, next)
      } catch {
        return prev
      }
    }
    return next
  }
  return resolve(app.getAppPath(), '..')
}

export function getAppPaths(): AppPaths {
  const root = resolveRoot()
  const paths: AppPaths = {
    root,
    workspace: join(root, 'workspace'),
    skills: join(root, 'skills'),
    settings: join(root, 'settings'),
    ideaInbox: join(root, 'idea-inbox.md')
  }
  // 保证目录存在
  for (const dir of [paths.workspace, paths.skills, paths.settings]) {
    mkdirSync(dir, { recursive: true })
  }
  return paths
}
