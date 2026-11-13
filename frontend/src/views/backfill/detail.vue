<template>
  <section class="page" data-module="backfill-detail">
    <header class="page-head">
      <div>
        <h2>补数任务详情 · {{ row?.['任务编号'] ?? '未找到' }}</h2>
        <p class="page-desc">
          回看以历史补数为主对象：状态、完成水位、失效区间全部读取区间凭证，并核对归档签章指纹。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="{ name: 'backfill' }">返回补数列表</RouterLink>
      </div>
    </header>

    <article v-if="row && voucher" class="voucher-panel">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">凭证裁决状态</span>
          <strong class="stat-value">{{ row.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">完成水位</span>
          <strong class="stat-value">{{ voucher.completionWatermark || '未推进' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已签收 / 失效分片</span>
          <strong class="stat-value">{{ voucher.receivedCount }} / {{ voucher.voidCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">归档签章</span>
          <strong class="stat-value">{{ voucher.archiveSeal ? '已盖完成印' : '无签章' }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span class="legend-item">归属组：{{ row.ownerGroup }}</span>
        <span class="legend-item">归属方式：{{ row.ownership }}</span>
        <span class="legend-item">失效区间：{{ voidText }}</span>
        <span class="legend-item">归档被拒次数：{{ voucher.archiveRejections }}</span>
      </p>

      <h3>分片签收明细（区间凭证本体）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>分片日期</th><th>签收状态</th><th>签收时间</th><th>失效原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="shard in voucher.shards" :key="shard.date">
            <td>{{ shard.date }}</td>
            <td>{{ shard.state }}</td>
            <td>{{ shard.signedAt ?? '—' }}</td>
            <td>{{ shard.voidReason ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <h3>事件流水（唯一序号裁决终态）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>序号</th><th>事件</th><th>发生时间</th><th>裁决状态</th><th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in voucher.events" :key="event.seq">
            <td>{{ event.seq }}</td>
            <td>{{ event.type }}</td>
            <td>{{ event.at }}</td>
            <td>{{ event.resultingStatus }}</td>
            <td>{{ event.note }}</td>
          </tr>
          <tr v-if="!voucher.events.length">
            <td colspan="5" class="empty-state">暂无事件</td>
          </tr>
        </tbody>
      </table>

      <h3>归档签章核对</h3>
      <p v-if="!voucher.archiveSeal" class="page-desc">
        该计划没有完成印：未归档或归档曾被闸口退回，监控与概览均不得按成功统计。
      </p>
      <table v-else class="data-table">
        <tbody>
          <tr><th>签章时间</th><td>{{ voucher.archiveSeal.sealedAt }}</td></tr>
          <tr><th>签章事件序号</th><td>{{ voucher.archiveSeal.eventSeq }}</td></tr>
          <tr><th>固化指纹</th><td>{{ voucher.archiveSeal.fingerprint }}</td></tr>
          <tr>
            <th>回看核对</th>
            <td :class="sealCheck.ok ? '' : 'error-text'">{{ sealCheck.message }}</td>
          </tr>
        </tbody>
      </table>
    </article>

    <p v-else class="error-text">没有找到该补数任务，可能已被重置或编号无效。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getBackfillRow } from '@/data/backfill/repository'
import { formatVoidIntervals, verifySeal } from '@/data/backfill/domain'
import type { IntervalVoucher } from '@/data/backfill/types'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const id = Number(route.params.id)

// 详情页与列表页共用同一个仓储读取函数，杜绝两处口径不一致。
const row = ref<EntryRow | null>(getBackfillRow(id))
const voucher = computed<IntervalVoucher | null>(() =>
  row.value ? (row.value.voucher as IntervalVoucher) : null,
)
const voidText = computed(() => (voucher.value ? formatVoidIntervals(voucher.value) : '无空洞'))
const sealCheck = computed(() => (voucher.value ? verifySeal(voucher.value) : { ok: false, message: '无凭证' }))
</script>
