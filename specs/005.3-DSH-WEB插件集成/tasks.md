# 任务清单 - DSH-WEB 与 OutcomeGo 跨工作区集成

状态：Draft

## 工作分工

| 工作区 | 负责人 | 任务 | 预期周期 |
| --- | --- | --- | --- |
| **dsh-codingns** | 后端团队 | B1-B7（后端升级；B7 为补充的会话历史与搜索，对应 B 阶段 5） | 3-4 周，B7 另加 0.5-1 周 |
| **openteam** | 前端团队 | F1-F4（插件包与技能说明、事件订阅指引、联调与文档；不含自定义 connector。宿主侧事件轮询见 Spec 005.4，已完成） | 2-3 周 |

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

### B 阶段 2：会话队列、会话事件拉取（1-1.5 周）

#### B2.1 实现消息队列透明化与操作工具

- [ ] 任务 B2.1
  - 状态：TODO
  - 这一步到底做什么：升级 `session_continue` 返回值，包含消息状态和队列位置。实现四个新 MCP 工具：`message_status`、`message_cancel`、`message_prioritize`、`session_queue_peek`。使 Bot 能够了解和操作消息队列。
  - 做完你能看到什么：Bot 发送消息后能了解消息是否进入队列，并能对自己的消息进行查询、取消、插队等操作
  - 先依赖什么：B1.1
  - 开始前先看：
    - `design.md` §3.1.1（session_continue 升级和四个新工具）
    - `design.md` §3.1.2（`session_events` 事件日志，含 session.message_queued、session.message_dequeued）
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
    7. 队列状态变化时写入事件日志（`session.message_queued`、`session.message_dequeued`），由 B2.2 的 `session_events` 读取
  - 怎么验证：
    - 单元测试：消息队列逻辑、优先级排序
    - 集成测试：发送多条消息，验证队列行为；调用取消、插队，验证结果
    - 集成测试：验证队列事件被正确写入事件日志
  - 对应需求：B3
  - 对应设计：§3.1.1（工具定义）、§3.1.2（会话事件）

#### B2.2 实现会话事件日志与 `session_events` 拉取接口

- [ ] 任务 B2.2
  - 状态：TODO
  - 这一步到底做什么：为受管理工作区内会话的状态变化写入持久的事件日志，并新增 `session_events` 工具，按游标返回事件。取代原来的 Webhook 推送、重试和投递目标管理。
  - 做完你能看到什么：用游标反复调用 `session_events` 能按顺序读到会话完成、失败、提问、请求权限、消息入队/出队的事件，每个事件带 `agentId`（`actor`）和 `sessionId`（`resourceId`）；首次调用只返回基线游标
  - 先依赖什么：B1.1
  - 开始前先看：
    - `design.md` §3.1.2（`session_events` 协议、事件类型、实现要求）
    - Spec 005.4 `design.md` §3.3.1（轮询协议）
    - 需求 B2、B6
  - 主要改哪里：
    - `src/host/workspace-mcp/webhook-events.ts`（现有事件生成点，改为写入事件日志）
    - `src/host/workspace-mcp/webhook-store.ts`（存储层，改为带序号的事件日志；是否改名由后端决定）
    - `src/host/workspace-mcp/tools.ts`（新增 `session_events`）
  - 这一步先不做什么：不做 Webhook 推送、重试和投递目标；不实现按 Bot 过滤（过滤由 OutcomeGo 的订阅完成）；不暴露受管理工作区以外的会话事件
  - 怎么算完成：
    1. 事件日志持久、序号单调，服务重启后仍可读取，至少保留 7 天
    2. 首次调用（游标为空）返回基线游标和空事件；之后返回游标之后的事件，升序，单次不超过 `limit`（默认且最大 50），游标只推进到最后一个已返回的事件
    3. 同一事件重复返回时 `id` 相同；每个事件包含 `id`、`kind`、`text`、`occurredAt`、`actor`（如有）、`resourceId`
    4. 游标早于保留期时，从最早保留的事件继续并先返回 `session.events_gap`
    5. 已归档、未分组、受管理工作区以外的会话不产生可读事件
    6. 响应在 500ms 内；错误以 MCP 错误结果返回
  - 怎么验证：
    - 单元测试：游标推进、基线、上限、保留期、范围过滤
    - 集成测试：create → continue → 完成，用游标读到对应事件；重复读取得到相同 `id`
    - 与 OutcomeGo 联调（见 F1.2）
  - 对应需求：B2、B6
  - 对应设计：§3.1.2（`session_events`）、§4.2

