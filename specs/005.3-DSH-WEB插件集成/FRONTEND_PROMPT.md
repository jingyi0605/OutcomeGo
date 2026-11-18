# OutcomeGo DSH-WEB 插件集成项目 - 前端开发提示词

## 项目背景

这是一个跨工作区协作项目，需要在 OutcomeGo 中实现 DSH-WEB 插件，调用升级后的 DSH-WEB MCP 服务器，使 Bot 能够在 DSH-WEB 工作区中操作。

完整规格文档位置：`/Users/jackson/Code/openteam/specs/005.3-DSH-WEB插件集成/`

## 你的职责

在 OutcomeGo 中开发 DSH-WEB 插件，实现以下 4 个需求（F1-F4），分 2 个开发阶段完成，并与后端团队协作进行集成测试。

## 核心需求概览

### F1：MCP 客户端参数支持（P0）
- 升级 HTTP MCP 客户端，支持所有新参数（agentId、priority 等）
- 支持所有 20 个 MCP 工具的调用：
  - 工作区（6）：workspace_list、file_list、file_read、git_status、git_log、git_diff
  - 会话（4）：session_list、create、continue、queue_peek
  - 消息队列（3）：message_status、message_cancel、message_prioritize
  - 问题/权限（4）：questions、answer、request_permission、permission_status
  - 终端（3）：terminal_list、read、write
- 完善的错误处理和类型检查

### F2：Webhook 接收与事件处理（P0）【重点】
- 实现 Webhook 接收端点：`http://localhost:9999/webhook/dsh-web`
- 解析和处理后端发来的 Webhook 事件
- 根据 `agentId` 路由事件到对应的 Bot
- 支持的事件：
  - session.completed / session.failed
  - session.question_asked / session.permission_requested
  - message_queued / message_dequeued（新增）

### F3：新工具的插件映射（P1）
- 在 OutcomeGo 插件工具列表中声明所有 20 个工具
- 实现工具处理器（tool handlers）
- 参数序列化、结果格式化
- 统一的错误码映射

### F4：错误处理与超时（P1）
- 超时控制：30 秒
- 网络错误自动重试（指数退避）
- 清晰的用户友好错误消息
- 完善的日志记录（不暴露敏感信息）

## 核心要点

### 关键理解：消息队列透明化

这是本项目的**核心创新**。Bot 现在能够：

1. **发送消息时了解状态**
   ```
   session_continue(sessionId, message, agentId="bot-1")
   返回：{
     messageId: "msg-123",
     status: "queued" | "processing",
     queuePosition: 2,
     estimatedWaitMs: 8000
   }
   ```

2. **查询消息状态**
   ```
   message_status(sessionId, messageId)
   返回：消息当前状态、队列位置、是否可操作
   ```

3. **操作消息队列**
   ```
   message_cancel(sessionId, messageId)          # 取消排队
   message_prioritize(sessionId, messageId, 100) # 插队
   session_queue_peek(sessionId)                 # 查看队列
   ```

4. **接收队列事件**
   ```
   Webhook: session.message_queued
   Webhook: session.message_dequeued
   ```

Bot 基于这些能力，可以制定更智能的工作流。

## 技术实现指引

### 当前相关代码

```
packages/plugins/dsh-web/
├── plugin.json                    # 插件元数据和工具声明
├── package.json
├── connector/
│   └── src/
│       ├── index.ts               # 插件入口
│       ├── http-client.ts         # HTTP MCP 客户端
│       ├── credential-manager.ts  # 凭证管理
│       ├── webhook-handler.ts     # Webhook 接收（需升级）
│       ├── tools/
│       │   ├── workspace.ts       # 工作区工具
│       │   ├── session.ts         # 会话工具
│       │   ├── message.ts         # 消息队列工具（新建）
│       │   ├── question.ts        # 问题工具
│       │   ├── permission.ts      # 权限工具
│       │   └── terminal.ts        # 终端工具
│       └── types.ts               # 类型定义
└── test/
    └── integration.test.ts        # 集成测试
```

### 工作流示例

