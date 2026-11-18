# 需求文档 - Outcome 收件箱与决策通知

状态：Approved（2026-11-17）

关联文档：[README.md](README.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 简介

Outcome Inbox 将用户真正需要处理的事项集中为待决策、待验收、待用户执行和已完成四类，减少普通执行过程对用户的打扰。

## 范围说明

### In Scope

- Inbox 投影。
- Decision 卡片。
- 三段式结果和问题说明。
- Decision 解决和自定义选项。
- 必要通知和普通进度静默。
- 渐进式披露。

### Out of Scope

- 通用消息中心。
- 全量替换现有聊天和通知系统。
- 未经确认的复杂通知渠道编排。
- 自定义静默时间窗口和逾期升级规则（复用现有通知偏好开关，见 design.md §43）。

## 需求

### 需求 1：展示用户待处理事项

**用户故事：** 作为用户，我希望一眼看到需要我处理的事项，以便不必追踪所有 Agent 进度。

#### 验收标准

1. WHEN Outcome 需要用户处理 THEN System SHALL 在 Inbox 中展示其类别和原因。
2. WHEN Outcome 正常执行且没有用户动作 THEN System SHALL 不将普通进度升级为主动通知。
3. WHEN Outcome 已完成 THEN System SHALL 展示成果和验收状态。

### 需求 2：展示三段式 Decision

**用户故事：** 作为用户，我希望每个决策卡都说明完成情况、问题和下一步，以便快速做出决定。

#### 验收标准

1. WHEN Decision 展示 THEN System SHALL 包含已完成、当前问题和下一步。
2. WHEN Decision 没有阻塞问题 THEN System SHALL 明确显示无阻塞或无未解问题。
3. WHEN 用户选择自定义方案 THEN System SHALL 保存实际选择文字。

### 需求 3：解决 Decision

**用户故事：** 作为用户，我希望解决 Decision 后任务能够继续，以便不需要重新创建 Outcome。

#### 验收标准

1. WHEN 用户提交选择 THEN System SHALL 记录 Decision 结果和时间。
2. WHEN Decision 影响执行范围 THEN System SHALL 关联新的 Contract revision 或明确保留原范围。
3. WHEN Decision 已过期或被替代 THEN System SHALL 阻止旧结果作用于新执行。

## 非功能需求

### 非功能需求 1：可读性

1. 默认视图只显示用户下一步和一句话上下文。
2. 详细依据、日志和证据可以逐层展开。

### 非功能需求 2：通知节制

1. 普通进度保留在时间线，不主动推送。
2. 只有结果、必要决策或重大异常进入主动通知路径。

## 成功定义

- 用户可以只查看 Inbox 完成一个需要决策的 Outcome。
- 普通进度不会形成高频主动通知。
- Decision 结果能够恢复或改变对应执行流程。

## 详细需求

### 需求 4：Inbox 查询具有稳定分类

**用户故事：** 作为用户，我希望首页只显示当前需要我处理的 Outcome，以便不用阅读所有运行日志。

#### 验收标准

1. WHEN 查询 Inbox THEN System SHALL 返回 `decision_pending`、`acceptance_pending`、`human_action_pending` 和 `completed` 四类项目。
2. WHEN 同一个 Outcome 同时产生多个待处理事件 THEN System SHALL 按 Outcome 合并或明确显示多个独立动作，不生成重复卡片。
3. WHEN 项目已被用户处理或被新 revision 覆盖 THEN 旧卡片 SHALL 不再出现在待处理列表。
4. WHEN 请求未通过现有认证中间件 THEN API SHALL 不返回任何 Outcome 标题、摘要或 Decision 内容（单 owner 系统，不做按 owner 过滤，父 design §44）。

### 需求 5：Decision 卡片内容完整

**用户故事：** 作为用户，我希望不用打开完整日志就能理解一个决策，以便快速选择下一步。

#### 验收标准

1. WHEN Decision 为 `open` 或 `presented` THEN 卡片 SHALL 包含完成情况、当前问题、下一步/需要决策、推荐依据和影响摘要。
2. WHEN 没有阻塞问题 THEN 卡片 SHALL 明确显示“无阻塞/无未解问题”，不能省略问题字段。
3. WHEN Decision 有证据 THEN 卡片 SHALL 能展开到 Evidence、Contract revision 和 Run。
4. WHEN 用户输入自定义选项 THEN API SHALL 保存实际文字和提交主体。

### 需求 6：Decision 解决与流程恢复

**用户故事：** 作为用户，我希望提交决定后原 Outcome 可以继续，而不是重新开始。

#### 验收标准

1. WHEN 用户解决有效 Decision THEN System SHALL 事务性保存选择、时间、主体和结果范围。
2. WHEN Decision 只影响执行计划 THEN System SHALL 允许原 Contract revision 继续，并记录计划变化。
3. WHEN Decision 改变目标、验收或边界 THEN System SHALL 创建新的 Contract revision 或回到批准状态。
4. WHEN Decision 已过期、撤回或属于旧 revision THEN System SHALL 拒绝解决并返回当前卡片状态。
5. WHEN Decision 解决成功且不改变范围 THEN System SHALL 在原 WorkItem 的同一 Outcome 子线程中开启新回合继续执行，不能重复创建不相关 Run，也不打断 Bot 主对话。

### 需求 7：通知策略与现有通道兼容

**用户故事：** 作为用户，我希望结果和必要决策能到达我，同时普通过程不产生噪声。

#### 验收标准

1. WHEN Outcome 进入 `completed`、`decision_pending`、`acceptance_pending` 或 `human_action_pending` THEN System SHALL 创建一个可查询的通知事实；失败和执行方上报阻塞见需求 20。
2. WHEN 同一个事实重复处理 THEN System SHALL 通过稳定 key 只产生一个主动通知意图。
3. WHEN 普通 Run 进度或内部 WorkItem 完成 THEN System SHALL 不创建主动 push 通知。
4. WHEN 当前客户端不支持新通知 payload THEN System SHALL 返回通用 fallback，而不阻塞业务状态。

### 需求 8：渐进式披露

**用户故事：** 作为用户，我希望默认只看到下一步，但需要时可以深入证据和运行细节。

#### 验收标准

1. WHEN 默认打开 Inbox THEN System SHALL 只展示标题、状态、完成摘要、问题和下一步。
2. WHEN 用户展开详情 THEN System SHALL 显示推荐依据、影响、Evidence 和 Contract revision。
3. WHEN 用户进入高级详情 THEN System SHALL 能查询 Run、事件和审计信息，但不把内部日志默认推送。

## 失败和并发场景

| 场景 | 预期行为 |
|---|---|
| 两个客户端同时解决 Decision | 只有一个结果成功；另一个收到当前状态 |
| Contract 被新 revision 覆盖 | 旧 Decision 自动 `withdrawn` |
| Push 发送失败 | Inbox 事实保留，Outbox 记录失败并可按现有机制重试 |
| 用户离线 | 重新连接后通过 Inbox cursor 获取未处理项目 |
| Decision 过期 | 不默认为同意；允许创建新的 Decision |
| 通知重复投递 | 客户端按通知 key/事件 ID 去重 |

## 需求 9：Inbox 读取和业务事实分离

**用户故事：** 作为用户，我希望通知读状态不会改变 Outcome 业务状态，以便查看卡片不会误操作任务。

#### 验收标准

1. WHEN 用户读取 Inbox 或打开通知 THEN System SHALL 只更新 read/presented 状态，不自动 resolve Decision。
2. WHEN NotificationService 或 Push 失败 THEN Decision 和 Outcome SHALL 仍然可通过 API 查询。
3. WHEN Inbox 投影重建 THEN 业务事实、Decision、Review 和 Evidence SHALL 保持不变。
4. WHEN 一个客户端已读通知、另一个客户端打开 Inbox THEN 两者 SHALL 看到同一业务状态。

## 需求 10：Decision 解决具有 revision 条件

**用户故事：** 作为用户，我希望在旧 Decision 已经失效时得到明确提示，以便不会误操作新的 Contract。

#### 验收标准

1. WHEN resolve 请求带有旧 `expectedContractRevision` THEN System SHALL 返回 revision conflict，不执行选择。
2. WHEN Decision 已被新 revision 撤回 THEN System SHALL 返回 withdrawn 状态和新的 Outcome 入口。
3. WHEN 同一客户端重复提交相同 request ID THEN System SHALL 返回第一次结果。
4. WHEN 两个客户端并发提交不同选择 THEN 只有一个可以成功，另一个得到当前 Decision 状态。

## 需求 11：通知内容不泄露业务正文

**用户故事：** 作为用户，我希望锁屏或系统通知只提供足够的提醒，以便敏感资料不会进入第三方通知 payload。

#### 验收标准

1. WHEN 创建 Push payload THEN System SHALL 只包含 Outcome/Decision ID、类型、简短标题、摘要和深链。
2. WHEN Decision 包含资料、文件或客户正文 THEN Push payload SHALL 不包含其完整内容。
3. WHEN 客户端打开深链 THEN System SHALL 通过已认证 API 读取详情。
4. WHEN 未登录或会话过期 THEN System SHALL 先进入现有认证流程，不显示私有 Decision 正文。

## 需求 12：旧客户端和未知事件兼容

**用户故事：** 作为现有用户，我希望新 Outcome 通知不会让旧客户端崩溃或丢失普通消息通知。

#### 验收标准

1. WHEN 旧客户端收到未知通知类型 THEN SHALL 使用通用 fallback 或忽略，不崩溃。
2. WHEN 旧客户端读取 Inbox API 的新增字段 THEN SHALL 能忽略未知字段并继续解析已知字段。
3. WHEN 新服务端发送 Outcome 通知 THEN 现有普通消息/Reaction 通知 SHALL 继续可读和可推送。
4. WHEN 新客户端连接旧服务端 THEN SHALL 隐藏不支持的 Outcome 入口或显示能力不可用。

## 需求 13：Inbox 性能和分页可控

**用户故事：** 作为用户，我希望 Inbox 在项目和通知较多时仍能打开，以便不用等待全量历史加载。

#### 验收标准

1. WHEN Inbox 查询带有 cursor 和 limit THEN System SHALL 返回稳定分页结果，不重复或跳过同一页项目。
2. WHEN 用户拥有大量已完成 Outcome THEN 默认查询 SHALL 只加载当前待处理项目。
3. WHEN 读取详情 THEN System SHALL 不为每张卡片执行无界的串行数据库查询。
4. WHEN 通知投影积压 THEN Inbox 查询 SHALL 仍能读取已提交业务事实，并显示投影延迟状态（如有）。

## 非功能需求补充

### 非功能需求 3：一致性

1. Decision resolve、revision 变化和 Inbox 状态必须在同一业务事务边界内保持一致。
2. Push、Desktop banner 和 read marker 不得成为业务状态的唯一事实。

### 非功能需求 4：隐私

1. 日志、Push payload、Outbox payload 和客户端缓存不得保存完整敏感 Decision 正文。
2. deep link 只携带对象 ID，不携带 token、custom text 或资料正文。

### 非功能需求 5：兼容性

1. 新增通知 schema 字段必须可选。
2. 新类别必须有旧客户端 fallback。
3. 旧 URL scheme 和现有通知 read state 必须继续工作。

## API 验收矩阵

| API | 成功 | 失败/边界 | 验证 |
|---|---|---|---|
| `GET /outcome-inbox` | 分页待处理项 | 无 auth、非法 cursor | route/integration |
| `GET /decisions/:id` | 三段式详情 | expired、withdrawn、不存在 | service/API |
| `POST /decisions/:id/resolve` | stored result | revision conflict、并发、custom disabled | transaction/concurrency |
| `POST /decisions/:id/withdraw` | withdrawn | already resolved、旧 revision | state tests |
| notification projection | one fact/one intent | duplicate event/provider failure | projector/outbox |

## 需求 14：Agent 可以请求用户决策

**用户故事：** 作为用户，我希望 Agent 在需要我选择时主动提出，而不是自行扩大范围或停在原地。

#### 验收标准

1. WHEN Outcome 子线程中的 Agent 需要用户选择 THEN Agent SHALL 能调用 `RequestOutcomeDecision`，提交已完成内容、当前问题、下一步和 1–4 个选项，然后结束当前回合。
2. WHEN 工具被调用 THEN System SHALL 创建 Decision，只把该 WorkItem 和依赖它的 WorkItem 置为 `waiting_decision`，其他独立 WorkItem 继续。
3. WHEN 普通 Run、主对话或 Routine 线程 THEN 该工具 SHALL 不出现在工具列表中。
4. WHEN 同一 Run 重复调用相同请求 THEN System SHALL 只创建一个 Decision。

## 需求 15：Decision 推荐选项有上限和来源

#### 验收标准

1. WHEN 创建 Decision THEN 推荐选项 SHALL 为 1–4 个，并始终允许自定义输入（原规划 §11.3）。
2. WHEN 有推荐项 THEN SHALL 附带推荐理由。
3. WHEN 用户提交自定义内容 THEN System SHALL 保存原文，并按 design.md §29 判断是否需要新 revision。

## 需求 16：通知尊重现有偏好且沉默不等于同意

#### 验收标准

1. WHEN 用户在现有通知偏好中关闭智能通知或 Bot 通知 THEN Outcome 通知 SHALL 遵守相同设置，但 Inbox 中的事项保持可见。
2. WHEN Decision 过期 THEN System SHALL 标记 `expired`，不得视为同意任何选项。
3. WHEN 同一 Outcome 在短时间内产生多个非紧急通知 THEN System SHALL 按 design.md §33 合并。

## 需求 17：子线程汇报不打扰主对话

**用户故事：** 作为用户，我希望 Outcome 的汇报集中在 Inbox，而不是插进我和 Bot 的日常对话。

#### 验收标准

1. WHEN Outcome 子线程产生结果、待验收、待决策或待人工处理 THEN System SHALL 写入 Inbox 事实并按需通知，不以 Bot 身份向主对话写入消息；平台可以另行写入一张不属于 Bot、不唤醒 Bot 的目标通知卡片（需求 19）。
2. WHEN 子线程需要主线程处理的交接（例如重新授权连接） THEN System SHALL 使用现有 `WakeParent`，等主线程空闲后处理，不打断主线程当前回合。
3. WHEN 同一事实同时满足 Inbox 通知和 `WakeParent` 条件 THEN 用户 SHALL 只收到一次主动通知。

## 需求 18：移动端可以查看 Inbox 并解决 Decision

**用户故事：** 作为用户，我希望在手机上收到决策通知后直接处理。

#### 验收标准

1. WHEN 用户在 Android/iOS 打开 Outcome Inbox THEN System SHALL 显示四类待处理项和三段式卡片默认层。
2. WHEN 用户在移动端选择选项或输入自定义内容 THEN System SHALL 使用与 Desktop 相同的 resolve API 和冲突处理。
3. WHEN 卡片类别为待验收或待人工处理 THEN 移动端 SHALL 只读显示，并提示“请在 Desktop 完成”（父 design §41）。
4. WHEN 用户点击通知 THEN 移动端 SHALL 通过深链打开对应 Decision 或 Outcome。

## 需求 19：目标通知卡片出现在机器人对话中但不属于机器人

**用户故事：** 作为用户，我希望目标在独立线程中运行时，需要我处理的变化会在对应机器人的对话里留下一张目标卡片并通知我，而不会因此打扰机器人或改变主对话的上下文。

#### 验收标准

1. WHEN 通知事实（需求 7、需求 20）被投影 THEN System SHALL 在该 Outcome 所属 Bot 的私聊频道写入一张目标卡片，卡片的发送者为 `system`，不是 Bot。
2. WHEN 同一事实被重复处理或对账 THEN System SHALL 通过由事实 key 派生的 `clientId` 只保留一张卡片。
3. WHEN 卡片写入 THEN System SHALL 不创建 Run、投递或唤醒，主对话中的机器人 SHALL 不因此开始工作。
4. WHEN Bot 读取自己的转录 THEN System SHALL 不返回这类卡片；只有用户引用该卡片发言时，引用内容和 Outcome ID 才进入该回合的提示。
5. WHEN 用户在 Desktop、iOS 或 Android 查看卡片 THEN 客户端 SHALL 读取 Outcome 的当前状态显示阶段，保存的阶段只在读取失败时作为回退。
6. WHEN 用户关闭了 Bot 通知、频道静音或智能通知 THEN System SHALL 仍写入卡片，只跳过主动通知（需求 16）。
7. WHEN 用户对卡片点击 THEN 客户端 SHALL 就地打开对应目标详情；客户端 SHALL 对卡片提供「回复」入口以便引用，不提供让 Bot 被动收到的其他入口。

## 需求 20：失败和执行方上报的阻塞也会通知

**用户故事：** 作为用户，我希望目标失败，或执行方明确告诉我某项任务被阻塞时，不必主动打开目标页面也能知道。

#### 验收标准

1. WHEN 当前 revision 的全部 Agent 尝试失败且 Outcome 状态为 `failed` THEN System SHALL 创建 `outcome.failed` 通知事实，其 key 随失败尝试集合变化，重试后再次失败会再次通知。
2. WHEN 执行中的 WorkItem 通过 `ReportOutcomeProgress` 上报了 `blocked` 任务且 Outcome 仍为 `running` THEN System SHALL 创建 `outcome.blocked` 通知事实。
3. WHEN 阻塞任务不再是 `blocked`、Outcome 离开 `running` 或失败状态被重试覆盖 THEN 事实 SHALL 失效，尚未发出的推送 SHALL 在发送前被丢弃（沿用 `outcomeNotificationIsCurrent`）。
4. WHEN 部署后首次对账 THEN System SHALL 只补发近 2 天内的失败事实，不为更早的历史失败批量通知。
5. WHEN 处理这两类事实 THEN System SHALL 不新增 Inbox 类别：它们只产生通知和卡片，Inbox 的四个类别和查询保持不变。
6. WHEN 通知 payload 生成 THEN System SHALL 使用固定文案，不包含目标标题、任务名或错误详情（需求 11）。

## 需求 21：移动端渲染目标卡片并识别新通知类型

**用户故事：** 作为手机用户，我希望在聊天里看到目标卡片，点击进入目标，并能收到失败和阻塞的通知。

#### 验收标准

1. WHEN iOS 或 Android 收到发送者为 `system`、带 `source = outcome-update` 的目标卡片 THEN 客户端 SHALL 渲染为目标卡片，而不是文本气泡。
2. WHEN 用户点击卡片 THEN 客户端 SHALL 通过现有目标深链打开该 Outcome。
3. WHEN 卡片内容缺失、Outcome ID 不是合法 UUID 或发送者不是 `system` THEN 客户端 SHALL 回退为普通消息渲染。
4. WHEN 移动端收到 `outcome.failed` 或 `outcome.blocked` 推送 THEN 客户端 SHALL 与既有四类相同地校验 schemaVersion、type、ID 和深链后展示并可点击打开。
5. WHEN 旧版本客户端收到这两类推送 THEN 客户端 SHALL 按未知类型忽略，不崩溃（需求 12）。

