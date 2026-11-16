# 需求文档 - 微信 iLink 消息服务集成

状态：IN_PROGRESS

文档关系：

- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- 协议事实与探测清单：[`docs/20261116-iLink协议事实与探测清单.md`](docs/20261116-iLink协议事实与探测清单.md)

## 简介

微信在 2026 年通过「微信 ClawBot」开放了个人号 bot 能力，其背后是 iLink Bot API：二维码登录、HTTP 长轮询收消息、带会话 token 的回复、经 CDN 加密传输的媒体。

本 Spec 参照 WhatsApp connector 的 packaged MCP、persistent state 和 host-only 设备链接模式，实现微信 iLink connector，并通过 Spec 009 的外部消息服务把账户所有者在微信里发给 bot 的消息交给 OpenTeam Bot，再把 Bot 的回复送回微信。

- **服务角色**：OpenTeam 用户（微信账户所有者）、connector 维护者。
- **核心收益**：用户不打开 OpenTeam 客户端，也能在微信里使用自己的 Bot。

iLink 没有公开的服务端规范。本 Spec 的协议事实来自腾讯官方客户端 `Tencent/openclaw-weixin` 的源码和公开的第三方整理，其中尚未实机验证的部分列为探测项，开工第一步就是完成探测。

## 依赖

- 基础需求：[`../009-外部消息服务/requirements.md`](../009-外部消息服务/requirements.md)
- 基础设计：[`../009-外部消息服务/design.md`](../009-外部消息服务/design.md)
- 基础任务：[`../009-外部消息服务/tasks.md`](../009-外部消息服务/tasks.md)

## 术语表

- **System**：微信 connector（运行在 Bot Computer 上的 stdio MCP 进程）以及它依赖的 Spec 009 服务。
- **iLink**：微信 ClawBot 背后的 HTTP JSON 协议，业务入口 `https://ilinkai.weixin.qq.com`。
- **bot token**：二维码确认后下发的账户凭据，用于全部业务请求。
- **`get_updates_buf`**：`getupdates` 的不透明游标，本文称 provider 游标。
- **context token**：随每条入站消息下发的会话令牌，回复时必须回传；本文称会话令牌。
- **会话窗口**：从用户最近一条消息起、bot 仍可回复的时间段，公开资料为 24 小时。
- **落盘队列（spool）**：connector 私有状态目录中的入站消息队列，消息在被 Server 确认之前一直保留。
- **确认游标**：Spec 009 定义的 `ackCursor`，本 connector 的格式为 `<queueId>:<seq>`。
- **账户所有者**：扫码确认的微信用户，即二维码确认时返回的 `ilink_user_id`。
- **simulator**：测试用的本地 iLink 与 CDN 模拟服务。

## 范围说明

### In Scope

- 微信 iLink packaged MCP connector（`packages/plugins/wechat`）。
- 协议基线：固定官方参考版本、完成实机探测并记录。
- 二维码设备链接、取消、移除、重启恢复和会话过期处理。
- 后台长轮询、入站落盘队列、provider 游标持久化。
- Spec 009 的 poll 与 deliver 两个 host-only 工具。
- 文本外发：会话令牌、会话窗口、分片、限速、幂等。
- 媒体：入站图片、文件、视频的下载与解密；外发图片的加密与上传。
- 只读的 `connection_status` 工具和面向 Bot 的技能说明。
- simulator、connector 测试、与 Spec 009 的集成测试、实机联调清单。

### Out of Scope

- QQ Bot、OneBot、NapCat 或其他 QQ 协议。
- 微信群聊（iLink bot 不能入群）和非所有者用户的消息（由 Spec 009 的 `owner_only` 拒绝）。
- 主动发起会话和会话窗口之外的推送（协议不支持）。
- 完整微信历史搜索和历史回填。
- 绕过 iLink 的个人微信逆向协议或桌面自动化。
- 外发语音（公开实现一致反馈服务端接受但不投递）。
- 输入中提示（`sendtyping`）。
- WeChat automation trigger。

## 需求

### 需求 1：协议基线与安全边界

**用户故事：** 作为 connector 维护者，我希望实现所依据的协议事实有明确出处和实测结论，并且 connector 只会访问微信的域名，以便协议变化时能定位差异，也不会被恶意响应引向别处。

#### 验收标准

