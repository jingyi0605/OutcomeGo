# 任务清单 - DSH-WEB 与 OutcomeGo 跨工作区集成

状态：Draft

## 工作分工

| 工作区 | 负责人 | 任务 | 预期周期 |
| --- | --- | --- | --- |
| **dsh-codingns** | 后端团队 | B1-B6（后端升级） | 3-4 周 |
| **openteam** | 前端团队 | F1-F4（前端插件） | 2-3 周 |

两个工作区可并行开发，但前端需要等待后端 MCP 接口稳定后才能全面测试。

---

## 一、dsh-codingns 后端任务

### B 阶段 1：会话升级与 Agent 消息标识（1-1.5 周）

#### B1.1 升级 session_create 和 session_continue

- [ ] 任务 B1.1
  - 状态：TODO
  - 这一步到底做什么：修改 MCP 工具 `session_create` 和 `session_continue`，增加 `agentId` 和 `priority` 参数支持。会话创建时存储这些信息。
  - 做完你能看到什么：后端 MCP 工具能够接收并处理 agentId 参数，会话数据模型包含 agentId 字段
  - 先依赖什么：无
  - 开始前先看：
    - `src/host/workspace-mcp/tools.ts`（当前 MCP 工具实现）
    - `src/host/session-handle-eviction.ts`（会话管理）
  - 主要改哪里：
    - `src/host/workspace-mcp/tools.ts`
    - 会话数据模型（添加 agentId、priority 字段）
  - 这一步先不做什么：不实现 UI 显示；不实现队列逻辑
  - 怎么算完成：
    1. session_create 接受 agentId 参数并存储
    2. session_continue 接受 agentId 参数
    3. 会话可查询其关联的 agentId
  - 怎么验证：
    - 单元测试：参数存储正确
    - 集成测试：调用工具时传递 agentId，确认被保存
  - 对应需求：B1、B2
  - 对应设计：`design.md` §3.1.1（MCP 工具升级）

#### B1.2 UI 显示「发送自 Agent」标签

- [ ] 任务 B1.2
  - 状态：TODO
  - 这一步到底做什么：在 DSH-WEB UI 中，当会话包含 agentId 时，对该会话中来自 Agent 的消息添加「发送自Agent」标签。标签显示在时间戳左侧。
  - 做完你能看到什么：用户在 DSH-WEB 中能看到来自 Agent 的消息被标记，方便识别
  - 先依赖什么：B1.1
  - 开始前先看：
    - DSH-WEB 前端代码（client 目录）
    - 消息渲染组件
  - 主要改哪里：
    - 消息气泡组件（添加标签）
    - 消息数据展示（显示 Agent 标签）
  - 这一步先不做什么：不添加复杂的 Agent 信息面板
  - 怎么算完成：
    1. 消息列表中包含 agentId 的消息显示标签
    2. 标签位置正确（时间戳左侧）
    3. 标签设计美观、易读
  - 怎么验证：
    - 手动测试：创建包含 agentId 的会话，查看 UI 显示
    - 截图对比设计稿
  - 对应需求：B1
  - 对应设计：`design.md` §3.1.3（UI 增强）

#### B1.3 阶段 B1 检查

- [ ] 任务 B1.3
  - 状态：TODO
  - 这一步到底做什么：验证 Agent 消息识别功能完整，MCP 参数和 UI 显示无问题
  - 做完你能看到什么：确认可进入队列和事件回传阶段
  - 先依赖什么：B1.1、B1.2
  - 开始前先看：
    - 需求 B1、B2
  - 主要改哪里：本阶段文件
  - 这一步先不做什么：不优化性能
  - 怎么算完成：
    1. B1.1 和 B1.2 都完成
    2. 单元和集成测试通过
    3. 手动测试无问题
  - 怎么验证：
    - 运行单元测试
    - 手动端到端测试
  - 对应需求：B1、B2
  - 对应设计：§3.1.1

### B 阶段 2：会话队列、Webhook 增强（1-1.5 周）

