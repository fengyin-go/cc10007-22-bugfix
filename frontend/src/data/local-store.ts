import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'data-layer-studio:entries'
// 结构版本：种子结构（含区间凭证、归属字段）升级时递增，旧版本整体替换而不是浅合并，
// 否则旧模块缺失、字段改名时会出现「列表残留旧对象、详情值对不上」的双口径数据。
const SCHEMA_VERSION_KEY = 'data-layer-studio:schema-version'
const SCHEMA_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedAll(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function writeStorage(data: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    window.localStorage.setItem(SCHEMA_VERSION_KEY, String(SCHEMA_VERSION))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedAll()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    writeStorage(fallback)
    return fallback
  }
  const storedVersion = Number(window.localStorage.getItem(SCHEMA_VERSION_KEY) ?? '1')
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    if (storedVersion < SCHEMA_VERSION) {
      // 结构升级：旧数据整体作废，重新播种，杜绝半新半旧的残留对象。
      writeStorage(fallback)
      return fallback
    }
    // 同版本仍以种子为骨架做模块级补齐：新增模块可直接出现，且不覆盖已有模块数据。
    return { ...fallback, ...parsed }
  } catch {
    writeStorage(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.localStorage.setItem(SCHEMA_VERSION_KEY, String(SCHEMA_VERSION))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 测试专用：清掉内存缓存，下一次读取强制重新播种/读存储。 */
export function __resetStoreCacheForTest(): void {
  cache = null
}
