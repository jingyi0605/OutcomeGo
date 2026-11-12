# 任务清单：实时语音对话

状态：草案

日期：2026 年 11 月 6 日。

修订：2026 年 11 月 7 日。按评审结果调整阶段 0 验证项、帧格式、Agent 桥接任务和设备验证要求。

## 状态值

- `TODO`：未开始
- `IN_PROGRESS`：正在实施
- `BLOCKED`：被外部决策或依赖阻塞
- `IN_REVIEW`：实现已存在，等待评审
- `DONE`：实现和证据均已完成
- `CANCELLED`：已记录原因并有意移除

只有状态为 `DONE` 的任务才可以勾选完成。

## 完成规则

只有在实现、失败行为、生命周期行为、安全边界和验证证据都已具备时，任务才算完成。只有正常路径可用，但没有队列上限、清理逻辑或中断覆盖的实现，仍然是不完整的。

## 阶段 0：基线和 Provider 验证

- [ ] 0.1 固化语音产品基线
  - 状态：DONE
  - 任务说明：记录支持的 macOS、iOS 和 Android 版本、单 Bot 范围、会话时长、回合时长、发布人群，以及实时语音和语音笔记之间的区别。
  - 依赖：无
  - 主要文件：`requirements.md`、`design.md`
  - 完成条件：
    1. 产品范围和排除项已获批准。
    2. 能力和发布规则已记录。
    3. 现有语音笔记行为已列为回归要求。
  - 验证方式：规格文档评审。
  - 证据：2026 年 11 月 7 日已确认支持 macOS 桌面端、iOS 18+、Android API 26+，全量用户发布但默认关闭，单会话 30 分钟、单回合 60 秒；决策已记录在 `requirements.md` 和 `design.md`。

- [ ] 0.2 评估 Provider 兼容性
  - 状态：TODO
  - 任务说明：从服务端同时验证火山引擎豆包语音和 Deepgram 的流式 STT/TTS WebSocket，比较真实部分结果、最终结果、取消、流式输出、凭据和错误码。
  - 依赖：0.1
  - 主要文件：新的 Provider fixture、两个适配器验证脚本和 Provider 注册表。
  - 完成条件：
    1. 火山引擎和 Deepgram 都能提供流式 STT 和流式 TTS。
    2. Provider 取消操作能在目标时间内响应抢话。
    3. Provider 的字节数、时长、并发数和成本行为已记录。
    4. Provider 不要求客户端持有凭据。
    5. 两个 Provider 的认证字段、资源 ID或项目配置、模型、声音和音频格式映射已记录。
    6. TTS 流式接口在调用方暂停读取时的背压行为已记录。
  - 验证方式：使用一次性测试账号进行服务端验证，并使用模拟 Provider 完成离线协议测试。

- [ ] 0.2a 测量 `SendToUser` 驱动的首段音频延迟
  - 状态：TODO
  - 任务说明：在真实 Bot 上测量用户停止说话到首条 `SendToUser` 回复持久化、再到首段 TTS 音频的延迟；比较有无“先发简短回复”语音提示的差异；估算流式解析 `toolcall_delta` 能节省的时间和改造范围（computer 工具参数转发、部分 JSON 解析）。
  - 依赖：0.1
  - 主要文件：`apps/computer/src/runtime/events.ts`、`apps/computer/src/runtime/tools.ts`、`apps/server/src/services/internal-tool-service.ts`
  - 完成条件：
    1. 记录不调用工具时的 p50/p95 延迟。
    2. 记录语音提示对首条回复长度和延迟的影响。
    3. 形成是否在第一版之后实现工具参数流式朗读的书面决定。
  - 验证方式：十回合有界测量脚本和记录报告。

- [ ] 0.3 选择并测量编解码链路
  - 状态：IN_PROGRESS
  - 任务说明：比较进程内 Opus 绑定和受限 FFmpeg 媒体 Worker 在服务端解码/编码方面的表现，并测量 CPU、启动、清理和输出兼容性。同时验证客户端编解码路径：Electron 当前版本的 WebCodecs Opus、iOS `AVAudioConverter` Opus、Android libopus JNI 打包（覆盖 API 26–28）。
  - 依赖：0.1
  - 主要文件：`apps/server/src/services/voice-decoder.ts`、`apps/server/src/services/voice-encoder.ts`、`docker/app.Dockerfile`
  - 完成条件：
    1. 固定标准输入和输出采样率。
    2. 证明解码器和编码器在正常关闭及崩溃后都能清理。
    3. 记录生产镜像打包方式。
    4. 记录三个客户端的编解码选型，以及 Android 各 ABI 的 APK 体积增量。
  - 验证方式：十分钟有界媒体压力测试、进程清理审计和三端编解码 fixture 往返测试。
  - 进展证据：服务端 60 秒 Opus 往返基准已完成。进程内 libopus 为约 0.25 秒 user CPU、1.7 MB 峰值 RSS；FFmpeg 编码约 0.20 秒、解码约 0.07 秒 user CPU，各进程约 15.9 MB 峰值 RSS，冷启动 20 次 p50 约 19.9 ms。两者在强制终止后均无遗留子进程。已增加 `native-opus.ts` 的 Bun FFI 绑定，并通过真实 `libopus` fixture 往返测试。Electron 43.4.1 的 Chromium 150.0.7871.224 中 `AudioEncoder`/`AudioDecoder` 未定义，桌面端现改用内联 WASM `libopus-wasm` 原始包编解码；Android debug APK 已包含 arm64-v8a、armeabi-v7a 和 x86_64 的 JNI libopus；iOS 18 SDK 可类型检查 `AVAudioConverter` PCM↔Opus，iOS 真机验证仍未完成。