1. WHEN 开始实现 THEN System SHALL 在协议事实文档中固定一个 `Tencent/openclaw-weixin` 参考版本，并记录全部探测项的实测结论。
2. WHEN connector 发起任何业务请求 THEN System SHALL 携带参考版本要求的请求头和 `base_info`，并为每次请求重新生成 `X-WECHAT-UIN`。
3. WHEN 二维码确认或状态查询返回新的基座地址 THEN System SHALL 只接受 `https` 且主机为 `weixin.qq.com` 子域的地址，否则拒绝并报 `wechat_base_url_rejected`。
4. WHEN 入站媒体给出下载地址 THEN System SHALL 只访问 `https` 且主机为 `weixin.qq.com` 子域的地址，并禁止跟随 HTTP 重定向。
5. WHEN 解析 provider 响应 THEN System SHALL 无损保留 64 位整数字段（例如 `message_id`），不得经过 JavaScript `number`。
6. WHEN provider 返回未识别的错误码或消息项类型 THEN System SHALL 记录机器可读的未知码并继续运行，不得崩溃。

### 需求 2：二维码连接与持久状态

**用户故事：** 作为用户，我希望在 OpenTeam 中扫码连接微信，并在 connector 或 computer 重启后继续使用已授权的账户。

#### 验收标准

1. WHEN 用户开始连接 THEN System SHALL 通过 host-only 工具返回二维码图片、`sessionId` 和过期时间。
2. WHEN 二维码被确认 THEN System SHALL 原子地持久化 bot token、基座地址、`ilink_bot_id` 和 `ilink_user_id`，文件权限为 `0600`。
3. WHEN connector 重启且凭据有效 THEN System SHALL 自动恢复接收，不要求重新扫码。
4. WHEN 二维码过期 THEN System SHALL 在同一 `sessionId` 下自动刷新最多 3 次，之后以 `wechat_qr_expired` 结束本次链接。
5. WHEN 用户取消链接 THEN System SHALL 清理临时二维码状态，并保持此前已有的有效凭据不变。
6. WHEN 用户移除账户 THEN System SHALL 尽力通知 provider 停止，并删除全部本地状态。
7. WHEN 新确认的账户与此前不同，或同一账户重新扫码 THEN System SHALL 清空 provider 游标和会话令牌；账户不同时还 SHALL 重建落盘队列并让确认游标重置。
8. WHEN `getupdates` 返回会话过期（`-14`）THEN System SHALL 停止全部业务请求、进入 `needs_pairing`，并在 1 小时冷却后做一次探活；探活仍失败则清除凭据。
9. WHEN 账户没有 ClawBot 资格或 provider 要求 connector 无法完成的额外验证 THEN System SHALL 返回可读的原因和下一步指引，不得停留在无限等待。

### 需求 3：入站接收与落盘队列

**用户故事：** 作为账户所有者，我希望发给 bot 的每条消息都不会因为 connector、computer 或 Server 的重启而丢失。

#### 验收标准

1. WHEN 账户处于 `ready` THEN System SHALL 在后台持续长轮询 `getupdates`，并采用服务端建议的下一轮超时。
2. WHEN `getupdates` 返回消息 THEN System SHALL 先把消息（含已下载的媒体）写入落盘队列并刷盘，然后才持久化新的 provider 游标。
3. WHEN 同一 `message_id` 再次出现 THEN System SHALL 不重复入队。
4. WHEN 消息来自 bot 自身、带有 `group_id` 或不含任何可处理内容 THEN System SHALL 丢弃并计数，不入队。
5. WHEN 消息入队 THEN System SHALL 转换为 Spec 009 的 `ExternalMessage`，其中 `sender.isAccountOwner` 当且仅当发送者等于二维码确认时的 `ilink_user_id` 时为 `true`。
6. WHEN Server 调用 poll 工具并带上确认游标 THEN System SHALL 删除该游标及之前的队列项和对应媒体文件，并返回其后的消息。
7. WHEN 队列为空 THEN System SHALL 最多挂起 `waitMs`，期间有新消息立即返回，且挂起期间仍能处理 deliver 调用。
8. WHEN 确认游标不属于当前队列 THEN System SHALL 返回 `resetCursor: true`。
9. WHEN 队列达到 500 条或媒体占用达到 1 GiB THEN System SHALL 暂停拉取 provider、进入 `backlogged`，并在回落到 80% 以下后恢复。
10. WHEN 长轮询失败 THEN System SHALL 先等待 2 秒重试，连续 3 次失败后退避 30 秒。

