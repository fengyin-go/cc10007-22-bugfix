/**
 * 区间凭证领域规则测试：纯 node:test，不依赖浏览器与 Vue。
 * 运行：node --test frontend/src/data/backfill/domain.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyBackfillAction,
  buildVoidIntervals,
  canSealCompletion,
  createVoucher,
  deriveWatermark,
  enumerateDates,
  formatVoidIntervals,
  resolveStatus,
  signShard,
  verifySeal,
  voidShard,
} from './domain.ts'
import { BACKFILL_STATUS } from './types.ts'
import type { IntervalVoucher } from './types.ts'

function run(voucher: IntervalVoucher, action: Parameters<typeof applyBackfillAction>[1], options = {}) {
  return applyBackfillAction(voucher, action, { at: '2026-09-10T00:00:00.000Z', ...options })
}

test('日期枚举与空洞区间压缩', () => {
  assert.deepEqual(enumerateDates('2026-09-01', '2026-09-03'), ['2026-09-01', '2026-09-02', '2026-09-03'])
  assert.deepEqual(enumerateDates('2026-09-03', '2026-09-01'), [])
  let voucher = createVoucher('2026-09-01', '2026-09-05')
  voucher = voidShard(voucher, '2026-09-02', 'x')
  voucher = voidShard(voucher, '2026-09-03', 'x')
  voucher = voidShard(voucher, '2026-09-05', 'x')
  assert.deepEqual(buildVoidIntervals(voucher.shards), [
    { from: '2026-09-02', to: '2026-09-03' },
    { from: '2026-09-05', to: '2026-09-05' },
  ])
  assert.equal(formatVoidIntervals(voucher), '2026-09-02~2026-09-03、2026-09-05')
})

test('BACK-0001 场景：终止后只能是已失败，且保留空洞区间，没有完成印', () => {
  let voucher = createVoucher('2026-09-01', '2026-09-05')
  voucher = run(voucher, '提交执行').voucher
  voucher = run(voucher, '启动任务').voucher
  // 只签收前两天，模拟运行中断。
  voucher = {
    ...voucher,
    shards: voucher.shards.map((shard, index) =>
      index >= 2 ? { ...shard, state: '待签收' as const, signedAt: null } : shard,
    ),
  }
  const terminated = run(voucher, '终止任务', { voidReason: '中断' })
  assert.equal(terminated.result.ok, true)
  voucher = terminated.voucher
  assert.equal(resolveStatus(voucher, ''), BACKFILL_STATUS.failed)
  assert.equal(voucher.archiveSeal, null)
  assert.equal(voucher.voidCount, 3)
  assert.deepEqual(voucher.voidIntervals, [{ from: '2026-09-03', to: '2026-09-05' }])
  assert.equal(voucher.receivedCount, 2)
  // 失败计划尝试归档：必须被闸口拒绝，且不得出现完成印/已完成。
  const archiveAttempt = run(voucher, '归档结果')
  assert.equal(archiveAttempt.result.ok, false)
  assert.match(archiveAttempt.result.message, /失败计划不得获得完成印/)
  assert.equal(archiveAttempt.voucher.archiveSeal, null)
  assert.equal(resolveStatus(archiveAttempt.voucher, ''), BACKFILL_STATUS.failed)
  assert.equal(archiveAttempt.voucher.archiveRejections, 1)
})

test('没有签收任何分片的计划不能获得完成印（草稿直接归档被拒）', () => {
  let voucher = createVoucher('2026-09-01', '2026-09-02')
  const attempt = run(voucher, '归档结果')
  assert.equal(attempt.result.ok, false)
  assert.match(attempt.result.message, /没有签收任何分片/)
  assert.equal(attempt.voucher.archiveSeal, null)
  assert.equal(canSealCompletion(voucher), false)
})

test('正常归档：水位、空洞、签章同笔成功，重复归档不再推水位', () => {
  let voucher = createVoucher('2026-09-01', '2026-09-03')
  voucher = run(voucher, '提交执行').voucher
  voucher = run(voucher, '启动任务').voucher
  const watermarkBefore = voucher.completionWatermark
  const sealed = run(voucher, '归档结果')
  assert.equal(sealed.result.ok, true)
  voucher = sealed.voucher
  assert.equal(voucher.archiveSeal !== null, true)
  assert.equal(voucher.completionWatermark, '2026-09-03')
  assert.equal(resolveStatus(voucher, ''), BACKFILL_STATUS.completed)
  assert.deepEqual(verifySeal(voucher), { ok: true, message: '签章指纹核对一致，区间凭证未被篡改' })
  // 重复归档：拒绝且水位不变。
  const again = run(voucher, '归档结果')
  assert.equal(again.result.ok, false)
  assert.match(again.result.message, /重复归档不再推水位/)
  assert.equal(again.voucher.completionWatermark, watermarkBefore ?? '2026-09-03')
  assert.equal(again.voucher.archiveSeal?.sealedAt, voucher.archiveSeal?.sealedAt)
})

test('终止与归档交叉：唯一序号决定终态（后到者赢），无双印章', () => {
  // 场景 A：先归档后终止 → 终止被拒，保持已完成。
  let a = createVoucher('2026-09-01', '2026-09-02')
  a = run(a, '提交执行').voucher
  a = run(a, '启动任务').voucher
  a = run(a, '归档结果').voucher
  const lateTerminate = run(a, '终止任务')
  assert.equal(lateTerminate.result.ok, false)
  assert.equal(resolveStatus(lateTerminate.voucher, ''), BACKFILL_STATUS.completed)

  // 场景 B：先终止（有空洞）后归档 → 归档被拒，保持已失败且空洞保留。
  let b = createVoucher('2026-09-01', '2026-09-03')
  b = run(b, '提交执行').voucher
  b = run(b, '启动任务').voucher
  b = {
    ...b,
    shards: b.shards.map((shard, index) =>
      index >= 1 ? { ...shard, state: '待签收' as const, signedAt: null } : shard,
    ),
  }
  b = run(b, '终止任务').voucher
  const lateArchive = run(b, '归档结果')
  assert.equal(lateArchive.result.ok, false)
  assert.equal(resolveStatus(lateArchive.voucher, ''), BACKFILL_STATUS.failed)
  assert.equal(lateArchive.voucher.voidCount, 2)
})

test('事件序号严格单调，终态只看最大序号的终结事件', () => {
  let voucher = createVoucher('2026-09-01', '2026-09-02')
  const steps: Array<Parameters<typeof applyBackfillAction>[1]> = ['提交执行', '启动任务', '归档结果']
  for (const action of steps) {
    const out = run(voucher, action)
    assert.equal(out.result.ok, true)
    voucher = out.voucher
  }
  const seqs = voucher.events.map((event) => event.seq)
  assert.deepEqual(seqs, [1, 2, 3])
  assert.equal(voucher.events[voucher.events.length - 1].resultingStatus, BACKFILL_STATUS.completed)
})

test('水位按连续签收推导，中间空洞会阻断水位', () => {
  let voucher = createVoucher('2026-09-01', '2026-09-04')
  voucher = signShard(voucher, '2026-09-01')
  assert.equal(deriveWatermark(voucher.shards), '2026-09-01')
  voucher = signShard(voucher, '2026-09-02')
  voucher = signShard(voucher, '2026-09-04') // 跳过 09-03，水位仍停在 09-02
  assert.equal(deriveWatermark(voucher.shards), '2026-09-02')
})

test('签章指纹能识别凭证被事后篡改（列表残留旧对象场景）', () => {
  let voucher = createVoucher('2026-09-01', '2026-09-02')
  voucher = run(voucher, '提交执行').voucher
  voucher = run(voucher, '启动任务').voucher
  voucher = run(voucher, '归档结果').voucher
  const tampered: IntervalVoucher = {
    ...voucher,
    shards: voucher.shards.map((shard) =>
      shard.date === '2026-09-02' ? { ...shard, signedAt: '2026-09-11T00:00:00.000Z' } : shard,
    ),
  }
  const check = verifySeal(tampered)
  assert.equal(check.ok, false)
  assert.match(check.message, /不一致/)
})

test('整笔退回语义：归档失败时凭证业务字段保持原样', () => {
  let voucher = createVoucher('2026-09-01', '2026-09-03')
  voucher = run(voucher, '提交执行').voucher
  voucher = run(voucher, '启动任务').voucher
  voucher = voidShard(voucher, '2026-09-03', '制造空洞')
  const snapshot = JSON.stringify({ ...voucher, archiveRejections: voucher.archiveRejections + 1 })
  const rejected = run(voucher, '归档结果')
  assert.equal(rejected.result.ok, false)
  // 除拒绝计数外，水位/空洞/签章/事件流水均不变。
  assert.equal(rejected.voucher.completionWatermark, voucher.completionWatermark)
  assert.equal(rejected.voucher.archiveSeal, null)
  assert.equal(rejected.voucher.events.length, voucher.events.length)
  assert.deepEqual(rejected.voucher.voidIntervals, JSON.parse(snapshot).voidIntervals)
})

test('已签收分片不能在终止时被改判为空洞', () => {
  let voucher = createVoucher('2026-09-01', '2026-09-02')
  voucher = run(voucher, '提交执行').voucher
  voucher = run(voucher, '启动任务').voucher
  const out = run(voucher, '终止任务', { voidDates: ['2026-09-01'] })
  assert.equal(out.result.ok, false)
  assert.match(out.result.message, /已签收，不能改判为空洞/)
})
