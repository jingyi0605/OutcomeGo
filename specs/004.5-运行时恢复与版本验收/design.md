# 设计文档 - 运行时恢复与版本验收

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. Checkpoint

Checkpoint 保存：

- `outcome_id`
- `contract_revision`
- `run_id`
- 最近完成的 WorkItem
- 下一步动作
- 当前阻塞或 Decision
- 已创建输出和 Evidence 引用
- 当前预算或重试计数（如果已有）
- 外部动作回执（如果已有）

Checkpoint 只服务于已有 Run 恢复，不作为新的任务系统。

## 2. 事件幂等

每个业务事件使用 `event_id`。处理器需要在应用业务结果前检查事件是否已处理。结果写入和处理记录必须在同一可靠事务边界内，或使用当前数据库和事件机制支持的等价方案。

## 3. 重试

重试分类：

- 可安全重复的内部计算：允许有限重试。
- 有明确幂等键的外部动作：根据回执和幂等键重试。
- 无法确认是否发生的外部动作：暂停并进入 Decision 或人工处理。

不建设全局自动重试平台。

## 4. 必要动作判断

动作判断只针对当前产品流程已经使用的动作，并以简单结果表达：

```text
ALLOW
NEEDS_USER_DECISION
MANUAL_ACTION
UNSUPPORTED
```

- `ALLOW`：当前 Contract 和实现范围内可继续。
- `NEEDS_USER_DECISION`：需要用户选择或批准。
- `MANUAL_ACTION`：必须由人执行。
- `UNSUPPORTED`：当前路径不支持，不能伪装成自动完成。

该判断是产品流程路由，不是权限判断：它决定 WorkItem 下一步交给谁，不检查、不阻止任何工具动作（父 design.md §40）。

## 5. 指标

最低指标：

- 每个 Outcome 的用户介入次数 N。
- 用户规划、决策和验收时间 T。
- 验收质量 Q。
- 主动通知数量及其中需要行动的数量。
- 恢复成功和重复处理结果。

先记录基线，不提前设定未经确认的效率提升百分比。

## 6. 最终验收顺序

```text
旧版本升级
  → Outcome 规划
  → Contract 批准
  → OpenTeam 执行
  → Evidence 验收
  → Decision 解决
  → 人工任务回执
  → 重启和重复事件回放
  → 下一版本发布检查
```

## 7. 当前代码基线

| 现有能力 | 文件/模型 | 本阶段处理 |
|---|---|---|
| 事件日志 | `packages/db/prisma/schema.prisma` 的 `Event` | 复用 topic/entity/schemaVersion，增加 Outcome 事件主题 |
| 请求幂等 | `IdempotencyRecord` | 复用 scope/key/requestHash/response，不另建通用幂等表 |
| 外发重试 | `OutboxDelivery`、`apps/worker/src/push-notifications.ts` | 只扩展 Outcome 通知或现有外部动作 |
| Run lease | `BotRunLease`、`apps/worker` | 复用 heartbeat/expiry，恢复时重新检查 Run |
| Run progress | `Run.requestProgress`、`requestRevision`、`requestNextCheckAt` | 若字段可表达 Checkpoint，优先扩展 JSON schema |
| 启动恢复 | `apps/server/src/services/startup-recovery.ts` | 增加 Outcome/WorkItem 遗留状态扫描 |
| Run 取消 | `apps/server/src/services/run-service.ts` | 使用现有 cancel/stop 语义，不增加新取消原因 |

## 8. Checkpoint 数据合同

```ts
interface OutcomeCheckpoint {
  id: string;
  outcomeId: string;
  contractRevision: number;
  workItemId?: string;
  runId?: string;
  sequence: number;
  status: "running" | "waiting_decision" | "waiting_human" | "retrying" | "needs_review";
  completedItems: string[];
  nextAction?: { type: string; summary: string; idempotencyKey?: string };
  outputRefs: string[];
  evidenceRefs: string[];
  decisionId?: string;
  sideEffectReceipts?: Array<{ key: string; status: "confirmed" | "unknown" | "not_started"; ref?: string }>;
  createdAt: string;
}
```

