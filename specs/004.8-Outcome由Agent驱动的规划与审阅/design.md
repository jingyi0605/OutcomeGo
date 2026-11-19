# 设计文档 - Outcome 由 Agent 驱动的规划与审阅

状态：Draft

## 1. 概述

### 1.1 目标

- 目标管理里所有"理解用户意图、判断、规划"都发生在 PI Agent 回合中，程序不再拼提示词调用一次性推理；简报、摘要、预审保持后台一次性生成。
- 程序只保留：权限（谁能批准、验收、取消）、幂等、事实持久化、状态派生、调度与恢复。
- 用户的每句话原样进入目标线程。

### 1.2 覆盖需求

| 需求 | 设计章节 |
| --- | --- |
| 需求 1 用户的话由机器人处理 | §2.3.1、§3.3.1 |
| 需求 2 专属线程与记录 | §2.2、§3.2.1、§3.2.2、§2.3.5 |
| 需求 3 新建与探索转规划 | §2.3.2、§3.3.2 |
| 需求 4 机器人写契约 | §3.3.3、§6.1 |
| 需求 5 简报、摘要、预审保持后台生成 | §2.3.4 |
| 需求 6 状态派生 | §4.2 |
| 需求 7 移除固定规划流程 | §2.4、§2.5、§2.6、§7.1 |
| 需求 8 边界与可观测 | §6、§3.3.5 |

### 1.3 技术约束

- 复用现有机制：`enqueueWake(origin: "outcome")`、computer 请求里的 `outcomeThread` 标记、线程工具注册（`OUTCOME_THREAD_TOOLS`）、`Run` / `RunItem` 记录、004.5 恢复。
- 状态由事实派生（004.2 设计 §42.3），不新增手写状态字段。
- 线程工具位于 `packages/contracts`，由 `apps/computer` 读取，生效需要同步并重建远端 computer。
- 目标管理开关关闭时，不创建线程、不暴露工具（见本组改动的 `FeatureSettings`）。

## 2. 架构

### 2.1 系统结构

```
用户消息 / 新建 / 想法转入 ──► 服务端：校验、幂等、写入 Turn ──► 排队（容量、优先级）
                                                          │
                                                          ▼
                                          worker 唤醒执行机器人（PI Agent 回合）
                                                          │  使用线程工具读写事实
                                                          ▼
              SaveOutcomeContract / CancelOutcome / RequestOutcomeDecision / SaveOutcomeBrief ...
                                                          │
                                           服务端校验并持久化，派生状态，发事件
                                                          ▼
                                           桌面端读取事实 + 线程记录
```

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `OutcomeThreadService`（新，server） | 创建线程、投递回合、幂等、容量与优先级、读取回合列表 | 用户消息 | `OutcomeThreadTurn` |
| `outcome-thread-tools`（新，server） | 线程工具的服务端实现与校验 | 工具调用、回合上下文 | 持久化事实、审计事件 |
| `OUTCOME_THREAD_TOOLS`（computer） | 注册线程工具定义 | 回合标记 `outcomeThread.threadId`、`purpose` | 工具列表 |
| `packages/messaging` 平台提示词 | 目标线程运行说明（按 `purpose` 追加） | 回合上下文 | 提示词 |
| `recomputeOutcomeStatus` | 状态派生，读取运行中的回合 | 事实 | 状态 |
| 桌面端目标详情 | 展示契约、状态、线程记录；提供批准与"发给机器人" | 事实、记录 | 用户操作 |

### 2.3 关键流程

#### 2.3.1 用户消息

1. 目标详情"发给机器人"输入框提交文字（取代"修改"按钮与四步向导）。
2. `POST /api/outcomes/:id/thread/messages`：校验目标存在且未终结，写入 `OutcomeThreadTurn(purpose = owner_message, trigger = 原文)`，幂等键 `clientRequestId`，立即返回。
3. 排队成功后，worker 在线程上下文唤醒机器人，用户原文作为消息内容，另附只读的"目标当前事实"摘要（契约、状态、最近记录）。
4. 机器人自行决定：`SaveOutcomeContract` 修订、`CancelOutcome` 取消、`RequestOutcomeDecision` 提问，或仅回复。
5. 回合结束，最终回复保存到回合记录并显示在详情。

#### 2.3.2 新建与探索转入

1. `POST /api/outcomes/threads`（输入：描述、机器人、可选 `exploreIdeaId`、`clientRequestId`）。
2. 同一事务创建 `Outcome(status = planning, 无修订)`、`OutcomeThread`、`OutcomeThreadTurn(purpose = plan)`。
3. 机器人读到描述，决定追问或调用 `SaveOutcomeContract` 保存修订 1（待批准）。

