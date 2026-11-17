# 任务清单 - 运行时恢复与版本验收（人话版）

状态：TODO（运维验证可先行；恢复在 `004.2` 3.2/3.4 合入后进入第 2 波；第 3 波回归和最终回放）

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

2026-11-17 整理：恢复对象改为“WorkItem + 子线程运行组”，不建 checkpoint 表（D17）；事件去重使用 `IdempotencyRecord`（D18）；“旧版本升级”改为新安装和手动备份导入；合并了原先重复的普通 Run 隔离（4.1/6.1）、跨客户端矩阵（3.2/5.2）、父场景回放（3.1/7.1）和最终检查（3.3/5.3/7.2）。

分波及测试替身合同：[父接口冻结文档](../004-OutcomeGo整体项目/docs/parallel-interfaces.md)。需求见 [requirements.md](requirements.md)，业务设计见 [design.md](design.md)；本次只调整任务前置关系。

## 阶段 0：运行时能力审计

- [ ] 0.1 盘点恢复相关设施
  - 状态：TODO
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

- [ ] 1.1 增加 WorkItem 恢复字段和恢复视图
  - 状态：TODO
  - 先依赖什么：0.1
  - 主要改哪里：`packages/db/prisma/schema.prisma`（`OutcomeWorkItem.retryCount`、`recoveryCount`）、`packages/contracts/src/outcome-runtime.ts`（`OutcomeRecoveryView`）
  - 这一步先不做什么：不新建 checkpoint 表；不写入 `Run.requestProgress`。
  - 怎么算完成：恢复视图能从现有字段计算；序列化测试通过。
  - 怎么验证：`bun --filter @outcomego/db typecheck`、contracts 测试
  - 对应需求：需求 5、需求 9
  - 对应设计：§1、§8

- [ ] 1.2 接入启动恢复
  - 状态：TODO
  - 先依赖什么：1.1、`004.2` 任务 3.2、3.4；依照冻结接口恢复同一子线程。
  - 主要改哪里：`apps/server/src/services/startup-recovery.ts`、`apps/server/src/services/outcome-recovery-service.ts`（新增）、`packages/messaging/src/outcome-threads.ts`
  - 这一步先不做什么：不盲目重跑所有 `running` 的 WorkItem；不触碰主对话租约。
  - 怎么算完成：按 §17.2 重新结算、在同一子线程续跑（最多 2 次）、保持等待或进入 `needs_review`；写 `outcome.recovered` 事件。
  - 怎么验证：进程重启 fixture、租约过期、旧 revision、连续中断测试
  - 对应需求：需求 1、需求 5、需求 15
  - 对应设计：§12、§17、§32

- [ ] 1.3 实现恢复查询和 reconcile
  - 状态：TODO
  - 先依赖什么：1.2
  - 主要改哪里：`apps/server/src/routes/outcome.ts`（`GET /recovery`、`POST /reconcile`）
  - 这一步先不做什么：不提供绕过状态前置条件的强制成功接口。
  - 怎么算完成：可以看到原因、运行组状态和建议动作；reconcile 幂等。
  - 怎么验证：中断、旧 revision、状态不一致 fixture
  - 对应需求：需求 9、需求 11
  - 对应设计：§24、§25、§35、§45

## 阶段 2：幂等、路由和指标

- [ ] 2.1 复核 Outcome 业务幂等和事件去重
  - 状态：TODO
  - 先依赖什么：0.1、`004.3` 任务 1.4
  - 主要改哪里：Outcome、Decision、人工任务服务和事件消费者
  - 这一步先不做什么：不替换现有消息幂等机制。
  - 怎么算完成：重复 run、review、decision resolve、receipt、notification 和重复事件都不产生第二个结果；事件消费者使用 `IdempotencyRecord(scope="outcome-event:<handler>")`。
  - 怎么验证：并发请求、hash 冲突、处理中、已完成和重复事件回放
  - 对应需求：需求 2、需求 6
  - 对应设计：§9、§19、§20、§37、§38

- [ ] 2.2 实现 WorkItem 下一步路由
  - 状态：TODO
  - 先依赖什么：1.2、`004.3` 任务 1.3；人工动作路由真实联调依赖 `004.4` 2.1、3.2。
  - 主要改哪里：`outcome-recovery-service.ts`
  - 这一步先不做什么：不分类或拦截 Agent 的工具调用。
  - 怎么算完成：§11 表中五种事实各有对应路由和测试。
  - 怎么验证：路由单测
  - 对应需求：需求 3、需求 7、需求 8
  - 对应设计：§11、§23

- [ ] 2.3 实现指标和注意力时间上报
  - 状态：TODO
  - 先依赖什么：2.1
  - 主要改哪里：Outcome 指标聚合查询、Desktop 规划/Decision/验收页面的前台计时上报接口
  - 这一步先不做什么：不建 dashboard，不设目标值，不新增指标事件。
  - 怎么算完成：N/T/Q、非必要通知比例、变更追溯率可按 Outcome 导出；客户端未上报时 T 为空。
  - 怎么验证：指标 fixture；T 为空测试
  - 对应需求：需求 9、需求 13
  - 对应设计：§26、§40

