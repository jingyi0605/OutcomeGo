# 任务清单 - 外部消息服务（人话版）

状态：IN_PROGRESS

文档关系：

- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- WeChat 子规格任务：[`../009.1-微信iLink消息服务集成/tasks.md`](../009.1-微信iLink消息服务集成/tasks.md)

## 这份文档是干什么的

让接手的人快速知道：

- 先做什么、后做什么
- 每一步到底改什么
- 做完后怎么判断是不是真的完成了

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- `BLOCKED` 必须写清楚卡在哪里
- `CANCELLED` 必须写清楚为什么不做
- 每做完一个任务，必须立刻更新这里

## 通用验证命令

除非任务另有说明，以下命令都在仓库根目录执行：

- 类型检查：`bun run typecheck`
- 枚举与边界检查：`bun run check:architecture`
- 本 Spec 的 Server 测试：`bun run prepare:plugins && bun test apps/server/test/external-messaging`
- 集成测试需要本地测试数据库，准备方式与现有 `apps/server/test/*.integration.test.ts` 相同。
- 涉及 `apps/computer`、`packages/contracts`、`packages/plugin-sdk`、`packages/plugins` 的改动要在真实环境生效，必须按 `AGENTS.md`「Remote Debug Computer」同步并重建远端 computer。重建会中断正在运行的 Bot 任务，动手前先征得用户同意。

## 与子规格的并行关系

- `009.1` 的阶段 1、2（协议探测、插件骨架、iLink API client、二维码）不依赖本 Spec，可以与本 Spec 阶段 1、2 并行。
- `009.1` 的阶段 3 依赖本 Spec 任务 1.2（线协议类型）。
- `009.1` 的阶段 4 依赖本 Spec 任务 4.5（外发阶段检查）。

---

## 修订记录（2026-11-16）：会话并入 Bot 主会话

实机使用后确认产品期望是「微信与应用是同一个 Bot 的两个入口」，决策 D13（见 `design.md` §8.3）取代了 D1 与 D12。受影响的已完成任务按下面的方式理解，其验证记录是修订前的结果，修订后的证据在本节：

- 3.2、3.3：消息写入 Bot 的 `bot_dm`，不再创建 `external_dm`；`ExternalChannelMapping.channelId` 改为可空。旧映射在下一条消息到达时脱离旧会话并归档旧会话。
- 4.1、4.2、4.3：回复是否发往外部，由该轮触发消息的 Receipt 决定（`runId`），不再看 Channel 类型。应用内发起的轮次只回复应用。外部回复写入的消息不再触发应用推送。
- 2.1：`external_dm` 不再有新数据；分支审计中涉及它的行只对旧数据有意义。
- 5.1：侧栏平台标签、只读输入区只对旧数据出现；主会话里 Bot 回复显示投递状态，用户消息显示「来自微信」。
- 修订后的验证：`bun test apps/server/test/external-messaging` 全部通过（含新增的「应用内发起的轮次只回复应用」「来自外部的轮次发卡片落在应用」「旧联系人迁移」「外部回复不推送」用例），桌面端 `external-delivery-status.test.tsx` 9 项通过。未做：真实微信账号上的人工验证。
- Bot 主动投递（2026-11-16）：`SendToUser` 的 `channel` 支持只写平台名（如 `wechat`），解析为该 Bot 正在对话的联系人；写 `wechat:<联系人>` 仍可指定。解析时要求连接就绪、绑定启用且仍指向该 Bot、联系人曾发过消息，否则返回 `external_binding_missing`、`external_peer_unknown` 或 `external_peer_ambiguous`，且不发送。例程自己的运行仍不能给用户发消息（既有规则，未改动），由被唤醒的主会话那一轮发送。窗口过期时按既有规则失败并在应用里保留文本。证据：`reply-routing.integration.test.ts`「on the Bot's own initiative」8 项、`delivery.integration.test.ts` 地址解析用例。未验证：真实微信账号上的主动投递，以及超出回复窗口后微信的实际行为。
- 每日续期提醒（2026-11-17）：manifest `messaging.replyWindow: { hours }` 声明平台有回复窗口，才会在连接设置里出现「每日续期提醒」开关和提醒时间（`ExternalMessagingBinding.reminderEnabled/reminderTime/lastReminderOn/lastReminderAt/lastReminderOutcome`）。`ExternalReminderService` 每分钟检查：到点后 6 小时内、该联系人当天（按用户时区）还没发过消息，就通过 `ExternalDeliveryService.sendNotice` 发一条固定提醒并记录在 Bot 主会话（`metadata.externalNotice`，不计未读）；每个绑定每天先占位再发送，至多一次，失败或不确定只记录结果、当天不重试。提醒发出且未被回答（36 小时内）时，联系人的下一条纯确认类消息（不超过 2 个字的任何内容，或不超过 4 个字的纯数字、标点、符号、空格，或「okay」「[微笑]」等；2026-11-17 起 2 个字以内一律算确认）只记一条回执并算作已发过消息，不写进聊天、不唤醒 Bot；含文字内容、带文件、或没有待回答提醒时的消息照常处理。证据：`reminder.integration.test.ts` 42 项、`binding.integration.test.ts` 设置用例。已知限制：纯空白消息被连接器在到达 Server 前丢弃，它会续期窗口，但 Server 看不到，所以当天先发空白再到提醒时间仍可能多收到一条提醒；窗口时长（24 小时）与微信的实际行为未经真实账号验证；提醒文字是固定的中英双语。
- 已知限制：由旧轮次触发的后续轮次（例如子任务完成后的续跑、定时任务）没有 Receipt，因此只回复应用，不再自动回复到微信；Bot 需要时可用显式地址 `wechat:<联系人>` 发送。

## 阶段 1：契约与数据模型

