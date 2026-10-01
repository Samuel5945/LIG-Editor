import { describe, it, expect } from 'vitest'
import { diffLines } from '../lineDiff'
import { mergeDecision, mergeLines, mergedLineCount } from '../lineMerge'

/**
 * 冲突逐行合并口径（ConflictDialog「逐行合并」）：
 * 默认并集——本地独有行与外部独有行都先收下，再由人逐行翻面。
 */
describe('lineMerge 逐行合并', () => {
  const local = ['共享段A', '本地独有B', '共享段C']
  const external = ['共享段A', '外部独有D', '共享段C']
  const lines = diffLines(local.join('\n'), external.join('\n'))

  it('相同行一律保留，独有行默认收下（并集）', () => {
    const merged = mergeLines(lines, {})
    expect(merged).toContain('共享段A')
    expect(merged).toContain('共享段C')
    expect(merged).toContain('本地独有B')
    expect(merged).toContain('外部独有D')
  })

  it('逐行开关可把某条独有行去掉，不影响其它行', () => {
    const delIdx = lines.findIndex((l) => l.text === '本地独有B')
    const addIdx = lines.findIndex((l) => l.text === '外部独有D')
    expect(delIdx).toBeGreaterThanOrEqual(0)
    expect(mergeLines(lines, { [delIdx]: false })).not.toContain('本地独有B')
    expect(mergeLines(lines, { [addIdx]: false })).not.toContain('外部独有D')
    // 关掉一行，行数正好少一
    expect(mergedLineCount(lines, { [addIdx]: false })).toBe(mergedLineCount(lines, {}) - 1)
  })

  it('相同行不给开关（关掉也不该生效，避免「合并结果丢共同内容」）', () => {
    const sameIdx = lines.findIndex((l) => l.type === 'same')
    expect(mergeDecision(lines[sameIdx], false)).toBe(true)
  })

  it('两边全丢只剩共同行时，结果就是共同行', () => {
    const only = diffLines('A', 'A')
    expect(mergeLines(only, {})).toBe('A')
    expect(mergedLineCount(only, {})).toBe(1)
  })
})
