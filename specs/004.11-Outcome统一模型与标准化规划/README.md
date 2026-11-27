# Spec 004.11：Outcome 统一模型与标准化规划

状态：Draft

## 简介

本 Spec 将当前分散在 `Outcome`、`OwnerTodoItem`、`ExploreIdea`、`Routine(once / 固定日期 Cron)` 中的目标与任务对象，以及新增的 `note`（笔记，可同步接入共享记忆）类型，全部统一收口到 **`Outcome`** 单一对象模型中；整合统一收件入口 **「Go / 随便记点什么」**（支持文本、图片、附件，提交后异步走 Plan Pi Agent 自动分诊为笔记/待办/正式目标/想法，支持同源多条拆分）；同时将当前割裂的 4 套规划/预分析通道（`OutcomeThread(plan/replan)`、`Routine(preparation)`、`OutcomeThread(inspection)`、`OutcomePlanningService`）整合为**一套标准、可复用、具备完整只读调研能力（含本机与目标归属 Bot 只读 MCP）的统一 Plan 流程**，并彻底移除多余的旧表、旧服务、旧接口与兼容分支。

## 文档索引

- [requirements.md](./requirements.md)：业务背景、范围边界、可验证功能需求与非功能需求
- [design.md](./design.md)：统一数据模型、标准化 Plan 引擎、只读调研权限模型（方案 B）、API/工具契约与清理清单
- [tasks.md](./tasks.md)：分阶段人话版实施任务清单与验证方式
- [docs/README.md](./docs/README.md)：补充文档目录

## 核心设计决策（已与所有者确认）

1. **单一 Outcome 对象表（含附件承载）**：将 `standard`、`tracked`、`scheduled_once`、`todo`、`explore_idea`、`note` 六种类型全部统一在 `Outcome` 表中通过 `kind` 字段维护，统一支持 `attachments` 图片/文件挂载与同一 `outcomeId` 上的原地演进和同源多条拆分（通过 `parentOutcomeId` 关联源记录），不再维护平行对象表。
2. **统一「Go / 随便记点什么」收件入口与自动分诊**：将目标页「新建目标」、概览「记录想法」与侧栏快速记录整合为单一 **`Go`** 入口，弹出标题为「随便记点什么」的模态框（复用悬浮框的文本、`@Bot`、图片粘贴预览、文件附件交互）。点击 `Go` 或回车后立即落盘源记录并关闭弹窗，后台异步走标准 Plan Pi Agent（`planMode: "triage"`）自动识别为 `note` / `todo` / `standard` / `explore_idea`（或按需在保留源 `note` 的前提下拆出多条子项并关联 `parentOutcomeId`）；经由「Go」识别为 `todo` 时因属所有者主动录入，直接建为正式待办（`open`）而非建议（`suggested`）。
3. **标准化可复用 Plan 流程（含自动巡检收敛）**：任意 `kind` 的 Outcome 均复用同一套 `OutcomeThread(role="planner")` 规划引擎，支持「收件分诊（`triage`）」、「轻量运行建议 / 调研简报（`advice`）」和「正式合同与执行计划（`contract_plan`）」三档标准化输出，以及多轮追问与原地升格；保留自动巡检策略（`inspection.enabled` / `inspection.leadHours`），到期前由统一调度器自动调用 `plan(mode="advice")`。
4. **Plan 阶段只读调研权限（方案 B）**：
   - 允许访问本机：`ListMachines` + `Read(machineId)` + 本机 `Shell(machineId)` / `AwaitShell(machineId)`（在规划提示词中约束仅做只读调研，不得修改本机文件或执行外部写操作）。
   - 允许借用目标归属 Bot 的只读 MCP 与只读上下文：规划回合同时拥有规划 Bot 与目标归属 Bot（`outcome.botId`）的只读 MCP 工具与只读上下文（`RecallMemory`、`ReadTranscript`、私有技能说明），彻底解决独立规划 Bot 查不到业务 Bot 资料的问题。
   - 代码层硬禁止副作用工具：禁止 `SendToUser`、`WakeParent`、`UpdateRoutine`、写类 MCP 等。
5. **`note`（笔记）类型定位与共享记忆接入**：
   - 支持 Markdown 长正文、图片/附件、标签、来源引用、关联其他 Outcome，以及原地发起 Plan。
   - **接入共享记忆（`MemoryFact`）**：笔记创建/编辑时自动提炼精简事实摘要同步写入 `MemoryFact`（遵守 500 字符上限并记录 `noteId` 溯源），让所有 Bot 在对话与规划中自动召回；编辑/归档/删除笔记时同步更新或撤销对应共享记忆，需要全文时由 Bot 通过 `GetOutcome` 按需读取。
   - Bot 在对话中可直接通过统一 Outcome 工具创建、更新、检索 `note`。
   - 工作区在「全部 / 笔记」中作为独立筛选分类展示；默认不进入日历，除非显式设置了时间（`scheduledAt` / `dueAt`）。
