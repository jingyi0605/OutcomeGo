# 任务清单 - Outcome 规划执行与成果验收闭环（人话版）

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

## 阶段 0：代码基线和试点冻结

- [ ] 0.1 画出当前消息到 Run 的真实调用链
  - 状态：TODO
  - 这一步到底做什么：从 `ChannelService.sendDirectMessage`、`AgentMessaging.acceptDirectUserMessage`、`RunService`、Worker 到 `SendToUser` 记录实际调用和事务边界。
  - 做完你能看到什么：`docs/runtime-capability-matrix.md` 有文件、函数、输入、输出、失败状态和可复用结论。
  - 先依赖什么：`004.1` 最终检查点
  - 开始前先看：`apps/server/src/services/channel-service.ts`、`apps/server/src/services/run-service.ts`、`apps/worker/src/worker.ts`、`apps/server/src/services/internal-tool-service.ts`
  - 主要改哪里：`docs/runtime-capability-matrix.md`
  - 这一步先不做什么：不修改 Runtime，不先设计第二套队列。
  - 怎么算完成：可以回答 Run 创建、取消、输出、事件和重试分别在哪里发生。
  - 怎么验证：源码走查、聚焦集成测试和一条本地测试任务。
  - 对应需求：需求 3、需求 4
  - 对应设计：`design.md` §8、§12

- [ ] 0.2 固定研究试点 fixture
  - 状态：TODO
  - 这一步到底做什么：固定输入、候选项、Contract、Agent 输出和验收材料。
  - 做完你能看到什么：`docs/research-pilot.json` 和 `docs/acceptance-replay.md`。
  - 先依赖什么：0.1
  - 开始前先看：`requirements.md` 需求 10、`design.md` §11
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不使用真实客户或生产资料。
  - 怎么算完成：同一个 fixture 可创建新 Outcome，重试有独立 idempotency 断言。
  - 怎么验证：fixture schema 检查和 dry-run。
  - 对应需求：需求 10
  - 对应设计：`design.md` §11、§15

- [ ] 0.3 检查点：确认集成方式
  - 状态：TODO
  - 先依赖什么：0.1、0.2
  - 主要改哪里：`tasks.md`、`design.md`、能力矩阵
  - 这一步先不做什么：不进入 UI 开发。
  - 怎么算完成：确定直接扩展 Run 还是增加 WorkItem 关联表，并记录理由。
  - 怎么验证：设计评审。
  - 对应需求：需求 8
  - 对应设计：`design.md` §9、§12

## 阶段 1：共享合同、模型和迁移

- [ ] 1.1 实现 Outcome/Contract/Acceptance/Evidence DTO
  - 状态：TODO
  - 先依赖什么：0.3
  - 主要改哪里：`packages/contracts/src/outcomes.ts`、`index.ts`、`service-protocol.ts`
  - 这一步先不做什么：不加入未使用的权限等级和未来模型。
  - 怎么算完成：所有公共类型有 schema 校验、错误路径和测试。
  - 怎么验证：`bun --filter @aiteamos/contracts typecheck`、聚焦 contracts tests。
  - 对应需求：需求 1、需求 2、需求 3、需求 4、需求 5
  - 对应设计：`design.md` §9、§10、§11

- [ ] 1.2 增加数据库模型和增量迁移
  - 状态：TODO
  - 先依赖什么：1.1
  - 主要改哪里：`packages/db/prisma/schema.prisma`、生成 migration、数据库集成测试
  - 这一步先不做什么：不删除或重命名现有 Channel/Run/Message 表。
  - 怎么算完成：Outcome、revision、criterion、evidence、review、work item 可迁移，唯一约束生效。
  - 怎么验证：`bun --filter @aiteamos/db db:generate`、一次性 PostgreSQL migration、历史数据读取。
  - 对应需求：需求 1、需求 7、需求 8、需求 9
  - 对应设计：`design.md` §9、§13

