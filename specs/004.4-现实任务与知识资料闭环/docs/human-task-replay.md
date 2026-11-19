# 人工任务固定场景全流程本地回放（task70最终私有库隔离版）

日期：2026-11-17；实现基线`93d5ff665`加本轮未提交源码。执行者w1-product。**真实本地PostgreSQL/生产服务/Worker.claim/Projection/settlement；推理与Computer事件受控、材料虚构，没有监听服务/真实模型/原生客户端。**

当前权威来源为[实际JSON](../../004-OutcomeGo整体项目/docs/20261117-开发收尾证据/product-isolation/human-isolated.json)，SHA-256 `345e9147720b2e800dc5b55a7821b5c75cb22e46930a39c6a0ed41eccf7bf3b7`；报告PASS，32/32业务检查通过。该报告通过公共helper/CLI在唯一template0私有库执行，生产全局consumer只读写该私有URL，未继承规范库任何事实；`databaseIsolation`记录 `outcomego_product_replay_57d64b19638f426baa3ee9c82b2db9ad`、inheritedData=false、removed=true。drop/连接关闭/临时目录清理后才发布报告。旧final3 JSON保留为历史，不倒改其ID或源码归属；共享库误用的RED与新外部pending不变/故障清理回归另存父证据目录。

## 实际ID与关联

| 字段 | 实际值 |
| --- | --- |
| `botId` | `c5c4ceaf-9cd4-4d63-93d1-91f8dcce8bbb` |
| `channelId` | `41ae5ab2-0804-467a-b8b2-5e905f59cc32` |
| `planId` | `86617247-9b19-444b-9d9a-1782af6bd6da` |
| `outcomeId` | `6e536ee3-f26d-43bd-b771-695fd61c969f` |
| `revisionId` | `286c6de9-11b7-424a-be4a-49506931cd0f` |
| `workItemId` | `37c74862-f8b9-40be-9ba3-89d287581c12` |
| `rootRunId` | `3f362f58-c38e-4165-8339-18934a5ac451` |
| `contextSessionId` | `526ad134-7612-4a09-a645-c0d95686a0fd` |
| `mainRunId` | `4bb5b535-e18b-434c-8fde-81b0b16dde06` |
| `humanWorkItemId` | `468e3703-8304-46f5-a2d7-e44ed99505cd` |
| outputs（1） | `d9064292-8d86-43b2-9ffc-d4a01365ee0a` |
| evidence（4） | `863d5b8e-0a48-4351-9c82-418d9dee6929`, `191ba4c7-a361-41d2-b57c-9e8c09bca816`, `e3fb7ca0-d2f2-4802-9629-943793e664a1`, `52e49481-a7b7-4670-b5bb-ab690834b13d` |
| reviews（4） | `5e10536a-550a-4fe8-84a0-d0e87b7bede4`, `9f9a4461-b76c-4785-b877-62fcbdc63cf7`, `f5cf33a8-98bf-4d7d-a3ec-2405722ed75c`, `5aeae5ea-b5a4-4783-bca4-64966faad225` |
| Run[0] | `3f362f58-c38e-4165-8339-18934a5ac451` / completed / WorkItem=`37c74862-f8b9-40be-9ba3-89d287581c12` |
| Run[1] | `e7ea8466-d9b5-4b8a-883c-e90421fb40b4` / completed / WorkItem=`37c74862-f8b9-40be-9ba3-89d287581c12` |
| Receipt[0] | `f0157494-cb5e-4b64-afb3-c5fe91313d53` / rejected / sequence=1 |
| Receipt[1] | `d798022a-9309-4de3-ab5d-8c3c19ed51bd` / accepted / sequence=2 |

## 每步真实请求与结果

JSON指针从0开始。每步完整input/result都在同一实际JSON，不凭摘要猜测完整载荷；无客户端key不表示只读。

