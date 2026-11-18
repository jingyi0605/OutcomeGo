# 研究主链路本地回放（task70最终私有库隔离版）

日期：2026-11-17；实现基线`93d5ff665`加本轮未提交源码。执行者w1-product。**真实本地PostgreSQL/生产服务/Worker.claim/Projection/settlement；推理与Computer事件受控、材料虚构，没有监听服务/真实模型/原生客户端。**

当前权威来源为[实际JSON](../../004-OutcomeGo整体项目/docs/20261117-开发收尾证据/product-isolation/research-isolated.json)，SHA-256 `76befaab5cc4400398bac2a8745d7656956b66beb1be8480ab3019fe3a8f6e1a`；报告PASS，19/19业务检查通过。该报告通过公共helper/CLI在唯一template0私有库执行，生产全局consumer只读写该私有URL，未继承规范库任何事实；`databaseIsolation`记录 `outcomego_product_replay_95f08acce21549ac9a56155be4311712`、inheritedData=false、removed=true。drop/连接关闭/临时目录清理后才发布报告。旧final3 JSON保留为历史，不倒改其ID或源码归属；共享库误用的RED与新外部pending不变/故障清理回归另存父证据目录。

## 实际ID与关联

| 字段 | 实际值 |
| --- | --- |
| `botId` | `01074448-fae2-4724-8f21-1a1598f3fe15` |
| `channelId` | `1a1ffec9-bb4d-480c-af31-d77dccda60a5` |
| `planId` | `9bc20692-492a-44ee-ae5b-91aa2e88e8a7` |
| `outcomeId` | `23e1a024-a7d5-47df-971b-74162a208a41` |
| `revisionId` | `38d4ea64-beb6-4e0e-a4d3-7d59ee28e184` |
| `workItemId` | `4ce00777-91ce-45b5-bdae-17d1b40f411d` |
| `rootRunId` | `bdde114c-74f5-4ef8-8d5d-4a89e66caaa7` |
| `contextSessionId` | `a114419b-3340-4fee-a7b5-eed595db9ac9` |
| `mainRunId` | `ecb3bb62-433e-49dc-9aca-03464423d18f` |
| outputs（1） | `e04d1886-b569-4e52-a8bd-6663254e22f3` |
| evidence（9） | `31e1ce2e-d49d-4198-8b5f-dd1bd528d8b0`, `8d833b7c-9f6a-4922-ad28-102a2e9f7b50`, `6cb0fea3-6172-4c82-b8cd-a1c7d170950e`, `2d4464bf-63d7-4f21-85fa-aeecfad86c15`, `77bef310-002b-42be-b960-4293c08dc232`, `ea6794fb-d530-430b-a942-82d5755819e1`, `a203d99c-92f8-4cba-af69-b00a1812ebd1`, `3afa7d1b-76b6-4978-ae8b-0ff85c8f6adb`, `c7daa60b-1390-4b92-a92c-277ca59d5d85` |
| reviews（3） | `4bbcf48c-edda-4266-93e2-2c98061deb65`, `e64f5aa5-9058-478f-80ce-88e0ea0eb3fd`, `5a1111c8-7d0f-4c16-8190-c2d8a91ec996` |
| Run[0] | `bdde114c-74f5-4ef8-8d5d-4a89e66caaa7` / completed / WorkItem=`4ce00777-91ce-45b5-bdae-17d1b40f411d` |

## 每步真实请求与结果

JSON指针从0开始。每步完整input/result都在同一实际JSON，不凭摘要猜测完整载荷；无客户端key不表示只读。

