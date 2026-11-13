<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">数据分层建模工作台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">离线版数仓分层建模工具，覆盖贴源层、明细层、汇总层、应用层的表结构设计、分区策略配置、质量规则编排与血缘关系管理，数据持久化到浏览器本地存储。</span>
        <span class="head-user">
          当前值班：{{ store.operator }} · {{ store.shiftLabel }}
          <label class="group-switch">
            操作组
            <select :value="store.group" @change="switchGroup">
              <option v-for="group in groups" :key="group" :value="group">{{ group }}</option>
            </select>
          </label>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import { GROUPS } from '@/data/backfill/access'

const store = useSessionStore()
const groups = GROUPS

function switchGroup(event: Event) {
  store.setGroup((event.target as HTMLSelectElement).value)
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "贴源层建模", path: "/ods" }, { label: "明细层建模", path: "/dwd" }, { label: "汇总层建模", path: "/dws" }, { label: "应用层发布", path: "/ads" }, { label: "数据源管理", path: "/source" }, { label: "分区策略", path: "/partition" }, { label: "清洗加工", path: "/cleanse" }, { label: "转换编排", path: "/transform" }, { label: "质量校验", path: "/quality" }, { label: "血缘追踪", path: "/lineage" }, { label: "历史补数", path: "/backfill" }, { label: "元数据管理", path: "/schema" }, { label: "数据同步", path: "/datasync" }, { label: "快照管理", path: "/snapshot" }, { label: "存储治理", path: "/govern" }, { label: "任务监控", path: "/monitor" }, { label: "变更审计", path: "/audit" }, { label: "编目检索", path: "/catalog" }]
</script>
