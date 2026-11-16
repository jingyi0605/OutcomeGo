# 需求文档 - 外部消息服务

状态：IN_PROGRESS

文档关系：

- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- WeChat 子规格：[`../009.1-微信iLink消息服务集成/requirements.md`](../009.1-微信iLink消息服务集成/requirements.md)

## 简介

当前项目的 packaged MCP connector（例如 WhatsApp）可以管理外部账户并由 Bot 主动调用工具发送消息，但外部入站消息不能进入 OpenTeam Channel，Bot 的回复也不会自动回到外部会话。

现有代码里已有三套相关机制，但都不覆盖"聊天式入站"：

- `PluginEventPoller`（`apps/server/src/services/plugin/events.ts`）只把事件分发给 Routine，事件源只有 `email`，轮询间隔下限 30 秒。
- `deliverConnectedChannel`（`apps/server/src/services/plugin/connectors.ts`）只支持 Bot 显式带 `platform:chat` 地址外发，没有入站映射，也没有"不确定"状态。
- `ChannelKind` 只有 `bot_dm`、`agent_dm`、`group`，没有承载外部会话的类型。

本 Spec 建立一个 provider 无关的 Server 服务：用户把一个外部账户连接绑定到一个 Bot 后，账户所有者本人在外部平台发来的消息会进入一个专属 Channel 并唤醒 Bot，Bot 的回复自动送回同一外部会话。

- **服务角色**：OpenTeam 用户（外部账户所有者）、平台 connector 开发者、系统维护者。
- **核心收益**：用户可以在已有的聊天软件里使用自己的 Bot；后续平台只需实现 provider adapter。

本 Spec 只建立基础服务，不实现具体平台 connector。

## 术语表

- **System**：OpenTeam Server、Worker、Messaging、Plugin Runtime 和 Bot Computer。
- **Connection**：代表一个外部账户连接的 `PluginConnection`。
- **Connector**：运行在 Bot Computer 上的 packaged MCP（stdio）进程，负责与外部平台通信。
- **Peer**：外部平台上的稳定会话标识，首版只有 `direct` 类型。
- **账户所有者**：完成设备链接、拥有该外部账户的 OpenTeam 用户本人。
- **Binding**：一个 Connection 到一个 target Bot 的消息入口绑定，记录是否启用、准入策略和入站游标。
- **Mapping**：`(connectionId, peerId, botId)` 到一个 `external_dm` Channel 的持久关系。
- **Receipt**：`(connectionId, providerMessageId)` 的幂等记录。
- **Delivery**：一次把 Bot 可见消息送往外部 peer 的外发记录。
- **确认游标（ack cursor）**：connector 为每条入站消息给出的不透明标记；Server 保存它表示"该条及之前的消息已处理完毕"。
- **Exchange**：connector 与 Server 之间交换媒体字节的受控通道。
- **终态结果**：一条入站消息的 `accepted`、`duplicate` 或 `rejected`；`retry` 不是终态。

## 范围说明

### In Scope

- 消息入口绑定：Connection 到 target Bot，启用开关，`owner_only` 准入策略。
- 新的 provider 无关 Channel 类型 `external_dm`，以及 Mapping 的创建、复用和归档。
- 入站：host 调度的轮询、逐条确认游标、去重、冲突检测、失败分类、死信。
- 入站消息写入 `ChannelMessage` 并创建 durable Bot wake。
- 媒体：入站经 Exchange 登记到 `AssetStore`，外发只接受 `AssetStore` 资产。
- 外发：`external_dm` 内的 Bot 回复自动路由到原 peer；显式 `platform:peer` 地址外发复用同一服务；持久的 `sent`、`failed`、`uncertain` 状态。
- Plugin SDK 的 `messaging` manifest 契约与线协议类型，供 connector 实现。
- 桌面端的绑定设置与 `external_dm` 只读呈现；移动端首版隐藏该类型。
- 供后续 connector 使用的 fixture 和集成测试。

### Out of Scope

