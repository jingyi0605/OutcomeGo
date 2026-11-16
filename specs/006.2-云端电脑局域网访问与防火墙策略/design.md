# 设计文档 - 云端电脑局域网访问与防火墙策略

状态：IN_PROGRESS

## 1. 概述

### 1.1 目标

- 将 Computer 的私有网络访问从镜像内固定行为提升为服务端持久化策略。
- 默认恢复自托管部署的局域网可达性，同时保持公共网络经过托管出口。
- 为 `allowlist` 提供 Settings → Server 图形化管理入口。
- 将模型端点作为 Computer 本地配置驱动的自动例外，并与手工规则合并。

### 1.2 覆盖需求

- `requirements.md` 需求 1：私有网络策略模式
- `requirements.md` 需求 2：服务端策略存储与 Computer 应用
- `requirements.md` 需求 3：模型端点自动例外
- `requirements.md` 需求 4：Settings → Server 图形化管理
- `requirements.md` 需求 6：机器人防火墙操作与双重卡片确认
- `requirements.md` 需求 5：出口连通性、可观察性与回归防护

### 1.3 技术约束

- 后端：Bun、TypeScript、Prisma、PostgreSQL、`BrowserNetworkService` 现有 control token 通道
- Computer：Linux Docker、nftables、`ip rule`、TUN、`models.json`
- Desktop：Electron、React renderer、现有 Server settings API 和 Modal 组件
- 数据存储：新增全局 `ComputerNetworkPolicy` Prisma 模型
- 认证授权：登录后的 Server settings API；Computer 使用 `OUTCOMEGO_CONTROL_TOKEN`
- 兼容性：公共网络出口、route epoch、BrowserNetworkService 和现有 host bridge 行为继续有效

## 2. 架构

### 2.1 系统结构

```mermaid
flowchart LR
    UI[Settings → Server
    LAN policy modal]
    API[Server settings API]
    DB[(ComputerNetworkPolicy)]
    INTERNAL[Internal policy endpoint]
    COMPUTER[Computer policy reconciler]
    MODELS[models.json]
    NFT[nftables + ip rule]
    RELAY[Managed TUN/SOCKS exit]
    LAN[Private LAN services]

    UI --> API
    API --> DB
    COMPUTER -->|control token poll| INTERNAL
    INTERNAL --> DB
    COMPUTER --> MODELS
    COMPUTER --> NFT
    NFT --> LAN
    NFT --> RELAY
```

服务端保存用户策略；Computer 负责把服务端策略和本地模型端点编译为一个原子目的地集合。Server 不接触模型 API key，也不把 `models.json` 的完整内容上传到服务端。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `ComputerNetworkPolicyService` | 读取、校验、保存策略并处理 revision | 登录用户请求、Prisma 行 | `ComputerNetworkPolicyView` |
| `ComputerNetworkPolicy` | 保存模式、规则、revision、更新时间 | Prisma migration | 全局持久化策略 |
| `computer-network-policy` route | 提供用户 API 和 Computer 内部 API | HTTP + auth | 策略视图或内部快照 |
| `ComputerNetworkPolicyReconciler` | 周期拉取服务端策略、读取模型端点、更新规则 | policy snapshot、models.json | applied/pending/error 状态 |
| `outcomego-computer-network.py` | 校验目的地、编译 nftables set 和 `ip rule` | policy file/arguments | 内核策略 |
| `LanPolicyModal` | 展示模式、规则、模型例外和应用状态 | API view | PATCH policy |

### 2.3 关键流程

#### 2.3.1 读取和保存策略

1. Desktop 请求 `GET /api/v0/server-settings/computer-network-policy`。
2. Server 从 `ComputerNetworkPolicy` 读取全局行，校验模式、规则和 revision。
3. Server 通过 Computer 内部状态接口读取当前 `appliedRevision`、策略状态和错误摘要。
4. 用户提交模式或规则时携带 `expectedRevision`。
5. Server 事务校验输入并使用 compare-and-swap 更新 revision；冲突返回 409。
6. Computer 下一次轮询发现 revision 变化，编译新集合并报告状态。

#### 2.3.2 Computer 合并目的地集合

