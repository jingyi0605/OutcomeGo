# 钉钉个人工作区

这个插件把官方开源的 [DingTalk Workspace CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) 接入 OutcomeGo。插件使用当前用户的 OAuth 身份；组织仍须先在钉钉开发者后台启用 CLI 访问。Bot 可在服务端授权范围内操作：

| 能力 | 入口 |
| --- | --- |
| 待办 | `dws todo` |
| 消息和个人 IM 事件 | `dws chat`、`dws event` |
| Drive 文件和文档搜索 | `dws drive` |
| 钉钉文档读取和编辑 | `dws doc` |

安装插件后，Marketplace 详情页可以在选定的 Bot Computer 上安装、升级和检查 DWS，并启动浏览器授权流程。页面会通过 DWS 的只读 `upgrade --check --format json` 在线检查最新稳定版本，仅在确有新版本时显示升级按钮。页面只显示 Computer-side 返回的版本、账号和连接状态；钉钉登录态不会复制到服务器。

插件采用 skills-only 形态。插件目录分发两项技能，不提供 MCP 工具、OutcomeGo「账号」条目、聊天渠道或自动提醒推送。DWS 二进制和登录状态留在选定计算机上，OutcomeGo 数据库不另外保存钉钉令牌。同一计算机上启用该技能的其他 Bot 可使用此登录；换 Computer 时可以通过 DWS portable auth bundle 迁移。

详情页的使用示例只会关闭 Marketplace 并将可编辑提示词填入主 Bot 对话框，不会自动发送。示例覆盖待办汇总、审批盘点、文档搜索、最小范围文档修改、文档导出和从文档提取行动项。

待办查询使用 `todo +get-my-tasks --status false --all --max-pages 40 --size 20` 并以 `data.complete` 判断是否完整；每条待办的回复都必须包含内容简述。识别到 `certify_todo` 审批待办后，必须通过 OA 实例详情选择当前用户的 `taskId`，先 dry-run 再提交，并用 OA 待处理列表和未完成待办列表双重验证结果。

## 使用方式

安装插件后，先让 Bot 执行 `dingtalk-setup` Skill。Skill 会：

1. 根据 Bot Computer 的系统和架构下载固定版本 `v1.0.68`；
2. 校验官方 SHA-256；
3. 在远程 Computer 执行 `dws auth login --device --no-browser`；
4. 给用户显示官方 verification URL 和短期用户码，在用户自己的设备上完成扫码或授权；
5. 使用 `dws auth status` 和只读命令验证当前身份。

完成授权后，使用 `dingtalk-workspace` Skill 处理待办、消息、Drive 和文档。发送、回复、完成、编辑等操作须有用户针对目标和内容的明确授权，并遵循当前命令的 dry-run、确认和结果验证契约。应用提醒未必有可回复会话；处理待办仍须调用对应待办动作。

如果授权时发现组织尚未开启 CLI 访问个人数据，Marketplace 会显示原因、管理员处理路径和官方开通指南按钮；管理员在开发者平台的 CLI 访问管理中开启后，重新执行授权即可。

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