- 微信 iLink 协议和 connector，由 `009.1` 实现。
- 非所有者外部用户的准入（allowlist、逐 peer 审批）。原因：外部用户可以驱动 Bot 的 Shell、文件和浏览器能力，必须先有受限的 Bot 能力档位，需另立 Spec。
- `group`、`channel` 类型的 peer。
- QQ connector、OneBot 和任何 automation trigger。
- 外部消息历史搜索与历史回填。
- 在应用内向 `external_dm` 发送消息（首版只读）。
- 输入中提示（typing）、已读回执、消息撤回与编辑。

## 需求

### 需求 1：消息入口绑定与准入

**用户故事：** 作为 OpenTeam 用户，我希望明确指定哪个 Bot 接收某个外部账户的消息，并且只有我本人发来的消息会唤醒它，以便外部入口不会被他人利用。

#### 验收标准

1. WHEN 用户为一个已就绪且 connector 声明了 `messaging` 的 Connection 选择 target Bot 并启用 THEN System SHALL 持久化唯一的 Binding，并在 15 秒内开始入站轮询。
2. WHEN Connection 没有 Binding、Binding 被停用或 Connection 未就绪 THEN System SHALL 不轮询该 Connection，也不创建任何 Channel、消息或 wake。
3. WHEN 入站消息的 `sender.isAccountOwner` 不为 `true` THEN System SHALL 以 `external_sender_not_allowed` 永久拒绝，不写入正文，不唤醒 Bot。
4. WHEN 入站消息的 `peer.type` 不是 `direct` THEN System SHALL 以 `external_peer_type_unsupported` 永久拒绝。
5. WHEN target Bot 不存在、已归档或不可运行 THEN System SHALL 把 Binding 置为 `needs_attention`、暂停推进游标，并且不创建悬空 wake；Bot 恢复或用户改绑后 System SHALL 从原游标继续。
6. WHEN 用户改绑到另一个 Bot THEN System SHALL 让后续消息进入新 Bot 自己的 Mapping 和 Channel，旧 Channel 保留为历史且不再接收入站消息。

### 需求 2：Channel 映射

**用户故事：** 作为系统维护者，我希望同一外部会话始终映射到同一个 OpenTeam Channel，以便保留连续上下文，并且不影响 Bot 原有的应用内私聊。

#### 验收标准

1. WHEN 首次接受 `(connectionId, peerId, botId)` 的消息 THEN System SHALL 在同一事务内创建 Mapping 和一个 `kind = external_dm` 的 Channel，并把 target Bot 加为唯一成员。
2. WHEN 再次接受相同 `(connectionId, peerId, botId)` 的消息 THEN System SHALL 复用原 Channel。
3. WHEN 两个 Connection 拥有相同 `peerId` THEN System SHALL 通过 `connectionId` 隔离为不同的 Mapping 和 Channel。
4. WHEN 同一 peer 的首批消息并发到达 THEN System SHALL 只创建一个 Mapping 和一个 Channel。
5. WHEN Mapping 已归档或其 Channel 已归档 THEN System SHALL 以 `external_channel_unavailable` 永久拒绝新消息并保留已有历史。
6. WHEN 存在 `external_dm` Channel THEN System SHALL 保持所有按 `bot_dm` 或 `directKey = bot:<botId>` 定位 Bot 私聊的既有行为不变。

### 需求 3：入站接受、去重与 Bot 唤醒

**用户故事：** 作为账户所有者，我希望在外部平台发出的每条消息都恰好进入一次 Bot 对话，provider 重复投递不会造成重复回复，失败也不会悄悄丢消息。

#### 验收标准