- [ ] 0.3a 验证各平台回声消除
  - 状态：TODO
  - 任务说明：在 macOS（Chromium `echoCancellation` + 同 renderer `AudioContext` 播放）、iPhone（`setVoiceProcessingEnabled`）和 Xiaomi Android（`VOICE_COMMUNICATION` + `AcousticEchoCanceler`）上，外放播放 30 秒语音，同时运行服务端 VAD，统计误触发次数。
  - 依赖：0.1
  - 完成条件：
    1. 三个平台外放时误触发次数均为 0，或记录无法满足的设备并采用“播放期间关闭 VAD 抢话”回退。
    2. 记录每个平台 AEC 启用所需的音频会话配置。
  - 验证方式：带录音电平日志的设备测试报告。

- [ ] 0.4 检查点：批准 Provider 和编解码方案
  - 状态：TODO
  - 任务说明：在客户端实现开始前，冻结 Provider 适配器和编解码假设。
  - 依赖：0.2、0.2a、0.3、0.3a
  - 完成条件：
    1. Provider 适配器契约稳定。
    2. 传输协议值稳定。
    3. 剩余风险均有负责人和明确的接受标准。
  - 验证方式：设计评审。

## 阶段 1：契约、数据库结构和服务端会话边界

- [ ] 1.1 增加语音契约和协议常量
  - 状态：DONE
  - 任务说明：增加 `packages/contracts/src/voice.ts`、导出项、控制消息联合类型（含 `reply.message`、带 `generation` 的 `audio.started`/`audio.stopped`、`playback.ack`）、18 字节帧常量、能力值、设置视图和稳定错误码。不修改 `RuntimeRequestSource`。
  - 依赖：0.4
  - 文件：`packages/contracts/src/voice.ts`、`packages/contracts/src/service-protocol.ts`、`packages/contracts/package.json`、`packages/contracts/src/index.ts`
  - 完成条件：
    1. JSON 控制消息可以往返序列化和解析。
    2. 必填字段和最大尺寸得到校验。
    3. 协议版本和编解码协商是显式的。
  - 验证方式：`packages/contracts` 单元测试和类型检查。
  - 证据：新增 `packages/contracts/src/voice.ts`、导出项、18 字节帧编解码器和控制模型；`bun --filter @openteam/contracts typecheck` 与 `bun test packages/contracts/test/voice.test.ts` 通过。

- [ ] 1.2 增加增量持久化模型和迁移
  - 状态：IN_PROGRESS
  - 任务说明：增加 `VoiceSession` 和 `VoiceTurn`（含 `assistantMessageIds` 和 `runId` 索引），以及清理字段和生成的数据库迁移。不增加 Worker 事件表；控制序列号和播放位置不入库。
  - 依赖：1.1
  - 文件：`packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/<generated>_add_voice_sessions/migration.sql`
  - 完成条件：
    1. 迁移可以应用到一次性 PostgreSQL 数据库。
    2. `(sessionId, sequence)` 唯一约束有效。
    3. 清理查询使用索引。
    4. 删除语音记录不会删除 channel message 或 run。
  - 验证方式：一次性数据库迁移和并发测试。
  - 进展证据：已增加 `VoiceSession`、`VoiceTurn` Prisma 模型、索引、关联和增量 SQL；`bun --filter @openteam/db db:generate` 与 `bun --filter @openteam/db typecheck` 通过。一次性 PostgreSQL 迁移和并发验证尚未运行。

- [ ] 1.3 实现会话创建和脱敏视图
  - 状态：IN_PROGRESS
  - 任务说明：实现会话创建、Bot/channel 授权、功能能力检查、租约过期、平台校验和禁止缓存响应。
  - 依赖：1.2
  - 文件：`apps/server/src/routes/voice.ts`、`apps/server/src/services/voice-service.ts`、`apps/server/src/services/voice-settings.ts`
  - 完成条件：
    1. 未授权用户无法创建或查看会话。
    2. 会话绑定到一个 Bot、一个 conversation、一个 channel 和一个所有者客户端会话。
    3. Provider 密钥不会出现在视图中。
  - 验证方式：路由和授权测试。
  - 进展证据：已增加 `voice-service.ts`、`voice-settings.ts` 和认证路由，票据响应不返回 Provider 密钥；授权/并发/过期路由测试仍需补齐。