- [ ] 1.3 实现 Outcome/Contract service
  - 状态：TODO
  - 先依赖什么：1.2
  - 主要改哪里：`apps/server/src/services/outcome-service.ts`、`contract-service.ts`、service tests
  - 这一步先不做什么：不实现 Inbox UI 和现实任务。
  - 怎么算完成：草案、revision、批准、supersede 和查询状态都在事务内完成。
  - 怎么验证：服务单测、并发批准和重复请求集成测试。
  - 对应需求：需求 1、需求 7
  - 对应设计：`design.md` §9、§13

## 阶段 2：规划和批准

- [ ] 2.1 实现 Planning API 和候选项服务
  - 状态：TODO
  - 先依赖什么：1.3
  - 主要改哪里：`apps/server/src/routes/outcome.ts`、planning service、contracts tests
  - 这一步先不做什么：不实现自动复用模板和长期偏好。
  - 怎么算完成：通过 `/v1/infer`（`kind=planning`）生成三维选项，最多四项，custom、多选、冲突、推荐理由和 draft snapshot 可用。
  - 怎么验证：API happy path、四项边界、伪造 ID、冲突、空输入、模型返回非 JSON 和超时测试。
  - 对应需求：需求 2、需求 6、需求 15
  - 对应设计：`design.md` §10、§11、§31

- [ ] 2.2 实现 Desktop Planning 页面
  - 状态：TODO
  - 先依赖什么：2.1
  - 主要改哪里：`apps/desktop/src/renderer/components/aiteamos/outcomes/`、`chat-pane.tsx`、API client
  - 这一步先不做什么：不替换聊天历史，不展示完整运行日志。
  - 怎么算完成：用户可以输入任务、逐维度多选、自定义、看到冲突并确认草案。
  - 怎么验证：Desktop typecheck、组件测试、浏览器 UI fixture。
  - 对应需求：需求 1、需求 2
  - 对应设计：`design.md` §10、§14

- [ ] 2.3 实现批准和运行前状态检查
  - 状态：TODO
  - 先依赖什么：2.2
  - 主要改哪里：approve route、Outcome service、DB tests
  - 这一步先不做什么：不把点击 UI 当作批准证据。
  - 怎么算完成：批准写入主体、时间和摘要；未批准创建 Run 返回结构化错误。
  - 怎么验证：重复批准、并发批准、原位编辑和未批准运行测试。
  - 对应需求：需求 3、需求 7
  - 对应设计：`design.md` §9、§13

## 阶段 3：OpenTeam 执行主链路

- [ ] 3.1 实现 WorkItem 到现有 Run 的映射
  - 状态：TODO
  - 先依赖什么：2.3
  - 主要改哪里：`apps/server/src/services/outcome-service.ts`、`channel-service.ts`、`run-service.ts`、`apps/worker/src/worker.ts`
  - 这一步先不做什么：不新建 Agent Runtime。
  - 怎么算完成：保存 `contractRevision`，生成真实 Run，返回 Run ID 和状态。
  - 怎么验证：服务端集成测试和真实开发 Bot 运行。
  - 对应需求：需求 3、需求 8
  - 对应设计：`design.md` §8、§12

- [ ] 3.2 注入最小 Outcome 执行上下文
  - 状态：TODO
  - 先依赖什么：3.1
  - 主要改哪里：`packages/messaging/src/index.ts` 的 `WakeInput`/InboxEvent payload（`outcomeWorkItemId`）和 `platformPrompt` 的 ambient context
  - 这一步先不做什么：不改变普通聊天 prompt 和工具行为；不使用 `taskConfiguration`。
  - 怎么算完成：Agent 能看到目标、验收、边界和输出要求；普通 Run 快照不变。
  - 怎么验证：Outcome/普通 Run 对比式 prompt snapshot、Worker tests。
  - 对应需求：需求 3、需求 8
  - 对应设计：`design.md` §12、§23

