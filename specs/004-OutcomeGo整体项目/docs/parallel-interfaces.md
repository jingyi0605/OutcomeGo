# 第 0 波跨线接口冻结

日期：2026-11-17

状态：第 0 波 B 本地实现和定向验证完成；远端 CI 证据以 [失败基线](test-failure-baseline.md) 为准。

关联：[需求](../requirements.md) · [父设计](../design.md) §14、§39、§42–§45 · [任务](../tasks.md) · [004.2 设计](../../004.2-Outcome规划执行与成果验收闭环/design.md) §12、§24 · [004.3 设计](../../004.3-Outcome收件箱与决策通知/design.md) §29、§41 · [004.4 设计](../../004.4-现实任务与知识资料闭环/design.md) §16、§32 · [004.5 设计](../../004.5-运行时恢复与版本验收/design.md) §11、§17。

分波方案：`data/spec004-并行开发提示词/20261117-Spec004并行开发方案.md`。该目录不进入 Git；本文件和各 `tasks.md` 保存版本库内可交接的接口与任务依赖。

## 1. 使用规则

- 共享写入函数从 `@outcomego/messaging` 导入；类型和事件目录从 `@outcomego/contracts/outcomes` 导入。Worker 不依赖 Server。
- `tx` 均为 `Prisma.TransactionClient`，必须由调用方的 `$transaction` 提供。函数不自行提交、不调用 computer、不向主对话发消息。
- WorkItem 状态只通过 `transitionWorkItem` 写入；Outcome 状态只通过 `recomputeOutcomeStatus` 计算；同一子线程续跑只调用 `enqueueOutcomeTurn`。
- `actor` 由服务端请求上下文或 Worker 生成，类型 `ActorRef = user:<id> | owner:local | bot:<id> | system:<name>`。客户端不能提交主体字段或最终状态。
- 不新增状态、事件名或工具授权门禁。业务调用方仍需验证 Decision、revision、Evidence、WorkItem 的真实关联与内容约束。
- 事务内加锁顺序为 `outcome:<outcomeId>`，再 `outcome-work-item:<workItemId>`。直接修改同一 Outcome 下的其他事实时，先取得 Outcome 锁，再调用共享函数，避免锁顺序反转。

## 2. 状态和事件写入

实现：`packages/messaging/src/outcome-state.ts`。第 0 波 B 建立，线 1 维护，线 2、3、4、6 调用。

```ts
appendOutcomeEvent<T extends OutcomeEventTopic>(
  tx: Prisma.TransactionClient,
  topic: T,
  outcomeId: string,
  input: {
    actor: ActorRef;
    payload: OutcomeEventPayloads[T];
    contractRevision?: number;
    workItemId?: string;
    runId?: string;
    idempotencyKey?: string;
  }
): Promise<Event>

recomputeOutcomeStatus(
  tx: Prisma.TransactionClient,
  outcomeId: string,
  actor: ActorRef
): Promise<OutcomeStatus>

transitionWorkItem(
  tx: Prisma.TransactionClient,
  input: {
    workItemId: string;
    to: WorkItemStatus;
    reason: string;
    actor: ActorRef;
    idempotencyKey?: string;
  }
): Promise<void>
```

`appendOutcomeEvent` 只接受父设计 §14 的 `OUTCOME_EVENT_TOPICS`，运行时也拒绝目录外 topic（`TypeError`）。继续使用既有 `Event.topic/entityId/payload` 布局：`entityId` 为 outcomeId，其余 Envelope 字段在 payload 中。`eventId` 由服务端生成；`correlationId` 为 idempotencyKey 或 eventId。该函数不独立去重，调用方须把业务事实、事件和幂等记录放在同一事务中。

`recomputeOutcomeStatus` 从原 `OutcomeService.recomputeStatus` 提取，保留优先级、当前 revision 筛选和 resumeStatus 派生，只在状态确实改变时写 `outcome.status_changed`。函数取得 Outcome 事务锁，避免并发 WorkItem 写入后覆盖聚合结果。原 Server 方法保留为转发入口，兼容已有调用。

