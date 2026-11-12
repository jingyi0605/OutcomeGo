# 设计文档 - Outcome 规划执行与成果验收闭环

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. 领域模型

```text
Outcome 1 ── * ContractRevision
ContractRevision 1 ── * WorkItem
WorkItem 1 ── * Run
Run 1 ── * Evidence
AcceptanceCriterion 1 ── * Evidence
```

最小对象：

- `Outcome`：成果目标和当前状态。
- `ContractRevision`：目标、验收、边界和执行上下文的不可变版本。
- `AcceptanceCriterion`：可验证完成条件。
- `WorkItem`：可分派给 Agent 或人的最小动作。
- `Run`：一次 OpenTeam 或人工执行实例。
- `Evidence`：输出、来源、时间和验证结果。

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

接口以 §19 为准，路径统一带 `/api/v0` 前缀（`apps/server/src/main.ts` 会把 `/api/v0` 映射为 `/api`）：

```text
POST /api/v0/outcomes/plans
POST /api/v0/outcomes
POST /api/v0/outcomes/:id/revisions/:revision/approve
POST /api/v0/outcomes/:id/runs
GET  /api/v0/outcomes/:id
POST /api/v0/outcomes/:id/reviews
POST /api/v0/outcomes/:id/rework
```

本阶段产生的事实事件（名称以父 design.md §14 为准）：

```text
outcome.created
contract.revision.created
contract.revision.approved
work_item.created
run.started
run.finished
review.required
review.recorded
outcome.accepted
```

事件 Envelope 和存储方式见父 design.md §14、§43。

## 5. 执行映射

```text
Approved ContractRevision
        ↓
WorkItem(subject, acceptance_refs, contract_revision)
        ↓
OpenTeam Bot / Run
        ↓
Output + Run events
        ↓
Evidence
        ↓
Acceptance review
```

执行上下文只包含已批准 Contract 的目标、验收、边界和必要资料。执行过程中产生的新目标必须回到用户决策或 Contract 变更流程。

## 6. 持久化

数据库迁移必须：

- 新增表或字段时保持现有数据可读。
- 为旧数据提供空值或默认兼容路径。
- 不覆盖已批准 revision。
- 为 Run、Evidence 和 Review 保存 Contract revision。

## 7. 验收逻辑

必需验收条款全部为 `PASS`，并且需要人工签收的条款已签收时，Outcome 才能进入 `Accepted`。任何 `UNVERIFIED` 都必须保留缺口信息。

## 8. 当前代码基线和集成点

在实现前必须以当前工作树为准更新此表。下表是已发现的首选集成点：

| 现有文件 | 责任 | 新增或调整 |
|---|---|---|
| `packages/contracts/src/index.ts` | 共享类型出口 | 导出 Outcome、Contract、Decision、Review 类型 |
| `packages/contracts/src/service-protocol.ts` | 路由/协议常量 | 增加 Outcome API 路径 |
| `packages/db/prisma/schema.prisma` | PostgreSQL 模型 | 增加 Outcome 相关模型和关系 |
| `apps/server/src/main.ts` | HTTP route 注册和生命周期 | 注册 Outcome routes |
| `apps/server/src/routes/` | 输入解析、鉴权和响应 | 新增 `outcome.ts` 或按现有组织方式拆分 |
| `apps/server/src/services/channel-service.ts` | 现有用户消息到 Run | 复用窄化的 Run 创建入口，不复制消息接受逻辑 |
| `apps/server/src/services/run-service.ts` | Run 取消/状态 | 增加 Outcome 关联查询或回调 |
| `apps/server/src/services/internal-tool-service.ts` | Agent 可见输出 | 将 `sourceRunId` 输出转为 Outcome Output/Evidence 候选 |
| `apps/worker/src/worker.ts` | Agent 回合执行 | 读取 Outcome context，不改变普通消息 prompt |
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
acceptance         JSON
boundaries         JSON
budget             JSON nullable，可选的时间或费用上限，不设默认值
executionBotId     UUID
changeSummary      text nullable
createdBy          actorRef（父 design.md §44）
approvedBy         actorRef nullable
approvedAt         timestamp nullable
approvalProof      JSON nullable
createdAt          timestamp
```

唯一约束：`(outcomeId, revision)`。批准后 `goal`、`acceptance`、`boundaries`、`budget` 和 `executionBotId` 不允许原位修改。本 Spec 不保存 authority 字段，原因见父 design.md §40。

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

### 9.4 `WorkItem` 和 `OutcomeRun`

如果现有 `Run` 不能直接扩展为 Outcome 关联，新增 `OutcomeWorkItem` 和关联表；不得复制一套 Agent Run 状态机。推荐：

```text
OutcomeWorkItem:
id, outcomeId, contractRevisionId, executorType(agent|human),
kind(initial|rework), title, instructions, status, ordinal, dependsOn JSON,
runId nullable, assignedTo nullable, reworkOfWorkItemId nullable,
createdAt, updatedAt

