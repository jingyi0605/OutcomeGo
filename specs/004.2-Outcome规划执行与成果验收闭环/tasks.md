# 任务清单 - Outcome 规划执行与成果验收闭环（人话版）

2026-11-18 扩展：新增需求 21、设计 §35 和阶段 8 普通对话原生目标工具。此前 122 项/96 DONE 的组合统计为本扩展前历史快照；本阶段单独验收，不改写原任务完成判据或外部环境结果。

2026-11-17 task73 当前开发更新：当前原九项仍4DONE/5开放。task70 final3已补同Outcome阳性Output/Evidence/Review及所有核心请求/ID，[acceptance-replay.md](docs/acceptance-replay.md)为当前对账，19检查PASS；旧两条空集合链仅为历史。本地7.2数据/报告缺口已关闭，但原7.1真实研究Bot前置仍未验，因此7.2/7.3不勾；3.1/3.2/7.1的真实Bot门也未被受控推理/Computer替代。

状态：IN_PROGRESS（2026-11-17 逐项验收：本次九项中新增完成 3.4、5.1、5.2、5.3；3.1、3.2、7.1、7.2、7.3 保持未完成）

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

2026-11-17 最终逐项验收：原始完成标准、验证要求和前置依赖不变；判定与证据见[逐项任务验收记录](docs/20261117-逐项任务验收记录.md)。本次只接受四项本地实现/回归任务，不将真实 Bot、远端 Computer 或研究试点标为通过。3.4 的代码依赖 3.1/3.2 已交付并参与组合测试，但这两项的正式真实环境验证仍 BLOCKED；最终检查点不据此放行。下文较早波次计数保留历史归属，以本次记录区分当前结果。

2026-11-17 整理：按“主线程 + 子线程”执行模型重排；合并了原先重复的最终检查点（4.6/5.5/7.2）、普通聊天回归（4.5/5.3/6.4）和失败回放（5.4/6.1/6.2）；原阶段 8 的规划服务、返工、预审和 Budget 并入对应阶段，解决“2.1 需要的 `kind=planning` 在 8.1 才实现”的顺序问题。

分波及测试替身合同：[父接口冻结文档](../004-OutcomeGo整体项目/docs/parallel-interfaces.md)。需求见 [requirements.md](requirements.md)，业务设计见 [design.md](design.md)；本次只调整任务前置关系。

## 阶段 0：代码基线和试点冻结

- [x] 0.1 画出当前消息到 Run 的真实调用链
  - 状态：DONE
  - 证据：[`docs/runtime-capability-matrix.md`](docs/runtime-capability-matrix.md)（2026-11-17，代码基线 `3b02ebfe6`）
  - 结论：`acceptDirectUserMessage` 会顶替主对话正在运行的回合，不能用于 Outcome；Routine 的子线程模式（独立上下文 scope、独立租约 scope、运行组判断、禁用 `SendToUser`）可作为 Outcome 子线程的先例。
  - 对应需求：需求 3、需求 4、需求 19
  - 对应设计：§8、§12

- [x] 0.2 固定研究试点 fixture
  - 状态：DONE
  - 证据：[`docs/research-pilot.json`](docs/research-pilot.json)、[`docs/acceptance-replay.md`](docs/acceptance-replay.md)（回放表待任务 7.1 填写）
  - 对应需求：需求 10、需求 19
  - 对应设计：§11、§15

- [x] 0.3 检查点：确认集成方式
  - 状态：DONE
  - 结论（2026-11-17）：采用父 design §39 D10（新增 `RunOrigin.outcome`）、D11（每次运行 1 个 WorkItem）、D13（每 Bot 2 个子线程）、D14（`Run.outcomeWorkItemId`，不建 `OutcomeRunLink`）、D15（Output 来自运行组最终结果和输出目录）。理由见 `docs/runtime-capability-matrix.md` §3。
  - 对应需求：需求 8、需求 19
  - 对应设计：§9.4、§12

## 阶段 1：共享合同、模型和 schema

- [x] 1.1 实现 Outcome 共享 DTO 和解析函数
  - 状态：DONE（2026-11-17，实现提交 `69e5edd7c`）
  - 证据：`packages/contracts/src/outcomes.ts`（状态枚举、事件目录、错误码、DTO、请求 Schema、`resolvePlanningSelections`、`detectPlanningConflicts`、`requiredCriteriaSatisfied`、列表游标）；`packages/contracts/test/outcomes.test.ts` 18 项通过；contracts 全量 180 项通过；`bun --filter @outcomego/contracts typecheck` 通过；`scripts/check/contract-enum-parity.ts` 通过。
  - 这一步到底做什么：在 contracts 中定义 Outcome、ContractRevision、AcceptanceCriterion、WorkItem、Output、Evidence、Review、PlanningDraft 的类型、状态枚举、错误码和请求解析函数。
  - 先依赖什么：0.3
  - 开始前先看：§9、§10、§16.2、§19、§20；父 design §15、§42
  - 主要改哪里：`packages/contracts/src/outcomes.ts`（新增）、`packages/contracts/src/index.ts`、`packages/contracts/package.json`、`packages/contracts/test/outcomes.test.ts`（新增）
  - 这一步先不做什么：不加入权限等级、authority 字段和未来模型；不改 `service-protocol.ts` 的推理 kind（属于 2.1）。
  - 怎么算完成：所有请求体有解析函数，超限、缺字段、伪造字段返回稳定错误；状态枚举与父 design §42 一致。
  - 怎么验证：`bun --filter @outcomego/contracts typecheck`、`bun test packages/contracts/test/outcomes.test.ts`
  - 对应需求：需求 1、需求 2、需求 6、需求 9、需求 18
  - 对应设计：§9、§10、§16.2、§19、§20

- [x] 1.2 增加数据库模型
  - 状态：DONE（2026-11-17，实现提交 `69e5edd7c`）
  - 证据：`packages/db/prisma/schema.prisma` 新增 9 个枚举和 8 个模型（`OutcomePlanningDraft`、`Outcome`、`OutcomeContractRevision`、`OutcomeAcceptanceCriterion`、`OutcomeWorkItem`、`OutcomeOutput`、`OutcomeEvidence`、`OutcomeReview`），`RunOrigin` 增加 `outcome`，`Run` 增加可选 `outcomeWorkItemId` 及索引；同步 `packages/contracts/src/index.ts` 的 `RunOrigin`、`packages/messaging/src/index.ts` 的 `WakeInput.origin`、`apps/worker/src/worker.ts` 的请求来源映射（`outcome` → `automation`）。本地一次性 PostgreSQL 17 容器上 `deploy-schema.ts` 成功；`packages/db/test/outcomes.integration.test.ts` 4 项、`fresh-schema.integration.test.ts` 3 项通过，db 全量 41 项通过；messaging、worker、server、computer、desktop typecheck 通过。
  - 与设计的差异：验收条款只存 `OutcomeAcceptanceCriterion`，revision 不另存 `acceptance` JSON（design §9.2 已同步）；`retryCount`、`recoveryCount` 留给 `004.5` 任务 1.1。
  - 这一步到底做什么：新增 Outcome、OutcomePlanningDraft、OutcomeContractRevision、OutcomeAcceptanceCriterion、OutcomeWorkItem、OutcomeOutput、OutcomeEvidence、OutcomeReview；`RunOrigin` 增加 `outcome`；`Run` 增加可选 `outcomeWorkItemId` 和索引。
  - 先依赖什么：1.1
  - 开始前先看：§9、§21、§31.3；父 design §16
  - 主要改哪里：`packages/db/prisma/schema.prisma`、`packages/db/test/fresh-schema.integration.test.ts`、`packages/db/test/outcomes.integration.test.ts`（新增）
  - 这一步先不做什么：不删除或重命名现有表和列；不写 Prisma Migrate 迁移文件。
  - 怎么算完成：Prisma 生成通过；新表的唯一约束生效；现有 Run 的 `outcomeWorkItemId` 为空。
  - 怎么验证：`bun --filter @outcomego/db typecheck`；一次性 PostgreSQL 上 `DATABASE_URL=<临时库> bun --filter @outcomego/db db:push` 后运行 `bun test packages/db/test/fresh-schema.integration.test.ts packages/db/test/outcomes.integration.test.ts`
  - 对应需求：需求 1、需求 7、需求 8、需求 9
  - 对应设计：§6、§9、§21