- [ ] 1.4 实现一次性 WebSocket 票据和分发
  - 状态：IN_PROGRESS
  - 任务说明：在 VNC 和浏览器网络协议旁边增加带标签的 WebSocket 分发，不改变现有任一协议。增加 `POST /api/v0/voice/sessions/:sessionId/tickets` 重连票据路由。
  - 依赖：1.3
  - 文件：`apps/server/src/main.ts`、`apps/server/src/services/voice-session.ts`
  - 完成条件：
    1. 票据重放和过期使用都会失败。
    2. Origin 和会话绑定得到强制校验。
    3. 注销和 Bot 归档会关闭活动会话。
    4. 重连票据作废旧票据；新连接成功后旧连接被关闭；终态会话无法申请票据。
    5. VNC 和浏览器网络测试继续通过。
  - 验证方式：协议、竞态、注销和回归测试。
  - 进展证据：已接入 Bun 分发、一次性票据消费、Origin 校验、旧连接关闭和协议选择；竞态及 VNC/browser-network 回归测试尚未补齐。

## 阶段 2：媒体协议和服务端处理链路

- [ ] 2.1 实现二进制帧解析和背压
  - 状态：IN_PROGRESS
  - 任务说明：解析 18 字节 Opus 帧头（含 `generation`），校验序列号和负载上限（1500 字节）。输入侧溢出时关闭会话；输出侧按播放速度发送，按 `playback.ack` 推进领先窗口，缓冲满时暂停读取 TTS，只有客户端长时间不确认播放才关闭。
  - 依赖：1.4
  - 文件：`apps/server/src/services/voice-media.ts`、`packages/contracts/src/voice.ts`
  - 完成条件：
    1. 有效帧可以解析为有界数据包对象。
    2. 无效帧不会进入解码器。
    3. 队列具有明确的内存和时长上限。
    4. 模拟 TTS 以 5 倍实时速度产生音频时，服务端按播放速度发送且不关闭会话。
    5. 客户端停止 `playback.ack` 超过阈值时，以 `1013` 关闭。
  - 验证方式：基于属性的帧测试、快速 TTS 模拟和慢速读取端测试。
  - 进展证据：已实现帧校验、generation、输出队列上限和 playback ack；输出发送按 playback ack 维持最多 1,000 ms 领先，TTS 读取在队列满时等待。`voice-media.test.ts` 通过，属性测试及真实 WebSocket 背压测试尚未补齐。

- [ ] 2.2 实现服务端解码器和编码器
  - 状态：IN_PROGRESS
  - 任务说明：将客户端 Opus 解码为单声道 PCM16，重采样到 STT/VAD 采样率，将输出 PCM 编码为协商后的 Opus，并在所有退出路径上清理资源。
  - 依赖：0.3、2.1
  - 文件：`apps/server/src/services/voice-decoder.ts`、`apps/server/src/services/voice-encoder.ts`、`docker/app.Dockerfile`、`scripts/check-voice-runtime.ts`
  - 完成条件：
    1. fixture 音频可以往返处理，失真在有界范围内。
    2. 解码进程随会话结束而退出。
    3. 缺少运行时依赖时，准备状态检查能清晰失败。
  - 验证方式：编解码 fixture、CPU/内存压力测试和生产镜像检查。
  - 进展证据：已建立 `OpusCodec`、decoder/encoder 生命周期边界；服务端会话使用 48 kHz 输入解码和 24 kHz 输出编码，桌面端使用 WASM 原始 Opus 往返。生产运行时绑定、十分钟压力测试和镜像依赖尚未完成。

- [ ] 2.3 实现 VAD 和回合检测器
  - 状态：IN_PROGRESS
  - 任务说明：基于标准化 PCM 增加开始说话、静音结束、最大时长和抢话检测。
  - 依赖：2.2
  - 文件：`apps/server/src/services/voice-vad.ts`、`apps/server/test/voice-media.test.ts`
  - 完成条件：
    1. 合成的语音/静音 fixture 产生确定性的状态转换。
    2. 抢话递增 `generation`，旧代次的输出帧不再发送。
    3. 客户端声明 `echoCancellation: false` 时，播放期间不触发抢话。
    4. 静音和时长限制可配置，但始终有上限。
  - 验证方式：确定性状态测试和延迟测试。
  - 进展证据：已增加有界阈值、静音、最大回合时长和 AEC 回退的 `VoiceVad`；确定性基础测试通过，端到端延迟测试尚未完成。

