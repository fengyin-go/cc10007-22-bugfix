/**
 * 仓储 + 服务层集成测试：用 localStorage 桩与 Pinia 验证完整链路。
 * 运行：node --test src/data/backfill/repository.test.ts
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

// 最小 localStorage 桩：local-store 只用到 getItem / setItem。
const memory = new Map<string, string>()
const localStorageStub: Storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
}
globalThis.localStorage = localStorageStub
// local-store 以 window.localStorage 是否存在选择持久化分支，Node 下需要补 window 桩。
globalThis.window = { localStorage: localStorageStub } as unknown as Window & typeof globalThis

import { useSessionStore } from '@/stores/session'
import { listBackfillRows, getBackfillRow, commitBackfillAction } from './repository.ts'
import { checkRowAccess, loadBackfillMonitorView, runAction } from '@/api/local-service'
import { verifySeal } from './domain.ts'
import type { IntervalVoucher } from './types.ts'
import { GROUPS } from './access.ts'
import { __resetStoreCacheForTest } from '@/data/local-store'

beforeEach(() => {
  memory.clear()
  __resetStoreCacheForTest()
  setActivePinia(createPinia())
})

test('种子数据：BACK-0001 终止后只有已失败印章且保留空洞，BACK-0002 有完成印', () => {
  const rows = listBackfillRows()
  const back1 = rows.find((row) => row['任务编号'] === 'BACK-0001')!
  const voucher1 = back1.voucher as IntervalVoucher
  assert.equal(back1.status, '已失败')
  assert.equal(voucher1.archiveSeal, null)
  assert.equal(voucher1.voidCount, 3)
  assert.deepEqual(voucher1.voidIntervals, [{ from: '2026-09-03', to: '2026-09-05' }])
  assert.equal(back1['失败区间'], '2026-09-03~2026-09-05')
  assert.equal(back1.abnormal, true)
  assert.equal(back1.pending, false)

  const back2 = rows.find((row) => row['任务编号'] === 'BACK-0002')!
  assert.equal(back2.status, '已完成')
  assert.equal((back2.voucher as IntervalVoucher).archiveSeal !== null, true)
  assert.equal(verifySeal(back2.voucher as IntervalVoucher).ok, true)
})

test('归档闸口：失败计划归档整笔退回，业务数据原样不动', () => {
  listBackfillRows() // 先触发播种落盘
  const before = JSON.parse(localStorage.getItem('data-layer-studio:entries')!)
  const result = commitBackfillAction(1, { action: '归档结果' })
  assert.equal(result.ok, false)
  assert.match(result.message, /失败计划不得获得完成印/)
  // 整笔退回：补数模块的业务数据与退回前完全一致，没有任何签章/水位写入。
  const after = JSON.parse(localStorage.getItem('data-layer-studio:entries')!)
  assert.deepEqual(after.backfill, before.backfill)
  const row = getBackfillRow(1)!
  assert.equal(row.status, '已失败')
  assert.equal((row.voucher as IntervalVoucher).archiveSeal, null)
})

test('跨组越权写被拒绝；切回本组后终止/归档按凭证规则执行', () => {
  const session = useSessionStore()
  // BACK-0003 归属交易数据组，当前默认平台数仓组。
  session.setGroup(GROUPS[0])
  const denied = runAction('backfill', 3, '终止任务')
  assert.equal(denied.ok, false)
  assert.match(denied.message, /跨组越权拒绝/)

  const row = getBackfillRow(3)!
  const access = checkRowAccess(row, true)
  assert.equal(access.allowed, false)
  assert.equal(access.readonly, true)

  session.setGroup(GROUPS[1])
  const allowed = checkRowAccess(getBackfillRow(3)!, true)
  assert.equal(allowed.allowed, true)
})

test('共享记录对任何组只读', () => {
  const session = useSessionStore()
  for (const group of GROUPS) {
    session.setGroup(group)
    const result = runAction('backfill', 4, '启动任务')
    assert.equal(result.ok, false)
    assert.match(result.message, /共享记录/)
  }
})

test('运行中计划成功归档：完成印落盘且重复归档不推水位', () => {
  const session = useSessionStore()
  session.setGroup(GROUPS[1])
  // BACK-0003 还有两个待签收分片，先启动完成签收，再归档。
  const start = commitBackfillAction(3, { action: '启动任务' })
  assert.equal(start.ok, true)
  const seal = commitBackfillAction(3, { action: '归档结果' })
  assert.equal(seal.ok, true)
  const row = getBackfillRow(3)!
  const voucher = row.voucher as IntervalVoucher
  assert.equal(row.status, '已完成')
  assert.equal(voucher.completionWatermark, '2026-09-06')
  assert.equal(voucher.archiveSeal !== null, true)

  const watermark = voucher.completionWatermark
  const again = commitBackfillAction(3, { action: '归档结果' })
  assert.equal(again.ok, false)
  assert.match(again.message, /重复归档/)
  assert.equal((getBackfillRow(3)!.voucher as IntervalVoucher).completionWatermark, watermark)
})

test('列表、详情、监控、概览读取同一张凭证，口径完全一致', () => {
  const list = listBackfillRows()
  const monitor = loadBackfillMonitorView()
  for (const row of list) {
    const detail = getBackfillRow(Number(row.id))!
    const monitorItem = monitor.find((item) => item.id === Number(row.id))!
    const voucher = row.voucher as IntervalVoucher
    assert.equal(detail.status, row.status)
    assert.equal(detail['完成水位'], row['完成水位'])
    assert.equal(monitorItem.status, row.status)
    assert.equal(monitorItem.watermark, voucher.completionWatermark ?? '')
    assert.equal(monitorItem.voidIntervals, row['失败区间'])
    assert.equal(monitorItem.sealed, voucher.archiveSeal !== null)
  }
})

test('旧对象迁移：缺失凭证的行会按日期补建，不残留双口径', () => {
  // 先触发播种，再手动写入一条没有 voucher 的旧结构行。
  listBackfillRows()
  const raw = JSON.parse(localStorage.getItem('data-layer-studio:entries')!)
  raw.backfill.push({
    id: 99,
    status: '草稿',
    pending: true,
    abnormal: false,
    '任务编号': 'BACK-0099',
    '目标表名': 'legacy_table',
    '开始日期': '2026-10-01',
    '结束日期': '2026-10-02',
    ownerGroup: GROUPS[0],
    ownership: '本组',
  })
  localStorage.setItem('data-layer-studio:entries', JSON.stringify(raw))
  __resetStoreCacheForTest()

  const migrated = getBackfillRow(99)!
  const voucher = migrated.voucher as IntervalVoucher
  assert.equal(voucher.shards.length, 2)
  assert.equal(voucher.receivedCount, 0)
  // 无任何签收，归档必须被闸口拒绝。
  const attempt = commitBackfillAction(99, { action: '归档结果' })
  assert.equal(attempt.ok, false)
  assert.match(attempt.message, /没有签收任何分片/)
})
