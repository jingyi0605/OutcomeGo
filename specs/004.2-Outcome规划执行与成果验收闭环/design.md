# 设计文档 - Outcome 规划执行与成果验收闭环

状态：Approved（2026-11-17，按“主线程 + 子线程”执行模型修订）

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. 领域模型

```text
Outcome 1 ── * ContractRevision
ContractRevision 1 ── * AcceptanceCriterion
ContractRevision 1 ── * WorkItem
WorkItem(agent) 1 ── 1 Outcome 子线程 ── * Run（Run.outcomeWorkItemId）
WorkItem 1 ── * Output
AcceptanceCriterion 1 ── * Evidence
AcceptanceCriterion 1 ── * Review
```

最小对象：

- `Outcome`：成果目标和当前状态。
- `ContractRevision`：目标、验收、边界和执行上下文的不可变版本。
- `AcceptanceCriterion`：可验证完成条件。
- `WorkItem`：可分派给 Agent 或人的最小动作。Agent WorkItem 对应一个 Outcome 子线程。
- `Run`：现有运行时的一次 Agent 回合。一个子线程内可以有多个 Run（根 Run、后续回合、子 Agent 和后台 shell 唤醒的回合），统称**运行组**。
- `Output`：运行组最终结果或输出目录文件。
- `Evidence`：用于证明条款的材料、来源和可信度。
- `Review`：用户对每条条款的结论。

## 2. 状态

```text
Outcome:
Draft → Planning → PendingApproval → Approved → Running
       → ReviewPending → Accepted
       → DecisionPending / HumanActionPending / Paused / Failed / Cancelled

ContractRevision:
Draft → PendingApproval → Approved → Superseded / Closed

Agent WorkItem（取值和与现有 RunStatus 的映射见父 design.md §42）:
queued → running → completed / failed / cancelled
running → waiting_decision / retry_pending / needs_review
```

现有 `Run` 只使用其原有 `RunStatus`（`queued`、`running`、`completed`、`failed`、`cancelled`、`interrupted`），本 Spec 不修改该枚举。状态转换由服务端执行。`Run=completed` 只表示执行完成，不表示成果已验收。

## 3. 规划协议

规划结果包含：

```ts
interface PlanningDimension {
  options: PlanningOption[]; // length <= 4
  selectedOptionIds: string[];
  customEntries: string[];
}

interface PlanningDraft {
  goal: PlanningDimension;
  acceptance: PlanningDimension;
  boundaries: PlanningDimension;
  conflicts: PlanningConflict[];
}
```

最终 Contract 必须保存用户实际确认的文字，不能只保存选项 ID。

## 4. API 和事件

建议最小接口：

接口以 requirements.md “API 合同需求”表和 §19 为准，路径统一带 `/api/v0` 前缀（`apps/server/src/main.ts:107` 会把 `/api/v0` 映射为 `/api`）：

```text
POST /api/v0/outcomes/plans
GET  /api/v0/outcomes/plans/:planId
POST /api/v0/outcomes
GET  /api/v0/outcomes
GET  /api/v0/outcomes/:id
POST /api/v0/outcomes/:id/revisions
POST /api/v0/outcomes/:id/revisions/:revision/approve
POST /api/v0/outcomes/:id/runs
POST /api/v0/outcomes/:id/reviews
POST /api/v0/outcomes/:id/rework
POST /api/v0/outcomes/:id/cancel
GET  /api/v0/outcomes/:id/work-items/:workItemId/transcript
```

本阶段产生的事实事件（名称以父 design.md §14 为准）：

```text
outcome.created
outcome.status_changed
outcome.contract.revision_created
outcome.contract.revision_approved
outcome.work_item.created
outcome.work_item.updated
outcome.output.recorded
outcome.review.required
outcome.review.recorded
outcome.accepted
```

本阶段读取（不写入）的现有运行时事件：`run.completed`、`run.interrupted`、`run.cancelled`。

事件 Envelope 和存储方式见父 design.md §14、§43。

## 5. 执行映射

```text
Approved ContractRevision
        ↓
WorkItem(subject, acceptance_refs, contract_revision)
        ↓
Outcome 子线程（执行 Bot 下，独立上下文和租约，§12）
        ↓
运行组结束 → Output
        ↓
Evidence
        ↓
Acceptance review
```

执行上下文只包含已批准 Contract 的目标、验收、边界和必要资料。执行过程中产生的新目标必须回到用户决策或 Contract 变更流程。

## 6. 持久化

schema 变更按父 design §16：在 `schema.prisma` 中新增表和可选列，通过 `db:push` 部署，不写 Prisma Migrate 迁移。必须：

- 新增表或字段时保持现有数据可读；`Run.outcomeWorkItemId` 为可选列，现有 Run 为空。
- 不覆盖已批准 revision。
- WorkItem、Evidence 和 Review 保存 Contract revision；Run 通过 `outcomeWorkItemId` 间接关联 revision。

## 7. 验收逻辑

必需验收条款全部为 `PASS`，并且需要人工签收的条款已签收时，Outcome 才能进入 `Accepted`。任何 `UNVERIFIED` 都必须保留缺口信息。

## 8. 当前代码基线和集成点

下表已按任务 0.1 审计结果（`docs/runtime-capability-matrix.md`）更新：

| 现有文件 | 责任 | 新增或调整 |
|---|---|---|
| `packages/contracts/src/outcomes.ts`（新增）、`index.ts` | 共享类型出口 | Outcome、Contract、WorkItem、Output、Evidence、Review DTO 和解析函数 |
| `packages/db/prisma/schema.prisma` | PostgreSQL 模型 | 新增 Outcome 模型；`RunOrigin` 增加 `outcome`；`Run` 增加可选 `outcomeWorkItemId` |
| `apps/server/src/main.ts` | HTTP route 注册和生命周期 | 注册 Outcome routes |
| `apps/server/src/routes/outcome.ts`（新增） | 输入解析、鉴权和响应 | 按现有 route 组织方式实现 |
| `packages/messaging/src/index.ts` | `enqueueWake`、`WakeInput` | `WakeInput` 增加可选 `outcomeWorkItemId`，写入 InboxEvent payload 和 `Run.outcomeWorkItemId`；`platformPrompt` 读取 Outcome context |
| `packages/messaging/src/automation-results.ts` | Routine 运行组判断 | 抽出与 origin 无关的“运行组是否结束”判断，供 Routine 和 Outcome 共用 |
| `apps/worker/src/worker.ts` | 领取 InboxEvent、租约、上下文 scope | `contextScopeForRun` 支持 `outcome`；领取逻辑把 `outcome` 当作后台线程 origin，租约 scope `outcome:<workItemId>`，每 Bot 上限 2；回合结束时调用 Outcome 运行组结算 |
| `apps/computer/src/runtime/tools.ts` | 子线程工具列表 | `outcome` 请求来源沿用 Routine worker 工具约定，后续由 `004.3`/`004.4` 增加 `RequestOutcomeDecision`、`RequestHumanAction` |
| `apps/server/src/services/run-service.ts` | Run 取消 | Outcome 取消时停止子线程运行组，复用现有取消语义 |
| `apps/desktop/src/renderer/client/outcomego-api.ts` | Desktop API 客户端 | Outcome API 和错误类型 |
| `apps/desktop/src/renderer/components/outcomego/chat-pane.tsx` | 当前聊天入口 | 从聊天输入进入 Planning UI |
| `packages/db/prisma/migrations/` | 增量迁移 | 生成实际迁移，不手工覆盖已有迁移 |

## 9. 数据库模型

### 9.1 `Outcome`

```text
id                 UUID primary key
botId              UUID，执行 Bot（父 design.md §39）
title              text
description        text
status             outcome_status
currentRevisionId  UUID nullable
resumeStatus       outcome_status nullable，侧向状态返回时使用
createdAt          timestamp
updatedAt          timestamp
acceptedAt         timestamp nullable
```

建议状态：

```text
draft
planning
pending_approval
approved
running
review_pending
accepted
decision_pending
human_action_pending
paused
failed
cancelled
```

### 9.2 `ContractRevision`

```text
id                 UUID primary key
outcomeId          UUID foreign key
revision           integer
status             draft | pending_approval | approved | superseded | closed
goal               JSON
boundaries         JSON
budget             JSON nullable，可选的时间或费用上限，不设默认值
executionBotId     UUID
conflicts          JSON，创建时检测到的规划冲突
contentHash        sha256(goal, 条款, boundaries, budget, executionBotId)
changeSummary      text nullable
baseRevisionId     UUID nullable
sourceDecisionId   UUID nullable
createdBy          actorRef（父 design.md §44）
approvedBy         actorRef nullable
approvedAt         timestamp nullable
approvalProof      JSON nullable
createdAt          timestamp
```

