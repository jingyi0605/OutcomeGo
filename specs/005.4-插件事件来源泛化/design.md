# 设计文档 - 插件事件来源泛化

状态：Draft

## 1. 概述

### 1.1 目标

- 把宿主现有的插件事件轮询从"仅 Email、仅 stdio"泛化为"任意插件、含 Remote MCP"
- 用一个通用 `plugin` 触发器承载订阅，不为每个插件新增事件来源或触发器类型
- 保持 Email、Routine Webhook、外部消息服务的行为不变
- 让插件接入事件只需清单声明加一个轮询工具

### 1.2 覆盖需求

- `requirements.md` 需求 1：通用事件来源声明
- `requirements.md` 需求 2：Remote MCP 连接的事件轮询
- `requirements.md` 需求 3：事件标识与来源不可伪造
- `requirements.md` 需求 4：通用 `plugin` 触发器
- `requirements.md` 需求 5：派发、可靠性与唤醒内容
- `requirements.md` 需求 6：Bot 可见契约与文档
- `requirements.md` 需求 7：兼容性

### 1.3 技术约束

- 后端：TypeScript（Bun），`apps/server`、`packages/messaging`、`packages/plugin-sdk`、`packages/contracts`
- 数据存储：沿用 `pluginConnection.eventCursor` 与 `eventsPolledAt`，**不新增数据库迁移**
- 认证授权：Remote MCP 沿用连接的 Bearer 令牌或请求头；宿主工具对 Bot 隐藏
- 插件规则：不得在 `apps/server` 写某个插件专属逻辑；插件只提供清单与轮询工具

### 1.4 现有机制（改动基线）

| 位置 | 现状 |
| --- | --- |
| `apps/server/src/services/plugin/events.ts` | `PluginEventPoller`：15 秒一拍；条件占用 `eventsPolledAt`；调用 `pollTool`；逐个派发；成功后保存游标；仅轮询 `transport: "stdio"` |
| `packages/plugin-sdk/src/manifest.ts`、`types.ts` | `PluginEventSource = "email"`；`events` 仅允许 stdio 连接 |
| `packages/messaging/src/automation-events.ts` | 事件来源枚举、解析、`matchesAutomationEvent` 按来源分支 |
| `packages/messaging/src/automation-trigger.ts` | 触发器解析与分组校验 |
| `packages/messaging/src/routines.ts` | `EVENT_BLOCKS`、来源标签、`dispatchEventToAll` |
| `packages/contracts/src/native-tools.json`、`reference-main-parsers.ts` | `UpdateRoutine` 的模型可见 Schema、解析、描述 |
| `apps/server/src/services/plugin/transport.ts` | `callHostTool` 仅走 `callStdio` |
| `apps/server/src/services/plugin-service.ts` | Remote MCP 发现结果不过滤宿主工具（stdio 过滤） |

## 2. 架构

### 2.1 系统结构

```
插件清单 events: { pollTool, source: "plugin", intervalSeconds }
        │
        ▼
PluginEventPoller（每 15 秒检查到期连接）
        │  http：MCP 客户端调用 pollTool({cursor})，30 秒上限
        │  stdio：Bot 计算机上的连接器调用（不变）
        ▼
{ events, cursor }
        │  宿主覆盖 source/plugin/account，标识加命名空间
        ▼
routines.dispatchEventToAll(event)
        │  对所有启用的 routine 匹配 plugin 触发器
        ▼
匹配的 routine 各运行一次 → Bot 收到带 <plugin_event> 的唤醒
        ▼
派发全部成功后保存游标
```

