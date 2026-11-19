# 设计文档 - Outcome 任务看板与自动登记

状态：Draft

## 1. 概述

### 1.1 目标

让 bot 能在日常对话里用一次工具调用登记"当场做不完的事"，并把不需要用户的事自动结束、需要用户的事送进收件箱。对应 `requirements.md` 需求 1–5。

### 1.2 覆盖需求

| 需求 | 设计章节 |
| --- | --- |
| 需求 1 自动登记 | §3.3.1、§2.3.1 |
| 需求 2 自动结束 | §3.3.2、§2.3.2、§6.1 |
| 需求 3 用户决策进收件箱 | §2.3.3、§4.2 |
| 需求 4 bot 行为约束 | §2.4 |
| 需求 5 展示与审计 | §3.2、§2.5 |

### 1.3 技术约束

- 标准目标的批准、验收逻辑保持不变（需求非功能 2.1）。
- 状态由事实派生（004.2 设计 §42.3），跟踪型目标不引入新的 `OutcomeStatus` 值。
- `OUTCOME_CHAT_TOOLS` 位于 `packages/contracts`，由 `apps/computer` 运行时读取，生效需要同步并重建远端 computer。

## 2. 架构

### 2.1 系统结构

bot（computer 容器）→ 动态工具 `TrackOutcome` / `CloseOutcome` → 控制面 `InternalToolService` → `OutcomeChatTools` → `OutcomeService.track / closeTracked`（单事务 + 幂等 + 事件）。

### 2.2 模块职责

- `packages/contracts/src/outcome-chat.ts`：两个新工具的输入 Schema 与描述。
- `packages/contracts/src/outcomes.ts`：`OutcomeDetail` 增加 `trackingMode`、`autoClosedAt`、`closeSummary`；`outcome.accepted` 事件载荷增加可选 `autoClosed`、`summary`。
- `packages/db`：`Outcome` 增加列与迁移。
- `apps/server/src/services/outcome-service.ts`：`track`、`closeTracked`。
- `packages/messaging/src/outcome-state.ts`：跟踪型目标存在未解决的无 WorkItem Decision 时派生 `decision_pending`。
- `apps/server/src/services/decision-service.ts`：无 WorkItem 的 `plan_only` Decision 解决后只记录。
- `packages/messaging/src/prompts/platform.json`：bot 行为准则。

### 2.3 关键流程

#### 2.3.1 登记

1. 校验 `TrackOutcome` 入参。
2. 同一事务内：创建 `Outcome`（`planningDraftId = null`、`botId` 取会话 bot）→ 写入修订 1。
3. 按 `ownerNeed` 分支：
   - `none`：`trackingMode = tracked`；修订 1 直接置为 `approved`，`approvedBy = system:auto-track`，写入 `approvalProof`；不创建 WorkItem。
   - `decision`：同上，并在同一事务创建 Decision（无 WorkItem），重新派生状态为 `decision_pending`。
   - `approval`：`trackingMode = standard`，修订 1 保持 `pending_approval`，等待用户批准；批准后沿用 `startApprovedRevision`。
4. 追加 `outcome.created`、`outcome.contract.revision_created`（及 `revision_approved`）事件。

#### 2.3.2 自动结束

`closeTracked(outcomeId, { resultSummary, clientRequestId }, actor)`：加锁 → 校验 `trackingMode = tracked`、未关闭、无活动 Decision → 写 `acceptedAt`、`autoClosedAt`、`closeSummary` → 追加 `outcome.accepted`（`autoClosed: true`）→ 重新派生状态为 `accepted`。

#### 2.3.3 用户决策

Decision 沿用 004.3 的快照、通知与收件箱；解决 `plan_only` 选项且无 WorkItem、目标为 `tracked` 时，只写入选择并重新派生状态（回到 `approved`，即进行中），`resume.status = "recorded"`；bot 通过 `GetOutcome` 读取 Decision 结果。`scope_change`/`acceptance_change` 选项对 `tracked` 目标不允许创建（登记时拒绝）。

### 2.4 bot 行为准则（platform.json）

- 当场能做完的不登记；做不完的先 `ListOutcomes` 查重再 `TrackOutcome`。
- 涉及付款、对外发送、删除、不可逆变更等必须由用户拍板的，只能用 `decision` 或 `approval`。
- 自动结束后用一句话告知用户结果；不为跟踪型目标索取验收。