- [x] 1.1 建立并修订 Spec 009
  - 状态：DONE
  - 这一步到底做什么：定义 provider 无关的外部消息基础服务，把平台 connector 拆到子规格，并按复核意见补齐决策。
  - 做完你能看到什么：需求、设计、任务三份文档互相引用，关键决策记录在 `design.md` §8.3。
  - 先依赖什么：无
  - 开始前先看：
    - `specs/000-Spec规范/Spec模板/`
  - 主要改哪里：
    - `specs/009-外部消息服务/*`
  - 这一步先不做什么：不写代码。
  - 怎么算完成：
    1. 每条需求都有编号、用户故事和验收标准
    2. `design.md` §7.4 的验证映射覆盖全部需求
  - 怎么验证：
    - 人工走查文档引用
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [x] 1.2 增加 manifest `messaging` 契约和线协议类型
  - 状态：DONE
  - 验证记录：`packages/plugin-sdk/test/messaging.test.ts`、`packages/contracts/test/plugin-namespaces.test.ts`、`apps/server/test/external-messaging/host-tools.test.ts` 通过；线协议类型位于 `packages/plugin-sdk/src/messaging.ts`（子路径 `@outcomego/plugin-sdk/messaging`，含 Node 的 `crypto`，不进入浏览器入口），常量位于浏览器安全的 `messaging-limits.ts`。`list_peers` 的输入、输出类型与解析函数也在该文件中，供 `009.1` 复用。
  - 这一步到底做什么：让 connector 能在 `plugin.json` 里声明"我支持聊天式收发"，并提供 Server 和 connector 共用的消息类型与校验函数。
  - 做完你能看到什么：一个带 `messaging` 块的 manifest 能通过校验；poll 和 deliver 两个工具对 Bot 不可见。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 4、非功能需求 3.5、4.1
    - `design.md` §3.2.6「线协议类型」
    - `design.md` §3.2.8「manifest `messaging` 块」
    - `packages/plugin-sdk/src/types.ts` 中 `PluginEventPolling` 的写法
  - 主要改哪里：
    - `packages/plugin-sdk/src/types.ts`（`PluginMessaging`，挂到 `PluginConnectorDefinition`）
    - `packages/plugin-sdk/src/manifest.ts`（校验规则）
    - `packages/plugin-sdk/src/messaging.ts`（新：类型、解析与校验函数、`payloadHash`）
    - `packages/contracts/src/plugin-namespaces.ts`（`manifestHostTools` 加入两个工具）
    - `apps/server/src/services/plugin/invocations.ts`（Bot 调用这两个工具时拒绝）
    - `packages/plugin-sdk/test/messaging.test.ts`、`packages/contracts/test/`
  - 这一步先不做什么：不实现任何平台协议，不建表。
  - 怎么算完成：
    1. 非 stdio、缺少 `persistentState`、工具名重复、`maxTextChars` 越界的 manifest 都被拒绝
    2. `parseExternalPollResult` 和 `parseExternalDeliverResult` 对畸形输入抛出明确错误
    3. 相同消息的 `payloadHash` 在展示名和 `exchangeName` 变化时保持不变
  - 怎么验证：
    - `bun test packages/plugin-sdk/test/messaging.test.ts`
    - `bun test packages/contracts/test`
    - `bun run typecheck`
  - 对应需求：`requirements.md` 需求 4 / 验收 4.1、4.2；非功能需求 3.5、4.1
  - 对应设计：`design.md` §3.2.6、§3.2.8、§3.3.1、§3.3.2

- [x] 1.3 增加 `ChannelKind.external_dm`
  - 状态：DONE
  - 验证记录（2026-11-16，PostgreSQL 16.10，调试服务所在实例上的一次性库，未触碰 `outcomego` 库）：空库经 `bun scripts/deploy-schema.ts` 建出完整 schema，枚举含 `external_dm`；以 `0db433709` 的旧 schema 建库（69 张表，无 `external_dm`），依次执行两个 migration 与 `raw-schema.sql` 均成功。`bun run check:architecture` 与全仓类型检查通过。
  - 这一步到底做什么：在数据库枚举和契约里加入新的 Channel 类型。
  - 做完你能看到什么：可以创建 `kind = external_dm` 的 Channel，枚举一致性检查通过。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §3.2.5「`ChannelKind`」
    - `design.md` §8.3 决策 D1
    - `scripts/check/contract-enum-parity.ts`
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`（`enum ChannelKind`）
    - `packages/db/prisma/migrations/<时间戳>_add_external_dm_channel_kind/`
    - `packages/contracts/src/index.ts`（`ChannelKind`）
  - 这一步先不做什么：不改任何按 `kind` 判断的业务代码（留给 2.1）。
  - 怎么算完成：
    1. migration 可在空库和现有库上执行
    2. Prisma 与契约的枚举值一致
  - 怎么验证：
    - `bun run check:architecture`
    - `packages/db` 的 migration 测试
  - 对应需求：`requirements.md` 需求 2 / 验收 2.1
  - 对应设计：`design.md` §3.2.5

- [x] 1.4 增加四张数据表
  - 状态：DONE
  - 验证记录（同上）：`packages/db/test/external-messaging.integration.test.ts` 28 项通过，运行方式为 `OUTCOMEGO_TEST_DATABASE_URL=<一次性库> bun test packages/db/test/external-messaging.integration.test.ts`。覆盖：Mapping、Receipt、Delivery（`callId`、`channelMessageId`）、Binding 的唯一约束（含 8 至 12 路并发只成功一次）；Receipt 无 `processing` 状态、`rejected` 必带拒绝码；Delivery 五种状态与"非终态必有租约、终态必无租约"；级联（删连接、删 Bot、删 Channel、删 Mapping 各自的结果）；带前值条件的游标更新与过期租约抢占在并发下只有一个获胜；租约条件终态写入后，迟到结果不能覆盖。每条拒绝都断言了具体的 SQLSTATE（`23505` 唯一、`23514` CHECK）。手写 migration 在旧库上执行后，与当前 schema 的 diff 中没有任何 `external_*` 或 `channel_kind` 语句。
  - 这一步到底做什么：新增 Binding、Mapping、Receipt、Delivery 四张独立表及其唯一约束和外键。
  - 做完你能看到什么：数据库层面就能阻止重复的 Mapping、重复的 Receipt 和重复的 Delivery。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、2、3、6、8，非功能需求 2.2、4.3
    - `design.md` §3.2.1 到 §3.2.4
    - `design.md` §4.1「数据关系」
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`
    - `packages/db/prisma/migrations/<时间戳>_add_external_messaging/`
    - `packages/db` 的测试 fixture
  - 这一步先不做什么：不向 `PluginConnection`、`Channel`、`Bot` 添加列（只加关系字段）。
  - 怎么算完成：
    1. `(connectionId, peerId, botId)`、`channelId`、`(connectionId, providerMessageId)`、`callId`、`channelMessageId` 的唯一约束生效
    2. 删除 Connection 时 Binding、Mapping、Receipt、Delivery 级联删除；删除 Bot 时 Binding、Mapping 级联删除
    3. Receipt 的 `status` 没有 `processing`
  - 怎么验证：
    - `packages/db` 的 schema 校验和 migration 测试
    - 并发插入相同键的唯一性测试
  - 对应需求：`requirements.md` 需求 2 / 验收 2.4；需求 3 / 验收 3.2；需求 8 / 验收 8.1、8.2
  - 对应设计：`design.md` §3.2.1 到 §3.2.4、§4.1

