# 需求文档 - 钉钉个人工作区插件

状态：IN_PROGRESS

## 简介

当前 OutcomeGo 已具备插件目录、技能插件和 Bot Computer 执行能力，但没有针对钉钉个人用户的工作区插件。用户希望在不取得企业级共享凭据的前提下，通过自己的钉钉授权远程查看和处理三类资源：

1. 查看和处理自己的待办；
2. 查看并回复消息，包括待办提醒等应用消息；
3. 查看和编辑自己有权限的钉钉 Drive 文档。

DingTalk Workspace CLI 已经提供个人 OAuth 登录、待办、聊天、事件、Drive 和文档命令。本 Spec 将其作为外部 CLI 集成到 OutcomeGo 的 skills-only 插件体系中，避免在 OutcomeGo 内重复实现钉钉 API、令牌刷新和产品命令映射。

## 术语表

- **System**：OutcomeGo。
- **DWS**：DingTalk Workspace CLI，命令名为 `dws`。
- **个人授权**：当前用户通过 DWS OAuth 设备流登录后取得的用户身份和令牌。
- **Bot Computer**：运行技能命令、保存本机 CLI 登录状态并访问外部网络的计算机运行时。
- **钉钉资源**：待办、即时消息、DingTalk Drive 文件以及钉钉在线文档。
- **受控写入**：发送消息、完成/更新待办、编辑文档等会改变外部数据的操作，必须遵循 DWS 技能中的目标确认、幂等和 dry-run 规则。

## 范围说明

### In Scope

- 在 `packages/plugins` 中新增钉钉个人工作区 skills-only 插件。
- 固定并安装官方 `dws` CLI `v1.0.68`，支持 macOS 和 Linux 的常用架构。
- 提供钉钉个人 OAuth 扫码登录、状态检查、重新登录和故障排查指引。
- 提供当前 Computer 的只读登录状态命令、portable auth bundle 导出/导入、退出登录和一次性受控文件迁移流程。
- 提供待办查询、创建、更新、完成和事件监听能力。
- 提供消息查询、消息发送、回复和个人 IM 事件监听能力。
- 提供 Drive 搜索/列表、文档读取、文档块或正文更新等能力。
- 生成插件目录并通过仓库现有插件校验、类型检查和测试。
- 在有真实钉钉账号授权时执行只读烟测，并对写入动作使用明确的测试目标。

### Out of Scope

- 在 OutcomeGo Server 中重新实现 DingTalk OpenAPI 客户端。
- 把钉钉个人令牌、AppSecret、Refresh Token 或真实业务数据提交到 Git。
- 读取用户无权访问的消息、待办或文档。
- 把全量 DWS 产品技能全部暴露为本插件的业务范围；本插件优先覆盖待办、聊天、事件、Drive 和文档。
- 启动 OutcomeGo 开发服务器或远程重建 Debug Computer。

## 需求

### 需求 1：插件安装和个人授权

**用户故事：** 作为普通钉钉用户，我希望安装插件后通过钉钉扫码完成个人授权，以便 Bot 使用我的钉钉资源。

#### 验收标准

1. WHEN 插件安装到 OutcomeGo THEN System SHALL 在插件目录中显示钉钉个人工作区插件及其安装说明。
2. WHEN Bot Computer 执行初始化技能 THEN System SHALL 安装指定版本的 `dws`，并在安装后验证版本和 SHA-256。
3. WHEN 用户执行个人登录 THEN System SHALL 调用 DWS OAuth 设备流并提示用户使用钉钉扫码授权。
4. WHEN 登录状态不存在、过期或失效 THEN System SHALL 明确提示重新登录，不得伪造已连接状态。
5. WHEN 处理凭据或命令输出 THEN System SHALL 不把 AppSecret、Access Token、Refresh Token 或完整授权包写入仓库或普通日志。
6. WHEN 用户请求查看登录状态 THEN System SHALL 在选定的 Computer 上执行只读状态命令并明确 Computer 范围。
7. WHEN 用户迁移登录态 THEN System SHALL 只通过受控文件传输交付 portable auth bundle，并在目标 Computer 验证 `authenticated: true` 后删除目标侧一次性 bundle。
8. WHEN 用户请求退出登录 THEN System SHALL 在当前 Computer 执行 DWS logout，并说明其他 Computer 的登录态不受影响。

### 需求 2：待办查看和处理

**用户故事：** 作为钉钉用户，我希望从 OutcomeGo 查看和处理自己的待办，以便集中管理工作事项。

#### 验收标准

1. WHEN 用户请求待办列表 THEN System SHALL 调用 DWS 待办查询命令并返回可读的标题、状态、截止时间和角色信息。
2. WHEN 用户请求完成、更新或删除待办 THEN System SHALL 在真实写入前确认目标待办和动作，调用对应 DWS 写命令，并报告真实结果。
3. WHEN 用户请求创建个人待办 THEN System SHALL 使用当前个人授权身份创建，并在结果中返回 DingTalk 任务标识。
4. WHEN DingTalk 未返回某些手工创建的个人待办 THEN System SHALL 如实报告 API 覆盖范围，不把部分列表声称为完整列表。
5. WHEN 待办事件监听运行 THEN System SHALL 能识别当前用户相关的创建、更新和删除事件。

