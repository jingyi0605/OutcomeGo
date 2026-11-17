# 跨阶段 API、事件和数据库合同矩阵

2026-11-17，第 3 波 task-26。代码起点 `948ead5de`；固定输入提交 `2d9eaeb43`，故障脚手架提交 `e00496f5e`，入口补齐提交 `543eef450`。本文件是代码交接，不代表实际回放或 CI 已通过。

## 事实来源和接口

| 载荷/事实 | 生产者 | 消费者 | 关联与兼容行为 |
|---|---|---|---|
| PlanningDraft/ConfirmedContract | OutcomePlanningService、OutcomeService | 规划页、批准 API | 保存快照生成 option ID；批准前不创建执行；生成失败保留可读失败草稿 |
| ContractRevision | OutcomeService | enqueue、worker claim、Decision/Human/recovery | `outcomeId+revision` 唯一；执行保留原批准快照；待批准 N+1 不自动改写已开始 N |
| OutcomeWorkItem | startRun、Decision supplement、HumanActionPort | messaging、Review、Inbox、恢复 | Run 显式携带 nullable `outcomeWorkItemId`；普通 Run 为 null；最多两个 Outcome 子线程 |
| enqueueOutcomeTurn | startRun、Decision resolution、Human Review、恢复 | mailbox/worker | 事务内持 Outcome→WorkItem 锁；`{workItemId,content,reason,clientId}`；返回 enqueued/runId 或 queued_for_capacity；等待意图由 IdempotencyRecord 保存 |
| settleOutcomeWorkItem | worker 正常完成、定期恢复 | Output、Review 事件、容量排队 | 根据实际执行顺序和运行组后台工作结算；生产 caller 传 messaging/workspace；两参数调用只结算事实 |
| createOutcomeDecision | RequestOutcomeDecision、恢复 | DecisionService、Inbox | 共享事务构造器；resolved 与后续效果同事务；同 key 不同输入冲突 |
| consumeOutcomeInboxEvent | dispatcher.drain | ChannelNotification/Outbox | `processed=true` 包括已处理重放；`projected=false` 可表示重放；`outcome-event:inbox/eventId` 持久回执与投影共事务 |
| Inbox 永久事实恢复 | reconcileOutcomeInboxNotifications | 既有 dispatcher 启动/周期 drain | 不依赖 Event 保留期限；进度不通知；按 fact key 去重；回放按 category/outcome 筛选，不硬编码 Review group key |
| HumanActionPort | HumanWorkService.createFromAgentRequest/createFromDecision | 动作卡、等待 Agent | Agent 来源须实际 running Run 与同一 WorkItem；Decision 来源验证实际 manual_action 快照 |
| HumanReceipt | HumanReceiptService.submit | 统一 Review | 已上传 AssetStore 材料经 metadata 校验；Evidence、Receipt、状态、事件、幂等响应同事务；提交后仍等待验收 |
| HumanReviewPort | HumanReceiptService | OutcomeReviewService 第五参数 | 统一 Review 检查最新回执证据；验收通过后同一 Agent WorkItem 入队一次；提交回执不会提前续跑 |
| KnowledgeReference | HumanKnowledgeService | 动作卡与回执 Review | 通过真实 provider 读取 bot scope、version、digest；无资料请求的测试才使用空 resolver |
| recoverOutcomeWorkItem | worker 周期、OutcomeRecoveryService | 同线程 enqueue 或 Decision | 事务使用 Outcome→WorkItem；有效租约不抢占；过期运行必须有事务外精确停止证明；等待状态保持 |
| metrics/attention | OutcomeRecoveryService | 运行详情、回放报告 | N 从持久事实推导；T 未上报为 null；重复事件无持久计数时为 null；幂等样本不改变业务事务 |
| cancelOutcomeWorkItems | OutcomeService、scoped/global Stop | Run、后台子任务、Computer | 先提交选定 WorkItem 的权威取消事实，再按不可变 owned Run IDs 停止；旧 Computer 404 保留可重试不完整结果，不退回 all-Bot stop |

所有代码/事务参数以实际 TypeScript 源文件为准。冻结接口文件仍是 [parallel-interfaces.md](parallel-interfaces.md)，本矩阵不另建业务事实。

## §14 事件目录

`OUTCOME_EVENT_SCHEMA_VERSION=1`。公共 envelope 包含 eventId、schemaVersion、occurredAt、actorId、correlationId 和 payload，可选 contractRevision/workItemId/runId/idempotencyKey；数据库继续使用 Event.topic/entityId。

