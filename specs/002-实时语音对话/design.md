# 设计：实时语音对话

状态：草案

日期：2026 年 11 月 6 日。

修订：2026 年 11 月 7 日。根据评审修正 TTS 文本来源、抢话时序、回声消除、输出帧代次、输出背压、重连票据和回合幂等键。

## 1. 决策

第一版采用服务端终止的流式处理链路：

```text
Opus 上行（客户端已做回声消除）
  -> 服务端解码/重采样
  -> 服务端 VAD
  -> 流式 STT 适配器
  -> 最终转写
  -> 现有 ChannelService 和 Worker run
  -> Agent 调用 SendToUser 产生用户可见回复
  -> 语音文本规范化
  -> 流式 TTS 适配器
  -> 服务端 Opus 编码，按播放速度发送
  -> Opus 下行
```

这是在保留 OpenTeam 现有 Agent 工具、会话记忆、持久化消息、Worker 执行和 run 取消能力的前提下，概念最少的实现方式。

TTS 只朗读用户可见回复。OpenTeam 的 Agent 普通助手文本（`agent.delta`）不展示给用户，用户可见回复只来自 `SendToUser` 工具调用，并由 `InternalToolService` 持久化为 `ChannelMessage`。因此语音输出以 `SendToUser` 为唯一文本来源，朗读内容与聊天记录一致。

以后可以在相同的会话边界后面增加原生语音到语音 Provider，但第一版不引入第二套上下文、工具、持久化和中断模型。

第一阶段同时接入火山引擎豆包语音和 Deepgram。服务端 API 和会话状态机保持与 Provider 无关，每个 Provider 都通过独立的 STT/TTS 适配器接入。火山引擎使用其双向流式语音识别和语音合成 WebSocket；Deepgram 使用其流式 STT 和流式 TTS WebSocket。正式接入前仍需通过媒体验证阶段确认两个 Provider 的端点、资源 ID或项目配置、模型、语言、声音、错误码、取消延迟和成本配置。

火山引擎官方接口文档：

- [双向流式语音识别 WebSocket](https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)
- [双向流式语音合成 WebSocket](https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-text-to-speech-websocket?lang=zh)

Deepgram 作为第二个同时支持的 Provider，用于验证 Provider 无关接口并提供国际化选项。它与火山引擎一起出现在 Provider 注册表和配置界面中，管理员可以在创建新会话前选择默认 Provider。中文识别质量、中文声音覆盖、区域、价格和数据处理要求仍需与火山引擎进行实测比较，但这些差异不得泄漏到客户端协议或会话状态机。

## 2. 当前代码库基线

本规格文档的源代码基线是 2026 年 11 月 6 日检查的 `feat/android-client-parity` 分支提交 `efb9b0f8`。

现有可复用基础：

| 区域 | 当前证据 | 复用方式 |
| --- | --- | --- |
| 语音笔记采集 | `apps/desktop/src/renderer/hooks/use-voice-note.ts`、`apps/ios/Sources/App/VoiceMemo.swift`、`apps/android/app/src/main/kotlin/com/openteam/platform/VoiceRecording.kt` | 保留权限和录音体验；在旁边增加实时适配器。 |
| 批量转写 | `apps/server/src/transcription/service.ts`、`apps/server/src/routes/transcription.ts`、`packages/contracts/src/transcription.ts` | 保留批量行为，只在不改变行为的前提下提取共享 Provider 校验。 |
| 认证 WebSocket | `apps/server/src/screen-vnc.ts`、`apps/server/src/main.ts` | 复用一次性协议票据和带标签的 WebSocket 分发模式。 |
| 持久化消息 | `apps/server/src/services/channel-service.ts`、`packages/db/prisma/schema.prisma` | 最终转写进入普通消息/run 路径。 |
| 用户可见回复 | `apps/computer/src/runtime/tools.ts`、`apps/server/src/services/internal-tool-service.ts`、`packages/messaging/src/index.ts`（`sendVisible`） | `SendToUser` 在服务端进程内创建 `ChannelMessage`；语音会话在这里接收可朗读文本。 |
| 新消息替代运行中 run | `packages/messaging/src/index.ts`（用户消息入队时返回 `interruptRunId`）、`apps/server/src/services/channel-service.ts`（`interruptRun`） | 最终转写作为普通用户消息进入后，由现有路径替代仍在运行的旧 run。 |
| Run 取消 | `apps/server/src/services/run-service.ts`、`apps/computer/src/main.ts` | 用户显式停止时使用现有 `stop` 取消；computer 只接受 `user_message`、`parent_message`、`stop` 三种原因，不新增原因。 |
| 实时事件唤醒 | `apps/server/src/event-wakeup.ts`、`packages/db/prisma/sql/raw-schema.sql`（`openteam_notify_event`） | 复用单一 `LISTEN openteam_events` 连接和轮询回退，不新增监听器。 |
| 移动端共享核心 | `mobile/shared/src/commonMain/kotlin/com/openteam/mobile/core/` | 增加语音协议/状态模型，平台音频代码仍保持原生。 |
| 桌面麦克风体验 | `apps/desktop/src/renderer/lib/microphone.ts`、语音笔记组件和测试 | 复用设备选择、权限和音频电平模式。 |
| 原生 VNC Socket | `apps/ios/Sources/Core/ComputerVNCSession.swift`、`apps/android/app/src/main/kotlin/com/openteam/platform/ComputerVnc.kt` | 复用原生认证 WebSocket 的传输约定。 |

当前限制：

- 批量转写只上传录音完成后的完整音频体；
- 没有流式 STT 或 TTS 合同；
- 没有 Bot 音频输出的播放链路；
- `agent.delta` 只携带不对用户展示的助手文本，不能作为 TTS 来源；
- `SendToUser` 的文本在工具参数中以 `toolcall_delta` 形式生成，当前不会流式转发给服务端；
- 一个 run 可以多次调用 `SendToUser`，产生多条用户可见消息；
- 已存在 `voice-call` request source 字面量，但它不在 `isDeliveryOwed` 和 `communicationReminder` 的范围内，直接使用会关闭回复提醒；第一版不使用该字面量；
- 生产服务端镜像尚未声明服务端媒体解码依赖；
- 移动端共享代码有传输和同步原语，但没有 WebSocket 或音频会话抽象。

### 2.1 阶段 0.1 产品基线

- 支持 macOS 桌面端、iOS 18 及以上、Android API 26 及以上。
- 第一版面向所有用户，但服务端实时语音能力默认关闭，只有通过能力检查和限制校验后才展示入口。
- 单个会话最长 30 分钟，单个语音回合最长 60 秒。
- 语音笔记继续使用现有的完整录音上传和批量转写流程，实时语音不复用或改变其用户入口和协议。

## 3. 系统架构

