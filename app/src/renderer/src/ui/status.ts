import type { ProjectStatus } from '@shared/types'
import type { DotStatus } from './primitives'

/**
 * 工程状态 → 圆点语义单源（UI/UX PRD §3.1 约束）：
 * 黄=草稿、蓝=进行中、绿=已成稿/已发布。工作树、封面墙、看板、日历必须共用这张表，
 * 不得在各自组件里另起颜色；选题中/审阅中同属「进行中」，靠文字/图标区分而非另设色。
 */
export const PROJECT_DOT: Record<ProjectStatus, DotStatus> = {
  ideating: 'doing',
  drafting: 'draft',
  reviewing: 'doing',
  ready: 'done'
}

export const PROJECT_STATUS_TEXT: Record<ProjectStatus, string> = {
  ideating: '选题中',
  drafting: '草稿',
  reviewing: '审阅中',
  ready: '已成稿'
}

/** 取工程状态对应的圆点语义（未知状态回落灰点，不猜色） */
export function dotOfStatus(status: ProjectStatus | string | undefined): DotStatus {
  return PROJECT_DOT[status as ProjectStatus] ?? 'draft'
}
