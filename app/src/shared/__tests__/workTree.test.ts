/**
 * 左栏工作树骨架分组（shared/workTree.ts）为什么要测这些：
 * 树的分组顺序决定用户找工程的路径——预设分类序必须稳定、未分类兜底不能漏、
 * 隐藏分类下仍有工程时必须出现在树尾而不是凭空消失。全部用整对象 toEqual 钉死输出结构。
 */
import { describe, expect, it } from 'vitest'
import { groupProjectsByCategory } from '../workTree'
import { UNCATEGORIZED } from '../categories'
import type { ProjectSummary } from '../types'

const proj = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  name: '工程',
  dir: 'C:\\workspace\\未分类\\工程',
  status: 'drafting',
  category: UNCATEGORIZED,
  updated_at: '2026-09-25T10:00:00.000Z',
  ...over
})

describe('groupProjectsByCategory', () => {
  it('空列表返回空树', () => {
    expect(groupProjectsByCategory([], ['科技数码', UNCATEGORIZED])).toEqual([])
  })

  it('按传入分类序分组，组内按 updated_at 倒序', () => {
    const groups = groupProjectsByCategory(
      [
        proj({ name: '旧', category: '科技数码', updated_at: '2026-09-20T10:00:00.000Z' }),
        proj({ name: '新', category: '科技数码', updated_at: '2026-09-25T10:00:00.000Z' }),
        proj({ name: '随笔', category: UNCATEGORIZED })
      ],
      ['科技数码', UNCATEGORIZED]
    )
    expect(groups).toEqual([
      {
        category: '科技数码',
        projects: [
          proj({ name: '新', category: '科技数码', updated_at: '2026-09-25T10:00:00.000Z' }),
          proj({ name: '旧', category: '科技数码', updated_at: '2026-09-20T10:00:00.000Z' })
        ]
      },
      { category: UNCATEGORIZED, projects: [proj({ name: '随笔', category: UNCATEGORIZED })] }
    ])
  })

  it('category 缺省视为未分类', () => {
    const groups = groupProjectsByCategory([proj({ category: undefined })], [UNCATEGORIZED])
    expect(groups).toEqual([{ category: UNCATEGORIZED, projects: [proj({ category: undefined })] }])
  })

  it('空分类不出现在树上，有工程的分类才出现', () => {
    const groups = groupProjectsByCategory(
      [proj({ name: 'A', category: '科技数码' })],
      ['科技数码', '设计鉴赏', UNCATEGORIZED]
    )
    expect(groups.map((g) => g.category)).toEqual(['科技数码'])
  })

  it('列表外分类（隐藏分类残留工程、任意 meta 值）兜底排在末尾', () => {
    const groups = groupProjectsByCategory(
      [
        proj({ name: '遗留', category: '已隐藏分类' }),
        proj({ name: '常规', category: '科技数码' }),
        proj({ name: '野值', category: '奇怪分类' })
      ],
      ['科技数码', UNCATEGORIZED]
    )
    expect(groups.map((g) => g.category)).toEqual(['科技数码', '已隐藏分类', '奇怪分类'])
    expect(groups[1].projects.map((p) => p.name)).toEqual(['遗留'])
  })

  it('同一分类下重名工程不合并（重名由主进程立项去重保证，这里原样保留）', () => {
    const list = [proj({ name: '同名' }), proj({ name: '同名' })]
    const groups = groupProjectsByCategory(list, [UNCATEGORIZED])
    expect(groups[0].projects).toHaveLength(2)
  })

  it('置顶工程在组内浮到最前，置顶之间保持 updated_at 倒序，未置顶不受影响', () => {
    const groups = groupProjectsByCategory(
      [
        proj({ name: '新', category: '科技数码', updated_at: '2026-09-25T10:00:00.000Z' }),
        proj({ name: '旧', category: '科技数码', updated_at: '2026-09-20T10:00:00.000Z' }),
        proj({ name: '更旧', category: '科技数码', updated_at: '2026-09-10T10:00:00.000Z' })
      ],
      ['科技数码'],
      ['更旧', '旧']
    )
    expect(groups[0].projects.map((p) => p.name)).toEqual(['旧', '更旧', '新'])
  })

  it('pinned 里的未知名字不影响排序', () => {
    const groups = groupProjectsByCategory(
      [proj({ name: 'A', category: '科技数码' }), proj({ name: 'B', category: '科技数码', updated_at: '2026-09-01T00:00:00.000Z' })],
      ['科技数码'],
      ['不存在的工程']
    )
    expect(groups[0].projects.map((p) => p.name)).toEqual(['A', 'B'])
  })
})