### 阶段检查

- [ ] 1.5 契约与数据模型阶段检查
  - 状态：TODO
  - 这一步到底做什么：只检查契约和表结构是否足够支撑后续阶段和 `009.1`，不再扩新范围。
  - 做完你能看到什么：`009.1` 可以放心按 `packages/plugin-sdk/src/messaging.ts` 开始实现 poll 和 deliver。
  - 先依赖什么：1.2、1.3、1.4
  - 开始前先看：
    - `requirements.md`
    - `design.md` §3、§4
    - `../009.1-微信iLink消息服务集成/design.md` §3
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求，不实现 Server 服务。
  - 怎么算完成：
    1. 线协议类型能表达 `009.1` 设计中的全部字段，且不包含任何回复凭据
    2. 已知缺口记录在 `design.md` §8.2
  - 怎么验证：
    - 人工走查
    - `bun run typecheck && bun run check:architecture`
  - 对应需求：`requirements.md` 需求 1、2、3、4、6
  - 对应设计：`design.md` §3.2、§3.3、§4

---

## 阶段 2：Channel 行为与媒体交换通道

- [ ] 2.1 审计并修正全部 `kind` 分支
  - 状态：IN_REVIEW
  - 验证记录（2026-11-16，PostgreSQL 16.10 一次性库）：应用内向 `external_dm` 发送返回 409 `external_channel_read_only`、语音会话拒绝、通知静默、`product-core` 行投影取到 Bot（`product-core.test.ts` 有对应用例）；`channel-kind-regression.integration.test.ts` 5 项通过（外部聊天先于或后于 `bot_dm` 创建，`dmChannelId`、`kind` 与 `directKey` 查询结果都不变）。审计表已写入 `docs/20261116-ChannelKind分支审计.md`，桌面端与移动端分支见该文档第四节。仍缺：语音会话拒绝（`voice-service.ts:174`）没有专门测试，只有 `tsc` 通过，所以第 3 条完成标准未全部满足，本任务保持 IN_REVIEW。
  - 这一步到底做什么：逐处检查按 Channel 类型判断的代码，确认 `external_dm` 出现时行为正确，并让应用内发送对它只读。
  - 做完你能看到什么：一张审计表列出每处分支的结论；一个 Bot 同时有 `bot_dm` 和 `external_dm` 时，私聊相关功能完全不变。
  - 先依赖什么：1.5
  - 开始前先看：
    - `requirements.md` 需求 2 / 验收 2.6，需求 7 / 验收 7.3，非功能需求 3.4
    - `design.md` §6.7「既有私聊不受影响」
    - `design.md` §8.1 前两条风险
    - 用 `grep -rn 'kind === \|kind !== \|kind: "' apps/server/src apps/worker/src packages/messaging/src` 得到完整清单
  - 主要改哪里：
    - `apps/server/src/services/`（`channel-service.ts`、`view-mappers.ts`、`snapshot/views.ts`、`snapshot-service.ts`、`internal-tool-service.ts`、`rich-message-service.ts`、`voice-service.ts`、`messages-send-service.ts`、`external-draft-service.ts`）
    - `apps/worker/src/worker.ts`、`apps/worker/src/projection.ts`
    - `packages/messaging/src/`（`index.ts`、`routines.ts`、`notifications.ts`、`sibling-threads.ts`、`agent-data.ts`、`draft-notifications.ts`）
    - `specs/009-外部消息服务/docs/20261116-ChannelKind分支审计.md`（新：审计结果）
    - `apps/server/test/external-messaging/channel-kind-regression.integration.test.ts`（新）
  - 这一步先不做什么：不实现入站和外发；不改客户端。
  - 怎么算完成：
    1. 审计表覆盖 grep 得到的每一处，并标明"无需改动"或"已改动及原因"
    2. 应用内向 `external_dm` 发送返回 409 `external_channel_read_only`
    3. 密钥请求、网络策略审批、语音会话在 `external_dm` 中被拒绝或不可用，且有测试
    4. 手工插入一个 `external_dm` 后，`dmChannelId`、Routine 归属、通知标题等结果与插入前一致
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/channel-kind-regression.integration.test.ts`
    - 现有 `apps/server`、`apps/worker`、`packages/messaging` 测试全部通过
  - 对应需求：`requirements.md` 需求 2 / 验收 2.6；需求 7 / 验收 7.3；非功能需求 3.4
  - 对应设计：`design.md` §3.2.5、§3.3.5、§6.7

- [ ] 2.2 实现 computer exchange 端点
  - 状态：DONE
  - 进展：三个端点（`apps/computer/src/mcp-exchange.ts`、`main.ts` 路由）和 Server 侧封装（`apps/server/src/services/external-messaging/media-exchange.ts`）已完成。`apps/computer/test/mcp-exchange.test.ts`（36 项：命名、符号链接、父目录与状态目录替换、越界、大小上限、临时文件加原子改名、`0600`、清理）和 `apps/server/test/external-messaging/media-exchange.test.ts`（17 项）通过，类型检查通过。读取使用 `O_NOFOLLOW` 加 `fstat`，不依赖先 `lstat` 后打开。远端实测（2026-11-16，`openteam-debug` 的 computer 已按流程同步并重建，`debug.sh check` 全部 ok）：从 Mac 经局域网直连 `10.255.0.45:18790`，PUT 209,711,104 字节（上限 200 MiB 减 4 KiB）约 6.3 秒，文件落盘权限 `0600`、目录内只有该文件、无临时文件残留；复制进 `inbound` 后 GET 约 4.2 秒，三处 SHA-256（PUT 响应、容器内文件、取回文件）完全一致；多 1 字节返回 413 `exchange_too_large` 且不留文件；DELETE 清理成功。实测发现并修复一个缺陷：computer 的 `Bun.serve` 没设 `maxRequestBodySize`，沿用 Bun 默认 128 MiB，导致 128 至 200 MiB 的外发文件在到达端点前就被 413 拒绝（修复前复现过），现设为交换上限加 1 MiB（`apps/computer/src/main.ts`）。未覆盖：直接用 curl 打端点，没有经过 Server 的 `media-exchange.ts` 封装；没有经过任何反向代理（调试环境 Server 到 computer 是直连）。
  - 这一步到底做什么：在 Bot Computer 上增加三个 HTTP 端点，让 Server 能从 connector 的受控目录读入站文件、写外发文件并清理。
  - 做完你能看到什么：Server 可以用一个文件名把字节流取回或送达，任何越界、符号链接、非法命名的请求都被拒绝。
  - 先依赖什么：1.5
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.5、5.6、5.7
    - `design.md` §3.3.3「computer exchange 端点」
    - `design.md` §8.3 决策 D10
    - `apps/computer/src/main.ts` 中 `/v1/mcp/connections/:id/call` 的处理
    - `apps/computer/src/mcp-manager.ts` 的 `accountStateDirectory` 和 `forget`
  - 主要改哪里：
    - `apps/computer/src/main.ts`
    - `apps/computer/src/mcp-manager.ts`
    - `apps/computer/test/`（新测试）
    - `apps/server/src/services/external-messaging/media-exchange.ts`（新：Server 侧封装）
    - `apps/server/src/services/plugin/transport.ts`（复用 `computerFetch`）
  - 这一步先不做什么：不接 `AssetStore`，不做平台相关的加解密。
  - 怎么算完成：
    1. 三个端点的命名、UUID、符号链接、父目录、大小上限校验都有测试
    2. 写入采用临时文件加原子改名，权限 `0600`
    3. 对未声明 `persistentState` 的连接返回错误
    4. 实测一个接近 `AssetStore` 上限的文件能完整往返，结论写入 `design.md` §8.2
  - 怎么验证：
    - `bun test apps/computer/test`
    - 征得用户同意后同步并重建远端 computer，执行 `scripts/dev/debug.sh check`
  - 对应需求：`requirements.md` 需求 5 / 验收 5.5、5.6、5.7
  - 对应设计：`design.md` §3.3.3

### 阶段检查

- [ ] 2.3 Channel 与交换通道阶段检查
  - 状态：TODO
  - 这一步到底做什么：确认新 Channel 类型在系统里是"安全存在"的，媒体通道可用。
  - 做完你能看到什么：可以在不影响任何现有功能的前提下开始接入站。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `docs/20261116-ChannelKind分支审计.md`
    - `design.md` §8.1
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新范围。
  - 怎么算完成：
    1. 全量测试通过
    2. 审计中标为"待观察"的条目都有后续任务或风险记录
  - 怎么验证：
    - `bun run typecheck && bun run test`
  - 对应需求：`requirements.md` 需求 2、5、7
  - 对应设计：`design.md` §3.2.5、§3.3.3、§6.7

---

## 阶段 3：入站

- [x] 3.1 实现绑定服务和管理接口
  - 状态：DONE
  - 验证记录（2026-11-16，PostgreSQL 16.10 一次性库）：`binding.integration.test.ts` 10 项通过；`PUT/GET/DELETE /api/plugin-connections/:id/messaging` 已接入路由。
  - 这一步到底做什么：让"哪个连接的消息交给哪个 Bot"可以被创建、修改、停用和查询。
  - 做完你能看到什么：通过 HTTP 接口能为一个声明了 `messaging` 的连接绑定 Bot，并读到入口状态。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §3.2.1「`ExternalMessagingBinding`」
    - `design.md` §3.3.4「绑定管理 HTTP 接口」
    - `design.md` §4.2 的 Binding 状态表
  - 主要改哪里：
    - `apps/server/src/services/external-messaging/binding.ts`（新）
    - `apps/server/src/services/external-messaging/errors.ts`、`views.ts`（新）
    - `apps/server/src/routes/plugin-query.ts`、`plugin-mutation.ts`
    - `apps/server/src/app-service.ts`（装配）
    - `apps/server/test/external-messaging/binding.integration.test.ts`（新）
  - 这一步先不做什么：不启动轮询。
  - 怎么算完成：
    1. 未声明 `messaging` 的连接返回 `external_messaging_unsupported`
    2. 归档的 Bot 和子代理身份不能被绑定
    3. 改绑保留游标，并从 `needs_attention` 恢复为 `active`
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/binding.integration.test.ts`
  - 对应需求：`requirements.md` 需求 1 / 验收 1.1、1.2、1.5、1.6
  - 对应设计：`design.md` §3.2.1、§3.3.4、§4.2

