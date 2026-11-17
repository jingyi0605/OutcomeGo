# 任务清单 - 现实任务与知识资料闭环（人话版）

状态：IN_PROGRESS（第 1 波完成；第 2 波工具/双来源/回执/统一验收与续跑代码已交付，集成数据库验证 PENDING；第 3 波客户端）

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

2026-11-17 整理：合并了原先重复的 provider 合同测试（1.x/5.1）、状态机验证（2.1/5.3）、回执对账（3.x/5.4）、Explore（4.x/5.5）、全流程回放（4.3/5.6）、普通 Agent 回归（4.4/5.7）和三个最终检查点（4.5/5.8/5.9）；新增人工 WorkItem 创建来源（`RequestHumanAction`、Decision `manual_action`）和移动端只读动作卡任务；验收统一走 `004.2` 的 `/reviews`；Explore 移到最后，可整体延期。

分波及测试替身合同：[父接口冻结文档](../004-OutcomeGo整体项目/docs/parallel-interfaces.md)。需求见 [requirements.md](requirements.md)，业务设计见 [design.md](design.md)；本次只调整任务前置关系。

## 阶段 0：资料、文件和项目范围基线

- [x] 0.1 盘点资料、文件和 asset 入口
  - 状态：DONE（2026-11-17，第一波）
  - 实现提交：`fea60e9d9`；合同另见 `9790c2fd7`。
  - 修改文件：`docs/knowledge-capability-matrix.md`；父 design §39 D19。
  - 数据库变化：无。
  - 验证命令：源码核对；`bun test apps/server/test/knowledge-provider.test.ts`。
  - 验证结果：PASS；共享挂载读取路径经负责人确认，真实临时 Bot 文本、消息与附件读取验证通过。
  - 证据文件：[第一波实现与验证](docs/20261117-第一波实现与验证.md)。
  - 已知限制：真实环境共享挂载未观察（PENDING）；后续工具/回执/验收不在第一波完成范围；第 0 波全量数据库失败门槛继续保留。
  - 回滚方式：撤销本线实现/合同，保留有数据的新表，按父设计关闭入口。
  - 这一步到底做什么：确认 `AgentFileState`、computer 文件读取（`/v1/read` 常量的处理端）、`SearchDocument`、`asset-service`、`asset-store` 和消息附件的真实调用路径，确定 ProjectFile provider 的检索和读取方式（D19）。
  - 做完你能看到什么：`docs/knowledge-capability-matrix.md`。
  - 先依赖什么：第 0 波 B、`004.2` 任务 1.2（第 1 波线 4）。
  - 开始前先看：design §6、§15、§28、§29
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不接入 X-File 或新的外部知识库。
  - 怎么算完成：选定读取路径和检索路径，写入父 design §39 D19；`bot:<botId>` scope 的边界和缺失行为有结论。
  - 怎么验证：源码审查和一次 fixture read
  - 对应需求：需求 5、需求 9、需求 10
  - 对应设计：§6、§15、§28、§29

- [x] 0.2 固定现实任务 fixture
  - 状态：DONE（2026-11-17，第一波）
  - 实现提交：`fea60e9d9`；合同另见 `9790c2fd7`。
  - 修改文件：`docs/human-task-fixture.json`；`apps/server/test/knowledge-provider.test.ts`。
  - 数据库变化：无。
  - 验证命令：`bun test apps/server/test/knowledge-provider.test.ts`。
  - 验证结果：PASS；虚构 fixture 的工具参数/start/pause 合同与后续回执/驳回/补交/通过/同子线程输入均已检查。
  - 证据文件：[第一波实现与验证](docs/20261117-第一波实现与验证.md)。
  - 已知限制：第二波阶段只提供 fixture 输入，未宣称已执行工具、回执和续跑；第 0 波全量数据库失败门槛继续保留。
  - 回滚方式：撤销本线实现/合同，保留有数据的新表，按父设计关闭入口。
  - 先依赖什么：0.1
  - 主要改哪里：`docs/human-task-fixture.json`
  - 这一步先不做什么：不使用真实客户资料、真实照片或生产设备。
  - 怎么算完成：资料、`RequestHumanAction` 调用、动作卡、缺材料、驳回、补交、通过、Agent 子线程继续都有固定输入。
  - 怎么验证：fixture schema 检查
  - 对应需求：需求 7、需求 11、需求 12、需求 13、需求 17
  - 对应设计：§40、§41

