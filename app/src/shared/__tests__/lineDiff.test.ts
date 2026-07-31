import { describe, it, expect } from 'vitest'
import { diffLines } from '../lineDiff'

describe('diffLines', () => {
  it('完全相同时全部为 same', () => {
    const r = diffLines('a\nb', 'a\nb')
    expect(r).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' }
    ])
  })

  it('外部新增行标记为 add', () => {
    const r = diffLines('a\nc', 'a\nb\nc')
    expect(r).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'same', text: 'c' }
    ])
  })

  it('本地独有行标记为 del', () => {
    const r = diffLines('a\nb\nc', 'a\nc')
    expect(r).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'same', text: 'c' }
    ])
  })

  it('同位置改动 → del + add 成对出现', () => {
    const r = diffLines('标题一', '标题二')
    expect(r).toEqual([
      { type: 'del', text: '标题一' },
      { type: 'add', text: '标题二' }
    ])
  })

  it('空串与内容对比', () => {
    expect(diffLines('', 'x')).toEqual([
      { type: 'del', text: '' },
      { type: 'add', text: 'x' }
    ])
  })
})