- [x] 3.2 实现消息接受：准入、去重、映射、写消息、唤醒
  - 状态：DONE
  - 验证记录（2026-11-16，PostgreSQL 16.10 一次性库）：`inbound.integration.test.ts` 18 项通过：所有者准入、非所有者与群聊拒绝且不存正文、重复与冲突、8 路并发重投只产生一条消息、并发首条消息只建一个会话、事务中途失败不留任何记录、Bot 不可用进入 `needs_attention`、归档会话拒绝、新消息打断当前回合。
  - 这一步到底做什么：把一条标准化的外部消息变成 `external_dm` 里的一条用户消息和一个 Bot wake，并保证只发生一次。
  - 做完你能看到什么：直接调用 `accept` 就能看到 Channel 被创建、消息出现、Bot 被唤醒；重复调用只返回 `duplicate`。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 1 / 验收 1.3、1.4；需求 2；需求 3
    - `design.md` §2.3.2「接受一条入站消息」
    - `design.md` §3.2.2、§3.2.3、§3.2.7
    - `apps/server/src/services/channel-service.ts` 的 `sendDirectMessage`（事务结构的参照）
  - 主要改哪里：
    - `apps/server/src/services/external-messaging/inbound.ts`（新）
    - `apps/server/src/services/channel/formatting.ts`（来源标注的格式函数）
    - `apps/server/test/external-messaging/inbound.integration.test.ts`（新）
  - 这一步先不做什么：不处理媒体（媒体字段先按"无媒体"走通），不接轮询。
  - 怎么算完成：
    1. 非所有者、非 direct、非法、超长、冲突、Channel 已归档各返回对应的 `rejected` 并写入 `rejected` Receipt，且不保存正文
    2. 事务任一步抛错后数据库中没有 Receipt、Mapping、Channel、消息和 wake
    3. 并发提交同一 peer 的两条首消息只创建一个 Mapping 和一个 Channel
    4. target Bot 不可用返回 `retry` 且 Binding 进入 `needs_attention`
    5. Bot 可见内容包含消息地址和来源平台标注
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/inbound.integration.test.ts`
  - 对应需求：`requirements.md` 需求 1 / 验收 1.3、1.4、1.5；需求 2 / 验收 2.1 到 2.5；需求 3 / 验收 3.1 到 3.4、3.7、3.8
  - 对应设计：`design.md` §2.3.2、§3.2.2、§3.2.3、§6.1、§6.2、§6.5

- [x] 3.3 接入入站媒体
  - 状态：DONE
  - 验证记录（2026-11-16，PostgreSQL 16.10 一次性库）：`inbound-media.integration.test.ts` 11 项通过：摘要或大小不符、声明超限（不拉取）、文件缺失、超过数量、全部失败的纯媒体消息、computer 不可达时整条重试且不写任何记录、文件名注入不能逃出说明行。
  - 这一步到底做什么：把入站消息里的媒体经 exchange 端点取回、校验并登记到 `AssetStore`，失败的附件降级为说明文字。
  - 做完你能看到什么：带图片的消息被接受后，Bot 能把图片当作附件使用；坏附件不会拖垮整条消息。
  - 先依赖什么：2.2、3.2
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.1 到 5.4
    - `design.md` §2.3.3「入站媒体」
    - `design.md` §8.3 决策 D11
    - `packages/messaging/src/asset-store.ts` 的 `ingestStream`
  - 主要改哪里：
    - `apps/server/src/services/external-messaging/inbound.ts`
    - `apps/server/src/services/external-messaging/media-exchange.ts`
    - `apps/server/test/external-messaging/inbound-media.integration.test.ts`（新）
  - 这一步先不做什么：不做外发媒体。
  - 怎么算完成：
    1. 摘要不符、超限、超数量、文件缺失各自只影响对应附件
    2. 仅含媒体且全部失败的消息仍被接受并带占位说明
    3. computer 不可达时整条消息返回 `retry`
    4. 失败说明里的文件名经过规范化和截断
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/inbound-media.integration.test.ts`
  - 对应需求：`requirements.md` 需求 5 / 验收 5.1 到 5.4
  - 对应设计：`design.md` §2.3.3、§6.6