`transitionWorkItem` 在同一事务中校验转换、更新 `status/statusReason/startedAt/completedAt`、写 `outcome.work_item.updated`，最后重算 Outcome。首次进入 `running` 或 `in_progress` 时写 startedAt，续跑保留首次开始时间；进入 `completed/failed/cancelled/accepted` 写 completedAt，其他目标状态清空 completedAt。

错误：

- 找不到 WorkItem：`OutcomeError("work_item_not_found")`。
- 目标状态不属于该 executor，或不允许该转换（含无幂等 key 的同状态转换）：`OutcomeError("invalid_outcome_transition")`。
- 同一 WorkItem、同一 idempotencyKey 携带不同 `to/reason/actor`：`OutcomeError("idempotency_conflict")`。
- 相同 key 和请求重复调用为无副作用重放。幂等记录 scope 为 `outcome-work-item:<id>`，与事件在同一事务内写入；记录期限 30 天。
- Server 继续将 `OutcomeError` 映射为现有 `ApiError` 合同。

完整允许转换如下；未列出的组合全部拒绝，`completed/failed/accepted/cancelled` 不可复活：

| executor | 原状态 | 允许目标 |
|---|---|---|
| agent | queued | running、retry_pending、failed、cancelled |
| agent | running | completed、failed、cancelled、waiting_decision、waiting_human、retry_pending、needs_review、queued |
| agent | waiting_decision / waiting_human | running、cancelled |
| agent | retry_pending | running、failed、cancelled |
| agent | needs_review | running、cancelled、completed |
| human | pending | ready、in_progress、cancelled |
| human | ready | in_progress、cancelled |
| human | in_progress | submitted、paused、cancelled |
| human | paused | in_progress、cancelled |
| human | submitted | review_pending、rejected、cancelled |
| human | review_pending | accepted、rejected、cancelled |
| human | rejected | in_progress、cancelled |

这里合并父设计 §42.2 的箭头、同节“提交失败”“中断重新排队”的正文和既有 Outcome 整体取消语义。人工 `pending → in_progress` 来自 `004.4` §16 的 start 规则；未完成状态的取消保留原 `OutcomeService.cancel` 行为。业务内容验证（回执必填项、Review/Evidence、拒绝说明）仍由线 4/线 2 的服务完成；共享状态函数不替代这些事务。

## 3. 子线程接口和测试替身

签名：`packages/messaging/src/outcome-threads.ts`。真实实现归线 1（`004.2` 3.2、3.4）。

```ts
interface EnqueueOutcomeTurnInput {
  workItemId: string;
  content: string;
  reason: "start" | "decision_resolved" | "human_action_accepted" | "recovery" | "rework";
  clientId: string;
}
type EnqueueOutcomeTurnResult =
  | { status: "enqueued"; runId: string }
  | { status: "queued_for_capacity" };

enqueueOutcomeTurn(
  tx: Prisma.TransactionClient,
  messaging: AgentMessaging,
  input: EnqueueOutcomeTurnInput
): Promise<EnqueueOutcomeTurnResult>

interface OutcomeThreadRuntime {
  messaging: AgentMessaging;
  workspaceRoot?: string;
}
settleOutcomeWorkItem(
  tx: Prisma.TransactionClient,
  runId: string,
  runtime?: OutcomeThreadRuntime
): Promise<void>

dispatchQueuedOutcomeWorkItems(
  tx: Prisma.TransactionClient,
  messaging: AgentMessaging,
  botId: string
): Promise<void>
```