#### B2.1 实现消息队列透明化与操作工具

- [ ] 任务 B2.1
  - 状态：TODO
  - 这一步到底做什么：升级 `session_continue` 返回值，包含消息状态和队列位置。实现四个新 MCP 工具：`message_status`、`message_cancel`、`message_prioritize`、`session_queue_peek`。使 Bot 能够了解和操作消息队列。
  - 做完你能看到什么：Bot 发送消息后能了解消息是否进入队列，并能对自己的消息进行查询、取消、插队等操作
  - 先依赖什么：B1.1
  - 开始前先看：
    - `design.md` §3.1.1（session_continue 升级和四个新工具）
    - `design.md` §3.1.2（session.message_queued、session.message_dequeued 事件）
    - 需求 B3
  - 主要改哪里：
    - 消息存储和队列管理层（添加消息 ID 和队列位置追踪）
    - `src/host/workspace-mcp/tools.ts`（升级 session_continue 和新增 4 个工具）
    - `src/host/workspace-mcp/message-queue-handler.ts`（新建，消息队列操作辅助类）
  - 这一步先不做什么：不处理跨会话的全局队列；不处理消息的优先级阻塞
  - 怎么算完成：
    1. session_continue 返回消息 ID 和状态（processing/queued/completed）
    2. 如果消息进入队列，返回队列位置和预期等待时间
    3. message_status 工具能查询消息状态
    4. message_cancel 工具能取消排队的消息
    5. message_prioritize 工具能调整消息优先级
    6. session_queue_peek 工具能查看当前队列
    7. 队列状态变化时发送 Webhook 事件
  - 怎么验证：
    - 单元测试：消息队列逻辑、优先级排序
    - 集成测试：发送多条消息，验证队列行为；调用取消、插队，验证结果
    - 集成测试：验证 Webhook 事件正确生成
  - 对应需求：B3
  - 对应设计：§3.1.1（工具定义）、§3.1.2（Webhook 事件）

#### B2.2 升级 Webhook 事件和重试机制

- [ ] 任务 B2.2
  - 状态：TODO
  - 这一步到底做什么：为所有 Webhook 事件添加 agentId 字段，实现可靠的重试机制（指数退避、最多 3 次）
  - 做完你能看到什么：Webhook 事件包含 agentId，失败时能自动重试，最终可被传递或记录为失败
  - 先依赖什么：B1.1
  - 开始前先看：
    - `src/host/workspace-mcp/webhook-events.ts`（当前事件实现）
    - `src/host/workspace-mcp/webhook-store.ts`（存储管理）
    - `design.md` §3.1.2（Webhook 事件格式）
  - 主要改哪里：
    - `src/host/workspace-mcp/webhook-events.ts`
    - `src/host/workspace-mcp/webhook-store.ts`
    - `src/host/workspace-mcp/webhook-dispatcher.ts`（如需要创建）
  - 这一步先不做什么：不处理 Webhook 端点的多个目标（先支持一个）
  - 怎么算完成：
    1. 所有 Webhook 事件都包含 agentId 字段
    2. 失败事件被存储和重试
    3. 重试遵循指数退避策略（1s、2s、4s）
    4. 最多尝试 3 次
  - 怎么验证：
    - 单元测试：重试逻辑、事件格式
    - 集成测试：模拟 Webhook 端点故障，验证重试
  - 对应需求：B2、B6
  - 对应设计：§3.1.2（Webhook 事件格式和重试）

#### B2.3 阶段 B2 检查

- [ ] 任务 B2.3
  - 状态：TODO
  - 这一步到底做什么：验证队列和 Webhook 功能完整
  - 做完你能看到什么：确认可进入文件和 Git 工具实现阶段
  - 先依赖什么：B2.1、B2.2
  - 开始前先看：
    - 需求 B3、B6
  - 主要改哪里：本阶段文件
  - 这一步先不做什么：不优化性能
  - 怎么算完成：
    1. B2.1 和 B2.2 都完成
    2. 单元和集成测试通过
  - 怎么验证：
    - 运行测试：`bun test`
  - 对应需求：B3、B6
  - 对应设计：§3.1.1-2