- [x] 3.4 实现入站轮询器
  - 状态：DONE
  - 验证记录（2026-11-16，PostgreSQL 16.10 一次性库）：`poller.integration.test.ts` 28 项通过：逐条推进游标、`retry` 停止整批、20 次或 30 分钟后死信、Bot 不可用不计死信、`resetCursor`、2 至 60 秒退避、租约过期后两个轮询器重叠既不重复也不回退游标、运行代数检查、90 天回执清理。
  - 这一步到底做什么：定时找到可轮询的绑定，抢租约，以长等待方式调用 connector 的 poll 工具，逐条交给 `accept`，按结果推进游标、退避或记死信。
  - 做完你能看到什么：用假 connector 喂消息，消息会自动进入 Channel；中途制造失败后会从正确的位置继续。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 3 / 验收 3.5、3.6；需求 4
    - `design.md` §2.3.1「入站轮询循环」
    - `design.md` §6.3「游标只在终态后推进」
    - `apps/server/src/services/plugin/events.ts`（构造方式和抢占模式的参照）
  - 主要改哪里：
    - `apps/server/src/services/external-messaging/poller.ts`（新）
    - `apps/server/src/app-service.ts`（与 `pluginEvents` 并列启动和停止）
    - `apps/server/test/external-messaging/poller.integration.test.ts`（新）
    - `apps/server/test/external-messaging/fixtures.ts`（新：假 `callHostTool`）
  - 这一步先不做什么：不实现任何真实 connector。
  - 怎么算完成：
    1. 终态结果逐条推进游标；`retry` 后本批剩余消息不被处理
    2. 两个轮询器同时处理同一绑定时不产生重复消息，游标不回退
    3. 同一消息失败 20 次或超过 30 分钟后成为死信并推进
    4. target Bot 不可用不计入死信，循环退出且游标不动
    5. `resetCursor` 会清空游标
    6. poll 调用失败按 2 秒到 60 秒退避，并更新 `consecutiveFailures`、`lastErrorCode`
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/poller.integration.test.ts`
  - 对应需求：`requirements.md` 需求 3 / 验收 3.5、3.6；需求 4 / 验收 4.1 到 4.6；非功能需求 1.1、1.3、2.3
  - 对应设计：`design.md` §2.3.1、§3.3.1、§6.3

### 阶段检查

- [ ] 3.5 入站阶段检查
  - 状态：TODO
  - 这一步到底做什么：用 fixture connector 经真实的 `StdioMcpManager` 跑通入站主链路，并确认 Bot 在 `external_dm` 里能完成一整轮运行。
  - 做完你能看到什么：不是只有服务层测试，而是"connector 进程 → poll → Channel → Bot 真的跑了一轮"。
  - 先依赖什么：3.1、3.2、3.3、3.4
  - 开始前先看：
    - `requirements.md`
    - `design.md` §7.3、§8.1
  - 主要改哪里：
    - `apps/server/test/fixtures/external-messaging-connector/`（新：最小 stdio MCP）
    - `apps/server/test/external-messaging/e2e-inbound.integration.test.ts`（新）
  - 这一步先不做什么：不做外发，不做客户端。
  - 怎么算完成：
    1. fixture 消息走通"poll → 准入 → Mapping → ChannelMessage → wake → Worker 运行"
    2. 测得从 connector 入队到 wake 入队的延迟，p95 不超过 5 秒
    3. Worker 在 `external_dm` 中没有因 Channel 类型报错
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/e2e-inbound.integration.test.ts`
    - 事务边界人工走查
  - 对应需求：`requirements.md` 需求 1、2、3、4、5；非功能需求 1.1、2.1
  - 对应设计：`design.md` §2.3.1 到 §2.3.3、§7.3

---

## 阶段 4：外发

