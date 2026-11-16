# 需求文档 - 云端电脑局域网访问与防火墙策略

状态：IN_PROGRESS

## 简介

beta.17 在云端电脑中启用了更严格的 nftables 出站策略和网络出口验证。该策略把未显式授权的私有地址流量拒绝在容器内，导致配置在 `models.json` 中的局域网模型服务无法访问，进而使所有机器人无法对话。beta.16 虽然已经存在出站隔离，但会立即安装 TUN 默认路由，行为与 beta.17 不同。

本 Spec 为自托管部署提供清晰、可持久化、可观察的局域网策略：默认允许云端电脑访问私有网络地址；用户可以在 Desktop 的“设置 → 服务器”中切换为显式白名单；计算机端自动把模型配置中的私有模型端点加入允许集合；公共网络流量继续使用现有的托管出口。

## 术语表

- **System**：OutcomeGo 服务端、Computer 运行时和 Desktop 客户端组成的网络策略系统。
- **Computer**：运行机器人任务的 Linux Docker 容器。
- **托管出口**：由 `BrowserNetworkService` 选择并通过 TUN/SOCKS 转发的公共 TCP 和 DNS 出口。
- **私有网络地址**：RFC1918、链路本地地址以及部署环境明确标记为 private 的地址；本 Spec 首期使用计算机端 IP 字面量校验。
- **模型端点**：`/home/box/.pi/agent/models.json` 中 provider 的 `baseUrl` 所指向的 HTTP(S) 服务。
- **策略模式**：`lan` 或 `allowlist` 两种私有网络访问模式。

## 范围说明

### In Scope

- 默认允许 Computer 访问私有网络 TCP 目的地，公共流量继续走托管出口。
- 服务端持久化网络策略和 TCP 目的地白名单，并通过 control token 下发给 Computer。
- Desktop“设置 → 服务器”中的独立局域网策略 Modal，支持模式选择、规则新增、编辑、删除和应用状态查看。
- Computer 自动识别并允许 `models.json` 中的私有模型端点，动态更新 nftables 与策略路由。
- beta.17 到新策略的迁移、断线恢复、策略版本冲突和错误提示。

### Out of Scope

- 任意 UDP、ICMP、端口转发、入站连接或修改宿主机防火墙。
- 通过策略编辑器允许公共地址绕过托管出口。
- 通过域名解析任意扩大私有网络允许范围；首期规则使用 IP 字面量。
- 为机器人提供一套可以自行修改防火墙的 Shell 命令。

## 需求

### 需求 1：私有网络策略模式

**用户故事：** 作为自托管部署的所有者，我希望云端 Computer 默认能够访问局域网服务，同时保留收紧策略的选择，以便模型服务和内部工具可以正常工作。

#### 验收标准

1. WHEN 新部署初始化或已有部署升级到支持本 Spec 的版本 THEN System SHALL 默认使用 `lan` 模式。
2. WHEN 策略为 `lan` THEN System SHALL 允许 Computer 访问经过校验的私有 IPv4/IPv6 TCP 目的地，并 SHALL 继续通过托管出口处理公共网络流量。
3. WHEN 策略为 `allowlist` THEN System SHALL 只允许白名单规则和模型端点例外，不得因为 Computer 重启而丢失策略。
4. WHEN 策略更新或 Computer 失去托管出口 THEN System SHALL 保留私有网络规则的明确状态，并 SHALL 不把公共流量静默放行到 Docker underlay。

### 需求 2：服务端策略存储与 Computer 应用

**用户故事：** 作为运维者，我希望策略由服务端持久化并由 Computer 自动应用，以便重启和升级后网络行为一致。

#### 验收标准

1. WHEN 用户保存策略 THEN System SHALL 保存模式、规则、revision 和更新时间，并返回可审计的当前版本。
2. WHEN Computer 启动、策略 revision 变化或模型配置变化 THEN Computer SHALL 重新计算允许集合并原子更新 nftables 集合和策略路由。
3. WHEN Computer 尚未成功应用当前 revision THEN System SHALL 暴露 `pending` 或 `error` 状态和安全错误消息，不得显示为已应用。
4. WHEN 策略配置非法、文件权限异常或 nftables 更新失败 THEN System SHALL 保留上一份有效规则，并记录可定位的错误原因。
5. WHEN Computer 断线重连或容器重启 THEN System SHALL 清理旧规则并重新应用服务端最新策略和当前模型端点。

