# Spec 005：插件扩展体系

规格编号：`005`

状态：草案

日期：2026 年 11 月 12 日。

本 Spec 是 OpenTeam 插件扩展能力的总规格，统一定义插件包、Skills、MCP connector、Bot runtime、插件配置、凭据传递、账号生命周期、版本兼容和发布验收的共同边界。

现有 `packages/plugins/1password` 已经证明插件可以通过 Skill、Shell 和插件环境变量为 Bot 提供直接凭据读取能力。后续 Bitwarden/Vaultwarden、其他密码管理器、企业内网服务和自托管工具都应在同一套插件模型下扩展，而不是各自建立独立的配置、凭据和运行时通道。

## 子规格

- `005.1`：[Bitwarden 与 Vaultwarden 凭据插件接入](../005.1-Bitwarden与Vaultwarden凭据插件接入/README.md)：第一个凭据类插件扩展，支持 Bitwarden Cloud 和本地 Vaultwarden。
- `005.2`：预留给通用插件账号、连接和运行配置能力的独立扩展。
- `005.3`：预留给插件兼容性、发布、来源校验和跨版本回放的独立扩展。

`005.1` 是本总 Spec 的第一条实施链路。其字段运行时扩展、Skills-only 方案、只读 CLI 包装层和 Vaultwarden 兼容性验收必须遵守本父规格的共同约束。

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)

## 总体决策

插件体系继续建立在当前 OpenTeam Runtime 之上，不创建第二套 Agent Runtime、第二套凭据数据库或独立的插件编排平台。

插件能力按三个层次组织：

1. **Package 层**：负责稳定 key、版本、元数据、组件、资源、setup fields 和来源校验。
2. **Runtime 层**：负责 Skill、MCP、Bot computer、desktop runtime、Shell、浏览器和子机器人之间的能力传递。
3. **Provider 层**：负责具体第三方服务、CLI、API、OAuth、Vault、网络和版本兼容。

Provider-specific 逻辑只能位于插件包或明确的 runtime adapter 中；通用插件生命周期、环境字段、缓存、错误和安全行为必须由共享 SDK、server 和 runtime 提供。

## 可实施边界

本总 Spec 覆盖：

- 现有 Skills-only、Remote MCP、Packaged MCP 和 Hybrid 插件的共同契约。
- 插件包发现、解析、生成、安装、更新、回滚、卸载和缓存同步。
- setup field、secret field 和 plugin runtime field 的定义与安全传递。
- 主 Bot、executor、knowledgeWork、computerUse 等 worker 的 Skill 与 connector 能力边界。
- 插件账号、连接 namespace、工具风险、错误分类和公开配置视图。
- 凭据类插件的直接读取、浏览器使用、脱敏、只读边界和外部服务兼容性。
- 插件测试、来源固定、CLI 完整性校验、文档和发布验收。

本总 Spec 不要求一次性实现所有插件类型。每个子规格必须声明自己覆盖的组件和退出条件。

## 全局原则

- 插件包是声明式入口，实际用户值和账号凭据永远不进入插件包、registry 或 Git。
- 公开配置视图只返回字段定义、非敏感配置和已配置状态，不返回 secret。
- 每个插件必须清楚声明能力属于主 Bot、哪个 worker 或哪个 runtime。
- 插件工具必须声明 `read`、`write` 或 `destructive` 风险，Skill-only 插件也必须通过包装层限制动作范围。
- 自托管服务必须以运行 Bot computer 的网络视角验证，不以用户桌面可访问作为充分条件。
- 兼容性必须有固定版本、真实或隔离 fixture、失败分类和回滚依据。
- 子规格只能扩展本总 Spec 没有覆盖的具体 provider 行为，不得复制一套插件生命周期。
