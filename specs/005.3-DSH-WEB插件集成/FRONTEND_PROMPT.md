# OutcomeGo DSH-WEB 插件集成项目 - 前端开发提示词

## 项目背景

这是一个跨工作区协作项目：在 OutcomeGo 中交付 DSH-WEB 插件，使 Bot 能通过升级后的 DSH-WEB MCP 服务在其工作区中操作。

完整规格文档位置：`/Users/jackson/Code/openteam/specs/005.3-DSH-WEB插件集成/`

## 先理解插件系统的规则（重要）

OutcomeGo 的插件是**声明式**的。本项目按这些规则交付，不要写自定义 connector：

- 插件包只包含 `plugin.json`（连接与配置字段声明）、`skills/dsh-web/SKILL.md`（Bot 使用说明）、`README.md`，以及测试。
- DSH-WEB 通过 **Remote MCP** 连接。宿主负责连接、工具发现、输入 Schema 校验、账号隔离和 HTTP 错误处理。`plugin.json` 里 `connections[].tools` 保持空数组，工具清单来自发现结果。
- 宿主不重放结果不确定的工具调用；工具调用时限由宿主统一管理（当前 60 分钟），连接与发现时限 30 秒，插件不能单独设置。
- 插件不能监听端口。事件订阅使用宿主的**插件事件轮询**（Spec 005.4，宿主侧已完成）：插件清单声明 `events`，宿主定期调用后端 `session_events` 并对 Bot 隐藏该工具；Bot 创建触发器为 `{ "type": "plugin", "plugin": "dsh-web", ... }` 的 routine 来订阅。不需要公网地址，也没有 Webhook。
- 不得在 `apps/server` 中写 DSH-WEB 专属分发逻辑；`scripts/generate.ts` 自动发现插件目录。

因此，**不要**创建 `connector/`、`http-client.ts`、`webhook-handler.ts`，也不要使用 Webhook 或 `localhost:9999` 之类的端点。

## 你的职责

围绕需求 F1–F4，在插件系统允许的形态内完成交付，并与后端团队联调：

| 需求 | 交付方式 | 承担方 |
| --- | --- | --- |
| F1 MCP 连接与参数支持（P0） | 连接声明、配置字段、工具发现；`agentId`、`priority` 按后端 Schema 传递 | 插件包 + 宿主 + 后端 Schema |
| F2 会话事件订阅（P0） | `plugin.json` 的 `events` 声明、`SKILL.md` 订阅指引、联调 | 宿主（已完成）+ 后端 `session_events` + 插件包 |
| F3 工具映射与使用说明（P1） | `SKILL.md` 覆盖 22 个工具和错误码指引；契约测试 | 插件包 |
| F4 错误处理与超时（P1） | 遵守宿主语义；`SKILL.md` 给出错误处理和"先查状态再重做"的规则 | 宿主 + 插件包 + 后端 |

## 当前进度（截至 2026-11-19）

已完成（配置接入）：

- `packages/plugins/dsh-web/plugin.json`、`README.md`、`skills/dsh-web/SKILL.md`（初版）
- 私有网络 IP 可用 HTTP、公网和域名必须 HTTPS 的 URL 校验（`packages/plugin-sdk`，同步 iOS 校验与 t3-code 文案）
- `packages/plugins/test/dsh-web.test.ts`（通过）；`apps/server/test/plugin/dsh-web.integration.test.ts`（需要 `OUTCOMEGO_TEST_DATABASE_URL`，否则跳过）

未完成：

- `SKILL.md` 覆盖 22 个工具和错误码指引，以及技能契约测试、模拟 MCP 服务的发现与调用测试（F1.1）
- 事件订阅与真实后端的联调（F1.2；`plugin.json` 的 `events` 声明和 `SKILL.md` 订阅指引已完成，等待后端 `session_events`）

宿主侧已完成（Spec 005.4）：插件清单支持 `events.source: "plugin"`（含 Remote MCP）、`plugin` 触发器、宿主定期拉取、事件去重、轮询工具对 Bot 隐藏。
- Bot 工作流指引与联调（F2.1）
- ≥ 10 个联调场景与文档（F2.2）

## 核心要点

### 消息队列透明化

这是本项目的核心能力。Bot 通过后端 MCP 工具获得：

1. **发送消息时了解状态**
   ```
   session_continue(sessionId, message, agentId?)
   返回：{ messageId, status: "queued" | "processing" | "completed",
          queuePosition?, estimatedWaitMs?, reason?, success }
   ```
2. **查询消息状态**：`message_status(sessionId, messageId)` 返回状态、队列位置、`canCancel`、`canPrioritize`
3. **操作消息队列**：`message_cancel`、`message_prioritize(…, priority)`、`session_queue_peek`
4. **订阅队列事件**：`session_events` 事件 `session.message_queued`、`session.message_dequeued`，由 Bot 的订阅 routine 接收

`SKILL.md` 必须要求 Bot：先 `message_status` 再取消或插队；只报告实际返回的字段，不推断未返回的队列位置或预计等待时间。

### agentId 的使用

