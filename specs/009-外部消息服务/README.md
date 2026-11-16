# Spec 009：外部消息服务

状态：IN_PROGRESS

文档关系：

- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- 补充文档：[`docs/README.md`](docs/README.md)
- WeChat 子规格：[`009.1-微信iLink消息服务集成`](../009.1-微信iLink消息服务集成/README.md)

本 Spec 建立 provider 无关的外部消息基础服务：外部 peer 到 OpenTeam Channel 的持久映射、入站消息去重与 Bot 唤醒、媒体资产边界和外发回复上下文。

QQ 不属于本轮实现范围。自动化触发器也不在本 Spec 中实现；具体平台必须先依赖本 Spec 的 Channel 路径。
