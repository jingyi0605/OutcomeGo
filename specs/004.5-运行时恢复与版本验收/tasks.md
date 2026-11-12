# 任务清单 - 运行时恢复与版本验收（人话版）

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

## 阶段 0：运行时能力审计

- [ ] 0.1 盘点现有 Event、Idempotency、Outbox、Run lease 和 startup recovery
  - 状态：TODO
  - 这一步到底做什么：确认现有设施能覆盖 Outcome 的最小恢复需求。
  - 做完你能看到什么：`docs/runtime-recovery-matrix.md`，列出复用点、缺口和不新增的系统。
  - 先依赖什么：`004.2` 的 Run 模型和 `004.3` 的 Decision 模型
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不引入新的队列、编排器或权限平台。
  - 怎么算完成：每个故障注入场景都有现有代码入口或明确新增文件。
  - 怎么验证：源码审查和现有 recovery/idempotency tests。
  - 对应需求：需求 5、需求 6、需求 7
  - 对应设计：`design.md` §7–§12

## 阶段 1：Checkpoint 和恢复

- [ ] 1.1 固定 Checkpoint schema 和存储位置
  - 状态：TODO
  - 先依赖什么：0.1
  - 主要改哪里：`packages/contracts/src/outcome-runtime.ts`、`packages/db` 或 `Run.requestProgress`
  - 这一步先不做什么：不保存原始 Agent transcript 或全量日志。
  - 怎么算完成：schema version、序列、下一步和 side effect receipt 有稳定结构。
  - 怎么验证：schema/serialization tests、DB migration if needed。
  - 对应需求：需求 5
  - 对应设计：`design.md` §8

- [ ] 1.2 在关键转换写 Checkpoint
  - 状态：TODO
  - 先依赖什么：1.1、`004.2` Run flow
  - 主要改哪里：Outcome service、Worker、Review/Decision/HumanAction 入口
  - 这一步先不做什么：不改变普通 Run 的执行顺序。
  - 怎么算完成：开始、成功、等待、失败、取消和外部动作前后都有 checkpoint。
  - 怎么验证：事务测试和中断注入测试。
  - 对应需求：需求 1、需求 5
  - 对应设计：`design.md` §8、§10

- [ ] 1.3 接入启动恢复
  - 状态：TODO
  - 先依赖什么：1.2
  - 主要改哪里：`apps/server/src/services/startup-recovery.ts`、Worker readiness/recovery
  - 这一步先不做什么：不盲目重跑所有 running Run。
  - 怎么算完成：可恢复 Run 排队、等待或进入 needs_review，状态有 recovery event。
  - 怎么验证：进程重启 fixture、lease 过期和旧 revision 测试。
  - 对应需求：需求 5、需求 9
  - 对应设计：`design.md` §10、§12

## 阶段 2：幂等和动作分流

- [ ] 2.1 实现 Outcome 业务幂等 key
  - 状态：TODO
  - 先依赖什么：0.1、`004.2` 数据模型
  - 主要改哪里：Outcome service、Decision service、Human work service、现有 `IdempotencyRecord`
  - 这一步先不做什么：不替换现有消息幂等机制。
  - 怎么算完成：重复 run、review、decision resolve、receipt 和 notification 不产生第二个结果。
  - 怎么验证：并发请求、hash conflict、处理中和已完成回放。
  - 对应需求：需求 6
  - 对应设计：`design.md` §9

- [ ] 2.2 实现有限重试和 unknown side effect 分流
  - 状态：TODO
  - 先依赖什么：1.2、2.1、`004.3` Decision
  - 主要改哪里：Outcome recovery service、现有外部动作适配入口
  - 这一步先不做什么：不实现全局自动重试框架。
  - 怎么算完成：可重试、需要 Decision、人工执行和 unsupported 四类结果可观察。
  - 怎么验证：超时、回执未知、重复调用和超过重试限制测试。
  - 对应需求：需求 2、需求 3、需求 7、需求 8
  - 对应设计：`design.md` §9、§11

- [ ] 2.3 记录运行和恢复指标
  - 状态：TODO
  - 先依赖什么：1.3、2.1
  - 主要改哪里：事件埋点、Outcome 查询和导出脚本
  - 这一步先不做什么：不建设复杂运营 dashboard。
  - 怎么算完成：N/T/Q、retry、recovery、duplicate event 和 notification count 可按 Outcome 导出。
  - 怎么验证：指标 fixture 和聚合查询。
  - 对应需求：需求 9
  - 对应设计：`design.md` §13

## 阶段 3：全项目验收和发布

- [ ] 3.1 执行父规格场景 A–D
  - 状态：TODO
  - 先依赖什么：`004.1`、`004.2`、`004.3`、`004.4` 最终检查点
  - 主要改哪里：测试 fixture、`docs/final-replay.md`
  - 这一步先不做什么：不在验收阶段新增功能。
  - 怎么算完成：升级、规划、执行、验收、Decision、人工任务和恢复都有记录。
  - 怎么验证：按父 Spec requirements 的场景 A–D 回放。
  - 对应需求：需求 9
  - 对应设计：`design.md` §14、§16