- [ ] 3.3 记录 Agent 输出为 Output/Evidence 候选
  - 状态：TODO
  - 先依赖什么：3.1
  - 主要改哪里：`internal-tool-service.ts`、Outcome output service、`ChannelMessage.sourceRunId`
  - 这一步先不做什么：不自动将所有 Agent 文本标为 PASS。
  - 怎么算完成：Output 可反查 source message、Run 和 Contract revision。
  - 怎么验证：多条 SendToUser、Run 失败、消息缺失和对账测试。
  - 对应需求：需求 4、需求 5
  - 对应设计：`design.md` §12、§13

## 阶段 4：Evidence 和验收

- [ ] 4.1 实现 Evidence 写入和来源引用
  - 状态：TODO
  - 先依赖什么：3.3
  - 主要改哪里：Evidence service、DB、review route、文件/asset 引用适配
  - 这一步先不做什么：不把大文件直接存进 JSON 字段。
  - 怎么算完成：Evidence 记录来源、时间、主体、revision、criterion 和 credibility。
  - 怎么验证：来源缺失、重复上传、内容摘要、asset reference 和 credibility 规则测试。
  - 对应需求：需求 4、需求 18
  - 对应设计：`design.md` §9、§13

- [ ] 4.2 实现逐项 Review 和 Accepted 计算
  - 状态：TODO
  - 先依赖什么：4.1
  - 主要改哪里：`outcome-review-service.ts`、Review UI、状态转换
  - 这一步先不做什么：不使用模型分数替代 Review 结果。
  - 怎么算完成：PASS/FAIL/UNVERIFIED/WAIVED 路径都有结果和不可变记录。
  - 怎么验证：必需条款、可选条款、缺证据、失败、豁免和重复 Review 测试。
  - 对应需求：需求 5、需求 9
  - 对应设计：`design.md` §7、§13

- [ ] 4.3 完成研究试点端到端回放
  - 状态：TODO
  - 先依赖什么：4.2
  - 主要改哪里：`docs/acceptance-replay.md`、测试 fixture 和运行记录
  - 这一步先不做什么：不使用生产系统写入、付款或真实客户资料。
  - 怎么算完成：输入、规划、批准、Run、输出、Evidence 和 Review 都有 ID 可追踪。
  - 怎么验证：按 `research-pilot.json` 执行至少一次真实 OpenTeam Run，并记录失败路径。
  - 对应需求：需求 10
  - 对应设计：`design.md` §15

### 最终检查

- [ ] 4.4 Contract/Run/Evidence 追踪矩阵
  - 状态：TODO
  - 先依赖什么：4.3
  - 怎么算完成：随机抽取一个 Outcome，可以在服务端和数据库中反查完整主链路。
  - 怎么验证：查询脚本、API 快照和数据库记录对账。

- [ ] 4.5 普通聊天回归检查
  - 状态：TODO
  - 先依赖什么：3.2、4.2
  - 怎么算完成：未使用 Outcome 的普通消息、Run、Tool、记忆和投递行为不变。
  - 怎么验证：现有 channel、worker、messaging 聚焦测试。

- [ ] 4.6 Spec 最终检查点
  - 状态：TODO
  - 先依赖什么：4.3、4.4、4.5
  - 怎么算完成：需求、设计、任务、试点证据和已知限制全部回写。
  - 怎么验证：按 `requirements.md`、`design.md`、`docs/acceptance-replay.md` 逐项核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 5：合同变更和普通聊天回归

- [ ] 5.1 实现 Contract revision change summary 和旧/新关联
  - 状态：TODO
  - 先依赖什么：2.3、3.1、4.2
  - 主要改哪里：Contract service、revision DTO、DB model、API view。
  - 这一步先不做什么：不自动迁移已完成 Run 到新 revision。
  - 怎么算完成：新 revision 可反查旧 revision、来源 Decision/用户操作和变更摘要。
  - 怎么验证：scope/acceptance/boundary change fixture。
  - 对应需求：需求 7、需求 12
  - 对应设计：`design.md` §17、§21、§22