1. Computer 读取服务端策略快照。
2. Computer 读取本地 `models.json`，提取合法私有 IP 字面量 `baseUrl` 的地址和 TCP 端口。
3. `lan` 模式产生私有网络允许集合；`allowlist` 模式产生服务端规则集合。
4. 两种模式都叠加模型端点集合和现有显式 host bridge 集合。
5. helper 先创建/更新 `ip rule` 和 nftables set，再删除被撤销的旧项；失败时保留上一份有效策略。
6. Computer 对外报告 `appliedRevision`、`state`、`modelEndpointCount` 和安全错误类别。

#### 2.3.3 公共与私有流量分流

- 公共目标没有私有直连规则，继续按照现有 `ip rule pref 110` 进入托管 TUN。
- 允许的私有 TCP 目标通过 `ip rule pref 98` 查主路由表，并由 nftables transport chain 标记为 control/underlay 路径。
- 未允许的私有 TCP 目标没有 direct route，也没有 TUN fallback 时的公共出口语义，最终被 nftables drop/reject。
- UDP、入站连接和非 TCP 规则不在本 Spec 范围内。

#### 2.3.4 策略状态回报

1. Computer 启动时状态为 `pending`，直到拿到服务端策略。
2. 计算和 helper 执行期间状态为 `applying`。
3. 成功后状态为 `applied` 并记录 revision。
4. 失败后状态为 `error`，保留 `lastAppliedRevision` 和上一份有效规则。
5. Server settings API 将该状态透传给 Desktop；状态接口不可用时明确显示“Computer 状态未知”。

#### 2.3.5 反向路径校验与出口复验

**背景。** 容器的全部出站流量由 `ip rule pref 110` 送入出口表 18791，该表默认只有 `unreachable default`。内核对入站包做反向路径校验时，用未标记的查找去找回源地址的路由，因此会落入这张表而失败。局域网地址因为有 `pref 98` 指向 `main` 的规则，不受影响；公共地址的回包则被丢弃。Docker 会在容器创建后一段时间（实测约 15 秒）把 `rp_filter` 重置为 2，所以只在启动时写 0 不可靠。

**处理方式。**

1. `nft_ruleset()` 增加 `rpf` 链：`prerouting`、`priority -150`，`iifname "eth0" meta mark set 0x4f54`，给 eth0 入站包打上传输标记。
2. `disable_reverse_path_filter()` 对 `/proc/sys/net/ipv4/conf` 下每个接口写 `rp_filter=0` 和 `src_valid_mark=1`。`src_valid_mark=1` 让反向路径校验使用包上的标记，命中 `pref 100 fwmark … lookup main`，校验因此在 `main` 表完成，与 `rp_filter` 的取值无关。
3. 容器自身的直连网段（`connected_prefixes()`，排除 TUN 和链路本地）安装 `ip rule pref 94 to <prefix> lookup main`。宿主机对容器的 ARP 请求同样要过反向路径校验，缺少这条规则时请求被丢弃，宿主机的邻居条目停在 `INCOMPLETE`，回包排队约 20 秒后才被放出。
4. 默认路由由 `network-connectivity.ts` 的探测循环启用：先经托管出口探测，通过后调用 `outcomego-computer-network.py --families` 装上 TUN 默认路由，再由不带传输标记的子进程用普通套接字复验；复验失败则撤销路由。
5. 复验子进程的入口 `parseComputerProbeRequest()` 与发送方 `probeComputerNetwork()` 共用 `computerProbeKinds`。发送方能发出的每个类型都被子进程接受，类型列表不一致会在编译或测试阶段暴露。
6. 复验失败时，worker 输出 `{"verifyFailed":{"family","reason"}}`，主进程校验字段格式后以 `Computer network verify failed: family=… reason=…` 记入日志。`connectivity` 状态同时出现在 `GET /v1/browser-network` 的响应中。

#### 2.3.6 机器人专用防火墙操作

机器人不获得 Shell、nftables 或通用策略 API 的写权限。服务端提供唯一的 `UpdateComputerNetworkPolicy` 专用操作，操作的输入分为首次请求和后续 `approvalId` 调用两类：

