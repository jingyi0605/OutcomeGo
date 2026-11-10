# 设计文档：群聊实时语音对话

规格编号：`002.1`

状态：草案

日期：2026 年 11 月 10 日。

## 1. 概述

### 1.1 目标

一句话：语音转写作为普通群聊用户消息进入现有群聊流程，Bot 的群聊答复在投递完成后按顺序朗读。

设计原则：

- 复用现有群聊机制，只在三个点增加分支：创建回合时使用语音点名结果、语音回合不创建追问回合、投递完成后通知语音会话。
- 数据库只增加一个字段 `VoiceSession.participantBotIds`。
- Bot 投递的推进与音频播放解耦：投递照常串行推进，只有朗读队列串行。

### 1.2 覆盖需求

- `requirements.md` 需求 1 至需求 5，非功能需求 1 至 4。

### 1.3 技术约束

- 后端：`apps/server`、`packages/messaging`、`apps/worker`。
- 前端：桌面端 React/Electron。iOS 和 Android 不改。
- 数据：PostgreSQL、Prisma，复用 `ChannelMessage`、`ChannelRound`、`ChannelDelivery`、`VoiceSession`、`VoiceTurn`。
- 兼容：直接语音、普通文本群聊、群聊例行任务（routine）的行为不变。

### 1.4 现有能力复用

| 需要的能力 | 现有实现 |
| --- | --- |
| 每个 Bot 每回合一次投递 | `ChannelDelivery` 的 `@@unique([roundId, botId])` |
| 串行投递和顺序 | `AgentMessaging.advanceRound` 和 `ordinal` |
| 静默完成 | 群聊提示 “A turn with no SendToUser is a silent contribution”，投递 `completed` 且无消息 |
| 答复持久化和去重 | 群聊 Outbox：`stageGroupMessage`、`settleGroupOutbox` |
| 转写幂等 | `ChannelService.sendGroupMessage` 按 `clientId` 幂等 |
| 新消息淘汰旧回合 | `supersedeGroupUserTurns`（取消旧 run，丢弃未发布的 Outbox） |
| 失活成员跳过 | `advanceRound` 对非 `active` Bot 标记 `skipped` |
| 每回合消息上限 | `GROUP_MAX_MEMBER_TURNS`、`GROUP_MAX_MESSAGES_PER_TURN` |
| 抢话后丢弃旧音频 | `connection.media.currentGeneration` 代次检查 |
| 重连 | `VoiceService` 按 `sessionId` 替换连接 |
| 功能开关 | `VoiceSettings.enabled` |

## 2. 架构

### 2.1 系统结构

```text
桌面端群聊语音入口 -> 成员选择器
  -> POST /api/voice/sessions（botId = 默认说话人，participantBotIds）
  -> Voice WebSocket -> VAD、STT（现有）
  -> VoiceService.acceptTranscript 群聊分支
       -> resolveVoiceResponders(转写, 参与成员, 默认说话人)
       -> ChannelService.sendGroupMessage(clientId = voice:<sessionId>:<turnId>, responderIds)
  -> 现有 advanceRound 串行投递（语音回合不创建追问回合）
  -> completeDelivery 发布 Outbox 后调用 onGroupDeliverySettled
  -> VoiceService 找到会话连接，把该 run 的答复加入朗读队列
  -> 现有 TTS 链路，按 Bot 声音朗读，事件携带 speakerBotId
```

### 2.2 模块职责

| 模块 | 改动 |
| --- | --- |
| `packages/contracts/src/voice.ts` | 输入增加 `participantBotIds`；会话视图和 `reply.message`、`audio.started` 增加可选字段 |
| `packages/db/prisma/schema.prisma` | `VoiceSession.participantBotIds String[] @default([])` |
| `packages/messaging/src/group-routing.ts` | 新增 `resolveVoiceResponders` |
| `packages/messaging/src/index.ts` | `createGroupRound` 接受预解析响应者；语音回合不追问；新增 `onGroupDeliverySettled` 回调 |
| `apps/server/src/services/channel-service.ts` | `sendGroupMessage` 增加内部参数 `responderIds`，并写入 `metadata.voice` |
| `apps/server/src/services/voice-service.ts` | 群聊会话创建、转写接收分支、投递完成后朗读 |
| `apps/worker/src/worker.ts` | 群聊投递 run 识别语音回合并注入 `voiceTurnPrompt` |
| 桌面端 `use-live-voice.ts`、`live-voice-layer.tsx`、`App.tsx` | 群聊入口、成员选择器、说话人显示 |

