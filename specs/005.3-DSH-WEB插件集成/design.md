# 设计文档 - DSH-WEB 与 OutcomeGo 跨工作区集成

状态：Draft

## 1. 概述

### 1.1 目标

- 设计 DSH-WEB（dsh-codingns）和 OutcomeGo（openteam）之间的完整集成方案
- 升级 DSH-WEB MCP 以支持 Agent 消息识别、会话关联、队列管理、文件/Git 工具
- 在 DSH-WEB 增加会话事件拉取接口 `session_events`（取代原 Webhook 推送），由 OutcomeGo 宿主按游标定期读取
- 按 OutcomeGo 插件系统规则交付 DSH-WEB 插件：声明式 Remote MCP 连接 + Bot 技能说明；Bot 通过 `plugin` 触发器的 routine 订阅会话事件，由宿主的插件事件轮询（Spec 005.4）拉取并唤醒（见 §3.2）

### 1.2 工作区分工

| 工作区 | 职责 | 升级内容 |
| --- | --- | --- |
| **dsh-codingns**（后端） | MCP 服务器、会话管理、事件日志 | MCP 工具扩展、`session_events` 事件拉取、UI 标签显示 |
| **openteam**（前端） | 插件包（连接声明、技能说明）、宿主能力（Remote MCP、插件事件轮询） | 工具发现与技能说明、事件订阅指引、Bot 工作流 |

### 1.3 覆盖需求

- dsh-codingns：B1-B7（7 个后端需求；B7 为补充需求：会话历史读取与会话搜索）
- openteam：F1-F4（4 个前端需求）

## 2. 架构

### 2.1 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                  openteam（OutcomeGo）                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Bot 1        Bot 2        Bot 3                       │  │
│  └───────────────────────────────────────────────────────┘  │
│           ↓           ↓           ↓                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │    DSH-WEB 插件（Remote MCP 连接 + 技能说明）         │  │
│  │  • 工具：连接后由宿主发现（共 22 个）           │  │
│  │  • 事件：宿主轮询 session_events，匹配订阅则唤醒 Bot │  │
│  │  • 订阅：Bot 的 plugin 触发器（resourceIds/actors）  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          ↕ HTTP JSON-RPC 2.0
┌─────────────────────────────────────────────────────────────┐
│              dsh-codingns（DSH-WEB）                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            MCP 服务器                                  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ 工作区管理                                       │  │  │
│  │  │ • workspace_list                               │  │  │
│  │  │ • workspace_file_list、workspace_file_read    │  │  │
│  │  │ • workspace_git_status、workspace_git_log     │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ 会话管理（升级）                                 │  │  │
│  │  │ • session_list、session_create、session_continue│  │  │
│  │  │   → 新增 agentId、priority 参数                │  │  │
│  │  │ • session_questions、session_answer           │  │  │
│  │  │ • session_queue_peek、message_*（新）                 │  │  │
│  │  │ • terminal_list、terminal_read、terminal_write│  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ UI 增强                                         │  │  │
│  │  │ • 消息显示 Agent 标签                           │  │  │
│  │  │ • 会话队列可视化                               │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │        会话事件日志（新增）                            │  │
│  │  • 持久事件日志 + 游标                                │  │
│  │  • 事件队列：session.completed、session.failed...     │  │
│  │  • 由 OutcomeGo 宿主定期调用 session_events 拉取      │  │
│  │  • 包含 agentId、sessionId、workspaceId              │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 关键流程

#### 2.2.1 Bot 创建会话并关联 Agent ID

```
Bot 1 发起创建会话请求
    ↓
Bot 调用已发现的 MCP 工具 session_create（由宿主校验 Schema）
    • workspaceId: "ws-001"
    • agentId: "bot-1"
    • adapterId: "dsh"
    ↓
DSH-WEB 创建会话
    • 存储 agentId = "bot-1"
    • 返回 sessionId = "sess-123"
    ↓
宿主把工具结果返回给 Bot 1
    ↓
Bot 1 保存 sessionId，后续使用
```

#### 2.2.2 Bot 发送消息，显示 Agent 标签

```
Bot 1 调用 session_continue
    • sessionId: "sess-123"
    • message: "Please analyze this code"
    • agentId: "bot-1"
    ↓
DSH-WEB 接收并处理消息
    • 触发 DSH 执行
    • 存储消息与 agentId 关联
    ↓
DSH-WEB UI 渲染消息
    • 显示消息内容
    • 时间戳左侧显示「发送自Agent」标签
    • 用户可点击标签查看 Agent ID
    ↓
会话执行完成
```

#### 2.2.3 订阅会话，状态变化时被唤醒

