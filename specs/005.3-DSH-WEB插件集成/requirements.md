# 需求文档 - DSH-WEB 与 OutcomeGo 跨工作区集成

状态：Draft

## 简介

本规格定义了跨两个工作区的协作开发计划，以实现 codingns4dsh（DSH-WEB / CodingNS）与 OutcomeGo 的深度集成。

**后端侧（dsh-codingns）**：升级 MCP 服务器和 Webhook 机制，支持：
- Agent 消息标识和回溯（UI 标签显示、机器人 ID 跟踪）
- 会话与机器人的关联，事件回传
- 扩展 MCP 工具：工作区文件、工作区 Git
- 会话队列、插队等高级功能

**前端侧（openteam）**：实现 OutcomeGo 插件，调用这些升级的功能。

**核心价值**：
- OutcomeGo Bot 能够直接在 DSH-WEB 工作区中操作（文件、Git、会话）
- 跨机器人的会话管理和事件同步
- 提升开发工作流的连贯性和自动化程度

## 术语表

- **dsh-codingns**：CodingNS 工作区（后端），需要升级 MCP 和 Webhook
- **openteam**：OutcomeGo 工作区（前端），实现插件和集成
- **MCP（Model Context Protocol）**：两个系统间的标准通信协议
- **Agent 消息**：由 OutcomeGo Bot 通过 MCP 发送到 DSH-WEB 会话的消息
- **机器人 ID（agentId）**：OutcomeGo Bot 的唯一标识符
- **会话队列**：多个 Agent 等待会话资源的队列
- **会话插队**：允许高优先级任务中断低优先级任务
- **Webhook 回传**：DSH-WEB 会话完成/出错时向 OutcomeGo 推送事件

## 范围说明

### In Scope - dsh-codingns 后端升级

#### 会话侧的升级

1. **Agent 消息识别**
   - MCP `session_continue` 新增可选参数 `agentId`
   - UI 识别该参数，在消息上显示「发送自Agent」标签
   - 标签显示在时间戳的左侧（或消息气泡上）
   - 存储 agentId 以便后续关联和审计

2. **会话与机器人关联**
   - MCP `session_create` 新增可选参数 `agentId`
   - 会话完成或出错时，Webhook 回传事件包含 `agentId`
   - OutcomeGo 能够识别并路由事件回对应的机器人

3. **会话队列与插队**
   - 支持识别多个 Agent 的并发请求
   - 支持设置优先级（可选）
   - 支持在必要时插队（中断低优先级任务）
   - Webhook 通知队列变化

#### MCP 工具的升级与扩展

4. **扩展文件查看工具**
   - `workspace_file_list`：列出工作区文件树
   - `workspace_file_read`：读取文件内容
   - 支持大小限制和编码处理

5. **扩展 Git 查看工具**
   - `workspace_git_status`：查看 Git 状态
   - `workspace_git_log`：查看提交历史
   - `workspace_git_diff`：查看文件变更
   - 支持分支和范围查询

6. **完善终端工具**
   - 已有 `terminal_list/read/write`，确保性能和并发安全

#### Webhook 机制的升级

7. **Webhook 事件类型扩展**
   - 现有：`session.completed`、`session.failed`、`session.permission_requested`、`session.question_asked`
   - 新增：`session.queue_changed`、`session.agent_message_sent`
   - 所有事件都包含 `agentId`（如有）

8. **Webhook 确保传递**
   - 存储未成功传递的 Webhook 事件
   - 支持指数退避重试
   - 支持多个 Webhook 目标（OutcomeGo 插件注册）

### In Scope - openteam 前端插件实现

9. **MCP 客户端升级**
   - 支持所有新增/升级的 MCP 参数
   - 正确处理 `agentId` 和优先级参数
   - 支持文件和 Git 工具

10. **Webhook 接收与事件处理**
    - OutcomeGo 插件注册 Webhook 端点
    - 接收并解析 DSH-WEB 的 Webhook 事件
    - 根据 `agentId` 路由事件回对应的机器人

11. **Bot 工作流支持**
    - Bot 能够调用文件和 Git 工具
    - Bot 能够处理会话的完成/错误事件
    - Bot 能够管理会话队列

### Out of Scope

- 远程连接到 DSH-WEB（仅支持本地）
- 文件写入和修改（仅支持读取）
- Git 写操作（push、commit 等，仅支持查看）
- 实时消息流（仅支持轮询）
- SSO 和多租户（单用户/本地）

