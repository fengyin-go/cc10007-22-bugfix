<template>
  <section class="page" data-module="monitor">
    <header class="page-head">
      <div>
        <h2>任务监控管理</h2>
        <p class="page-desc">
          补数监控直接读取区间凭证：只认归档完成印，失败计划的空洞区间原样透出，避免把终止误读成成功。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记监控配置</button>
        <button class="btn" type="button" @click="exportRows">导出任务监控清单</button>
      </div>
    </header>

    <h3>补数区间凭证监控（历史补数为主对象）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>任务编号</th>
          <th>目标表</th>
          <th>凭证状态</th>
          <th>完成水位</th>
          <th>失效区间</th>
          <th>签收/失效</th>
          <th>完成印</th>
          <th>签章核对</th>
          <th>归属</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in backfillView" :key="item.id">
          <td>{{ item.taskCode }}</td>
          <td>{{ item.targetTable }}</td>
          <td>{{ item.status }}</td>
          <td>{{ item.watermark || '未推进' }}</td>
          <td :class="item.voidCount > 0 ? 'error-text' : ''">{{ item.voidIntervals }}</td>
          <td>{{ item.receivedCount }} / {{ item.voidCount }}</td>
          <td>{{ item.sealed ? `已签章 ${item.sealedAt.slice(0, 10)}` : '无完成印' }}</td>
          <td :class="item.sealCheck ? '' : 'error-text'">
            {{ item.sealed ? (item.sealCheck ? '一致' : item.sealMessage) : '—' }}
          </td>
          <td>{{ item.ownerGroup }}·{{ item.ownership }}</td>
        </tr>
        <tr v-if="!backfillView.length">
          <td colspan="9" class="empty-state">暂无补数凭证数据</td>
        </tr>
      </tbody>
    </table>

    <div class="stat-row" style="margin-top: 16px">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无任务监控数据，可先登记监控配置</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条任务监控记录；补数指标与历史补数页同读一张区间凭证</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  loadBackfillMonitorView,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('monitor')
const columns = ['配置编号', '关联任务', '监控指标', '告警阈值', '告警级别', '静默分钟', '通知渠道', '恢复条件']
const actions = ['提交校验', '启用监控', '停用监控']
const statuses = ['草稿', '待校验', '已启用', '已停用']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 监控口径直接来自区间凭证仓储，不自行解释补数行状态。
const backfillView = ref(loadBackfillMonitorView())

const stats = computed(() => [
  { label: '监控配置总数', value: rows.value.length },
  { label: '补数完成印数', value: backfillView.value.filter((item) => item.sealed).length },
  { label: '补数空洞任务', value: backfillView.value.filter((item) => item.voidCount > 0).length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '监控配置登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
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
    backfillView.value = loadBackfillMonitorView()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '任务监控列表读取失败'
  }
}

onMounted(reload)
</script>