- [ ] 5.2 实现未开始 WorkItem 的 revision 处理
  - 状态：TODO
  - 先依赖什么：5.1
  - 主要改哪里：Outcome service、WorkItem transition、Run submission。
  - 这一步先不做什么：不重写已完成 Output/Evidence。
  - 怎么算完成：未开始 WorkItem 按明确规则继续、暂停或重新确认。
  - 怎么验证：new revision before/after WorkItem queued fixture。
  - 对应需求：需求 12
  - 对应设计：`design.md` §18、§22

- [ ] 5.3 完成普通聊天行为回归
  - 状态：TODO
  - 先依赖什么：3.2、3.3、4.2、5.1
  - 主要改哪里：现有 channel/worker/messaging focused tests 和 regression fixture。
  - 这一步先不做什么：不把普通消息包装成 Outcome。
  - 怎么算完成：普通消息、Tool、Memory、Run cancel、visible message 和通知行为不变。
  - 怎么验证：现有 focused test suite、普通消息快照和数据库事实对账。
  - 对应需求：需求 11
  - 对应设计：`design.md` §23、§24、§28

- [ ] 5.4 受控失败回放
  - 状态：TODO
  - 先依赖什么：4.3、5.1、5.3
  - 主要改哪里：failure fixtures、acceptance replay、错误报告。
  - 这一步先不做什么：不在失败回放中补临时代码路径。
  - 怎么算完成：planning/db/run/evidence/review 五类失败都能重现和解释。
  - 怎么验证：按 requirements 需求 14 的矩阵执行。
  - 对应需求：需求 14
  - 对应设计：`design.md` §29、§32

- [ ] 5.5 Spec 最终检查点增强
  - 状态：TODO
  - 先依赖什么：5.1、5.2、5.3、5.4
  - 怎么算完成：需求 1–14、普通聊天回归、Contract 变更和失败证据全部回写。
  - 怎么验证：需求/设计/任务三向追踪和研究试点完整回放。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 6：失败路径和合同变更

- [ ] 6.1 Planning provider 失败回放
  - 状态：TODO
  - 先依赖什么：2.1
  - 这一步到底做什么：验证规划生成失败、超时、空结果、选项超限和冲突返回。
  - 主要改哪里：planning service、error fixtures、Desktop error UI。
  - 这一步先不做什么：不创建未完整的 Contract。
  - 怎么算完成：草案状态、retryable、error code 和用户下一步可解释。
  - 怎么验证：provider failure fixtures、API/UI tests。
  - 对应需求：需求 2、需求 6、需求 14
  - 对应设计：`design.md` §16、§20

- [ ] 6.2 Contract transaction rollback 回放
  - 状态：TODO
  - 先依赖什么：1.3、2.3
  - 这一步到底做什么：在批准、创建 Outcome、创建 Run intent 和 Review 事务中注入失败。
  - 主要改哪里：server service integration tests、DB fixtures。
  - 这一步先不做什么：不直接删除半对象作为修复。
  - 怎么算完成：事务失败后没有可批准半对象、重复 revision 或错误状态。
  - 怎么验证：transaction failure/rollback tests。
  - 对应需求：需求 1、需求 7、需求 14
  - 对应设计：`design.md` §22、§29

- [ ] 6.3 Contract revision 变更回放
  - 状态：TODO
  - 先依赖什么：5.1、5.2
  - 这一步到底做什么：验证 scope/acceptance/boundary 变化、新旧 WorkItem、Evidence 和 Review 的处理。
  - 主要改哪里：revision service、change fixtures、review tests。
  - 这一步先不做什么：不覆盖旧 revision 的审计记录。
  - 怎么算完成：新旧 revision、影响范围和需要重新验收的条款可追踪。
  - 怎么验证：revision-change fixture。
  - 对应需求：需求 7、需求 12、需求 13
  - 对应设计：`design.md` §18、§25