## 阶段 3：全项目验收和发布

- [ ] 3.1 普通 Run 和主对话恢复隔离回归
  - 状态：TODO
  - 先依赖什么：1.2
  - 怎么算完成：没有 `outcomeWorkItemId` 的 Run 不进入 Outcome 恢复分支；主对话、群聊和 Routine 的恢复行为不变；恢复重新入队不打断主对话。
  - 怎么验证：现有 startup-recovery 和 worker 生命周期测试 + 新增分流断言
  - 对应需求：需求 10、需求 15
  - 对应设计：§34、§35

- [ ] 3.2 复核 `004.1` 已知 PENDING 项和跨客户端矩阵
  - 状态：TODO
  - 先依赖什么：前半部分：父任务 1.2 和 `004.1` 发布资产/手动备份 fixture（第 1 波线 5B，可在第 0 波先行）；跨客户端 Outcome 矩阵：`004.2` 6.1、6.2，`004.3` 3.1–3.3，`004.4` 3.3、3.4。
  - 这一步到底做什么：在隔离环境执行 OutcomeGo 新安装、手动备份导入、回滚演练（关闭入口 vs 回退镜像）、跨平台旧资产混用负例；Desktop/Android/iOS 的深链、通知、登录和 Outcome/普通聊天回归。
  - 主要改哪里：`docs/release-acceptance-matrix.md`
  - 这一步先不做什么：不改变稳定包 ID 和签名；设备或环境缺失时记 PENDING。
  - 怎么算完成：每项有 PASS/PENDING/FAIL、证据和回滚结论；`004.1` 收尾记录中的 PENDING 项逐条有结论。
  - 怎么验证：平台既有命令、`bash scripts/android/package-debug.sh`、iOS 配置检查、Desktop update 测试
  - 对应需求：需求 4、需求 12、需求 14
  - 对应设计：§14、§28、§44、§48

- [ ] 3.3 故障注入回放
  - 状态：TODO
  - 先依赖什么：1.2、2.1、`004.2` 3.4、4.2，`004.3` 1.3、1.4，`004.4` 3.1、3.2（第 3 波回归，不依赖最终检查点）。
  - 主要改哪里：`scripts/test-outcome-recovery.ts`、`docs/final-replay.md`
  - 这一步先不做什么：不通过直接 SQL 改状态修复失败。
  - 怎么算完成：§42 每个 scenario 输出 JSON 和数据库对账。
  - 怎么验证：restart、duplicate finish、interrupted-thread-resume、concurrent decision、receipt retry
  - 对应需求：需求 5、需求 6、需求 7、需求 11、需求 15
  - 对应设计：§27、§37、§42

- [ ] 3.4 备份、回退演练和失败日志
  - 状态：TODO
  - 先依赖什么：3.2
  - 主要改哪里：发布验证脚本、`docs/release-decision.md`、恢复服务日志
  - 这一步先不做什么：不在用户生产环境自动备份，不建告警平台。
  - 怎么算完成：备份路径、两种回退方式的实际结果和失败日志样例写入发布记录。
  - 怎么验证：测试环境 `pg_dump`、关闭入口演练、回退镜像演练；故障注入后检查日志
  - 对应需求：需求 14
  - 对应设计：§48、§49

- [ ] 3.5 指标和日志脱敏复核
  - 状态：TODO
  - 先依赖什么：2.3、3.3
  - 怎么算完成：恢复、重试、重复事件、N/T/Q 和发布结果可查询，日志没有敏感内容。
  - 怎么验证：metrics fixture、日志脱敏测试
  - 对应需求：需求 9、需求 11、需求 12
  - 对应设计：§40、§41、§46

## 阶段 4：最终交付

- [ ] 4.1 父场景 A–H 回放报告和发布决策
  - 状态：TODO
  - 先依赖什么：3.1–3.5、`004.2` 7.3、`004.3` 4.4、`004.4` 6.1；不依赖本规格 4.2，避免最终检查点循环。
  - 主要改哪里：`docs/final-replay.md`、`docs/release-decision.md`
  - 这一步先不做什么：不在验收阶段新增功能；不以“以后补测试”替代未通过的门槛。
  - 怎么算完成：新安装/导入、主链路、主对话不被打断、Decision、人工任务、重启、重复事件和回滚都有记录；PASS/PENDING/FAIL、责任人和回滚方法明确。
  - 怎么验证：父 fixture 回放和人工验收矩阵
  - 对应需求：需求 4、需求 9、需求 12
  - 对应设计：§14、§28、§41

- [ ] 4.2 Spec 最终检查点
  - 状态：TODO
  - 先依赖什么：4.1
  - 怎么算完成：需求 1–15 全部回写；按父 design §34 回答八个问题。
  - 怎么验证：requirements/design/tasks/docs 四向核对
  - 对应需求：全部需求
  - 对应设计：全文