### 需求 4：文本外发与会话窗口

**用户故事：** 作为账户所有者，我希望 Bot 的回复出现在我和 bot 的微信对话里，发不出去时 Bot 能知道确切原因。

#### 验收标准

1. WHEN 收到任意入站消息 THEN System SHALL 以 peer 为键保存最新的会话令牌和接收时间。
2. WHEN Server 调用 deliver 工具 THEN System SHALL 使用该 peer 的会话令牌调用 `sendmessage`，令牌不出现在任何工具结果和日志中。
3. WHEN 该 peer 没有会话令牌 THEN System SHALL 在发出任何请求之前返回 `failed`（`wechat_context_missing`）。
4. WHEN 会话令牌的年龄超过安全窗口（默认 23 小时）THEN System SHALL 返回 `failed`（`wechat_context_expired`）。
5. WHEN 文本超过单条上限（默认 1800 字符）THEN System SHALL 在段落或句子边界分片并按顺序发送。
6. WHEN 60 秒内的 provider 消息数将超过 20 THEN System SHALL 在发出任何请求之前返回 `failed`（`wechat_rate_limited`）。
7. WHEN 全部分片的 `sendmessage` 都返回成功 THEN System SHALL 返回 `sent`，并注明这表示 provider 已接受而非对方已收到。
8. WHEN 第一个分片被 provider 明确拒绝 THEN System SHALL 返回 `failed`；之后的分片被拒绝或任何请求结果不明 THEN System SHALL 返回 `uncertain`。
9. WHEN `sendmessage` 返回 `-14` THEN System SHALL 作废该 peer 的会话令牌并按会话窗口过期处理，不得因此断开账户。
10. WHEN 相同 `deliveryId` 再次到达 THEN System SHALL 返回首次的结果而不重发；若首次调用在发送中途被中断 THEN System SHALL 返回 `uncertain`。

### 需求 5：媒体

**用户故事：** 作为账户所有者，我希望发给 Bot 的图片和文件能被使用，Bot 也能把图片发回给我。

#### 验收标准

1. WHEN 入站消息包含图片、文件或视频 THEN System SHALL 从 CDN 下载、用消息给出的密钥做 AES-128-ECB 解密，并写入 `exchange/inbound/`，同时给出明文大小和 SHA-256。
2. WHEN 入站媒体声明的大小超过 100 MiB THEN System SHALL 不下载并在 `mediaFailures` 中报告。
3. WHEN 入站媒体下载或解密连续 3 次失败 THEN System SHALL 在 `mediaFailures` 中报告，并照常入队消息的其余部分。
4. WHEN 入站语音带有服务端转写文字 THEN System SHALL 把转写文字作为文本；没有转写时在 `mediaFailures` 中报告。
5. WHEN Server 要求外发图片 THEN System SHALL 从 `exchange/outbound/<deliveryId>/` 读取并校验大小和 SHA-256，然后执行"申请上传地址 → 本地加密 → 上传 CDN → 发送媒体引用"。
6. WHEN 外发媒体文件不在受控目录内、是符号链接或摘要不符 THEN System SHALL 在发出任何请求之前返回 `failed`（`wechat_media_invalid`）。
7. WHEN 上传在任何 `sendmessage` 之前失败 THEN System SHALL 返回 `failed`（`wechat_media_upload_failed`）。
8. WHEN 媒体下载地址、加密参数或密钥出现在处理过程中 THEN System SHALL 不把它们写入日志、工具结果或队列以外的任何位置。

### 需求 6：接入 OpenTeam Channel

**用户故事：** 作为 OpenTeam 用户，我希望微信消息进入真实的 OpenTeam Channel，并让 Bot 在同一个微信对话里回复。

#### 验收标准

