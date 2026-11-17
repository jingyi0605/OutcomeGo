# 通知能力核对矩阵

日期：2026-11-17。任务：[0.1](../tasks.md)；需求：[1、7、16、17](../requirements.md)；设计：[§6、§18、§43](../design.md)。核对基线 `5070c6bc9`，新增实现见 `070ffe968`、`b49299da0`；行号以本线提交后源码为准。

## 结论：D16 成立

Inbox 使用业务表的实时 SQL 投影，不新增 `OutcomeInboxItem`，不读写 Worker 队列 `InboxEvent`。`ChannelNotification.key` 已有唯一约束，`OutboxDelivery.deliveryKey` 已有唯一约束，可以保留一个事实、每设备一个投递意图。通知已读通过现有 notification sequence；不创建 Bot 主对话消息。

| 能力 | 源码定位 | 结论与复用边界 |
|---|---|---|
| 通知事实 | `packages/db/prisma/schema.prisma:674`；`packages/messaging/src/notifications.ts:15` | `ChannelNotification` 的 sequence、唯一 key、revoked 可复用；kind 是 String，追加 `outcome` 不影响旧类型 |
| 已读状态 | `packages/db/prisma/schema.prisma:664`；`apps/server/src/services/notification-service.ts:227`；`packages/messaging/src/notifications.ts:179` | `lastReadSequence` 用于消息，`lastReadNotificationSequence` 用于活动；Outcome 使用后者。读取通知不解决 Decision |
| Outbox | `packages/db/prisma/schema.prisma:1081`；`apps/worker/src/push-notifications.ts:65` | 原有 claim、最多 5 次重试、指数退避和设备失效处理全部复用；Push 错误不写 Decision |
| 推送设备 | `packages/db/prisma/schema.prisma:1099`；`apps/server/src/services/notification-service.ts:113` | 复用 APNs/FCM、安装身份、认证会话、enabled；不新增 provider |
| 全局偏好和活跃客户端 | `apps/server/src/services/notification-service.ts:73` 的 `routing()`；`packages/messaging/src/notification-presence.ts:5`；`packages/contracts/src/notification-presence.ts:40` | 不新增偏好。Outcome 主动提醒检查 smartEnabled 和 Bot.notificationsEnabled；通知事实、Inbox 在关闭时仍可查询；现有活跃端抑制继续生效 |
| 既有聊天通知 | `packages/messaging/src/notifications.ts:15`、`:110` | message/reaction 的 title、body、sender、read 语义保持；Outcome 使用独立入口，避免伪造 messageSequence |
| Desktop 本地 banner | `apps/desktop/src/main/notifications.ts:57`、`:174`；`apps/desktop/src/renderer/lib/notifications.ts:1` | 既有严格类型允许表只接受 message/reaction；未知 kind 不进入旧通知管理器。Outcome banner 属第三波 |
| Desktop 深链 | `apps/desktop/src/renderer/lib/app-deep-links.ts:41`；`apps/desktop/src/renderer/App.tsx:439` | 既有 app/v1 settings/plugin 路径；共享合同只追加 outcomes 和 outcomes/decision，客户端挂接第三波 |
| Android 通知与深链 | `apps/android/app/src/main/kotlin/com/outcomego/platform/AndroidNotifications.kt:44`、`:60`、`:412` | 字符串解析未知 kind；isAlert 只识别 message/reaction，因此旧版忽略新活动。既有 chat 深链保留 |
| iOS 通知与深链 | `apps/ios/Sources/Core/NotificationReads.swift:28`；`apps/ios/Sources/App/NativeNotifications.swift:367`、`:393`、`:401`；`apps/ios/Sources/App/AppStore.swift:1906` | 旧 isAlert 白名单忽略新活动，不做错误跳转；认证后 pending tap 复用。第三波补 Outcome 路由 |
| iOS extension fallback | `apps/ios/NotificationService/NotificationService.swift:20` | 未知 kind 直接返回原通知，安全显示固定标题/摘要；不尝试读取 Decision 正文 |
| Desktop 刷新 | `apps/desktop/src/renderer/state/use-outcomego.ts:1000`；`packages/client-core/src/sync.ts:16` | 现有 live sync、focus catch-up；未知事件默认触发 refresh，但当前 snapshot 没有 Inbox，需要第三波重新读 Inbox API |
| Android 共享轮询 | `mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/Sync.kt:53`、`:213`、`:247` | 已有 `/events/poll`、cursor、applyEvent；第三波从通知/前台恢复重新读 Inbox |
| iOS 轮询 | `apps/ios/Sources/App/AppStore.swift:897` | 已有长轮询、cursor 和 reconnect refresh；第三波接 Inbox |
| 事件运输 | `apps/server/src/event-stream.ts:26`、`:50`、`:100`；`apps/server/src/event-wakeup.ts:45`、`:50`、`:97` | SSE/长轮询复用，PostgreSQL LISTEN 只传唤醒，不传事实正文；断线有轮询 fallback |
| 事件实际选择 | `apps/server/src/services/snapshot-service.ts:609`、`:633` | 审计基线实际上读取全部 Event 主题，与父设计 §14 的“默认不推 outcome.*”不一致。已报告负责人，由集成者独立修正；本线没有修改此文件 |

