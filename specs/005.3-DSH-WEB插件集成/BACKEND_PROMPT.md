# DSH-WEB MCP 升级项目 - 后端开发提示词

## 项目背景

这是一个跨工作区协作项目，需要升级 dsh-codingns（DSH-WEB）的 MCP 服务器并提供会话事件拉取接口，以支持 OutcomeGo 的深度集成。

完整规格文档位置：`/Users/jackson/Code/openteam/specs/005.3-DSH-WEB插件集成/`

## 你的职责

升级 dsh-codingns 中的 MCP 服务器并提供会话事件拉取接口（取代 Webhook 推送），实现以下 7 个需求（B1-B7），分 5 个开发阶段完成（B7 是补充需求，放在阶段 B5）。

## 核心需求概览

### B1：Agent 消息识别与标签显示（P0）
- 在 MCP 工具中支持 `agentId` 参数
- UI 在消息上显示「发送自Agent」标签（时间戳左侧）
- 会话能追踪消息来自哪个 Agent

### B2：会话与机器人关联，事件回传（P0）
- `session_create` 和 `session_continue` 接受 `agentId` 参数
- `session_events` 返回的所有事件包含 `agentId`（作为 `actor`）和 `sessionId`（作为 `resourceId`）
- 完成/错误事件由 OutcomeGo 按游标拉取，不需要后端知道有哪些 Bot

### B3：消息队列透明化与操作能力（P0）【重点】
- `session_continue` 返回消息状态回执（status: queued/processing、position、waitTime）
- 新增 4 个工具：
  - `message_status` - 查询消息状态
  - `message_cancel` - 取消排队
  - `message_prioritize` - 调整优先级（插队）
  - `session_queue_peek` - 查看队列

### B4：文件查看工具（P1）
- 新增 `workspace_file_list` - 列出文件树
- 新增 `workspace_file_read` - 读取文件内容
- 支持路径验证、大小限制（1MB）

### B5：Git 查看工具（P1）
- 新增 `workspace_git_status` - Git 状态
- 新增 `workspace_git_log` - 提交历史
- 新增 `workspace_git_diff` - 文件变更对比
- 所有操作支持 5s 超时保护

### B6：会话事件拉取接口 `session_events`（P0，取代 Webhook）
- 新增 MCP 工具 `session_events`：输入 `{ cursor?, limit? }`（`limit` 默认且最大 50），输出 `{ events, cursor }`；协议见 `design.md` §3.1.2 和 Spec 005.4 design §3.3.1
- 事件类型：`session.completed`、`session.failed`、`session.question_asked`、`session.permission_requested`、`session.message_queued`、`session.message_dequeued`、`session.events_gap`
- 持久事件日志，序号单调，至少保留 7 天；首次调用（游标为空）只返回基线游标，不返回历史事件
- 事件升序，游标只推进到最后一个已返回的事件；同一事件 `id` 始终相同；`text` 写明会话标题、工作区等关键信息
- 只包含受管理工作区内的会话事件（与 B7 一致）
- 不再做 Webhook 推送、重试和投递目标管理；`session_events` 由 OutcomeGo 宿主调用，对 Bot 隐藏（插件清单声明）
- 输入 Schema 中为 `agentId`、`priority` 等参数声明类型、长度、格式和取值范围，OutcomeGo 宿主据此校验参数

### B7：会话历史读取与会话搜索（P1，补充需求）
- 新增 `session_history` - 按页读取会话里的用户和助手消息（`limit`、`cursor`，返回 `nextCursor`）
- 新增 `session_search` - 按关键词查找会话，可用 `workspaceId` 限定范围
- 只面向受管理工作区：已归档、未纳入受管理工作区和未分组的会话读不到、搜不到
- 大小限制：单条消息 8 KiB、每页文字 256 KiB；被截短的消息带 `truncated`
- 搜索结果可能少于 `limit`：DSH 先在整个 Host 搜并最多返回 20 个会话，之后才按受管理范围过滤
- 详见 `design.md` §3.1.1

## 技术实现指引

### 当前相关代码

```
src/host/workspace-mcp/tools.ts          # MCP 工具定义
src/host/workspace-mcp/webhook-events.ts  # 事件生成（改为写入事件日志）
src/host/workspace-mcp/webhook-store.ts   # 存储（改为带序号的事件日志）
src/host/workspace-mcp/transport.ts       # MCP 传输层
src/host/workspace-mcp/webhook-dispatcher.ts # 推送分发（不再使用；可移除或保持不接入）
```

### MCP 工具设计规范

参考现有工具结构，新增工具需要：
1. 清晰的参数定义和验证
2. 结构化的返回值
3. 完善的错误处理（NOT_FOUND、INVALID_PARAM 等）
4. 安全性考虑（路径验证、大小限制等）

### 消息队列实现关键点

- 每条消息需要唯一 ID（messageId）
- 追踪消息状态：queued → processing → completed
- 支持优先级排序和快速重排
- 状态变化时写入事件日志（`session.message_queued`、`session.message_dequeued`）
- 估算等待时间（基于队列和当前处理进度）

## 开发阶段