### 需求 3：消息查看和回复

**用户故事：** 作为钉钉用户，我希望查看相关聊天或应用消息并回复，以便处理待办提醒和工作沟通。

#### 验收标准

1. WHEN 用户指定单聊、群聊、发送者或时间范围 THEN System SHALL 查询对应消息并保留会话和消息标识。
2. WHEN 用户请求回复消息 THEN System SHALL 使用原消息的会话标识和引用上下文发送回复。
3. WHEN 用户请求发送个人消息、应用消息或机器人消息 THEN System SHALL 明确发送身份和目标，不能静默切换身份。
4. WHEN 用户订阅个人 IM 事件 THEN System SHALL 能接收支持范围内的消息、已读、撤回和表情事件。
5. WHEN 发送目标不唯一、权限不足或结果未知 THEN System SHALL 停止盲目重试，并报告需要确认或恢复的信息。

### 需求 4：Drive 文档查看和编辑

**用户故事：** 作为钉钉用户，我希望搜索、查看和编辑自己有权限的 Drive 文档，以便在远程工作流中维护资料。

#### 验收标准

1. WHEN 用户搜索或列出 Drive 内容 THEN System SHALL 返回文档/文件名称、类型、标识和可继续操作的引用。
2. WHEN 用户读取在线文档 THEN System SHALL 返回可读正文或块结构，并保留文档标识。
3. WHEN 用户请求编辑文档 THEN System SHALL 优先使用块级或指定段落更新，写入前说明目标文档和修改范围。
4. WHEN 用户请求上传、下载、重命名或权限相关操作 THEN System SHALL 遵循 DWS 对目标和覆盖行为的安全规则。
5. WHEN 当前用户没有文档编辑权限 THEN System SHALL 报告实际权限错误，不尝试绕过钉钉权限。

### 需求 5：插件可维护性和验证

**用户故事：** 作为项目维护者，我希望插件版本、上游 CLI、技能文件和验证证据可追踪，以便后续升级和排障。

#### 验收标准

1. WHEN DWS CLI 版本升级 THEN System SHALL 能在单一版本常量和校验清单中更新下载地址、哈希和文档。
2. WHEN 生成插件目录 THEN System SHALL 通过现有 `packages/plugins` 生成器和插件目录校验。
3. WHEN 没有真实钉钉凭据 THEN System SHALL 仍能完成结构、安装器、技能引用和模拟命令测试。
4. WHEN 有真实钉钉凭据 THEN System SHALL 记录只读烟测结果和写入测试边界，不记录令牌或业务内容。
5. WHEN 插件仍为 skills-only THEN System SHALL 不伪造 OutcomeGo account/connection 状态；Marketplace account card 属于后续 local CLI connection 扩展范围。

## 非功能需求

### 非功能需求 1：安全

1. WHEN 保存 CLI 登录状态 THEN System SHALL 使用 DWS 自己的本机安全存储，不把凭据复制到 OutcomeGo 配置或仓库。
2. WHEN 运行命令输出结果 THEN System SHALL 遵循 DWS 的脱敏和日志约束。
3. WHEN 执行发送、编辑、删除等写入操作 THEN System SHALL 采用确认、dry-run 或等价的受控操作流程。
4. WHEN 处理 portable auth bundle THEN System SHALL 将其视为敏感凭据材料，不读取内容、不写入聊天或仓库，并限制导入文件位于 Computer workspace。

### 非功能需求 2：可靠性

1. WHEN DWS 未安装、网络不可用或登录失效 THEN System SHALL 返回可定位的错误和恢复命令。
2. WHEN DWS 命令或企业网关未开放某项能力 THEN System SHALL 报告命令不可用，不把文档中的命令当成已验证能力。
3. WHEN 写操作返回结果未知 THEN System SHALL 保留原始结果上下文，禁止未经确认的重复写入。

### 非功能需求 3：可维护性

1. WHEN 新增钉钉产品能力 THEN System SHALL 通过 DWS 上游技能引用和插件技能入口扩展，不复制 API 客户端。
2. WHEN 上游技能文档升级 THEN System SHALL 记录上游版本或提交，避免无来源的本地命令说明。
3. WHEN 项目需要安装插件 THEN System SHALL 只生成可移植的插件文件，不依赖仓库外的未声明路径。

## 成功定义

- 本地可验证 `dws v1.0.68` 安装、校验和版本检查。
- 插件被生成器发现，插件目录和 TypeScript 检查通过。
- Bot Computer 技能可以指导用户扫码登录，并能调用待办、消息、Drive/文档命令。
- 至少完成一组真实只读钉钉烟测；写入能力使用用户明确指定的测试目标后再验收。
- 需求、设计、任务和验证证据可以逐项追踪。