```
Bot 创建会话，得到 sessionId
    ↓
Bot 调用 UpdateRoutine 创建订阅 routine
    {
      "type": "plugin", "plugin": "dsh-web",
      "resourceIds": ["sess-123"],
      "events": ["session.completed", "session.failed"]
    }
    ↓
会话执行完成或出错
    ↓
DSH-WEB 写入事件日志
    { "id": "evt-42", "kind": "session.completed", "resourceId": "sess-123",
      "actor": "bot-1", "text": "…" }
    ↓
OutcomeGo 宿主每 60 秒调用 session_events(cursor)
    • 用该账号的凭证，30 秒上限，对 Bot 隐藏
    • 事件匹配订阅 → 唤醒该 routine 所属的 Bot
    • 全部派发成功后才保存新游标
    ↓
Bot 收到唤醒内容中的 <plugin_event>
    • 获取完成状态
    • 继续后续工作流，并删除订阅
```

## 3. 组件和接口

### 3.1 后端（dsh-codingns）新增/升级

#### 3.1.1 MCP 工具升级

**工具：`session_create`（升级）**

```
输入：
{
  workspaceId: string,
  adapterId?: string,
  modelId?: string,
  prompt?: string,
  agentId?: string,           // 新增
  priority?: number            // 新增（0-100，默认 50）
}

输出：
{
  sessionId: string,
  title?: string,
  agentId?: string,            // 返回确认
  queuePosition?: number       // 新增：队列位置
}
```

**工具：`session_continue`（升级）**

```
输入：
{
  sessionId: string,
  message: string,
  agentId?: string
}

输出（新增回执）：
{
  messageId: string,                    // 新增：消息唯一标识
  status: "processing" | "queued" | "completed",  // 新增：消息状态
  queuePosition?: number,               // 新增：队列位置（从 1 开始，仅当 queued 时）
  estimatedWaitMs?: number,             // 新增：预期等待时间
  reason?: string,                      // 新增：如果 queued，说明原因
  success: boolean
}
```

**工具：`message_status`（新增）**

```
输入：
{
  sessionId: string,
  messageId: string
}

输出：
{
  messageId: string,
  status: "processing" | "queued" | "completed",
  queuePosition?: number,
  estimatedWaitMs?: number,
  canCancel: boolean,                   // 是否可以取消（仅 queued 时为 true）
  canPrioritize: boolean                // 是否可以插队
}

错误：
• NOT_FOUND（消息不存在）
• SESSION_NOT_FOUND
```

**工具：`message_cancel`（新增）**

```
输入：
{
  sessionId: string,
  messageId: string
}

输出：
{
  success: boolean,
  reason?: string                       // 如果失败，说明原因
}

错误：
• NOT_FOUND（消息不存在或已处理）
• CANNOT_CANCEL（消息无法取消，如已开始处理）
• SESSION_NOT_FOUND
```

**工具：`message_prioritize`（新增）**

```
输入：
{
  sessionId: string,
  messageId: string,
  priority: number                      // 0-100，数值越高优先级越高
}

输出：
{
  success: boolean,
  newPosition: number,                  // 新的队列位置
  reason: string                        // 说明变化情况
}

错误：
• NOT_FOUND（消息不存在或已完成）
• INVALID_PRIORITY
• SESSION_NOT_FOUND
```

**工具：`session_queue_peek`（新增）**

```
输入：
{
  sessionId: string,
  limit?: number,                       // 最多返回多少条，默认 10，最大 100
  includeProcessing?: boolean           // 是否包含处理中的消息，默认 false
}

输出：
{
  current?: {                           // 当前处理中的消息（如有）
    messageId: string,
    status: "processing",
    priority: number,
    sentAt: string,
    estimatedRemainingMs?: number       // 预期还需多久完成
  },
  queue: [
    {
      messageId: string,
      status: "queued",
      priority: number,
      position: number,                 // 队列位置
      sentAt: string,
      estimatedWaitMs: number
    }
  ]
}

错误：
• NOT_FOUND（会话不存在）
```

**工具：`session_history`（新增，需求 B7）**