- [ ] 2.4 实现与 Provider 无关的流式 STT/TTS 适配器
  - 状态：IN_PROGRESS
  - 任务说明：增加 Provider 无关的流式 STT/TTS 接口、能力声明、注册表、火山引擎适配器、Deepgram 适配器、超时、取消、响应限制和脱敏错误映射。
  - 依赖：0.2、2.2、2.3
  - 文件：`apps/server/src/services/voice-provider.ts`、`apps/server/src/services/voice-provider-registry.ts`、`apps/server/src/services/voice-providers/volcengine.ts`、`apps/server/src/services/voice-providers/deepgram.ts`、`apps/server/src/services/voice-settings.ts`、`apps/server/test/voice-provider.test.ts`、`apps/server/test/voice-provider-volcengine.test.ts`、`apps/server/test/voice-provider-deepgram.test.ts`
  - 完成条件：
    1. 部分/最终 STT 事件统一为一个 OpenTeam 数据结构。
    2. TTS 输出按增量到达，并在调用方暂停消费时停止读取 Provider 流。
    3. 抢话时取消可以停止 Provider 工作。
    4. Provider 密钥和内容不会进入日志。
    5. 配置界面可以选择火山引擎或 Deepgram，并分别显示连接检查和能力状态。
    6. 增加 Provider 只需新增适配器和注册信息，不需要修改会话状态机或客户端协议。
    7. Provider 专用的 WebSocket 消息和鉴权字段不会泄漏到通用接口。
  - 验证方式：模拟 Provider、实时兼容性检查和超时测试。
  - 进展证据：已增加 Provider 接口、注册表、确定性测试 fixture、Deepgram 流式 STT/TTS 和 Volcengine 二进制 WebSocket STT/TTS 适配器，统一事件已接入会话状态机；真实账号验证、认证握手、取消和背压测试尚未完成。

- [ ] 2.5 将媒体处理链路接入会话状态机
  - 状态：IN_PROGRESS
  - 任务说明：将帧依次送入解码、VAD、STT 和 TTS，并向一个客户端发布控制/音频事件。
  - 依赖：2.1、2.3、2.4
  - 文件：`apps/server/src/services/voice-session.ts`、`apps/server/src/services/voice-media.ts`、`apps/server/test/voice-session.test.ts`
  - 完成条件：
    1. 合成客户端可以完成 listening/processing/speaking 周期。
    2. 停止、取消、超时、Provider 失败和断开连接都会释放所有资源。
    3. 不持久化任何音频。
  - 验证方式：进程内模拟客户端和服务端集成测试。
  - 进展证据：会话 WebSocket 已接入控制序列、输入 Opus 解码、48→16 kHz PCM、VAD、STT 最终转写、Agent 消息路径、SendToUser 回复、TTS、24 kHz Opus 输出、播放确认和资源关闭；确定性测试 fixture 单测通过，真实 WebSocket 集成测试尚未完成。

## 阶段 3：持久化 Agent 桥接和实时输出

- [ ] 3.1 通过现有消息路径接收语音回合
  - 状态：IN_PROGRESS
  - 任务说明：让最终转写以 `voice:<sessionId>:<turnId>` 作为 `clientId`，通过现有直接消息路径幂等创建 channel message 和带 `metadata.voice` 的 run。
  - 依赖：1.2、2.5
  - 文件：`apps/server/src/services/voice-service.ts`、`apps/server/src/services/channel-service.ts`、`packages/contracts/src/index.ts`
  - 完成条件：
    1. 一个语音回合最多创建一个用户消息和一个 run。
    2. 现有投递查询可以找到结果。
    3. 现有文本消息行为不变。
  - 验证方式：重复提交、重试和持久化消息集成测试。
  - 进展证据：`VoiceService.acceptTranscript` 使用 `voice:<sessionId>:<turnId>` 幂等键并通过现有 direct message 路径写入 `metadata.voice`；数据库重复提交集成测试尚未完成。

- [ ] 3.2 增加 Worker 语音隐藏提示
  - 状态：IN_PROGRESS
  - 任务说明：触发消息带 `metadata.voice` 时，Worker 在 `prependMessages` 中追加 `[SAND_HIDDEN_PROMPT]` 语音提示（简短、适合朗读、先发简短回复、不用表格和代码块）。run 仍为 `origin: "user"`、`requestSource: "turn"`。
  - 依赖：3.1、0.2a
  - 文件：`apps/worker/src/worker.ts`、`apps/worker/test/voice-prompt.test.ts`
  - 完成条件：
    1. 语音 run 的 turn 请求包含提示，提示不进入聊天历史。
    2. 非语音 run 的 turn 请求逐字节不变。
    3. 回复提醒（`isDeliveryOwed`、`communicationReminder`）对语音 run 仍然生效。
  - 验证方式：Worker 单元测试和 turn 请求快照对比。
  - 进展证据：Worker 已按 `channelId + clientId` 读取触发消息 metadata，语音 run 才追加隐藏提示；基础 prompt 测试与全仓 typecheck 通过，turn 快照和 delivery reminder 对比尚未完成。

