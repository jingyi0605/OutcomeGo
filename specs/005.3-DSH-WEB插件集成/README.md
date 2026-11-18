# DSH-WEB 与 OutcomeGo 跨工作区集成 (005.3)

## 概述

本规格定义了一个**跨两个工作区的协作开发计划**，以实现 codingns4dsh（DSH-WEB / CodingNS）和 OutcomeGo 的深度集成。

### 后端侧（dsh-codingns）

升级 MCP 服务器和 Webhook 机制，支持：
- **Agent 消息标识**：消息来自 Agent 时显示「发送自Agent」标签
- **会话与机器人关联**：会话完成/错误时回传事件给对应的机器人
- **会话队列管理**：支持多 Agent 并发、优先级、插队
- **文件查看工具**：新增 `workspace_file_list` 和 `workspace_file_read`
- **Git 查看工具**：新增 `workspace_git_status`、`workspace_git_log`、`workspace_git_diff`
- **Webhook 可靠性**：事件包含 agentId，失败时自动重试

### 前端侧（openteam）

实现 OutcomeGo 插件，支持：
- **MCP 客户端升级**：调用所有新增工具和参数
- **Webhook 接收**：接收 DSH-WEB 事件并路由回对应 Bot
- **Bot 工作流**：Bot 能创建会话、发送消息、处理完成事件

## 文档结构

```
specs/005.3-DSH-WEB插件集成/
├── README.md           # 本文档（项目总览）
├── requirements.md     # 7 个需求（分后端 B1-B6 和前端 F1-F4）
├── design.md           # 技术设计（架构、接口、数据模型）
├── tasks.md            # 工作分工（后端 B 阶段 1-4、前端 F 阶段 1-2）
└── docs/               # 补充文档目录
```

## 核心需求

### 后端升级（dsh-codingns）

| 编号 | 需求 | 优先级 |
| --- | --- | --- |
| **B1** | Agent 消息识别与标签显示 | P0 |
| **B2** | 会话与机器人关联，事件回传 | P0 |
| **B3** | 会话队列与优先级管理 | P1 |
| **B4** | 文件查看工具（新增） | P1 |
| **B5** | Git 查看工具（新增） | P1 |
| **B6** | Webhook 机制增强 | P0 |

### 前端集成（openteam）

| 编号 | 需求 | 优先级 |
| --- | --- | --- |
| **F1** | MCP 客户端参数支持 | P0 |
| **F2** | Webhook 接收与事件处理 | P0 |
| **F3** | 新工具的插件映射 | P1 |
| **F4** | 错误处理与超时 | P1 |

## 工具映射总览

**后端（dsh-codingns）暴露的 MCP 工具**：

| 类型 | 工具数 | 工具名 |
| --- | --- | --- |
| 工作区（新增 2 个） | 6 | workspace_list、**workspace_file_list**、**workspace_file_read**、workspace_git_status、workspace_git_log、workspace_git_diff |
| 会话 | 4 | session_list、session_create、session_continue、session_queue_peek |
| 消息队列（新增）| 3 | **message_status**、**message_cancel**、**message_prioritize** |
| 问题/权限 | 4 | session_questions、session_answer、session_request_permission、session_permission_status |
| 终端 | 3 | terminal_list、terminal_read、terminal_write |
| **总计** | **20** | （原有 11 + 新增 9） |

前端（openteam）插件将这 20 个工具映射为 OutcomeGo 工具，Bot 可直接调用。

## 实现计划

### 后端（dsh-codingns）：3-4 周

**阶段 B1：会话升级与 Agent 消息识别**（1-1.5 周）
- B1.1 升级 session_create/continue，支持 agentId
- B1.2 UI 显示「发送自Agent」标签
- B1.3 阶段检查

**阶段 B2：会话队列、Webhook 增强**（1-1.5 周）
- B2.1 实现会话队列管理和 session_queue_status 工具
- B2.2 升级 Webhook 事件（加 agentId）和重试机制
- B2.3 阶段检查

**阶段 B3：文件和 Git 工具实现**（1.5-2 周）
- B3.1 实现文件查看工具（workspace_file_list/read）
- B3.2 实现 Git 查看工具（workspace_git_*）
- B3.3 阶段检查

**阶段 B4：文档和交付**（0.5 周）
- B4.1 文档编写、SKILL.md 更新、发布新版本

### 前端（openteam）：2-3 周

**阶段 F1：MCP 客户端升级与 Webhook 接收**（2 周）
- F1.1 升级 HTTP MCP 客户端，支持新参数和工具
- F1.2 实现 Webhook 接收端点和事件路由
- F1.3 阶段检查

**阶段 F2：Bot 工作流集成与测试**（1.5-2 周）
- F2.1 实现 Bot 回调和事件处理机制
- F2.2 端到端测试和文档

## 关键流程

### 流程 1：Bot 创建会话并发送消息

