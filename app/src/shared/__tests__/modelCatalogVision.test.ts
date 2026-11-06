// @vitest-environment node
/**
 * 模型能力目录的视觉声明契约（双源互验，2026-11-05 商汤网关红块图探针实测 +
 * 2026-11-06 TokenRhythm 官方 /api/models capabilities.vision）：
 * deepseek-flash 真读图；deepseek-v4 系网关丢图按无视觉；deepseek-v4.1 TR 官方标有视觉；
 * glm-5 系纯文本；kimi-k3 / sensenova-6.8-flash(-lite) 读图。附件拦截与「视觉」徽章都吃这份声明。
 */
import { describe, it, expect } from 'vitest'
import { hasImageInput, modelCapability } from '../modelCatalog'

const st = { baseUrl: 'https://token.sensenova.cn/v1' }

describe('modelCatalog 视觉声明（商汤实测 + TokenRhythm 官方标注）', () => {
  it('deepseek-flash 有视觉；deepseek-v4 系无视觉（网关丢图）；v4.1 TR 标有视觉', () => {
    expect(hasImageInput(modelCapability(st, 'deepseek-flash'))).toBe(true)
    expect(hasImageInput(modelCapability(st, 'deepseek-v4-flash'))).toBe(false)
    expect(hasImageInput(modelCapability(st, 'deepseek-v4-pro'))).toBe(false)
    expect(hasImageInput(modelCapability(st, 'deepseek-v4.1-flash-1017'))).toBe(true)
  })

  it('glm-5 系纯文本；kimi-k3 / sensenova-6.8-flash 与 -lite 都有视觉', () => {
    expect(hasImageInput(modelCapability(st, 'glm-5.2'))).toBe(false)
    expect(hasImageInput(modelCapability(st, 'glm-5.3'))).toBe(false)
    expect(hasImageInput(modelCapability(st, 'kimi-k3'))).toBe(true)
    expect(hasImageInput(modelCapability(st, 'sensenova-6.8-flash'))).toBe(true)
    expect(hasImageInput(modelCapability(st, 'sensenova-6.8-flash-lite'))).toBe(true)
  })

  it('未知供应商兜底同声明：deepseek-flash / v4.1 视觉不随供应商丢', () => {
    expect(hasImageInput(modelCapability({ baseUrl: 'https://other.example/v1' }, 'deepseek-flash'))).toBe(true)
    expect(hasImageInput(modelCapability({ baseUrl: 'https://tokenrhythm.studio/v1' }, 'deepseek-v4.1-flash'))).toBe(true)
  })
})
