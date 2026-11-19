# 任务清单 - Outcome 收件箱与决策通知（人话版）

2026-11-17 task73 当前开发更新：当前原五项仍2DONE/3开放。task73已补[scenario-b-replay.md](docs/scenario-b-replay.md)：实际工具→Inbox→生产路由并发200/409→同WorkItem/context继续→Output/transcript，16检查PASS。本地B具名链已交付；原4.1双真实客户端未关闭，因此4.3/4.4仍不勾。没有app/监听服务、原生通知或live模型新执行。

状态：代码与已执行本地验证完成（2026-11-17 逐项复核：14 项中 11 项 DONE；4.1、4.3、4.4 保留真实双客户端、场景 B 和正式退出验收门槛）

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

只有 `DONE` 的任务才能勾选完成。任务必须同时包含实现、失败行为和验证证据。

最新五项逐项结论见 [20261117-逐项任务验收记录](docs/20261117-逐项任务验收记录.md)。早期分波证据保留为历史：第 2 波工具/事件和第 3 波客户端代码已整合，最新完整本地包命令合计 4950 PASS / 0 FAIL / 83 SKIP；这不是一次新 root/远端 CI，也不替代真实客户端和设备验收。

2026-11-17 整理：合并了原先重复的 Decision 并发（2.4/4.4/5.1）、通知去重（2.2/4.3/5.2）、旧客户端兼容（3.2/5.3）、分页性能（3.3/5.4）、普通通知回归（2.5/4.5/6.3）和两个最终检查点（4.6/6.4）；新增 Android/iOS 的 Inbox 和 Decision 解决任务；Decision 解决后的继续执行改为在同一 Outcome 子线程中开启新回合。

2026-11-18 追加：阶段 5 新增「目标通知卡片」与「失败、阻塞通知」三端实现，见 5.1–5.4；对应需求 19–21、设计 §44。

分波及测试替身合同：[父接口冻结文档](../004-OutcomeGo整体项目/docs/parallel-interfaces.md)。需求见 [requirements.md](requirements.md)，业务设计见 [design.md](design.md)；本次只调整任务前置关系。

## 阶段 0：通知基线

- [x] 0.1 盘点现有通知、Push 和客户端刷新链路
  - 状态：DONE
  - 这一步到底做什么：确认 `ChannelNotification`、`ChannelReadState`、`OutboxDelivery`、`PushDevice`、`NotificationService.routing()`、`apps/server/src/event-stream.ts` 和三端通知/深链的真实调用路径；确认客户端用什么机制刷新数据。
  - 做完你能看到什么：`docs/notification-capability-matrix.md`。
  - 先依赖什么：第 0 波 B、`004.2` 任务 1.2（第 1 波线 3）。
  - 开始前先看：design §6、§18
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不新增通知服务。
  - 怎么算完成：已读 cursor、Push 重试、深链、客户端刷新和通知偏好都有文件:行引用；确认 D16 是否成立。
  - 怎么验证：源码审查；`bun test apps/server/test/notification*`
  - 对应需求：需求 1、需求 7、需求 16
  - 对应设计：§6、§8、§18

  - 实现提交：070ffe968、b49299da0；审计文档随本记录提交
  - 修改文件：docs/notification-capability-matrix.md；完整路径清单见证据文件
  - 数据库变化：none
  - 验证命令：源码审查；43 项现有通知回归 PASS；精确组合命令见证据文件
  - 验证结果：定向合并 80 PASS / 0 FAIL / 406 assertions；五个受影响包 typecheck PASS；未运行全量 CI，未声称第 0 波阻塞已消失
  - 证据文件：[20261117-第一波服务端验证记录](docs/20261117-第一波服务端验证记录.md)；[通知能力矩阵](docs/notification-capability-matrix.md)
  - 已知限制：实际 Event 流与父设计默认行为不一致，已交集成者；三端设备回放第三波 PENDING
  - 回滚方式：撤销本线服务与通知入口提交，保留 Decision 事实与新增表；没有生产数据库变更
  - 集成验证补充：task-48 修正通知和返工周期 fixture 对原本缺失的认证环境恢复方式，避免 Bun 将 undefined 写成字符串。生产 parser 真实红例 1 PASS / 2 FAIL；修正后 unset/required/disabled 各 10 PASS / 57 assertions。根 server 级联消除结果待执行者整合回放，见 [通知测试认证环境隔离修正记录](docs/20261117-通知测试认证环境隔离修正记录.md)。

## 阶段 1：Decision、Inbox 和 Agent 决策请求

