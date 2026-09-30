/**
 * Enter 提交的输入法（IME）判定 —— 修「对话偶现无法输入」
 *
 * 症状：中文输入时按 Enter 是想「确认拼音候选词上屏」，但控件的 keydown 把它当成「提交」，
 * 于是半截拼音/半截句子被当成消息发了出去并清空输入框（重命名框则直接关闭编辑态）。
 * 用户视角就是「打字打到一半回车，字没了、发错了、框不能输了」，且只在按 Enter 确认候选时出现——所以是「偶现」。
 *
 * 判据用事件自带的组合态标志，不用组件内自记的 composing 状态：
 * 后者若 compositionend 未送达会卡在 true，把 Enter 永久堵死，等于换一个更难的 bug。
 * 两条信号任一为真即算组合中：isComposing（标准）与 keyCode 229（旧 WebKit/Blink 的组合期约定）。
 */

/** 只声明判定所需的最小字段，React 的 KeyboardEvent 与原生 KeyboardEvent 都能直接传入 */
export interface EnterKeyLike {
  key?: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  /** 原生 KeyboardEvent 上的组合态标志 */
  isComposing?: boolean
  /** React 合成事件走这条路 */
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
  /** 已废弃但仍在事件上可读，229 = 组合进行中 */
  keyCode?: number
}

/** 该按键事件是否处于输入法组合中（候选词未上屏） */
export function isImeComposing(e: EnterKeyLike): boolean {
  if (e.isComposing) return true
  const native = e.nativeEvent
  if (native?.isComposing) return true
  if (e.keyCode === 229 || native?.keyCode === 229) return true
  return false
}

/**
 * Enter 是否应当触发提交。
 * - 非 Enter 一律 false（调用方不需要再判 key）
 * - 组合中的 Enter 不提交，交给输入法确认候选
 * - 带 Ctrl/Alt/Meta 的 Enter 不提交（留给可能的快捷键）
 * - allowShift=false（默认）：Shift+Enter 属于「换行」，多行输入框用它保留软换行
 */
export function shouldSubmitOnEnter(e: EnterKeyLike, opts?: { allowShift?: boolean }): boolean {
  if (e.key !== 'Enter') return false
  if (isImeComposing(e)) return false
  if (!opts?.allowShift && e.shiftKey) return false
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  return true
}
