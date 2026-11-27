# 任务清单 - Outcome 统一模型与标准化规划（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单把 Spec 004.11 拆成 6 个按依赖顺序推进的阶段，每一步都写清楚：

- 这一步到底做什么
- 做完后你能看到什么
- 主要改或删哪些文件
- 怎么验证才算真正完成

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- `BLOCKED` 必须写清楚卡在哪里
- `CANCELLED` 必须写清楚为什么不做
- 每做完一个任务，必须立刻更新这里

---

## 阶段 1：统一数据模型与契约定义

- [x] 1.1 重构 Prisma Schema，将 6 种 Outcome 统一到 `Outcome` 单表并清理旧表
  - 状态：DONE
  - 这一步到底做什么：把 `Outcome` 主表改造成支持 `standard`、`tracked`、`scheduled_once`、`todo`、`explore_idea`、`note` 六种 `kind` 的统一模型（`botId` 改为可选，补齐 `attachments`/`tags`/`urgency`/`scheduledAt`/`prepareAt`/`followUpAt`/`snoozeUntil`/`sourceRef`/`parentOutcomeId`/`revision`/`kindMeta` 等字段），在 `OutcomeThreadTurn` 增加 `planMode`（`triage | advice | contract_plan`）和 `outcomeRevision`，在 `MemoryFact` 增加可空索引列 `sourceOutcomeId`（用于 `note` 共享记忆溯源清理），在 `Run` 增加可空索引列 `outcomeId`（用于 `scheduled_once` 正式执行回合租约与隔离），把 `TodoAutoAcceptRule` 收口为 `OutcomeAutoAcceptRule`，并直接删除 `OwnerTodoItem`、`ExploreIdea`、`OutcomePlanningDraft`、`OutcomeTrackingMode` 以及 `Routine` 的 `once`/`preparation` 字段（保留 Bot 内部 `TodoItem`）。
  - 做完你能看到什么：数据库模型变成干干净净的一套 `Outcome` 体系，Prisma Client 生成通过，不再有平行对象表。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 4、需求 7
    - `design.md` §3.2「数据结构」、§4.1「数据关系」、§8.2「彻底清理清单」
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`
    - `packages/db/prisma/migrations/`（新增重置/重构迁移）
    - `packages/db/scripts/deploy-schema.ts`（让既有 `db:push` 升级入口应用本次迁移）
  - 这一步先不做什么：先不改业务服务、路由和前端代码。
  - 怎么算完成：
    1. `OutcomeKind` 包含全部 6 种类型且索引完整
    2. 旧表模型与 `Routine` 的 `once`/`preparation` 列已从 Schema 移除
    3. Prisma 校验与 Client 生成成功
  - 怎么验证：
    - 运行 Prisma validate 与 generate 命令，检查生成的类型定义
  - 验证结果：`prisma validate`、`bun run typecheck`（含 Prisma Client 生成）通过，已核查生成类型。隔离 PostgreSQL 17 验证了 `db:push` 初始化、升级与重复运行，追踪目标、自动接受规则、周期和事件例程得以保留，旧一次性排期已退役，无 Bot 笔记可写入。7 项相关数据库集成测试通过。
  - 对应需求：`requirements.md` 需求 1 / 验收 1.1–1.2、需求 7 / 验收 7.1
  - 对应设计：`design.md` §3.2.1、§3.2.2、§4.1、§8.2

- [x] 1.2 重构 `packages/contracts` 统一 Outcome、PlanAdvice、AccessMode 与对话工具契约
  - 状态：DONE
  - 这一步到底做什么：定义统一的 `OutcomeKind`、`OutcomeDetail`、`OutcomeSummary`（`attachments` 直接复用现网 `AssetRef[]`）、统一列表查询（支持 `kinds`/`statuses`/`view=needs_me` 等）、统一创建/更新/演进/动作与 `POST /api/v0/outcomes/intake` 输入 Schema、`OutcomePlanAdvice`（`suggestedKind` 含 `explore_idea`）与 `OutcomeTriageResult` 结构化契约、`TurnAccessMode`（`full | research_readonly | readonly_strict`）以及精简后的统一 Outcome 对话工具与规划工具（新增 `SavePlanAdvice`、`ClassifyOutcome`）；同时移除旧的 `todo.ts` 独立契约、`explore.ts` 独立契约和 `Routine` 的 `once`/`DATED_ROUTINE_CRON`/`preparation` 契约。
  - 做完你能看到什么：前后端、Worker、Computer 共用同一份强类型契约，不再出现 `ScheduledGoalDetail`、`TodoItemView`、`ExploreIdeaView` 多套平行类型。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 5、需求 6、需求 7
    - `design.md` §3.2「数据结构」、§3.3「接口契约」
  - 主要改哪里：
    - `packages/contracts/src/outcomes.ts`
    - `packages/contracts/src/outcome-view.ts`
    - `packages/contracts/src/outcome-thread.ts`
    - `packages/contracts/src/outcome-chat.ts`
    - `packages/contracts/src/routine-types.ts`
    - `packages/contracts/src/task-overview.ts`
    - `packages/contracts/src/index.ts`
    - 删除或合并 `packages/contracts/src/todo.ts`、`packages/contracts/src/explore.ts`
  - 这一步先不做什么：先不修改 Server/Worker/Desktop 业务实现。
  - 怎么算完成：
    1. `packages/contracts` 类型检查与单测全部通过
    2. `SavePlanAdvice` 与 `TurnAccessMode` 已正式导出
    3. 旧平行对象契约已清理干净
  - 怎么验证：
    - 运行 `packages/contracts` 的 typecheck 与 unit tests
  - 验证结果：`bun run typecheck` 通过，354 项契约测试通过。
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 5、需求 6、需求 7、需求 8
  - 对应设计：`design.md` §3.2、§3.3

### 阶段检查

- [x] 1.3 阶段 1 检查点（Schema 与契约基线）
  - 状态：DONE
  - 这一步到底做什么：确认数据库 Schema 与共享契约已完全对齐，没有遗漏 6 种 `kind` 或 `PlanAdvice` / `AccessMode` 字段。
  - 做完你能看到什么：后续服务层、运行时和客户端改造有了稳固的类型基线。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 全部需求
    - `design.md` §3.2、§3.3、§4.2
  - 主要改哪里：仅修正阶段 1 发现的字段遗漏或类型不一致
  - 这一步先不做什么：不提前写 UI。
  - 怎么算完成：
    1. `packages/db` 与 `packages/contracts` 编译零报错
    2. 6 种 `kind` 字段与状态流转覆盖需求 1–6
  - 怎么验证：
    - 运行 `packages/db` 生成与 `packages/contracts` 类型检查
  - 验证结果：两个包的类型检查均通过。Prisma Client 与共享契约的 `kind`、状态、紧急度、执行归属、Plan 模式及回合枚举一致，`ComputerTurnRequest` 与三档 `TurnAccessMode` 一致。阶段 2 起继续接入业务状态流转与运行时。
  - 对应需求：`requirements.md` 需求 1–8
  - 对应设计：`design.md` §3.2、§3.3、§4

---

## 阶段 2：统一 Outcome 核心服务、排期调度与剥离 Routine 一次性逻辑

- [x] 2.1 整合 `OutcomeService`（覆盖 6 种 `kind`、原地演进与 `note` 共享记忆双向同步）
  - 状态：DONE
  - 这一步到底做什么：把原 `OwnerTodoService`（待办增改查、建议/接受/延后/完成/忽略/恢复/交给 Bot、来源授权校验、`OutcomeAutoAcceptRule` 以及被 `schedule`/`activity`/`external-calendar` 路由依赖的 `ownerForSession`/`attention`/`digest`）与 `ExploreService`（草稿/探索/丢弃）以及新增的 `note`（正文、附件、标签、归档/恢复、**通过 `MemoryFact.sourceOutcomeId` + 共享命名空间 `user:notes` 自动同步精简事实摘要并在 `agent-data.ts` 的 `recallMemory` 中纳入召回，编辑/归档/取消/关同步时按 `sourceOutcomeId` 自动撤销**）和 `scheduled_once`（改期、暂停、恢复、取消）全部整合进统一的 `OutcomeService`，并实现保持同一 `outcomeId` 的原地演进接口 `convert` 与「Go」收件源记录创建 `createIntake`（先提交落盘源 `note`，再独立尝试入队分诊，Planner 不可用时记录 `triageStatus="failed"` 且绝不回滚源笔记）。
  - 做完你能看到什么：所有 6 种目标/任务/笔记都在同一个 `OutcomeService` 中受咨询锁与 `revision` 乐观并发保护，笔记要点自动接入共享记忆，原地演进不产生重复对象、不丢历史。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 4、需求 8
    - `design.md` §2.3.1「统一对象创建与原地演进」、§2.3.4「统一 Go 收件流程与 `note` 共享记忆双向同步」、§3.3.1、§4.2「状态流转与原地演进矩阵」、§5「错误处理」、§6.8
  - 主要改哪里：
    - `apps/server/src/services/outcome-service.ts`
    - `apps/server/src/services/outcome-schedule-service.ts`
    - `packages/messaging/src/outcome-state.ts`
    - `packages/messaging/src/memory-facts.ts`
    - `packages/messaging/src/agent-data.ts`（`recallMemory` 纳入 `user:notes` 命名空间与 `noteId` 展示）
    - `packages/messaging/src/owner-todo-*.ts`（整合收口到 Outcome 模块）
  - 这一步先不做什么：先不改 Plan 引擎与 Computer 运行时权限。
  - 怎么算完成：
    1. 6 种 `kind` 的创建、查询、更新、动作与原地演进全部打通
    2. `note` 创建/编辑同步生成 ≤ 500 字 `MemoryFact`（带 `noteId` 溯源），归档/取消/关同步时自动撤销
    3. `todo` 来源门禁与自动接受规则完整保留（`owner_go_inbox` 来源直接建 `open`）
    4. `revision` 冲突与幂等重放行为正确
  - 怎么验证：
    - 编写并运行统一 `OutcomeService` 与 `note` 共享记忆同步隔离 DB 集成测试
  - 验证结果：隔离 PostgreSQL 17 中统一生命周期、附件保留、记忆同步和待办到期共 12 项集成测试通过；另有 14 项状态派生和标准任务回归测试通过。部分测试使用临时预载隔离未清理的 Routine 导出，未加入生产兼容层，阶段 2.3 将原生复跑。
  - 对应需求：`requirements.md` 需求 1、需求 2 / 验收 2.1–2.2、需求 3 / 验收 3.1–3.2、需求 4、需求 8 / 验收 8.3、8.5
  - 对应设计：`design.md` §2.3.1、§2.3.4、§3.3.1、§4.2、§5、§6.8

- [x] 2.2 实现 `Outcome(kind="scheduled_once")` 与到期主动巡检统一调度器，彻底剥离 `Routine` 一次性与准备逻辑
  - 状态：DONE
  - 这一步到底做什么：在 Outcome 调度器中实现 ① `scheduled_once` 到 `prepareAt` 自动触发统一 `plan(advice)`、到 `scheduledAt` 原子认领并注入当前修订 `advice` 正式执行（在 `Run` 上写入 `outcomeId`，并扩展 `worker.ts` 支持无 `outcomeWorkItemId` 的 `origin === "outcome"` 回合使用 `outcome:${outcomeId}` 作为上下文与租约 `scope`）以及 `WakeParent` 交付；② **保留并迁入到期主动巡检扫描**（读取 `taskPolicy["inspection.enabled"]` 与 `inspection.leadHours`，对即将到期的目标自动调用统一 `plan(mode="advice")` 并按修订幂等去重）；同时从 `packages/messaging/src/routines.ts`、`apps/server/src/services/dated-routine-schedule.ts` 和 `apps/worker/src/worker.ts` 中彻底删除 `scheduleKind="once"`、`DATED_ROUTINE_CRON`、`prepareOwner`、`enqueuePreparation`、`claimOnceRoutineExecution`、`scheduledGoal` 等一次性代码路径。
  - 做完你能看到什么：`Routine` 恢复纯粹的周期/事件例程，一次性定时任务与到期自动巡检全部由 Outcome 调度器统一走标准 Plan 管线。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 5 / 验收 5.1、需求 7
    - `design.md` §2.3.3「`scheduled_once` 定时准备、到点执行与到期主动巡检」、§6.5、§8.2
  - 主要改哪里：
    - `packages/messaging/src/routines.ts`
    - `apps/server/src/services/outcome-schedule-service.ts`
    - `apps/worker/src/worker.ts`
    - `packages/messaging/src/automation-results.ts`
    - 删除 `apps/server/src/services/dated-routine-schedule.ts`
  - 这一步先不做什么：先不清理旧 HTTP 路由（留到阶段 4 统一替换删除）。
  - 怎么算完成：
    1. `scheduled_once` 到点自动执行、注入当前修订 `advice` 并向主对话交付
    2. 改期后旧修订待执行准备回合自动失效，正式执行不会读取旧简报
    3. `inspection.enabled` 开启时，临期目标自动入队统一 `plan(mode="advice")` 且同修订不重复触发
    4. `Routine` 中无任何 `once` / `preparation` / `DATED_ROUTINE_CRON` 残留
  - 怎么验证：
    - 运行新的 `scheduled_once` 与自动巡检集成测试和现有周期/事件 `Routine` 回归测试
  - 验证结果：隔离 PostgreSQL 17 中，3 项新调度测试、6 项 Worker 隔离测试通过，覆盖并发去重、改期取消旧回合、建议注入、正式执行租约与 `WakeParent` 交付；107 项 Routine 回归通过。
  - 对应需求：`requirements.md` 需求 3 / 验收 3.1–3.4、需求 5 / 验收 5.1、需求 7 / 验收 7.1
  - 对应设计：`design.md` §2.3.3、§6.5、§8.2

### 阶段检查

- [x] 2.3 阶段 2 检查点（统一对象引擎与调度稳定）
  - 状态：DONE
  - 这一步到底做什么：确认 6 种 `OutcomeKind` 的存储、流转、演进与 `scheduled_once` 调度已经全部跑通，且 `Routine` 剥离无回归。
  - 做完你能看到什么：对象层与调度层完全统一，可放心进入 Plan 引擎改造。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 1–4
    - `design.md` §2.3.1、§2.3.3、§4.2、§6.1–6.2、§6.5
  - 主要改哪里：阶段 2 涉及的 Service 与 Messaging 文件
  - 这一步先不做什么：不提前改前端 UI。
  - 怎么算完成：
    1. 阶段 2 新增集成测试与周期例程回归测试全部通过
  - 怎么验证：
    - 运行 `packages/messaging` 与 `apps/server` 相关集成测试
  - 验证结果：隔离 PostgreSQL 17 中，20 个文件的 244 项生命周期、笔记、待办、附件、活动、排期、标准合同和 Routine 回归通过；另有 9 项新增调度与 Worker 测试通过。全程无需临时预载。旧路由和客户端的过渡类型错误仍待后续阶段清理。
  - 对应需求：`requirements.md` 需求 1–4
  - 对应设计：`design.md` §2.3.1、§2.3.3、§4.2

---

## 阶段 3：标准化 Plan 引擎与 `research_readonly` 运行时权限（方案 B）

- [x] 3.1 统一 `OutcomeThread` Plan 引擎，支持三档标准输出（`triage` / `advice` / `contract_plan`）、多模态附件与多轮追问
  - 状态：DONE
  - 这一步到底做什么：把 `OutcomeThreadService`、`outcome-threads.ts` 和 `OutcomeThreadTools` 升级为面向全部 6 种 `kind` 的统一规划引擎：新增 `plan(outcomeId, { mode, prompt, expectedRevision, workItemId })` 入口、`ClassifyOutcome` 工具（支持单落点原地 `convert`、或保留源 `note` 并拆出多条 `parentOutcomeId` 关联子项，且对 `owner_go_inbox` 来源待办直通 `open`、对 `standard` 自动续发 `contract_plan`）与 `SavePlanAdvice` 工具（持久化标准 `facts`/`gaps`/`recommendations`/`summary`）；透传 `Outcome.attachments` 多模态图片/文件给规划回合；收敛原 `inspection` 为 `plan(mode="advice")`；统一规划 Bot 不可用时的回退策略（有 `outcome.botId` 回退，否则报 `409 planner_unavailable`）；删除 `OutcomePlanningService` 与 `outcome-inspections.ts`。
  - 做完你能看到什么：不管是「Go」收件自动分诊（单落点或同源多条拆分），还是对任意 `note`/`todo`/`explore_idea`/`scheduled_once`/`standard` 发起只读调研或正式规划，全部走同一条标准化规划管线。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 5、需求 8
    - `design.md` §2.3.2「标准化 Plan 流程」、§2.3.4「统一 Go 收件流程」、§3.2.3、§6.6、§6.7
  - 主要改哪里：
    - `apps/server/src/services/outcome-thread-service.ts`
    - `apps/server/src/services/outcome-thread-tools.ts`
    - `packages/messaging/src/outcome-threads.ts`
    - `packages/messaging/src/outcome-roles.ts`
    - 删除 `apps/server/src/services/outcome-planning-service.ts`、`packages/messaging/src/outcome-inspections.ts`
  - 这一步先不做什么：先不改前端详情页。
  - 怎么算完成：
    1. 6 种 `kind` 均可通过统一 `plan` 方法入队并结算
    2. `triage` 模式调用 `ClassifyOutcome` 完成单落点原地转换与同源多条拆分，且「Go」来源待办直通 `open`
    3. `advice` 模式调用 `SavePlanAdvice` 落盘结构化 JSON（未调用时有最终文本兜底）
    4. 同一修订同模式并发/重放幂等不重复入队
  - 怎么验证：
    - 编写并运行统一 Plan 与 `ClassifyOutcome` 分诊集成测试
  - 验证结果：隔离 PostgreSQL 17 中，统一 Plan、分诊原子性、收件防丢稿、目标聊天、到期调度与 Worker 隔离共 41 项通过。覆盖建议结构化保存与文本兜底、附件入队、追问、修订去重及 `standard` 后续规划。
  - 对应需求：`requirements.md` 需求 5 / 验收 5.1–5.5、需求 8 / 验收 8.3–8.6
  - 对应设计：`design.md` §2.3.2、§2.3.4、§3.2.3、§6.6、§6.7

- [x] 3.2 落地 `accessMode: "research_readonly"`（方案 B）与目标 Bot 只读 MCP / 记忆 / 对话借用机制
  - 状态：DONE
  - 这一步到底做什么：
    1. 在 Worker 中为所有 Plan / Triage / Replan / Advice 回合设置 `accessMode: "research_readonly"`，透传源 `Outcome.attachments`（多模态图片/附件），并在独立规划 Bot 与 `outcome.botId` 不同时传递 `borrowedBotId = outcome.botId`，合并加载目标 Bot 的只读 MCP / 私有技能说明与上下文提示；
    2. 在 Computer `tools.ts` 与 `dynamic-catalog.ts` 中用 `accessMode` 替代粗糙的 `readOnly` 布尔与 `purpose === "inspection"` 硬锁：在 `research_readonly` 下**开放 `ListMachines` + `Read(machineId)` + `Shell(machineId)` + `AwaitShell(machineId)`**（方案 B，并在提示词强调本机 Shell 仅限只读调研），放行只读 MCP（`readOnlyHint: true` / `risk === "read"` / 只读白名单）和规划专用工具（含 `triage` 模式的 `ClassifyOutcome`），硬拦截写类 MCP、`SendToUser`、`WakeParent`、`UpdateRoutine`、`CopyToBox`/`CopyFromBox` 等副作用工具；
    3. 在 Server `InternalToolService` 中完善 `research_readonly` 借用与门禁：① `PluginCall` 做服务端二次只读校验，支持借用 `borrowedBotId` 权限并记录审计字段；② `RecallMemory` 合并查询 `[request.botId, borrowedBotId]` 的记忆范围（含笔记同步的共享记忆）；③ `ReadTranscript` 允许只读查阅 `borrowedBotId` 所属主对话历史。
  - 做完你能看到什么：配置了独立规划 Bot 时，不管是收件分诊、`scheduled_once` 运行建议还是 `standard` 目标规划，都能真正读到本机文档、用户上传的图片/附件、业务 Bot 的只读 MCP、共享记忆与对话上下文，同时代码层严格防止越权写操作。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §3.3.3「Computer 运行时 `accessMode` 与目标 Bot 只读 MCP 借用机制」、§6.4
  - 主要改哪里：
    - `apps/worker/src/worker.ts`
    - `apps/worker/src/plugins.ts`
    - `apps/computer/src/runtime.ts`
    - `apps/computer/src/runtime/types.ts`
    - `apps/computer/src/runtime/tools.ts`
    - `apps/computer/src/runtime/dynamic-catalog.ts`
    - `apps/computer/src/runtime/readonly-connectors.ts`
    - `apps/server/src/services/internal-tool-service.ts`
  - 这一步先不做什么：此时先不重建远端 Debug Computer（集中到阶段 6 征得同意后同步）。
  - 怎么算完成：
    1. Computer 单测验证 `research_readonly` 放行方案 B 本机工具与只读 MCP，硬拒写类 MCP、`WakeParent`、`SendToUser`、`CopyToBox`
    2. Server `InternalToolService` 单测/集成测试验证借用 `outcome.botId` 只读 MCP、`RecallMemory` 与 `ReadTranscript` 成功，且写类 MCP 返回 `403 readonly_mcp_tool_required`
    3. `purpose === "inspection"` 只允许 `GetOutcome` 的硬锁已移除
  - 怎么验证：
    - 运行 `apps/computer`、`apps/worker`、`apps/server` 权限与工具门禁测试
  - 验证结果：Computer 权限回归 88 项、Worker 聚焦回归 31 项及 Server 隔离 PostgreSQL 权限测试 4 项通过。验证了四个本机调研工具、独立规划 Bot 的记忆与对话读取范围、MCP 审计与拒写；工具目录转换后保留明确的拒绝标记。
  - 对应需求：`requirements.md` 需求 6 / 验收 6.1–6.5
  - 对应设计：`design.md` §3.3.3、§6.4

### 阶段检查

- [x] 3.3 阶段 3 检查点（标准 Plan 引擎与权限闭环）
  - 状态：DONE
  - 这一步到底做什么：端到端核验统一 Plan 引擎在 Worker → Computer → Server 工具回调上的完整闭环。
  - 做完你能看到什么：后端与运行时层面已经具备统一、高准确度、可复用的只读调研规划能力。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6
    - `design.md` §2.3.2、§3.3.3、§6.4、§6.6
  - 主要改哪里：阶段 3 相关文件
  - 这一步先不做什么：不提前改移动端。
  - 怎么算完成：
    1. `packages/messaging`、`apps/worker`、`apps/computer`、`apps/server` 全部类型检查与相关测试通过
  - 怎么验证：
    - 运行相关包的 typecheck 与 test
  - 对应需求：`requirements.md` 需求 5、需求 6
  - 对应设计：`design.md` §2.3.2、§3.3.3

---

## 阶段 4：统一 HTTP API、统一对话工具、读模型改造与彻底删除旧代码

- [x] 4.1 重构 HTTP 路由与 `AppService`，新增 `/intake` 并彻底删除旧路由与旧服务
  - 状态：DONE
  - 这一步到底做什么：在 `apps/server/src/routes/outcome.ts` 实现统一的 `/api/v0/outcomes*` 全套接口（列表多 `kind` 与 `view=needs_me` 筛选、统一创建/更新、`/intake` 收件复用现有 `POST /api/assets` 提供的 `AssetRef`、`/convert` 原地演进、`/actions`、`/plan`、`/auto-accept-rules*`），同步将 `routes/schedule.ts`、`routes/activity.ts`、`routes/external-calendar.ts` 对 `OwnerTodoService` 的依赖切换至 `OutcomeService`，并彻底删除 `routes/todos.ts`、`routes/explore.ts`、`owner-todo-service.ts`、`explore-service.ts`、`explore-state.ts`、`todo-auto-accept.ts`（保留 Bot 内部 `todo-service.ts`）以及 `routes/routine.ts` 中的 `/prepare` 与 `/api/outcomes/scheduled-goals*`。
  - 做完你能看到什么：服务端只有一套干净统一的 `/api/v0/outcomes*` API，旧路由全部返回 `404`，零兼容代理层。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 1–5、需求 7、需求 8
    - `design.md` §3.3.1「统一 Outcome HTTP API」、§8.2「彻底清理清单」
  - 主要改哪里：
    - `apps/server/src/routes/outcome.ts`
    - `apps/server/src/routes/routine.ts`
    - `apps/server/src/routes/schedule.ts`
    - `apps/server/src/routes/activity.ts`
    - `apps/server/src/routes/external-calendar.ts`
    - `apps/server/src/app-service.ts`
    - `apps/server/src/main.ts`（路由注册处）
    - 删除 `apps/server/src/routes/todos.ts`、`apps/server/src/routes/explore.ts` 及对应旧服务文件
  - 这一步先不做什么：先不改 Desktop/Mobile 代码。
  - 怎么算完成：
    1. 所有新统一路由（含 `/intake` 与 `/attachments`）按契约工作
    2. 所有旧路由与旧服务文件已物理删除，全仓无残余 import
  - 怎么验证：
    - 运行路由集成测试，验证新接口通过且旧路由返回 `404`
  - 对应需求：`requirements.md` 需求 1–5、需求 7 / 验收 7.1、需求 8 / 验收 8.3
  - 对应设计：`design.md` §3.3.1、§8.2
  - 验证结果：独立 PostgreSQL 17 中，统一路由与旧路由 14 项测试通过，共 86 项断言。覆盖认证收件 `202`、所有者派生、列表/详情/简报/评审/运行时/排期、所有者隔离，以及 `/explore`、`/todos`、旧 scheduled-goal、旧 Routine prepare/thread/plan 路径返回 `404`。

- [x] 4.2 统一对话侧 Outcome 工具（支持 `note` 增改查）并改造活动视图/日历/ICS 读模型
  - 状态：DONE
  - 这一步到底做什么：
    1. 重构 `OutcomeChatTools` 为统一的 6 个对话工具（`CreateOutcome`、`UpdateOutcome`、`QueryOutcomes`、`GetOutcome`、`ActOnOutcome`、`PlanOutcome`），使 Bot 在对话中可直接创建/更新/检索 `note` 及其他 5 种类型，移除独立 `TODO_TOOLS` 和 `SubmitOutcome` 旁路；
    2. 改造 `ScheduleService`、`ActivityService` 和 `CalendarFeedService` 改为单源查询 `Outcome` 表，确保 `note` 仅在设置了 `scheduledAt` 或 `dueAt` 时进入日历与 ICS 订阅。
  - 做完你能看到什么：Bot 对话工具显著精简统一，且能顺畅管理笔记；日历和总览从单张 `Outcome` 表读取，逻辑大幅简化。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 7
    - `design.md` §3.3.2「统一 Agent 对话工具集」、§4.3「日历与工作区视图派生规则」、§6.3
  - 主要改哪里：
    - `apps/server/src/services/outcome-chat-tools.ts`
    - `apps/server/src/services/internal-tool-service.ts`
    - `apps/server/src/services/schedule-service.ts`
    - `apps/server/src/services/activity-service.ts`
    - `apps/server/src/services/calendar-feed-service.ts`（或对应日历订阅服务）
    - `apps/computer/src/runtime/dynamic-catalog.ts`
    - `packages/messaging/src/index.ts`（精简对话提示词）
  - 这一步先不做什么：先不改客户端 UI。
  - 怎么算完成：
    1. Bot 对话工具可创建、更新、按关键词/标签检索 `note` 以及操作其他 `kind`
    2. 无时间的 `note` 不出现在日历中，设置时间后正常出现并支持改期
  - 怎么验证：
    - 运行对话工具测试、`ScheduleService` 日历过滤测试与 `ActivityService` 测试
  - 对应需求：`requirements.md` 需求 2 / 验收 2.1–2.2、2.4、需求 7 / 验收 7.2
  - 对应设计：`design.md` §3.3.2、§4.3、§6.3

### 阶段检查

- [x] 4.3 阶段 4 检查点（服务端全面收口）
  - 状态：DONE
  - 这一步到底做什么：确认 Server + Messaging + Worker + Computer 全部编译通过且旧服务/旧路由已清零。
  - 做完你能看到什么：整个后端已彻底切换至统一 Outcome 体系。
  - 先依赖什么：4.1、4.2
  - 开始前先看：
    - `design.md` §3.3、§8.2
  - 主要改哪里：后端各包
  - 这一步先不做什么：暂不触碰前端页面。
  - 怎么算完成：
    1. `rg` 搜索旧表名、旧服务名、旧路由路径在后端源码中零残留
    2. 后端全量 typecheck 与核心测试通过
  - 怎么验证：
    - 执行全局 `rg` 核查与后端 typecheck/test
  - 验证结果：全仓 `rg` 核查确认后端源码中旧表、旧路由与旧服务零残留（`todo-service.ts` 已保留），`bun run typecheck` 15/15 包通过，`packages/contracts` 与 `packages/client-core` 451 项测试全部通过。
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §8.2

---

## 阶段 5：多端适配（Client SDK / Desktop / Mobile）

- [x] 5.1 改造 `packages/client-core` 与 Desktop 统一客户端 API
  - 状态：DONE
  - 这一步到底做什么：在 `packages/client-core` 和 `apps/desktop/src/renderer/client/outcome-api.ts` 中对齐统一 `/api/v0/outcomes*` 方法（支持 `kinds`/`view` 筛选、统一 `create`/`intake`/`update`/`convert`/`act`/`plan` 与 `autoAcceptRules`，附件上传直接复用现有 `/api/assets` 客户端方法），删除 `todo-api.ts` 以及 `client-core` 中的 `prepareRoutine`、`scheduledGoals`、`scheduledGoal` 旧方法。
  - 做完你能看到什么：桌面端与共享 SDK 只保留一套干净的 Outcome 客户端。
  - 先依赖什么：4.3
  - 开始前先看：
    - `requirements.md` 需求 7、需求 8
    - `design.md` §3.3.1、§8.2
  - 主要改哪里：
    - `packages/client-core/src/client.ts`
    - `apps/desktop/src/renderer/client/outcome-api.ts`
    - `apps/desktop/src/renderer/client/outcomego-api.ts`
    - 删除 `apps/desktop/src/renderer/client/todo-api.ts`
  - 这一步先不做什么：先不改业务页面组件。
  - 怎么算完成：
    1. `packages/client-core` 编译与单测通过
    2. 桌面端不再引用 `todo-api.ts` 或旧例程建议接口
  - 怎么验证：
    - 运行 `packages/client-core` 测试与类型检查
  - 对应需求：`requirements.md` 需求 7 / 验收 7.1、7.3、需求 8 / 验收 8.3
  - 对应设计：`design.md` §3.3.1、§8.2

- [x] 5.2 重构 Desktop 目标工作区：统一「Go / 随便记点什么」收件弹窗、统一列表与「笔记」筛选、统一详情与 Plan 面板、日历适配
  - 状态：DONE
  - 这一步到底做什么：
    1. **落地统一「Go / 随便记点什么」入口与收件弹窗**：将目标页右上角 `+ 新建目标` 改为 **`Go`**，移除概览工具栏的「记录想法」按钮，侧栏快速记录小灯泡同步打开同一模态框（标题「随便记点什么」，复用 `dock-composer.tsx` 的文本 + `@Bot` + 图片粘贴预览 + 文件附件交互，回车或点击 `Go` 后立即关闭弹窗并在后台走 `/outcomes/intake` 异步分诊，完成后弹出可直达/可改判的轻量 Toast）；
    2. 承接已精简的概览页结构（置顶紧凑可点击状态条 + 「需要我处理」+ 合并后的「进行中」且无空态新建按钮 + 按需「即将执行」；「需要处理」内含「待办」子筛选），在「全部」视图按 6 种 `kind` 提供清晰筛选（含独立的「笔记」分类），移除独立的 `ScheduledRoutineGoals` 和旧 `ExplorePanel`；
    3. 统一详情页（`outcome-detail.tsx`）：展示挂载的图片/附件预览，按 `kind` 展示对应操作栏（`note` 正文/标签/共享记忆同步开关/时间编辑、以及同源拆分出的子项列表；`todo` 接受/延后/完成/忽略/交 Bot；`scheduled_once` 改期/暂停/恢复/取消；`standard` 合同与审批），全部复用同一个「运行建议 / 规划（Plan）」交互区（展示结构化 `facts`、`gaps`、`recommendations` 与多轮追问）以及「原地演进（升级为目标/转为待办/设为排期/改判）」入口，删除 `scheduled-goal-detail.tsx`；
    4. 更新 `calendar-page.tsx` 与 `outcome-dashboard.tsx`，点击日历中的 `scheduled_once` / `todo` / 带时间 `note` 全部打开统一 `Outcome` 详情抽屉，并补齐中英文 `i18n-catalog.ts` 文案。
  - 做完你能看到什么：用户点一下「Go」就能在「随便记点什么」里随手丢入文字、图片或文件，后台自动识别归类或同源拆分；在统一工作区里管理全部 6 种类型，任意条目都能原地生成带来源的结构化运行建议或升格为正式目标。
  - 先依赖什么：5.1
  - 开始前先看：
    - `requirements.md` 需求 1–5、需求 7、需求 8
    - `design.md` §2.3.4、§3.2.3、§4.3、§8.2
  - 主要改哪里：
    - `apps/desktop/src/renderer/App.tsx`（侧栏小灯泡接入「Go」弹窗）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/inbox/outcome-workspace.tsx`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/inbox/outcome-inbox.tsx`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/explore/quick-idea-dialog.tsx`（升级为「随便记点什么」Go 弹窗或由新收件弹窗替代）
    - `apps/desktop/src/renderer/botdock/dock-composer.tsx`（抽离可复用的附件与输入组件）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/outcome-list.tsx`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/detail/outcome-detail.tsx`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/outcome-dashboard.tsx`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/todo-panel.tsx`（并入或简化为统一列表子视图）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/calendar/calendar-page.tsx`
    - `apps/desktop/src/renderer/components/outcomego/routine-panel.tsx`（移除 `once`/`preparation` 展示分支）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/thread/new-outcome-form.tsx`（清理旧 `exploreIdeaId` 分支）
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
    - 删除 `scheduled-goal-detail.tsx`、`scheduled-routine-goals.tsx`、`explore-panel.tsx`、`explore-api.ts`、`quick-idea-form.tsx`、`todo-handoff.tsx` 等冗余组件（**保留**被多组件复用的 `outcomes/planning/outcome-client.ts`）
  - 这一步先不做什么：先不改移动端。
  - 怎么算完成：
    1. 「Go / 随便记点什么」支持文本、`@Bot`、图片、附件、回车/点击提交立即关闭与后台分诊通知
    2. 6 种 `kind` 在列表、筛选（含「笔记」）、详情（含附件与同源子项）、日历均可正常交互
    3. 统一 Plan 面板能展示结构化 `advice` 并支持原地演进
    4. Desktop TypeScript 检查与组件测试通过
  - 怎么验证：
    - 运行 `apps/desktop` typecheck 与组件聚焦测试
  - 验证结果：已补齐 `GoIntakeForm` 剪贴板粘贴图片/文件与附件体积校验、后台分诊完成/失败实时 Toast 通知（支持直达与一键改判）及 `triageStatus="failed"` 重试入口、统一详情页同源子项/源笔记关联（`OutcomeRelationsPanel`）、`NotePanel` 日历时间与归档/取消、`TodoDetailPanel` 生命周期操作栏、`OutcomeEvolutionPanel` 完整演进矩阵（含 `ScheduledOutcomeDetail` 原地演进），修复了 `requestUnifiedPlan` 的 `expectedRevision` 传参，并彻底删除 `outcomes/explore/`（`explore-panel.tsx`、`quick-idea-form.tsx`、`quick-idea-dialog.tsx`、`explore-state.ts`）与 `todo-handoff.tsx`。全仓 `bun run typecheck`（15/15）与 Desktop Outcome 相关 160 项测试全部通过。
  - 对应需求：`requirements.md` 需求 1–5、需求 7 / 验收 7.3、需求 8 / 验收 8.1–8.2、8.6
  - 对应设计：`design.md` §2.3.4、§3.2.3、§4.3、§8.2