订阅就是 routine：Bot 用 `UpdateRoutine` 创建触发器为 `{ "type": "plugin", "plugin": "dsh-web", "resourceIds": [...] }` 的 routine，删除或停用 routine 即取消订阅。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `plugin-sdk` 清单校验 | 校验 `events.source` 与传输组合 | 插件清单 | 通过或拒绝 |
| `PluginEventPoller` | 到期轮询、超时、命名空间、覆盖来源、保存游标 | 已安装的 ready 连接 | 派发事件、新游标 |
| `PluginTransport.callHostTool` | 按连接传输选择 stdio 或 http 调用 | 连接、工具名、参数、可选信号 | 工具结果 |
| `PluginService` 发现 | Remote MCP 发现后过滤宿主工具 | 发现的工具列表 | Bot 可见工具快照 |
| `messaging` 事件解析与匹配 | 解析 `plugin` 事件、匹配 `plugin` 触发器 | 事件、触发器 | 是否匹配 |
| `messaging` 触发器解析 | 校验并规范化 `plugin` 触发器 | 触发器输入 | 规范化触发器 |
| `messaging` 唤醒内容 | 生成 `<plugin_event>` 块与描述 | 事件 | 提示词片段 |
| `contracts` | `UpdateRoutine` Schema、触发器形状文案、描述 | — | 模型可见契约 |

### 2.3 关键流程

#### 2.3.1 订阅并被唤醒

1. 用户连接 DSH-WEB 账号；清单声明了 `events`，宿主开始按间隔轮询（首次游标为空）
2. 轮询工具对空游标返回基线游标和空事件列表（约定见 §3.3.1），宿主保存游标
3. Bot 创建会话后调用 `UpdateRoutine`，触发器 `{ type: "plugin", plugin: "dsh-web", resourceIds: [sessionId], events: ["session.completed", "session.failed"] }`
4. 会话状态变化，下一次轮询返回事件，宿主覆盖 `source`、`plugin`、`account`，生成命名空间事件标识
5. `dispatchEventToAll` 匹配到该 routine，运行一次，Bot 在唤醒内容中读到 `<plugin_event>`
6. 全部事件派发成功，宿主保存新游标

#### 2.3.2 失败与恢复

1. 轮询调用超时、报错或返回不可解析的结果：记录失败，游标不变，下个周期重试
2. 某个事件派发失败：保留旧游标，整批在下个周期重新返回，已运行过的 routine 由事件标识去重
3. 服务重启：从数据库保存的游标继续

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、5

- `PluginEventPoller`（`apps/server/src/services/plugin/events.ts`）：增加 `http` 连接、调用上限、`plugin` 来源的字段覆盖与标识命名空间
- `PluginTransport.callHostTool`（`transport.ts`）：增加可选 `signal`；连接带 `transport: "http"` 时走 `callHttp`
- `PluginService` 的 Remote MCP 发现（`plugin-service.ts`）：过滤 `connectorHostTools` 声明的工具

### 3.2 数据结构

覆盖需求：1、3、4

#### 3.2.1 `PluginEventPolling`（清单 `connections[].events`）

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `pollTool` | `string` | 是 | 轮询工具名，对 Bot 隐藏 | 非空，≤200 字符 |
| `source` | `"email" \| "plugin"` | 是 | 事件来源 | `email` 仅 `stdio`；`plugin` 允许 `http`、`stdio` |
| `intervalSeconds` | `number` | 否 | 轮询间隔 | 整数 30–3600，默认 60 |

#### 3.2.2 连接器返回的事件

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | 稳定的原始事件标识 | 1–150 字符；同一事件重复返回时必须相同 |
| `kind` | `string` | 是 | 事件类型，例如 `session.completed` | ≤80 字符 |
| `text` | `string` | 是 | 供 Bot 阅读的事件摘要 | ≤32 000 字符 |
| `occurredAt` | `string` | 否 | ISO 时间 | — |
| `actor` | `string` | 否 | 触发方，例如 `agentId` | ≤512 字符（事件字段通用上限） |
| `resourceId` | `string` | 否 | 关联资源，例如 `sessionId` | ≤512 字符（事件字段通用上限）；超过 200 字符的值无法被触发器匹配 |

连接器返回的 `source`、`plugin`、`account` 一律被宿主覆盖。其他未知字段被忽略。

