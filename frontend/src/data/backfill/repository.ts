/**
 * 历史补数仓储：区间凭证的唯一读写闸口。
 *
 * 列表页、详情页、监控、概览都只能从这里取补数数据；写动作也只在这一层落盘，
 * 从根上消除「列表残留旧对象、详情又是另一套值」的双口径问题。
 */
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import {
  applyBackfillAction,
  createVoucher,
  deriveWatermark,
  formatVoidIntervals,
  resolveStatus,
} from './domain'
import type { BackfillActionResult, BackfillEventType, IntervalVoucher } from './types.ts'

export const BACKFILL_MODULE_KEY = 'backfill'

function isVoucher(value: unknown): value is IntervalVoucher {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as IntervalVoucher).shards) &&
    Array.isArray((value as IntervalVoucher).events)
  )
}

/**
 * 旧对象迁移：历史数据里没有凭证（或凭证结构残缺）时，按行上的开始/结束日期补建凭证。
 * 迁移只发生在读取路径，且每次读都校验，保证列表与详情拿到的永远是同一张凭证。
 */
function migrateRow(row: EntryRow): EntryRow {
  if (isVoucher(row.voucher)) {
    return row
  }
  const from = String(row['开始日期'] ?? '')
  const to = String(row['结束日期'] ?? from)
  const voucher = createVoucher(from, to)
  return { ...row, voucher }
}

/** 读取全部补数行，并把行上的展示字段统一改成从区间凭证派生。 */
export function listBackfillRows(): EntryRow[] {
  const migrated = listRows(BACKFILL_MODULE_KEY).map(migrateRow)
  return migrated.map(projectRow)
}

export function getBackfillRow(id: number): EntryRow | null {
  return listBackfillRows().find((row) => Number(row.id) === id) ?? null
}

/**
 * 凭证 → 展示行投影：状态、水位、失败区间、待处理/异常标记全部派生自凭证。
 * 任何页面都不允许再自行解释 status，MONI 等模块误读完成印的问题由此堵死。
 */
export function projectRow(row: EntryRow): EntryRow {
  const voucher = row.voucher as IntervalVoucher
  const status = resolveStatus(voucher, String(row.status))
  const voidText = formatVoidIntervals(voucher)
  return {
    ...row,
    status,
    pending: status !== '已完成' && status !== '已失败',
    abnormal: status === '已失败',
    '完成水位': voucher.completionWatermark ?? deriveWatermark(voucher.shards) ?? '',
    '失败区间': voidText,
  }
}

/** 整笔落盘：领域层演算成功后才写存储，任一失败由调用方保持原凭证不动。 */
function commitRows(rows: EntryRow[]): void {
  saveRows(BACKFILL_MODULE_KEY, rows)
}

export type BackfillCommand = {
  action: BackfillEventType
  voidDates?: string[]
  voidReason?: string
}

/**
 * 执行补数动作并整笔提交。
 * 归属校验在 service 层完成；这里只负责凭证演算与同笔落盘。
 */
export function commitBackfillAction(id: number, command: BackfillCommand): BackfillActionResult {
  const rows = listRows(BACKFILL_MODULE_KEY).map(migrateRow)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的补数任务` }
  }
  const current = rows[index]
  const voucher = current.voucher as IntervalVoucher
  const { voucher: nextVoucher, result } = applyBackfillAction(voucher, command.action, {
    voidDates: command.voidDates,
    voidReason: command.voidReason,
  })
  if (!result.ok) {
    // 整笔退回：不写存储。注意归档被闸口拒绝时领域层累计了拒绝次数，
    // 该计数仅用于内存解释，不落盘，保证退回后凭证字节级不变。
    return result
  }
  const nextRow = projectRow({ ...current, voucher: nextVoucher })
  const nextRows = [...rows]
  nextRows[index] = nextRow
  commitRows(nextRows)
  return result
}