- [ ] 3.2 执行跨客户端和升级矩阵
  - 状态：TODO
  - 先依赖什么：3.1、`004.1` 发布候选资产
  - 主要改哪里：`docs/release-acceptance-matrix.md`、Desktop/Android/iOS 测试记录
  - 这一步先不做什么：不改变稳定包 ID 和签名。
  - 怎么算完成：旧版本升级、OutcomeGo 安装、深链、通知、登录和历史数据通过。
  - 怎么验证：平台聚焦命令、Android packaging script、iOS checks、Desktop update tests。
  - 对应需求：需求 4、需求 9
  - 对应设计：`design.md` §14

- [ ] 3.3 最终发布决策
  - 状态：TODO
  - 先依赖什么：3.1、3.2
  - 主要改哪里：`docs/release-decision.md`
  - 这一步先不做什么：不以“以后补测试”替代未通过的发布门槛。
  - 怎么算完成：所有必须证据、已知限制、回滚方法和责任人明确，父 Spec 可以标记完成。
  - 怎么验证：父 Spec 最终评审。
  - 对应需求：需求 4、需求 9
  - 对应设计：全文

## 阶段 4：普通 Run 隔离和人工恢复

- [ ] 4.1 添加 Outcome/普通 Run 分流回归
  - 状态：TODO
  - 先依赖什么：1.3、2.1、`004.2` 普通聊天回归
  - 这一步到底做什么：验证没有 Outcome context 的 Run 不进入新 checkpoint、Decision 或恢复分支。
  - 做完你能看到什么：普通 Run 仍使用现有 Run/lease/cancel/message 路径。
  - 开始前先看：`apps/server/src/services/run-service.ts`、`apps/server/src/services/channel-service.ts`、`apps/worker/src/worker.ts`
  - 主要改哪里：regression tests、outcome recovery classifier。
  - 这一步先不做什么：不重写普通 Run recovery。
  - 怎么算完成：Outcome/普通 Run 分类和状态断言齐全。
  - 怎么验证：existing focused tests + new classification fixture。
  - 对应需求：需求 10
  - 对应设计：`design.md` §22、§35

- [ ] 4.2 实现 needs_review 查询和人工 reconcile
  - 状态：TODO
  - 先依赖什么：1.3、2.1、2.2
  - 主要改哪里：recovery service、Outcome route、reconcile API、docs runbook。
  - 这一步先不做什么：不提供绕过状态前置条件的管理员强制成功接口。
  - 怎么算完成：维护者可以查看原因、checkpoint、建议动作，并通过幂等 reconcile 处理。
  - 怎么验证：unknown receipt、old revision、missing checkpoint fixtures。
  - 对应需求：需求 3、需求 5、需求 8、需求 11
  - 对应设计：`design.md` §18、§24、§45

- [ ] 4.3 记录发布证据和 PENDING 外部环境
  - 状态：TODO
  - 先依赖什么：3.1、3.2
  - 主要改哪里：`docs/release-decision.md`、matrix、fixture reports。
  - 这一步先不做什么：不把缺少设备/账号写成 PASS。
  - 怎么算完成：每个 Gate 有 PASS/PENDING/FAIL、证据、责任人和回滚方法。
  - 怎么验证：人工发布评审和报告 schema 检查。
  - 对应需求：需求 9、需求 12
  - 对应设计：`design.md` §41、§44、§46

## 阶段 5：全局故障和升级回放

- [ ] 5.1 执行重启、重复事件和未知副作用回放
  - 状态：TODO
  - 先依赖什么：1.3、2.1、4.2、`004.2`/`004.3`/`004.4` 最终检查点
  - 主要改哪里：`scripts/test-outcome-recovery.ts`、`docs/final-replay.md`
  - 这一步先不做什么：不通过直接 SQL 改状态修复失败。
  - 怎么算完成：每个 scenario 输出 JSON 和最终数据库对账。
  - 怎么验证：restart、duplicate finish、unknown receipt、concurrent decision、receipt retry。
  - 对应需求：需求 5、需求 6、需求 7、需求 11
  - 对应设计：`design.md` §27、§37、§42

- [ ] 5.2 执行跨客户端和旧版本升级矩阵
  - 状态：TODO
  - 先依赖什么：5.1、`004.1` 候选资产
  - 主要改哪里：release acceptance matrix、Desktop/Android/iOS/CLI/server 记录。
  - 这一步先不做什么：不改变稳定 package/bundle ID 和签名。
  - 怎么算完成：旧版本数据、登录、Outcome/普通聊天、通知、深链和回滚有结论。
  - 怎么验证：平台既有命令、Android package/release gate、iOS config、Desktop update tests。
  - 对应需求：需求 10、需求 12
  - 对应设计：`design.md` §43、§44、§46

- [ ] 5.3 Spec 最终检查点增强
  - 状态：TODO
  - 先依赖什么：5.1、5.2
  - 怎么算完成：需求 1–12、故障注入、普通 Run 隔离、人工恢复和发布 Gate 全部回写。
  - 怎么验证：逐项核对 requirements/design/tasks/docs 和父 Spec 场景 A–D。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 6：恢复边界和发布故障