只有工作流提供了稳定的 Bot 标识、且当前 Schema 接受 `agentId` 时才传；`session_create` 与 `session_continue` 使用同一个值。`agentId` 是 DSH-WEB 侧用于标签和审计的标识，**不用于 OutcomeGo 侧选择接收事件的 Bot**。

### 重试与副作用

宿主不自动重放工具调用。只读工具可由 Bot 重试；有副作用的工具（`session_create`、`session_continue`、`message_cancel`、`message_prioritize`、`session_answer`、`terminal_write`）在网络中断或结果不确定时，先用 `session_list`、`message_status`、`session_queue_peek` 核对状态再决定是否重做。

## 工具清单（22 个，以后端发现结果为准）

| 类型 | MCP 工具 |
| --- | --- |
| 工作区（6） | `workspace_list`、`workspace_file_list`、`workspace_file_read`、`workspace_git_status`、`workspace_git_log`、`workspace_git_diff` |
| 会话（6） | `session_list`、`session_create`、`session_continue`、`session_queue_peek`、`session_history`、`session_search` |
| 消息队列（3） | `message_status`、`message_cancel`、`message_prioritize` |
| 问题/权限（4） | `session_questions`、`session_answer`、`session_request_permission`、`session_permission_status` |
| 终端（3） | `terminal_list`、`terminal_read`、`terminal_write` |

参数、副作用和使用要点见 `design.md` §3.2.3。宿主侧显示名按其既有规则（插件、账号命名空间）生成，不要在文档里自定义 `dsh_web.` 之类的前缀。

## 工作流示例

```
1. Bot 调用 session_create（带 workspaceId，必要时带 agentId、priority）
   → DSH-WEB 创建会话，返回 sessionId
2. Bot 调用 session_continue
   → 返回回执：messageId、status、queuePosition、estimatedWaitMs
3. Bot 基于回执决定：
   ├─ processing → 等待完成
   └─ queued → session_queue_peek 查看；先 message_status，再按需 message_cancel / message_prioritize
4. 会话完成或失败
   ├─ 已订阅（plugin 触发器的 routine）：宿主每 60 秒拉取 session_events，匹配则唤醒该 Bot → Bot 继续，并删除订阅
   └─ 未订阅或怀疑漏事件：Bot 用 session_list / message_status 查询，不得声称已收到事件
```

## 开发阶段

### 阶段 F1（2 周）：连接、技能契约与事件接入

#### F1.1 MCP 连接配置、技能说明与工具契约测试（进行中）
- 补全 `SKILL.md`：22 个工具、后端错误码处理指引、先查状态再操作的规则
- 技能契约测试：`SKILL.md` 的工具名与 design §3.2.3 一致
- 模拟 MCP 服务的集成测试：发现 22 个工具；`agentId`、`priority` 被正确传递；非法参数被宿主拒绝
- 真实后端 Schema 核对（需要后端 B1.1）

#### F1.2 会话事件订阅与联调（清单和指引已完成，等待后端 B2.2 联调）
- `plugin.json` 已声明 `events: { "pollTool": "session_events", "source": "plugin", "intervalSeconds": 60 }`（版本 0.1.3）。后端还没有该工具时，宿主只记录一条提示并每 15 分钟检查一次，不会每个周期报错，后端上线后自动生效
- `SKILL.md` 写订阅方法：创建会话后用 `resourceIds`（会话）或 `actors`（`agentId`）创建 routine，事件类型用 `events` 收窄；保存的提示词写明事件到达后做什么；处理完成后删除 routine；怀疑漏事件时用 `session_list`、`message_status` 核对
- 联调 6 类事件：`session.completed`、`session.failed`、`session.question_asked`、`session.permission_requested`、`session.message_queued`、`session.message_dequeued`
- 验证：匹配的 Bot 被唤醒、不匹配的不被唤醒、重复拉取不重复运行、首次连接不集中唤醒历史事件
- 核对 `<plugin_event>` 的内容形态并补进 `SKILL.md`；更新 `README.md` 的 Webhook 一节为事件订阅

#### F1.3 阶段检查
- 自动化测试通过；事件订阅联调记录完整

### 阶段 F2（1.5-2 周）：Bot 工作流与交付

#### F2.1 Bot 工作流指引与联调
- 固化 `agentId` 规则、队列流程、事件处理
- 真实 Bot 跑完整流程（需要后端 B3.3）
- 多个 Bot 各自订阅不同会话，事件只唤醒各自的 Bot，互不干扰

#### F2.2 联调场景与文档
- 不少于 10 个联调或端到端场景，22 个工具均被覆盖
- 错误场景：API Key 无效、网络中断后的状态核对、非法参数、后端错误码
- 文档按 `docs/README.md` 清单编写（带日期的中文文件名）

## 与后端的同步点

| 后端完成 | 前端可开始 |
| --- | --- |
| B1.1 | F1.1 对真实后端的 Schema 核对 |
| B2.2 | F1.2 事件订阅联调 |
| B3.3 | F2.1 完整流程 |

每周同步进度；参数格式、错误码、事件内容有问题立即反馈；后端完成阶段时提供集成环境。

