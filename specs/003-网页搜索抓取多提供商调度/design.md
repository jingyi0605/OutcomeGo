# 设计文档 - 网页搜索与抓取多提供商调度

状态：IN_REVIEW

## 1. 概述

### 1.1 目标

- 使用统一的 Web tool schedule 表达 Search 和 Fetch 的关闭、单提供商和多提供商状态。
- 将 DeepSeek 官方 Search/Fetch API 接入现有 adapter 层。
- 在不泄露凭据的前提下实现轮询和故障转移。
- 通过兼容读取和数据库迁移保留旧部署的行为。

### 1.2 覆盖需求

- `requirements.md` 需求 1：DeepSeek Search/Fetch 提供商
- `requirements.md` 需求 2：多提供商配置
- `requirements.md` 需求 3：调度策略
- `requirements.md` 需求 4：兼容性与安全

### 1.3 技术约束

- 后端：TypeScript、Bun、Prisma、PostgreSQL
- 前端：React、桌面端 renderer、现有 Settings UI 组件
- 数据存储：`WebSearchSettings`、`WebFetchSettings`、`WebToolProvider`
- 认证授权：现有 server settings API 和 computer control token
- 外部依赖：DeepSeek Search/Fetch API、现有 provider adapter

## 2. 架构

### 2.1 系统结构

1. 桌面端分别打开 Search 或 Fetch 页面，编辑 provider entries、顺序、策略和 API Key。
2. server settings service 校验输入，在事务中保存 schedule 和 provider secrets。
3. computer runtime 每次从 server 读取当前 schedule 和对应 secrets。
4. scheduler 按策略生成本次尝试顺序：`round_robin` 只选择一个 provider，`failover` 按顺序尝试全部可用 provider。
5. provider adapter 发送外部请求并标准化结果。
6. runtime 返回现有 WebSearch/WebFetch 工具结果；失败信息只包含 provider 名称和安全错误摘要。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `packages/contracts/src/web-search.ts` | 定义 provider、schedule、配置视图和凭据契约 | provider catalog、客户端输入 | TypeScript 类型 |
| `apps/server/src/services/web-provider-settings.ts` | 校验、迁移兼容、保存和读取 schedule | Web tool settings input | secret-free view 或 runtime credentials |
| `packages/db/prisma/schema.prisma` | 保存 schedule 和轮询状态 | JSON/字段 | PostgreSQL rows |
| `apps/computer/src/search-provider.ts` | Search adapter、DeepSeek adapter 和调度 | Search credentials、query | Search result |
| `apps/computer/src/fetch-provider.ts` | Fetch adapter、DeepSeek adapter 和调度 | Fetch credentials、URL | Fetch result |
| `apps/desktop/src/renderer/components/outcomego/settings/providers.tsx` | 多 provider 编辑、排序和策略选择 | WebProvidersView | WebProvidersInput |
| `apps/desktop/src/renderer/assets/web-providers` | DeepSeek provider 图标 | brand | image asset |

### 2.3 关键流程

#### 2.3.1 保存多提供商配置

1. 页面加载 `WebProvidersView`，把服务端 entries 映射为可编辑 draft。
2. 用户添加 provider、输入或替换 API Key、调整顺序、选择策略。
3. 保存时发送当前 Web tool 的完整 schedule 和发生变化的 provider fields。
4. 服务端验证 provider 唯一性、顺序完整性、entry ready 状态和策略值。
5. 服务端在一个事务中更新 schedule、provider secrets 和必要的轮询状态。

#### 2.3.2 执行轮询

1. runtime 读取当前 schedule。
2. 对 `round_robin`，使用原子递增或事务安全游标计算起始索引。
3. 只调用选中的一个 provider；成功或失败都完成本次轮询位置消费。
4. 返回 provider 标识，但不返回 API Key。

#### 2.3.3 执行故障转移

1. runtime 从配置首 provider 开始尝试。
2. 对可恢复的网络、超时、429、402、5xx 错误继续下一个 provider。
3. 对请求无效、API Key 无效或目标 URL 被安全策略拒绝的错误保留错误分类，并按 adapter 规则继续或终止。
4. 成功时返回成功结果；全部失败时返回安全摘要和最后一个可操作提示。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4