| 步骤 | 生产入口/操作 | 输入/key定位 | 实际结果定位 |
| --- | --- | --- | --- |
| 1 | `controlled-inference` | 受控推理输入/响应；`/requests/0/input` | 完整响应/嵌套视图见指针，不补造字段；`/requests/0/result` |
| 2 | `planning.create` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:plan；`/requests/1/input` | status=ready；`/requests/1/result` |
| 3 | `outcomes.createFromDraft` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:create；`/requests/2/input` | id=6e536ee3-f26d-43bd-b771-695fd61c969f; status=pending_approval；`/requests/2/result` |
| 4 | `outcomes.approve` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:approve；`/requests/3/input` | id=6e536ee3-f26d-43bd-b771-695fd61c969f; status=approved；`/requests/3/result` |
| 5 | `outcomes.startRun` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:start；`/requests/4/input` | id=6e536ee3-f26d-43bd-b771-695fd61c969f; status=running；`/requests/4/result` |
| 6 | `worker.claim` | 无客户端幂等key；实际生产写入/领取事务；`/requests/5/input` | runId=3f362f58-c38e-4165-8339-18934a5ac451；`/requests/5/result` |
| 7 | `messaging.acceptDirectUserMessage` | 无独立客户端key；按实际生产操作记录；`/requests/6/input` | runId=4bb5b535-e18b-434c-8fde-81b0b16dde06；`/requests/6/result` |
| 8 | `knowledge.search/read` | 只读资料查询；无客户端幂等key；`/requests/7/input` | 完整响应/嵌套视图见指针，不补造字段；`/requests/7/result` |
| 9 | `RequestHumanAction` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:request-human；`/requests/8/input` | workItemId=468e3703-8304-46f5-a2d7-e44ed99505cd; status=waiting_human；`/requests/8/result` |
| 10 | `controlled-computer-completion` | 受控Computer事件传输，实际Projection/结算写入；`/requests/9/input` | 完整响应/嵌套视图见指针，不补造字段；`/requests/9/result` |
| 11 | `human.start` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:human-start；`/requests/10/input` | id=468e3703-8304-46f5-a2d7-e44ed99505cd; status=in_progress；`/requests/10/result` |
| 12 | `human.pause` | human-pause:fixture:1；`/requests/11/input` | id=468e3703-8304-46f5-a2d7-e44ed99505cd; status=paused；`/requests/11/result` |
| 13 | `human.start` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:human-resume；`/requests/12/input` | id=468e3703-8304-46f5-a2d7-e44ed99505cd; status=in_progress；`/requests/12/result` |
| 14 | `receipts.submit.missing` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:receipt-missing；`/requests/13/input` | id=f0157494-cb5e-4b64-afb3-c5fe91313d53; workItemId=468e3703-8304-46f5-a2d7-e44ed99505cd; status=submitted；`/requests/13/result` |
| 15 | `reviews.submit.UNVERIFIED` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:review-unverified；`/requests/14/input` | id=6e536ee3-f26d-43bd-b771-695fd61c969f; status=human_action_pending；`/requests/14/result` |
| 16 | `reviews.submit.missing-PASS` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:review-missing-pass；`/requests/15/input` | errorCode=human_evidence_missing；`/requests/15/result` |
| 17 | `reviews.submit.FAIL` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:review-reject；`/requests/16/input` | id=6e536ee3-f26d-43bd-b771-695fd61c969f; status=human_action_pending；`/requests/16/result` |
| 18 | `human.start` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:human-resubmit-start；`/requests/17/input` | id=468e3703-8304-46f5-a2d7-e44ed99505cd; status=in_progress；`/requests/17/result` |
| 19 | `receipts.submit.resubmitted` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:receipt-resubmit；`/requests/18/input` | id=d798022a-9309-4de3-ab5d-8c3c19ed51bd; workItemId=468e3703-8304-46f5-a2d7-e44ed99505cd; status=submitted；`/requests/18/result` |
| 20 | `reviews.submit.human-PASS` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:review-human；`/requests/19/input` | id=6e536ee3-f26d-43bd-b771-695fd61c969f; status=running；`/requests/19/result` |
| 21 | `worker.claim.continuation` | 无客户端幂等key；实际生产写入/领取事务；`/requests/20/input` | runId=e7ea8466-d9b5-4b8a-883c-e90421fb40b4；`/requests/20/result` |
| 22 | `controlled-computer-completion` | 受控Computer事件传输，实际Projection/结算写入；`/requests/21/input` | 完整响应/嵌套视图见指针，不补造字段；`/requests/21/result` |
| 23 | `controlled-inference` | 受控推理输入/响应；`/requests/22/input` | 完整响应/嵌套视图见指针，不补造字段；`/requests/22/result` |
| 24 | `evidenceConsumer.drain` | 无客户端幂等key；实际生产写入/领取事务；`/requests/23/input` | processed=2；`/requests/23/result` |
| 25 | `reviews.submit.final` | product-replay:4d5553fd-eb3b-4c31-8f18-8d0233c75f1d:review-final；`/requests/24/input` | id=6e536ee3-f26d-43bd-b771-695fd61c969f; status=accepted；`/requests/24/result` |

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
| `knowledge_reads_actual_mounted_bytes` | PASS |
| `human_tool_replay_returns_same_card` | PASS |
| `human_tool_ends_turn` | PASS |
| `settlement_preserves_waiting_human` | PASS |
| `paused_draft_survives_reopen` | PASS |
| `missing_material_is_explicit_not_success` | PASS |
| `missing_human_material_rejects_pass` | PASS |
| `rejection_preserves_receipt` | PASS |
| `receipt_retry_is_exact` | PASS |
| `human_review_retry_is_exact` | PASS |
| `review_accepts_human_only_before_agent_finishes` | PASS |
| `human_review_enqueues_once` | PASS |
| `continuation_uses_actual_same_context_and_root` | PASS |
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
bun --no-env-file scripts/outcome-recovery/product-replay.ts human data/acceptance/task70-20261117/isolation/human-isolated.json
```

规范URL只是创建私有库的本地管理连接，不在共享库执行受控prereview。helper全部业务连接/PgBoss/EventWakeup/consumer使用私有URL，finally关闭连接并drop准确随机库，不清除或过滤外国业务事实，不修改生产consumer API。外部pending种子snapshot在前后完全相同；报告发布失败与执行期consumer故障清理均有专门回归，精确最终结果见父开发台账。

此前final3研究19/人工32是实际历史运行；当前上述19/32来自隔离版真实重执行。integrator此前9文件78P451是共享harness修正前联合覆盖，之后同9文件80P460（含四个product案例）及两类型零诊断为新隔离源码证明；之后若只增第5个测试，单文件结果另列，不冒称完整9文件81已执行。没有新完整server/root/远端CI总数。

## 原4.1完成标准与开发裁决

资料search/read、实际RequestHumanAction、开始/暂停/恢复、缺材料/UNVERIFIED、错误PASS拒绝、FAIL驳回、补交、唯一Review接受、原Agent同ContextSession继续及最终accepted的请求/ID/结果均在上述实际链中；不再以“各阶段分散测试存在”替代一条完整链。task69的18项实际mounted UI也补齐3.3前置，既有移动只读3.4保持DONE，因此本地固定fixture的4.1原标准满足。这里没有把真实客户端或生产现场操作写为已发生。

## 需求1–18与失败矩阵（支持6.1）

| 需求 | 已实施及实际证据 | 未外推边界 |
| --- | --- | --- |
| 1 资料来源 | 本链真实agent-data文件search/read+digest；既有provider24例 | 远端共享挂载未观察 |
| 2 两种人工来源 | 现有14回执实际DB验证A/B；本链实际trusted工具A | 模型真实调用未验 |
| 3 人工回执 | 本链missing/rejected/resubmitted与材料Evidence | 现场材料为明确虚构 |
| 4 Explore交付 | 既有Explore7DB+本轮72真实converted恢复 | live planner未验 |
| 5 Bot scope | provider范围/权限先于limit；既有24实际DB | 无跨项目/RBAC新平台 |
| 6 可执行卡片 | 本链start/pause/read/reopen；69真实mounted交互 | 不声明原生窗口操作 |
| 7 统一验收 | 本链missing PASS拒绝/FAIL/人工PASS/同线程继续 | 不把Agent建议当人工执行 |
| 8 范围分离 | Explore独立新Outcome不自动批准；72双向关联恢复 | 不自动扩大原Contract |
| 9 可替换provider | 真实factory注入/mounted文件适配+固定合同 | 外部X-File不在范围 |
| 10 引用范围 | source refs/版本hash，外国Bot/stale回归 | 不把外链当已读 |
| 11 状态恢复 | 本链pause草稿；69online/乱序读取/已提交历史 | 未保存File不保证跨应用重启 |
| 12 多材料与重试 | 原receipt asset实际事务+69部分上传/原key重试 | 原生文件选择权限未验 |
| 13 Evidence归属 | 本链同Outcome/revision/criterion/receipt/Review ID | 不跨Outcome拼阳性事实 |
| 14 Explore生命周期 | 既有7DB/只读历史；72 4Plan/3Idea真实restore | 旧镜像实际回退未验 |
| 15 人工与普通隔离 | 跨阶段11实际DB，前台Run/lease不变 | live并行UI未验 |
| 16 失败与数据边界 | 缺材料/拒绝/补交，持久资产竞争，69卸载/迟到处理 | 不假设未知外部成功 |
| 17 原子线程继续 | 本链两次Worker.claim同context，接受前不续跑 | 远端Computer未验 |
| 18 移动只读 | 前阶段真实Android43+86、Swift329；无移动写入 | 完整iOS App TLS/设备UI仍PENDING |

失败行为的当前证据包括：读取stale/unreadable、scope-before-limit；缺材料UNVERIFIED/422，Review错误PASS拒绝；receipt事务失败原key重试；rejected后补交历史；asset缺失/冲突与保留竞争；69网络/409/partial-upload/online/refresh/unmount/两种迟到成功/重叠在途；普通Agent路径不新增人工事实。受影响联合server80/0、Desktop786/0支持本轮源码并集；不将其称作新的远端CI。

## 父design §34八问

1. **代码修改**：本轮69仅ReceiptForm/HumanAction、测试devDependency及18DOM回归；70新增真实本地完整链；72新增有数据备份代码；中央仅新B回放和现有CI/类型入口。此前Knowledge/Human/Review/Explore/移动端生产装配保持，准确文件见父开发收尾记录。
2. **数据库变更**：本轮无schema变更；实际在独立一次性PostgreSQL部署现有Prisma+raw schema。72对4Planning/3Explore/2Outcome、86表/123FK作同版完整恢复，不部署生产库。
3. **客户端平台**：本轮完整Desktop786/0/1、18mounted UI（包含包内，不再相加）；此前Android shared43/app86及Swift329保持来源归属；完整iOS App、原生设备/窗口/live API不声明通过。
4. **命令**：上述product-replay CLI19/32、task70测试2/31与integrator联合78/451；完整Desktop786/20262；新根脚本30/88、26目标类型零诊断、Desktop/server完整tsc与workflow。各原始日志/命令由父新证据目录索引，本问不制造新执行。
5. **外部缺项**：真实模型/Bot/远端Computer、共享挂载现场、OS权限/文件选择/通知、完整iOS App、设备/live API、远端CI、旧镜像/发布不在本地证明中。
6. **明确未做**：自动设备控制/移动Receipt写入、组织RBAC、X-File/知识图谱仍Out of Scope。Explore已实现并测试，本轮未延期。没有加入新的工具权限门禁。
7. **回滚**：只撤本轮授权源码/测试/CI改动并恢复已有13文档的本轮增量；保留卡片/回执/Evidence/Review/Explore与审计。正式首选关闭Outcome新入口并保留新表，不自动删除数据或运行旧镜像；源WIP备份路径在父记录。
8. **下一阶段**：本地实现及固定fixture开发验收满足后，发布负责人再组织真实客户端/部署/provider和父全局依赖门；本地DONE不替代它们。已有本地全包未改范围无需为写文档重跑。
