# 任务清单 - Outcome 收件箱与决策通知（人话版）

状态：TODO（等待 `004.2` 相关任务）

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

2026-11-17 整理：合并了原先重复的 Decision 并发（2.4/4.4/5.1）、通知去重（2.2/4.3/5.2）、旧客户端兼容（3.2/5.3）、分页性能（3.3/5.4）、普通通知回归（2.5/4.5/6.3）和两个最终检查点（4.6/6.4）；新增 Android/iOS 的 Inbox 和 Decision 解决任务；Decision 解决后的继续执行改为在同一 Outcome 子线程中开启新回合。

## 阶段 0：通知基线

- [ ] 0.1 盘点现有通知、Push 和客户端刷新链路
  - 状态：TODO
  - 这一步到底做什么：确认 `ChannelNotification`、`ChannelReadState`、`OutboxDelivery`、`PushDevice`、`NotificationService.routing()`、`apps/server/src/event-stream.ts` 和三端通知/深链的真实调用路径；确认客户端用什么机制刷新数据。
  - 做完你能看到什么：`docs/notification-capability-matrix.md`。
  - 先依赖什么：`004.2` 任务 1.2
  - 开始前先看：design §6、§18
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不新增通知服务。
  - 怎么算完成：已读 cursor、Push 重试、深链、客户端刷新和通知偏好都有文件:行引用；确认 D16 是否成立。
  - 怎么验证：源码审查；`bun test apps/server/test/notification*`
  - 对应需求：需求 1、需求 7、需求 16
  - 对应设计：§6、§8、§18

## 阶段 1：Decision、Inbox 和 Agent 决策请求

- [ ] 1.1 实现 Decision 数据模型和状态服务
  - 状态：TODO
  - 这一步到底做什么：`OutcomeDecision` 表和 `DecisionService`：create、present、resolve（条件更新、revision 检查、`resolutionEffect` 分流）、withdraw、expire；revision 被替代时自动 withdraw。
  - 先依赖什么：0.1、`004.2` 任务 1.3
  - 开始前先看：design §7、§13、§15、§29、§30、§31
  - 主要改哪里：`packages/contracts/src/outcome-inbox.ts`（新增）、`packages/db/prisma/schema.prisma`、`apps/server/src/services/decision-service.ts`（新增）、测试
  - 这一步先不做什么：不实现 Inbox UI。
  - 怎么算完成：五种状态转换、并发 resolve 只有一个成功、旧 revision 返回 `decision_revision_conflict`、重复 request 返回原结果；事件只使用 `outcome.decision.*`。
  - 怎么验证：`bun test apps/server/test/decision-service.test.ts`（状态机、并发、事务回滚）
  - 对应需求：需求 3、需求 5、需求 6、需求 10、需求 15、需求 16
  - 对应设计：§7、§13、§15、§29、§30、§31

- [ ] 1.2 实现 Outcome Inbox 查询
  - 状态：TODO
  - 这一步到底做什么：`GET /outcome-inbox`、`GET /outcomes/:id/inbox`、`GET /decisions/:id`、`POST /decisions/:id/resolve`、`POST /decisions/:id/withdraw`；四类项目、合并规则、cursor 分页、批量加载。
  - 先依赖什么：1.1
  - 开始前先看：design §9、§14、§16、§26、§27、§33
  - 主要改哪里：`apps/server/src/routes/outcome-inbox.ts`（新增）、`apps/server/src/services/outcome-inbox-service.ts`（新增）
  - 这一步先不做什么：不将内部日志复制为 Inbox 项；不按 owner 过滤。
  - 怎么算完成：四种类别、合并、去重、排序、分页稳定；没有 N+1 查询。
  - 怎么验证：fixture 查询、大数据分页（重复/漏项）、SQL 查询次数断言
  - 对应需求：需求 4、需求 8、需求 9、需求 13
  - 对应设计：§9、§14、§16、§27、§33