#### 3.2.3 `AutomationEvent` 增加字段

`source` 枚举增加 `"plugin"`；新增可选字段 `plugin`、`account`、`resourceId`（字符串）。宿主赋值后的插件事件：

| 字段 | 来源 |
| --- | --- |
| `id` | `plugin:<插件 key>:<连接 ID>:<原始 id>` |
| `source` | 固定 `plugin`（清单声明） |
| `plugin` | 安装的插件 key（宿主） |
| `account` | 连接别名（宿主） |
| `kind`、`text`、`occurredAt`、`actor`、`resourceId` | 连接器返回 |

标识总长度不超过现有 256 字符上限：`plugin:` + 插件 key（≤160）+ 连接 ID（36）+ 原始标识（≤150）在极端长度下可能超限，超限时按需求 3.3 丢弃并警告。

#### 3.2.4 `plugin` 触发器

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `type` | `"plugin"` | 是 | 触发器类型 | — |
| `plugin` | `string` | 是 | 插件 key | 符合插件标识格式（小写字母、数字、`.`、`-`） |
| `events` | `string[]` | 否 | 事件类型列表，缺省匹配任意 | ≤50 项，每项 ≤80 字符 |
| `resourceIds` | `string[]` | 条件 | 订阅的资源 | ≤50 项，每项 ≤200 字符 |
| `actors` | `string[]` | 条件 | 触发方 | ≤50 项，每项 ≤200 字符 |

条件：`resourceIds` 与 `actors` 至少一个非空。列表去重、去空白后保存；未提供的字段不写入存储。

### 3.3 接口契约

覆盖需求：2、3、4、5、6

#### 3.3.1 轮询协议（连接器或 Remote MCP 工具）

- 类型：MCP 工具调用，对 Bot 隐藏
- 输入：`{ "cursor": <JSON 或 null> }`
- 输出：MCP 结果为 `structuredContent` 或 JSON 文本：`{ "events": [...], "cursor": <JSON 或 null> }`
- 约定：
  1. `cursor` 为空（首次）时，返回当前基线游标和空 `events`，即"只有连接之后发生的事件才会触发"
  2. `events` 按发生顺序升序，单次不超过 50 个；游标只推进到最后一个已返回的事件
  3. 同一事件无论返回几次，`id` 必须相同
  4. 出错时返回 MCP 错误结果（`isError`），宿主保留旧游标
  5. 游标是不透明 JSON，大小应保持在数 KB 以内
- 宿主处理：超过 50 个只取前 50 个并警告；游标在全部派发成功后保存

#### 3.3.2 宿主调用路径

- `stdio`：保持不变（`callComputer`）
- `http`：`PluginTransport.callHostTool(connection, tool, args, signal)`，当 `connection.transport === "http"` 时调用 `callHttp`，使用该连接的 `httpOptions`；轮询器传入 `AbortSignal.timeout(30_000)`
- Remote MCP 发现：保存工具快照前，剔除 `connectorHostTools(connector)` 中的工具（连接时和服务端通知工具列表变化时都要过滤）
- Remote MCP 请求前检查：`httpOptions` 的 `beforeRequest` 原本要求被调用的工具必须在快照中，会拦下宿主自己的轮询调用。改为放行清单声明的宿主工具；其他工具仍须在快照中，连接状态必须为 ready
- Bot 调用：`invocations.ts` 已拒绝宿主工具名（`plugin_tool_not_found`），无需改动

#### 3.3.3 匹配规则（`matchesAutomationEvent`，`plugin` 触发器）

```
event.source === "plugin"
&& trigger.plugin === event.plugin
&& (events 为空 || events 包含 event.kind)
&& (resourceIds 为空 || resourceIds 包含 event.resourceId)
&& (actors 为空 || actors 包含 event.actor)
```

由于保存时要求 `resourceIds` 或 `actors` 至少一个非空，不会出现对整个插件的无条件匹配。

#### 3.3.4 唤醒内容与描述