唯一约束：`(outcomeId, revision)`。验收条款只保存在 `OutcomeAcceptanceCriterion` 表中（§9.3），revision 不再另存一份 `acceptance` JSON，避免两个事实来源。批准后 `goal`、条款、`boundaries`、`budget` 和 `executionBotId` 不允许原位修改。本 Spec 不保存 authority 字段，原因见父 design.md §40。

### 9.3 `AcceptanceCriterion` 和 `Evidence`

```text
AcceptanceCriterion:
id, contractRevisionId, ordinal, statement, required,
verificationMethod, evidenceRequired, status, reviewedBy, reviewedAt
（verificationMethod 取值：human_review | deterministic_check）

Evidence:
id, outcomeId, contractRevisionId, criterionId,
runId nullable, workItemId nullable, sourceType, sourceRef,
contentSummary, contentHash nullable, capturedAt, capturedBy,
credibility
```

`credibility` 取值：`deterministic_check`（确定性检查或测试结果）、`human_confirmed`（人工回执或人工确认）、`external_record`（外部系统记录）、`agent_report`（Agent 输出或自述）、`ai_prereview`（AI 预审建议）。UI 按此区分展示，`agent_report` 和 `ai_prereview` 不能单独支撑必需条款的 PASS。

`contentSummary` 保存可展示的摘要；原始大文件继续使用现有 asset store 或文件引用，不直接塞入 Outcome 行。

### 9.4 `OutcomeWorkItem` 和 Run 关联（D11、D14）

```text
OutcomeWorkItem:
id, outcomeId, contractRevisionId, executorType(agent|human),
kind(initial|rework|supplement|human_action), title, instructions,
status, ordinal, dependsOn JSON（workItemId 数组）,
rootRunId nullable, reworkOfWorkItemId nullable, sourceDecisionId nullable,
statusReason nullable, startedAt, completedAt, createdAt, updatedAt

Run（现有表，新增可选列）:
outcomeWorkItemId UUID nullable，索引 (outcomeWorkItemId, createdAt)
```

- 不建 `OutcomeRunLink`。子线程运行组内的每个 Run（包括 Agent 后续回合）都写入 `outcomeWorkItemId`；WorkItem 的 `rootRunId` 指向子线程第一个 Run。
- 不复制 Agent Run 状态机；WorkItem 状态由运行组派生（父 design §42.2）。
- Human WorkItem 的专用字段（步骤、回执要求等）由 `004.4` 以可选列或关联表扩展，不另建 WorkItem 表。

### 9.5 `Output` 和 `Review`

```text
OutcomeOutput:
id, outcomeId, workItemId, runId nullable, kind(final_result|file),
title, content text nullable, contentRef nullable, createdAt

OutcomeReview:
id, outcomeId, contractRevisionId, criterionId,
result PASS|FAIL|UNVERIFIED|WAIVED_BY_APPROVED_CHANGE,
evidenceIds JSON, comment, reviewedBy, reviewedAt
```

实现前必须检查是否已有可复用的输出或通知模型；如果已有模型足够，使用扩展字段而不是新增重复表。

## 10. PlanningDraft 协议

```ts
type PlanningDimensionName = "goal" | "acceptance" | "boundaries";

interface PlanningOption {
  id: string;
  text: string;
  recommended?: boolean;
  reason?: string;
}

interface PlanningDimension {
  options: PlanningOption[]; // 0..4
  selectedOptionIds: string[];
  customEntries: string[];
}

interface PlanningDraft {
  planId: string;
  sourceText: string;
  goal: PlanningDimension;
  acceptance: PlanningDimension;
  boundaries: PlanningDimension;
  conflicts: Array<{ code: string; dimensions: PlanningDimensionName[]; message: string }>;
  generatedAt: string;
}
```

服务端批准前必须把选择解析为：

```ts
interface ConfirmedContractInput {
  goal: string[];
  acceptance: Array<{ statement: string; required: boolean; verificationMethod: string }>;
  boundaries: { included: string[]; excluded: string[] };
}
```

前端不能只提交 `selectedOptionIds`，因为候选项可能已经重新生成。服务端需要使用当次 draft 快照解析并保存最终文字。

## 11. API 请求和响应样例

### 11.1 生成规划

```http
POST /api/v0/outcomes/plans
Content-Type: application/json

{"sourceText":"比较两个备份方案并给出选型建议","context":{"botId":"<uuid>"}}
```

```json
{
  "planId": "<uuid>",
  "goal": {"options": [{"id":"goal-1","text":"形成可执行的选型建议"}],"selectedOptionIds":[],"customEntries":[]},
  "acceptance": {"options": [{"id":"acceptance-1","text":"说明成本、恢复时间和限制"}],"selectedOptionIds":[],"customEntries":[]},
  "boundaries": {"options": [{"id":"boundaries-1","text":"不修改生产系统"}],"selectedOptionIds":[],"customEntries":[]},
  "conflicts": []
}
```

### 11.2 批准和执行

批准和执行的请求体见 §19.3、§19.4。

幂等统一使用请求体中的 `clientRequestId`，不使用 `Idempotency-Key` 请求头。

```http
POST /api/v0/outcomes/<outcomeId>/revisions/1/approve

{"expectedRevision":1,"confirmationText":"...","clientRequestId":"approve:<outcomeId>:1"}
```

```json
{"approvedBy":"user:<User.id> 或 owner:local","approvedAt":"<iso-time>","revision":1,"status":"approved"}
```

```http
POST /api/v0/outcomes/<outcomeId>/runs

{"expectedRevision":1,"clientRequestId":"run:<outcomeId>:1"}
```

响应必须包含 `outcomeId`、`contractRevision`、`workItems`（含 `rootRunId`）和 `status`，不能只返回一个不可追踪的后台任务 ID。

## 12. Outcome 子线程执行桥接（父 design §45，D09–D15）

### 12.1 为什么不用 `acceptDirectUserMessage`

任务 0.1 审计确认：`AgentMessaging.acceptDirectUserMessage`（`packages/messaging/src/index.ts:1224`）以 `origin: "user"` 入队，并把 Bot 主对话中正在运行的回合标为 `interruptedRunId`（同文件 `:1240`）。用它提交 WorkItem 会打断用户聊天，用户再发消息又会打断 Outcome 任务；执行说明还会以用户消息的形式进入主对话。因此 Outcome 不使用该入口。

### 12.2 入队

```text
事务内：
  创建 OutcomeWorkItem(status=queued)
  若该 Bot 运行中的 Outcome 子线程 < 2：
    messaging.enqueueWake(tx, {
      botId: outcome.botId,
      channelId: <执行 Bot 的 DM channel>,
      origin: "outcome",
      type: "outcome.work_item",
      content: <WorkItem 执行说明，不含 Contract JSON>,
      clientId: "outcome-run:<outcomeId>:<revision>:<workItemId>",
      outcomeWorkItemId: <workItemId>,
      priority: 280,
    })
    WorkItem.rootRunId = wake.run.id
  写 outcome.work_item.created 事件
```

- `enqueueWake`（`packages/messaging/src/index.ts:989`）只写数据库（Message、Run、InboxEvent、Event），不调用 Worker，可以放在同一事务中。
- 不传 `interruptedRunId`，不会顶替任何回合。
- `channelId` 只用于运行时上下文；子线程不向该 channel 发送可见消息（§24）。
- 超出并发上限的 WorkItem 保持 `queued`，不入队 Run；在任一 Outcome 子线程结算后，由同一结算事务挑选下一个 `queued` WorkItem 入队。

### 12.3 Worker 侧

| 位置 | 现状（Routine） | Outcome 子线程 |
|---|---|---|
| `contextScopeForRun`（`apps/worker/src/worker.ts:192`） | `routine` → `automation` scope | `outcome` → scope `outcome`，scopeId = `outcomeWorkItemId` |
| InboxEvent 领取（`worker.ts:1240` 起） | 主对话忙时只领取 `routine`；Routine 数量上限 4 | 把 `outcome` 与 `routine` 一样视为后台线程 origin；同一 workItemId 已有租约时不领取；Outcome 子线程上限 2 |
| 租约（`worker.ts:1307`） | `automation:<rootRunId>` | `outcome:<workItemId>` |
| 回合结束（`worker.ts:1634`、`:1917`） | `reconcileRoutineExecution` | 同一位置调用 `settleOutcomeWorkItem(tx, runId)` |
| 工具（`apps/computer/src/runtime/tools.ts:254`） | `requestSource=automation` 时提供 `WakeParent` | `outcome` 映射为同一类 worker 请求来源，额外工具由 `004.3`/`004.4` 增加 |