1. 首次调用只允许顶层用户机器人使用。服务端要求请求模式与当前模式一致，校验新增规则，读取当前策略 revision，按 `address/port` 将新增规则并入当前规则并保存为 `verification_pending` 请求，并在机器人所有者的 bot DM 中发送核验卡片。已有规则和标签保持不变；模式切换只能由所有者在 Settings 中完成。
2. 用户选择“核验策略”后，卡片响应将请求推进到 `approval_pending`，同时唤醒原机器人。机器人使用同一个 `approvalId` 再次调用操作，服务端发送最终授权卡片。
3. 用户选择最终批准后，请求变为 `approved`，再次唤醒机器人。机器人使用 `approvalId` 第三次调用操作，服务端在同一事务中检查 bot、DM、状态、有效期和 `consumedAt`，再按 `expectedRevision` 更新全局策略并消费请求。
4. 任一阶段的拒绝、关闭、过期、revision 冲突或重复消费都会终止请求。卡片中的规则来自数据库保存的候选策略，后续调用不得重新提交或改写规则。

审批记录状态使用 `verification_pending`、`approval_pending`、`approved`、`denied` 和 `expired`。`widgetMessageId` 指向当前阶段的卡片；核验成功后清空该字段，确保最终授权卡片只能由机器人重新发送并绑定。

Desktop 的 `localizeComputerNetworkPolicyCard` 在展示层翻译已知的服务端防火墙卡片文本，使用当前界面语言和翻译目录；核验、授权、已回答和已关闭状态共用此路径，因此无需改写历史消息即可显示中文。仅处理防火墙专用模板，保持规则地址、用户标签和选项提交值不变；未知文本原样保留。对应需求：`requirements.md` 需求 6.9；验证：`tasks.md` 2.5。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、6

- `ComputerNetworkPolicy` Prisma 模型：保存全局策略。
- `ComputerNetworkPolicyService`：输入校验、CAS 更新和视图组合。
- `ComputerNetworkPolicyReconciler`：Computer 内部轮询和状态管理。
- `readModelEndpoints()`：从 `models.json` 提取安全的私有模型目的地。
- `LanPolicyModal`：Settings → Server 中的图形化编辑器。
- `UpdateComputerNetworkPolicy`：顶层机器人可调用的专用策略操作，负责核验卡片、授权卡片和一次性应用。
- `outcomego-computer-network.py`：统一编译模式、规则、模型端点和 host bridge。

### 3.2 数据结构

#### 3.2.1 `ComputerNetworkPolicy`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `String` | 是 | 固定为 `global` | 主键 |
| `mode` | `String` | 是 | `lan`、`allowlist` | 仅允许两个值 |
| `rules` | `Json` | 是 | 手工私有 TCP 规则 | 最多 128 条 |
| `revision` | `Int` | 是 | 并发控制版本 | 从 1 开始递增 |
| `updatedAt` | `DateTime` | 是 | 最后修改时间 | Prisma 自动更新 |

规则 JSON 的逻辑结构：

```json
{
  "id": "rule-uuid",
  "address": "10.255.0.0/24",
  "port": "8000-8100",
  "label": "Local model gateway"
}
```

`address` 支持私有 IPv4/IPv6 主机或完全包含在 RFC1918、IPv4 链路本地、IPv6 ULA 或 IPv6 链路本地空间内的网络；IPv4 网络可使用 CIDR 或连续点分掩码。服务端将 host 和 network address 规范化，非规范 CIDR 主机位会清零。`port` 兼容既有整数单端口，并支持字符串表示的递增闭区间（例如 `8000-8100`）；`1-1` 规范化为整数 `1`。Computer 使用每条规则独立的 nftables 匹配和 `ip rule`，避免拼接区间产生规则间交叉匹配。`label` 只用于界面显示，不参与安全判断。

#### 3.2.2 `ComputerNetworkPolicyView`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `policy.mode` | `"lan" | "allowlist"` | 是 | 当前私有网络模式 | 来自数据库 |
| `policy.rules` | `PolicyRule[]` | 是 | 手工规则 | 已排序、无重复 |
| `policy.revision` | `number` | 是 | 服务端版本 | PATCH 必须匹配 |
| `runtime.state` | `"unknown" | "pending" | "applying" | "applied" | "error"` | 是 | Computer 应用状态 | 不伪造成功 |
| `runtime.appliedRevision` | `number | null` | 是 | 最后成功版本 | 错误时保留 |
| `runtime.modelEndpointCount` | `number` | 是 | 自动例外数量 | 不返回 key |
| `runtime.error` | `string | null` | 是 | 安全错误摘要 | 不含凭据 |

