# 任务清单 - 运行时恢复与版本验收（人话版）

2026-11-17 task73 当前开发更新：当前原十项仍7DONE/3开放。task72实际同版恢复已补Planning/Explore从0行到4Planning/3Explore/2Outcome，14/14检查/86表123FK；[完整证据](docs/20261117-规划探索数据备份回放开发与验证.md)与源字节匹配。3.4剩余是实际入口切换/两种回退或旧镜像，不再写“没有有数据备份开发”。父具名A–H及release报告已交付；4.1/4.2原指定最终前置未闭，继续开放。X5人工UI本地缺口已由task69实际18 mounted测试关闭，C完整链由task70 final3补齐；保留外部平台观测PENDING。

状态：IN_PROGRESS（最终本机组合回归已通过；真实远端/provider、跨客户端安装/设备、CI 与完整旧镜像回退未验，整体发布不放行）

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

2026-11-17 task-66 逐项验收：原十项未勾选任务新增 **7 DONE（1.1、1.2、1.3、2.1、2.2、2.3、3.2）**，保留 **3 OPEN（3.4、4.1、4.2）**；连同原有四项共 **11 DONE / 3 OPEN**。详见[逐项任务验收记录](docs/20261117-逐项任务验收记录.md)：十项原文标准与证据、完整发布/跨客户端及004.1遗留矩阵、父A–H、十五条需求回写和父§34八问。3.2为报告完成，真实安装/设备子项仍PENDING；4.1报告和4.2文档内容已齐，但明确前置未关闭，不能形成正式退出或发布PASS。以下旧检查点“未执行/待装配”不覆盖最新逐项证据，原始失败记录不删除。

2026-11-17 整理：恢复对象改为“WorkItem + 子线程运行组”，不建 checkpoint 表（D17）；事件去重使用 `IdempotencyRecord`（D18）；“旧版本升级”改为新安装和手动备份导入；合并了原先重复的普通 Run 隔离（4.1/6.1）、跨客户端矩阵（3.2/5.2）、父场景回放（3.1/7.1）和最终检查（3.3/5.3/7.2）。

分波及测试替身合同：[父接口冻结文档](../004-OutcomeGo整体项目/docs/parallel-interfaces.md)。需求见 [requirements.md](requirements.md)，业务设计见 [design.md](design.md)；本次只调整任务前置关系。

## 阶段 0：运行时能力审计

- [x] 0.1 盘点恢复相关设施
  - 状态：DONE（2026-11-17，源码审计完成；不表示运行回放通过）
  - 实现提交：`6aae513e6`、`ee85a7977`；审计文档提交由 `git log -1 -- docs/runtime-recovery-matrix.md` 查询。
  - 修改文件：`docs/runtime-recovery-matrix.md`、`docs/20261117-恢复运行时实现与验证记录.md`。
  - 数据库变化：本审计无；任务 1.1 单独添加两个计数列。
  - 验证命令：源码和冻结接口逐项审查；`git diff --check`。
  - 验证结果：D17 成立，design §27 每个故障点均已关联代码或所属线入口；数据库回放 PENDING。
  - 证据文件：[能力矩阵](docs/runtime-recovery-matrix.md)、[实现与验证](docs/20261117-恢复运行时实现与验证记录.md)。
  - 已知限制：没有执行完整 Worker/Routine 回归，未产生外部验收 PASS。
  - 回滚方式：撤销审计文档提交；不改运行数据。
  - 这一步到底做什么：确认 `startup-recovery.ts`、`BotRunLease`、Routine 运行组恢复、`IdempotencyRecord` 和 `004.2` 子线程结算的真实行为，确认 D17 是否成立。
  - 做完你能看到什么：`docs/runtime-recovery-matrix.md`。
  - 先依赖什么：第 0 波 B、`004.2` 任务 3.2、3.4（第 2 波线 6，不等待最终检查点）。
  - 开始前先看：design §1、§7、§12、§17；`004.2/docs/runtime-capability-matrix.md`
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不引入新的队列、编排器或权限平台。
  - 怎么算完成：每个故障注入场景（§27）都有现有代码入口或明确新增文件。
  - 怎么验证：源码审查；现有 `apps/server/test/*recovery*`、worker 生命周期测试
  - 对应需求：需求 1、需求 5、需求 6、需求 15
  - 对应设计：§1、§7–§12

## 阶段 1：子线程恢复