### 2.3 关键流程

#### 2.3.1 创建会话

1. 客户端提交 `botId`（默认说话人）、`channelId`（群聊）、`participantBotIds`。
2. 服务端在 `VoiceService.createSession` 中按频道类型分支：
   - `bot_dm`：现有逻辑不变，`participantBotIds` 为空。
   - `group`：校验频道未归档、`participantBotIds` 去重后为 1 到 `GROUP_MAX_MEMBERS` 个、全部是频道活跃成员、包含 `botId`。
3. `conversationId` 取默认说话人的会话，`voice` 取默认说话人的声音，满足现有非空字段。
4. 其余流程（并发上限、Provider 校验、票据）不变。

#### 2.3.2 接收转写

1. 现有 VAD 和 STT 产生最终转写，现有有效性过滤不变。
2. `acceptTranscript` 创建 `VoiceTurn`（现有逻辑）。
3. 会话为群聊时：
   - 调用 `resolveVoiceResponders` 得到有序 Bot ID。
   - 调用 `sendGroupMessage(channelId, { content, clientId, voice }, { responderIds })`。
   - `VoiceTurn.userMessageId` 写入返回的消息 ID，`runId` 保持为空。
4. 重复的 `(sessionId, turnId)` 由 `clientId` 幂等返回原结果。
5. `sendGroupMessage` 现有的 `supersedeGroupUserTurns` 会淘汰上一条用户消息未完成的回合。

#### 2.3.3 投递和朗读

1. `advanceRound` 按 `ordinal` 串行投递，与文本群聊相同。
2. Worker 发现投递所属回合的触发消息带 `metadata.voice` 时注入 `voiceTurnPrompt`。群聊投递的 run 来源不是 `user`，现有逻辑不会开启旁白。
3. Bot 调用 `SendToUser` 时，消息进入 Outbox，此时不朗读。
4. `completeDelivery` 发布 Outbox 后，在调用 `advanceRound` 前 await `onGroupDeliverySettled({ runId, roundId })`。`retryInterruptedGroupDelivery` 的发布分支同样调用。回调异常只记录日志。
5. `VoiceService` 的回调读取回合触发消息的 `metadata.voice.sessionId`，找到活动连接。没有连接时直接返回。
6. 读取 `sourceRunId = runId` 的 Bot 消息，跳过连接内已朗读的 `messageId`，对每条消息：
   - 发送 `reply.message`（带 `speakerBotId`）。
   - 调用 `speak(text, generation, "answer", botVoice)` 加入现有 `ttsChain`。
7. 投递是串行的，回调按投递顺序到达，所以朗读顺序等于投递顺序。下一个 Bot 的投递不等待音频播放。
8. 所有投递结束后，`advanceRound` 结束回合。触发消息带 `metadata.voice` 时不创建追问回合。

#### 2.3.4 抢话和重连

1. 抢话沿用现有逻辑：`stopOutputGeneration` 让旧代次的队列项目和正在播放的音频失效。
2. 用户新的有效转写进入 `sendGroupMessage`，由 `supersedeGroupUserTurns` 取消旧回合的 run 并丢弃未发布的答复。
3. 重连替换连接后，后续投递完成回调会找到新连接。已朗读的消息不重播，与直接语音一致。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4。

- `resolveVoiceResponders`：纯函数，解析当前转写。
- `createGroupRound` 的 `responderIds` 参数：有值时跳过 `resolveGroupResponderIds` 和轮转。
- `onGroupDeliverySettled`：`AgentMessaging` 上的可选回调，与现有 `onGroupRoutineSettled` 写法一致，由 `AppService` 接到 `VoiceService`。
- `VoiceService` 群聊分支：创建会话、接收转写、朗读答复。