实现状态（2026-11-17，线 1）：`ce875ef7f` 实现真实入队与结算；`aaed9e362` 修复回调并发、主对话请求归属、最终回合顺序和候选饥饿；`4754659cc` 接入服务与精确取消；`e74706d97` 补齐平台移交和历史批准快照回归；`9ddfd10b1` 预留子 Agent 归属并按不可变尝试取消；`5681c940c` 统一所有取消入口的 WorkItem 事实栅栏并遍历完整历史后代。第 0 波占位异常已移除。详细验证和未放行项见 [子线程运行时验证](../../004.2-Outcome规划执行与成果验收闭环/docs/20261117-子线程运行时验证.md)。

- 入队仍保持冻结的 `reason`、返回联合类型和事务边界；根 `clientId` 为 `outcome-run:<outcomeId>:<revision>:<workItemId>`，续跑必须使用带原因与序号的稳定 ID。只调用 `enqueueWake`，不写主对话可见消息、不传 `interruptedRunId`。同 Bot 的 Outcome 容量 2，独立于 Routine 容量 4。
- 容量等待内容保存在既有 `IdempotencyRecord`，不是第二个运行状态表：scope 为 `outcome-turn:<workItemId>`、key 为 clientId，`processing` 的 response 为 `{input}`；成功创建 Run 后同事务改为 `completed` 并保存 `{status:"enqueued",runId}`。相同 key 不同内容冲突；相同输入重放同一结果。
- 记录写入 30 天的 `expiresAt`。本线没有新增清理任务，入队与 drain 不按到期时间丢弃尚未消费的意图；不能把该字段描述为已实现的自动清理。未来清理必须保留待消费意图，终态记录也不能在仍允许旧请求重试时任意删除。
- 经负责人批准，可选第三参数使用显式依赖注入。**两参数调用只结算持久化事实**，不扫描文件、不立即调度下一项；生产 Worker 的成功结束、失败结束、周期恢复三个调用点全部传 `{messaging,workspaceRoot}`。没有其他生产调用方。周期恢复分页扫描并补齐已完成项的文件输出，再通过 `dispatchQueuedOutcomeWorkItems` 排空可执行意图。不能把两参数调用的成功返回当作完整续跑验收通过。
- drain 在 `LIMIT 100` 前只选择有 `processing` 意图的 WorkItem，等待 Decision/人工而没有意图的旧项不会挡住新项。跨 Outcome 使用 try-lock，保持 Outcome → WorkItem 锁序。
- shell/子 Agent 回调在**同一个调用方事务**中，经 `automationContinuationRoute` 取得 Outcome → WorkItem 锁、重新验证来源，并持锁直至完成事实/回执与续跑 Run 一起提交；结算使用相同锁，不能在路由验证后提前提交。最终回合按实际 `startedAt` 优先排序，并排除合并回执，不按入队先后选结果。
- Outcome 与 Routine 一样不拥有主对话 `requestProgress`，不产生 `request.check` 或普通请求恢复；原有普通/Routine 行为保留。桌面互斥、租约和容量位置见 [运行时能力矩阵](../../004.2-Outcome规划执行与成果验收闭环/docs/runtime-capability-matrix.md)。
- Outcome `WakeParent` 是当前回合的终止移交：WorkItem 进入 `needs_review`，`AutomationResult` 移交 marker 绑定**当前 Outcome Run ID**；等待主对话空闲、不打断主对话。返回既有 `{woken,run_id,automation_run_ids}`。显式 `recovery` 可恢复原 WorkItem，旧 marker 继续阻止旧 shell/子 Agent 回调复活；同 Bot 新续跑携带 `origin:outcome` 和 `outcomeWorkItemId`。受托子 Agent 保留既有自身 origin，归属由 `Subagent.parentRunId` 追踪。