```
输入：
{
  sessionId: string,
  limit?: number,                       // 本页最多返回多少条消息，默认 20，最大 100
  cursor?: number                       // 上一页返回的 nextCursor；不传则从最新的消息开始
}

输出：
{
  sessionId: string,
  workspaceId: string,
  messages: [                           // 本页内按时间从早到晚排列
    {
      seq: number,                      // 消息序号，越大越新
      role: "user" | "assistant",
      text: string,                     // 单条最多 8 KiB，超出部分被截掉
      time?: number,                    // 毫秒时间戳
      truncated?: true,                 // 这条消息被截短了
      agentId?: string,                 // 这条消息由哪个 Agent 通过 session_continue 发出
      sourceKind?: string               // DSH 自己生成的消息类型，例如压缩摘要
    }
  ],
  limit: number,
  hasMore: boolean,                     // 还有更早的消息
  nextCursor?: number,                  // hasMore 为 true 时给出，作为下一次的 cursor
  omittedWithoutText?: number           // 本页中没有文字（如只有图片）而被略过的消息数
}

规则：
• 只返回用户和助手的文字；工具调用等其他内容不返回
• 每页文字总量最多 256 KiB；超出时保留最新的消息，更早的留给下一页
• 只能读受管理工作区内、未归档的会话

错误：
• WORKSPACE_MCP_SESSION_UNAVAILABLE（会话不存在，或不在受管理工作区内）
• WORKSPACE_MCP_SESSION_HISTORY_UNAVAILABLE（当前 DSH 版本不支持，或读取失败）
• WORKSPACE_MCP_INVALID_ID、WORKSPACE_MCP_INVALID_INPUT（参数不合法）
```

**工具：`session_search`（新增，需求 B7）**

```
输入：
{
  query: string,                        // 要查找的文字，1-256 个字符
  workspaceId?: string,                 // 只在这个受管理工作区内找
  limit?: number                        // 最多返回多少个会话，默认 10，最大 20
}

输出：
{
  results: [
    {
      sessionId: string,
      workspaceId: string,
      snippet: string                   // 命中位置附近的一小段文字
    }
  ],
  limit: number,
  hasMore: boolean
}

规则：
• DSH 在整个 Host 范围内搜索，最多返回 20 个会话；之后才去掉受管理工作区以外的会话。
  所以结果可能少于 limit，而 hasMore 仍为 true。遇到这种情况，缩短关键词或指定 workspaceId
• 受管理工作区以外的会话（包括已归档和未分组的会话）永远不会出现在结果里

错误：
• WORKSPACE_MCP_WORKSPACE_UNAVAILABLE（指定的工作区不存在）
• WORKSPACE_MCP_SESSION_SEARCH_DISABLED（该 DSH 部署关闭了会话搜索：会话查询索引 openAt 为 never，需宿主开启并重启；重试无效）
• WORKSPACE_MCP_SESSION_SEARCH_UNAVAILABLE（当前 DSH 版本不支持，或搜索失败）
• WORKSPACE_MCP_INVALID_ID、WORKSPACE_MCP_INVALID_INPUT（参数不合法）
```

**工具：`workspace_file_list`（新增）**

```
输入：
{
  workspaceId: string,
  path?: string,               // 相对路径，默认为根
  depth?: number               // 目录深度，默认 2，最大 5
}

输出：
{
  entries: [
    {
      path: string,
      name: string,
      type: "file" | "directory",
      size?: number,
      mtime?: string
    }
  ]
}

错误：
• NOT_FOUND
• INVALID_PATH
• PERMISSION_DENIED
```

**工具：`workspace_file_read`（新增）**

```
输入：
{
  workspaceId: string,
  path: string,
  encoding?: "utf8" | "base64", // 默认 utf8
  limitBytes?: number            // 最大 1MB
}

输出：
{
  content: string,
  size: number,
  encoding: string,
  truncated: boolean             // 如果超过限制
}

错误：
• NOT_FOUND
• INVALID_PATH
• FILE_TOO_LARGE
```

**工具：`workspace_git_status`（新增）**

```
输入：
{
  workspaceId: string
}

输出：
{
  branch: string,
  tracking?: string,
  ahead: number,
  behind: number,
  staged: string[],              // 已暂存文件
  unstaged: string[],            // 未暂存文件
  untracked: string[]            // 未追踪文件
}

错误：
• NOT_A_GIT_REPO
• GIT_ERROR
```

**工具：`workspace_git_log`（新增）**

```
输入：
{
  workspaceId: string,
  branch?: string,
  limit?: number,                // 最多返回多少条，默认 10
  skip?: number                  // 跳过多少条
}

输出：
{
  commits: [
    {
      hash: string,
      author: string,
      date: string,
      message: string
    }
  ]
}

错误：
• NOT_A_GIT_REPO
• BRANCH_NOT_FOUND
```

**工具：`workspace_git_diff`（新增）**

```
输入：
{
  workspaceId: string,
  path?: string,                 // 可选：指定文件
  fromRef?: string,              // 默认 HEAD
  toRef?: string                 // 默认工作区
}

输出：
{
  diff: string,                  // diff 内容
  stats: {
    insertions: number,
    deletions: number,
    filesChanged: number
  }
}

错误：
• NOT_A_GIT_REPO
• INVALID_REF
```

#### 3.1.2 会话事件拉取：`session_events`（取代原 Webhook 推送，需求 B6）

**工具：`session_events`（新增；宿主专用，由插件清单声明，对 Bot 隐藏）**