- [x] 1.1 实现 Decision 数据模型和状态服务
  - 状态：DONE
  - 这一步到底做什么：`OutcomeDecision` 表和 `DecisionService`：create、present、resolve（条件更新、revision 检查、`resolutionEffect` 分流）、withdraw、expire；revision 被替代时自动 withdraw。
  - 先依赖什么：0.1、`004.2` 任务 1.3
  - 开始前先看：design §7、§13、§15、§29、§30、§31
  - 主要改哪里：`packages/contracts/src/outcome-inbox.ts`（新增）、`packages/db/prisma/schema.prisma`、`apps/server/src/services/decision-service.ts`（新增）、测试
  - 这一步先不做什么：不实现 Inbox UI。
  - 怎么算完成：五种状态转换、并发 resolve 只有一个成功、旧 revision 返回 `decision_revision_conflict`、重复 request 返回原结果；事件只使用 `outcome.decision.*`。
  - 怎么验证：`bun test apps/server/test/decision-service.test.ts`（状态机、并发、事务回滚）
  - 对应需求：需求 3、需求 5、需求 6、需求 10、需求 15、需求 16
  - 对应设计：§7、§13、§15、§29、§30、§31

  - 实现提交：e2764b948、a60e897ef、e8c662d7b、070ffe968、b49299da0
  - 修改文件：schema.prisma；outcome-inbox.ts；decision-service.ts；decision-lifecycle.ts；decision-service.test.ts；完整路径清单见证据文件
  - 数据库变化：新增 OutcomeDecision、五状态、FK/索引、唯一请求键和活动 WorkItem slot
  - 验证命令：bun test apps/server/test/decision-service.test.ts；fresh-schema 和模型测试 PASS；精确组合命令见证据文件
  - 验证结果：定向合并 80 PASS / 0 FAIL / 406 assertions；五个受影响包 typecheck PASS；未运行全量 CI，未声称第 0 波阻塞已消失
  - 证据文件：[20261117-第一波服务端验证记录](docs/20261117-第一波服务端验证记录.md)；[通知能力矩阵](docs/notification-capability-matrix.md)
  - 已知限制：生产 plan_only 依赖线 1 真实续跑；manual_action 默认 503；外部 revision/cancel 需集成者装配撤回 helper
  - 回滚方式：撤销本线服务与通知入口提交，保留 Decision 事实与新增表；没有生产数据库变更

- [x] 1.2 实现 Outcome Inbox 查询
  - 状态：DONE
  - 这一步到底做什么：`GET /outcome-inbox`、`GET /outcomes/:id/inbox`、`GET /decisions/:id`、`POST /decisions/:id/resolve`、`POST /decisions/:id/withdraw`；四类项目、合并规则、cursor 分页、批量加载。
  - 先依赖什么：1.1
  - 开始前先看：design §9、§14、§16、§26、§27、§33
  - 主要改哪里：`apps/server/src/routes/outcome-inbox.ts`（新增）、`apps/server/src/services/outcome-inbox-service.ts`（新增）
  - 这一步先不做什么：不将内部日志复制为 Inbox 项；不按 owner 过滤。
  - 怎么算完成：四种类别、合并、去重、排序、分页稳定；没有 N+1 查询。
  - 怎么验证：fixture 查询、大数据分页（重复/漏项）、SQL 查询次数断言
  - 对应需求：需求 4、需求 8、需求 9、需求 13
  - 对应设计：§9、§14、§16、§27、§33

  - 实现提交：a60e897ef、070ffe968、a2ec70549、b49299da0
  - 修改文件：outcome-inbox 路由/服务；main.ts；对应 route/query 测试；完整路径清单见证据文件
  - 数据库变化：none
  - 验证命令：bun test apps/server/test/outcome-inbox-service.test.ts apps/server/test/outcome-inbox-routes.test.ts：PASS；全局页 1 SQL，无 N+1；精确组合命令见证据文件
  - 验证结果：定向合并 80 PASS / 0 FAIL / 406 assertions；五个受影响包 typecheck PASS；未运行全量 CI，未声称第 0 波阻塞已消失
  - 证据文件：[20261117-第一波服务端验证记录](docs/20261117-第一波服务端验证记录.md)；[通知能力矩阵](docs/notification-capability-matrix.md)
  - 已知限制：实时事实已处理后从待处理列表消失；游标提供稳定排序和新事实快照边界，非跨请求历史 MVCC 快照
  - 回滚方式：撤销本线服务与通知入口提交，保留 Decision 事实与新增表；没有生产数据库变更