- [ ] 1.3 实现 `RequestOutcomeDecision` 和子线程继续执行
  - 状态：TODO
  - 这一步到底做什么：在 computer 工具列表和 `internal-tool-service.ts` 中新增该工具，只在 Outcome 子线程提供；resolve 后按 `resolutionEffect` 在同一子线程开启新回合、创建新 revision、创建人工 WorkItem 或追加补充 WorkItem。
  - 先依赖什么：1.1、`004.2` 任务 3.4
  - 开始前先看：design §41；`004.2` design §12；父 design §45.5
  - 主要改哪里：`packages/contracts/src/`（工具定义）、`apps/computer/src/runtime/tools.ts`、`apps/server/src/services/internal-tool-service.ts`、`decision-service.ts`、`packages/messaging/src/outcome-threads.ts`
  - 这一步先不做什么：不向主对话、群聊、Routine 或普通 Run 暴露该工具。
  - 怎么算完成：工具调用创建 Decision 并让 WorkItem 进入 `waiting_decision`；回合结束后 WorkItem 不被结算覆盖；resolve 后同一上下文继续；重复调用幂等；主对话不被打断。
  - 怎么验证：工具列表快照（Outcome 子线程/主对话/Routine）；`bun test apps/worker/test/outcome-thread.integration.test.ts` 增加决策暂停和继续场景
  - 对应需求：需求 6、需求 14、需求 15、需求 17
  - 对应设计：§15、§29、§41

- [ ] 1.4 接入待验收、待人工处理和完成事件
  - 状态：TODO
  - 这一步到底做什么：消费 `outcome.review.required`、`outcome.human_action.required`、`outcome.accepted`、`outcome.decision.closed`，生成对应 Inbox 项和通知事实；消费者用 `IdempotencyRecord(scope="outcome-event:inbox")` 去重。
  - 先依赖什么：1.2、`004.2` 任务 4.2；人工动作部分依赖 `004.4` 任务 2.1
  - 开始前先看：design §8、§17；父 design §14、§43
  - 主要改哪里：`outcome-inbox-service.ts`、事件消费者
  - 这一步先不做什么：不提前实现 Push。
  - 怎么算完成：业务状态变化能生成对应类别和 dedupe key；重复事件不产生第二项。
  - 怎么验证：事件回放和重复投递测试
  - 对应需求：需求 4、需求 7、需求 9
  - 对应设计：§8、§17

## 阶段 2：通知

- [ ] 2.1 接入现有 ChannelNotification、Outbox 和通知偏好
  - 状态：TODO
  - 这一步到底做什么：通知事实写入现有通知模型；遵守 `NotificationService.routing()` 和 Bot `notificationsEnabled`；同一 Outcome、同一 revision 的非紧急通知 60 秒内合并；`WakeParent` 与 Inbox 通知不重复。
  - 先依赖什么：1.4
  - 开始前先看：design §17、§18、§32、§43
  - 主要改哪里：`packages/messaging/src/notifications.ts`、`apps/server/src/services/notification-service.ts`、`apps/worker/src/push-notifications.ts`
  - 这一步先不做什么：不新增 Push provider；不新增偏好设置项。
  - 怎么算完成：一个事实一个通知意图；provider 失败不改变 Decision；关闭偏好后不推送但 Inbox 可见；普通 progress 不推送。
  - 怎么验证：duplicate fact、provider failure、retry、偏好开关、合并窗口测试
  - 对应需求：需求 7、需求 9、需求 11、需求 16、需求 17
  - 对应设计：§17、§18、§32、§43

- [ ] 2.2 实现 Push payload 脱敏和旧客户端兼容
  - 状态：TODO
  - 先依赖什么：2.1
  - 主要改哪里：`packages/contracts/src/notification-content.ts`、`packages/contracts/src/app-deep-links.ts`（增加 `outcomes` 路径）、三端通知解析
  - 这一步先不做什么：不把完整 Decision 正文放入 payload；不删除既有通知类型。
  - 怎么算完成：payload 有 schemaVersion、ID、类型、深链；旧客户端遇到未知类型不崩溃；普通消息通知照常。
  - 怎么验证：payload snapshot、旧 parser fixture、未登录深链 fixture
  - 对应需求：需求 11、需求 12
  - 对应设计：§10、§34、§35

## 阶段 3：客户端

