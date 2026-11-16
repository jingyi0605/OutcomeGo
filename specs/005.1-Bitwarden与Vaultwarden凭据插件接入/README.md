# Spec 005.1：Bitwarden 与 Vaultwarden 凭据插件接入

规格编号：`005.1`

状态：实施中（2026-11-16 多实例演进修订）

日期：2026 年 11 月 12 日（修订：2026 年 11 月 16 日）。

父规格：[Spec 005：插件扩展体系](../005-插件扩展体系/README.md)

本 Spec 为 OpenTeam 增加 Bitwarden 凭据插件，并以 Bitwarden CLI 兼容方式支持本地部署的 Vaultwarden。插件采用受控多实例配置与 Skills 读取模型，允许管理员配置多个 Bitwarden / Vaultwarden 实例，只有通过 Bot computer 容器上的真实 `bw.sh status`（`login + unlock + sync`）校验后实例才显示为「已连接」，并让 Bot 和 `computerUse` 子机器人能够在需要登录网站时跨已连接实例查找用户名、密码和一次性验证码。

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)

## 决策

采用“多实例连接记录（`PluginConnection`）+ Skills + 受限 CLI 包装脚本 + 服务端读写闸门”的实现：复用平台实例管理、状态展示与连接检查语义，但不把 Vault 内容复制到 OpenTeam 数据库，不向模型暴露任意 MCP 工具或原始 Vault 写操作，也不在普通进程环境中暴露任何 `BW_*` 配置。

选择这个边界有四个原因：

1. 当前 1Password 已经证明 Skills、Computer 私有执行路径与浏览器安全填充可以组成完整的登录链路。
2. `computerUse` 子机器人不会直接继承父 Bot 的 connector 工具，但可以接收同一插件 Skill 并使用受控 first-party 工具，因此保留 Skills 读取路径与服务端闸门能够保持主 Bot 与 `computerUse` 的一致性。
3. 管理员可能同时使用多个 Bitwarden Cloud 账号或自托管 Vaultwarden 服务。将每个 Bitwarden 配置建模为独立插件实例（`PluginConnection`），可以在插件市场直接展示每个实例的名称（默认为账户邮箱，重复邮箱支持别名）与真实连通状态（「已连接」）。
4. Vaultwarden 没有与 1Password Service Account 完全等价的只读服务账户模型。必须把只读边界放在受限包装脚本、服务端授权闸门、专用 Vaultwarden 用户和 Collection 权限上，并明确这不是主机级强制沙箱。

为支持多实例与既有单实例升级，本 Spec 保留单实例字段安全基线（`BW_*` 字段受保护、主密码保留前后空白、不进入公开视图或普通 Shell），同时将实例配置持久化至各自 `PluginConnection`（`configuration` / `credentials`），并在升级时自动把已保存的 `plugin:bitwarden` 单实例配置迁移为第一个实例。

## 可实施边界

本阶段实现以下完整主链路：

1. Marketplace 可以发现、安装、配置和卸载 `bitwarden` 插件。
2. 用户可以添加、编辑、重命名和移除多个 Bitwarden Cloud 或 Vaultwarden 实例，每个实例独立配置 5 个字段（Server URL、账户邮箱、个人 API 客户端 ID、个人 API 客户端密钥、主密码）。
3. 实例保存配置后，必须由服务端调度 Bot computer 容器实际执行 `bw.sh status`（完成 server 配置、API Key 登录、邮箱核对、主密码解锁与同步）；只有检查通过，实例才显示为「已连接」，实例名称默认更新为账户邮箱（重复邮箱支持设置或自动区分别名）。
4. 插件使用固定版本且可校验完整性的 Bitwarden CLI。
5. Bot 调用 `SearchBitwardenItems` 时自动搜索所有状态为「已连接」的实例，并在结果与审批卡片中显示来源实例名称（邮箱或别名）。
6. Bot 可以在用户通过聊天审批卡片选择并授权后，从对应实例读取 username、password 和 TOTP，并把值用于用户请求的登录任务（通过 `browserReference` 仅进入 Computer 短时环境与浏览器私有填充路径）。
7. `computerUse` 可以复用 Skill 完成网页登录和验证码填充。
8. 插件的可用命令只提供读取操作，不提供创建、更新、删除、移动或共享 Vault 项目操作。
9. 插件可以报告配置缺失、网络不可达、TLS、登录、解锁、同步、匹配和字段读取错误，并将失败状态体现在对应实例上。
10. 已存在单全局 `plugin:bitwarden` 配置的环境在升级后自动迁移为第一个实例（待通过 `bw.sh status` 验证后标记为「已连接」）。
11. 相关测试、文档和 Vaultwarden 兼容性验收脚本齐全。

## 明确不做

- 不实现 Vault 项目创建、更新、删除、移动、共享、组织成员管理或权限修改。
- 不主动创建凭据日志；CLI 必需的 token 和加密 Vault 使用短期私有目录并清理。
- 不引入新的 Vault 数据库、缓存表或 OpenTeam 内部凭据模型。
- 不承诺对 Vaultwarden 所有历史版本和所有未来 Bitwarden CLI 版本自动兼容。
- 不绕过 TLS 证书校验，不支持通过关闭证书校验解决内网证书问题。
- 不向模型暴露通用 MCP 工具或把 Bitwarden CLI 的任意命令暴露为 Bot 的通用 Shell 能力。
- 不在未经过真实 `bw.sh` 连接检查前把已保存配置的实例直接伪报为「已连接」。

复核结论与实施基线见 [20261113-规格复核与覆盖矩阵](docs/20261113-规格复核与覆盖矩阵.md) 和 [设计 §8.2](design.md#82-已确定基线与外部验收)。