如果使用 `Run.requestProgress` 保存，必须增加 runtime schema validator 和版本字段；如果需要跨多个 WorkItem 查询，新增 `OutcomeCheckpoint` 表。选择理由必须写入任务证据。

Checkpoint 写入时机：

1. WorkItem 开始前。
2. WorkItem 成功并产生 Output 后。
3. 创建 Decision 或 HumanAction 后。
4. 触发需要回执的外部动作前后。
5. Run 失败、取消和恢复完成时。

## 9. 幂等处理合同

业务 key 规则：

```text
outcome-run:<outcomeId>:<contractRevision>:<workItemId>
outcome-event:<eventId>
decision-resolve:<decisionId>:<clientRequestId>
human-receipt:<workItemId>:<clientRequestId>
outcome-notification:<factType>:<factId>
```

处理器必须检查：

1. key 是否已存在。
2. request hash 是否一致。
3. 现有对象是否已经终态。
4. 结果是否可以安全重放。

hash 不一致返回 `409 idempotency_conflict`；已经完成返回第一次响应；处理中返回 `409 request_in_progress` 或现有项目约定的等价错误。

## 10. 恢复状态机

本状态机就是父 design.md §42.2 的 Agent WorkItem 状态，不另起一套恢复状态。Human WorkItem 的等待由 `004.4` §16 的状态机表达，这里不重复定义 `waiting_human`。

```text
running
  → retry_pending       （内部可重试失败）
  → waiting_decision    （需要用户选择）
  → needs_review        （外部副作用未知或状态不一致）
  → completed
  → failed

retry_pending → running | failed | waiting_decision
waiting_decision → running | cancelled（revision 被替代时）
needs_review → running | cancelled | completed
```

状态转换必须携带 `transitionReason` 和 `checkpointId`。恢复逻辑不依据 Agent 自报文本判断状态，只读取数据库状态、事件和回执。

## 11. 必要动作分流器

```ts
type ActionDecision =
  | { kind: "ALLOW"; workItemId: string }
  | { kind: "NEEDS_USER_DECISION"; decisionId: string }
  | { kind: "MANUAL_ACTION"; workItemId: string }
  | { kind: "UNSUPPORTED"; actionType: string; reason: string };
```

分流输入是 `contractRevision`、WorkItem executor type、当前 action type 和已知回执。它不是模型生成的权限令牌，也不负责理解所有插件/MCP 工具。

## 12. 运行时恢复流程

```text
服务启动
  → 找出非终态 Outcome/Run
  → 读取最新 Checkpoint
  → 检查 Contract revision 是否仍有效
  → 检查 lease 是否过期
  → 检查最后一个动作的回执
  → queued / waiting / needs_review
  → 写入 recovery event
  → 唤醒现有 Worker 或生成 Decision
```

服务启动不得盲目重新执行所有 `running` Run。没有 Checkpoint、revision 已 superseded 或副作用状态 unknown 的 Run 进入 `needs_review`。

## 13. 指标和查询

最低指标：

```text
outcomeId, runId, contractRevision,
humanInterventionCount,
planningStartedAt, approvalAt, firstRunAt, acceptedAt,
decisionCount, notificationCount, retryCount,
recoveryCount, duplicateEventCount, lastErrorCode
```

指标只做事实记录，不在本阶段创建复杂 dashboard。可以提供管理查询或 JSON 导出用于 N/T/Q 基线。

## 14. 最终发布检查

必须按以下顺序执行：

1. `004.1` 旧版本升级和 OutcomeGo 安装。
2. `004.2` 研究任务规划、批准、Run、Evidence 和 Review。
3. `004.3` Decision 创建、通知、resolve 和恢复。
4. `004.4` 资料、人工动作卡、回执和验收。
5. Server/Worker 重启、重复 Event、重试和 unknown side effect。
6. Desktop/Android/iOS 版本和深链回归。
7. 版本、迁移、签名、Release asset 和回滚检查。

## 15. 文件影响清单