## 阶段 1：KnowledgeProvider

- [x] 1.1 定义 provider 合同并实现 FixtureKnowledgeProvider
  - 状态：DONE（2026-11-17，第一波）
  - 实现提交：`fea60e9d9`；合同另见 `9790c2fd7`。
  - 修改文件：`packages/contracts/src/knowledge.ts`；`knowledge-provider.ts`、`knowledge-scope-service.ts`、`fixture-knowledge-provider.ts`；合同测试。
  - 数据库变化：无。
  - 验证命令：contracts/server typecheck；`bun test apps/server/test/knowledge-provider.test.ts`。
  - 验证结果：PASS；两个 provider 共用 search/read/去重/stale/跨范围/timeout/unreadable 合同，fixture 无生产默认注册。
  - 证据文件：[第一波实现与验证](docs/20261117-第一波实现与验证.md)。
  - 已知限制：真实环境共享挂载未观察（PENDING）；后续工具/回执/验收不在第一波完成范围；第 0 波全量数据库失败门槛继续保留。
  - 回滚方式：撤销本线实现/合同，保留有数据的新表，按父设计关闭入口。
  - 先依赖什么：0.1
  - 主要改哪里：`packages/contracts/src/knowledge.ts`（新增）、`apps/server/src/services/knowledge-provider.ts`、`knowledge-scope-service.ts`、`fixture-knowledge-provider.ts`（新增）
  - 这一步先不做什么：不把全文缓存和 provider token 暴露给客户端；生产环境不默认启用 fixture provider。
  - 怎么算完成：search/read、scope、stale、digest 和 §44 错误码可序列化；fixture provider 可注入 timeout/stale/permission 错误。
  - 怎么验证：`bun test apps/server/test/knowledge-provider.test.ts`（合同测试，两个 provider 共用）
  - 对应需求：需求 1、需求 5、需求 9、需求 10、需求 16
  - 对应设计：§7、§13、§14、§15、§28、§44

- [x] 1.2 实现 ProjectFileKnowledgeProvider
  - 状态：DONE（2026-11-17，第一波）
  - 独立复核修复：`6bd25528a`；bound/query allowedSources 交集在 SQL limit 前筛选；message-only 跳过受管文件候选。实际数据库新增两例回归由 FAIL 转 PASS，本线完整重跑 38 PASS / 0 FAIL。
  - 实现提交：`fea60e9d9`；合同另见 `9790c2fd7`。
  - 修改文件：`apps/server/src/services/knowledge-file-provider.ts`；`apps/server/test/knowledge-provider.test.ts`。
  - 数据库变化：无。
  - 验证命令：server typecheck；`bun test apps/server/test/knowledge-provider.test.ts`。
  - 验证结果：PASS；实际临时共享目录文本 SHA-256、消息/附件、空向量兼容、scope-before-limit、失效和不可读行为均验证。
  - 证据文件：[第一波实现与验证](docs/20261117-第一波实现与验证.md)。
  - 已知限制：真实环境共享挂载未观察（PENDING）；后续工具/回执/验收不在第一波完成范围；第 0 波全量数据库失败门槛继续保留。
  - 回滚方式：撤销本线实现/合同，保留有数据的新表，按父设计关闭入口。
  - 先依赖什么：1.1
  - 主要改哪里：`knowledge-file-provider.ts`（新增），按 0.1 结论接入 computer 读取和站内检索
  - 这一步先不做什么：不跨 Bot 检索。
  - 怎么算完成：执行 Bot 范围内可检索和读取文件/消息引用，返回 sourceRef/version/digest；跨 Bot 引用不返回正文。
  - 怎么验证：同一合同测试 + scope、stale、unreadable source 测试
  - 对应需求：需求 5、需求 9、需求 10、需求 16
  - 对应设计：§15、§29、§43

