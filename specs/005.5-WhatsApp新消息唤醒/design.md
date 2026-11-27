# 设计文档 - WhatsApp 新消息唤醒

状态：Draft

## 1. 概述

### 1.1 目标

在 WhatsApp 同步确认的实时收件消息与现有插件事件例程之间建立可靠唤醒链路，提供单账户范围内按聊天、联系人发送者或明确选择的全部消息订阅。

### 1.2 覆盖需求

- `requirements.md` 需求 1：实时事件与恢复。
- `requirements.md` 需求 2：账户及聊天/发送者筛选。
- `requirements.md` 需求 3：去重、旧事件和授权边界。

### 1.3 技术约束

- 连接器运行于远端 computer 容器；连接器的 wacli 事件跟随 WhatsApp 长连接。
- 服务端复用 `PluginEventPoller`、`AutomationEvent`、`RoutineService.dispatchEventToAll`。
- 每个插件连接有独立持久状态目录及数据库事件游标。
- `events.longPoll` 只对 packaged stdio 连接开放；原有 HTTP 定时事件源不变。

## 2. 架构

### 2.1 系统结构

```text
WhatsApp 实时消息
  -> wacli sync --follow 消息已落地事件
  -> HMAC 签名的 loopback Webhook
  -> WhatsApp 私有 SQLite 事件 outbox（稳定 ID、限额、保留期）
  -> whatsapp_poll_events MCP 宿主工具（最多 20 秒长轮询）
  -> PluginEventPoller 账户租约、分发和游标提交
  -> RoutineService 例程筛选、投递去重、机器人唤醒
```

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `connector/inbound-events.ts` | 验证 wacli HMAC、过滤非收件事件、持久化通知、按游标返回 | 本地 Webhook、MCP 长轮询 | 有界事件批次 |
| WhatsApp `WhatsAppAccount` | 在后台 sync 进程配置 Webhook，关闭时释放队列 | wacli 进程、连接器生命周期 | 正常收件事件 |
| WhatsApp `whatsapp_poll_events` | 隐藏的宿主工具；支持可取消的短长轮询 | cursor、waitSeconds | events、cursor |
| `PluginEventPoller` | 管理长轮询连接、跨实例租约、事件派发和游标 | manifest、连接、事件批次 | 通用插件自动化事件 |
| `automation-trigger.ts` | 校验 WhatsApp 特有单账户范围 | 例程 Trigger | 规范化触发条件 |
| `automation-events.ts` | 按安装插件、账户、聊天、发送者及事件类型匹配 | 规范化事件 | 例程匹配结果 |
| `RoutineService` | 排除订阅建立前已收到的 WhatsApp 队列项并执行现有去重/唤醒 | 例程、事件 | 机器人例程执行 |

### 2.3 关键流程

#### 2.3.1 实时收件

1. sync 进程启用 `message` Webhook，只监听 loopback，启用 HMAC 签名和私有网段显式允许。
2. 连接器校验签名；只接受合法 WhatsApp 聊天 JID、有消息 ID/时间、且 FromMe=false 的消息事件；跳过事件类型非消息的结构、编辑、撤回、反应等。
3. 将正文限制为 2000 字，媒体/投票/位置/通话等以类型提示代替二进制内容。以 `chatJID + messageID` 的 SHA-256 作为稳定去重键，事务写入私有 SQLite。
4. 宿主长轮询返回至多 50 个事件。成功派发后才提交新游标；失败重试以相同事件 ID 派发，由例程幂等键去重。

#### 2.3.2 订阅和唤醒

