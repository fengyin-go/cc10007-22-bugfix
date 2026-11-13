# 数据分层建模工作台

离线版数仓分层建模工具，覆盖贴源层、明细层、汇总层、应用层的表结构设计、分区策略配置、质量规则编排与血缘关系管理，数据持久化到浏览器本地存储。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 贴源层建模 | `ods` | 贴源表 | 表编号、源表名称、目标表名 |
| 明细层建模 | `dwd` | 明细表 | 表编号、业务域、明细表名 |
| 汇总层建模 | `dws` | 汇总表 | 表编号、汇总主题、聚合维度 |
| 应用层发布 | `ads` | 应用数据集 | 数据集编号、业务应用、输出表名 |
| 数据源管理 | `source` | 数据源连接 | 连接编号、连接类型、接入地址 |
| 分区策略 | `partition` | 分区方案 | 方案编号、目标表名、分区字段 |
| 清洗加工 | `cleanse` | 清洗规则 | 规则编号、输入表名、目标表名 |
| 转换编排 | `transform` | 转换节点 | 节点编号、输入表名、输出表名 |
| 质量校验 | `quality` | 质量规则 | 规则编号、校验表名、目标字段 |
| 血缘追踪 | `lineage` | 血缘关系 | 关系编号、上游表名、下游表名 |
| 历史补数 | `backfill` | 补数任务 | 任务编号、目标表名、开始日期 |
| 元数据管理 | `schema` | 字段定义 | 字段编号、所属表名、字段名称 |
| 数据同步 | `datasync` | 同步链路 | 链路编号、源端连接、目标端连接 |
| 快照管理 | `snapshot` | 快照策略 | 策略编号、目标表名、快照周期 |
| 存储治理 | `govern` | 治理策略 | 策略编号、目标表名、治理类型 |
| 任务监控 | `monitor` | 监控配置 | 配置编号、关联任务、监控指标 |
| 变更审计 | `audit` | 审计记录 | 记录编号、操作表名、变更类型 |
| 编目检索 | `catalog` | 编目条目 | 条目编号、数据集名称、所属分层 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `data-layer-studio:entries` 这一项，或调用 `resetModule(模块)`。

## 历史补数：区间凭证（Interval Voucher）

历史补数模块不走通用状态机，状态事实全部收敛到 `frontend/src/data/backfill/` 的区间凭证上：

```text
src/data/backfill/
├── types.ts        凭证/分片/事件流水类型
├── domain.ts       纯领域逻辑：分片签收、空洞区间、归档闸口、唯一序号裁决、签章指纹
├── access.ts       本组归属控制：跨组越权拒绝，共享记录只读
├── repository.ts   唯一读写闸口：列表、详情、监控、概览同读一张凭证
└── *.test.ts       node:test 领域与集成测试（npm test）
```

治理规则与对应实现：

1. **没有签收任何分片的计划不能获得完成印**：`applyBackfillAction('归档结果')` 在
   `receivedCount === 0` 时整笔退回，不写归档签章。
2. **失败计划必须保留空洞区间**：终止把未签收分片打成「失效」，由相邻分片压缩成闭区间
   持久化在凭证 `voidIntervals` 上；带空洞的归档一律被闸口拒绝。
3. **完成水位、失效区间、归档签章同笔提交，任一失败整笔退回**：领域层先在副本上演算，
   只有 `ok` 时仓储才写 localStorage；失败路径不产生任何落盘写入。
4. **终止与归档交叉由唯一序号决定终态**：每条事件分配单调递增 `seq`，`resolveStatus`
   只认序号最大的终结事件，杜绝「已失败 + 待处理」双印章；重复归档直接拒绝，不再推水位。
5. **补数、监控、概览同读一张凭证**：三个页面都通过 `repository` / `loadBackfillMonitorView`
   取数，行上的状态、水位、失败区间均由凭证投影派生；详情页（`/backfill/:id`）回看时
   重算签章指纹核对，列表残留旧对象会被指纹识别出来。
6. **本组归属控制**：记录带 `ownerGroup` 与 `ownership`，跨组写操作拒绝、共享记录对所有组
   只读；顶栏可切换操作组验证越权拦截。
7. **本地存储结构版本**：`local-store` 带 `SCHEMA_VERSION`，结构升级时整体重新播种，
   避免旧数据浅合并造成的列表/详情双口径；无凭证的旧行在读取时按日期自动补建。

## 测试

```bash
cd frontend
npm test          # node:test，21 个用例覆盖凭证规则、归属控制与仓储集成
npm run typecheck
npm run build
```


领域：数据工程
子方向：数仓与数据湖