```
输入：
{
  cursor?: JSON | null,         // 不透明游标；首次为空
  limit?: number                // 默认且最大 50
}

输出：
{
  events: [
    {
      id: string,               // 稳定的事件标识，1–150 字符，同一事件重复返回时必须相同
      kind: string,             // 见下表
      text: string,             // 供 Bot 阅读的摘要，须含会话标题、工作区名称等关键信息
      occurredAt: string,       // ISO 时间
      actor?: string,           // agentId（如有）
      resourceId: string,       // sessionId
      workspaceId?: string      // 宿主忽略该字段，关键信息请写进 text
    }
  ],
  cursor: JSON                  // 只推进到最后一个已返回的事件
}
```

协议约定（Spec 005.4 design §3.3.1）：

1. 首次调用（`cursor` 为空）返回当前基线游标和空 `events`，只有连接之后发生的事件才会触发订阅
2. 事件按发生顺序升序，单次不超过 `limit` 个
3. 同一事件的 `id` 始终相同；宿主据此去重
4. 出错时返回 MCP 错误结果，宿主保留旧游标并重试
5. 游标早于保留期：从最早保留的事件继续返回，并在第一个事件前插入 `session.events_gap` 事件

事件类型：

| `kind` | 何时产生 | `text` 应包含 |
| --- | --- | --- |
| `session.completed` | 会话执行完成 | 会话标题、工作区、最后一条助手消息的开头 |
| `session.failed` | 会话出错或被中断 | 会话标题、工作区、错误原因 |
| `session.question_asked` | 会话提出待回答的问题 | 会话标题、问题摘要；提示用 `session_questions` 读取 |
| `session.permission_requested` | 会话请求权限 | 会话标题、请求的工具和原因；提示用 `session_permission_status` 查询 |
| `session.message_queued` | 消息进入队列 | `messageId`、队列位置、预计等待时间 |
| `session.message_dequeued` | 消息离开队列 | `messageId`、原因（`processing`、`cancelled`、`prioritized`） |
| `session.events_gap` | 游标早于保留期 | 说明可能有遗漏，建议用 `session_list` 核对 |

后端实现要求：

- 持久的事件日志，每个事件有单调递增的序号；游标可以是 `{ "seq": N }`，首次调用的基线为当前最大序号
- 只记录受管理工作区内会话的事件；已归档、未分组会话不出现（与 B7 一致）
- 至少保留 7 天；服务重启后日志仍在
- `id` 可取 `evt-<序号>`；`actor` 取会话创建或消息发送时记录的 `agentId`
- 不需要知道有哪些 Bot，也不需要记录投递目标或重试

#### 3.1.3 UI 增强

- 消息气泡上显示「发送自Agent」标签
- 标签位置：时间戳左侧或消息气泡右上角
- 点击标签可显示 Agent ID 和相关信息
- 会话列表中显示关联的 Agent ID（如有）

### 3.2 前端（openteam）交付

#### 3.2.0 交付形态与职责划分

OutcomeGo 插件系统是声明式的：插件包只提供配置声明、技能说明和测试，由宿主承担连接、发现、校验和事件入口。DSH-WEB 插件按此规则交付，不包含自定义 connector 进程。

插件包 `packages/plugins/dsh-web/`：

```
plugin.json                 # Remote MCP 连接声明、配置字段（mcpUrl、token）、技能声明、事件轮询声明（后端提供 session_events 后加入）
skills/dsh-web/SKILL.md     # Bot 使用说明（工具、队列、错误、事件订阅）
README.md                   # 配置与边界说明
```

测试位置：`packages/plugins/test/dsh-web.test.ts`（目录与配置契约）、`apps/server/test/plugin/dsh-web.integration.test.ts`（保存与连接，需要数据库环境变量）。`scripts/generate.ts` 自动发现插件目录并生成注册表，不在 `apps/server` 中加入 DSH-WEB 专属代码。

| 能力 | 承担方 | 说明 |
| --- | --- | --- |
| MCP 连接、Streamable HTTP、会话重建 | 宿主 | `apps/server/src/plugins/mcp-client-manager.ts`；会话过期（HTTP 404）后下一次请求重新初始化 |
| 工具发现与输入 Schema | 宿主 | 连接后读取 `tools/list`；连接和发现时限 30 秒 |
| 参数校验与账号隔离 | 宿主 | 按发现的输入 Schema 校验；API Key 按账号保存，不进入导出 |
| 工具调用时限 | 宿主 | 统一管理（当前 60 分钟），插件不能单独设置 |
| 失败重放 | 宿主 | 不重放结果不确定的工具调用 |
| 事件订阅与拉取 | 宿主 | 插件事件轮询（Spec 005.4）：定期调用 `session_events`、去重、保存游标、唤醒匹配的 Bot，见 §3.2.2 |
| 工具用法、前置检查、错误处理指引 | 插件包 | `SKILL.md` |
| 配置字段与 URL 规则 | 插件包、SDK | `plugin.json`、`validateMcpUrl` |
| 工具 Schema、错误码、`session_events` 事件日志 | 后端 |