- `packages/contracts/src/outcome-runtime.ts`（新增）
- `packages/contracts/src/outcome-inbox.ts`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<generated>_add_outcome_runtime/`
- `packages/db/test/outcome-recovery.integration.test.ts`
- `apps/server/src/services/outcome-recovery-service.ts`（新增）
- `apps/server/src/services/outcome-idempotency.ts`（新增或复用 service-utils）
- `apps/server/src/services/startup-recovery.ts`
- `apps/server/src/services/run-service.ts`
- `apps/server/src/routes/outcome.ts`
- `apps/worker/src/worker.ts`
- `apps/worker/src/queue-dispatch.ts`
- `apps/worker/test/outcome-recovery.integration.test.ts`
- `scripts/release/version.ts`、`.github/workflows/release.yml`（最终验收只在 004.1 已变更的基础上检查）

## 16. 验证策略

- Checkpoint 序列、并发写入和恢复状态测试。
- Event 重复、IdempotencyRecord hash 冲突和已终态重放测试。
- Worker lease 过期、服务重启和 Run 重新排队测试。
- unknown side effect 进入 Decision，而不是自动重试测试。
- 四种 ActionDecision 的单测和集成测试。
- N/T/Q 事件记录和导出测试。
- 父 Spec 场景 A–D 以及发布升级矩阵。

## 17. Run 恢复的代码流程

### 17.1 启动扫描

服务端或 Worker 启动时执行有界扫描：

```text
load non-terminal Outcome/Run
  → group by outcomeId
  → select latest checkpoint/event
  → validate contract revision
  → validate lease/heartbeat
  → classify resume action
```

扫描不能一次加载全部历史数据。使用状态、更新时间和索引分页，限制每次处理数量；未处理的记录在下一轮继续。

### 17.2 分类规则

| 条件 | 恢复分类 | 下一步 |
|---|---|---|
| 有最新 checkpoint，内部步骤未完成 | `resume_queued` | 重新排队同一 WorkItem |
| 已创建 Decision | `waiting_decision` | 不重新排队，等待 resolve |
| 已创建 HumanAction | `waiting_human` | 不重新排队，等待回执 |
| lease 过期且无副作用 | `resume_queued` | 重新获取 lease |
| 外部动作状态 confirmed | `resume_after_receipt` | 写入结果后继续 |
| 外部动作状态 unknown | `needs_review` | 创建 Decision/人工检查 |
| revision superseded | `needs_review` | 迁移到新 revision 或取消 |
| 无 checkpoint 且 Run running | `needs_review` | 不猜测下一步 |

## 18. Checkpoint 持久化选择

### 方案 A：扩展 `Run.requestProgress`

适用条件：

- Checkpoint 只属于一个 Run。
- 现有 JSON 字段已经在 recovery 读取路径中处理。
- 不需要跨 WorkItem 作为查询入口。

优点：迁移少，复用现有恢复。缺点：Outcome 查询需要解析 JSON，历史版本和索引能力弱。

### 方案 B：新增 `OutcomeCheckpoint`

适用条件：

- 一个 Outcome 有多个 WorkItem/Run。
- 需要按 Outcome、sequence、status 查询。
- 恢复和审计需要独立保留。

优点：关系清晰、可索引、可测试。缺点：需要迁移和服务端关联。

选择必须在 `0.1` 审计后写入 ADR，不允许同时长期维护两套权威 Checkpoint。

## 19. 事件处理器实现

### 19.1 处理顺序

```text
receive event
  → validate envelope/schemaVersion
  → begin transaction
  → insert/process eventId marker
  → load current business state
  → compare transition precondition
  → apply transition
  → create next event/outbox intent
  → commit
  → perform async side effect
