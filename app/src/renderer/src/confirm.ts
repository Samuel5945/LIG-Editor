/**
 * 破坏性操作的确认框。
 *
 * 一律走主进程的父窗口模态（`dialog:confirm`），不要用 `window.confirm`：
 * 后者在 Windows 上不带父窗口，弹框关掉后焦点不回到 BrowserWindow，
 * 表现是之后页面里点了没反应（切到别的窗口再切回来才恢复）——2026-09-30 删除会话实测命中。
 *
 * 取不到结果时返回 false：问不成就不删。宁可让作者多点一次，也不能替作者确认破坏性操作。
 */
export async function confirmAction(
  message: string,
  opts?: { title?: string; okLabel?: string }
): Promise<boolean> {
  try {
    return await window.api.invoke('dialog:confirm', message, opts?.title, opts?.okLabel)
  } catch {
    return false
  }
}
