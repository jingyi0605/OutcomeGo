# 任务清单 - Outcome 规划执行与成果验收闭环（人话版）

状态：IN_PROGRESS（阶段 0、阶段 1 完成；下一步任务 2.1）

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

2026-11-17 整理：按“主线程 + 子线程”执行模型重排；合并了原先重复的最终检查点（4.6/5.5/7.2）、普通聊天回归（4.5/5.3/6.4）和失败回放（5.4/6.1/6.2）；原阶段 8 的规划服务、返工、预审和 Budget 并入对应阶段，解决“2.1 需要的 `kind=planning` 在 8.1 才实现”的顺序问题。

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

- [ ] 2.1 实现规划候选项服务
  - 状态：TODO
  - 这一步到底做什么：`OutcomePlanningService` 通过 computer `/v1/infer`（`kind=planning`）生成三维候选项，保存 `OutcomePlanningDraft`，处理非 JSON、超时和空结果。
  - 先依赖什么：1.3
  - 开始前先看：§10、§16、§31
  - 主要改哪里：`packages/contracts/src/service-protocol.ts`（kind 增加 `planning`、`prereview`）、`apps/server/src/services/outcome-planning-service.ts`（新增）、对应测试
  - 这一步先不做什么：不新建 Agent Run，不做模板复用和长期偏好。
  - 怎么算完成：固定 fixture 能生成合法 draft；每维度最多 4 项；`questions` 转为 `ambiguous_scope` 冲突；失败返回 `planning_generation_failed`（retryable）。
  - 怎么验证：用假 computer 响应的服务测试 `bun test apps/server/test/outcome-planning-service.test.ts`；开发环境一次真实调用记录在 `docs/acceptance-replay.md`
  - 对应需求：需求 2、需求 6、需求 15
  - 对应设计：§10、§16、§31

- [ ] 2.2 实现 Outcome HTTP API（不含执行和验收）
  - 状态：TODO
  - 这一步到底做什么：注册 plans、outcomes 创建/列表/详情、revisions、approve、cancel 路由。
  - 先依赖什么：1.3、2.1
  - 开始前先看：requirements “API 合同需求”；design §11、§19、§20；`apps/server/src/main.ts` 现有 route 注册方式
  - 主要改哪里：`apps/server/src/routes/outcome.ts`（新增）、`apps/server/src/main.ts`、`apps/server/test/outcome-routes.test.ts`（新增）
  - 这一步先不做什么：不实现 `/runs`、`/reviews`、`/rework`、transcript（属于阶段 3–4）。
  - 怎么算完成：路由返回 §19 的结构；错误使用 `{ error: { code, message, details } }`；未认证请求被现有中间件拒绝；认证关闭时 `actorRef = owner:local`。
  - 怎么验证：`bun test apps/server/test/outcome-routes.test.ts`
  - 对应需求：需求 1、需求 3、需求 6、需求 7
  - 对应设计：§11、§19、§20

- [ ] 2.3 实现 Desktop 规划和批准页面
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
  - 这一步到底做什么：从批准 revision 创建 1 个 Agent WorkItem，在同一事务内通过 `enqueueWake` 入队子线程根 Run；超出并发上限时保持 `queued`。
  - 先依赖什么：2.2、3.1
  - 开始前先看：design §12.2、§19.4、§22
  - 主要改哪里：`apps/server/src/services/outcome-service.ts`、`packages/messaging/src/outcome-threads.ts`（新增）、`apps/server/src/routes/outcome.ts`
  - 这一步先不做什么：不调用 `acceptDirectUserMessage`；不在主对话中写可见消息。
  - 怎么算完成：返回 `workItems`（含 `rootRunId`）；重复请求不产生第二个 Run；Bot 不可运行时 WorkItem 为 `retry_pending` 或 `failed`。
  - 怎么验证：`bun test apps/server/test/outcome-runs.test.ts`、真实开发 Bot 一次运行
  - 对应需求：需求 3、需求 8、需求 19
  - 对应设计：§12.2、§19.4、§22

- [ ] 3.3 注入 Outcome 执行上下文
  - 状态：TODO
  - 这一步到底做什么：`platformPrompt` 根据 `outcomeWorkItemId` 读取 WorkItem 和批准 revision，作为隐藏上下文注入；执行说明要求输出写入 `outcomes/<outcomeId>/<workItemId>/`。
  - 先依赖什么：3.1
  - 开始前先看：design §23
  - 主要改哪里：`packages/messaging/src/index.ts`
  - 这一步先不做什么：不改变普通 Run prompt；不使用 `taskConfiguration`。
  - 怎么算完成：Outcome 子线程能看到目标、验收、边界和输出要求；普通 Run 请求快照不变。
  - 怎么验证：Outcome/普通 Run 对比 prompt snapshot（`bun test packages/messaging/test/outcome-context.test.ts`）
  - 对应需求：需求 3、需求 8、需求 11
  - 对应设计：§23

