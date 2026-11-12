# 设计文档 - Outcome 收件箱与决策通知

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. Inbox 投影

Inbox 不作为新的业务事实存储，而是根据 Outcome、Decision、Review、HumanAction 和完成事件生成的查询投影。

命名说明：现有 `InboxEvent` 表是 Worker 的 Bot 级任务队列（字段有 `claimedAt`、`attempts`、`priority`），与用户可见的 Outcome Inbox 无关。Outcome Inbox 不读写 `InboxEvent`，也不在其上增加字段；代码中统一使用 `OutcomeInbox` 前缀避免混淆。

类别：

```text
DecisionPending
AcceptancePending
HumanActionPending
Completed
```

## 2. Decision 数据

```ts
interface Decision {
  id: string;
  outcomeId: string;
  contractRevision: number;
  status: 'open' | 'presented' | 'resolved' | 'rejected' | 'expired' | 'withdrawn';
  completedSummary: string;
  problemSummary: string;
  nextStepSummary: string;
  options: DecisionOption[];
  customEntryAllowed: boolean;
  resolvedAt?: string;
}
```

## 3. 事件流

```text
Run / Review / HumanAction
        ↓
事实事件
        ↓
Decision 或 Inbox projection
        ↓
用户界面和必要通知
        ↓
Decision resolved
        ↓
恢复、变更或关闭对应流程
```

内部日志不能自动升级为用户通知。

## 4. API

接口以 §9 为准：

```text
GET  /api/v0/outcome-inbox
GET  /api/v0/decisions/:decisionId
POST /api/v0/decisions/:decisionId/resolve
POST /api/v0/decisions/:decisionId/withdraw
```

解决接口必须检查 Decision 当前状态、Outcome 状态和 Contract revision。

## 5. UI

默认卡片显示：

- 为什么现在需要用户处理。
- 一句话完成情况。
- 一句话问题。
- 推荐下一步。
- 选项和自定义输入。

日志、证据和完整事件流作为展开内容。

## 6. 当前代码基线

本阶段优先复用已有数据和服务：

| 现有能力 | 文件/模型 | 复用方式 |
|---|---|---|
| Worker 任务队列 | `packages/db/prisma/schema.prisma` 的 `InboxEvent` | 不复用。它是 Worker 领取任务的队列，不是用户收件箱；Outcome 投影通过 WorkItem 的 `runId` 关联 Run |
| Channel 通知 | `ChannelNotification`、`packages/messaging/src/notifications.ts` | 只在 Outcome 需要用户处理时发布 |
| Push/outbox | `OutboxDelivery`、`apps/server/src/services/notification-service.ts`、`apps/worker/src/push-notifications.ts` | 使用现有投递和重试，不新增 Push worker |
| Desktop 通知 | `apps/desktop/src/main/notifications.ts`、`renderer/lib/notifications.ts` | 增加 Outcome target 和深链 |
| iOS/Android | 现有 `NativeNotifications`、`AndroidNotifications`、notification presence | 增加 payload 解析和打开 Outcome |
| 事件唤醒 | `apps/server/src/event-wakeup.ts`、`packages/db` 的 `Event` | 生成查询投影刷新信号（父 design.md §43） |
| 通知偏好 | `NotificationService.routing()`、`/api/notification-preferences` | 复用现有偏好开关，见 §43 |

## 7. 数据模型

### 7.1 `Decision`

```text
id                  UUID primary key
outcomeId           UUID foreign key
contractRevisionId  UUID foreign key
runId               UUID nullable
workItemId          UUID nullable
status              open | presented | resolved | rejected | expired | withdrawn
completedSummary    text
problemSummary      text
nextStepSummary     text
recommendation      JSON
options             JSON
customEntryAllowed  boolean
expiresAt           timestamp nullable
resolvedOption      JSON nullable
resolvedBy          actorRef nullable（父 design.md §44）
resolvedAt          timestamp nullable
createdAt/updatedAt timestamp
```

唯一的开放 Decision 约束需要按当前 PostgreSQL/Prisma 能力实现；如果部分索引不适合 Prisma schema，则通过已有 raw schema/deploy 机制补充并写 migration 测试。

### 7.2 `OutcomeInboxItem`

优先采用查询投影而非重复事实表。若查询多个来源成本过高，再新增：

