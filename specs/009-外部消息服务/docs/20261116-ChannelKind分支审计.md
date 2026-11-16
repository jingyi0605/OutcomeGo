# ChannelKind 分支审计

对应任务：`tasks.md` 任务 2.1。对应需求：`requirements.md` 需求 2 / 验收 2.6，需求 7 / 验收 7.3，非功能需求 3.4。对应设计：`design.md` §3.2.5、§3.3.5、§6.7。

## 范围与方法

- 日期：2026-11-16。
- 范围：`apps/server/src`、`apps/worker/src`、`packages/messaging/src`、`packages/product-core/src`、桌面端渲染进程、Android 与 iOS 客户端。
- 方法：用 `grep -rnE '"bot_dm"|"agent_dm"|"external_dm"|kind (===|!==|:) "group"'` 取得全部分支，再逐处判断 `external_dm` 出现时的行为。外部消息服务自己的目录 `apps/server/src/services/external-messaging/` 不在审计范围内，它只处理 `external_dm`。
- 结论只有两种：**无需改动**（`external_dm` 自然落到正确行为，并说明原因）；**已改动**（写明改了什么、为什么）。
- 判断原则：`external_dm` 是 Bot 与一个外部对端的一对一会话，在 Bot 视角里按私聊处理；但它不是应用内私聊，因此任何"取这个 Bot 的私聊"的查询仍然只能命中 `bot_dm`。

## 一、仍只认 `bot_dm` 的查询：无需改动

这些位置的语义是"这个 Bot 在应用里的私聊"。`external_dm` 不匹配，是期望行为。`channel-kind-regression.integration.test.ts` 验证了：外部会话先于或后于 `bot_dm` 创建，`dmChannelId`、`kind` 与 `directKey` 的查询结果都不变。

| 位置 | 用途 | 结论 |
| --- | --- | --- |
| `services/view-mappers.ts:75` `toBotView.dmChannelId` | 找 Bot 的私聊 ID | 无需改动：仍取 `bot_dm` |
| `services/snapshot-service.ts:157、244、349` | 只有存在 `bot_dm` 的 Bot 才进入快照 | 无需改动：Bot 一定有 `bot_dm` |
| `services/startup-recovery.ts:313`、`worker.ts:875、1046` | 首次引导找私聊 | 无需改动：引导只发生在应用私聊 |
| `services/bot-service.ts:109`、`worker.ts:741、1957`、`projection.ts:477`、`subagent/service.ts:642、757` | 创建或查找 Bot 私聊 | 无需改动 |
| `services/process-secrets.ts:18`、`channel/direct-profile.ts:64、84`、`shared-template-service.ts:26` | 按 `directKey: bot:<id>` 查私聊 | 无需改动：`external_dm` 的 `directKey` 是 `external:<mappingId>` |
| `services/rich-message-service.ts:294` | 网络策略审批只在私聊生效 | 无需改动：外部会话里发起的审批卡经 `to: "dm"` 落到 `bot_dm`，在应用内完成 |
| `services/internal-tool-service.ts:447` | 求助请求目标私聊 | 无需改动：见下文"已改动"中的路由 |
| `packages/messaging/src/draft-notifications.ts:163` | 草稿通知落到私聊 | 无需改动 |
| `packages/messaging/src/index.ts:1132、2045、2942` | 找 Bot 私聊、写私聊消息 | 无需改动 |
| `packages/messaging/src/read-agent-activity.ts:37` | 读取 Bot 私聊活动 | 无需改动 |
| `packages/messaging/src/agent-data.ts:1442` | 修复旧版隐藏标记，只处理 `bot_dm`、`group` | 无需改动：`external_dm` 从未被隐藏 |
| `worker.ts:2002` | 仅 `bot_dm` 发推送通知 | 无需改动：外部会话由此保持静默，另有 `notifications.ts` 双重保证 |

## 二、"是否为群聊"的分支：无需改动

这些位置只区分 `group` 与"其他"。`external_dm` 属于"其他"，与私聊一致，符合期望。

| 位置 | 用途 | 结论 |
| --- | --- | --- |
| `services/channel-service.ts:96`（`bot_dm` 取会话 ID） | 私聊会话 | 无需改动 |
| `services/voice-service.ts:155、292、520、525、527` | 群聊语音与私聊语音的分流 | 无需改动：入口已先拒绝 `external_dm`（见下文） |
| `services/rich-message-service.ts:143` | 群聊里不支持表单卡 | 无需改动：外部会话不是群聊，表单经 `to: "dm"` 去私聊 |
| `packages/messaging/src/routines.ts:53、1180、1304、1402、1978` | Routine 按群聊或 Bot 归属 | 无需改动：Routine 所有者只可能是 Bot 或群聊 |
| `packages/messaging/src/sibling-threads.ts:23、29` | 兄弟会话列表，排除 `agent_dm` | 无需改动：`external_dm` 以普通会话出现，这是 Bot 读取自己全部对话时的预期 |
| `packages/messaging/src/read-transcript.ts:69`、`index.ts:3193、3198` | 读取会话记录，排除 `agent_dm` | 无需改动：Bot 可回看自己与外部对端的对话 |
| `packages/messaging/src/index.ts:1199` | 投递失败的恢复通知，群聊不发 | 无需改动：外部投递失败不触发恢复唤醒，状态写在消息元数据里，由 `delivery.ts` 负责 |
| `packages/messaging/src/index.ts:2423、2426、2675、2734、2743、2859、2867、2894、2913、3076` | 群聊发言、反应、锁、投递确认 | 无需改动：均为群聊专有逻辑 |
| `packages/messaging/src/index.ts:2753` | `agent_dm` 不允许可见发送 | 无需改动 |
| `worker.ts:700、2327` | 群聊复活说明与群聊目录 | 无需改动 |
| `apps/server/src/app-service.ts:367` | 查群聊 | 无需改动 |
| `packages/messaging/src/agent-data.ts:1025` | 是否群聊 | 无需改动 |