```text
┌───────────────────────┐
│ macOS / iOS / Android │
│ 原生采集 + 回声消除   │
│ 原生 Opus 编码        │
│ 原生 Opus 播放        │
└───────────┬───────────┘
            │ 经过认证的 WebSocket
            │ JSON 控制消息 + 二进制 Opus 帧
┌───────────▼──────────────────────────────────────────────┐
│ OpenTeam 服务端                                           │
│                                                           │
│ VoiceSessionService                                       │
│   ├─ 票据/认证/Origin/撤销                                │
│   ├─ 会话状态和限制                                       │
│   ├─ 帧校验/背压                                          │
│   ├─ Opus 解码 -> PCM16 单声道                            │
│   ├─ VAD 和回合检测                                       │
│   ├─ StreamingSttProvider                                │
│   ├─ ChannelService 最终转写桥接                         │
│   ├─ VoiceReplySource <- SendToUser 可见消息              │
│   ├─ 语音文本规范化                                       │
│   ├─ StreamingTtsProvider                                │
│   └─ PCM -> Opus 编码 -> 按播放速度发送                   │
│                                                           │
│ PostgreSQL                                                │
│   ├─ VoiceSession                                         │
│   └─ VoiceTurn                                           │
└───────────────────────────────────────────────────────────┘
            │ 现有内部 HTTP / DB Worker 路径
┌───────────▼───────────┐
│ Worker -> computer    │
│ 现有文本 Agent        │
│ 工具、记忆、run       │
└───────────────────────┘
```

服务端 WebSocket Handler 只负责传输层。`VoiceSessionService` 负责会话状态和媒体链路协调。Provider 适配器负责 Provider 协议细节。Worker 永远不会收到原始音频，也不需要知道语音会话的存在。

语音会话与创建它的服务端进程绑定：票据保存在进程内存中，WebSocket 也终止在该进程。`SendToUser` 由 computer 调用服务端 `/api/internal/tools/call`，在同一服务端进程中执行。`VoiceReplySource` 在 `sendVisible` 成功持久化消息后，按 `runId` 查找活动语音回合，并在进程内把消息内容交给对应会话。持久化的 `ChannelMessage` 是权威结果。进程内投递只是低延迟路径；会话通过 `EventWakeup` 唤醒后，按 `sourceRunId` 查询该 run 的 agent 消息完成对账，补齐进程内投递遗漏的消息。第一版不新增 Worker 事件表。

## 4. 会话生命周期

### 4.1 HTTP 创建会话

`POST /api/v0/voice/sessions`

请求：

```json
{
  "botId": "uuid",
  "channelId": "uuid",
  "clientPlatform": "macos",
  "clientInstanceId": "stable-client-id",
  "timeZone": "Asia/Singapore"
}
```

服务端验证 Bot 和 channel 属于当前认证用户，并且 channel 是该 Bot 的直接会话。服务端创建 `VoiceSession` 行，生成随机的一次性票据，并返回：

```json
{
  "sessionId": "uuid",
  "path": "/api/v0/voice/sessions/uuid/stream",
  "protocols": ["openteam-voice.v1", "ticket.<opaque-ticket>"],
  "expiresAt": "2026-11-06T12:30:00Z",
  "input": {
    "codec": "opus",
    "sampleRate": 48000,
    "channels": 1,
    "frameMs": 20,
    "maxFrameBytes": 1500
  },
  "output": {
    "codec": "opus",
    "sampleRate": 24000,
    "channels": 1,
    "frameMs": 20,
    "maxFrameBytes": 1500
  },
  "limits": {
    "maxSessionMs": 1800000,
    "maxTurnMs": 60000
  }
}
```

响应使用 `Cache-Control: no-store`。票据由服务端进程内保存，只能使用一次，有效期为 30 秒；在异步授权检查前就消费票据。未来部署多实例时，必须在启用跨实例 WebSocket 升级前，将票据状态迁移到共享数据库或共享临时存储。

单个 Opus 包的上限是 1275 字节；`maxFrameBytes` 取 1500，为帧头和未来字段留余量。

### 4.1.1 重连票据

`POST /api/v0/voice/sessions/:sessionId/tickets`

票据只能使用一次，所以重连必须申请新票据。服务端使用现有用户会话认证，校验会话属于当前所有者、未进入终态、租约未过期，再签发与首次创建相同格式的 `protocols`。同一会话同一时刻最多只有一个未使用票据和一个活动 WebSocket；签发新票据会作废旧票据，新连接成功后关闭旧连接。响应使用 `Cache-Control: no-store`。

### 4.2 WebSocket 升级

`GET /api/v0/voice/sessions/:sessionId/stream`

客户端发送服务端返回的两个 subprotocol。服务端校验：

- 精确的 `openteam-voice.v1` 协议；
- 票据格式、有效期和一次性状态；
- 会话 ID 匹配；
- 浏览器/桌面上下文中的 Origin 匹配；
- 用户认证会话仍然有效；
- 会话不是终态；
- 账号和 Bot 并发限制；
- 当前服务端语音能力已启用。

服务端选择 `openteam-voice.v1` 并发送 `ready`。

### 4.3 关闭行为

所有关闭路径都必须记录有界的 `closeReason`，释放资源，并结束当前 Provider/解码器。能够正常关闭时，服务端发送最终 `ended` 控制事件。终端错误使用 WebSocket close code，并在连接仍可用的短暂窗口内发送结构化最终控制事件。

## 5. 传输协议

### 5.1 控制消息

控制消息是 UTF-8 JSON 对象，必须包含 `type`、`version`、`sessionId`，以及服务端到客户端方向上递增的 `sequence`。客户端控制消息使用独立的客户端序列号。

客户端到服务端的消息：

```text
hello
client_ready
stop
cancel_turn
playback.ack
ping
```

服务端到客户端的消息：

```text
ready
session.state
turn.started
transcript.partial
transcript.final
reply.message
audio.started
audio.stopped
barge_in
turn.completed
turn.interrupted
error
ended
pong
```

`reply.message` 在一条 `SendToUser` 消息持久化后发送，包含 `messageId`、可展示文本和该消息对应的输出 `generation`。客户端用 `messageId` 与普通聊天历史对账。`audio.started` 和 `audio.stopped` 携带 `generation`。

示例负载：

```json
{
  "type": "transcript.partial",
  "version": 1,
  "sessionId": "uuid",
  "sequence": 42,
  "turnId": "uuid",
  "text": "Can you check the deployment",
  "isFinal": false
}
```

```json
{
  "type": "turn.completed",
  "version": 1,
  "sessionId": "uuid",
  "sequence": 57,
  "turnId": "uuid",
  "userMessageId": "uuid",
  "runId": "uuid",
  "assistantMessageIds": ["uuid", "uuid"],
  "status": "completed"
}
```

控制负载必须有大小上限。部分文本如果客户端处理较慢，必须合并发送。

### 5.2 二进制音频帧

每条 WebSocket 二进制消息只包含一个帧：

