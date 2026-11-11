# 设计文档：群聊实时语音对话

规格编号：`002.1`

状态：草案

日期：2026 年 11 月 10 日。

## 1. 概述

### 1.1 目标

一句话：语音转写作为普通群聊用户消息进入现有群聊流程，Bot 的群聊答复按顺序朗读，写出一句读一句。

设计原则：

- 复用现有群聊机制，只在五个点增加分支：创建回合时使用语音点名结果、语音回合按 `@` 接力而不是自由追问、被点名回合的回复兜底、投递完成后通知语音会话、朗读时去掉 `@`。
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
| 静默完成 | 群聊提示 “A turn with no SendToUser is a silent contribution”，投递 `completed` 且无消息（被点名的回合除外，见 §2.3.6） |
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
  -> 现有 advanceRound 串行投递（语音回合只按答复里的 @ 接力，见 §2.3.5）
  -> completeDelivery 发布 Outbox 后调用 onGroupDeliverySettled
  -> VoiceService 找到会话连接，把该 run 的答复加入朗读队列
  -> 现有 TTS 链路，按 Bot 声音朗读，事件携带 speakerBotId
```

### 2.2 模块职责

| 模块 | 改动 |
| --- | --- |
| `packages/contracts/src/voice.ts` | 输入增加 `participantBotIds`；会话视图和 `reply.message`、`audio.started` 增加可选字段 |
| `packages/db/prisma/schema.prisma` | `VoiceSession.participantBotIds String[] @default([])` |
| `packages/messaging/src/group-routing.ts` | 新增 `resolveVoiceResponders`（集体称呼、同音字）、`resolveRelayResponders`、`isAddressedTurn` |
| `packages/messaging/src/index.ts` | `createGroupRound` 接受预解析响应者；语音回合按 `@` 接力；`completeDelivery` 的被点名兜底；新增 `onGroupDeliverySettled` 回调 |
| `packages/messaging/src/group-outbox.ts` | 新增 `stageFallbackMessage`，把兜底文本写入 Outbox |
| `apps/server/src/services/channel-service.ts` | `sendGroupMessage` 增加内部参数 `responderIds`，并写入 `metadata.voice` |
| `apps/server/src/services/voice-service.ts` | 群聊会话创建、转写接收分支、边写边读（`speakGroupChunk`）、投递完成后补读剩余部分、字幕同步 |
| `apps/server/src/services/voice-session.ts`、`voice-media.ts` | `waitForPlayback`、`queuedFrames` |
| `apps/server/src/services/voice-opening.ts` | 群聊开场白 |
| `packages/contracts/src/index.ts` | `ComputerTurnRequest.voiceSpeech` |
| `apps/computer/src/runtime.ts`、`runtime/voice-stream.ts` | 群聊语音 run 创建 `SendToUserSpeech`（`toRoom`） |
| 桌面端 `live-voice-layer.tsx`、`live-voice.css`、`use-live-voice.ts`、`live-voice-audio.ts` | 参与者头像网格、说话动效、字幕行、按 `replaces` 替换字幕、播放结束事件 |
| `apps/worker/src/worker.ts` | 群聊投递 run 按回合根消息识别语音回合，注入 `voiceTurnPrompt` 和 `voiceRoomPrompt`（如何用 `@` 交棒） |
| `apps/server/src/services/voice-text.ts` | 新增 `stripVoiceMentions`，朗读前去掉 `@名字` |
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
2. Worker 发现投递所属回合的**根消息**带 `metadata.voice` 时注入 `voiceTurnPrompt` 和 `voiceRoomPrompt`。接力回合的触发消息是 Bot 的答复，不带 `metadata.voice`，所以必须看根消息。群聊投递的 run 来源不是 `user`，现有逻辑不会开启旁白。
3. Bot 调用 `SendToUser` 时，消息进入 Outbox，发布要等投递完成。但朗读不等发布，见 §2.3.7。
4. `completeDelivery` 发布 Outbox 后，在调用 `advanceRound` 前 await `onGroupDeliverySettled({ runId, roundId })`。`retryInterruptedGroupDelivery` 的发布分支同样调用。回调异常只记录日志。
5. `VoiceService` 的回调读取回合**根消息**的 `metadata.voice.sessionId`，找到活动连接。没有连接时直接返回。接力回合的触发消息是 Bot 答复，所以不能读触发消息。
6. 读取 `sourceRunId = runId` 的 Bot 消息，跳过连接内已朗读的 `messageId`，对每条消息：
   - 找出它已经边写边读的部分（§2.3.7），只对剩余部分调用 `speak(...)` 加入现有 `ttsChain`。送去合成的文本先经 `stripVoiceMentions` 去掉 `@名字`。
   - `reply.message` 不在这里直接发，而是作为 `speak` 的 `onAudible` 回调，等这条消息的声音真正开始时才发（§2.3.8）。字幕文本保留原文，带 `replaces` 时客户端替换对应的流式字幕。
7. 投递是串行的，回调按投递顺序到达，所以朗读顺序等于投递顺序。下一个 Bot 的投递不等待音频播放。
8. 所有投递结束后，`advanceRound` 结束回合。根消息带 `metadata.voice` 时不创建自由追问回合，只按 §2.3.5 接力。

#### 2.3.4 抢话和重连

1. 抢话沿用现有逻辑：`stopOutputGeneration` 让旧代次的队列项目和正在播放的音频失效。
2. 用户新的有效转写进入 `sendGroupMessage`，由 `supersedeGroupUserTurns` 取消旧回合的 run 并丢弃未发布的答复。
3. 重连替换连接后，后续投递完成回调会找到新连接。已朗读的消息不重播，与直接语音一致。

#### 2.3.5 按 @ 接力

1. 语音回合的最后一次投递完成后，`advanceRound` 读取根消息的 `metadata.voice`。有值时进入语音分支，不走自由追问。
2. 语音分支先检查上限：`roundIndex + 1 >= GROUP_MAX_ROUNDS` 或已发布消息数达到 `GROUP_MAX_MEMBER_TURNS` 时直接结束。
3. 取本回合所有投递的 run 中最新的一条 Bot 答复，用 `resolveRelayResponders(答复, 参与成员, 作者)` 解析被点名的成员。参与成员取 `VoiceSession.participantBotIds` 中的活跃成员，作者本人被排除。
4. 没有被点名者则结束回合。有则调用 `createGroupRound`，触发消息为该答复，`rootMessageId` 不变，`roundIndex` 加一，`responderIds` 为被点名者。
5. 提前思考：接力回合在答复发布的同一事务链里创建并入队，不等待朗读。`onGroupDeliverySettled` 对语音只做 `void speak(...)`，所以上一位的音频还在播放时，下一位已经在读上下文并生成回复。TTS 链仍然串行，音频顺序等于发布顺序。
6. 房间里只有一个其他成员，而答复中的 `@xxx` 没有匹配任何成员时（例如模型沿用了旧名字），视为点名了这个成员。有两个及以上其他成员时不猜。

#### 2.3.6 被点名回合的回复兜底

1. `completeDelivery` 在发布 Outbox 之前，对状态为 `completed` 的投递调用 `stageAddressedFallback`。
2. 判断“被点名”由 `isAddressedTurn` 完成：根消息带 `metadata.voice`，或触发消息是用户消息且 `@` 了该 Bot 或 `@everyone`。其他情况不兜底，保持原有静默行为。
3. 该 run 调用过 `SendToUser`（包括 `(pass)`）则不兜底，因为那是模型对本回合的明确决定。
4. 否则取该 run 最后一条非空的 `agent_message` 文本，经 `normalizeGroupAgentMessage` 过滤 `(pass)` 和空文本，再由 `stageFallbackMessage` 写入 Outbox，由现有 `settleGroupOutbox` 一并发布。
5. 兜底消息的 `callId` 为 `fallback:<runId>`，同一 run 重复结算不会重复发布。

#### 2.3.7 边写边读

1. pi agent 流式生成 `SendToUser` 的参数时，Computer 端的 `SendToUserSpeech` 每看到一句完整的句子（至少 8 个字符，句末为 `。！？；` 或换行，拉丁句号需后跟空白），就调用 `speakChunk`。这条链路在单 Bot 私聊里已存在。
2. 群聊以前没有接入，原因有两个：①只有 `voiceNarration` 开着才会创建 `SendToUserSpeech`，群聊 run 没有；②Server 端按 `runId` 找朗读接收器，只有私聊分支注册了。
3. 现在 Worker 对群聊语音 run（根消息带 `metadata.voice`、有 `deliveryId`、不是子代理）在 `ComputerTurnRequest` 中带 `voiceSpeech: true`。Computer 据此创建 `SendToUserSpeech(…, { toRoom: true })`，不创建旁白器。
4. `toRoom` 的区别：群聊回合里 `SendToUser` 默认发到群里，所以没有 `channel` 且 `to` 不是 `"dm"` 的消息才读；私聊回合则只读没有任何目标的消息。
5. Server 的 `speakChunk` 先交给私聊的接收器，没有再走 `speakGroupChunk`：按 `runId` 查出所属语音会话（根消息的 `metadata.voice.sessionId`）、说话 Bot 的声音和房间成员名，把句子去掉 `@名字` 后送入该会话的朗读队列。
6. 每个 `(runId, callId)` 记录已经读过的原文 `raw` 和当时的输出代次。群聊 run 结算时 `onGroupDeliverySettled` 用 `unspokenRemainder` 只读剩余部分。
7. 抢话后输出代次变化，该回复后面的句子不再朗读，结算时也不重读。
8. 不属于语音通话的群聊 run、没有活动连接的会话，`speakChunk` 返回 false，保持原有行为。

#### 2.3.8 字幕与声音同步

1. 字幕不在文字发布时发，而是在这条消息的声音开始时发。做法是 `speak` 新增可选参数 `onAudible`，在朗读队列轮到这条消息、并且之前排队的音频已经被客户端播完之后调用。
2. “之前排队的音频已播完”由 `VoiceSessionConnection.waitForPlayback(generation, positionMs, timeoutMs)` 判断：目标位置是当前代次已入队的帧数乘以帧长，等客户端的播放确认追上它。抢话换代次时返回 false；客户端迟迟不确认时超时放行，字幕不会永远不出现。
3. 合成不被这个等待阻塞：`stream.end()` 发出请求后才等待，所以下一位的语音在上一位播放期间已经在合成，上一位一播完就能接上。
4. 边写边读时，字幕在第一句的声音开始时发出，内容是到那一句为止已写的文本，消息 id 为 `stream:<runId>:<callId>`。完整消息发布后再发一条 `reply.message`，带 `replaces` 指向它，客户端用完整文本替换。
5. TTS 失败时同样调用 `onAudible`，字幕仍会显示。

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
| { type: "reply.message"; ...; speakerBotId?: string; replaces?: string }
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
2. 出现集体称呼时返回全部参与成员。中文：“所有人”“大家”“你们”“你俩”“两位”“各位”“诸位”。英文按单词边界：`everyone`、`everybody`、`you two`、`you both`、`both of you`、`you all`、`all of you`、`y'all`。
3. 名称匹配：含非 ASCII 字符的名称按去空白后的子串匹配，匹配前把常见同音字折叠为同一字符（如飞/菲/非，满/曼，小/晓），所以转写成“小飞”也能匹配“小菲”；纯 ASCII 名称按单词边界匹配，避免 “Max” 命中 “maximum”。同音字表是 `group-routing.ts` 中的一张小表，只覆盖已知易混的几组。
4. 一个已匹配名称是另一个已匹配名称的子串时，去掉较短的那个。
5. 有匹配时按参与顺序返回；无匹配时返回 `[defaultBotId]`。

