/**
 * 公众号推送契约：主进程实现在 main/wechatStore.ts 与 main/wechatPublish.ts，
 * UI 层（推送设置/分类管理/导出对话框）与 preload 按本文件的类型与通道名对接
 *
 * 多账号（账号 = 分类）：一个公众号账号一条记录（id 稳定，绑定与 token 缓存按 id 索引），
 * 分类通过 bindings 绑定到账号；未绑定的分类回退到 defaultAccountId。
 */

/** 单个公众号账号：渲染层明文往返；主进程落盘时 appSecret 用 safeStorage 加密（同 llm.json） */
export interface WechatAccount {
  /** 稳定 id：绑定关系与 access_token 缓存都按它索引，改 appId 不影响既有绑定 */
  id: string
  /** 展示名（如「LIG人生如戏」），多账号列表里区分用；空则回落为 appId */
  name: string
  appId: string
  appSecret: string
}

/** 公众号配置全量：账号列表 + 默认账号 + 分类绑定 */
export interface WechatConfig {
  accounts: WechatAccount[]
  /** 未单独绑定的分类回退到它；无账号时为 null */
  defaultAccountId: string | null
  /** 分类名 → 账号 id；分类改名时由 projectStore.renameCategory 同步迁移 */
  bindings: Record<string, string>
}

export interface PushDraftResult {
  ok: boolean
  /** 成功时返回草稿 media_id */
  mediaId?: string
  /** 本次实际推送到的账号名（账号 = 分类，按工程分类解析；失败时也可能带上已解析出的账号） */
  accountName?: string
  error?: string
}

/** 获取本机公网 IP 结果（用于填写公众平台 API IP 白名单，每个账号都要各自加一遍） */
export interface PublicIpResult {
  ok: boolean
  ip?: string
  error?: string
}

/** IPC 通道名（UI 接入层注册用） */
export const WECHAT_CHANNELS = {
  getConfig: 'wechat:get-config',
  saveConfig: 'wechat:save-config',
  setBinding: 'wechat:set-binding',
  pushDraft: 'wechat:push-draft',
  pushCards: 'wechat:push-cards',
  publicIp: 'wechat:public-ip'
} as const