- 事件块标签：`plugin_event`；内容为 `JSON.stringify(event)` 并把 `<` 转义为 `<`
- 一行摘要：`<plugin> <kind>[ for <resourceId>][: "<text 前 120 字符>"][ by <actor>]`
- 触发器描述：`When <plugin> reports <events 用逗号连接，缺省为 "events"> for <n> resource(s)`；只有 `actors` 时为 `<n> actor(s)`。例如 `When dsh-web reports session.completed for 2 resources`，由 `describeTrigger` 的测试固定

#### 3.3.5 Bot 可见契约

- `native-tools.json`：`UpdateRoutine.trigger` 增加 `plugin` 形状，调整 `anyOf` 序号与 `$ref`
- `tool-reference.json`：模型实际看到的 `UpdateRoutine.trigger.type` 枚举增加 `plugin`（Schema 只列类型名，形状靠技能文本和解析器报错给出）
- `reference-main-parsers.ts`：增加 `pluginTrigger`（zod）、`describeListener` 分支、组合规则（与 `origin` 不能同组）、触发器形状文案 `AUTOMATION_TRIGGER_SHAPE_LINES`
- `messaging/src/prompts/managed-skills.json`：routines 技能列出 `plugin` 形状、分组限制和 `<plugin_event>` 块，并与形状文案逐字一致（有测试固定）
- 保存时的校验由 `messaging` 的 `parseStoredTrigger` 完成（要求 `resourceIds` 或 `actors`），zod 形状只校验字段类型

## 4. 数据与状态模型

### 4.1 数据关系

- `pluginConnection.eventCursor`、`eventsPolledAt`：已存在，不变
- 订阅存储在 `routine.trigger`（JSON）；无新表
- 事件标识用于 routine 执行的幂等键（沿用）

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| 未轮询 | `eventsPolledAt` 为空 | 连接 ready 且清单声明 `events` | 条件占用成功 |
| 已占用 | 本周期被某个进程占用 | 到期且更新 `eventsPolledAt` 成功 | 调用结束 |
| 已保存游标 | 本周期全部事件派发成功 | 派发无异常 | 下个周期 |
| 失败待重试 | 调用或派发失败，游标未变 | 超时、错误结果、派发异常 | 下个周期成功 |

## 5. 错误处理

### 5.1 错误类型

- 轮询超时（http 30 秒）：取消调用，记录，游标不变
- 轮询结果错误：`isError`、不可解析、缺少 `events` 列表
- 事件校验失败：标识为空或过长、字段超限、类型不合法
- 触发器校验失败：缺少 `plugin`，缺少 `resourceIds` 与 `actors`，列表超限
- 清单校验失败：来源未知，`email` 用于非 stdio

### 5.2 处理策略

1. 清单与触发器校验错误：在保存或安装时拒绝，返回明确的错误消息
2. 轮询错误：同一连接 10 分钟内最多记录一次，不推进游标
   - 例外：`plugin` 来源的服务端答复"没有这个工具"（`-32601` 或 unknown tool 等文字）时，说明服务端版本尚未提供该工具。宿主只记录一条提示（每个连接每个进程一次），把下次检查推迟到 15 分钟后（把 `eventsPolledAt` 往后设，不增加字段），不推进游标，服务端升级后下次检查成功即建立基线。这使插件可以先于服务端声明 `events`
3. 单个事件无效：丢弃并警告，其余事件继续
4. 派发异常：不推进游标，整批下个周期重试，事件标识保证幂等
5. 连接被撤销或安装被移除：不再轮询

## 6. 正确性属性

### 6.1 属性 1：不丢失

*对于任何* 一批已返回的事件，只有当全部派发成功后游标才推进，因此失败不会丢失事件。

**验证需求：** 5.1、5.2

### 6.2 属性 2：不重复运行

*对于任何* 同一连接重复返回的同一原始事件，同一个 routine 至多运行一次。

**验证需求：** 3.2、3.4

