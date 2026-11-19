# 需求文档 - DSH-WEB 与 OutcomeGo 跨工作区集成

状态：Draft

## 简介

本规格定义了跨两个工作区的协作开发计划，以实现 codingns4dsh（DSH-WEB / CodingNS）与 OutcomeGo 的深度集成。

**后端侧（dsh-codingns）**：升级 MCP 服务器并提供会话事件拉取接口，支持：
- Agent 消息标识和回溯（UI 标签显示、机器人 ID 跟踪）
- 会话与机器人的关联，事件回传
- 扩展 MCP 工具：工作区文件、工作区 Git
- 读取会话历史、按关键词搜索会话（只面向受管理工作区）
- 会话队列、插队等高级功能

**前端侧（openteam）**：按 OutcomeGo 插件系统的规则交付 DSH-WEB 插件：以声明式 Remote MCP 连接加 Bot 技能（SKILL.md）承接 F1、F3、F4；F2 的事件订阅使用宿主的插件事件轮询（Spec 005.4）：Bot 创建订阅 routine，宿主定期调用后端 `session_events`，匹配的会话状态变化唤醒该 Bot；不在插件包内运行代码，也不需要公网地址。

**核心价值**：
- OutcomeGo Bot 能够直接在 DSH-WEB 工作区中操作（文件、Git、会话）
- 跨机器人的会话管理和事件同步
- 提升开发工作流的连贯性和自动化程度

## 术语表

- **dsh-codingns**：CodingNS 工作区（后端），需要升级 MCP 并提供事件拉取接口
- **openteam**：OutcomeGo 工作区（前端），实现插件和集成
- **MCP（Model Context Protocol）**：两个系统间的标准通信协议
- **Agent 消息**：由 OutcomeGo Bot 通过 MCP 发送到 DSH-WEB 会话的消息
- **机器人 ID（agentId）**：由工作流提供的、可稳定标识 OutcomeGo Bot 的字符串；是否被接受以及格式由 DSH-WEB MCP 的输入 Schema 决定
- **宿主**：OutcomeGo 的服务端与 Bot 计算机运行时，负责 Remote MCP 连接、工具发现、Schema 校验、账号隔离、HTTP 错误处理和插件事件轮询（Spec 005.4）
- **工具发现**：连接账号后，宿主从 DSH-WEB MCP 服务读取实际公布的工具及输入 Schema；插件包不内置、不伪造工具
- **事件订阅**：Bot 创建触发器为 `{ "type": "plugin", "plugin": "dsh-web", "resourceIds"?: [...], "actors"?: [...], "events"?: [...] }` 的 routine；宿主定期拉取事件，只唤醒触发器匹配的 routine 所属的 Bot（Spec 005.4）。`resourceIds` 对应 `sessionId`，`actors` 对应 `agentId`，二者至少给一个
- **会话队列**：多个 Agent 等待会话资源的队列
- **会话插队**：允许高优先级任务中断低优先级任务
- **会话事件**：DSH-WEB 记录的会话状态变化（完成、失败、提问、请求权限、消息入队/出队），由 OutcomeGo 通过 `session_events` 定期拉取，而不是由 DSH-WEB 推送

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
   - 会话完成或出错时，`session_events` 返回的事件包含 `agentId`
   - Bot 订阅该会话或该 `agentId` 后由宿主拉取并唤醒（见 F2）

3. **会话队列与插队**
   - 支持识别多个 Agent 的并发请求
   - 支持设置优先级（可选）
   - 支持在必要时插队（中断低优先级任务）
   - 队列变化记入会话事件

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

7. **读取会话历史与搜索会话**（补充需求 B7）
   - `session_history`：按页读取会话里的用户和助手消息
   - `session_search`：按关键词查找对话内容包含该文字的会话
   - 只面向受管理工作区，不读取其他会话

#### 会话事件拉取接口（取代原 Webhook 推送）

8. **会话事件类型**
   - `session.completed`、`session.failed`、`session.permission_requested`、`session.question_asked`、`session.message_queued`、`session.message_dequeued`
   - 所有事件都包含 `sessionId`，以及 `agentId`（如有）