#### 3.3.2.1 `resolveRelayResponders` 和 `isAddressedTurn`

```ts
function resolveRelayResponders(
  text: string,
  participants: readonly { id: string; name: string }[],
  authorBotId: string | null
): string[];

function isAddressedTurn(
  turn: { rootIsVoice: boolean; triggerIsUser: boolean; triggerContent: string },
  bot: { id: string; name: string }
): boolean;
```

- `resolveRelayResponders`：复用 `parseGroupMentions`，排除作者；`@everyone` 返回除作者外的全部参与成员；规则 §2.3.5 第 6 点。
- `isAddressedTurn`：语音根消息一律为真；否则只有用户消息里 `@` 了该 Bot 或 `@everyone` 才为真。Bot 之间的 `@` 不算，避免兜底造成 Bot 互相应答。

#### 3.3.3 `ChannelService.sendGroupMessage`

- 新增第三个内部参数 `options?: { responderIds?: string[] }`，HTTP 路由不传。
- `input.voice` 有值时写入用户消息的 `metadata.voice`，与 `sendDirectMessage` 一致。
- `responderIds` 传给 `createGroupRound`。

#### 3.3.4 `AgentMessaging`

- `createGroupRound(tx, { ..., responderIds? })`：有 `responderIds` 时，按其顺序过滤出活跃且非发起者的成员，直接创建投递。
- `advanceRound` 结束回合的分支：根消息的 `metadata.voice` 存在时进入语音分支，只按 §2.3.5 接力，不走自由追问。
- `completeDelivery` 的被点名兜底：§2.3.6。
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

