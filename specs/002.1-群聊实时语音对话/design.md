# 设计文档：群聊实时语音对话

规格编号：`002.1`

状态：草案

日期：2026 年 11 月 10 日。

## 1. 概述

### 1.1 目标

- 在不破坏单 Bot 直接语音的前提下支持群聊语音。
- 复用现有群聊持久化投递、顺序锁和 Outbox 能力。
- 把用户最终语音转写作为群聊用户消息进入现有上下文。
- 让点名规则决定哪些参与成员获得响应机会。
- 允许 Bot 通过不调用 `SendToUser` 静默完成。
- 通过一个服务端说话队列保证多个 Bot 不同时输出。
- 使抢话、重试、重连和 Worker 恢复具备明确的持久化边界。

### 1.2 覆盖需求

- `requirements.md` 需求 1 至需求 8。

### 1.3 技术约束

- 后端：`apps/server`、`packages/messaging`、`apps/worker`、Bun WebSocket。
- 前端：桌面端 React/Electron；iOS 和 Android 先保持直接语音兼容。
- 数据存储：PostgreSQL、Prisma、现有 `ChannelMessage`、`ChannelRound`、`ChannelDelivery`、`Run`。
- 认证授权：现有用户会话、VoiceSession owner session 和一次性 WebSocket 票据。
- 外部依赖：现有 STT/TTS Provider、Bot Worker、computer 运行时。
- 兼容约束：普通文本群聊的 `resolveGroupResponderIds` 和 `sendVisible` 语义不能被群聊语音默认改变。

## 2. 架构

### 2.1 系统结构

```text
桌面端群聊语音入口
  -> 参与成员选择器
  -> POST /api/voice/sessions
  -> 认证 Voice WebSocket
  -> 服务端解码、VAD、流式 STT
  -> 群聊语音转写接收服务
  -> 群聊 ChannelMessage + VoiceTurn + VoiceTurnResponse
  -> voice 模式 ChannelRound
  -> AgentMessaging 顺序推进 ChannelDelivery
  -> Bot SendToUser 或静默完成
  -> VoiceReplySource
  -> 单一说话队列 + 参与成员声音快照
  -> 流式 TTS、Opus 编码和 WebSocket 播放
```

核心原则：

- 一个 WebSocket 对应一个语音会话，不为每个 Bot 创建连接。
- 一个用户最终转写对应一个 `VoiceTurn`。
- 一个被解析的 Bot 对应一个 `VoiceTurnResponse` 和一条有序投递。
- 响应机会可以产生一条可见答复，也可以静默完成。
- 语音回合不创建普通文本群聊追问回合。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `VoiceService` | 创建会话、接收转写、协调回复和生命周期 | 会话请求、最终转写、连接事件 | 会话视图、回合、响应和音频控制 |
| `VoiceSessionParticipant` | 保存参与成员和声音快照 | Bot、ordinal、默认标记 | 固定参与成员集合 |
| `VoiceGroupRouting` | 解析当前转写中的点名和响应者 | 文本、参与成员、默认说话人 | 有序 Bot ID 集合 |
| `AgentMessaging` | 创建和推进 voice 模式群聊回合 | Channel、响应者快照、用户消息 | `ChannelRound`、`ChannelDelivery`、Bot run |
| `VoiceReplySource` | 将可见群聊消息映射到语音 sink | run ID、消息 ID、响应记录 | 字幕、TTS 队列项目 |
| `VoiceSpeakerQueue` | 串行管理 TTS 和播放代次 | Bot 声音、文本、响应 ordinal | 音频帧、说话人事件 |
| `ChannelService` | 持久化群聊用户消息和幂等结果 | 频道、文本、语音元数据 | `ChannelMessage` 和回合接受结果 |
| 桌面端 `useLiveVoice` | 管理单连接、音频设备和界面状态 | 会话目标、服务端事件 | 选择器、字幕、头像和播放控制 |

### 2.3 关键流程

#### 2.3.1 创建群聊语音会话