### 3.2 数据结构

覆盖需求：1、4、5。

#### 3.2.1 `VoiceSession` 增加字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `participantBotIds` | `String[]`，默认 `[]` | 群聊参与成员，按频道成员顺序保存；直接会话为空 |

现有字段在群聊会话中的含义：

| 字段 | 群聊含义 |
| --- | --- |
| `botId` | 默认说话人 |
| `conversationId` | 默认说话人的会话，仅满足非空约束 |
| `channelId` | 群聊频道 |
| `voice` | 默认说话人的声音；其他 Bot 朗读时读取 `Bot.voice` |

会话模式由 `channel.kind` 推导，不新增字段。

#### 3.2.2 契约改动

```ts
// VoiceSessionCreateInput
participantBotIds?: string[]; // 仅群聊需要，最多 6 个

// VoiceSessionView
participantBotIds?: string[];

// VoiceServerEvent
| { type: "reply.message"; ...; speakerBotId?: string }
| { type: "audio.started"; ...; speakerBotId?: string }
```

服务端在直接会话中也填写 `speakerBotId = session.botId`，客户端可统一处理。客户端用已有 Bot 列表把 ID 映射为名称和头像。新增字段都是可选字段，原生客户端的解析会忽略未知字段。

### 3.3 接口契约

#### 3.3.1 `POST /api/voice/sessions`

- 输入：`VoiceSessionCreateInput`。
- 群聊校验：见 §2.3.1。
- 新增错误：`voice_invalid_participants`（HTTP 400）。其余错误沿用现有错误码。

#### 3.3.2 `resolveVoiceResponders`

```ts
function resolveVoiceResponders(
  text: string,
  participants: readonly { id: string; name: string }[], // 已按参与顺序排列
  defaultBotId: string
): string[];
```

规则：

1. 文本统一小写。
2. 出现“所有人”“大家”或 `everyone` 时返回全部参与成员。
3. 名称匹配：含非 ASCII 字符的名称按去空白后的子串匹配；纯 ASCII 名称按单词边界匹配，避免 “Max” 命中 “maximum”。
4. 一个已匹配名称是另一个已匹配名称的子串时，去掉较短的那个。
5. 有匹配时按参与顺序返回；无匹配时返回 `[defaultBotId]`。

#### 3.3.3 `ChannelService.sendGroupMessage`

- 新增第三个内部参数 `options?: { responderIds?: string[] }`，HTTP 路由不传。
- `input.voice` 有值时写入用户消息的 `metadata.voice`，与 `sendDirectMessage` 一致。
- `responderIds` 传给 `createGroupRound`。

#### 3.3.4 `AgentMessaging`

- `createGroupRound(tx, { ..., responderIds? })`：有 `responderIds` 时，按其顺序过滤出活跃且非发起者的成员，直接创建投递。
- `advanceRound` 结束回合的分支：`round.triggerMessage.metadata.voice` 存在时直接结束，不调用 `createGroupRound` 创建追问回合。
- `onGroupDeliverySettled?: (input: { runId: string; roundId: string }) => Promise<unknown>`。

## 4. 数据与状态模型

### 4.1 数据关系

```text
VoiceSession 1 ── N VoiceTurn
VoiceTurn 1 ── 1 ChannelMessage（userMessageId，metadata.voice）
ChannelMessage 1 ── 1 ChannelRound（triggerMessageId）
ChannelRound 1 ── N ChannelDelivery 1 ── 0..1 Run
Run 1 ── N ChannelMessage（Bot 答复，sourceRunId）
```

语音回合的识别依据只有一个：触发消息的 `metadata.voice`。

### 4.2 状态流转

不新增状态。

- `ChannelRound`、`ChannelDelivery`、`Run`：沿用现有状态。静默完成是 `completed` 且没有答复消息。
- `VoiceTurn`：与直接语音一致，接受后为 `speaking`，失败为 `failed`，取消为 `interrupted`。
- 朗读队列：沿用现有内存 `ttsChain` 和代次，不持久化。

