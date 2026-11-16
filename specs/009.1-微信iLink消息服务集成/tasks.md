# 任务清单 - 微信 iLink 消息服务集成（人话版）

状态：IN_PROGRESS

文档关系：

- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- 协议事实与探测清单：[`docs/20261116-iLink协议事实与探测清单.md`](docs/20261116-iLink协议事实与探测清单.md)
- 基础服务任务：[`../009-外部消息服务/tasks.md`](../009-外部消息服务/tasks.md)

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

- connector 测试：`bun run prepare:plugins && bun test packages/plugins/wechat`
- 插件目录与打包：`bun test packages/plugins/test`
- 类型检查：`bun run typecheck`
- 文案检查：`bun run check:i18n`
- connector 运行在远端 Bot Computer 上。要让改动在真实环境生效，必须按 `AGENTS.md`「Remote Debug Computer」同步并重建（`computer` 与 `computer-memory-init` 一起），之后执行 `scripts/dev/debug.sh check`。重建会中断正在运行的 Bot 任务，动手前先征得用户同意。

## 与基础服务的依赖关系

| 本 Spec | 依赖 Spec 009 | 说明 |
| --- | --- | --- |
| 阶段 1、阶段 2 | 无 | 可与 Spec 009 阶段 1、2 并行 |
| 阶段 3 | 任务 1.2（线协议类型） | poll、deliver 的输入输出类型 |
| 阶段 4 | 任务 4.5（外发阶段检查） | 需要完整的入站与外发服务 |

---

## 阶段 1：协议基线与插件骨架

- [x] 1.1 建立并修订 Spec 009.1
  - 状态：DONE
  - 这一步到底做什么：把微信实现从基础外部消息服务中拆成独立子规格，并按复核意见补齐协议事实、决策和任务。
  - 做完你能看到什么：需求、设计、任务和协议事实文档互相引用，决策记录在 `design.md` §8.3。
  - 先依赖什么：无
  - 开始前先看：
    - `specs/000-Spec规范/Spec模板/`
    - `../009-外部消息服务/design.md`
  - 主要改哪里：
    - `specs/009.1-微信iLink消息服务集成/*`
  - 这一步先不做什么：不写代码。
  - 怎么算完成：
    1. `design.md` §7.4 的验证映射覆盖全部需求
    2. 尚未验证的协议事实都列为探测项
  - 怎么验证：
    - 人工走查文档引用
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [ ] 1.2 固定协议基线并完成实机探测
  - 状态：TODO
  - 这一步到底做什么：选定一个 `Tencent/openclaw-weixin` 版本作为参考，用一个有 ClawBot 入口的微信号逐项验证探测清单，把结论和脱敏样例写回协议事实文档。
  - 做完你能看到什么：协议事实文档里每个探测项都有"实测结论"，每个决策门都有明确走向。
  - 先依赖什么：1.1；需要用户提供一个已获得 ClawBot 入口的微信号
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §8.2「待确认项」
    - `docs/20261116-iLink协议事实与探测清单.md` 全文
  - 主要改哪里：
    - `specs/009.1-微信iLink消息服务集成/docs/20261116-iLink协议事实与探测清单.md`
    - `specs/009.1-微信iLink消息服务集成/docs/`（脱敏的请求响应样例）
    - 一次性探测脚本放在不入库的临时目录，不提交
  - 这一步先不做什么：不写 connector 产品代码；不把任何真实 token、用户标识、游标或消息正文写入仓库。
  - 怎么算完成：
    1. 参考版本号和提交哈希已记录
    2. P1 到 P11 全部有实测结论和日期
    3. 决策门中受影响的设计条目已在 `design.md` 中更新
    4. 若 P1 或 P11 的结论要求扩大范围，已新增任务或另立 Spec
  - 怎么验证：
    - 人工走查探测记录
    - 检查入库文件中不含敏感值
  - 对应需求：`requirements.md` 需求 1 / 验收 1.1
  - 对应设计：`design.md` §8.2