#### 3.2.1 MCP 连接与工具发现（F1）

- `plugin.json` 的连接声明：`transport: http`、`auth: token`、`endpoint: ${mcpUrl}`、`tools: []`。工具清单来自发现结果，插件不内置、不伪造。
- 配置字段：`mcpUrl`（`format: mcp-url`）和 `token`（`secret: true`，作为 Bearer Token 发送）。
- URL 规则：`localhost` 与局域网私有 IP 可用 HTTP，公网 IP 和域名必须 HTTPS，不允许内嵌凭证。
- 新参数（`agentId`、`priority`）按后端输入 Schema 传递。后端必须在 Schema 中声明类型、必填、长度、格式和取值范围（例如 `priority` 为 0–100），宿主才能完成校验；Schema 没有声明的参数不得由 Bot 传递。
- 后端按 §3.1.1 完成接口后，用契约测试核对：服务端公布 23 个工具，其中 Bot 可见的恰为 22 个（`session_events` 由清单声明后对 Bot 隐藏），且每个工具的输入字段与 §3.1.1 一致。

#### 3.2.2 会话事件订阅（F2）

事件由宿主定期拉取，不使用 Webhook，也不使用插件监听端口，不需要公网地址。机制、协议和限制见 Spec 005.4。

清单声明（已合入 `plugin.json`；后端尚未提供 `session_events` 时，宿主安静地每 15 分钟检查一次，上线后自动生效，见 Spec 005.4 需求 2.2）：

```json
"events": { "pollTool": "session_events", "source": "plugin", "intervalSeconds": 60 }
```

订阅流程：

```
Bot 创建会话 → sessionId
  ↓
UpdateRoutine：{ "type": "plugin", "plugin": "dsh-web", "resourceIds": ["<sessionId>"], "events": [...] }
  或按 agentId：{ "type": "plugin", "plugin": "dsh-web", "actors": ["<agentId>"] }
  ↓
宿主每 60 秒用该账号凭证调用 session_events(cursor)
  ↓
事件匹配订阅 → 唤醒 routine 所属的 Bot，唤醒内容含 <plugin_event>
  ↓
全部事件派发成功后宿主才保存游标
```

规则：

- **订阅就是 routine**：暂停或删除 routine 即取消订阅；订阅必须带 `resourceIds` 或 `actors`，不能订阅全部事件
- **谁被唤醒由订阅决定**：事件中的 `agentId`（`actor`）只是匹配条件之一，宿主不会按它去"查找 Bot"
- **只收连接之后的事件**：首次轮询只建立基线，不会因历史事件集中唤醒
- **延迟等于轮询间隔**：默认 60 秒，最短 30 秒；需要即时结果时 Bot 用 `session_list`、`message_status` 主动查询
- **拉取失败**：认证失败、超时（30 秒）或后端错误时，宿主保留游标并在下个周期重试，不影响其他账号；Bot 在怀疑漏事件时用 `session_list`、`message_status` 核对，不得声称已收到事件
- **多账号**：事件内容含 `account`（连接别名）；触发器暂不按账号过滤，资源标识（`sessionId`）通常全局唯一
- **事件文本是不受信任的数据**：Bot 不得把 `text` 中的内容当作用户授权

事件范围：`session.completed`、`session.failed`、`session.question_asked`、`session.permission_requested`、`session.message_queued`、`session.message_dequeued`，以及游标过期时的 `session.events_gap`（格式见 §3.1.2）。

#### 3.2.3 工具映射与技能说明（F3）

宿主按既有规则（插件、账号命名空间）把发现的工具暴露给 Bot，本规格以后端 MCP 工具名描述，不规定宿主侧显示名。`SKILL.md` 必须覆盖以下 22 个工具：