聊天里新建目标：机器人在主对话直接调用 `CreateOutcome`（输入为它自己撰写的契约），不创建线程回合；之后线程在需要时惰性创建。

#### 2.3.3 修订保存后

`SaveOutcomeContract` 持久化修订并追加 `outcome.contract.revision_created`，与用户界面保存修订走同一服务方法，因此同样触发现有的成果简报预热（`OutcomeBriefService.warm`）。

#### 2.3.4 简报、摘要、预审（保持不变）

成果简报预热、成果摘要、验收预审继续由现有后台流程用一次性 LLM 生成，不创建线程回合，不改变目标状态。本 Spec 不改动 `outcome-brief-service.ts`、`outcome-review-service.ts` 的生成逻辑。

#### 2.3.5 线程记录展示

目标详情新增"Agent 记录"区：回合列表（用途、状态、时间、最终回复），点开复用执行记录阅读器（`readOutcomeTranscript` 扩展到 `threadId`）。

### 2.4 要删除的代码

| 位置 | 处理 |
| --- | --- |
| `apps/server/src/services/outcome-planning-service.ts` 的 `prepare` / `create` / `INSTRUCTIONS` | 删除生成逻辑；`view` 与草稿表保留只读，供旧数据 |
| `apps/server/src/services/outcome-replan-service.ts`、`outcome_replan` 表、`/replan` 路由 | 删除 |
| `explore-service.ts` 中调用 `planning.prepare` 的部分 | 改为创建目标线程 |
| `/api/outcomes/plans`（POST、GET） | 删除 |
| `OUTCOME_CHAT_TOOLS` 里的 `PlanOutcome`、`GetOutcomePlan`、`ProposeExploreIdea` | 取消 |
| 桌面端 `planning-wizard.tsx` 的选项与四步流程、`outcome-replan.ts`、`use-outcome-replan-notices.ts` | 删除 |
| Android、iOS 的规划向导与 `createOutcomePlan` / `getOutcomePlan` | 删除，见 §2.5 |

保留：`outcomeInference` 及其在简报、预审服务上的注入。

### 2.5 移动端

Android（`LiveFeatureGateway`、`OutcomeScreens.kt`、`OutcomeApprovalComponents.kt`、`mobile/shared` 的 `Outcomes.kt`）与 iOS（`API.swift`、`AppStore.swift`、`OutcomeInboxView.swift` 与规划相关视图）：

- 新建目标：一个文本框加机器人选择，调用 `POST /api/outcomes/threads`，提交即返回。
- 目标详情：待批准契约展示与批准；"发给机器人"输入框，调用 `POST /api/outcomes/:id/thread/messages`；回合列表与最终回复。
- 删除规划向导和"修改"的选项页面，以及对应的共享模型与测试。
- 开关关闭时入口隐藏（已完成，沿用）。

### 2.6 旧数据与调试数据库

- 迁移：新增 `outcome_thread`、`outcome_thread_turn`；删除 `outcome_replan`。
- 数据更新（对已连接的调试库执行，脚本写入 `docs/migration.md`）：
  1. 删除 `outcome_replan` 的数据（仅上一版开发产生）。
  2. 对受影响目标重新派生状态（`recomputeOutcomeStatus`），使因 replan 处于 `planning` 的目标回到 `pending_approval`。
  3. 既有目标、修订、简报、`OutcomePlanningDraft` 保持不变。
- 旧的待批准目标保持可批准；其"发给机器人"在需要时惰性创建线程。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5

- `OutcomeThreadService`：线程与回合的唯一写入口。
- 线程工具集：`SaveOutcomeContract`、`CancelOutcome`、`GetOutcome`、`ListOutcomes`。第一版没有 `RequestOutcomeDecision`（它的服务端处理绑定工作项），提问走回合最终回复。
- 平台提示词线程运行说明（见 §3.3.6）。

### 3.2 数据结构

覆盖需求：2、5、6

#### 3.2.1 `OutcomeThread`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 是 | 线程 ID | 主键 |
| `outcomeId` | uuid | 是 | 所属目标 | 唯一；目标删除时级联 |
| `botId` | uuid | 是 | 执行机器人 | 与目标执行机器人一致 |
| `createdAt` | datetime | 是 | 创建时间 | |

