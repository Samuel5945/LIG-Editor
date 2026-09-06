/**
 * 内容日历纯函数测试：月历矩阵形状与对齐（周一起始）、ymd 往返、月份游标跨年。
 * 用真实日历锚点校验：2026-09-01 是周二 → 首格应为 2026-08-31（周一）。
 */
import { describe, expect, it } from 'vitest'
import { addMonths, monthMatrix, parseYmd, todayYmd, weekCount, ymd, ymdLabel } from '../calendar'

describe('ymd / parseYmd', () => {
  it('本地日期格式化与解析往返', () => {
    const d = new Date(2026, 8, 6) // 2026-09-06 本地 0 点
    expect(ymd(d)).toBe('2026-09-06')
    const back = parseYmd('2026-09-06')
    expect(back).not.toBeNull()
    expect(ymd(back!)).toBe('2026-09-06')
    expect(back!.getFullYear()).toBe(2026)
    expect(back!.getMonth()).toBe(8)
    expect(back!.getDate()).toBe(6)
  })

  it('非法输入返回 null；todayYmd 是合法 ymd', () => {
    expect(parseYmd('2026/09/06')).toBeNull()
    expect(parseYmd('not-a-date')).toBeNull()
    expect(parseYmd('')).toBeNull()
    expect(/^\d{4}-\d{2}-\d{2}$/.test(todayYmd())).toBe(true)
  })
})

describe('monthMatrix（周一起始 6×7）', () => {
  it('2026-09：首格为 8/31（周一），9/1 落第二格', () => {
    const weeks = monthMatrix(2026, 8)
    expect(weeks).toHaveLength(6)
    for (const row of weeks) expect(row).toHaveLength(7)
    expect(ymd(weeks[0][0])).toBe('2026-08-31') // 周一
    expect(ymd(weeks[0][1])).toBe('2026-09-01') // 周二
    // 每行首列都是周一
    for (const row of weeks) expect(row[0].getDay()).toBe(1)
  })

  it('跨月溢出：网格包含上月与下月日期（调用方按 getMonth 判断灰显）', () => {
    const weeks = monthMatrix(2026, 8)
    expect(ymd(weeks[5][6])).toBe('2026-10-11') // 9 月网格最后格
    expect(weeks.flat().some((d) => d.getMonth() === 7)).toBe(true) // 含 8 月溢出
    expect(weeks.flat().some((d) => d.getMonth() === 9)).toBe(true) // 含 10 月溢出
  })

  it('平年 2 月（2027-02，28 天）：2/1 恰是周一 → 首格当天、整占 4 周', () => {
    const weeks = monthMatrix(2027, 1)
    expect(ymd(weeks[0][0])).toBe('2027-02-01')
    expect(weekCount(2027, 1)).toBe(4)
  })

  it('weekCount：2026-09 是 5 周月（8/31 起 35 天覆盖到 10/4）', () => {
    // 9/1 周二，30 天：8/31 + 34 天 = 10/4 → 第 5 行末 10/4 当月 → 5 行
    expect(weekCount(2026, 8)).toBe(5)
    // 2026-08：8/1 是周六 → 前导 5 天，31 天 → 8/31 周一在第 6 行 → 6 行
    expect(weekCount(2026, 7)).toBe(6)
  })
})

describe('addMonths / ymdLabel', () => {
  it('跨年进退位', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month0: 0 })
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month0: 11 })
    expect(addMonths(2026, 8, 4)).toEqual({ year: 2027, month0: 0 })
    expect(addMonths(2026, 8, -8)).toEqual({ year: 2026, month0: 0 })
  })

  it('ymdLabel 中文短格式；非法原样返回', () => {
    expect(ymdLabel('2026-09-06')).toBe('9月6日')
    expect(ymdLabel('bad')).toBe('bad')
  })
})