#### B2.3 阶段 B2 检查

- [ ] 任务 B2.3
  - 状态：TODO
  - 这一步到底做什么：验证队列和会话事件拉取功能完整
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
  - 这一步到底做什么：编写升级后的 MCP API 文档、`session_events` 事件文档、变更日志。发布新版本。
  - 做完你能看到什么：前端团队能够清晰了解后端提供的所有功能
  - 先依赖什么：B1.3、B2.3、B3.3、B5.2（B7 的两个工具也要写进文档后再发布）
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
  - 对应需求：全部（B1-B7）
  - 对应设计：全部

### B 阶段 5：会话历史与搜索（B7 补充，0.5-1 周）

这一阶段是在 B1-B6 做完后补的：目前 Bot 只能看到会话的标题、状态和时间，读不到「会话里聊了什么」，也不能按关键词找会话。

#### B5.1 实现会话历史读取与会话搜索

- [ ] 任务 B5.1
  - 状态：代码和定向测试已在 dsh-codingns 工作区完成，尚未提交；未在真实 DSH 上验证
  - 这一步到底做什么：新增 `session_history`（按页读取会话里的用户和助手消息）和 `session_search`（按关键词找会话），两者只面向受管理工作区。
  - 做完你能看到什么：Bot 能读到某个会话「做到哪一步、上次说了什么」，也能按关键词找到相关会话；受管理工作区以外的会话读不到
  - 先依赖什么：B1.1（会话保存 agentId）、B2.1（消息队列，用于在历史里标出消息由哪个 Agent 发出）
  - 开始前先看：
    - 需求 B7
    - `design.md` §3.1.1 中 `session_history`、`session_search`
    - `src/host/workspace-mcp/tools.ts` 里 `session_list` 如何判断会话属于哪个受管理工作区
  - 主要改哪里：
    - `src/host/workspace-mcp/history-handler.ts`（新建：读取、截短、分页、过滤）
    - `src/host/workspace-mcp/tools.ts`（登记工具、检查会话归属）
    - `src/dsh-capabilities/host/workspace-session-control-adapter.ts`（读历史和搜索的可选方法；DSH 不提供时工具返回“能力不可用”）
    - `src/client/features/workspace-mcp.ts`、`src/client/locale.ts`（设置页里的工具说明）
    - `tests/workspace-mcp-session-history.spec.ts`（新建）、`tests/workspace-mcp-capabilities.spec.ts`（适配器转发）
  - 这一步先不做什么：不读受管理工作区以外的会话（包括未分组会话）；不返回工具调用、图片等没有文字的内容；不做跨 Host 搜索；不新增事件类型；不修改或删除会话
  - 怎么算完成：
    1. `session_history` 按页返回消息，用 `nextCursor` 往前翻页；单条最多 8 KiB、每页文字最多 256 KiB，被截短的消息有标记
    2. 由 Agent 发出的消息带 `agentId`
    3. `session_search` 返回会话 ID、所属工作区和命中片段，可用 `workspaceId` 限定范围
    4. 受管理工作区以外、已归档的会话：`session_history` 返回“会话不可用”，`session_search` 直接略过
    5. DSH 版本不提供读历史或搜索时，返回明确的“能力不可用”，其他工具不受影响
    6. 出错信息不暴露路径等内部细节
  - 怎么验证：
    - 单元测试：排序和翻页、大小上限、Agent 标注、授权拒绝、参数校验、搜索过滤、适配器转发
    - 集成测试：在真实 DSH 上读一个已有会话的历史，并搜索一个已知关键词，核对结果和受管理范围
  - 对应需求：B7
  - 对应设计：§3.1.1

#### B5.2 阶段检查与文档同步