1. WHEN 插件被安装 THEN manifest SHALL 声明 Spec 009 的 `messaging` 块，使 poll 与 deliver 工具对 Bot 隐藏。
2. WHEN 账户所有者首次在微信里给 bot 发消息且连接已绑定 Bot THEN System SHALL 经 Spec 009 创建 `external_dm` Channel、写入 `ChannelMessage` 并唤醒 Bot。
3. WHEN Bot 在该 Channel 中回复 THEN System SHALL 经 Spec 009 的外发服务把文本或图片送回同一微信对话。
4. WHEN connector 或 computer 重启 THEN System SHALL 继续使用原 Mapping、落盘队列和确认游标，不产生重复 Channel 或重复消息。
5. WHEN 非所有者的微信用户给 bot 发消息 THEN System SHALL 如实标记 `isAccountOwner = false`，由 Spec 009 拒绝。
6. WHEN Bot 调用 `connection_status` THEN System SHALL 返回连接状态、会话窗口是否打开及到期时间、积压数量，不包含任何凭据或用户标识原文。

### 需求 7：打包与用户指引

**用户故事：** 作为用户，我希望在插件目录里找到微信插件，按清晰的步骤完成连接，并知道它能做什么、不能做什么。

#### 验收标准

1. WHEN 用户浏览插件目录 THEN System SHALL 展示微信插件的名称、图标、说明和连接步骤，并提供中文文案。
2. WHEN 用户查看连接步骤 THEN System SHALL 说明需要已开通 ClawBot 的微信号，以及连接后需要先在微信里给 bot 发一条消息。
3. WHEN Bot 的运行加载该插件的技能 THEN System SHALL 告知 Bot：回复会自动送达、只能发文本和图片、存在会话窗口限制、卡片类内容应使用 `to: "dm"`。
4. WHEN 插件被打包 THEN System SHALL 通过插件目录、打包往返和 i18n 检查。

## 非功能需求

### 非功能需求 1：性能

1. WHEN provider 返回一条纯文本消息 THEN System SHALL 在 1 秒内完成入队并唤醒挂起的 poll 调用。
2. WHEN poll 调用被新消息唤醒 THEN System SHALL 在 200 毫秒内返回。
3. WHEN connector 进程启动 THEN System SHALL 在 5 秒内完成状态加载并开始接收，不含网络耗时。

### 非功能需求 2：可靠性

1. WHEN 进程在任意时刻被杀死 THEN System SHALL 保证已从 provider 取回的消息要么在落盘队列中，要么会被 provider 重新下发。
2. WHEN 写入任何状态文件 THEN System SHALL 使用临时文件加原子改名，并在改名前刷盘。
3. WHEN 外发结果不确定 THEN System SHALL 不自动重试。
4. WHEN provider 不可达 THEN System SHALL 保持账户状态为 `recovering` 并持续按退避重连，不要求重新扫码。

### 非功能需求 3：安全

1. WHEN 输出任何工具结果、错误或日志 THEN System SHALL 不包含 bot token、会话令牌、provider 游标、下载地址、加密密钥和原始请求头。
2. WHEN 处理微信文本、文件名和展示名 THEN System SHALL 按不可信输入处理，文件名只作为元数据传递，磁盘上使用自生成的名称。
3. WHEN 普通 Bot 运行尝试调用设备链接、poll 或 deliver 工具 THEN System SHALL 被拒绝。
4. WHEN 测试需要替换基座地址 THEN System SHALL 只通过测试入口的依赖注入实现，产品代码不提供可绕过域名限制的环境变量。

### 非功能需求 4：可维护性

1. WHEN iLink 协议调整 THEN System SHALL 只需修改 `api.ts`、协议类型和 simulator，状态机与队列不变。
2. WHEN 排查问题 THEN System SHALL 通过 `connection_status` 和脱敏日志提供：账户状态及原因、最近一次成功轮询时间、连续失败次数、队列长度、各类丢弃计数。
3. WHEN 状态文件格式变化 THEN System SHALL 通过版本号迁移或在无法迁移时安全地要求重新扫码。

## 成功定义

- 协议事实文档中全部探测项都有实测结论，决策门全部关闭。
- 二维码、状态机、落盘队列、poll、deliver、媒体都有基于 simulator 的离线测试，不依赖真实网络。
- 崩溃注入测试证明：在"入队后、保存 provider 游标前"和"保存后"两个时间点杀进程都不丢消息、不重复入队。
- 微信文本消息走通 connector → Spec 009 → `ChannelMessage` → Bot wake → 回复 → 微信，并在实机联调中复现。
- 至少图片完成入站和外发的实机往返。
- connector 中不存在 Channel、Receipt、Delivery 相关逻辑，也不存在 QQ 或 automation trigger 代码。