9. **可靠读取**
   - 事件持久保存并带单调的游标，服务重启后仍可按游标继续
   - 不再由后端推送、重试或管理投递目标；读取方按游标至少一次读取，事件标识稳定供去重

### In Scope - openteam 前端插件实现

前端交付物限于插件系统允许的形态：`packages/plugins/dsh-web/` 下的 `plugin.json`（连接与配置字段声明）、`skills/dsh-web/SKILL.md`、`README.md`，以及 `packages/plugins/test/`、`apps/server/test/plugin/` 下的测试，外加使用宿主已有能力的配置与文档。

10. **MCP 连接与工具发现（F1、F3）**
   - 账号配置 MCP URL 与 API Key，连接后由宿主发现全部 DSH-WEB 工具及输入 Schema
   - 参数（含 `agentId`、`priority`）按发现的 Schema 传递并由宿主校验
   - 技能说明覆盖 22 个工具的正确用法

11. **事件订阅（F2）**
    - 插件清单声明事件轮询：`events: { pollTool: "session_events", source: "plugin" }`
    - Bot 创建 `plugin` 触发器的 routine 订阅会话；宿主定期拉取并唤醒匹配的 Bot
    - 不在插件包或 Bot 计算机内监听端口

12. **Bot 工作流与错误处理（F3、F4）**
    - Bot 能够调用文件和 Git 工具、处理会话完成/错误事件、管理会话队列
    - 超时与重试遵守宿主语义：不自动重放有副作用的工具调用

### Out of Scope

- 插件包内的自定义 connector 进程、HTTP 客户端、监听端口、自定义重试和超时（宿主 Remote MCP 已承担连接与调用）
- 在 `apps/server` 或宿主中加入 DSH-WEB 专用分发逻辑（插件规则：不得在服务端写 provider 专属分发）
- 后端主动推送（Webhook）：事件改为由宿主拉取，因此事件有轮询间隔的延迟（宿主允许 30–3600 秒，默认 60 秒），不适用于要求即时响应的场景
- 文件写入和修改（仅支持读取）
- Git 写操作（push、commit 等，仅支持查看）
- 读取或搜索受管理工作区以外的会话（包括未分组会话）、读取会话的分组归属、跨 Host 搜索（B7 只覆盖受管理工作区；如确需，另立规格）
- 会话内容的写入、删除和导出（B7 只读）
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
2. WHEN 会话完成 THEN `session_events` 返回的事件包含 `agentId`（作为 `actor`）和 `sessionId`（作为 `resourceId`），Bot 订阅的 routine 据此匹配（见 F2）
3. WHEN 会话出错或被中断 THEN 事件同样包含 `agentId` 和错误原因
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

6. WHEN 消息在队列中的状态变化 THEN `session_events` 返回 `session.message_queued` 或 `session.message_dequeued` 事件

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

#### 需求 B6：会话事件拉取接口（取代原 Webhook 机制）

**用户故事**：作为系统集成者，我希望 OutcomeGo 能按游标可靠地拉取 DSH-WEB 的会话事件，不需要后端知道有哪些 Bot，也不需要公网回调地址。

**验收标准**：

1. WHEN 新增 MCP 工具 `session_events`，输入 `{ "cursor"?: <不透明 JSON 或 null>, "limit"?: number }`（`limit` 默认且最大 50） THEN 返回 `{ "events": [...], "cursor": <JSON> }`，格式遵循 Spec 005.4 design §3.3.1
2. WHEN `cursor` 为空（首次调用） THEN 返回当前基线游标和空 `events`，使只有连接之后发生的事件才会触发订阅
3. WHEN 有新事件 THEN 按发生顺序升序返回，单次不超过 `limit` 个；游标只推进到最后一个已返回的事件，其余留待下次返回
4. WHEN 同一事件被多次返回 THEN `id` 必须相同；每个事件包含 `id`（≤150 字符）、`kind`、`text`（供 Bot 阅读的摘要，须包含工作区名称等关键信息）、`occurredAt`、`actor`（`agentId`，如有）、`resourceId`（`sessionId`）；宿主忽略其他未知字段
5. WHEN 服务重启 THEN 事件仍可按旧游标继续读取；事件至少保留 7 天（保留期为待确认项）
6. WHEN 游标早于保留期 THEN 从最早保留的事件继续返回，并在第一个事件前插入一个 `session.events_gap` 事件提示可能有遗漏，而不是返回错误
7. WHEN 会话不在受管理工作区内、属于未分组会话或已归档 THEN 其事件不出现在结果中（与 B7 范围一致）
8. WHEN 调用失败 THEN 返回 MCP 错误结果，宿主保留旧游标并在下个周期重试
9. WHEN 事件量较大 THEN 响应在 500ms 内返回；游标大小保持在数 KB 以内