### 12.4 运行组结算

`settleOutcomeWorkItem(tx, runId)`：

1. 找到 `Run.outcomeWorkItemId`；为空则直接返回（普通 Run 不受影响）。
2. 加 `pg_advisory_xact_lock(hashtext('outcome-work-item:<id>'))`。
3. 运行组 = 所有 `outcomeWorkItemId = <id>` 的 Run。若其中有 `queued`/`running`，或其子 Agent、后台 shell 未结束（复用从 `automationBackgroundWorkRunning` 抽出的判断），返回。
4. 若 WorkItem 为 `waiting_decision` 或 `waiting_human`，不改变状态（Decision 解决或人工 WorkItem 被接受后会在同一子线程再入队）。
5. 按最后一个 Run 的状态更新 WorkItem（父 design §42.2），写 `outcome.work_item.updated`。
6. 若为 `completed`，读取最后一个 Run 的最终 agentMessage（与 `saveSilentAutomationResult` 相同来源：`run_item.completed` 事件中 `item.type = agentMessage` 的最后一条），写 `OutcomeOutput(kind=final_result)`，写 `outcome.output.recorded`；输出目录中的文件登记为 `kind=file`。
7. 重新计算 Outcome 状态；所有 Agent WorkItem 结束且有 Output 时进入 `review_pending`，写 `outcome.review.required`。
8. 挑选同一 Bot 下一个 `queued` WorkItem 入队（§12.2）。

### 12.5 不改变的部分

Agent 的普通运行、记忆和主对话消息投递保持不变。2026-11-18 需求 21 为普通主 Bot 增加显式调用的原生管理工具，见 §35；不因此把所有普通回合改为 Outcome 子线程。Outcome context 的传递方式见 §23。不使用 `taskConfiguration`：它是 Bot 级执行器配置，`parseTaskConfiguration` 会拒绝未知字段。

## 13. 状态转换和事务边界

```text
Draft
  → Planning
  → PendingApproval
  → Approved
  → Running
  → ReviewPending
  → Accepted

Running → DecisionPending
Running → HumanActionPending
Running → Failed
Approved → Cancelled
Approved revision → Superseded by revision N+1
```

以下动作必须在事务内完成：

- 批准 revision 和批准凭证写入。
- 创建 WorkItem 与其 Contract 关联。
- 幂等创建 Run 关联。
- Review 结论写入并重新计算 Outcome 状态。

跨进程的 OpenTeam 提交不能放在长数据库事务中；事务先写 `queued` 状态和提交意图，提交失败时写 `retry_pending` 或 `failed`（父 design.md §42）。

## 14. 文件影响清单

### 共享契约和数据库

- `packages/contracts/src/outcomes.ts`（新增）、`packages/contracts/src/index.ts`、`packages/contracts/package.json`（exports）
- `packages/contracts/test/outcomes.test.ts`（新增）
- `packages/contracts/src/service-protocol.ts`（`ComputerInferenceRequest.kind` 增加 `planning`、`prereview`）
- `packages/db/prisma/schema.prisma`（Outcome 模型、`RunOrigin.outcome`、`Run.outcomeWorkItemId`）
- `packages/db/test/fresh-schema.integration.test.ts`（覆盖新表）
- `packages/db/test/outcomes.integration.test.ts`（新增，唯一约束和 revision 不可变）

### 服务端、messaging 和 Worker

- `apps/server/src/main.ts`
- `apps/server/src/routes/outcome.ts`（新增）
- `apps/server/src/services/outcome-service.ts`（新增：Outcome、revision、批准、WorkItem、状态计算）
- `apps/server/src/services/outcome-planning-service.ts`（新增，§31）
- `apps/server/src/services/outcome-review-service.ts`（新增）
- `apps/server/src/services/run-service.ts`（取消子线程）
- `packages/messaging/src/index.ts`（`WakeInput.outcomeWorkItemId`；`platformPrompt` 读取 Outcome context）
- `packages/messaging/src/automation-results.ts`（抽出运行组判断）
- `packages/messaging/src/outcome-threads.ts`（新增：`settleOutcomeWorkItem`、下一个 WorkItem 入队）
- `apps/worker/src/worker.ts`（scope、领取、租约、结算调用）
- `apps/computer/src/runtime/tools.ts`（`outcome` 请求来源）
- `apps/worker/test/outcome-thread.integration.test.ts`（新增：主对话与子线程互不打断）

### Desktop

- `apps/desktop/src/renderer/client/outcomego-api.ts`
- `apps/desktop/src/renderer/components/outcomego/chat-pane.tsx`（入口）
- `apps/desktop/src/renderer/components/outcomego/outcomes/`（新增）
- `apps/desktop/test/outcome-planning.test.ts`（新增）

### Android/iOS（只读，需求 20）

- `mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/Models.kt`、`Transport.kt`（Outcome DTO 和读取）
- `apps/android/app/src/main/kotlin/com/outcomego/features/`（Outcome 列表和详情页面）
- `apps/ios/Sources/Core/API.swift`、`Models.swift`，`apps/ios/Sources/App/`（Outcome 列表和详情视图）

### 测试数据和文档

- `specs/004.2-Outcome规划执行与成果验收闭环/docs/research-pilot.json`
- `specs/004.2-Outcome规划执行与成果验收闭环/docs/contract-fixtures.json`
- `specs/004.2-Outcome规划执行与成果验收闭环/docs/acceptance-replay.md`

## 15. 验证策略

- Planning dimension 选项数量、custom、多选和冲突的服务端单测。
- 数据库 revision 唯一约束、批准不可变和重复批准集成测试。
- 未批准不运行、批准后运行、重复提交和 Run 对账集成测试。
- Agent 输出、Evidence、Review 和 Accepted 状态的状态机测试。
- 研究试点真实 OpenTeam Run 回放。
- 旧消息路径回归，确保普通聊天行为不变。
- Desktop Planning UI、错误、刷新和结果页面测试。

## 16. Planning 服务实现细节

### 16.1 请求生命周期

```text
POST /outcomes/plans
  → validate authenticated owner
  → normalize sourceText/context
  → create plan snapshot
  → generate three dimensions（§31）
  → validate option count and text size
  → detect conflicts
  → persist/retrieve plan
  → return PlanningDraft
```

PlanningDraft 是可重新读取的服务端对象。客户端不能只把模型响应保存在内存中，再直接提交选项文字。

### 16.2 候选项限制

每个维度的服务端限制：

```text
max options: 4
max option text: 500 characters
max custom entry: 2,000 characters
max selected options: 4
max total confirmed text: 12,000 characters
```

这些是输入合同边界，不是额外的产品权限门。超过限制时返回 `planning_input_too_large` 或 `planning_option_limit_exceeded`。

### 16.3 冲突模型

```ts
interface PlanningConflict {
  code:
    | "goal_boundary_conflict"
    | "acceptance_boundary_conflict"
    | "duplicate_selection"
    | "missing_acceptance"
    | "ambiguous_scope";
  severity: "blocking" | "informational";
  dimensions: Array<"goal" | "acceptance" | "boundaries">;
  message: string;
  resolutionHint?: string;
}
```

只有 `blocking` 冲突阻止批准。`informational` 冲突可以随 Contract 保存，但必须显示给用户。

## 17. Contract 组装

用户确认 PlanningDraft 后，服务端执行：

1. 验证 draft 存在且状态为 `ready`（单 owner 系统，不做归属检查，父 design §44）。
2. 验证 draft 没有过期或被消费。
3. 根据选项 ID读取当时的 option snapshot。
4. 合并 custom entries。
5. 生成实际确认文字。
6. 将 acceptance 选项转成可验收条款。
7. 将 boundaries 分为 included/excluded。
8. 重新执行冲突检查。
9. 创建 Contract revision `draft`。

服务端不信任客户端提交的 `recommended`、`required` 或 `verificationMethod` 字段。用户选择的是规划内容；条款验证方法由 Contract 组装规则和后续 Review 配置确定。

## 18. Contract revision 版本规则

### 新 revision 的触发条件