- [ ] 1.3 建立插件骨架
  - 状态：TODO
  - 这一步到底做什么：创建 `packages/plugins/wechat`，包含 manifest、MCP server 入口、工具注册和占位实现，并接入插件目录与打包流程。
  - 做完你能看到什么：插件出现在目录中，connector 进程能启动并列出工具，host-only 工具带有正确标记。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 6 / 验收 6.1；需求 7 / 验收 7.4
    - `design.md` §2.2「模块职责」、§3.2.7「manifest 关键片段」、§3.3.1「MCP 工具一览」
    - `packages/plugins/whatsapp/plugin.json`、`connector/server.ts`、`connector/tools.ts`
    - `packages/plugins/scripts/generate.ts`
  - 主要改哪里：
    - `packages/plugins/wechat/plugin.json`
    - `packages/plugins/wechat/connector/server.ts`、`tools.ts`
    - `packages/plugins/wechat/connector/test/tools.test.ts`、`package.test.ts`
    - `packages/plugins/test/catalog.test.ts`
  - 这一步先不做什么：manifest 暂不加入 `messaging` 块（等任务 4.1）；不访问真实网络；不实现媒体。
  - 怎么算完成：
    1. `bun run prepare:plugins` 能生成 `connector/server.mjs`
    2. 工具发现返回 §3.3.1 的八个工具，除 `connection_status` 外都带 host-only 标记
    3. 打包往返和目录测试通过
  - 怎么验证：
    - `bun test packages/plugins/wechat`
    - `bun test packages/plugins/test/catalog.test.ts`
  - 对应需求：`requirements.md` 需求 7 / 验收 7.4；非功能需求 3.3
  - 对应设计：`design.md` §2.2、§3.3.1

- [ ] 1.4 实现 iLink API client 和 simulator
  - 状态：TODO
  - 这一步到底做什么：封装全部 iLink 请求（请求头、`base_info`、域名校验、超时、错误映射、64 位整数无损解析），并写一个可编排的本地模拟服务。
  - 做完你能看到什么：不联网就能对每个接口做请求和响应断言；任何指向非微信域名的地址都会被拒绝。
  - 先依赖什么：1.2、1.3
  - 开始前先看：
    - `requirements.md` 需求 1 / 验收 1.2 到 1.6；非功能需求 3.4、4.1
    - `design.md` §3.3.2「iLink 接口」、§6.7
    - `docs/20261116-iLink协议事实与探测清单.md` 的接口与常量部分
  - 主要改哪里：
    - `packages/plugins/wechat/connector/api.ts`、`json.ts`、`protocol.ts`（协议类型与常量）
    - `packages/plugins/wechat/connector/test/api.test.ts`、`json.test.ts`
    - `packages/plugins/wechat/connector/test/fixtures/ilink-simulator.ts`
  - 这一步先不做什么：不实现状态机和循环；不提供替换基座地址的环境变量。
  - 怎么算完成：
    1. `X-WECHAT-UIN` 每次请求都不同
    2. 超过 2^53 的 `message_id` 解析后与原文逐位一致
    3. 非 `https`、非 `weixin.qq.com` 子域、HTTP 重定向三种情况都被拒绝
    4. simulator 能编排：空轮询、多条消息、`-14`、超时、重放与不重放两种游标模式
  - 怎么验证：
    - `bun test packages/plugins/wechat/connector/test/api.test.ts packages/plugins/wechat/connector/test/json.test.ts`
  - 对应需求：`requirements.md` 需求 1 / 验收 1.2 到 1.6
  - 对应设计：`design.md` §3.3.2、§6.7

---

## 阶段 2：二维码与账户状态

