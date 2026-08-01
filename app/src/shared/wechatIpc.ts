// 公众号推送 UI 接入层的 IPC 契约声明（本文件归 UI 层所有）
// 类型契约的单一来源在 shared/wechat.ts（核心管线侧），此处只转发 + 做 IpcApi 模块增强
import type { WechatSettings, PushDraftResult, PublicIpResult } from './wechat'

export type { WechatSettings, PushDraftResult, PublicIpResult } from './wechat'

// IpcApi 模块增强：四个公众号通道并入单一契约来源（types.ts 冻结，不直接改）
declare module './types' {
  interface IpcApi {
    'wechat:get-settings': () => WechatSettings
    'wechat:set-settings': (settings: WechatSettings) => void
    'wechat:push-draft': (args: { project: string }) => PushDraftResult
    'wechat:push-cards': (args: { project: string }) => PushDraftResult
    'wechat:public-ip': () => PublicIpResult
  }
}