1. 客户端加载群聊活跃成员，并默认全选。
2. 用户选择参与成员和默认说话人。
3. 服务端校验频道类型、成员关系、Bot 状态、数量和默认说话人。
4. 服务端在同一事务中创建 `VoiceSession` 和参与成员快照。
5. 服务端返回包含参与成员、声音、默认说话人和 WebSocket 票据的会话视图。
6. 客户端只建立一个 WebSocket，并完成 `hello` 和 `client_ready`。

#### 2.3.2 接收一个最终语音转写

1. VAD 结束用户讲话，Provider 返回最终转写。
2. 服务端按 `(sessionId, turnId)` 检查幂等记录。
3. 服务端读取参与成员快照和当前群聊成员状态。
4. `VoiceGroupRouting` 只解析当前用户转写，不读取旧消息中的点名。
5. 服务端创建群聊用户 `ChannelMessage`、`VoiceTurn`、响应机会和 `voice` 模式 `ChannelRound`。
6. 服务端提交事务后异步调用 `advanceRound`。
7. 用户抢话时，旧回合待处理响应在新回合开始前被淘汰。

#### 2.3.3 顺序处理 Bot 响应

1. `advanceRound` 在回合锁内选取下一条待处理 `ChannelDelivery`。
2. 如果 Bot 已失活或被移出群聊，则将响应标记为 `skipped` 并继续。
3. Worker 获取只包含当前目标和群聊可见上下文的 prompt。
4. Prompt 要求 Bot 先判断相关性；无关时不调用 `SendToUser`，直接结束。
5. `SendToUser` 产生可见消息时，通过 Outbox 持久化并通知语音 sink。
6. 没有可见消息时，将响应标记为 `silent`，不产生 TTS。
7. 当前响应的消息和音频处理结束后，调度器推进下一响应机会。
8. 所有响应进入终态后，完成 `VoiceTurn`，不创建下一轮。

#### 2.3.4 抢话和重连

1. VAD 检测到用户在播放期间讲话时，服务端停止当前输出代次。
2. TTS 流取消，客户端丢弃旧代次的音频。
3. 只有有意义的最终转写被接受为新用户回合。
4. 新回合提交前，旧回合活动 run 和待处理响应被淘汰。
5. WebSocket 重连时发送会话状态、当前回合和未开始响应。
6. 已完成音频不重播；连接丢失时已中断的音频不自动重播。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7、8。

- `VoiceSessionMode`：区分 `direct` 和 `group`。
- `VoiceSessionParticipant`：保存参与成员、顺序、默认说话人和声音快照。
- `VoiceTurnResponse`：保存每个 Bot 的响应机会、run、可见消息和终态。
- `VoiceGroupRouting`：解析当前语音转写中的成员点名。
- `ChannelRoundMode`：区分普通文本回合和语音回合。
- `VoiceSpeakerQueue`：单连接内的唯一音频输出队列。
- `VoiceReplySource`：将可见频道消息交给当前语音会话。

### 3.2 数据结构

覆盖需求：1、4、5、6、7。

#### 3.2.1 `VoiceSession`

保留现有直接语音字段，增加：

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `mode` | `VoiceSessionMode` | 是 | `direct` 或 `group` | 默认 `direct` |
| `botId` | UUID | 直接会话是 | 兼容直接会话；群聊可保存默认 Bot 锚点 | 群聊路由不依赖它 |
| `conversationId` | UUID | 直接会话是 | 兼容直接会话 | 群聊只作为兼容锚点 |
| `channelId` | UUID | 是 | 目标频道 | 必须为活跃 `bot_dm` 或 `group` |
| `ownerSessionId` | 字符串 | 否 | 用户会话 | 用于创建、查看、结束和重连授权 |
| `expiresAt` | 时间 | 是 | 会话过期时间 | 不超过现有 30 分钟限制 |

#### 3.2.2 `VoiceSessionParticipant`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `sessionId` | UUID | 是 | 语音会话 | 外键级联删除 |
| `botId` | UUID | 是 | 参与 Bot | 必须是会话创建时的活跃群聊成员 |
| `ordinal` | 整数 | 是 | 说话和投递顺序 | 同一会话唯一 |
| `voice` | 字符串 | 是 | Bot 声音快照 | 空值表示 Provider 默认声音 |
| `isDefault` | 布尔 | 是 | 是否为默认说话人 | 同一会话最多一个 |
| `status` | 字符串或枚举 | 是 | `active`、`removed`、`inactive` | 推进时重新检查 |