- 增加或删除成果目标。
- 修改必需验收条款。
- 修改范围、排除项或环境。
- 修改执行主体。
- 修改影响现有 Run 的预算或截止条件。
- Decision 选择导致业务范围变化。

### 不需要新 revision 的变化

- 任务内部顺序调整。
- 同义文字整理且验收含义不变。
- 不改变范围的研究方法替换。
- 输出文档格式整理。

即使不需要新 revision，计划变化也必须写入 Run/WorkItem history，不能静默修改执行说明。

## 19. API 路由详细合同

### 19.1 `POST /api/v0/outcomes/plans`

请求：

```json
{
  "sourceText": "比较两个备份方案并给出选型建议",
  "context": {
    "botId": "<uuid>",
    "channelId": "<uuid>",
    "projectId": "<uuid>"
  },
  "clientRequestId": "plan:<uuid>"
}
```

响应：

```json
{
  "planId": "<uuid>",
  "status": "ready",
  "sourceText": "比较两个备份方案并给出选型建议",
  "goal": {
    "options": [
      {"id": "goal-1", "text": "形成可执行的选型建议", "recommended": true, "reason": "直接对应决策结果"}
    ],
    "selectedOptionIds": [],
    "customEntries": []
  },
  "acceptance": {"options": [], "selectedOptionIds": [], "customEntries": []},
  "boundaries": {"options": [], "selectedOptionIds": [], "customEntries": []},
  "conflicts": []
}
```

### 19.2 `POST /api/v0/outcomes`

请求必须包含 plan ID 和最终选择：

```json
{
  "planId": "<uuid>",
  "goal": {"selectedOptionIds": ["goal-1"], "customEntries":[]},
  "acceptance": {"selectedOptionIds": ["acceptance-1"], "customEntries":[]},
  "boundaries": {"selectedOptionIds": ["boundaries-1"], "customEntries":[]},
  "title": "备份方案选型建议",
  "clientRequestId": "outcome:<uuid>"
}
```

服务端返回 Outcome、revision 1 和冲突。没有 blocking conflict 时 revision 1 直接进入 `pending_approval`；存在 blocking conflict 时 revision 1 停在 `draft`，客户端通过 §19.5 提交修改后的内容。

### 19.5 `POST /api/v0/outcomes/:id/revisions`

用完整确认内容创建新 revision，用于解决规划冲突，或在 Decision 要求变更范围后提交新范围：

```json
{
  "baseRevision": 1,
  "contract": {
    "goal": ["形成可执行的选型建议"],
    "acceptance": [{"statement": "比较两条可行路线", "required": true}],
    "boundaries": {"included": ["公开资料研究"], "excluded": ["修改生产系统"]},
    "budget": null
  },
  "changeSummary": "补充排除项",
  "sourceDecisionId": null,
  "clientRequestId": "revision:<outcomeId>:<n>"
}
```

- `baseRevision` 必须等于当前 revision，否则返回 `409 contract_revision_conflict`。
- 当前 revision 未批准时，旧 revision 标为 `superseded`；已批准时，新 revision 记录 `changeSummary` 和来源。
- 新 revision 没有 blocking conflict 时进入 `pending_approval`。
- `verificationMethod` 和 `required` 仍按 §17 规则由服务端确定，客户端提交的 `required` 只作为用户意图记录。

### 19.6 `GET /api/v0/outcomes`

查询参数：`status`（可多值）、`cursor`（`updatedAt` + `id` 组合游标）、`limit`（默认 20，最大 100）。返回 `{ items: OutcomeSummary[], nextCursor }`，`OutcomeSummary` 含 `id`、`title`、`status`、`botId`、`currentRevision`、`updatedAt`。

### 19.7 `POST /api/v0/outcomes/:id/reviews`

```json
{
  "expectedRevision": 1,
  "results": [
    {"criterionId": "<uuid>", "result": "PASS", "evidenceIds": ["<uuid>"], "comment": ""},
    {"criterionId": "<uuid>", "result": "FAIL", "evidenceIds": [], "comment": "缺少恢复时间对比"}
  ],
  "newEvidence": [
    {"criterionId": "<uuid>", "sourceType": "asset", "sourceRef": "asset:<id>", "contentSummary": "..."}
  ],
  "clientRequestId": "review:<outcomeId>:<n>"
}
```

服务端先写 `newEvidence`（`credibility=human_confirmed`），再写 Review，并重新计算 Outcome 状态。这是唯一的验收入口（D20），`004.4` 的人工回执验收也使用它。

### 19.8 `POST /api/v0/outcomes/:id/cancel`

请求 `{ "clientRequestId": "cancel:<outcomeId>" }`。服务端在事务中把 Outcome 置为 `cancelled`、未结束的 WorkItem 置为 `cancelled`，并对运行中的子线程 Run 使用 `run-service` 现有取消语义；已产生的 Output、Evidence 和 Review 保留。

### 19.9 `GET /api/v0/outcomes/:id/work-items/:workItemId/transcript`

只读返回子线程运行组的消息记录摘要（复用现有 transcript 读取能力），不提供写入。

### 19.10 `GET /api/v0/outcomes/:id/revisions/:revision`

2026-11-17 负责人批准的只读接口增量：沿用既有 Outcome 认证，返回保留的真实 `ContractRevisionView`、该 revision 的条款及其最新 Review 结果。不存在的 Outcome/revision 使用既有 404 错误。该读取不移动 currentRevisionId，不迁移条款，也不放宽 Review/Decision/人工控制资格；Desktop 可据此独立加载人工动作绑定的 N，同时继续展示当前待批准 N+1。

### 19.3 `POST /approve`

批准请求只能包含客户端意图：

```json
{
  "expectedRevision": 1,
  "confirmationText": "我确认以上目标、验收和边界",
  "clientRequestId": "approve:<outcomeId>:1"
}
```

服务端从数据库重新读取 revision 内容，保存 confirmation text、actorRef（父 design.md §44）、时间和摘要 hash。客户端不能传入 `approvedBy`。

### 19.4 `POST /runs`

请求：

```json
{
  "expectedRevision": 1,
  "clientRequestId": "run:<outcomeId>:1",
  "pilotProfile": "research-document"
}
```

响应：

```json
{
  "outcomeId": "<uuid>",
  "contractRevision": 1,
  "workItems": [
    {"id": "<uuid>", "executorType": "agent", "status": "queued"}
  ],
  "runs": [
    {"id": "<uuid>", "status": "queued", "nativeRunId": "<id>"}
  ]
}
```

## 20. API 错误和状态码

| 条件 | HTTP | code |
|---|---:|---|
| Outcome 不存在 | 404 | `outcome_not_found` |
| 规划生成失败 | 502 | `planning_generation_failed`（details.retryable=true） |
| 返工对象不是 FAIL/UNVERIFIED 条款 | 409 | `rework_not_allowed` |
| 规划草案过期 | 409 | `planning_draft_expired` |
| 选项不是草案快照 | 409 | `planning_option_not_found` |
| blocking conflict | 409 | `planning_conflict` |
| revision 不存在 | 404 | `contract_revision_not_found` |
| revision 已 supersede | 409 | `superseded_revision` |
| 未批准执行 | 409 | `contract_revision_not_approved` |
| 重复 key 不同内容 | 409 | `idempotency_conflict` |
| Run 已创建 | 200 | stored response |
| Review 缺 Evidence | 422 | `evidence_missing` |
| Review revision 不一致 | 409 | `review_revision_conflict` |
| revision 基线不一致 | 409 | `contract_revision_conflict` |
| 执行 Bot 不可运行 | 409 | `bot_not_runnable`（details.retryable 视原因而定） |
| Outcome 已取消或已接受 | 409 | `invalid_outcome_transition` |

## 21. 数据库约束和索引

### 必须约束

- `ContractRevision(outcomeId, revision)` unique。
- `Outcome.currentRevisionId` 只能指向该 Outcome 的 revision。
- `AcceptanceCriterion(contractRevisionId, ordinal)` unique。
- `WorkItem(outcomeId, ordinal)` unique。
- `OutcomeReview(criterionId, reviewSequence)` unique，可追踪重复 Review。
- idempotency key 按 `IdempotencyRecord(scope, key)` 唯一（现有主键）。

### 查询索引

- Outcome status/updatedAt。
- ContractRevision outcome/status/revision。
- WorkItem outcome/status/createdAt；WorkItem botId/status（并发上限查询，通过 Outcome 关联或冗余 botId 列）。
- Run outcomeWorkItemId/createdAt。
- Evidence criterion/contractRevision/createdAt。
- Output workItem/createdAt。

