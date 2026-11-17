# 研究试点验收回放记录

Fixture：[`research-pilot.json`](research-pilot.json)

状态：本线真实试点未执行（集成分支运行时已装配，组合检查另行记录；本线远端 computer 调用、live API 和浏览器回放保持 PENDING）

每次回放按 fixture 的 `requestSequence` 逐步执行，并在下表记录真实 ID 和结果。没有执行的步骤保持空白，不填写预期值。

| 步骤 | 请求/动作 | 关键 ID | 实际状态 | 结果 |
|---|---|---|---|---|
| 1 | 生成规划 | planId= | | |
| 2 | 创建 Outcome | outcomeId=、revisionId= | | |
| 3 | 批准 revision 1 | — | | |
| 4 | 开始执行 | workItemId=、rootRunId= | | |
| 5 | 主对话发消息 | mainRunId= | | |
| 6 | 子线程结算 | outputId= | | |
| 7 | 逐项验收 | reviewIds= | | |

幂等断言：

| 断言 | 结果 |
|---|---|
| 重复步骤 2 | |
| 重复步骤 3 | |
| 重复步骤 4（同一 clientRequestId） | |
| 重复步骤 4（不同 clientRequestId） | |

失败路径记录：见任务 5.4。

## 2026-11-17 第 3 波受控失败准备

对应当前任务 5.2/5.3。此节只记录新测试代码与计划；实际集中数据库执行仍 PENDING，未改写上表真实试点 ID。

| 失败类别 | 现有/新增验证入口 | 状态 |
|---|---|---|
| 规划非 JSON/空/超时 | outcome-planning-service.test.ts；新增 cross-phase 的失败草稿/同 key 不重生成 | 已有测试保留，新组合待跑 |
| 事务失败/半对象 | outcome-revision-transaction.test.ts；新增 Review 后续失败回滚 Evidence/Review/accepted/idempotency | 新组合待跑 |
| Bot 临时/永久不可运行 | 新 cross-phase provisioning→retry_pending、archived→failed，无部分 Run | 已编写，待跑 |
| 子线程失败/中断 | outcome-threads.integration.test.ts；interrupted-thread-resume/restart-running-run CLI | 新组合待跑 |
| Evidence/Receipt 写入失败 | receipt-retry 真实资产上传后 receipt.create 故障，整个事务回滚后同 key 重试 | 已编写，待跑 |
| Review/finish 重复 | duplicate-finish-event 的真实 settlement/Inbox D18/并发 Review | 已编写，待跑 |
| 外部回执未知 | unknown-external-receipt 的持久 test adapter 与实际恢复 Decision | 已编写；真实 provider 链仍待验 |

主 Run/foreground lease/可见消息在等待、恢复、回执验收期间均作为独立对照；普通 user/group/routine 无 Outcome marker 的新增断言不修改原普通 fixture。没有人工动作的执行通过实际 Output→owner Review 路径验证，不依赖人工回执。

精确执行步骤见 [第 3 波组合验证手册](../../004-OutcomeGo整体项目/docs/20261117-第3波组合验证运行手册.md)，恢复 JSON 见 [final-replay](../../004.5-运行时恢复与版本验收/docs/final-replay.md)。第 0 波数据库失败仍阻塞；新 canonical 入口扩大覆盖，不得将旧 canonical/dual-flag 历史结果混成新全绿结论。


## 2026-11-17 第 1 波线 2 本地验证边界

- 规划、Evidence、Review、返工和预审的本地 fixture/API 函数验证见 [产品功能验证](20261117-第1波产品功能验证.md)。这些测试不填写上表真实试点 ID。
- 真实 `kind=planning` 调用：PENDING，未请求远端 computer 同步重建或真实模型调用授权。
- 真实 `kind=prereview` 调用：PENDING，只有独立模型 fixture 及失败注入验证。
- 本线真实返工子线程、取消和 transcript 回放：PENDING；集成分支已装配的运行时组合检查另行记录，冻结 fake 不等同于真实 Run。
- Desktop 交互及视觉回放：PENDING，本次未启动前端或渲染服务。
- 任务 5.1 与 7.1 继续按后续波次执行；本记录不宣称端到端研究试点通过。

## 2026-11-17 线 1 子线程运行时回放

状态：**PENDING**。本线只使用本地一次性 PostgreSQL 和测试内 computer fixture 验证；没有启动开发服务、同步远端源码或重建远端 computer。真实开发 Bot 的执行环境尚未提供，不能将测试 UUID 当作真实验收记录。

| 所需证据 | 实际记录 | 状态 |
|---|---|---|
| 真实 Bot ID / Outcome ID / 批准 revision | 尚无 | PENDING |
| WorkItem ID / 根 Run ID / 后续 Run ID | 尚无 | PENDING |
| `BotRunLease.scope=outcome:<workItemId>`、领取与释放时间 | 尚无 | PENDING |
| 主对话并行 Run 和互不打断记录 | 尚无 | PENDING |
| 子 Agent / shell 完成、最终 Output、下一排队项启动 | 尚无 | PENDING |
| 新 computer 精确停止路径及旧 computer 404 的真实回放 | 尚无 | PENDING |

本地定向验证通过；完整数据库测试仍有既有失败，未达到全绿放行。命令、实际计数、基线逐项对比、提交和接口交接见 [子线程运行时验证](20261117-子线程运行时验证.md)。真实环境可用后，由集成负责人经授权部署匹配的 server/worker/computer，再填写真实 ID、租约和结果。