#### 需求 B7：会话历史读取与会话搜索（补充需求，P1）

**用户故事**：作为 OutcomeGo Bot，我希望能读到某个会话里已经聊了什么，也能按关键词找到相关会话。这样接手会话或写汇报时，能知道「做到哪一步、上次说了什么」，而不是只能看到标题、状态和时间。

**验收标准**：

1. WHEN 新增 MCP 工具 `session_history` THEN 按页返回会话里用户和助手的文字消息，每条带序号、角色和时间；工具调用、图片等没有文字的内容不返回，但告知被略过的数量
2. WHEN 会话历史很长 THEN 每页消息数有上限（默认 20，最多 100），单条消息最多 8 KiB、每页文字最多 256 KiB，被截短的消息带 `truncated` 标记；Bot 用返回的 `nextCursor` 继续往更早的消息翻页
3. WHEN 消息由 Bot 通过 `session_continue` 发出 THEN 历史里这条消息带上发送它的 `agentId`（与 B1 一致）
4. WHEN 新增 MCP 工具 `session_search` THEN 按关键词查找对话内容包含该文字的会话，返回会话 ID、所属工作区和命中位置附近的一小段文字；可用 `workspaceId` 限定在一个工作区内
5. WHEN 会话已归档、不在受管理工作区内或属于未分组会话 THEN `session_history` 返回「会话不可用」，`session_search` 不把它列入结果
6. WHEN 当前 DSH 版本不提供读历史或搜索 THEN 对应工具返回明确的「能力不可用」，其他工具不受影响；WHEN DSH 部署关闭了会话搜索（DSH Web 默认如此） THEN `session_search` 返回专门的「搜索未开启」错误并说明需宿主开启，而不是通用失败
7. WHEN 底层读取失败 THEN 错误信息不暴露路径等内部细节
8. WHEN 搜索命中的会话很多 THEN 结果可能少于 `limit`：DSH 先在整个 Host 范围内搜索并最多返回 20 个会话，之后才去掉受管理工作区以外的会话；此时 `hasMore` 为真，Bot 应缩短关键词或指定 `workspaceId`

### 二、openteam 前端需求

前端需求按插件系统规则交付：F1、F3、F4 依赖「MCP 工具发现 + 宿主能力 + 技能说明」，F2 依赖「宿主插件事件轮询（Spec 005.4）」。每条标准后的「承担方」标明由谁保证：**插件包**（`plugin.json`/SKILL.md/README）、**宿主**（OutcomeGo 现有运行时）、**后端**（dsh-codingns）、**流程**（配置与联调验证）。

#### 需求 F1：MCP 连接与参数支持（P0）

**用户故事**：作为 OutcomeGo Bot 开发者，我希望连接 DSH-WEB 后能直接使用其全部 MCP 工具，并按工具 Schema 传递 `agentId`、`priority` 等新参数。

**验收标准**：

1. WHEN 用户在账号设置中填写 MCP URL 与 API Key 并连接 THEN 宿主发现 DSH-WEB 公布的全部工具及输入 Schema；局域网私有 IP 或 localhost 可用 HTTP，公网 IP 和域名必须 HTTPS（承担方：插件包 `plugin.json`、宿主；已完成）
2. WHEN 后端 Schema 声明了 `agentId`、`priority` 等参数 THEN Bot 能按 Schema 传递，宿主按 Schema 校验类型、必填与范围（承担方：宿主；后端须在 Schema 中声明类型、长度、格式和取值范围）
3. WHEN 后端尚未公布某工具或参数 THEN 插件不伪造该工具，技能说明要求 Bot 以发现结果为准（承担方：插件包 SKILL.md）
4. WHEN 后端按 design §3.1.1 完成接口 THEN 服务端公布 23 个工具（Bot 可用的 22 个加宿主专用的 `session_events`），Bot 可见的是 22 个，且 Schema 与 design §3.1.1 一致，用契约测试验证（承担方：流程、后端、宿主）
5. WHEN 插件配置被导出 THEN 不包含 API Key（承担方：宿主）

