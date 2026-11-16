# 需求文档 - 云端电脑局域网访问与防火墙策略

状态：IN_PROGRESS

## 简介

beta.17 在云端电脑中启用了更严格的 nftables 出站策略和网络出口验证。该策略把未显式授权的私有地址流量拒绝在容器内，导致配置在 `models.json` 中的局域网模型服务无法访问，进而使所有机器人无法对话。beta.16 虽然已经存在出站隔离，但会立即安装 TUN 默认路由，行为与 beta.17 不同。

本 Spec 为自托管部署提供清晰、可持久化、可观察的局域网策略：默认允许云端电脑访问私有网络地址；用户可以在 Desktop 的“设置 → 服务器”中切换为显式白名单；计算机端自动把模型配置中的私有模型端点加入允许集合；公共网络流量继续使用现有的托管出口。

## 术语表

- **System**：OutcomeGo 服务端、Computer 运行时和 Desktop 客户端组成的网络策略系统。
- **Computer**：运行机器人任务的 Linux Docker 容器。
- **托管出口**：由 `BrowserNetworkService` 选择并通过 TUN/SOCKS 转发的公共 TCP 和 DNS 出口。
- **私有网络地址**：RFC1918、链路本地地址以及部署环境明确标记为 private 的地址；首期只接受计算机端 IP 字面量或显式网段掩码，不解析域名。
- **模型端点**：`/home/box/.pi/agent/models.json` 中 provider 的 `baseUrl` 所指向的 HTTP(S) 服务。
- **策略模式**：`lan` 或 `allowlist` 两种私有网络访问模式。
- **出口连通性（connectivity）**：Computer 对 IPv4/IPv6 公共出口的探测与复验结果，状态为 `checking`、`working` 或 `unavailable`。
- **反向路径校验（rp_filter）**：内核对入站包按源地址反查路由的校验；失败的入站包会被静默丢弃。
- **出口复验**：安装 TUN 默认路由后，由不带传输标记的子进程用普通套接字再次探测；复验失败会撤销默认路由。

## 范围说明

### In Scope

- 默认允许 Computer 访问私有网络 TCP 目的地，公共流量继续走托管出口。
- 服务端持久化网络策略和 TCP 目的地白名单，并通过 control token 下发给 Computer。
- Desktop“设置 → 服务器”中的独立局域网策略 Modal，支持模式选择、规则新增、编辑、删除和应用状态查看。
- Computer 自动识别并允许 `models.json` 中的私有模型端点，动态更新 nftables 与策略路由。
- beta.17 到新策略的迁移、断线恢复、策略版本冲突和错误提示。
- Computer 出口连通性的可靠性、可观察性和回归防护：容器内反向路径校验、出口复验失败原因、探测类型契约，以及调试环境对真实流量的检查。

### Out of Scope

- 任意 UDP、ICMP、端口转发、入站连接或修改宿主机防火墙。
- 通过策略编辑器允许公共地址绕过托管出口。
- 通过域名解析任意扩大私有网络允许范围；首期规则使用 IP 字面量或带显式掩码的 IP 网段。
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
3. WHEN 用户新增规则 THEN System SHALL 允许填写私有 IPv4/IPv6 主机或完全位于私有地址空间内的网段（CIDR；IPv4 兼容点分掩码）、单个 TCP 端口或递增闭区间端口范围，以及可选说明，并在保存前校验地址族、掩码、端口范围、重复项和私有地址边界。
4. WHEN 用户编辑或删除规则 THEN System SHALL 以当前 revision 提交，遇到 revision 冲突时刷新服务端状态并保留明确提示。
5. WHEN Computer 尚未应用新策略 THEN Modal SHALL 显示 applying/pending 状态；WHEN 应用失败 THEN SHALL 显示错误并保留上一份有效策略。
6. WHEN 用户打开 Modal 或刷新服务器设置 THEN System SHALL 显示服务端持久化状态和 Computer 实际应用状态，不能把草稿当成已生效策略。

### 需求 6：机器人防火墙操作与双重卡片确认

**用户故事：** 作为部署所有者，我希望机器人可以提出局域网防火墙变更，但必须经过明确的策略核验和最终授权，避免机器人或过期请求直接改变 Computer 的网络边界。