- [ ] 3.3 实现 `VoiceReplySource` 和语音文本规范化
  - 状态：IN_PROGRESS
  - 任务说明：`SendToUser` 的 `sendVisible` 成功后，按 `runId` 查找本进程活动语音回合并投递消息；会话被 `EventWakeup` 唤醒或回合结算时，按 `sourceRunId` 补齐遗漏；实现 Markdown、代码块和 URL 规范化；附件和外部 Connector 消息按规则处理。
  - 依赖：1.2、2.5、3.1
  - 文件：`apps/server/src/services/voice-reply.ts`、`apps/server/src/services/internal-tool-service.ts`、`apps/server/test/voice-reply.test.ts`
  - 完成条件：
    1. 同一 run 的多条消息按 `ChannelMessage.sequence` 顺序朗读，并全部记录到 `assistantMessageIds`。
    2. 进程内投递失败或遗漏时，补齐查询找回消息且不重复朗读。
    3. 投递失败不改变 `SendToUser` 工具结果。
    4. 没有活动语音回合的 run 不产生任何额外查询以外的副作用。
    5. 规范化只影响朗读文本，聊天历史保留原文。
  - 验证方式：多消息、投递遗漏、附件、外部 Connector 和规范化 fixture 测试。
  - 进展证据：已接入 `SendToUser` 持久化后的进程内回调、按 sourceRunId 对账和 Markdown/URL/代码块规范化；多消息遗漏、附件和 Connector 测试尚未完成。

- [ ] 3.4 实现两步抢话和显式停止
  - 状态：IN_PROGRESS
  - 任务说明：检测到语音时只停输出、递增 `generation`、把回合标记为 `output_paused`；新转写被接受后由现有 `interruptRunId` → `interruptRun(runId, true)` 路径替代旧 run；无效转写时旧 run 继续，后续回复只展示不朗读；`cancel_turn`/`stop` 走 `RunService.cancel` 的 `stop` 原因。
  - 依赖：2.3、3.1、3.3
  - 文件：`apps/server/src/services/voice-service.ts`、`apps/server/src/services/voice-session.ts`
  - 完成条件：
    1. 新回合开始后不会播放旧音频。
    2. 咳嗽或附和声不会取消 run。
    3. 已完成的 run 不会被错误取消。
    4. 被替代或停止的 run 具有准确终态，不新增 computer 取消原因。
  - 验证方式：完成、替代、无效转写、显式停止和 VAD 事件之间的竞态测试。
  - 进展证据：输出 generation 停止、explicit stop 和 existing run cancel 边界已建立；完整竞态测试尚未完成。

## 阶段 4：macOS 桌面端

- [ ] 4.1 增加桌面端 API 和 WebSocket 会话客户端
  - 状态：IN_PROGRESS
  - 任务说明：增加能力/会话请求、票据协议选择、控制消息顺序、二进制帧传输、重连和清理。
  - 依赖：2.5、3.4
  - 文件：`apps/desktop/src/renderer/client/openteam-api.ts`、`apps/desktop/src/renderer/lib/live-voice-transport.ts`、`apps/desktop/src/renderer/hooks/use-live-voice.ts`
  - 完成条件：
    1. Bearer Token 不会出现在 WebSocket URL 中。
    2. 授权失败和终态会停止重连。
    3. `reply.message` 按 `messageId` 与持久化消息完成对账。
    4. 重连前通过票据路由申请新票据。
    5. 抢话后丢弃旧 `generation` 的在途帧。
  - 验证方式：传输单元测试和模拟服务端集成测试。
  - 进展证据：已增加桌面端能力入口、HTTP ticket API、hello/client_ready 握手、二进制帧传输、generation 过滤、WASM Opus 编解码、播放确认回调和清理；同一 Electron 客户端根据 `window.outcomego.platform` 将 Windows 标识为 `clientPlatform: "windows"`，macOS 保持 `"macos"`。传输单元测试和重连测试尚未完成。

- [ ] 4.2 增加桌面端音频采集、编解码和播放
  - 状态：IN_PROGRESS
  - 任务说明：使用 0.3 选定的编解码器（优先 WebCodecs Opus）和 AudioWorklet 实现采集/输出。采集启用 `echoCancellation`、`noiseSuppression`、`autoGainControl`；播放必须走同一 renderer 的 `AudioContext`，使 Chromium AEC 生效。
  - 依赖：0.3、4.1
  - 文件：`apps/desktop/src/renderer/lib/live-voice-audio.ts`、生成的 AudioWorklet/WASM 资源（如有）
  - 完成条件：
    1. 会话活动期间，真实麦克风帧可以到达服务端。
    2. 服务端输出经过有界抖动缓冲后可以听见。
    3. 停止以及页面/窗口清理会释放音轨和音频上下文。
    4. 外放播放 30 秒期间不误触发抢话。
  - 验证方式：macOS 浏览器驱动的音频 fixture、设备冒烟测试和外放测试。
  - 进展证据：已增加同一 renderer 的麦克风/AEC/AudioContext 生命周期适配器、AudioWorklet/ScriptProcessor fallback、WASM 原始 Opus 编解码、20 ms 帧缓冲、输出抖动调度和 playback ack；真实音频 fixture、外放 AEC 和设备冒烟测试尚未完成。