```

如果现有 Event 表没有事件 ID 唯一约束，新增专用处理记录或使用已有 IdempotencyRecord；不得仅靠内存 Set 去重。

### 19.2 乱序事件

事件按 `occurredAt` 不是绝对顺序。状态转换必须以数据库当前状态和 event type 的前置条件为准：

- 终态后的旧事件只记录为 ignored。
- 新 revision 的事件不能修改旧 revision。
- 已处理的同一 eventId 返回原处理结果。
- 不满足前置条件的事件进入 reconciliation，而不是强行改状态。

## 20. 幂等请求实现

### 20.1 请求哈希

现有 `IdempotencyRecord.requestHash` 必须覆盖业务输入中会影响结果的字段，不覆盖：

- 传输层 trace ID。
- 客户端时间戳。
- 非业务 headers。

覆盖：

- outcome/work item/decision ID。
- Contract revision。
- 选项或回执正文。
- asset/source refs。
- action type 和参数摘要。

### 20.2 处理结果

```text
no record       → create processing → execute transaction
processing      → return request_in_progress or poll result
completed       → return stored response
failed          → retry only if failure is declared retryable
hash mismatch   → 409 idempotency_conflict
```

保存的 response 必须是可安全序列化的 API 结果，不保存 token、内部错误堆栈或完整私有资料。

## 21. 外部副作用处理

本项目不实现所有外部动作，只定义恢复时的三种证据：

```text
confirmed：有明确外部回执或本地事务结果
not_started：调用前 checkpoint 已写，调用未开始
unknown：调用可能发生但没有可信回执
```

处理规则：

| 状态 | 是否自动重试 | 处理 |
|---|---:|---|
| confirmed | 否 | 继续后续状态 |
| not_started | 是，按当前任务限制 | 复用相同 idempotency key |
| unknown | 否 | Decision 或人工核实 |

Agent 自己声称“已经发送/已经修改”不能成为 `confirmed` 回执。

## 22. Worker lease 和恢复

恢复服务必须复用当前 `BotRunLease`：

1. 检查 lease owner 和 expiry。
2. 过期 lease 不能被旧 Worker 继续使用。
3. 新 Worker 重新 claim 前检查 Run status 和 revision。
4. lease heartbeat 失败时写 checkpoint/recovery event，再释放或等待。
5. 同一个 Run 不能同时存在两个有效执行者。

如果当前 Worker 恢复机制只能处理普通 Run，Outcome 恢复通过窄化 adapter 调用它，不复制 lease 表。

## 23. ActionDecision 详细实现

### 输入

```ts
interface ActionDecisionInput {
  outcomeId: string;
  contractRevision: number;
  workItemId: string;
  executorType: "agent" | "human";
  actionType: string;
  hasReceipt: boolean;
  currentRunStatus?: string;
}
```

### 规则顺序

```text
human executor       → MANUAL_ACTION
explicit decision    → NEEDS_USER_DECISION
known supported step → ALLOW
unknown step         → UNSUPPORTED
```

规则服务只处理 Outcome 工作流定义的 action type。它不扫描或重分类现有插件和 MCP 工具，也不替代或拦截现有 Runtime 的工具执行逻辑。`NEEDS_USER_DECISION` 的来源只有两个：Agent 调用 `RequestOutcomeDecision`（`004.3` §41），或恢复时发现外部结果未知（§21）。

## 24. 状态转换 API

建议由服务端内部服务提供：

```text
checkpoint(outcomeId, input)
recover(outcomeId, reason)
classifyAction(input)
markNeedsReview(outcomeId, reason)
resumeWorkItem(workItemId, checkpointId)
reconcileRun(runId)
```

每个方法必须：

- 接收 correlation ID。
- 检查当前状态和 revision。
- 写入 transition reason。
- 返回新的状态和 checkpoint ID。
- 在重复调用时返回同一业务结果。

## 25. 恢复 API 和查询

用户 API：

```text
GET /api/v0/outcomes/:outcomeId/recovery
POST /api/v0/outcomes/:outcomeId/reconcile
```

管理/内部查询只返回脱敏摘要：

```json
{
  "outcomeId":"<id>",
  "runId":"<id>",
  "status":"needs_review",
  "lastCheckpointSequence":4,
  "lastTransition":"external_side_effect_unknown",
  "nextAction":"decision_pending",
  "retryCount":1,
  "recoveryCount":2,
  "lastErrorCode":"external_receipt_unknown"
}
```

## 26. 指标实现

### 26.1 事件计数

每个计数通过事实事件或现有事件投影产生：

```text
outcome.intervention.requested
outcome.decision.resolved
outcome.review.submitted
outcome.retry.started
outcome.recovery.started
outcome.event.duplicate
outcome.notification.created
```

### 26.2 N/T/Q

- N：Decision、资料补充、人工回执、Review 提交等用户动作次数。
- T：记录规划开始、批准、Decision 展示/解决、Review 提交的时间差；不强行推断用户实际阅读时间。
- Q：一次通过率、UNVERIFIED 比例、失败严重度和证据覆盖率。

指标为观察数据，不自动改变任务状态，也不作为 Agent 权限依据。

## 27. 故障注入实现矩阵

| 注入点 | 方法 | 断言 |
|---|---|---|
| DB commit 前 | mock transaction failure | 无半个 Outcome/Decision |
| DB commit 后事件重复 | replay same event | 状态只改变一次 |
| Worker claim 后断开 | terminate worker fixture | lease 过期后可恢复 |
| Run output 写入后断开 | duplicate finish | 一个 Output/Review |
| Decision resolve 并发 | two clients | 一个成功，一个 conflict |
| receipt upload 后提交失败 | retry same key | 一个 Receipt |
| external action timeout | mock unknown receipt | needs_review，不重试 |
| server restart | process restart fixture | checkpoint 恢复 |

## 28. Release gate 详细顺序

### Gate 1：代码和 Schema

- Contracts typecheck。
- Prisma generate。
- migration apply to disposable PostgreSQL。
- existing schema tests。

### Gate 2：服务端和 Worker

- Outcome service tests。
- Decision/Inbox tests。
- Worker Run integration。
- recovery/idempotency tests。

### Gate 3：客户端

- Desktop typecheck/test。
- Android package script and unit tests。
- iOS package/Core checks。
- deep-link and notification fixtures。

### Gate 4：父级回放

- upgrade-from-beta-13。
- research outcome。
- decision pending/resolved。
- human action receipt。
- duplicate event/restart。

### Gate 5：发布资产

- version check。
- release asset names and hashes。
- APK manifest/signing checks。
- old/new update manifest.
- rollback record.

任何 Gate 失败都保留失败证据，不能通过把任务标记为“基本完成”绕过。

## 29. 文件影响清单扩展

### Server/Worker

- `apps/server/src/services/outcome-recovery-service.ts`
- `apps/server/src/services/outcome-idempotency.ts`
- `apps/server/src/services/startup-recovery.ts`
- `apps/server/src/services/run-service.ts`
- `apps/server/src/services/outcome-service.ts`
- `apps/server/src/routes/outcome.ts`
- `apps/worker/src/worker.ts`
- `apps/worker/src/queue-dispatch.ts`
- `apps/worker/src/readiness.ts`

### Contracts/DB

- `packages/contracts/src/outcome-runtime.ts`
- `packages/contracts/src/outcomes.ts`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<generated>_add_outcome_runtime/`
- `packages/db/test/outcome-recovery.integration.test.ts`