| 类型 | MCP 工具 | 参数（见 §3.1.1） | 副作用 | 技能说明要点 |
| --- | --- | --- | --- | --- |
| 工作区 | `workspace_list` | — | 只读 | 选择服务端实际返回的工作区 |
| | `workspace_file_list` | workspaceId, path?, depth? | 只读 | 使用相对路径，遵循深度限制 |
| | `workspace_file_read` | workspaceId, path, encoding?, limitBytes? | 只读 | 遵循 1 MB 限制，注意 `truncated` |
| | `workspace_git_status` | workspaceId | 只读 | 非 Git 仓库返回 NOT_A_GIT_REPO |
| | `workspace_git_log` | workspaceId, branch?, limit?, skip? | 只读 | 用 `limit`、`skip` 分页 |
| | `workspace_git_diff` | workspaceId, path?, fromRef?, toRef? | 只读 | 大 diff 先按文件缩小范围 |
| 会话 | `session_list` | workspaceId, limit?, offset? | 只读 | 查找目标会话，也用于核对状态 |
| | `session_create` | workspaceId, adapterId?, modelId?, prompt?, agentId?, priority? | 写 | 只传 Schema 接受的参数 |
| | `session_continue` | sessionId, message, agentId? | 写 | 报告回执中的 `messageId`、`status`、`queuePosition` |
| | `session_queue_peek` | sessionId, limit?, includeProcessing? | 只读 | 查看当前处理消息和队列 |
| | `session_history` | sessionId, limit?, cursor? | 只读 | 汇报进展前先读最近的消息；`hasMore` 为真时用 `nextCursor` 往前翻；被截短的消息带 `truncated`，只报告实际读到的文字 |
| | `session_search` | query, workspaceId?, limit? | 只读 | 只覆盖受管理工作区，没找到不代表别处没有；结果可能少于 `limit`，`hasMore` 为真时缩短关键词或指定 `workspaceId` |
| 消息 | `message_status` | sessionId, messageId | 只读 | 读取 `canCancel`、`canPrioritize` 后再操作 |
| | `message_cancel` | sessionId, messageId | 写 | 仅对排队中的消息，先查状态 |
| | `message_prioritize` | sessionId, messageId, priority | 写 | 返回 `newPosition`，向用户报告 |
| 问题 | `session_questions` | sessionId | 只读 | 获取待答问题 |
| | `session_answer` | sessionId, callId, answer | 写 | 先确认问题仍待回答 |
| 权限 | `session_request_permission` | sessionId, toolName, reason, callId? | 写 | 仅在会话上下文需要时调用 |
| | `session_permission_status` | sessionId, requestId | 只读 | 轮询授权结果 |
| 终端 | `terminal_list` | workspaceId, sessionId | 只读 | 获取终端 ID |
| | `terminal_read` | workspaceId, sessionId, terminalId, limitBytes? | 只读 | 遵循大小限制 |
| | `terminal_write` | workspaceId, sessionId, terminalId, data | 写 | 写入前向用户确认命令内容 |

结果只报告实际返回的字段，不推断未返回的队列位置或预计等待时间。文件和 Git 工具只读，插件不声明文件写入或 Git 写操作。

#### 3.2.4 错误处理、超时与重试（F4）

| 场景 | 处理方 | 行为 |
| --- | --- | --- |
| API Key 无效（HTTP 401/403） | 宿主返回，技能说明 | 提示检查该账号配置的 DSH-WEB API Key，不重试 |
| 连接或工具发现超时 | 宿主 | 30 秒后失败；用户可在 Installed 中重新连接或刷新工具 |
| 工具调用较慢 | 宿主、后端 | 宿主统一时限；后端文件和 Git 操作 5 秒保护，耗时工作走会话异步，用状态查询或事件订阅获取结果 |
| 事件拉取失败 | 宿主 | 保留游标，下个周期重试，同一连接 10 分钟内最多记录一次；Bot 在怀疑漏事件时用 `session_list`、`message_status` 核对 |
| 网络中断，结果不确定 | 宿主、技能说明 | 宿主不重放；只读工具可由 Bot 重试；有副作用的工具先用 `session_list`、`message_status`、`session_queue_peek` 核对再决定 |
| MCP 会话过期（HTTP 404） | 宿主 | 丢弃旧会话，下一次显式请求重新初始化，不重放上次调用 |
| 后端返回错误码 | 后端、技能说明 | 保留错误码与消息；按下表给出指引 |

后端错误码的处理指引（写入 `SKILL.md`）：

| 错误码 | 指引 |
| --- | --- |
| `NOT_FOUND`、`SESSION_NOT_FOUND` | 用 `session_list` 或 `workspace_list` 重新确认目标，不重复创建 |
| `INVALID_PATH`、`FILE_TOO_LARGE` | 修正为工作区内相对路径，或缩小读取范围 |
| `NOT_A_GIT_REPO`、`BRANCH_NOT_FOUND`、`INVALID_REF` | 告知用户该工作区或引用不可用，不继续猜测 |
| `CANNOT_CANCEL`、`INVALID_PRIORITY` | 重新调用 `message_status` 读取 `canCancel`、`canPrioritize`，再向用户报告 |
| `INVALID_AGENT_ID` | 不再传 `agentId`，或向用户确认稳定的标识 |
| `QUEUE_FULL`、`QUEUE_CONFLICT` | 先用 `session_queue_peek` 查看队列，向用户说明，不连续重发 |
| `WORKSPACE_MCP_SESSION_UNAVAILABLE` | 用 `session_list` 确认该会话仍在受管理工作区内；不要换成别的会话重试，也不要猜测历史内容 |
| `WORKSPACE_MCP_SESSION_SEARCH_DISABLED` | 告知用户该 DSH 部署没有开启会话搜索，需要宿主管理员开启会话查询索引；不要重试，改用 `session_list` 按标题查找 |
| `WORKSPACE_MCP_SESSION_HISTORY_UNAVAILABLE`、`WORKSPACE_MCP_SESSION_SEARCH_UNAVAILABLE` | 告知用户当前 DSH 版本或这次读取暂时不可用，改用 `session_list` 查看标题和状态，不重复重试 |