最终索引名称以 Prisma migration 生成结果为准，任务完成时将生成的 SQL/索引写入证据。

## 22. 事务边界

### 创建 Outcome

一个事务写：Outcome、ContractRevision draft、AcceptanceCriterion、初始 Event、IdempotencyRecord response。

### 批准 revision

一个事务写：revision status、approval proof、Outcome status、Event。不能在事务中调用 Worker。

### 创建 Run

`enqueueWake` 只写数据库（Message、Run、InboxEvent、Event），不调用 Worker。因此 WorkItem、子线程根 Run、InboxEvent 和 `outcome.work_item.created` 事件放在同一个事务里，WorkItem 保存 `rootRunId`。Worker 通过现有 InboxEvent 队列领取任务，不需要第二个事务回写。只有当执行 Bot 当前不可运行（`enqueueWake` 抛出 `Runnable target bot ... was not found`）时，WorkItem 写入 `retry_pending`（Bot 处于 provisioning 等临时状态）或 `failed`（Bot 不存在或已停用）。

### Review

一个事务写：Review、Evidence references、criterion status、Outcome status、Event。最终状态由服务端重新计算。

## 23. Agent context 结构

进入 Worker 的 Outcome context 不能通过拼接用户可见消息实现，也不使用 `taskConfiguration`。传递方式：

1. 提交 WorkItem 时，在 `WakeInput` 增加可选字段 `outcomeWorkItemId`，由 `enqueueWake` 写入 InboxEvent payload（与现有 `automationContextRunId`、`taskContextRunId` 相同的做法）和 `Run.outcomeWorkItemId`。
2. Worker 领取 InboxEvent 后，`platformPrompt` 根据 `outcomeWorkItemId` 从数据库读取 WorkItem 和已批准 revision，生成下列结构，并作为 `ambientContext` 的一段隐藏上下文注入（与现有 ambient context 相同的 `[SAND_HIDDEN_PROMPT]` 通道）。
3. 子线程内部的 Message（运行时会话记录，不是用户可见的 `ChannelMessage`）只包含 WorkItem 的执行说明，不包含 Contract JSON。
4. 普通 Run 的 payload 没有 `outcomeWorkItemId`，prompt 和请求快照保持不变。
5. 子线程上下文 scope 为 `outcome`，与主对话的 `home` scope 隔离：子线程看不到主对话历史，主对话也看不到子线程过程。

上下文结构：

```json
{
  "outcome": {
    "id": "<uuid>",
    "contractRevision": 1,
    "goal": ["形成可执行的选型建议"],
    "acceptance": [
      {"id":"A1","statement":"比较两条可行路线","required":true}
    ],
    "boundaries": {
      "included":["公开资料研究"],
      "excluded":["生产系统修改"]
    }
  },
  "execution": {
    "workItemId":"<uuid>",
    "outputRequirements":["报告草案","来源列表"]
  }
}
```

Agent 需要用户决策时调用 `RequestOutcomeDecision` 内部工具（`004.3` §41），需要人工现场动作时调用 `RequestHumanAction`（`004.4` §32）；两者只在 Outcome 子线程中提供。

## 24. Agent 输出映射（D15）

子线程不向主对话发送可见消息。Output 有两个来源，都在运行组结算时写入（§12.4）：

1. **最终结果**：运行组最后一个 Run 的最后一条 agentMessage（`run_item.completed` 事件，`item.type = agentMessage`），写 `OutcomeOutput(kind=final_result, content=<文本>)`。这与 Routine 保存静默结果的来源相同（`saveSilentAutomationResult`）。
2. **输出文件**：执行说明要求 Agent 把交付文件写入工作区 `outcomes/<outcomeId>/<workItemId>/`；结算时登记该目录下的文件为 `OutcomeOutput(kind=file, contentRef=<路径或 asset 引用>)`。

规则：

- Output 不自动成为 PASS 证据。系统为每个 Output 创建一条 `credibility=agent_report` 的 Evidence 候选，挂到相关条款，只供 Review 参考。
- reasoning、tool call 和内部日志不是 Output。
- 子线程不能调用 `SendToUser`：`outcome` 映射为 `automation` 请求来源后，`AUTOMATION_PARENT_ONLY_TOOLS`（`packages/contracts/src/automation-tools.ts`，含 `SendToUser`、`ReactToMessage`、`SendToAgent`、`RequestUserForm`、`DraftExternalMessage` 等）在子线程中不可用（`apps/computer/src/runtime/tools.ts:787`、`:882`）。实现时以工具列表快照测试固定。

## 25. Review 计算

```ts
function outcomeAcceptanceStatus(criteria: CriterionReview[]): OutcomeStatus {
  const required = criteria.filter(c => c.required);
  const satisfied = (c: CriterionReview) =>
    c.result === "PASS" || (c.result === "WAIVED_BY_APPROVED_CHANGE" && c.waiverRevisionApproved);
  return required.every(satisfied) ? "accepted" : "review_pending";
}
```

`WAIVED_BY_APPROVED_CHANGE` 只有在关联的新 revision 已批准时才算满足；没有关联批准记录的豁免不能提交。

实际实现还要检查：

- 是否需要人工验收人。
- Evidence 是否满足 `evidenceRequired`。
- 是否存在未完成的必需 WorkItem。
- 是否有开放 Decision 或 HumanAction。
- 当前 revision 是否仍然是 Outcome current revision。

任何一个条件未满足，都不能进入 Accepted。

## 26. Desktop 组件和状态

建议组件边界：

```text
OutcomeEntryPoint
  └─ PlanningWizard
      ├─ PlanningDimensionStep
      ├─ CustomEntryEditor
      ├─ ConflictSummary
      └─ ContractConfirmation

OutcomeDetail
  ├─ ContractRevisionSummary
  ├─ WorkItemList
  ├─ RunSummary
  ├─ EvidenceList
  └─ ReviewPanel
```

UI 状态必须区分：

```text
loading
draft
conflict
pending_approval
approved
submitting
running
review_pending
accepted
failed
```

刷新时以服务端状态覆盖本地状态。批准按钮在请求处理中禁用，错误返回后保留用户选择。

## 27. 测试 fixture

```text
specs/004.2-Outcome规划执行与成果验收闭环/docs/fixtures/
  planning-generation-failed.json
  rework-after-fail.json
  ai-prereview.json
  planning-basic.json
  planning-conflict.json
  planning-custom-multi-select.json
  contract-approved.json
  run-research-pilot.json
  output-multiple-send-to-user.json
  evidence-missing.json
  review-fail.json
  review-pass.json
  duplicate-approve.json
  duplicate-run-submit.json
```

每个 fixture 必须定义：

- 初始数据库实体。
- API 请求顺序。
- 预期状态。
- 预期 Event。
- 预期 idempotency response。
- 清理方式。

## 28. 测试矩阵

| 层级 | 必须覆盖 |
|---|---|
| contracts | DTO、枚举、错误、选项上限、序列化 |
| service unit | planning、contract、approve、review、状态转换 |
| DB integration | migration、unique、revision immutable、transaction rollback |
| server integration | API、auth、idempotency、Run bridge |
| worker integration | context 注入、普通 Run 回归、Run output |
| desktop | wizard、conflict、refresh、approve、review |
| E2E | research pilot 全链路 |

## 29. 失败恢复和回滚

- Planning provider 失败：保存可重试的 draft error，不创建 Contract。
- Contract 写入失败：事务回滚，不留下可批准半对象。
- OpenTeam 提交失败：WorkItem 进入 `retry_pending` 或 `failed`，不重复创建消息。
- Agent Run 失败：Outcome 进入 review/failed，保留 Output 和错误。
- Evidence 上传失败：不改变 criterion status。
- Review 请求超时：使用相同 clientRequestId 重试。
- 数据库 migration 失败：停止部署，恢复旧应用和旧 schema 兼容路径。

## 30. 设计决策记录

本 Spec 的设计决策统一登记在父 design §39，这里只列出引用和本阶段补充的实现细节：

| 问题 | 结论 |
|---|---|
| WorkItem 存储、Run 关联 | `OutcomeWorkItem` 新表 + `Run.outcomeWorkItemId`（D14） |
| 执行方式 | Outcome 子线程（D09、D10、§12） |
| 一次运行创建几个 WorkItem | 1 个（D11） |
| Output 来源 | 运行组最终结果 + 输出目录文件（D15、§24） |
| 研究试点 | 使用真实开发 Bot，fixture 见 `docs/research-pilot.json`（D05） |
| Evidence 大文件 | 复用现有 asset store，Evidence 只保存引用 |
| `verificationMethod` | `human_review`、`deterministic_check`（§9.3） |
| 批准证明 | `approvalProof = { confirmationText, contentHash(sha256 of goal/acceptance/boundaries/budget/executionBotId), actorRef, approvedAt }` |
| 客户端范围 | Desktop 完整；Android/iOS 只读列表和详情（父 §41，需求 20） |