### Fixtures and scripts

- `specs/004.5-运行时恢复与版本验收/docs/runtime-recovery-matrix.md`
- `specs/004.5-运行时恢复与版本验收/docs/failure-injection.json`
- `specs/004.5-运行时恢复与版本验收/docs/final-replay.md`
- `scripts/test-outcome-recovery.ts`
- `scripts/check-outcome-release.ts`

## 30. Rollback

### Runtime code

保留旧服务版本和旧数据库读取路径。新 recovery worker 关闭后，已有普通 Run 不应被清理。

### Database

新表/可选字段不影响旧代码；不得在发布中删除旧字段或重写历史 `Run.requestProgress`。需要回滚时停止新写入，保留数据，使用兼容读路径。

### Notification

关闭新通知类型不删除 Decision；用户仍可通过 API/旧客户端访问，直到兼容版本结束。

### Release

回到 `004.1` 保留的旧 asset、镜像 digest、update manifest 和版本 tag。发布失败不得直接清理新旧资产。

## 31. 设计决策记录

实现前必须记录：

- Checkpoint 存储方案。
- Event 去重使用现有表还是专用处理记录。
- 哪些 action type 进入第一版 `ALLOW`。
- 哪些外部动作具备可信 receipt。
- 恢复后旧 revision 的迁移规则。
- 是否允许服务端启动时自动重排队 Run。
- N/T/Q 的第一轮统计字段。
- 哪些发布 Gate 是硬门槛，哪些仅记录 PENDING。

## 32. Recovery service 的启动和停止

### 启动顺序

```text
database ready
  → load schema/version
  → start recovery scanner
  → mark expired leases
  → process bounded non-terminal records
  → start normal queue consumption
  → publish readiness
```

