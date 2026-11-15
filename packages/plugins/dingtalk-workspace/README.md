# 钉钉个人工作区

这个插件把官方开源的 [DingTalk Workspace CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) 接入 OutcomeGo。插件使用当前用户的 OAuth 身份；组织仍须先在钉钉开发者后台启用 CLI 访问。Bot 可在服务端授权范围内操作：

| 能力 | 入口 |
| --- | --- |
| 待办 | `dws todo` |
| 消息和个人 IM 事件 | `dws chat`、`dws event` |
| Drive 文件和文档搜索 | `dws drive` |
| 钉钉文档读取和编辑 | `dws doc` |

插件采用 skills-only 形态。插件目录分发两项技能，不提供 MCP 工具、OutcomeGo「账号」条目、聊天渠道或自动提醒推送。Bot 通过现有 Shell 执行 DWS。DWS 二进制和登录状态留在选定计算机上，OutcomeGo 数据库不另外保存钉钉令牌。同一计算机上启用该技能的其他 Bot 可使用此登录；换 Computer 时可以通过 DWS portable auth bundle 迁移。

## 使用方式

安装插件后，先让 Bot 执行 `dingtalk-setup` Skill。Skill 会：

1. 根据 Bot Computer 的系统和架构下载固定版本 `v1.0.68`；
2. 校验官方 SHA-256；
3. 在远程 Computer 执行 `dws auth login --device --no-browser`；
4. 给用户显示官方 verification URL 和短期用户码，在用户自己的设备上完成扫码或授权；
5. 使用 `dws auth status` 和只读命令验证当前身份。

完成授权后，使用 `dingtalk-workspace` Skill 处理待办、消息、Drive 和文档。发送、回复、完成、编辑等操作须有用户针对目标和内容的明确授权，并遵循当前命令的 dry-run、确认和结果验证契约。应用提醒未必有可回复会话；处理待办仍须调用对应待办动作。

当前 Computer 的状态可以通过 `skills/dingtalk-setup/scripts/dws-status.sh` 查询。登录态迁移使用 `dws-auth-export.sh`、`CopyToBox` 和 `dws-auth-import.sh`：认证包只允许一次性传输到目标 Computer，目标脚本在导入并验证 `authenticated: true` 后删除本地 bundle。认证包不得进入聊天、仓库或插件 manifest。

安装器使用版本专属目录，重复安装会复用同版本，不覆盖系统中已有的全局 `dws`。包装入口无需修改 PATH：

```bash
bash <插件目录>/skills/dingtalk-setup/scripts/ensure-dws.sh --install
bash <插件目录>/skills/dingtalk-setup/scripts/dws.sh auth status --readonly --format json
```

默认 CLI 目录为 `$HOME/.local/share/outcomego/dws/v1.0.68`；HOME 不可写的 Linux Bot 使用持久 `/workspace`。包装脚本保持配置与凭据路径一致。DWS 还可能自行初始化官方发行版运行时支持文件，这些文件与二进制同目录，不进入插件包或 Git。

## 运行边界

- CLI 登录状态留在执行 Skill 的 Bot Computer；更换计算机可能需要重新登录。
- 钉钉当前组织、用户权限和 MCP 网关能力决定具体命令是否可用。
- 文档中的命令必须以当前 `dws --help`、叶子帮助或 schema 为准。
- 未授权、命令未开放或资源无权限时，Bot 必须如实报告，不得伪造已连接或绕过权限。
- 远程 Debug Computer 需另外同步并重建后才能运行本次仓库中的插件；本地源码变更不等于已部署。
- 卸载插件只移除技能；CLI、DWS 登录和服务端授权需单独退出或撤销，用户未要求时不自动清理。登录态属于 Computer，插件管理页当前不会显示独立的 DingTalk account card。

## 版本

- DWS CLI：`v1.0.68`
- 上游提交：`ba02fc6cdbdb3543d21d0cdb70f027bf0d142692`
- 本地技能：针对三项需求编写的简要流程，命令参数动态查询固定二进制的 Schema；不分发全部官方产品手册。
- 资产校验：见 [`20261115-上游资产清单.json`](20261115-上游资产清单.json)。
- 许可证：官方 Apache-2.0 的 [`LICENSE`](LICENSE) 和 [`NOTICE`](NOTICE) 保留。