- [x] 4.1 实现外发服务和状态机
  - 状态：DONE
  - 验证记录（2026-11-16，PostgreSQL 16.10 一次性库）：`delivery.integration.test.ts` 31 项通过（连续三次）：sent、failed、uncertain，超时与传输错误与不可解析结果一律 uncertain 且不重发；前置失败；媒体暂存与清理；租约从数据库时钟续期；并发 dispatch 只调用一次；过期恢复只处理过期记录且不碰他人有效租约；恢复之后到达的迟到结果不能覆盖终态。
  - 这一步到底做什么：实现 Delivery 的创建和分发：前置检查、暂存媒体、调用 deliver 工具、把结果归类为 `sent`、`failed` 或 `uncertain`。
  - 做完你能看到什么：给定一条 Delivery，系统最多调用一次 connector，并留下明确的最终状态。
  - 先依赖什么：3.5
  - 开始前先看：
    - `requirements.md` 需求 6 / 验收 6.5 到 6.9；需求 5 / 验收 5.5、5.7
    - `design.md` §2.3.6「分发一次外发」
    - `design.md` §4.2 的 Delivery 状态表
    - `design.md` §6.4「外发至多一次」
  - 主要改哪里：
    - `apps/server/src/services/external-messaging/delivery.ts`（新）
    - `apps/server/src/services/external-messaging/media-exchange.ts`
    - `apps/server/test/external-messaging/delivery.integration.test.ts`（新）
  - 这一步先不做什么：不改 `SendToUser` 入口。
  - 怎么算完成：
    1. 超时、传输错误、结果不可解析一律为 `uncertain`
    2. 调用 provider 之前的任何失败一律为 `failed`
    3. 对同一 Delivery 并发调用 `dispatch` 只产生一次 deliver 调用
    4. 结束后 exchange 外发目录被清理
    5. 状态变化写入消息 metadata 并产生 `external.delivery.updated` 事件
    6. 从创建、媒体暂存到调用结束均持有并续租分发租约；续租失败不能开始发送，迟到结果不能覆盖终态
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/delivery.integration.test.ts`
  - 对应需求：`requirements.md` 需求 6 / 验收 6.5、6.6、6.9、6.10；需求 5 / 验收 5.5、5.7；非功能需求 1.4、2.4
  - 对应设计：`design.md` §2.3.6、§3.2.4、§4.2、§6.4

- [x] 4.2 接入 `external_dm` 内的回复自动路由
  - 状态：DONE
  - 验证记录（2026-11-16，PostgreSQL 16.10 一次性库）：`reply-routing.integration.test.ts` 19 项通过。为让 `to: "dm"` 真正可用，放开了两处共享参数校验（`reference-main-parsers.ts`、`validateSendToUserInput`）允许 widget、secret-request 带 `to`；群聊的限制仍在 `sendVisible` 里，有测试钉住。外部聊天里的 `request_box_help`、`RequestUserForm`、`DraftExternalMessage`、`SendIMessage` 卡片改送应用内 `bot_dm`。
  - 这一步到底做什么：Bot 在 `external_dm` 里调用普通的 `SendToUser` 时，自动把消息写入 Channel 并投递到外部 peer；不支持的类型给出明确拒绝；`to: "dm"` 走应用内私聊。
  - 做完你能看到什么：Bot 不需要知道任何外部地址，回复就回到了原会话，并在工具结果里看到真实投递状态。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 6 / 验收 6.1、6.2、6.3、6.7、6.10
    - `design.md` §2.3.4「`external_dm` 内的回复路由」
    - `design.md` §8.3 决策 D8、D9
    - `apps/server/src/services/internal-tool-service.ts` 的 `SendToUser` 分支
    - `packages/messaging/src/index.ts` 的 `sendVisible` 和 `onPersisted`
  - 主要改哪里：
    - `apps/server/src/services/internal-tool-service.ts`
    - `packages/messaging/src/index.ts`（解析目标 bot_dm，external_dm 的私聊类型不沿用 group 限制）
    - `apps/server/src/services/rich-message-service.ts`（卡片回执与后续 wake 归属目标 bot_dm）
    - `packages/contracts/src/tool-results.ts`（确认结构中的 `external` 字段）
    - `apps/server/test/external-messaging/reply-routing.integration.test.ts`（新）
  - 这一步先不做什么：不做显式地址路径。
  - 怎么算完成：
    1. agent 消息和 `pending` 的 Delivery 在同一事务内创建
    2. 相同 `callId` 重放不产生第二条消息和第二次外发
    3. 未指定 to: dm 时 widget、secret-request 等类型被拒绝且不写入任何消息
    4. `to: "dm"` 的 text、attachment、widget、secret-request、computer-handoff、user-form、external-draft 和 imessage-send 按现有 `bot_dm` 规则写入应用内私聊，且没有 Delivery
    5. `secret-request` 等所有者专属类型按解析后的 `bot_dm` 目标校验，不因来源 Channel 是 `external_dm` 而被误拒绝
    6. 自动回复的 failed、uncertain 返回 sent: false 与 delivery_failed；显式地址路径采用相同语义
    7. 外发失败不创建恢复 wake；卡片回执的后续 wake 仍在目标 bot_dm
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/reply-routing.integration.test.ts`
  - 对应需求：`requirements.md` 需求 6 / 验收 6.1、6.2、6.3、6.7、6.10
  - 对应设计：`design.md` §2.3.4、§5.2

