import { sanitizeProjectName } from './projectName'
import type { IdeaEntry, IdeaProjectRef, IdeaStage, IdeaStageInfo } from './types'

/**
 * 选题状态推导（选题库泳道看板的依据）。
 *
 * 选题在库文件里没有状态字段，也不该有——它是否被用起来，是工程现实的结果而不是一条要手工维护的标记。
 * 因此状态一律现算：有没有对应工程、该工程排期没有、写到什么程度。
 */

export interface IdeaStageMeta {
  id: IdeaStage
  label: string
  hint: string
}

/** 泳道顺序即流转顺序：左到右 */
export const IDEA_STAGES: IdeaStageMeta[] = [
  { id: 'idle', label: '待立项', hint: '还没有对应的工程' },
  { id: 'projected', label: '已立项', hint: '工程已建，尚未排期' },
  { id: 'scheduled', label: '已排期', hint: '已定发布日，仍在写' },
  { id: 'ready', label: '已成稿', hint: '工程已进入审阅或可发布' }
]

/**
 * 选题 → 状态。
 * 命中工程的顺序：
 * 1. `topic.angle + topic.audience` 全等——日历上「拖选题到日期」立项时由机器写下的，是权威关联
 * 2. 工程名精确等于按立项规则复算出的候选名（脑暴立项只设名字，没有 topic）
 * 两条都不命中即待立项。
 */
export function ideaStageOf(idea: IdeaEntry, projects: IdeaProjectRef[]): IdeaStageInfo {
  const byTopic = idea.angle
    ? projects.find((p) => p.topicAngle === idea.angle && p.topicAudience === idea.audience)
    : undefined
  const base = sanitizeProjectName(idea.title)
  const byName = base ? projects.find((p) => p.name === base || p.name === dedupeName(base, p.plannedAt)) : undefined
  const hit = byTopic ?? byName
  if (!hit) return { stage: 'idle' }
  return {
    stage: hit.status === 'reviewing' || hit.status === 'ready' ? 'ready' : hit.plannedAt ? 'scheduled' : 'projected',
    project: hit.name,
    category: hit.category,
    plannedAt: hit.plannedAt
  }
}

/**
 * 同名去重时立项用的名字：`sanitizeProjectName(`${base} MMDD`)`，MMDD 取自排期日期。
 * 这里**复算**而不是用「以 base 开头」的前缀猜：前缀匹配会把标题为「iPhone」的选题
 * 认到叫「iPhone 15 评测」的工程上，看板就会显示假状态。
 */
function dedupeName(base: string, plannedAt?: string): string {
  if (!plannedAt) return ''
  return sanitizeProjectName(`${base} ${plannedAt.slice(5).replace('-', '')}`)
}