### B 阶段 3：文件和 Git 工具实现（1.5-2 周）

#### B3.1 实现文件查看工具

- [ ] 任务 B3.1
  - 状态：TODO
  - 这一步到底做什么：实现两个新 MCP 工具：`workspace_file_list`（列出文件树）和 `workspace_file_read`（读取文件内容）。支持路径验证、大小限制、编码处理。
  - 做完你能看到什么：后端能够提供工作区的文件访问能力，支持读取代码和配置文件
  - 先依赖什么：无（可与 B2 并行）
  - 开始前先看：
    - `design.md` §3.1.1（workspace_file_list、workspace_file_read 工具）
  - 主要改哪里：
    - `src/host/workspace-mcp/tools.ts`（新增文件工具）
    - 新建 `src/host/workspace-mcp/file-handler.ts`（文件操作辅助类）
  - 这一步先不做什么：不支持文件写操作；不支持大于 1MB 的文件
  - 怎么算完成：
    1. workspace_file_list 返回正确的文件树
    2. workspace_file_read 返回文件内容
    3. 路径验证防止目录穿越
    4. 大小和深度限制生效
  - 怎么验证：
    - 单元测试：路径验证、大小限制
    - 集成测试：读取实际文件
    - 安全测试：尝试穿越到工作区外，确认被拒绝
  - 对应需求：B4
  - 对应设计：§3.1.1（文件工具）

#### B3.2 实现 Git 查看工具

- [ ] 任务 B3.2
  - 状态：TODO
  - 这一步到底做什么：实现三个新 MCP 工具：`workspace_git_status`、`workspace_git_log`、`workspace_git_diff`。支持分支查询、范围查询、超时控制。
  - 做完你能看到什么：后端能够提供工作区的 Git 信息，Bot 可查看代码状态和历史
  - 先依赖什么：无（可与 B2、B3.1 并行）
  - 开始前先看：
    - `design.md` §3.1.1（workspace_git_* 工具）
  - 主要改哪里：
    - `src/host/workspace-mcp/tools.ts`（新增 Git 工具）
    - 新建 `src/host/workspace-mcp/git-handler.ts`（Git 操作辅助类）
  - 这一步先不做什么：不支持 Git 写操作（commit、push 等）；不处理合并冲突
  - 怎么算完成：
    1. workspace_git_status 返回当前分支、修改文件等信息
    2. workspace_git_log 返回提交历史
    3. workspace_git_diff 返回文件变更对比
    4. 所有工具都有超时控制（最多 5s）
    5. 非 Git 仓库时返回 NOT_A_GIT_REPO 错误
  - 怎么验证：
    - 单元测试：Git 命令调用、输出解析
    - 集成测试：在真实 Git 仓库上测试
    - 超时测试：模拟卡住的 Git 操作，确认超时返回
  - 对应需求：B5
  - 对应设计：§3.1.1（Git 工具）

#### B3.3 阶段 B3 检查

- [ ] 任务 B3.3
  - 状态：TODO
  - 这一步到底做什么：验证文件和 Git 工具完整、可靠、性能良好
  - 做完你能看到什么：确认后端功能完整，可交付给前端集成
  - 先依赖什么：B3.1、B3.2
  - 开始前先看：
    - 需求 B4、B5
  - 主要改哪里：本阶段文件
  - 这一步先不做什么：不优化性能
  - 怎么算完成：
    1. B3.1 和 B3.2 都完成
    2. 单元和集成测试覆盖率 ≥ 80%
    3. 性能满足：文件列表 < 500ms、Git 操作 < 2s
  - 怎么验证：
    - 运行测试和性能测试
    - 生成覆盖率报告
  - 对应需求：B4、B5
  - 对应设计：§3.1.1

### B 阶段 4：文档和交付（0.5 周）

#### B4.1 文档编写和发布