### 6.3 属性 3：来源不可伪造

*对于任何* 连接器返回的事件，最终事件的 `source`、`plugin`、`account` 与连接器返回值无关，由宿主按清单和连接决定。

**验证需求：** 3.1

### 6.4 属性 4：订阅有界

*对于任何* 已保存的 `plugin` 触发器，都带有非空的 `resourceIds` 或 `actors`，不存在对整个插件的无条件订阅。

**验证需求：** 4.2

### 6.5 属性 5：对 Bot 隐藏

*对于任何* 在清单中声明的轮询工具，Remote MCP 的 Bot 可见工具快照不包含它，Bot 调用它会被拒绝。

**验证需求：** 2.3、2.4

## 7. 测试策略

### 7.1 单元测试

- `plugin-sdk`：清单校验（`plugin` 来源接受 http 与 stdio，`email` 仍仅 stdio，未知来源拒绝，间隔范围）
- `messaging`：事件解析（新字段、长度限制）、`plugin` 触发器解析与规范化、匹配规则（插件、事件类型、资源、触发方、组合条件）、分组规则
- `contracts`：`UpdateRoutine` Schema 校验接受与拒绝、描述文案、触发器形状列表
- 轮询结果解析、命名空间标识、超长标识丢弃

### 7.2 集成测试

- `apps/server/test/plugin-events.integration.test.ts`（需要数据库）：http 连接按间隔轮询；来源与插件字段被覆盖；游标仅在派发成功后保存；超时不阻塞其他连接；Remote MCP 发现过滤轮询工具
- `apps/server/test` 中使用模拟 Remote MCP 服务（参考 `mcp-transport.test.ts`）：宿主调用 `pollTool` 带认证头
- routine：创建 `plugin` 触发器、事件匹配后唤醒 Bot，唤醒内容含 `<plugin_event>`

### 7.3 回归测试

- 现有：`packages/messaging`、`packages/plugin-sdk`、`packages/contracts`（含 `main-parser-parity.test.ts`）、`apps/server` 的 Email 事件与外部消息服务测试

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §3.2.1 | SDK 清单测试 |
| 需求 2 | §3.3.2、§6.5 | 服务端集成测试、发现过滤测试 |
| 需求 3 | §3.2.2、§3.2.3、§6.2、§6.3 | 轮询器单元与集成测试 |
| 需求 4 | §3.2.4、§3.3.3、§6.4 | 触发器解析与匹配测试 |
| 需求 5 | §2.3、§3.3.4、§6.1 | 集成测试、唤醒内容测试 |
| 需求 6 | §3.3.5 | 契约与解析测试、文档检查 |
| 需求 7 | §1.4 | 回归测试、客户端人工检查 |

## 8. 风险与待确认项

### 8.1 风险

- **唤醒延迟**：最短 30 秒，默认 60 秒；对即时性要求高的场景不适用
- **事件量**：`dispatchEventToAll` 读取全部启用的 routine 后内存匹配；routine 数量很大时有成本。缓解：事件批量上限 50，周期 ≥30 秒
- **首次轮询语义**：如果连接器在空游标时返回历史事件，会在连接后集中唤醒。缓解：约定在 §3.3.1，并在插件开发文档和 DSH-WEB 接口中写明
- **多账号**：同一插件的多个账号事件由 `account` 区分，触发器暂不过滤账号；资源标识通常全局唯一，冲突风险低
- **客户端文案**：客户端显示通用文案"有事件发生时"，用户难以区分订阅对象。缓解：后续任务提供专用文案
- **不实时**：本规格不解决实时需求

### 8.2 待确认项

- [x] `plugin` 触发器的可读描述的最终文案：见 §3.3.4（任务 3.2 已确定）
- [ ] 是否在 routine 详情里展示订阅的 `resourceIds` 数量（属客户端后续工作）
- [ ] 事件标识上限 256 字符与长插件 key 组合的边界处理是否需要更短的前缀
