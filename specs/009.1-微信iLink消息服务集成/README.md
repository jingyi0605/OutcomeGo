# Spec 009.1：微信 iLink 消息服务集成

状态：IN_PROGRESS

文档关系：

- 基础服务：[`../009-外部消息服务/README.md`](../009-外部消息服务/README.md)
- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- 补充文档：[`docs/README.md`](docs/README.md)

本 Spec 依赖 Spec 009 的外部消息服务，负责实现微信 ClawBot/iLink packaged MCP connector，并把微信 direct peer 的入站消息接入 OpenTeam Channel。

QQ 不在本 Spec 范围内，也不创建 QQ connector 或 QQ automation trigger 任务。