- [x] 1.3 实现 `RequestOutcomeDecision` 和子线程继续执行
  - 状态：DONE（本线代码和必要聚焦检查；跨线组装、广泛回归与远端部署验收 PENDING）
  - 这一步到底做什么：在 computer 工具列表和 `internal-tool-service.ts` 中新增该工具，只在 Outcome 子线程提供；resolve 后按 `resolutionEffect` 在同一子线程开启新回合、创建新 revision、创建人工 WorkItem 或追加补充 WorkItem。
  - 先依赖什么：1.1、第 0 波 B 工具分发点；真实续跑依赖 `004.2` 任务 3.2、3.4，之前可用 OutcomeThreadFake（第 2 波线 3）。
  - 开始前先看：design §41；`004.2` design §12；父 design §45.5
  - 主要改哪里：`packages/contracts/src/`（工具定义）、`apps/computer/src/runtime/tools.ts`、`apps/server/src/services/internal-tool-service.ts`、`decision-service.ts`、`packages/messaging/src/outcome-threads.ts`
  - 这一步先不做什么：不向主对话、群聊、Routine 或普通 Run 暴露该工具。
  - 怎么算完成：工具调用创建 Decision 并让 WorkItem 进入 `waiting_decision`；回合结束后 WorkItem 不被结算覆盖；resolve 后同一上下文继续；重复调用幂等；主对话不被打断。
  - 怎么验证：工具列表快照（Outcome 子线程/主对话/Routine）；`bun test apps/worker/test/outcome-thread.integration.test.ts` 增加决策暂停和继续场景
  - 对应需求：需求 6、需求 14、需求 15、需求 17
  - 对应设计：§15、§29、§41
  - 实现提交：f598cf59d、4c963a368、922c25840、e9d56c461、515abb275、f60495cf8
  - 修改文件：contracts/outcome-inbox；messaging/outcome-decisions；server/outcome-decision-tool、decision-service、outcome-inbox 路由；computer/runtime/tools；相关聚焦测试
  - 数据库变化：none
  - 验证命令：证据记录内限定 test-name-pattern 的三文件 DB 测试；合同/工具快照两文件；受影响包 TypeScript 检查
  - 验证结果：DB 聚焦 8 PASS / 44 assertions；合同/工具快照 7 PASS / 17 assertions；server/computer/worker/messaging 类型检查通过；广泛回归未运行
  - 证据文件：[第二波决策工具与事件接入验证记录](docs/20261117-第二波决策工具与事件接入验证记录.md)
  - 已知限制：真实 HumanActionPort 和 trusted handler 中央组装归集成者；远端 computer 未同步/重建，部署和跨线联合验收 PENDING；第 0 波失败基线未宣称消失
  - 回滚方式：逆序撤销本线提交并移除集成者的组装引用，保留业务事实；无 schema 回滚
  - 集成验证补充：task-41 修正 pending N+1 时 sourceDecision 派生 supplement 的有效性，实际依赖完成后才调度；N+1 批准后旧控制仍 409。原组合 0 PASS / 1 FAIL → 必要聚焦 7 PASS / 46 assertions，详见 [待批准后继版本补充工作验证记录](docs/20261117-待批准后继版本补充工作验证记录.md)。

- [x] 1.4 接入待验收、待人工处理和完成事件
  - 状态：DONE（本线代码和必要聚焦检查；客户端及真实生产者联合验收 PENDING）
  - 这一步到底做什么：消费 `outcome.review.required`、`outcome.human_action.required`、`outcome.accepted`、`outcome.decision.closed`，生成对应 Inbox 项和通知事实；消费者用 `IdempotencyRecord(scope="outcome-event:inbox")` 去重。
  - 先依赖什么：1.2、`004.2` 任务 4.2；人工动作真实事件依赖 `004.4` 任务 2.1 的来源实现，之前使用冻结 payload fixture（第 2 波）。
  - 开始前先看：design §8、§17；父 design §14、§43
  - 主要改哪里：`outcome-inbox-service.ts`、事件消费者
  - 这一步先不做什么：不提前实现 Push。
  - 怎么算完成：业务状态变化能生成对应类别和 dedupe key；重复事件不产生第二项。
  - 怎么验证：事件回放和重复投递测试
  - 对应需求：需求 4、需求 7、需求 9
  - 对应设计：§8、§17
  - 实现提交：e9d56c461、515abb275、d2253a9ce；共享通知读取合同 f598cf59d
  - 修改文件：messaging/outcome-inbox-notifications、notifications、index；server/notification-service、outcome-inbox-service；worker/push-notifications；新增事件集成测试
  - 数据库变化：none
  - 验证命令：bun test packages/messaging/test/outcome-inbox-events.integration.test.ts（实际与限定模式 DB 聚焦组合执行，完整命令见证据）
  - 验证结果：三类新增事件、D18 重放、永久事实恢复、偏好/已读、closed/current 检查随上述 8 项聚焦测试全部通过；审阅补充返工周期等必要聚焦 9 PASS / 49 assertions（与前者部分重合）；真实 readA→FAIL/rework→newB 单未读/outbox/provider send 通过。无高水位、不依赖 Event 留存，现有 Dispatcher 生命周期默认接入
  - 证据文件：[第二波决策工具与事件接入验证记录](docs/20261117-第二波决策工具与事件接入验证记录.md)
  - 已知限制：原生通知数组需第三波客户端采用；广泛回归和实际设备验证 PENDING；不开放原始 outcome.* 客户端流
  - 回滚方式：撤销本线消费者/dispatcher 默认引用和 additive 读取数组，不清理持久业务事实

## 阶段 2：通知