- [ ] 任务 B4.1
  - 状态：TODO
  - 这一步到底做什么：编写升级后的 MCP API 文档、Webhook 事件文档、变更日志。发布新版本。
  - 做完你能看到什么：前端团队能够清晰了解后端提供的所有功能
  - 先依赖什么：B1.3、B2.3、B3.3
  - 开始前先看：
    - 当前 `SKILL.md`
    - 当前 README
  - 主要改哪里：
    - `SKILL.md`（更新工具列表）
    - `README.md`（更新功能列表）
    - 新建 `CHANGES.md`（变更日志）
  - 这一步先不做什么：不编写详细的开发者教程
  - 怎么算完成：
    1. SKILL.md 包含所有新工具的说明
    2. CHANGES.md 记录新增功能和破坏性改动
    3. README 更新为最新状态
  - 怎么验证：
    - 人工阅读，检查清晰易懂
  - 对应需求：全部（B1-B6）
  - 对应设计：全部

---

## 二、openteam 前端任务

### F 阶段 1：MCP 客户端升级与 Webhook 接收（2 周）

#### F1.1 升级 MCP 客户端支持新参数

- [ ] 任务 F1.1
  - 状态：TODO
  - 这一步到底做什么：修改 OutcomeGo DSH-WEB 插件的 HTTP MCP 客户端，支持所有新增参数（agentId、priority）和新工具（文件、Git、队列）。
  - 做完你能看到什么：插件能够调用所有 15 个 MCP 工具（旧 11 个 + 新 4 个），并能传递新参数
  - 先依赖什么：B1.1（后端 MCP 接口稳定）
  - 开始前先看：
    - `packages/plugins/dsh-web/connector/src/http-client.ts`（当前 HTTP 客户端）
    - `design.md` §3.1.1（新 MCP 工具和参数）
  - 主要改哪里：
    - `packages/plugins/dsh-web/connector/src/http-client.ts`（修改，支持新参数）
    - `packages/plugins/dsh-web/connector/src/tools/`（新增工具处理器）
    - `packages/plugins/dsh-web/plugin.json`（更新工具声明）
  - 这一步先不做什么：不处理 Webhook 接收；不实现 Bot 逻辑
  - 怎么算完成：
    1. HTTP 客户端支持新参数的序列化和传输
    2. 所有 15 个工具都有处理器
    3. 参数验证完整（类型、长度、格式）
  - 怎么验证：
    - 单元测试：参数序列化、工具处理
    - 集成测试（需要 B1.1 完成）：实际调用后端工具
  - 对应需求：F1
  - 对应设计：§3.1.1、§3.2.3

#### F1.2 实现 Webhook 接收端点和事件路由

- [ ] 任务 F1.2
  - 状态：TODO
  - 这一步到底做什么：在 OutcomeGo 插件中实现 Webhook 接收端点（如 http://localhost:9999/webhook/dsh-web），解析事件并根据 agentId 路由回对应的机器人。
  - 做完你能看到什么：DSH-WEB 的 Webhook 事件能被 OutcomeGo 接收和处理，正确路由到对应的 Bot
  - 先依赖什么：B2.2（后端 Webhook 事件包含 agentId）
  - 开始前先看：
    - `packages/plugins/dsh-web/connector/src/`（当前插件结构）
    - `design.md` §3.1.2（Webhook 事件格式）
  - 主要改哪里：
    - `packages/plugins/dsh-web/connector/src/webhook-handler.ts`（新建）
    - `packages/plugins/dsh-web/connector/src/index.ts`（修改，注册 Webhook 端点）
  - 这一步先不做什么：不实现 Webhook 签名验证（先信任 DSH-WEB）
  - 怎么算完成：
    1. Webhook 端点能接收 POST 请求
    2. 事件被正确解析
    3. 根据 agentId 路由到对应的机器人
    4. 无法路由的事件被记录，不报错
  - 怎么验证：
    - 单元测试：事件解析、路由逻辑
    - 集成测试：模拟 DSH-WEB 发送 Webhook，验证路由
  - 对应需求：F2
  - 对应设计：§3.2.2