1. WHEN 收到通过准入的有效 `ExternalMessage` THEN System SHALL 在同一事务内写入一条 `sender = user` 的 `ChannelMessage`、一条 Receipt 和一个 durable Bot wake。
2. WHEN 相同 `(connectionId, providerMessageId)` 再次到达且 `payloadHash` 相同 THEN System SHALL 返回 `duplicate`，不重复写消息或唤醒。
3. WHEN 相同 `(connectionId, providerMessageId)` 再次到达但 `payloadHash` 不同 THEN System SHALL 以 `external_message_conflict` 拒绝第二条，保留第一条 Receipt，并记录冲突。
4. WHEN 消息结构非法、文本超过 20000 字符或 metadata 不符合白名单 THEN System SHALL 以 `external_message_invalid` 或 `external_message_too_large` 永久拒绝。
5. WHEN 接受过程遇到瞬时失败（数据库错误、computer 不可达、媒体暂时取不到）THEN System SHALL 不写 Receipt、不推进游标，并按退避重试。
6. WHEN 同一条消息连续瞬时失败达到 20 次或持续超过 30 分钟 THEN System SHALL 把它记为死信（`external_retry_exhausted`）、推进游标，并在连接诊断中显示。
7. WHEN 消息被接受 THEN System SHALL 按所有者输入消息处理 wake（与应用内直发相同的优先级和中断语义），并在 Bot 可见内容中注明来源平台。
8. WHEN 进程在接受事务提交前崩溃 THEN System SHALL 不留下任何中间状态记录，下次轮询重新处理该消息。

### 需求 4：入站轮询与游标

**用户故事：** 作为平台 connector 开发者，我希望只实现"取出消息"和"按确认游标清理"，由 Server 负责调度、并发和推进，以便不重复实现可靠性逻辑。

#### 验收标准

1. WHEN connector 在 manifest 声明 `messaging.inbound.pollTool` THEN System SHALL 以 host-only 方式调用它，并对 Bot 隐藏该工具。
2. WHEN System 调用 poll 工具 THEN System SHALL 传入上次保存的确认游标、批量上限和最长等待时间，并期望返回带逐条 `ackCursor` 的消息列表。
3. WHEN 一条消息得到终态结果 THEN System SHALL 立即把游标推进到该消息的 `ackCursor`；得到 `retry` 时 System SHALL 停止处理本批剩余消息。
4. WHEN 多个 Server 进程同时运行 THEN System SHALL 通过租约保证同一 Connection 同时只有一个轮询者；租约失效导致的重叠 SHALL 不产生重复消息。
5. WHEN connector 在等待窗口内没有消息 THEN System SHALL 在返回后立即发起下一次调用，不引入额外固定延迟。
6. WHEN poll 调用失败或返回无法解析的结果 THEN System SHALL 保留原游标，按 2 秒起、60 秒封顶的退避重试，并记录脱敏错误。

### 需求 5：媒体边界

**用户故事：** 作为账户所有者，我希望发给 Bot 的图片和文件能作为附件使用，Bot 发回的媒体也受同样的保护。

#### 验收标准

1. WHEN 入站消息携带媒体 THEN System SHALL 通过 Exchange 读取字节，校验大小和 SHA-256 后登记到 `AssetStore`，并把资产引用写入消息附件。
2. WHEN 媒体超过 `AssetStore` 限制、摘要不符或类型被拒绝 THEN System SHALL 丢弃该附件、接受消息的其余部分，并在 Bot 可见内容和消息 metadata 中注明该附件未能接收及原因。
3. WHEN 消息只有媒体且全部被拒绝 THEN System SHALL 仍接受消息并写入占位说明，不静默丢弃。
4. WHEN 一条消息的附件数超过 `AssetStore` 单条上限 THEN System SHALL 只保留上限以内的附件并注明其余被丢弃。
5. WHEN Bot 外发媒体 THEN System SHALL 只接受 `AssetStore` 管理的资产，并经 Exchange 交给 connector，不传递任意本地路径。
6. WHEN Exchange 请求中的文件名越出受控目录、是符号链接或不符合命名规则 THEN System SHALL 拒绝该请求。
7. WHEN 一条入站消息到达终态或一次外发结束 THEN System SHALL 清理对应的 Exchange 临时文件。

### 需求 6：回复路由与外发