| 步骤 | 生产入口/操作 | 输入/key定位 | 实际结果定位 |
| --- | --- | --- | --- |
| 1 | `controlled-inference` | 受控推理输入/响应；`/requests/0/input` | 完整响应/嵌套视图见指针，不补造字段；`/requests/0/result` |
| 2 | `planning.create` | product-replay:9d90b1fc-c859-4340-8561-ec8ddfad868f:plan；`/requests/1/input` | status=ready；`/requests/1/result` |
| 3 | `outcomes.createFromDraft` | product-replay:9d90b1fc-c859-4340-8561-ec8ddfad868f:create；`/requests/2/input` | id=23e1a024-a7d5-47df-971b-74162a208a41; status=pending_approval；`/requests/2/result` |
| 4 | `outcomes.approve` | product-replay:9d90b1fc-c859-4340-8561-ec8ddfad868f:approve；`/requests/3/input` | id=23e1a024-a7d5-47df-971b-74162a208a41; status=approved；`/requests/3/result` |
| 5 | `outcomes.startRun` | product-replay:9d90b1fc-c859-4340-8561-ec8ddfad868f:start；`/requests/4/input` | id=23e1a024-a7d5-47df-971b-74162a208a41; status=running；`/requests/4/result` |
| 6 | `worker.claim` | 无客户端幂等key；实际生产写入/领取事务；`/requests/5/input` | runId=bdde114c-74f5-4ef8-8d5d-4a89e66caaa7；`/requests/5/result` |
| 7 | `messaging.acceptDirectUserMessage` | 无独立客户端key；按实际生产操作记录；`/requests/6/input` | runId=ecb3bb62-433e-49dc-9aca-03464423d18f；`/requests/6/result` |
| 8 | `controlled-computer-completion` | 受控Computer事件传输，实际Projection/结算写入；`/requests/7/input` | 完整响应/嵌套视图见指针，不补造字段；`/requests/7/result` |
| 9 | `controlled-inference` | 受控推理输入/响应；`/requests/8/input` | 完整响应/嵌套视图见指针，不补造字段；`/requests/8/result` |
| 10 | `evidenceConsumer.drain` | 无客户端幂等key；实际生产写入/领取事务；`/requests/9/input` | processed=2；`/requests/9/result` |
| 11 | `reviews.submit.final` | product-replay:9d90b1fc-c859-4340-8561-ec8ddfad868f:review-final；`/requests/10/input` | id=23e1a024-a7d5-47df-971b-74162a208a41; status=accepted；`/requests/10/result` |

## 实际业务检查

| 检查 | 实际结果 |
| --- | --- |
| `planning_same_key_returns_same_draft` | PASS |
| `create_same_key_returns_same_outcome` | PASS |
| `approval_replay_preserves_approved_snapshot` | PASS |
| `run_replay_has_same_work_item_and_root` | PASS |
| `run_replay_does_not_create_second_run` | PASS |
| `actual_worker_claims_enqueued_outcome_root` | PASS |
| `actual_context_is_scoped_to_work_item` | PASS |
| `main_message_claims_independently` | PASS |
| `main_message_does_not_interrupt_outcome` | PASS |
| `output_evidence_consumer_is_idempotent` | PASS |
| `settlement_records_real_output_and_review_pending` | PASS |
| `output_created_agent_report_candidates` | PASS |
| `final_review_retry_returns_exact_response` | PASS |
| `same_outcome_has_output_evidence_review_and_acceptance` | PASS |
| `outcome_does_not_mutate_main_run_or_lease` | PASS |
| `outcome_never_publishes_main_visible_messages` | PASS |
| `run_lineage_never_changes_revision_or_work_item` | PASS |
| `all_output_ids_bind_real_outcome_item_and_run` | PASS |
| `all_evidence_and_reviews_bind_actual_approved_criteria` | PASS |

## 命令、隔离与边界

```sh
# 真实命令由执行者在repo根运行；仅显式本地OUTCOMEGO_TEST_DATABASE_URL，--no-env-file
bun --no-env-file scripts/outcome-recovery/product-replay.ts research data/acceptance/task70-20261117/isolation/research-isolated.json
```

规范URL只是创建私有库的本地管理连接，不在共享库执行受控prereview。helper全部业务连接/PgBoss/EventWakeup/consumer使用私有URL，finally关闭连接并drop准确随机库，不清除或过滤外国业务事实，不修改生产consumer API。外部pending种子snapshot在前后完全相同；报告发布失败与执行期consumer故障清理均有专门回归，精确最终结果见父开发台账。

