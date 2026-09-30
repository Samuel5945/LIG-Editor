import { describe, expect, it } from 'vitest'
import { isImeComposing, shouldSubmitOnEnter } from '../imeEnter'

/** 造一个 React 风格的键盘事件（组合态走 nativeEvent.isComposing，与真实合成事件一致） */
function key(opts: {
  key?: string
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
  alt?: boolean
  composing?: boolean
  keyCode?: number
}) {
  return {
    key: opts.key ?? 'Enter',
    shiftKey: !!opts.shift,
    ctrlKey: !!opts.ctrl,
    metaKey: !!opts.meta,
    altKey: !!opts.alt,
    nativeEvent: { isComposing: !!opts.composing, keyCode: opts.keyCode ?? (opts.key === 'Enter' || !opts.key ? 13 : 0) }
  }
}

describe('isImeComposing（输入法组合态判定）', () => {
  it('nativeEvent.isComposing 为真即组合中', () => {
    expect(isImeComposing(key({ composing: true }))).toBe(true)
    expect(isImeComposing(key({}))).toBe(false)
  })

  it('事件顶层 isComposing 也认（原生 KeyboardEvent 直接用）', () => {
    expect(isImeComposing({ key: 'Enter', isComposing: true })).toBe(true)
  })

  it('keyCode 229（旧 WebKit/Blink 组合期约定）算组合中', () => {
    expect(isImeComposing({ key: 'Process', keyCode: 229 })).toBe(true)
    expect(isImeComposing(key({ keyCode: 229 }))).toBe(true)
  })
})

describe('shouldSubmitOnEnter（Enter 提交判定）', () => {
  it('组合中的 Enter 不提交——这正是「中文打完按回车，半截拼音被发出去/输入框被清空」的现场', () => {
    expect(shouldSubmitOnEnter(key({ composing: true }))).toBe(false)
    expect(shouldSubmitOnEnter(key({ composing: true, shift: true }))).toBe(false)
  })

  it('非组合态的裸 Enter 提交', () => {
    expect(shouldSubmitOnEnter(key({}))).toBe(true)
  })

  it('Shift+Enter 默认留给软换行，allowShift 时（单行输入框）照旧提交', () => {
    expect(shouldSubmitOnEnter(key({ shift: true }))).toBe(false)
    expect(shouldSubmitOnEnter(key({ shift: true }), { allowShift: true })).toBe(true)
  })

  it('带 Ctrl/Alt/Meta 的 Enter 不当提交（留给快捷键）', () => {
    expect(shouldSubmitOnEnter(key({ ctrl: true }))).toBe(false)
    expect(shouldSubmitOnEnter(key({ meta: true }))).toBe(false)
    expect(shouldSubmitOnEnter(key({ alt: true }))).toBe(false)
  })

  it('其他键一律不提交', () => {
    expect(shouldSubmitOnEnter(key({ key: 'a' }))).toBe(false)
    expect(shouldSubmitOnEnter(key({ key: 'Escape' }))).toBe(false)
    expect(shouldSubmitOnEnter({})).toBe(false)
  })
})