```text
id, outcomeId, decisionId, category, priority,
dedupeKey, title, summary, availableAt, resolvedAt,
createdAt, updatedAt
```

`dedupeKey` 必须由业务事实生成，例如 `decision:<decisionId>` 或 `review:<outcomeId>:<revision>`，不能由客户端随机生成。

## 8. 事件到通知的映射

```text
contract.revision.approved → 不通知，除非用户明确要求
run.progress            → 时间线，不通知
run.finished            → acceptance_pending 或 completed
review.required         → acceptance_pending
decision.required       → decision_pending + 主动通知
human_action.required   → human_action_pending + 主动通知
outcome.accepted        → completed + 结果通知
```

事件处理器必须先检查业务事实和 dedupe key，再写 Inbox 投影或 `ChannelNotification`。Push 失败不能回滚 Outcome/Decision 事实。

## 9. API 合同

```text
GET  /api/v0/outcome-inbox?status=pending&cursor=<event-sequence>
GET  /api/v0/outcomes/:outcomeId/inbox
GET  /api/v0/decisions/:decisionId
POST /api/v0/decisions/:decisionId/resolve
POST /api/v0/decisions/:decisionId/withdraw
```

解决请求：

```json
{
  "optionId": "allow-limited-research",
  "customText": null,
  "expectedContractRevision": 2,
  "clientRequestId": "decision-client-request-id"
}
```

响应：

```json
{
  "decisionId": "<uuid>",
  "status": "resolved",
  "outcomeId": "<uuid>",
  "contractRevision": 2,
  "resume": {"status": "queued", "workItemIds": ["<uuid>"]}
}
```

如果 `expectedContractRevision` 不匹配，返回 `409 decision_revision_conflict` 和当前 Decision；不得覆盖用户在另一个客户端提交的结果。

## 10. 客户端深链

沿用现有 `packages/contracts/src/app-deep-links.ts` 的 `aiteamos://app/v1/...` 格式，只增加路径，不新增 URL scheme：

```text
aiteamos://app/v1/outcomes?id=<outcomeId>
aiteamos://app/v1/outcomes/decision?id=<decisionId>
```

原因：Android Manifest 和 iOS 工程当前只注册 `aiteamos` scheme，`004.1` 也规定该 scheme 作为稳定标识保留。新增 `outcomego` scheme 需要同时修改三端注册并保持旧 scheme，属于 `004.1` 的可选后续迁移，不在本阶段实现。Desktop 可使用现有窗口打开机制；深链只携带 ID，不携带 Decision 文本、token 或凭据。

## 11. 设计文件影响

- `packages/contracts/src/outcome-inbox.ts`（新增）
- `packages/contracts/src/notification-content.ts`
- `packages/contracts/src/app-deep-links.ts`
- `packages/contracts/src/service-protocol.ts`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<generated>_add_outcome_decisions/`
- `apps/server/src/routes/outcome-inbox.ts`（新增）
- `apps/server/src/services/outcome-inbox-service.ts`（新增）
- `apps/server/src/services/notification-service.ts`
- `apps/server/src/event-wakeup.ts`（只核对，通常无需修改）
- `packages/messaging/src/notifications.ts`
- `apps/desktop/src/renderer/components/aiteamos/outcomes/OutcomeInbox.tsx`
- `apps/desktop/src/main/notifications.ts`
- `apps/ios/Sources/Core/NotificationPresence.swift`
- `apps/ios/Sources/App/NativeNotifications.swift`
- `apps/android/app/src/main/kotlin/com/aiteamos/platform/AndroidNotifications.kt`
- `apps/android/app/src/main/kotlin/com/aiteamos/features/LiveFeatureGateway.kt` 或 Outcome API gateway

## 12. 验证策略

- Inbox 查询权限、cursor、排序、合并和去重测试。
- Decision 状态机和双客户端并发解决测试。
- revision 覆盖、过期、撤回和重复 resolve 测试。
- `ChannelNotification`、Outbox 和 Push 失败解耦测试。
- Desktop 深链、Android/iOS 深链和旧 scheme 兼容测试。
- 普通 Run 进度不产生主动通知的回归测试。
- 三段式卡片字段完整性和渐进展开 UI 测试。

## 13. Decision 状态和并发规则

### 13.1 状态转换

```text
open
  → presented
  → resolved
  → withdrawn
  → expired
  → rejected

