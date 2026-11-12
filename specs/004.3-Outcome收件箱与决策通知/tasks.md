# 任务清单 - Outcome 收件箱与决策通知（人话版）

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

## 阶段 0：通知基线

- [ ] 0.1 盘点现有 Inbox、ChannelNotification 和 Push 链路
  - 状态：TODO
  - 这一步到底做什么：确认事件、ChannelNotification、OutboxDelivery、PushDevice 和客户端通知的真实调用路径。
  - 做完你能看到什么：`docs/notification-capability-matrix.md`。
  - 先依赖什么：`004.2` 最终检查点
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不新增通知服务。
  - 怎么算完成：已有的读取 cursor、Push retry、深链和客户端回调都有引用。
  - 怎么验证：源码审查、现有 notification tests。
  - 对应需求：需求 1、需求 7
  - 对应设计：`design.md` §6、§8

## 阶段 1：Decision 和投影

- [ ] 1.1 实现 Decision 数据模型和状态服务
  - 状态：TODO
  - 先依赖什么：0.1、`004.2` Contract 模型
  - 主要改哪里：`packages/contracts`、`packages/db`、`apps/server/src/services/decision-service.ts`
  - 这一步先不做什么：不实现完整 Inbox UI。
  - 怎么算完成：创建、展示、resolve、withdraw、expire 和 revision conflict 均有服务端行为。
  - 怎么验证：状态机、并发和数据库集成测试。
  - 对应需求：需求 5、需求 6
  - 对应设计：`design.md` §7、§9

- [ ] 1.2 实现 Outcome Inbox 查询和合并
  - 状态：TODO
  - 先依赖什么：1.1
  - 主要改哪里：`outcome-inbox-service.ts`、API route、查询测试
  - 这一步先不做什么：不将每条内部日志复制为 Inbox 项。
  - 怎么算完成：四种类别、cursor、去重、排序和权限都可用。
  - 怎么验证：fixture 查询、重复事件、已处理项目和跨用户隔离测试。
  - 对应需求：需求 4
  - 对应设计：`design.md` §6、§7、§8

- [ ] 1.3 接入完成/审核/人工动作事件
  - 状态：TODO
  - 先依赖什么：1.2、`004.2` review、`004.4` WorkItem 设计
  - 主要改哪里：事件投影、Outcome review service、人工任务入口
  - 这一步先不做什么：不提前实现 Push。
  - 怎么算完成：业务状态变化能生成对应 Inbox category 和 dedupe key。
  - 怎么验证：事件回放和重复投递测试。
  - 对应需求：需求 4、需求 7
  - 对应设计：`design.md` §8

## 阶段 2：客户端和通知