```text
offset  size  field
0       2     magic = 0x4F56（"OV"）
2       1     protocol version = 1
3       1     frame kind：1=input，2=output
4       4     generation，无符号大端整数
8       4     sequence，无符号大端整数
12      4     timestampMs，无符号大端整数，按 2^32 取模
16      2     payloadLength，无符号大端整数
18      N     Opus packet
```

帧头为 18 字节。服务端拒绝尾随字节、错误 magic、错误方向、不支持的版本、过大负载、违反序列规则的帧，以及会话或回合结束后收到的帧。

`generation` 是输出代次。服务端每开始朗读一条 `reply.message` 就递增一次，抢话或停止时也递增一次。客户端收到 `barge_in` 或 `audio.stopped` 后，丢弃 `generation` 小于等于被停止代次的所有输出帧，包括已经在网络中传输的帧。输入帧的 `generation` 固定为 0，服务端忽略该字段。`sequence` 在每个 `generation` 内从 0 开始递增。

客户端发送 48 kHz 单声道输入。服务端将其解码并重采样为 16 kHz 单声道 PCM16，用于 VAD 和 STT。服务端将输出编码为 24 kHz 单声道 Opus。协商值必须明确记录，以便未来增加编码协议版本，而不改变会话状态机。

### 5.3 背压

TTS Provider 产生音频的速度通常快于实时播放，所以输出侧的背压方向是向上游：服务端按播放速度发送，队列满时暂停从 TTS Provider 读取，而不是关闭会话。

- 输入队列：每个会话最多 500 ms 的已解码音频；输入溢出说明服务端处理落后，先进行一次有界排空，仍然溢出则以 `1013` 关闭；
- 输出发送：服务端按 `frameMs` 节奏发送，最多领先客户端已确认播放位置 1,000 ms（启动缓冲加抖动余量）；
- 输出缓冲：服务端最多保留 2,000 ms 已编码但未发送的音频；缓冲满时暂停读取 TTS 流，Provider 适配器通过其流式接口自然施加背压；
- `playback.ack` 报告客户端已播放到的 `generation` 和 `sequence`，推进领先窗口；
- 客户端超过 5,000 ms 没有推进 `playback.ack`，且发送窗口已满，视为客户端卡死，以 `1013` 关闭；
- Provider 文本队列：最多 32 KB 的未合成文本；
- WebSocket 控制队列：最多 256 条消息；
- 不得为了掩盖慢客户端而静默丢弃音频帧。抢话时按 `generation` 主动丢弃旧输出不属于静默丢弃。

## 6. 状态机

### 6.1 服务端会话

```text
created
  -> connecting
  -> ready
  -> listening
  -> processing
  -> speaking
  -> listening              （回合完成）
  -> closing
  -> ended

任何非终态 -> failed -> ended
speaking + 检测到语音 -> listening（输出已停止，旧回合等待替代或恢复）
```

服务端是权威状态源。客户端状态是可能在服务端仍可恢复时显示 `reconnecting` 的投影。

### 6.2 语音回合

```text
idle
  -> listening
  -> finalizing_input
  -> transcript_ready
  -> run_queued
  -> run_running
  -> speaking
  -> completed

listening -> cancelled（无语音或用户取消）
run_running/speaking -> output_paused（检测到抢话语音，只停止输出）
output_paused -> superseded（新回合的最终转写被接受）
output_paused -> run_running/completed（新语音没有产生有效转写，旧 run 继续）
run_running/speaking -> interrupted（用户显式停止）
任何状态 -> failed
```

`completed` 表示持久化路径已经结束，不要求客户端已经播放所有输出帧。`superseded` 和 `interrupted` 都是终态。

## 7. Agent 桥接

### 7.1 用户输入

STT 产生最终转写后：

1. 校验文本非空，以及回合和会话归属关系。
2. 服务端生成 `VoiceTurn.id`，并使用 `voice:<sessionId>:<turnId>` 作为 `SendMessageInput.clientId`。该值为 79 个字符，满足现有 8 到 120 个字符的限制。`ChannelMessage` 的 `@@unique([channelId, clientId])` 和现有 `IdempotencyRecord` 共同保证同一语音回合最多创建一条用户消息。
3. 调用新的 `VoiceService.acceptTranscript`，由它使用普通的 `SendMessageInput` 形状进入现有 ChannelService 直接消息接受路径。
4. 在 channel message 中存储语音元数据：

```json
{
  "type": "text",
  "voice": {
    "sessionId": "uuid",
    "turnId": "uuid",
    "durationMs": 4200,
    "language": "en",
    "provider": "volcengine"
  }
}
```

5. 将生成的 run 与 `VoiceTurn` 关联。
6. 只有 run 已结算后才发送 `turn.completed`；此前可以发送 `run_queued`/`run_running` 状态。

原始音频不加入 `ChannelMessage`。

### 7.2 Agent 输出

TTS 文本来源是 `SendToUser`，不是 `agent.delta`：

1. computer 执行 `SendToUser`，调用服务端 `/api/internal/tools/call`。
2. `InternalToolService` 调用 `messaging.sendVisible` 持久化 `ChannelMessage`，`sourceRunId` 为当前 run。
3. 持久化成功后，`VoiceReplySource` 按 `runId` 查找本进程中处于 `run_running` 或 `speaking` 的语音回合。找到后，把消息交给会话。这一步不影响工具调用结果；失败时只记录脱敏日志。
4. 会话向客户端发送 `reply.message`，把规范化后的文本送入 TTS，并为该消息分配新的 `generation`。
5. 同一 run 的多条消息按 `ChannelMessage.sequence` 顺序排队朗读；`VoiceTurn.assistantMessageIds` 按顺序记录所有消息。
6. 会话被 `EventWakeup` 唤醒或回合结算时，按 `sourceRunId` 查询 agent 消息并补齐遗漏，不会重复朗读已经处理过的 `messageId`。

只朗读 `type: "text"` 的 `SendToUser`。附件、图片和 secret request 只通过 `reply.message` 展示，并朗读一句固定的本地化提示，例如"我发送了一个文件"。带 `channel` 参数发往外部 Connector 的 `SendToUser` 不朗读。

**语音文本规范化。** 送入 TTS 前，服务端去除 Markdown 标记，用简短提示替换代码块，把 URL 替换为域名，再按句子边界切分。规范化只影响朗读文本；聊天历史保留原始内容。

**语音提示。** 第一版不新增 `RunOrigin` 或 `RuntimeRequestSource`，语音 run 仍使用 `origin: "user"` 和 `requestSource: "turn"`，以保留回复提醒和投递义务。持久化的用户消息内容只保存转写文本。Worker 构造 turn 请求时，如果触发消息的 `metadata.voice` 存在，就在 `prependMessages` 中追加一条 `[SAND_HIDDEN_PROMPT]` 提示，说明当前是语音对话、回复应简短且适合朗读、不要使用表格和代码块。该提示不进入聊天历史。实现时需确认 Worker 读取触发消息元数据的位置，并保证非语音 run 的 turn 请求完全不变。

