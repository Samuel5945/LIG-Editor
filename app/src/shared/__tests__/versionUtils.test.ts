import { describe, it, expect } from 'vitest'
import { compareVersions, extractUrl } from '../versionUtils'

describe('compareVersions', () => {
  it('逐段比较数字大小', () => {
    expect(compareVersions('0.6.1', '0.6.0')).toBe(1)
    expect(compareVersions('0.6.0', '0.6.1')).toBe(-1)
    expect(compareVersions('0.6.0', '0.6.0')).toBe(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
  })

  it('兼容 v 前缀与段数不齐', () => {
    expect(compareVersions('v0.6.0', '0.6.0')).toBe(0)
    expect(compareVersions('V1.0', '0.99.9')).toBe(1)
    expect(compareVersions('0.7', '0.6.5')).toBe(1)
  })

  it('脏版本号不抛错（非数字段按 0）', () => {
    expect(compareVersions('0.6.0-beta', '0.6.0')).toBe(0)
    expect(compareVersions('abc', '0.0.1')).toBe(-1)
  })
})

describe('extractUrl', () => {
  const quark = /pan\.quark\.cn\//
  const baidu = /pan\.baidu\.com\//

  it('裸链接直接提取', () => {
    expect(extractUrl('下载：https://pan.quark.cn/s/1cb400aa407b', quark)).toBe('https://pan.quark.cn/s/1cb400aa407b')
  })

  it('markdown 链接截掉闭合括号', () => {
    expect(extractUrl('[夸克网盘](https://pan.quark.cn/s/abc123)', quark)).toBe('https://pan.quark.cn/s/abc123')
  })

  it('百度链接保留 ?pwd= 提取码参数', () => {
    expect(extractUrl('百度网盘 https://pan.baidu.com/s/1abc?pwd=35c8 请自取', baidu)).toBe(
      'https://pan.baidu.com/s/1abc?pwd=35c8'
    )
  })

  it('域名不符或无链接返回 undefined', () => {
    expect(extractUrl('没有链接', quark)).toBeUndefined()
    expect(extractUrl('https://example.com/file', baidu)).toBeUndefined()
  })

  it('句尾标点不粘在链接上', () => {
    expect(extractUrl('https://pan.quark.cn/s/xyz。', quark)).toBe('https://pan.quark.cn/s/xyz')
  })
})
