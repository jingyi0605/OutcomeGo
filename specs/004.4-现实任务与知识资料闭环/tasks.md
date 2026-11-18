# 任务清单 - 现实任务与知识资料闭环（人话版）

状态：DONE（本地字面任务15/15完成；真实环境/发布限制按证据保留，不等于全项目发布放行）

2026-11-17 开发收尾：在task65先接受6/仍3的基础上，task69/70真实开发及执行新增接受3.3、4.1、6.1，原九项全部接受，当前15/15 DONE；历史判定保留于逐项报告，不改原完成条件和依赖。

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

2026-11-17 整理：合并了原先重复的 provider 合同测试（1.x/5.1）、状态机验证（2.1/5.3）、回执对账（3.x/5.4）、Explore（4.x/5.5）、全流程回放（4.3/5.6）、普通 Agent 回归（4.4/5.7）和三个最终检查点（4.5/5.8/5.9）；新增人工 WorkItem 创建来源（`RequestHumanAction`、Decision `manual_action`）和移动端只读动作卡任务；验收统一走 `004.2` 的 `/reviews`；Explore 移到最后，可整体延期。

2026-11-17 后续范围确认：负责人明确要求完成整个 Spec004 的剩余代码，Explore 5.1 后端与 Desktop 已纳入本轮代码交付和组合验收，不使用上文历史分波的“可整体延期”作为豁免；移动端 Explore 不在本次客户端范围。代码实现完成与真实端到端 / 发布验收状态分别记录。


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

- [x] 2.1 实现人工 WorkItem 模型、状态和创建来源
  - 历史后续实际复验（Task-39，当时定向结果）：两来源续跑失败由真实 Bot fixture 默认 provisioning 引起，已改为 active；保留原第二个 Run 断言并增加唯一 Inbox/持久意图证明。完整回执文件 14 PASS / 0 FAIL / 117 expect；本次结合最终集成包结果接受本任务，不扩大为真实部署验收。见[复验修复](docs/20261117-人工回执续跑复验修复.md)。
  - 状态：DONE（2026-11-17，task-65；双来源、工具面、非法状态/旧 revision 和生产端口均有实际本地证据）
  - 实现提交：`d67c1122b`（schema）；`9790c2fd7`（contracts）；`fea60e9d9`（内部构造与骨架）。
  - 修改文件：`schema.prisma` 的 004.4 区段及必要逆向关系；`human-work.ts`；`human-work-service.ts`；本线测试。
  - 数据库变化：新增 `OutcomeHumanActionCard`、`OutcomeHumanReceipt`/status enum、sequence 唯一约束与 FK；人工 WorkItem 复用已有表。
  - 验证命令：Prisma generate/db typecheck；一次性库 deploy-schema；`bun test packages/db/test/human-work.integration.test.ts apps/server/test/human-work-service.test.ts`；共享状态转换穷举回归。
  - 第二波实现提交：`f7601f5bf`（contracts）、`473f46bd1`（合同测试）、`ab37843dc`（双来源、工具和真实资料消费）。
  - 第二波修改文件：`human-action-tool.ts`、`human-work-service.ts`、`human-knowledge-service.ts`、`human-revision-policy.ts`、`human-work-factory.ts`、`runtime/tools.ts` 和本线测试。
  - 验证结果：最终 server 完整包 1535 PASS / 0 FAIL / 11 SKIP 中，本任务相关回执 14、human service 8、routes 5 项全部 PASS；Computer 完整包包含工具面和结束回合测试。两来源、pending successor、旧控制 409、非法状态、事务及单次同线程续跑已实际执行，七包类型通过。不同包/增量不相加冒充一次命令。
  - 生产组装核对：AppService 的 createHumanWorkServices、DecisionService.humanActions、RequestHumanAction handler、Review 第五参数、main.ts 的真实 human/knowledge 路由均已存在，不再记待组装。
  - 证据文件：[逐项验收 E1/E2/E6](docs/20261117-逐项任务验收记录.md)、[第一波实现](docs/20261117-第一波实现与验证.md)、[第二波交付历史](docs/20261117-第二波人工动作回执交付.md)。
  - 已知限制：来源 A 进入 `waiting_human`，来源 B 按冻结策略保持 `waiting_decision` 到人工接受；真实远端 Computer/Bot、共享挂载观察和完整父场景 C 仍 PENDING，保留在 4.1/6.1，不宣称生产部署已生效。
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

