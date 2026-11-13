/**
 * 历史补数区间凭证：纯领域逻辑（不碰 localStorage / window / Vue）。
 *
 * 所有写操作都是「先在副本上整笔演算，任一校验失败就返回原凭证 + ok:false」，
 * 模拟完成水位、失效区间、归档签章同笔提交、任一失败整笔退回的事务语义。
 */
import type {
  BackfillActionResult,
  BackfillEvent,
  BackfillEventType,
  IntervalVoucher,
  Shard,
} from './types.ts'
import { BACKFILL_STATUS } from './types.ts'

const DAY_MS = 24 * 60 * 60 * 1000

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** 闭区间枚举日期，用于把计划的开始/结束日期切成日分片。 */
export function enumerateDates(from: string, to: string): string[] {
  const start = toDate(from)
  const end = toDate(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return []
  }
  const dates: string[] = []
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += DAY_MS) {
    dates.push(formatDate(new Date(cursor)))
  }
  return dates
}

/** 新建空凭证：计划登记后尚未提交执行，所有分片等待签收。 */
export function createVoucher(from: string, to: string): IntervalVoucher {
  const shards: Shard[] = enumerateDates(from, to).map((date) => ({
    date,
    state: '待签收',
    signedAt: null,
    voidReason: null,
  }))
  return {
    version: 1,
    shards,
    receivedCount: 0,
    voidCount: 0,
    completionWatermark: null,
    voidIntervals: [],
    archiveSeal: null,
    archiveRejections: 0,
    events: [],
  }
}

/** 把相邻的失效分片压缩成闭区间，失败计划的空洞区间由此而来。 */
export function buildVoidIntervals(shards: Shard[]): { from: string; to: string }[] {
  const intervals: { from: string; to: string }[] = []
  let current: { from: string; to: string } | null = null
  for (const shard of shards) {
    if (shard.state !== '失效') {
      current = null
      continue
    }
    if (current && toDate(shard.date).getTime() === toDate(current.to).getTime() + DAY_MS) {
      current.to = shard.date
    } else {
      current = { from: shard.date, to: shard.date }
      intervals.push(current)
    }
  }
  return intervals
}

/** 从分片明细推导完成水位：从最早日期起连续「已签收」到的最后一天。 */
export function deriveWatermark(shards: Shard[]): string | null {
  let watermark: string | null = null
  for (const shard of shards) {
    if (shard.state !== '已签收') {
      break
    }
    watermark = shard.date
  }
  return watermark
}

/** 凭证指纹：签章时固化，回看时重算比对，识别列表残留旧对象的情形。 */
export function fingerprint(voucher: IntervalVoucher): string {
  const shardDigest = voucher.shards
    .map((shard) => `${shard.date}:${shard.state}:${shard.signedAt ?? ''}`)
    .join('|')
  const voidDigest = voucher.voidIntervals.map((item) => `${item.from}~${item.to}`).join('|')
  return [
    'v1',
    shardDigest,
    `received=${voucher.receivedCount}`,
    `void=${voucher.voidCount}`,
    `watermark=${voucher.completionWatermark ?? ''}`,
    `voids=${voidDigest}`,
    `sealed=${voucher.archiveSeal?.sealedAt ?? ''}`,
  ].join('#')
}

function nextSeq(voucher: IntervalVoucher): number {
  return voucher.events.reduce((max, event) => Math.max(max, event.seq), 0) + 1
}

function appendEvent(
  voucher: IntervalVoucher,
  type: BackfillEventType,
  resultingStatus: string,
  note: string,
  at: string,
): { voucher: IntervalVoucher; event: BackfillEvent } {
  const event: BackfillEvent = { seq: nextSeq(voucher), type, at, resultingStatus, note }
  return { voucher: { ...voucher, events: [...voucher.events, event] }, event }
}

/**
 * 终态裁决：终止与归档交叉时，只认事件流水里唯一序号最大的一条终结事件。
 * - 末位终结事件是归档 → 已完成（且必然带完成印，归档闸口保证）
 * - 末位终结事件是终止 → 已失败（且必然保留空洞区间）
 * 流水缺失时回退到行状态，兼容尚未产生事件的旧对象。
 */
export function resolveStatus(voucher: IntervalVoucher, fallback: string): string {
  for (let index = voucher.events.length - 1; index >= 0; index -= 1) {
    const event = voucher.events[index]
    if (event.type === '归档结果') {
      return BACKFILL_STATUS.completed
    }
    if (event.type === '终止任务') {
      return BACKFILL_STATUS.failed
    }
  }
  return fallback
}

