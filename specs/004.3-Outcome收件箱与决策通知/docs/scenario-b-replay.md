# 场景B：Decision工具到Inbox及同线程继续的本地开发回放

日期：2026-11-17；基线`93d5ff665`加本轮未提交源码，未创建提交。执行者：integrator（task73，本地B）。

**范围：真实本地PostgreSQL、生产服务/事务/Worker.claim；推理和Computer事件受控，没有真实模型、原生客户端、网络监听服务或远端provider。** 本地运行不冒充真实开发Bot试点或设备回放。每个请求的完整输入与返回保存在[实际JSON](../../004-OutcomeGo整体项目/docs/20261117-开发收尾证据/decision-replay.json)的`requests`，下表索引逐步对应；所有ID来自这一份报告，不拼接其他Outcome。

报告状态 **PASS**，实际检查 **16/16 PASS**；JSON SHA-256 `c60239e76c27f64695f082813d3e6ea5400989960964d9f0a235dd68948d3e2f`。初态是既有approved fixture；规划从输入到批准另由研究回放证明。

## 实际ID与关联

| 字段 | 实际值 |
| --- | --- |
| `botId` | `ddedd81f-10b0-49d1-9ee2-c707defacbc0` |
| `channelId` | `93b6e6aa-add4-4b9c-8734-988f8937fc40` |
| `outcomeId` | `e9dc5e6d-b53d-4fe0-966f-ebd826239adc` |
| `revisionId` | `9969db47-920c-4f70-8a0b-6367f00d7ce1` |
| `workItemId` | `29696862-23e0-490e-98fe-6ee16bc62d00` |
| `decisionId` | `2b9b4030-0e11-4867-a799-ddaac6835e8b` |
| `rootRunId` | `d1f5b2f6-bd40-47d1-98fe-a8c9775625a1` |
| `continuationRunId` | `2a6e9b03-7b00-406d-aff5-ba31629b96a7` |
| `contextSessionId` | `aed2feb3-3255-4a6d-8e4a-4e92f0d3708c` |
| `foregroundRunId` | `3541864f-4470-4c8a-a2f9-986824440b03` |
| outputs（1） | `68212246-164a-46a5-8cd5-c30ac73fdcdc` |
| evidence（0） |  |
| reviews（0） |  |

## 每步真实请求与结果

JSON指针从0开始；下列指针均指向上方同一实际JSON文件，包含完整request body/clientRequestId/callId、返回视图和业务ID，不要求用户从概述猜测完整载荷。