**用户故事：** 作为账户所有者，我希望 Bot 的回复自动回到我发消息的那个外部会话，并且在结果不明时不会重复发送。

#### 验收标准

1. WHEN Bot 在 `external_dm` 的运行中调用 `SendToUser`（类型为 `text` 或 `attachment`，未指定 `channel` 和 `to`）THEN System SHALL 写入 agent `ChannelMessage` 并把内容投递到该 Mapping 的 peer。
2. WHEN 上述调用的类型不是 `text` 或 `attachment` THEN System SHALL 以 `external_channel_type_unsupported` 拒绝，不写入任何消息，并提示改用 `to: "dm"`。
3. WHEN Bot 在 `external_dm` 的运行中以 `to: "dm"` 调用 `SendToUser` THEN System SHALL 按目标 `bot_dm` 的类型与所有者校验规则写入应用内私聊，不外发；支持 text、attachment、widget、secret-request、computer-handoff、user-form、external-draft 和 imessage-send，不沿用 group 的私聊类型限制。
4. WHEN Bot 以 `channel: "<platform>:<peerId>"` 显式外发且该 Connection 声明了 `messaging` THEN System SHALL 要求存在该 Bot 的活动 Mapping，并通过同一外发服务投递和落 Channel 记录。
5. WHEN connector 明确返回成功 THEN System SHALL 把 Delivery 记为 `sent`；明确返回失败 THEN 记为 `failed` 并带机器可读原因。
6. WHEN 外发调用超时、连接中断或结果无法解析 THEN System SHALL 把 Delivery 记为 `uncertain`，并且任何路径都不得自动重发。
7. WHEN 同一工具调用（相同 `callId`）被重放 THEN System SHALL 返回已记录的 Delivery 结果，不再次外发。
8. WHEN Server 启动或周期恢复发现租约已过期的 `pending` 或 `sending` Delivery THEN System SHALL 通过条件更新分别置为 `failed`（`external_delivery_abandoned`）和 `uncertain`，不补发，不覆盖其他进程仍持有的有效租约。
9. WHEN provider 不支持所请求的内容类型或大小 THEN System SHALL 返回能力错误，不伪造成功。
10. WHEN 自动回复或显式地址外发结束 THEN System SHALL 在工具结果中如实告知 Bot 投递状态，并把状态写入该 `ChannelMessage` 的 metadata；`failed` 和 `uncertain` 不进入旧的恢复 wake 路径。

### 需求 7：客户端呈现与配置

**用户故事：** 作为 OpenTeam 用户，我希望在桌面端配置消息入口、查看外部会话的完整记录和每条回复的投递状态。

#### 验收标准

1. WHEN 用户打开一个声明了 `messaging` 的 Connection 的设置 THEN System SHALL 显示启用开关、target Bot 选择、入口状态和最近错误。
2. WHEN 存在 `external_dm` Channel THEN 桌面端 SHALL 在侧栏以平台标识展示它，并以只读方式展示消息记录。
3. WHEN 用户或客户端尝试在应用内向 `external_dm` 发送消息 THEN System SHALL 以 `external_channel_read_only` 拒绝。
4. WHEN 一条 agent 消息有 Delivery THEN 桌面端 SHALL 展示 `sent`、`failed` 或 `uncertain` 状态及原因。
5. WHEN Android 或 iOS 新版本客户端收到 `external_dm` Channel THEN 客户端 SHALL 不在会话列表展示它。
6. WHEN 用户归档 `external_dm` Channel THEN System SHALL 同步归档其 Mapping。

### 需求 8：生命周期与清理

**用户故事：** 作为系统维护者，我希望连接、Bot 和绑定的变化都有确定的结果，不留下孤儿数据。

#### 验收标准