- [ ] 2.1 实现持久状态
  - 状态：TODO
  - 这一步到底做什么：实现状态目录的布局、版本化文件的原子读写和损坏处理。
  - 做完你能看到什么：任意时刻杀进程，状态文件要么是旧内容要么是新内容，不会是半截。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2 / 验收 2.2；非功能需求 2.2、4.3
    - `design.md` §3.2.1 到 §3.2.3、§5.3 第 5 条
  - 主要改哪里：
    - `packages/plugins/wechat/connector/state.ts`
    - `packages/plugins/wechat/connector/test/state.test.ts`
  - 这一步先不做什么：不实现队列（留给 3.1）。
  - 怎么算完成：
    1. 写入流程为"临时文件 → 刷盘 → 原子改名"，权限 `0600`
    2. 损坏的 `account.json` 被视为未链接，不抛出未处理异常
    3. 版本号不匹配时有明确的迁移或重置路径
  - 怎么验证：
    - `bun test packages/plugins/wechat/connector/test/state.test.ts`
  - 对应需求：`requirements.md` 需求 2 / 验收 2.2；非功能需求 2.2、4.3
  - 对应设计：`design.md` §3.2.1、§3.2.2、§3.2.3

- [ ] 2.2 实现二维码流程和账户状态机
  - 状态：TODO
  - 这一步到底做什么：实现五个设备链接工具、二维码刷新、基座地址切换、确认后保存凭据、重启恢复，以及 `connection_status`。
  - 做完你能看到什么：在 simulator 上能完整走完"开始 → 扫码 → 确认 → 就绪"，重启后无需再扫码。
  - 先依赖什么：1.4、2.1
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.1「二维码链接」、§4.2「状态流转」、§3.3.3
    - `packages/plugins/whatsapp/connector/account.ts`
    - `apps/server/src/services/plugin/device-link.ts`
    - 协议事实文档中 P1 的结论
  - 主要改哪里：
    - `packages/plugins/wechat/connector/account.ts`
    - `packages/plugins/wechat/connector/tools.ts`
    - `packages/plugins/_shared/`（二维码 PNG 编码器的复用，连同许可说明）
    - `packages/plugins/wechat/connector/test/account.test.ts`、`host-integration.test.ts`
    - `packages/plugins/wechat/connector/test/fixtures/`（测试入口脚本）
  - 这一步先不做什么：不启动真实的接收循环（用可注入的桩代替）；不发送消息。
  - 怎么算完成：
    1. 二维码过期后在同一 `sessionId` 下刷新，最多 3 次
    2. 取消链接不影响已有的有效凭据
    3. 账户更换时队列被重建，同一账户重新扫码时只清空 provider 游标和会话令牌
    4. 移除账户后状态目录为空
    5. 任何工具结果中都搜不到假 token 串
  - 怎么验证：
    - `bun test packages/plugins/wechat/connector/test/account.test.ts packages/plugins/wechat/connector/test/host-integration.test.ts`
  - 对应需求：`requirements.md` 需求 2 / 验收 2.1 到 2.7、2.9；需求 6 / 验收 6.6
  - 对应设计：`design.md` §2.3.1、§3.3.1、§3.3.3、§4.2

### 阶段检查

- [ ] 2.3 二维码阶段检查
  - 状态：TODO
  - 这一步到底做什么：只检查链接和状态是否站稳，不扩新范围。
  - 做完你能看到什么：可以放心在其上叠加收发逻辑。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 1、2
    - `design.md` §2.3.1、§4.2、§6.6、§6.7
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. host-only 工具对 Bot 不可见
    2. 敏感值扫描测试覆盖全部已实现的工具
    3. 打包往返通过
  - 怎么验证：
    - `bun test packages/plugins/wechat`
    - `bun test packages/plugins/test`
  - 对应需求：`requirements.md` 需求 1、2；非功能需求 3
  - 对应设计：`design.md` §2.3.1、§6.6、§6.7

---

## 阶段 3：入站与外发（connector 侧）