#### 3.2.3 `ComputerNetworkPolicyApproval`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `String` | 是 | 双重卡片流程的稳定标识 | UUID |
| `botId`、`channelId` | `String` | 是 | 请求机器人和所有者 bot DM | 应用时必须精确匹配 |
| `sourceRunId`、`sourceCallId` | `String` | 是 | 首次专用操作的幂等边界 | 组合唯一 |
| `expectedRevision` | `Int` | 是 | 候选策略读取时的 revision | 应用时 compare-and-swap |
| `mode`、`rules` | `String`、`Json` | 是 | 当前策略与机器人新增目的地合并后的策略 | 后续调用不能改写 |
| `status` | 枚举 | 是 | `verification_pending`、`approval_pending`、`approved`、`denied`、`expired` | 最终应用前必须为 `approved` |
| `widgetMessageId` | `String?` | 否 | 当前核验或授权卡片 | 唯一；核验成功后清空 |
| `expiresAt`、`consumedAt` | `DateTime` | 是、否 | 有效期和一次性消费时间 | 过期或已消费拒绝 |

### 3.3 接口契约

覆盖需求：1、2、3、4

#### 3.3.1 读取策略

- 类型：HTTP
- 路径：`GET /api/v0/server-settings/computer-network-policy`
- 输入：已登录 Desktop 请求
- 输出：`ComputerNetworkPolicyView`
- 校验：读取并修复缺失的 global 默认行；默认模式为 `lan`
- 错误：沿用 `ApiError`，内部状态不可用时 runtime.state 为 `unknown`

#### 3.3.2 更新策略

- 类型：HTTP
- 路径：`PATCH /api/v0/server-settings/computer-network-policy`
- 输入：

```json
{
  "expectedRevision": 3,
  "mode": "allowlist",
  "rules": [
    { "id": "rule-uuid", "address": "10.255.0.83", "port": 3425, "label": "Local model gateway" }
  ]
}
```

- 输出：更新后的 `ComputerNetworkPolicyView`
- 校验：revision、模式、地址族、私有范围、端口、重复项、128 条上限
- 错误：400 输入错误；409 revision 冲突；503 状态服务不可用但数据库更新不回滚

#### 3.3.3 Computer 获取策略

- 类型：HTTP
- 路径：`GET /api/internal/computer-network-policy`
- 认证：`Authorization: Bearer OUTCOMEGO_CONTROL_TOKEN`
- 输出：服务端策略快照和 revision，不包含用户 session 信息
- 错误：401 未授权；404 表示旧 Server 不支持此能力；500 表示无法读取数据库

#### 3.3.4 Computer 状态

- 类型：HTTP
- 路径：`GET /v1/computer-network-policy`
- 认证：Computer control token
- 输出：当前 reconciler 状态、applied revision、模型端点数量和错误摘要
- 错误：401 未授权；503 表示 reconciler 尚未准备好

#### 3.3.5 浏览器网络与出口连通性

- 类型：HTTP
- 路径：`GET /v1/browser-network`
- 认证：Computer control token
- 输出：`ready`、`mode`、`activeConnections`、`policy` 和 `connectivity`。`connectivity` 含 `ipv4`、`ipv6`（`state` 为 `checking`/`working`/`unavailable`，不可用时带 `reason`）和 `checkedAt`
- 错误：401 未授权
- 兼容：`connectivity` 为新增可选字段，旧客户端忽略即可

## 4. 数据与状态模型

### 4.1 数据关系

`ComputerNetworkPolicy` 是服务端唯一持久化策略。`ComputerNetworkPolicyReconciler` 持有短生命周期的应用状态和上一份有效目的地集合，不把模型 API key 或完整 `models.json` 写回服务端。`BrowserNetworkSettings` 继续只负责公共网络出口排序，两者互不覆盖。

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `unknown` | Server 无法读取 Computer 应用状态 | Computer 旧版本、断线或状态接口失败 | 状态接口恢复 |
| `pending` | 等待策略或首次应用 | Computer 启动、策略 revision 改变 | 开始应用 |
| `applying` | 正在编译和写入规则 | reconciler 开始一次应用 | 成功或失败 |
| `applied` | 当前 revision 已成功应用 | nftables、ip rule 和状态更新成功 | 新 revision 或模型配置变化 |
| `error` | 本次应用失败，上一份规则仍在 | 校验、helper 或内核更新失败 | 下一次重试成功 |