```
用户创建 Bot 工作流：

1. Bot 调用 session_create
   → OutcomeGo 插件调用 MCP 工具 session_create
   → DSH-WEB 创建会话，返回 sessionId
   → Bot 保存 sessionId

2. Bot 发送消息
   → OutcomeGo 插件调用 session_continue（带 agentId）
   → DSH-WEB 处理消息，返回状态回执
   → OutcomeGo 告诉 Bot：消息进入队列了（position: 2, waitTime: 5000）

3. Bot 基于回执决定：
   ├─ 如果立即处理 → 等待会话完成
   ├─ 如果进入队列 → 可选择：
   │  ├─ 查看队列状态（session_queue_peek）
   │  ├─ 取消这条消息（message_cancel）
   │  └─ 提升优先级（message_prioritize）
   └─ 等待消息被处理

4. 消息处理完成 → DSH-WEB 发送 Webhook 事件
   → OutcomeGo Webhook 端点接收
   → 根据 agentId 查找 Bot
   → Bot 处理 Webhook 事件，继续后续工作流
```

## 开发阶段

### 阶段 F1（2 周）：MCP 客户端升级与 Webhook 接收

#### F1.1 升级 MCP 客户端（1 周）
- 支持新参数（agentId、priority）
- 支持所有 20 个工具
- 参数验证和序列化
- 错误码映射
- 集成测试（需要后端 B1.1 完成）

#### F1.2 实现 Webhook 接收（1 周）
- Webhook 端点实现
- 事件解析（需要后端 B2.2 完成）
- 事件路由机制
- 错误处理和日志
- 集成测试

#### F1.3 阶段检查
- 单元测试通过
- 集成测试通过
- 与后端联合测试通过

### 阶段 F2（1.5-2 周）：Bot 工作流集成与测试

#### F2.1 实现 Bot 回调和事件处理（1 周）
- Bot 在 session_create 时传递 agentId
- Webhook 事件触发对应 Bot 的回调
- 完整的工作流处理
- 集成测试（完整的 Bot 场景）

#### F2.2 端到端测试和文档（0.5-1 周）
- E2E 测试：覆盖所有 20 个工具
- 错误场景测试：网络故障、超时、无效凭证
- 用户文档：如何使用 DSH-WEB 插件
- 开发者文档：如何在 Bot 中调用

## 与后端的同步点

### 依赖关系

```
后端完成              →  前端可开始
─────────────────────────────────────
B1.1 完成            →  F1.1（参数支持测试）
B2.2 完成            →  F1.2（Webhook 事件格式）
B3.3 完成            →  F2.1（完整流程测试）
```

### 沟通机制

- **每周同步**：了解后端进度，获取最新 MCP 接口
- **遇到问题立即反馈**：参数格式、错误码、事件内容等
- **集成测试协调**：后端完成阶段时提供集成环境

## 完整规格文档章节引用

- **需求定义**：`requirements.md` 中 F1-F4 部分
- **工具接口**：`design.md` 中 §3.2.3（工具映射表）和 §3.1.1（MCP 工具定义）
- **Webhook 事件**：`design.md` 中 §3.1.2（Webhook 事件格式）
- **关键流程**：`design.md` 中 §2.2（三个关键流程）
- **具体任务**：`tasks.md` 中 F 阶段 1-2

## 验收标准

### F1 验收
- [ ] HTTP MCP 客户端支持所有新参数
- [ ] 所有 20 个工具都有处理器和测试
- [ ] 参数验证完整（类型、长度、格式）
- [ ] Webhook 端点能接收和解析事件
- [ ] 事件路由根据 agentId 正确工作
- [ ] 错误消息清晰易懂
- [ ] 单元测试覆盖率 ≥ 80%

### F2 验收
- [ ] Bot 能在 session_create 时提供 agentId
- [ ] Webhook 事件能触发 Bot 的回调
- [ ] 完整的 Bot 工作流正常运作
- [ ] E2E 测试覆盖至少 10 个场景
- [ ] 错误处理完善（超时、网络故障等）
- [ ] 文档清晰完整

### 端到端验收
- [ ] Bot 能创建会话、发送消息、获取状态回执
- [ ] Bot 能查询队列、取消消息、提升优先级
- [ ] Bot 能读取文件和 Git 信息
- [ ] Bot 能处理会话完成和错误事件
- [ ] 多个 Bot 并发使用不互相干扰