- [ ] 3.1 实现落盘队列和 poll 工具
  - 状态：TODO
  - 这一步到底做什么：实现入站消息的磁盘队列（追加、去重、确认删除、压缩、损坏恢复、等待通知），并用它实现 `wechat_poll_inbound`。
  - 做完你能看到什么：往队列里放消息后，poll 工具能按确认游标逐批取出，确认后的消息和文件被清理。
  - 先依赖什么：2.3；Spec 009 任务 1.2
  - 开始前先看：
    - `requirements.md` 需求 3 / 验收 3.3、3.6、3.7、3.8
    - `design.md` §2.3.3「poll 工具」、§3.2.4「队列项」
    - `../009-外部消息服务/design.md` §3.2.6、§3.3.1
  - 主要改哪里：
    - `packages/plugins/wechat/connector/spool.ts`
    - `packages/plugins/wechat/connector/tools.ts`
    - `packages/plugins/wechat/connector/test/spool.test.ts`
  - 这一步先不做什么：不接 iLink；不处理媒体下载。
  - 怎么算完成：
    1. `ackCursor` 严格递增，格式为 `<queueId>:<seq>`
    2. 游标不属于当前队列时返回 `resetCursor: true`
    3. 空队列时 poll 挂起，入队后 200 毫秒内返回；新 poll 到达时旧 poll 立即返回
    4. 日志尾部损坏时截断到最后一条完整记录
    5. 账户未链接且队列为空时返回 `wechat_needs_pairing`；队列非空时照常返回消息
  - 怎么验证：
    - `bun test packages/plugins/wechat/connector/test/spool.test.ts`
  - 对应需求：`requirements.md` 需求 3 / 验收 3.3、3.6、3.7、3.8；非功能需求 1.2
  - 对应设计：`design.md` §2.3.3、§3.2.4、§6.2、§6.3

- [ ] 3.2 实现接收循环和消息标准化
  - 状态：TODO
  - 这一步到底做什么：实现后台长轮询、过滤、转换为 `ExternalMessage`、入队、保存 provider 游标、退避、背压，以及 `getupdates` 上的会话过期处理。
  - 做完你能看到什么：simulator 发出的消息会自动出现在队列里；在任意时间点杀进程都不丢不重。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 3 / 验收 3.1、3.2、3.4、3.5、3.9、3.10；需求 2 / 验收 2.8
    - `design.md` §2.3.2「接收循环」、§2.3.5「会话过期」、§3.2.5「映射」
    - 协议事实文档中 P2、P3、P9、P10 的结论
  - 主要改哪里：
    - `packages/plugins/wechat/connector/receive.ts`、`normalize.ts`
    - `packages/plugins/wechat/connector/account.ts`（循环启停与会话过期）
    - `packages/plugins/wechat/connector/test/receive.test.ts`、`normalize.test.ts`、`crash.test.ts`
  - 这一步先不做什么：媒体项先全部记为 `mediaFailures`（留给 3.3）；不做外发。
  - 怎么算完成：
    1. provider 游标只在本批全部入队之后保存
    2. `crash.test.ts` 在两个崩溃点、两种 simulator 模式下都不丢不重
    3. bot 自身消息和群消息被丢弃并计数
    4. `isAccountOwner` 只在发送者等于 `ilinkUserId` 时为真
    5. `-14` 触发冷却，冷却后探活成功可自愈，失败则清除凭据
    6. 队列达到上限时停止拉取，回落后恢复
  - 怎么验证：
    - `bun test packages/plugins/wechat/connector/test/receive.test.ts packages/plugins/wechat/connector/test/normalize.test.ts packages/plugins/wechat/connector/test/crash.test.ts`
  - 对应需求：`requirements.md` 需求 3 / 验收 3.1、3.2、3.4、3.5、3.9、3.10；需求 2 / 验收 2.3、2.8；需求 4 / 验收 4.1；非功能需求 1.1、2.1、2.4
  - 对应设计：`design.md` §2.3.2、§2.3.5、§3.2.5、§6.1、§6.2