- [ ] 3.1 Desktop Inbox、Decision 卡和通知
  - 状态：TODO
  - 先依赖什么：1.2、2.2
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/OutcomeInbox.tsx`、Decision 卡、`apps/desktop/src/main/notifications.ts`、API client
  - 这一步先不做什么：不默认显示完整日志；主进程不缓存完整 Decision 文本。
  - 怎么算完成：默认层/展开层/高级层；loading/ready/resolving/conflict/expired/error 状态；banner 点击和深链打开；刷新不丢选择。
  - 怎么验证：`bun --filter @outcomego/desktop typecheck`、组件测试、无障碍检查
  - 对应需求：需求 1、需求 2、需求 5、需求 8、需求 10
  - 对应设计：§16、§19、§20、§35

- [ ] 3.2 Android Inbox、Decision 解决和通知深链
  - 状态：TODO
  - 先依赖什么：1.2、2.2、`004.2` 任务 6.1
  - 主要改哪里：`mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/`（DTO、Transport）、`apps/android/app/src/main/kotlin/com/outcomego/features/`、`apps/android/app/src/main/kotlin/com/outcomego/platform/AndroidNotifications.kt`
  - 这一步先不做什么：不改稳定 package ID；待验收和待人工处理只读。
  - 怎么算完成：Inbox 列表、Decision 解决（含冲突刷新）、通知点击打开对应卡片、未登录先认证。
  - 怎么验证：`bash scripts/android/package-debug.sh`、JVM 测试；设备不可用时记录 PENDING
  - 对应需求：需求 18、需求 11、需求 12
  - 对应设计：§20、§35

- [ ] 3.3 iOS Inbox、Decision 解决和通知深链
  - 状态：TODO
  - 先依赖什么：1.2、2.2、`004.2` 任务 6.2
  - 主要改哪里：`apps/ios/Sources/Core/`（API、Models、`InboxPresentation.swift` 旁新增 Outcome 类型）、`apps/ios/Sources/App/NativeNotifications.swift`、`AppStore.swift`
  - 这一步先不做什么：不改稳定 bundle ID；待验收和待人工处理只读。
  - 怎么算完成：同 3.2；启动、后台恢复和通知点击进入同一个 pending deep link 处理。
  - 怎么验证：iOS Core 测试；设备不可用时记录 PENDING
  - 对应需求：需求 18、需求 11、需求 12
  - 对应设计：§20、§35

## 阶段 4：交付检查

- [ ] 4.1 双客户端并发、过期和撤回端到端回放
  - 状态：TODO
  - 先依赖什么：3.1、3.2 或 3.3
  - 怎么算完成：两个客户端只有一个 resolve 成功；旧卡片不可误 resolve；过期不视为同意。
  - 怎么验证：服务端并发测试 + Desktop/移动端回放
  - 对应需求：需求 6、需求 10、需求 16
  - 对应设计：§13、§29、§31

- [ ] 4.2 普通消息通知和主对话回归
  - 状态：TODO
  - 先依赖什么：2.1、2.2
  - 怎么算完成：普通 message/reaction/read state/push 与改动前一致；子线程汇报不出现在主对话；Run progress 不推送。
  - 怎么验证：`bun test apps/server/test/notification*`、messaging 和客户端通知测试、no-new-outbox 断言
  - 对应需求：需求 1、需求 7、需求 12、需求 17
  - 对应设计：§18、§35

- [ ] 4.3 父场景 B 回放
  - 状态：TODO
  - 先依赖什么：1.3、3.1、4.1
  - 怎么算完成：子线程中 Agent 请求决策 → Inbox → 用户解决 → 同一子线程继续 → Outcome 可查到决策结果；主对话全程不被打断。
  - 怎么验证：`docs/scenario-b-replay.md`
  - 对应需求：需求 3、需求 6、需求 14、需求 17
  - 对应设计：§41；父 design §20

- [ ] 4.4 Spec 最终检查点
  - 状态：TODO
  - 先依赖什么：3.3、4.1、4.2、4.3
  - 怎么算完成：需求 1–18、Decision 状态、通知、分页、旧客户端、移动端和失败路径都有证据；按父 design §34 回答八个问题。
  - 怎么验证：requirements/design/tasks 三向核对
  - 对应需求：全部需求
  - 对应设计：全文
