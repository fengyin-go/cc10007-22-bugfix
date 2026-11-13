import { defineStore } from 'pinia'

import { GROUPS } from '@/data/backfill/access'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '数据分层建模工作台',
    /** 当前操作组：本组归属控制的裁决主体，可在顶栏切换以演示跨组拒绝。 */
    group: GROUPS[0] as string,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setGroup(group: string) {
      this.group = group
    },
  },
})