恢复扫描完成前，服务可以提供健康状态，但不能将 Outcome Worker readiness 标为“全部可处理”。如果当前应用生命周期没有独立 recovery readiness，任务必须新增一个内部状态或在现有 readiness 结果中记录恢复阶段。

### 停止顺序

```text
stop accepting new Outcome runs
  → finish/record current transaction
  → write checkpoint for active work
  → release leases
  → stop recovery/queue loops
  → close database
```

普通聊天停止行为不应因为 Outcome recovery 增加额外等待；只对已开始的 Outcome WorkItem 写 checkpoint。

## 33. Checkpoint 写入策略

### 事务内写入

以下操作和 checkpoint 必须在同一数据库事务内：

- WorkItem 从 queued 变为 running。
- Run 完成并关联 Output。
- Decision 创建并将 Outcome 变为 decision_pending。
- HumanReceipt 写入并将 WorkItem 变为 review_pending。
- Review 完成并重新计算 Outcome 状态。

### 事务外写入

以下操作只能在外部动作前后通过独立 checkpoint 记录：

- HTTP/邮件/外部 connector 调用。
- 长时间等待用户。
- Worker/Computer 进程执行。
- 资料 provider 请求。

如果外部动作之前的 checkpoint 已提交，恢复逻辑才能区分 `not_started` 与 `unknown`。

## 34. Run/WorkItem/Outcome 状态一致性

状态关系必须满足：

| WorkItem | Run | Outcome | 允许的关系 |
|---|---|---|---|
| queued | null/queued | approved/running | 等待提交 |
| running | queued/running | running | 正常执行 |
| waiting_decision | completed（Agent 回合已结束） | decision_pending | 不重新提交 |
| retry_pending | failed/interrupted | running | 等待重试 |
| needs_review | interrupted/failed | running 或 review_pending | 等待人工核对 |
| completed | completed | review_pending 或继续下一 WorkItem | 等待验收 |
| failed | failed | failed/decision_pending | 显示原因 |
| （Human WorkItem） | 无 Run | human_action_pending | 见 `004.4` §16 |

恢复服务发现非法组合时，不能自行修正为 completed；应写 `state_inconsistent` 并进入 needs_review。

## 35. Reconciliation 查询

### Outcome reconciliation

```text
load current Outcome
load current revision
load WorkItems ordered by ordinal
load linked Runs and latest checkpoints
load open Decisions/HumanReceipts
calculate expected aggregate state
compare stored state
write reconciliation event if changed
```

reconciliation 只在发现有事实依据时修正聚合状态，不修改 Contract revision、Evidence 或历史 Review。

### Run reconciliation

```text
load Run
load lease
load latest RunItems/events
load OutcomeRunLink
classify active/completed/stale/unknown
```

现有 Run 已终态时，不能因为旧 checkpoint 重新排队。Outcome 侧只补齐 Output/Review 状态。

## 36. Worker 断开和 lease 处理

当 Worker 断开：

1. 记录 `worker_disconnected`。
2. 等待当前 lease expiry 或通过现有健康机制确认 owner 失效。
3. 读取最新 Run 状态和 checkpoint。
4. 没有副作用证据时重新排队；有未知副作用时进入 needs_review。
5. 新 owner claim 前检查旧 owner 是否仍可能运行。

不能通过简单删除 lease 来保证安全；必须避免旧 Worker 和新 Worker 同时处理同一 Run。

## 37. Event handler 事务示例

```text
BEGIN
  insert EventProcess(eventId) if absent
  if duplicate: return stored result
  load Outcome/Run with row lock
  check current status and revision
  apply allowed transition
  insert next Event/Outbox intent
COMMIT

perform push/worker wakeup outside transaction
```

如果当前 Event 表已经是事实日志而非处理记录，增加处理记录时要说明保留期限和清理方式。处理记录不能覆盖事实事件。

## 38. 幂等 key 与业务对象