## 5. 错误处理

### 5.1 错误类型

- `computer_network_policy_invalid`: 策略模式、规则或 revision 不合法。
- `computer_network_policy_conflict`: 服务端 revision 已变化。
- `computer_network_policy_unavailable`: Computer 状态不可读取。
- `computer_network_policy_apply_failed`: helper/nftables/ip rule 应用失败。
- `computer_network_model_endpoint_ignored`: 模型端点不是合法私有 IP 字面量。
- `computer_network_legacy_runtime`: Computer 不支持内部策略接口。

出口复验失败使用固定原因码，只出现在日志和 `connectivity` 状态中，不进入 API 错误响应：

| 原因码 | 含义 |
| --- | --- |
| `timeout` | 复验子进程超过时限被终止 |
| `aborted` | 租约变化或进程关闭导致复验取消 |
| `exit_<code>` | 子进程以非 0 退出，例如请求类型不被接受或探测失败 |
| `bad_output` | 子进程输出无法解析 |
| `spawn_failed` | 无法启动子进程 |

### 5.2 错误响应格式

```json
{
  "error": {
    "code": "computer_network_policy_apply_failed",
    "message": "Computer could not apply the network policy; the last valid policy is still active."
  }
}
```

### 5.3 处理策略

1. API 输入错误：拒绝写入并返回字段级错误。
2. revision 冲突：不覆盖服务端新版本，Desktop 重新读取后让用户重试。
3. Computer 应用失败：保留上一份有效规则，状态为 `error`，按 2 秒间隔重试。
4. 模型端点异常：忽略单个端点，其他规则继续应用，并在状态中计数和记录安全摘要。
5. 旧 Computer：Server 保存策略，但 UI 显示 `legacy runtime`，不声称已应用。

## 6. 正确性属性

### 6.1 属性 1：公共出口不被私有策略绕过

*对于任何* 未被模型端点或手工规则允许的公共地址，Computer 都应该继续使用现有托管出口；策略模式只影响私有地址集合。

**验证需求：** `requirements.md` 需求 1.2、需求 3.4

### 6.2 属性 2：失败保持上一份有效规则

*对于任何* 新策略应用失败，内核中的有效集合都应该保持最后一次成功应用的规则，不出现空集合或全放行窗口。

**验证需求：** `requirements.md` 需求 2.3、需求 2.4

### 6.3 属性 3：模型端点与手工规则合并且可撤销

*对于任何* `models.json` 变化，下一次重算后的集合应该等于当前策略规则、合法模型端点和合法 host bridge 的并集，并删除不再存在的项目。

**验证需求：** `requirements.md` 需求 3.1、需求 3.2

### 6.7 属性 7：机器人策略变更必须经过双重确认且只能消费一次

*对于任何* 机器人提交的候选策略，服务端在核验卡片和最终授权卡片都完成前不应改变全局策略；最终应用必须匹配保存时的 bot、channel、revision 和完整规则，并且同一 `approvalId` 只能成功消费一次。

**验证需求：** `requirements.md` 需求 6.1-6.8

### 6.4 属性 4：revision 是唯一写入顺序

*对于任何* 并发 Desktop 更新，只有携带当前 revision 的一次更新可以成功；旧 revision 不得覆盖新策略。

**验证需求：** `requirements.md` 需求 2.1、需求 4.4

### 6.5 属性 5：公共出口回包不依赖 `rp_filter`

*对于任何* `rp_filter` 取值（0、1 或 2），Computer 经托管出口访问公共地址的回包都应该通过反向路径校验，宿主机对容器的 ARP 请求都应该得到应答。

**验证需求：** `requirements.md` 需求 5.1、需求 5.2

### 6.6 属性 6：出口复验失败必有可见原因