**首段音频延迟。** `SendToUser` 的文本在整条工具参数生成完成后才到达服务端，所以首段音频延迟包含整条消息的生成时间。隐藏提示要求 Agent 先发一条简短回复，可以缩短这段延迟。流式解析 `toolcall_delta` 中的部分 JSON 可以更早开始朗读，但需要把 computer 的工具参数流转发到服务端。第一版不实现该方案；阶段 0 测量两种方式的延迟差异后再决定。

### 7.3 中断

抢话分为两步，先停止输出，再由新消息替代旧 run：

**第一步：检测到语音时只停止输出。**

1. 服务端 VAD 在输出活动期间检测到语音，并持续达到最短时长。
2. 递增 `generation`，发送 `barge_in` 和 `audio.stopped`。
3. 取消当前 TTS 请求，丢弃排队的输出帧，停止朗读该回合后续的 `reply.message`。
4. 将当前 `VoiceTurn` 标记为 `output_paused`。不取消 run。

**第二步：新转写被接受时替代旧 run。**

5. 新回合的最终转写通过 `acceptTranscript` 进入现有直接消息路径。
6. 现有用户消息入队逻辑在旧 run 仍为 `running` 时返回 `interruptRunId`，`ChannelService.interruptRun(runId, true)` 以 `user_message` 原因取消旧 run。语音不新增取消原因。
7. 旧 `VoiceTurn` 标记为 `superseded`。

**新语音没有产生有效转写**（咳嗽、附和声、噪声）时，旧 run 继续执行。它之后产生的 `SendToUser` 消息照常持久化，并通过 `reply.message` 展示，但不自动朗读，避免打断用户之后再突然开口。旧回合结算后标记为 `completed`。

**用户显式停止**（客户端发送 `cancel_turn` 或 `stop`）时，服务端停止输出，并通过现有 `RunService.cancel` 以 `stop` 原因取消 run，回合标记为 `interrupted`。

如果 run 已经持久化完成，服务端只停止播放，不得修改已经完成的消息。

## 8. 持久化

### 8.1 `VoiceSession`

增加 Prisma 模型，包含：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `id` | UUID | 会话标识 |
| `user/session identity` | string | 所有者授权绑定 |
| `botId` | UUID | 目标 Bot |
| `conversationId` | UUID | 目标 conversation |
| `channelId` | UUID | 持久化消息 channel |
| `platform` | string | `macos`、`ios` 或 `android` |
| `state` | string enum/text | 当前活动或终态 |
| `protocolVersion` | int | 协商的协议版本 |
| `expiresAt` | DateTime | 租约过期时间 |
| `startedAt` | DateTime | 首次接受连接的时间 |
| `endedAt` | DateTime? | 进入终态的时间 |
| `closeReason` | string? | 已脱敏的关闭分类 |
| `createdAt/updatedAt` | DateTime | 审计和清理 |

索引包括所有者/会话身份和活动状态、Bot 和活动状态、过期时间以及创建时间。

控制消息序列号、输出 `generation` 和播放确认位置只保存在服务端进程内存中。会话本来就绑定到单个进程，把这些值写入数据库会让每条控制消息多一次写入。`VoiceSession` 只在状态变化、连接、关闭时写入。服务端重启后，进程内状态丢失，遗留的非终态会话由启动清理标记为 `failed`。

### 8.2 `VoiceTurn`

增加模型，包含：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `id` | UUID | 回合标识，由服务端在 VAD 检测到回合开始时生成 |
| `sessionId` | UUID | 语音会话 |
| `sequence` | int | 会话内顺序 |
| `runId` | UUID? | 已关联的现有 run |
| `userMessageId` | UUID? | 已关联的持久化用户消息 |
| `assistantMessageIds` | UUID[] | 按顺序关联的 `SendToUser` 消息，可以为空 |
| `status` | string | listening、running、output_paused、completed、superseded、interrupted、cancelled、failed |
| `transcript` | text? | 仅保存最终转写 |
| `language` | string? | Provider 结果 |
| `inputDurationMs` | int? | 有界指标 |
| `firstTranscriptAt` | DateTime? | 延迟指标 |
| `firstAudioAt` | DateTime? | 延迟指标 |
| `completedAt` | DateTime? | 结算时间 |
| `error` | JSON? | 已脱敏错误分类 |

唯一键为 `(sessionId, sequence)`。用户消息幂等由 `voice:<sessionId>:<turnId>` 作为 `ChannelMessage.clientId` 保证，不需要客户端提供回合 ID。为活动会话、`runId` 查询和创建时间增加索引；`runId` 索引供 `VoiceReplySource` 查找回合。

### 8.3 不新增 Worker 事件表

第一版不增加 `VoiceSessionEvent`。语音输出来自 `SendToUser`，它在服务端进程内执行并持久化 `ChannelMessage`，不需要 Worker 跨进程转发文本。对账使用现有 `EventWakeup` 唤醒和 `ChannelMessage.sourceRunId` 查询。只有阶段 0 决定流式转发 `toolcall_delta` 时，才重新评估是否需要短期事件表。

## 9. Provider 边界

增加仅供服务端使用的接口：

```ts
interface StreamingSttProvider {
  open(input: {
    model: string;
    language?: string;
    signal: AbortSignal;
    onPartial: (text: string) => void;
    onFinal: (result: { text: string; language?: string }) => void;
  }): Promise<{
    writePcm16(chunk: Uint8Array): Promise<void>;
    end(): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface StreamingTtsProvider {
  synthesize(input: {
    model: string;
    voice: string;
    text: AsyncIterable<string>;
    signal: AbortSignal;
    onPcm16: (chunk: Uint8Array, sampleRate: number) => Promise<void>;
  }): Promise<void>;
}
```

核心接口只接受标准化的 PCM 和文本流，不暴露 Provider 专用的 WebSocket 消息、鉴权字段、连接状态或结束语义。建议将实现拆成三层：

1. `voice-provider.ts`：定义 STT/TTS 接口、标准化事件、能力声明和错误类型。
2. `voice-provider-registry.ts`：根据服务端配置选择适配器，校验 Provider 是否声明 `stt`、`tts`、取消和目标音频格式能力。
3. `voice-providers/<provider>.ts`：封装单个 Provider 的 URL、鉴权、握手、消息编码、消息解析、重连和关闭语义。

火山引擎和 Deepgram 适配器必须满足以下边界：

