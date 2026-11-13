/**
 * 历史补数域：区间凭证（Interval Voucher）类型定义。
 *
 * 设计约束（对应历史补数治理规则）：
 * 1. 完成水位、失效区间、归档签章同属一张区间凭证，三者只能在同一笔提交里落盘；
 * 2. 没有签收任何分片的计划不能获得完成印；失败计划必须保留空洞区间；
 * 3. 终止与归档交叉时，由事件流水里的唯一序号决定终态；重复归档不再推水位；
 * 4. 补数、监控、概览只允许从这张凭证读状态，不再各自解释行上的 status 字段。
 */

/** 分片状态：待签收 / 已签收（成功落盘）/ 失效（空洞，需要后续补数） */
export type ShardState = '待签收' | '已签收' | '失效'

/** 分片是补数调度的最小单元，按日期切分；签收记录是完成印的唯一凭据。 */
export type Shard = {
  /** 分片对应日期（YYYY-MM-DD），同一计划内唯一 */
  date: string
  state: ShardState
  /** 实际完成落盘的时间；未签收或失效时为空 */
  signedAt: string | null
  /** 失效原因，仅失效分片有值，用于回看空洞区间的来历 */
  voidReason: string | null
}

/**
 * 区间事件流水。终止与归档可能交叉到达，每条事件分配一个单调递增的唯一序号，
 * 终态由序号最大的事件决定（后到者赢），从根上杜绝「已失败 + 待处理」双印章。
 */
export type BackfillEventType = '提交执行' | '启动任务' | '终止任务' | '归档结果'

export type BackfillEvent = {
  /** 计划内单调递增的唯一序号，由领域层分配，外部不允许指定 */
  seq: number
  type: BackfillEventType
  /** 事件发生时间（ISO 字符串），仅用于展示，裁决只看 seq */
  at: string
  /** 事件落账后的计划状态 */
  resultingStatus: string
  /** 被拒绝的事件会带说明，例如「无完成印，拒绝归档」 */
  note: string
}

/**
 * 区间凭证：历史补数计划的唯一事实来源。
 * 行上的 status / 完成水位 / 失败区间都由凭证派生，页面与其他模块只读凭证。
 */
export type IntervalVoucher = {
  /** 凭证版本号，后续结构升级时按版本迁移旧数据 */
  version: 1
  /** 分片签收明细 */
  shards: Shard[]
  /** 已签收分片数；完成印要求 received > 0 */
  receivedCount: number
  /** 失效（空洞）分片数；失败计划必须 > 0 且空洞区间被保留 */
  voidCount: number
  /**
   * 完成水位：已连续签收至的日期（含）。
   * 只有成功归档的同一笔提交里才允许推进；重复归档不再推水位。
   */
  completionWatermark: string | null
  /** 失效区间（空洞），闭区间 [from, to] 列表，随凭证持久化保留 */
  voidIntervals: { from: string; to: string }[]
  /** 归档签章：成功归档时写入，是「已完成」印章的唯一合法来源 */
  archiveSeal: {
    /** 签章时间 */
    sealedAt: string
    /** 签章时凭证的快照指纹，回看时核对，防止列表/详情各说各话 */
    fingerprint: string
    /** 签章所在事件的序号 */
    eventSeq: number
  } | null
  /** 归档被闸口拒绝的次数，用于回看与监控解释 MONI 误读 */
  archiveRejections: number
  /** 事件流水，按 seq 升序 */
  events: BackfillEvent[]
}

/** 归属控制：本组可写，跨组只读，共享记录对所有人只读。 */
export type OwnershipMode = '本组' | '共享'

/** 补数计划在凭证上派生的终态/当前态。 */
export const BACKFILL_STATUS = {
  draft: '草稿',
  pending: '待执行',
  running: '运行中',
  completed: '已完成',
  failed: '已失败',
} as const

/** 动作执行结果：ok=false 时整笔退回，凭证保持原样。 */
export type BackfillActionResult = {
  ok: boolean
  message: string
  /** 动作成功时给出事件序号，便于交叉场景回看裁决依据 */
  seq?: number
}
