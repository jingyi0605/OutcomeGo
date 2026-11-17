# 运行时恢复能力矩阵

日期：2026-11-17。审计基线：`948ead5de`。本线实现：`943bbebca`、`8fa19b037`、`6aae513e6`、`d4275f9c8`、`ee85a7977`。

关联：[需求](../requirements.md)、[设计](../design.md)、[任务](../tasks.md)、[本线实现与验证记录](20261117-恢复运行时实现与验证记录.md)。

## D17 结论

D17 成立。不建检查点表，不写 `Run.requestProgress`。恢复所需事实来自 WorkItem 的 revision、状态、原因、两个计数，以及现有 Run 运行组、租约、Output、Evidence、Decision、人工卡和回执。WorkItem 状态继续通过 `transitionWorkItem` 写入，聚合状态继续通过 `recomputeOutcomeStatus` 计算，续跑继续通过 `enqueueOutcomeTurn` 入队。

| 设施 | 基线入口 | 本线处理 |
|---|---|---|
| 普通启动恢复 | `apps/server/src/services/startup-recovery.ts:recover` | 在原恢复结束后分页扫描 Outcome，不改变普通 Run 分支 |
| 子线程结算 | `packages/messaging/src/outcome-threads.ts:settleOutcomeWorkItem` | 重用 Output 唯一键、运行组和回调锁，不复制结算逻辑 |
| 有界扫描 | `packages/messaging/src/outcome-recovery.ts:recoverOutcomeWorkItems` | 每批 100，游标继续；启动阶段完成扫描后再启动 Worker 消费 |
| 恢复分类 | 同文件 `recoverOutcomeWorkItem` | 持 Outcome → WorkItem 锁；有效租约保持，等待事实保持，中断最多续跑两次，之后创建真实 Decision |
| 过期执行者 | Worker `recoverOutcomeWorkItems`、`heartbeat`、`claim` | 事务外确认旧 computer 精确回合停止；事务内重查租约；过期心跳不能续租，不能把同一 running Run 发给第二个执行者 |
| 容量等待 | `dispatchQueuedOutcomeWorkItems` | 保留 processing 意图；过滤终态、无批准和失效 revision，锁后复查；旧记录不阻塞后续有效意图 |
| 取消后的队首 | Worker `claim` | 同次领取清理不可执行的 queued Run/Inbox，继续选择有效候选；保留历史和幂等记录 |
| 待批准后继版本 | `isOutcomeDecisionRevisionActive` | 统一采用线 3 共享谓词：实际已开始的已批准 N 在 N+1 待批准时可继续；N+1 批准后不新增旧版本续跑 |
| 查询与对账 | `OutcomeRecoveryService.get/reconcile` | 只返回引用、状态、原因和计数；同请求同响应；不提供强制成功 |
| 运维关闭入口 | `outcomeDispatchEnabled` | `OUTCOMEGO_OUTCOMES_ENABLED=false/0` 停止新派发，保留持久意图；既有执行、普通聊天和读路径不受影响 |
| 统计 | `OutcomeRecoveryService.metrics/recordAttention` | N/T/Q、通知比例、变更追溯率；T 未上报为 null，不估算；不新增指标事件 |

## 故障注入入口

下表是源码和回归入口审计，不是已执行的数据库验收。数据库及全组合回放按负责人要求留到全部代码合入后。

| design §27 注入点 | 实现与回归入口 | 当前验证状态 |
|---|---|---|
| DB commit 前失败 | 共享事务、`outcomeWrite`、Decision/回执所属线事务测试 | 既有机制源码复核；最终组合 PENDING |
| commit 后重复事件 | Evidence 消费者和通知消费者的 `outcome-event:*` 收据；Output 唯一键 | 源码复核；线 3/集成最终验证 PENDING |
| Worker claim 后断开 | Worker 过期租约确认及 `apps/worker/test/outcome-recovery.integration.test.ts` | 新增测试，未运行 |
| Output 写入后断开 | 共享结算；`packages/messaging/test/outcome-recovery.integration.test.ts` 的重结算案例 | 新增测试，未运行 |
| Decision resolve 并发 | 线 3 `DecisionService` 的 Outcome 锁、原响应、同事务效果 | 所属线实现；组合 PENDING |
| receipt 上传后提交失败 | 线 4 回执服务、稳定请求 ID、追加回执/证据事务 | 所属线实现；组合 PENDING |
| 外部结果未知 | 已有明确未知原因，或连续中断两次后，通过共享构造器创建 `external_result_unknown` Decision | 新增测试，未运行；不重新调用外部适配器 |
| server restart | 真正 `recover` 入口及 `apps/server/test/outcome-recovery-service.test.ts` | 新增测试，未运行 |
| 等待 Decision/人工 | 恢复保持 `waiting_decision`/`waiting_human`，容量 drain 只消费真实待派发意图 | 新增测试，未运行 |
| revision 替代 | 共享谓词、恢复取消、claim/drain/入队复查；有效租约的既有执行不因指针变化被停止 | 新增测试，未运行 |
| 普通聊天/Routine 隔离 | 主租约保持、普通 Run 不进入 Outcome 恢复、独立 claim | 新增测试，生命周期全集 PENDING |

## 幂等审计

| 事实 | 幂等依据 | 所属线与结论 |
|---|---|---|
| Run 创建/容量意图 | `outcome-turn:<workItemId>` 请求哈希、稳定 clientId、事务内 response | 复用并补充 revision 与关闭派发条件 |
| 运行组结算 | Output `dedupeKey`、WorkItem 转换收据、同 Outcome 锁 | 复用；不能删除终态收据后复活 |
| Review | `outcome-review:<outcomeId>`、请求哈希、锁前回放原响应 | 线 2；人工验收统一入口由线 4/集成装配 |
| Decision 创建 | 线 3 共享 `createOutcomeDecision`、唯一创建键、唯一开放 WorkItem 槽位 | 不另写 Worker 决策规则 |
| Decision resolve | `decision-resolve:<id>` 与效果同事务 | 线 3；待批准后继 revision 使用同一谓词 |
| 人工回执 | 稳定请求 ID、回执序列、事务内 Evidence/Review 关联 | 线 4；最终并发/hash 冲突组合 PENDING |
| 通知 | 事实键、Outbox 唯一 deliveryKey、`outcome-event:inbox` 收据 | 线 3；本线不修改通知业务语义 |
| Evidence 消费 | `outcome-event:<handler>` 收据、事务外推理副作用自身的稳定业务键 | 既有消费者不依赖高水位跳过未提交事件；保留待处理事件 |
| 恢复 | `outcome-recovery:<outcomeId>`，按 WorkItem/最后回合/有效与失效分类去重 | 恢复事件、计数、Decision 或续跑意图在同事务提交 |
| 前台注意力 | `outcome-attention:<outcomeId>`，每段计时稳定 clientRequestId | 重放不重复计时；不读取原始资料、Prompt 或外部响应 |

幂等记录的 `expiresAt` 沿用现有约定；本线没有新增自动清理器，不能把到期字段解释成已经实现的清理行为。重复事件次数没有可持久化的准确来源时返回 null，不能把收据总数当作重复次数。