- [ ] 6.1 验证 Outcome/普通 Run recovery 分流
  - 状态：TODO
  - 先依赖什么：1.3、`004.2` 普通聊天回归
  - 这一步到底做什么：验证没有 Outcome 关联的 Run 不读取新 checkpoint、Decision 或 action classifier。
  - 主要改哪里：recovery classifier、普通 Run regression tests。
  - 这一步先不做什么：不重写现有普通 recovery。
  - 怎么算完成：两类 Run 的日志、状态和数据库变化明确区分。
  - 怎么验证：classification fixture、existing lifecycle tests。
  - 对应需求：需求 10
  - 对应设计：`design.md` §34、§35

- [ ] 6.2 验证启动恢复 batch 和 lease 竞态
  - 状态：TODO
  - 先依赖什么：1.3、2.1
  - 这一步到底做什么：验证多个非终态 Run、过期 lease、并发 Worker claim 和启动扫描不会重复执行。
  - 主要改哪里：startup-recovery、queue/lease integration tests。
  - 这一步先不做什么：不删除 lease 代替竞争处理。
  - 怎么算完成：同一 Run 同时只有一个有效执行者，扫描有界并可继续。
  - 怎么验证：concurrency/restart fixtures。
  - 对应需求：需求 1、需求 5、需求 6
  - 对应设计：`design.md` §32、§36

- [ ] 6.3 验证发布失败和回滚
  - 状态：TODO
  - 先依赖什么：3.2、5.2
  - 这一步到底做什么：模拟版本不一致、migration failure、签名失败、旧客户端和新入口不可用。
  - 主要改哪里：release fixture、rollback docs、release decision。
  - 这一步先不做什么：不删除旧资产或用户数据。
  - 怎么算完成：能够关闭新入口、恢复旧资产、保留数据库和生成失败报告。
  - 怎么验证：release gate negative fixtures、upgrade/rollback replay。
  - 对应需求：需求 4、需求 9、需求 12
  - 对应设计：`design.md` §41、§44、§45

- [ ] 6.4 复核指标和日志脱敏
  - 状态：TODO
  - 先依赖什么：2.3、3.1、5.1
  - 这一步到底做什么：确认 checkpoint、recovery、retry、duplicate event、N/T/Q 和 release 结果可查询，且没有敏感内容。
  - 主要改哪里：metrics/query tests、log snapshot、docs。
  - 这一步先不做什么：不建设复杂 dashboard。
  - 怎么算完成：字段、事件、错误码和脱敏规则都有 snapshot。
  - 怎么验证：metrics fixture、log redaction test。
  - 对应需求：需求 9、需求 11、需求 12
  - 对应设计：`design.md` §40、§41、§46

## 阶段 7：最终交付

- [ ] 7.1 生成父级场景 A–D 回放报告
  - 状态：TODO
  - 先依赖什么：6.1、6.2、6.3、6.4、所有子 Spec 最终检查点
  - 主要改哪里：`docs/final-replay.md`、release decision。
  - 怎么算完成：升级、主链路、Decision、人工任务、重启、重复事件和回滚都有记录。
  - 怎么验证：父 fixture replay 和人工验收矩阵。
  - 对应需求：需求 4、需求 9、需求 12
  - 对应设计：`design.md` §14、§28、§41

- [ ] 7.2 Spec 最终发布检查
  - 状态：TODO
  - 先依赖什么：7.1、8.1、8.2
  - 主要改哪里：`tasks.md`、`docs/release-decision.md`。
  - 这一步先不做什么：不以“以后补设备/账号测试”替代当前结论。
  - 怎么算完成：PASS/PENDING/FAIL、责任人、回滚和下一阶段状态明确。
  - 怎么验证：requirements/design/tasks/docs 四向核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 8：原规划补充项

- [ ] 8.1 实现派生指标和注意力时间上报
  - 状态：TODO
  - 先依赖什么：2.3
  - 主要改哪里：Outcome 指标聚合查询、Desktop 规划/Decision/验收页面的前台计时上报
  - 这一步先不做什么：不做 dashboard，不设目标值。
  - 怎么算完成：N/T/Q、非必要通知比例、变更追溯率可按 Outcome 导出；T 不可用时为空。
  - 怎么验证：指标 fixture；客户端未上报时 T 为空的测试。
  - 对应需求：需求 13
  - 对应设计：`design.md` §40

- [ ] 8.2 备份、回退演练和失败日志
  - 状态：TODO
  - 先依赖什么：3.2
  - 主要改哪里：发布验证脚本、`docs/release-decision.md`、恢复服务日志
  - 这一步先不做什么：不在用户生产环境自动备份，不建设告警平台。
  - 怎么算完成：备份路径、恢复演练结果和失败日志样例写入发布记录。
  - 怎么验证：测试环境执行 `pg_dump`、恢复、旧镜像读取；故障注入后检查日志。
  - 对应需求：需求 14
  - 对应设计：`design.md` §48、§49