### 6.2 属性 2：语音回合只按 @ 接力

*对于任何* 根消息带 `metadata.voice` 的回合，所有投递结束后，下一回合存在当且仅当最后一条答复 `@` 了作者以外的参与成员，且未超过 `GROUP_MAX_ROUNDS` 和 `GROUP_MAX_MEMBER_TURNS`；下一回合的响应者恰为被点名者。

**验证需求：** 需求 3。

### 6.2.1 属性 2.1：被点名必有回复

*对于任何* 被点名的投递，若 run 正常完成，则该回合要么发布了至少一条该 Bot 的消息，要么该 run 调用过 `SendToUser` 且模型选择了 `(pass)`，要么没有任何非空文本可发。

**验证需求：** 需求 3。

### 6.3 属性 3：顺序朗读

*对于任何* 语音会话，同一时刻最多一个 TTS 项目在播放，朗读顺序等于投递完成顺序，同一 `messageId` 最多朗读一次。

**验证需求：** 需求 4。

### 6.3.1 属性 3.1：朗读不含 @

*对于任何* 送去 TTS 的文本，不含 `@名字` 形式的点名；`reply.message` 字幕保留原文。

**验证需求：** 需求 4。

### 6.4 属性 4：既有行为不变

*对于任何* 触发消息不带 `metadata.voice` 的回合和任何直接语音会话，行为都与改动前一致。

