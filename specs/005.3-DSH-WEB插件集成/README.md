# DSH-WEB 与 OutcomeGo 跨工作区集成 (005.3)

## 概述

本规格定义了一个**跨两个工作区的协作开发计划**，以实现 codingns4dsh（DSH-WEB / CodingNS）和 OutcomeGo 的深度集成。

### 后端侧（dsh-codingns）

升级 MCP 服务器并提供会话事件拉取接口，支持：
- **Agent 消息标识**：消息来自 Agent 时显示「发送自Agent」标签
- **会话与机器人关联**：会话完成/错误等事件带 `agentId`，由 OutcomeGo 按游标拉取，匹配订阅的 Bot 被唤醒
- **会话队列管理**：支持多 Agent 并发、优先级、插队
- **文件查看工具**：新增 `workspace_file_list` 和 `workspace_file_read`
- **Git 查看工具**：新增 `workspace_git_status`、`workspace_git_log`、`workspace_git_diff`
- **会话事件拉取**：新增 `session_events`（持久事件日志 + 游标），取代 Webhook 推送
- **会话历史与搜索**：新增 `session_history`、`session_search`，只面向受管理工作区

### 前端侧（openteam）

按 OutcomeGo 插件系统规则交付插件（声明式 Remote MCP + 技能说明，不含自定义 connector 进程），支持：
- **MCP 连接与工具发现**：连接后由宿主发现全部 22 个工具及参数 Schema
- **事件订阅**：Bot 创建 `plugin` 触发器的 routine 订阅会话，宿主定期拉取 `session_events`，匹配时唤醒 Bot（Spec 005.4；无需公网地址）
- **Bot 工作流**：Bot 能创建会话、发送消息、处理完成事件

## 文档结构

```
specs/005.3-DSH-WEB插件集成/
├── README.md           # 本文档（项目总览）
├── requirements.md     # 11 个需求（后端 B1-B7 和前端 F1-F4）
├── design.md           # 技术设计（架构、接口、数据模型）
├── tasks.md            # 工作分工（后端 B 阶段 1-5、前端 F 阶段 1-2）
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
| **B6** | 会话事件拉取接口 `session_events`（取代 Webhook） | P0 |
| **B7** | 会话历史读取与会话搜索（补充需求） | P1 |

### 前端集成（openteam）

| 编号 | 需求 | 优先级 |
| --- | --- | --- |
| **F1** | MCP 连接与参数支持（工具发现 + 宿主 Schema 校验） | P0 |
| **F2** | 会话事件订阅（宿主插件事件轮询，Spec 005.4） | P0 |
| **F3** | 工具映射与技能说明 | P1 |
| **F4** | 错误处理与超时（遵守宿主语义） | P1 |

## 工具映射总览

**后端（dsh-codingns）暴露的 MCP 工具**：

| 类型 | 工具数 | 工具名 |
| --- | --- | --- |
| 工作区（新增 5 个） | 6 | workspace_list、**workspace_file_list**、**workspace_file_read**、workspace_git_status、workspace_git_log、workspace_git_diff |
| 会话（新增 2 个） | 6 | session_list、session_create、session_continue、session_queue_peek、**session_history**、**session_search** |
| 消息队列（新增）| 3 | **message_status**、**message_cancel**、**message_prioritize** |
| 问题/权限 | 4 | session_questions、session_answer、session_request_permission、session_permission_status |
| 终端 | 3 | terminal_list、terminal_read、terminal_write |
| **总计** | **22** | （原有 11 + 新增 11） |

连接后宿主会发现这 22 个工具并暴露给 Bot；插件包不内置工具清单，`SKILL.md` 说明每个工具的用法和前置检查（见 design §3.2.3）。

## 实现计划

### 后端（dsh-codingns）：3-4 周

**阶段 B1：会话升级与 Agent 消息识别**（1-1.5 周）
- B1.1 升级 session_create/continue，支持 agentId
- B1.2 UI 显示「发送自Agent」标签
- B1.3 阶段检查

**阶段 B2：会话队列、会话事件拉取**（1-1.5 周）
- B2.1 实现消息队列透明化和 session_queue_peek、message_* 工具
- B2.2 实现会话事件日志和 `session_events` 拉取接口
- B2.3 阶段检查

**阶段 B3：文件和 Git 工具实现**（1.5-2 周）
- B3.1 实现文件查看工具（workspace_file_list/read）
- B3.2 实现 Git 查看工具（workspace_git_*）
- B3.3 阶段检查

**阶段 B4：文档和交付**（0.5 周）
- B4.1 文档编写、SKILL.md 更新、发布新版本（需在 B5.2 之后发布）

**阶段 B5：会话历史与搜索（补充 B7）**（0.5-1 周）
- B5.1 实现 session_history、session_search（只面向受管理工作区）
- B5.2 阶段检查与文档同步

### 前端（openteam）：2-3 周

**阶段 F1：连接、技能契约与事件接入**（2 周）
- F1.1 MCP 连接配置、技能说明与工具契约测试（配置接入已完成）
- F1.2 会话事件订阅与联调（等待 B2.2；宿主侧已完成）
- F1.3 阶段检查

**阶段 F2：Bot 工作流与交付**（1.5-2 周）
- F2.1 Bot 工作流指引与联调
- F2.2 联调场景与文档

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

### 流程 2：订阅会话，完成时被唤醒

```
会话执行完成
  ↓