## 需求（按工作区分组）

### 一、dsh-codingns 后端需求

#### 需求 B1：Agent 消息识别与标签显示

**用户故事**：作为 DSH-WEB 用户，我希望当看到来自 OutcomeGo Agent 的消息时，能够识别出这是一条「自动」消息，而非用户输入。

**验收标准**：

1. WHEN Agent 通过 MCP `session_continue` 发送消息且提供 `agentId` THEN 会话存储该 agentId
2. WHEN 消息在 UI 中显示 THEN 在时间戳左侧显示「发送自Agent」标签（或类似标识）
3. WHEN 用户点击标签 THEN 显示该 Agent 的 ID 和相关信息（可选）
4. WHEN 导出或查看会话历史 THEN Agent 消息被正确标记

#### 需求 B2：会话与机器人关联，事件回传

**用户故事**：作为 OutcomeGo 开发者，我希望 DSH-WEB 会话完成时，能够收到事件通知并获知完成的会话属于哪个 Agent。

**验收标准**：

1. WHEN Agent 通过 MCP `session_create` 创建会话时，可选提供 `agentId` THEN 会话记录该关联
2. WHEN 会话完成 THEN Webhook 事件包含 `agentId`，OutcomeGo 能据此路由事件回对应机器人
3. WHEN 会话出错或被中断 THEN Webhook 事件同样包含 `agentId` 和错误原因
4. WHEN 同一工作区有多个并发会话 THEN 事件能够正确区分各会话的 agentId

#### 需求 B3：消息队列透明化与操作能力

**用户故事**：作为 OutcomeGo Bot，我希望在发送消息到会话时，能够了解消息是否进入了队列，并且具备查询、取消、插队等队列操作能力，以便精细控制工作流。

**验收标准**：

1. WHEN Bot 调用 `session_continue` 发送消息 THEN 返回消息回执，包含状态、队列位置、预期等待时间
   - 状态可为：`processing`（立即处理）、`queued`（进入队列）、`completed`（已完成）
   - 如果是 `queued`，返回队列位置（从 1 开始）和预期等待时间（毫秒）

2. WHEN Bot 需要查询消息状态 THEN 新增 `message_status` 工具返回消息当前状态及队列位置

3. WHEN Bot 想要取消排队的消息 THEN 新增 `message_cancel` 工具取消队列中的消息
   - 前提：消息还未开始处理
   - 返回：取消成功或失败原因

4. WHEN Bot 想要对消息进行插队 THEN 新增 `message_prioritize` 工具将消息提前处理
   - 支持设置优先级参数（数值越高越优先）
   - 返回：新的队列位置

5. WHEN Bot 需要了解队列现状 THEN 新增 `session_queue_peek` 工具查看当前队列中的消息列表
   - 返回：队列中的消息及其优先级、状态等信息
   - 支持分页（limit）

6. WHEN 消息在队列中的状态变化 THEN Webhook 通知 `session.message_queued` 或 `session.message_dequeued` 事件

#### 需求 B4：文件查看工具（新增）

**用户故事**：作为 OutcomeGo Bot，我希望能够查看 DSH-WEB 工作区中的文件，以便进行代码分析和自动化处理。

**验收标准**：

1. WHEN 新增 MCP 工具 `workspace_file_list` THEN 返回工作区文件树（目录结构）
2. WHEN 新增 MCP 工具 `workspace_file_read` THEN 返回文件内容（支持二进制和文本）
3. WHEN 文件大于限制大小 THEN 返回错误或支持分块读取
4. WHEN 路径包含不安全字符（..等） THEN 拒绝并返回错误
5. WHEN 文件不存在 THEN 返回 NOT_FOUND 错误

#### 需求 B5：Git 查看工具（新增）

**用户故事**：作为 OutcomeGo Bot，我希望能够查看工作区的 Git 信息（状态、提交历史、文件变更）。

**验收标准**：

1. WHEN 新增 MCP 工具 `workspace_git_status` THEN 返回当前分支、修改文件、未暂存等状态
2. WHEN 新增 MCP 工具 `workspace_git_log` THEN 返回提交历史（支持分支、范围、限制条数）
3. WHEN 新增 MCP 工具 `workspace_git_diff` THEN 返回文件变更对比
4. WHEN 工作区非 Git 仓库 THEN 返回 NOT_A_GIT_REPO 错误
5. WHEN 查询涉及网络操作（如 fetch） THEN 返回支持超时和错误处理

#### 需求 B6：Webhook 机制增强