## 第一波交付和后续交接

- `OutcomeInboxService` 以一条有索引业务事实 UNION 查询完成全局页；按 Outcome 查询额外执行存在性检查。SQL 内聚合验收条款，无卡片级 N+1。
- `DecisionService` 只写目录内的 required/resolved/closed；默认不过期，显式过期不代表同意。新请求在同一 Outcome 锁下释放已过期 active slot。
- `publishRequiredDecisionNotification` 从永久 Decision 加载，`reconcileOutcomeDecisionNotifications` 在现有 dispatcher.drain 的启动与每 2 秒周期中重试。没有 Event 高水位，Event 被清理、晚提交、投影临时失败或 DM 晚创建都可恢复。缺少 DM 的事实在 LIMIT 之前排除，不饿死其他事实。
- pending/failed Outbox 的合并必须对应未读事实和真实设备意图；合并时推进 surviving payload 到最新 notificationSequence。原事实已读、没有设备或没有待投递意图时，新事实创建自己的意图。Decision 与其他 Decision 不合并。
- 第 2 波任务 1.4 才接入 review/human/accepted 等生产事件。第一波只用固定业务事实验证其查询类别与通用投递设施，不宣称非 Decision 生产通知已经连通。
- 第三波的真实三端通知点击、未登录后恢复和设备验证为 PENDING；本线提供共享 ID 深链、旧解析器 fixture 和 APNs/FCM 编码验证。
- `notification.created` 是脱敏唤醒消息；不需要把 `outcome.*` 正文推给客户端。关闭/过期后的 UI 应重新查询 Inbox，通知已读不能当作业务处理。

## 第二波代码进展

`515abb275` 新增 `reconcileOutcomeInboxNotifications`，在原 dispatcher.drain 中恢复 Decision、review、human action、accepted 四类永久事实；`consumeOutcomeInboxEvent` 对目录事件写入 D18 receipt，Event 清理不影响业务事实恢复。第一波“其他类别留给 1.4”的范围说明至此由第二波代码完成，跨线与客户端联合验收仍待集中进行。

现有认证 `GET /api/v0/notification-state` 追加 `outcomeNotifications` 数组，包含当前未读、全局/Bot 偏好允许且非隐藏/归档的固定脱敏 Outcome payload，客户端仍应使用原 notificationRouting。不能直接从 `notification.created` 的存在推断提醒资格。message/reaction 数组与旧客户端兼容行为保留。详细提交、检查和组装边界见 [第二波验证记录](20261117-第二波决策工具与事件接入验证记录.md)。

`d2253a9ce` 补齐返工周期：设计 §17.1 的 review key 第四段为 criterionGroup，由 criterion IDs 和当前 ready result/receipt IDs 的确定摘要生成。返工期间原结果退出 ready 组；新结果完成时生成新未读事实，重复 settle/event 不重复。Inbox 和通知共用该 SQL，避免“旧卡仍在，但新结果永远不提醒”的分歧。