此前final3研究19/人工32是实际历史运行；当前上述19/32来自隔离版真实重执行。integrator此前9文件78P451是共享harness修正前联合覆盖，之后同9文件80P460（含四个product案例）及两类型零诊断为新隔离源码证明；之后若只增第5个测试，单文件结果另列，不冒称完整9文件81已执行。没有新完整server/root/远端CI总数。

本地同Outcome阳性Output/Evidence/Review、11步请求及主对话隔离已完整对账，7.2的本地开发/报告缺口关闭；原7.1真实研究Bot试点及3.1/3.2真实能力矩阵前置仍未关闭，7.2/7.3正式状态不勾。

## 历史回放记录（本轮前，保持原文）

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

## 2026-11-17 第 3 波受控失败实际检查点

对应当前任务 5.2/5.3。task-30 已使用真实服务和本线一次性 PostgreSQL 执行下表检查；不改写上表远端研究试点 ID。精确源码、命令、SHA-256、六个实际故障 JSON 见 [后端组合验收首轮结果](../../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收首轮结果.md)。首轮完整根测试记录 351 failed occurrences（340 个去重 package/file/title keys），以下为历史检查点。最终本机结果见下文。

| 失败类别 | 现有/新增验证入口 | 状态 |
|---|---|---|
| 规划非 JSON/空/超时 | outcome-planning-service.test.ts；新增 cross-phase 的失败草稿/同 key 不重生成 | 本地 PASS；真实模型/远端 PENDING |
| 事务失败/半对象 | outcome-revision-transaction.test.ts；新增 Review 后续失败回滚 Evidence/Review/accepted/idempotency | 本地 PASS；cross-phase 修正真实 PrismaPromise 断言后 11 PASS / 61 assertions |
| Bot 临时/永久不可运行 | 新 cross-phase provisioning→retry_pending、archived→failed，无部分 Run | 本地 PASS，原始期望未放宽 |
| 子线程失败/中断 | outcome-threads.integration.test.ts；interrupted-thread-resume/restart-running-run CLI | 本地 PASS，实际子进程退出证据早于恢复 |
| Evidence/Receipt 写入失败 | receipt-retry 真实资产上传后 receipt.create 故障，整个事务回滚后同 key 重试 | 实际 JSON PASS，统一 Review 后才续跑，9 checks |
| Review/finish 重复 | duplicate-finish-event 的真实 settlement/Inbox D18/并发 Review | 实际 JSON PASS，一个最终 Output，8 checks |
| 外部回执未知 | unknown-external-receipt 的持久 test adapter 与实际恢复 Decision | 本地 JSON PASS，无自动重试；真实 provider 链 PENDING |

主 Run/foreground lease/可见消息在等待、恢复、回执验收期间均作为独立对照；普通 user/group/routine 无 Outcome marker 的新增断言不修改原普通 fixture。没有人工动作的执行通过实际 Output→owner Review 路径验证，不依赖人工回执。

精确执行步骤见 [第 3 波组合验证手册](../../004-OutcomeGo整体项目/docs/20261117-第3波组合验证运行手册.md)，恢复 JSON 见 [final-replay](../../004.5-运行时恢复与版本验收/docs/final-replay.md)。该历史检查点未放行；原始数据库失败记录保留。最新本机已完成真实修复及复验，不能把不同源码/flag 的历史结果混并。


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

本地定向与最终四包完整回归均通过；真实研究试点及远端门槛仍未放行。命令、实际计数、基线逐项对比、提交和接口交接见 [子线程运行时验证](20261117-子线程运行时验证.md)。真实环境可用后，由集成负责人经授权部署匹配的 server/worker/computer，再填写真实 ID、租约和结果。

## 2026-11-17 最终本机回归边界

最新四包完整回归 3988 PASS / 0 FAIL / 82 SKIP，另九项专库恢复通过；六个 CLI 40 检查通过。Computer/Messaging 运行于生产冻结 `5e2ce81d8`，Server/Worker 运行于纯测试后继 `727d410f2`，无生产差异。详见[最终本机结果](../../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)及其源码、逐项 skip、原始日志 SHA。该证据证明本地服务/fixture/数据库；上表真实 Bot、研究试点、租约、远端精确停止和 UI 记录继续空白/PENDING，不用测试 UUID 填充。