- [x] 1.3 实现 Outcome/Contract 服务
  - 状态：DONE（2026-11-17，实现提交 `69e5edd7c`）
  - 证据：`apps/server/src/services/outcome-service.ts`（`createFromDraft`、`createRevision`、`approve`、`cancel`、`get`、`list`、`recomputeStatus`；业务写入、`outcome.*` 事件和 `IdempotencyRecord` 同一事务）；`apps/server/test/outcome-service.test.ts` 11 项通过（含重复请求回放、同 key 不同内容、过期草案、阻断冲突、并发批准只成功一次、revision 基线冲突、N+1 批准后 N 被替代、状态派生和 resumeStatus、取消、分页）；server typecheck 通过。
  - 已知限制：取消只改 WorkItem 状态，停止子线程 Run 在任务 3.2 实现；服务尚未注册到 `app-service` 和路由（任务 2.2）。
  - 这一步到底做什么：从 PlanningDraft 创建 Outcome 和 revision 1、创建新 revision、批准 revision、取消 Outcome，以及 Outcome 状态重新计算；全部在事务内写事件和 `IdempotencyRecord`。
  - 先依赖什么：1.2
  - 开始前先看：§13、§17、§18、§19、§22；父 design §14、§42.3、§43、§44
  - 主要改哪里：`apps/server/src/services/outcome-service.ts`（新增）、`apps/server/test/outcome-service.test.ts`（新增）
  - 这一步先不做什么：不实现 HTTP route、规划生成和子线程入队。
  - 怎么算完成：草案、revision、批准、supersede、取消和状态计算都在事务内完成；重复 `clientRequestId` 返回原结果，同 key 不同内容返回 `idempotency_conflict`。
  - 怎么验证：`bun --filter @outcomego/server typecheck`、`bun test apps/server/test/outcome-service.test.ts`（含并发批准和重复请求）
  - 对应需求：需求 1、需求 7、需求 12
  - 对应设计：§13、§17、§18、§22

## 阶段 2：规划、API 和批准

- [x] 2.1 实现规划候选项服务
  - 状态：DONE（第 1 波本地实现；外部/跨线检查的 PENDING 见下）
  - 实现提交：10363eea9、1b4b0e068、a909e2d43
  - 修改文件：`packages/contracts/src/service-protocol.ts`、`apps/server/src/services/outcome-inference.ts`、`outcome-planning-service.ts`、`app-service.ts`、对应测试
  - 数据库变化：none（仅一次性测试库部署既有 schema）
  - 验证命令：`bun test apps/server/test/outcome-planning-service.test.ts packages/contracts/test/outcome-inference.test.ts`；contracts/server typecheck
  - 验证结果：本地 fixture、上限/伪造 ID/关键问题/空输入/非 JSON/超时/过期/幂等 PASS；真实 computer 调用 PENDING
  - 证据文件：[第 1 波线 2 验证记录](docs/20261117-第1波产品功能验证.md)
  - 已知限制：本线未执行远端同步/重建/真实调用，部署状态未验证，见验收记录；未创建正式 Agent Run
  - 回滚方式：按本线提交逆序 revert，保留其他线改动。
  - 这一步到底做什么：`OutcomePlanningService` 通过 computer `/v1/infer`（`kind=planning`）生成三维候选项，保存 `OutcomePlanningDraft`，处理非 JSON、超时和空结果。
  - 先依赖什么：1.3
  - 开始前先看：§10、§16、§31
  - 主要改哪里：`packages/contracts/src/service-protocol.ts`（kind 增加 `planning`、`prereview`）、`apps/server/src/services/outcome-planning-service.ts`（新增）、对应测试
  - 这一步先不做什么：不新建 Agent Run，不做模板复用和长期偏好。
  - 怎么算完成：固定 fixture 能生成合法 draft；每维度最多 4 项；`questions` 转为 `ambiguous_scope` 冲突；失败返回 `planning_generation_failed`（retryable）。
  - 怎么验证：用假 computer 响应的服务测试 `bun test apps/server/test/outcome-planning-service.test.ts`；开发环境一次真实调用记录在 `docs/acceptance-replay.md`
  - 对应需求：需求 2、需求 6、需求 15
  - 对应设计：§10、§16、§31

- [x] 2.2 实现 Outcome HTTP API（不含执行和验收）
  - 状态：DONE（第 1 波本地实现；外部/跨线检查的 PENDING 见下）
  - 实现提交：5f8a56471、a909e2d43、410ca8976
  - 修改文件：`apps/server/src/routes/outcome.ts`、`services/outcome-service.ts`、`app-service.ts`、`main.ts`、路由/事务测试
  - 数据库变化：none（仅一次性测试库部署既有 schema）
  - 验证命令：`bun test apps/server/test/outcome-routes.test.ts apps/server/test/outcome-revision-transaction.test.ts apps/server/test/outcome-service.test.ts`；server typecheck
  - 验证结果：路由格式/错误/认证注册顺序/持久 Session 主体/本地主体/幂等/事务回滚 PASS；同 key 并发批准和修订屏障回归均由失败转为通过，原服务 11 项继续通过
  - 证据文件：[第 1 波线 2 验证记录](docs/20261117-第1波产品功能验证.md)
  - 已知限制：不启动 HTTP 服务；运行和 transcript 端口由线 1 合并后提供真实实现；Decision 撤回第四参数由集成装配
  - 回滚方式：按本线提交逆序 revert，保留其他线改动。
  - 这一步到底做什么：注册 plans、outcomes 创建/列表/详情、revisions、approve、cancel 路由。
  - 先依赖什么：1.3、2.1
  - 开始前先看：requirements “API 合同需求”；design §11、§19、§20；`apps/server/src/main.ts` 现有 route 注册方式
  - 主要改哪里：`apps/server/src/routes/outcome.ts`（新增）、`apps/server/src/main.ts`、`apps/server/test/outcome-routes.test.ts`（新增）
  - 这一步先不做什么：不实现 `/runs`、`/reviews`、`/rework`、transcript（属于阶段 3–4）。
  - 怎么算完成：路由返回 §19 的结构；错误使用 `{ error: { code, message, details } }`；未认证请求被现有中间件拒绝；认证关闭时 `actorRef = owner:local`。
  - 怎么验证：`bun test apps/server/test/outcome-routes.test.ts`
  - 对应需求：需求 1、需求 3、需求 6、需求 7
  - 对应设计：§11、§19、§20