### 阶段 B1（1-1.5 周）：会话升级与 Agent 消息识别
1. B1.1 升级 session_create/continue，支持 agentId 参数
2. B1.2 UI 显示「发送自Agent」标签
3. B1.3 阶段检查

### 阶段 B2（1-1.5 周）：消息队列与会话事件拉取
1. B2.1 实现消息队列透明化（重点：4 个新工具 + session_continue 回执）
2. B2.2 实现事件日志和 `session_events` 拉取接口
3. B2.3 阶段检查

### 阶段 B3（1.5-2 周）：文件和 Git 工具
1. B3.1 实现文件查看工具（workspace_file_list、workspace_file_read）
2. B3.2 实现 Git 查看工具（workspace_git_status、workspace_git_log、workspace_git_diff）
3. B3.3 阶段检查

### 阶段 B4（0.5 周）：文档和交付
1. B4.1 更新 SKILL.md、README.md、CHANGES.md（发布新版本前需完成阶段 B5）

### 阶段 B5（0.5-1 周）：会话历史与搜索（补充需求 B7）
1. B5.1 实现 `session_history`、`session_search`（只面向受管理工作区）
2. B5.2 阶段检查与文档同步

## 完整规格文档章节引用

- **需求定义**：`requirements.md` 中 B1-B7 部分
- **工具接口**：`design.md` 中 §3.1.1（工具接口定义）
- **会话事件拉取**：`design.md` 中 §3.1.2（`session_events`）
- **数据结构**：`design.md` 中 §3.2（DshWebConfig、MessageInfo 等）
- **关键流程**：`design.md` 中 §2.3（三个关键流程设计）
- **具体任务**：`tasks.md` 中 B 阶段 1-5

## 验收标准

### B1 验收
- [ ] 会话能存储 agentId
- [ ] UI 显示「发送自Agent」标签
- [ ] 用户可点击标签查看 Agent ID
- [ ] 单元测试覆盖率 ≥ 80%

### B2 验收（消息队列部分最关键）
- [ ] session_continue 返回消息状态回执（messageId、status、position、waitTime）
- [ ] message_status 工具正常工作
- [ ] message_cancel 工具正常工作（仅能取消队列中的消息）
- [ ] message_prioritize 工具正常工作（支持优先级调整）
- [ ] session_queue_peek 工具正常工作（返回队列信息）
- [ ] 事件日志（message_queued、message_dequeued 等）正确写入，`session_events` 按游标返回
- [ ] 首次调用只返回基线；重复读取同一事件 `id` 相同；游标过期返回 `session.events_gap`

### B3 验收
- [ ] workspace_file_list 返回文件树
- [ ] workspace_file_read 返回文件内容（安全验证通过）
- [ ] workspace_git_* 工具正常工作
- [ ] 所有 Git 操作有 5s 超时保护

### B4 验收
- [ ] SKILL.md 更新完整
- [ ] 文档清晰易懂
- [ ] 版本号遵循 SemVer

### B5 验收（需求 B7：会话历史与搜索）
- [ ] session_history 按页返回用户和助手消息，nextCursor 能继续往前翻
- [ ] 单条消息 ≤ 8 KiB、每页文字 ≤ 256 KiB，被截短的消息带 truncated
- [ ] Agent 发出的消息带 agentId
- [ ] session_search 返回会话 ID、所属工作区和命中片段，workspaceId 能限定范围
- [ ] 已归档和受管理工作区以外的会话读不到、搜不到
- [ ] DSH 不支持时返回“能力不可用”，其他工具不受影响

## 测试策略

- **单元测试**：消息队列逻辑、优先级排序、文件读取、Git 命令解析
- **集成测试**：完整流程（create → continue → queue → dequeue）、`session_events` 游标与保留期、错误处理
- **端到端测试**：与前端插件的联合测试（待前端 F1.3 完成）

## 与前端的同步点

前端将在以下时间点接入：
- B1.1 完成后 → 前端启动 F1.1（参数支持）
- B2.2 完成后 → 前端联调 F1.2（插件清单已声明 `events`；`session_events` 一上线，OutcomeGo 最多 15 分钟内自动开始拉取）
- B3.3 完成后 → 前端启动 F2.1（完整工作流）

## 关键实现提示

1. **消息队列实现的核心**：
   - 维护消息的全局唯一 ID
   - 记录消息进入和离开队列的时间戳
   - 支持快速重排（避免频繁迭代）
   - 计算预期等待时间

2. **安全性要点**：
   - 文件路径验证（防止 `../` 穿越）
   - 大小限制检查（文件 ≤1MB、Git 输出 ≤10MB）
   - agentId 不在日志中暴露
   - 会话历史和搜索只面向受管理工作区；出错信息不带路径等内部细节

3. **错误处理**：
   - 消息无法取消时返回清晰原因（已处理、不存在等）
   - Git 操作超时时立即返回错误
   - `session_events` 失败时返回 MCP 错误结果，宿主保留游标并重试

## 有任何问题请参考

- 完整规格：`/Users/jackson/Code/openteam/specs/005.3-DSH-WEB插件集成/`
- 前端团队提示词：`FRONTEND_PROMPT.md`（同目录）

---

**开始开发时请先仔细阅读 Spec 文档的 requirements.md 和 design.md，确保完全理解需求再开始编码。**