#### F1.3 阶段 F1 检查

- [ ] 任务 F1.3
  - 状态：TODO
  - 这一步到底做什么：验证 MCP 客户端和 Webhook 接收功能完整
  - 做完你能看到什么：确认可进入 Bot 集成阶段
  - 先依赖什么：F1.1、F1.2
  - 开始前先看：
    - 需求 F1、F2
  - 主要改哪里：本阶段文件
  - 这一步先不做什么：不优化性能
  - 怎么算完成：
    1. F1.1 和 F1.2 都完成
    2. 单元和集成测试通过
    3. 手动测试 Webhook 路由正确
  - 怎么验证：
    - 运行测试
    - 手动测试 Webhook 接收和路由
  - 对应需求：F1、F2
  - 对应设计：§3.2

### F 阶段 2：Bot 工作流集成与测试（1.5-2 周）

#### F2.1 实现 Bot 回调和事件处理

- [ ] 任务 F2.1
  - 状态：TODO
  - 这一步到底做什么：在 OutcomeGo 插件中实现机制，使得 Bot 能够：1）在创建会话时传递自己的 ID；2）在接收到 Webhook 事件时处理并触发 Bot 的回调
  - 做完你能看到什么：Bot 能够创建会话时关联自己，并在会话完成时收到事件通知
  - 先依赖次什么：F1.3
  - 开始前先看：
    - `design.md` §2.2.1、§2.2.3（关键流程）
    - OutcomeGo 的 Bot 文档
  - 主要改哪里：
    - `packages/plugins/dsh-web/connector/src/bot-integration.ts`（新建）
    - `packages/plugins/dsh-web/connector/src/webhook-handler.ts`（修改，添加回调触发）
  - 这一步先不做什么：不处理 Bot 内部状态管理
  - 怎么算完成：
    1. Bot 能在 session_create 时提供 agentId
    2. Webhook 事件能触发对应 Bot 的回调
    3. Bot 能接收会话完成/失败事件
  - 怎么验证：
    - 单元测试：回调机制
    - 集成测试：完整 Bot 工作流（需要 B3.3 完成）
  - 对应需求：F3、F4
  - 对应设计：§2.2（关键流程）

#### F2.2 端到端测试和文档

- [ ] 任务 F2.2
  - 状态：TODO
  - 这一步到底做什么：编写完整的端到端测试，覆盖所有 15 个工具和 Webhook 回传流程。编写用户和开发者文档。
  - 做完你能看到什么：一个功能完整、文档清晰的插件，可交付给用户
  - 先依赖什么：F2.1
  - 开始前先看：
    - `design.md` 全文
  - 主要改哪里：
    - `packages/plugins/dsh-web/connector/test/e2e.test.ts`（新建或扩展）
    - `packages/plugins/dsh-web/README.md`（更新）
    - `packages/plugins/dsh-web/docs/`（新增或扩展）
  - 这一步先不做什么：不做性能压力测试
  - 怎么算完成：
    1. E2E 测试覆盖至少 10 个场景
    2. README 和文档清晰易懂
    3. 用户能快速了解如何使用
  - 怎么验证：
    - 运行 E2E 测试
    - 人工阅读文档
  - 对应需求：全部（F1-F4）
  - 对应设计：全部

---

## 附注

### 跨工作区协作建议

1. **同步点**：
   - B1.1 完成后 → F1.1 可开始
   - B2.2 完成后 → F1.2 可开始
   - B3.3 完成后 → F2.1 可开始

2. **沟通渠道**：
   - 后端每周发布工作进度和 MCP 接口文档
   - 前端在集成时遇到问题立即反馈，后端协调修复

3. **测试协调**：
   - 后端完成一个阶段后提供集成测试环境
   - 前端及时进行集成测试，反馈问题

4. **版本管理**：
   - dsh-codingns：v X.Y.Z（后端版本）
   - openteam：v X.Y.Z-dsh-web（标记对应的后端版本）