presented → resolved | withdrawn | expired
resolved  → 不可回到 open
withdrawn → 不可 resolve
expired   → 不可 resolve
```

`presented` 表示至少一个客户端读取过 Decision，不表示用户同意。用户沉默不会触发状态转换。

### 13.2 并发 resolve

解决接口必须使用数据库条件更新：

```text
UPDATE Decision
SET status = 'resolved', resolvedBy = ?, resolvedAt = ?
WHERE id = ?
  AND status IN ('open', 'presented')
  AND contractRevisionId = expectedRevision
```

更新行数为 0 时重新读取当前 Decision：

- 已经被同一客户端解决：返回原结果。
- 被其他客户端解决：返回 `409 decision_already_resolved`。
- revision 已变化：返回 `409 decision_revision_conflict`。
- 已过期或撤回：返回当前状态，不创建新结果。

## 14. Inbox 查询模型

### 14.1 查询参数

```ts
interface OutcomeInboxQuery {
  status?: "pending" | "completed" | "all";
  category?: "decision_pending" | "acceptance_pending" | "human_action_pending" | "completed";
  cursor?: string;
  limit?: number;
}
```

服务端限制 `limit`，默认按 `priority DESC, availableAt ASC, createdAt ASC` 排序。cursor 使用已有 Event/sequence 或稳定的投影游标，不使用客户端时间戳作为分页边界。

### 14.2 投影输入

Inbox 查询需要组合：

| 输入 | 用途 |
|---|---|
| Outcome 状态 | 判断 completed、running 和 pending |
| Decision 状态 | 生成 decision_pending |
| Review 状态 | 生成 acceptance_pending |
| Human WorkItem 状态 | 生成 human_action_pending |
| Contract revision | 使旧 Decision 失效 |
| Notification/read state | 计算是否已读，不改变业务状态 |
| Event cursor | 增量刷新 |

查询层不能通过“最后一条消息”猜测 Outcome 状态。没有对应业务事实时不生成 Inbox 项。

## 15. Decision 生成规则

Decision 由服务端事实触发，最小输入为：

```ts
interface DecisionCreateInput {
  outcomeId: string;
  contractRevisionId: string;
  runId?: string;
  workItemId?: string;
  reasonCode: string;
  completedSummary: string;
  problemSummary: string;
  nextStepSummary: string;
  recommendation?: { optionId: string; reason: string };
  options: Array<{ id: string; label: string; consequence: string }>; // 1..4
  customEntryAllowed: boolean;
  expiresAt?: string;
  idempotencyKey: string;
}
```

reason code 示例：

```text
scope_change_required
missing_input
acceptance_failed
external_result_unknown
manual_action_required
unsupported_action
budget_or_time_decision
```

每个 reason code 必须有 UI 解释和恢复动作。未知 reason code 可以写入事实，但客户端使用通用 Decision 卡，不把内部异常直接显示给用户。

## 16. 三段式卡片渲染合同

### 默认层

```ts
interface DecisionCardSummary {
  decisionId: string;
  outcomeId: string;
  title: string;
  category: "decision_pending" | "acceptance_pending" | "human_action_pending" | "completed";
  completed: string;
  problem: string;
  next: string;
  recommendedOptionId?: string;
  availableOptionCount: number;
  requiresAction: boolean;
}
```

默认层不得包含：完整事件流、模型原始思考、内部 token、provider payload、凭据、未脱敏路径或与用户无关的系统日志。

### 展开层

展开后可以读取：

- Contract revision 和变更摘要。
- Recommendation 来源。
- 时间、成本、影响和替代方案。
- Evidence 摘要及来源链接。
- 关联 Run/WorkItem 状态。

### 高级层

只有用户主动展开时显示：

- Event ID 和 correlation ID。
- 运行状态和重试计数。
- Checkpoint 摘要。
- 审计结果和失败码。

## 17. 通知去重和投递

### 17.1 事实 key

```text
decision.required:<decisionId>
review.required:<outcomeId>:<contractRevision>:<criterionGroup>
human_action.required:<workItemId>
outcome.completed:<outcomeId>:<acceptedRevision>
```

事实 key 写入已有通知模型或 Outbox 前必须唯一。Push 重试使用现有 Outbox delivery key，不由客户端重新生成。

### 17.2 通知内容

推送 payload 只携带：

```json
{
  "type": "outcome.decision.required",
  "outcomeId": "<uuid>",
  "decisionId": "<uuid>",
  "category": "decision_pending",
  "title": "需要决定下一步",
  "body": "技术方案中有一项范围需要确认",
  "deepLink": "aiteamos://app/v1/outcomes/decision?id=<decisionId>"
}
```

不携带完整 Contract、资料内容、私有文件名、token 或用户自定义的敏感内容。客户端通过深链和 API 读取详情。

### 17.3 Push 失败

Push 失败不改变 Decision 或 Inbox 状态。现有 Outbox 重试可以继续；超过重试后，用户仍能在 Inbox 看到该项目。失败记录必须包含 provider error code，不包含密钥和完整 payload。

## 18. 现有通知设施的集成细节

实现者必须在代码审计中核对：

- `packages/messaging/src/notifications.ts` 如何发布 `ChannelNotification`。
- `ChannelReadState.lastReadNotificationSequence` 如何更新。
- `apps/server/src/services/notification-service.ts` 的 push registration、presence 和 outbox 关系。
- `apps/worker/src/push-notifications.ts` 如何 claim 和 retry `OutboxDelivery`。
- Desktop `notifications.ts` 如何把服务器通知转为原生 banner。
- iOS/Android 现有 notification service 如何解析 payload 和深链。

Outcome notification 应该沿用现有消息/通知的读标记和推送机制；如果需要新类型，应扩展共享 `notification-content.ts`，而不是在每个平台定义不同 JSON。

## 19. UI 交互状态

| UI 状态 | 触发 | 可用操作 | 服务端状态 |
|---|---|---|---|
| Loading | 首次读取 | 无 | unchanged |
| Ready | 数据返回 | 打开、展开、resolve | unchanged |
| Resolving | 提交选择 | 禁止重复提交 | request in progress |
| Resolved | 成功 | 查看后续状态 | resolved |
| Conflict | 409 | 刷新当前 Decision | unchanged/current |
| Expired | 410/状态读取 | 查看原因、创建新方案 | expired |
| Error | 网络/API 错误 | 重试 | unchanged |

客户端在 `Resolving` 状态不应允许用户重复点击产生第二个 client request ID；重试必须复用同一个 request ID，除非服务端明确返回可重试的新请求。

## 20. 深链和旧客户端兼容

### Desktop

Desktop 深链处理器读取 `outcomeId`/`decisionId`，验证格式后打开对应窗口或当前 renderer route。深链缺少 ID 时打开 Inbox 首页，不抛出未处理异常。

### Android

Android 继续使用现有 `aiteamos` scheme，在现有 App Link 解析中增加 `outcomes` 路径。Intent extras 只保存 ID；用户未登录时先完成现有认证，再恢复 deep link。

### iOS

iOS 使用现有 URL scheme/universal link 分发。应用启动、后台恢复和通知点击都进入同一个 pending deep link reducer，防止重复打开和丢失 Decision。

## 21. 离线和刷新

离线时：

1. 显示最后一次成功的 Inbox snapshot，并标记可能过期。
2. 禁止提交依据旧 revision 的 Decision，除非服务端仍接受并返回成功。
3. 网络恢复后使用 cursor 或重新读取 Outcome。
4. 过期/撤回的旧卡片从待处理列表移除，但保留历史结果。

## 22. 文件影响和测试夹具

新增测试夹具：

```text
apps/server/test/fixtures/outcome-inbox/
  decision-open.json
  decision-expired.json
  decision-superseded.json
  duplicate-notification.json
  concurrent-resolve.json
