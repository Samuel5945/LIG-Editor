import { app } from 'electron'
import { join, resolve } from 'path'
import { mkdirSync } from 'fs'
import type { AppPaths } from '@shared/types'

/**
 * 应用根目录（workspace/skills/settings 的父级）
 * - 开发态：app.getAppPath() = ...\图文编辑器\app → 取上级
 * - portable EXE：运行时解压到临时目录，execPath 不可靠，用 PORTABLE_EXECUTABLE_DIR（exe 同级，随身携带）
 * - 安装版：「文档\图文编辑器」——绝不能放安装目录，NSIS 覆盖安装/卸载会清空整个目录导致工程丢失
 * - 可用 TUWEN_ROOT 环境变量覆盖
 */
export function resolveRoot(): string {
  if (process.env.TUWEN_ROOT) return process.env.TUWEN_ROOT
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR
  if (app.isPackaged) return join(app.getPath('documents'), '图文编辑器')
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