## 三、已改动的分支

| 位置 | 改动 | 原因 | 验证 |
| --- | --- | --- | --- |
| `services/channel-service.ts:339` | 应用内向 `external_dm` 发消息返回 409 `external_channel_read_only` | 验收 2.6：应用内不得向外部会话写入 | `channel-kind-regression.integration.test.ts` |
| `services/voice-service.ts:174` | 创建语音会话时拒绝 `external_dm`，同样返回 409 | 外部会话没有语音通路 | 无专门测试，仅 `tsc` 通过 |
| `packages/messaging/src/notifications.ts:36-38` | 对 `external_dm` 不生成推送和通知标题 | 非功能需求 3.4：外部会话静默；与 `worker.ts:2002` 双重保证 | 同上 |
| `packages/product-core/src/snapshot.ts:105-106` | 行投影把 `external_dm` 的成员当作 Bot 取出 | 桌面端侧栏需要 Bot 信息渲染外部会话 | `packages/product-core/test/product-core.test.ts`「lists an external chat with its Bot」 |
| `packages/messaging/src/index.ts:2761-2770` | 在 `external_dm` 里发卡片、密钥请求、审批等，经 `to: "dm"` 落到 Bot 的 `bot_dm` | 外部平台只能收文本和附件，应用内才能处理卡片 | `reply-routing.integration.test.ts`（卡片、密钥请求、接管电脑请求落到私聊） |
| `services/internal-tool-service.ts:771-804` | `SendToUser` 在 `external_dm` 内自动回复到外部；显式 `平台:对端` 地址经 `resolveAddress` 解析，未知对端返回 `external_peer_unknown` | 需求 6：外发路由 | `reply-routing.integration.test.ts`、`delivery.integration.test.ts` |
| `services/external-draft-service.ts:250`、`services/messages-send-service.ts:64` | 视 `external_dm` 与 `group` 同为"会话房间"，卡片转到私聊 | 避免外部会话里出现无人能处理的卡片 | 无专门测试，仅 `tsc` 通过 |
| `services/rich-message-service.ts:149` | 表单卡来自 `external_dm` 时带 `to: "dm"` | 同上 | 无专门测试，仅 `tsc` 通过 |
| `services/snapshot/views.ts`、`services/snapshot/roster-queries.ts`、`services/snapshot-service.ts` | `ChannelView` 增加可选字段 `externalPlatform`，取自映射的 `platform` | 桌面端侧栏需要平台标识（任务 5.1） | `channel-view.test.ts`（3 项） |

## 四、客户端分支

### 桌面端

| 位置 | 结论 |
| --- | --- |
| `sidebar.tsx` 名称旁标签 | 已改动：`external_dm` 显示平台标识（微信等） |
| `sidebar.tsx` `isPinnableChannel` | 无需改动：外部会话不可置顶，与设计一致 |
| `sidebar.tsx` 各处 `bot_dm`、`group` 分支（右键菜单、预览、拖拽） | 无需改动：外部会话没有 Bot 菜单和群菜单，落到默认的普通行 |
| `chat-pane.tsx` 输入区 | 已改动：`external_dm` 用只读提示替代输入框，说明会话来自哪个平台 |
| `chat-pane.tsx` 消息行 | 已改动：Bot 回复下显示投递状态（`ExternalDeliveryStatus`） |
| `chat-pane.tsx` 其余 `bot_dm`、`group` 分支（A2A 折叠、群聊头像） | 无需改动：外部会话是单 Bot 会话，不需要群聊头像和 A2A 折叠 |
| `App.tsx`、`desktop-header.tsx`、`inspector.tsx`、`avatar.tsx`、`notifications.ts`、`channel-selection.ts` | 无需改动：`external_dm` 走通用路径，`tsc` 通过；头像回退为 Bot 头像拼贴 |
| `plugins/connection-configuration.tsx` | 已改动：新增 `ExternalMessagingSettings`（开关、Bot 选择、诊断） |

### 移动端

| 位置 | 结论 |
| --- | --- |
| `apps/android/.../HttpMobileGateway.kt` `applyBootstrap` | 已改动：`mobileVisibleChannels` 过滤 `external_dm`，目录、未读计数和通知跳转都不含它。单元测试 `externalChatsAreNotListedOnMobile` 已写，尚未运行（见下） |
| `apps/ios/Sources/App/AppStore.swift` `channels` 与 `NativeNotifications.apply` | 已改动：两处都过滤 `external_dm` |

## 五、未完成或未验证的部分

- Android 单元测试已加入，但本仓库约定只能用 `scripts/android/package-debug.sh` 构建，不直接运行 Gradle，所以该测试未运行；构建本身通过（`assembleDebug` 成功）。
- iOS 的过滤没有单元测试，也没有在模拟器上走查：`AppStore` 在 App 目标内，现有 `CoreTests` 不覆盖它。需要人工走查。
- 桌面端人工走查（设置页、侧栏标识、只读输入区、投递状态）尚未进行。
- 旧版移动客户端不认识 `external_dm`：它会按未知类型处理并可能显示一个无法正常使用的会话条目。发布说明需要注明（任务 5.2 第 2 条，待补）。