唯一约束：`(sessionId, botId)`、`(sessionId, ordinal)`。

#### 3.2.3 `VoiceTurnResponse`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `turnId` | UUID | 是 | 父级 `VoiceTurn` | 外键级联删除 |
| `botId` | UUID | 是 | 响应 Bot | 同一回合每个 Bot 一行 |
| `runId` | UUID | 否 | Bot run | 运行创建后写入，唯一 |
| `ordinal` | 整数 | 是 | 当前回合响应顺序 | 同一回合唯一 |
| `status` | 枚举 | 是 | 见状态表 | 默认 `queued` |
| `assistantMessageIds` | 字符串数组 | 是 | 已发布可见消息 | 可为空 |
| `generation` | 整数 | 是 | 响应消息代次 | 用于去重和重连 |
| `error` | JSON | 否 | 安全错误信息 | 不含凭据和私有提示词 |

`status` 取值：`queued`、`processing`、`speaking`、`completed`、`silent`、`skipped`、`superseded`、`failed`。

#### 3.2.4 请求和服务端事件

```ts
type VoiceSessionCreateInput = {
  botId?: string;
  channelId: string;
  participantBotIds?: string[];
  defaultSpeakerBotId?: string;
  clientPlatform: VoiceClientPlatform;
  clientInstanceId: string;
  timeZone?: string;
  provider?: VoiceProviderId;
};

type VoiceParticipantView = {
  botId: string;
  name: string;
  title: string;
  voice: string;
  ordinal: number;
  isDefaultSpeaker: boolean;
};
```

新增或扩展的服务端事件包含：

```ts
type VoiceSpeakerFields = {
  speakerBotId: string;
  speakerName: string;
};
```

`reply.message`、`audio.started`、已知说话人的 `audio.stopped` 和响应完成事件都应携带说话人字段。一个 WebSocket 服务整个群聊会话，不为每个参与成员创建连接。

### 3.3 接口契约

覆盖需求：1、2、4、5、6、8。

#### 3.3.1 创建语音会话

- 类型：HTTP。
- 路径：`POST /api/voice/sessions`。
- 输入：`VoiceSessionCreateInput`。
- 输出：现有 `VoiceSessionTicketView` 加 `mode`、`participants`、`defaultSpeakerBotId`。
- 校验：直接频道要求 `botId`；群聊要求一到六个有效 `participantBotIds`；默认说话人必须属于参与成员。
- 错误：`voice_unavailable`、`voice_target_not_found`、`voice_provider_unconfigured`、`voice_invalid_participants`、`voice_concurrency_limit`。

#### 3.3.2 接收群聊语音最终转写

- 类型：服务端函数。
- 标识：`VoiceService.acceptGroupVoiceTranscript`。
- 输入：`sessionId`、`turnId`、`text`、`durationMs`、可选 `language`。
- 输出：`accepted`、`userMessageId`、`responseIds`。
- 校验：会话归属、会话状态、最大文本长度、转写有意义、幂等键、群聊成员关系。
- 错误：空转写返回未接受；会话失效返回会话错误；重复请求返回原结果；不合法成员不创建会话外成员响应。

#### 3.3.3 语音回合调度

- 类型：内部函数和数据库事务。
- 标识：`AgentMessaging.createVoiceGroupRound`、`AgentMessaging.advanceRound` 的 `voice` 分支。
- 输入：频道、用户消息、已解析响应者、会话 ID、语音回合 ID。
- 输出：有序 `ChannelDelivery` 和 Bot run。
- 校验：参与成员快照、当前成员状态、每个 Bot 一次投递、单回合预算。
- 错误：失活成员标记 `skipped`；运行失败标记 `failed` 并继续后续机会；重复推进依赖数据库锁和幂等键。

#### 3.3.4 语音输出事件