6. **彻底清理冗余逻辑，无兼容代理层**：
   - 同步改造 Server、Worker、Computer、Client SDK、Desktop、Android 与 iOS 客户端后，彻底删除旧表、旧服务与旧路由（`/api/v0/todos`、`/api/v0/explore`、`/api/v0/outcomes/scheduled-goals`、`/api/v0/routines/:id/prepare` 等），不保留兼容转发层（保留 Bot 内部任务清单 `TodoItem` / `todo-service.ts`）。
   - 按全新架构直接重构数据库 Schema，不背负存量旧字段兼容包袱。

## 分阶段路线图

| 阶段 | 内容 | 核心产出 |
| --- | --- | --- |
| 阶段 1 | 统一数据模型与契约定义 | 重构 `Outcome` Prisma Schema 与 `packages/contracts` 统一契约，删除旧表模型 |
| 阶段 2 | 统一 Outcome 服务、笔记记忆同步与排期调度 | 整合 `OutcomeService`（覆盖 6 种 `kind`、原地演进、`note` 共享记忆双向同步、Todo 自动接受规则、`scheduled_once` 与到期自动巡检调度器），剥离 `Routine` 一次性分支 |
| 阶段 3 | 标准化 Plan 引擎、收件自动分诊与 `research_readonly` 运行时 | 统一 `OutcomeThread` 规划管线（`triage` / `advice` / `contract_plan` + 多模态附件透传）、Worker/Server 借用目标 Bot 只读 MCP 与记忆/对话权、Computer 方案 B 权限档位、收敛 `inspection` |
| 阶段 4 | 统一 HTTP API、Agent 工具与清理旧代码 | 统一 `/api/v0/outcomes`（含 `/intake`，复用 `/api/assets` 附件能力）路由、统一对话工具（含 `note` 增改查）、更新活动/日历/订阅读模型、彻底移除旧路由与旧服务 |
| 阶段 5 | 多端适配（SDK / Desktop / Android / iOS） | 改造 `client-core`、Desktop 统一「Go / 随便记点什么」收件弹窗/工作区/「笔记」筛选/统一详情与 Plan 面板/日历、Android & iOS 迁至统一 Outcome 接口 |
| 阶段 6 | 全链路验证与远端 Computer 同步 | 隔离 DB 集成测试、桌面/移动端构建验证、征得同意后同步并重建远端 Debug Computer |

## 与相邻 Spec 的关系

- **004.2 / 004.3 / 004.4 / 004.5**：保留 `standard` 目标的合同审批、WorkItem 执行、决策、现实人工任务与验收状态机核心不变量；废弃并彻底删除 004.2/004.4 残留的 `OutcomePlanningDraft` / `OutcomePlanningService` 与独立 `ExploreIdea` 表。
- **004.6（移动端）**：同步将 `mobile/shared`（`OutcomeExplore.kt`、`Outcomes.kt`）、Android（`LiveFeatureGateway.kt`）与 iOS（`MobileTodo.swift`）从 `/api/v0/explore` 与 `/api/v0/todos` 迁移到统一的 `/api/v0/outcomes`（按 `kind=explore_idea` / `kind=todo` 筛选与操作），保持全端编译与单测通过。
- **004.7（看板挂板追踪）**：将 `trackingMode: "tracked"` 正式收口为 `Outcome.kind = "tracked"`，移除 `OutcomeTrackingMode` 枚举，支持原地升格为 `standard`。
- **004.8 / 004.9（Agent 驱动规划与规划角色）**：将 `OutcomeThread(role="planner")` 从仅服务 `standard` 升级为服务全部 6 种 `Outcome.kind` 的标准规划引擎；统一规划角色回退策略，并补齐本机只读调研与目标 Bot 只读 MCP 借用能力。
- **004.10（任务全景视图）**：**整合与取代部分底层实现**。保留全景活动视图、日历、ICS 订阅、任务排期与延后、待办自动接受规则等产品能力，但其底层对象全部统一读/写 `Outcome` 表，彻底移除独立的 `OwnerTodoItem` 表以及 `Routine` 里的 `once` / 固定日期 Cron / `preparation` 逻辑。
- **010（群任务看板）**：保持独立，不并入本 Spec。
- **远端 Debug Computer**：本 Spec 涉及 `packages/contracts`、`apps/computer` 的工具权限与契约变更，实际联调生效前须按仓库 `AGENTS.md` 同步远端并征得用户同意后重建 `computer` 与 `computer-memory-init` 容器。
