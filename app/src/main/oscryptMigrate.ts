import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getAppPaths } from './paths'

/**
 * safeStorage 密钥迁移（2026-08 应用改名：图文编辑器 → 立格编辑器）。
 * Electron safeStorage（Windows）的密文是 v10 格式 = AES-GCM，AES 密钥本身经 DPAPI
 * 加密后存在 <userData>/Local State 的 os_crypt.encrypted_key。改名使 userData 目录
 * 从 %APPDATA%\图文编辑器 变为 %APPDATA%\立格编辑器，新目录首启会生成全新密钥——
 * 随数据目录迁移过来的 llm.json / wechat.json 密文将全部解不开（界面 Key 显示为空）。
 * 这里在首启把旧密钥搬到新 Local State（DPAPI 只认 Windows 账户，跨目录搬运有效）。
 * 必须在任何 safeStorage 调用之前执行（OSCrypt 密钥进程内懒加载，启动后再改无效）；
 * 以 settings/.oscrypt-key-migrated 做一次性标记，密钥已一致或搬完都落标记不重复执行。
 */
export function migrateSafeStorageKey(): void {
  try {
    if (!app.isPackaged) return
    const marker = join(getAppPaths().settings, '.oscrypt-key-migrated')
    if (existsSync(marker)) return
    const oldLs = join(app.getPath('appData'), '图文编辑器', 'Local State')
    if (!existsSync(oldLs)) return
    const oldKey = (
      JSON.parse(readFileSync(oldLs, 'utf-8')) as { os_crypt?: { encrypted_key?: string } }
    ).os_crypt?.encrypted_key
    if (!oldKey) return
    const newLs = join(app.getPath('userData'), 'Local State')
    let cur: { os_crypt?: { encrypted_key?: string } } = {}
    if (existsSync(newLs)) {
      cur = JSON.parse(readFileSync(newLs, 'utf-8')) as typeof cur
    }
    if (cur.os_crypt?.encrypted_key !== oldKey) {
      // 新密钥是改名后首启自动生成的，此时尚未保护过任何数据，直接换成旧密钥接管历史密文
      cur.os_crypt = { ...cur.os_crypt, encrypted_key: oldKey }
      writeFileSync(newLs, JSON.stringify(cur))
    }
    writeFileSync(marker, new Date().toISOString())
  } catch {
    // 迁移失败不阻塞启动：Key 解不开时用户重输一次即可
  }
}