## 阶段 2：人工 WorkItem 和动作卡

- [ ] 2.1 实现人工 WorkItem 模型、状态和创建来源
  - 后续实际复验（Task-39）：两来源续跑失败由真实 Bot fixture 默认 provisioning 引起，已改为 active；保留原第二个 Run 断言并增加唯一 Inbox/持久意图证明。完整回执文件 14 PASS / 0 FAIL / 117 expect，整体任务验收继续等待统一结果。见[复验修复](docs/20261117-人工回执续跑复验修复.md)。
  - 状态：IN_PROGRESS（第一波表结构完成；第二波工具和双来源实现已交付，生产组装和数据库验证 PENDING）
  - 实现提交：`d67c1122b`（schema）；`9790c2fd7`（contracts）；`fea60e9d9`（内部构造与骨架）。
  - 修改文件：`schema.prisma` 的 004.4 区段及必要逆向关系；`human-work.ts`；`human-work-service.ts`；本线测试。
  - 数据库变化：新增 `OutcomeHumanActionCard`、`OutcomeHumanReceipt`/status enum、sequence 唯一约束与 FK；人工 WorkItem 复用已有表。
  - 验证命令：Prisma generate/db typecheck；一次性库 deploy-schema；`bun test packages/db/test/human-work.integration.test.ts apps/server/test/human-work-service.test.ts`；共享状态转换穷举回归。
  - 第二波实现提交：`f7601f5bf`（contracts）、`473f46bd1`（合同测试）、`ab37843dc`（双来源、工具和真实资料消费）。
  - 第二波修改文件：`human-action-tool.ts`、`human-work-service.ts`、`human-knowledge-service.ts`、`human-revision-policy.ts`、`human-work-factory.ts`、`runtime/tools.ts` 和本线测试。
  - 验证结果：第一波表结构、内部 `createCard`、状态/并发/事务验证 PASS；第二波 server/computer/contracts 类型检查 PASS，最小无数据库测试 11 PASS / 0 FAIL。两来源和 pending successor 的数据库测试已写，按负责人要求等待整体集成执行；不能把整个任务记为 DONE。
  - 证据文件：[第一波实现](docs/20261117-第一波实现与验证.md)、[第二波代码交付与待验项](docs/20261117-第二波人工动作回执交付.md)。
  - 已知限制：integrator 负责将真实 `HumanActionPort`、工具 handler、HTTP 依赖和 Review 第五参数组装到生产；Decision pending resolve 依赖 L3 `515abb275`。来源 A 进入 `waiting_human`，来源 B 按冻结策略保持 `waiting_decision` 到人工接受；不宣称生产部署或数据库全链路已通过。
  - 回滚方式：撤销入口与实现；保留有数据的新表，不执行破坏性 schema 回退。
  - 这一步到底做什么：`OutcomeHumanActionCard`、`OutcomeHumanReceipt` 表；§16 状态机；`RequestHumanAction` 工具（只在 Outcome 子线程）；Decision `manual_action` 创建入口；调用方 Agent WorkItem → `waiting_human`。
  - 先依赖什么：表结构/状态骨架：0.2、1.1、第 0 波 B；工具来源：`004.2` 3.2、3.4；Decision 来源：`004.3` 1.3（后两部分在第 2 波实现）。
  - 开始前先看：design §8、§16、§32；父 design §42.2、§45.3
  - 主要改哪里：`packages/contracts/src/human-work.ts`（新增）、`packages/db/prisma/schema.prisma`、`apps/server/src/services/human-work-service.ts`（新增）、`apps/computer/src/runtime/tools.ts`、`apps/server/src/services/internal-tool-service.ts`
  - 这一步先不做什么：不复制 Agent Run 状态机；不从 Contract 自动推断人工任务；不自动执行现场命令。
  - 怎么算完成：两种来源都能创建人工 WorkItem；非法状态转换被拒绝；旧 revision 提交返回冲突；工具不出现在主对话、Routine 和普通 Run。
  - 怎么验证：`bun test apps/server/test/human-work-service.test.ts`、工具列表快照
  - 对应需求：需求 2、需求 6、需求 11、需求 15、需求 17
  - 对应设计：§8、§16、§32