```
Bot 调用 session_create(workspaceId, agentId="bot-1")
  ↓
DSH-WEB 创建会话，存储 agentId
  ↓
返回 sessionId
  ↓
Bot 调用 session_continue(sessionId, message, agentId="bot-1")
  ↓
DSH-WEB 处理消息，UI 显示「发送自Agent」标签
```

### 流程 2：会话完成，Webhook 回传事件

```
会话执行完成
  ↓
DSH-WEB 生成 Webhook 事件
  {
    "eventType": "session.completed",
    "sessionId": "sess-123",
    "agentId": "bot-1",
    ...
  }
  ↓
DSH-WEB Webhook 服务进行重试
  ↓
OutcomeGo 插件 Webhook 端点接收事件
  ↓
根据 agentId 查找 Bot 1
  ↓
Bot 1 的回调被触发，处理完成事件
```

### 流程 3：Bot 查看工作区文件/Git

```
Bot 调用 workspace_file_read(workspaceId, path)
  ↓
DSH-WEB 返回文件内容
  ↓
Bot 调用 workspace_git_log(workspaceId)
  ↓
DSH-WEB 返回提交历史
  ↓
Bot 进行代码分析和处理
```

## 协作模式

### 后端与前端的同步点

| 后端完成 | 前端可开始 | 说明 |
| --- | --- | --- |
| B1.1 | F1.1 | 后端 MPC 接口稳定 |
| B2.2 | F1.2 | Webhook 事件格式确定 |
| B3.3 | F2.1 | 所有工具完成 |

### 并行开发原则

- 后端 B 阶段 1、2、3 可部分并行（B1 影响 B2/B3 的测试，但代码可并行）
- 前端 F 阶段 1.1 和 F1.2 可部分并行
- 建议后端 B1 和 B2 同时进行
- 建议后端 B3 和前端 F1 同时进行

### 沟通与反馈

- **每周同步**：后端发布本周完成的功能和新的 MPC 接口
- **即时反馈**：前端集成时遇到问题立即反馈后端
- **共同测试**：后端完成一个阶段后提供集成测试环境
- **版本标记**：openteam 插件版本应标记对应的 dsh-codingns 版本

## 验收标准

### 后端验收

- ✓ B1：Agent 消息标签在 UI 中正确显示
- ✓ B2：会话与机器人正确关联，Webhook 事件包含 agentId
- ✓ B3：会话队列正常管理，支持优先级和插队
- ✓ B4：文件查看工具能正确列出和读取文件
- ✓ B5：Git 查看工具能查看状态、日志、diff
- ✓ B6：Webhook 事件能可靠传递（失败时重试）

### 前端验收

- ✓ F1：MPC 客户端支持所有新工具和参数
- ✓ F2：Webhook 事件能正确接收并路由到 Bot
- ✓ F3：Bot 能调用所有新工具
- ✓ F4：错误处理完善，超时和重试机制生效

### 端到端验收

- ✓ Bot 能创建会话、发送消息、读取文件、查看 Git、处理完成事件
- ✓ 多个 Bot 并发使用不会互相干扰
- ✓ 会话队列、优先级、插队等功能正常工作
- ✓ 所有通信安全、可靠、性能良好

## 技术亮点

1. **跨工作区协作**：设计清晰的接口契约，两边可独立开发和测试
2. **Agent 身份识别**：通过 agentId 追踪消息来源和回传事件
3. **消息队列透明化**：Bot 能看到消息是否进入队列，并可操作队列（查询、取消、插队）
4. **工具扩展**：文件、Git、消息队列工具为 Bot 提供更强大的能力
5. **可靠的 Webhook**：指数退避重试确保事件不丢失
6. **完整的工作流**：从创建会话到处理完成事件的端到端支持

## 风险与缓解

| 风险 | 缓解方案 |
| --- | --- |
| 并发冲突 | 使用乐观锁或版本号 |
| Webhook 丢失 | 完善重试和日志机制 |
| 性能问题 | 设置超时和大小限制 |
| 接口变更 | 频繁同步，尽早集成测试 |

## 相关资源

### 后端代码位置（dsh-codingns）

- MPC 工具：`src/host/workspace-mcp/tools.ts`
- Webhook 事件：`src/host/workspace-mcp/webhook-events.ts`
- Webhook 存储：`src/host/workspace-mcp/webhook-store.ts`
- UI 代码：`src/client/`

### 前端代码位置（openteam）

- 插件目录：`packages/plugins/dsh-web/`
- HTTP 客户端：`packages/plugins/dsh-web/connector/src/http-client.ts`
- 工具处理：`packages/plugins/dsh-web/connector/src/tools/`
- 配置文件：`packages/plugins/dsh-web/plugin.json`

## 后续扩展

一旦本规格的 MVP 完成，可考虑的扩展：

- Webhook 签名验证和加密
- 支持多个 Webhook 端点
- Bot 能否执行写操作（commit、push 等）
- 实时消息流（而非轮询）
- Web UI 中的实时队列可视化
- 错误处理的自动恢复建议

---

**文档最后更新时间**：2026-01-01（Draft）
