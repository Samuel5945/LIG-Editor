import { describe, expect, it } from 'vitest'
import { parseAccentIntent } from '../accentIntent'

describe('parseAccentIntent（纯换色指令直连）', () => {
  it('识别中文色名换色', () => {
    expect(parseAccentIntent('强调色改为金色')).toEqual({ color: '#c9a227' })
    expect(parseAccentIntent('把强调色改为金色')).toEqual({ color: '#c9a227' })
    expect(parseAccentIntent('换个橙色')).toEqual({ color: '#ff6b35' })
    expect(parseAccentIntent('配色改成墨绿')).toEqual({ color: '#1f6f54' })
  })

  it('识别夹带正文/标题字样但本质是换色（截图真实用例）', () => {
    expect(parseAccentIntent('我让你把正文蓝色改为金色')).toEqual({ color: '#c9a227' })
    expect(parseAccentIntent('标题强调色换红色')).toEqual({ color: '#e63946' })
  })

  it('识别浅色/柔和色名（用户偏好）', () => {
    expect(parseAccentIntent('强调色换成清新浅绿')).toEqual({ color: '#81c784' })
    expect(parseAccentIntent('换成浅绿')).toEqual({ color: '#81c784' })
    expect(parseAccentIntent('强调色改浅蓝')).toEqual({ color: '#90caf9' })
    expect(parseAccentIntent('配色换成莫兰迪绿')).toEqual({ color: '#a3b899' })
  })

  it('识别 hex 色值（含不带 # 的裸色值）', () => {
    expect(parseAccentIntent('强调色改成#FF6B35')).toEqual({ color: '#ff6b35' })
    expect(parseAccentIntent('配色设为 #4f8cff')).toEqual({ color: '#4f8cff' })
    expect(parseAccentIntent('换成81c784')).toEqual({ color: '#81c784' })
    expect(parseAccentIntent('用 81c784')).toEqual({ color: '#81c784' })
  })

  it('识别恢复默认', () => {
    expect(parseAccentIntent('恢复默认强调色')).toEqual({ color: null })
    expect(parseAccentIntent('强调色还原')).toEqual({ color: null })
  })

  it('非强调色对象 / 夹带内容需求 / 无颜色 → 回落 LLM（null）', () => {
    expect(parseAccentIntent('把封面换成金色')).toBeNull()
    expect(parseAccentIntent('把标题改成红色再润色正文')).toBeNull()
    expect(parseAccentIntent('帮我优化一下这段')).toBeNull()
    expect(parseAccentIntent('这篇文章写得怎么样')).toBeNull()
    // 超长句多半带内容需求
    expect(parseAccentIntent('请把全文的强调色从蓝色改成金色并且顺便帮我把第三段的措辞再润色得更口语化一些')).toBeNull()
  })
})