- [ ] 任务 B5.2
  - 状态：TODO（dsh-codingns 的 `SKILL.md` 和开发记录里已写明两个新工具；`CHANGES.md`、真实 DSH 验证和提交还没做）
  - 这一步到底做什么：确认 B5.1 完成，把两个新工具写进变更日志，并在真实 DSH 上验证一次
  - 做完你能看到什么：后端 22 个工具齐全，前端可据此补全技能说明和契约测试
  - 先依赖什么：B5.1；B4.1 发布新版本前必须包含本阶段
  - 开始前先看：需求 B7
  - 主要改哪里：dsh-codingns 的 `SKILL.md`、`CHANGES.md`
  - 这一步先不做什么：不扩大搜索范围；不优化性能
  - 怎么算完成：
    1. B5.1 完成
    2. `SKILL.md`、`CHANGES.md` 记录两个工具，并写明“搜索结果可能少于 limit”的限制
    3. 相关测试通过；真实 DSH 验证有记录
  - 怎么验证：运行 B5.1 列出的测试文件；人工阅读文档；检查真实 DSH 验证记录
  - 对应需求：B7
  - 对应设计：§3.1.1

---

## 二、openteam 前端任务

前端任务按插件系统规则执行：交付物是 `packages/plugins/dsh-web/` 下的声明与技能说明、测试和文档；连接、发现、校验、事件入口由宿主承担（见 design §3.2.0）。不新增 `connector/`、HTTP 客户端、监听端口或服务端专属代码。

### F 阶段 1：连接、技能契约与事件接入（2 周）

#### F1.1 MCP 连接配置、技能说明与工具契约测试

- [ ] 任务 F1.1
  - 状态：进行中（配置接入已完成；技能说明补全与契约测试未完成）
  - 这一步到底做什么：保持插件为声明式 Remote MCP；把 `SKILL.md` 补全为覆盖 22 个工具和后端错误码的使用说明；增加技能契约测试和使用模拟 DSH-WEB MCP 服务的集成测试。
  - 已完成：
    - `plugin.json`（Remote MCP、`token` 认证、`mcpUrl` 与 `token` 配置字段、技能声明）
    - 私有网络 IP 可用 HTTP、公网和域名必须 HTTPS 的 URL 校验（`packages/plugin-sdk`）
    - `README.md` 与 `SKILL.md` 初版
    - `packages/plugins/test/dsh-web.test.ts`（配置流程）、`apps/server/test/plugin/dsh-web.integration.test.ts`（保存配置，需 `OUTCOMEGO_TEST_DATABASE_URL`）
  - 做完你能看到什么：连接 DSH-WEB 后发现 22 个工具；`SKILL.md` 与 design §3.2.3 的工具清单一致，测试能发现文档与契约脱节
  - 先依赖什么：对真实后端的联调依赖 B1.1（接口 Schema 稳定）；模拟服务测试不依赖后端
  - 开始前先看：
    - `packages/plugins/dsh-web/plugin.json`、`skills/dsh-web/SKILL.md`
    - `design.md` §3.1.1、§3.2.0–§3.2.4
    - `apps/server/test/plugin/mcp-transport.test.ts`（现有 MCP 传输测试写法）
  - 主要改哪里：
    - `packages/plugins/dsh-web/skills/dsh-web/SKILL.md`（补全工具和错误码指引）
    - `packages/plugins/test/dsh-web.test.ts`（技能契约测试）
    - `apps/server/test/plugin/dsh-web.integration.test.ts`（模拟 MCP 服务的发现与调用）
    - `packages/plugins/dsh-web/plugin.json`（仅在声明变化时，并按规则提升版本）
  - 这一步先不做什么：不新增 `connector/` 和 HTTP 客户端；不在 `apps/server` 中加入 DSH-WEB 专属代码；不在 `plugin.json` 里手写工具清单（`tools` 保持空数组）；不处理事件订阅（见 F1.2）
  - 怎么算完成：
    1. `SKILL.md` 覆盖 design §3.2.3 的 22 个工具，并包含 §3.2.4 的错误码指引和"先查状态再取消、插队、重做"的规则
    2. 契约测试校验 `SKILL.md` 中的工具名与 design §3.2.3 一致
    3. 模拟 MCP 服务实现 §3.1.1 的 22 个工具 Schema，宿主发现 22 个工具；`session_create` 带 `agentId`、`priority`、`session_continue` 带 `agentId` 的调用被正确传递；超出范围或类型错误的参数被宿主拒绝
    4. 插件目录通过共享校验和注册表生成
  - 怎么验证：
    - `cd packages/plugins && bun test test/dsh-web.test.ts`
    - 设置 `OUTCOMEGO_TEST_DATABASE_URL` 后运行 `apps/server/test/plugin/dsh-web.integration.test.ts`
    - B1.1 完成后，对真实 DSH-WEB 做一次发现并核对 Schema
  - 对应需求：F1、F3、F4
  - 对应设计：§3.2.0、§3.2.1、§3.2.3、§3.2.4