apps/desktop/test/fixtures/outcome-inbox/
  default-card.json
  expanded-card.json
  conflict-card.json
```

必须覆盖的现有文件：

- `packages/contracts/src/notification-content.ts`
- `packages/contracts/src/app-deep-links.ts`
- `packages/messaging/src/notifications.ts`
- `apps/server/src/services/notification-service.ts`
- `apps/worker/src/push-notifications.ts`
- `apps/desktop/src/main/notifications.ts`
- `apps/ios/Sources/App/NativeNotifications.swift`
- `apps/android/app/src/main/kotlin/com/aiteamos/platform/AndroidNotifications.kt`

## 23. 验收和回滚

验收顺序：

1. 仅 API 查询和 resolve。
2. Desktop Inbox 和 Decision 卡。
3. ChannelNotification/Outbox。
4. Desktop native notification。
5. Android/iOS 深链和 push。
6. 双客户端并发、离线、过期和旧 payload 回放。

回滚时：

- 保留 Decision 和 Inbox 数据，不删除业务事实。
- 暂停新主动通知类型，但继续提供 API 查询。
- 旧客户端收到未知通知类型时使用 fallback 或忽略。
- 通过服务端 capability/版本判断隐藏 UI，不删除数据库列。

## 24. 设计决策记录

实现前必须记录：

- Inbox 使用实时查询还是持久化投影。
- 是否复用 `ChannelNotification`，还是为 Outcome 创建独立通知类型。
- `Decision` 是否需要独立表，还是作为 Outcome event payload。
- 非紧急通知是否支持聚合窗口。
- Android/iOS 第一版是否同时支持主动 push，还是先支持 Inbox 查询。
- Decision 过期时间是否由 Contract、WorkItem 或服务端默认值提供。

## 25. Server service 分层

建议将本阶段服务拆成窄职责：

```text
OutcomeInboxService
  ├─ list(query, auth)
  ├─ get(outcomeId, auth)
  ├─ buildItem(fact)
  └─ acknowledgeRead(input)