/** 完成印合法性：必须真的签收过分片，且没有未闭合的失效空洞。 */
export function canSealCompletion(voucher: IntervalVoucher): boolean {
  return (
    voucher.receivedCount > 0 &&
    voucher.voidCount === 0 &&
    voucher.shards.length > 0 &&
    voucher.shards.every((shard) => shard.state === '已签收')
  )
}

/** 重新汇总派生字段，保证凭证内部自洽（手工修正分片后必须调用一次）。 */
export function recomputeVoucher(voucher: IntervalVoucher): IntervalVoucher {
  return recompute(voucher)
}

/** 重新汇总派生字段，保证凭证内部自洽。 */
function recompute(voucher: IntervalVoucher): IntervalVoucher {
  const receivedCount = voucher.shards.filter((shard) => shard.state === '已签收').length
  const voidCount = voucher.shards.filter((shard) => shard.state === '失效').length
  return {
    ...voucher,
    receivedCount,
    voidCount,
    voidIntervals: buildVoidIntervals(voucher.shards),
    completionWatermark: deriveWatermark(voucher.shards),
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 把指定日期的分片标记为已签收；已失效的空洞不允许被签收悄悄盖掉。 */
export function signShard(
  voucher: IntervalVoucher,
  date: string,
  at: string = nowIso(),
): IntervalVoucher {
  const shards = voucher.shards.map((shard) =>
    shard.date === date && shard.state === '待签收'
      ? { ...shard, state: '已签收' as const, signedAt: at, voidReason: null }
      : shard,
  )
  return recompute({ ...voucher, shards })
}

/** 把指定日期的分片打成失效空洞；终止时用于保留失败区间。 */
export function voidShard(
  voucher: IntervalVoucher,
  date: string,
  reason: string,
): IntervalVoucher {
  const shards = voucher.shards.map((shard) =>
    shard.date === date
      ? { ...shard, state: '失效' as const, signedAt: null, voidReason: reason }
      : shard,
  )
  return recompute({ ...voucher, shards })
}

/**
 * 计划动作入口。返回新凭证（失败时是未改动的原凭证）与统一结果说明。
 * 调用方只在 ok 时整笔落盘，任一失败都不写存储 —— 整笔退回。
 */
export function applyBackfillAction(
  voucher: IntervalVoucher,
  action: BackfillEventType,
  options: { at?: string; voidDates?: string[]; voidReason?: string } = {},
): { voucher: IntervalVoucher; result: BackfillActionResult } {
  const at = options.at ?? nowIso()
  const current = resolveStatus(voucher, '')

  switch (action) {
    case '提交执行': {
      if (current === BACKFILL_STATUS.running || current === BACKFILL_STATUS.completed) {
        return { voucher, result: { ok: false, message: `计划已处于「${current}」，不能重复提交执行` } }
      }
      const { voucher: next, event } = appendEvent(voucher, action, BACKFILL_STATUS.pending, '提交执行，等待调度', at)
      return { voucher: next, result: { ok: true, message: '补数计划已提交执行，进入待执行', seq: event.seq } }
    }

    case '启动任务': {
      if (current === BACKFILL_STATUS.completed || current === BACKFILL_STATUS.failed) {
        return { voucher, result: { ok: false, message: `计划已终态「${current}」，不能再启动` } }
      }
      // 启动即模拟调度：全部待签收分片完成签收，作为后续完成印的唯一凭据来源。
      let candidate = voucher
      for (const shard of voucher.shards) {
        if (shard.state === '待签收') {
          candidate = signShard(candidate, shard.date, at)
        }
      }
      const { voucher: next, event } = appendEvent(candidate, action, BACKFILL_STATUS.running, '调度启动，分片开始签收', at)
      return { voucher: next, result: { ok: true, message: '补数任务已启动，分片进入签收', seq: event.seq } }
    }

    case '终止任务': {
      if (current === BACKFILL_STATUS.completed) {
        return { voucher, result: { ok: false, message: '计划已盖完成印并归档，终止被唯一序号裁决拒绝' } }
      }
      if (current === BACKFILL_STATUS.failed) {
        return { voucher, result: { ok: false, message: '计划已经终止，请勿重复终止' } }
      }
      // 终止：未签收的分片全部打成失效空洞，已签收成果保留；失败计划必须留空洞。
      const voidDates = options.voidDates ?? voucher.shards.filter((s) => s.state !== '已签收').map((s) => s.date)
      if (voidDates.length === 0) {
        return { voucher, result: { ok: false, message: '终止被退回：没有可保留的空洞区间，无法证明失败事实' } }
      }
      let candidate = voucher
      for (const date of voidDates) {
        const shard = candidate.shards.find((item) => item.date === date)
        if (!shard) {
          return { voucher, result: { ok: false, message: `终止被退回：分片 ${date} 不在计划区间内` } }
        }
        if (shard.state === '已签收') {
          return { voucher, result: { ok: false, message: `终止被退回：分片 ${date} 已签收，不能改判为空洞` } }
        }
        candidate = voidShard(candidate, date, options.voidReason ?? '任务终止，分片未完成签收')
      }
      candidate = recompute(candidate)
      const { voucher: next, event } = appendEvent(
        candidate,
        action,
        BACKFILL_STATUS.failed,
        `终止落账，保留 ${candidate.voidIntervals.length} 段空洞区间`,
        at,
      )
      return { voucher: next, result: { ok: true, message: `任务已终止，失效区间已保留（${candidate.voidCount} 个分片）`, seq: event.seq } }
    }

    case '归档结果': {
      // 归档闸口：完成水位 / 失效区间 / 归档签章必须同笔提交，任一不合法整笔退回。
      if (voucher.archiveSeal) {
        return {
          voucher,
          result: { ok: false, message: '计划已盖归档章，重复归档不再推水位、不再重复签章' },
        }
      }
      if (voucher.voidCount > 0) {
        const rejected: IntervalVoucher = { ...voucher, archiveRejections: voucher.archiveRejections + 1 }
        return {
          voucher: rejected,
          result: {
            ok: false,
            message: `归档被闸口退回：存在 ${voucher.voidCount} 个失效分片（${voucher.voidIntervals
              .map((item) => `${item.from}~${item.to}`)
              .join('、')}），失败计划不得获得完成印`,
          },
        }
      }
      if (!canSealCompletion(voucher)) {
        const rejected: IntervalVoucher = { ...voucher, archiveRejections: voucher.archiveRejections + 1 }
        return {
          voucher: rejected,
          result: {
            ok: false,
            message:
              voucher.receivedCount === 0
                ? '归档被闸口退回：没有签收任何分片的计划不能获得完成印'
                : '归档被闸口退回：仍有分片未完成签收，完成水位无法闭合',
          },
        }
      }
      // 同笔提交：先在副本上把水位、空洞（此处为空）、签章凑齐，再整体返回给调用方落盘。
      const sealEventSeq = nextSeq(voucher)
      const sealed: IntervalVoucher = {
        ...recompute(voucher),
        archiveSeal: { sealedAt: at, fingerprint: '', eventSeq: sealEventSeq },
      }
      sealed.archiveSeal = {
        sealedAt: at,
        eventSeq: sealEventSeq,
        fingerprint: fingerprint(sealed),
      }
      const { voucher: next, event } = appendEvent(
        sealed,
        action,
        BACKFILL_STATUS.completed,
        '完成水位、失效区间、归档签章同笔提交完成',
        at,
      )
      // 签章里记录的是真正落账事件的序号，再固化一次指纹。
      next.archiveSeal = {
        sealedAt: at,
        eventSeq: event.seq,
        fingerprint: fingerprint(next),
      }
      return {
        voucher: next,
        result: { ok: true, message: `归档成功，完成水位 ${next.completionWatermark}，完成印已签章`, seq: event.seq },
      }
    }

    default:
      return { voucher, result: { ok: false, message: `未登记的补数动作：${String(action)}` } }
  }
}

/** 回看核对：重算当前凭证指纹，与签章固化指纹比对。 */
export function verifySeal(voucher: IntervalVoucher): { ok: boolean; message: string } {
  if (!voucher.archiveSeal) {
    return { ok: false, message: '凭证未归档，无签章可核对' }
  }
  const current = fingerprint(voucher)
  if (current !== voucher.archiveSeal.fingerprint) {
    return { ok: false, message: '签章指纹与当前凭证不一致，列表残留对象与详情凭证对不上' }
  }
  return { ok: true, message: '签章指纹核对一致，区间凭证未被篡改' }
}

/** 失效区间的展示文本，监控与概览共用同一份口径。 */
export function formatVoidIntervals(voucher: IntervalVoucher): string {
  if (voucher.voidIntervals.length === 0) {
    return '无空洞'
  }
  return voucher.voidIntervals.map((item) => (item.from === item.to ? item.from : `${item.from}~${item.to}`)).join('、')
}