- [x] 5.3 适配移动端（KMP `mobile/shared`、Android 与 iOS）至统一 `/api/v0/outcomes` 接口
  - 状态：DONE
  - 这一步到底做什么：
    1. 把 `mobile/shared` 中的 `OutcomeExplore.kt`、`Outcomes.kt` 及单测从 `/api/v0/explore` 迁移到统一的 `/api/v0/outcomes`（支持 `kind` 字段与 `kinds=explore_idea` 等筛选）；
    2. 把 Android `apps/android/app/src/main/kotlin/com/outcomego/features/LiveFeatureGateway.kt`、`FeatureContracts.kt`、`OutcomeWorkspaceScreen.kt` 及 `MobileTodoGatewayTest.kt` 中对 `/api/v0/todos`（改用 `/api/v0/outcomes?kinds=todo&view=needs_me` 与 `POST /api/v0/outcomes/:id/actions`）与 `/api/v0/explore` / `exploreIdeaId` 的调用切换至统一的 `/api/v0/outcomes`；
    3. 把 iOS `apps/ios/Sources/Core/MobileTodo.swift`、`OutcomeThread.swift`（清理 `exploreIdeaId`）及 `apps/ios/Tests/CoreTests/TransportTests.swift` 中对 `/api/v0/todos` 的调用切换至统一的 `/api/v0/outcomes` 接口；
    4. 移除移动端全部旧 `/api/v0/explore` 与 `/api/v0/todos` 路径引用。
  - 做完你能看到什么：Android、iOS 与 KMP 共享层全部与新服务端 API 对齐，删除旧路由后移动端待办与探索功能正常可用。
  - 先依赖什么：4.3
  - 开始前先看：
    - `requirements.md` 需求 7 / 验收 7.4
    - `design.md` §3.3.1
  - 主要改哪里：
    - `mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/Outcomes.kt`
    - `mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/OutcomeExplore.kt`
    - `mobile/shared/src/commonTest/kotlin/com/outcomego/mobile/core/` 下对应单测
    - `apps/android/app/src/main/kotlin/com/outcomego/features/LiveFeatureGateway.kt`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/FeatureContracts.kt`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/OutcomeWorkspaceScreen.kt`
    - `apps/android/app/src/test/kotlin/com/outcomego/features/MobileTodoGatewayTest.kt`
    - `apps/ios/Sources/Core/MobileTodo.swift`
    - `apps/ios/Sources/Core/OutcomeThread.swift`
    - `apps/ios/Tests/CoreTests/TransportTests.swift`
  - 这一步先不做什么：不在本次扩展移动端完整笔记/日历 UI（仅确保现有功能与接口完全兼容新架构）。
  - 怎么算完成：
    1. `mobile/`、`apps/android/`、`apps/ios/` 下不再存在 `/api/v0/explore` 与 `/api/v0/todos` 引用
    2. 移动端共享核心测试、Android 单测/打包（按需使用 `bash scripts/android/package-debug.sh`）与 iOS 核心单测通过
  - 怎么验证：
    - 运行移动端单测与 `rg` 路径核查
  - 对应需求：`requirements.md` 需求 7 / 验收 7.4
  - 对应设计：`design.md` §3.3.1