1. WHEN Connection 被移除 THEN System SHALL 归档它的所有 `external_dm` Channel，删除 Binding、Mapping 和 Receipt，并把未结束的 Delivery 置为 `failed`。
2. WHEN target Bot 被删除 THEN System SHALL 删除其 Binding 和 Mapping，对应 Channel 按现有 Bot 删除流程处理。
3. WHEN Binding 被停用 THEN System SHALL 停止轮询，并使该 Connection 的后续外发以 `external_messaging_disabled` 失败。
4. WHEN Receipt 创建超过 90 天 THEN System SHALL 定期清理。
5. WHEN Connection 重新完成设备链接 THEN System SHALL 保留既有 Binding 和 Mapping，并由子规格决定是否重置确认游标。

## 非功能需求

### 非功能需求 1：性能

1. WHEN connector 已拿到一条入站消息且 computer 可达 THEN System SHALL 在 5 秒内（p95）完成 wake 入队，不含媒体传输时间。
2. WHEN 接受一条不含媒体的消息 THEN System SHALL 在 500 毫秒内（p95）完成接受事务。
3. WHEN 一次 poll 返回多条消息 THEN System SHALL 单批最多处理 20 条，并按到达顺序串行处理同一 Connection 的消息。
4. WHEN 外发文本 THEN System SHALL 以 60 秒为调用上限，超时即记为 `uncertain`。

### 非功能需求 2：可靠性

1. WHEN 任何组件在任意步骤崩溃 THEN System SHALL 保证每条入站消息最多产生一条 `ChannelMessage` 和一个 wake（至少一次投递加幂等去重）。
2. WHEN 数据库层面出现并发 THEN System SHALL 依靠 PostgreSQL 唯一约束和事务保证 Mapping 与 Receipt 唯一，不依赖进程内锁。
3. WHEN 游标更新与另一个轮询者竞争 THEN System SHALL 使用带前值条件的更新，游标不得回退。
4. WHEN 外发结果未知 THEN System SHALL 宁可少发也不重发。

### 非功能需求 3：安全

1. WHEN 处理外部文本、文件名、展示名和 metadata THEN System SHALL 把它们当作不可信数据：限制长度、去除控制字符，展示名不得作为身份键。
2. WHEN connector 需要回复凭据（例如会话 token）THEN System SHALL 让凭据只保存在 connector 私有状态中，不进入数据库、日志、Bot 可见内容或工具结果。
3. WHEN 记录日志或错误 THEN System SHALL 只记录白名单字段和机器可读错误码，不记录消息正文、下载地址或 provider 原始响应。
4. WHEN Bot 在 `external_dm` 运行 THEN System SHALL 保持密钥请求、网络策略审批等所有者专属卡片只能出现在应用内 `bot_dm`。
5. WHEN connector 的 poll 或 deliver 工具被 Bot 运行直接调用 THEN System SHALL 拒绝。

### 非功能需求 4：可维护性

1. WHEN 新增一个平台 THEN System SHALL 只需要 connector 在 manifest 声明 `messaging` 并实现 poll 与 deliver 两个 host-only 工具，不修改 Server 的 Channel 和事务逻辑。
2. WHEN 排查问题 THEN System SHALL 提供每个 Binding 的最近轮询时间、最近接受时间、连续失败次数、最近错误码和各类拒绝计数。
3. WHEN 新增或修改数据表 THEN System SHALL 使用独立的新表，不向从上游同步的既有表添加列。

## 成功定义

- fixture connector 发出的文本消息能走通"poll → 准入 → Mapping → ChannelMessage → Bot wake → SendToUser → deliver"全链路，并有集成测试覆盖。
- 重复、冲突、非所有者、非法、瞬时失败和死信六类入站情形各有测试，且都不会产生重复消息或丢消息。
- 至少一种媒体类型完成入站登记和外发交付，摘要校验、越界路径和超限各有测试。
- 外发的 `sent`、`failed`、`uncertain` 三种结果和启动恢复各有测试，任何路径都没有自动重发。
- 现有 `bot_dm`、`group`、`agent_dm` 的全部既有测试保持通过。
- `009.1` 只实现 provider adapter、connector 本地可靠队列和 provider 游标持久化；不复制 Server 的 Channel、Receipt、Delivery 数据库事务或 Binding 确认游标推进逻辑。