- [ ] 4.3 增加桌面端实时语音界面
  - 状态：IN_PROGRESS
  - 任务说明：增加明确的实时语音入口和覆盖层，展示 listening、转写、speaking、中断、重连和错误状态。
  - 依赖：4.1、4.2
  - 文件：`apps/desktop/src/renderer/components/openteam/live-voice/live-voice-layer.tsx`、`live-voice.css`、`apps/desktop/src/renderer/components/openteam/chat-pane.tsx`
  - 完成条件：
    1. 语音笔记和实时语音在界面上有明显区别。
    2. 键盘和无障碍控制可以停止/中断会话。
    3. 部分输出不会插入持久化编辑器。
  - 验证方式：浏览器界面断言和无障碍评审。
  - 进展证据：已在 bot DM composer dock 增加独立实时语音入口；已增加 dsh 风格的全屏覆盖层、Bot 头像焦点、实时字幕（含 partial/final/reply）、状态点、计时器、圆形麦克风/扬声器/结束控件、最小化悬浮条和错误重试入口。`bun --filter @openteam/desktop typecheck` 与 `bun --filter @openteam/desktop test`（514 pass、1 skip）通过；浏览器无障碍断言和真实音频回放验证尚未完成。

- [ ] 4.4 检查点：macOS 端到端语音链路
  - 状态：TODO
  - 任务说明：在开始原生移动端实现前，证明 macOS 可以完成十个真实回合、一次中断、一次无效转写不取消回复、一次重连、外放无误触发，以及朗读内容与持久化历史一致。
  - 依赖：4.1、4.2、4.3
  - 验证方式：`scripts/test-voice-session.ts` 和带记录的 QA 报告。

## 阶段 5：移动端共享核心和 iOS

- [ ] 5.1 增加共享 KMP 语音协议和状态归约器
  - 状态：IN_PROGRESS
  - 任务说明：增加公共模型、控制消息顺序、重连策略、会话归约器和平台音频接口。
  - 依赖：1.1、4.4
  - 文件：`mobile/shared/src/commonMain/kotlin/com/openteam/mobile/core/LiveVoice.kt`、`Models.kt`、`Transport.kt`、`PlatformServices.kt`、`mobile/shared/src/commonTest/kotlin/com/openteam/mobile/core/LiveVoiceTests.kt`
  - 完成条件：
    1. 公共代码可以为 Android 和 iOS 编译。
    2. 归约器行为与服务端状态机一致。
    3. 调试描述中不包含令牌和音频字节。
  - 验证方式：KMP 公共测试和 Android/iOS framework 构建。
  - 进展证据：已增加共享帧编解码、控制消息、reducer、AEC/generation 状态和平台音频接口及测试；Android Debug 编译会编译共享核心。完整 KMP `allTests` 和 iOS framework 构建尚未运行。

- [ ] 5.2 实现 iOS 实时音频和 WebSocket 适配器
  - 状态：IN_PROGRESS
  - 任务说明：增加 AVAudioSession（`.playAndRecord` + `.voiceChat`）和单一 AVAudioEngine 采集/播放，在 inputNode 上启用 `setVoiceProcessingEnabled(true)`；使用 0.3 选定的 Opus 编解码；处理路由/中断；实现 WebSocket 传输和重连票据。
  - 依赖：5.1
  - 文件：`apps/ios/Sources/Core/LiveVoiceSession.swift`、`apps/ios/Sources/Core/LiveVoiceAudio.swift`
  - 完成条件：
    1. 会话关闭后恢复原有音频 category/mode。
    2. 处理电话、蓝牙、路由变化和媒体服务重置。
    3. 抢话时及时停止播放，并丢弃旧 `generation` 帧。
    4. 外放播放 30 秒期间不误触发抢话。
  - 验证方式：Core 测试、模拟器协议测试、实体 iPhone 冒烟测试和外放测试。
  - 进展证据：已增加 iOS session/reducer、短期票据 WebSocket、48 kHz 输入 Opus 编码、24 kHz 输出 Opus 解码/播放、实际播放完成后的 `playback.ack`、`ready` 握手后的采集、generation 过滤、音频 category 恢复、中断/路由/媒体服务重置处理。Xcode 26.2 的 iPhoneOS SDK 对全部 `Sources/Core` 的 arm64 iOS typecheck 已通过；`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --package-path apps/ios` 通过 216 项测试。Xcode 项目构建因本机没有安装 iOS 26.2 runtime/destination 无法启动，实体 iPhone 验证尚未完成。

- [ ] 5.3 增加 iOS 实时语音界面和对账
  - 状态：IN_PROGRESS
  - 任务说明：增加实时语音覆盖层，并与 `VoiceMemoController` 分开提供入口。
  - 依赖：5.2
  - 文件：`apps/ios/Sources/App/LiveVoiceView.swift`、`ChatView.swift`、`ComposerView.swift`、`AppStore.swift`
  - 完成条件：
    1. 现有语音笔记手势和测试保持不变。
    2. 实时状态具有 VoiceOver 标签以及停止/中断操作。
    3. 输出中断后，持久化消息仍能完成对账。
  - 验证方式：`LiveVoiceUITests.swift` 和现有语音笔记界面测试套件。
  - 进展证据：已增加独立 `LiveVoiceView`，复用 BotGlyph，提供全屏通话卡片、头像光环、计时器、字幕、listening/thinking/speaking 状态、麦克风/扬声器/结束控件和可恢复的最小化胶囊；Bot 会话 composer 拨号按钮、VoiceOver 标签，以及独立 realtime voice settings/profile voice 字段仍与 `VoiceMemoController` 分离。Swift app 文件已通过语法检查；app-target UI 编译和设备 UI 测试因本机没有可用 iOS destination/runtime 尚未完成。