- [x] 4.3 接入显式地址外发
  - 状态：DONE
  - 验证记录（2026-11-16，PostgreSQL 16.10 一次性库）：`platform:peer` 经同一外发服务；无映射返回 `external_peer_unknown` 且不外发；失败与不确定如实返回且不产生恢复 wake；未声明 `messaging` 的平台继续走旧路径。
  - 这一步到底做什么：让 `SendToUser` 的 `channel: "<platform>:<peerId>"` 在目标连接声明了 `messaging` 时改走新的外发服务。
  - 做完你能看到什么：Bot 从应用内私聊也能给已建立映射的外部会话发消息，并且该消息同样出现在 `external_dm` 里。
  - 先依赖什么：4.2
  - 开始前先看：
    - `requirements.md` 需求 6 / 验收 6.4
    - `design.md` §2.3.5「显式地址外发」
    - `apps/server/src/services/plugin/connectors.ts` 的 `deliverConnectedChannel`
  - 主要改哪里：
    - `apps/server/src/services/plugin/connectors.ts`
    - `apps/server/src/services/external-messaging/delivery.ts`（`deliverToAddress`）
    - `apps/server/src/services/internal-tool-service.ts`
    - `apps/server/test/external-messaging/address-delivery.integration.test.ts`（新）
  - 这一步先不做什么：不改未声明 `messaging` 的 connector 的现有行为。
  - 怎么算完成：
    1. 没有活动 Mapping 时返回 `external_peer_unknown` 且不外发
    2. 地址前缀可以用 `messaging.platform` 匹配
    3. `sent`、`failed`、`uncertain` 都原样返回给 `SendToUser`
    4. 外部 Delivery 失败不创建旧的恢复 wake
    5. 现有 `deliverConnectedChannel` 的测试保持通过
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/address-delivery.integration.test.ts`
    - `bun test apps/server/test/plugin`
  - 对应需求：`requirements.md` 需求 6 / 验收 6.4
  - 对应设计：`design.md` §2.3.5

- [x] 4.4 实现启动恢复和生命周期清理
  - 状态：DONE
  - 验证记录（2026-11-16，PostgreSQL 16.10 一次性库）：移除连接、卸载与更新插件三条路径都在同一事务里归档外部会话、将未结束外发置 failed 并删除绑定、映射、回执；归档与取消归档同步映射状态；Receipt 90 天清理；启动与每 30 秒恢复已接入 `AppService`。
  - 这一步到底做什么：处理 Server 重启时未结束的外发，以及连接移除、Bot 删除、Channel 归档、绑定停用和 Receipt 过期。
  - 做完你能看到什么：任何生命周期事件之后都没有孤儿数据，也没有被补发的消息。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 6 / 验收 6.8；需求 7 / 验收 7.6；需求 8
    - `design.md` §2.3.7「启动恢复与生命周期」
    - `apps/server/src/services/startup-recovery.ts`
  - 主要改哪里：
    - `apps/server/src/services/startup-recovery.ts`
    - `apps/server/src/services/external-messaging/delivery.ts`（周期恢复和有条件终态写入）
    - `apps/server/src/app-service.ts`（周期恢复的启停）
    - `apps/server/src/services/plugin-service.ts`（移除连接的路径）
    - `apps/server/src/services/channel-service.ts`（归档与取消归档）
    - `apps/server/src/services/external-messaging/poller.ts`（每日清理）
    - `apps/server/test/external-messaging/lifecycle.integration.test.ts`（新）
  - 这一步先不做什么：不实现 Receipt 的手工管理界面。
  - 怎么算完成：
    1. 启动及每 30 秒的恢复只处理租约已过期的记录：`pending` 变 `failed`、`sending` 变 `uncertain`，且没有任何 deliver 调用
    2. 移除连接后其 `external_dm` 全部归档，四张表无残留
    3. 归档与取消归档 Channel 会同步 Mapping 状态
    4. 90 天前的 Receipt 被清理
    5. 两个 Server 进程同时运行时，启动恢复不会覆盖另一进程持有的有效 Delivery 租约
    6. 启动时尚未过期的孤儿租约会在周期扫描中得到终态；旧进程迟到的完成回调不能覆盖恢复结果
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/lifecycle.integration.test.ts`
  - 对应需求：`requirements.md` 需求 6 / 验收 6.8；需求 7 / 验收 7.6；需求 8 / 验收 8.1 到 8.5
  - 对应设计：`design.md` §2.3.7

### 阶段检查

- [ ] 4.5 外发阶段检查
  - 状态：TODO
  - 这一步到底做什么：用 fixture connector 跑通"入站 → Bot 回复 → 外发"的完整往返，包含一次图片往返。
  - 做完你能看到什么：基础服务对 connector 的全部承诺都已兑现，`009.1` 可以开始集成。
  - 先依赖什么：4.1、4.2、4.3、4.4
  - 开始前先看：
    - `requirements.md`
    - `design.md` §6、§7.4
  - 主要改哪里：
    - `apps/server/test/external-messaging/e2e-roundtrip.integration.test.ts`（新）
  - 这一步先不做什么：不做客户端。
  - 怎么算完成：
    1. 文本和图片各完成一次往返
    2. `design.md` §6 的七条正确性属性都有对应测试
    3. 代码中不存在任何自动重发外发的路径（人工走查加 grep）
  - 怎么验证：
    - `bun test apps/server/test/external-messaging`
    - `bun run typecheck && bun run test`
  - 对应需求：`requirements.md` 需求 1 到 6、需求 8
  - 对应设计：`design.md` §2、§3、§4、§5、§6

---

## 阶段 5：客户端、可观测与验收

