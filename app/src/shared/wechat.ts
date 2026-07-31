/**
 * 公众号推送契约：主进程实现在 main/wechatStore.ts 与 main/wechatPublish.ts，
 * UI 层（设置页/导出对话框）与 preload 按本文件的类型与通道名对接
 */

export interface WechatSettings {
  appId: string
  /** 渲染层明文往返；主进程落盘时 safeStorage 加密（同 llm.json） */
  appSecret: string
}

export interface PushDraftResult {
  ok: boolean
  /** 成功时返回草稿 media_id */
  mediaId?: string
  error?: string
}

/** IPC 通道名（UI 接入层注册用） */
export const WECHAT_CHANNELS = {
  getSettings: 'wechat:get-settings',
  setSettings: 'wechat:set-settings',
  pushDraft: 'wechat:push-draft'
} as const