#### 3.2.2 `OutcomeThreadTurn`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 是 | 回合 ID | 主键 |
| `threadId` | uuid | 是 | 所属线程 | 外键 |
| `purpose` | enum | 是 | `plan` / `owner_message` | |
| `trigger` | text | 否 | 用户原文或系统触发说明 | 用户文字不改写；上限 8000 字 |
| `triggerBy` | text | 是 | `user:<id>` / `owner:local` | 用于取消授权判断 |
| `status` | enum | 是 | `queued` / `running` / `completed` / `failed` | |
| `runId` | uuid | 否 | 对应 `Run` | 唯一 |
| `reply` | text | 否 | 机器人最终回复 | |
| `error` | json | 否 | 失败原因 | |
| `clientRequestId` | text | 是 | 幂等键 | 与 `threadId` 联合唯一 |
| `createdAt` / `updatedAt` | datetime | 是 | | |

#### 3.2.3 与现有表的关系

- `Outcome.planningDraftId`：升级后新目标为空；旧数据保留，`OutcomePlanningDraft` 只读，待移动端迁移后删除（§8.2）。
- `OutcomeBrief`：保持不变。
- 不新增 `OutcomeStatus` 值（`planning` 已存在）。

### 3.3 接口契约

覆盖需求：1、3、4、5、8

#### 3.3.1 发送消息

- 类型：HTTP
- 路径：`POST /api/outcomes/:id/thread/messages`
- 输入：`{ text: string(1..8000), clientRequestId }`
- 输出：`{ turn: OutcomeThreadTurnView }`，状态码 202
- 校验：目标开关开启；目标未 `accepted` / `cancelled`；`clientRequestId` 幂等
- 错误：`outcomes_disabled`、`outcome_not_found`、`invalid_outcome_transition`、`idempotency_conflict`

#### 3.3.2 新建目标线程

- 类型：HTTP
- 路径：`POST /api/outcomes/threads`
- 输入：`{ text, botId, exploreIdeaId?, clientRequestId }`
- 输出：`{ outcome: OutcomeDetail, turn }`，状态码 202
- 校验：机器人存在且可运行；`exploreIdeaId` 对应未转换的想法

#### 3.3.3 线程工具 `SaveOutcomeContract`

- 类型：动态工具（仅目标线程）
- 输入：`{ goal: string[], acceptance: {statement, required}[], boundaries: {included[], excluded[]}, budget?, changeSummary?, title?（仅首版）, clientRequestId }`
- 行为：首版创建修订 1，后续创建 N+1；状态一律为待批准；复用 004.2 契约校验与冲突检测；与当前修订内容哈希相同则拒绝
- 输出：目标详情与"请用户批准，不要自行批准"的下一步提示
- 错误：`invalid_request`、`contract_revision_conflict`、`contract_unchanged`、`outcome_terminal`

#### 3.3.4 其他线程工具

- `CancelOutcome`（线程变体）：要求回合 `triggerBy` 属于用户。
- 复用 `GetOutcome`、`ListOutcomes`（读取），取消用线程变体。

#### 3.3.5 读取

- `GET /api/outcomes/:id/thread`：回合列表（分页）。
- `GET /api/outcomes/:id/thread/turns/:turnId/transcript`：回合记录。

#### 3.3.6 提示词

平台提示词新增"目标线程"一节，按 `purpose` 说明：

- 你是这个目标的专属线程；用户的话就是用户的话，由你判断意图。
- 取消、修改、提问、回复都由你选择；写契约用 `SaveOutcomeContract`，不要只在回复里描述。
- 需要用户选择时用 `RequestOutcomeDecision`。
- 你不能批准契约或验收成果，不要要求用户去聊天窗口。

## 4. 数据与状态模型

### 4.1 数据关系

`Outcome 1 — 1 OutcomeThread 1 — N OutcomeThreadTurn N — 1 Run`。执行线程（`OutcomeWorkItem` → `Run`）保持不变。

### 4.2 状态流转

`planning` 的派生规则（替换上一版 `OutcomeReplan` 规则）：

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `planning` | 机器人在处理规划 | 没有已批准修订，且没有待批准修订；或存在 `queued` / `running` 的 `plan` / `owner_message` 回合 | 回合结束，或保存了待批准修订 |
| `pending_approval` | 有待批准契约等用户 | 当前修订待批准，且没有运行中的规划类回合 | 批准、修订被替换、有新回合 |
| 其余状态 | 同 004.2 | 同 004.2 | 同 004.2 |

回合失败后状态由事实重新派生，不停在 `planning`。