#### 需求 F2：会话事件订阅（P0，宿主能力，Spec 005.4）

**用户故事**：作为 OutcomeGo Bot，我希望订阅指定的 DSH-WEB 会话，状态变化时被唤醒，以便继续后续工作；没有变化时不浪费运行成本。

**验收标准**：

1. WHEN DSH-WEB 插件清单声明 `events: { "pollTool": "session_events", "source": "plugin", "intervalSeconds": 60 }` 且账号已连接 THEN 宿主按间隔用该账号的凭证调用 `session_events`，调用对 Bot 隐藏（承担方：插件包 `plugin.json`、宿主；清单已声明。后端尚未提供 `session_events` 时，宿主只记录一条提示并每 15 分钟检查一次，不报错，后端上线后自动生效）
2. WHEN Bot 创建 routine，触发器为 `{ "type": "plugin", "plugin": "dsh-web", "resourceIds": ["<sessionId>"], "events": ["session.completed", "session.failed"] }` THEN 只有匹配的事件唤醒该 routine 所属的 Bot；不匹配的事件不唤醒任何 Bot（承担方：宿主）
3. WHEN Bot 希望订阅自己创建的所有会话 THEN 可用 `actors: ["<agentId>"]` 代替逐个会话订阅；`resourceIds` 与 `actors` 至少提供一个，不能订阅整个插件的全部事件（承担方：宿主、插件包 SKILL.md）
4. WHEN 事件被拉取 THEN 唤醒内容包含 `<plugin_event>` 块，含 `kind`、`resourceId`、`actor`、`text`；`text` 是不受信任的数据，不是新的用户授权（承担方：宿主）
5. WHEN 同一事件被重复返回或服务重启 THEN 同一个 routine 只运行一次；宿主在全部事件派发成功后才保存新游标（承担方：宿主）
6. WHEN 账号首次连接 THEN 只有连接之后发生的事件才会触发，不会因历史事件集中唤醒（承担方：后端 B6.2）
7. WHEN 取消订阅 THEN 暂停或删除该 routine 即可（承担方：宿主、插件包 SKILL.md）
8. WHEN 轮询失败（认证失败、超时 30 秒、后端错误） THEN 宿主保留旧游标并在下个周期重试，不影响其他账号；技能说明要求 Bot 在怀疑漏事件时用 `session_list`、`message_status` 核对（承担方：宿主、插件包 SKILL.md）
9. 插件包不新增监听端口、服务端路由或 connector 进程；不需要公网地址（承担方：插件包）

#### 需求 F3：工具映射与使用说明（P1）

**用户故事**：作为 OutcomeGo Bot，我希望正确、安全地使用文件、Git、队列等全部 22 个工具。

**验收标准**：

1. WHEN 宿主发现工具 THEN 按宿主既有命名规则（插件、账号命名空间）暴露给 Bot；`plugin.json` 中 `connections[].tools` 保持空数组，工具清单以发现结果为准（承担方：宿主、插件包）
2. WHEN Bot 使用工作区、会话、队列、问题/权限、终端工具 THEN SKILL.md 说明各类工具的用法和前置检查，例如先 `message_status` 再 `message_cancel`、`message_prioritize`，`session_queue_peek` 查看队列（承担方：插件包 SKILL.md）
3. WHEN 工具返回结果 THEN 由后端按 design §3.1.1 返回结构化 JSON，宿主原样传递，插件不二次改写；Bot 只报告实际返回的字段，不推断未返回的队列位置或等待时间（承担方：后端、插件包 SKILL.md）
4. WHEN 后端返回错误码（design §5.1） THEN SKILL.md 给出各错误码的处理指引（承担方：插件包 SKILL.md、后端）
5. WHEN 修改工具清单 THEN 自动化测试校验 SKILL.md 覆盖 design §3.1.1 中全部 22 个工具名，避免文档与契约脱节（承担方：流程）