- 类型：WebSocket 事件。
- 标识：`reply.message`、`audio.started`、`audio.stopped`、`turn.completed`。
- 输入：响应记录、可见消息、音频代次。
- 输出：字幕、说话人身份、音频帧和回合状态。
- 校验：活动 session、输出代次、响应去重、说话队列租约。
- 错误：TTS 失败只影响当前响应；连接慢时沿用现有背压和关闭策略。

## 4. 数据与状态模型

### 4.1 数据关系

```text
VoiceSession 1 ── N VoiceSessionParticipant
VoiceSession 1 ── N VoiceTurn
VoiceTurn 1 ── N VoiceTurnResponse
VoiceTurnResponse 0..1 ── 1 Run
VoiceTurn 1 ── 1 voice ChannelRound
ChannelRound 1 ── N ChannelDelivery
ChannelDelivery 0..1 ── 1 Run
```

`VoiceSessionParticipant` 是会话级快照。`VoiceTurnResponse` 是用户回合内的响应机会快照。`ChannelRound` 和 `ChannelDelivery` 继续负责群聊运行顺序，响应表负责语音说话和恢复状态。

普通文本群聊继续使用现有 `ChannelRoundMode.chat`。群聊语音必须使用 `ChannelRoundMode.voice`，并保存 `sessionId`、`turnId` 和预解析响应者。

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `queued` | 等待 Bot run | 语音回合提交成功 | 开始 run、被淘汰、成员失活 |
| `processing` | Bot 正在执行 | Worker 获取投递 | 可见答复、静默完成、失败、取消 |
| `speaking` | 有可见答复并等待音频 | 语音 sink 接收消息 | 音频结束、抢话、失败 |
| `completed` | 有答复且音频完成 | 音频完成或消息已确认 | 不再变化 |
| `silent` | Bot 无可见答复地成功完成 | run 成功且没有 `SendToUser` | 不再变化 |
| `skipped` | 不再处理该 Bot | 成员失活或被移除 | 不再变化 |
| `superseded` | 被新用户回合替代 | 抢话或新回合提交 | 不再变化 |
| `failed` | 当前响应失败 | Worker、TTS 或持久化失败 | 按群聊恢复规则处理 |

父级 `VoiceTurn` 在所有 `VoiceTurnResponse` 进入终态后变为 `completed`、`interrupted` 或 `failed`。所有响应都是 `silent` 时，父级仍然是成功的 `completed`。

## 5. 错误处理

### 5.1 错误类型

- `voice_invalid_participants`：参与成员不是当前群聊活跃成员、重复或超过上限。
- `voice_default_speaker_invalid`：默认说话人不在参与成员集合中。
- `voice_group_turn_inactive`：语音会话、群聊回合或当前投递已失效。
- `voice_duplicate_final`：最终转写已接受，返回已有结果而不是创建新工作。
- `voice_speaker_queue_busy`：说话队列被关闭或当前会话已结束。
- `voice_tts_failed`：当前 Bot 的 TTS 失败，响应记录失败并继续回合。
- `voice_loop_guard`：检测到重复回合、重复响应或超出语音预算。

### 5.2 错误响应格式

