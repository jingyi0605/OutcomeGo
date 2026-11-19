# Codingns4DSH

DSH-WEB 插件通过 OutcomeGo 的 Remote MCP 运行时连接 DSH-WEB 服务。MCP 工具由服务端动态发现（当前对应 DSH-WEB 的 22 个工具）；当服务端提供对应能力时，Bot 可使用工作区文件与 Git（6 个）、会话管理与队列、**读会话历史**（`session_history`）与**搜索会话**（`session_search`）（6 个）、消息队列状态与操作（3 个）、问题与权限（4 个）、终端（3 个）共 22 个工具。

## 配置

在插件账号设置中填写 DSH-WEB MCP HTTP 端点和服务端签发的 API Key。局域网私有 IP（如 `http://10.0.0.42:3010/mcp`）可使用 HTTP；公网 IP 和域名（含 `.local`）必须使用 HTTPS。使用 `localhost` 时，DSH-WEB 必须在发起 MCP 请求的 OutcomeGo 服务所处的同一网络环境里。HTTP 不加密，请仅在可信网络使用；凭证由 OutcomeGo 按账号保存，不属于插件包内容。

连接成功后，OutcomeGo 会读取服务端实际公布的工具及输入 Schema。服务端未实现或未开放的工具不会由插件伪造。

## 事件订阅

不使用 Webhook，也不需要公网地址。OutcomeGo 宿主支持插件事件轮询（Spec 005.4）：插件声明 `events`，宿主定期调用 DSH-WEB 的 `session_events` 并把事件交给订阅它的 Bot 的 routine；Bot 通过触发器 `{ "type": "plugin", "plugin": "dsh-web", "resourceIds": [...] }` 订阅。

`plugin.json` 已声明 `events`（`session_events`，每 60 秒）。DSH-WEB 的版本如果还没有 `session_events`，OutcomeGo 会安静地每 15 分钟检查一次，不报错；后端升级后订阅自动生效，无需更新插件。在此之前，Bot 用 `session_list`、`message_status` 查询状态。订阅方法见 [Bot 使用技能](skills/dsh-web/SKILL.md)。

## 当前边界

- 插件复用 OutcomeGo Remote MCP 的连接、工具发现、Schema 校验、账号隔离和 HTTP 错误处理。
- `plugin.json` 中 `tools` 保持空数组，具体可用工具及 `session_create` / `session_continue` 的 `agentId`、优先级与队列回执支持，以连接的 DSH-WEB MCP 服务实际发现结果与 Schema 为准。
- `session_history`（读会话历史）与 `session_search`（搜索会话）仅覆盖 DSH-WEB 受管理工作区内的未归档会话；`session_search` 受后端先在 Host 最多取 20 个再过滤的限制，可能出现返回数量少于 `limit` 但 `hasMore` 为 `true` 的情况。
- OutcomeGo 通用 Remote MCP 调用时限由宿主运行时管理；插件不能单独把调用时限改为 30 秒。
- 事件订阅依赖 DSH-WEB 提供 `session_events`；该工具由 OutcomeGo 宿主调用并对 Bot 隐藏，不计入 22 个工具。事件延迟约等于轮询间隔（60 秒），只收连接之后的事件。

详见 [Bot 使用技能](skills/dsh-web/SKILL.md)。
