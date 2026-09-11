/**
 * 选题状态推导测试。看板的说服力全靠这里准不准——把假阳性与假阴性都钉住：
 * 前缀式的宽松匹配会把「iPhone」认到「iPhone 15 评测」上，所以名字一律按立项规则精确复算。
 */
import { describe, expect, it } from 'vitest'
import { ideaStageOf } from '../ideaStage'
import type { IdeaEntry, IdeaProjectRef } from '../types'

const idea = (over: Partial<IdeaEntry> = {}): IdeaEntry => ({
  index: 0,
  title: '手机信号栏的小字',
  angle: '从显示规则切入',
  audience: '泛科技读者',
  score: 8,
  reason: '冷门角度',
  ...over
})

const proj = (over: Partial<IdeaProjectRef> = {}): IdeaProjectRef => ({
  name: '手机信号栏的小字',
  status: 'ideating',
  ...over
})

describe('选题状态推导', () => {
  it('没有对应工程 → 待立项', () => {
    expect(ideaStageOf(idea(), [])).toEqual({ stage: 'idle' })
    expect(ideaStageOf(idea(), [proj({ name: '别的工程' })])).toEqual({ stage: 'idle' })
  })

  it('按工程名精确命中，无排期 → 已立项', () => {
    const info = ideaStageOf(idea(), [proj()])
    expect(info.stage).toBe('projected')
    expect(info.project).toBe('手机信号栏的小字')
  })

  it('有排期且工程仍在写 → 已排期（并带出分类与日期）', () => {
    const info = ideaStageOf(idea(), [proj({ plannedAt: '2026-09-12', category: '科技数码' })])
    expect(info).toEqual({
      stage: 'scheduled',
      project: '手机信号栏的小字',
      category: '科技数码',
      plannedAt: '2026-09-12'
    })
  })

  it('工程已进审阅或可发布 → 已成稿（优先于排期）', () => {
    expect(ideaStageOf(idea(), [proj({ status: 'reviewing', plannedAt: '2026-09-12' })]).stage).toBe('ready')
    expect(ideaStageOf(idea(), [proj({ status: 'ready' })]).stage).toBe('ready')
  })

  it('topic 全等命中：工程名被改过也能认出来', () => {
    const renamed = proj({ name: '临时工程名-已改名', plannedAt: '2026-10-01', topicAngle: idea().angle, topicAudience: idea().audience })
    expect(ideaStageOf(idea(), [renamed]).project).toBe('临时工程名-已改名')
  })

  it('topic 只对上一半不算命中（避免角度相同就误认）', () => {
    const half = proj({ name: '别的工程', topicAngle: idea().angle, topicAudience: '另一个读者群' })
    expect(ideaStageOf(idea(), [half]).stage).toBe('idle')
  })

  it('同名去重的立项名也算命中：<标题> MMDD', () => {
    const deduped = proj({ name: '手机信号栏的小字 0912', plannedAt: '2026-09-12' })
    expect(ideaStageOf(idea(), [deduped]).stage).toBe('scheduled')
  })

  it('去重后缀必须与排期日期一致，否则不算命中', () => {
    const mismatch = proj({ name: '手机信号栏的小字 0912', plannedAt: '2026-10-01' })
    expect(ideaStageOf(idea(), [mismatch]).stage).toBe('idle')
  })

  it('不用前缀宽松匹配：标题「iPhone」不会认领「iPhone 15 评测」', () => {
    const other = proj({ name: 'iPhone 15 评测' })
    expect(ideaStageOf(idea({ title: 'iPhone' }), [other]).stage).toBe('idle')
    // 但精确同名仍然命中
    expect(ideaStageOf(idea({ title: 'iPhone' }), [proj({ name: 'iPhone' })]).stage).toBe('projected')
  })

  it('标题清洗后为空时不乱认工程', () => {
    expect(ideaStageOf(idea({ title: '///' }), [proj({ name: '' })]).stage).toBe('idle')
  })

  it('topic 命中优先于名字命中（同名工程存在时以机器写的关联为准）', () => {
    const projects = [
      proj({ name: '手机信号栏的小字', status: 'ideating' }),
      proj({ name: '另一个名字', status: 'ready', topicAngle: idea().angle, topicAudience: idea().audience })
    ]
    expect(ideaStageOf(idea(), projects).project).toBe('另一个名字')
  })

  it('长标题截断后仍能与去重名对上（清洗规则含 30 字截断）', () => {
    const long = '前华为大佬创业一个月估值一亿美金这件事到底说明了什么以及我们该关注什么'
    const base = long.slice(0, 30)
    expect(ideaStageOf(idea({ title: long }), [proj({ name: base })]).stage).toBe('projected')
  })
})