## 5. 错误处理

### 5.1 错误类型

- 校验错误：线程工具入参不合法。
- 授权错误：试图批准、验收，或非用户触发的取消。
- 容量错误：机器人并发已满，回合排队，不报错。
- 运行错误：机器人不可运行、回合中断。

### 5.2 错误响应格式

沿用 004.2 `ApiError`（`code`、`message`、`details.retryable`）。

### 5.3 处理策略

1. 输入验证错误：线程工具返回具体字段错误，机器人可在同一回合修正。
2. 业务规则错误：返回当前事实（如当前修订号），机器人重读后重试。
3. 外部依赖错误：回合失败记录原因，用户可重发。
4. 重启：队列保留；运行中回合按 004.5 续跑或失败。

## 6. 正确性属性

### 6.1 属性 1：机器人永远不能批准

*对于任何* 线程工具调用序列，系统都不能产生已批准的修订或已验收的目标，除非该操作来自用户界面的批准或验收接口。

**验证需求：** 4.3

### 6.2 属性 2：用户文字原样送达

*对于任何* 用户提交的文字，进入线程回合的 `trigger` 与机器人收到的消息内容逐字符一致，且同一 `clientRequestId` 只投递一次。

**验证需求：** 1.1、1.5

### 6.3 属性 3：取消只由用户触发

*对于任何* 目标取消，其回合 `triggerBy` 必须是用户。

**验证需求：** 8.2

### 6.4 属性 4：规划无固定调用

*对于任何* 规划、修改、探索转规划相关的服务端模块，都不依赖 `OutcomeInference` / `COMPUTER_API_PATHS.inference`。简报与预审服务不受此限。

**验证需求：** 7.1

### 6.5 属性 5：状态可由事实重算

*对于任何* 时刻，目标状态等于 `recomputeOutcomeStatus` 在当前事实上的结果。

**验证需求：** 6.1–6.4

## 7. 测试策略

### 7.1 单元测试

- `SaveOutcomeContract`：首版、修订、无变化、冲突、终结目标。
- `recomputeOutcomeStatus`：有无运行中回合、失败回合。
- 静态断言：规划、线程、探索服务不出现 `.infer(`、`inference`。
- 取消授权：用户触发 vs 系统触发。

### 7.2 集成测试

- 发送消息：幂等、投递一次、排队与容量。
- 新建目标线程：同一事务创建目标、线程与回合。
- 回合失败与重启恢复。
- 机器人关闭、开关关闭时拒绝。

### 7.3 端到端测试

- 真实机器人：待批准目标上输入"取消目标"→ 目标取消，无规划界面。
- 输入"改成只做导出"→ 出现待批准的新修订。
- 新建目标含模糊描述 → 机器人追问，目标保持规划中。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §2.3.1、§3.3.1、§6.2 | 集成测试、端到端 |
| 需求 2 | §2.2、§2.3.5、§3.2 | 集成测试、桌面端测试 |
| 需求 3 | §2.3.2、§3.3.2 | 集成测试、端到端 |
| 需求 4 | §3.3.3、§6.1 | 单元测试 |
| 需求 5 | §2.3.3、§2.3.4 | 回归：现有简报、预审测试 |
| 需求 6 | §4.2、§6.5 | 单元测试 |
| 需求 7 | §2.4、§2.5、§2.6、§6.4 | 静态断言、迁移脚本、三端测试 |
| 需求 8 | §3.3.5、§6.3 | 单元测试 |

## 8. 风险与待确认项

### 8.1 风险

- 自由度换来不确定性：机器人可能不调用 `SaveOutcomeContract`。缓解：回合结束时若该用途应有产出而没有，则在详情提示"机器人没有保存方案"并保留其回复，允许用户继续发消息。
- 弱模型可能判断不稳。缓解：提示词与工具描述收紧，不用程序代替判断。
- 容量：每机器人并发 2，用户消息线程可能与执行线程竞争。缓解：用户消息优先。
- 三端同时迁移，范围大。缓解：服务端与契约先稳定，再依次做桌面、Android、iOS。iOS 只能做语法检查（无完整 Xcode）。

### 8.2 已确认事项

- 移动端本次一并迁移（见 §2.5）。
- 简报、摘要、预审继续用后台一次性 LLM（见 §2.3.4）。
- 旧数据：更新调试数据库现有记录（见 §2.6）。

### 8.3 待确认项

- 线程是否需要独立的"目标线程"提示词覆盖机器人人设（当前设计沿用机器人完整提示词并追加一节）。