DecisionService
  ├─ create(input)
  ├─ present(id, client)
  ├─ resolve(id, input, auth)
  ├─ withdraw(id, reason)
  └─ expire(now)

OutcomeNotificationProjector
  ├─ consume(event)
  ├─ dedupe(factKey)
  ├─ publishChannelNotification(fact)
  └─ enqueuePush(fact)
```

`DecisionService` 是业务事实的唯一写入者；`OutcomeInboxService` 只读或生成查询投影；`OutcomeNotificationProjector` 不改变 Outcome/Decision 状态。

## 26. Route 鉴权和查询顺序

每个 route 执行顺序：

1. 解析认证上下文。
2. 解析和限制 query/body 大小。
3. 按 owner/关联对象查询，不先按客户端提供的 ID 返回详情。
4. 检查 revision/Decision 状态。
5. 执行 service。
6. 映射稳定 DTO 和错误。
7. 记录 correlation ID，不记录完整私有 payload。

禁止先 `findUnique(decisionId)` 再在应用层忘记检查 owner。查询必须把 owner 关系放进 Prisma where 或等价 SQL 条件。

## 27. Inbox 查询 SQL/ORM 形状

如果采用实时查询，推荐先查询待处理主键，再批量加载详情：

```text
select outcome/decision/work_item ids
  where owner = current owner
    and status in pending categories
  order by priority, availableAt, createdAt
  limit N

batch load Outcome, ContractRevision, Decision, Review, Evidence summary
map to OutcomeInboxItemView
```

不要对每张 Inbox 卡片执行多个串行查询。实现任务必须为 N+1 查询添加测试或查询日志断言。

## 28. 已读和已处理的区别

| 概念 | 作用 | 是否关闭业务项 |
|---|---|---:|
| presented | 客户端已读取卡片 | 否 |
| read | 用户看过通知 | 否 |
| resolved | 用户提交并被服务端接受 | 是，按 Decision |
| accepted | 验收条款通过 | 是，按 Outcome |
| withdrawn | 被新 revision/事实替代 | 是，旧卡片不可操作 |

客户端通知已读不能调用 Decision resolve。通知 read marker 失败也不能阻止业务 resolve。

## 29. Decision 与 Contract revision 的关系

Decision 创建时固定 `contractRevisionId`。Resolve 时根据 `resolutionEffect` 分类：

```text
plan_only
  → keep same revision, record plan change

scope_change
  → create new draft revision, require approval

acceptance_change
  → create new draft revision, invalidate affected review

cancel_branch
  → close affected WorkItem, preserve Outcome history

manual_action
  → create/activate human WorkItem
```

Decision 不能直接修改已批准的 Contract JSON。`resolutionEffect` 由服务端根据 Decision type 和选项定义决定，客户端只能提交 option ID/custom text。

## 30. Decision 选项持久化

选项保存完整快照：

```json
{
  "id": "allow-limited-research",
  "label": "允许限额补充研究",
  "consequence": "只增加研究 WorkItem，不改变生产边界",
  "createdAt": "<iso>",
  "source": "planner|runtime|reviewer"
}
```

不能只保存 option ID，因为规划器或代码版本变化后无法解释历史选择。custom text 作为 separate field 保存，不能覆盖 option label。

## 31. 过期和撤回 job

过期处理可以由现有 Worker/Routine 机制执行，必须是幂等的：

```text
find open/presented Decision where expiresAt <= now
  → conditional update to expired
  → create decision.expired event
  → revoke pending notification if supported
  → keep Inbox history
