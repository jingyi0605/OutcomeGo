# Spec 004.5：运行时恢复与版本验收

规格编号：`004.5`

状态：草案

日期：2026 年 11 月 11 日。

父规格：[Spec 004：OutcomeGo 整体项目](../004-OutcomeGo整体项目/README.md)

本 Spec 负责实现已规划工作流所需的最小运行可靠性、状态恢复、幂等处理、指标和最终版本验收。它不建设泛化安全平台，也不引入与当前功能无关的防御式门禁。

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)

## 可实施边界

本阶段只补齐 Outcome 主链路实际需要的运行时能力：Run/WorkItem 状态可恢复、事件不重复应用、支持的外部动作具有幂等键、需要用户选择时进入 Decision，以及所有阶段和下一版本发布可以被复核。

本阶段不创建 IAM、RBAC、策略编排、通用工具分类或“为了安全”而阻塞产品开发的 Feature Gate。动作判断只针对 `004.2`、`004.3` 和 `004.4` 已经定义的执行路径，并以简单结果返回：`ALLOW`、`NEEDS_USER_DECISION`、`MANUAL_ACTION`、`UNSUPPORTED`。

当前代码已有可复用基础：`Event`、`IdempotencyRecord`、`OutboxDelivery`、`BotRunLease`、`Run.requestProgress`、`Run.requestRevision`、`apps/server/src/services/startup-recovery.ts` 和 Worker recovery 相关模块。本阶段优先扩展这些能力，而不是另建恢复数据库。