### 阶段检查

- [ ] 5.4 阶段 5 检查点（全端适配完成）
  - 状态：IN_REVIEW
  - 这一步到底做什么：确认 SDK、Desktop、Mobile 均已切换到统一 Outcome 接口并通过本地测试。
  - 做完你能看到什么：前后端全链路类型、接口和界面已经完全一致。
  - 先依赖什么：5.1、5.2、5.3
  - 开始前先看：
    - `requirements.md` 全部需求
    - `design.md` §7「测试策略」
  - 主要改哪里：阶段 5 相关文件
  - 这一步先不做什么：不新增超出 Spec 范围的新功能。
  - 怎么算完成：
    1. 全仓 typecheck 与单元测试通过
  - 怎么验证：
    - 运行 monorepo 类型检查与测试套件
  - 验证结果：全仓 `bun run typecheck`（15/15）、`packages/contracts` + `packages/client-core`（451 项）、Desktop Outcome 测试（160 项）、iOS 核心测试（342 项）及旧组件/旧路由清理核查均通过；Android Gradle 单测/打包因本机缺少 Java Runtime 暂未执行，待配置 JDK 后补跑。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §7

---

## 阶段 6：全链路测试、远端 Computer 同步与最终验收

- [ ] 6.1 同步并重建远端 Debug Computer，完成真实场景联调验证
  - 状态：IN_PROGRESS
  - 这一步到底做什么：先 `rsync -n` 干跑比对差异并备份远端文件，**征得用户明确同意后**按 `AGENTS.md` 同步 `apps/computer`、`packages/contracts` 等目录到 `ubuntu@10.255.0.45:~/openteam-debug/` 并同时重建 `computer` 与 `computer-memory-init` 容器；随后跑 `scripts/dev/debug.sh check` 并实机验证：
    1. 通过「Go / 随便记点什么」提交带截图/附件的复合记录，验证弹窗立即关闭、后台由 Plan Pi Agent 自动归类/拆出多条关联子项（待办直通 `open`，源记录落为 `note` 并同步到共享记忆）；
    2. 独立规划 Bot 对涉及本机文档 + 业务 Bot MCP + 共享记忆笔记的 `scheduled_once` / `todo` 生成高准确度运行建议；
    3. 对话创建/更新/检索 `note`、工作区「全部 / 笔记」展示及日历显隐、编辑/归档同步清理共享记忆；
    4. `note` / `todo` / `scheduled_once` 原地演进为 `standard` 正式目标并保留规划上下文。
  - 做完你能看到什么：在真实桌面端 + 远端 Computer 环境下，统一 Outcome 与标准化 Plan 全链路实际可用。
  - 先依赖什么：5.4
  - 开始前先看：
    - `AGENTS.md`「Remote Debug Computer」章节
    - `design.md` §7.3「端到端与实机验证」、§8.1「风险与缓解」
  - 主要改哪里：远端 `~/openteam-debug/`（同步）及 `specs/004.11-Outcome统一模型与标准化规划/docs/20261126-验收结果.md`
  - 这一步先不做什么：严禁触碰 `~/openteam`（`openteam-dev`）或 `~/openteam-debug/data`。
  - 怎么算完成：
    1. `docker ps` 显示 `openteam-debug-computer-1` 为 `healthy` 且 `scripts/dev/debug.sh check` 通过
    2. 四条真实场景验收通过并留存验证记录
  - 怎么验证：
    - `scripts/dev/debug.sh check` + 桌面端实机走查
  - 验证结果：2026-11-27 已征得用户同意，完成 `rsync -n` 干跑比对、远端备份（`~/openteam-debug-backups/20261127-spec004.11-pre-sync.tar.gz`）、源码同步与旧文件清理，并重建 `openteam-debug-computer-1`（`healthy`）与 `openteam-debug-computer-memory-init-1`（`Up`）；`scripts/dev/debug.sh check` 验证共享目录、数据库、Computer 就绪（`http://10.255.0.45:18790`）、浏览器网络与外网均正常（仅远端 `.env` 中 `OUTCOMEGO_DEBUG_SERVER_URL` 变量名与脚本检测不一致提示，未触碰 `.env`）。待在桌面端完成 4 条真实场景走查后关闭本项。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §7.3、§8.1

### 最终检查

- [ ] 6.2 最终检查点
  - 状态：IN_PROGRESS
  - 这一步到底做什么：逐项对照 `requirements.md` 验收标准、`design.md` 正确性属性与清理清单，确认所有任务均已完成且状态已回写。
  - 做完你能看到什么：Spec 004.11 完整闭环，无残留旧代码、无未追踪缺口。
  - 先依赖什么：6.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：更新本 Spec 文档状态与验收记录
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. 所有需求、设计章节、任务与测试验证一一闭合
    2. 全仓无旧表、旧服务、旧路由死代码残留
    3. Spec 文档状态更新为最终状态
  - 怎么验证：
    - 按 `design.md` §7.4 验证映射逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