DSH-WEB 写入事件日志
  {
    "id": "evt-42",
    "kind": "session.completed",
    "resourceId": "sess-123",
    "actor": "bot-1",
    ...
  }
  ↓
OutcomeGo 宿主每 60 秒调用 session_events(cursor) 拉取
  ↓
事件匹配 Bot 1 创建的订阅（plugin 触发器，resourceIds 含 sess-123）
  ↓
Bot 1 的 routine 被唤醒，读取 <plugin_event>，处理完成事件
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
| B1.1 | F1.1（真实后端 Schema 核对） | 后端 MCP 接口稳定 |
| B2.2 | F1.2 | `session_events` 可用 |
| B3.3 | F2.1 | 所有工具完成 |

### 并行开发原则

- 后端 B 阶段 1、2、3 可部分并行（B1 影响 B2/B3 的测试，但代码可并行）
- 前端 F 阶段 1.1 和 F1.2 可部分并行
- 建议后端 B1 和 B2 同时进行
- 建议后端 B3 和前端 F1 同时进行

### 沟通与反馈

- **每周同步**：后端发布本周完成的功能和新的 MCP 接口
- **即时反馈**：前端集成时遇到问题立即反馈后端
- **共同测试**：后端完成一个阶段后提供集成测试环境
- **版本标记**：openteam 插件版本应标记对应的 dsh-codingns 版本

## 验收标准

### 后端验收

- ✓ B1：Agent 消息标签在 UI 中正确显示
- ✓ B2：会话与机器人正确关联，`session_events` 返回的事件包含 agentId
- ✓ B3：会话队列正常管理，支持优先级和插队
- ✓ B4：文件查看工具能正确列出和读取文件
- ✓ B5：Git 查看工具能查看状态、日志、diff
- ✓ B6：`session_events` 按游标可靠读取，重启后不丢，首次调用只返回基线
- ✓ B7：Bot 能按页读取受管理工作区内会话的历史、按关键词搜索会话；范围外的会话读不到、搜不到

### 前端验收

- ✓ F1：连接后发现 22 个工具，参数按 Schema 传递并被宿主校验
- ✓ F2：Bot 订阅会话后，状态变化时被宿主拉取并唤醒；没有变化时不唤醒
- ✓ F3：技能说明覆盖 22 个工具，Bot 能正确使用
- ✓ F4：错误提示清晰，不自动重放有副作用的调用，超时语义与宿主一致

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
5. **可靠的事件读取**：持久事件日志加游标，至少一次读取，宿主按事件 id 去重
6. **完整的工作流**：从创建会话到处理完成事件的端到端支持

## 风险与缓解

| 风险 | 缓解方案 |
| --- | --- |
| 并发冲突 | 使用乐观锁或版本号 |
| 事件延迟或遗漏 | 默认 60 秒轮询；事件日志至少保留 7 天；游标过期时返回 `session.events_gap` |
| 性能问题 | 设置超时和大小限制 |
| 接口变更 | 频繁同步，尽早集成测试 |

## 相关资源

### 后端代码位置（dsh-codingns）

- MCP 工具：`src/host/workspace-mcp/tools.ts`
- 事件生成：`src/host/workspace-mcp/webhook-events.ts`（改为写入事件日志）
- 事件存储：`src/host/workspace-mcp/webhook-store.ts`（改为带序号的事件日志）
- UI 代码：`src/client/`

### 前端代码位置（openteam）

- 插件目录：`packages/plugins/dsh-web/`
- 配置与连接声明：`packages/plugins/dsh-web/plugin.json`
- Bot 使用说明：`packages/plugins/dsh-web/skills/dsh-web/SKILL.md`
- 插件说明：`packages/plugins/dsh-web/README.md`
- 测试：`packages/plugins/test/dsh-web.test.ts`、`apps/server/test/plugin/dsh-web.integration.test.ts`
- 宿主 Remote MCP：`apps/server/src/plugins/mcp-client-manager.ts`
- 宿主插件事件轮询：Spec 005.4、`packages/plugins/README.md`（Event sources）、`apps/server/src/services/plugin/events.ts`

## 后续扩展

一旦本规格的 MVP 完成，可考虑的扩展：

- 实时推送（MCP 通知或 SSE），缩短事件延迟
- 订阅按账号过滤
- Bot 能否执行写操作（commit、push 等）
- 实时消息流（而非轮询）
- Web UI 中的实时队列可视化
- 错误处理的自动恢复建议

---

**文档最后更新时间**：2026-11-19（Draft；前端部分改为按插件系统规则交付：依赖 MCP 工具发现与宿主能力）