OutcomeRunLink:
workItemId, runId, contractRevisionId, linkedAt
```

若代码审计证明 `Run` 可直接增加 `contractRevisionId`，优先使用直接关系，减少映射表。

### 9.5 `Output` 和 `Review`

```text
OutcomeOutput:
id, outcomeId, workItemId, runId nullable, kind,
title, contentRef, sourceMessageId nullable, createdAt

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
  "acceptance": {"options": [{"id":"accept-1","text":"说明成本、恢复时间和限制"}],"selectedOptionIds":[],"customEntries":[]},
  "boundaries": {"options": [{"id":"boundary-1","text":"不修改生产系统"}],"selectedOptionIds":[],"customEntries":[]},
  "conflicts": []
}
```

### 11.2 批准和执行

批准和执行的请求体见 §19.3、§19.4。

```http
POST /api/v0/outcomes/<outcomeId>/revisions/1/approve
Idempotency-Key: approve:<outcomeId>:1
```

```json
{"approvedBy":"user:<User.id> 或 owner:local","approvedAt":"<iso-time>","revision":1,"status":"approved"}
```

```http
POST /api/v0/outcomes/<outcomeId>/runs
Idempotency-Key: run:<outcomeId>:1
```

响应必须包含 `outcomeId`、`contractRevision`、`workItemIds`、`runIds`、`status`，不能只返回一个不可追踪的后台任务 ID。

## 12. OpenTeam 执行桥接

桥接复用 `AgentMessaging.acceptDirectUserMessage`（`packages/messaging/src/index.ts`）这一现有消息接受入口；它在一个事务里创建 Message、Run 和 InboxEvent：

1. 将 WorkItem 的执行说明转换为现有用户消息或内部任务输入。
2. 使用服务端生成的 idempotency key，避免重复创建 ChannelMessage/Run。
3. 保存 `runId` 与 `contractRevision` 关系。
4. 监听已有 Run/Event 状态，不新建并行调度系统。
5. Agent 的普通运行行为、工具、记忆和消息投递保持不变。
6. `SendToUser` 产生的 `ChannelMessage.sourceRunId` 进入 Output 候选。
7. Run 结束时生成 ReviewPending，而不是直接 Accepted。

Outcome context 的传递方式见 §23。不使用 `taskConfiguration`：它是 Bot 级执行器配置，`parseTaskConfiguration` 会拒绝未知字段。

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

- `packages/contracts/src/index.ts`
- `packages/contracts/src/service-protocol.ts`
- `packages/contracts/src/outcomes.ts`（新增）
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<generated>_add_outcomes/`
- `packages/db/test/outcomes.integration.test.ts`（新增）

### 服务端和 Worker

- `apps/server/src/main.ts`
- `apps/server/src/routes/outcome.ts`（新增）
- `apps/server/src/services/outcome-service.ts`（新增）
- `apps/server/src/services/outcome-planning-service.ts`（新增，§31）
- `packages/contracts/src/service-protocol.ts`（`ComputerInferenceRequest.kind` 增加 `planning`、`prereview`）
- `apps/computer/src/main.ts`（无需改动；核对新 kind 透传）
- `packages/messaging/src/index.ts`（WakeInput/InboxEvent payload 增加 `outcomeWorkItemId`；`platformPrompt` 读取 Outcome context）
- `apps/server/src/services/contract-service.ts`（新增）
- `apps/server/src/services/outcome-review-service.ts`（新增）
- `apps/server/src/services/channel-service.ts`
- `apps/server/src/services/run-service.ts`
- `apps/server/src/services/internal-tool-service.ts`
- `apps/worker/src/worker.ts`
- `apps/worker/test/outcome-run.integration.test.ts`（新增）

### Desktop

- `apps/desktop/src/renderer/client/outcomego-api.ts`
- `apps/desktop/src/renderer/components/outcomego/chat-pane.tsx`
- `apps/desktop/src/renderer/components/outcomego/outcomes/`（新增）
- `apps/desktop/test/outcome-planning.test.ts`（新增）

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