- [ ] 6.4 普通聊天和 Outcome 隔离回归
  - 状态：TODO
  - 先依赖什么：3.2、3.3、4.2
  - 这一步到底做什么：证明没有 Outcome context 的普通 Run 不产生 Outcome 事实。
  - 主要改哪里：channel/worker/messaging regression tests。
  - 这一步先不做什么：不通过修改普通消息 fixture 来适配新逻辑。
  - 怎么算完成：普通消息、Tool、Memory、Cancel、visible message 和 notification 行为保持原结果。
  - 怎么验证：existing focused suite + new absence assertions。
  - 对应需求：需求 11
  - 对应设计：`design.md` §23、§24、§28

## 阶段 7：交付检查

- [ ] 7.1 生成主链路完整对账报告
  - 状态：TODO
  - 先依赖什么：4.3、6.1、6.2、6.3、6.4
  - 主要改哪里：`docs/acceptance-replay.md`、数据库/API snapshots。
  - 怎么算完成：一个 Outcome 可以反查到每个核心 ID、状态转换、Output、Evidence 和 Review。
  - 怎么验证：查询脚本和 fixture replay。
  - 对应需求：需求 8、需求 9、需求 13
  - 对应设计：`design.md` §14、§24、§27

- [ ] 7.2 Spec 最终发布检查
  - 状态：TODO
  - 先依赖什么：7.1、8.1、8.2、8.3、8.4
  - 主要改哪里：`tasks.md`、`docs/release-readiness.md`。
  - 这一步先不做什么：不以单元测试通过替代端到端验收。
  - 怎么算完成：研究 fixture、普通聊天回归、失败路径和已知限制全部有证据。
  - 怎么验证：requirements/design/tasks 三向核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 8：返工、预审和原规划补充项

- [ ] 8.1 实现规划候选项生成服务
  - 状态：TODO
  - 这一步到底做什么：新增 `OutcomePlanningService` 和 `OutcomePlanningDraft` 表，通过 computer `/v1/infer` 生成三维候选项。
  - 先依赖什么：1.2
  - 主要改哪里：`packages/contracts/src/service-protocol.ts`（kind 增加 `planning`、`prereview`）、`apps/server/src/services/outcome-planning-service.ts`、`packages/db/prisma/schema.prisma`
  - 这一步先不做什么：不新建 Agent Run，不做模板复用。
  - 怎么算完成：固定 fixture 能生成合法 draft；非 JSON、超时和空结果有结构化错误。
  - 怎么验证：用假 computer 响应的服务测试；开发环境一次真实调用。
  - 对应需求：需求 6、需求 15
  - 对应设计：`design.md` §31

- [ ] 8.2 实现返工 API 和 UI
  - 状态：TODO
  - 先依赖什么：4.2、3.1
  - 主要改哪里：`apps/server/src/routes/outcome.ts`、`outcome-review-service.ts`、Desktop ReviewPanel
  - 这一步先不做什么：不实现自动重试循环。
  - 怎么算完成：FAIL 条款可以返工；返工 WorkItem 关联原 WorkItem；返工后可以重新验收。
  - 怎么验证：`rework-after-fail.json` fixture；非 FAIL 条款返工返回 `rework_not_allowed`。
  - 对应需求：需求 16
  - 对应设计：`design.md` §32

- [ ] 8.3 实现 AI 预审建议
  - 状态：TODO
  - 先依赖什么：4.1、8.1
  - 主要改哪里：`outcome-review-service.ts`、Evidence 写入、Review UI
  - 这一步先不做什么：不让预审结果写入 Review。
  - 怎么算完成：WorkItem 完成后生成 `ai_prereview` Evidence；预审失败不阻塞 Review。
  - 怎么验证：`ai-prereview.json` fixture；预审失败注入。
  - 对应需求：需求 17、需求 18
  - 对应设计：`design.md` §33

- [ ] 8.4 规划向导支持可选 Budget
  - 状态：TODO
  - 先依赖什么：2.2
  - 主要改哪里：Desktop PlanningWizard、Contract DTO
  - 这一步先不做什么：不实现预算超限自动中止。
  - 怎么算完成：用户可以选填时间或费用上限，Outcome 详情显示该值。
  - 怎么验证：组件测试和 DTO 测试。
  - 对应需求：需求 1
  - 对应设计：`design.md` §34