- [x] 2.2 实现动作卡 API
  - 状态：DONE（2026-11-17，第一波）
  - 独立复核修复：`6bd25528a`；成功请求先幂等回放，再对新请求检查 revision/status。start/pause 两例验证 revision 和取消状态变化后的并发原响应回放、旧 revision 新 key 冲突和无重复事件，本线完整重跑 38 PASS / 0 FAIL。
  - 实现提交：`fea60e9d9`；合同另见 `9790c2fd7`。
  - 修改文件：`apps/server/src/routes/human-work.ts`；`human-work-service.ts`；`main.ts` 路由注册；service/route 测试。
  - 数据库变化：复用 2.1 新表，不另增表。
  - 验证命令：`bun test apps/server/test/human-work-service.test.ts apps/server/test/human-work-routes.test.ts`；共享状态机回归。
  - 验证结果：PASS；list/detail/start/pause、旧 revision、幂等/并发、非法状态、草稿恢复、服务端 actor；无独立验收接口。
  - 证据文件：[第一波实现与验证](docs/20261117-第一波实现与验证.md)。
  - 已知限制：真实环境共享挂载未观察（PENDING）；后续工具/回执/验收不在第一波完成范围；第 0 波全量数据库失败门槛继续保留。
  - 回滚方式：撤销本线实现/合同，保留有数据的新表，按父设计关闭入口。
  - 先依赖什么：2.1 的表结构/状态骨架、1.2；第 1 波用 fixture 创建动作卡，不等待工具和 Decision 来源完成。
  - 主要改哪里：`apps/server/src/routes/human-work.ts`（新增）
  - 这一步先不做什么：不把客户端提交的 status 当作可信状态；不另设验收接口。
  - 怎么算完成：list/detail/start/pause 有 revision 条件和幂等；重新打开从服务端恢复。
  - 怎么验证：route/service/并发测试
  - 对应需求：需求 6、需求 11
  - 对应设计：§9、§17、§33