**验证需求：** 需求 1、需求 5，非功能需求 3。

## 7. 测试策略

### 7.1 单元测试

- `resolveVoiceResponders`：单个、多个、所有人、未点名、中文名、英文单词边界、名称包含关系、集体称呼（“你们两个”“you two”）、同音字（“小飞”对“小菲”）。
- `resolveRelayResponders`：点名一人、点名作者自己、没有点名、`@everyone`、旧名字在两人房间里的回落、三人房间不回落、邮箱不算点名。
- `isAddressedTurn`：语音根消息、用户 `@Bot`、用户 `@everyone`、无点名的用户消息、Bot 之间的 `@`。
- `stripVoiceMentions`：去掉 `@名字`，保留邮箱。
- 契约：带和不带 `participantBotIds` 的输入；带 `speakerBotId` 的事件。
- Worker：群聊投递 run 的根消息带 `metadata.voice` 时注入 `voiceTurnPrompt` 和 `voiceRoomPrompt`。
- Computer：`SendToUserSpeech` 的 `toRoom` 分支——普通消息读、`to: "dm"` 和 `channel` 不读、单 Bot 通话不受影响。
- 服务端：`speakGroupChunk` 与 `onGroupDeliverySettled`（`voice-group-stream.test.ts`）——逐句朗读且去掉 `@`、字幕在第一句声音开始时才发、保存后只补读剩余部分并替换字幕、未流式的回复整条朗读、抢话后不再朗读、非语音通话的 run 不朗读。
- 服务端：`waitForPlayback`——播放确认追上目标位置、抢话返回 false、超时放行；`pickGreeting` 群聊开场白。