- [ ] 3.3 实现入站媒体
  - 状态：TODO
  - 这一步到底做什么：下载、解密入站的图片、文件和视频，写入 exchange 入站目录，并处理语音转写。
  - 做完你能看到什么：带图片的消息入队后，exchange 目录里有对应的明文文件，大小和摘要与消息里声明的一致。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.1 到 5.4、5.8
    - `design.md` §2.3.4「媒体」入站部分
    - 协议事实文档的媒体部分和 P8 的结论
  - 主要改哪里：
    - `packages/plugins/wechat/connector/media.ts`
    - `packages/plugins/wechat/connector/receive.ts`
    - `packages/plugins/wechat/connector/test/media.test.ts`
    - simulator 的 CDN 部分
  - 这一步先不做什么：不做外发上传。
  - 怎么算完成：
    1. 两种密钥编码都能正确解密
    2. 声明超限的媒体不下载；下载中超限立即中止
    3. 连续 3 次失败后记入 `mediaFailures`，消息其余部分照常入队
    4. 落盘文件名由 connector 生成，与微信文件名无关
    5. 日志中没有下载地址和密钥
  - 怎么验证：
    - `bun test packages/plugins/wechat/connector/test/media.test.ts`
  - 对应需求：`requirements.md` 需求 5 / 验收 5.1 到 5.4、5.8；非功能需求 3.2
  - 对应设计：`design.md` §2.3.4、§6.6

- [ ] 3.4 实现文本外发
  - 状态：TODO
  - 这一步到底做什么：实现 `wechat_deliver_message` 的文本路径：会话令牌与窗口检查、分片、限速、幂等日志、结果归类，以及 `sendmessage` 上的 `-14` 处理。
  - 做完你能看到什么：给定一个 `deliveryId`，connector 最多发送一次，并明确告诉调用方是成功、确定失败还是结果不明。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.6「外发」、§3.2.6「文本分片规则」、§5.1
    - `../009-外部消息服务/design.md` §3.3.2
    - 协议事实文档中 P5、P6 的结论
  - 主要改哪里：
    - `packages/plugins/wechat/connector/deliver.ts`
    - `packages/plugins/wechat/connector/tools.ts`
    - `packages/plugins/wechat/connector/test/deliver.test.ts`
  - 这一步先不做什么：不做媒体外发；不自动重试任何发送。
  - 怎么算完成：
    1. 没有令牌、令牌过期、超限速时都在发出请求之前返回 `failed`
    2. 第一条被拒为 `failed`，后续被拒为 `uncertain`（`wechat_partial_delivery`）
    3. 超时和连接中断为 `uncertain`
    4. 相同 `deliveryId` 重复调用不产生新的 `sendmessage`
    5. 发送中途杀进程后再次调用返回 `uncertain`（`wechat_delivery_interrupted`）
    6. `sendmessage` 的 `-14` 只作废该 peer 的令牌，账户状态不变
    7. 分片不切断代理对，不产生空分片
  - 怎么验证：
    - `bun test packages/plugins/wechat/connector/test/deliver.test.ts`
  - 对应需求：`requirements.md` 需求 4 / 验收 4.2 到 4.10；非功能需求 2.3
  - 对应设计：`design.md` §2.3.5、§2.3.6、§3.2.6、§6.4、§6.5

- [ ] 3.5 实现外发图片
  - 状态：TODO
  - 这一步到底做什么：从 exchange 外发目录读取并校验文件，完成"申请上传地址 → 加密 → 上传 CDN → 发送媒体引用"。
  - 做完你能看到什么：simulator 收到一条媒体消息，其引用的密文解密后与原文件一致。
  - 先依赖什么：3.3、3.4
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.5 到 5.8
    - `design.md` §2.3.4「媒体」外发部分、§8.3 决策 W6
    - 协议事实文档的媒体部分和 P7 的结论
  - 主要改哪里：
    - `packages/plugins/wechat/connector/media.ts`、`deliver.ts`
    - `packages/plugins/wechat/connector/test/media.test.ts`、`roundtrip.test.ts`
  - 这一步先不做什么：不实现语音外发；文件与视频只有在 P7 通过后才在 manifest 中声明。
  - 怎么算完成：
    1. 路径越界、符号链接、大小或摘要不符都在发出请求之前返回 `wechat_media_invalid`
    2. 上传失败返回 `wechat_media_upload_failed`，此时没有任何 `sendmessage`
    3. 文本加图片的外发按"文本在前、图片在后"发送
  - 怎么验证：
    - `bun test packages/plugins/wechat/connector/test/media.test.ts packages/plugins/wechat/connector/test/roundtrip.test.ts`
  - 对应需求：`requirements.md` 需求 5 / 验收 5.5 到 5.8
  - 对应设计：`design.md` §2.3.4、§2.3.6