| 步骤 | 生产入口/操作 | 请求key或输入定位 | 实际结果与原始定位 |
| --- | --- | --- | --- |
| 1 | `enqueueOutcomeTurn` | decision-replay:9df167a7-8383-45a5-b385-373a9269f259:start；`/requests/0/input` | runId=d1f5b2f6-bd40-47d1-98fe-a8c9775625a1; status=enqueued；`/requests/0/result` |
| 2 | `worker.claim.initial` | 无客户端幂等key；实际生产写入/领取事务；`/requests/1/input` | runId=d1f5b2f6-bd40-47d1-98fe-a8c9775625a1；`/requests/1/result` |
| 3 | `main user request / independent worker claim` | decision-replay:9df167a7-8383-45a5-b385-373a9269f259:main；`/requests/2/input` | runId=3541864f-4470-4c8a-a2f9-986824440b03；`/requests/2/result` |
| 4 | `RequestOutcomeDecision / trusted persisted context` | decision-replay:9df167a7-8383-45a5-b385-373a9269f259:decision；`/requests/3/input` | decisionId=2b9b4030-0e11-4867-a799-ddaac6835e8b; status=waiting_for_user；`/requests/3/result` |
| 5 | `controlled Computer completion / production settlement` | 受控Computer事件传输，实际Projection/结算写入；`/requests/4/input` | run: id=d1f5b2f6-bd40-47d1-98fe-a8c9775625a1; status=completed；`/requests/4/result` |
| 6 | `GET /api/outcomes/e9dc5e6d-b53d-4fe0-966f-ebd826239adc/inbox?status=pending&category=decision_pending` | 只读/受控传输步骤；`/requests/5/input` | status=401; errorCode=unauthorized；`/requests/5/result` |
| 7 | `GET /api/outcomes/e9dc5e6d-b53d-4fe0-966f-ebd826239adc/inbox?status=pending&category=decision_pending` | 只读/受控传输步骤；`/requests/6/input` | status=200; errorCode=None；`/requests/6/result` |
| 8 | `GET /api/decisions/2b9b4030-0e11-4867-a799-ddaac6835e8b` | 只读/受控传输步骤；`/requests/7/input` | status=200; errorCode=None；`/requests/7/result` |
| 9 | `POST /api/decisions/2b9b4030-0e11-4867-a799-ddaac6835e8b/resolve` | decision-replay:9df167a7-8383-45a5-b385-373a9269f259:resolve:0；`/requests/8/input` | status=200; errorCode=None；`/requests/8/result` |
| 10 | `POST /api/decisions/2b9b4030-0e11-4867-a799-ddaac6835e8b/resolve` | decision-replay:9df167a7-8383-45a5-b385-373a9269f259:resolve:1；`/requests/9/input` | status=409; errorCode=decision_already_resolved；`/requests/9/result` |
| 11 | `POST /api/decisions/2b9b4030-0e11-4867-a799-ddaac6835e8b/resolve` | decision-replay:9df167a7-8383-45a5-b385-373a9269f259:resolve:0；`/requests/10/input` | status=200; errorCode=None；`/requests/10/result` |
| 12 | `worker.claim.continuation` | 无客户端幂等key；实际生产写入/领取事务；`/requests/11/input` | runId=2a6e9b03-7b00-406d-aff5-ba31629b96a7；`/requests/11/result` |
| 13 | `controlled Computer completion / production settlement` | 受控Computer事件传输，实际Projection/结算写入；`/requests/12/input` | run: id=2a6e9b03-7b00-406d-aff5-ba31629b96a7; status=completed；`/requests/12/result` |
| 14 | `GET /api/decisions/2b9b4030-0e11-4867-a799-ddaac6835e8b` | 只读/受控传输步骤；`/requests/13/input` | status=200; errorCode=None；`/requests/13/result` |
| 15 | `GET /api/outcomes/e9dc5e6d-b53d-4fe0-966f-ebd826239adc/inbox?status=pending&category=decision_pending` | 只读/受控传输步骤；`/requests/14/input` | status=200; errorCode=None；`/requests/14/result` |
| 16 | `outcomes.detail / transcript` | 只读/受控传输步骤；`/requests/15/input` | detail: id=e9dc5e6d-b53d-4fe0-966f-ebd826239adc; status=review_pending；`/requests/15/result` |

## 实际业务检查

| 检查 | 实际结果 |
| --- | --- |
| `initial_context_is_persisted_for_this_work_item` | PASS |
| `foreground_and_outcome_claim_independently` | PASS |
| `tool_replay_returns_one_decision` | PASS |
| `settlement_keeps_waiting_decision` | PASS |
| `paused_work_has_no_output` | PASS |
| `required_auth_rejects_unsigned_request` | PASS |
| `inbox_returns_the_tool_decision` | PASS |
| `public_card_uses_persisted_options` | PASS |
| `independent_user_requests_have_one_winner` | PASS |
| `winner_retry_returns_original_response` | PASS |
| `one_resolution_event_and_continuation` | PASS |
| `choice_preserves_the_approved_revision` | PASS |
| `continuation_preserves_work_item_and_context` | PASS |
| `resolved_decision_is_queryable_and_no_longer_pending` | PASS |
| `final_output_is_from_the_resumed_turn` | PASS |
| `main_run_lease_and_visible_messages_unchanged` | PASS |

## 重放命令、失败与边界

在集成根目录、显式本线55440一次性库执行：`bun --no-env-file test ./apps/server/test/outcome-decision-full-replay.integration.test.ts`；仅导出报告时另设`OUTCOMEGO_DECISION_REPLAY_REPORT`为新的输出文件。实际1 PASS / 0 FAIL / 12 assertions；后续九文件server联合78 PASS / 0 FAIL / 451 assertions也包含该用例。两次失败是新报告程序的对象键顺序字符串比较和BigInt导出；分别改为严格结构相等、Event.sequence无损字符串后通过，没有改生产幂等语义。原始失败与最终日志见父[开发收尾证据目录](../../004-OutcomeGo整体项目/docs/20261117-开发收尾证据)。

二个生产Request handler并发请求并非两个实际原生客户端；只证明200/409、原key回放及同context续跑。004.3/4.1真实双客户端前置仍未完成，故4.3具名本地报告交付不自动通过正式场景B。

本地数据库与临时资料由各执行者只清理自己资源，证据先归档。真实部署、模型/provider、远端Computer、Desktop窗口/设备、OS通知/文件权限和CI仍按原任务记录为PENDING，不是本地结果。