*对于任何* 导致默认路由被撤销的复验失败，日志和 `connectivity` 状态都应该包含固定原因码；发送方能发出的每种探测类型都被子进程接受。

**验证需求：** `requirements.md` 需求 5.3、需求 5.4、需求 5.5

## 7. 测试策略

### 7.1 单元测试

- 策略模式、规则地址、端口、重复项和上限校验。
- Prisma 默认行创建、revision CAS 更新和冲突。
- `models.json` 私有 IP 字面量提取、非法 URL 忽略和旧端点撤销。
- nftables/ip rule 计划编译，验证 `lan`、`allowlist` 和模型例外。
- reconciler 应用成功、失败保留上一份规则、重试和状态转换。
- Modal 的模式切换、规则编辑、冲突刷新和应用状态渲染。
- `nft_ruleset()` 含 `rpf` 链且在 `prerouting` 给 eth0 入站包打标记；`disable_reverse_path_filter()` 写入 `rp_filter=0` 与 `src_valid_mark=1`；`connected_prefixes()` 只返回直连网段（`scripts/imessage-bridge-linux/test_network.py`）。
- `parseComputerProbeRequest()` 接受 `computerProbeKinds` 中的全部类型，拒绝未知类型、缺少 epoch 的路由和非法 JSON（`apps/computer/test/computer-network-probe.test.ts`）。

### 7.2 集成测试

- Server API 与 PostgreSQL 策略行的读写、迁移和 409 冲突。
- Computer internal policy endpoint 的 control token 授权。
- 使用 Linux network fixture 验证 TUN、main route、nftables set 和私有 TCP 连接。
- 生产配置 `10.255.0.83:3425` 在 `lan` 与 `allowlist + model exception` 两种路径可达。

- 在 `rp_filter` 被重置为 2 的新建容器中，带标记的公网连接成功，SOCKS 中继成功，TUN 默认路由保持，`apt-get update` 成功。
- `scripts/dev/debug.sh smoke` 强制重建后通过 `check`。

### 7.3 端到端测试

- Desktop Settings → Server 打开 Modal、切换模式、新增规则、保存并等待 applied。
- Computer 重启后策略和模型端点自动恢复。
- 删除规则或模型端点后，目标连接被阻断且其他公共网络仍可用。
- 旧 Computer 连接时显示 legacy/unknown 状态，不误报已应用。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.3.3、§4.2、§6.1 | Linux 网络策略集成测试和生产回放 |
| `requirements.md` 需求 2 | `design.md` §3.2、§3.3.1-§3.3.4、§6.2 | Prisma/API/reconciler 测试 |
| `requirements.md` 需求 3 | `design.md` §2.3.2、§6.3 | models.json 与 helper 测试 |
| `requirements.md` 需求 4 | `design.md` §2.3.1、§3.3、§7.3 | Desktop renderer/API/E2E 测试 |
| `requirements.md` 需求 5 | `design.md` §2.3.5、§3.3.5、§5.1、§6.5、§6.6 | Python 规则测试、探测契约测试、`debug.sh check/smoke` |

## 8. 风险与待确认项

### 8.1 风险

- `lan` 默认模式降低了 Computer 对同一 LAN 的隔离，需要在设置界面明确展示当前模式。
- 旧 Computer 镜像无法读取策略接口；Server 必须显示实际未应用状态。
- 私有网段和公共出口共用容器路由时，规则顺序错误会造成连接失败或意外绕过。
- 大量规则会增加 nftables 更新和 UI 编辑复杂度，因此首期限制 128 条。
- 容器创建后约 15 秒 `rp_filter` 被重置为 2，重置来源尚未查明。当前方案不依赖该值；如果其他内核参数也被重置，需要再次排查。
- 直连网段只在容器启动时读取一次。运行中用 `docker network connect` 新增网络时，新网段不会自动得到 `pref 94` 规则。
- 服务器运行在 Mac、Computer 运行在远端 Docker 桥接网络的调试拓扑少见，故障更难定位，因此 `debug.sh check` 需要同时检查宿主机到容器这一跳。

### 8.2 待确认项

- 是否需要在后续版本支持域名到私有地址的安全解析和动态 pinning。
- 是否需要为 `lan` 模式增加“只允许 RFC1918、不允许 link-local”的细分开关。