- [x] 2.3 实现 Desktop 动作卡和资料引用
  - 状态：DONE（2026-11-17，task-65；按任务自身卡片/资料/保存状态判据接受本地组件、服务和构建证据）
  - 实现提交：`3abfc861e`、`4ed536b33`。
  - 修改文件：`outcomes/human-work/human-action.tsx`、`knowledge-references.tsx`、`human-api.ts`、Inbox 导航和最小 API/本地化接线。
  - 数据库变化：本线无。
  - 验证命令：integrator 在 Desktop cwd 执行 `bun --no-env-file test --pass-with-no-tests --isolate`；完整 Desktop tsc、真实 renderer/Electron/helper 生产构建；Runtime 最终 server 完整包含 human-work routes/service、knowledge provider。
  - 验证结果：完整 Desktop 768 PASS / 0 FAIL / 1 SKIP / 20163 assertions，含 7 SSR 与 8 状态/adapter 用例；暂停服务端恢复、完整卡片字段/引用元数据、按需正文与范围失败均有源码/实际测试证据。完整类型和真实生产 bundle 通过；不是原生 UI 回放。
  - 证据文件：[逐项验收 E2/E4](docs/20261117-逐项任务验收记录.md)、[桌面客户端交付历史](docs/20261117-桌面客户端代码与最小检查.md)、[最终组合验证总账](../004-OutcomeGo整体项目/docs/20261117-全规格组合验证与修复记录.md)。
  - 已知限制：Electron/浏览器真实点按、暂停/刷新与 live API 联验尚未执行。仅将服务端已保存的步骤、摘要、已读引用和状态称为恢复；未提交的完整本地 File 对象不宣称可跨应用重启恢复。资料正文主动读取且不持久化到客户端缓存；完整场景保留在 4.1/6.1。
  - 回滚方式：撤销本线代码和文档提交；保留服务端表与真实材料。
  - 先依赖什么：2.2、2.1 的两种来源、3.2（第 3 波 Desktop）。
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/human-work/`、API client
  - 这一步先不做什么：不默认展示完整资料正文。
  - 怎么算完成：目的、前置条件、步骤、资料、输入和 Evidence 要求可读；暂停和刷新后状态恢复。
  - 怎么验证：`bun --filter @outcomego/desktop typecheck`、组件测试
  - 对应需求：需求 6、需求 10、需求 11
  - 对应设计：§17、§24、§39

## 阶段 3：回执、验收和客户端

- [x] 3.1 实现回执提交
  - 历史后续实际复验（Task-39，当时定向结果）：一次性 PostgreSQL 55434 上完整 `human-receipt.integration.test.ts` 为 14 PASS / 0 FAIL / 117 expect；包含幂等、资产冲突、缺材料和补交。该记录只关闭当时 fixture 问题，本次实现验收使用下列最终后继证据，4.1/6.1 不提前关闭，见[复验修复](docs/20261117-人工回执续跑复验修复.md)。
  - 状态：DONE（2026-11-17，task-65；真实 DB 幂等/资产/材料/Evidence 和事务回滚已验）
  - 实现提交：`f7601f5bf`（严格输入/DTO）、`473f46bd1`（合同测试）、`ab37843dc`（回执服务、HTTP 和测试）。
  - 修改文件：`human-receipt-service.ts`、`human-work.ts`、`routes/human-work.ts`、`human-work-service.ts`、本线回执/HTTP 测试和 fixture。
  - 数据库变化：无；复用第一波人工表与 sequence 约束。
  - 验证命令：最终 server 完整包 `bun --no-env-file test --pass-with-no-tests`；真实 `scripts/test-outcome-recovery.ts --scenario receipt-retry` CLI；持久资产/回执/AssetStore 三文件组合，完整类型检查。
  - 验证结果：最终包内 human-receipt 14 PASS、清理竞争 3 PASS；实际 receipt-retry 9/9 checks PASS，已有资产上传后 create 故障回滚、同 key 只一 Receipt/Evidence，Review 前不续跑。三文件资产组合 35 PASS / 0 FAIL / 210 assertions；历史“13 DB 未执行”和“生产组装待做”已由实际后继关闭。
  - 证据文件：[逐项验收 E1/E2/E5/E6](docs/20261117-逐项任务验收记录.md)、[持久资产修复](docs/20261117-持久回执附件清理修复与验证.md)、[第二波交付历史](docs/20261117-第二波人工动作回执交付.md)。
  - 已知限制：实际现场客户端上传及外部记录读取未观察；不可读 URL 保持未验证。最终本地完整包零失败不等于远端 CI/发布通过，完整外部验收保留在 4.1/6.1。
  - 回滚方式：撤销入口与服务，保留有数据的人工表。
  - 先依赖什么：2.2、2.1 的来源实现（第 2 波）。
  - 主要改哪里：`apps/server/src/services/human-receipt-service.ts`（新增）、receipts 路由
  - 这一步先不做什么：不直接保存无归属的本地路径。
  - 怎么算完成：文本、asset refs、source refs、observations 幂等提交；资产已被其他 WorkItem 回执引用时拒绝；提交后生成 `human_confirmed` Evidence，WorkItem → `review_pending`。
  - 怎么验证：same key/hash、different hash、asset 冲突测试
  - 对应需求：需求 3、需求 7、需求 12、需求 16
  - 对应设计：§18、§19、§34

- [x] 3.2 接入统一验收和 Agent 子线程继续执行
  - 历史后续实际复验（Task-39，当时定向结果）：原两例 `runs=1` 对 `expected=2` 实际复现后修正活动 Bot 前提；相同事务续跑与回放唯一性通过。新增 provisioning 持久意图、激活后两次 drain 仅续跑一次的真实测试，完整文件 14 PASS / 0 FAIL，见[复验修复](docs/20261117-人工回执续跑复验修复.md)。
  - 状态：DONE（2026-11-17，task-65；唯一 Review、实际双来源同线程 enqueue、失败回滚和历史材料保留均已验）
  - 实现提交：`ab37843dc`。
  - 修改文件：`human-receipt-service.ts`、`human-revision-policy.ts`、`human-work-factory.ts`、`outcome-review-service.ts` 授权人工分支及人工 fixture、本线回执数据库测试。
  - 数据库变化：无。
  - 验证命令：Runtime 最终完整 server/worker 包；实际 receipt-retry 故障 CLI；Task39 真实两来源与 provisioning 恢复、统一 Review/回执组合；完整 server/computer/contracts 类型。
  - 验证结果：最终包内回执 14 PASS、Review 16 PASS；E5 九项实际检查记录原 WorkItem/runCount 1→2、前台不变及唯一续跑。拒绝/补交、enqueue 故障回滚、pending/approved successor、不可运行 Bot 留 processing 意图并激活后仅 drain 一次均通过，不再记为数据库用例未执行。
  - 证据文件：[逐项验收 E1/E2/E5/E6](docs/20261117-逐项任务验收记录.md)、[第二波交付历史](docs/20261117-第二波人工动作回执交付.md)。
  - 已知限制：生产已在唯一 `/reviews` 注入 `HumanReviewPort`，人工项/回执/原请求 Agent enqueue 同事务；N+1 pending 仅接受有实际启动证明的 N，批准后新旧控制 409，N Review 不接受 N+1。上游 `004.2` 正式真实 Bot/远端验收及部署挂载观察仍 PENDING；依赖代码/真实 DB 事务已满足，本任务 DONE 不替代该外部门。
  - 回滚方式：撤销人工事务钩子及入口，不另设验收 API，不破坏历史回执。
  - 先依赖什么：3.1、`004.2` 任务 3.2、3.4、4.2（同一子线程续跑和统一验收，第 2 波）。
  - 主要改哪里：`outcome-review-service.ts`、`human-work-service.ts`、`packages/messaging/src/outcome-threads.ts`
  - 这一步先不做什么：不把 Agent 说明或不可读外部 URL 标为 PASS。
  - 怎么算完成：通过 `/reviews` 接受或驳回人工 WorkItem；接受后调用方 Agent WorkItem 在同一子线程继续；驳回保留回执历史和缺口。
  - 怎么验证：missing/stale/rejected/resubmit/accepted 测试
  - 对应需求：需求 7、需求 13、需求 15、需求 17
  - 对应设计：§20、§32、§35

- [x] 3.3 实现 Desktop 回执表单和错误恢复
  - 状态：DONE（2026-11-17，task69/73；原要求的回执UI失败fixture及刷新/重连已实际执行）
  - 本轮生产修复：ReceiptForm确认后禁重复提交；HumanAction online读取权威状态；卸载/状态或revision变更使旧请求代际失效，旧finally不释放新请求。保留成功asset refs/草稿和未知结果原key重试。
  - 实际验证：18 mounted ReactDOM/linkedom用例 PASS / 99 assertions；相关40 PASS / 238 assertions；integrator全Desktop786 PASS / 0 FAIL / 1 SKIP（含上述18），完整src及显式测试类型通过。网络/asset/409/拒绝补交、重新挂载/重连、两种迟到成功顺序及重叠新提交均有真实DOM驱动，非SSR替代。
  - 证据文件：[交互修复与RED/GREEN](docs/20261117-回执表单交互开发与验证.md)、[人工全链路/18需求/八问](docs/human-task-replay.md)、[新联合验证](../004-OutcomeGo整体项目/docs/20261117-开发任务收尾与验收边界.md)。
  - 边界与回滚：实际原生窗口/文件选择/设备/live server未观测；不承诺未保存File跨应用重启。撤本轮两组件/测试依赖增量，保留receipt/Evidence/资产。task65原本地缺口的历史结论见逐项记录历史段。
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

- [x] 4.1 现实任务 fixture 全流程回放（父场景 C）
  - 状态：DONE（2026-11-17，task70最终私有库隔离版 / task73；原固定场景每步请求、实际ID、结果具名归档完成）
  - 实际证据：[human-task-replay.md](docs/human-task-replay.md)及其中final3 JSON；Outcome `6e536ee3-f26d-43bd-b771-695fd61c969f`，25步请求、32/32检查，同Outcome含1Output/4Evidence/4Review。
  - 覆盖：knowledge search/read→trusted RequestHumanAction→开始/暂停/重开→缺材料UNVERIFIED及非法PASS拒绝→FAIL/拒绝历史→补交→唯一Review接受→同WorkItem/context继续→最终accepted。记录完整input/result/clientRequestId、card/receipt/Run/context及前台不变。
  - 执行边界：真实本地PG/生产服务/Worker.claim/Projection与settle；推理/Computer事件受控、现场材料虚构，不称真实模型/原生客户端/监听服务。原任务未要求把原生设备作为本地固定fixture完成前提。
  - 联合验证：最终隔离并集server9文件80 PASS / 0 FAIL / 460 assertions；task70独立2 PASS / 31 assertions，CLI19/32检查分列不重复加总。
  - 先依赖什么：3.3、3.4
  - 怎么算完成：资料检索、`RequestHumanAction`、动作卡开始/暂停、缺材料、驳回、补交、验收、Agent 子线程继续都有请求、ID 和结果。
  - 怎么验证：`docs/human-task-replay.md`
  - 对应需求：需求 1–7、需求 11–17
  - 对应设计：§40、§41

- [x] 4.2 Agent WorkItem 和普通聊天隔离回归
  - 状态：DONE（2026-11-17，task-65；最终真实 DB 跨阶段隔离及纯 Agent Review 路径已验）
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 最终验证命令：Runtime 四个完整后端包 `bun --no-env-file test --pass-with-no-tests`；六个实际故障 CLI（不带 --plan）；静态 fixture/合同/gate/目标语义检查。原 13 项最小检查及 --plan 仅为历史准备，不代替实际后继。
  - 最终验证结果：包内 cross-phase **11 PASS**、Review **16 PASS**，ordinary user/group/routine 不产生新 Outcome/人工事实，waiting_human 不被 finish/recovery 假完成；六 CLI **40/40 checks**，receipt-retry 验证前台 Run/lease/可见消息不变。四后端完整包 3988 PASS / 0 FAIL / 82 SKIP，skip 分列不改成 PASS。
  - 证据文件：[逐项验收 E1/E2/E3/E5](docs/20261117-逐项任务验收记录.md)、[最终后端本机结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)、[第3波历史脚手架](../004-OutcomeGo整体项目/docs/20261117-第3波回归脚手架交接.md)。
  - 已知限制：正式 `004.2` 研究试点真实 Bot、远端 CI/Computer/真实模型、安装及旧镜像未验；这与已验证的 CODE/DB 隔离依赖分别记录。历史失败保留，最终本地完整包零失败不宣称远端 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 先依赖什么：3.2
  - 怎么算完成：没有人工动作的 Outcome 仍按 `004.2` 路径完成；普通聊天不产生人工任务或资料记录。
  - 怎么验证：`004.2` 研究试点回归、event 断言
  - 对应需求：需求 15
  - 对应设计：§22

## 阶段 5：Explore（2026-11-17 负责人要求本轮实现）

- [x] 5.1 实现 ExploreIdea 和转 PlanningDraft
  - 状态：DONE（2026-11-17，task-65；原状态/独立转换/只读/不自动批准执行判据已有真实 DB、Desktop 组件/adapter/构建证据）
  - 实现提交：`d0eadb5d6`（contracts）、`01f437220`（schema）、`de5a12db8`（后端）、`f3ad396c3`（并发主体冲突）。
  - 修改文件：`packages/contracts/src/explore.ts`、exports、可选 OutcomeDetail 来源字段；`packages/db/prisma/schema.prisma`；`apps/server/src/services/explore-state.ts`、`explore-service.ts`、`outcome-planning-service.ts`、`outcome-service.ts`、`routes/explore.ts`、Explore contracts/routes/service 测试及对应冻结/设计文档。
  - 数据库变化：新增 ExploreIdea/ExploreIdeaStatus，独立 PlanningDraft FK 和真实转换 Outcome 双向可选关联；不删除或重命名已有表/列，不写 migration 文件。
  - 验证命令：最终完整 server、contracts、Desktop 包；完整七包类型；Desktop 真实 renderer/Electron/helper 生产 bundle。准确命令和原始日志 SHA 见逐项记录 E1/E3/E4。
  - 验证结果：最终包内 Explore **7 项真实 DB 全部 PASS**，包括独立新 Outcome pending_approval、原 Contract 不变、零 Run、丢弃/并发/失败重试和转换回滚；Desktop 只读历史 SSR、真实 transport terminal 502 重试 3 项及完整包通过。原“7 DB 未运行”不再是当前状态。
  - 证据文件：[逐项验收 5.1 行及 E3/E4](docs/20261117-逐项任务验收记录.md)、[Explore 后端交付历史](docs/20261117-Explore后端实现与验证.md)、[最终组合总账](../004-OutcomeGo整体项目/docs/20261117-全规格组合验证与修复记录.md)。
  - 已知限制：AppService/main 的 ExploreService/routes 已真实装配；真实模型、原生客户端 Propose→确认→独立批准联验和有 Explore 数据的完整回退尚 PENDING，不将本地转换证明扩大为这些外部门通过。
  - 回滚方式：先撤销装配，再按本线提交撤销接口/服务，保留实际已有探索/交付数据，不在回滚时删除表。
  - Desktop 进度：DONE（2026-11-17，本任务本地代码/组件/transport/完整类型及生产构建已验；真实原生客户端全程与正式外部验收 PENDING）。
  - Desktop 实现提交：`4ed536b33`；冻结 Explore 合同原始提交 `d0eadb5d6`。
  - Desktop 修改文件：`outcomes/explore/{explore-api.ts,explore-panel.tsx}`、`planning/planning-wizard.tsx` 的可选预算桥接、Inbox 工作区/最小 API/本地化接线。
  - Desktop 数据库变化：无；后端模型与转换事务由产品线拥有。
  - Desktop 验证：最终完整包 768 PASS / 0 FAIL / 1 SKIP；只读历史与版本 SSR、Explore 请求重试 3 PASS 已执行，完整类型/真实 bundle 通过。源码 PlanningWizard 保留创建与明确批准两步；真实原生客户端 Propose→PlanningDraft→确认→新 Outcome 全程观察仍 PENDING。
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

- [x] 6.1 Spec 最终检查点
  - 状态：DONE（2026-11-17，task73；原需求1–18、provider/回执/Evidence/移动/失败矩阵及父八问证据齐）
  - 退出依据：3.3已实际mounted失败/刷新重连验证；4.1具名全流程已交付；4.2隔离与5.1 Explore均DONE，原显式前置满足。
  - 完整矩阵：[human-task-replay.md](docs/human-task-replay.md)逐条18需求、失败行为和父design§34八问；[当前逐项报告](docs/20261117-逐项任务验收记录.md)保留判据/执行者归属；Explore本轮未延期。
  - 当前证据：真实provider范围/资料读取、receipt/Evidence原子事务/资产持久保留、双来源/同线程、移动只读源码及Android43+86/Swift329原始平台证明、本轮18DOM及32checks、72有数据恢复；不将原生/远端实际观察冒称PASS。
  - 已知限制：真实Bot/provider/挂载、原生设备/UI/live API、完整iOS App、远端CI/发布和旧镜像回退仍分别PENDING。本任务标准要求证据矩阵和八问，不新增“所有平台live PASS”条件；004.4本地Spec退出不豁免父/其他子Spec正式前置。
  - 先依赖什么：4.1、4.2；5.1 完成或明确延期
  - 怎么算完成：需求 1–18（Explore 延期时需求 4、8、14 记为延期并写入 Out of Scope）、provider scope、回执、Evidence、移动端和失败矩阵都有证据；按父 design §34 回答八个问题。
  - 怎么验证：requirements/design/tasks 三向核对
  - 对应需求：全部需求
  - 对应设计：全文
