/**
 * 工程名规范化：选题标题 / 用户输入 → 合法工程名。
 * 单一来源——主进程创建工程、渲染层脑暴立项、选题状态匹配都走这里，
 * 三处各写一份迟早会分叉（历史上渲染层就复制过一份并在注释里写着"与主进程一致"）。
 */

/** 去 Windows 非法字符、折叠上级目录、截断 30 字、去结尾点与空格（结尾点是 Windows 病态路径） */
export function sanitizeProjectName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\./g, '')
    .trim()
    .slice(0, 30)
    .replace(/[. ]+$/, '')
}