## 5. 错误处理

### 5.1 错误类型

- `voice_invalid_participants`：参与成员为空、超过 6 个、不是频道活跃成员，或不包含 `botId`。

### 5.2 错误响应格式

沿用现有 `ApiError` 格式。

### 5.3 处理策略

1. 输入错误：创建会话时拒绝。
2. Bot run 失败：沿用群聊投递失败和重投递规则。
3. TTS 失败：沿用现有 `speak` 的重试一次逻辑，失败后跳过该条，继续后续队列。
4. `onGroupDeliverySettled` 异常：记录日志，不影响投递推进。

## 6. 正确性属性

### 6.1 属性 1：响应者只来自当前转写

*对于任何* 语音回合，投递集合都等于 `resolveVoiceResponders` 对当前转写的结果与活跃成员的交集。

**验证需求：** 需求 2。

### 6.2 属性 2：语音回合不追问

*对于任何* 触发消息带 `metadata.voice` 的回合，所有投递结束后都不创建下一回合。

**验证需求：** 需求 3。

### 6.3 属性 3：顺序朗读

*对于任何* 语音会话，同一时刻最多一个 TTS 项目在播放，朗读顺序等于投递完成顺序，同一 `messageId` 最多朗读一次。

**验证需求：** 需求 4。

### 6.4 属性 4：既有行为不变

*对于任何* 触发消息不带 `metadata.voice` 的回合和任何直接语音会话，行为都与改动前一致。

**验证需求：** 需求 1、需求 5，非功能需求 3。

## 7. 测试策略

### 7.1 单元测试

- `resolveVoiceResponders`：单个、多个、所有人、未点名、中文名、英文单词边界、名称包含关系。
- 契约：带和不带 `participantBotIds` 的输入；带 `speakerBotId` 的事件。
- Worker：群聊投递 run 的触发消息带 `metadata.voice` 时注入 `voiceTurnPrompt`。

### 7.2 集成测试

- 消息包：传入 `responderIds` 的回合按给定顺序投递；语音回合结束后不创建追问回合；普通回合仍创建追问回合；投递完成后触发 `onGroupDeliverySettled`。
- 服务端：群聊会话创建和 `voice_invalid_participants`；群聊转写接受与重复转写幂等；投递完成后按顺序发出带 `speakerBotId` 的 `reply.message`，静默投递不发事件。
- 回归：现有直接语音、群聊执行、群聊淘汰测试全部通过。

### 7.3 端到端测试

- 桌面端人工验证：群聊入口、成员选择、点名、多个 Bot 依次朗读、说话人切换、抢话、结束通话。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §2.3.1、§3.2、§3.3.1 | 契约测试、会话创建集成测试 |
| 需求 2 | §3.3.2、§6.1 | 路由单元测试 |
| 需求 3 | §2.3.2、§2.3.3、§3.3.4、§6.2 | 消息包集成测试、Worker 测试 |
| 需求 4 | §2.3.3、§2.3.4、§6.3 | 服务端集成测试、桌面端人工验证 |
| 需求 5 | §3.2.2、§6.4 | 桌面端类型检查、人工验证、回归测试 |
| 非功能需求 1 至 4 | §1.4、§2.3.3、§5.3 | 回归测试、集成测试 |

## 8. 风险与待确认项

### 8.1 风险

- 群聊答复在投递完成后才朗读，没有边写边读和旁白。一个 Bot 执行耗时工具时用户会听到较长静音。如果实测体验不足，后续可以把 `speakChunk` 接到群聊 run。
- 口语转写中的名称可能被 STT 写错或写成同音字，导致回落到默认说话人。第一版不做别名，按实测再决定。

### 8.2 已定默认值

- 默认全选参与成员，默认说话人为第一个选中成员。
- 一个 Bot 一次投递可发多条消息，受现有 `GROUP_MAX_MESSAGES_PER_TURN` 限制，全部朗读。
- iOS 和 Android 第一版不提供群聊入口。