### 阶段检查

- [ ] 3.6 connector 阶段检查
  - 状态：TODO
  - 这一步到底做什么：确认 connector 在 simulator 上已经是一个完整、可独立验证的收发组件。
  - 做完你能看到什么：不依赖 Spec 009 的 Server 服务，就能证明 connector 侧的全部正确性属性。
  - 先依赖什么：3.1、3.2、3.3、3.4、3.5
  - 开始前先看：
    - `requirements.md`
    - `design.md` §6、§7.4
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不接 Server。
  - 怎么算完成：
    1. `design.md` §6 的七条属性都有对应测试
    2. 敏感值扫描覆盖 poll、deliver、`connection_status` 的全部结果和日志输出
    3. connector 代码中没有 Channel、Receipt、Delivery 相关逻辑
  - 怎么验证：
    - `bun test packages/plugins/wechat`
    - `bun run typecheck`
  - 对应需求：`requirements.md` 需求 1 到 5
  - 对应设计：`design.md` §2、§3、§5、§6

---

## 阶段 4：接入 OpenTeam

- [ ] 4.1 声明 `messaging` 并完成与 Spec 009 的集成测试
  - 状态：TODO
  - 这一步到底做什么：在 manifest 中加入 `messaging` 块，用 simulator 加真实 connector 进程加 Spec 009 服务跑通完整往返。
  - 做完你能看到什么：simulator 里的一条"微信消息"变成 `external_dm` 里的用户消息并唤醒 Bot，Bot 的回复变成 simulator 收到的 `sendmessage`。
  - 先依赖什么：3.6；Spec 009 任务 4.5
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §3.2.7、§7.3
    - `../009-外部消息服务/design.md` §2.3.1、§2.3.4、§3.2.8
  - 主要改哪里：
    - `packages/plugins/wechat/plugin.json`
    - `apps/server/test/external-messaging/wechat.integration.test.ts`（新）
  - 这一步先不做什么：不在 Server 中加入任何微信专属分支；不实现 automation trigger。
  - 怎么算完成：
    1. 文本和图片各完成一次往返
    2. 重启 connector 进程后继续收发，没有重复 Channel 和重复消息
    3. 模拟非所有者发来的消息被 Spec 009 以 `external_sender_not_allowed` 拒绝
    4. 会话窗口过期时 Bot 在工具结果里看到 `wechat_context_expired`
    5. 为跑通本任务没有修改 `apps/server/src/services/external-messaging/` 下的任何文件；如必须修改，说明基础服务有缺口并回到 Spec 009 处理
  - 怎么验证：
    - `bun run prepare:plugins && bun test apps/server/test/external-messaging/wechat.integration.test.ts`
  - 对应需求：`requirements.md` 需求 6 / 验收 6.1 到 6.5
  - 对应设计：`design.md` §3.2.5、§3.2.7、§7.3

