<template>
  <section class="page" data-module="backfill">
    <header class="page-head">
      <div>
        <h2>历史补数管理</h2>
        <p class="page-desc">
          区间凭证是唯一事实来源：无分片签收不得盖完成印，失败计划保留空洞区间；完成水位、失效区间与归档签章同笔提交。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记补数任务</button>
        <button class="btn" type="button" @click="exportRows">导出历史补数清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">当前操作组：{{ session.group }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>归属</th>
          <th>凭证状态</th>
          <th>可执行动作</th>
          <th>回看</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>
            {{ row.ownerGroup }}
            <p class="page-desc">{{ row.ownership === '共享' ? '共享·只读' : accessOf(row).reason }}</p>
          </td>
          <td>
            {{ row.status }}
            <span v-if="sealedOf(row)" class="legend-item">完成印</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!writableOf(row)"
              :title="writableOf(row) ? action : accessOf(row).reason"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
          <td>
            <RouterLink class="link" :to="{ name: 'backfill-detail', params: { id: row.id } }">
              核对凭证
            </RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无历史补数数据，可先登记补数任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条历史补数记录，状态与水位均由区间凭证实时派生</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  checkRowAccess,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import type { IntervalVoucher } from '@/data/backfill/types'

const meta = moduleMeta('backfill')
const session = useSessionStore()
const columns = ['任务编号', '目标表名', '开始日期', '结束日期', '并行度', '覆盖策略', '完成水位', '失败区间']
const actions = ['提交执行', '启动任务', '终止任务', '归档结果']
const statuses = ['草稿', '待执行', '运行中', '已完成', '已失败']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: '补数任务总数', value: rows.value.length },
  { label: '运行中任务', value: rows.value.filter((row) => row.status === '运行中').length },
  { label: '已完成任务', value: rows.value.filter((row) => row.status === '已完成').length },
  { label: '带空洞失败任务', value: rows.value.filter((row) => row.status === '已失败').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function accessOf(row: EntryRow) {
  return checkRowAccess(row, true)
}

function writableOf(row: EntryRow): boolean {
  return checkRowAccess(row, true).allowed
}

function sealedOf(row: EntryRow): boolean {
  return (row.voucher as IntervalVoucher)?.archiveSeal !== null
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '补数任务登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    reload()
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '历史补数列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.link:disabled {
  color: #9aa6b2;
  cursor: not-allowed;
}
</style>
