# 运行时能力矩阵（004.2 任务 0.1）

审计日期：2026-11-17

代码基线：`OutcomeGo` 分支 `3b02ebfe6`（版本 `0.1.0-beta.19`）

目的：确认 Outcome WorkItem 应当如何进入现有运行时，回答 Run 的创建、取消、输出、事件和重试分别在哪里发生，并给出 B1（打断主对话）和 B2（Run 完成不等于工作完成）的方案依据。

## 1. 主对话路径（用户发消息）

| 步骤 | 文件:行 | 输入 → 输出 | 事务 | 结论 |
|---|---|---|---|---|
| 接收用户消息 | `apps/server/src/services/channel-service.ts:127` `sendDirectMessage` | SendMessageInput → ChannelMessage | 是 | 主对话专用 |
| 入队 | `apps/server/src/services/channel-service.ts:233` → `packages/messaging/src/index.ts:1224` `acceptDirectUserMessage` | 以 `origin: "user"` 调用 `enqueueWake`；若主对话租约中有 `running` 的 Run，传入 `interruptedRunId`（`index.ts:1240`） | 是 | **会顶替正在运行的回合**，不能用于 Outcome |
| 通用入队 | `packages/messaging/src/index.ts:989` `enqueueWake` | WakeInput → Message（运行时会话记录）、Run、InboxEvent、Event | 是，只写库 | 可在 Outcome 事务内调用 |
| 领取 | `apps/worker/src/worker.ts:1240` 起 | 按 priority/createdAt 选择 InboxEvent；主对话忙时只选 `routine`；Routine 租约数达到 4 时不再选 `routine` | 是 | 需要把 `outcome` 当作后台 origin |
| 租约 | `apps/worker/src/worker.ts:1307` | `BotRunLease(botId, scope)` 主键；`routine` 用 `automation:<rootRunId>`，其余用 `foreground` | 是 | 不同 scope 可以并行 |
| 上下文 | `apps/worker/src/worker.ts:192` `contextScopeForRun` | `routine` → `automation` scope；其余 → `channel` 或 `home` | — | 需要增加 `outcome` |
| 请求来源 | `apps/worker/src/worker.ts:206` `REQUEST_SOURCE_BY_ORIGIN` | `routine` → `automation` | — | `outcome` 映射为 `automation` |
| 运行事件 | `apps/worker/src/projection.ts:211` `run.started`、`:432` `run.completed`；`worker.ts:1947` `run.interrupted` | `entityId = runId` | 是 | Outcome 只读，不复用这些主题名 |
| 回合结束结算 | `apps/worker/src/worker.ts:1634`、`:1917` 调用 `reconcileRoutineExecution` | — | 是 | Outcome 结算在同一位置挂接 |
| 取消 | `apps/server/src/services/run-service.ts:43`、`:74` | 写 `run.cancelled`、`run.cancel_requested` | 是 | Outcome 取消复用 |
| 可见输出 | `apps/server/src/services/internal-tool-service.ts:801` `SendToUser` → `ChannelMessage.sourceRunId` | — | 是 | Outcome 子线程中不可用（见 §3） |

## 2. Routine 子线程路径（Outcome 的先例）

| 能力 | 文件:行 | 说明 |
|---|---|---|
| 入队 | `packages/messaging/src/routines.ts:1212` | `enqueueWake({ origin: "routine", channelId, clientId: dedupeKey, priority: 290 })`，不传 `interruptedRunId` |
| 后续回合归属 | `WakeInput.automationContextRunId`（`index.ts:749`，写入 InboxEvent payload `:1063`） | 子 Agent 结果、后台 shell 唤醒的回合都带根 Run ID |
| 运行组完成判断 | `packages/messaging/src/automation-results.ts:164` `automationBackgroundWorkRunning`、`:200` `reconcileRoutineExecution` | 运行组 = 根 Run + payload 指向根 Run 的 Run；还检查子 Agent（`Subagent.parentRunId`）和后台 shell |
| 最终结果 | `automation-results.ts:472` `saveSilentAutomationResult` | 取最后一个 Run 中最后一条 `run_item.completed`（`item.type = agentMessage`）的文本，写 `AutomationResult` |
| 向主线程汇报 | `apps/server/src/services/internal-tool-service.ts:424` `WakeParent` → `wakeAutomationParent` | 唤醒主线程时等待其空闲（`index.ts:279` 注释），不打断 |
| 禁用工具 | `packages/contracts/src/automation-tools.ts` `AUTOMATION_PARENT_ONLY_TOOLS` | `SendToUser`、`ReactToMessage`、`SendToAgent`、`RequestUserForm`、`DraftExternalMessage` 等只能由主线程调用 |

## 3. 结论

### B1：用子线程代替 `acceptDirectUserMessage`

- Outcome WorkItem 通过 `enqueueWake` 以新的 `RunOrigin.outcome` 入队，不传 `interruptedRunId`。
- 租约 scope `outcome:<workItemId>`、上下文 scope `outcome`，与主对话（`foreground`/`home`）并行，互不打断。
- `outcome` 映射为 `automation` 请求来源，自动继承“不能向主对话发可见消息”的约束。
- 选择新 origin 而不是复用 `routine`（D10）：`routine` 的结算会写 `RoutineExecution`、触发 `routines.afterExecution`，混用会让 Routine 逻辑处理 Outcome 运行。新 origin 的改动面为 Prisma 枚举 1 处、`contextScopeForRun`、`REQUEST_SOURCE_BY_ORIGIN`、领取条件、租约 scope 和结算挂接点，约 6 处，可接受。

### B2：按运行组判断 WorkItem 是否完成

- 运行组 = `Run.outcomeWorkItemId` 相同的所有 Run（新增可选列，D14），比 Routine 的 JSON path 查询更直接。
- 子 Agent 和后台 shell 的检查从 `automationBackgroundWorkRunning` 抽出，按 Run ID 列表工作，Routine 和 Outcome 共用。
- `RequestOutcomeDecision` 结束回合时，WorkItem 为 `waiting_decision`，结算不覆盖该状态。
- 最终结果与 `saveSilentAutomationResult` 同源。

### 风险和后续核对

| 风险 | 处理 |
|---|---|
| 子线程和主线程共用同一工作区 | 输出写入 `outcomes/<outcomeId>/<workItemId>/`（D13） |
| 桌面操作冲突 | 同一 Bot 只允许一个子线程使用 `computerUse`；实现位置在 `004.2` 任务 3.1 中确定 |
| Routine 并发上限 4 与 Outcome 上限 2 互相影响 | 领取逻辑分别计数，互不占用 |
| `requestWakeAllowed`（`worker.ts:1258`）对非 user origin 的检查 | 任务 3.1 中确认 `outcome` 不会被误判为已被取代 |

## 4. 一次本地测试任务

本审计为源码走查。真实开发 Bot 上的子线程回放属于任务 3.1 的验证范围，届时在 `docs/acceptance-replay.md` 记录 Run ID 和租约记录。