## 31. 规划候选项生成

### 31.1 生成方式

`OutcomePlanningService` 通过 `computerJson` 调用 computer 现有的 `POST /v1/infer`（`COMPUTER_API_PATHS.inference`），不在 server 进程内直接调用模型提供方，也不新建 Agent Run：

```text
POST /v1/infer
{
  "kind": "planning",
  "instructions": "<planning system instructions>",
  "prompt": "<sourceText + 可选 Bot 名称/描述>",
  "timeoutMs": 60000,
  "model": "<当前推理设置的模型>",
  "reasoning": "<当前推理设置>"
}
```

需要的代码变更：

1. `packages/contracts/src/service-protocol.ts`：`ComputerInferenceRequest.kind` 增加 `"planning"` 和 `"prereview"`，`parseComputerInferenceRequest` 同步放行。
2. `apps/computer/src/runtime.ts` 的 `infer` 已经把 `kind` 作为日志标签使用，不需要其他改动。
3. 模型和推理强度从 `agentData.loadInferenceSettings()` 读取，与现有推理设置一致。

规划只调用一次模型，不跑完整的 Agent 回合，因此不会触发工具调用。

### 31.2 输出格式

instructions 要求模型只返回 JSON：

```json
{
  "goal": [{"text": "...", "recommended": true, "reason": "..."}],
  "acceptance": [{"text": "...", "required": true}],
  "boundaries": [{"text": "...", "kind": "included|excluded"}],
  "questions": ["只在缺少关键信息时提出的问题"]
}
```

服务端解析后：

1. 每个维度截断到 4 项，超长文字截断到 §16.2 的上限。
2. 为每项生成稳定 ID（格式 `<维度>-<序号>`，例如 `goal-1`、`acceptance-2`、`boundaries-1`），保存到 PlanningDraft 快照。
3. JSON 无法解析时重试一次；仍失败则返回 `planning_generation_failed`，`details.retryable=true`。
4. `questions` 作为 `ambiguous_scope` 类 informational conflict 返回，原规划 §6.1 的“只询问影响结果的关键问题”由此实现。

### 31.3 PlanningDraft 持久化

PlanningDraft 保存在新表 `OutcomePlanningDraft`：

```text
id, sourceText, botId, status(ready|failed|consumed|expired),
snapshot JSON（三个维度的 options、conflicts、questions）,
error JSON nullable, createdAt, expiresAt
```

`POST /api/v0/outcomes` 消费 draft 后将其标记为 `consumed`。过期时间为 24 小时，过期 draft 由现有清理任务删除。

### 31.4 推荐来源

每个 recommended 选项必须带 `reason`，说明为什么推荐（例如“直接对应用户请求中的决策目标”）。本项目不做长期偏好学习（父 requirements.md Out of Scope），因此推荐来源只有当前请求和 Bot 描述；UI 展开时显示 `reason`，满足原规划 U07 中“推荐有来源”的要求。

## 32. 验收失败后的返工

原规划 §9.1 要求“授权内可修复”时回到执行，不打扰用户重新规划。本 Spec 的实现：

1. 任一必需条款为 FAIL 或 UNVERIFIED 时，Outcome 停在 `review_pending`，Review UI 提供“返工”操作。
2. `POST /api/v0/outcomes/:id/rework` 请求体：

```json
{
  "criterionIds": ["<criterionId>"],
  "comment": "补充两条方案的恢复时间对比",
  "expectedRevision": 1,
  "clientRequestId": "rework:<outcomeId>:<n>"
}
```

3. 服务端在同一 revision 下创建 `kind=rework` 的 Agent WorkItem，`reworkOfWorkItemId` 指向原 WorkItem，执行说明包含 FAIL 条款原文和用户意见，然后按 §12 提交。
4. 返工不改变 Contract，因此不需要新 revision；如果用户在返工意见里要求改变目标、验收或边界，必须改走 revision 变更流程。
5. 返工 Run 完成后产生新的 Output 和 Evidence 候选，用户对之前未通过的条款重新提交 Review。旧 Review 保留为历史记录。
6. 返工次数不设上限；每次返工都是用户主动发起，不存在系统自动重试循环。

## 33. AI 预审建议

原规划 §10.3 建议在执行之外增加独立的验证步骤。本 Spec 采用最轻量的实现：

1. Agent WorkItem 进入 `completed` 后，服务端调用一次 `POST /v1/infer`，`kind="prereview"`，输入为已批准的验收条款和本次 Output 摘要，不复用执行 Agent 的提示词和会话。
2. 模型对每条条款返回建议结论（`likely_pass`、`likely_fail`、`unclear`）和一句理由。
3. 结果作为 `credibility=ai_prereview` 的 Evidence 写入，在 Review UI 中作为参考显示。
4. 预审建议不能写入 Review 结果，必需条款的 PASS 仍由用户提交（父 design.md §39 D07）。
5. 预审调用失败时只记录 Evidence 缺失，不阻塞 Review。

## 34. Budget 字段

原规划 §7.1 的 Budget 在本 Spec 只保留可选字段，不设默认值：

```json
{ "timeLimitMinutes": null, "costLimit": null }
```

1. 规划向导允许用户填写，但不作为必填项。
2. 本阶段只把 budget 作为执行上下文的一部分交给 Agent，并在 Outcome 详情中显示，不实现自动中止。
3. 预算超限检测属于 `004.5` 的指标记录：只记录 Outcome 实际耗时，供用户在验收时参考。

## 35. 普通对话原生 Outcome 工具