调用方事务同时包含 Decision/回执事实和续跑入队；不要先提交 Decision 再另开事务创建 Run。线 2 负责 HTTP runs/transcript 路由和装配，线 1 提供 `OutcomeService.startRun`、`cancel`、`transcript`。构造器为 `(prisma,messaging?,runService?,onRevisionCreated?)`，第四参数在取消事实事务内 `cancelledAt` 更新后调用，与线 2 的 revision hook 保持同位。精确取消使用独立 `POST /v1/bots/:id/background-shells/stop-runs`、`{runIds:string[]}`；旧 computer 404 返回可重试的 `outcome_stop_incomplete`，重复同一取消请求继续尝试物理停止，绝不降级到全 Bot 停止。共享路径单独提交 `767663a96`，无数据库结构变更。

`RunService.cancelOutcomeWorkItems(workItemIds)` 自身先在 Outcome → WorkItem 锁下将**仅传入的未终态 Agent 项**通过 `transitionWorkItem` 置 cancelled 并重算聚合，再取得 Run 快照和执行外部停止。即使根 Run 已完成、或者容量等待项没有 rootRunId，直接 Stop 入口也得到持久化栅栏；终态保持，重复调用无额外转换，不写整个 Outcome 的 cancelledAt。子 Agent 重绑定前在 parent lifecycle 和子行锁下预留，只取消旧尝试/steering 的精确运行 ID；历史尝试可供 404 后重试。遍历由已访问子 Agent 集合终止，没有任意深度上限。前台/global Stop 的选择与接线由 integrator 维护，global 路径应将 Bot 的全部活跃 Agent WorkItem（含 completed root 和无根容量意图）传给该原语；不能从 Run.status 判断是否存在活跃 Outcome 工作。

替身为 `packages/messaging/src/testing/outcome-thread-fake.ts` 的 `OutcomeThreadFake`（从 messaging 导出）：

```ts
const fake = new OutcomeThreadFake();
await db.$transaction(tx => fake.enqueueOutcomeTurn(tx, messaging, input));
fake.enqueueCalls; // EnqueueOutcomeTurnInput[]
fake.settleCalls;  // string[]
```

替身记录输入，通过真实 `transitionWorkItem` 将 WorkItem 置为 running；返回 `runId = fake:<clientId>`。不会创建数据库 Run、检查容量、写主对话或模拟真实结算；settle 只记录 runId。其 runId 不能写入数据库 UUID/FK 字段。替身是线 3、4、6 的测试依赖，禁止注册到生产服务。

## 4. 工具注册和分发

合同：

```ts
OUTCOME_THREAD_TOOL_NAMES = ["RequestOutcomeDecision", "RequestHumanAction"]
ComputerTurnRequest.outcomeThread?: { workItemId: string }
```

线 1 在 Worker 构造 Outcome turn 请求时填写 marker，Routine 和普通 Run 省略。Computer 已将字段传递到 `ActiveTurn`。工具注册位置为 `apps/computer/src/runtime/tools.ts` 的 `OUTCOME_THREAD_TOOLS`，按工具名独立登记定义；`outcomeThreadToolDefinitions` 只返回 marker 存在且已经实现的工具。两个工具目前均未登记，所有工具列表保持原样。

Server 分发点：`apps/server/src/services/internal-tool-service.ts` 构造函数最后一个可选参数。

```ts
interface OutcomeThreadToolContext {
  runId: string;
  workItemId: string;
  botId: string;
}
type OutcomeThreadToolHandler = (
  request: DynamicToolCallRequest,
  context: OutcomeThreadToolContext
) => Promise<unknown>;
interface OutcomeThreadToolHandlers {
  RequestOutcomeDecision?: OutcomeThreadToolHandler;
  RequestHumanAction?: OutcomeThreadToolHandler;
}
```

分发继续先验证已有动态工具上下文。workItemId 取自持久化 `Run.outcomeWorkItemId`；没有 Outcome 线程身份返回 `outcome_thread_required`，未登记处理函数返回 `outcome_thread_tool_unavailable`。处理函数自行建立业务事务，复用共享状态与事件函数，返回普通工具结果；不返回伪成功。