### 7.2 集成测试

- 消息包：传入 `responderIds` 的回合按给定顺序投递；语音回合结束后只按 `@` 接力，没有点名则不创建下一回合；普通回合仍创建追问回合；投递完成后触发 `onGroupDeliverySettled`；被点名且没有调用 `SendToUser` 的回合发布兜底消息，调用过 `SendToUser`（含 `(pass)`）的不发布。
- 服务端：群聊会话创建和 `voice_invalid_participants`；群聊转写接受与重复转写幂等；投递完成后按顺序发出带 `speakerBotId` 的 `reply.message`，静默投递不发事件。
- 回归：现有直接语音、群聊执行、群聊淘汰测试全部通过。

### 7.3 端到端测试

- 桌面端人工验证：群聊入口、成员选择、点名、多个 Bot 依次朗读、说话人切换、抢话、结束通话；多人会议室样式、说话者头像动效；上一位播完前下一位字幕不出现；第二轮对话第一句声音出现的时间。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §2.3.1、§3.2、§3.3.1 | 契约测试、会话创建集成测试 |
| 需求 2 | §3.3.2、§6.1 | 路由单元测试 |
| 需求 3 | §2.3.2、§2.3.3、§2.3.5、§2.3.6、§3.3.4、§6.2、§6.2.1 | 消息包集成测试、Worker 测试 |
| 需求 4 | §2.3.3、§2.3.4、§2.3.5、§6.3、§6.3.1 | 服务端集成测试、桌面端人工验证 |
| 需求 5 | §3.2.2、§6.4 | 桌面端类型检查、人工验证、回归测试 |
| 非功能需求 1 至 4 | §1.4、§2.3.3、§5.3 | 回归测试、集成测试 |

## 8. 风险与待确认项

### 8.1 风险

- 群聊没有旁白。一个 Bot 执行耗时工具时用户会听到较长静音。边写边读只覆盖 `SendToUser` 文本的生成过程，不覆盖工具执行。
- 边写边读会读出最后没有发布的内容：回合被抢话取消、或 Bot 之后改变主意时，已经读出的句子收不回。抢话用输出代次挡住后续句子，但已读出的无法撤回。
- 同音字折叠只覆盖手写表里的几组字。表外的转写错误仍会回落到默认说话人。需要时再扩表或加别名配置。
- 接力依赖模型在答复里写 `@名字`。模型漏写时辩论会停在当前这位，用户需要再说一句。`voiceRoomPrompt` 只是引导，不保证。
- 提前思考只做到“答复发布即开始下一位”，没有在上一位还在写的时候并行启动。下一位需要读到上一位的完整回复，并行启动要在发布机制上提前暴露草稿，风险更大，没做。边写边读缩短的是每位自己出声前的等待。
- 字幕等待依赖客户端的播放确认。确认迟迟不来时按超时放行，此时字幕可能略早于声音。
- 群聊语音的 Worker 判定、Computer 创建接收器、Server 结算三处必须一起部署。只更新一处时，边写边读退回为发布后朗读，不会出错。
- 兜底把模型的最后一段文本当作回复，可能带有思考性质的内容。只对被点名的回合生效，把范围限制在“用户正在等这个 Bot 回答”的场景。

### 8.2 已定默认值

- 默认全选参与成员，默认说话人为第一个选中成员。
- 一个 Bot 一次投递可发多条消息，受现有 `GROUP_MAX_MESSAGES_PER_TURN` 限制，全部朗读。
- iOS 和 Android 第一版不提供群聊入口。
