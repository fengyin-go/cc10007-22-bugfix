import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import { checkAccess } from '@/data/backfill/access'
import {
  BACKFILL_MODULE_KEY,
  commitBackfillAction,
  listBackfillRows,
} from '@/data/backfill/repository'
import { formatVoidIntervals, resolveStatus, verifySeal } from '@/data/backfill/domain'
import type { BackfillEventType, IntervalVoucher } from '@/data/backfill/types'
import { useSessionStore } from '@/stores/session'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 历史补数动作改由区间凭证域处理，通用状态机不再直接把「归档」映射成「已完成」。
const BACKFILL_ACTIONS: BackfillEventType[] = ['提交执行', '启动任务', '终止任务', '归档结果']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  // 历史补数只走凭证仓储：列表与详情同口径，不允许读到未投影的旧对象。
  const source = key === BACKFILL_MODULE_KEY ? listBackfillRows() : listRows(key)
  const matched = filterRows(source, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 归属权限裁决：跨组越权拒绝写操作，共享记录只读。 */
export function checkRowAccess(row: EntryRow, wantWrite: boolean): ReturnType<typeof checkAccess> {
  const session = useSessionStore()
  return checkAccess(
    {
      ownerGroup: String(row.ownerGroup ?? session.group),
      ownership: row.ownership === '共享' ? '共享' : '本组',
    },
    session.group,
    wantWrite,
  )
}

function runBackfillAction(id: number, action: string): ActionResult {
  if (!BACKFILL_ACTIONS.includes(action as BackfillEventType)) {
    return { ok: false, message: `补数任务没有登记「${action}」这个动作` }
  }
  const row = listBackfillRows().find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的补数任务` }
  }
  const access = checkRowAccess(row, true)
  if (!access.allowed) {
    return { ok: false, message: access.reason }
  }
  const result = commitBackfillAction(id, { action: action as BackfillEventType })
  return { ok: result.ok, message: result.message }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === BACKFILL_MODULE_KEY) {
    return runBackfillAction(id, action)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const rows = listEntries(key).items
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/**
 * 监控读取口径：任务监控页的补数部分直接解释区间凭证，
 * 只认真正的完成印（archiveSeal），失败计划的空洞区间原样透出，MONI 不再误读成功。
 */
export function loadBackfillMonitorView() {
  return listBackfillRows().map((row) => {
    const voucher = row.voucher as IntervalVoucher
    const sealCheck = verifySeal(voucher)
    return {
      id: row.id,
      taskCode: String(row['任务编号'] ?? ''),
      targetTable: String(row['目标表名'] ?? ''),
      status: resolveStatus(voucher, String(row.status)),
      watermark: voucher.completionWatermark ?? '',
      voidIntervals: formatVoidIntervals(voucher),
      receivedCount: voucher.receivedCount,
      voidCount: voucher.voidCount,
      sealed: voucher.archiveSeal !== null,
      sealedAt: voucher.archiveSeal?.sealedAt ?? '',
      rejections: voucher.archiveRejections,
      sealCheck: sealCheck.ok,
      sealMessage: sealCheck.message,
      ownerGroup: String(row.ownerGroup ?? ''),
      ownership: String(row.ownership ?? '本组'),
    }
  })
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    // 历史补数的待处理/异常量以区间凭证派生的投影为准。
    const entries = meta.key === BACKFILL_MODULE_KEY ? listBackfillRows() : rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
