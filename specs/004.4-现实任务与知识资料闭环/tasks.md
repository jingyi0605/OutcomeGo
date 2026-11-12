# 任务清单 - 现实任务与知识资料闭环（人话版）

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

## 阶段 0：资料、文件和项目范围基线

- [ ] 0.1 盘点现有资料和 asset 入口
  - 状态：TODO
  - 先依赖什么：`004.2` 最终检查点
  - 这一步到底做什么：确认 AgentFileState、asset-service、asset-store、ChannelMessage attachment 和现有文件权限的真实调用路径。
  - 做完你能看到什么：`docs/knowledge-capability-matrix.md`，列出来源、scope、版本、读取入口和错误。
  - 开始前先看：`apps/computer/src/agent-store/`、`apps/server/src/services/asset-service.ts`、`packages/messaging/src/asset-store.ts`、`apps/server/src/services/channel-service.ts`
  - 主要改哪里：`docs/knowledge-capability-matrix.md`
  - 这一步先不做什么：不接入 X-File 或新的外部知识库。
  - 怎么算完成：选定一个 fixture provider 和一个当前仓库可读的 provider。
  - 怎么验证：源码审查、fixture read、scope/permission tests。
  - 对应需求：需求 5、需求 9、需求 10
  - 对应设计：`design.md` §6、§28、§29

- [ ] 0.2 固定现实任务 fixture 和回执材料
  - 状态：TODO
  - 先依赖什么：0.1
  - 主要改哪里：`docs/human-task-fixture.json`、references、asset fixture
  - 这一步先不做什么：不使用真实客户资料、真实照片或生产设备。
  - 怎么算完成：资料、动作卡、缺材料、驳回、补交、通过路径都有固定输入。
  - 怎么验证：fixture schema 和人工回放。
  - 对应需求：需求 7、需求 11、需求 12、需求 13
  - 对应设计：`design.md` §40、§41

- [ ] 0.3 确定 project scope 解析方式
  - 状态：TODO
  - 先依赖什么：0.1
  - 主要改哪里：`docs/knowledge-capability-matrix.md`、`knowledge-scope-service` 设计记录
  - 这一步先不做什么：不把最近打开项目或模型猜测作为唯一 scope。
  - 怎么算完成：记录 project/channel/bot/fixture scope 的优先级和缺失行为。
  - 怎么验证：跨项目 sourceRef 测试。
  - 对应需求：需求 5、需求 10
  - 对应设计：`design.md` §15、§30

## 阶段 1：KnowledgeProvider

- [ ] 1.1 定义 provider、scope、reference 和错误合同
  - 状态：TODO
  - 先依赖什么：0.3
  - 主要改哪里：`packages/contracts/src/knowledge.ts`、provider service
  - 这一步先不做什么：不把全文缓存和 provider token暴露给客户端。
  - 怎么算完成：search/read、scope、stale、digest 和稳定错误码可序列化。
  - 怎么验证：contracts typecheck/test、provider contract tests。
  - 对应需求：需求 5、需求 9、需求 10、需求 16
  - 对应设计：`design.md` §7、§13、§14、§44

- [ ] 1.2 实现 FixtureKnowledgeProvider
  - 状态：TODO
  - 先依赖什么：1.1
  - 主要改哪里：`apps/server/src/services/fixture-knowledge-provider.ts`、fixture tests
  - 这一步先不做什么：不允许生产默认使用 fixture provider。
  - 怎么算完成：测试可查询、读取、返回版本和 digest，并能注入 timeout/stale/permission error。
  - 怎么验证：provider unit/integration tests。
  - 对应需求：需求 9、需求 16
  - 对应设计：`design.md` §28、§40、§41

- [ ] 1.3 实现 ProjectFileKnowledgeProvider
  - 状态：TODO
  - 先依赖什么：1.1、0.1
  - 主要改哪里：`knowledge-file-provider.ts`、`knowledge-scope-service.ts`、asset/file adapters
  - 这一步先不做什么：不跨项目全文搜索。
  - 怎么算完成：当前 scope 下可检索和读取文件/消息引用，返回 sourceRef/version/digest。
  - 怎么验证：scope、permission、stale、unreadable source tests。
  - 对应需求：需求 5、需求 9、需求 10、需求 16
  - 对应设计：`design.md` §15、§29、§43

## 阶段 2：Human WorkItem 和动作卡