- `WebToolSchedule`：表示一个 Web tool 的策略和有序 provider entries。
- `WebToolCredentials`：runtime 使用的 provider、API Key 和调度游标信息。
- `ProviderAdapter`：将具体 provider 的请求和响应转换为统一结果。
- `WebProviderScheduler`：根据策略生成尝试顺序，并分类失败。

### 3.2 数据结构

#### 3.2.1 `WebToolSchedule`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `strategy` | `"round_robin" \| "failover"` | 是 | 调度策略 | 仅允许两个值 |
| `providers` | `string[]` | 是 | 有序 provider id 列表 | 不重复；必须属于当前 tool 目录 |
| `cursor` | `number` | 是 | 轮询游标 | 非负整数；服务端负责规范化 |

空数组表示关闭。为兼容旧客户端，输入层继续接受 `selected`，并转换为单 provider entry。

#### 3.2.2 `WebToolCredentials`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `strategy` | `"round_robin" \| "failover"` | 是 | 当前策略 | 已校验 |
| `providers` | `Array<{ provider: string; apiKey: string \| null }>` | 是 | 按顺序返回的 runtime 凭据 | 只返回 ready entry |
| `cursor` | `number` | 是 | 当前轮询游标 | 不返回给公开 API |

#### 3.2.3 `WebToolView`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `selected` | `Provider \| null` | 否 | 旧客户端兼容字段，取首 entry | 不作为新客户端的唯一状态来源 |
| `schedule` | `WebToolSchedule` | 是 | 当前配置的公开调度状态 | 不含秘密 |
| `providers` | `Record<string, WebProviderState>` | 是 | 目录内每个 provider 的状态 | 不含秘密 |

### 3.3 接口契约

覆盖需求：1、2、3、4

#### 3.3.1 Web provider settings

- 类型：HTTP
- 路径或标识：`GET/PATCH /api/server-settings/web-providers`
- 输入：新客户端发送 `schedule` 和 `providers`；旧客户端可发送 `selected` 和 `providers`
- 输出：带 `schedule`、兼容 `selected`、provider 状态的 `WebProvidersView`
- 校验：tool、provider、策略、重复 entry、API Key 和 selected/schedule 一致性
- 错误：沿用 `ApiError(400, "invalid_web_provider_settings", ...)`

#### 3.3.2 Runtime credentials

- 类型：HTTP
- 路径或标识：`GET /api/internal/server-settings/web-search/credentials`、`GET /api/internal/server-settings/web-fetch/credentials`
- 输入：现有 control token
- 输出：只供 computer 使用的 schedule credentials
- 校验：只返回已保存且 ready 的 provider；fetch 空 schedule 表示关闭
- 错误：服务端返回非成功状态，computer fail closed

#### 3.3.3 DeepSeek Search

- 类型：HTTP
- 路径或标识：`POST https://api.deepseek.com/v1/tools/search`
- 输入：`{ query: string; count: 10; need_content: true }`
- 输出：从 `results[]` 读取 `title`、`url`、`snippet`、`summary`、`content`、`date`
- 校验：只接受合法 HTTP(S) URL，限制响应体大小和结果数量
- 错误：按 HTTP 状态映射认证、余额、限流、服务和无结果错误

#### 3.3.4 DeepSeek Fetch

- 类型：HTTP
- 路径或标识：`POST https://api.deepseek.com/v1/tools/fetch`
- 输入：`{ url: string }`
- 输出：从 `title`、`content` 读取页面内容
- 校验：复用现有公开 URL 校验；限制 URL 长度和响应体大小
- 错误：按 HTTP 状态映射认证、余额、限流、策略拒绝和服务错误

## 4. 数据与状态模型

### 4.1 数据关系

- `WebSearchSettings` 和 `WebFetchSettings` 各自保存一个 JSON schedule。
- `WebToolProvider` 继续以 `(tool, provider)` 为主键保存各 tool 独立的 secret 和 check 状态。
- schedule 只引用 provider id，不复制 secret。
- 旧的 `provider` 字段保留一段迁移周期，读取时优先 schedule；旧字段只用于生成单 entry 默认值。

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `off` | 当前 Web tool 不调用 provider | schedule 为空或兼容 selected 为 null | 保存至少一个 ready provider |
| `ready` | 有可用 provider 可调度 | entry 有必需 secret | 删除 entry、移除 secret 或保存空 schedule |
| `checking` | 正在进行真实连接检查 | 用户点击 Check | 检查成功或失败 |
| `degraded` | 至少一个 entry 失败但仍有其他 entry | 故障转移发生 provider 失败 | 下一次检查或配置变更 |

