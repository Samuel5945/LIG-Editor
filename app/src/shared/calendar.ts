/**
 * 内容日历纯函数（M12）：月历矩阵与本地日期工具
 *
 * 约定：日期一律用本地时区的 Date 或 'YYYY-MM-DD' 字符串（ymd）。
 * 排期数据（project.json plannedAt）与看板单元格都用 ymd 字符串比较，零时区/序列化问题；
 * 只有定位周几、生成网格才走 Date。周一起始（国内排期习惯）。
 */

/** 本地日期 → 'YYYY-MM-DD'（不用 toISOString：那是 UTC，本地 0 点会退一天） */
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 'YYYY-MM-DD' → 本地 Date（0 点）；非法输入返回 null */
export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 今天的 ymd */
export function todayYmd(): string {
  return ymd(new Date())
}

/** 月份游标：年 + 0 起始月，delta 可跨年（11 + 1 → 次年 0） */
export function addMonths(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 }
}

/**
 * 月历矩阵：包含该月所有日期的 6 行 × 7 列（周一起始）。
 * 首尾用相邻月日期补满 42 格（看板渲染跨月溢出灰显，矩阵本身不做标记——
 * 调用方用 getMonth() 判断是否当月）。
 */
export function monthMatrix(year: number, month0: number): Date[][] {
  const first = new Date(year, month0, 1)
  // 周一起始偏移：getDay() 周日=0 → 周一=1；偏移 = (day + 6) % 7
  const lead = (first.getDay() + 6) % 7
  const start = new Date(year, month0, 1 - lead)
  const weeks: Date[][] = []
  for (let w = 0; w < 6; w++) {
    const row: Date[] = []
    for (let i = 0; i < 7; i++) {
      row.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i))
    }
    weeks.push(row)
  }
  return weeks
}

/** 某月实际占用的周数（4-6）——看板想压缩空行时用；固定 6 行渲染可忽略 */
export function weekCount(year: number, month0: number): number {
  const matrix = monthMatrix(year, month0)
  let n = 0
  for (const row of matrix) {
    if (row.some((d) => d.getMonth() === month0)) n++
  }
  return n
}

/** 'YYYY-MM-DD' 的中文短展示（9月6日）；非当月年份缺失时由调用方自行补 */
export function ymdLabel(s: string): string {
  const d = parseYmd(s)
  if (!d) return s
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