- [x] 2.3 实现 Desktop 规划和批准页面
  - 状态：DONE（第 1 波本地实现；外部/跨线检查的 PENDING 见下）
  - 实现提交：b7f6aba7e
  - 修改文件：Desktop `outcomes/planning/`、`client/outcome-api.ts`、`outcomego-api.ts`、`chat-pane.tsx`、`test/outcome-planning.test.ts`
  - 数据库变化：none（仅一次性测试库部署既有 schema）
  - 验证命令：`bun --filter @outcomego/desktop typecheck`；`bun test apps/desktop/test/outcome-planning.test.ts`
  - 验证结果：类型检查与组件静态渲染/多选自定义/冲突/重试 ID/批准禁用/API 适配 PASS
  - 证据文件：[第 1 波线 2 验证记录](docs/20261117-第1波产品功能验证.md)
  - 已知限制：交互及视觉回放 PENDING，未启动前端或渲染服务；Budget 仅记录上下文
  - 回滚方式：按本线提交逆序 revert，保留其他线改动。
  - 这一步到底做什么：PlanningWizard（逐维度多选、自定义、冲突提示、可选 Budget）和 Contract 确认批准。
  - 先依赖什么：2.2
  - 开始前先看：§26、§34
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/`（新增）、`chat-pane.tsx`（入口）、`apps/desktop/src/renderer/client/outcomego-api.ts`
  - 这一步先不做什么：不替换聊天历史，不展示完整运行日志。
  - 怎么算完成：用户可以输入任务、多选、自定义、看到冲突、填写或跳过 Budget、批准；批准请求中按钮禁用，失败后保留选择。
  - 怎么验证：`bun --filter @outcomego/desktop typecheck`、`bun test apps/desktop/test/outcome-planning.test.ts`
  - 对应需求：需求 1、需求 2
  - 对应设计：§10、§26、§34

## 阶段 3：Outcome 子线程执行

- [ ] 3.1 增加 Outcome 子线程运行时支持
  - 状态：BLOCKED（本地完成标准和组合回归已满足；引用的运行时能力矩阵 §4 明确要求真实开发 Bot 回放，证据仍缺失）
  - 本次验收：Worker 真实领取数据库测试 5 项及 Messaging 运行组测试 14 项均出现在最终通过日志；不替代能力矩阵 §4 的真实 Bot Run ID/租约记录。见[逐项记录第 2 节](docs/20261117-逐项任务验收记录.md#2-九项逐项判定)。
  - 最终本机检查点（2026-11-17，task-30）：Computer 1360/0/68、Messaging 857/0/0（生产冻结 `5e2ce81d8`）；Server 1535/0/11、Worker 236/0/3（纯测试后继 `727d410f2`，生产相同）；另九项专库恢复及六 CLI 40 checks 通过。此前本块 wave1 canonical/dual-flag 计数均保留为历史，不与当前结果混并。真实环境门槛不据此放行，见[最终本机结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)。
  - 实现提交：`ce875ef7f`、`aaed9e362`、`4754659cc`、`e74706d97`
  - 修改文件：`packages/messaging/src/index.ts`、`request-progress.ts`、`automation-results.ts`；`apps/worker/src/worker.ts`、`test/outcome-thread.integration.test.ts`；computer 精确取消接入见 3.2。
  - 数据库变化：none
  - 验证命令：证据文档命令 A、C、D、E、F；五包 typecheck、architecture、workflow。
  - 验证结果：定向测试通过；首次 canonical worker `161 PASS / 51 SKIP / 14 FAIL`；最终原始全量 `157 PASS / 51 SKIP / 9 FAIL / 1 ERROR`，含 typed-message 启动超时；该文件单次隔离 `4 PASS / 6 FAIL` 恢复原六个 Stop 失败，其余 8 个有名失败与基线一致。dual-flag 对比基线两侧 `83 PASS / 18 FAIL`，名字逐项新增 0；真实租约回放 PENDING。原始计数不混并，详见证据。
  - 证据文件：[`docs/20261117-子线程运行时验证.md`](docs/20261117-子线程运行时验证.md)、[`docs/acceptance-replay.md`](docs/acceptance-replay.md)
  - 已知限制：不宣称 CI 全绿；远端 computer 未部署；前台 Stop 隔离的 `subagent/service.ts` 补丁由 integrator 独立交付。
  - 回滚方式：按证据文档逆依赖顺序撤销线 1 提交，无 schema 回滚。
  - 这一步到底做什么：`WakeInput.outcomeWorkItemId` 写入 InboxEvent payload 和 `Run.outcomeWorkItemId`；`contextScopeForRun` 支持 `outcome`；`REQUEST_SOURCE_BY_ORIGIN` 映射为 `automation`；领取逻辑把 `outcome` 当作后台线程，租约 `outcome:<workItemId>`，每 Bot 上限 2；同一 Bot 桌面操作互斥。
  - 先依赖什么：1.2
  - 开始前先看：design §12.3；`docs/runtime-capability-matrix.md`
  - 主要改哪里：`packages/messaging/src/index.ts`、`apps/worker/src/worker.ts`、`apps/computer/src/runtime/tools.ts`（如需）、`apps/worker/test/outcome-thread.integration.test.ts`（新增）
  - 这一步先不做什么：不改变主对话、群聊和 Routine 的租约、上下文和工具；不新建队列。
  - 怎么算完成：主对话有运行中回合时，Outcome 子线程仍可被领取；Outcome 子线程运行时，用户消息不会把它标为 interrupted；第 3 个子线程排队。
  - 怎么验证：`bun --filter @outcomego/worker typecheck`、`bun test apps/worker/test/outcome-thread.integration.test.ts`、现有 worker 生命周期测试
  - 对应需求：需求 19
  - 对应设计：§12.3；父 design §45

- [ ] 3.2 实现 `POST /runs` 和 WorkItem 入队调度
  - 状态：BLOCKED（本地真实服务/Request handler、幂等入队与失败状态已验证；原文要求的“真实开发 Bot 一次运行”未执行）
  - 本次验收：最终 Server/Worker/Messaging 整包及跨阶段测试已通过；保留真实 Bot 和远端回放门槛，不再把本地路由装配列为缺口。见[逐项记录第 2 节](docs/20261117-逐项任务验收记录.md#2-九项逐项判定)。
  - 最终本机检查点（2026-11-17，task-30）：Computer 1360/0/68、Messaging 857/0/0（生产冻结 `5e2ce81d8`）；Server 1535/0/11、Worker 236/0/3（纯测试后继 `727d410f2`，生产相同）；另九项专库恢复及六 CLI 40 checks 通过。此前本块 wave1 canonical/dual-flag 计数均保留为历史，不与当前结果混并。真实环境门槛不据此放行，见[最终本机结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)。
  - 实现提交：`767663a96`（独立 contracts）、`ce875ef7f`、`aaed9e362`、`4754659cc`、`9ddfd10b1`、`5681c940c`、`5cc33fba0`
  - 修改文件：`packages/contracts/src/service-protocol.ts`；`packages/messaging/src/outcome-threads.ts`；`apps/server/src/services/outcome-service.ts`、`run-service.ts`；`apps/computer/src/main.ts`、`runtime.ts`、`runtime/tools.ts`；对应路径、服务、shell 停止测试。
  - 数据库变化：none；复用现有 IdempotencyRecord 保存容量等待意图，不建新队列。
  - 验证命令：证据文档命令 A、B；五包 typecheck。
  - 验证结果：服务幂等、容量 2、下一项启动、精确停止及旧 computer 404 定向通过；真实 Task 重绑定竞争 4 项修复前失败/修复后通过；完成根直接 Stop 的 shell 回调、无根意图取消、兄弟项隔离和 6 层历史后代通过。集成负责人报告 `af0c38d88` 本地 routes/revision 11 PASS（含真实 runs/transcript handler），真实 Bot/远端/live API PENDING。
  - 证据文件：[`docs/20261117-子线程运行时验证.md`](docs/20261117-子线程运行时验证.md)
  - 已知限制：旧 computer 404 为可重试不完整取消，绝不改用全 Bot 停止；runs 路由和 app-service 装配归线 2，集成证据按来源标注；远端未重建。
  - 回滚方式：先撤销服务/worker/computer 接入，再撤销 messaging 和 contracts 路径；旧停止路径不变。
  - 这一步到底做什么：从批准 revision 创建 1 个 Agent WorkItem，在同一事务内通过 `enqueueWake` 入队子线程根 Run；超出并发上限时保持 `queued`。
  - 先依赖什么：2.2、3.1
  - 开始前先看：design §12.2、§19.4、§22
  - 主要改哪里：`apps/server/src/services/outcome-service.ts`、`packages/messaging/src/outcome-threads.ts`（新增）、`apps/server/src/routes/outcome.ts`
  - 这一步先不做什么：不调用 `acceptDirectUserMessage`；不在主对话中写可见消息。
  - 怎么算完成：返回 `workItems`（含 `rootRunId`）；重复请求不产生第二个 Run；Bot 不可运行时 WorkItem 为 `retry_pending` 或 `failed`。
  - 怎么验证：`bun test apps/server/test/outcome-runs.test.ts`、真实开发 Bot 一次运行
  - 对应需求：需求 3、需求 8、需求 19
  - 对应设计：§12.2、§19.4、§22

- [x] 3.3 注入 Outcome 执行上下文
  - 状态：DONE
  - 最终本机检查点（2026-11-17，task-30）：Computer 1360/0/68、Messaging 857/0/0（生产冻结 `5e2ce81d8`）；Server 1535/0/11、Worker 236/0/3（纯测试后继 `727d410f2`，生产相同）；另九项专库恢复及六 CLI 40 checks 通过。此前本块 wave1 canonical/dual-flag 计数均保留为历史，不与当前结果混并。真实环境门槛不据此放行，见[最终本机结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)。
  - 实现提交：`ce875ef7f`、`4754659cc`、`e74706d97`
  - 修改文件：`packages/messaging/src/index.ts`、`outcome-threads.ts`；`test/outcome-context.test.ts`、`test/outcome-threads.integration.test.ts`、prompt fixture。
  - 数据库变化：none
  - 验证命令：证据文档命令 A；`bun test ./packages/messaging/test/outcome-context.test.ts`
  - 验证结果：普通/Routine prompt 与精确基线 `5070c6bc9` 快照一致；Outcome 隐藏上下文和输出目录要求通过；新未批准 revision 不替换旧已批准执行快照。
  - 证据文件：[`docs/20261117-子线程运行时验证.md`](docs/20261117-子线程运行时验证.md)
  - 已知限制：真实 Bot 回放另记 PENDING；以下第 1 波失败为历史观测，当前本机结果见最终检查点。
  - 回滚方式：撤销对应 prompt/context 与快照提交。
  - 这一步到底做什么：`platformPrompt` 根据 `outcomeWorkItemId` 读取 WorkItem 和批准 revision，作为隐藏上下文注入；执行说明要求输出写入 `outcomes/<outcomeId>/<workItemId>/`。
  - 先依赖什么：3.1
  - 开始前先看：design §23
  - 主要改哪里：`packages/messaging/src/index.ts`
  - 这一步先不做什么：不改变普通 Run prompt；不使用 `taskConfiguration`。
  - 怎么算完成：Outcome 子线程能看到目标、验收、边界和输出要求；普通 Run 请求快照不变。
  - 怎么验证：Outcome/普通 Run 对比 prompt snapshot（`bun test packages/messaging/test/outcome-context.test.ts`）
  - 对应需求：需求 3、需求 8、需求 11
  - 对应设计：§23

- [x] 3.4 实现运行组结算和 Output 记录
  - 状态：DONE（2026-11-17，本地运行组结算、等待状态、Output 和 Routine 回归满足本任务原完成/验证标准；真实环境依赖仍未关闭）
  - 本次验收：最终 Messaging 857 PASS / 0 FAIL（含 14 项 Outcome 运行组场景及既有 Routine），Worker 236 PASS / 0 FAIL / 3 SKIP（含 5 项 Outcome 领取/隔离）；子 Agent/后台 shell、waiting 状态、最终 Output 和 review_pending 均有实际断言。3.1/3.2 的代码/接口依赖已交付，正式真实 Bot 门槛仍 BLOCKED；不推导远端或发布通过。见[逐项记录](docs/20261117-逐项任务验收记录.md)。
  - 最终本机检查点（2026-11-17，task-30）：Computer 1360/0/68、Messaging 857/0/0（生产冻结 `5e2ce81d8`）；Server 1535/0/11、Worker 236/0/3（纯测试后继 `727d410f2`，生产相同）；另九项专库恢复及六 CLI 40 checks 通过。此前本块 wave1 canonical/dual-flag 计数均保留为历史，不与当前结果混并。真实环境门槛不据此放行，见[最终本机结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)。
  - 实现提交：`ce875ef7f`、`aaed9e362`、`e74706d97`
  - 修改文件：`packages/messaging/src/automation-results.ts`、`outcome-threads.ts`、`index.ts`、`request-progress.ts`；`apps/worker/src/worker.ts`；messaging、worker、真实 Task 集成测试及并发 barrier fixture。
  - 数据库变化：none
  - 验证命令：证据文档命令 A、C、D、E、F。
  - 验证结果：确定性 shell/子 Agent 回调竞争、幂等 Output/事件、等待状态保留、失败映射、执行顺序反转、100 旧等待项不饥饿、两参数事实结算后周期补齐全部通过；canonical 和双 flag 失败与基线一致。
  - 证据文件：[`docs/20261117-子线程运行时验证.md`](docs/20261117-子线程运行时验证.md)
  - 已知限制：两参数结算只处理持久化事实；生产 worker 三个入口均显式注入 runtime，文件扫描/下一项派发由 runtime 或周期恢复完成；不把 Output 自动验收为 PASS。
  - 回滚方式：先撤销 worker 接入再撤销 messaging 实现；保留既有事实表和第 0 波状态接口。
  - 这一步到底做什么：从 `automation-results.ts` 抽出运行组判断；`settleOutcomeWorkItem` 在 Worker 回合结束处调用，更新 WorkItem 状态、写 Output、重新计算 Outcome，并调度下一个 `queued` WorkItem。
  - 先依赖什么：3.1、3.2
  - 开始前先看：design §12.4、§24；父 design §42.2
  - 主要改哪里：`packages/messaging/src/automation-results.ts`、`packages/messaging/src/outcome-threads.ts`、`apps/worker/src/worker.ts`
  - 这一步先不做什么：不把 Output 自动标为 PASS；不改变 Routine 的结算结果。
  - 怎么算完成：子 Agent 或后台 shell 未结束时 WorkItem 保持 `running`；`waiting_decision`、`waiting_human` 不被覆盖；完成后 Outcome 进入 `review_pending`。
  - 怎么验证：`bun test apps/worker/test/outcome-thread.integration.test.ts`（多回合、子 Agent、失败、中断）；现有 Routine 测试全部通过
  - 对应需求：需求 4、需求 13、需求 19
  - 对应设计：§12.4、§24

- [x] 3.5 实现子线程只读记录接口
  - 状态：DONE（本地服务和 HTTP handler 验证完成；真实远端/live API 回放另记 PENDING）
  - 最终本机检查点（2026-11-17，task-30）：Computer 1360/0/68、Messaging 857/0/0（生产冻结 `5e2ce81d8`）；Server 1535/0/11、Worker 236/0/3（纯测试后继 `727d410f2`，生产相同）；另九项专库恢复及六 CLI 40 checks 通过。此前本块 wave1 canonical/dual-flag 计数均保留为历史，不与当前结果混并。真实环境门槛不据此放行，见[最终本机结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)。
  - 实现提交：`ce875ef7f`、`4754659cc`；路由装配由线 2/集成负责人交付，集成验证点 `af0c38d88`、`cb0f8af46`。
  - 修改文件：`packages/messaging/src/outcome-transcript.ts`、`index.ts`；`apps/server/src/services/outcome-service.ts`、`test/outcome-runs.test.ts`。
  - 数据库变化：none
  - 验证命令：证据文档命令 A；`bun test ./apps/server/test/outcome-runs.test.ts`；集成负责人执行 `OUTCOMEGO_TEST_DATABASE_URL=<55438 一次性库> bun test apps/server/test/outcome-routes.test.ts apps/server/test/outcome-revision-transaction.test.ts`。
  - 验证结果：持久化运行组摘要、分页、内部字段/推理过滤及关联验证定向通过；集成负责人报告 routes/revision 11 PASS / 0 FAIL / 51 assertions，其中 routes 6 PASS 覆盖实际 OutcomeService/messaging 的 runs/transcript Request handler，未启动 HTTP server。
  - 证据文件：[`docs/20261117-子线程运行时验证.md`](docs/20261117-子线程运行时验证.md)
  - 已知限制：线 1 不修改 `routes/outcome.ts`；集成验证是负责人提供的证据，不冒充本线独立重跑；真实远端/live API 回放 PENDING，不宣称 CI 全绿。
  - 回滚方式：撤销 transcript 服务和投影；不删除持久化消息。
  - 先依赖什么：3.4
  - 主要改哪里：`apps/server/src/routes/outcome.ts`、复用现有 transcript 读取
  - 这一步先不做什么：不提供在子线程中发消息的入口。
  - 怎么算完成：`GET /work-items/:id/transcript` 返回运行组消息摘要。
  - 怎么验证：`bun test apps/server/test/outcome-routes.test.ts`
  - 对应需求：需求 13
  - 对应设计：§19.9

## 阶段 4：Evidence、验收和返工

- [x] 4.1 实现 Evidence 写入和可信度
  - 状态：DONE（第 1 波本地实现；外部/跨线检查的 PENDING 见下）
  - 实现提交：a909e2d43、d24547414、eea0c0b87、a9a74fbb1（依赖 integrator 8c900af7c、7cf64f503）
  - 修改文件：`apps/server/src/services/outcome-review-service.ts`、`outcome-evidence-consumer.ts`、`outcome-write.ts`、`app-service.ts`、对应测试及 `test/outcome-event-retention.test.ts`
  - 数据库变化：none（仅一次性测试库部署既有 schema）
  - 验证命令：`bun test apps/server/test/outcome-review-service.test.ts apps/server/test/outcome-evidence-consumer.test.ts apps/server/test/outcome-event-retention.test.ts`；server typecheck；完整最终七文件命令见证据
  - 验证结果：真实 Prisma fixture、来源/可信度/去重/积压/重启/停止/晚提交低 sequence/调用期间 revision 变更 PASS；真实 100000 事件清理→handler 失败无回执→再次清理保留→重试产生 Evidence→清理移除 PASS；最终本线服务端 48 PASS / 0 FAIL、212 断言
  - 证据文件：[第 1 波线 2 验证记录](docs/20261117-第1波产品功能验证.md)
  - 已知限制：选择 Server 持久 Event 订阅，冻结接口文档已补充；SnapshotService 和共享 SQL 由 integrator 独占，本线仅消费其已接纳提交；不在 Worker 中引用 Server
  - 回滚方式：按本线提交逆序 revert，保留其他线改动。
  - 先依赖什么：1.3 + 测试数据（可用 fixture 创建 Output，不再等待 3.4）。
  - 主要改哪里：`apps/server/src/services/outcome-review-service.ts`（新增）、asset 引用适配
  - 这一步先不做什么：不把大文件直接存进 JSON 字段。
  - 怎么算完成：Evidence 记录来源、时间、主体、revision、criterion 和 credibility；Output 自动生成 `agent_report` 候选。
  - 怎么验证：`bun test apps/server/test/outcome-review-service.test.ts`
  - 对应需求：需求 4、需求 9、需求 13、需求 18
  - 对应设计：§9.3、§24

- [x] 4.2 实现逐项 Review 和 Accepted 计算
  - 状态：DONE（第 1 波本地实现；外部/跨线检查的 PENDING 见下）
  - 实现提交：a909e2d43、d24547414、eea0c0b87
  - 修改文件：`outcome-review-service.ts`、`outcome-write.ts`、`routes/outcome.ts`、对应测试
  - 数据库变化：none（仅一次性测试库部署既有 schema）
  - 验证命令：`bun test apps/server/test/outcome-review-service.test.ts apps/server/test/outcome-routes.test.ts`；server typecheck
  - 验证结果：必需/可选/缺证据/FAIL/UNVERIFIED/批准变更豁免/重复文字拒绝/并发/幂等/人工条款 PASS
  - 证据文件：[第 1 波线 2 验证记录](docs/20261117-第1波产品功能验证.md)
  - 已知限制：唯一入口 `/reviews`；独立 open/presented Decision 与 HumanAction 阻断依赖 integrator d5008544b（其组合测试结果见证据，本线未重复 guard）；人工接受后同子线程续跑属于线 4 第 2 波；不扩大豁免能力
  - 回滚方式：按本线提交逆序 revert，保留其他线改动。
  - 先依赖什么：4.1
  - 主要改哪里：`outcome-review-service.ts`、`POST /reviews` 路由
  - 这一步先不做什么：不使用模型结论替代 Review。
  - 怎么算完成：PASS/FAIL/UNVERIFIED/WAIVED 路径都有结果；必需条款 PASS 至少有一条非 `agent_report`、非 `ai_prereview` 的 Evidence 或用户确认。
  - 怎么验证：`bun test apps/server/test/outcome-review-service.test.ts`（必需、可选、缺证据、失败、豁免、重复）
  - 对应需求：需求 5、需求 9、需求 18
  - 对应设计：§7、§19.7、§25

- [x] 4.3 实现返工
  - 状态：DONE（第 1 波本地实现；外部/跨线检查的 PENDING 见下）
  - 实现提交：a909e2d43、d24547414、eea0c0b87
  - 修改文件：`outcome-review-service.ts`、`routes/outcome.ts`、`test/outcome-review-service.test.ts`
  - 数据库变化：none（仅一次性测试库部署既有 schema）
  - 验证命令：`bun test apps/server/test/outcome-review-service.test.ts`；server typecheck
  - 验证结果：FAIL/UNVERIFIED 返工、PASS 拒绝、原任务关联/旧 Review 保留、重复提交、事务调用冻结 fake PASS
  - 证据文件：[第 1 波线 2 验证记录](docs/20261117-第1波产品功能验证.md)
  - 已知限制：本线真实 enqueueOutcomeTurn、容量/根 Run 回放 PENDING；集成分支运行时已装配，其组合检查另行记录，未把 fake 当真实成功
  - 回滚方式：按本线提交逆序 revert，保留其他线改动。
  - 先依赖什么：4.2、3.2
  - 主要改哪里：`POST /rework` 路由、`outcome-service.ts`
  - 这一步先不做什么：不实现自动重试循环。
  - 怎么算完成：FAIL/UNVERIFIED 条款可以返工；返工 WorkItem 在新子线程中执行并关联原 WorkItem；非 FAIL 条款返回 `rework_not_allowed`。
  - 怎么验证：`rework-after-fail` fixture 测试
  - 对应需求：需求 16
  - 对应设计：§32

- [x] 4.4 实现 AI 预审建议
  - 状态：DONE（第 1 波本地实现；外部/跨线检查的 PENDING 见下）
  - 实现提交：a909e2d43、d24547414、eea0c0b87
  - 修改文件：`outcome-review-service.ts`、`outcome-inference.ts`、`outcome-evidence-consumer.ts`、对应测试
  - 数据库变化：none（仅一次性测试库部署既有 schema）
  - 验证命令：`bun test apps/server/test/outcome-review-service.test.ts apps/server/test/outcome-evidence-consumer.test.ts`；server typecheck
  - 验证结果：独立模型 fixture、按条款保存 ai_prereview、去重、失败不阻塞、不可独立支撑 PASS、旧 revision 保留 PASS
  - 证据文件：[第 1 波线 2 验证记录](docs/20261117-第1波产品功能验证.md)
  - 已知限制：真实 computer 预审 PENDING；不写入 Review，不自动接受
  - 回滚方式：按本线提交逆序 revert，保留其他线改动。
  - 先依赖什么：4.1、2.1
  - 主要改哪里：`outcome-review-service.ts`
  - 这一步先不做什么：不让预审结果写入 Review。
  - 怎么算完成：WorkItem 完成后生成 `ai_prereview` Evidence；预审失败不阻塞 Review。
  - 怎么验证：`ai-prereview` fixture 和失败注入测试
  - 对应需求：需求 17、需求 18
  - 对应设计：§33

- [x] 4.5 实现 Desktop Outcome 详情和验收页面
  - 状态：DONE（第 1 波本地实现；外部/跨线检查的 PENDING 见下）
  - 实现提交：b7f6aba7e
  - 修改文件：Desktop `outcomes/detail/`、`client/outcome-api.ts`、`test/outcome-detail.test.ts`
  - 数据库变化：none（仅一次性测试库部署既有 schema）
  - 验证命令：`bun --filter @outcomego/desktop typecheck`；`bun test apps/desktop/test/outcome-detail.test.ts`
  - 验证结果：详情组件/可信度/来源/最新服务端 Review 状态/终态禁用/只读 transcript 入口静态验证 PASS
  - 证据文件：[第 1 波线 2 验证记录](docs/20261117-第1波产品功能验证.md)
  - 已知限制：真实 transcript 与交互视觉回放 PENDING；刷新清除旧本地判定，原 Review 历史保留
  - 回滚方式：按本线提交逆序 revert，保留其他线改动。
  - 先依赖什么：4.2、4.3、3.5
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/`（OutcomeDetail、ReviewPanel）
  - 这一步先不做什么：不默认展示子线程完整记录。
  - 怎么算完成：显示 revision、WorkItem、Output、Evidence（带可信度标签）、逐条验收、返工；刷新以服务端为准。
  - 怎么验证：`bun --filter @outcomego/desktop typecheck`、组件测试
  - 对应需求：需求 5、需求 13、需求 16、需求 18
  - 对应设计：§26