- [ ] 2.1 设计并实现 Human WorkItem 状态/迁移
  - 状态：TODO
  - 先依赖什么：0.2、`004.2` WorkItem 模型
  - 主要改哪里：`packages/contracts/src/human-work.ts`、`packages/db/prisma/schema.prisma`、migration
  - 这一步先不做什么：不复制 Agent Run 状态机，不自动执行现场命令。
  - 怎么算完成：pending/ready/in_progress/paused/submitted/review_pending/accepted/rejected/cancelled 可持久化。
  - 怎么验证：DB migration、state transition、revision conflict tests。
  - 对应需求：需求 6、需求 11、需求 15
  - 对应设计：`design.md` §16、§18、§32

- [ ] 2.2 实现动作卡 API
  - 状态：TODO
  - 先依赖什么：2.1、1.3
  - 主要改哪里：`apps/server/src/routes/human-work.ts`、`human-work-service.ts`
  - 这一步先不做什么：不把客户端提交的 status 当作可信状态。
  - 怎么算完成：list/detail/start/pause/resume API 具有 owner、revision、状态条件和幂等。
  - 怎么验证：API route/service/concurrency tests。
  - 对应需求：需求 6、需求 11
  - 对应设计：`design.md` §17、§33

- [ ] 2.3 实现 Desktop 动作卡和资料引用
  - 状态：TODO
  - 先依赖什么：2.2、1.3
  - 主要改哪里：`HumanActionCard.tsx`、`KnowledgeReferences.tsx`、API client
  - 这一步先不做什么：不默认展示完整资料正文。
  - 怎么算完成：目的、前置条件、步骤、资料、输入和 Evidence 要求可读；刷新后状态恢复。
  - 怎么验证：Desktop typecheck、component/browser tests、offline/reopen fixture。
  - 对应需求：需求 6、需求 10、需求 15
  - 对应设计：`design.md` §17、§24、§39

## 阶段 3：Receipt、Evidence 和 Review

- [ ] 3.1 实现 asset/reference 校验和 receipt submit
  - 状态：TODO
  - 先依赖什么：2.2、现有 asset service
  - 主要改哪里：`human-receipt-service.ts`、receipt route、asset adapter、contracts
  - 这一步先不做什么：不直接保存无归属本地路径。
  - 怎么算完成：文本、asset refs、source refs、observations 支持幂等提交。
  - 怎么验证：asset owner、work item owner、same key/hash、different hash tests。
  - 对应需求：需求 7、需求 12、需求 16
  - 对应设计：`design.md` §18、§19、§34

- [ ] 3.2 实现 Evidence 关联和逐项 Review
  - 状态：TODO
  - 先依赖什么：3.1、`004.2` Review service
  - 主要改哪里：`outcome-review-service.ts`、Evidence/Review models、review UI
  - 这一步先不做什么：不把 Agent 说明或外部不可读 URL自动标 PASS。
  - 怎么算完成：criterion、Evidence、reviewer、revision、digest 和结果可反查。
  - 怎么验证：missing/stale/rejected/resubmit/accepted tests。
  - 对应需求：需求 7、需求 13、需求 15
  - 对应设计：`design.md` §20、§35

- [ ] 3.3 实现 Receipt/Review 客户端错误恢复
  - 状态：TODO
  - 先依赖什么：3.1、3.2
  - 主要改哪里：Desktop receipt form、asset upload state、review status
  - 这一步先不做什么：不清空已上传资产和已填写草稿。
  - 怎么算完成：网络失败、asset 失败、revision conflict、rejected 和 retry 状态可见。
  - 怎么验证：UI failure fixtures、refresh/reconnect tests。
  - 对应需求：需求 7、需求 11、需求 12、需求 13、需求 16
  - 对应设计：`design.md` §24、§43、§44

## 阶段 4：Explore/Delivery

- [ ] 4.1 实现 ExploreIdea 生命周期
  - 状态：TODO
  - 先依赖什么：1.2、2.1
  - 主要改哪里：Explore model/service/route、contracts、DB migration
  - 这一步先不做什么：不把 ExploreIdea 直接变成 approved Outcome。
  - 怎么算完成：draft/exploring/proposed/converted/discarded 状态和来源引用可查。
  - 怎么验证：state transition、discard、source reference tests。
  - 对应需求：需求 8、需求 14
  - 对应设计：`design.md` §21、§38