### 需求 3：模型端点自动例外

**用户故事：** 作为使用自建模型服务的用户，我希望配置在模型设置中的局域网端点自动可达，以便不需要手动复制每个模型地址到防火墙设置。

#### 验收标准

1. WHEN `models.json` 中存在使用 HTTP(S) 和 IP 字面量的私有 `baseUrl` THEN Computer SHALL 将其主机地址和 TCP 端口加入模型端点允许集合。
2. WHEN 模型端点配置被新增、删除、替换或端口改变 THEN Computer SHALL 在下一次轮询内更新规则，并删除已撤销的旧端点。
3. WHEN `baseUrl` 包含凭据、查询参数、片段、非法端口、非 HTTP(S) 协议或公共地址 THEN System SHALL 不将其作为私有模型例外处理。
4. WHEN 策略为 `allowlist` THEN 合法私有模型端点 SHALL 继续可达；公共模型 provider SHALL 继续走托管出口。
5. WHEN 模型端点无法应用 THEN 模型设置和 Computer 网络状态 SHALL 给出可理解的连接失败信息，不得暴露 API key。

### 需求 4：Settings → Server 图形化管理

**用户故事：** 作为服务器所有者，我希望在 Desktop 的“设置 → 服务器”中查看和修改 Computer 的 nftables 策略，以便不需要登录服务器执行命令。

#### 验收标准

1. WHEN 用户打开局域网策略 Modal THEN System SHALL 显示当前策略模式、revision、Computer 应用状态、最后错误和模型端点例外数量。
2. WHEN 用户切换模式 THEN System SHALL 显示模式含义、对公共出口和私有地址的影响，并要求确认会中断现有连接的操作。
3. WHEN 用户新增规则 THEN System SHALL 允许填写 IP 地址、TCP 端口和可选说明，并在保存前校验地址族、端口范围、重复项和私有地址边界。
4. WHEN 用户编辑或删除规则 THEN System SHALL 以当前 revision 提交，遇到 revision 冲突时刷新服务端状态并保留明确提示。
5. WHEN Computer 尚未应用新策略 THEN Modal SHALL 显示 applying/pending 状态；WHEN 应用失败 THEN SHALL 显示错误并保留上一份有效策略。
6. WHEN 用户打开 Modal 或刷新服务器设置 THEN System SHALL 显示服务端持久化状态和 Computer 实际应用状态，不能把草稿当成已生效策略。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 策略或模型配置变化 THEN Computer SHALL 在 2 秒内开始重新计算，并在 5 秒内完成正常 nftables 更新。
2. WHEN 规则数量达到 128 条上限 THEN System SHALL 在 UI 和 API 层拒绝继续新增，并保持已有策略可用。

### 非功能需求 2：可靠性

1. WHEN 策略更新失败 THEN System SHALL 使用上一份有效集合，不得出现“清空后等待”导致公共或私有流量无边界放行的窗口。
2. WHEN Computer 和 Server 暂时断开 THEN Computer SHALL 遵循当前防火墙 fail-closed 行为，重连后重新同步 revision。
3. WHEN 旧版本不认识策略接口 THEN Server SHALL 保持兼容响应并提示需要升级 Computer runtime。

### 非功能需求 3：可维护性

1. WHEN 增加新的私有目的地来源 THEN System SHALL 通过统一的目的地集合编译流程加入，不复制 nftables 更新逻辑。
2. WHEN 问题排查 THEN 日志 SHALL 记录策略 revision、应用结果、规则数量和错误类别，不记录 API key 或 control token。
3. WHEN API 或 UI 结构变化 THEN `requirements.md`、`design.md` 和 `tasks.md` SHALL 保持逐项追踪。

## 成功定义

- 生产 Computer 在 `lan` 模式下可以访问 `10.255.0.83:3425`，机器人能够恢复对话。
- Desktop 可以在“设置 → 服务器”中查看并修改策略，且无需手动 SSH 或执行 nftables 命令。
- `allowlist`、模型端点例外和 Computer 重启恢复均有自动化验证。
- 服务端持久化状态、Computer 应用状态和 UI 展示状态可互相追踪。
