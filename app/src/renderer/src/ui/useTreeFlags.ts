import { useCallback, useEffect, useState } from 'react'

/**
 * 置顶 / 归档名单单源（渲染层本地偏好，不入 project.json，避开 readMeta 白名单坑）。
 * 左栏工作树与工程封面墙共用同一份数据：任一侧改动即写盘并广播，另一侧即时跟上，
 * 不出现「墙上看是未归档、树里已归档」两套事实。
 */
const KEY_PIN = 'lig-tree-pinned'
const KEY_ARCH = 'lig-tree-archived'
const EVT = 'lig-tree-flags-changed'

function read(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export interface TreeFlags {
  pinned: string[]
  archived: string[]
  setPinned: (updater: string[] | ((prev: string[]) => string[])) => void
  setArchived: (updater: string[] | ((prev: string[]) => string[])) => void
  togglePin: (name: string) => void
  toggleArchive: (name: string) => void
  /** 顺手清掉盘上已不存在的项（工程被删/改名后不留幽灵名） */
  pruneTo: (liveNames: string[]) => void
}

export function useTreeFlags(): TreeFlags {
  const [pinned, setPinned] = useState<string[]>(() => read(KEY_PIN))
  const [archived, setArchived] = useState<string[]>(() => read(KEY_ARCH))

  // 改动 → 写盘 + 广播（值没变就不写不广播，避免订阅侧回环）
  useEffect(() => {
    const next = JSON.stringify(pinned)
    if (localStorage.getItem(KEY_PIN) !== next) {
      localStorage.setItem(KEY_PIN, next)
      window.dispatchEvent(new Event(EVT))
    }
  }, [pinned])
  useEffect(() => {
    const next = JSON.stringify(archived)
    if (localStorage.getItem(KEY_ARCH) !== next) {
      localStorage.setItem(KEY_ARCH, next)
      window.dispatchEvent(new Event(EVT))
    }
  }, [archived])

  useEffect(() => {
    const on = (): void => {
      const p = read(KEY_PIN)
      const a = read(KEY_ARCH)
      setPinned((prev) => (JSON.stringify(prev) === JSON.stringify(p) ? prev : p))
      setArchived((prev) => (JSON.stringify(prev) === JSON.stringify(a) ? prev : a))
    }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [])

  const togglePin = useCallback((name: string) => {
    setPinned((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [name, ...prev]))
  }, [])
  const toggleArchive = useCallback((name: string) => {
    setArchived((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }, [])
  const pruneTo = useCallback((liveNames: string[]) => {
    const s = new Set(liveNames)
    setPinned((prev) => (prev.some((n) => !s.has(n)) ? prev.filter((n) => s.has(n)) : prev))
    setArchived((prev) => (prev.some((n) => !s.has(n)) ? prev.filter((n) => s.has(n)) : prev))
  }, [])

  return { pinned, archived, setPinned, setArchived, togglePin, toggleArchive, pruneTo }
}
