---
name: dingtalk-setup
description: 在当前 Bot Computer 安装固定版本的 DingTalk Workspace CLI，完成个人 OAuth 登录、状态检查、登录态导入导出、退出登录和故障排查。
---

# 钉钉个人工作区初始化

这个 Skill 负责准备当前 Bot Computer 上的 `dws` 命令和钉钉个人授权。业务操作请转到相邻的 [dingtalk-workspace](../dingtalk-workspace/SKILL.md)。登录态属于选定的 Bot Computer；同一台 Computer 上启用此 Skill 的 Bot 可以使用它，换 Computer 需要重新登录或导入可迁移认证包。插件仍是 skills-only，不提供 OutcomeGo「账号」条目。

## 初始化顺序

1. 在当前 Bot Computer 执行：

   ```bash
   bash <this-skill>/scripts/ensure-dws.sh --install
   ```

2. 以下所有命令都通过同一包装脚本执行，不依赖 PATH。安装脚本只向 stdout 输出固定二进制的绝对路径；不改动全局 `dws` 或 shell 配置。包装入口为：

   ```bash
   bash <this-skill>/scripts/dws.sh --version
   ```

   目标版本是 `v1.0.68`。默认存放在 `$HOME/.local/share/outcomego/dws/v1.0.68/`。Bot Computer 的 HOME 不可写时使用持久 `/workspace`，包装脚本同时设置 DWS 配置和凭据目录。`OUTCOMEGO_DWS_CLI_DIR` 可指定绝对安装目录；全部命令须使用相同环境。

   Marketplace 的 “Install DWS” 和 “Upgrade DWS” 运行在选定 Bot Computer 上；升级使用 DWS 官方更新器并跳过上游 Skills 覆盖，只保留本插件维护的 Skills。

3. 检查当前 Computer 的授权状态。优先使用插件提供的 Computer-side 状态入口：

   ```bash
   bash <this-skill>/scripts/dws-status.sh
   ```

   Marketplace 页面显示的 DWS 版本和连接状态来自同一个 Computer-side 状态检查；状态检查同时调用只读 `dws upgrade --check --format json` 查询最新稳定版本，仅在 `needs_upgrade` 为 `true` 时显示升级按钮。不能用服务器保存的登录信息代替。

   该命令只读本机状态，不刷新令牌、不迁移 Keychain，也不访问业务资源。需要确认刷新令牌仍可用时，才使用：

   ```bash
   bash <this-skill>/scripts/dws.sh auth status --format json
   ```

4. 如果当前 Computer 未登录，执行：

   ```bash
   bash <this-skill>/scripts/dws.sh auth login --device --no-browser
   ```

   给用户显示这次命令返回的官方 verification URL 和短期用户码，让用户在自己的设备上打开并扫码/确认；不要发送内部 device code、Access Token 或 Refresh Token。保持登录进程直到授权完成、取消或过期。本地有人使用浏览器时也可用不带 `--device` 的 loopback 登录，它会临时监听 `127.0.0.1`；远程容器必须使用设备流。国际版或 `.io` 账号才追加 `--intl`。

   组织必须在钉钉开发者后台开通 CLI 访问；若尚未开通，报告实际原因和管理员审批入口，不能把扫码当成绕过企业策略。普通个人授权无需让用户提供企业 AppSecret，也不自动执行 `--recommend` 批量扩大授权。

5. 登录后只运行只读验证：

   ```bash
   bash <this-skill>/scripts/dws.sh auth status --format json
   bash <this-skill>/scripts/dws.sh contact user get-self --format json
   ```

6. 如果需要把已登录状态迁移到另一台 Linux Computer，使用一次性认证包。先在已登录的源 Computer 导出：

   ```bash
   bash <this-skill>/scripts/dws-auth-export.sh /workspace/uploads/dws-auth.tar.gz
   ```

   只把这个文件通过受控文件传输交给目标 Computer。用户计算机上的文件使用 `CopyToBox` 复制到目标 Bot Computer 的 `/workspace/uploads/`；不要把认证包粘贴到聊天，也不要读取、预览或发送其内容。目标 Computer 导入并验证：

   ```bash
   bash <this-skill>/scripts/dws-auth-import.sh /workspace/uploads/dws-auth.tar.gz
   ```

   如果目标已有登录态且用户明确要求覆盖，才加 `--force`。导入成功并确认 `authenticated: true` 后，脚本删除目标 Computer 上的这份一次性 bundle；源文件和传输缓存也必须由用户按自己的安全策略删除。

   DWS 的 portable auth bundle 适用于支持的文件凭据后端，Linux 是本插件的默认迁移场景。macOS 系统 Keychain 模式和 Windows 后端可能拒绝 portable export/import；保留 DWS 的实际错误，不自动关闭 Keychain 或重置登录。

7. 需要退出当前 Computer 的登录态时：

   ```bash
   bash <this-skill>/scripts/dws-logout.sh
   ```

   默认退出本机全部组织账号；用户指定组织或账号时，将同一 `--profile` 原样传给脚本。`auth reset` 会清除更多本地凭据，只有用户明确要求丢弃全部登录态时才使用。

8. 验证成功后，再根据用户目标运行 `dws todo`、`dws chat`、`dws drive` 或 `dws doc` 的只读命令。

## 凭据边界

- 不要把 Access Token、Refresh Token、AppSecret 或本机 DWS 配置复制到聊天、仓库或普通日志。用户完成授权所需的 verification URL/短期用户码只展示给当前用户，不写入持久文档。
- 认证导出包包含加密凭据材料，按 secret 处理；不要读取其内容、打印 base64、上传到普通附件、提交 Git 或放入插件 manifest。只允许通过明确的 Computer 文件传输进入目标 Computer。
- `dws auth status` 是登录状态的唯一依据；命令失败时不能声称授权成功。
- DWS 的 profile 和令牌由 DWS 保存在当前 Bot Computer。远程刷新可能让另一台设备的 Refresh Token 失效，按 DWS 的错误提示重新登录。

## 常见恢复

- 未找到固定 CLI：重新运行 `ensure-dws.sh --install`，并使用包装脚本。
- 安装脚本拒绝现有非目标版本：保留该文件，检查安装目录，不静默覆盖其他安装。
- `auth status --readonly` 的 `reason` 非空：本地状态可能需要修复；使用同一 profile 的普通 `auth status`，不要把不确定读取当成退出登录。
- `未登录`：重新运行 `dws auth login`。
- `AUTH_TOKEN_EXPIRED`、`USER_TOKEN_ILLEGAL` 或令牌验证失败：重新运行 `dws auth login`。
- `dws auth import` 报已有登录态：只有用户明确要求覆盖时才使用 `dws-auth-import.sh --force`。
- portable export/import 被平台拒绝：报告 DWS 原因；Linux 文件凭据后端是默认迁移目标，macOS/Windows 遵循 DWS 的平台限制。
- 产品命令 `unknown command`：先运行对应叶子命令的 `--help` 或 schema；不要猜测同义命令。
- 业务命令权限不足：保留错误信息并说明需要钉钉组织、应用或文档权限。
