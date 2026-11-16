# Spec 009：外部消息服务

状态：IN_PROGRESS

文档关系：

- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- 补充文档：[`docs/README.md`](docs/README.md)
- WeChat 子规格：[`009.1-微信iLink消息服务集成`](../009.1-微信iLink消息服务集成/README.md)

本 Spec 建立 provider 无关的外部消息基础服务：消息入口绑定、外部 peer 到 OpenTeam Channel 的持久映射、入站轮询与去重、Bot 唤醒、媒体交换，以及把 Bot 回复送回原 peer 的外发投递。

## 已定的关键决策

完整理由见 [`design.md`](design.md) §8.3。

| 决策点 | 结论 |
| --- | --- |
| 会话归属 | 外部联系人的消息并入 Bot 的主会话 `bot_dm`（D13，2026-11-16 取代原先的独立 `external_dm`）；`external_dm` 只保留为旧数据的只读历史 |
| 准入与信任 | 首版只接受 connector 证明为账户所有者本人的消息（`owner_only`），按所有者消息唤醒 Bot |
| target Bot | 由用户在连接设置中显式绑定，保存在 `ExternalMessagingBinding` |
| 入站调度 | 新增 manifest `messaging` 块和 `ExternalInboundPoller`，不扩展 `PluginEventPoller` |
| 游标 | Server 持有确认游标，逐条推进；connector 负责落盘队列 |
| 回复路由 | Server 按 mapping 自动路由，Bot 不接触外部地址和回复凭据 |
| 外发状态 | 新增 `ExternalOutboundDelivery`，从创建到调用结束持有分发租约；仅恢复过期租约，uncertain 从不自动重发 |
| 媒体交换 | 经 computer 的 exchange HTTP 端点传输，connector 与 Server 不共享目录约定 |

## 不在本 Spec 内

- 具体平台协议与 connector：微信由 `009.1` 实现。
- 非所有者外部用户的准入（allowlist、审批）和与之配套的 Bot 能力收敛。
- 群聊类 peer、QQ、自动化触发器、外部消息历史搜索。