- [x] 1.1 增加 WorkItem 恢复字段和恢复视图
  - 状态：DONE（2026-11-17，task-66；现有字段计算视图、两计数列及合同序列化已完成，本机实际schema部署和完整类型通过）。
  - 最新验收：contracts完整194 PASS，七包完整类型、真实schema部署通过；来源、命令与raw SHA见[逐项记录§1–2](docs/20261117-逐项任务验收记录.md#2-十项任务逐项判定)。不新增checkpoint表、不写Run.requestProgress。正式部署库未操作，不将本机结果称为生产migration。
  - 以下实现提交/聚焦验证为代码交付时历史；当时“数据库部署和整包typecheck PENDING”已由最新组合证据替代。
  - 实现提交：`943bbebca`、`8fa19b037`；服务映射 `6aae513e6`、`ee85a7977`。
  - 修改文件：`packages/db/prisma/schema.prisma`、`packages/contracts/src/outcome-runtime.ts`、contracts 导出、`outcome-recovery-service.ts`。
  - 数据库变化：仅 `OutcomeWorkItem.retryCount/recoveryCount Int @default(0)`；无检查点表和迁移目录。
  - 验证命令/结果：Prisma generate 成功；新增合同/路由合计 4 PASS、21 断言；8 个变更文件语义诊断为 0。数据库部署和整包 typecheck PENDING。
  - 证据文件：[实现与验证](docs/20261117-恢复运行时实现与验证记录.md)。
  - 已知限制：未将生成成功描述为数据库部署成功。
  - 回滚方式：撤销本线实现提交，保留已落库列和审计数据。
  - 先依赖什么：0.1
  - 主要改哪里：`packages/db/prisma/schema.prisma`（`OutcomeWorkItem.retryCount`、`recoveryCount`）、`packages/contracts/src/outcome-runtime.ts`（`OutcomeRecoveryView`）
  - 这一步先不做什么：不新建 checkpoint 表；不写入 `Run.requestProgress`。
  - 怎么算完成：恢复视图能从现有字段计算；序列化测试通过。
  - 怎么验证：`bun --filter @outcomego/db typecheck`、contracts 测试
  - 对应需求：需求 5、需求 9
  - 对应设计：§1、§8

- [x] 1.2 接入启动恢复
  - 状态：DONE（2026-11-17，task-66；按规定本机fixture实际验证重结算、原线程最多两次恢复、等待保持、needs_review及recovered事件）。
  - 最新验收：messaging12项、server4项、worker4项恢复数据库案例已实际纳入最终完整包；另九项专库恢复与六CLI共40/40 checks通过。共享Decision构造/有效approved执行谓词已集成，活租约/停止确认/取消队列头及非阻塞claim有真实断言。详见[逐项记录§1–2](docs/20261117-逐项任务验收记录.md#2-十项任务逐项判定)。
  - 依赖/边界：004.2运行组实现已集成并通过本机验证，3.4已按自身本地结算标准DONE；其3.1/3.2/7.1真实Bot/远端租约与scoped stop及研究试点门槛仍未关闭，不把本地executor退出冒充远端证明。
  - 以下最小检查与“20项未执行”为交付时历史，已被实际组合回放替代。
  - 第 3 波核验修复（2026-11-17）：原生任务 34 修复候选优先级与全局停止 UUID 顺序冲突；代码 `8be7c16b9`。真实冻结基线两个新增案例重现 `40P01` 和前台超时，修复后新增 2 项及既有 Worker 4 项合计 6 PASS、22 断言；原先其他数据库案例和全局验收不据此放行。见[领取锁顺序修复与验证](docs/20261117-领取锁顺序修复与验证.md)。
  - 实现提交：`6aae513e6`、`ee85a7977`；测试 `d4275f9c8`。
  - 修改文件：`startup-recovery.ts`、Worker 恢复/心跳/claim 区块、共享 `outcome-recovery.ts`、`outcome-threads.ts`、三个数据库测试文件。
  - 数据库变化：复用任务 1.1 两列，无其他变化。
  - 验证命令/结果：精确变更文件语义诊断 0；20 项新增数据库/生命周期案例尚未执行，按要求等待全部代码集成。
  - 证据文件：[能力矩阵](docs/runtime-recovery-matrix.md)、[实现与验证](docs/20261117-恢复运行时实现与验证记录.md)。
  - 已知限制：共享 Decision 构造与 pending-only revision 谓词必须同步集成线 3 原始依赖。
  - 回滚方式：先关闭新 Outcome 派发，保留运行组和事实；逆序撤销本线代码提交。
  - 先依赖什么：1.1、`004.2` 任务 3.2、3.4；依照冻结接口恢复同一子线程。
  - 主要改哪里：`apps/server/src/services/startup-recovery.ts`、`apps/server/src/services/outcome-recovery-service.ts`（新增）、`packages/messaging/src/outcome-threads.ts`
  - 这一步先不做什么：不盲目重跑所有 `running` 的 WorkItem；不触碰主对话租约。
  - 怎么算完成：按 §17.2 重新结算、在同一子线程续跑（最多 2 次）、保持等待或进入 `needs_review`；写 `outcome.recovered` 事件。
  - 怎么验证：进程重启 fixture、租约过期、旧 revision、连续中断测试
  - 对应需求：需求 1、需求 5、需求 15
  - 对应设计：§12、§17、§32

- [x] 1.3 实现恢复查询和 reconcile
  - 状态：DONE（2026-11-17，task-66；AppService和实际公共路由装配已完成，查询/幂等reconcile/原因脱敏实际DB与handler测试通过）。
  - 最新验收：`OutcomeRecoveryService` 已由AppService构造，`routes/outcome.ts`实际装配GET recovery/POST reconcile；四项recovery service DB案例全部通过，包含actual startup/幂等/私密内容排除。见[逐项记录§2](docs/20261117-逐项任务验收记录.md#2-十项任务逐项判定)；真实live API/UI仍PENDING。
  - 以下服务交付时历史保留；“公共路由待装配/测试未跑”不再是当前状态。
  - 实现提交：`6aae513e6`、`ee85a7977`。
  - 修改文件：新增 `apps/server/src/services/outcome-recovery-service.ts`；公共 `routes/outcome.ts` 留集成者。
  - 数据库变化：none。
  - 验证命令/结果：聚焦语义诊断 0；幂等对账、真实 startup、脱敏数据库案例已增加，未运行。
  - 证据文件：[集成接口与验证记录](docs/20261117-恢复运行时实现与验证记录.md)。
  - 已知限制：未将独立服务实现描述为公共 HTTP 路由已生效。
  - 回滚方式：撤销服务与装配；不删除 WorkItem/Decision/输出。
  - 先依赖什么：1.2
  - 主要改哪里：`apps/server/src/routes/outcome.ts`（`GET /recovery`、`POST /reconcile`）
  - 这一步先不做什么：不提供绕过状态前置条件的强制成功接口。
  - 怎么算完成：可以看到原因、运行组状态和建议动作；reconcile 幂等。
  - 怎么验证：中断、旧 revision、状态不一致 fixture
  - 对应需求：需求 9、需求 11
  - 对应设计：§24、§25、§35、§45

## 阶段 2：幂等、路由和指标

- [x] 2.1 复核 Outcome 业务幂等和事件去重
  - 状态：DONE（2026-11-17，task-66；run/review/resolve/receipt/notification/event实际重复与并发回放通过，D18和业务终态围栏保留）。
  - 最新验收：线3/4持久事实与消费者已集成；messaging/server完整DB回归、事件保留及CLI duplicate8/concurrent5/receipt9项checks通过；原key/hash冲突、处理中和完成响应有测试。证据见[逐项记录§1–2](docs/20261117-逐项任务验收记录.md#2-十项任务逐项判定)。真实provider发送/查询仍PENDING，不删除幂等审计。
  - 以下源码审计/“新回放未执行”为交付时历史，已由实际新代码组合验证替代。
  - 实现提交：`6aae513e6`、`d4275f9c8`、`ee85a7977`；跨线依赖见能力矩阵。
  - 修改文件：`outcome-recovery.ts`、`outcome-threads.ts`、新增恢复/指标测试与能力矩阵。
  - 数据库变化：none，复用 `IdempotencyRecord` 和业务唯一键。
  - 验证命令/结果：源码复核 run/review/resolve/receipt/notification/consumer；新增回放尚未执行，不声明最终去重通过。
  - 证据文件：[幂等审计](docs/runtime-recovery-matrix.md)。
  - 已知限制：线 2/3/4 完整功能和事件保留由各 owner/集成者完成，不能以旧基线覆盖新代码。
  - 回滚方式：撤销本线补充，保留历史业务事实与幂等记录。
  - 先依赖什么：0.1、`004.3` 任务 1.4
  - 主要改哪里：Outcome、Decision、人工任务服务和事件消费者
  - 这一步先不做什么：不替换现有消息幂等机制。
  - 怎么算完成：重复 run、review、decision resolve、receipt、notification 和重复事件都不产生第二个结果；事件消费者使用 `IdempotencyRecord(scope="outcome-event:<handler>")`。
  - 怎么验证：并发请求、hash 冲突、处理中、已完成和重复事件回放
  - 对应需求：需求 2、需求 6
  - 对应设计：§9、§19、§20、§37、§38

- [x] 2.2 实现 WorkItem 下一步路由
  - 状态：DONE（2026-11-17，task-66；§11五种持久事实的产品路由及规定单测通过，Decision/Human真实服务路径已集成本机验证）。
  - 最新验收：`five durable workflow facts route to their actual product owner`实际通过；Decision/Human构造、receipt/统一Review后一次continuation已通过实际DB与CLI。详见[逐项记录§2](docs/20261117-逐项任务验收记录.md#2-十项任务逐项判定)。不分类或拦截工具，真实现场动作/客户端父场景仍PENDING。
  - 以下4项纯检查及“全链路待集成”为交付时历史，不代替当前组合验证。
  - 实现提交：`6aae513e6`、`d4275f9c8`、`ee85a7977`。
  - 修改文件：共享 `outcome-recovery.ts:routeOutcomeNextStep`、Server 恢复查询、纯路由测试。
  - 数据库变化：none。
  - 验证命令/结果：`bun test packages/contracts/test/outcome-runtime.test.ts packages/messaging/test/outcome-recovery.test.ts`，合计 4 PASS、21 断言。
  - 证据文件：[实现与验证](docs/20261117-恢复运行时实现与验证记录.md)。
  - 已知限制：没有分类或拦截工具；人工动作实际联调留组合阶段。
  - 回滚方式：撤销事实路由与查询映射，不改业务对象。
  - 先依赖什么：1.2、`004.3` 任务 1.3；人工动作路由真实联调依赖 `004.4` 2.1、3.2。
  - 主要改哪里：`outcome-recovery-service.ts`
  - 这一步先不做什么：不分类或拦截 Agent 的工具调用。
  - 怎么算完成：§11 表中五种事实各有对应路由和测试。
  - 怎么验证：路由单测
  - 对应需求：需求 3、需求 7、需求 8
  - 对应设计：§11、§23

- [x] 2.3 实现指标和注意力时间上报
  - 状态：DONE（2026-11-17，task-66；聚合/attention公共路由和Desktop三surface生产者均已集成，规定指标fixture与T为空测试实际通过）。
  - 最新验收：四项recovery service DB案例覆盖attention空值/去重/hash冲突、N/Q/通知比例/追溯；Desktop attention四测试及完整768/0/1通过。native active/visible、document focus/visibility、intersection共同限定前台；planning创建前缓冲绑定、原key重试、300秒上限已有断言。见[逐项记录§2/§5](docs/20261117-逐项任务验收记录.md#2-十项任务逐项判定)。
  - 范围限制：live UI计时、provider日志、普遍PII和latency percentile未观察；T无样本null，缺持久重复次数来源时duplicateEventCount=null，不估算。以下“Desktop/公共路由/DB fixture未集成执行”为历史。
  - 实现提交：`943bbebca`、`8fa19b037`、`6aae513e6`、`d4275f9c8`、`ee85a7977`。
  - 修改文件：运行时合同、`outcome-recovery-service.ts`、指标与计时回归；Desktop 由客户端 owner 实现。
  - 数据库变化：none；计时增量保存在原 `IdempotencyRecord`，不新增指标事件。
  - 验证命令/结果：计时合同聚焦测试通过；null/重复/hash 冲突/N/Q/通知比例/变更追溯数据库测试已写，未运行。
  - 证据文件：[集成接口与验证记录](docs/20261117-恢复运行时实现与验证记录.md)。
  - 已知限制：T 无样本为 null；没有持久重复次数来源时 `duplicateEventCount=null`；不可把日志收据数当作重复事件数。
  - 回滚方式：停止客户端计时上报、撤销聚合服务；不清理业务事实。
  - 先依赖什么：2.1
  - 主要改哪里：Outcome 指标聚合查询、Desktop 规划/Decision/验收页面的前台计时上报接口
  - 这一步先不做什么：不建 dashboard，不设目标值，不新增指标事件。
  - 怎么算完成：N/T/Q、非必要通知比例、变更追溯率可按 Outcome 导出；客户端未上报时 T 为空。
  - 怎么验证：指标 fixture；T 为空测试
  - 对应需求：需求 9、需求 13
  - 对应设计：§26、§40

## 阶段 3：全项目验收和发布

- [x] 3.1 普通 Run 和主对话恢复隔离回归
  - 状态：DONE（2026-11-17，task-30；普通 Run/main/group/Routine 本机恢复隔离完整回归与九项专库实跑通过，不代替真实远端或客户端验收）
  - 最终验证：Computer 1360/0/68、Messaging 857/0/0（`5e2ce81d8`）；Server 1535/0/11、Worker 236/0/3（`727d410f2`，无生产差异）；另专库 startup 6 PASS/32 assertions、dispatch 3 PASS/7 assertions。完整命令、raw SHA、82 skip/九项独立通过见[最终本机结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)。
  - 完成范围：仅受控本地 PostgreSQL/fixture；metrics 的 T 未上报为 null，缺持久来源的重复计数为 null。没有 live UI 注意力采样、provider 日志、普遍 PII 审计或 latency percentile 证明，分位数 PENDING；真实 Bot/远端未证明；3.2报告虽已完成，其实际客户端/安装子项与3.4完整回退仍PENDING。
  - 以下“第 3 波”字段是 task-26 开闸前历史，不代表当前未执行；原始最小检查与失败证据保留。
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 第 3 波验证命令：`bun test ./scripts/check-outcome-contracts.test.ts ./scripts/outcome-recovery/report.test.ts ./scripts/check/test-database-gates.test.ts`；`bun scripts/check/outcome-regression-types.ts`；`bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan`；`git diff --check`。
  - 第 3 波验证结果：13 PASS / 0 FAIL / 62 assertions；14 个本线文件语义诊断 0、依赖诊断 0；51 个旧测试文件语法通过；11+6 个新 DB 测试、六场景实际 JSON/DB 对账及备份回退均 PENDING。
  - 第 3 波证据文件：[第3波回归脚手架交接](../004-OutcomeGo整体项目/docs/20261117-第3波回归脚手架交接.md)；同目录组合验证手册/合同矩阵/数据库入口补齐记录；`004.5/docs/final-replay.md` 和 `release-decision.md`。
  - 第 3 波已知限制：canonical 入口补齐已扩大覆盖，新的完整失败数未知；历史 canonical/dual-flag 基线分别保留且数据库失败仍阻塞；远端 CI/Computer/真实模型、安装与旧镜像未验，不宣称 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 先依赖什么：1.2
  - 怎么算完成：没有 `outcomeWorkItemId` 的 Run 不进入 Outcome 恢复分支；主对话、群聊和 Routine 的恢复行为不变；恢复重新入队不打断主对话。
  - 怎么验证：现有 startup-recovery 和 worker 生命周期测试 + 新增分流断言
  - 对应需求：需求 10、需求 15
  - 对应设计：§34、§35

- [x] 3.2 复核 `004.1` 已知 PENDING 项和跨客户端矩阵
  - 状态：DONE（2026-11-17，task-66；完成原文允许含PENDING的逐项复核报告，不表示实际安装/设备/更新/旧镜像通过）。
  - 最新验收：[逐项记录§3](docs/20261117-逐项任务验收记录.md#3-任务-32发布跨客户端和-0041-遗留复核)保留原A1–S1全部ID，补X1–X8跨客户端矩阵和004.1八条PENDING逐项结论；每行包含实际范围、证据、责任/恢复条件与回退。Desktop完整768/0/1、Android129JVM/真实APK、Swift Core329已验，实际UI/live API/安装子项如实PENDING；移动端批准/receipt写入首版范围外。
  - 依赖判断：004.2/004.3移动与Desktop、004.4移动只读实现/验证已可复核；**指定前置004.4 3.3仍IN_PROGRESS**，实现可供矩阵审查，但缺实际ReceiptForm UI失败fixture/刷新/重连测试，是本地验证缺口，不能只归入native环境。逐项记录X5/场景C明确PENDING及Human/Desktop补证责任；3.2完成包含未满足前置结论的复核报告，不关闭3.3，也不要求报告每行外部PASS。
  - 当前修复：历史validator三个错误接受已由真实物理schema/FK校验修复，23tests和最终CLI7/7通过；旧F2的Channel.botId不是当前真实列，补充真实ChannelMember缺Bot表负例。原FAIL日志不改写，实际导入/旧镜像仍PENDING。
  - 以下第一波矩阵与当时“不勾选/未运行”的字段为历史检查点；当前报告结论以本块及逐项记录为准。
  - 第 1 波线 5B 记录（2026-11-17）：[发布验收矩阵](docs/release-acceptance-matrix.md) 已覆盖新安装、校验/导入、签名/更新、错误来源和两种回退，并逐项回写 `004.1` PENDING；本任务不勾选完成。
  - 实现提交：无产品实现提交；核验代码基线为 `5070c6bc9c564cc2c0b982a25393860bcd82c774`，本线文档/证据提交可用 `git log -1 -- specs/004.5-运行时恢复与版本验收/docs/release-acceptance-matrix.md` 查询。
  - 修改文件：本任务前半证据块、`docs/release-acceptance-matrix.md`、`docs/20261117-l5b-evidence/`、`004.1/tasks.md` 的遗留项证据和 `004.1/docs/release-decision.md` 的复核补充。
  - 数据库变化：none；未连接数据库或启动服务。
  - 验证命令：`python3 specs/004.5-运行时恢复与版本验收/docs/20261117-l5b-evidence/run-checks.py`；内部逐条执行 `bun --no-install` 的版本/workflow/备份测试与校验器、精确本地 export 映射的 Desktop/CLI 配置测试、Android 静态/contract/公钥签名检查和 iOS native config；详见 `results.json`。
  - 验证结果：既有备份测试 5 PASS；Desktop/共享更新 22 PASS；CLI 配置首次 6 PASS/1 超时、相同默认参数隔离重试 7 PASS；CLI/Android fixture 原语签名绑定和错误来源离线负例符合预期。三个不合法备份被校验器接受，记 FAIL；完整 CLI Sigstore/更新安全测试缺依赖，真实安装/导入/设备更新/回退缺隔离环境及执行授权，记 PENDING。采集脚本退出 0 不代表验收 PASS，必须读取逐项结果。
  - 证据文件：`docs/20261117-l5b-evidence/results.json`、`backup-hashes.json`、`synthetic-backups.json`、`source-hashes.json` 和各命令 `*.log`。
  - 已知限制：未知表名、缺失引用目标表、Outcome 孤儿引用由数据库/备份脚本负责人处理；一次文件写入超时保留原始失败，不宣称修复；`004.1` 旧指纹拒绝说明与当前 `db push` 行为有偏差。第 0 波 CI/完整数据库失败门槛和父任务 1.3 PENDING 未改；Outcome 跨端回归未执行。
  - 回滚方式：仅撤销本线文档/证据提交。产品正式回退仍按设计关闭 Outcome 入口、保留新镜像/新表；关闭入口与旧镜像实际回放均 PENDING。
  - 先依赖什么：前半部分：父任务 1.2 和 `004.1` 发布资产/手动备份 fixture（第 1 波线 5B，可在第 0 波先行）；跨客户端 Outcome 矩阵：`004.2` 6.1、6.2，`004.3` 3.1–3.3，`004.4` 3.3、3.4。
  - 这一步到底做什么：在隔离环境执行 OutcomeGo 新安装、手动备份导入、回滚演练（关闭入口 vs 回退镜像）、跨平台旧资产混用负例；Desktop/Android/iOS 的深链、通知、登录和 Outcome/普通聊天回归。
  - 主要改哪里：`docs/release-acceptance-matrix.md`
  - 这一步先不做什么：不改变稳定包 ID 和签名；设备或环境缺失时记 PENDING。
  - 怎么算完成：每项有 PASS/PENDING/FAIL、证据和回滚结论；`004.1` 收尾记录中的 PENDING 项逐条有结论。
  - 怎么验证：平台既有命令、`bash scripts/android/package-debug.sh`、iOS 配置检查、Desktop update 测试
  - 对应需求：需求 4、需求 12、需求 14
  - 对应设计：§14、§28、§44、§48

- [x] 3.3 故障注入回放
  - 状态：DONE（2026-11-17，task-30 已实际执行六类本地故障，生成 §42 JSON 并与真实数据库对账；本地测试不替代远端 Computer/provider 或完整回归门槛）。
  - 最终复验：生产冻结 `5e2ce81d8` 实际再次运行六类 CLI，全部 exit 0，6+8+8+5+9+4=40/40 checks。最终 JSON 与 42 命令 raw SHA 见[最终本机结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)。下列首轮 root 失败和 task-26 字段保留为历史；当前本机四包已零失败，不改变远端/provider PENDING。
  - 集中验证实现提交：`af6e9bf6a`（真实 PrismaPromise 外键断言、已等待的 executor 退出证明）；首轮证据提交 `60f6fab3e`；脚手架原始实现见以下 task-26 历史字段。
  - 集中验证修改文件：`scripts/test-outcome-recovery.ts`、实际 fixture/scenarios、`004.5/docs/final-replay.md`、本任务块及父文档 `20261117-第3波后端组合验收首轮结果.md`/同名证据目录。
  - 集中验证数据库变化：none；本线独立 PostgreSQL 17.12、`127.0.0.1:55439`；首次 schema deploy 与重复 deploy 均 PASS，未连接生产或远端库。
  - 集中验证命令：显式本线 `OUTCOMEGO_TEST_DATABASE_URL`，依次运行 `bun scripts/test-outcome-recovery.ts --scenario <scenario> --output <独立JSON路径>`；restart 正式证据另运行 `restart-running-run-exit-proof.json`，保留最初元数据问题报告。
  - 集中验证结果：restart 6、duplicate finish 8、interrupted 8、concurrent Decision 5、receipt retry 9、unknown receipt 4 项实际检查均 PASS；receipt 必须统一 Review 后续跑，unknown 外部动作没有自动重试。六个 JSON 在 fixture 清理前保存并归档实际 ID/状态/计数。
  - 集中验证证据：[final-replay.md](docs/final-replay.md)、[首轮结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收首轮结果.md)、[六场景 JSON](../004-OutcomeGo整体项目/docs/20261117-第3波组合验收证据/faults/receipt-retry.json)。
  - 集中验证限制：executor 为本地脚本拥有的真实子进程；unknown 使用虚构持久测试适配器。真实 provider、远端 Computer、CI、设备、旧镜像仍 PENDING；根回归实际 351 FAIL，发布 BLOCKED。
  - 集中验证回滚：只撤销本线脚手架/测试/证据变更；不通过 SQL 修复失败或删除业务表。以下保留 task-26 在验证开闸前的历史记录，其“未执行”仅描述该旧检查点。
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 第 3 波验证命令：`bun test ./scripts/check-outcome-contracts.test.ts ./scripts/outcome-recovery/report.test.ts ./scripts/check/test-database-gates.test.ts`；`bun scripts/check/outcome-regression-types.ts`；`bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan`；`git diff --check`。
  - 第 3 波验证结果：13 PASS / 0 FAIL / 62 assertions；14 个本线文件语义诊断 0、依赖诊断 0；51 个旧测试文件语法通过；11+6 个新 DB 测试、六场景实际 JSON/DB 对账及备份回退均 PENDING。
  - 第 3 波证据文件：[第3波回归脚手架交接](../004-OutcomeGo整体项目/docs/20261117-第3波回归脚手架交接.md)；同目录组合验证手册/合同矩阵/数据库入口补齐记录；`004.5/docs/final-replay.md` 和 `release-decision.md`。
  - 第 3 波已知限制：canonical 入口补齐已扩大覆盖，新的完整失败数未知；历史 canonical/dual-flag 基线分别保留且数据库失败仍阻塞；远端 CI/Computer/真实模型、安装与旧镜像未验，不宣称 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 先依赖什么：1.2、2.1、`004.2` 3.4、4.2，`004.3` 1.3、1.4，`004.4` 3.1、3.2（第 3 波回归，不依赖最终检查点）。
  - 主要改哪里：`scripts/test-outcome-recovery.ts`、`docs/final-replay.md`
  - 这一步先不做什么：不通过直接 SQL 改状态修复失败。
  - 怎么算完成：§42 每个 scenario 输出 JSON 和数据库对账。
  - 怎么验证：restart、duplicate finish、interrupted-thread-resume、concurrent decision、receipt retry
  - 对应需求：需求 5、需求 6、需求 7、需求 11、需求 15
  - 对应设计：§27、§37、§42

- [ ] 3.4 备份、回退演练和失败日志
  - 逐项验收（2026-11-17，task-66）：保留BLOCKED；3.2报告前置可关闭，但原文要求的两种回退“实际结果”仍不齐。恢复/通知固定错误码、详情诊断及本地canary已有证据，不能代替真实旧镜像日志；发布负责人需提供新旧digest、有Planning/Explore数据的隔离副本、备份路径/SHA、入口切换/旧镜像实际拒绝或启动日志与对账。见[逐项记录§2/§3/§6](docs/20261117-逐项任务验收记录.md)。
  - 最终边界：同版本本机 dump/restore 86 表/22 有数据表/123 FK 对账通过且原 dump 保留；Planning/Explore 没有填充数据，旧镜像未演练，不把这两项写 DONE。最终本机测试零失败不关闭本任务。
  - 状态：BLOCKED（2026-11-17，task-30 实际 populated pg_dump/restore 已通过；旧镜像未提供且 Planning/Explore 有数据回退未覆盖，未满足两级回退完整验收）。
  - 集中验证补充：`03cf82651` 源码，在本线 `55439/outcomego_w3_backup` 保留六个真实故障 fixture 后执行 custom pg_dump，恢复到独立空库 `outcomego_w3_restored`；86 表行数/内容摘要完全一致，22 表有数据，123 个 FK 全部 validated；dump 333755 bytes，SHA-256 `0e5f11d9b725efadd5d388a47c31f964d4ecd5e431077a0e07f4ed9e061baf69`。
  - 集中验证证据：[第二检查点](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收第二检查点.md)、同目录 `20261117-第3波组合验收证据/populated-backup-result.json`。未启动旧镜像、未删除新表、未通过 SQL 修复业务状态；下面 task-26 的“未执行”字段保留为验证开闸前的历史记录。
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 第 3 波验证命令：`bun test ./scripts/check-outcome-contracts.test.ts ./scripts/outcome-recovery/report.test.ts ./scripts/check/test-database-gates.test.ts`；`bun scripts/check/outcome-regression-types.ts`；`bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan`；`git diff --check`。
  - 第 3 波验证结果：13 PASS / 0 FAIL / 62 assertions；14 个本线文件语义诊断 0、依赖诊断 0；51 个旧测试文件语法通过；11+6 个新 DB 测试、六场景实际 JSON/DB 对账及备份回退均 PENDING。
  - 第 3 波证据文件：[第3波回归脚手架交接](../004-OutcomeGo整体项目/docs/20261117-第3波回归脚手架交接.md)；同目录组合验证手册/合同矩阵/数据库入口补齐记录；`004.5/docs/final-replay.md` 和 `release-decision.md`。
  - 第 3 波已知限制：canonical 入口补齐已扩大覆盖，新的完整失败数未知；历史 canonical/dual-flag 基线分别保留且数据库失败仍阻塞；远端 CI/Computer/真实模型、安装与旧镜像未验，不宣称 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 先依赖什么：3.2
  - 主要改哪里：发布验证脚本、`docs/release-decision.md`、恢复服务日志
  - 这一步先不做什么：不在用户生产环境自动备份，不建告警平台。
  - 怎么算完成：备份路径、两种回退方式的实际结果和失败日志样例写入发布记录。
  - 怎么验证：测试环境 `pg_dump`、关闭入口演练、回退镜像演练；故障注入后检查日志
  - 对应需求：需求 14
  - 对应设计：§48、§49

- [x] 3.5 指标和日志脱敏复核
  - 状态：DONE（2026-11-17，task-30；本地 metrics/恢复诊断查询、四个 recovery service DB 案例及 cross-phase 脱敏 canary 通过，不代替真实远端或客户端验收）
  - 最终验证：Computer 1360/0/68、Messaging 857/0/0（`5e2ce81d8`）；Server 1535/0/11、Worker 236/0/3（`727d410f2`，无生产差异）；另专库 startup 6 PASS/32 assertions、dispatch 3 PASS/7 assertions。完整命令、raw SHA、82 skip/九项独立通过见[最终本机结果](../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)。
  - 完成范围：仅受控本地 PostgreSQL/fixture；metrics 的 T 未上报为 null，缺持久来源的重复计数为 null。没有 live UI 注意力采样、provider 日志、普遍 PII 审计或 latency percentile 证明，分位数 PENDING；真实 Bot/远端未证明；3.2报告虽已完成，其实际客户端/安装子项与3.4完整回退仍PENDING。
  - 以下“第 3 波”字段是 task-26 开闸前历史，不代表当前未执行；原始最小检查与失败证据保留。
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 第 3 波验证命令：`bun test ./scripts/check-outcome-contracts.test.ts ./scripts/outcome-recovery/report.test.ts ./scripts/check/test-database-gates.test.ts`；`bun scripts/check/outcome-regression-types.ts`；`bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan`；`git diff --check`。
  - 第 3 波验证结果：13 PASS / 0 FAIL / 62 assertions；14 个本线文件语义诊断 0、依赖诊断 0；51 个旧测试文件语法通过；11+6 个新 DB 测试、六场景实际 JSON/DB 对账及备份回退均 PENDING。
  - 第 3 波证据文件：[第3波回归脚手架交接](../004-OutcomeGo整体项目/docs/20261117-第3波回归脚手架交接.md)；同目录组合验证手册/合同矩阵/数据库入口补齐记录；`004.5/docs/final-replay.md` 和 `release-decision.md`。
  - 第 3 波已知限制：canonical 入口补齐已扩大覆盖，新的完整失败数未知；历史 canonical/dual-flag 基线分别保留且数据库失败仍阻塞；远端 CI/Computer/真实模型、安装与旧镜像未验，不宣称 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 先依赖什么：2.3、3.3
  - 怎么算完成：恢复、重试、重复事件、N/T/Q 和发布结果可查询，日志没有敏感内容。
  - 怎么验证：metrics fixture、日志脱敏测试
  - 对应需求：需求 9、需求 11、需求 12
  - 对应设计：§40、§41、§46

## 阶段 4：最终交付

- [ ] 4.1 父场景 A–H 回放报告和发布决策
  - 状态：IN_PROGRESS（2026-11-17，task-66；报告内容已补齐，指定前置3.4及各子规格最终检查点未关闭）。
  - 验收记录：[既有回放](docs/final-replay.md)、[既有发布决策](docs/release-decision.md)及[逐项记录§3–4](docs/20261117-逐项任务验收记录.md#4-任务-41父场景-ah-与发布决策补充)覆盖新安装/导入、A–H、主对话、Decision、人工、重启/重复、回退；每行状态/证据/责任/回退明确。报告可以含PENDING，未要求外部全部PASS才算写完。
  - 未勾选原因：3.4、004.2 7.3、004.3 4.4、004.4 6.1的原定前置未完成。正式发布BLOCKED/PENDING；本机六包4950/0/83及九恢复/40CLI不代替前置。lead/各owner补齐最终判定或明确范围决策后由集成者复核；本次不新增代码、测试、数据库或外部操作。
  - 先依赖什么：3.1–3.5、`004.2` 7.3、`004.3` 4.4、`004.4` 6.1；不依赖本规格 4.2，避免最终检查点循环。
  - 主要改哪里：`docs/final-replay.md`、`docs/release-decision.md`
  - 这一步先不做什么：不在验收阶段新增功能；不以“以后补测试”替代未通过的门槛。
  - 怎么算完成：新安装/导入、主链路、主对话不被打断、Decision、人工任务、重启、重复事件和回滚都有记录；PASS/PENDING/FAIL、责任人和回滚方法明确。
  - 怎么验证：父 fixture 回放和人工验收矩阵
  - 对应需求：需求 4、需求 9、需求 12
  - 对应设计：§14、§28、§41

- [ ] 4.2 Spec 最终检查点
  - 状态：IN_PROGRESS（2026-11-17，task-66；需求回写和八问已写齐，直接前置4.1未关闭，正式最终检查点不放行）。
  - 文档交付：[逐项记录§5](docs/20261117-逐项任务验收记录.md#5-任务-42需求-115-回写矩阵)逐行回写需求1–15的实现/本机证据/实际环境缺项/下一步；[§6](docs/20261117-逐项任务验收记录.md#6-父设计-34-八个问题)明确回答父§34八问，§7记录四向追踪和5项设计计划路径漂移。不是以本机整包零失败替代逐需求判断。
  - 未完成项：4.1指定前置与需求4/14实际发布/两级回退验收仍未满足，需求12正式发布PENDING。由lead/集成者根据具体外部证据与各子规格最终检查点重新判定，不把PENDING报告写齐等同于所有需求通过。
  - 先依赖什么：4.1
  - 怎么算完成：需求 1–15 全部回写；按父 design §34 回答八个问题。
  - 怎么验证：requirements/design/tasks/docs 四向核对
  - 对应需求：全部需求
  - 对应设计：全文