## 阶段 6：Android

- [ ] 6.1 实现 Android WebSocket 和原生音频适配器
  - 状态：IN_PROGRESS
  - 任务说明：增加 AudioRecord（`VOICE_COMMUNICATION`）/AudioTrack（`USAGE_VOICE_COMMUNICATION`）、`MODE_IN_COMMUNICATION`、`AcousticEchoCanceler`、libopus JNI 编解码（覆盖 API 26 及以上）、音频焦点、路由处理、WebSocket 分帧和重连票据。
  - 依赖：5.1
  - 文件：`apps/android/app/src/main/kotlin/com/openteam/platform/LiveVoiceAudio.kt`、`LiveVoiceWebSocket.kt`、`AndroidPlatformRuntime.kt`
  - 完成条件：
    1. 按策略处理音频焦点丢失时暂停或结束会话。
    2. 蓝牙和有线设备路由变化不会破坏队列。
    3. 停止、错误和生命周期丢失后，所有原生资源都能关闭。
    4. Xiaomi 实体设备外放播放 30 秒期间不误触发抢话；AEC 不可用时声明 `echoCancellation: false`。
    5. debug APK 通过 `bash scripts/android/package-debug.sh` 构建，包含所需 ABI 的 libopus。
  - 验证方式：JVM 模拟对象、instrumented 生命周期测试和 Xiaomi 实体设备测试。
  - 进展证据：已增加 AudioRecord/AudioTrack、`VOICE_COMMUNICATION`、`MODE_IN_COMMUNICATION`、`AcousticEchoCanceler` capability、JNI libopus bridge、等待服务端 `ready` 后采集、generation 过滤、播放时钟驱动的 `playback.ack` 和清理；realtime voice 现在由 microphone foreground service 持有，带 ongoing call notification、partial wake lock，并支持导航离开、后台和熄屏期间继续运行。`bash scripts/android/package-debug.sh` 通过，APK 为 `/Users/jackson/Code/openteam/apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`，SHA-256 为 `769721cc15b9420f194e48f9c6f6108fa2cf3fd5854f3bcd920602c0dcff8f5c`，包含 `arm64-v8a`、`armeabi-v7a` 和 `x86_64` 的 libopus。`bash scripts/android/qa.sh unit` 通过；connected instrumented 测试、Xiaomi 实体设备测试和音频焦点/路由专门验证尚未完成。

- [ ] 6.2 增加 Android API 网关和实时语音界面
  - 状态：IN_PROGRESS
  - 任务说明：增加会话 API 请求和与当前聊天界面集成的 Compose 覆盖层。
  - 依赖：6.1
  - 文件：`apps/android/app/src/main/kotlin/com/openteam/features/LiveFeatureGateway.kt`、`apps/android/app/src/main/java/com/openteam/android/AppViewModel.kt`、`apps/android/app/src/main/java/com/openteam/android/MainActivity.kt`、`apps/android/app/src/main/kotlin/com/openteam/features/LiveVoiceView.kt`
  - 完成条件：
    1. 旧服务端不具备能力时隐藏实时语音入口。
    2. 界面展示 listening、speaking、中断、重连和错误状态。
    3. 现有语音笔记入口保持不变。
  - 验证方式：JVM 测试和 Compose instrumented 测试。
  - 进展证据：已增加独立 Compose `LiveVoiceView` 和状态 test tags，并将 voice settings gateway、ViewModel 状态、Settings 导航、ChatScreen composer 拨号按钮和 session/audio lifecycle 接入 Android；全屏 Dialog 现在使用 edge-to-edge call surface，底部控制避开导航区域，顶部折叠按钮匹配 macOS 的收起语义，并提供字幕、计时器、静音、扬声器、结束和可拖动的 app-level 浮动最小化胶囊。浮动胶囊不再属于对话时间线，切换对话或返回目录时仍保留。`bash scripts/android/qa.sh unit` 通过，connected instrumented 测试和 Xiaomi 实体设备测试尚未完成。

## 阶段 7：设置、能力、文档和发布

