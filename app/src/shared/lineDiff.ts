/** 行级 diff（LCS）：用于外部修改冲突弹窗的可视化对比 */

export interface DiffLine {
  type: 'same' | 'del' | 'add'
  text: string
}

/** a=本地内容，b=外部内容；del=本地独有行，add=外部独有行 */
export function diffLines(a: string, b: string): DiffLine[] {
  const al = a.split('\n')
  const bl = b.split('\n')
  const m = al.length
  const n = bl.length
  // LCS 动态规划表（文章体量下 O(m*n) 足够）
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (al[i] === bl[j]) {
      out.push({ type: 'same', text: al[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: al[i] })
      i++
    } else {
      out.push({ type: 'add', text: bl[j] })
      j++
    }
  }
  while (i < m) out.push({ type: 'del', text: al[i++] })
  while (j < n) out.push({ type: 'add', text: bl[j++] })
  return out
}

export interface DiffSeg {
  type: 'same' | 'del' | 'add'
  text: string
}

/** 字符级 diff（LCS）：对比两段短文本（修订补丁的原文 vs 新版），标出具体改了哪几个字。
 * 两长度乘积过大时退化为「整删+整增」，避免 O(m*n) 爆炸 */
export function diffChars(a: string, b: string): DiffSeg[] {
  if (a === b) return a ? [{ type: 'same', text: a }] : []
  if (a.length * b.length > 250000) {
    return [...(a ? [{ type: 'del' as const, text: a }] : []), ...(b ? [{ type: 'add' as const, text: b }] : [])]
  }
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const raw: DiffSeg[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'del', text: a[i++] })
    } else {
      raw.push({ type: 'add', text: b[j++] })
    }
  }
  while (i < m) raw.push({ type: 'del', text: a[i++] })
  while (j < n) raw.push({ type: 'add', text: b[j++] })
  // 合并相邻同类型片段，避免一字一块的碎片渲染
  const out: DiffSeg[] = []
  for (const seg of raw) {
    const last = out[out.length - 1]
    if (last && last.type === seg.type) last.text += seg.text
    else out.push({ ...seg })
  }
  return out
}
