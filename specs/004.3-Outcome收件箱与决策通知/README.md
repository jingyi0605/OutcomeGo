# Spec 004.3：Outcome 收件箱与决策通知

规格编号：`004.3`

状态：草案

日期：2026 年 11 月 11 日。

父规格：[Spec 004：OutcomeGo 整体项目](../004-OutcomeGo整体项目/README.md)

本 Spec 在 `004.2` 的执行和验收基础上，提供以成果和必要决策为中心的用户收件箱。

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)

## 可实施边界

本阶段复用当前 `InboxEvent`、`ChannelNotification`、`OutboxDelivery`、`PushDevice` 和 Desktop/iOS/Android 通知能力，新增 Outcome 级投影和 Decision 卡片。Inbox 是 Outcome 工作流的查询入口，不是另一套消息数据库；业务事实仍来自 Outcome、Run、Review 和人工动作记录。

实现必须覆盖两条路径：

1. Desktop/移动端主动读取 `GET /api/v0/outcome-inbox`。
2. 结果或必要决策通过当前通知服务和已有 push/outbox 机制到达用户。

普通进度只写事实事件或时间线，不创建主动通知。