## 需要和后端确认的事项

- 后端 `session_events` 的事件日志保留期（建议至少 7 天）与游标过期行为（建议 `session.events_gap`）
- 首次调用（游标为空）只返回基线游标，不返回历史事件；每次最多返回 50 个，升序，游标只推进到最后一个已返回的事件
- 默认 60 秒的轮询间隔是否满足场景；是否改为 30 秒（宿主最短 30 秒）
- 后端在输入 Schema 中声明 `agentId`、`priority` 的类型、长度、格式和范围（宿主据此校验）
- 文件和 Git 操作的后端超时（当前 5 秒保护）与超时错误形态
- `agentId` 的格式规范，以及 Bot 稳定标识如何提供给工作流

## 完整规格文档章节引用

- **需求定义**：`requirements.md` 中 F1–F4 部分
- **交付形态与职责划分**：`design.md` §3.2.0
- **工具接口**：`design.md` §3.1.1（MCP 工具定义）、§3.2.3（工具映射与技能说明）
- **会话事件**：`design.md` §3.1.2（`session_events` 协议与事件类型）、§3.2.2（订阅方式）；宿主机制见 Spec 005.4
- **错误处理**：`design.md` §3.2.4、§5
- **关键流程**：`design.md` §2.2、§3.2.5
- **具体任务**：`tasks.md` 中 F 阶段 1–2，含需求—设计—任务追踪表

## 验收标准

### F1 验收
- [ ] 连接后发现 22 个工具，Schema 与 design §3.1.1 一致（模拟服务和真实后端各验证一次）
- [ ] `agentId`、`priority` 按 Schema 传递，非法参数被宿主拒绝
- [ ] `plugin.json` 的 `tools` 为空，插件目录无 `connector/`，`apps/server` 无 DSH-WEB 专属代码
- [ ] 目录与配置测试、集成测试通过

### F2 验收
- [ ] `plugin.json` 声明了 `events`，Bot 可见的工具仍是 22 个（`session_events` 不在其中）
- [ ] 订阅步骤可复现；6 类事件能唤醒订阅它们的 Bot，不匹配的不唤醒，重复拉取不重复运行
- [ ] 完整 Bot 工作流正常运作
- [ ] 联调场景不少于 10 个，22 个工具被覆盖，每个场景有结果记录
- [ ] 错误场景覆盖：凭证无效、网络中断后核对状态、非法参数、后端错误码
- [ ] 文档清晰完整，`README.md` 的"当前边界"与实际一致

### F3、F4 验收
- [ ] `SKILL.md` 覆盖 22 个工具和错误码指引，契约测试通过
- [ ] 凭证无效时提示检查 API Key；错误码与消息原样保留
- [ ] 有副作用的调用不自动重放，`SKILL.md` 要求先查状态再重做
- [ ] API Key 不出现在插件包、导出和对话中

### 端到端验收
- [ ] Bot 能创建会话、发送消息、获取状态回执
- [ ] Bot 能查询队列、取消消息、提升优先级
- [ ] Bot 能读取文件和 Git 信息
- [ ] Bot 能处理会话完成和错误事件
- [ ] 多个 Bot 各自订阅不同会话，并发使用不互相干扰

## 测试策略

- **目录与配置测试**：`packages/plugins/test/dsh-web.test.ts`（运行：`cd packages/plugins && bun test test/dsh-web.test.ts`）
- **技能契约测试**：`SKILL.md` 与 design §3.2.3、§3.2.4 一致
- **服务端集成测试**：`apps/server/test/plugin/dsh-web.integration.test.ts`，需要 `OUTCOMEGO_TEST_DATABASE_URL`；参考 `apps/server/test/plugin/mcp-transport.test.ts` 的 MCP 测试写法
- **事件订阅联调**：为 Bot 创建 `plugin` 触发器的 routine，DSH-WEB 产生 6 类事件，观察唤醒与不唤醒
- **端到端**：真实 Bot + 真实 DSH-WEB，覆盖 22 个工具

原先"单元测试覆盖率 ≥ 80%"的目标取消：插件没有自定义运行时代码，质量由上述测试和联调记录保证。

## 注意事项

- 不要提交 `.env`、凭证文件或真实令牌；文档示例使用占位符
- 插件版本按插件规则提升，并在 `README.md` 标明对应的 dsh-codingns 版本
- 当前工作树里 SDK、iOS、t3-code 的改动与 DSH-WEB 插件混在一起，提交前建议拆成独立提交
- 提交消息使用中文，格式为 `前端：xxxxx` 或 `修复：xxxxxx`

## 有任何问题请参考

- 完整规格：`/Users/jackson/Code/openteam/specs/005.3-DSH-WEB插件集成/`
- 后端团队提示词：`BACKEND_PROMPT.md`（同目录）
- 宿主文档：`packages/plugins/README.md`、`docs/usage/plugins.md`、`docs/usage/routines.md`
- 后端 SKILL.md：`/Users/jackson/Code/CodingNS/data/dsh-codingns/SKILL.md`