1. 机器人通过选中的 WhatsApp 连接读取 `connection_status` 的 `subscription_account_key`、`authenticated` 和 `incoming_message_events`。
2. 用户指明聊天时以确切 JID 设置 `resourceIds`；指明联系人任意位置时以确切 JID 设置 `actors`；全部收件消息仅在用户明确提出时设 `allMessages: true`。
3. Trigger 需包含该账户 key 和 `message.received`。事件宿主字段以当前插件连接计算账户 key，覆盖任何连接器字段。
4. 仅当收到时间不早于当前 `RoutineRevision.createdAt` 且所有筛选匹配时，使用现有 RoutineService 分发流程。revision 时间可在更新/恢复时重置，又不会受例程执行期间的 `updatedAt` 修改影响。

## 3. 组件和接口

### 3.1 核心组件

- 覆盖需求 1、3：连接器事件接收器与 SQLite outbox。
- 覆盖需求 1、2：manifest 长轮询声明与宿主事件长轮询。
- 覆盖需求 2、3：WhatsApp 特有事件触发验证、账户 JID 匹配和旧事件过滤。

### 3.2 数据结构

#### 3.2.1 WhatsApp 事件 outbox 行

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `seq` | SQLite INTEGER | 是 | 单调递增游标 | `PRIMARY KEY AUTOINCREMENT` |
| `event_id` | TEXT | 是 | 稳定消息去重 ID | `UNIQUE` |
| `received_ms` | INTEGER | 是 | 连接器接收时间 | 保留 24 小时 |
| `body` | TEXT | 是 | 不含媒体二进制的规范事件 | 5000 行上限、正文限 2000 字 |

#### 3.2.2 `message.received` 自动化事件

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | `plugin:whatsapp:<connection>:<sha256>` | 主机命名空间 |
| `plugin` | string | 是 | `whatsapp` | 由宿主覆盖 |
| `accountKey` | string | 是 | 插件连接 ID 的 SHA-256 前 24 位 | 连接器不可指定 |
| `resourceId` | string | 是 | 目标聊天 JID | 用于私聊或群组过滤 |
| `actor` | string | 否 | 可识别的私人联系人 JID | 发送者筛选 |
| `messageId` | string | 是 | WhatsApp 原始消息 ID | 查询消息内容 |
| `receivedAt` | string | 是 | 宿主队列接收时间 | 创建时间边界 |
| `text` | string | 是 | 文本、媒体说明或类型提示 | 最多 2000 字 |

#### 3.2.3 WhatsApp 触发条件

```json
{
  "type": "plugin",
  "plugin": "whatsapp",
  "accountKey": "<connection_status 中返回的 subscription_account_key>",
  "events": ["message.received"],
  "resourceIds": ["<聊天 JID>"]
}
```

`resourceIds` 与 `actors` 可同时配置（AND 关系）。明确监听该账户全部收件消息时仅设置 `allMessages: true`，不可同时传入这两种筛选。

### 3.3 接口契约

#### 3.3.1 连接器内部 Webhook

- 类型：仅 loopback HTTP POST
- 路径：动态 loopback 端口上的 `/incoming`
- 输入：wacli v0.26 `ParsedMessage` JSON；`X-Wacli-Signature: sha256=<HMAC-SHA256>`
- 输出：合法签名接受后返回 HTTP 204；签名错误 401，JSON 格式错误 400
- 校验：私有每进程随机 secret、常量时间签名比较、最大 512 KiB 请求、限额持久化队列
- 来源：每个连接器实例仅绑定 `127.0.0.1`；wacli 显式配置 `--webhook-allow-private`

#### 3.3.2 宿主 MCP 长轮询

- 类型：MCP 工具，仅宿主可见
- 标识：`whatsapp_poll_events`
- 输入：`{ cursor: number | null, waitSeconds: 0..20 }`
- 输出：`{ events: [...], cursor: number | null }`
- 超时：宿主每次调用不超过 30 秒，并把连接中止信号传递给 stdio MCP 调用。

#### 3.3.3 manifest

```json
"events": { "pollTool": "whatsapp_poll_events", "source": "plugin", "longPoll": true }
```

`longPoll` 与定时 `intervalSeconds` 互斥，仅对 packaged stdio 连接合法；未声明此标记的既有定时事件连接仍按原逻辑运行。

