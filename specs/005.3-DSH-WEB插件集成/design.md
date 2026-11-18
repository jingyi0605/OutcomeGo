# 设计文档 - DSH-WEB 与 OutcomeGo 跨工作区集成

状态：Draft

## 1. 概述

### 1.1 目标

- 设计 DSH-WEB（dsh-codingns）和 OutcomeGo（openteam）之间的完整集成方案
- 升级 DSH-WEB MCP 以支持 Agent 消息识别、会话关联、队列管理、文件/Git 工具
- 升级 DSH-WEB Webhook 以支持可靠的事件回传
- 实现 OutcomeGo 插件作为 MCP 客户端和 Webhook 接收方

### 1.2 工作区分工

| 工作区 | 职责 | 升级内容 |
| --- | --- | --- |
| **dsh-codingns**（后端） | MCP 服务器、会话管理、事件发送 | MCP 工具扩展、Webhook 增强、UI 标签显示 |
| **openteam**（前端） | MCP 客户端、插件、Bot 集成 | 新工具映射、Webhook 接收、Bot 工作流 |

### 1.3 覆盖需求

- dsh-codingns：B1-B6（6 个后端需求）
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
│  │    DSH-WEB 插件（MCP 客户端 + Webhook 接收方）         │  │
│  │  • 工具：session_*、workspace_file_*、workspace_git_* │  │
│  │  • Webhook 端点：http://localhost:9999/webhook       │  │
│  │  • 事件路由：根据 agentId 分发到对应 Bot             │  │
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
│  │  │ • session_queue_status（新）                   │  │  │
│  │  │ • terminal_list、terminal_read、terminal_write│  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ UI 增强                                         │  │  │
│  │  │ • 消息显示 Agent 标签                           │  │  │
│  │  │ • 会话队列可视化                               │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │        Webhook 服务（升级）                            │  │
│  │  • 存储和重试机制                                     │  │
│  │  • 事件队列：session.completed、session.failed...     │  │
│  │  • 推送到 OutcomeGo Webhook 端点                      │  │
│  │  • 包含 agentId、sessionId、workspaceId              │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 关键流程

#### 2.2.1 Bot 创建会话并关联 Agent ID

```
Bot 1 发起创建会话请求
    ↓
OutcomeGo 插件调用 session_create
    • workspaceId: "ws-001"
    • agentId: "bot-1"
    • adapterId: "dsh"
    ↓
DSH-WEB 创建会话
    • 存储 agentId = "bot-1"
    • 返回 sessionId = "sess-123"
    ↓
OutcomeGo 插件返回 sessionId 给 Bot 1
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

#### 2.2.3 会话完成，Webhook 回传事件

```
会话执行完成或出错
    ↓
DSH-WEB 生成 Webhook 事件
    {
      "eventId": "evt_...",
      "eventType": "session.completed",
      "sessionId": "sess-123",
      "agentId": "bot-1",
      "workspaceId": "ws-001",
      "data": { "lastMessage": "..." }
    }
    ↓
DSH-WEB Webhook 服务进行重试
    • 推送到 OutcomeGo 插件
    • 失败时指数退避重试（1s、2s、4s）
    ↓
OutcomeGo 插件接收 Webhook
    • 解析 agentId = "bot-1"
    • 查找对应的 Bot 1
    ↓
OutcomeGo Bot 1 处理事件
    • 获取完成状态
    • 继续后续工作流
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

#### 3.1.2 Webhook 事件升级

**事件格式（所有事件通用）**

```json
{
  "eventId": "evt_<sha256>",
  "eventType": "session.completed" | "session.failed" | "session.permission_requested" | "session.question_asked" | "session.queue_changed" | "session.agent_message_sent",
  "occurredAt": "2026-01-01T00:00:00Z",
  "destinationId": "webhook-1",
  "workspace": {
    "id": "ws-001",
    "name": "my-project"
  },
  "session": {
    "id": "sess-123",
    "title": "Session Title"
  },
  "agentId": "bot-1",              // 新增字段
  "data": { /* 事件特定数据 */ }
}
```

**新增事件：`session.message_queued`**

```json
{
  "eventType": "session.message_queued",
  "data": {
    "messageId": "msg-123",
    "queuePosition": 2,
    "estimatedWaitMs": 8000
  }
}
```

**新增事件：`session.message_dequeued`**

```json
{
  "eventType": "session.message_dequeued",
  "data": {
    "messageId": "msg-123",
    "reason": "processing" | "cancelled" | "prioritized"
  }
}
```

**新增事件：`session.agent_message_sent`**

```json
{
  "eventType": "session.agent_message_sent",
  "data": {
    "message": "Message content",
    "agentId": "bot-1"
  }
}
```

#### 3.1.3 UI 增强