依据：[需求 21](requirements.md#需求-21在普通对话中管理原生目标)；实现任务：阶段 8。本节补齐“界面和 HTTP 服务已存在，但普通 Bot 没有创建/查询工具”的真实缺口，不替换既有批准、执行和验收模型。

### 35.1 工具和现有服务

在现有 `cursor` 动态目录中注册下列可发现工具，使用共享 Effect Schema 生成输入合同；不占用所有普通回合的直接工具列表：

| 工具 | 既有服务及语义 |
|---|---|
| `PlanOutcome`、`GetOutcomePlan` | `OutcomePlanningService.create/get`；Bot 由当前 Run 提供，返回三维候选项、planId 和到期状态 |
| `CreateOutcome` | `OutcomeService.createFromDraft`；验证真实选项与自定义内容，仅创建未批准契约 |
| `ListOutcomes` | `OutcomeService.list`；新增可选 `query` 标题/描述搜索，保留状态与 cursor 分页 |
| `GetOutcome` | `OutcomeService.get/getRevision/transcript`；可选历史 revision 或 WorkItem 执行记录 |
| `ReviseOutcome` | `OutcomeService.createRevision`；完整 Contract、baseRevision、变更说明 |
| `StartOutcome`、`CancelOutcome` | `OutcomeService.startRun/cancel`；启动不代替批准，取消不删除审计 |
| `ListOutcomeInbox` | `OutcomeInboxService.list`；只读当前业务事实，可限定 Outcome |
| `ListExploreIdeas`、`GetExploreIdea`、`CreateExploreIdea`、`ProposeExploreIdea`、`DiscardExploreIdea` | `ExploreService`；沿用规划、来源关联、终态只读和幂等规则 |

单所有者产品的目标/探索读取范围与已认证界面一致，不引入跨租户/RBAC 引擎。创建规划和探索的默认 Bot 来自当前持久化 Run，审计主体使用 `bot:<run.botId>`，不伪造用户批准。

### 35.2 调用和确认

`InternalToolService` 在现有 Run 身份检查后调用新增 `OutcomeChatTools` 适配器；AppService 装配真实 Planning/Outcome/Inbox/Explore 服务。后台及委派 Bot 不提供该管理目录，服务端同步检查，不改变 `RequestOutcomeDecision` / `RequestHumanAction` 的子线程限制。所有写工具复用原有 `clientRequestId`、事务、事件和服务错误；只解析输入，不重复维护业务状态机。

Bot 可以根据聊天形成候选方案及待批准契约，但必须将建议标为草案，并通过 `outcomeDeepLink` 返回现有详情页供用户核对。不注册批准、Review PASS、人工回执或任意状态写入工具。用户在既有界面批准后，Bot 才可按用户请求启动确切的 `expectedRevision`。修改已批准目标产生待批准 successor，不能自动接管旧运行。

平台提示说明“目标”默认使用原生工具，仅用户明确指定 Notion 等外部系统时使用对应连接器；工具未返回成功前不得声称记录已保存。主对话的 Todo/请求进度仍是另一类记录，不冒充 Outcome。

### 35.3 验证与上线

共享合同测试覆盖无效输入和候选项限制；Computer 目录测试确认新增工具仅普通主 Bot 可发现、旧工具顺序和后台行为不变。服务端用实际独立 PostgreSQL 验证创建/搜索/分页/历史/变更/批准前拒绝启动/用户批准后启动/幂等/取消/Explore/收件箱及当前 Run 身份校验。普通聊天不调用工具时不写 Outcome。

不修改数据库 schema、旧客户端协议或生产数据。真实远端 Computer 使用 `apps/computer` 与共享 contracts 镜像，必须同步并重建后才拥有新目录；本任务默认只完成本地实现和隔离测试，不自动中断正在执行的远端 Bot。


## 36. 对话阶段卡片与渐进披露（2026-11-18）

对应需求 22、任务 9.1–9.2。沿用现有 ChannelMessage metadata、sendVisible 及 channel.message.updated 事件。服务器在工具调用期间发布紧凑文字回退和 outcome-card 元数据；同一调用的阶段原位更新，重试不产生重复卡片。分析与生成来自实际调用边界，规划完成只表示建议就绪；创建后依据真实 Outcome 状态区分待批准、执行、待决策/人工处理、待验收、已验收及失败。支持旧客户端的纯文字回退，不更改数据库或工具输入合同。

Desktop 使用主题 token、既有按钮和原生图标，阶段动画分别采用分析呼吸、生成扫描、执行旋转及结果短暂入场；减少动态效果时全部静止。带目标 ID 的卡片通过现有只读 API 刷新当前事实，展示读取失败与重试，旧阶段快照不能当作当前状态。

详情分三层：第一层目标/状态/下一步与计数；第二层按用户动作展开完整契约、结果、执行和验收；第三层来源/ID/历史/恢复诊断。批准按钮只在完整契约审阅展开后存在，待验收入口保持显著，历史回执指定 revision 的加载与权限检查沿用既有逻辑。长背景不通过 CSS 截断冒充摘要，只在明确的背景展开层完整保留。

验证覆盖真实持久化卡片与阶段更新、重试/失败、挂载交互的默认隐藏与展开、审阅批准门槛、结果与用户验收区别、历史 revision 回归和 reduced-motion 样式；复用独立测试数据库，不向调试 Bot 发送测试消息。


## 37. 决策优先的三层语义总览（2026-11-18 修正）

第 36 节的初版只折叠原内容，没有形成用户需要的语义层次。本节将首屏改为：真实当前决策/人工事项或批准入口 → 一句话背景 → 前提状态 → 可选风险 → 少量任务名。类别第二层显示简短解释/清单；第三层才显示来源原文、完整契约、证据和执行记录。对话卡片与详情复用相同总览。

新增只读 `GET /api/outcomes/:id/brief`，复用现有 inference 仅做文字整理，不调用工具、不写业务数据、不改 schema。来源为当前描述与契约快照，摘要包含短句及可核对的原文引用；生成的前提只允许 unknown，批准与 WorkItem 依赖由客户端真实记录补充。风险仅整理明确写出的风险，不将所有排除边界强制转换成风险；建议任务明确区分实际 WorkItem。进程内有限缓存按来源内容版本去重，不作为持久事实；失败返回不可用，界面保留可操作降级与重试。

摘要、Inbox 的异步结果按 Outcome/revision/来源版本匹配，不可泄漏上一目标或旧版本。原完整契约、历史 Review、幂等与明确批准保持不变；折叠后不卸载已访问表单。实际 Inbox 按 requiresAction 筛选并保留原路由处理。验证短默认文案、独立展开及第三层原文、无风险省略、未知/批准/依赖状态、真实待办、过期响应和原批准回归。


## 38. 审批选项、行内信息浮层和隐藏记录

需求 24 将主审批区命名为“需要你决定的事”，提供不预选的“批准当前方案”“稍后决定”“自定义修改”选项。明确提交批准时生成相应确认文字，继续传原 expectedRevision/clientRequestId；稍后决定不写业务状态。自定义文字通过现有规划服务形成候选项，复用规划向导确认目标/验收/边界后，仅以原 baseRevision 保存待批准新版本，不能当作当前契约的附加授权。创建向导和详情共用审批组件。

前提、任务、风险的来源改为文字尾部的 Info 按钮，复用既有 Radix Popover；悬停临时展示，点击固定，Escape/外点关闭，保留键盘访问。来源不占单独一行。实际任务状态来自 WorkItem；建议步骤显示未安排，风险无独立处置事实时保持待评估，前提维持真实满足/未满足/待核实。完整资料、历史、诊断与手动编辑隐藏在显式“更多详情”操作之后，验收和成果的直接动作仍可打开相应记录。

本节替代 §36 中审批区强制展示全文的旧布局，不改变明确批准和版本校验。自定义修改生成候选项后沿用现有规划向导及 `createRevision`：使用生成时的 `baseRevision`，保存后仍待批准，不创建第二个目标。已批准快照继续保持原服务语义。生成失败时保留原目标；原方案超过既有规划输入上限时明确提示使用辅助记录中的手动编辑，不静默截断内容。


## 39. 决策控件直接进入首屏

按用户本轮修正替代 §38 的三级审批选项及“查看决策选项”入口。待批准方案在概览顶部显示意见输入及两个直接按钮：明确批准时以已有 confirmationText 保存意见；否定时使用意见生成修改建议，原方案不批准、不执行，候选内容仍待用户确认保存。意见可选；无意见时按明确的“不同意当前方案，请给其他建议”生成候选，不额外阻挡否定按钮。

真实运行 Decision 复用现有 DecisionController/HTTP resolve，直接嵌入目标首屏。最多四个选项使用服务端原 label，不从文案猜测 resolutionEffect；后果、理由和来源在行内 Info 中分段、加粗呈现。自定义文字输入即选中独立自定义项，仍受 customEntryAllowed 约束。选项明确为成对 yes/no 标签时可用直接按钮，其他情况用选择框和一次提交。保留提交中的禁用、网络重试同键、过期/冲突重读、历史版本和诊断。


## 40. 目标浮动模态框和紧凑输入

目标、Decision、人工事项和创建流程使用既有 Radix Dialog 的同一浮动容器，主列表/收件箱/探索页面留在背景。列表点击、深链接和内部跳转复用当前 Route；外点、Escape 或关闭按钮回到原分类，并保留过滤状态和列表上下文。浮层自身滚动，不使长内容超出窗口；Info Popover 继续使用原层级和关闭行为，不把内部点击当作外点。

意见 textarea 使用原生一行 rows 与现有 Chromium 支持的 field-sizing:content，随换行/折行增长，达到合理最大高度后内部滚动，清空后缩回，不建立第二套高度状态。修改按钮保留原生成修改候选语义，仅改名“修改”；唯一方案 Info 放在上方摘要，仍能查看已保存的完整方案。

折叠任务栏用总数/完成/进行中替代几个任务名称。只统计当前 revision：completed 与人工 accepted 计完成，running/in_progress 计进行中，其余不冒充进行中；没有实际 WorkItem 时可显示明确的建议步骤数量、完成和进行中均零，摘要未完成时维持加载/不可用提示。


## 41. 来源浮层与只读执行消息

Info 复用 MessageResponse 渲染 Markdown，Popover Portal 优先放到最近的 Dialog 内容内，使既有滚动锁允许浮层内的滚轮；其他 Popover 保持默认容器。来源高度受视口限制并独立滚动，悬停/固定/Escape 行为不变。

对话卡片刷新同一目标时保留当前事实，只在目标身份变化时清空；背景数据变化不重置展开记录。头像沿用同身份/同凭据的现有资源保留能力，替换图片加载期间保持旧图，切换身份或退出时不能沿用。

执行消息入口只在有当前版本 agent WorkItem/Run 时出现，打开只读对话（§41.2）才请求既有 transcript GET；原卡片内展开已被 §41.2 取代。按任务和分页边界匹配异步响应；最近消息视图在任务运行且对话打开时串行定时刷新，关闭即停止；请求期间保留原消息，失败显示提示与重试。按服务端既有边界展示 Bot 可观察回复与脱敏工具投影；run 级 user 行混有调度/执行输入，不作为普通用户消息渲染，不展示内部推理，不提供输入或状态写入。采用有界分页，不把整段 JSON 当作用户消息。对应需求 27、任务 14.1–14.2。

### 41.2 执行消息只读对话与入口

`outcome-execution-card.tsx` 拆为三个导出，共用同一套读取与解析逻辑，不新增服务端接口或写入路径：

- `OutcomeExecutionDialog`：基于既有 Dialog 的只读对话。头部为 Bot 头像（`BotAvatar`，未知 Bot 回退默认头像）、Bot 名称、目标标题，多任务时提供任务选择，另有刷新；正文按时间从旧到新排列，assistant 行为带头像气泡（既有 MessageResponse 渲染 Markdown），tool/command/file_change 行为默认折叠的脱敏工具活动；底部为“此聊天为只读”与“关闭聊天”，复用既有文案。读取、`next_before` 分页、5 秒串行刷新、按 Outcome/WorkItem/分页键丢弃晚响应与失败重试沿用原语义，仅在对话打开时生效。滚动容器在位于底部时跟随最新消息，翻到较早页或手动上滚后不强制回底。`BotAvatar` 以懒加载引入，避免把依赖认证与 `window` 的模块拉进目标详情的纯数据模块图。
- `OutcomeExecutionCard`：入口按钮，显示“执行消息 · 只读 ›”；没有当前版本 agent WorkItem/Run 时不渲染。Bot 由对话消息（`RichMessage.bot`）或目标详情/工作区的 Bot 列表按 `botId` 解析。
- `OutcomeExecutionListAction`：全部目标列表行右侧的独立按钮（作为 `li` 内的兄弟节点，避免按钮嵌套）。点击时才 GET 该目标详情再打开对话；读取中/失败在小弹层内提示。草稿、规划中、待批准、待启动不显示。

对话目标卡片的底部 `footer` 与入口共行：入口 `flex: 1` 占满剩余空间并与“查看目标”等高，“查看目标”保持原样式靠右；`footer` 不显示的阶段，入口单独显示在原位置。样式在 `outcome-ui.css`，窄屏下弹层随视口收窄。

对应需求 27 补充（执行消息只读对话）、任务 16.1–16.4。

### 41.1 侧栏云电脑画面刷新

既有 `useAuthenticatedResource` 已按 Bot 与凭据代际保留旧资源，但刷新失败会清空结果，且新 Blob 仅下载完成便切换，图片尚未解码时仍可能出现空白。继续复用现有资源租约，不新增画面缓存或第二套刷新状态：启用保留时，临时失败维持同一身份的已显示资源；BotScreen 单独启用 `decodeImage`，新 Blob 经浏览器原生 `HTMLImageElement.decode()` 成功后才提交 URL。旧租约继续在 React 替换 DOM 后释放；失败及取消的候选租约释放，原取消和凭据代际检查仍阻止过期结果。

预览失败使用原重新连接文案，已有画面时以底部小提示标明暂未更新，成功加载新画面后移除提示。首次失败仍显示连接占位；Bot 身份变化、401 和退出不保留旧画面。其他资源默认不增加解码步骤；原五秒预览间隔、可见性/资源休眠、VNC 观看与接管流程不改变。对应需求 27 补充、任务 15.1–15.2。


## 42. 人工动作浮层的渐进披露（2026-11-18）

`human-work/human-action.tsx` 只改呈现，不改数据读取、开始/暂停变更、幂等键和回执提交逻辑。布局复用目标详情已有的简报样式：外层 `outcome-brief`，首屏 `outcome-now`（“现在需要你”），其下 `outcome-brief-facts` 内为若干折叠行。

- 首屏：标题下仅一行状态；`outcome-now` 展示下一步文字（优先已保存进度中的当前步骤，否则第一步）、“第 n 步，共 m 步 · 由你亲自完成，不会自动运行”，以及可开始/继续时的主按钮。已提交、已验收或不可操作时改为状态说明，不再显示“现在需要你”。驳回提示与暂停原因紧随其后。目的收在 `details`“查看为什么需要你”。
- 折叠行（`ActionSection`，原生 `details`，正文常驻挂载）：步骤（进行中默认展开）、前置条件（为空时不显示）、资料引用、证据要求、执行回执（进行中默认展开）、暂停并保存进度（仅进行中）、已保存进度（有草稿时）、回执历史（有被驳回回执时默认展开）、详情。正文常驻挂载是为了折叠后回执表单的本地输入不丢失，也让既有静态渲染与表单测试保持有效。
- `ReceiptForm`、`KnowledgeReferences` 的可见标题改为仅屏幕阅读器可见，避免与行标题重复；表单字段、提交流程、上传与重试逻辑不变。
- 新增文案同步到 `i18n-catalog.ts`；“详情”“状态”复用既有键。
对应需求 28、任务 17.1–17.2。

## 43. 目标内 Bitwarden 读取的步骤审批（2026-11-18）

原有读取闸门把 `routine` 与 `outcome` 两种来源同视为后台并一律拒绝（`internal-tool-service.ts`），而聊天内授权依赖“向聊天发 widget、用户回复后下一轮携带隐藏引用”，在目标线程里无从完成。本设计只放开 `outcome` 来源，复用既有决策链路，不新增表：

- 闸门：`outcome` 且带 WorkItem 的运行可调用 Bitwarden 工具；`routine` 与不合规子任务仍返回 `bitwarden_tool_forbidden`。搜索仅返回非机密元数据，与聊天一致，不需审批。
- 申请：`RequestBitwardenReadApproval` 在 Outcome 运行中先按原规则校验候选实例与项目，再交给 `createOutcomeCredentialApprovalTool`。若所有候选已被授权则直接返回 `already_granted`；否则经共享的 `requestDecisionFromRun`（由原 `RequestOutcomeDecision` 的事务体抽出，行为不变）在同一事务内创建决策并把 WorkItem 置为等待决策。决策两个选项：允许（`credentialGrant` 携带候选，由服务端写入，代理侧工具输入没有该字段，解码时被忽略）与不允许；`customEntryAllowed=false`。固定英文文案由桌面端翻译；具体登录项由 `credentialGrant` 在卡片首屏列出。
- 授权判定：`findOutcomeCredentialGrant` 读取该 Outcome 下 `reasonCode=credential_access_required`、已解决且 `resolvedBy` 以 `owner:` 或 `user:` 开头的决策，其已选选项的 `credentialGrant` 匹配实例与登录项时才放行。授权随决策记录存在，因此可审计，无需单独撤销存储；Outcome 被取消或验收后不再有运行可使用。
- 读取：`ReadBitwardenCredential` 在 Outcome 运行中以上述授权代替“隐藏引用 + 聊天授权记录”，其后的租约签发、消费和 Computer 内部读取流程完全沿用。
- 回合控制：决策被所有者解决后沿用既有 `decision_resolved` 唤醒新一轮；Computer 在 Outcome 线程收到 `waiting_for_user` 时结束本轮（与 `RequestOutcomeDecision` 一致）。技能与 README 同步说明“Outcome 线程里申请即暂停，批准对整个目标有效，被拒绝不重复申请”。
对应需求 29、任务 17.3–17.6。

## 44. 批准即执行（2026-11-18）

`OutcomeService.approve` 在批准事务内、重新计算目标状态之后，若状态为 `approved`（即没有更早的运行中或等待中的任务），调用与 `startRun` 共用的 `startApprovedRevision`：创建该版本的初始 agent WorkItem、记录事件并 `enqueueOutcomeTurn`，随后重新计算状态。初始任务按“同目标同版本只有一个 `initial`”去重，因此批准重放、重复启动与旧客户端的 `startRun` 都不会再建任务。未注入 messaging 的服务实例只批准、不启动（保持既有测试和无执行环境的行为）。入队失败时整个事务回滚，批准也不会生效，错误返回给调用方重试。

桌面端：`outcome-detail.tsx` 删除“现在开始执行已批准的方案？/启动已批准的目标”提示，改为“正在启动执行…”状态行；对话卡片与目标列表把 `approved` 阶段文案从“待启动”改为“正在启动执行”。对批准前遗留的“已批准且当前版本无任务”的目标，详情打开时用既有幂等 `start` 请求自动启动一次（按目标与版本去重，失败时显示错误，不循环重试）。对应需求 30、任务 18.1–18.3。