| 对象 | key | 约束 |
|---|---|---|
| Run submission | `outcome-run:<outcome>:<revision>:<workItem>` | 一个 WorkItem 一个有效 Run |
| Decision resolve | `decision-resolve:<decision>:<clientRequest>` | stored response |
| Human receipt | `human-receipt:<workItem>:<clientRequest>` | 一个请求一个 Receipt |
| Review | `review:<criterion>:<revision>:<reviewer>:<sequence>` | 历史可追踪 |
| Notification | `outcome-notification:<factType>:<factId>` | 一个事实一个通知意图 |
| Recovery | `recovery:<run>:<checkpoint>` | 同一 checkpoint 不重复恢复 |

业务 key 不能使用随机 UUID 作为唯一去重依据，否则网络重试会创建第二个业务对象。

## 39. Retry policy

### 内部可重试

- DB serialization/deadlock，按现有数据库重试约定处理。
- Worker wakeup 短暂失败，保留 queued 状态。
- 读取资料 provider 超时，有限次重试。

### 不自动重试

- 外部副作用状态 unknown。
- Contract revision 已 superseded。
- Decision 需要用户选择。
- Human WorkItem 需要回执。
- Schema/data 不一致。
- 用户明确拒绝。

每次 retry 写入 `retryCount`、`reasonCode` 和 `nextAttemptAt`。重试策略不能由模型输出覆盖。

## 40. Metrics schema

建议将指标作为 Outcome 事件 payload 或聚合查询字段：

```json
{
  "outcomeId":"<id>",
  "planningStartedAt":"<iso>",
  "approvalAt":"<iso>",
  "firstRunAt":"<iso>",
  "acceptedAt":"<iso>",
  "humanInterventionCount":3,
  "decisionCount":1,
  "reviewCount":2,
  "retryCount":1,
  "recoveryCount":0,
  "duplicateEventCount":0,
  "notificationCount":2,
  "actionableNotificationCount":2,
  "attentionSeconds":420,
  "firstPassAccepted":true,
  "contractRevisionCount":2,
  "approvedRevisionCount":2
}
```

派生指标（原规划 §17.2）：

| 指标 | 计算方式 |
|---|---|
| N：人工介入次数 | `humanInterventionCount`（规划确认、Decision 解决、验收提交、回执提交各计一次） |
| T：注意力投入 | `attentionSeconds`：客户端在规划向导、Decision 卡和验收页面处于前台的累计时间，由客户端上报；不可用时为 null，不估算 |
| Q：验收质量 | `firstPassAccepted` 比例和 FAIL 条款数 |
| 非必要通知比例 | `1 - actionableNotificationCount / notificationCount`；actionable 指用户在通知后执行了解决、验收或回执动作 |
| 恢复正确率 | 故障注入回放中安全恢复的样本数 / 总样本数，来自 §42 脚本报告 |
| Contract 变更追溯率 | `approvedRevisionCount / contractRevisionCount`（只统计已结束的 Outcome） |

只记录基线，不设目标值。

不记录原始用户资料、完整 prompt、token、密钥或未脱敏外部响应。指标写入失败不能阻塞主流程。

## 41. 版本验收数据

最终报告必须关联：

```text
source commit
branch/tag
root version
DB migration list
server image digest
worker image digest
client build versions
test commands/results
fixture IDs
known pending evidence
rollback assets
reviewer/date
```

如果使用 CI 生成报告，将报告作为 artifact 保存，并在 `docs/release-decision.md` 引用；不要只把“CI green”写进任务。

## 42. 故障注入脚本接口

建议新增脚本接受固定 scenario：

```text
bun scripts/test-outcome-recovery.ts --scenario restart-running-run
bun scripts/test-outcome-recovery.ts --scenario duplicate-finish-event
bun scripts/test-outcome-recovery.ts --scenario unknown-external-receipt
bun scripts/test-outcome-recovery.ts --scenario concurrent-decision
bun scripts/test-outcome-recovery.ts --scenario upgrade-from-beta-13
```

每个 scenario 输出 JSON：

```json
{
  "scenario":"duplicate-finish-event",
  "initialState":"running",
  "injectedEventId":"<id>",
  "replayed":true,
  "finalState":"review_pending",
  "outputCount":1,
  "decisionCount":0,
  "evidence":"<path>"
}
```

## 43. 数据库迁移和旧数据

如果采用新增 Checkpoint/Outcome runtime 表：