线 3 在独立文件 `outcome-decision-tool.ts` 实现 Decision 处理；线 4 在 `human-action-tool.ts` 实现人工动作处理。注册和装配时各占一个独立代码块。此次不实现业务处理，也不新增工具授权机制。

## 5. Decision 效果和人工动作端口

`DecisionEffect` 定义在 contracts/outcomes，从 messaging 重新导出；人工端口定义在 `packages/messaging/src/outcome-actions.ts`。

| 效果 | 唯一处理入口 | 负责人 |
|---|---|---|
| plan_only | enqueueOutcomeTurn，同一 WorkItem/子线程续跑；supplement 追加遵循 D11 | 线 3 调用线 1 |
| scope_change / acceptance_change | OutcomeService.createRevision 的同一业务逻辑，创建待批准 revision；不修改批准快照 | 线 3 调用线 2 |
| cancel_branch | transitionWorkItem(to=cancelled) | 线 3 |
| manual_action | HumanActionPort.createFromDecision；人工验收后续跑原子线程 | 线 3 调用线 4 |

效果只由服务端选项定义决定，客户端不提交 resolutionEffect 或最终状态。线 3 调用 revision 创建时须与 Decision resolve 共享事务，不得在外层事务中直接调用会开启新事务的 serviceEffect；线 2/3 应提取同一 revision 事务内部实现后复用，不能复制业务逻辑。

```ts
interface HumanActionInput {
  title: string;
  purpose: string;
  steps: readonly string[];
  evidenceRequirements: ReadonlyArray<{
    criterionOrdinal: number;
    label: string;
    kind: "text" | "asset" | "sourceReference" | "observation";
  }>;
  referenceIds?: readonly string[];
}
interface HumanActionResult { workItemId: string; cardId: string }
interface HumanActionPort {
  createFromDecision(tx: Prisma.TransactionClient, input: {
    outcomeId: string; decisionId: string;
    requestedByWorkItemId: string; card: HumanActionInput;
  }): Promise<HumanActionResult>;
  createFromAgentRequest(tx: Prisma.TransactionClient, input: {
    runId: string; workItemId: string; input: HumanActionInput;
  }): Promise<HumanActionResult>;
}
```

两个方法都在调用方事务内创建人工 WorkItem 和动作卡快照，并按 `004.4` §32 验证来源与材料。线 4 提供真实实现前，默认替身 `unavailableHumanActionPort` 的两个入口都抛 `OutcomeError("manual_action_unavailable")`（HTTP 503）；不能创建半对象或假装成功。

## 6. 事件 payload

类型 `OutcomeEventPayloads` 已覆盖目录内全部 16 个主题，无新事件名。下表列出跨线消费的 11 个冻结 payload；`outcomeId/contractRevision/workItemId/runId/actorId/correlationId/idempotencyKey` 按 Envelope 传递，不从不受信任的请求正文取得。

| 主题 | payload | 产生/消费 |
|---|---|---|
| outcome.work_item.updated | `{ from: WorkItemStatus, to: WorkItemStatus, reason: string }` | 线 1/4/6；线 3/6 |
| outcome.output.recorded | `{ outputId: string, kind: OutputKind }` | 线 1；线 2 |
| outcome.review.required | `{ criterionIds: string[], workItemIds: string[] }` | 线 1/2/4；线 3 |
| outcome.review.recorded | `{ reviewId: string, criterionId: string, result: ReviewResult, evidenceIds: string[] }` | 线 2/4；线 3/6 |
| outcome.decision.required | `{ decisionId: string, reasonCode: string }` | 线 3/6；线 3 |
| outcome.decision.resolved | `{ decisionId: string, resolutionEffect: DecisionEffect, optionId: string \| null, customText: string \| null }` | 线 3；线 1/4/6 |
| outcome.decision.closed | `{ decisionId: string, reason: "expired" \| "withdrawn" }` | 线 3；线 3 |
| outcome.human_action.required | `{ workItemId: string, cardId: string, requestedByWorkItemId: string, decisionId: string \| null }` | 线 4；线 3 |
| outcome.human_receipt.submitted | `{ workItemId: string, receiptId: string, evidenceIds: string[] }` | 线 4；线 2/3 |
| outcome.accepted | `{ revisionId: string, reviewIds: string[] }` | 线 2/4；线 3/6 |
| outcome.recovered | `{ workItemId: string, action: "resettle" \| "resume_queued" \| "needs_review" \| "cancelled", reason: string }` | 线 6；线 3/6 |