#### 验收标准

1. WHEN 顶层用户机器人调用专用的 `UpdateComputerNetworkPolicy` 操作 THEN System SHALL 要求请求模式与当前生效模式一致，校验私有 IP、TCP 端口、重复规则和当前 revision，并 SHALL 将当前策略与新增目的地合并后保存为待核验请求；机器人不得切换生效模式，该次调用不得修改生效策略。
2. WHEN 子机器人或 routine 机器人调用该操作 THEN System SHALL 拒绝请求，并 SHALL 不创建可用于修改防火墙的授权记录。
3. WHEN 待核验请求创建成功 THEN System SHALL 在该机器人所有者的 bot DM 中发送核验卡片；卡片必须显示模式、revision、完整规则和“核验不会立即修改防火墙”的说明。
4. WHEN 用户核验核验卡片 THEN System SHALL 将请求推进到待最终授权状态，并 SHALL 由机器人再次调用同一操作发送独立的最终授权卡片。
5. WHEN 用户拒绝、关闭或核验/授权请求过期 THEN System SHALL 将请求标记为拒绝或过期，并 SHALL 不应用任何策略。
6. WHEN 用户在最终授权卡片中选择批准 THEN System SHALL 只允许机器人再次以该请求的 `approvalId` 调用操作；服务端 SHALL 按保存的合并策略和 expected revision 做 compare-and-swap，成功后一次性消费请求。
7. WHEN 策略 revision 已变化、请求已消费或 approvalId 属于其他机器人 THEN System SHALL 拒绝应用，并 SHALL 要求重新发起核验和授权流程。
8. WHEN 机器人通过 Shell、普通消息卡片或其他通用操作尝试修改防火墙 THEN System SHALL 没有可用的绕过路径；只有专用操作和双重卡片流程可以触发策略更新。
9. WHEN Desktop 使用简体中文 THEN 核验和授权卡片 SHALL 使用中文展示标题、模式名称、策略影响、有效期和选项；已有卡片、已回答卡片和已关闭卡片 SHALL 同样遵循界面语言，规则地址、用户标签和提交值不得因翻译改变。对应设计：`design.md` §2.3.6；验证：`tasks.md` 2.5。

### 需求 5：出口连通性、可观察性与回归防护

**用户故事：** 作为运维者，我希望 Computer 的公共出口不因容器内核参数变化而失效，并且出口失败时能直接看到原因，以便这类故障不会再靠抓包才能定位。

#### 验收标准

1. WHEN 容器的 `rp_filter` 在启动后被重置为非 0 THEN Computer SHALL 仍然接受公共地址的回包和宿主机对容器的 ARP 请求，不得依赖 `rp_filter` 的取值。
2. WHEN Computer 经由托管出口访问公共地址 THEN 反向路径校验 SHALL 在 `main` 路由表中完成，不得落入只含 `unreachable default` 的出口表。
3. WHEN 出口复验失败 THEN Computer SHALL 记录固定原因码（`timeout`、`aborted`、`exit_<code>`、`bad_output` 或 `spawn_failed`），并 SHALL 不转发子进程输出。
4. WHEN 读取 `GET /v1/browser-network` THEN 响应 SHALL 包含 `connectivity`，显示 IPv4/IPv6 的状态和不可用原因。
5. WHEN 增加新的探测类型 THEN 发送方和子进程入口 SHALL 引用同一份定义，并 SHALL 有测试证明发送方能发出的每种类型都被子进程接受。
6. WHEN 执行 `scripts/dev/debug.sh check` THEN 脚本 SHALL 用真实流量验证出口连通性、公网可达、Computer 到服务端的局域网可达，以及宿主机能解析容器；任一项失败 SHALL 使检查失败。
7. WHEN 执行 `scripts/dev/debug.sh smoke` THEN 脚本 SHALL 强制重建 Computer，等待延迟的网络变化发生后再执行完整检查，因为部分容器网络状态只在新建容器后才会被改变。

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
- 在 `rp_filter` 被重置为 2 的新建容器中，Computer 能访问公网和局域网，且 `debug.sh smoke` 通过。
- 出口复验失败时，原因码出现在日志和 `GET /v1/browser-network` 中。