- [ ] 3.4 实现运行组结算和 Output 记录
  - 状态：TODO
  - 这一步到底做什么：从 `automation-results.ts` 抽出运行组判断；`settleOutcomeWorkItem` 在 Worker 回合结束处调用，更新 WorkItem 状态、写 Output、重新计算 Outcome，并调度下一个 `queued` WorkItem。
  - 先依赖什么：3.1、3.2
  - 开始前先看：design §12.4、§24；父 design §42.2
  - 主要改哪里：`packages/messaging/src/automation-results.ts`、`packages/messaging/src/outcome-threads.ts`、`apps/worker/src/worker.ts`
  - 这一步先不做什么：不把 Output 自动标为 PASS；不改变 Routine 的结算结果。
  - 怎么算完成：子 Agent 或后台 shell 未结束时 WorkItem 保持 `running`；`waiting_decision`、`waiting_human` 不被覆盖；完成后 Outcome 进入 `review_pending`。
  - 怎么验证：`bun test apps/worker/test/outcome-thread.integration.test.ts`（多回合、子 Agent、失败、中断）；现有 Routine 测试全部通过
  - 对应需求：需求 4、需求 13、需求 19
  - 对应设计：§12.4、§24

- [ ] 3.5 实现子线程只读记录接口
  - 状态：TODO
  - 先依赖什么：3.4
  - 主要改哪里：`apps/server/src/routes/outcome.ts`、复用现有 transcript 读取
  - 这一步先不做什么：不提供在子线程中发消息的入口。
  - 怎么算完成：`GET /work-items/:id/transcript` 返回运行组消息摘要。
  - 怎么验证：`bun test apps/server/test/outcome-routes.test.ts`
  - 对应需求：需求 13
  - 对应设计：§19.9

## 阶段 4：Evidence、验收和返工

- [ ] 4.1 实现 Evidence 写入和可信度
  - 状态：TODO
  - 先依赖什么：3.4
  - 主要改哪里：`apps/server/src/services/outcome-review-service.ts`（新增）、asset 引用适配
  - 这一步先不做什么：不把大文件直接存进 JSON 字段。
  - 怎么算完成：Evidence 记录来源、时间、主体、revision、criterion 和 credibility；Output 自动生成 `agent_report` 候选。
  - 怎么验证：`bun test apps/server/test/outcome-review-service.test.ts`
  - 对应需求：需求 4、需求 9、需求 13、需求 18
  - 对应设计：§9.3、§24

- [ ] 4.2 实现逐项 Review 和 Accepted 计算
  - 状态：TODO
  - 先依赖什么：4.1
  - 主要改哪里：`outcome-review-service.ts`、`POST /reviews` 路由
  - 这一步先不做什么：不使用模型结论替代 Review。
  - 怎么算完成：PASS/FAIL/UNVERIFIED/WAIVED 路径都有结果；必需条款 PASS 至少有一条非 `agent_report`、非 `ai_prereview` 的 Evidence 或用户确认。
  - 怎么验证：`bun test apps/server/test/outcome-review-service.test.ts`（必需、可选、缺证据、失败、豁免、重复）
  - 对应需求：需求 5、需求 9、需求 18
  - 对应设计：§7、§19.7、§25

- [ ] 4.3 实现返工
  - 状态：TODO
  - 先依赖什么：4.2、3.2
  - 主要改哪里：`POST /rework` 路由、`outcome-service.ts`
  - 这一步先不做什么：不实现自动重试循环。
  - 怎么算完成：FAIL/UNVERIFIED 条款可以返工；返工 WorkItem 在新子线程中执行并关联原 WorkItem；非 FAIL 条款返回 `rework_not_allowed`。
  - 怎么验证：`rework-after-fail` fixture 测试
  - 对应需求：需求 16
  - 对应设计：§32

- [ ] 4.4 实现 AI 预审建议
  - 状态：TODO
  - 先依赖什么：4.1、2.1
  - 主要改哪里：`outcome-review-service.ts`
  - 这一步先不做什么：不让预审结果写入 Review。
  - 怎么算完成：WorkItem 完成后生成 `ai_prereview` Evidence；预审失败不阻塞 Review。
  - 怎么验证：`ai-prereview` fixture 和失败注入测试
  - 对应需求：需求 17、需求 18
  - 对应设计：§33

