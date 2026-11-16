# 需求文档 - 外部消息服务

状态：IN_PROGRESS

## 简介

当前项目的 WhatsApp packaged MCP connector 可以管理外部账户并发送消息，但外部入站消息还不能稳定进入 OpenTeam Channel。系统需要一个与 provider 无关的 Server 服务，把外部 peer 映射到 OpenTeam Channel，安全保存消息和媒体，去重 provider 事件，唤醒目标 Bot，并为后续 connector 提供统一回复路径。

本 Spec 只建立基础服务，不实现具体平台 connector。

## 术语表

- **System**：OpenTeam Server、Messaging、Plugin Runtime 和 Bot Computer。
- **Plugin connection**：代表一个外部账户连接的 `PluginConnection`。
- **Peer**：外部平台上的稳定会话标识。
- **External message**：连接器标准化后的外部入站消息。
- **Channel mapping**：`(connectionId, peerId)` 到 OpenTeam `Channel` 的持久关系。
- **Inbound message service**：完成校验、去重、映射、消息写入和 Bot 唤醒的 Server 服务。

## 范围说明

### In Scope

- 持久化 `(connectionId, peerId) -> channelId` 映射。
- 持久化 provider message id 幂等记录。
- 标准化外部消息和媒体类型。
- Server 入站消息服务：Channel 映射、去重、ChannelMessage 和 Bot wake。
- 外部媒体接收、AssetStore 登记、大小与路径边界。
- 外部文本和媒体的通用外发边界。
- 为后续 connector 提供 fixture 和集成测试。

### Out of Scope

- WeChat iLink 协议和 connector，由 `009.1` 实现。
- QQ connector、OneBot 和 QQ automation trigger。
- WeChat automation trigger；后续另立 Spec。
- 外部消息历史搜索。
- 绕过 ChannelMessage 和 Bot wake 的直接 Routine 触发。

## 需求

### 需求 1：Channel 映射

**用户故事：** 作为系统维护者，我希望外部账户和 peer 始终映射到同一个 OpenTeam Channel，以便保留连续上下文。

#### 验收标准

1. WHEN 首次收到 `(connectionId, peerId)` 的消息 THEN System SHALL 在事务中创建或登记唯一 Channel mapping。
2. WHEN 再次收到相同 `(connectionId, peerId)` THEN System SHALL 复用原 Channel。
3. WHEN 两个连接拥有相同 `peerId` THEN System SHALL 通过 `connectionId` 隔离。
4. WHEN Channel、连接或映射不可用 THEN System SHALL 拒绝新消息并返回可诊断结果。

### 需求 2：入站消息去重和 Bot 唤醒

**用户故事：** 作为外部用户，我希望消息能进入绑定 Bot 的真实对话，并且 provider 重复投递不会造成重复回复。

#### 验收标准

1. WHEN 收到有效 ExternalMessage THEN System SHALL 写入一条 `sender=user` 的 `ChannelMessage` 并创建 durable Bot wake。
2. WHEN 相同 `(connectionId, providerMessageId)` 再次到达 THEN System SHALL 返回 duplicate，不重复写消息或唤醒。
3. WHEN provider message id 的 payload hash 冲突 THEN System SHALL 拒绝第二条消息并记录冲突。
4. WHEN Bot 不存在、归档或不可运行 THEN System SHALL 不创建悬空 wake。
5. WHEN消息包含 provider reply context THEN System SHALL 保存受控上下文，不能把 token 写入 Bot 可见正文。

### 需求 3：媒体边界

**用户故事：** 作为外部用户，我希望图片或文件能作为 Bot 附件使用，并且 Bot 外发媒体受到同样保护。

#### 验收标准

1. WHEN connector 提交受支持媒体 THEN System SHALL 将其登记到 AssetStore，并把资产引用写入消息附件。
2. WHEN 媒体超过限制、类型不支持或下载校验失败 THEN System SHALL 拒绝该附件并返回明确错误。
3. WHEN Bot 外发媒体 THEN System SHALL 只接受 AssetStore 管理的资产。
4. WHEN媒体或 provider URL 包含凭据 THEN System SHALL 不把凭据写入日志、正文或工具结果。

### 需求 4：通用外发边界

**用户故事：** 作为平台 connector 开发者，我希望使用统一外发接口回复原 peer，而不重复实现 Server 的幂等和资产校验。

#### 验收标准

1. WHEN Channel mapping 存在且连接 ready THEN System SHALL 能按 provider address 发送文本。
2. WHEN外发结果未知 THEN System SHALL 保留不确定状态，禁止自动重复发送。
3. WHEN外发媒体已登记为 AssetStore 资产 THEN System SHALL 将受控文件交给 connector。
4. WHEN provider 不支持某种能力 THEN System SHALL 返回能力错误，不伪造成功。

## 非功能需求

### 非功能需求 1：一致性与幂等

1. mapping、receipt、ChannelMessage 和 Bot wake 必须有清晰事务边界。
2. 数据库唯一约束必须覆盖 connection 和 provider message identity。
3. provider cursor 只能在 Server 接受成功后推进，由子规格实现。

### 非功能需求 2：安全

1. 外部文本、文件名、caption、peer 名称和 metadata 都是不可信输入。
2. token、reply context、下载 URL 和原始 payload 必须脱敏或白名单化。
3. 媒体路径必须经过 AssetStore 或 connector 边界校验。

## 成功定义

- 标准化外部消息可以创建或复用唯一 OpenTeam Channel。
- 重复和冲突 provider message 能安全处理。
- 文本和至少一种媒体类型能完成入站资产、ChannelMessage 和 Bot wake。
- 外发文本和媒体复用统一边界，并能表达不确定结果。
- 子规格只实现 provider adapter，不复制 Server Channel 逻辑。
