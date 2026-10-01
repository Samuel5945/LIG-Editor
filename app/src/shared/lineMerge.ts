import type { DiffLine } from './lineDiff'

/**
 * 冲突逐行合并（ConflictDialog 的「逐行合并」模式）。
 *
 * 口径：相同行一律保留；本地独有行（del）与外部独有行（add）各由一行开关决定收不收，
 * 默认全收 = 并集（谁的内容都不丢，再由人逐行去掉不要的）。
 * 抽成纯函数放这里，是为了让「默认并集」这条口径可被单测锁住——
 * 它写在弹窗组件里就只能靠手点验证，而手点很难覆盖默认值语义。
 */
export function mergeDecision(line: DiffLine, explicit: boolean | undefined): boolean {
  if (line.type === 'same') return true
  return explicit ?? true
}

/** 按开关表合成合并后的全文（take[i] 未定义 = 用默认值） */
export function mergeLines(lines: DiffLine[], take: Record<number, boolean>): string {
  return lines
    .filter((l, i) => mergeDecision(l, take[i]))
    .map((l) => l.text)
    .join('\n')
}

/** 合并结果行数（同一口径的计数，给底栏提示用） */
export function mergedLineCount(lines: DiffLine[], take: Record<number, boolean>): number {
  return lines.filter((l, i) => mergeDecision(l, take[i])).length
}