## 阶段 5：Contract 变更、回归和失败路径

- [x] 5.1 实现 Contract 变更追溯和未开始 WorkItem 处理
  - 状态：DONE（2026-11-17，原待执行六项数据库回归已在最终 Server 整包实际通过；追溯、只取消未开始项和旧快照保留满足标准）
  - 本次验收：最终 Server 日志中 outcome-revision-successor.test.ts 五项、outcome-revision-read.test.ts 一项全部 PASS；Desktop 来源/历史 2 项及 route/client 2 项早期 PASS 保留执行归属。真实环境回放仍 PENDING。见[逐项记录第 3 节](docs/20261117-逐项任务验收记录.md#3-本地完成项的行为证据)。
  - 实现提交：`cf96b8e17`（可选 DTO）、`fb8b5aa60`（事务规则与回归）、`ed4373ad8`（Desktop）、`82651fb83`（批准生命周期 hook）、`a7b3067e0`（真实历史只读）。
  - 修改文件：`packages/contracts/src/outcomes.ts`；`apps/server/src/services/outcome-service.ts`、`test/outcome-revision-successor.test.ts`；Desktop `outcomes/detail/outcome-detail.tsx`、`revision-history.tsx`、`outcomes/planning/contract-confirmation.tsx`、`test/outcome-revision-history.test.ts`；冻结接口 §11。
  - 数据库变化：none，复用既有 base/sourceDecision/createdBy/startedAt 字段。
  - 验证命令：`bun test apps/desktop/test/outcome-revision-history.test.ts`；仅对服务/新数据库测试执行 Bun Transpiler 语法检查；数据库组合命令见证据。
  - 验证结果：Desktop 2 PASS / 0 FAIL、14 断言；历史 route/client 2 PASS / 0 FAIL、4 断言；server 编译 PASS；当时新增的 5 个批准/来源数据库回归及 1 个历史读数据库回归未执行；该历史 PENDING 已由最终 Server 整包六项 PASS 关闭。
  - 证据文件：[`docs/20261117-第2波产品追溯验证.md`](docs/20261117-第2波产品追溯验证.md)。
  - 已知限制：Recovery 所有者处理已取消项的待执行 Run/Inbox/容量意图，不在批准路径增加物理停止；已开始旧任务保留原执行快照；live API/远端/浏览器回放未执行。
  - 回滚方式：仅撤销本线新提交，保留已有运行时与其他线改动；可选字段可被旧客户端忽略。
  - 先依赖什么：1.3、3.2、4.2
  - 主要改哪里：`outcome-service.ts`
  - 这一步先不做什么：不改写已完成 Output、Evidence 和旧 revision 的 Review。
  - 怎么算完成：新 revision 可反查旧 revision、来源 Decision/用户操作和变更摘要；未开始的旧 revision WorkItem 置为 `cancelled`。
  - 怎么验证：scope/acceptance/boundary change fixture
  - 对应需求：需求 7、需求 12、需求 13
  - 对应设计：§17、§18、§22

- [x] 5.2 普通聊天和主对话隔离回归
  - 状态：DONE（2026-11-17，最终本地完整包回归与主对话隔离证据通过；外部环境及包内跳过项保持单列）
  - 本次验收：最终 Worker 236/0/3、Messaging 857/0/0、Server 1535/0/11，Computer 1360/0/68；普通聊天/Tool/Memory/取消/可见消息/通知/Routine 及无 Outcome 事实的 canary 均有通过记录。九项 startup/dispatch 独立专库另行通过，不改包内 SKIP。见[逐项记录](docs/20261117-逐项任务验收记录.md)。
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 第 3 波验证命令：`bun test ./scripts/check-outcome-contracts.test.ts ./scripts/outcome-recovery/report.test.ts ./scripts/check/test-database-gates.test.ts`；`bun scripts/check/outcome-regression-types.ts`；`bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan`；`git diff --check`。
  - 第 3 波验证结果：13 PASS / 0 FAIL / 62 assertions；14 个本线文件语义诊断 0、依赖诊断 0；51 个旧测试文件语法通过；当时 11+6 个新 DB 测试、六场景 JSON/DB 对账及备份回退均 PENDING（历史阶段结果）；当前完整包、六 CLI 和同版本有数据备份/恢复已执行，详见本次验收。旧镜像回退仍未执行。
  - 第 3 波证据文件：[第3波回归脚手架交接](../004-OutcomeGo整体项目/docs/20261117-第3波回归脚手架交接.md)；同目录组合验证手册/合同矩阵/数据库入口补齐记录；`004.5/docs/final-replay.md` 和 `release-decision.md`。
  - 第 3 波已知限制：当时 canonical 入口补齐后的完整失败数未知、数据库失败阻塞（历史观测）；现最终各包结果已明确，历史 canonical/dual-flag 和修复前失败仍保留；远端 CI/Computer/真实模型、安装与旧镜像未验，不宣称 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 先依赖什么：3.3、3.4、4.2
  - 主要改哪里：现有 channel、worker、messaging 测试和新增断言
  - 这一步先不做什么：不通过修改普通消息 fixture 适配新逻辑。
  - 怎么算完成：普通消息、Tool、Memory、Run cancel、可见消息、通知和 Routine 行为不变；没有 Outcome context 的 Run 不产生 Outcome 事实；主对话与子线程互不打断。
  - 怎么验证：`bun --filter @outcomego/worker test`、`bun --filter @outcomego/messaging test`、`bun --filter @outcomego/server test`
  - 对应需求：需求 11、需求 19
  - 对应设计：§12.5、§23

- [x] 5.3 受控失败回放
  - 状态：DONE（2026-11-17，需求 14 的本地受控失败与幂等/回滚断言、六场景实际 CLI/JSON 对账均通过）
  - 本次验收：最终 Server 的跨阶段 11 项、Review 16 项及规划失败测试通过；六个 CLI 场景实际 40/40 checks PASS。restart 是本地 executor 137/SIGKILL，unknown 是虚构持久适配器；均不冒充远端 Computer 或真实 provider。见[逐项记录](docs/20261117-逐项任务验收记录.md)。
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 第 3 波验证命令：`bun test ./scripts/check-outcome-contracts.test.ts ./scripts/outcome-recovery/report.test.ts ./scripts/check/test-database-gates.test.ts`；`bun scripts/check/outcome-regression-types.ts`；`bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan`；`git diff --check`。
  - 第 3 波验证结果：13 PASS / 0 FAIL / 62 assertions；14 个本线文件语义诊断 0、依赖诊断 0；51 个旧测试文件语法通过；当时 11+6 个新 DB 测试、六场景 JSON/DB 对账及备份回退均 PENDING（历史阶段结果）；当前完整包、六 CLI 和同版本有数据备份/恢复已执行，详见本次验收。旧镜像回退仍未执行。
  - 第 3 波证据文件：[第3波回归脚手架交接](../004-OutcomeGo整体项目/docs/20261117-第3波回归脚手架交接.md)；同目录组合验证手册/合同矩阵/数据库入口补齐记录；`004.5/docs/final-replay.md` 和 `release-decision.md`。
  - 第 3 波已知限制：当时 canonical 入口补齐后的完整失败数未知、数据库失败阻塞（历史观测）；现最终各包结果已明确，历史 canonical/dual-flag 和修复前失败仍保留；远端 CI/Computer/真实模型、安装与旧镜像未验，不宣称 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 先依赖什么：2.1、3.4、4.2
  - 主要改哪里：失败 fixture、`docs/acceptance-replay.md`
  - 这一步先不做什么：不在失败回放中补临时代码路径；不直接删除半对象作为修复。
  - 怎么算完成：规划失败、事务失败、Bot 不可运行、子线程失败/中断、Evidence 失败、Review 重复五类都能重现和解释。
  - 怎么验证：按需求 14 逐项执行
  - 对应需求：需求 14
  - 对应设计：§20、§29

## 阶段 6：移动端只读

- [x] 6.1 Android Outcome 列表和只读详情
  - 状态：DONE（实现交付；外部验收仍为 PENDING）
  - 先依赖什么：2.2、4.2
  - 主要改哪里：`mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/Models.kt`、`Transport.kt`、`apps/android/app/src/main/kotlin/com/outcomego/features/`
  - 这一步先不做什么：不提供规划、批准、验收和返工入口。
  - 怎么算完成：列表和详情可读；Desktop 专属操作显示“请在 Desktop 完成”；旧服务端隐藏入口。
  - 怎么验证：`bash scripts/android/package-debug.sh`；KMP 共享测试
  - 对应需求：需求 20
  - 对应设计：§14
  - 实现提交：`7a8803bd7`（移动端）；`40e2b41f2`（Android 可选测试包装入口）。
  - 数据库变化：none。
  - 证据文件：[`docs/20261117-移动端Outcome只读验证.md`](docs/20261117-移动端Outcome只读验证.md)。
  - 修改文件：`mobile/shared/.../core/Outcomes.kt`、`commonTest/.../OutcomeReadTests.kt`；Android `AppViewModel.kt`、`OutcomeGoApp.kt`、`DirectoryScreen.kt`；`features/FeatureContracts.kt`、`LiveFeatureGateway.kt`、`OutcomeScreens.kt`；`OutcomeGatewayTest.kt`；`scripts/android/package-debug.sh`。
  - 验证命令：`bash scripts/android/package-debug.sh --test`；`shasum -a 256 apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`。
  - 验证结果：PASS，共享核心 37 项、Android 单测 84 项，失败/错误/跳过为 0；打包成功。最终 APK 绝对路径及 SHA-256 见证据文件。
  - 已知限制：设备安装/启动与真实 API + PostgreSQL 联调均 PENDING；不把未执行的设备/数据库检查记为通过，第 0 波数据库阻塞保留。
  - 回滚方式：由负责人撤销上述实现提交；无数据库回滚。

- [x] 6.2 iOS Outcome 列表和只读详情
  - 状态：DONE（实现交付；外部验收仍为 PENDING）
  - 先依赖什么：2.2、4.2
  - 主要改哪里：`apps/ios/Sources/Core/API.swift`、`Models.swift`、`apps/ios/Sources/App/`
  - 这一步先不做什么：不提供规划、批准、验收和返工入口。
  - 怎么算完成：同 6.1。
  - 怎么验证：iOS Core 测试和 native config 检查；设备不可用时记录 PENDING
  - 对应需求：需求 20
  - 对应设计：§14
  - 实现提交：`7a8803bd7`（移动端）；`40e2b41f2`（Android 可选测试包装入口）。
  - 数据库变化：none。
  - 证据文件：[`docs/20261117-移动端Outcome只读验证.md`](docs/20261117-移动端Outcome只读验证.md)。
  - 修改文件：`Sources/Core/API.swift`、`Models.swift`；`Sources/App/AppStore.swift`、`HomeView.swift`、`OutcomesView.swift`；`Sources/Localizable.xcstrings`；`Tests/CoreTests/OutcomeReadTests.swift`、`Fixtures/outcome-detail.json`。
  - 验证命令：`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --package-path apps/ios -j 4`；隔离 harness 定向及可编译测试；`python3 apps/ios/scripts/check-native-config.py`；新增视图模拟器目标类型检查和修改文件语法检查。完整命令及 harness 重建方式见证据文件。
  - 验证结果：Outcome 4 项和既有传输 15 项 PASS；原生配置与定向类型/语法检查 PASS。原始全量 Core suite BLOCKED（10 个既有旧模块导入）；可编译测试执行 243 项，242 项通过，1 项既有 provider catalog 测试产生 2 个断言失败，创建基线同样复现。
  - 已知限制：完整 App 模拟器编译因固定依赖获取停滞而安全停止，PENDING；真机/模拟器运行、真实 HTTP + PostgreSQL 联调 PENDING。没有声明全量 iOS 测试或数据库门槛为绿。
  - 回滚方式：由负责人撤销上述实现提交；无数据库回滚。

## 阶段 7：交付检查

- [ ] 7.1 完成研究试点端到端回放
  - 状态：BLOCKED（缺少 research-pilot.json 的真实开发 Bot 端到端执行及第 5 步主对话并行回放）
  - 本次验收：固定 fixture 与本地测试齐备，但 acceptance-replay.md 中真实运行的 Run ID、租约、规划/模型及验收记录尚缺；局部 DB/CLI 不替代研究试点。见[逐项记录](docs/20261117-逐项任务验收记录.md)。
  - 先依赖什么：4.5、5.2
  - 主要改哪里：`docs/acceptance-replay.md`
  - 这一步先不做什么：不使用生产系统写入、付款或真实客户资料。
  - 怎么算完成：按 `research-pilot.json` 执行一次真实子线程运行，包括第 5 步主对话不被打断，所有 ID 可追踪。
  - 怎么验证：回放记录
  - 对应需求：需求 10、需求 19
  - 对应设计：§15

- [ ] 7.2 生成主链路对账报告
  - 状态：BLOCKED（本地对账报告已补充；前置 7.1 的真实试点及其同一 Outcome 全链路记录尚缺）
  - 本次验收：[逐项记录第 4 节](docs/20261117-逐项任务验收记录.md#4-主链路本地归档对账任务-72-部分交付)保存已核验 dump 的两条独立 Outcome ID 链；一条有 Output/Review 且 Evidence 为空（用户确认），另一条有 Evidence/Review 且 Output 为空（执行续跑）。不跨 Outcome 拼接，不将真实试点依赖标为完成。
  - 先依赖什么：7.1、5.1、5.3
  - 主要改哪里：`docs/acceptance-replay.md`
  - 怎么算完成：一个 Outcome 可以反查每个核心 ID、状态转换、Run、Output、Evidence 和 Review。
  - 怎么验证：查询脚本和 API 快照
  - 对应需求：需求 8、需求 9、需求 13
  - 对应设计：§14、§24、§27

- [ ] 7.3 Spec 最终检查点
  - 状态：BLOCKED（需求 1–20 和父 design §34 八问已回写；前置 7.2 与真实环境最终证据仍未满足）
  - 本次验收：[逐项记录第 5、6 节](docs/20261117-逐项任务验收记录.md#5-需求-120-回写任务-73-部分交付)提供需求对照、回归/失败/限制及八问；本次报告交付完成不等于 Spec 最终退出。保留 6.1/6.2 的设备/live API/完整 iOS 限制，不改其他所有者任务块。
  - 先依赖什么：6.1、6.2、7.2
  - 怎么算完成：需求 1–20、普通聊天回归、主对话隔离、Contract 变更、失败证据和已知限制全部回写；按父 design §34 回答八个问题。
  - 怎么验证：requirements/design/tasks 三向核对
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 8：普通对话目标管理（2026-11-18 补充）

- [x] 8.1 实现普通主 Bot 的 Outcome 和 Explore 工具
  - 状态：DONE（2026-11-18，本地实现、实际独立 PostgreSQL 服务回放及工具目录/合同回归通过；用户另行授权后已部署 debug Computer，新消息实测单列）
  - 先依赖什么：既有 Planning、Outcome、Explore、Inbox 服务的实现
  - 主要改哪里：新增共享 `outcome-chat.ts` 合同和服务适配器；现有 Computer 动态工具目录、InternalToolService、AppService、平台提示；列表可选文字搜索。
  - 这一步先不做什么：不让 Bot 代替用户批准或最终验收，不新建 Runtime/schema/权限引擎，不部署远端 Computer。
  - 怎么算完成：设计 §35 全部工具可在普通对话发现并调用真实服务；返回实际 ID/状态/应用链接；写入沿用幂等和 revision 检查；子 Agent/后台无管理入口。
  - 怎么验证：共享合同测试、Computer 工具目录测试、服务端实际 PostgreSQL 集成测试及受影响包类型检查。
  - 对应需求：需求 21、需求 7、需求 11、需求 12、需求 19
  - 对应设计：§35、§19、§22

- [x] 8.2 回归与交付说明
  - 状态：DONE（2026-11-18，本地测试/类型检查通过，独立数据库清理完成；授权 debug 重建、健康/连通性及 bundle 检查通过，不冒充真实模型会话）
  - 证据：[对话目标工具开发与验证](docs/20261118-对话目标工具开发与验证.md)，包括实际命令、测试归属、清理和远端部署限制。
  - 先依赖什么：8.1
  - 主要改哪里：新增对话工具集成测试和带日期的中文交付记录。
  - 怎么算完成：记录“聊天描述→三维建议→待批准 Outcome→既有用户批准→启动→读取事实”的真实服务回放；验证 Explore、取消、重试、过期编辑和主线程/后台兼容；明确远端尚未同步/重建及实际测试结果。
  - 怎么验证：受影响合同/Computer/server 测试与类型检查、Spec 结构检查、局部差异检查。
  - 对应需求：需求 21、需求 11
  - 对应设计：§35.3


## 阶段 9：对话阶段卡片与渐进披露

- [x] 9.1 原生卡片与分层详情
  - 状态：DONE（2026-11-18，受影响测试、类型检查与既有 Desktop 调试窗口检查通过；真实新 Bot 会话单列）
  - 先依赖什么：8.1、现有 Desktop 详情与富消息组件
  - 主要改哪里：对话工具卡片发布、Desktop 富消息及 Outcome 详情
  - 怎么算完成：真实分析/生成/草稿/执行/结果卡片及阶段动画；概览默认紧凑，契约审阅和技术记录按需展开，批准与历史回执语义不变。
  - 怎么验证：服务器持久化测试、Desktop 挂载/渲染测试及类型检查
  - 对应需求：需求 22
  - 对应设计：§36

- [x] 9.2 受影响回归与交付记录
  - 状态：DONE（2026-11-18，受影响测试、类型检查与既有 Desktop 调试窗口检查通过；真实新 Bot 会话单列）
  - 先依赖什么：9.1
  - 怎么算完成：实际执行受影响测试，记录动态效果、渐进披露及调试可用范围，不冒充真实 Bot/远端部署验证。
  - 怎么验证：局部回归、差异检查、已有调试窗口可视检查
  - 对应需求：需求 22
  - 对应设计：§36

- 阶段 9 验证证据：[对话目标卡片与渐进披露开发验证](docs/20261118-对话目标卡片与渐进披露开发验证.md)。


## 阶段 10：决策优先的语义渐进披露修正

- [x] 10.1 实现带来源引用、无 schema 变更的只读语义摘要与共享三层总览；实际待办优先，前提未知不伪造满足，无风险不显示。
  - 对应需求：23；设计：§37；验证：摘要解析/缓存/失败及挂载交互、真实 Inbox 路由、旧版本响应丢弃。
- [x] 10.2 完成受影响类型/测试和现有调试桌面只读视觉检查，记录与初版的差异及验证边界。
  - 对应需求：23；设计：§37；验证：原批准/历史验收回归、简洁默认视图、三级展开、无生产数据写入。

阶段 10 完成证据：[决策优先目标总览与三级披露验证](docs/20261118-决策优先目标总览与三级披露验证.md)。Desktop 811 PASS / 0 FAIL / 1 既有 DB-gated SKIP；服务端只读摘要及路由 8 PASS；两端完整类型与 29 回归目标通过。现有调试桌面只读核验完成，未批准或修改用户目标。


## 阶段 11：审批选项与行内资料修正

- [x] 11.1 实现简明审批选项、自定义修改后待批准版本、Info 浮层和真实状态指示，其他记录显式展开。
  - 对应需求：需求 24
  - 对应设计：§38
  - 怎么验证：挂载交互、批准/稍后/自定义分流、来源浮层和旧版本/幂等回归。
- [x] 11.2 完成受影响测试、类型和现有调试桌面只读视觉检查并记录证据。
  - 对应需求：需求 24
  - 对应设计：§38
  - 怎么验证：Desktop 受影响/完整回归、类型检查、不得改变用户目标。

阶段 11 完成证据：[审批选项与行内来源渐进披露验证](docs/20261118-审批选项与行内来源渐进披露验证.md)。Desktop 完整测试 814 PASS / 0 FAIL / 1 既有数据库门 SKIP；6 个相关文件 45 PASS；完整 Desktop 类型、29 个回归目标与 i18n 检查通过。已有调试桌面确认简洁决策区、三项选择和按选择出现的自定义输入；未提交用户目标操作。


## 阶段 12：首屏直接决策

- [x] 12.1 将带意见的直接审批按钮及真实路线选择嵌入顶部，移除稍后与二次入口，行内详情分段加粗。
  - 对应需求：需求 25
  - 对应设计：§39
  - 怎么验证：直接批准/否定、自定义、最多四项、Inline Info、真实 Decision 请求及版本/幂等回归。
- [x] 12.2 完成相关挂载/状态回归、类型检查及已有调试窗口只读检查，记录执行边界。
  - 对应需求：需求 25
  - 对应设计：§39
  - 怎么验证：Desktop 受影响与完整测试、类型检查、已有用户目标无提交。

阶段 12 完成证据：[首屏直接审批与路线选择验证](docs/20261118-首屏直接审批与路线选择验证.md)。完整 Desktop 819 PASS / 0 FAIL / 1 既有 DB-gated SKIP；8 个相关文件 65 PASS；完整 Desktop 类型、29 个回归目标及 i18n 检查通过。已有调试目标首屏可见意见及两个直接按钮，无“稍后”或二次展开入口；未提交实际目标。


## 阶段 13：目标浮层与紧凑摘要

- [x] 13.1 实现目标浮动模态框、外点关闭、一行自适应意见、修改按钮/唯一 Info 与任务状态计数。
  - 对应需求：需求 26
  - 对应设计：§40
  - 怎么验证：模态打开/外点/Escape/内部跳转、输入样式、方案来源、实际/建议任务计数及旧 revision 排除。
- [x] 13.2 完成相关挂载测试、类型/完整 Desktop 回归和已有调试界面检查，记录验证边界。
  - 对应需求：需求 26
  - 对应设计：§40
  - 怎么验证：受影响测试和实际 Electron 只读检查；不提交真实用户目标。

阶段 13 完成证据：[目标浮层与任务计数验证](docs/20261118-目标浮层与任务计数验证.md)。完整 Desktop 822 PASS / 0 FAIL / 1 既有 DB-gated SKIP；8 个相关文件 68 PASS；完整 Desktop 类型、29 个回归目标及 i18n 检查通过。现有 Electron 确认一行意见、自动增高/清空缩回、外点关闭与原行焦点恢复；未提交实际目标操作。


## 阶段 14：来源滚动与稳定的后台执行观察

- [x] 14.1 修复模态内 Info 来源滚动/Markdown、已证实的刷新闪烁，并提供对话与详情共享的只读执行消息卡。
  - 对应需求：需求 27
  - 对应设计：§41
  - 怎么验证：真实组件挂载、来源容器/排版、异步刷新保留、身份隔离、只读分页/失败/任务切换及展开生命周期。
- [x] 14.2 完成受影响回归与类型检查，并在既有 Electron 做不改变目标的实际检查，记录闪烁原因的证据边界。
  - 对应需求：需求 27
  - 对应设计：§41
  - 怎么验证：相关与完整 Desktop 测试、类型、只读 UI 检查；不向真实 Bot 发送测试任务或批准用户目标。

阶段 14 完成证据：[来源浮层与执行消息观察验证](docs/20261118-来源浮层与执行消息观察验证.md)。Desktop 完整测试 828 PASS / 0 FAIL / 1 既有 DB-gated SKIP；10 个相关文件 83 PASS；完整 Desktop 类型、29 回归目标与 i18n 均通过。既有 Electron 实测来源 Markdown/滚轮及对话和详情中的只读执行消息。已修复可复现头像刷新空白及同目标卡片清空；整窗每 2–3 秒闪烁因当前目标已等待人工，未独立复现，不能声称所有整窗闪烁原因都已排除。


## 阶段 15：侧栏云电脑预览稳定刷新

- [x] 15.1 保留同 Bot 已解码画面，失败时提示重连，解码成功后再替换，继续隔离 Bot 与凭据身份。
  - 对应需求：需求 27 补充
  - 对应设计：§41.1
  - 怎么验证：真实 BotScreen 与共享资源 Hook 挂载，控制下载/解码延迟、HTTP/网络/解码失败及恢复、切换 Bot、401、退出后的迟到响应；默认资源行为不改变。
- [x] 15.2 完成相关/完整 Desktop 测试、完整 Desktop 与独立回归类型检查，记录只读界面检查边界。
  - 对应需求：需求 27 补充
  - 对应设计：§41.1
  - 怎么验证：执行原始日志与源码摘要；不重启服务、不发送真实目标操作、不接管或重建远端 Computer。

阶段 15 完成证据：[侧栏云电脑预览稳定刷新验证](docs/20261118-侧栏云电脑预览稳定刷新验证.md)。新挂载回归 8 PASS / 0 FAIL；五个相关文件 54 PASS；完整 Desktop 836 PASS / 0 FAIL / 1 既有数据库门 SKIP，21147 assertions / 144 files。完整 Desktop 类型及 31 个回归输入检查通过。已验证下载/解码/失败保持与身份隔离，不据此宣称所有整窗闪烁已排除。


## 阶段 16：执行消息只读对话与目标列表入口

- [x] 16.1 将目标卡片内展开的执行消息改为入口加只读对话弹层，对话参照 Bot 之间的只读聊天；卡片底部入口与“查看目标”同行并占用剩余横向空间。
  - 对应需求：需求 27 补充（执行消息只读对话）
  - 对应设计：§41.2
  - 怎么验证：真实组件挂载，核对入口不展开内联内容、打开才读取、无输入框、工具活动默认折叠、入口与“查看目标”位于同一 `footer`，关闭后不再刷新。
- [x] 16.2 在全部目标列表行增加执行消息入口，未进入执行阶段的目标不显示，点击入口不触发进入详情。
  - 对应需求：需求 27 补充（执行消息只读对话）
  - 对应设计：§41.2
  - 怎么验证：列表挂载测试核对入口数量与状态过滤、点击后先读取目标再读取 transcript、全部请求为 GET、目标行选择回调未触发。
- [x] 16.3 同步更新既有分页、任务切换与晚响应测试到弹层形态，完成受影响与完整 Desktop 测试、类型与 i18n 检查，并如实记录回归类型脚本的既有失败。
  - 对应需求：需求 27 补充（执行消息只读对话）
  - 对应设计：§41.2
  - 怎么验证：执行记录见验证文档；不据此宣称回归类型脚本通过。
- [ ] 16.4 在实际 Electron 中人工检查弹层与卡片底部同行布局、头像、气泡、窄窗口表现。
  - 对应需求：需求 27 补充（执行消息只读对话）
  - 对应设计：§41.2
  - 怎么验证：只读观察既有目标，不向真实 Bot 发送消息、不批准或改变用户目标；截图与结论写入验证文档。本任务尚未执行。

阶段 16 完成证据（16.1–16.3）：[执行消息只读对话与目标列表入口验证](docs/20261118-执行消息只读对话与目标列表入口验证.md)。完整 Desktop 840 PASS / 0 FAIL / 1 既有 DB-gated SKIP；两个受影响文件 43 PASS；Desktop 类型与 i18n 检查通过。`outcome-regression-types.ts` 在本环境失败（21 条诊断，均为 server 测试中 Prisma Client 缺少新模型），改动前后结果相同，不属于本阶段引入。16.4 未执行，界面观感未经实际 Electron 确认。