1. 验证 draft ID 属于当前 owner。
2. 验证 draft 没有过期或被新的 draft supersede。
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
  "acceptance": {"selectedOptionIds": ["accept-1"], "customEntries":[]},
  "boundaries": {"selectedOptionIds": ["boundary-1"], "customEntries":[]},
  "title": "备份方案选型建议",
  "clientRequestId": "outcome:<uuid>"
}
```

服务端返回 Outcome、Contract draft 和冲突；存在 blocking conflict 时可以创建 draft，但不能进入 `pending_approval`。

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

## 21. 数据库约束和索引

### 必须约束

- `ContractRevision(outcomeId, revision)` unique。
- `Outcome.currentRevisionId` 只能指向该 Outcome 的 revision。
- `AcceptanceCriterion(contractRevisionId, ordinal)` unique。
- `WorkItem(outcomeId, ordinal)` unique。
- `OutcomeReview(criterionId, contractRevisionId, reviewerId, reviewSequence)` 可追踪重复 Review。
- idempotency key 按当前 owner/scope 唯一。

### 查询索引

- Outcome owner/status/updatedAt。
- ContractRevision outcome/status/revision。
- WorkItem outcome/status/createdAt。
- Run contractRevision/outcome/status。
- Evidence criterion/contractRevision/createdAt。
- Output run/sourceMessage。

最终索引名称以 Prisma migration 生成结果为准，任务完成时将生成的 SQL/索引写入证据。

## 22. 事务边界

### 创建 Outcome

一个事务写：Outcome、ContractRevision draft、AcceptanceCriterion、初始 Event、IdempotencyRecord response。

### 批准 revision

一个事务写：revision status、approval proof、Outcome status、Event。不能在事务中调用 Worker。

### 创建 Run

`acceptDirectUserMessage` 只写数据库（Message、Run、InboxEvent），不调用 Worker。因此 WorkItem、Message、Run、InboxEvent 和 `run.started` 前的 `work_item.created` 事件放在同一个事务里，WorkItem 直接保存 `runId`。Worker 通过现有 InboxEvent 队列领取任务，不需要第二个事务回写。只有当 Bot 当前不可运行（`acceptDirectUserMessage` 抛出错误）时，WorkItem 写入 `retry_pending` 或 `failed`。

### Review

一个事务写：Review、Evidence references、criterion status、Outcome status、Event。最终状态由服务端重新计算。

## 23. Agent context 结构

进入 Worker 的 Outcome context 不能通过拼接用户可见消息实现，也不使用 `taskConfiguration`。传递方式：

1. 提交 WorkItem 时，在 `WakeInput` 增加可选字段 `outcomeWorkItemId`，由 `acceptDirectUserMessage` 写入 InboxEvent payload（与现有 `taskContextRunId` 相同的做法）。
2. Worker 领取 InboxEvent 后，`platformPrompt` 根据 `outcomeWorkItemId` 从数据库读取 WorkItem 和已批准 revision，生成下列结构，并作为 `ambientContext` 的一段隐藏上下文注入（与现有 ambient context 相同的 `[SAND_HIDDEN_PROMPT]` 通道）。
3. 用户可见的 Message 内容只包含 WorkItem 的执行说明，不包含 Contract JSON。
4. 普通 Run 的 payload 没有 `outcomeWorkItemId`，prompt 和请求快照保持不变。

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

Agent 需要用户决策时调用 `RequestOutcomeDecision` 内部工具（`004.3` §41），该工具只在带 `outcomeWorkItemId` 的 Run 中提供。

## 24. Agent 输出映射

`SendToUser` 持久化为 `ChannelMessage` 后：

1. 通过 `sourceRunId` 找到关联 Run。
2. 通过 Run 找到 OutcomeWorkItem。
3. 创建 Output 记录，保存 message ID 和 sequence。
4. 若消息包含用户提供的来源引用，创建 Evidence candidate；不自动标 PASS。
5. `ReviewPending` 由 Run 完成和验收配置决定。

普通 `agent.delta`、reasoning、tool call 和内部日志不是默认 Output。若需要把文件或命令结果作为 Evidence，必须通过明确的 Output/Evidence adapter 转换。

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

实现前必须记录：

- WorkItem 是否新建表，还是扩展现有 Run/ChannelDelivery。
- Outcome 是否绑定一个 Bot/Conversation，还是允许多个 Bot（已决定：绑定一个执行 Bot，见父 design.md §39）。
- 研究试点是否使用真实 OpenTeam Bot。
- Evidence 大文件是否复用 asset store。
- AcceptanceCriterion 的 `verificationMethod` 枚举。
- Contract revision 的批准证明格式。
- 客户端第一版是否只做 Desktop（已决定：规划、批准和验收第一版只做 Desktop，见父 design.md §41）。
- Output 是否允许来自非 `SendToUser` 的现有消息类型。

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
2. 为每项生成稳定 ID（`goal-1` 等），保存到 PlanningDraft 快照。
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