- [ ] 2.3 实现 Desktop 动作卡和资料引用
  - 状态：IN_PROGRESS（Desktop 代码完成；统一集成后的正式验证 PENDING）
  - 实现提交：`3abfc861e`、`4ed536b33`。
  - 修改文件：`outcomes/human-work/human-action.tsx`、`knowledge-references.tsx`、`human-api.ts`、Inbox 导航和最小 API/本地化接线。
  - 数据库变化：本线无。
  - 验证命令：15 项聚焦状态/适配器测试；32 个变更 Desktop 根文件的聚焦编译；39 个源/测试文件语法检查；`git diff --check`。
  - 验证结果：15 PASS / 0 FAIL / 50 assertions；聚焦编译及语法 0 diagnostics；SSR/浏览器/真实服务统一验证 PENDING。
  - 证据文件：[桌面客户端代码与最小检查](docs/20261117-桌面客户端代码与最小检查.md)。
  - 已知限制：仅将服务端已保存的步骤、摘要、已读引用和状态称为恢复；未提交的完整本地 File 对象不宣称可跨应用重启恢复。资料正文只在主动读取时请求，不持久化到客户端缓存。
  - 回滚方式：撤销本线代码和文档提交；保留服务端表与真实材料。
  - 先依赖什么：2.2、2.1 的两种来源、3.2（第 3 波 Desktop）。
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/human-work/`、API client
  - 这一步先不做什么：不默认展示完整资料正文。
  - 怎么算完成：目的、前置条件、步骤、资料、输入和 Evidence 要求可读；暂停和刷新后状态恢复。
  - 怎么验证：`bun --filter @outcomego/desktop typecheck`、组件测试
  - 对应需求：需求 6、需求 10、需求 11
  - 对应设计：§17、§24、§39

## 阶段 3：回执、验收和客户端

- [ ] 3.1 实现回执提交
  - 后续实际复验（Task-39）：一次性 PostgreSQL 55434 上完整 `human-receipt.integration.test.ts` 为 14 PASS / 0 FAIL / 117 expect；包含幂等、资产冲突、缺材料和补交。全局验收状态不在本次局部修复中提前关闭，见[复验修复](docs/20261117-人工回执续跑复验修复.md)。
  - 状态：IN_PROGRESS（代码和测试编写完成，集成数据库验证 PENDING）
  - 实现提交：`f7601f5bf`（严格输入/DTO）、`473f46bd1`（合同测试）、`ab37843dc`（回执服务、HTTP 和测试）。
  - 修改文件：`human-receipt-service.ts`、`human-work.ts`、`routes/human-work.ts`、`human-work-service.ts`、本线回执/HTTP 测试和 fixture。
  - 数据库变化：无；复用第一波人工表与 sequence 约束。
  - 验证命令：server/computer/contracts `tsc`；`bun test packages/contracts/test/human-work.test.ts apps/computer/test/runtime/human-action-tool.test.ts apps/computer/test/runtime/outcome-tool-surfaces.test.ts apps/server/test/human-action-routes.test.ts`。
  - 验证结果：三个类型检查 PASS；4 文件 11 PASS / 0 FAIL / 32 expect。回执并发/幂等、资产冲突、缺材料和补交等数据库用例已添加，未执行。
  - 证据文件：[第二波代码交付与待验项](docs/20261117-第二波人工动作回执交付.md)。
  - 已知限制：按负责人“代码完成后统一验证”执行；生产组装与一次性数据库验收 PENDING，第 0 波数据库失败门槛保留。
  - 回滚方式：撤销入口与服务，保留有数据的人工表。
  - 先依赖什么：2.2、2.1 的来源实现（第 2 波）。
  - 主要改哪里：`apps/server/src/services/human-receipt-service.ts`（新增）、receipts 路由
  - 这一步先不做什么：不直接保存无归属的本地路径。
  - 怎么算完成：文本、asset refs、source refs、observations 幂等提交；资产已被其他 WorkItem 回执引用时拒绝；提交后生成 `human_confirmed` Evidence，WorkItem → `review_pending`。
  - 怎么验证：same key/hash、different hash、asset 冲突测试
  - 对应需求：需求 3、需求 7、需求 12、需求 16
  - 对应设计：§18、§19、§34

- [ ] 3.2 接入统一验收和 Agent 子线程继续执行
  - 后续实际复验（Task-39）：原两例 `runs=1` 对 `expected=2` 实际复现后修正活动 Bot 前提；相同事务续跑与回放唯一性通过。新增 provisioning 持久意图、激活后两次 drain 仅续跑一次的真实测试，完整文件 14 PASS / 0 FAIL，见[复验修复](docs/20261117-人工回执续跑复验修复.md)。
  - 状态：IN_PROGRESS（代码和测试编写完成，集成数据库验证 PENDING）
  - 实现提交：`ab37843dc`。
  - 修改文件：`human-receipt-service.ts`、`human-revision-policy.ts`、`human-work-factory.ts`、`outcome-review-service.ts` 授权人工分支及人工 fixture、本线回执数据库测试。
  - 数据库变化：无。
  - 验证命令：server/computer/contracts `tsc`；本线最小无数据库测试；待集成运行 `human-receipt.integration.test.ts`、`outcome-review-service.test.ts` 和 004.2 研究试点回归。
  - 验证结果：类型检查和本线最小无数据库测试 PASS；接受/驳回/补交、同线程真实 enqueue、事务回滚和 pending successor 边界共 13 个新增数据库用例已写，未执行，不能标记 DONE。
  - 证据文件：[第二波代码交付与待验项](docs/20261117-第二波人工动作回执交付.md)。
  - 已知限制：唯一 `/reviews` 注入第五参数 `HumanReviewPort`，人工项/回执/原请求 Agent 续跑在同事务；真实生产组装由 integrator 合并。N+1 pending 时只接受有实际启动证明的 N 人工上下文；N+1 批准后新旧控制 409；N 的 Review 不得全局接受 N+1。部署挂载观察与第 0 波数据库门槛仍 PENDING。
  - 回滚方式：撤销人工事务钩子及入口，不另设验收 API，不破坏历史回执。
  - 先依赖什么：3.1、`004.2` 任务 3.2、3.4、4.2（同一子线程续跑和统一验收，第 2 波）。
  - 主要改哪里：`outcome-review-service.ts`、`human-work-service.ts`、`packages/messaging/src/outcome-threads.ts`
  - 这一步先不做什么：不把 Agent 说明或不可读外部 URL 标为 PASS。
  - 怎么算完成：通过 `/reviews` 接受或驳回人工 WorkItem；接受后调用方 Agent WorkItem 在同一子线程继续；驳回保留回执历史和缺口。
  - 怎么验证：missing/stale/rejected/resubmit/accepted 测试
  - 对应需求：需求 7、需求 13、需求 15、需求 17
  - 对应设计：§20、§32、§35

- [ ] 3.3 实现 Desktop 回执表单和错误恢复
  - 状态：IN_PROGRESS（Desktop 代码完成；统一集成后的正式验证 PENDING）
  - 实现提交：`3abfc861e`、`4ed536b33`；真实历史契约读取接口依赖原始提交 `a7b3067e0`。
  - 修改文件：`human-work/receipt-form.tsx`、`receipt-state.ts`、动作卡/回执历史、`detail/outcome-detail.tsx`、`detail/review-panel.tsx`、统一导航。
  - 数据库变化：本线无。
  - 验证命令：15 项聚焦状态/适配器测试；32 个变更 Desktop 根文件的聚焦编译；39 个源/测试文件语法检查；`git diff --check`。
  - 验证结果：15 PASS / 0 FAIL / 50 assertions；部分上传失败后保留成功引用的回归通过；SSR 的缺材料、驳回和真实 N / 待批 N+1 案例已添加未执行。
  - 证据文件：[桌面客户端代码与最小检查](docs/20261117-桌面客户端代码与最小检查.md)。
  - 已知限制：真实服务回执、验收和续跑联验 PENDING。历史契约读取失败时禁止验收，不回退到 N+1；N+1 真正批准后旧 N 控制由服务端拒绝，客户端刷新事实。
  - 回滚方式：撤销本线代码和文档提交；保留资产、Receipt 和 Evidence。
  - 先依赖什么：3.1、3.2
  - 主要改哪里：`ReceiptForm.tsx`、asset 上传状态、验收状态
  - 这一步先不做什么：不清空已上传资产和已填写草稿。
  - 怎么算完成：网络失败、asset 失败、revision 冲突、驳回和重试状态可见。
  - 怎么验证：UI 失败 fixture、刷新/重连测试
  - 对应需求：需求 7、需求 11、需求 12、需求 16
  - 对应设计：§24、§39、§44

- [x] 3.4 实现 Android/iOS 只读动作卡
  - 状态：DONE（2026-11-17，实现交付及整合后 Android 构建/JVM、原始 Swift Core 测试通过；设备/UI、真实 API 与完整 iOS App 验收 PENDING）
  - 实现提交：`9d1eb4dce`、`b75ed7caf`
  - 修改文件：共享 `OutcomeInbox.kt`、iOS Core `OutcomeInbox.swift`；Android `OutcomeInboxScreens.kt`/`OutcomeScreens.kt`/gateway；iOS `OutcomeInboxView.swift`/`OutcomesView.swift`/`AppStore.swift`；两端文案、fixtures 和模型测试。
  - 数据库变化：none。
  - 验证命令：`bash scripts/android/package-debug.sh --test`；`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --package-path apps/ios`；native/Siri 配置检查。
  - 验证结果：shared 43、Android 86、原始 Swift Core 329 tests，全部 0 failures；包含只读 human receipt、未知字段/状态与真实传输测试；Android 新 APK 已记录。iOS 全 App 外部固定包 TLS 拉取停滞，真实 GET 无状态变化和设备/UI 检查 PENDING。
  - 证据文件：[`20261117-整合后移动端真实构建与测试.md`](../004-OutcomeGo整体项目/docs/20261117-整合后移动端真实构建与测试.md)。
  - 已知限制：仅展示动作、资料引用、服务端保存进度和 receipt 历史；没有 start/pause/receipt/review 写操作，均引导 Desktop。未将 fixture 验证等同真实 API 验收；第 0 波数据库阻塞保留。
  - 回滚方式：先撤销 `b75ed7caf` UI，再撤销 `9d1eb4dce` 模型；无数据库回滚。
  - 先依赖什么：2.2、`004.2` 任务 6.1、6.2
  - 主要改哪里：`mobile/shared/.../core/Models.kt`、`apps/android/app/src/main/kotlin/com/outcomego/features/`、`apps/ios/Sources/App/`
  - 这一步先不做什么：不提供开始、暂停、提交和验收入口。
  - 怎么算完成：只读显示动作卡；操作提示“请在 Desktop 完成”；查看不改变状态。
  - 怎么验证：`bash scripts/android/package-debug.sh`、iOS Core 测试；设备不可用时记录 PENDING
  - 对应需求：需求 18
  - 对应设计：§24、§42

## 阶段 4：回放和交付

- [ ] 4.1 现实任务 fixture 全流程回放（父场景 C）
  - 状态：TODO
  - 先依赖什么：3.3、3.4
  - 怎么算完成：资料检索、`RequestHumanAction`、动作卡开始/暂停、缺材料、驳回、补交、验收、Agent 子线程继续都有请求、ID 和结果。
  - 怎么验证：`docs/human-task-replay.md`
  - 对应需求：需求 1–7、需求 11–17
  - 对应设计：§40、§41

- [ ] 4.2 Agent WorkItem 和普通聊天隔离回归
  - 状态：BLOCKED（2026-11-17，task-26 代码交付及最小检查完成；按负责人要求集中数据库/回放待执行，未满足正式验收）
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 第 3 波验证命令：`bun test ./scripts/check-outcome-contracts.test.ts ./scripts/outcome-recovery/report.test.ts ./scripts/check/test-database-gates.test.ts`；`bun scripts/check/outcome-regression-types.ts`；`bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan`；`git diff --check`。
  - 第 3 波验证结果：13 PASS / 0 FAIL / 62 assertions；14 个本线文件语义诊断 0、依赖诊断 0；51 个旧测试文件语法通过；11+6 个新 DB 测试、六场景实际 JSON/DB 对账及备份回退均 PENDING。
  - 第 3 波证据文件：[第3波回归脚手架交接](../004-OutcomeGo整体项目/docs/20261117-第3波回归脚手架交接.md)；同目录组合验证手册/合同矩阵/数据库入口补齐记录；`004.5/docs/final-replay.md` 和 `release-decision.md`。
  - 第 3 波已知限制：canonical 入口补齐已扩大覆盖，新的完整失败数未知；历史 canonical/dual-flag 基线分别保留且数据库失败仍阻塞；远端 CI/Computer/真实模型、安装与旧镜像未验，不宣称 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 先依赖什么：3.2
  - 怎么算完成：没有人工动作的 Outcome 仍按 `004.2` 路径完成；普通聊天不产生人工任务或资料记录。
  - 怎么验证：`004.2` 研究试点回归、event 断言
  - 对应需求：需求 15
  - 对应设计：§22

## 阶段 5：Explore（2026-11-17 负责人要求本轮实现）

- [ ] 5.1 实现 ExploreIdea 和转 PlanningDraft
  - 状态：IN_PROGRESS（后端与 Desktop 代码均已交付；统一组合验证 PENDING，不提前勾选整个任务完成）
  - 实现提交：`d0eadb5d6`（contracts）、`01f437220`（schema）、`de5a12db8`（后端）、`f3ad396c3`（并发主体冲突）。
  - 修改文件：`packages/contracts/src/explore.ts`、exports、可选 OutcomeDetail 来源字段；`packages/db/prisma/schema.prisma`；`apps/server/src/services/explore-state.ts`、`explore-service.ts`、`outcome-planning-service.ts`、`outcome-service.ts`、`routes/explore.ts`、Explore contracts/routes/service 测试及对应冻结/设计文档。
  - 数据库变化：新增 ExploreIdea/ExploreIdeaStatus，独立 PlanningDraft FK 和真实转换 Outcome 双向可选关联；不删除或重命名已有表/列，不写 migration 文件。
  - 验证命令：`bun test packages/contracts/test/explore.test.ts apps/server/test/explore-routes.test.ts`；`bun --filter @outcomego/db db:generate`；定向 server `tsc` 编译检查。
  - 验证结果：5 PASS / 0 FAIL、14 断言；Prisma 生成与 server 编译 PASS。7 个新增真实数据库场景仅完成用例代码，按代码优先要求保持未运行/PENDING；没有 broad suites、构建或回放通过声明。
  - 证据文件：[`docs/20261117-Explore后端实现与验证.md`](docs/20261117-Explore后端实现与验证.md)。
  - 已知限制：中心 app/main 装配由 integrator，Desktop Explore UI 由 w3-desktop；本线不启动服务/数据库，不执行远端真实模型调用；转换后的 readonly 和旧数据兼容待整合验证。
  - 回滚方式：先撤销装配，再按本线提交撤销接口/服务，保留实际已有探索/交付数据，不在回滚时删除表。
  - Desktop 代码进度（2026-11-17，负责人要求本轮完整实现）：DONE；正式统一验收 PENDING。此行不替代产品线的后端实现与验收记录。
  - Desktop 实现提交：`4ed536b33`；冻结 Explore 合同原始提交 `d0eadb5d6`。
  - Desktop 修改文件：`outcomes/explore/{explore-api.ts,explore-panel.tsx}`、`planning/planning-wizard.tsx` 的可选预算桥接、Inbox 工作区/最小 API/本地化接线。
  - Desktop 数据库变化：无；后端模型与转换事务由产品线拥有。
  - Desktop 验证：聚焦状态/适配器测试 15 PASS / 0 FAIL；聚焦编译 0 diagnostics；只读历史/规划桥接 SSR 测试已添加未执行；真实 Propose→PlanningDraft→确认→新 Outcome 回放 PENDING。
  - Desktop 证据：[桌面客户端代码与最小检查](docs/20261117-桌面客户端代码与最小检查.md)。
  - Desktop 已知限制：不创建自动 Run、不自动批准；`proposed_for_delivery` 是冻结规范值，转换或丢弃后只读保留历史；不因 UI 完成宣称整个任务验证完成。
  - Desktop 回滚：撤销 `4ed536b33` 和文档记录，保留后端数据和转换来源。
  - 先依赖什么：4.1、`004.2` 任务 2.1
  - 主要改哪里：Explore model/service/route、contracts、Desktop 入口
  - 这一步先不做什么：不把 ExploreIdea 直接变成 approved Outcome；不为探索创建 Run。
  - 怎么算完成：draft/exploring/proposed_for_delivery/converted/discarded 状态可查；propose 产生新 PlanningDraft，确认创建真实独立 Outcome 后原记录只读，不自动批准或执行。
  - 怎么验证：状态转换、转换事务和 approved Contract 快照测试
  - 对应需求：需求 4、需求 8、需求 14
  - 对应设计：§21、§37、§38

## 阶段 6：最终检查

- [ ] 6.1 Spec 最终检查点
  - 状态：TODO
  - 先依赖什么：4.1、4.2；5.1 完成或明确延期
  - 怎么算完成：需求 1–18（Explore 延期时需求 4、8、14 记为延期并写入 Out of Scope）、provider scope、回执、Evidence、移动端和失败矩阵都有证据；按父 design §34 回答八个问题。
  - 怎么验证：requirements/design/tasks 三向核对
  - 对应需求：全部需求
  - 对应设计：全文