#### 需求 F4：错误处理与超时（P1）

**用户故事**：作为 OutcomeGo 用户，我希望 DSH-WEB 操作异常时收到清晰的提示，且不会因为重试造成重复操作。

**验收标准**：

1. WHEN 凭证无效 THEN 宿主返回 HTTP 认证错误，技能说明提示检查该账号配置的 DSH-WEB API Key（承担方：宿主、插件包 SKILL.md）
2. WHEN 后端工具调用失败 THEN 错误码与消息原样保留给 Bot，Bot 向用户报告而不吞掉上下文（承担方：宿主、插件包 SKILL.md；后端须返回清晰错误码和消息）
3. WHEN 操作较慢 THEN 宿主连接和工具发现的时限为 30 秒；工具调用时限由宿主统一管理（当前为 60 分钟），插件不能单独设置。后端工具应在约定时限内返回或返回超时错误：文件和 Git 操作 5 秒保护（B4、B5），其余耗时工作通过会话异步处理，用状态查询或事件订阅获取结果（承担方：宿主、后端）
4. WHEN 网络故障或结果不确定 THEN 宿主不自动重放工具调用（避免重复副作用）；只读工具可由 Bot 重试；有副作用的工具（`session_create`、`session_continue`、`message_cancel`、`message_prioritize`、`session_answer`、`terminal_write`）须先查询状态再决定是否重做；事件拉取失败时宿主按游标重试（承担方：宿主、插件包 SKILL.md）
5. WHEN 记录日志或导出配置 THEN API Key 作为 secret 字段单独存储，不出现在插件包、导出和对话中；`agentId` 不当作凭证，但后端日志不应意外暴露（承担方：宿主、后端）

## 非功能需求

### 后端（dsh-codingns）

1. **性能**：
   - 文件列表操作在 500ms 内返回（深度 ≤ 3）
   - Git 操作在 2s 内返回
   - `session_events` 在 500ms 内返回

2. **可靠性**：
   - 事件持久保存，服务重启后仍可按游标读取，至少保留 7 天
   - 并发会话不超过 10 个时性能无明显下降
   - 队列管理不占用过多内存

3. **安全性**：
   - 路径验证防止目录穿越
   - agentId 不被意外暴露在日志中
   - 会话历史和搜索只面向受管理工作区，其他会话读不到；错误信息不带路径等内部细节

### 前端（openteam）

1. **性能**：
   - 工具调用响应时间由后端指标保证（文件列表 ≤ 500ms、Git ≤ 2s），前端不额外增加代理层
   - 已安装插件及其账号对所有 Bot 可用；10 个 Bot 并发时用联调验证，不要求插件内实现并发控制

2. **可靠性**：
   - 不自动重放有副作用的工具调用；事件按游标至少一次读取，宿主去重
   - 事件延迟等于轮询间隔（默认 60 秒，最短 30 秒），不承诺即时

3. **安全性**：
   - API Key 按账号隔离保存，不进入插件包、导出和对话
   - 插件包不包含 `.env`、凭证文件或真实令牌
   - 日志和文档示例中不出现真实 API Key、Bearer 密钥；`agentId` 不当作凭证

## 成功定义

- ✓ dsh-codingns 升级了 MCP 并提供 `session_events` 事件拉取接口，支持 Agent 消息标识、会话关联、队列管理、文件/Git 工具
- ✓ openteam 插件按插件系统规则交付：连接后 Bot 可见 22 个工具，技能说明完整，Bot 订阅会话后由宿主拉取事件并唤醒
- ✓ Bot 能够执行完整工作流（创建会话 → 发送消息 → 接收完成事件 → 继续后续任务）
- ✓ 多个 Bot 并发使用不会互相干扰
- ✓ 会话队列、插队等高级功能能正常工作
- ✓ Bot 能读取受管理工作区内会话的历史、按关键词搜索会话，读不到范围之外的会话
- ✓ 用户在 DSH-WEB UI 中能看到「发送自Agent」标签
- ✓ 所有通信都安全、可靠、性能良好