日志与敏感信息：API Key 是 `secret` 字段，由宿主按账号单独保存，不出现在插件包、导出和对话中；插件包不写日志；`agentId` 不是凭证，但文档示例不使用真实值。

#### 3.2.5 Bot 工作流约定（F2.1）

- **`agentId` 的使用**：只有工作流提供了稳定的 Bot 标识，且当前 Schema 接受 `agentId` 时才传；不要把任意 Bot 名称当作 `agentId`。同一 Bot 在 `session_create` 和 `session_continue` 中使用同一个值。
- **发送消息**：调用 `session_continue` 后读取回执；`processing` 则等待会话完成；`queued` 则可用 `session_queue_peek` 查看，必要时先 `message_status` 再 `message_cancel` 或 `message_prioritize`。
- **订阅与等待完成**：创建会话后为它（或为自己的 `agentId`）创建 `plugin` 触发器的 routine；保存的提示词写明事件到达后要做什么，处理完成后删除 routine。未订阅或怀疑漏事件时，用 `session_list`、`message_status` 查询。
- **处理事件**：`session.completed`、`session.failed` 继续或终止工作流；`session.question_asked`、`session.permission_requested` 交给 `session_questions`、`session_answer` 或权限工具；`session.message_queued`、`session.message_dequeued` 用来更新队列判断。
- **了解会话进展**：接手一个会话或汇报进展前，先用 `session_history` 读最近的消息；想找讨论过某件事的会话时用 `session_search`。两者只覆盖受管理工作区，没读到或没搜到不代表别处没有；只报告实际读到的文字，不补写被截短或被略过的内容。

## 4. 数据与状态模型

### 4.1 会话生命周期（升级）

```
创建（包含 agentId）
    ↓
队列等待（如果有优先级冲突）
    ↓
处理中（DSH 执行）
    ↓
完成或出错
    ↓
事件回传给 agentId 对应的机器人
```

### 4.2 事件读取语义

```
首次调用（cursor 为空）
    → 返回基线游标，没有事件
之后每个周期
    → 返回游标之后的事件（≤ 50 个，升序）
    → 宿主派发全部成功后保存新游标
    → 任一事件派发失败：保留旧游标，下个周期重新返回，宿主按事件 id 去重
游标早于保留期
    → 从最早保留的事件继续，先返回 session.events_gap
```

## 5. 错误处理

### 5.1 后端错误码

- `INVALID_AGENT_ID`：agentId 格式无效
- `QUEUE_FULL`：会话队列已满
- `QUEUE_CONFLICT`：优先级冲突
- `NOT_A_GIT_REPO`：工作区非 Git 仓库
- `INVALID_PATH`：路径包含不安全字符

### 5.2 前端错误处理

错误处理遵守宿主语义，详见 §3.2.4：

- 认证失败 → 宿主返回认证错误，技能说明提示检查 API Key，不重试
- 连接或发现超时 → 宿主 30 秒后失败，用户重新连接
- 结果不确定的工具调用 → 宿主不重放，Bot 先查询状态再决定
- 事件拉取失败 → 宿主保留游标并重试；Bot 改用状态查询
- `agentId` 无对应订阅 → 事件不唤醒任何 Bot，也不是错误；OutcomeGo 侧不存在按 `agentId` 查找 Bot 的步骤

## 6. 测试策略

### 后端测试（dsh-codingns）

- 单元测试：agentId 存储、队列管理、文件读取、Git 操作、会话历史（排序、翻页、大小上限、Agent 标注）和会话搜索（受管理范围过滤）
- 授权测试：已归档和受管理工作区以外的会话，`session_history` 被拒绝、`session_search` 不返回
- 真实 DSH 验证：读一个已有会话的历史、搜一个已知关键词（模拟数据无法证明事件结构与真实 DSH 一致）
- 集成测试：完整的会话流程（create → continue → complete → `session_events`）；事件日志的游标、基线、保留期与 `session_events` 的受管理范围过滤
- UI 测试：Agent 标签显示

### 前端测试（openteam）