- [ ] 4.2 补齐文案、技能、图标和说明
  - 状态：TODO
  - 这一步到底做什么：完成插件的用户可见部分和给 Bot 的使用说明。
  - 做完你能看到什么：插件目录里有完整的中英文介绍和连接步骤；Bot 知道在微信会话里该怎么回复、有哪些限制。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §8.1「风险」（需要告知用户的限制）
    - `packages/plugins/whatsapp/locales/zh-CN.json`、`skills/`、`assets/SOURCES.md`、`NOTICE.md`
  - 主要改哪里：
    - `packages/plugins/wechat/plugin.json`（说明、步骤）
    - `packages/plugins/wechat/locales/zh-CN.json`
    - `packages/plugins/wechat/skills/wechat/SKILL.md`
    - `packages/plugins/wechat/assets/`（图标与来源说明）
    - `packages/plugins/wechat/README.md`、`NOTICE.md`
  - 这一步先不做什么：不承诺协议不支持的能力（主动发送、群聊、语音外发）。
  - 怎么算完成：
    1. 连接步骤说明了 ClawBot 资格要求和"先在微信里给 bot 发一条消息"
    2. 技能说明覆盖：回复自动送达、只发文本和图片、会话窗口、卡片类内容使用 `to: "dm"`、`sent` 不等于对方已收到
    3. `NOTICE.md` 说明协议参考来源和独立实现
    4. 图标的使用符合其来源的许可
  - 怎么验证：
    - `bun run check:i18n`
    - `bun test packages/plugins/test/catalog.test.ts`
    - 人工走查文案
  - 对应需求：`requirements.md` 需求 7 / 验收 7.1 到 7.4
  - 对应设计：`design.md` §3.2.7、§8.1

- [ ] 4.3 远端 computer 实机联调
  - 状态：TODO
  - 这一步到底做什么：把 connector 同步到远端 debug computer，用真实微信号按联调清单逐项验证。
  - 做完你能看到什么：在真实微信里给 bot 发消息能得到 OpenTeam Bot 的回复，联调记录写入 `docs/`。
  - 先依赖什么：4.1、4.2；Spec 009 任务 5.1（桌面端绑定设置）；需要用户同意重建远端 computer
  - 开始前先看：
    - `AGENTS.md`「Remote Debug Computer」
    - `design.md` §7.3、§8.1
    - 协议事实文档中 P11 的结论
  - 主要改哪里：
    - `specs/009.1-微信iLink消息服务集成/docs/20261116-实机联调记录.md`（新）
  - 这一步先不做什么：不触碰 `openteam-dev` 项目和 `~/openteam-debug/data`；不把真实凭据或聊天内容写入记录。
  - 怎么算完成：
    1. 远端 `computer` 状态为 `healthy`，`scripts/dev/debug.sh check` 通过
    2. 扫码连接、文本往返、图片入站、图片外发各成功一次
    3. 重建 computer 后无需重新扫码，重建期间发出的微信消息在恢复后被处理
    4. 超过会话窗口后的回复被如实记为失败
    5. 实测的端到端延迟已记录
  - 怎么验证：
    - `ssh -o BatchMode=yes ubuntu@10.255.0.45 'docker ps --filter name=openteam-debug'`
    - `scripts/dev/debug.sh check`
    - 按联调清单逐项勾选
  - 对应需求：`requirements.md` 需求 2 / 验收 2.3；需求 6 / 验收 6.2 到 6.4；非功能需求 2.1
  - 对应设计：`design.md` §7.3

### 最终检查

- [ ] 4.4 微信子规格验收
  - 状态：TODO
  - 这一步到底做什么：确认从二维码、凭据、接收、队列、媒体、Channel、Bot wake 到回复的证据完整，并回写文档状态。
  - 做完你能看到什么：需求、设计、任务、验证证据能一一对上。
  - 先依赖什么：4.1、4.2、4.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：
    - `specs/009.1-微信iLink消息服务集成/docs/20261116-验收清单.md`（新）
    - 当前 Spec 全部文件（状态回写）
  - 这一步先不做什么：不添加 QQ、群聊或 automation trigger。
  - 怎么算完成：
    1. `design.md` §7.4 的每一行都有通过的测试或联调证据
    2. `requirements.md`「成功定义」逐条成立
    3. `design.md` §8.2 的待确认项全部关闭或转为已知限制
    4. 产品层面对第三方接入风险的确认已记录
  - 怎么验证：
    - `bun test packages/plugins/wechat`
    - `bun test apps/server/test/external-messaging/wechat.integration.test.ts`
    - `bun run typecheck && bun run check:i18n`
    - 按验收清单逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
