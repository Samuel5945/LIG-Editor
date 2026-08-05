/**
 * 供应商精选目录（纯展示层）：已知供应商官网跳转链接 + 置顶供应商标识
 * 只影响 UI 展示顺序与外链，不干预默认模型与任何调用逻辑
 */

export interface ProviderSiteLink {
  label: string
  url: string
}

/** 置顶供应商：基元律动（TokenRhythm）——仅显示置顶，不参与任何默认逻辑 */
export function isRhythmProvider(p: { name: string; baseUrl: string }): boolean {
  return p.baseUrl.includes('tokenrhythm.studio') || p.name.includes('基元律动')
}

export function isAgnesProvider(p: { name: string; baseUrl: string }): boolean {
  return /agnes-ai\.(com|cn)/i.test(p.baseUrl) || p.name.toLowerCase().includes('agnes')
}

/** 已知供应商的官网跳转链接（window.open → 系统浏览器）；未知供应商返回空 */
export function providerSiteLinks(p: { name: string; baseUrl: string } | null): ProviderSiteLink[] {
  if (!p) return []
  if (isRhythmProvider(p)) {
    return [{ label: '官网', url: 'https://tokenrhythm.studio/i/rf_tr_ZkWfacNv3IcOR5JNkY3jXQU0' }]
  }
  if (isAgnesProvider(p)) {
    return [
      { label: '国际站', url: 'https://agnes-ai.com' },
      { label: '中国站', url: 'https://agnes-ai.cn' }
    ]
  }
  return []
}