- [x] 2.1 接入现有 ChannelNotification、Outbox 和通知偏好
  - 状态：DONE
  - 这一步到底做什么：通知事实写入现有通知模型；遵守 `NotificationService.routing()` 和 Bot `notificationsEnabled`；同一 Outcome、同一 revision 的非紧急通知 60 秒内合并；`WakeParent` 与 Inbox 通知不重复。
  - 先依赖什么：1.1、1.2、0.1；第 1 波先按冻结事件 fixture 验证投递设施，第 2 波 1.4 接入真实事件。
  - 开始前先看：design §17、§18、§32、§43
  - 主要改哪里：`packages/messaging/src/notifications.ts`、`apps/server/src/services/notification-service.ts`、`apps/worker/src/push-notifications.ts`
  - 这一步先不做什么：不新增 Push provider；不新增偏好设置项。
  - 怎么算完成：一个事实一个通知意图；provider 失败不改变 Decision；关闭偏好后不推送但 Inbox 可见；普通 progress 不推送。
  - 怎么验证：duplicate fact、provider failure、retry、偏好开关、合并窗口测试
  - 对应需求：需求 7、需求 9、需求 11、需求 16、需求 17
  - 对应设计：§17、§18、§32、§43

  - 实现提交：070ffe968、b49299da0
  - 修改文件：messaging/notifications.ts、index.ts；notification-service.ts；worker/push-notifications.ts；outcome-notifications.test.ts；完整路径清单见证据文件
  - 数据库变化：none
  - 验证命令：新投影/恢复/合并测试与 43 项原通知回归 PASS；provider failure/retry 真实 dispatcher 断言 PASS；精确组合命令见证据文件
  - 验证结果：定向合并 80 PASS / 0 FAIL / 406 assertions；五个受影响包 typecheck PASS；未运行全量 CI，未声称第 0 波阻塞已消失
  - 证据文件：[20261117-第一波服务端验证记录](docs/20261117-第一波服务端验证记录.md)；[通知能力矩阵](docs/notification-capability-matrix.md)
  - 已知限制：第一波仅生产接入 decision.required；其他主题留给 1.4；没有 DM 时后续 drain 自动恢复
  - 回滚方式：撤销本线服务与通知入口提交，保留 Decision 事实与新增表；没有生产数据库变更

- [x] 2.2 实现 Push payload 脱敏和旧客户端兼容
  - 状态：DONE
  - 先依赖什么：2.1
  - 主要改哪里：`packages/contracts/src/notification-content.ts`、`packages/contracts/src/app-deep-links.ts`（增加 `outcomes` 路径）、三端通知解析
  - 这一步先不做什么：不把完整 Decision 正文放入 payload；不删除既有通知类型。
  - 怎么算完成：payload 有 schemaVersion、ID、类型、深链；旧客户端遇到未知类型不崩溃；普通消息通知照常。
  - 怎么验证：payload snapshot、旧 parser fixture、未登录深链 fixture
  - 对应需求：需求 11、需求 12
  - 对应设计：§10、§34、§35

  - 实现提交：a60e897ef、070ffe968、b49299da0
  - 修改文件：contracts notification-content/app-deep-links/index；worker apns/fcm；payload 与 legacy parser 测试；完整路径清单见证据文件
  - 数据库变化：none
  - 验证命令：bun test packages/contracts/test/outcome-inbox.test.ts apps/worker/test/outcome-push-payload.test.ts：PASS；普通 APNs/FCM 回归 PASS；精确组合命令见证据文件
  - 验证结果：定向合并 80 PASS / 0 FAIL / 406 assertions；五个受影响包 typecheck PASS；未运行全量 CI，未声称第 0 波阻塞已消失
  - 证据文件：[20261117-第一波服务端验证记录](docs/20261117-第一波服务端验证记录.md)；[通知能力矩阵](docs/notification-capability-matrix.md)
  - 已知限制：真实三端新卡片、点击及未登录深链恢复为第三波，设备验证 PENDING
  - 回滚方式：撤销本线服务与通知入口提交，保留 Decision 事实与新增表；没有生产数据库变更

## 阶段 3：客户端