- 消息气泡上显示「发送自Agent」标签
- 标签位置：时间戳左侧或消息气泡右上角
- 点击标签可显示 Agent ID 和相关信息
- 会话列表中显示关联的 Agent ID（如有）

### 3.2 前端（openteam）新增

#### 3.2.1 MCP 客户端升级

- 支持所有新增 MCP 参数（agentId、priority）
- 支持所有新增工具（文件、Git、队列）
- 正确处理错误码和响应

#### 3.2.2 Webhook 接收端点

```
POST /webhook/dsh-web

接收 DSH-WEB Webhook 事件
解析 agentId
查找对应的机器人
触发机器人的事件回调
```

#### 3.2.3 工具映射

OutcomeGo 插件中的工具列表（共 18 个）：

| 类型 | 工具名 | 映射到 MCP | 参数 |
| --- | --- | --- | --- |
| 工作区 | `dsh_web.workspace_list` | workspace_list | {} |
| | `dsh_web.workspace_file_list` | workspace_file_list | workspaceId, path?, depth? |
| | `dsh_web.workspace_file_read` | workspace_file_read | workspaceId, path, encoding?, limitBytes? |
| | `dsh_web.workspace_git_status` | workspace_git_status | workspaceId |
| | `dsh_web.workspace_git_log` | workspace_git_log | workspaceId, branch?, limit?, skip? |
| | `dsh_web.workspace_git_diff` | workspace_git_diff | workspaceId, path?, fromRef?, toRef? |
| 会话 | `dsh_web.session_list` | session_list | workspaceId, limit?, offset? |
| | `dsh_web.session_create` | session_create | workspaceId, adapterId?, modelId?, prompt?, agentId? |
| | `dsh_web.session_continue` | session_continue | sessionId, message, agentId? |
| | `dsh_web.message_status` | message_status | sessionId, messageId |
| | `dsh_web.message_cancel` | message_cancel | sessionId, messageId |
| | `dsh_web.message_prioritize` | message_prioritize | sessionId, messageId, priority |
| | `dsh_web.session_queue_peek` | session_queue_peek | sessionId, limit?, includeProcessing? |
| 问题 | `dsh_web.session_questions` | session_questions | sessionId |
| | `dsh_web.session_answer` | session_answer | sessionId, callId, answer |
| 权限 | `dsh_web.session_request_permission` | session_request_permission | sessionId, toolName, reason, callId? |
| | `dsh_web.session_permission_status` | session_permission_status | sessionId, requestId |
| 终端 | `dsh_web.terminal_list` | terminal_list | workspaceId, sessionId |
| | `dsh_web.terminal_read` | terminal_read | workspaceId, sessionId, terminalId, limitBytes? |
| | `dsh_web.terminal_write` | terminal_write | workspaceId, sessionId, terminalId, data |

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

### 4.2 Webhook 重试策略

```
事件生成
    ↓
首次投递
    ├─ 成功 → 标记为已传递
    └─ 失败 → 进入重试队列
        ↓
    等待 1 秒
        ↓
    重试 1 → 成功/失败
    重试 2 → 成功/失败
    重试 3 → 成功/失败
        ↓
    若全部失败 → 记录失败事件
```

## 5. 错误处理

### 5.1 后端错误码

- `INVALID_AGENT_ID`：agentId 格式无效
- `QUEUE_FULL`：会话队列已满
- `QUEUE_CONFLICT`：优先级冲突
- `NOT_A_GIT_REPO`：工作区非 Git 仓库
- `INVALID_PATH`：路径包含不安全字符

### 5.2 前端错误处理

- 连接失败 → 重试
- Webhook 接收失败 → 记录日志
- agentId 不存在 → 记录日志，不报错

## 6. 测试策略

### 后端测试（dsh-codingns）

- 单元测试：agentId 存储、队列管理、文件读取、Git 操作
- 集成测试：完整的会话流程（create → continue → complete → webhook）
- UI 测试：Agent 标签显示

### 前端测试（openteam）

- 单元测试：参数转换、错误映射、Webhook 解析
- 集成测试：工具调用、事件路由、Bot 回调
- 端到端测试：多个 Bot 并发使用

## 7. 风险与待确认项

### 风险

- **并发冲突**：多个 Bot 同时修改会话状态可能导致不一致。缓解：使用乐观锁或版本号。
- **Webhook 丢失**：网络故障可能导致事件未被正确传递。缓解：完善重试和日志机制。
- **性能**：文件和 Git 操作可能较慢。缓解：设置超时和大小限制。

### 待确认项

- [ ] dsh-codingns MCP 服务的性能指标（响应时间、并发限制）
- [ ] Webhook 回调的最大重试次数和间隔
- [ ] 文件和 Git 操作的超时设置
- [ ] agentId 的格式规范
- [ ] 是否需要支持 agentId 的权限控制