**用户故事**：作为系统集成者，我希望 DSH-WEB 的 Webhook 能够可靠地传递会话事件，包含足够的上下文信息。

**验收标准**：

1. WHEN Webhook 事件被创建 THEN 包含 `agentId`、`sessionId`、`workspaceId`、时间戳等信息
2. WHEN 首次 Webhook 传递失败 THEN 系统进行指数退避重试（最多 3 次）
3. WHEN 所有重试都失败 THEN 系统记录失败事件，便于后续审计和恢复
4. WHEN OutcomeGo 注册多个 Webhook 目标 THEN 系统能够管理和路由事件到各目标

### 二、openteam 前端需求

#### 需求 F1：MCP 客户端参数支持

**用户故事**：作为 OutcomeGo Bot 开发者，我希望在调用 DSH-WEB MCP 工具时，能够传递 `agentId` 等新参数。

**验收标准**：

1. WHEN Bot 调用 `session_continue` THEN 能够提供 `agentId` 参数
2. WHEN Bot 调用 `session_create` THEN 能够提供 `agentId` 参数
3. WHEN Bot 调用新的文件工具 THEN 参数被正确传递到后端
4. WHEN Bot 调用新的 Git 工具 THEN 参数被正确传递到后端

#### 需求 F2：Webhook 接收与事件处理

**用户故事**：作为 OutcomeGo 系统，我希望能够接收来自 DSH-WEB 的 Webhook 事件，并根据 `agentId` 路由事件回对应的机器人。

**验收标准**：

1. WHEN DSH-WEB Webhook 事件到达 THEN OutcomeGo 插件的 Webhook 端点接收并解析
2. WHEN 事件包含 `agentId` THEN OutcomeGo 查找对应的机器人并触发回调
3. WHEN 机器人不存在 THEN 系统记录日志，不报错
4. WHEN 事件包含会话完成状态 THEN 机器人能够处理并继续后续工作

#### 需求 F3：新工具的插件映射

**用户故事**：作为 OutcomeGo Bot，我希望能够调用文件、Git、队列等新工具。

**验收标准**：

1. WHEN Bot 调用 `workspace_file_list` 工具 THEN OutcomeGo 插件正确映射到后端
2. WHEN Bot 调用 `workspace_file_read` 工具 THEN 返回文件内容
3. WHEN Bot 调用 `workspace_git_*` 工具 THEN 返回 Git 信息
4. WHEN Bot 调用 `session_queue_status` THEN 返回队列状态

#### 需求 F4：错误处理与超时

**用户故事**：作为 OutcomeGo 用户，我希望在 DSH-WEB 操作异常时收到清晰的错误提示。

**验收标准**：

1. WHEN 后端工具调用失败 THEN OutcomeGo 返回清晰的错误码和消息
2. WHEN 操作超时 THEN OutcomeGo 在 30 秒后返回超时错误
3. WHEN 网络故障 THEN OutcomeGo 进行自动重试（指数退避）

## 非功能需求

### 后端（dsh-codingns）

1. **性能**：
   - 文件列表操作在 500ms 内返回（深度 ≤ 3）
   - Git 操作在 2s 内返回
   - Webhook 事件在 100ms 内发出

2. **可靠性**：
   - Webhook 事件至少尝试传递 3 次
   - 并发会话不超过 10 个时性能无明显下降
   - 队列管理不占用过多内存

3. **安全性**：
   - 路径验证防止目录穿越
   - agentId 不被意外暴露在日志中

### 前端（openteam）

1. **性能**：
   - 工具调用响应时间 < 3s
   - 支持 10 个并发 Bot

2. **可靠性**：
   - 网络故障时自动重试
   - Webhook 接收端点可用性 > 99%

3. **安全性**：
   - API Key 加密存储
   - agentId 和敏感信息不在日志中暴露

## 成功定义

- ✓ dsh-codingns 升级了 MCP 和 Webhook，支持 Agent 消息标识、会话关联、队列管理、文件/Git 工具
- ✓ openteam 插件能够调用所有新增工具并处理 Webhook 事件
- ✓ Bot 能够执行完整工作流（创建会话 → 发送消息 → 接收完成事件 → 继续后续任务）
- ✓ 多个 Bot 并发使用不会互相干扰
- ✓ 会话队列、插队等高级功能能正常工作
- ✓ 用户在 DSH-WEB UI 中能看到「发送自Agent」标签
- ✓ 所有通信都安全、可靠、性能良好