## 工具映射表

| 类型 | OutcomeGo 工具 | 后端 MCP 工具 | 说明 |
| --- | --- | --- | --- |
| 工作区 | dsh_web.workspace_list | workspace_list | 列出工作区 |
| | dsh_web.workspace_file_list | workspace_file_list | 列出文件 |
| | dsh_web.workspace_file_read | workspace_file_read | 读取文件 |
| | dsh_web.workspace_git_status | workspace_git_status | Git 状态 |
| | dsh_web.workspace_git_log | workspace_git_log | Git 历史 |
| | dsh_web.workspace_git_diff | workspace_git_diff | Git 变更 |
| 会话 | dsh_web.session_list | session_list | 列出会话 |
| | dsh_web.session_create | session_create | 创建会话 |
| | dsh_web.session_continue | session_continue | 发送消息 |
| | dsh_web.session_queue_peek | session_queue_peek | 查看队列 |
| 消息 | dsh_web.message_status | message_status | 消息状态 |
| | dsh_web.message_cancel | message_cancel | 取消消息 |
| | dsh_web.message_prioritize | message_prioritize | 提升优先级 |
| 问题 | dsh_web.session_questions | session_questions | 待回答问题 |
| | dsh_web.session_answer | session_answer | 回答问题 |
| 权限 | dsh_web.session_request_permission | session_request_permission | 请求权限 |
| | dsh_web.session_permission_status | session_permission_status | 权限状态 |
| 终端 | dsh_web.terminal_list | terminal_list | 列出终端 |
| | dsh_web.terminal_read | terminal_read | 读取终端 |
| | dsh_web.terminal_write | terminal_write | 写入终端 |

## 关键实现提示

1. **消息队列工具实现**（F1.1 中最重要）：
   - message_status 需要明确返回 canCancel、canPrioritize 布尔值
   - message_prioritize 需要返回新的队列位置
   - session_queue_peek 返回当前处理的消息和队列列表

2. **Webhook 接收实现**（F1.2 的核心）：
   - 端点应在启动插件时注册到 OutcomeGo
   - 需要能处理偶发的网络问题（不要 crash）
   - 无法路由的事件应记录日志，不报错

3. **Bot 工作流支持**（F2.1）：
   - Bot 需要能在 session_create 中提供自己的 agentId
   - 插件需要维护一个 agentId → Bot 的映射
   - Webhook 事件到达时快速查找和触发 Bot 回调

4. **错误处理**（F4）：
   - 网络错误时使用指数退避重试
   - 超时后立即返回清晰的"操作超时"错误
   - 无效参数时返回具体的验证错误
   - 凭证错误时提示"请检查 API Key"

5. **性能考虑**：
   - 缓存工作区列表（5 分钟更新周期）
   - 大文件读取时检查大小限制（1MB）
   - Git 操作要有超时保护（30s 总超时）

## 测试策略

### 单元测试
- 参数序列化/反序列化
- 错误码映射
- Webhook 事件解析
- agentId 路由逻辑

### 集成测试（与后端协作）
- 完整工作流：create → continue → queue_peek → dequeue
- Webhook 接收和路由
- 多 Bot 并发场景
- 错误场景（无效凭证、网络故障、超时）

### 端到端测试
- 真实 Bot 使用 DSH-WEB 插件
- 所有 20 个工具的调用
- Webhook 事件的完整处理

## 有任何问题请参考

- 完整规格：`/Users/jackson/Code/openteam/specs/005.3-DSH-WEB插件集成/`
- 后端团队提示词：`BACKEND_PROMPT.md`（同目录）
- 后端 SKILL.md：`/Users/jackson/Code/CodingNS/data/dsh-codingns/SKILL.md`

---

**开始开发前建议：**
1. 完整阅读 Spec 文档的 requirements.md、design.md、tasks.md
2. 了解与后端的三个同步点，制定详细计划
3. 与后端团队沟通确认 MCP 接口的具体格式
4. 准备好集成测试环境（本地 DSH-WEB 实例）

**祝你开发愉快！** 🚀