#### F1.2 会话事件订阅与联调

- [ ] 任务 F1.2
  - 状态：IN_PROGRESS（宿主与插件侧已完成：`plugin.json` 已声明 `events`、`SKILL.md` 已写订阅指引；等待后端 B2.2 的 `session_events` 后联调）
  - 这一步到底做什么：在 `plugin.json` 声明事件轮询，写出 Bot 订阅会话的指引和配置说明；与后端联调，验证订阅的 Bot 在会话状态变化时被唤醒。
  - 做完你能看到什么：Bot 创建会话后用 `plugin` 触发器的 routine 订阅它，会话完成或失败后，该 Bot 被唤醒并读到事件；没有变化时不被唤醒
  - 先依赖什么：B2.2（`session_events`）；Spec 005.4 任务 1.1–4.3（已完成）
  - 开始前先看：
    - `design.md` §3.1.2、§3.2.2、§3.2.5
    - Spec 005.4 `design.md` §3.3.1、`packages/plugins/README.md` 的 "Event sources"
    - `docs/usage/routines.md` 中插件事件的说明
  - 主要改哪里：
    - `packages/plugins/dsh-web/plugin.json`（`events: { "pollTool": "session_events", "source": "plugin", "intervalSeconds": 60 }`，提升版本；对应 Spec 005.4 任务 6.2）
    - `packages/plugins/dsh-web/skills/dsh-web/SKILL.md`（订阅方法、触发器写法、事件类型、取消订阅、核对方法）
    - `packages/plugins/dsh-web/README.md`（Webhook 一节改为事件订阅）
    - `docs/` 下的配置指南（见 F2.2）
  - 这一步先不做什么：不新增服务端路由或监听端口；不实现按账号过滤。清单可先于后端声明：服务端没有该工具时宿主安静地每 15 分钟检查一次，不会每个周期报错
  - 怎么算完成：
    1. 清单校验通过；Bot 可见的工具仍是 22 个，`session_events` 不在其中
    2. SKILL.md 说明：创建会话后用 `resourceIds` 或 `actors` 订阅；保存的提示词写明事件到达后做什么；处理完成后删除 routine；怀疑漏事件时用 `session_list`、`message_status` 核对
    3. 联调 6 类事件：匹配的 Bot 被唤醒，不匹配的不被唤醒，重复拉取不重复运行，首次连接不集中唤醒历史事件
    4. 核对 `<plugin_event>` 的内容形态并写入 SKILL.md；design §7 的相关待确认项有结论
  - 怎么验证：
    - 手工联调，记录每类事件的结果
    - 文档由另一人按步骤复现一次
  - 对应需求：F2
  - 对应设计：§3.2.2

#### F1.3 阶段 F1 检查

- [ ] 任务 F1.3
  - 状态：TODO
  - 这一步到底做什么：确认 F1.1 与 F1.2 完成，可进入 Bot 工作流阶段
  - 做完你能看到什么：连接、技能说明、事件接入都有可复现的验证结果
  - 先依赖什么：F1.1、F1.2
  - 开始前先看：需求 F1、F2、F3、F4
  - 主要改哪里：本阶段文件
  - 这一步先不做什么：不优化性能
  - 怎么算完成：
    1. F1.1 和 F1.2 都完成
    2. 自动化测试通过
    3. 事件订阅联调记录完整
  - 怎么验证：运行测试；复核联调记录
  - 对应需求：F1、F2、F3、F4
  - 对应设计：§3.2

### F 阶段 2：Bot 工作流与交付（1.5-2 周）

#### F2.1 Bot 工作流指引与联调