```json
{
  "detail": "群聊语音会话无法继续",
  "error_code": "voice_group_turn_inactive",
  "field": "sessionId",
  "timestamp": "2026-11-10T00:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：在创建资源前拒绝并返回稳定错误码。
2. 业务规则错误：保持会话存活，跳过当前响应或将当前回合标记为失败。
3. 外部依赖错误：记录安全原因码，按响应粒度继续，不让 TTS 失败拖垮整个会话。
4. 重试、降级或补偿：依赖现有群聊重投递、Outbox 幂等和会话重连；静默完成不能因为没有消息而重试。

## 6. 正确性属性

### 6.1 属性 1：响应者集合固定

*对于任何* 已接受的群聊语音回合，系统都应该只为用户最终转写解析出的参与成员创建响应机会，不因历史点名或 Bot 输出新增成员。

**验证需求：** 需求 2、需求 7。

### 6.2 属性 2：静默完成是成功终态

*对于任何* 没有调用 `SendToUser` 且 run 成功结束的响应，系统都应该将响应标记为 `silent`，不创建频道消息、字幕或 TTS 项目，并推进下一响应机会。

**验证需求：** 需求 3、需求 5。

### 6.3 属性 3：单一说话人

*对于任何* 一个活动群聊语音会话，系统都应该最多让一个 TTS 队列项目进入播放状态。

**验证需求：** 需求 4、需求 8。

### 6.4 属性 4：一次响应机会

*对于任何* 一个语音回合和一个解析 Bot，系统都应该最多创建一条投递和一个响应机会；重复最终转写不能增加数量。

**验证需求：** 需求 5、需求 6、需求 7。

### 6.5 属性 5：普通群聊不受影响

*对于任何* `ChannelRoundMode.chat` 的回合，系统都应该继续使用现有文本群聊路由和回合规则；群聊语音逻辑只在 `voice` 模式生效。

**验证需求：** 需求 7、需求 8。

## 7. 测试策略

### 7.1 单元测试

- 群聊会话输入校验、参与成员去重和默认说话人校验。
- 文本点名、口语名称、所有人、歧义和未点名解析。
- 响应机会顺序、静默状态和终态汇总。
- 单一说话队列和音频代次。
- 重复最终转写和重复消息通知。

### 7.2 集成测试

- 群聊会话创建保存参与成员快照。
- 点名一个、多个、所有人和未点名的响应范围。
- 静默 Bot 不产生消息、字幕或音频，但后续 Bot 仍然执行。
- 多个有答复 Bot 只按顺序说话。
- Bot 点名不产生成员追问回合。
- 失活成员跳过、Worker 失败继续、抢话淘汰和重连恢复。
- 直接语音和普通文本群聊回归。

### 7.3 端到端测试

- 桌面端群聊入口、成员选择器和默认说话人选择。
- 说话人字幕、头像和静默状态。
- 停止、最小化、麦克风静音、扬声器静音、抢话和重试。
- 同一会话只有一个 WebSocket 和一个音频输出。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §3.3.1、§4.1 | 契约测试、会话集成测试 |
| `requirements.md` 需求 2 | `design.md` §2.3.2、§3.2.4 | 路由单测和响应者集成测试 |
| `requirements.md` 需求 3 | `design.md` §2.3.3、§4.2、§6.2 | 静默完成集成测试 |
| `requirements.md` 需求 4 | `design.md` §2.3.3、§3.3.4、§6.3 | TTS 队列和客户端测试 |
| `requirements.md` 需求 5 | `design.md` §3.2、§4.1 | 数据库和消息持久化测试 |
| `requirements.md` 需求 6 | `design.md` §2.3.4、§5.3 | 重试、重复转写和重连测试 |
| `requirements.md` 需求 7 | `design.md` §2.3.3、§6.1、§6.4、§6.5 | 循环保护和普通群聊回归测试 |
| `requirements.md` 需求 8 | `design.md` §2.1、§3.3.4、§7.3 | 桌面端 UI 和协议测试 |

## 8. 风险与待确认项

### 8.1 风险

- 现有群聊 `sendVisible` 可能自动创建文本追问回合，若未正确识别 `voice` 模式，会造成重复唤醒。
- 多个响应 run 的完成时间与 TTS 播放时间可能不同，必须明确当前响应何时允许推进下一响应。
- Bot 静默需要依赖 Worker 成功结束且没有可见消息，恢复逻辑不能把静默误判为失败。
- 口语名称可能与普通词汇或另一个 Bot 名称产生歧义，错误唤醒会破坏通话体验。
- 每个参与成员建立 TTS pool 可能增加连接数量和资源占用，需要有界并在会话关闭时清理。
- 现有直接语音字段保留为兼容锚点，若后续代码错误使用它进行群聊路由，会造成主 Bot 依赖。

### 8.2 待确认项

- 未点名时是否只唤醒默认说话人。推荐只唤醒默认说话人。
- 参与成员选择器是否默认全选。推荐默认全选。
- 是否允许同一个 Bot 在一次响应机会中发送第二条可见消息。推荐不允许。
- 第一版是否支持可配置口语别名。推荐先使用精确归一化名称和常见口语形式。
- iOS 和 Android 群聊入口是否与桌面端同批发布。推荐先保持直接语音兼容，后续单独发布。
