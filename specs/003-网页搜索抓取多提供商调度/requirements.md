# 需求文档 - 网页搜索与抓取多提供商调度

状态：IN_REVIEW

## 简介

当前 Providers 设置页每项能力只能选择一个提供商。单一提供商出现限流、余额不足、服务暂时不可用或目标站点拒绝时，搜索或抓取会直接失败，用户也无法在同一页面维护多个 API Key。

本功能为 Search 和 Fetch 分别引入多提供商配置，并接入 DeepSeek 官方 Search/Fetch API。用户可以维护多个提供商，选择轮询或故障转移策略，并继续使用现有的单提供商配置和关闭行为。

## 术语表

- **System**：aiTeamOS 服务端、computer runtime 和桌面端设置界面。
- **Web tool**：Search 或 Fetch 能力。
- **Provider entry**：某个 Web tool 下的一个已配置提供商及其排序位置。
- **轮询**：每次请求只调用一个提供商，按配置顺序轮换起始位置。
- **故障转移**：按配置顺序逐个尝试提供商，当前提供商失败后尝试下一个。

## 范围说明

### In Scope

- 在 Search 和 Fetch 的提供商目录中加入 DeepSeek，并实现官方 API 请求、响应解析、错误处理和连接检查。
- 将每项 Web tool 从单一 `selected` provider 扩展为有序 provider entries 和 strategy。
- 在 Search、Fetch 设置页中增加多个提供商、删除提供商、调整顺序和选择轮询/故障转移策略的界面。
- 为旧的单提供商数据提供兼容读取和安全迁移。
- 保留 API Key 不回传、不写入事件、不出现在错误信息中的约束。

### Out of Scope

- 不新增自定义搜索或抓取 endpoint。
- 不实现并行聚合策略、按成本权重调度或按域名选择提供商。
- 不改变浏览器工具的网络访问策略。
- 不改变 onboarding 的单提供商引导流程之外的产品目标；引导流程只需兼容新的配置返回结构。

## 需求

### 需求 1：DeepSeek Search/Fetch 提供商

**用户故事：** 作为管理员，我希望在 Search 和 Fetch 页面配置 DeepSeek API Key，以便使用 DeepSeek 的实时网页搜索和网页 Markdown 抓取能力。

#### 验收标准

1. WHEN 用户打开 Search 或 Fetch 页面 THEN System SHALL 显示 DeepSeek 提供商、图标、说明和 API Key 配置入口。
2. WHEN Search 使用 DeepSeek THEN System SHALL 向 `POST https://api.deepseek.com/v1/tools/search` 发送 Bearer 鉴权 JSON 请求，并将结果标准化为现有 WebSearch 结果结构。
3. WHEN Fetch 使用 DeepSeek THEN System SHALL 向 `POST https://api.deepseek.com/v1/tools/fetch` 发送 Bearer 鉴权 JSON 请求，并将 `title` 和 `content` 标准化为现有 WebFetch 结果结构。
4. WHEN DeepSeek 返回认证、余额、限流、站点策略或服务错误 THEN System SHALL 返回不泄露 API Key 的可理解错误，并允许调度器依据错误类型决定是否尝试下一个提供商。
5. WHEN 用户运行连接检查 THEN System SHALL 使用已保存的 DeepSeek API Key 执行真实 Search 或 Fetch 检查，并保存检查结果。

### 需求 2：多提供商配置

**用户故事：** 作为管理员，我希望为 Search 和 Fetch 分别添加多个提供商并维护顺序，以便建立稳定的能力供应链。

#### 验收标准

1. WHEN 用户添加多个提供商并保存 THEN System SHALL 保存每项 Web tool 独立的有序 provider entries、策略和各提供商凭据。
2. WHEN 用户调整顺序 THEN System SHALL 在下一次请求中使用新的顺序，并且不会改变另一项 Web tool 的配置。
3. WHEN 用户删除提供商 THEN System SHALL 删除该提供商在当前 Web tool 的调度配置；若该凭据未被另一项 Web tool 使用，则允许同时清理其当前 Web tool 凭据。
4. WHEN provider entry 缺少必需 API Key THEN System SHALL 阻止保存该 entry，并说明需要补充凭据。
5. WHEN 用户关闭 Web tool THEN System SHALL 保存关闭状态，并在运行时不发起该 Web tool 的提供商请求。
6. WHEN 旧数据只有一个 `selected` provider THEN System SHALL 将其读取为单 entry 的兼容调度配置。

### 需求 3：调度策略

**用户故事：** 作为管理员，我希望为 Search 和 Fetch 选择轮询或故障转移策略，以便在均衡使用和可用性之间做选择。

#### 验收标准

1. WHEN 策略为轮询 THEN System SHALL 每次请求只调用一个 provider entry，并以持久化的轮询游标轮换起始 provider；单次失败不得隐式调用第二个 provider。
2. WHEN 策略为故障转移 THEN System SHALL 按配置顺序尝试 provider；遇到连接失败、超时、限流、余额不足或服务端错误时继续尝试下一个 ready provider。
3. WHEN 故障转移遇到认证错误、无效请求或明确的目标站点拒绝 THEN System SHALL 保留错误语义，并按错误分类决定是否继续；最终失败时返回包含尝试结果的安全摘要。
4. WHEN 任一 provider 成功 THEN System SHALL 返回现有 Search/Fetch 工具契约要求的结果，并标记实际使用的 provider。
5. WHEN 所有 provider 均不可用 THEN System SHALL 不声称已经完成搜索或抓取，并返回不包含凭据的失败信息。

### 需求 4：兼容性与安全

**用户故事：** 作为现有部署的管理员，我希望升级后原有配置继续可用，以便无需重新录入 API Key。

#### 验收标准

1. WHEN 数据库从旧版本升级 THEN System SHALL 保留现有 Search/Fetch provider、API Key 和连接检查结果。
2. WHEN 旧客户端只发送 `selected` 和 `providers` THEN System SHALL 接受该请求并转换为单 entry 调度配置。
3. WHEN 新客户端读取配置视图 THEN System SHALL 不返回任何 API Key 明文。
4. WHEN provider 请求、数据库错误、调度错误或检查结果被记录 THEN System SHALL 不包含 API Key、鉴权 header 或带凭据 URL。

## 非功能需求

### 非功能需求 1：性能

1. 轮询每次请求最多发起一个 provider 请求。
2. 故障转移只在前一个 provider 已明确失败后继续，遵守现有每个 provider 的超时和响应大小限制。

### 非功能需求 2：可靠性

1. 调度游标更新必须是并发安全的，不能因多个 computer 请求而长期固定在同一个 provider。
2. 配置保存失败时不得部分提交 provider 顺序、策略或凭据。
3. 某个 provider 的检查结果只在其 API Key 未变化时写回。

### 非功能需求 3：可维护性

1. 新增 Web provider 只需增加目录信息和对应 adapter，不应修改调度算法。
2. Search 和 Fetch 复用同一套配置模型和调度语义，同时保留各自的 provider 类型约束。

## 成功定义

- DeepSeek Search 和 Fetch 可在设置页配置、检查并实际调用。
- Search 和 Fetch 可分别保存至少两个 provider entry，且顺序和策略能在重启后保留。
- 轮询和故障转移行为有 runtime 单元测试覆盖，旧单提供商测试继续通过。
- 数据库迁移、服务端契约、桌面设置页和运行时验证均完成。