- [ ] 任务 F2.1
  - 状态：TODO
  - 这一步到底做什么：把 `agentId` 使用规则、消息队列流程、事件处理写成 Bot 可遵循的指引，并用真实 Bot 跑完整流程：create → continue → 回执 → queue_peek / cancel / prioritize → 完成事件。
  - 做完你能看到什么：Bot 能创建会话并关联自己的标识，读到消息回执，必要时操作队列，并在完成或失败事件到达后继续工作
  - 先依赖什么：F1.3，B3.3、B5.2（所有后端工具完成）
  - 开始前先看：
    - `design.md` §2.2、§3.2.5
    - `packages/plugins/dsh-web/skills/dsh-web/SKILL.md`
  - 主要改哪里：
    - `packages/plugins/dsh-web/skills/dsh-web/SKILL.md`
    - `docs/` 下的开发者指南（见 F2.2）
  - 这一步先不做什么：不实现 Bot 内部状态管理；不新增 `agentId → Bot` 映射表（谁被唤醒由 Bot 自己创建的订阅决定）
  - 怎么算完成：
    1. Bot 仅在工作流提供稳定标识且 Schema 接受时传 `agentId`，`session_create` 与 `session_continue` 使用同一值
    2. Bot 报告回执中的实际字段，不推断未返回的队列位置或等待时间
    3. `session.completed`、`session.failed` 事件到达后 Bot 能继续或终止工作流
    4. 多个 Bot 各自订阅不同会话，事件只唤醒各自的 Bot，互不干扰
  - 怎么验证：真实 Bot 与真实 DSH-WEB 联调，保存对话与事件记录
  - 对应需求：F2、F3、F4
  - 对应设计：§2.2、§3.2.2、§3.2.5

#### F2.2 联调场景与文档

- [ ] 任务 F2.2
  - 状态：TODO
  - 这一步到底做什么：编写不少于 10 个联调或端到端场景，覆盖 22 个工具、错误场景和事件订阅；编写用户与开发者文档。
  - 做完你能看到什么：一个文档清晰、验证记录完整的插件，可交付给用户
  - 先依赖什么：F2.1
  - 开始前先看：`design.md` §3.2、§6；`docs/README.md`（文档清单）
  - 主要改哪里：
    - `apps/server/test/plugin/`（可自动化的场景）
    - 本规格 `docs/` 目录（场景记录、配置指南、开发者指南、错误处理、限制说明）
    - `packages/plugins/dsh-web/README.md`
  - 这一步先不做什么：不做性能压力测试；不新增插件运行时代码
  - 怎么算完成：
    1. 至少 10 个场景，22 个工具都被至少一个场景覆盖，每个场景有结果记录
    2. 错误场景至少包括：API Key 无效、网络中断后的状态核对、非法参数、后端返回错误码（`NOT_FOUND`、`CANNOT_CANCEL` 等）
    3. 文档覆盖：配置账号、订阅会话事件（含延迟、首次连接和取消订阅）、Bot 使用方式、错误与限制
    4. `README.md` 的"当前边界"与实际一致
  - 怎么验证：运行自动化测试；复核联调记录；人工阅读文档
  - 对应需求：F1、F2、F3、F4
  - 对应设计：§3.2、§6

#### 前端需求—设计—任务追踪

| 需求 | 设计章节 | 任务 | 验证方式 |
| --- | --- | --- | --- |
| F1 MCP 连接与参数支持 | §3.2.0、§3.2.1 | F1.1、F1.3 | 目录与配置测试、模拟 MCP 服务发现与调用、真实后端 Schema 核对 |
| F2 会话事件订阅 | §3.2.2 | F1.2、F2.1 | 6 类事件联调、匹配与不匹配的订阅、重复拉取去重、首次连接基线 |
| F3 工具映射与使用说明 | §3.2.3、§3.2.5 | F1.1、F2.1、F2.2 | 技能契约测试、22 个工具场景覆盖 |
| F4 错误处理与超时 | §3.2.4 | F1.1、F2.2 | 错误场景联调（凭证、中断、非法参数、错误码） |

---

## 附注

### 跨工作区协作建议

1. **同步点**：
   - B1.1 完成后 → F1.1 对真实后端的 Schema 核对可进行（模拟服务测试不依赖后端）
   - B2.2 完成后 → F1.2 联调可开始（宿主和插件侧已就绪，清单已声明）
   - B3.3、B5.2 完成后 → F2.1 可开始

2. **沟通渠道**：
   - 后端每周发布工作进度和 MCP 接口文档
   - 前端在集成时遇到问题立即反馈，后端协调修复

3. **测试协调**：
   - 后端完成一个阶段后提供集成测试环境
   - 前端及时进行集成测试，反馈问题

4. **版本管理**：
   - dsh-codingns：v X.Y.Z（后端版本）
   - openteam：`packages/plugins/dsh-web/plugin.json` 的 `version` 按插件规则提升，并在 `README.md` 中标明所对应的 dsh-codingns 版本
