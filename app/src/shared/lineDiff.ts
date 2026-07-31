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
