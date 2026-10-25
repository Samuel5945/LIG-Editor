/**
 * 思考档位 → 协议参数的映射矩阵（openaiThinkingParams）：
 * qwen3.8 走 reasoning_effort（三档：low/medium/high，关=不发）；qwen3.7 等走 enable_thinking
 * （只吃开关，档位降级为开）；无 openaiParam 声明的模型（deepseek/glm-5）不发思考参数。
 * 这层是「思考级别」唯一真正生效的协议面，映射错一档用户的感知就是钱和等待时长。
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: async () => ({}) } }))

import { openaiThinkingParams } from '../llm'
import type { ProviderConfig } from '@shared/types'

const provider = (textModel: string): ProviderConfig =>
  ({ id: 'p', name: '测试', baseUrl: 'https://x', apiKey: '', textModel }) as ProviderConfig

describe('openaiThinkingParams · 档位映射', () => {
  it('reasoning_effort 协议（qwen3.8）：low/high 显式下发，true 与跟随默认落 medium，关不发', () => {
    const p = provider('qwen3.8-max')
    expect(openaiThinkingParams(p, { thinking: 'low' })).toEqual({ reasoning_effort: 'low' })
    expect(openaiThinkingParams(p, { thinking: 'high' })).toEqual({ reasoning_effort: 'high' })
    expect(openaiThinkingParams(p, { thinking: true })).toEqual({ reasoning_effort: 'medium' })
    // 跟随默认：目录 defaultOn=true → medium（与引入级别前的行为一致）
    expect(openaiThinkingParams(p, {})).toEqual({ reasoning_effort: 'medium' })
    expect(openaiThinkingParams(p, { thinking: false })).toEqual({})
  })

  it('enable_thinking 协议（qwen3.7）：档位降级为开关，级别信息不硬塞', () => {
    const p = provider('qwen3.7-plus')
    expect(openaiThinkingParams(p, { thinking: 'high' })).toEqual({ enable_thinking: true })
    expect(openaiThinkingParams(p, { thinking: 'low' })).toEqual({ enable_thinking: true })
    expect(openaiThinkingParams(p, { thinking: false })).toEqual({ enable_thinking: false })
    expect(openaiThinkingParams(p, {})).toEqual({ enable_thinking: true })
  })

  it('无 openaiParam 声明的思考模型（deepseek/glm-5）：不发思考参数，保持供应商默认', () => {
    expect(openaiThinkingParams(provider('deepseek-v4-flash'), { thinking: 'high' })).toEqual({})
    expect(openaiThinkingParams(provider('glm-5.2'), { thinking: 'low' })).toEqual({})
  })
})
