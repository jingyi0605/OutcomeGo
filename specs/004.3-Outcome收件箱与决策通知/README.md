# Spec 004.3：Outcome 收件箱与决策通知

规格编号：`004.3`

状态：已批准，待 `004.2` 完成后实施（2026-11-17 按子线程执行模型修订）

日期：2026 年 11 月 11 日。

父规格：[Spec 004：OutcomeGo 整体项目](../004-OutcomeGo整体项目/README.md)

本 Spec 在 `004.2` 的执行和验收基础上，提供以成果和必要决策为中心的用户收件箱。

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)

## 可实施边界

本阶段复用当前 `ChannelNotification`、`OutboxDelivery`、`PushDevice` 和 Desktop/iOS/Android 通知能力，新增 Outcome 级查询投影和 Decision 卡片。现有 `InboxEvent` 是 Worker 的任务队列，与 Outcome Inbox 无关，本阶段不读写它（design §1）。Inbox 是 Outcome 工作流的查询入口，不是另一套消息数据库；业务事实仍来自 Outcome、WorkItem、Decision、Review 和人工动作记录。

Outcome 的 Agent 工作在子线程中运行（父 design §45）。本阶段负责子线程向用户“汇报”的主通道：结果、待验收、待决策和待人工处理都进入 Outcome Inbox 并按需通知；主对话不自动收到这些汇报。

实现必须覆盖两条路径：

1. Desktop、Android、iOS 主动读取 `GET /api/v0/outcome-inbox`，并可以在三端解决 Decision（父 design §41）。
2. 结果或必要决策通过当前通知服务和已有 push/outbox 机制到达用户。

普通进度只写事实事件或时间线，不创建主动通知。