- [ ] 7.1 增加服务端设置和 Provider 检查
  - 状态：IN_PROGRESS
  - 任务说明：增加脱敏的语音设置、Provider 注册表能力输出、火山引擎和 Deepgram 的独立连接检查、Provider 选择和安全默认值。
  - 依赖：2.4
  - 文件：`apps/server/src/services/voice-settings.ts`、`apps/server/src/routes/voice.ts`，以及需要增加的桌面端/iOS/Android 设置界面。
  - 完成条件：
    1. 对现有安装默认关闭实时语音，除非发布决策明确启用。
    2. Provider 密钥只能写入，读取时必须脱敏。
    3. 检查响应区分就绪、未验证和不可用。
    4. `volcengine` 和 `deepgram` 的 STT/TTS 能力、凭据、模型、声音和端点配置可以独立检查。
    5. 配置界面可以保存两个 Provider 的独立配置，并选择新会话的默认 Provider。
    6. 已创建会话保存 Provider 快照，切换默认 Provider 不会改变活动会话。
  - 验证方式：服务端和界面设置测试。
  - 进展证据：已将实时语音配置从环境变量迁移到数据库持久化的服务端设置；Provider 密钥使用基于 `OPENTEAM_AUTH_SECRET` 的 AES-256-GCM 加密，响应只返回配置状态和末四位；macOS 设置面板和 Android Compose 设置页均可配置启用状态、默认 Provider、Volcengine/Deepgram 密钥、端点、资源 ID、模型、声音和语言。Bot profile 现在可以保存独立的 Provider voice/speaker ID，空值继承服务器默认声音；创建 VoiceSession 时保存有效 voice 快照，活动会话不会随 Bot profile 改动。Volcengine 使用 speaker，Deepgram 使用非默认 bot voice 作为 TTS model 覆盖。服务端语音设置测试 2 项、全量 TypeScript 类型检查和 Android debug 打包已通过。Provider 实际连接检查、旧服务端能力隐藏测试和界面自动化测试仍未完成。

- [ ] 7.2 增加部署/运行时检查
  - 状态：IN_PROGRESS
  - 任务说明：打包解码依赖，增加资源限制和健康/准备状态检查，并记录反向代理 WebSocket 设置。
  - 依赖：0.3、7.1
  - 文件：`docker/app.Dockerfile`、`deploy/compose.yaml`、`scripts/check-voice-runtime.ts`
  - 完成条件：
    1. 禁用语音时 compose 可以正常启动。
    2. 启用语音时，只有解码器和 Provider 配置有效才可以启动。
    3. 服务端重启会清理遗留会话和事件记录。
  - 验证方式：隔离的 compose 冒烟测试和重启测试。
  - 进展证据：生产 server 镜像已加入 `libopus0` 运行时依赖；compose 启动、readiness 和重启清理测试尚未完成。

- [ ] 7.3 编写管理、隐私和故障排查文档
  - 状态：TODO
  - 任务说明：说明安装配置、Provider 要求、配额、客户端权限、生命周期行为和已知限制。
  - 依赖：7.1
  - 文件：`docs/configuration/voice-conversation.md`、`docs/config.json`、`docs/overview/architecture.md`
  - 完成条件：
    1. 文档区分实时语音和语音笔记。
    2. 明确说明服务端媒体处理和隐私行为。
    3. 对常见连接、编解码、Provider 和权限失败提供可执行的排查指引。
  - 验证方式：文档构建/链接检查。

## 阶段 8：安全、性能和发布验证

- [ ] 8.1 执行安全和滥用检查
  - 状态：TODO
  - 任务说明：覆盖票据重放、重连票据滥用、Origin 不匹配、会话绑定、注销、归档、超大帧、队列耗尽、Provider 错误、转写泄漏、外部 Connector 消息不被朗读和账号隔离。
  - 依赖：3.4、4.4、5.3、6.2
  - 验证方式：聚焦的服务端/客户端安全测试套件。

- [ ] 8.2 执行延迟和资源基准测试
  - 状态：TODO
  - 任务说明：测量单个、多个和达到配额上限的会话在延迟目标和资源成本方面的表现。
  - 依赖：4.4、5.3、6.2、7.2
  - 验证方式：有界十回合和并发会话基准测试，提供 CPU、内存、队列、Provider 和延迟证据。

- [ ] 8.3 执行回归测试套件
  - 状态：TODO
  - 任务说明：运行服务端、Worker、contracts、桌面端、KMP、iOS、Android、打包和现有语音笔记检查。
  - 依赖：8.1、8.2
  - 验证方式：
    - `bun run typecheck`
    - 聚焦的服务端/Worker/contracts/桌面端测试
    - `./gradlew :mobile:shared:allTests :mobile:shared:assemble`
    - iOS package/Core/UI 检查
    - 通过 `bash scripts/android/package-debug.sh` 执行 Android debug 打包
    - 现有语音笔记浏览器/iOS/Android 检查

- [ ] 8.4 检查点：生产就绪决策
  - 状态：TODO
  - 任务说明：评审证据、未解决风险、发布开关、支持文档和回滚路径。
  - 依赖：8.1、8.2、8.3
  - 完成条件：
    1. 所有发布门槛要求都有证据。
    2. 剩余限制已记录并获接受。
    3. 可以仅通过服务端关闭功能，而无需回滚数据库。
  - 验证方式：发布评审。
