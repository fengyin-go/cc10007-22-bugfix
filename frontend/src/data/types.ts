/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 行字段以标量为主；区间凭证这类结构化字段用 unknown 兜底，读取处再显式收窄。 */
export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | null | unknown
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