| Topic | 生产阶段 | 主要消费方 |
|---|---|---|
| outcome.created | Outcome 创建 | 详情读取 |
| outcome.status_changed | 统一 recompute | 详情与客户端状态 |
| outcome.contract.revision_created | 契约版本 | 批准/详情 |
| outcome.contract.revision_approved | 批准 | 执行资格 |
| outcome.work_item.created | Agent/Human/supplement/rework | 任务列表 |
| outcome.work_item.updated | 统一状态机 | 恢复序列/详情 |
| outcome.output.recorded | 运行组结算 | agent_report Evidence/预审 |
| outcome.review.required | 完成 Agent/提交 Human | acceptance_pending Inbox |
| outcome.review.recorded | 逐项 owner Review | Accepted 计算/历史 |
| outcome.decision.required | 工具/恢复 | decision_pending Inbox |
| outcome.decision.resolved | owner 决策 | 同事务后续效果 |
| outcome.decision.closed | 到期/撤回 | 通知撤回 |
| outcome.human_action.required | 人工动作来源 | human_action_pending Inbox |
| outcome.human_receipt.submitted | 回执提交 | 统一 Review |
| outcome.accepted | 全部必需条款满足 | completed Inbox |
| outcome.recovered | 恢复分类/续跑 | 诊断与审计 |

`bun scripts/check-outcome-contracts.ts` 对比实际合同、父设计目录、生产代码 topic 字面量，并检查 7 组 enum。真实消费重放由六场景中的 duplicate-finish-event 检查；其实际数据库结果仍 PENDING。

## Schema 与 ID 链

静态检查覆盖 10 个 Outcome 模型的物理表映射与关系目标字段，拒绝重复的 OutcomeCheckpoint/OutcomeRunLink/OutcomeInboxItem 模型；恢复复用 WorkItem/Run/租约和 IdempotencyRecord。004.5 新增 retryCount/recoveryCount，不建另一份执行状态表。

| 关系 | 对账依据 |
|---|---|
| Outcome.currentRevisionId → ContractRevision.id | current revision、revision 序号；运行可保留历史批准快照 |
| ContractRevision.outcomeId → Outcome.id | 所有 Criterion/Review/Evidence 的修订归属 |
| WorkItem.outcomeId/contractRevisionId → Outcome/Revision | Agent/Human 共用一个 WorkItem 模型 |
| Run.outcomeWorkItemId → WorkItem.id | nullable；foreground/group/Routine 不自动创建 Outcome 事实 |
| WorkItem.rootRunId → Run.id | optional unique；后续 continuation 仍指同一个 WorkItem |
| Output.workItemId/runId → WorkItem/Run | unique dedupeKey；最终结果和文件各自去重 |
| Evidence.criterionId/contractRevisionId → Criterion/Revision | 服务拒绝跨条款、跨版本证据 |
| Decision.workItemId/runId/contractRevisionId | 同源验证与 openWorkItemId 唯一开放槽 |
| HumanActionCard.workItemId/requestedByWorkItemId | 人工项和请求 Agent 的独立关联 |
| HumanReceipt.workItemId → WorkItem.id | sequence 唯一；修订通过 WorkItem 读取，Receipt 无重复 revision 字段 |

新增跨阶段数据库测试包含 orphan Output/Evidence 外键拒绝。静态 schema 可解析不代表数据库已执行成功；跨 Outcome 的语义归属继续由实际服务测试覆盖。备份检查沿用集成线修复的真实模型/外键检查，不能用固定 JSON 的预期值代替实际导入。

## 依赖提交与验证边界

以下为各线原始作者提交，不计为本线产品实现：

- Inbox：`f598cf59d → 4c963a368 → 922c25840 → e9d56c461 → 515abb275`；Review group 后续采用 `d2253a9ce`。
- 恢复：schema `943bbebca`、DTO `8fa19b037`、实现 `6aae513e6`、测试 `d4275f9c8`、一致性补丁 `ee85a7977`。
- Human：合同 `f7601f5bf`、实现 `ab37843dc`、合同测试 `473f46bd1`。
- 本线 `870ebac90` 仅把当时已接受的集成 snapshot 合并到自己的 worktree；没有重新署名其他线代码。唯一冲突为本线 checker 同一新增文件的 credential key 正则，保留窄匹配版本。

最小静态检查已执行；数据库、备份、完整 suites、真实模型/Computer、客户端安装和远端 CI 均按 [组合验证运行手册](20261117-第3波组合验证运行手册.md) 等待集中阶段。历史数据库失败仍阻塞。