- 目录与配置测试（`packages/plugins/test/dsh-web.test.ts`）：`plugin.json` 声明、配置字段校验、连接声明为 Remote MCP 且 `tools` 为空
- 技能契约测试：`SKILL.md` 覆盖 §3.2.3 的 22 个工具名和 §3.2.4 的错误码指引
- 服务端集成测试（`apps/server/test/plugin/dsh-web.integration.test.ts`，需 `OUTCOMEGO_TEST_DATABASE_URL`）：保存配置、连接、使用模拟 DSH-WEB MCP 服务完成工具发现与调用，并验证 Bot 可见的是 22 个工具、`session_events` 被隐藏、Schema 与 §3.1.1 一致
- 事件订阅联调：为 Bot 创建 `plugin` 触发器的 routine，DSH-WEB 产生 6 类事件，验证匹配的 Bot 被唤醒、不匹配的不被唤醒、重复拉取不重复运行、首次连接不集中唤醒历史事件
- 端到端：真实 DSH-WEB 后端上覆盖 22 个工具，以及多个 Bot 各自订阅不同会话互不干扰

## 7. 风险与待确认项

### 风险

- **并发冲突**：多个 Bot 同时修改会话状态可能导致不一致。缓解：使用乐观锁或版本号。
- **事件延迟与遗漏**：宿主按间隔拉取，间隔内没有通知；事件日志过期会遗漏。缓解：默认 60 秒、最短 30 秒；后端至少保留 7 天；游标过期时返回 `session.events_gap`；Bot 可用 `session_list`、`message_status` 核对。
- **性能**：文件和 Git 操作可能较慢。缓解：设置超时和大小限制。
- **轮询成本**：每个账号每个周期调用一次 `session_events`。缓解：单次 ≤50 个、响应 ≤500ms；间隔可在 30–3600 秒内调整；没有匹配订阅的事件不唤醒任何 Bot，不产生模型成本。
- **订阅范围与事件内容**：订阅必须带 `resourceIds` 或 `actors`，避免全量唤醒；事件 `text` 来自会话内容，宿主把它标为不受信任的数据。后端应避免在 `text` 中放入大段原始内容。
- **不重放工具调用**：网络中断时有副作用的工具结果不确定。缓解：技能说明要求先查询状态；后端为 `session_continue` 等工具提供可核对的状态（`messageId`、`message_status`）。
- **工具数量口径**：此前文档出现 15、18、20 三种口径，统一以 §3.2.3 的 22 个为准（原有 11 个 + 新增 11 个，其中 B7 补充的 `session_history`、`session_search` 为最后 2 个）。
- **会话搜索覆盖不全**：DSH 的搜索在整个 Host 范围内进行并最多返回 20 个会话，之后才按受管理范围过滤。Host 上有大量会话（例如上千个）而受管理的只有少数时，命中的受管理会话可能被挤出前 20 个。缓解：搜索接口只接收关键词，后端无法绕开；`session_search` 用 `hasMore` 提示，由 Bot 缩短关键词或指定 `workspaceId`，文档写明这一限制。
- **会话历史含敏感内容**：消息里可能有用户粘贴的密钥或路径。缓解：只面向受管理工作区；只返回文字；不返回文件系统根路径；API Key 的授权边界不变。是否需要对内容做脱敏列入待确认项。

### 待确认项

- [ ] dsh-codingns MCP 服务的性能指标（响应时间、并发限制）
- [ ] 事件日志的保留期（建议至少 7 天）和游标过期时的行为（建议 `session.events_gap`）
- [ ] 文件和 Git 操作的超时设置
- [ ] agentId 的格式规范
- [ ] 是否需要支持 agentId 的权限控制
- [ ] 默认 60 秒的轮询间隔是否满足场景；是否把 DSH-WEB 的 `intervalSeconds` 设为 30 秒
- [ ] Bot 的稳定标识如何提供给工作流，用作 `agentId`
- [ ] `plugin` 触发器唤醒 Bot 时，Bot 看到的 `<plugin_event>` 内容（联调核对后写入 `SKILL.md`）
- [ ] `session_history` 的事件结构（`user/message`、`assistant/message`）在真实 DSH 上是否与实现一致（目前只用模拟数据验证）
- [ ] `session_history` 的大小上限（每条 8 KiB、每页 256 KiB）是否满足 Bot 汇报场景
- [ ] 是否需要对会话历史里的密钥等敏感内容做脱敏
- [ ] 是否要把搜索和历史扩展到未分组会话（当前明确不做，需另立规格并重新评估授权边界）
- [ ] 错误码命名：已有的队列工具用 `SESSION_NOT_FOUND` 这类短码，其他工具用 `WORKSPACE_MCP_` 前缀，B7 沿用后者；是否统一，待后端确认