### 2.5 展示

桌面端目标详情在 `tracked`/自动结束时显示"自动结束"标记与结果摘要；国际化文案放入 `i18n-catalog.ts`。

## 3. 组件和接口

### 3.1 核心组件

`OutcomeChatTools`（派发）、`OutcomeService`（写入）、`DecisionService`（决策解决）、`recomputeOutcomeStatus`（状态派生）。

### 3.2 数据结构

`Outcome` 新增：
- `trackingMode`：枚举 `standard | tracked`，默认 `standard`
- `autoClosedAt`：`DateTime?`
- `closeSummary`：`String?`

### 3.3 接口契约

#### 3.3.1 `TrackOutcome`

输入：`title`、`goal`、`acceptance?`（≤5 条，缺省一条"目标完成并已告知用户"）、`ownerNeed`（`none|decision|approval`，缺省 `none`）、`decision?`（`ownerNeed = decision` 时必填：`problemSummary`、1–4 个 `options{label, consequence, recommended?, reason?}`）、`clientRequestId`。
输出：与 `CreateOutcome` 同形（`outcome`、`url`、`approvalRequired`、`nextStep`）。

#### 3.3.2 `CloseOutcome`

输入：`outcomeId`、`resultSummary`（1–2000 字符）、`clientRequestId`。仅对 `tracked` 目标有效。

## 4. 数据与状态模型

### 4.1 数据关系

`Outcome(trackingMode=tracked)` —1:1 当前修订（自动批准）—0..n Decision（无 WorkItem）。

### 4.2 状态流转

`tracked/none`：`approved`（进行中）→ `accepted`（自动结束）或 `cancelled`。
`tracked/decision`：`decision_pending` → 用户解决 → `approved`（进行中）→ `accepted`。
`standard/approval`：`pending_approval` → 现有流程。

## 5. 错误处理

### 5.1 错误类型

`invalid_request`(400)、`outcome_not_found`(404)、`invalid_outcome_transition`(409)、`tracked_close_not_allowed`(409，非跟踪型目标或存在未解决 Decision)。

### 5.2 错误响应格式

沿用 `ApiError(status, code, message, details)`。

### 5.3 处理策略

写操作单事务整体回滚；重试依赖 `clientRequestId` 幂等。

## 6. 正确性属性

### 6.1 自动结束不绕过用户

对任意 `standard` 目标，`CloseOutcome` 永远失败；任意存在未解决 Decision 的目标，`CloseOutcome` 永远失败。验证：`apps/server/test/outcome-tracking.integration.test.ts`。

### 6.2 自动批准不产生执行

`tracked` 目标登记后不存在 WorkItem、Run。验证：同上测试断言 WorkItem 数为 0。

## 7. 测试策略

### 7.1 单元测试

`packages/contracts/test/outcome-chat.test.ts`：新工具 Schema 解码与拒绝额外属性、`ownerNeed = decision` 缺 `decision` 被拒。

### 7.2 集成测试

`apps/server/test/outcome-tracking.integration.test.ts`（需 `OUTCOMEGO_TEST_DATABASE_URL`）：登记、幂等、自动结束、拒绝路径、决策进收件箱并解决。

### 7.3 端到端测试

在远端 debug computer 同步重建后，由 bot 在对话中登记并自动结束一个目标（需用户同意重建）。

### 7.4 验证映射

| 需求 | 验证 |
| --- | --- |
| 1.1–1.4 | §7.1、§7.2 |
| 2.1–2.5 | §7.2 |
| 3.1–3.4 | §7.2 |
| 4.x | 提示词评审 + §7.3 |
| 5.x | 桌面端测试 `outcome-detail.test.ts` |

## 8. 风险与待确认项

### 8.1 风险

- bot 过度登记造成噪音：靠准则与查重缓解，后续可加频率限制。
- bot 误报"无需用户"后自动结束：属于信任边界，已限制为不执行、不授权，且全程审计、可从列表回看。

### 8.2 待确认项

- 跟踪型目标进行中的进度备注/到期提醒（本期不做）。
- 移动端展示（004.6 后续）。