- [ ] 2.1 实现 Desktop Inbox 和 Decision 卡片
  - 状态：TODO
  - 先依赖什么：1.2
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/`、API client
  - 这一步先不做什么：不把完整日志默认放在首屏。
  - 怎么算完成：默认摘要、三段式内容、展开详情、选项和 custom resolve 可用。
  - 怎么验证：Desktop typecheck、component/browser tests、无障碍检查。
  - 对应需求：需求 4、需求 5、需求 8
  - 对应设计：`design.md` §9、§10

- [ ] 2.2 接入现有 ChannelNotification 和 Push/outbox
  - 状态：TODO
  - 先依赖什么：1.3、2.1
  - 主要改哪里：`packages/messaging/src/notifications.ts`、`NotificationService`、worker push dispatcher
  - 这一步先不做什么：不新增 push provider。
  - 怎么算完成：Decision/结果按 dedupe key 到达；普通 progress 不到达。
  - 怎么验证：notification service tests、outbox failure/retry integration tests。
  - 对应需求：需求 7
  - 对应设计：`design.md` §8、§11

- [ ] 2.3 接入 Android/iOS 深链和通知详情
  - 状态：TODO
  - 先依赖什么：2.1、2.2
  - 主要改哪里：`apps/android`、`apps/ios` 的现有 notification/deep-link 文件
  - 这一步先不做什么：不改稳定 package/bundle ID。
  - 怎么算完成：通知可以打开指定 Outcome/Decision，旧通知 payload 仍可解析。
  - 怎么验证：Android JVM/UI、iOS Core/UI、设备或模拟器 deep-link 回放。
  - 对应需求：需求 7、需求 8
  - 对应设计：`design.md` §10

### 最终检查

- [ ] 2.4 双客户端并发 Decision 回放
  - 状态：TODO
  - 依赖：2.1、2.2、2.3
  - 怎么算完成：一个 resolve 成功，另一个收到明确 conflict，Inbox 最终只有一个有效结果。
  - 怎么验证：服务端并发测试和 Desktop/mobile 回放。

- [ ] 2.5 普通进度静默回归
  - 状态：TODO
  - 依赖：2.2
  - 怎么算完成：内部 Run progress 只可查询，不创建主动 push。
  - 怎么验证：事件类型矩阵和 notification/outbox 数据库断言。

## 阶段 3：一致性、兼容和隐私

- [ ] 3.1 实现 Decision 与 Inbox 的事务一致性
  - 状态：TODO
  - 先依赖什么：1.1、1.2、`004.2` Contract/Review 模型
  - 这一步到底做什么：保证 Decision 创建/resolve、Outcome 状态和 Inbox item 的业务事实在同一事务或可重放事件中保持一致。
  - 做完你能看到什么：重复、并发和投影失败时，业务状态仍可查询和恢复。
  - 开始前先看：`design.md` §13、§14、§29、§30
  - 主要改哪里：Decision service、Outcome inbox service、DB migration、integration tests
  - 这一步先不做什么：不把 read marker 当作 resolve。
  - 怎么算完成：resolve 成功后 Inbox、Outcome 和 Decision 的状态一致，投影重复不产生第二项。
  - 怎么验证：事务 rollback、duplicate event、concurrent resolve、projection replay。
  - 对应需求：需求 4、需求 6、需求 9、需求 10
  - 对应设计：`design.md` §13、§17、§27、§37

- [ ] 3.2 实现 Push payload 脱敏和旧客户端 fallback
  - 状态：TODO
  - 先依赖什么：2.2
  - 主要改哪里：`packages/contracts/src/notification-content.ts`、NotificationService、worker push、Desktop/Android/iOS notification parsers
  - 这一步先不做什么：不把完整 Decision 正文放入 Push payload。
  - 怎么算完成：新 payload 有 schemaVersion、ID、类型和深链；旧客户端不崩溃。
  - 怎么验证：payload snapshot、旧 parser fixture、未登录 deep-link fixture。
  - 对应需求：需求 7、需求 11、需求 12
  - 对应设计：`design.md` §34、§35

- [ ] 3.3 实现 Inbox cursor、分页和查询性能验证
  - 状态：TODO
  - 先依赖什么：1.2、2.1
  - 主要改哪里：Inbox route/service、查询索引、分页测试、Desktop query client
  - 这一步先不做什么：不加载完整运行事件到默认列表。
  - 怎么算完成：大数据 fixture 下分页稳定，查询没有 N+1。
  - 怎么验证：分页重复/漏项测试、SQL query count、bounded fixture benchmark。
  - 对应需求：需求 4、需求 13
  - 对应设计：`design.md` §14、§27

## 阶段 4：客户端完成和端到端通知

- [ ] 4.1 完成 Desktop Inbox/Decision 交互状态
  - 状态：TODO
  - 先依赖什么：2.1、3.1
  - 主要改哪里：Outcome Inbox、Decision card、resolve conflict、deep-link route、Desktop notification target
  - 这一步先不做什么：不默认显示完整日志和私有 payload。
  - 怎么算完成：loading/ready/resolving/conflict/expired/error 状态完整，刷新不丢选择。
  - 怎么验证：Desktop typecheck、component/browser tests、无障碍检查。
  - 对应需求：需求 1、需求 2、需求 5、需求 8、需求 10
  - 对应设计：`design.md` §16、§19、§36

- [ ] 4.2 完成 Android/iOS 通知和深链兼容
  - 状态：TODO
  - 先依赖什么：3.2、4.1
  - 主要改哪里：Android notification/deep-link、iOS NativeNotifications/AppStore、共享 contracts
  - 这一步先不做什么：不改稳定 package/bundle ID。
  - 怎么算完成：新旧 scheme/payload 都可解析，未登录/后台/重复点击行为明确。
  - 怎么验证：Android JVM/UI、iOS Core/UI、设备或模拟器 deep-link 回放。
  - 对应需求：需求 7、需求 11、需求 12
  - 对应设计：`design.md` §20、§35

- [ ] 4.3 完成通知 provider/outbox 回放
  - 状态：TODO
  - 先依赖什么：2.2、3.2、4.2
  - 主要改哪里：NotificationService、OutboxDelivery worker、notification fixtures
  - 这一步先不做什么：不增加新的 Push provider。
  - 怎么算完成：事实一条通知意图，失败可重试，业务状态不依赖 Push 成功。
  - 怎么验证：provider failure、retry、duplicate fact、read marker 回放。
  - 对应需求：需求 3、需求 7、需求 9、需求 11
  - 对应设计：`design.md` §17、§34、§38

### 最终检查增强项

- [ ] 4.4 Decision 过期/撤回/并发端到端回放
  - 状态：TODO
  - 先依赖什么：4.1、4.2、4.3
  - 怎么算完成：旧卡片不可误 resolve，新状态可定位，两个客户端只有一个成功。
  - 怎么验证：服务端 concurrency + Desktop/mobile deep-link replay。
  - 对应需求：需求 6、需求 10
  - 对应设计：`design.md` §13、§29、§30

- [ ] 4.5 普通消息通知回归
  - 状态：TODO
  - 先依赖什么：3.2、4.3
  - 怎么算完成：普通 message/reaction/read state/push 行为与改动前一致。
  - 怎么验证：现有 notification-service、messaging 和 client notification tests。
  - 对应需求：需求 7、需求 12
  - 对应设计：`design.md` §18、§35

- [ ] 4.6 Spec 最终检查点
  - 状态：TODO
  - 先依赖什么：4.4、4.5
  - 怎么算完成：需求 1–13、设计 API/状态/通知/兼容矩阵和任务证据全部对齐。
  - 怎么验证：按 `requirements.md`、`design.md`、fixtures 和 notification matrix 逐项核对。
  - 对应需求：全部需求
  - 对应设计：全文


## 阶段 5：通知运维和失败路径

- [ ] 5.1 验证 Decision 状态和双客户端并发
  - 状态：TODO
  - 先依赖什么：1.1、1.2
  - 这一步到底做什么：验证 open/presented/resolved/withdrawn/expired 状态和两个客户端并发 resolve。
  - 主要改哪里：Decision service、DB transaction tests、concurrency fixtures。
  - 这一步先不做什么：不增加批量 resolve 或转交用户能力。
  - 怎么算完成：只有一个 resolve 成功；另一个收到当前状态或 revision conflict。
  - 怎么验证：并发 API integration test、状态机 test。
  - 对应需求：需求 5、需求 6、需求 10
  - 对应设计：`design.md` §13、§29、§30

- [ ] 5.2 验证通知事实去重和 Outbox 重试
  - 状态：TODO
  - 先依赖什么：1.3、2.2
  - 这一步到底做什么：验证事实 key、ChannelNotification、OutboxDelivery 和 Push failure 的关系。
  - 主要改哪里：NotificationService、projector、worker push tests。
  - 这一步先不做什么：不新增 Push provider。
  - 怎么算完成：同一业务事实只产生一个通知意图；provider 失败不改变 Decision。
  - 怎么验证：duplicate event、provider failure、retry、delivered/failed fixture。
  - 对应需求：需求 3、需求 7、需求 9、需求 11
  - 对应设计：`design.md` §17、§18、§34、§38

- [ ] 5.3 验证旧客户端和未知 payload fallback
  - 状态：TODO
  - 先依赖什么：2.2、2.3
  - 主要改哪里：contracts notification content、Desktop/Android/iOS parsers、old payload fixtures。
  - 这一步先不做什么：不删除既有 message/reaction 通知类型。
  - 怎么算完成：旧客户端不崩溃，新服务端旧客户端仍能使用普通通知。
  - 怎么验证：payload snapshot、old client fixture、unknown type tests。
  - 对应需求：需求 11、需求 12
  - 对应设计：`design.md` §34、§35

- [ ] 5.4 验证 Inbox 查询分页和 N+1
  - 状态：TODO
  - 先依赖什么：1.2、2.1
  - 主要改哪里：Inbox query service、DB indexes、query count test。
  - 这一步先不做什么：不加载完整事件流到默认 Inbox。
  - 怎么算完成：cursor 稳定、limit 有界、查询次数可控、已处理项不重复显示。
  - 怎么验证：large fixture、pagination repeat/gap、SQL query count。
  - 对应需求：需求 4、需求 13
  - 对应设计：`design.md` §14、§27

## 阶段 6：平台回放和最终检查

- [ ] 6.1 执行 Desktop 通知/深链回放
  - 状态：TODO
  - 先依赖什么：2.1、5.1、5.2
  - 主要改哪里：Desktop renderer/main notification tests、deep-link fixtures。
  - 这一步先不做什么：不缓存完整 Decision payload 到主进程。
  - 怎么算完成：banner 点击、Inbox 打开、Decision resolve、冲突刷新全可回放。
  - 怎么验证：Desktop focused/browser tests。
  - 对应需求：需求 1、需求 2、需求 5、需求 8
  - 对应设计：`design.md` §16、§20

- [ ] 6.2 执行 Android/iOS 通知和深链回放
  - 状态：TODO
  - 先依赖什么：2.3、5.3、6.1
  - 主要改哪里：Android/iOS notification/deep-link tests、pending route reducer。
  - 这一步先不做什么：不修改稳定 application/bundle ID。
  - 怎么算完成：后台、未登录、旧 scheme、重复点击和 unknown payload 都有结果。
  - 怎么验证：JVM/UI/Core tests，设备不可用时记录 PENDING。
  - 对应需求：需求 7、需求 11、需求 12
  - 对应设计：`design.md` §20、§35

- [ ] 6.3 普通消息通知回归
  - 状态：TODO
  - 先依赖什么：5.2、6.1、6.2
  - 主要改哪里：现有 notification/messaging test suite。
  - 这一步先不做什么：不把普通 progress 变成 Outcome notification。
  - 怎么算完成：普通 message/reaction/read marker/push 与基线一致。
  - 怎么验证：现有 tests + no-new-outbox assertion。
  - 对应需求：需求 7、需求 12
  - 对应设计：`design.md` §18、§35

- [ ] 6.4 Spec 最终检查点
  - 状态：TODO
  - 先依赖什么：6.1、6.2、6.3、7.1、7.2
  - 怎么算完成：需求 1–16、Decision 状态、通知、分页、旧客户端和失败路径都有证据。
  - 怎么验证：按 `requirements.md`、`design.md`、fixtures 和父级场景 B 逐项核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 7：Agent 决策请求和原规划补充项

- [ ] 7.1 实现 `RequestOutcomeDecision` 内部工具
  - 状态：TODO
  - 这一步到底做什么：在 computer 工具列表和 server `internal-tool-service.ts` 中新增该工具，仅在带 `outcomeWorkItemId` 的 Run 中提供。
  - 先依赖什么：1.1、`004.2` 任务 3.2
  - 主要改哪里：`packages/contracts/src/`（工具定义）、`apps/computer/src/runtime/tools.ts`、`apps/server/src/services/internal-tool-service.ts`、`outcome-inbox-service.ts`
  - 这一步先不做什么：不向普通 Run 暴露该工具。
  - 怎么算完成：工具调用创建 Decision 并让对应 WorkItem 进入 `waiting_decision`；重复调用幂等。
  - 怎么验证：带/不带 Outcome 上下文的工具列表快照；重复调用测试；独立 WorkItem 继续执行测试。
  - 对应需求：需求 6、需求 14、需求 15
  - 对应设计：`design.md` §15、§41

- [ ] 7.2 接入现有通知偏好和深链路径
  - 状态：TODO
  - 先依赖什么：2.2、2.3
  - 主要改哪里：`notification-service.ts`、`packages/contracts/src/app-deep-links.ts`、三端深链解析
  - 这一步先不做什么：不新增 URL scheme，不新增通知偏好设置项。
  - 怎么算完成：关闭通知偏好后不推送但 Inbox 可见；`outcomego://app/v1/outcomes...` 三端可打开。
  - 怎么验证：偏好开关测试；三端深链测试，设备不可用时记录 PENDING。
  - 对应需求：需求 7、需求 16
  - 对应设计：`design.md` §10、§43