- [ ] 5.1 桌面端：绑定设置与 `external_dm` 呈现
  - 状态：IN_REVIEW
  - 验证记录（2026-11-16）：客户端增加 `externalMessaging`、`putExternalMessaging`、`deleteExternalMessaging`（`client.test.ts` 通过）；契约增加 `ExternalMessagingView`、`ExternalDeliveryState` 与 `ChannelView.externalPlatform`；设置页组件 `plugins/external-messaging-settings.tsx` 接入 `connection-configuration.tsx`，由接口返回的 `supported` 决定是否显示，未声明 `messaging` 的连接不显示；侧栏对 `external_dm` 显示平台标识，输入框换成只读提示；Bot 回复下显示 `sent`、`failed`、`uncertain` 三种可区分的投递状态和原因；`needs_attention` 显示修复指引。`bun run check:i18n` 通过，桌面端 `tsc` 通过，`external-delivery-status.test.tsx` 7 项、`channel-view.test.ts` 3 项通过。未完成：设置页组件没有渲染测试（依赖接口和副作用），`check-desktop-budgets.ts` 报告 Electron 构建产物超限（main.js、preload、runtime 体积等）和 settingsServer 分块缺失，这些与本改动无直接关系但未证明先前就失败；人工走查尚未进行。桌面端全量 `bun test` 有 7 项失败，来自另一会话提交的 `plugin-bitwarden-ui.test.tsx` 泄漏全局语言（去掉它后 717 项全部通过）。
  - 这一步到底做什么：在插件连接设置里加入消息入口的开关、Bot 选择和状态；在侧栏和会话区展示 `external_dm`（只读）以及每条回复的投递状态。
  - 做完你能看到什么：用户可以在桌面端完成绑定，看到外部会话的完整记录和每条消息是否送达。
  - 先依赖什么：4.5
  - 开始前先看：
    - `requirements.md` 需求 7 / 验收 7.1、7.2、7.4
    - `design.md` §3.3.4、§3.3.5、§3.2.7
    - `design.md` §8.2 第一条（设置界面落点）
    - `apps/desktop/src/renderer/components/outcomego/sidebar.tsx`、`chat-pane.tsx`
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/sidebar.tsx`
    - `apps/desktop/src/renderer/components/outcomego/chat-pane.tsx`
    - 桌面端插件连接设置组件（位置在本任务开始时确认）
    - `packages/client-core/src/`（视图类型与接口调用）
    - `packages/contracts/src/service-protocol.ts`
    - 桌面端文案目录（中英文）
  - 这一步先不做什么：不做应用内向 `external_dm` 发送；不做移动端。
  - 怎么算完成：
    1. 未声明 `messaging` 的连接不显示消息入口区域
    2. `external_dm` 在侧栏带平台标识，输入框被只读提示替代
    3. `sent`、`failed`、`uncertain` 三种状态有可区分的展示和原因说明
    4. `needs_attention` 状态有明确的修复指引
  - 怎么验证：
    - 桌面端组件测试
    - `bun run check:i18n`
    - `bun scripts/performance/check-desktop-budgets.ts`
    - 人工走查
  - 对应需求：`requirements.md` 需求 7 / 验收 7.1、7.2、7.4
  - 对应设计：`design.md` §3.3.4、§3.3.5

- [ ] 5.2 移动端：隐藏 `external_dm`
  - 状态：IN_REVIEW
  - 验证记录（2026-11-16）：Android 在 `applyBootstrap` 经 `mobileVisibleChannels` 过滤，iOS 在 `AppStore.channels` 与原生通知两处过滤。`scripts/android/package-debug.sh` 构建成功。Android 单元测试 `externalChatsAreNotListedOnMobile` 已写但未运行（仓库约定不直接运行 Gradle）；iOS 无测试、未走查；发布说明尚未注明旧版本的降级表现，所以完成标准第 2 条未满足。
  - 这一步到底做什么：Android 和 iOS 新版本在会话列表中过滤掉 `external_dm`。
  - 做完你能看到什么：新版移动端不会出现无法正常使用的外部会话条目。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 7 / 验收 7.5
    - `design.md` §8.1 第三条（旧版移动客户端）
    - `apps/android/app/src/main/java/com/outcomego/android/data/HttpMobileGateway.kt`
    - `apps/ios/Sources/App/HomeView.swift`、`apps/ios/Sources/App/AppStore.swift`
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/data/HttpMobileGateway.kt`
    - `apps/ios/Sources/App/HomeView.swift`、`apps/ios/Sources/App/AppStore.swift`
    - 对应的移动端测试
  - 这一步先不做什么：不在移动端展示或配置外部消息。
  - 怎么算完成：
    1. 两端列表、未读计数和通知跳转都不包含 `external_dm`
    2. 发布说明注明旧版本的降级表现
  - 怎么验证：
    - iOS 单元测试
    - `bash scripts/android/package-debug.sh` 后人工走查
  - 对应需求：`requirements.md` 需求 7 / 验收 7.5
  - 对应设计：`design.md` §8.1

- [ ] 5.3 可观测与日志脱敏
  - 状态：DONE
  - 验证记录（2026-11-16）：`redaction.test.ts` 5 项通过：连接器失败的原因文本、下载地址、假凭据和正文都不进入日志、`lastErrorCode` 和诊断视图；诊断视图只含约定的字段且不含游标；已接受和已拒绝的消息，Receipt、Binding、Mapping 中都没有正文和假凭据，ChannelMessage 按需求保留正文。`bun test apps/server/test/external-messaging` 共 159 项通过，服务端 `tsc` 通过。诊断字段（最近轮询、最近接受、连续失败、最近错误码、拒绝计数）已由 3.2、3.4 维护。未覆盖：外发投递的 `errorMessage` 只经过控制字符清理和 500 字符截断（`delivery.integration.test.ts` 验证了这两点），连接器若在失败说明里写入下载地址或凭据，Server 不会再过滤；微信 connector 的失败说明是固定文案，目前不会发生，但 Server 侧没有强制保证。
  - 这一步到底做什么：补齐绑定诊断字段的维护、结构化日志和脱敏检查。
  - 做完你能看到什么：出问题时能从诊断接口和日志定位到是哪一步、哪个错误码，日志里没有正文和凭据。
  - 先依赖什么：4.5
  - 开始前先看：
    - `requirements.md` 非功能需求 3、4.2
    - `design.md` §3.2.1 的诊断字段
    - `design.md` §6.6
  - 主要改哪里：
    - `apps/server/src/services/external-messaging/`（各文件的日志点）
    - `apps/server/test/external-messaging/redaction.test.ts`（新）
  - 这一步先不做什么：不接入外部监控系统。
  - 怎么算完成：
    1. 诊断接口能看到最近轮询、最近接受、连续失败、最近错误码和拒绝计数
    2. 日志和诊断结果不含正文、下载地址和假凭据串；Receipt、Binding、Delivery 不含正文和回复凭据，ChannelMessage 按需求保留正文和附件引用
  - 怎么验证：
    - `bun test apps/server/test/external-messaging/redaction.test.ts`
  - 对应需求：`requirements.md` 非功能需求 3 / 3.1 到 3.3；非功能需求 4 / 4.2
  - 对应设计：`design.md` §3.2.1、§6.6

### 最终检查

- [ ] 5.4 基础服务验收并交接给子规格
  - 状态：IN_REVIEW
  - 进展（2026-11-16）：验收清单草稿已写入 `docs/20261116-验收清单.md`，逐行核对了 §7.4，并列出缺口和需要用户参与的事项；`009.1` 没有复制 Server 逻辑的核对已写入。不能签收：§7.4 多行只有部分证据，全量测试因其他会话的 Bitwarden 工作和缺少 `DATABASE_URL` 而不是全绿。
  - 这一步到底做什么：确认本 Spec 达到交付标准，并核对 `009.1` 没有复制任何 Server 逻辑。
  - 做完你能看到什么：需求、设计、任务、验证证据能一一对上，验收结果写入 `docs/`。
  - 先依赖什么：5.1、5.2、5.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
    - `../009.1-微信iLink消息服务集成/tasks.md`
  - 主要改哪里：
    - `specs/009-外部消息服务/docs/20261116-验收清单.md`（新）
    - 当前 Spec 全部文件（状态回写）
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. `design.md` §7.4 的每一行都有通过的测试或人工证据
    2. `requirements.md`「成功定义」逐条成立
    3. `009.1` 复用基础服务；connector 可实现设备链接、poll、deliver、只读状态和 peer 查询，以及本地队列、媒体和 provider 游标，不实现 Server 数据库事务
    4. 风险、延期项、待确认项已更新
  - 怎么验证：
    - `bun run check`
    - 按验收清单逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