- [x] 3.1 Desktop Inbox、Decision 卡和通知
  - 状态：DONE（2026-11-17，代码、整合后完整 Desktop 测试、SSR/无障碍结构检查、完整类型和生产 bundle 已验证；真实 OS 通知点击、认证恢复及双客户端运行验收仍由 4.1、4.3、4.4 保留）
  - 实现提交：`3abfc861e`、`4ed536b33`；依赖原始提交与本工作树映射见证据文档。
  - 修改文件：`outcomes/inbox/`、`outcomego-api.ts`、最小 App/深链/原生通知/preload/本地化接线；准确清单见证据文档。
  - 数据库变化：本线无；消费其他线已冻结合同，不把依赖提交归为本线实现。
  - 验证命令：在 `apps/desktop` 执行 `bun --no-env-file test --pass-with-no-tests --isolate`；完整类型命令 `bun --no-env-file x --no-install tsc -p apps/desktop/tsconfig.json --pretty false`；renderer/Electron/helper 的实际构建步骤与原始最小检查命令见下列证据文档。
  - 验证结果：原 15 PASS / 50 assertions 为代码交付时历史；后续 integrator 完整 Desktop `bun --no-env-file test --pass-with-no-tests --isolate` 实际 768 PASS / 0 FAIL / 1 SKIP / 20163 assertions / 140 files，含原七项 SSR/无障碍结构、Decision 状态、通知/深链与旧消息回归；完整 Desktop tsc、renderer/Electron/helper 生产构建均 exit 0。本次只读验收复核这些既有日志和源码，没有重新运行测试。
  - 证据文件：[逐项任务验收记录](docs/20261117-逐项任务验收记录.md)；[全规格组合验证与修复记录](../004-OutcomeGo整体项目/docs/20261117-全规格组合验证与修复记录.md)；原始 [桌面客户端代码与最小检查](../004.4-现实任务与知识资料闭环/docs/20261117-桌面客户端代码与最小检查.md) 保留历史阶段边界。
  - 已知限制：SSR/语义标签不是 VoiceOver、真实 OS banner、登录前深链或两个真实客户端的观测；未安装/启动 Desktop。本地 enrollment 的另一次 1 PASS / 51 assertions 也不是 Decision 双客户端证明。正式外部验收仍为 PENDING，不据此关闭 4.1、4.3、4.4 或父 Spec。
  - 回滚方式：产品回滚按原两个本线代码提交及后续窄修的映射协调；本次仅文档编辑、未提交，可按负责人备份逐块恢复；保留其他线合同、数据库和用户数据。
  - 先依赖什么：1.2、1.3、1.4、2.2（第 2 波合入后进入第 3 波客户端）。
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/inbox/`、`apps/desktop/src/main/notifications.ts`、API client
  - 这一步先不做什么：不默认显示完整日志；主进程不缓存完整 Decision 文本。
  - 怎么算完成：默认层/展开层/高级层；loading/ready/resolving/conflict/expired/error 状态；banner 点击和深链打开；刷新不丢选择。
  - 怎么验证：`bun --filter @outcomego/desktop typecheck`、组件测试、无障碍检查
  - 对应需求：需求 1、需求 2、需求 5、需求 8、需求 10
  - 对应设计：§16、§19、§20、§35

- [x] 3.2 Android Inbox、Decision 解决和通知深链
  - 状态：DONE（2026-11-17，实现交付及整合后真实 Android 构建/指定 JVM 测试通过；真实 API 和设备/UI 验收 PENDING）
  - 实现提交：`9d1eb4dce`、`b75ed7caf`
  - 修改文件：共享 `core/OutcomeInbox.kt`、`Outcomes.kt`；Android `features/OutcomeInboxScreens.kt`、`OutcomeScreens.kt`、`FeatureContracts.kt`、`LiveFeatureGateway.kt`、`AppViewModel.kt`、`OutcomeGoApp.kt`、`DeepLinkRouter.kt`、`AndroidNotifications.kt`、`AndroidPlatformRuntime.kt` 和对应测试。
  - 数据库变化：none。
  - 验证命令：精确整合源码 `b58286ab309e2223d5c8adb90f3096dec69e40ea` 上单次 `bash scripts/android/package-debug.sh --test`；直接解析 JUnit XML；独立 `shasum -a 256`。
  - 验证结果：正式 wrapper exit 0；shared 43、Android 86 tests，均 0 failures/errors/skips，新增 Inbox gateway 与 router 测试通过；assembleDebug PASS。真实 UI/通知/API 验证 PENDING。
  - 证据文件：[`20261117-整合后移动端真实构建与测试.md`](../004-OutcomeGo整体项目/docs/20261117-整合后移动端真实构建与测试.md)，含新 APK 完整绝对路径及 SHA-256 `10e7d4be71e59a5f71d7e0e086f339a72de7adada487793fe4c6c9aeea1f9151`。
  - 已知限制：未安装/启动设备；不能将 JVM 测试和真实编译当作 UI 运行验证；第 0 波数据库失败门槛保留。
  - 回滚方式：先撤销 `b75ed7caf` 的 UI，再撤销 `9d1eb4dce` 的共享模型；不改其他线历史。
  - 先依赖什么：1.2、1.3、1.4、2.2、`004.2` 任务 6.1（第 3 波）。
  - 主要改哪里：`mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/`（DTO、Transport）、`apps/android/app/src/main/kotlin/com/outcomego/features/`、`apps/android/app/src/main/kotlin/com/outcomego/platform/AndroidNotifications.kt`
  - 这一步先不做什么：不改稳定 package ID；待验收和待人工处理只读。
  - 怎么算完成：Inbox 列表、Decision 解决（含冲突刷新）、通知点击打开对应卡片、未登录先认证。
  - 怎么验证：`bash scripts/android/package-debug.sh`、JVM 测试；设备不可用时记录 PENDING
  - 对应需求：需求 18、需求 11、需求 12
  - 对应设计：§20、§35

- [x] 3.3 iOS Inbox、Decision 解决和通知深链
  - 状态：DONE（2026-11-17，实现交付及整合后原始完整 Core 套件通过；完整 App、真实 API 和设备/UI 验收 PENDING）
  - 实现提交：`8d75fc154`、`9d1eb4dce`、`b6a222c18`、`b75ed7caf`
  - 修改文件：Core `OutcomeInbox.swift`、`NotificationReads.swift`、`WebProviderSettings.swift`；App `OutcomeInboxView.swift`、`OutcomesView.swift`、`AppStore.swift`、`HomeView.swift`、`NativeNotifications.swift`；`Localizable.xcstrings`、新夹具和相关 Core 测试。
  - 数据库变化：none。
  - 验证命令：`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --package-path apps/ios`；`check-native-config.py`、`check-siri-skills.py`；真实 xcodebuild，完整参数见证据。
  - 验证结果：原始完整 XCTest 329 tests、0 failures、exit 0；包括 Outcome Inbox 6、Outcome read 4、WebProvider 8。native/Siri 配置检查 PASS；xcodebuild 未进入 App 编译，外部包 GitHub TLS 拉取停滞，安全终止 exit 143，记 PENDING。
  - 证据文件：[`20261117-整合后移动端真实构建与测试.md`](../004-OutcomeGo整体项目/docs/20261117-整合后移动端真实构建与测试.md)。
  - 已知限制：首次默认 CLT 缺 XCTest，以单命令 DEVELOPER_DIR 修复环境后原套件通过，未改系统选择；完整 App/真实通知冷热启动/账号切换仍待验收；第 0 波数据库失败门槛保留。
  - 回滚方式：先撤销 `b75ed7caf`，再按依赖撤销 `9d1eb4dce`；两个 iOS 旧代码修正可独立决定。
  - 先依赖什么：1.2、1.3、1.4、2.2、`004.2` 任务 6.2（第 3 波）。
  - 主要改哪里：`apps/ios/Sources/Core/`（API、Models、`InboxPresentation.swift` 旁新增 Outcome 类型）、`apps/ios/Sources/App/NativeNotifications.swift`、`AppStore.swift`
  - 这一步先不做什么：不改稳定 bundle ID；待验收和待人工处理只读。
  - 怎么算完成：同 3.2；启动、后台恢复和通知点击进入同一个 pending deep link 处理。
  - 怎么验证：iOS Core 测试；设备不可用时记录 PENDING
  - 对应需求：需求 18、需求 11、需求 12
  - 对应设计：§20、§35

## 阶段 4：交付检查

- [ ] 4.1 双客户端并发、过期和撤回端到端回放
  - 状态：BLOCKED（服务端事务竞争、过期/撤回及客户端状态控制已有通过证据；Desktop 与 Android/iOS 两个真实客户端联验 PENDING，不勾选）
  - 已核实证据：最新 server 完整 1535 PASS / 0 FAIL；`decision-service.test.ts` 一胜者、stored replay、旧 revision/withdraw/expiry；真实本地 `concurrent-decision` CLI 5/5 checks、一次 continuation、主对话不变；Desktop controller 冲突刷新保留选择。详见 [逐项验收 4.1](docs/20261117-逐项任务验收记录.md)。
  - 仍缺证据与下一步：在获准的真实 Desktop 和 Android/iOS 会话中并发提交不同选项、打开过期/撤回旧卡，记录实际请求 ID、409/当前状态、同一 WorkItem 后续 Run 和 UI；不能把本地两个 enrollment 身份或两条 service Promise 当作此回放。
  - 先依赖什么：3.1、3.2 或 3.3
  - 怎么算完成：两个客户端只有一个 resolve 成功；旧卡片不可误 resolve；过期不视为同意。
  - 怎么验证：服务端并发测试 + Desktop/移动端回放
  - 对应需求：需求 6、需求 10、需求 16
  - 对应设计：§13、§29、§31

- [x] 4.2 普通消息通知和主对话回归
  - 状态：DONE（2026-11-17，普通消息/reaction/read/push 适配器、子线程隔离和 progress 静默的完整本地回归已通过；不扩大为真实 provider/设备送达）
  - 实现与修正：原通知设施及 Outcome 独立投影；Task53 多 emoji 并发/回执修正与用户明确选择，Task60 全局角标 fixture 因果红绿后整合；生产源码冻结 `5e2ce81d8`，最终 server/worker 测试后继 `727d410f2` 无生产改动。
  - 修改文件/数据库变化：本次仅验收文档；既有实际文件、来源→集成提交映射及历史失败保存在组合总账；无新增 schema 或产品改动。
  - 验证证据：Runtime 最终完整 server 1535 PASS / 0 FAIL、messaging 857 PASS / 0 FAIL、worker 236 PASS / 0 FAIL；integrator 最终 Desktop 768 PASS / 0 FAIL / 1 SKIP。日志中普通 progress 无主动意图、provider 失败/重试、恢复异常不阻止普通 badge 投递、真实 Worker 同上下文续跑且主对话可见消息为 0 均通过。完整命令、SHA 和具体验证项见 [逐项验收 4.2](docs/20261117-逐项任务验收记录.md)。
  - 已知限制：多条完整包命令不相加冒充一次 root/CI；83 个 skip 按原 gate 保留。实际 APNs/FCM 送达、OS banner 和设备读状态同步仍归 4.4 外部验收；Task60 原始额外事实 producer UNKNOWN，不猜测归因。
  - 回滚方式：本次只更新任务与验收记录，无产品或数据库变更；生产回滚遵守既有保留业务事实的方案。
  - 先依赖什么：2.1、2.2
  - 怎么算完成：普通 message/reaction/read state/push 与改动前一致；子线程汇报不出现在主对话；Run progress 不推送。
  - 怎么验证：`bun test apps/server/test/notification*`、messaging 和客户端通知测试、no-new-outbox 断言
  - 对应需求：需求 1、需求 7、需求 12、需求 17
  - 对应设计：§18、§35

- [ ] 4.3 父场景 B 回放
  - 状态：BLOCKED（真实本地工具→暂停→resolve→同一子线程续跑及主对话隔离已验证；真实 Agent、Inbox UI 与跨客户端场景回放 PENDING，依赖 4.1 未完成）
  - 已核实证据：`outcome-decision-tool.test.ts` 真实 trusted handler 和事务回滚；`outcome-thread.integration.test.ts` 的决策暂停/继续用真实 Worker claim、同 contextSessionId、同 WorkItem 和主对话继续断言；最新 worker 整包通过，见 [逐项验收 4.3](docs/20261117-逐项任务验收记录.md)。
  - 仍缺证据与下一步：`docs/scenario-b-replay.md` 尚无实际场景报告；获准后用真实 Bot/远端 Computer 请求 Decision，在真实 Inbox 展示并解决，核对历史和原线程继续、主对话无打断，再记录场景 B。现有 CLI/数据库 fixture 不作为 live Agent/UI 的替代。
  - 先依赖什么：1.3、3.1、4.1
  - 怎么算完成：子线程中 Agent 请求决策 → Inbox → 用户解决 → 同一子线程继续 → Outcome 可查到决策结果；主对话全程不被打断。
  - 怎么验证：`docs/scenario-b-replay.md`
  - 对应需求：需求 3、需求 6、需求 14、需求 17
  - 对应设计：§41；父 design §20

- [ ] 4.4 Spec 最终检查点
  - 状态：BLOCKED（需求 1–18 的本地实现/证据及父 design §34 八问已逐项核对；4.1、4.3 和真实平台/通知证据未齐，不宣布 Spec 退出）
  - 已完成核对：[逐项任务验收记录](docs/20261117-逐项任务验收记录.md) 包含五项结论、18 项需求映射、八问、命令/来源和下一步；最新本地包命令 4950 PASS / 0 FAIL / 83 SKIP 按执行者与冻结点分别归属。Android 43+86 JVM/构建、Swift Core 329 与 Desktop bundle 通过不等于三端真实 UI。
  - 仍缺证据与下一步：先补 4.1、4.3；真实 Desktop/Android/iOS 认证后深链、通知冷热启动、离线恢复和真实 provider 送达；完整 iOS App 编译仍被外部依赖 TLS 阻塞。由获准的验收者完成后重审八问；本次未启动服务、远端、设备或发布流程。
  - 先依赖什么：3.3、4.1、4.2、4.3
  - 怎么算完成：需求 1–18、Decision 状态、通知、分页、旧客户端、移动端和失败路径都有证据；按父 design §34 回答八个问题。
  - 怎么验证：requirements/design/tasks 三向核对
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 5：目标通知卡片与失败、阻塞通知

2026-11-18。背景：目标在独立线程运行，需要用户处理时主对话没有任何信号。方案见设计 §44：在机器人对话里写入不属于 Bot、不唤醒 Bot 的目标卡片，并把失败和执行方上报的阻塞纳入通知。以下均为未提交的工作树改动。

- [ ] 5.1 Server：目标卡片、失败与阻塞事实、引用提示
  - 状态：代码完成；涉及数据库的集成测试已编写但未执行（本机没有一次性测试库），因此不勾选
  - 实现提交：无（工作树未提交）
  - 修改文件：`packages/messaging/src/outcome-update-cards.ts`（新）、`outcome-inbox-notifications.ts`、`index.ts`；`packages/contracts/src/outcome-chat.ts`、`notification-content.ts`；`apps/server/src/services/channel/formatting.ts`。
  - 数据库变化：none（只新增 `ChannelMessage` 行和 `ChannelNotification` 行，不改 schema）。
  - 验证命令：contracts、messaging、server 的 `tsc --noEmit`；`bun test apps/server/test/outcome-update-card-quote.test.ts`；`packages/messaging/test/outcome-inbox-events.integration.test.ts`（需 `OUTCOMEGO_TEST_DATABASE_URL`）。
  - 验证结果：类型检查通过；引用提示单测 3 项通过；集成测试 6 项中新增 2 项（单张卡片不重复且不创建 Run、转录不含卡片；失败和阻塞各通知一次且阻塞解除后消失）未执行，仍为 SKIP。
  - 失败行为：Bot 没有私聊频道时 `publishFact` 返回 false，下一次对账重试；通知被关闭或频道静音时仍写卡片、跳过推送。
  - 已知限制：事实 SQL 在真实 PostgreSQL 上的行为（`jsonb_array_elements`、2 天窗口）尚未被真实库验证。
  - 回滚方式：撤销 `publishFact` 中的 `postOutcomeUpdateCard` 调用即可停止写卡片；撤销事实 SQL 中后两个 `UNION ALL` 即可停止失败/阻塞通知。已写入的卡片是普通 `system` 消息，保留不影响其他功能。
  - 先依赖什么：2.1、2.2。
  - 对应需求：需求 19、需求 20
  - 对应设计：§44.1–§44.6

- [x] 5.2 Desktop：卡片回复入口、阻塞提示和新通知类型
  - 状态：DONE（2026-11-18，类型检查和相关单测通过；真实 Electron 界面未检查）
  - 修改文件：`apps/desktop/src/renderer/components/outcomego/chat-pane.tsx`、`outcomes/outcome-chat-card.tsx`；`renderer/lib/outcome-target.ts`、`i18n-catalog.ts`；`main/index.ts`；`test/outcome-native-notifications.test.ts`。
  - 验证命令：desktop `tsc --noEmit`；`bun test --isolate` 运行 `outcome-disclosure-ui`、`outcome-attention`、`outcome-native-notifications`、`outcome-client-components`；`bun scripts/check/i18n-catalog.ts`。
  - 验证结果：类型检查通过；目标相关测试通过（新增失败/阻塞通知解析用例）；i18n 检查通过。
  - 已知限制：未在真实 Electron 中查看卡片的回复入口、系统通知文案和阻塞提示。
  - 回滚方式：撤销 `chat-pane.tsx` 的 `canReply` 即恢复为 `system` 消息不可回复。
  - 对应需求：需求 19.5、19.7、需求 20.6
  - 对应设计：§44.3、§44.4、§44.6

- [x] 5.3 iOS：卡片渲染、点击打开、回复和新通知类型
  - 状态：DONE（2026-11-18，Core 测试通过；完整 App 构建受既有错误影响，真实设备未验收）
  - 修改文件：Core `OutcomeUpdateCard.swift`（新）、`OutcomeInbox.swift`；App `OutcomeUpdateCardView.swift`（新）、`ChatView.swift`；`Localizable.xcstrings`；`Tests/CoreTests/OutcomeInboxTests.swift`。
  - 验证命令：`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter OutcomeInboxTests`（在 `apps/ios`）；`xcodebuild build -scheme OutcomeGoNative -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`。
  - 验证结果：`OutcomeInboxTests` 7 项通过，含新增的卡片识别、阶段映射和新推送类型。xcodebuild 在 `QuestionCard.swift`、`TeamIntents.swift`、`AppStore.swift`、`HomeView.swift` 报错，这些文件不在本任务范围，未做干净基线对比；本任务新增的 `OutcomeUpdateCardView.swift` 与 `ChatView.swift` 无编译错误。
  - 已知限制：完整 App 未能编译通过，所以卡片视图的实际渲染、点击和上下文菜单没有运行验证；真实推送冷热启动未验证。
  - 回滚方式：删除 `ChatView.swift` 中 `outcomeUpdateCard` 分支，卡片退回文本气泡。
  - 对应需求：需求 21
  - 对应设计：§44.7

- [x] 5.4 Android：卡片渲染、点击打开、回复和新通知类型
  - 状态：DONE（2026-11-18，`package-debug.sh --test` 通过并生成 APK；未安装到设备，界面未检查）
  - 修改文件：共享 `mobile/shared/.../core/OutcomeInbox.kt` 及 `OutcomeInboxTests.kt`；Android `data/MobileData.kt`、`ui/screens/chat/ChatMessageComponents.kt`、`ChatScreen.kt`、`ui/OutcomeGoApp.kt`、`test/.../MobileDataTest.kt`。
  - 验证命令：`bash scripts/android/package-debug.sh --test`。
  - 验证结果：wrapper exit 0；`MobileDataTest` 6 项、共享 `OutcomeInboxTests` 6 项，0 失败；assembleDebug 通过。APK：`/Users/jackson/Code/openteam/apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`，SHA-256 `b98d152fbc4ceb02a0f227a8383b35777207b8fb87733ad4edac88fbde84dfb0`。该 APK 构建的是包含其他未提交改动的工作树。
  - 已知限制：未安装到设备；卡片界面、回复图标、通知点击没有运行验证。
  - 回滚方式：撤销 `MessageBubble` 中 `outcomeUpdateCard` 的提前返回，卡片退回文本气泡。
  - 对应需求：需求 21
  - 对应设计：§44.7

- [ ] 5.5 三端真实验收
  - 状态：PENDING
  - 怎么算完成：真实服务端上让一个目标进入待决策、失败和阻塞；机器人私聊出现各一张卡片且 Bot 没有新的 Run；三端收到通知并点击进入目标；在主线程引用卡片提问，机器人能用 Outcome ID 读取目标；阻塞解除后未读通知消失。
  - 怎么验证：真实设备或模拟器 + 真实服务端；执行 5.1 的集成测试。
  - 对应需求：需求 19、需求 20、需求 21
  - 对应设计：§44

