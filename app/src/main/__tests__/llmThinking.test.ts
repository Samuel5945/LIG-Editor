/**
 * 思考档位 → 协议参数的映射矩阵（openaiThinkingParams）：
 * - 商汤 token 网关（sensenova.cn baseUrl）：reasoning_effort 全档直达（2026-10-25 probe 实测：
 *   词汇 none/minimal/low/medium/high/xhigh/max，effort=none 真关闭），跟随默认不发参数
 * - qwen3.8（阿里百炼）：reasoning_effort 只认 low/medium/high，无关闭档（关=不发）
 * - 未知 baseUrl 的 deepseek/glm/kimi：兜底 thinking_type 对象开关（官方 API 不认 effort，硬发 400）
 * - qwen3.7 等走 enable_thinking（只吃开关，档位降级为开/关）
 * 这层是「思考级别」唯一真正生效的协议面，映射错一档用户的感知就是钱和等待时长。
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: async () => ({}) } }))

import { openaiThinkingParams } from '../llm'
import type { ProviderConfig } from '@shared/types'

const provider = (textModel: string, baseUrl = 'https://x'): ProviderConfig =>
  ({ id: 'p', name: '测试', baseUrl, apiKey: '', textModel }) as ProviderConfig

describe('openaiThinkingParams · reasoning_effort 全档（商汤 token 网关）', () => {
  const p = provider('deepseek-v4-flash', 'https://token.sensenova.cn/v1')

  it('档位直达：minimal~max 原样下发，词汇表来自网关 400 报文回显', () => {
    expect(openaiThinkingParams(p, { thinking: 'minimal' })).toEqual({ reasoning_effort: 'minimal' })
    expect(openaiThinkingParams(p, { thinking: 'low' })).toEqual({ reasoning_effort: 'low' })
    expect(openaiThinkingParams(p, { thinking: 'medium' })).toEqual({ reasoning_effort: 'medium' })
    expect(openaiThinkingParams(p, { thinking: 'high' })).toEqual({ reasoning_effort: 'high' })
    expect(openaiThinkingParams(p, { thinking: 'xhigh' })).toEqual({ reasoning_effort: 'xhigh' })
    expect(openaiThinkingParams(p, { thinking: 'max' })).toEqual({ reasoning_effort: 'max' })
  })

  it('跟随默认不发参数（服务端默认最准）；true = 开但无偏好 → medium', () => {
    expect(openaiThinkingParams(p, {})).toEqual({})
    expect(openaiThinkingParams(p, { thinking: true })).toEqual({ reasoning_effort: 'medium' })
  })

  it('关闭：false 与显式 none 都落 effort:none（probe 实测 reasoning 归零）', () => {
    expect(openaiThinkingParams(p, { thinking: false })).toEqual({ reasoning_effort: 'none' })
    expect(openaiThinkingParams(p, { thinking: 'none' })).toEqual({ reasoning_effort: 'none' })
  })

  it('目录外的档位丢弃不发（换模型后残留的旧档位不能变成 400）', () => {
    expect(openaiThinkingParams(p, { thinking: 'banana' as never })).toEqual({})
  })
})

describe('openaiThinkingParams · reasoning_effort 三档（qwen3.8 · 阿里百炼）', () => {
  const p = provider('qwen3.8-max', 'https://dashscope.aliyuncs.com/compatible-mode/v1')

  it('low/medium/high 直达；true=medium；跟随默认与关闭都只发空（无 none 档，恒思考）', () => {
    expect(openaiThinkingParams(p, { thinking: 'low' })).toEqual({ reasoning_effort: 'low' })
    expect(openaiThinkingParams(p, { thinking: 'high' })).toEqual({ reasoning_effort: 'high' })
    expect(openaiThinkingParams(p, { thinking: true })).toEqual({ reasoning_effort: 'medium' })
    expect(openaiThinkingParams(p, {})).toEqual({})
    expect(openaiThinkingParams(p, { thinking: false })).toEqual({})
    expect(openaiThinkingParams(p, { thinking: 'none' })).toEqual({})
    // 商汤词汇表里的 xhigh/max 不在百炼档位集，丢弃防 400
    expect(openaiThinkingParams(p, { thinking: 'xhigh' })).toEqual({})
    expect(openaiThinkingParams(p, { thinking: 'max' })).toEqual({})
  })
})

describe('openaiThinkingParams · enable_thinking 协议（qwen3.7）', () => {
  it('档位降级为开关；false 与 none 都是关', () => {
    const p = provider('qwen3.7-plus')
    expect(openaiThinkingParams(p, { thinking: 'high' })).toEqual({ enable_thinking: true })
    expect(openaiThinkingParams(p, { thinking: 'low' })).toEqual({ enable_thinking: true })
    expect(openaiThinkingParams(p, { thinking: false })).toEqual({ enable_thinking: false })
    expect(openaiThinkingParams(p, { thinking: 'none' })).toEqual({ enable_thinking: false })
    expect(openaiThinkingParams(p, {})).toEqual({ enable_thinking: true })
  })
})

describe('openaiThinkingParams · thinking_type 兜底（未知 baseUrl 的 deepseek / glm-5 / kimi-k3）', () => {
  it('开 = thinking:{type:enabled}，关（false/none）= disabled；档位降级为开', () => {
    const p = provider('deepseek-v4-flash')
    expect(openaiThinkingParams(p, { thinking: 'high' })).toEqual({ thinking: { type: 'enabled' } })
    expect(openaiThinkingParams(p, { thinking: 'max' })).toEqual({ thinking: { type: 'enabled' } })
    expect(openaiThinkingParams(p, { thinking: false })).toEqual({ thinking: { type: 'disabled' } })
    expect(openaiThinkingParams(p, { thinking: 'none' })).toEqual({ thinking: { type: 'disabled' } })
    expect(openaiThinkingParams(p, {})).toEqual({ thinking: { type: 'enabled' } }) // 目录 defaultOn=true
    expect(openaiThinkingParams(provider('glm-5.2'), { thinking: false })).toEqual({ thinking: { type: 'disabled' } })
    expect(openaiThinkingParams(provider('kimi-k3-flash'), { thinking: 'high' })).toEqual({ thinking: { type: 'enabled' } })
  })
})

describe('openaiThinkingParams · 无 reasoning 声明', () => {
  it('（qwen3-max）不发思考参数，保持供应商默认', () => {
    expect(openaiThinkingParams(provider('qwen3-max'), { thinking: 'high' })).toEqual({})
  })
})
