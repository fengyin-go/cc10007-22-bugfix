/**
 * 本组归属控制（纯逻辑，不依赖 Vue / localStorage）。
 *
 * 规则：
 * - 本组归属记录：归属组与当前操作组一致才可写，跨组访问只读；
 * - 共享记录：所有组都可见，但对所有人只读；
 * - 跨组越权的写动作直接拒绝，并给出明确原因，不允许降级成静默失败。
 */
import type { OwnershipMode } from '@/data/backfill/types'

export type OwnedRecord = {
  ownerGroup: string
  ownership: OwnershipMode
}

export type AccessResult = {
  allowed: boolean
  /** readonly 时页面仍可渲染列表与详情，只是动作按钮不可用 */
  readonly: boolean
  reason: string
}

/** 组清单：值班会话可在组之间切换，用于演示跨组越权被拒绝。 */
export const GROUPS = ['平台数仓组', '交易数据组', '风控数据组'] as const

export function checkAccess(record: OwnedRecord, currentGroup: string, wantWrite: boolean): AccessResult {
  if (record.ownership === '共享') {
    return wantWrite
      ? { allowed: false, readonly: true, reason: '共享记录对所有组只读，写操作被拒绝' }
      : { allowed: true, readonly: true, reason: '共享记录（只读）' }
  }
  if (record.ownerGroup === currentGroup) {
    return wantWrite
      ? { allowed: true, readonly: false, reason: '本组记录，可读写' }
      : { allowed: true, readonly: false, reason: '本组记录' }
  }
  return wantWrite
    ? {
        allowed: false,
        readonly: true,
        reason: `跨组越权拒绝：记录归属「${record.ownerGroup}」，当前操作组为「${currentGroup}」`,
      }
    : { allowed: true, readonly: true, reason: `他组记录（归属${record.ownerGroup}，只读）` }
}