通知默认层仍从真实业务表加载三段式内容；这些事件只指向事实，不复制 Decision/动作卡全文，不携带附件内容或秘密。

## 7. 分波放行和变更规则

| 波次 | 可开始的任务 | 等待的真实接口 |
|---|---|---|
| 第 1 波 | 线 1 运行时；线 2 规划/验收；线 3 Decision/Inbox/通知设施；线 4 资料/人工表/API；线 5A 移动只读；线 5B 运维 | 根据各 tasks.md 开发，未就绪上游使用固定 fixture |
| 第 2 波 | 线 3 Decision 工具/事件；线 4 人工工具/回执；线 6 恢复；线 2 变更追溯 | 线 1 的 3.2/3.4，线 2 的 4.2；人工 Decision 来源另等线 3 的 1.3 |
| 第 3 波 | Inbox/人工客户端与失败回归并行；随后端到端验收 | 第 2 波服务合入、客户端 API 和线 5B 外部验证证据 |

冻结后修改应先更新本文件及对应类型/测试，再同步受影响线：

- 状态、入队或结算签名：线 1、2、3、4、6。
- DecisionEffect 或 Decision 事件：线 2、3、4、6。
- HumanActionPort 或人工事件：线 2、3、4、6。
- 工具名称、marker 或注册/分发约定：线 1、3、4。
- 其他事件 payload：该事件产生线和所有消费线；只增加可选字段时也需更新共同 fixture。
- 新状态或事件名还必须由负责人先确认父设计 §14/§42，不能只修改子规格。

## 8. 验证和回滚

`packages/messaging/test/outcome-state.integration.test.ts` 穷举两个 executor 的全部合法/非法目标组合，并验证状态派生、时间戳、回滚和并发幂等；`outcome-ports.test.ts` 验证所有占位接口明确失败。原 `OutcomeService` 11 项测试继续通过。

Computer 的 `outcome-tool-surfaces.test.ts` 与修改前捕获的 `fixtures/outcome-tool-surfaces.json` 比较主对话、Routine、普通事件 Run 的完整工具列表；带 marker 但未实现工具时也完全相同。Server 的 `outcome-thread-tools.test.ts` 验证未登记、线程身份和独立处理函数分发。

运行命令：

```bash
bun run check:architecture
bun run check:workflows
bun --filter @outcomego/contracts typecheck
bun --filter @outcomego/messaging typecheck
bun --filter @outcomego/server typecheck
bun --filter @outcomego/computer typecheck
OUTCOMEGO_TEST_DATABASE_URL=<一次性库> bun test packages/messaging/test/outcome-state.integration.test.ts packages/messaging/test/outcome-ports.test.ts apps/server/test/outcome-service.test.ts apps/server/test/outcome-thread-tools.test.ts packages/db/test/outcomes.integration.test.ts
bun test packages/contracts/test/outcomes.test.ts apps/computer/test/runtime/outcome-tool-surfaces.test.ts apps/computer/test/runtime/tool-surfaces.test.ts
OUTCOMEGO_TEST_DATABASE_URL=<一次性库> bun run test --force --continue=always
```

无新增数据库表/列。回滚为撤销第 0 波 B 的 contracts、messaging、Server/Computer 接入及文档提交；保留第 0 波 A 基础模型和数据库失败基线。此次没有重建远端 computer，真实调试环境在后续经负责人授权同步重建后才生效。

## 9. 交付证据

