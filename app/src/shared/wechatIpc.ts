// 公众号推送 UI 接入层的 IPC 契约声明（本文件归 UI 层所有）
// 类型契约的单一来源在 shared/wechat.ts（核心管线侧），此处只转发 + 做 IpcApi 模块增强
import type { WechatConfig, PushDraftResult, PublicIpResult } from './wechat'

export type { WechatAccount, WechatConfig, PushDraftResult, PublicIpResult } from './wechat'

// IpcApi 模块增强：公众号通道并入单一契约来源（types.ts 冻结，不直接改）
declare module './types' {
  interface IpcApi {
    'wechat:get-config': () => WechatConfig
    /** 全量保存账号列表与默认账号；绑定关系不经此通道（避免误覆盖分类绑定） */
    'wechat:save-config': (config: WechatConfig) => void
    /** 分类绑定账号；accountId 传 null = 解绑，回退到默认账号 */
    'wechat:set-binding': (category: string, accountId: string | null) => void
    'wechat:push-draft': (args: { project: string; variant?: 'day' | 'night' }) => PushDraftResult
    'wechat:push-cards': (args: { project: string }) => PushDraftResult
    'wechat:public-ip': () => PublicIpResult
  }
}
