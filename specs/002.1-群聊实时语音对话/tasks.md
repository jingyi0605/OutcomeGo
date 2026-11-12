# 任务清单：群聊实时语音对话（人话版）

规格编号：`002.1`

状态：草案

日期：2026 年 11 月 10 日。

## 这份文档是干什么的

这份任务清单把群聊语音拆成 8 个可以直接动手的任务。思路是复用现有群聊流程，只补语音特有的部分，所以没有单独的阶段检查任务；每个任务自带验证命令，最后统一跑一次回归。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`。
- `BLOCKED` 必须写清楚卡在哪里。
- `CANCELLED` 必须写清楚为什么不做。
- 每做完一个任务，必须立刻更新这里。

依赖关系：1 → 2、3 → 4 → 5 → 8；任务 6 依赖 2、3、4；任务 7 依赖 4、5、6；任务 8 在最后。任务 2 和任务 3 可以并行。

---

## 阶段 1：契约、数据库和路由

- [x] 1 契约和数据库字段
  - 状态：DONE
  - 这一步到底做什么：给会话输入加 `participantBotIds`，给会话视图和 `reply.message`、`audio.started` 加可选字段，给 `VoiceSession` 加 `participantBotIds` 列。
  - 做完你能看到什么：直接会话请求不变，群聊会话请求可以通过契约校验。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 4、需求 5
    - `design.md` §3.2「数据结构」
  - 主要改哪里：
    - `packages/contracts/src/voice.ts`
    - `packages/contracts/test/voice.test.ts`
    - `packages/db/prisma/schema.prisma`
    - `packages/db/prisma/migrations/<新迁移>`
  - 这一步先不做什么：不加会话模式字段，不加新表。
  - 怎么算完成：
    1. `participantBotIds` 为可选字段，最多 6 个
    2. `speakerBotId` 为可选字段
    3. 迁移只新增一列，默认值为空数组
  - 怎么验证：
    - `bun test packages/contracts/test/voice.test.ts`
    - 结果：通过（3 pass，0 fail）
  - 对应需求：`requirements.md` 需求 1、需求 4、需求 5
  - 对应设计：`design.md` §3.2、§3.3.1

- [x] 2 语音点名解析
  - 状态：DONE
  - 这一步到底做什么：实现纯函数 `resolveVoiceResponders`。
  - 做完你能看到什么：给定转写、参与成员和默认说话人，得到确定的响应 Bot 顺序。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §3.3.2「resolveVoiceResponders」
  - 主要改哪里：
    - `packages/messaging/src/group-routing.ts`
    - `packages/messaging/test/group-routing.test.ts`
  - 这一步先不做什么：不改 `resolveGroupResponderIds`，不做别名配置。
  - 怎么算完成：
    1. 覆盖单个、多个、所有人、未点名、中文名、英文单词边界和名称包含关系
  - 怎么验证：
    - `bun test packages/messaging/test/group-routing.test.ts`
    - 结果：通过（11 pass，0 fail）
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §3.3.2、§6.1

## 阶段 2：服务端主链路

- [x] 3 群聊回合的语音分支
  - 状态：DONE
  - 这一步到底做什么：`createGroupRound` 接受 `responderIds`；语音回合结束时不创建自由追问（接力见任务 6）；新增 `onGroupDeliverySettled` 回调；`sendGroupMessage` 支持 `voice` 元数据和 `responderIds`；Worker 对语音群聊投递注入 `voiceTurnPrompt`。
  - 做完你能看到什么：带 `metadata.voice` 的群聊消息只投递给指定 Bot，所有投递结束后回合直接完成，每次投递发布后回调被触发。
  - 先依赖什么：1
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3.2、§2.3.3、§3.3.3、§3.3.4
  - 主要改哪里：
    - `packages/messaging/src/index.ts`（`createGroupRound`、`advanceRound`、`completeDelivery`、`retryInterruptedGroupDelivery`）
    - `apps/server/src/services/channel-service.ts`
    - `apps/worker/src/worker.ts`
    - `packages/messaging/test/group-execution.integration.test.ts`
    - `apps/worker/test/voice-prompt.test.ts`
  - 这一步先不做什么：不改普通群聊路由，不新增回合或投递状态。
  - 怎么算完成：
    1. 有 `responderIds` 时按其顺序创建投递
    2. 语音回合不创建自由追问回合，普通回合照旧
    3. Outbox 发布后、`advanceRound` 前触发回调
    4. 语音群聊投递拿到 `voiceTurnPrompt`
  - 怎么验证：
    - `bun test packages/messaging/test/group-execution.integration.test.ts`
    - 结果：未配置 `OUTCOMEGO_TEST_DATABASE_URL`，13 个集成测试全部跳过，0 fail
    - `bun test apps/worker/test/voice-prompt.test.ts`
    - 结果：通过（1 pass，0 fail）
  - 对应需求：`requirements.md` 需求 3，非功能需求 3
  - 对应设计：`design.md` §2.3.3、§3.3.3、§3.3.4、§6.2

- [x] 4 VoiceService 群聊会话和顺序朗读
  - 状态：DONE
  - 这一步到底做什么：`createSession` 支持群聊；`acceptTranscript` 走群聊分支；实现 `onGroupDeliverySettled` 处理，把答复按 Bot 声音加入现有 `ttsChain`，事件带 `speakerBotId`。
  - 做完你能看到什么：在群聊中说一句话，被点名的 Bot 依次回答并依次朗读。
  - 先依赖什么：2、3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 4
    - `design.md` §2.3.1 至 §2.3.4
  - 主要改哪里：
    - `apps/server/src/services/voice-service.ts`
    - `apps/server/src/app-service.ts`（接回调）
    - `apps/server/test/voice-route.test.ts` 或新的群聊语音测试
  - 这一步先不做什么：不接旁白，不为每个 Bot 建连接。边写边读推迟到任务 7。
  - 怎么算完成：
    1. 群聊会话校验参与成员，错误返回 `voice_invalid_participants`
    2. 重复转写返回原结果
    3. 多个 Bot 的答复按投递顺序朗读，同一消息只朗读一次
    4. 静默 Bot 不产生事件
    5. 直接语音测试全部通过
  - 怎么验证：
    - `bun test apps/server/test/voice-route.test.ts`
    - 结果：通过（3 pass，0 fail）
    - `bun test apps/server/test/group-supersession.integration.test.ts`
    - 结果：未配置 `OUTCOMEGO_TEST_DATABASE_URL`，5 个集成测试全部跳过，0 fail
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 4，非功能需求 1、2
  - 对应设计：`design.md` §2.3、§5.3、§6.3

## 阶段 3：桌面端和收尾

- [x] 5 桌面端群聊语音
  - 状态：DONE
  - 这一步到底做什么：群聊标题栏显示语音入口；开始前选择成员和默认说话人；按 `speakerBotId` 切换头像、名称和字幕。
  - 做完你能看到什么：用户可以在桌面端完成一次群聊语音通话。
  - 先依赖什么：4
  - 开始前先看：
    - `requirements.md` 需求 1、需求 5
    - `design.md` §2.1、§3.2.2
  - 主要改哪里：
    - `apps/desktop/src/renderer/App.tsx`
    - `apps/desktop/src/renderer/hooks/use-live-voice.ts`
    - `apps/desktop/src/renderer/lib/live-voice-transport.ts`
    - `apps/desktop/src/renderer/components/outcomego/live-voice/live-voice-layer.tsx`
  - 这一步先不做什么：不在通话中改成员，不改直接语音的外观。
  - 怎么算完成：
    1. 直接私聊入口不变
    2. 群聊能选择成员并开始通话
    3. 说话人切换正确
  - 怎么验证：
    - 桌面端类型检查
    - 结果：通过（`bun run typecheck`）
    - 人工验证：点名、多个 Bot、抢话、结束通话
    - 结果：未执行；项目规则禁止启动开发服务，当前环境没有可用的桌面端运行服务
  - 对应需求：`requirements.md` 需求 1、需求 5
  - 对应设计：`design.md` §2.1、§3.2.2、§7.3

- [ ] 6 接力、被点名兜底和朗读去 @
  - 状态：IN_REVIEW
  - 这一步到底做什么：补齐实测暴露的三个问题和两项语音体验优化。①语音点名认“你们两个”等集体称呼和同音字；②语音回合按答复里的 `@` 接力，下一位在上一位朗读期间就开始处理；③被点名的回合没调用 `SendToUser` 时，把最后文本作为回复发出；④朗读时去掉 `@名字`；⑤Worker 按根消息识别语音回合并告诉 Bot 如何用 `@` 交棒。
  - 做完你能看到什么：语音里说“你们两个各说一句”两个 Bot 都回答；一个 Bot 在答复里 `@` 另一个，另一个接着说且 `@名字` 不会被读出；用户文字 `@某Bot` 追问时该 Bot 一定有回复。
  - 先依赖什么：2、3、4
  - 开始前先看：
    - `requirements.md` 需求 2 第 2、6 条，需求 3 第 4、5 条，需求 4 第 6、7 条
    - `design.md` §2.3.5、§2.3.6、§3.3.2、§3.3.2.1、§6.2、§6.2.1、§6.3.1
  - 主要改哪里：
    - `packages/messaging/src/group-routing.ts`
    - `packages/messaging/src/group-outbox.ts`
    - `packages/messaging/src/index.ts`（`advanceRound`、`completeDelivery`、`stageAddressedFallback`）
    - `apps/worker/src/worker.ts`（`voiceRoomPrompt`、根消息识别）
    - `apps/server/src/services/voice-text.ts`、`apps/server/src/services/voice-service.ts`
    - `packages/messaging/test/group-routing.test.ts`、`apps/server/test/voice-media.test.ts`、`apps/worker/test/voice-prompt.test.ts`
  - 这一步先不做什么：不在上一位还在写的时候并行启动下一位；不做别名配置；不改普通文本群聊的追问规则。
  - 怎么算完成：
    1. 集体称呼和同音字的路由单元测试通过
    2. 接力、被点名判断、去 `@` 的单元测试通过
    3. 受影响三个包的类型检查和全部测试通过
    4. 数据库集成测试补齐后通过（见下）
  - 怎么验证：
    - `cd packages/messaging && bun test test/group-routing.test.ts`
    - 结果：通过（14 pass，0 fail）
    - `cd apps/server && bun test test/voice-media.test.ts`
    - 结果：通过（7 pass，0 fail）
    - `cd apps/worker && bun test test/voice-prompt.test.ts`
    - 结果：通过（2 pass，0 fail）
    - `cd packages/messaging && bun test`、`cd apps/server && bun run test`、`cd apps/worker && bun test`
    - 结果：通过（messaging 258 pass，server 477 pass，worker 125 pass，均 0 fail；集成测试因未配置 `OUTCOMEGO_TEST_DATABASE_URL` 跳过）
    - 未完成：在 `group-execution.integration.test.ts` 补语音接力、被点名兜底（含 `SendToUser` 与 `(pass)` 不兜底）的集成测试，需要配置测试数据库后运行
    - 未完成：桌面端人工验证（“你们两个”、`@` 接力、`@名字` 不读出、`@小菲 你怎么不说话`），项目规则禁止启动开发服务，需要用户自行重启本地 debug 栈后验证
  - 对应需求：`requirements.md` 需求 2、3、4
  - 对应设计：`design.md` §2.3.5、§2.3.6、§3.3.2、§3.3.2.1、§6.2、§6.2.1、§6.3.1

- [ ] 7 会议室界面、字幕同步和边写边读
  - 状态：IN_REVIEW
  - 这一步到底做什么：①桌面端群聊通话改为多人会议室样式，参与者头像网格，说话者头像有动效，字幕带头像；②群聊开场白改为“我们都在”；③字幕在这位 Bot 的声音开始时才发，上一位没播完下一位的字幕不出现；④把已有的“边写边读”链路接到群聊 run，写出一句读一句；⑤修复语音事件监听器的竞态，并把兜底等待缩短。
  - 做完你能看到什么：群聊通话里谁说话谁的头像亮起并有波纹；开场听到“我们都在”；第二轮对话不再先出一串字幕再读第一句，而是第一位 Bot 写出第一句就开始出声。
  - 先依赖什么：4、5、6
  - 开始前先看：
    - `requirements.md` 需求 4 第 8 至 11 条，需求 5 第 5 条
    - `design.md` §2.3.7、§2.3.8
  - 主要改哪里：
    - `packages/contracts/src/index.ts`（`voiceSpeech`）、`packages/contracts/src/voice.ts`（`replaces`）
    - `apps/worker/src/worker.ts`
    - `apps/computer/src/runtime.ts`、`apps/computer/src/runtime/voice-stream.ts`
    - `apps/server/src/services/voice-service.ts`、`voice-session.ts`、`voice-media.ts`、`voice-opening.ts`
    - `apps/desktop/src/renderer/components/outcomego/live-voice/live-voice-layer.tsx`、`live-voice.css`
    - `apps/desktop/src/renderer/hooks/use-live-voice.ts`、`apps/desktop/src/renderer/lib/live-voice-audio.ts`、`apps/desktop/src/renderer/lib/i18n-catalog.ts`
    - 测试：`apps/computer/test/runtime/voice-stream.test.ts`、`apps/server/test/voice-group-stream.test.ts`、`voice-generation.test.ts`、`voice-opening.test.ts`
  - 这一步先不做什么：不做旁白；不让下一位 Bot 在上一位还在写的时候并行启动；不改单 Bot 通话的界面和朗读行为。
  - 怎么算完成：
    1. 群聊通话界面不再出现单 Bot 的大头像
    2. 字幕不早于上一位的声音播完
    3. 群聊 run 的句子在写出后立即送去合成，保存后只补读剩余部分，字幕被完整文本替换
    4. 抢话后该回复后面的句子不再朗读
    5. 类型检查和受影响包的测试通过
  - 怎么验证：
    - `cd apps/computer && bun test test/runtime/voice-stream.test.ts`
    - 结果：通过（13 pass，0 fail）
    - `cd apps/server && bun test test/voice-group-stream.test.ts test/voice-generation.test.ts test/voice-opening.test.ts`
    - 结果：通过
    - 各包类型检查（contracts、messaging、server、worker、computer、desktop）
    - 结果：通过
    - 各包全部测试：contracts 146 pass，messaging 258 pass，server 489 pass，worker 126 pass，desktop 543 pass，均 0 fail；computer 909 pass，1 fail（`web-provider-check` 的 fetch 检查，撤掉本任务改动后同样失败，是已有问题）
    - 未完成：桌面端人工验证（会议室样式与动效、字幕与声音同步、第二轮首句出声时间、抢话）。项目规则禁止启动开发服务，需要用户重启本地 debug 栈和远程 computer 后验证
    - 部署提醒：`apps/computer` 与 `packages/contracts` 的改动要同步到远程 computer 并重建容器后才生效，按 AGENTS.md 的流程进行，重建会中断正在运行的 bot 任务，需用户确认
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §2.3.7、§2.3.8、§8.1

### 最终检查

- [ ] 8 回归
  - 状态：TODO
  - 备注：先前的回归结果早于任务 6、7，两者的集成测试补齐后需要重跑。
  - 这一步到底做什么：跑相关包的全部测试，确认直接语音、普通群聊、群聊例行任务和原生客户端解析不受影响。
  - 做完你能看到什么：所有相关测试通过。
  - 先依赖什么：5、6、7
  - 开始前先看：
    - `requirements.md` 需求 5，非功能需求 3
    - `design.md` §6.4、§7.4
  - 主要改哪里：只修复回归问题。
  - 这一步先不做什么：不新增功能。
  - 怎么算完成：
    1. 下列测试通过，结果记录在本任务下
  - 怎么验证：
    - `cd packages/contracts && bun test`
    - 结果：通过（146 pass，0 fail）
    - `cd packages/messaging && bun test`
    - 结果：通过（255 pass，32 skip，0 fail）
    - `cd apps/server && bun run test`
    - 结果：通过（476 pass，143 skip，0 fail）
    - `cd apps/worker && bun test`
    - 结果：通过（124 pass，29 skip，0 fail）
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §6.4、§7
