# 任务清单 - WhatsApp 新消息唤醒（人话版）

状态：IN_PROGRESS

## 阶段 1：连接器接收并持久化新消息

- [x] 1.1 增加签名事件接收器与私有队列
  - 状态：DONE
  - 这一步到底做什么：验证本机 wacli Webhook，筛选新收件消息并保存在受限 SQLite outbox。
  - 做完你能看到什么：重启前后未确认的新消息事件均可通过游标读取，重复 Webhook 具有稳定 ID。
  - 先依赖什么：无
  - 开始前先看：`requirements.md` 需求 1、3；`design.md` §2.3.1、§3.2.1、§3.3.1、§6.1
  - 主要改哪里：`packages/plugins/whatsapp/connector/inbound-events.ts`、相邻 connector 测试
  - 这一步先不做什么：不转发媒体二进制，不对消息发送回复。
  - 怎么算完成：校验 HMAC、仅接受 loopback 实时消息；队列有稳定事件 ID、确认游标、24 小时及 5000 项上限。
  - 怎么验证：`bun test packages/plugins/whatsapp/connector/test/inbound-events.test.ts`
  - 对应需求：`requirements.md` 需求 1.1–1.3、3.1
  - 对应设计：`design.md` §2.3.1、§3.2.1、§3.3.1、§4.1

- [x] 1.2 将接收器接入 sync 与隐藏 MCP 工具
  - 状态：DONE
  - 这一步到底做什么：让 sync 把已存储的实时消息通知发送到签名 loopback Webhook，并提供只供宿主调用的长轮询工具。
  - 做完你能看到什么：WhatsApp MCP 会话可被取消的等待新事件工具唤醒。
  - 先依赖什么：1.1
  - 开始前先看：`requirements.md` 需求 1；`design.md` §2.3.1、§2.3.2、§3.3.1、§3.3.2
  - 主要改哪里：`packages/plugins/whatsapp/connector/account.ts`、`server.ts`、`process.ts`、`plugin.json`
  - 这一步先不做什么：不把宿主事件工具公开给机器人直接调用。
  - 怎么算完成：仅 sync 配置 Webhook；工具支持游标及 0–20 秒等待，MCP 会话关闭时释放 server、DB 和进程。
  - 怎么验证：connector 工具 schema 测试、account/process 测试及 package 测试。
  - 对应需求：`requirements.md` 需求 1.1、1.3
  - 对应设计：`design.md` §2.3.1、§2.3.2、§3.3.2

### 阶段检查

- [x] 1.3 连接器接收验收
  - 状态：DONE
  - 这一步到底做什么：覆盖 Webhook 签名、过滤、分页、重复消息、重启及取消。
  - 做完你能看到什么：连接器端不丢失已持久化但未确认的通知。
  - 先依赖什么：1.1、1.2
  - 开始前先看：`requirements.md`、`design.md` §5–§7
  - 主要改哪里：WhatsApp connector 测试
  - 这一步先不做什么：不进行真实 WhatsApp 账户发送测试。
  - 怎么算完成：核心路径和失效路径都有可重复测试。
  - 怎么验证：定向 bun test 与类型检查。
  - 对应需求：`requirements.md` 需求 1、3
  - 对应设计：`design.md` §5、§6、§7

## 阶段 2：事件宿主与订阅范围

- [x] 2.1 在事件宿主增加有租约的长轮询
  - 状态：DONE
  - 这一步到底做什么：为 packaged stdio 事件源新增显式 `longPoll` 模式，跨服务实例独占账户读取，传递取消信号并提交游标。
  - 做完你能看到什么：消息到达后宿主立即派发，不再每 60 秒查询一次该账户。
  - 先依赖什么：1.2
  - 开始前先看：`requirements.md` 需求 1、3；`design.md` §2.3.2、§3.3.3、§4.1
  - 主要改哪里：`packages/plugin-sdk/src/types.ts`、`manifest.ts`、`apps/server/src/services/plugin/events.ts`、`app-service.ts`
  - 这一步先不做什么：不改变未启用 longPoll 的既有定时事件源。
  - 怎么算完成：20 秒等待、30 秒 deadline、60 秒租约、运行时代次校验、成功派发后提交游标。
  - 怎么验证：`apps/server/test/plugin-events.integration.test.ts` 并增加多实例长轮询断言。
  - 对应需求：`requirements.md` 需求 1.1、1.3、3.1
  - 对应设计：`design.md` §2.3.2、§3.3.3、§4.1、§5