- [ ] 4.2 实现 Explore → PlanningDraft 转换
  - 状态：TODO
  - 先依赖什么：4.1、`004.2` Planning API
  - 主要改哪里：propose route、Planning client、sourceExploreId 关联
  - 这一步先不做什么：不修改已有 approved Contract。
  - 怎么算完成：转换产生新 PlanningDraft/Outcome，原 Explore 只读。
  - 怎么验证：conversion and end-to-end fixture。
  - 对应需求：需求 8、需求 14、需求 15
  - 对应设计：`design.md` §21、§38

### 最终检查增强项

- [ ] 4.3 现实任务 fixture 全流程回放
  - 状态：TODO
  - 先依赖什么：1.2、2.3、3.2、4.2
  - 怎么算完成：资料、动作卡、开始/暂停、缺材料、驳回、补交、验收和 Outcome continuation 全部有证据。
  - 怎么验证：`docs/human-task-fixture.json`、server integration、Desktop replay。
  - 对应需求：全部需求
  - 对应设计：`design.md` §40、§41

- [ ] 4.4 普通 Agent WorkItem 回归
  - 状态：TODO
  - 先依赖什么：2.1、3.2
  - 怎么算完成：Agent WorkItem 不被 Human 状态、receipt 或资料 provider 改变。
  - 怎么验证：Outcome 004.2 research pilot regression。
  - 对应需求：需求 15
  - 对应设计：`design.md` §22

- [ ] 4.5 Spec 最终检查点
  - 状态：TODO
  - 先依赖什么：4.3、4.4
  - 怎么算完成：需求 1–12、provider scope、human receipt、Evidence、Explore 和失败矩阵全部有实现或明确 PENDING 证据。
  - 怎么验证：逐项核对 `requirements.md`、`design.md`、fixture 和任务记录。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 5：交付证据和回归验证

- [ ] 5.1 固化 KnowledgeProvider 合同测试矩阵
  - 状态：TODO
  - 先依赖什么：1.1、1.2、1.3
  - 这一步到底做什么：用同一组 query、scope、sourceRef、版本和错误输入验证 FixtureProvider 与 ProjectFileProvider 的行为一致。
  - 主要改哪里：`packages/contracts/test/knowledge-provider.contract.test.ts`、`apps/server/test/knowledge/`
  - 这一步先不做什么：不把具体 provider 的特殊字段写入通用合同。
  - 怎么算完成：搜索、读取、重复、stale、越权、超时和不可读来源均有预期结果。
  - 怎么验证：provider contract test、scope isolation test、错误码快照。
  - 对应需求：需求 1、需求 5、需求 9、需求 10、需求 16
  - 对应设计：`design.md` §7、§13、§15、§28–§30

- [ ] 5.2 验证资料引用进入 Agent context 的边界
  - 状态：TODO
  - 先依赖什么：1.3、`004.2` Agent context 设计
  - 这一步到底做什么：检查引用 ID、版本、digest、适用范围和摘要进入 context，正文读取仍由服务端按范围执行。
  - 主要改哪里：Agent context builder、引用 serializer、fixture prompt。
  - 这一步先不做什么：不复制全文缓存，不让客户端提交任意 sourceRef。
  - 怎么算完成：同项目引用可进入 context，跨项目和 stale 引用只能进入待核验状态。
  - 怎么验证：context snapshot、cross-scope negative test、stale fixture。
  - 对应需求：需求 1、需求 5、需求 10、需求 16
  - 对应设计：`design.md` §14、§15、§31、§43

- [ ] 5.3 验证 Human WorkItem 状态机和 revision 条件
  - 状态：TODO
  - 先依赖什么：2.1、2.2、2.3
  - 这一步到底做什么：逐项检查开始、暂停、恢复、提交、Review、驳回、补交、接受和取消的合法转换。
  - 主要改哪里：状态机测试、human-work service、数据库约束测试。
  - 这一步先不做什么：不通过直接更新数据库状态绕过服务层。
  - 怎么算完成：非法转换被拒绝，旧 revision 提交返回 conflict，重试不会重复写入。
  - 怎么验证：state transition、concurrency、idempotency integration tests。
  - 对应需求：需求 2、需求 3、需求 6、需求 11、需求 12
  - 对应设计：`design.md` §16–§19、§33–§35

