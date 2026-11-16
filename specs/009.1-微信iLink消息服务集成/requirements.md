# 需求文档 - 微信 iLink 消息服务集成

状态：IN_PROGRESS

## 简介

Spec 009 已建立 provider 无关的外部消息服务。本 Spec 使用 WhatsApp connector 的 packaged MCP、persistent state、host-only device link 和生命周期测试模式，实现微信 ClawBot/iLink connector，并通过 Spec 009 的 Server 入站服务把微信直接消息交给 OpenTeam Bot。

## 依赖

- 基础需求：[`../009-外部消息服务/requirements.md`](../009-外部消息服务/requirements.md)
- 基础设计：[`../009-外部消息服务/design.md`](../009-外部消息服务/design.md)
- 基础任务：[`../009-外部消息服务/tasks.md`](../009-外部消息服务/tasks.md)

## 范围说明

### In Scope

- 微信 iLink packaged MCP connector。
- QR setup、连接状态、取消、移除和持久 token 状态。
- HTTP JSON API、长轮询和 `get_updates_buf` cursor 持久化。
- 已观察 direct peer 列表。
- 文本发送和 provider reply context 保存。
- 微信入站文本和至少一种媒体类型接入 Spec 009 Channel path。
- connector、provider simulator、QR 生命周期和 Channel integration tests。

### Out of Scope

- QQ Bot、OneBot、NapCat 或其他 QQ 协议。
- 微信群聊，首版只支持 direct peer。
- 完整微信历史搜索和历史回填。
- 绕过 iLink 的个人微信逆向协议或桌面自动化。
- WeChat automation trigger；Channel 路径稳定后另立 Spec。

## 需求

### 需求 1：二维码连接和持久状态

**用户故事：** 作为用户，我希望在 OpenTeam 中扫码连接微信，并在 connector 重启后继续使用已授权账户。

#### 验收标准

1. WHEN 用户开始连接 THEN System SHALL 通过 host-only tool 返回二维码图片、sessionId 和过期时间。
2. WHEN QR 被确认 THEN System SHALL 持久化 bot token、base URL、bot id 和 user id，并从普通 Bot 结果中隐藏 token。
3. WHEN connector 重启且 token 有效 THEN System SHALL 恢复连接，不要求重新扫码。
4. WHEN QR 被取消、过期或 token 失效 THEN System SHALL 清理临时 challenge 并返回可恢复状态。

### 需求 2：peer、文本和 cursor

**用户故事：** 作为用户，我希望查看微信 direct peer、发送文本并接收新消息，以便让微信成为 Bot 入口。

#### 验收标准

1. WHEN 用户请求 peer 列表 THEN System SHALL 返回本地已观察的稳定 direct peer id 和展示名称。
2. WHEN用户向 peer 发送文本 THEN System SHALL 使用该 peer 的 reply context 或合法主动发送上下文调用 iLink。
3. WHEN getupdates 返回消息 THEN System SHALL 转换为 Spec 009 的 `ExternalMessage`。
4. WHEN Server 成功接受消息 THEN System SHALL 保存新的 `get_updates_buf`；Server 接受失败时不得推进 cursor。
5. WHEN 同一消息重复返回 THEN System SHALL 通过 Spec 009 receipt 去重。

### 需求 3：媒体

**用户故事：** 作为微信用户，我希望发送图片或文件给 Bot，并能收到 Bot 发回的受控媒体。

#### 验收标准

1. WHEN iLink 返回受支持媒体 THEN System SHALL 下载并交给 Spec 009 的 AssetStore 边界。
2. WHEN Bot 外发受控媒体 THEN System SHALL 使用 iLink media upload 流程，不读取任意本地路径。
3. WHEN媒体大小、MIME 或下载凭据不符合限制 THEN System SHALL 拒绝媒体并保留可诊断错误。

### 需求 4：Channel integration

**用户故事：** 作为 OpenTeam 用户，我希望微信消息进入真实的 OpenTeam Channel，并让 Bot 在同一个微信 peer 回复。

#### 验收标准

1. WHEN 微信 direct peer 首次发消息 THEN System SHALL 创建或复用 Spec 009 mapping，并写入 `ChannelMessage`。
2. WHEN 微信消息被接受 THEN System SHALL 唤醒绑定 Bot，并保留 provider reply context。
3. WHEN Bot 回复 THEN System SHALL 使用 mapping 和 context 将文本或媒体发回同一微信 peer。
4. WHEN 连接器重启 THEN System SHALL 继续使用原 mapping 和 cursor，不产生重复 Channel 或重复消息。

## 非功能需求

### 非功能需求 1：安全

1. iLink token、context token、下载 URL 和原始请求头不得进入普通 Bot 工具结果或日志。
2. 微信文本、文件名、caption 和 peer 名称必须按不可信输入处理。
3. connector 状态接口只返回脱敏状态和机器可读错误。

### 非功能需求 2：可靠性

1. 长轮询断线后按边界重连；token 失效进入 needs pairing。
2. 不确定的外发结果不得自动重试。
3. cursor 只有在 Server 入站事务成功后推进。

## 成功定义

- QR、状态、peer、text send、cursor persistence 有离线 provider simulator 测试。
- 微信文本消息能走通 connector → Spec 009 inbound service → ChannelMessage → Bot wake。
- 至少一种微信媒体类型能走通 AssetStore 和 Channel attachment。
- Bot 回复能回到相同微信 peer。
- 不实现 QQ 代码或 QQ automation trigger。