- STT 适配器接收服务端规范化的 PCM16 单声道音频，并将各 Provider 的部分转写、最终转写、无语音、错误和结束事件转换为统一的 OpenTeam 事件。
- TTS 适配器接收规范化后的回复文本流，按各 Provider 要求完成连接、会话开始、增量文本、会话结束，并将音频事件转换为带采样率的 PCM16 数据块。适配器必须尊重调用方的读取节奏：调用方暂停消费 `onPcm16` 时，适配器停止读取 Provider 流，不得在内存中无界缓存音频。火山引擎适配器请求 `pcm` 音频格式；Deepgram 适配器使用其流式 TTS 音频输出并在适配器内部完成格式规范化。
- Provider 的鉴权字段、资源 ID、项目配置、连接 ID、请求 ID、事件类型和二进制消息头只存在于对应适配器内部。
- Provider 的连接失败、协议错误、超时、限流和取消必须映射为稳定的 OpenTeam error code。
- 适配器必须执行响应字节上限、文本上限和并发上限，在抢话时取消请求，并且不能记录 Provider 负载。

两个 Provider 的 STT 输入和 TTS 输出都先在服务端转换到 OpenTeam 的内部格式。这样客户端协议始终保持 Opus 帧，切换 Provider 或增加其他 Provider 时不需要修改客户端。

### 9.1 火山引擎适配器参数

第一阶段同时注册服务端配置中的 Provider 类型 `volcengine` 和 `deepgram`。配置界面必须同时展示两个 Provider 的配置卡片，分别保存和检查凭据、模型及能力；管理员选择的默认 Provider 只影响新建会话。会话创建时保存 Provider 类型和配置快照，运行中的会话不会因为默认值变化而切换 Provider。配置至少包括：

| 配置 | 说明 |
| --- | --- |
| `provider` | `volcengine` 或 `deepgram` |
| `sttEndpoint` / `ttsEndpoint` | 根据 Provider 使用默认端点，并允许部署环境覆盖 |
| `sttResourceId` / `ttsResourceId` | 火山引擎资源 ID；Deepgram 使用对应项目、模型或端点配置 |
| `sttModel` / `ttsModel` | Provider 模型或版本标识 |
| `language` | STT 语言或语言检测策略 |
| `voice` | TTS 音色 |
| `apiKey` | 仅服务端保存的密钥 |
| `outputSampleRate` | 统一为服务端输出编码器使用的采样率 |

服务端设置建议使用按 Provider 分组的结构：

```json
{
  "defaultProvider": "volcengine",
  "providers": {
    "volcengine": {
      "enabled": true,
      "apiKey": "server-secret",
      "sttResourceId": "resource-id",
      "ttsResourceId": "resource-id"
    },
    "deepgram": {
      "enabled": true,
      "apiKey": "server-secret",
      "sttModel": "configured-stt-model",
      "ttsModel": "configured-tts-model"
    }
  }
}
```

该结构中的密钥只存在于服务端安全存储，返回客户端的设置视图只能包含 `configured`、能力、检查状态和脱敏标识。配置界面必须允许分别检查两个 Provider，并在某个 Provider 不可用时保留另一个 Provider 的可选状态。

火山引擎新版控制台使用 `X-Api-Key`；STT 还需要 `X-Api-Resource-Id` 和 `X-Api-Request-Id`，TTS 还需要 `X-Api-Resource-Id`，并可使用 `X-Api-Connect-Id` 跟踪连接。Deepgram 使用其服务端 API 密钥和适配器要求的模型/项目参数。服务端向两个 Provider 发送的认证信息必须只从服务端密钥存储读取。客户端只接收 OpenTeam 会话票据和协商后的音频能力，不接收 Provider 密钥、资源 ID、项目配置或 Provider WebSocket URL。

### 9.2 Deepgram 同时支持和适配器验证

Deepgram 作为第二个同时支持的 Provider，原因是它的 STT 和 TTS 都适合拆分为独立的流式 WebSocket 适配器，且不要求改变本规格文档的服务端终止架构。Deepgram 的流式 STT 使用 `wss://api.deepgram.com/v1/listen`，流式 TTS 使用 `wss://api.deepgram.com/v1/speak`。两个 Provider 都必须通过相同的标准化接口和配置能力检查，管理员可以在配置界面选择默认 Provider，比较以下指标：

- 中文和英文的部分转写稳定性；
- 首个部分转写和最终转写延迟；
- Agent 文本到首段 TTS 音频延迟；
- 抢话时的取消速度；
- 音频格式、采样率和输出稳定性；
- 区域可用性、数据处理位置、并发限制和成本。

官方接口文档：

