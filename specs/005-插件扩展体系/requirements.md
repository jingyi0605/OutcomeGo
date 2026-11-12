# 需求文档 - 插件扩展体系

状态：草案

关联文档：[README.md](README.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 简介

OpenTeam 已经具备插件市场、插件包解析、Skills、MCP connector、账号连接、插件配置、Bot runtime 和插件缓存等能力，但这些能力目前主要由不同类型的插件分别使用。随着 Bitwarden/Vaultwarden 等凭据类插件加入，项目需要一份父规格来固定共同的数据流、权限边界、运行环境和验收方式。

本 Spec 的目标是让插件成为可持续扩展的产品边界：插件作者能够用统一的包格式声明能力，系统能够安全地保存和传递配置，Bot 能够按照明确的 worker scope 使用插件，维护者能够验证升级和外部服务兼容性。

## 术语表

- **System**：OpenTeam server、Worker、computer runtime、desktop、iOS/Android 客户端和插件包工具链。
- **Plugin package**：包含 `plugin.json`、Skill、connector、脚本、资源和来源元数据的可安装包。
- **Skill**：面向 Bot 的任务说明和支持文件，告诉 Bot 何时使用某个插件能力。
- **Connector**：通过 HTTP、stdio 或 builtin transport 提供结构化工具的插件连接。
- **Runtime field**：带 `environment` 的插件配置字段，保存后可注入 Bot computer 进程。
- **Plugin secret**：需要保护、不回显且只能在运行时使用的字段，例如 API Key、Client Secret 或主密码。
- **Plugin account**：插件 connector 的一个独立账号及其 credentials、namespace、状态和工具快照。
- **Provider**：插件连接的外部服务、CLI、Vaultwarden、邮件服务或自托管系统。
- **Worker scope**：插件 Skill 或 connector 可被主 Bot、executor、knowledgeWork、computerUse 等哪类运行单元使用的范围。
- **Package revision**：插件包内容和版本生成的可验证指纹，用于缓存、升级和回滚。
- **Child Spec**：编号为 `005.x` 的具体插件扩展规格。

## 范围说明

### In Scope

- 插件包和插件 SDK 的共同定义。
- Skills、MCP、Hybrid 插件的能力边界。
- setup field、runtime field、secret field 和配置视图。
- 插件安装、更新、回滚、卸载、缓存和环境清理。
- Bot 与不同 worker 的插件能力传递。
- 连接 namespace、工具风险和错误合同。
- 凭据类插件和自托管 provider 的安全与兼容性要求。
- 插件测试、来源完整性、CLI 安装校验和文档验收。
- 子规格之间的依赖、证据和最终父规格验收。

### Out of Scope

- 通用 IAM、组织级 RBAC、多租户权限平台和独立 Policy Engine。
- 为所有工具建立统一的风险评分或自动审批系统。
- 创建独立的插件云端执行平台或第二套 Agent Runtime。
- 把所有外部 provider 的数据复制到 OpenTeam 数据库。
- 默认允许插件修改用户文件、发送外部消息或执行写操作。
- 一次性把所有现有插件改造成同一种 transport。
- 将 provider 的 OAuth、CLI 或 API 细节硬编码到共享 server 核心。

## 需求

### 需求 1：插件包具有稳定且可验证的共同契约

**用户故事：** 作为插件作者，我希望用统一格式声明插件能力，以便插件可以被市场、SDK、Server 和 Bot runtime 一致处理。

#### 验收标准

1. WHEN 插件包被生成或导入 THEN SDK SHALL 校验稳定 key、语义化版本、组件声明、字段、路径、资源和连接定义。
2. WHEN 插件包包含 Skill、MCP、rules、commands、agents 或 hooks THEN System SHALL 只启用 manifest 明确声明且当前 runtime 支持的组件。
3. WHEN 插件包包含不安全路径、私有凭据文件、未声明资源或无效图标 THEN System SHALL 拒绝包或返回明确的验证错误。
4. WHEN 插件包生成 registry THEN System SHALL 以稳定排序和可重复内容生成插件定义，不把连接账号和运行凭据写入 registry。
5. WHEN 插件包使用上游来源文件 THEN System SHALL 记录来源、revision、文件清单和完整性校验信息。

### 需求 2：插件能力按 Skills、MCP 和 Hybrid 清晰分层

**用户故事：** 作为维护者，我希望插件声明的能力和运行位置清楚，以便 Bot 不会获得未声明或错误范围的能力。

#### 验收标准

1. WHEN 插件只有 Skill THEN System SHALL 不创建虚假的 connector 或 MCP namespace。
2. WHEN 插件声明 Remote MCP THEN System SHALL 通过 server 管理 endpoint、认证和账号连接，不把 provider secret 写进 URL。
3. WHEN 插件声明 Packaged MCP THEN System SHALL 在 Bot computer 上启动已打包的独立运行时，并通过受限环境传递配置。
4. WHEN 插件声明 Hybrid THEN Skill 和 connector SHALL 使用明确的配置来源和能力边界，不重复保存同一份 secret。
5. WHEN 子机器人加载插件上下文 THEN System SHALL 按 worker scope 决定是否提供 Skill、connector 或两者。

### 需求 3：插件配置和凭据生命周期可控

**用户故事：** 作为管理员，我希望插件配置可以保存、轮换、清理和回滚，以便 provider 凭据不会因为插件升级而失控。

#### 验收标准

1. WHEN 用户安装插件 THEN System SHALL 按字段定义校验必填项、类型、secret 属性和环境变量名称。
2. WHEN 用户替换 secret 或 runtime field THEN System SHALL 只更新指定字段，不回显其他字段，不清空无关配置。
3. WHEN 插件更新删除字段或环境变量 THEN System SHALL 清理不再声明的运行值，并保留仍兼容的值。
4. WHEN 用户卸载插件 THEN System SHALL 删除插件拥有的运行值、连接账号、Skill 缓存和运行时，但不得删除其他插件或用户文件。
5. WHEN 插件更新失败或回滚 THEN System SHALL 恢复到一个完整可运行的包版本和兼容配置状态。
6. WHEN 插件配置出现在公开设置接口 THEN System SHALL 只返回非敏感值和 Saved/Not set 状态。

### 需求 4：Runtime field 可以安全传递给 Bot computer

**用户故事：** 作为插件作者，我希望 server URL、邮箱、API Key 和主密码都能以合适的方式进入插件进程，以便不在 Skill 或包文件里写配置。

#### 验收标准

1. WHEN 字段声明 `environment` 且类型为 string THEN SDK SHALL 支持普通字段和 secret 字段。
2. WHEN runtime field 被保存 THEN System SHALL 使用现有受保护的插件 owner key，不新增重复凭据表。
3. WHEN Bot 执行 Shell 或受支持的运行时组件 THEN System SHALL 注入当前插件声明的 runtime fields。
4. WHEN Shell、Read、MCP stderr 或运行时结果包含 secret THEN System SHALL 使用流式脱敏处理跨 chunk 和 UTF-8 值。
5. WHEN 两个插件声明相同的环境变量名 THEN System SHALL 拒绝冲突安装或更新。
6. WHEN 普通 runtime field 与 secret field 同时存在 THEN System SHALL 只把 secret field 作为敏感值处理，不把普通值写入公开 Bot prompt。

### 需求 5：Bot 和 worker 的插件能力范围明确

**用户故事：** 作为系统维护者，我希望不同类型的 Bot worker 使用正确的插件能力，以便凭据和外部工具不会被无意扩大范围。

#### 验收标准

1. WHEN Skill 声明 `agents` THEN System SHALL 只将 Skill 注入列出的 worker 类型。
2. WHEN 主 Bot 调用 connector THEN System SHALL 使用当前 Bot 的连接账号和 namespace，不使用另一个 Bot 的隐式账号。
3. WHEN `computerUse` 需要完成网页登录 THEN System SHALL 允许其使用声明给 `computerUse` 的 Skill 和现有浏览器工具。
4. WHEN worker 是 read-only plugin agent THEN System SHALL 禁止其调用不符合只读策略的工具。
5. WHEN 插件无法为某个 worker 提供能力 THEN System SHALL 返回明确的 unavailable 状态，不通过隐藏环境变量绕过 scope。

### 需求 6：插件工具和 Skill 遵守安全边界

**用户故事：** 作为用户，我希望插件只执行我请求的外部动作，以便安装插件不会自动扩大 Bot 的行为范围。

#### 验收标准

1. WHEN connector 声明工具 THEN 每个工具 SHALL 具有 `read`、`write` 或 `destructive` 风险和可验证 input schema。
2. WHEN Skill-only 插件需要调用 CLI THEN SHALL 通过受限包装层提供允许动作，不得把任意 provider CLI 透传给 Bot。
3. WHEN 插件需要读取凭据 THEN SHALL 只返回完成当前任务所需的字段，不自动导出完整 Vault 或完整账号数据。
4. WHEN provider 返回外部内容 THEN System SHALL 将其当作不可信数据，不允许其改写 Contract、系统提示或插件配置。
5. WHEN plugin secret、provider token 或 credential value 出现在日志、错误、活动和测试输出 THEN System SHALL 脱敏或拒绝记录。
6. WHEN 写操作需要用户确认 THEN 插件 SHALL 使用现有确认、人工接管或 connector action 机制，不在 Skill 文本中伪造已完成。

### 需求 7：自托管和外部 provider 兼容性可验证

**用户故事：** 作为自托管服务用户，我希望插件从 Bot computer 的真实网络环境访问 provider，并且明确哪些版本组合受支持。

#### 验收标准

1. WHEN 插件配置自托管 URL THEN System SHALL 从 Bot computer 的 DNS、路由和 TLS 视角验证 provider。
2. WHEN provider 版本、CLI 版本或 API schema 变化 THEN 子 Spec SHALL 记录固定版本、兼容性矩阵和失败原因。
3. WHEN provider 不可达、TLS 不可信、认证失败或返回未知 schema THEN System SHALL 返回稳定错误类别，不自动降级到不安全路径。
4. WHEN provider 通过反向代理或内网域名提供服务 THEN 插件 SHALL 使用经过验证的 root URL 和标准证书校验。
5. WHEN provider 兼容性无法确认 THEN System SHALL 标记 PENDING 或 BLOCKED，不把未执行的验证标成 PASS。

### 需求 8：插件生命周期和账号路由保持一致

**用户故事：** 作为用户，我希望插件更新和账号管理不会破坏已连接账号，也不会把一个账号的请求发到另一个账号。

#### 验收标准

1. WHEN 插件支持多账号 THEN 每个账号 SHALL 具有独立 alias、namespace、credentials、状态和工具快照。
2. WHEN 插件只支持一个全局 Skills 配置 THEN 文档 SHALL 明确所有 Bot 共享该配置，不伪装成多账号。
3. WHEN 账号被重命名 THEN 稳定连接 ID SHALL 保持不变，namespace 变化必须可解释。
4. WHEN 账号被删除 THEN 其 credentials 和运行状态 SHALL 被清理，其他账号和插件安装保持可用。
5. WHEN 插件包升级 THEN 兼容账号 SHALL 保留 credentials；不兼容变化 SHALL 进入更新、重连或回滚流程。

### 需求 9：插件可测试、可观测和可发布

**用户故事：** 作为维护者，我希望每个插件都有足够的测试和发布证据，以便升级不会依赖人工猜测。

#### 验收标准

1. WHEN 插件提交 THEN SHALL 至少有 manifest/package 测试、核心 runtime 测试和 provider 错误测试。
2. WHEN 插件使用 CLI、上游文件或远程服务 THEN SHALL 有版本、完整性、来源或 fixture 验证记录。
3. WHEN 插件生命周期发生安装、连接、更新、回滚、错误或卸载 THEN System SHALL 产生不含 secret 的活动和诊断摘要。
4. WHEN 插件升级 THEN SHALL 能执行旧版本账号、配置、Skill cache 和工具快照的兼容回放。
5. WHEN 插件发布 THEN SHALL 记录实现提交、包版本、测试命令、兼容性矩阵、已知限制和回滚方式。
6. WHEN 插件测试依赖真实账号或服务 THEN SHALL 使用专用账号、最小权限和不含真实 secret 的输出。

### 需求 10：子规格可以独立实施并回填父规格

**用户故事：** 作为项目负责人，我希望每个具体插件扩展都能独立接手和验收，以便总规格不会成为不可执行的愿景文档。

#### 验收标准

1. WHEN 创建 `005.x` 子规格 THEN SHALL 包含需求、设计、任务、补充文档目录和父规格链接。
2. WHEN 子规格声明跨插件共享代码变化 THEN SHALL 指向本父规格的具体设计章节，并说明兼容影响。
3. WHEN 子规格完成 THEN SHALL 回写父规格的子规格状态、验证证据、已知限制和后续风险。
4. WHEN 子规格 BLOCKED 或 CANCELLED THEN 父规格 SHALL 保持可复核状态，并记录阻塞或取消原因。
5. WHEN 所有当前子规格完成 THEN 父规格 SHALL 通过共同验收场景和插件回归测试后才能标记 DONE。

## 非功能需求

### 非功能需求 1：兼容性

1. 现有 1Password、Gmail、Google、Slack、Plaid 和其他已安装插件的生命周期不得因通用插件扩展而破坏。
2. 插件包升级必须保留兼容账号和可回滚版本，除非子规格明确声明破坏性迁移。
3. 新增普通 runtime field 不得改变现有 secret field 的存储、注入和脱敏行为。

### 非功能需求 2：安全

1. 插件包、registry、Skill 文本、测试 fixture、活动日志和公开 API 不得包含真实凭据。
2. Secret 只在完成用户请求的最短运行链路中可用，并在进程、临时文件和错误路径中清理。
3. Provider 内容始终作为不可信输入处理，不得改变系统指令、Contract、插件 manifest 或用户授权范围。
4. 插件能力不能因为一个 Bot 的连接配置而自动授予另一个 Bot 或其他 worker。

### 非功能需求 3：可靠性

1. 安装、更新、回滚和卸载必须具备幂等行为或明确的失败恢复路径。
2. CLI 安装和包缓存必须使用原子写入和完整性校验。
3. 取消或超时必须回收插件子进程和连接运行时。
4. provider 失败不得返回未验证的旧凭据或伪造成功状态。

### 非功能需求 4：可维护性

1. 新增插件 provider 不得要求修改无关插件的核心逻辑。
2. 共享生命周期、配置和脱敏能力必须位于 SDK/server/runtime；provider 特殊处理位于插件包或明确 adapter。
3. 每个子规格必须保持需求、设计、任务和验证一一追踪。
4. 插件文档必须让没有对话上下文的接手者能够完成安装、测试、诊断和回滚。

## 成功定义

- 插件包契约、Skill/MCP/Hybrid 分层、runtime field、生命周期和安全边界都有稳定设计。
- 现有插件回归通过，新增普通 runtime field 不破坏 1Password secret field 行为。
- `005.1` 完成 Bitwarden/Vaultwarden 凭据插件的安装、读取、浏览器登录和兼容性验收。
- 后续插件可以复用相同的 package、配置、运行时、测试和发布流程。
- 父规格可以从子规格任务和验证证据追踪到最终插件能力，而不是依赖口头说明。