## 5. 错误处理

### 5.1 错误类型

- `invalid_web_provider_settings`：配置结构、策略或 provider 不合法。
- `web_provider_not_ready`：已加入调度的 provider 缺少 API Key。
- `web_provider_auth_failed`：provider API Key 无效。
- `web_provider_retryable_failure`：网络、超时、限流、余额或服务暂时错误。
- `web_provider_all_failed`：故障转移中的所有 provider 均失败。

### 5.2 错误响应格式

公开服务端接口沿用现有 `ApiError` JSON 格式。runtime 只向工具调用方返回经清理的消息，不包含 URL 中的 key、Authorization header 或原始私密错误体。

### 5.3 处理策略

1. 输入验证错误：事务开始前拒绝。
2. 业务规则错误：不允许保存缺少 key 的 enabled entry。
3. 外部依赖错误：adapter 统一分类后交给 scheduler。
4. 重试、降级或补偿：只由 failover 调度下一个 entry；round-robin 不进行同一请求内隐式 fallback。

## 6. 正确性属性

### 6.1 属性 1：凭据与公开视图分离

*对于任何* 成功返回的公开设置视图，系统都应该只包含 `secretSaved`、`ready` 和检查状态，不包含 API Key。

**验证需求：** `requirements.md` 需求 4

### 6.2 属性 2：策略行为稳定

*对于任何* 有序 provider 列表，round-robin 单次请求最多调用一个 provider，failover 的调用顺序严格遵循列表且不会重复调用同一个 entry。

**验证需求：** `requirements.md` 需求 3

### 6.3 属性 3：旧配置可恢复

*对于任何* 旧版本单 provider 配置，迁移后 schedule 应包含该 provider 且运行结果与迁移前一致。

**验证需求：** `requirements.md` 需求 4

## 7. 测试策略

### 7.1 单元测试

- DeepSeek Search/Fetch 请求体、鉴权、响应标准化和错误分类。
- schedule 输入校验、旧 selected 兼容转换和 cursor 规范化。
- round-robin 和 failover 的尝试顺序、取消和错误分类。

### 7.2 集成测试

- Prisma migration 后旧配置和新 schedule 的读写。
- server settings API 的 secret-free view、事务一致性和并发 cursor 更新。
- connection check 使用正确的 provider key 并按 key 变更丢弃过期结果。

### 7.3 端到端测试

- 桌面端 Search/Fetch 页面添加两个 provider、调整顺序、保存策略并重新打开。
- Search/Fetch 页面显示 DeepSeek、展开 API Key、运行 Check。
- 轮询和故障转移在真实 computer runtime 配置下走通。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §3.3.3、§3.3.4 | adapter 单测和 connection check 集成测试 |
| `requirements.md` 需求 2 | `design.md` §3.2、§4.1 | settings service、迁移和 UI 测试 |
| `requirements.md` 需求 3 | `design.md` §2.3、§5.1、§6.2 | runtime scheduler 单测和运行时集成测试 |
| `requirements.md` 需求 4 | `design.md` §4.1、§5.3、§6.1、§6.3 | 兼容迁移、secret redaction 和回归测试 |

## 8. 风险与待确认项

### 8.1 风险

- 将 cursor 持久化在 server settings 中会增加高并发下的写入频率，需要使用原子更新或低开销存储。
- DeepSeek Search 的 `need_content` 会增加响应体大小，需要沿用现有上限和截断规则。
- 部分 provider 的 4xx 错误表示 key 无效或目标站点拒绝，不能只按 HTTP 状态粗略决定是否 fallback。

### 8.2 待确认项

- DeepSeek API 的具体响应字段若与文档示例变化，需以 provider contract test 约束 adapter。
- round-robin 游标的持久化实现可在任务阶段根据现有数据库约束选择 JSON 更新或独立状态字段。