- [ ] 4.5 实现 Desktop Outcome 详情和验收页面
  - 状态：TODO
  - 先依赖什么：4.2、4.3、3.5
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/`（OutcomeDetail、ReviewPanel）
  - 这一步先不做什么：不默认展示子线程完整记录。
  - 怎么算完成：显示 revision、WorkItem、Output、Evidence（带可信度标签）、逐条验收、返工；刷新以服务端为准。
  - 怎么验证：`bun --filter @outcomego/desktop typecheck`、组件测试
  - 对应需求：需求 5、需求 13、需求 16、需求 18
  - 对应设计：§26

## 阶段 5：Contract 变更、回归和失败路径

- [ ] 5.1 实现 Contract 变更追溯和未开始 WorkItem 处理
  - 状态：TODO
  - 先依赖什么：1.3、3.2、4.2
  - 主要改哪里：`outcome-service.ts`
  - 这一步先不做什么：不改写已完成 Output、Evidence 和旧 revision 的 Review。
  - 怎么算完成：新 revision 可反查旧 revision、来源 Decision/用户操作和变更摘要；未开始的旧 revision WorkItem 置为 `cancelled`。
  - 怎么验证：scope/acceptance/boundary change fixture
  - 对应需求：需求 7、需求 12、需求 13
  - 对应设计：§17、§18、§22

- [ ] 5.2 普通聊天和主对话隔离回归
  - 状态：TODO
  - 先依赖什么：3.3、3.4、4.2
  - 主要改哪里：现有 channel、worker、messaging 测试和新增断言
  - 这一步先不做什么：不通过修改普通消息 fixture 适配新逻辑。
  - 怎么算完成：普通消息、Tool、Memory、Run cancel、可见消息、通知和 Routine 行为不变；没有 Outcome context 的 Run 不产生 Outcome 事实；主对话与子线程互不打断。
  - 怎么验证：`bun --filter @outcomego/worker test`、`bun --filter @outcomego/messaging test`、`bun --filter @outcomego/server test`
  - 对应需求：需求 11、需求 19
  - 对应设计：§12.5、§23

- [ ] 5.3 受控失败回放
  - 状态：TODO
  - 先依赖什么：2.1、3.4、4.2
  - 主要改哪里：失败 fixture、`docs/acceptance-replay.md`
  - 这一步先不做什么：不在失败回放中补临时代码路径；不直接删除半对象作为修复。
  - 怎么算完成：规划失败、事务失败、Bot 不可运行、子线程失败/中断、Evidence 失败、Review 重复五类都能重现和解释。
  - 怎么验证：按需求 14 逐项执行
  - 对应需求：需求 14
  - 对应设计：§20、§29

## 阶段 6：移动端只读

- [ ] 6.1 Android Outcome 列表和只读详情
  - 状态：TODO
  - 先依赖什么：2.2、4.2
  - 主要改哪里：`mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/Models.kt`、`Transport.kt`、`apps/android/app/src/main/kotlin/com/outcomego/features/`
  - 这一步先不做什么：不提供规划、批准、验收和返工入口。
  - 怎么算完成：列表和详情可读；Desktop 专属操作显示“请在 Desktop 完成”；旧服务端隐藏入口。
  - 怎么验证：`bash scripts/android/package-debug.sh`；KMP 共享测试
  - 对应需求：需求 20
  - 对应设计：§14

- [ ] 6.2 iOS Outcome 列表和只读详情
  - 状态：TODO
  - 先依赖什么：2.2、4.2
  - 主要改哪里：`apps/ios/Sources/Core/API.swift`、`Models.swift`、`apps/ios/Sources/App/`
  - 这一步先不做什么：不提供规划、批准、验收和返工入口。
  - 怎么算完成：同 6.1。
  - 怎么验证：iOS Core 测试和 native config 检查；设备不可用时记录 PENDING
  - 对应需求：需求 20
  - 对应设计：§14

## 阶段 7：交付检查

- [ ] 7.1 完成研究试点端到端回放
  - 状态：TODO
  - 先依赖什么：4.5、5.2
  - 主要改哪里：`docs/acceptance-replay.md`
  - 这一步先不做什么：不使用生产系统写入、付款或真实客户资料。
  - 怎么算完成：按 `research-pilot.json` 执行一次真实子线程运行，包括第 5 步主对话不被打断，所有 ID 可追踪。
  - 怎么验证：回放记录
  - 对应需求：需求 10、需求 19
  - 对应设计：§15

- [ ] 7.2 生成主链路对账报告
  - 状态：TODO
  - 先依赖什么：7.1、5.1、5.3
  - 主要改哪里：`docs/acceptance-replay.md`
  - 怎么算完成：一个 Outcome 可以反查每个核心 ID、状态转换、Run、Output、Evidence 和 Review。
  - 怎么验证：查询脚本和 API 快照
  - 对应需求：需求 8、需求 9、需求 13
  - 对应设计：§14、§24、§27

- [ ] 7.3 Spec 最终检查点
  - 状态：TODO
  - 先依赖什么：6.1、6.2、7.2
  - 怎么算完成：需求 1–20、普通聊天回归、主对话隔离、Contract 变更、失败证据和已知限制全部回写；按父 design §34 回答八个问题。
  - 怎么验证：requirements/design/tasks 三向核对
  - 对应需求：全部需求
  - 对应设计：全文
