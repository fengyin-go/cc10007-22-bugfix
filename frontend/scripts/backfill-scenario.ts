/**
 * 题述场景端到端演示（不进 npm test，仅手动验证用）：
 * node --import tsx scripts/backfill-scenario.ts
 */
import { listBackfillRows, commitBackfillAction } from '../src/data/backfill/repository.ts'
import { resolveStatus, verifySeal } from '../src/data/backfill/domain.ts'
import type { IntervalVoucher } from '../src/data/backfill/types.ts'

const memory = new Map<string, string>()
const ls: Storage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
  clear: () => memory.clear(),
  key: (i) => [...memory.keys()][i] ?? null,
  get length() { return memory.size },
}
globalThis.localStorage = ls
globalThis.window = { localStorage: ls } as unknown as Window & typeof globalThis

const line = (title: string) => console.log(`\n=== ${title} ===`)

line('1. BACK-0001 终止后：只有已失败，无完成印，保留空洞区间')
const back1 = listBackfillRows().find((r) => r['任务编号'] === 'BACK-0001')!
const v1 = back1.voucher as IntervalVoucher
console.log('状态:', back1.status, '| 完成印:', v1.archiveSeal ? '有(违规!)' : '无', '| 失效区间:', back1['失败区间'])

line('2. 对失败计划归档：闸口拒绝，MONI 不可能误读成功')
console.log(commitBackfillAction(1, { action: '归档结果' }))
console.log('拒绝后状态仍是:', resolveStatus(getVoucher(1), ''))

line('3. 草稿/无签收计划归档：拒绝完成印')
console.log(commitBackfillAction(4, { action: '归档结果' }))

line('4. 重复归档 BACK-0002：不再推水位')
const before = (getVoucher(2) as IntervalVoucher).completionWatermark
console.log(commitBackfillAction(2, { action: '归档结果' }))
console.log('水位保持:', before, '->', (getVoucher(2) as IntervalVoucher).completionWatermark)

line('5. 签章指纹回看核对')
console.log(verifySeal(getVoucher(2) as IntervalVoucher))

function getVoucher(id: number): IntervalVoucher {
  return listBackfillRows().find((r) => Number(r.id) === id)!.voucher as IntervalVoucher
}