## 4. 数据与状态模型

### 4.1 数据关系

事件 outbox 与 WhatsApp 账户状态共用连接器专属私有目录，账户删除时随连接器一起释放。服务端 `pluginConnection.eventCursor` 持久化已提交游标，`eventsPolledAt` 作为跨服务实例租约。游标提交前崩溃时重新投递，事件/例程幂等 ID 避免重启重复执行。

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `queued` | 通知已签名校验并持久化 | 实时收件 Webhook 通过 | 宿主返回批次 |
| `delivered` | 宿主已将事件派发给匹配例程 | 事件派发成功 | 游标提交或重启重试 |
| `acknowledged` | 宿主事件游标已提交 | 批次全部完成 | SQLite 清理已确认序号 |
| `expired` | 超过 24 小时 | 队列保留周期届满 | 清理任务移除记录 |

## 5. 错误处理

### 5.1 错误类型

- 签名不匹配、超大请求、无效事件：拒绝或忽略，不进入 outbox。
- MCP 长轮询超时、服务异常：游标不推进，在租约过期或下一轮后恢复。
- 连接器不支持 `whatsapp_poll_events`：记录受限频率诊断；不提供虚假的轮询替代能力。

### 5.2 处理策略

1. 解析/验证失败不泄露消息正文或签名密钥。
2. 例程匹配及唤醒复用现有调度和持久幂等机制。
3. 单连接长轮询租约确保一个服务实例负责读取；租约失效后由其他实例重新接管。
4. 事件接收与服务器/机器人进程停止可取消；其他账户由 15 秒扫描独立管理。

## 6. 正确性属性

### 6.1 持久事件恢复

*对于任何* 已写入 outbox 且未成功提交游标的事件，重启或派发失败后队列必须仍可返回相同的事件 ID。

**验证需求：** 需求 1.1、1.3、3.1

### 6.2 严格范围隔离

*对于任何* WhatsApp 事件，只有插件、账户 key、事件 kind 和所有非空资源/发送者筛选均匹配的例程才可以接收它；全部消息订阅也只覆盖一个账户。

**验证需求：** 需求 2.1–2.4、3.4

### 6.3 订阅起点

*对于任何* 比目标订阅版本 `RoutineRevision.createdAt` 更早到达的 WhatsApp outbox 事件，该版本不得接收这条旧事件。

**验证需求：** 需求 3.2

## 7. 测试策略

### 7.1 单元测试

- Event parser、消息分类、JID 校验、稳定事件 ID、HMAC、队列游标、长轮询唤醒及过期清理。
- manifest `longPoll` 限制、Trigger 输入校验、WhatsApp 账户/资源/发送者匹配及旧消息过滤。

### 7.2 集成测试

- 模拟服务接收一条签名消息，宿主长轮询取回、派发和提交游标。
- 并发长轮询租约、派发失败重试、运行时代次更新和取消。

### 7.3 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.3、§3.3、§4.1 | connector 测试；插件事件集成测试 |
| `requirements.md` 需求 2 | `design.md` §3.2、§3.3、§6.2 | Trigger parser、事件匹配单元测试 |
| `requirements.md` 需求 3 | `design.md` §4.2、§5、§6 | outbox 交付重试和例程去重测试 |

## 8. 风险与待确认项

### 8.1 风险

- wacli 事件 Webhook 仍在连接器本机以 HTTP 承接，必须严格绑定 loopback 并验证 HMAC。
- 私有事件队列限制为 5000 条、最长 24 小时；长时间电脑离线可能超过恢复窗口，指标需要评估。
- WA LID / PN 身份映射可能变化；需优先从聊天工具返回的规范 JID 配置筛选。

### 8.2 待确认项

- 是否需要未来在例程 UI 中提供账户和联系人选择控件；本次通过现有例程触发契约及机器人工具配置。