- [ ] 5.4 验证人工回执和 Evidence 的完整对账
  - 状态：TODO
  - 先依赖什么：3.1、3.2、3.3
  - 这一步到底做什么：从 receipt 提交到 criterion Review，核对 WorkItem、Outcome、Contract revision、asset 和 reviewer 的全部关联。
  - 主要改哪里：receipt/review integration fixtures、审计查询、Desktop Review 页面。
  - 这一步先不做什么：不把 Agent 输出、外部链接或缺少材料的回执自动视为事实。
  - 怎么算完成：缺材料、stale、驳回、补交、接受和历史保留均可追溯。
  - 怎么验证：evidence reconciliation query、accept/reject replay、asset retention test。
  - 对应需求：需求 3、需求 7、需求 13、需求 15、需求 16
  - 对应设计：`design.md` §18–§20、§34–§36、§43

- [ ] 5.5 验证 Explore 到 Delivery 不污染已批准 Contract
  - 状态：TODO
  - 先依赖什么：4.1、4.2
  - 这一步到底做什么：检查探索保存、建议、转换、取消和再次打开时的来源关系及只读边界。
  - 主要改哪里：Explore service、Planning route、conversion fixture。
  - 这一步先不做什么：不直接修改 approved Contract，不为探索自动创建 Run。
  - 怎么算完成：转换生成新的 PlanningDraft/Outcome，原 ExploreIdea 保持可读且不可变。
  - 怎么验证：state transition、conversion transaction、approved Contract snapshot。
  - 对应需求：需求 4、需求 8、需求 14
  - 对应设计：`design.md` §21、§37–§39

- [ ] 5.6 执行完整现实任务 fixture 回放
  - 状态：TODO
  - 先依赖什么：5.1、5.2、5.3、5.4、5.5
  - 这一步到底做什么：按固定顺序回放资料检索、动作开始、暂停、回执缺口、补交、Review、接受和 Outcome continuation。
  - 主要改哪里：`docs/human-task-fixture.json`、`docs/human-task-replay.md`、server/Desktop replay harness。
  - 这一步先不做什么：不使用生产账号、真实客户资料或现场设备。
  - 怎么算完成：每一步都有请求、响应、业务 ID、状态和证据文件。
  - 怎么验证：fixture schema、server integration replay、Desktop browser replay。
  - 对应需求：全部需求
  - 对应设计：`design.md` §40、§41

- [ ] 5.7 执行普通 Agent WorkItem 隔离回归
  - 状态：TODO
  - 先依赖什么：5.3、5.4、`004.2` 最终检查点
  - 这一步到底做什么：确认新增 Human WorkItem、资料引用和 receipt 流程不会改变普通 Agent WorkItem 的状态和验收。
  - 主要改哪里：`004.2` research pilot regression、普通 WorkItem 查询和事件测试。
  - 这一步先不做什么：不复制或重写 Agent Run 生命周期。
  - 怎么算完成：普通任务仍按既有路径完成，数据库没有新增 Human receipt 或资料范围记录。
  - 怎么验证：baseline comparison、event assertion、ordinary-task end-to-end replay。
  - 对应需求：需求 2、需求 3、需求 15
  - 对应设计：`design.md` §22、§35

- [ ] 5.8 生成资料和人工回执的发布证据
  - 状态：TODO
  - 先依赖什么：5.6、5.7
  - 主要改哪里：`docs/release-evidence.md`、fixture report、migration report。
  - 这一步先不做什么：不把未执行的设备或外部 provider 验证标记为 PASS。
  - 怎么算完成：每条需求有验证命令、结果、证据路径、PENDING 原因和回滚方法。
  - 怎么验证：报告 schema 检查、需求/设计/任务三向核对。
  - 对应需求：全部需求
  - 对应设计：`design.md` §25、§40–§45

- [ ] 5.9 现实任务 Spec 最终交付检查
  - 状态：TODO
  - 先依赖什么：5.6、5.7、5.8
  - 这一步到底做什么：确认 requirements、design、tasks、fixture、迁移和回放证据共同支持父 Spec 进入下一阶段。
  - 主要改哪里：本 Spec 全部文档和 `docs/` 证据索引。
  - 这一步先不做什么：不在最终检查时追加未评审的 provider 或自动执行能力。
  - 怎么算完成：需求 1–12、失败矩阵、普通 Agent 回归和回滚说明均已回填。
  - 怎么验证：文档链接、编号唯一性、fixture replay 和父 Spec 场景 C 回放。
  - 对应需求：全部需求
  - 对应设计：全文