```

撤回处理由 Contract revision supersede、Outcome cancel 或人工动作关闭触发。撤回不删除通知历史；客户端打开旧 deep link 时展示“已由新状态替代”。

## 32. Notification priority

优先级只影响排序和投递，不改变业务状态：

```text
0  ordinary completed result
1  acceptance required
2  human action required
3  decision required
4  urgent safety/operation issue explicitly emitted by service
```

普通 Run progress 不创建 priority item。优先级不由模型自由设置，必须由事件类型或服务端规则映射。

## 33. 合并和去重规则

同一 Outcome 的多个待验收条款可以合并为一个 `acceptance_pending` 卡，但卡片详情必须列出所有 criterion。多个 Decision 不能盲目合并，因为每个 Decision 可能有不同 revision、期限和恢复动作。

可合并条件：

- 同一个 Outcome。
- 同一个 Contract revision。
- 同一个用户动作类型。
- 没有相互冲突的过期时间。

不可合并条件：

- 不同 Contract revision。
- 一个 Decision 解决会改变另一个 Decision 的有效性。
- 一个项目需要立即处理而另一个可以等待。

## 34. Push payload 版本

```json
{
  "schemaVersion": 1,
  "type": "outcome.decision.required",
  "factKey": "decision.required:<decisionId>",
  "outcomeId": "<uuid>",
  "decisionId": "<uuid>",
  "category": "decision_pending",
  "title": "需要处理一个 Outcome",
  "body": "有一项范围需要确认",
  "deepLink": "aiteamos://app/v1/outcomes/decision?id=<decisionId>"
}
```

新增字段必须可选；旧客户端遇到未知 `type` 时只显示通用消息或忽略，不能崩溃。服务端不把完整 Decision options 放入 push payload。

## 35. Native notification integration

### Desktop

主进程接收 push/event 后保存一个 bounded pending target：`outcomeId`、`decisionId`、`category`。renderer 打开后重新从 API 获取卡片。主进程不缓存完整 Decision 文本。

### Android

通知 service 解析 schemaVersion/type/deepLink，校验 ID 格式，写入现有 pending intent。点击通知后由 Activity/Compose 读取 pending target 并请求 API。

### iOS

通知 service extension 只处理标题/body/artwork，不读取私有 Decision 内容。App 收到点击后通过现有 AppStore/route reducer 获取 API 详情。

## 36. API contract test cases

```text
GET inbox without auth                    → 401
GET another owner's outcome               → 404
GET with invalid cursor                   → 400
GET limit above max                       → capped/rejected
resolve open Decision                     → 200 resolved
resolve already resolved same request    → stored result
resolve already resolved other request   → 409
resolve expired                           → 409/410 current status
resolve old revision                      → 409 revision conflict
resolve custom text when disabled         → 422
resolve option not in snapshot            → 422
withdraw then resolve                     → 409 withdrawn
duplicate notification fact               → one outbox intent
ordinary progress event                   → no push intent
```

## 37. 数据库清理

Inbox projection/notification cleanup 不得删除 Outcome、Decision、Review 或 Evidence。可以清理：

- 已过期的 transient presentation marker。
- 已投递且超过保留期的 Outbox delivery metadata。
- 已撤回通知的临时 payload，前提是保留事实 key 和历史摘要。

清理 job 必须按 owner/createdAt 分页，不锁住整个通知表。

## 38. 运行时错误恢复

### Projector 失败

事实事件保留，projector 按 event ID 重试。重复消费不能创建第二个 Decision 或通知。

### API resolve 后响应丢失

客户端使用相同 request ID 查询或重试。服务端返回 stored response，不重新触发恢复。

### Push provider 宕机

Inbox 仍可读；Outbox retry 按现有规则运行。Push 永远不是 Decision 状态的唯一载体。

### 客户端版本过旧

返回兼容的 summary，未知详情字段忽略；必要时隐藏新操作按钮，但不隐藏已有业务事实。

## 39. 可观测性

最低日志字段：

```text
correlationId
eventId/factKey
outcomeId
decisionId
owner/session hash
category
status transition
notification provider result
```

禁止日志字段：完整 Decision options、custom text（除非已有业务日志明确允许）、认证 token、Push token、私有资料正文。

指标：

- open Decision 数量。
- Decision resolve latency。
- 过期/撤回比例。
- Inbox query latency。
- projector duplicate count。
- push success/failure/retry。
- 普通 progress 被错误升级为通知的数量。

## 40. 设计决策记录扩展

实现前必须决定：

- 是否提供批量 resolve；第一版建议不提供。
- 是否允许 Decision 转交给其他用户；当前不做。
- 是否在移动端支持离线填写；可以保存草稿，但提交必须在线校验 revision。
- 是否将 completed 结果保留在 Inbox；建议保留可配置时间，不影响历史 Outcome。
- 是否使用 WebSocket/event stream 实时刷新；第一版可以使用现有 event/snapshot 轮询。

## 41. Agent 发起的 Decision：`RequestOutcomeDecision`

原规划 §9.1 要求 Agent 在需要决策时升级到 Outcome Inbox。现有 Agent 没有这个入口，因此新增一个内部工具，沿用现有内部工具的实现方式（computer 声明工具，server `internal-tool-service.ts` 处理，与 `ReportTaskProgress` 相同）。

工具参数：

```ts
interface RequestOutcomeDecisionInput {
  completedSummary: string;   // 已完成的内容
  problemSummary: string;     // 当前问题；没有阻塞时写“无阻塞”
  nextStepSummary: string;    // 需要用户决定什么
  reasonCode: "scope_change_required" | "missing_input" | "acceptance_failed"
            | "external_result_unknown" | "manual_action_required" | "budget_or_time_decision";
  options: Array<{ label: string; consequence: string; recommended?: boolean; reason?: string }>; // 1..4
}
```

处理流程：

1. server 根据调用方 Run 的 InboxEvent payload 找到 `outcomeWorkItemId`；找不到时返回工具错误（普通 Run 拿不到该工具，这里只处理异常情况）。
2. 在一个事务内：创建 Decision（`idempotencyKey = decision-request:<runId>:<sha256(input)>`）、将该 WorkItem 置为 `waiting_decision`、写 `decision.required` 事件、重新计算 Outcome 状态。
3. 工具返回 `{ decisionId, status: "waiting_for_user" }`，Agent 结束当前回合，不轮询等待。
4. 用户解决 Decision 后：
   - 选择不改变范围：服务端为同一 WorkItem 提交一条新消息到原 Bot 会话（带相同 `outcomeWorkItemId`），内容为用户选择，WorkItem 回到 `running`。
   - 选择改变目标、验收或边界：按 §29 创建 revision N+1 并进入 `pending_approval`，原 WorkItem 标记 `cancelled`，批准后按新 revision 创建 WorkItem。
5. 依赖该 WorkItem 的其他 WorkItem 保持 `queued`，不依赖它的 WorkItem 继续执行。

工具只在带 `outcomeWorkItemId` 的 Run 中出现，普通 Run 的工具列表保持不变。

## 42. Decision 选项上限

Decision 的推荐选项为 1–4 个，并始终提供自定义输入。这一上限来自原规划 §11.3 的建议，与规划三维度的四项上限保持一致，方便用户快速选择。服务端在创建时截断超出部分并记录截断数量。

## 43. 通知偏好、静默和合并

原规划 §11.5 中通知渠道、静默窗口、逾期升级和优先级都未确认。本阶段只复用现有能力，不新增设置项：

1. 主动通知遵守现有 `NotificationService.routing()` 的全局智能通知开关和 Bot 的 `notificationsEnabled`。关闭后不推送，但 Inbox 仍然显示该事项。
2. 不实现自定义静默时间窗口和逾期自动升级；Decision 可以设置 `expiresAt`，过期后进入 `expired`，不视为同意（§31）。
3. 同一 Outcome、同一 revision 的非紧急通知在 60 秒内合并为一条推送；Decision 不与其他 Decision 合并（§33）。
4. `priority=4` 的紧急事件只由服务端规则产生（例如 `external_result_unknown`），不受合并窗口影响。