1. migration 只创建新表和索引。
2. 旧 Run 不自动填充为已恢复 Outcome。
3. 新代码只对存在 Outcome 关系的 Run 执行新恢复逻辑。
4. 迁移后执行 count、foreign key 和 orphan 检查。
5. rollback 不删除新表中的审计记录，除非发布方案明确允许。

如果扩展 `Run.requestProgress`：

- 增加 schema version。
- 旧 JSON 缺字段时按旧 Run 处理。
- 新字段解析失败进入 needs_review，不影响普通 Run。

## 44. 发布前后状态

### 发布前

- 新代码可读取旧数据。
- 新表/字段可选。
- Outcome capability 可以关闭。
- 旧客户端仍可连接。

### 发布后

- 先启用数据库读路径。
- 再启用 Outcome API。
- 再启用研究 fixture。
- 再打开目标用户入口。
- 观察 recovery/idempotency/notification 指标。

如果出现严重问题，先关闭新 Outcome 入口，保留现有聊天、Routine 和旧客户端路径；不要删除新数据或回滚不可逆 schema。

## 45. 运行手册

### 发现 stuck Run

1. 查询 Outcome、Run、lease、checkpoint 和最近事件。
2. 检查 revision 是否 superseded。
3. 检查外部动作 receipt。
4. 判断 resume、Decision、HumanAction 或 needs_review。
5. 通过服务入口执行一次幂等 reconcile。
6. 保存结果和 correlation ID。

### 发现重复通知

1. 查 fact key 和 Outbox delivery key。
2. 查 projector event processing record。
3. 确认是否是客户端展示重复还是服务端创建重复。
4. 修复 projector/dedupe，不删除业务 Decision。
5. 增加回归 fixture。

### 发现升级失败

1. 停止继续发布。
2. 保存安装器、日志、版本、签名和数据库状态。
3. 恢复旧发布资产或关闭新入口。
4. 不清理用户数据。
5. 在 release decision 中记录根因和回滚结果。

## 46. 最终验证命令矩阵

| 区域 | 命令/检查 |
|---|---|
| Contracts | `bun --filter @aiteamos/contracts typecheck`、聚焦 tests |
| DB | `bun --filter @aiteamos/db db:generate`、migration integration |
| Server | `bun test apps/server/test/outcome* apps/server/test/notification*` |
| Worker | `bun test apps/worker/test/*outcome* apps/worker/test/*lifecycle*` |
| Desktop | `bun --filter @aiteamos/desktop typecheck`、focused tests |
| Android | `bash scripts/android/package-debug.sh`、`bash scripts/android/release-gate.sh check` |
| iOS | package/core/native config checks |
| Recovery | `bun scripts/test-outcome-recovery.ts --scenario ...` |
| Release | `bun scripts/release/version.ts check`、asset/signature checks |

实际命令必须以仓库当前 package scripts 为准；如果某个 glob 没有匹配文件，任务需改成明确文件列表，不把空跑当成通过。

## 47. 设计决策记录扩展

实现前必须记录：

- Checkpoint 的最终存储方式。
- Recovery scanner 的启动位置和 batch size。
- Event process marker 的存储方式。
- 哪些内部失败可以自动重试。
- 哪些外部动作有可信 receipt。
- 是否提供人工 reconcile API。
- Outcome capability 的启用顺序。
- Release Gate 的 PASS/PENDING/FAIL 规则。

## 48. 数据库备份和迁移回退

1. 每个新增 Outcome 表的 migration 在部署前执行 `pg_dump`（只针对测试和发布验证环境；不在用户生产环境自动执行），备份路径写入 `docs/release-decision.md`。
2. 所有 Outcome migration 只新增表和可选列，回退方式是部署旧镜像并保留新表（父 design.md §16、§30），不执行破坏性 down migration。
3. 发布验证必须包含一次“从备份恢复后旧版本可读”的演练。

## 49. 失败告警

不建设新的监控平台。以下情况写入现有服务日志（`error` 级别，带父 design.md §33 的字段），并在 Outcome 详情显示：

- WorkItem 进入 `needs_review`。
- 启动恢复发现 `state_inconsistent`。
- Outbox 通知超过重试上限。
- 规划生成或 AI 预审连续失败。

运维通过现有日志查询这些记录；后续如需告警渠道，另立 Spec。