- [x] 2.2 加入 WhatsApp 账户与资源触发约束
  - 状态：DONE
  - 这一步到底做什么：为 WhatsApp `plugin` trigger 增加账户 key、联系人发送者、聊天资源和显式全部消息条件。
  - 做完你能看到什么：两个 WhatsApp 连接不会交叉触发；全部消息只会来自指定账户。
  - 先依赖什么：2.1
  - 开始前先看：`requirements.md` 需求 2；`design.md` §3.2.2、§3.2.3、§3.3.2、§6.2
  - 主要改哪里：`packages/messaging/src/automation-trigger.ts`、`automation-events.ts`、`apps/server/src/services/plugin/events.ts`、触发描述与例程测试
  - 这一步先不做什么：不改变其他插件的触发字段语义。
  - 怎么算完成：账户 key 由宿主覆盖；联系人、群聊、AND 组合、全部消息及跨账户不匹配都有测试。
  - 怎么验证：`bun test packages/messaging/test/automation-events.test.ts packages/messaging/test/automation-trigger-validation.test.ts`
  - 对应需求：`requirements.md` 需求 2.1–2.4、3.4
  - 对应设计：`design.md` §3.2.2、§3.2.3、§3.3.2、§6.2

- [x] 2.3 避免新订阅接收排队旧消息
  - 状态：DONE
  - 这一步到底做什么：对 WhatsApp 事件比较接收时间与当前订阅 revision 建立时间，并保留常规派发幂等性。
  - 做完你能看到什么：创建例程之前排队的旧消息不会突然触发新任务。
  - 先依赖什么：2.2
  - 开始前先看：`requirements.md` 需求 3；`design.md` §2.3.2、§4.2、§6.3
  - 主要改哪里：`packages/messaging/src/routines.ts`、相邻 RoutineService 测试
  - 这一步先不做什么：不改变 webhook、其他插件或定时例程的时间语义。
  - 怎么算完成：收到时间早于当前 revision 的 WhatsApp 事件被过滤，同时事件 ID 重试继续依赖现有去重逻辑。
  - 怎么验证：事件例程单测及 RoutineService 集成测试。
  - 对应需求：`requirements.md` 需求 3.1、3.2、3.4
  - 对应设计：`design.md` §4.1、§4.2、§6.1、§6.3

### 阶段检查

- [ ] 2.4 端到端宿主链路验收
  - 状态：IN_REVIEW
  - 这一步到底做什么：从插件模拟消息验证事件确实进入匹配例程，重试失败不推进游标，暂停例程不唤醒。
  - 做完你能看到什么：连接器和现有机器人任务调度串成可验证主流程。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：`requirements.md`、`design.md` §4–§7
  - 主要改哪里：server 和 messaging 集成测试
  - 这一步先不做什么：不部署远端电脑或触发真实外发消息。
  - 怎么算完成：成功、派发失败、租约接管、过滤和取消场景均有覆盖。
  - 怎么验证：相关 workspace 的定向 test 与 typecheck。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §4、§5、§6、§7

## 阶段 3：机器人设置指引与交付

- [x] 3.1 补充 WhatsApp 自动监听技能指导
  - 状态：DONE
  - 这一步到底做什么：指导机器人读取所选账户 key、解析聊天/联系人 JID，并按用户表达构造订阅。
  - 做完你能看到什么：机器人知道怎样创建指定联系人、群聊或全部消息例程，并解释其不自动授权回复。
  - 先依赖什么：2.2
  - 开始前先看：`requirements.md` 需求 2、3；`design.md` §2.3.2、§3.2.3
  - 主要改哪里：`packages/plugins/whatsapp/skills/whatsapp/SKILL.md`、本地化文案
  - 这一步先不做什么：不承诺桌面 UI 已提供可视化 WhatsApp 触发编辑器。
  - 怎么算完成：包含账户、聊天与联系人辨析、显式全量范围及停止订阅说明。
  - 怎么验证：技能文本人工核对及插件打包测试。
  - 对应需求：`requirements.md` 需求 2.1–2.4、3.3
  - 对应设计：`design.md` §2.3.2、§3.2.3、§7

- [ ] 3.2 最终检查点
  - 状态：IN_REVIEW
  - 这一步到底做什么：逐条核对需求、设计、实现和测试证据并标注待交付差异。
  - 做完你能看到什么：能准确说明本地实现边界和所运行的验证。
  - 先依赖什么：3.1
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：当前 Spec 和相关实现文件
  - 这一步先不做什么：不执行远端同步/重建或真实账户操作。
  - 怎么算完成：追踪映射齐全、定向测试通过、风险与限制已注明。
  - 怎么验证：执行 PR 定向验证清单并人工审阅 diff。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