- [Deepgram 流式 STT](https://developers.deepgram.com/reference/speech-to-text/listen-streaming)
- [Deepgram 流式 TTS](https://developers.deepgram.com/reference/text-to-speech/speak-streaming)

批量 `TranscriptionService` 继续负责 `/api/transcriptions`。只有在不改变批量请求行为的情况下，才允许提取共享 Provider 凭据或错误辅助函数。

## 10. 平台架构

所有平台都必须在采集链路中启用系统回声消除（AEC）。服务端 VAD 在 Bot 播放期间持续检测麦克风输入；没有 AEC 时，扬声器播放的 Bot 声音会被识别为用户说话，持续触发抢话。各平台的 AEC 要求见下文。AEC 不可用时，客户端必须在 `hello` 中声明 `echoCancellation: false`，服务端在该会话的播放期间关闭基于 VAD 的抢话，只接受显式停止。

### 10.1 macOS 桌面端

Electron renderer 负责用户可见的会话状态和 WebSocket 控制。采集使用 `getUserMedia` 并设置 `echoCancellation: true`、`noiseSuppression: true`、`autoGainControl: true`；`apps/desktop/src/renderer/lib/microphone.ts` 已对语音笔记启用 `echoCancellation`。Chromium 的 AEC 只消除同一渲染进程通过 WebAudio 或媒体元素播放的声音，所以输出播放必须走同一 renderer 的 `AudioContext`，不能交给主进程或原生播放器。

阶段 0 对当前 Electron 43.4.1 做了实际探测：运行时版本为 Chromium 150.0.7871.224，`AudioData` 可用，但 `AudioEncoder` 和 `AudioDecoder` 均未暴露；额外启用 WebCodecs 相关 Blink/Chromium 开关后结果不变。因此桌面端不能依赖 WebCodecs Opus，必须在后续 0.3 评审中从 WASM libopus 或其他受支持的本地绑定中确定实现。采集缓冲和播放队列仍使用 AudioWorklet。现有麦克风设备选择和权限工具仍然是显式用户操作的入口。

第一阶段可以使用 renderer 适配器，因为当前桌面语音笔记已经证明了麦克风权限和 MediaStream 采集链路。正式实现必须将长生命周期的音频时钟和资源清理放在 React render 生命周期之外。

### 10.2 iOS

增加独立的 `LiveVoiceSession`，负责 `AVAudioSession`、`AVAudioEngine`/`AudioUnit`、原生 Opus 编解码、输出播放器和 `URLSessionWebSocketTask`。会话活动期间使用 `.playAndRecord` category 和 `.voiceChat` mode，并在 `AVAudioEngine.inputNode` 上调用 `setVoiceProcessingEnabled(true)` 启用系统 AEC。输入和输出必须挂在同一个 `AVAudioEngine` 上，系统才能用播放信号做回声消除。处理中断、路由变化、蓝牙、媒体服务重置、应用后台化和麦克风丢失，并产生明确状态转换。

Opus 编解码优先使用 `AVAudioConverter`（`kAudioFormatOpus`）。阶段 0 已确认 iOS 18 SDK 可以类型检查 PCM 与 Opus 之间的 converter 构造；Apple 文档将 `kAudioFormatOpus` 标记为 iOS 11 起可用，将 `AVAudioConverter` 标记为 iOS 9 起可用。最低版本的真机可用性、延迟和往返质量仍需设备 fixture 验证；不满足要求时再引入 libopus。

当前 `VoiceMemoController` 继续负责语音笔记。不要把实时语音阶段加入它的 phase enum，应该使用独立控制器。

### 10.3 Android

在 `mobile/shared` 中增加共享协议/会话控制器，在 Android 侧使用 `AudioRecord`、`AudioTrack`、WebSocket、Opus 编解码、音频焦点和路由变化适配器。当前 `VoiceRecordingController` 继续负责文件录音。

采集使用 `MediaRecorder.AudioSource.VOICE_COMMUNICATION`，`AudioManager` 设为 `MODE_IN_COMMUNICATION`，播放使用 `USAGE_VOICE_COMMUNICATION`。`AcousticEchoCanceler.isAvailable()` 为真时，在 `AudioRecord` 的 session ID 上启用 `AcousticEchoCanceler`。不同厂商的 AEC 质量差异较大，阶段 6 必须在 Xiaomi 实体设备上做外放测试。

Opus 编解码：`MediaCodec` 的 Opus 解码器从 API 21 起可用，但 Opus 编码器从 API 29（Android 10）起才可用。应用 `minSdk` 是 26，所以 Android 8–9 设备必须使用通过 JNI 打包的 libopus。第一版统一使用 libopus 完成编码和解码，避免两条编码路径；阶段 0 记录 APK 体积增量和各 ABI 的打包方式。

第一版 Android UI 应该是在现有聊天界面中的独立实时语音浮层。必须为 listening、speaking、interrupt、stop、reconnecting 和 error 状态提供无障碍标签。

### 10.4 共享移动端核心

增加可序列化的协议模型、会话 reducer、序列校验、有界重连策略和平台接口：

```kotlin
interface LiveVoicePlatform {
    suspend fun openCapture(config: VoiceAudioConfig): VoiceCaptureStream
    suspend fun openPlayback(config: VoiceAudioConfig): VoicePlaybackSink
    suspend fun requestMicrophone(): Boolean
    suspend fun closeAudio()
}
```

共享 reducer 必须是确定性的，并可在没有 Android 或 iOS 音频 API 的环境中测试。它不能负责平台权限弹窗或具体编解码器实例。

## 11. API 路由和合同

增加以下路由：

```text
POST   /api/v0/voice/sessions
GET    /api/v0/voice/sessions/:sessionId
DELETE /api/v0/voice/sessions/:sessionId
POST   /api/v0/voice/sessions/:sessionId/tickets  （重连票据）
GET    /api/v0/voice/sessions/:sessionId/stream   （WebSocket 升级）
POST   /api/v0/server-settings/voice/check
GET    /api/v0/server-settings/voice
PUT    /api/v0/server-settings/voice
```

GET 会话路由返回脱敏的状态视图，用于重连和诊断。它永远不会返回一次性票据或 Provider 凭据。

在 `packages/contracts/src/voice.ts` 中增加：

- settings input/view；
- session create input/view；
- capability view；
- 控制消息联合类型；
- 解码音频帧元数据；
- error code；
- voice turn 和 session view。

在 `packages/contracts/package.json` 导出 `./voice`，并在 `packages/contracts/src/service-protocol.ts` 加入语音路由常量。

## 12. 安全和运维控制

- 会话创建必须使用正常的 owner authentication mode。
- 票据必须绑定会话、Bot、所有者会话和规范化 Origin。
- 在异步检查前消费票据，防止重放竞争。
- 活动会话期间按固定间隔重新检查所有者授权。
- 限制每个所有者和每个 Bot 的活动会话数。
- 限制输入/输出总字节数、解码时长、帧大小、帧率、Provider 请求数、队列大小和文本缓冲区大小。
- 音频和 Provider 密钥不得进入 Prisma、日志、事件历史或客户端存储，除非未来批准加密诊断模式。
- 所有语音会话 HTTP 响应都使用 `Cache-Control: no-store`。
- 转写内容不得出现在错误消息或指标 label 中。
- 所有者退出登录或目标 Bot 被归档时关闭会话。
- readiness 检查必须验证解码器程序/库和 Provider 配置。

生产 app 镜像必须包含选定的解码器依赖。如果实现使用 `ffmpeg`，应在 `docker/app.Dockerfile` 中安装并固定版本，使用 `-nostdin`、固定格式/大小限制、禁止网络输入，并保证父进程退出时进行清理。验证阶段必须将该方案与进程内 Opus 绑定进行运行成本比较，再确定最终适配器。

## 13. 兼容性和发布

功能是否展示由以下条件共同控制：

1. 服务端语音设置已启用；
2. Provider 检查通过，或被明确标记为未验证；
3. 客户端 capability 包含 `realtimeVoice`；
4. Bot/channel 类型受支持；
5. 未超过账号或平台限制。

客户端首先通过正常 bootstrap/runtime 表面请求 capability。旧服务端不返回语音能力，实时语音控件保持隐藏。现有语音笔记继续使用当前 endpoint 和设置。

## 14. 验证策略

### 合同和 reducer

- 对每一种控制消息做往返编码测试；
- 拒绝错误版本、未知必填字段、无效序列和过大文本；
- 测试控制消息重复和重连快照；
- 覆盖所有生命周期和中断路径的 reducer 状态转换。

### 媒体

- 解码有效和损坏的 Opus 帧；
- 拒绝过大和乱序帧；
- 验证队列内存有界；
- 验证 TTS 输出快于实时时，服务端按播放速度发送且不关闭会话；
- 验证抢话后客户端丢弃旧 `generation` 的在途帧；
- 验证 PCM 采样率和声道规范化；
- 验证三种客户端都能解码服务端输出帧；
- 验证不会将原始音频写入磁盘。

### 服务端和 Worker

- 授权、票据过期、Origin 绑定、重放、重连票据、退出登录、归档、并发、配额和会话清理；
- 最终转写幂等；
- `SendToUser` 进程内投递、多条消息顺序朗读、遗漏消息按 `sourceRunId` 补齐且不重复朗读；
- 语音文本规范化（Markdown、代码块、URL）；
- 抢话两步时序：只停输出不取消 run；新转写被接受后由现有 supersede 路径取消；无效转写时旧 run 继续；
- 显式停止使用 `stop` 原因取消；
- 非语音 run 的 turn 请求不变；
- 最终消息持久化对账。

### 客户端

- macOS 浏览器驱动的采集、播放、中断、重连和无 Provider 密钥断言；
- iOS 音频路由、中断、重连、无障碍和持久化消息对账单元/UI 测试；
- Android reducer、音频焦点、生命周期和 UI 状态 JVM/仪器测试；
- 至少一个 macOS 麦克风/扬声器环境、一台 iOS 真机和一台 Android 真机的物理设备测试；
- 每个平台都必须做外放（不戴耳机）测试：Bot 连续朗读 30 秒期间不得出现误触发抢话。

### 部署

- 使用解码器依赖构建服务端镜像；
- 语音关闭和开启两种模式启动生产 compose；
- 验证健康检查，以及客户端断开后的清理；
- 使用有界十回合 soak 测试测量内存、CPU、Provider 并发和会话数。

## 15. 文件影响清单

以下是计划中的实现范围。确切的 Prisma migration 文件名和 Provider 专用 fixture 文件名在对应任务执行时生成。

### 需要修改的现有文件

| 文件 | 计划变更 |
| --- | --- |
| `packages/contracts/src/index.ts` | 增加语音 capability 引用和 channel message 语音元数据类型。不修改 `RuntimeRequestSource`。 |
| `packages/contracts/src/service-protocol.ts` | 增加语音 HTTP 路径和协议常量。 |
| `packages/contracts/package.json` | 导出 `./voice`。 |
| `packages/db/prisma/schema.prisma` | 增加 `VoiceSession`、`VoiceTurn` 模型和索引。 |
| `docker/app.Dockerfile` | 安装或打包选定的服务端媒体解码器/运行时依赖。 |
| `apps/server/src/main.ts` | 增加语音 WebSocket 分发、会话关闭/撤销钩子和语音路由注册。 |
| `apps/server/src/app-service.ts` | 构造 `VoiceService`，暴露语音设置/capability 操作，并在关闭时停止语音资源。 |
| `apps/server/src/routes/context.ts` | 在语音路由使用 dispatch 上下文时增加对应集成。 |
| `apps/server/src/services/channel-service.ts` | 暴露窄化的语音回合幂等接受入口，或提取共享消息接受辅助函数。 |
| `apps/server/src/services/internal-tool-service.ts` | `SendToUser` 的 `sendVisible` 成功后调用 `VoiceReplySource`；失败不影响工具结果。 |
| `apps/server/src/services/service-utils.ts` | 如有需要，增加语音关联 ID 和有界 JSON/错误辅助函数。 |
| `apps/server/src/transcription/service.ts` | 只提取不改变批量转写行为的 Provider 凭据/错误辅助函数。 |
| `apps/worker/src/worker.ts` | 触发消息带 `metadata.voice` 时，在 `prependMessages` 中追加语音隐藏提示；其他 run 不变。 |
| `apps/desktop/src/renderer/client/openteam-api.ts` | 增加 capability、会话创建、关闭、状态和设置调用。 |
| `apps/desktop/src/renderer/components/openteam/chat-pane.tsx` | 挂载实时语音浮层，并与最终持久化消息对账。 |
| `apps/desktop/src/renderer/lib/microphone.ts` | 将显式麦克风/设备选择行为共享给实时适配器。 |
| `apps/ios/Sources/App/ChatView.swift` | 挂载实时语音浮层和会话操作。 |
| `apps/ios/Sources/App/ComposerView.swift` | 增加独立的实时语音入口，不改变语音笔记语义。 |
| `apps/ios/Sources/App/AppStore.swift` | 对账 capability、会话状态和持久化语音回合。 |
| `apps/android/app/src/main/kotlin/com/openteam/features/LiveFeatureGateway.kt` | 通过现有 Android feature gateway 增加实时语音 API 调用。 |
| `apps/android/app/src/main/java/com/openteam/android/AppViewModel.kt` | 向 Android 聊天 UI 和生命周期暴露实时语音状态。 |
| `apps/android/app/src/main/java/com/openteam/android/MainActivity.kt` | 在实时会话需要时提供 Activity 生命周期和权限桥接。 |
| `apps/android/app/src/main/kotlin/com/openteam/platform/AndroidPlatformRuntime.kt` | 将生命周期/音频焦点回调连接到实时会话适配器。 |
| `mobile/shared/src/commonMain/kotlin/com/openteam/mobile/core/Models.kt` | 增加可序列化语音协议和会话模型。 |
| `mobile/shared/src/commonMain/kotlin/com/openteam/mobile/core/Transport.kt` | 增加 WebSocket 传输能力边界，不把共享代码绑定到单个平台。 |
| `mobile/shared/src/commonMain/kotlin/com/openteam/mobile/core/PlatformServices.kt` | 增加原生实时音频平台接口。 |

### 新增服务端和共享文件

| 文件 | 责任 |
| --- | --- |
| `packages/contracts/src/voice.ts` | 语音设置、capability、会话视图、控制联合类型、错误和协议常量。 |
| `apps/server/src/routes/voice.ts` | 认证语音 HTTP 路由和会话视图操作。 |
| `apps/server/src/services/voice-service.ts` | 会话创建、授权、回合接受、生命周期、限制和持久化对账。 |
| `apps/server/src/services/voice-session.ts` | WebSocket 票据、连接状态、控制分发和关闭行为。 |
| `apps/server/src/services/voice-media.ts` | 帧校验、背压、解码器/编码器生命周期和 PCM 流。 |
| `apps/server/src/services/voice-vad.ts` | 服务端 VAD 和回合检测状态机。 |
| `apps/server/src/services/voice-provider.ts` | Provider 无关的流式 STT/TTS 接口和适配器选择。 |
| `apps/server/src/services/voice-provider-registry.ts` | Provider 注册表、能力声明、适配器工厂和配置校验。 |
| `apps/server/src/services/voice-providers/volcengine.ts` | 火山引擎豆包语音 STT/TTS 双向 WebSocket 适配器。 |
| `apps/server/src/services/voice-providers/deepgram.ts` | Deepgram STT/TTS 流式 WebSocket 适配器。 |
| `apps/server/src/services/voice-reply.ts` | `VoiceReplySource`：按 `runId` 把 `SendToUser` 消息投递给活动会话，按 `sourceRunId` 补齐遗漏，以及语音文本规范化。 |
| `apps/server/src/services/voice-settings.ts` | 持久化设置、校验、脱敏视图和 Provider 检查。 |
| `apps/server/src/services/voice-decoder.ts` | 选定的 Opus 解码进程或进程内绑定，以及有界清理。 |
| `apps/server/src/services/voice-encoder.ts` | 规范 PCM 到 Opus 的输出编码器。 |
| `apps/server/test/voice-session.test.ts` | 票据、重连票据、授权、生命周期和协议测试。 |
| `apps/server/test/voice-media.test.ts` | 帧、`generation`、编解码、队列、按播放速度发送和解码器测试。 |
| `apps/server/test/voice-service.test.ts` | 幂等回合、抢话两步时序和持久化对账测试。 |
| `apps/server/test/voice-reply.test.ts` | `SendToUser` 投递、多消息顺序、遗漏补齐和文本规范化测试。 |
| `apps/server/test/voice-provider.test.ts` | Provider fixture、超时、取消和脱敏测试。 |
| `apps/server/test/voice-provider-volcengine.test.ts` | 火山引擎握手、消息编码/解析、部分/最终结果、音频输出和错误映射测试。 |
| `apps/server/test/voice-provider-deepgram.test.ts` | Deepgram 连接、消息编码/解析、部分/最终结果、音频输出和错误映射测试。 |
| `apps/worker/test/voice-prompt.test.ts` | 语音隐藏提示只出现在语音 run 中。 |
| `packages/db/prisma/migrations/<generated>_add_voice_sessions/migration.sql` | 由 schema 生成的增量数据库迁移。 |
| `mobile/shared/src/commonMain/kotlin/com/openteam/mobile/core/LiveVoice.kt` | 共享会话 reducer、命令、重连、序列和协议模型。 |
| `mobile/shared/src/commonTest/kotlin/com/openteam/mobile/core/LiveVoiceTests.kt` | 共享协议和状态机测试。 |

### 新增客户端文件

| 文件 | 责任 |
| --- | --- |
| `apps/desktop/src/renderer/hooks/use-live-voice.ts` | 桌面端实时语音会话的 React 生命周期桥接。 |
| `apps/desktop/src/renderer/lib/live-voice-transport.ts` | 桌面端 WebSocket、控制消息、Opus 帧和重连传输。 |
| `apps/desktop/src/renderer/lib/live-voice-audio.ts` | AudioWorklet/WASM 采集、编码、解码、播放和队列控制。 |
| `apps/desktop/src/renderer/components/openteam/live-voice/live-voice-layer.tsx` | 实时会话浮层和控制。 |
| `apps/desktop/src/renderer/components/openteam/live-voice/live-voice.css` | 实时语音视觉状态和无障碍布局。 |
| `apps/desktop/test/live-voice-protocol.test.ts` | 桌面端帧/控制消息单元测试。 |
| `apps/desktop/test/browser/live-voice.tsx` | 浏览器驱动的采集/播放/中断/重连 fixture。 |
| `apps/ios/Sources/Core/LiveVoiceSession.swift` | iOS 会话 reducer 和 WebSocket 协调。 |
| `apps/ios/Sources/Core/LiveVoiceAudio.swift` | AVAudioSession/AVAudioEngine 和原生编解码适配器。 |
| `apps/ios/Sources/App/LiveVoiceView.swift` | iOS 实时语音浮层和控制。 |
| `apps/ios/Tests/CoreTests/LiveVoiceSessionTests.swift` | iOS 状态、协议和中断测试。 |
| `apps/ios/Tests/UITests/LiveVoiceUITests.swift` | iOS UI 和无障碍检查。 |
| `apps/android/app/src/main/kotlin/com/openteam/platform/LiveVoiceAudio.kt` | AudioRecord/AudioTrack、音频焦点、路由和编解码适配器。 |
| `apps/android/app/src/main/kotlin/com/openteam/platform/LiveVoiceWebSocket.kt` | Android WebSocket 帧和传输适配器。 |
| `apps/android/app/src/main/kotlin/com/openteam/features/LiveVoiceView.kt` | Android 实时语音浮层。 |
| `apps/android/app/src/test/kotlin/com/openteam/android/LiveVoiceAudioTest.kt` | Android JVM 音频/会话适配器测试。 |
| `apps/android/app/src/androidTest/java/com/openteam/android/qa/LiveVoiceUiTest.kt` | Android 仪器 UI 和生命周期测试。 |

### 文档和部署文件

| 文件 | 计划变更 |
| --- | --- |
| `docs/configuration/voice-conversation.md` | 管理员配置、Provider 要求、限制、隐私和故障排查。 |
| `docs/config.json` | 注册新文档页面。 |
| `docs/overview/architecture.md` | 记录服务端语音处理链路和持久化边界。 |
| `docker/app.Dockerfile` | 增加生产媒体依赖和 readiness 检查输入。 |
| `deploy/compose.yaml` | 增加需要的环境变量、资源限制和健康配置。 |
| `scripts/check-voice-runtime.ts` | 验证解码器、支持的格式和 Provider 运行前提。 |
| `scripts/test-voice-session.ts` | 可复现的认证媒体链路和有界 soak 测试工具。 |

## 16. 风险和缓解措施

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| 各平台原生 Opus 编解码绑定不一致 | 无法稳定共享音频链路 | 将编解码封装在平台适配器后面；固定协议 fixture；尽早进行真机测试。Android 统一使用 libopus。 |
| 外放时 Bot 声音触发抢话 | 会话不断自我中断，无法使用 | 各平台强制启用系统 AEC，输入输出共用同一音频引擎；AEC 不可用时关闭播放期间的 VAD 抢话；每个平台做外放测试。 |
| 咳嗽或附和声中断回复 | 回复被无故取消 | 检测到语音时只停输出，不取消 run；只有新转写被接受后才由现有路径替代旧 run。 |
| `SendToUser` 整条生成后才朗读 | 首段音频延迟偏高 | 语音提示要求先发简短回复；阶段 0 测量后决定是否流式解析 `toolcall_delta`。 |
| 服务端解码进程泄漏或 CPU 占用过高 | 可用性和成本受影响 | 在测量后决定每会话一个有界媒体进程或进程内绑定；强制时长/队列限制，并保证父进程清理。 |
| Provider 的流式行为不同于批量 API | STT/TTS 需要大量返工 | 在客户端开发前完成 Provider 验证；保持 Provider 无关接口。 |
| 进程内投递遗漏 `SendToUser` 消息 | 部分回复没有朗读 | 持久化消息是权威结果；会话被唤醒时按 `sourceRunId` 补齐，并按 `messageId` 去重。 |
| 抢话与 run 完成之间存在竞争 | 可能产生重复或过时输出 | 使用回合状态 CAS、run ID 校验、输出 `generation` 和幂等取消。 |
| 移动端应用挂起导致长连接中断 | 用户体验差，会话可能悬挂 | 按生命周期策略显式结束或挂起；最终转写持久化后允许 run 在客户端离线时继续。 |
| 反向代理缓冲或超时 WebSocket | 生产环境会话失败 | 文档化升级/超时要求，并增加部署 smoke 测试。 |
| 音频和转写通过日志泄露 | 隐私与合规风险 | 使用脱敏结构化日志；不持久化原始音频；有界处理转写。 |
| 新数据库行持续增长 | 存储压力 | 使用 TTL/清理任务，删除已消费事件，并增加保留期测试。 |