实现提交为 `23bc29151`（contracts）、`ad4b5de94`（共享实现与测试）。六个受影响包 typecheck、architecture、workflow 检查通过；定向测试 334 + 64 项通过；全量与 A 基线逐项比较及四个偶发项的 A/B 隔离复核见 [失败基线](test-failure-baseline.md)。本文件及任务依赖更新单独提交，作为第 1 波交接依据。


## 10. 第 1 波线 2 产品接口交接

实现：线 2 `5f8a56471`（事务内 revision）、`a909e2d43`（服务端产品）。详细验证见 [线 2 验证记录](../../004.2-Outcome规划执行与成果验收闭环/docs/20261117-第1波产品功能验证.md)。本节不改变既有状态、事件名或 payload。

- `OutcomeService.createRevisionInTransaction(tx,outcomeId,input:CreateContractRevisionInput,actor):Promise<OutcomeDetail>` 为绑定方法。Decision resolve 调用方拥有事务和幂等；普通 revision API 复用同一实现，不在调用方事务中再次开启 serviceEffect 事务。
- `OutcomeService.getInTransaction(tx,outcomeId):Promise<OutcomeDetail>` 读取同一事务内的最新详情。
- revision current 指针更新后调用事务内 `onRevisionCreated(tx,outcomeId,actor)`；与运行时构造参数组合时该回调在第四位，由集成人员注入线 3 `withdrawSupersededDecisions`。取消回调由线 1 放在同一事务。
- Evidence 选择 **Server 订阅持久 `outcome.output.recorded`**：启动扫描积压，已有 EventWakeup 唤醒并带轮询回退，按 Output/WorkItem 事实幂等，保存 `outcome-event:output-evidence` 消费记录。查询相关事件时以缺少回执的 `NOT EXISTS` 为依据，sequence 只排序，不作已提交水位，避免事务提交乱序漏消费。Worker 无需调用 Server。另读 completed 状态事件触发独立 AI 预审，推理不在写事务中；关闭时先停止消费者再断开数据库。
- Consumer 与 SnapshotService 精确保留使用同一个 `outcome-event-retention.ts` 导出的 `pendingOutcomeEvidenceEventSql`（固定别名 `event`）、`OUTCOME_EVIDENCE_EVENT_SCOPE`。相关事件为 Output 和 completed WorkItem，回执 key 使用 envelope eventId 或 sequence 字符串回退；handler 失败不写回执。helper/prune 分别由 integrator `8c900af7c`、`7cf64f503` 提供，线 2 `a9a74fbb1` 复用并以真实清理/失败重试验证。
- Output 仅生成 `agent_report` 候选，预审仅生成 `ai_prereview`。原执行 revision 被替换时不迁移这些 Evidence，不写 Review 或自动 PASS。
- `/reviews` 是人工和 Agent 成果的共同唯一验收入口。人工回执 Evidence 应带真实 criterionId/workItemId、当前 revision 和 `human_confirmed`；本线经共享 transition 更新 submitted/review_pending 人工项。线 4 第 2 波负责接受后原 Agent 子线程的同事务续跑，第一波不宣称已实现此链路。
- 本线 Review 未满足接受时产生 `outcome.review.required`（`criterionIds/workItemIds`），满足当前 revision 必需条款且没有未完成任务时写 `acceptedAt`、`outcome.accepted`（`revisionId/reviewIds`）并重算状态；运行组首次完成的 review.required 由线 1 产生。
- 跨线整合必须包含 integrator `d5008544b` 的同 Outcome 锁 Decision/HumanAction 验收阻断（design §25），当前 revision 有效 open/presented Decision 即使无 workItemId 也不能接受；线 2 不提供平行 guard 实现。
- 客户端列表和详情响应继续直接使用 `OutcomeListPage` / `OutcomeDetail`，无额外响应外壳；本线只增加推理 kind，不修改冻结 Outcome DTO。
