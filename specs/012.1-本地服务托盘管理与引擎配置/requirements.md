# 需求文档 - 本地服务托盘管理与引擎配置

状态：Draft

## 简介

本 Spec 为 [Spec 012：桌面端一键本地部署](../012-桌面端一键本地部署/README.md) 的延续子规格，面向在 Windows 与 macOS 上以本地自托管模式运行 OutcomeGo 的用户（涵盖托管引擎 `managed-wsl` / `managed-lima` 以及用户自带的 `external` Docker 兼容引擎）。

当前本地部署跑通后，日常运维与环境调优存在以下痛点：

- **托盘管理薄弱且状态滞后**：Windows/macOS 托盘右键菜单只有“打开 / 启动或停止 / 退出”，缺少“服务管理”入口、重启服务、自启开关和日志入口；且右键先弹出旧缓存菜单再异步刷新、部署完成未触发托盘同步，导致服务已经健康运行，托盘仍长期显示“正在启动本地服务”。
- **Docker 容器对用户不可见**：托管引擎内的容器（`server`、`worker`、`computer`、`postgres`、`computer-memory-init`）没有可视化管理界面，用户需要记忆 `wsl -d outcomego-engine` 或 `outcomego engine docker` 命令才能排查容器异常或查看日志。
- **开机自启耦合且不完整**：Windows 托管引擎的计划任务目前与 `start`/`stop` 强绑定，用户无法独立决定“是否开机自启本地服务”；macOS 托管引擎尚未实现登录自启；桌面端自身也缺少登录自启设置。
- **性能与资源配置不直观**：当前仅提供无回显的裸文本框调整 `computer`/`desktop` 内存限额，未覆盖当前值展示、推荐档位、`computer` CPU 限额、`worker` 并发数以及托管引擎（Lima VM / WSL2）层面的资源概览与配置。
- **缺少本地代理服务器配置**：在国内网络或企业内网环境下，本地服务端请求海外模型 API、网页搜索或拉取 Docker 镜像时经常被阻断，用户需要一个面向本地自托管栈的统一代理配置与一键测试入口。

本 Spec 交付后，本地自托管用户无需离开桌面端或打开命令行，即可通过任务栏托盘与「本地服务管理」界面完成容器管理、自启控制、性能调优与代理配置。

## 术语表

- **System**：OutcomeGo 桌面端（Electron 主进程与渲染进程）、OutcomeGo CLI 及本地托管的 Docker Compose 服务栈。
- **本地部署模式（Local Mode）**：桌面端当前连接的服务器地址与本机托管安装记录匹配（`canManageLocalInstallation` 为真），允许桌面端通过本地 CLI 管理该服务栈的工作模式。
- **托管引擎（Managed Engine）**：由 OutcomeGo 自动安装并管理的容器运行环境，Windows 上为私有 WSL2 发行版 `outcomego-engine`（`managed-wsl`），macOS 上为私有 Lima 虚拟机（`managed-lima`）。
- **外部引擎（External Engine）**：用户宿主机自行安装的 Docker Desktop、OrbStack、Colima、Rancher Desktop 或 Docker Engine（`external`）。
- **服务栈（Stack）**：`deploy/compose.yaml` 定义的一组 OutcomeGo 容器，包含常驻核心服务（`postgres`、`server`、`worker`、`computer`、`computer-memory-init`）及一次性初始化任务（`*-init`、`migrate`）。
- **本地代理（Local Service Proxy）**：面向本地服务端容器出网、托管 Docker 引擎拉取镜像及 CLI 资产下载的 HTTP/HTTPS/SOCKS5 代理配置，独立于“云电脑浏览器出口（`browser-network`）”。

## 范围说明

### In Scope

- 任务栏托盘右键菜单增强（本地部署模式专属项）与托盘状态实时同步修复。
- 桌面端「设置 → 服务器 → 本地服务管理」面板及深链接直达入口（`outcomego://app/v1/settings?id=local-services`）。
- 本地容器清单展示、实时 CPU/内存指标读取、单容器重启及最近日志查看/复制（自动脱敏）。
- 本地服务开机自启（Windows 计划任务、macOS LaunchAgent、外部引擎只读说明）与桌面端登录自启（含静默启动到托盘）的独立开关。
- 容器级性能资源配置（`computer` 内存/CPU、`desktop` 内存、`worker` 并发、预设档位、当前值回显）与托管引擎级资源配置（macOS Lima VM 内存/CPU 编辑；Windows WSL2 当前分配读取与可选安全写入 `.wslconfig`）。
- 本地服务与引擎代理配置（直连 / 跟随系统代理 / 手动代理 + `NO_PROXY`）、本地回环代理宿主机地址转换、Docker 守护进程代理同步（托管引擎）与一键连通性测试。
- 配套 CLI 结构化 JSON 子命令与 `deploy/compose.yaml` 可选环境变量透传。
- 中英文界面文案覆盖。

### Out of Scope

- 管理非 OutcomeGo 项目（宿主机上其他用户的第三方 Docker 容器或镜像）。
- 交互式容器终端（`docker exec -it` Shell）或在线直接编辑 `compose.yaml` 源码。
- 在桌面端内嵌完整的镜像仓库管理或构建系统。
- 修改“云电脑浏览器出口（`browser-network`）”与“云电脑防火墙策略（`computer-network-policy`）”的既有业务流程（仅做必要端口放通配合）。
- Linux 桌面端托盘与托管引擎支持（延续 Spec 012 边界，仅 Windows 与 macOS 桌面端提供本地服务管理与托盘）。
- 自动修改外部引擎（如 Docker Desktop / OrbStack）的软件配置、自启或守护进程代理。

## 需求

### 需求 1：任务栏托盘菜单增强与状态实时同步

**用户故事：** 作为本地自托管的桌面端用户，我希望在任务栏右键托盘图标时看到准确的服务状态，并能一键进入服务管理、重启服务、切换开机自启或打开日志目录，以便像使用本地守护软件一样随时掌控 OutcomeGo。

#### 验收标准

1. WHEN 本地一键部署完成、桌面端启动恢复完成、用户在设置页或托盘执行启停/重启/卸载操作，或本地服务器连接地址切换 THEN System SHALL 立即刷新托盘菜单状态，不得继续滞留于“正在启动本地服务”等过期状态。
2. WHEN 用户右键点击托盘图标 THEN System SHALL 在超时上限内（`<= 1.5s`）使用最新状态或立即刷新的状态构建菜单；若异步探测耗时超过该阈值，则先展示最近一次有效状态并在探测返回后自动更新后续菜单状态。
3. WHEN 桌面端处于本地部署模式 THEN 托盘右键菜单 SHALL 至少包含以下分区与操作：
   - 打开 OutcomeGo
   - 状态摘要行（只读，显示运行中 / 已停止 / 正在启动 / 异常 / 更新中等当前状态）
   - 服务管理…（点击后唤起主窗口并直接定位到「设置 → 服务器 → 本地服务管理」）
   - 启动本地服务 / 停止本地服务（随状态切换）
   - 重启本地服务（运行中或异常时可用，忙碌/未安装时禁用）
   - 开机自动启动本地服务（复选框菜单项；`managed-wsl` 与 `managed-lima` 可直接切换，`external` 引擎置灰或隐藏并由服务管理页说明）
   - 打开日志目录（在系统文件管理器中打开本机安装目录下的日志目录）
   - 退出 OutcomeGo（文案随 `stopServiceOnQuit` 偏好提示是否保持本地服务继续运行）
4. WHEN 桌面端连接的是远程服务器（非本地部署模式） THEN 托盘右键菜单 SHALL 仅展示“打开 OutcomeGo”与“退出 OutcomeGo”，不展示本地服务管理、启停、重启或本地自启项。
5. WHEN 托盘中正在执行启停、重启或自启切换操作 THEN System SHALL 禁用互斥的生命周期操作项并更新菜单提示，防止重复并发触发。

### 需求 2：本地容器视图、指标查看与单容器运维

**用户故事：** 作为本地自托管用户，我希望在桌面端看到当前所有 OutcomeGo 容器的运行与健康状态、CPU 和内存占用，并能对异常容器单独重启或查看最近日志，以便无需敲 Docker/WSL 命令即可排查和恢复服务。

#### 验收标准

1. WHEN 用户进入「设置 → 服务器 → 本地服务管理」（或从托盘点击“服务管理…”直达） THEN System SHALL 展示当前本机安装的基础信息（引擎类型、版本、安装目录、API 端口、运行状态）及容器列表。
2. WHEN 本地引擎处于运行状态 THEN 容器列表 SHALL 默认展示常驻核心服务容器（`server`、`worker`、`computer`、`postgres`、`computer-memory-init`），并提供可选折叠视图查看一次性初始化任务（如 `migrate`、`*-init`）；每个容器项展示服务名、运行状态（running / exited / restarting 等）、健康状态（healthy / starting / unhealthy / none）、已运行时长、镜像标签，以及当前 CPU 百分比与内存使用量/上限。
3. WHEN 本地引擎已停止或不可用 THEN 容器列表 SHALL 明确提示当前引擎未启动（不报未捕获错误），并提供“启动本地服务”操作。
4. WHEN 用户点击某个常驻核心容器的“重启”按钮 THEN System SHALL 通过 CLI 仅重启目标服务（若目标为 `computer`，SHALL 同时协同重建或重启依赖其 PID 命名空间的 `computer-memory-init`，避免 `computer` 卡在等待 helper 就绪），并在完成后刷新容器状态。
5. WHEN 用户点击某个容器的“查看日志”按钮 THEN System SHALL 弹出日志查看抽屉/对话框，拉取该容器最近若干行日志（默认 200 行，支持切换 100 / 200 / 500 行、手动刷新、关键词过滤及一键复制），且日志内容已自动脱敏（隐藏密码、Token、API Key 与敏感环境变量值）。
6. WHEN 面板处于前台可见且服务处于运行或启动中状态 THEN System SHALL 按固定间隔自动轮询刷新容器状态与指标（窗口不可见或离开该面板时自动暂停轮询，避免后台无谓消耗）。

### 需求 3：开机自启动独立配置（本地服务 + 桌面端）

**用户故事：** 作为本地自托管用户，我希望分别控制“开机后后台自动启动本地服务”与“登录系统时自动启动 OutcomeGo 桌面端”，以便既可以选择无感后台常驻，也可以选择只在手动打开时运行。

#### 验收标准

1. WHEN 用户在「本地服务管理」中查看自启动设置 THEN System SHALL 分别展示以下两项独立配置：
   - **开机自动启动本地服务**（控制托管容器引擎与服务栈在用户登录后自动拉起）
   - **登录时启动 OutcomeGo 桌面端**（并附带子选项“启动时最小化到托盘”，仅在桌面端自启开启时生效）
2. WHEN 本地引擎为 `managed-wsl`（Windows）且用户开启或关闭“开机自动启动本地服务” THEN System SHALL 通过 CLI 持久化该偏好，并立即注册或注销用户级免 UAC 计划任务 `OutcomeGo-ManagedEngine`（任务动作拉起 WSL2 托管引擎的 `docker.service` 并保持运行，使 `restart: unless-stopped` 的容器自动恢复）。
3. WHEN 本地引擎为 `managed-lima`（macOS）且用户开启或关闭“开机自动启动本地服务” THEN System SHALL 通过 CLI 持久化该偏好，并立即安装或卸载用户级 LaunchAgent（`~/Library/LaunchAgents/com.outcomego.managed-engine.plist`，登录时启动托管 Lima VM 并确保 Docker 与容器栈就绪）。
4. WHEN 本地引擎为 `external`（Docker Desktop / OrbStack 等） THEN System SHALL 将“开机自动启动本地服务”标记为只读并说明应由外部 Docker 引擎自身管理开机自启，不尝试修改外部软件的启动项。
5. WHEN 用户手动点击“停止本地服务”或“启动本地服务” THEN System SHALL 尊重用户已保存的“开机自动启动本地服务”偏好（`start` 时仅在偏好为开启时补齐注册；`stop` 时仅停止本次运行或按偏好决定是否保留计划任务，不再静默篡改用户的偏好开关）；且托盘与设置页的开关状态保持一致。
6. WHEN 用户切换“登录时启动 OutcomeGo 桌面端”或“启动时最小化到托盘” THEN System SHALL 调用 Electron `app.setLoginItemSettings` 更新系统登录项；启用“最小化到托盘”后，随系统登录拉起应用时仅初始化托盘与后台服务而不弹出主窗口。

### 需求 4：性能与资源配置（容器级 + 托管引擎级）

**用户故事：** 作为本地自托管用户，我希望直观查看当前电脑和容器引擎分配了多少 CPU 与内存，并按需调整资源档位或上限，以便在日常轻办公时不卡顿，或在多机器人重度任务时释放更多算力。

#### 验收标准

1. WHEN 用户打开「本地服务管理 → 性能与资源」 THEN System SHALL 展示宿主机总内存、CPU 核心数、安装盘可用空间，以及当前实际生效的各项资源配置值（`computer` 内存上限、`desktop` 内存上限、`computer` CPU 核心上限、`worker` 并发数、托管引擎内存/CPU 分配），不再以空白输入框代替当前值。
2. WHEN 用户调整容器级资源配置 THEN System SHALL 提供推荐预设档位（如“轻量”、“均衡”、“高性能”）及“自定义”模式，并执行前置校验：
   - `computer` 内存上限与 `desktop` 内存上限均不小于 `1 GiB`，且 `desktop` 内存上限严格小于 `computer` 内存上限（预留系统与代理开销），超过当前引擎可用内存 75% 时给出上限提示；
   - `computer` CPU 上限为 `1` 至宿主机逻辑核心数之间的有效数值（支持 `0.5` 步进或整数）；
   - `worker` 并发数为 `1` 至 `16`（CLI 允许上限 `64`）之间的正整数。
3. WHEN 用户确认并应用容器级资源变更 THEN System SHALL 明确提示“变更会重启受影响的本地容器并中断正在执行的任务”，确认后由 CLI 原子更新 `.env` 并重建受影响服务（修改内存或 CPU 重建 `computer` 与 `computer-memory-init`，修改 `worker` 并发重建 `worker`）；若重建失败则自动回滚 `.env` 并返回明确错误。
4. WHEN 本地引擎为 `managed-lima`（macOS）且用户修改虚拟机内存或 CPU 上限 THEN System SHALL 提示需要重启托管虚拟机及所有本地服务，确认后由 CLI 安全停止栈与 Lima VM、通过 `limactl edit` 更新内存/CPU 并重新启动引擎与服务栈；若启动失败则回滚到原 Lima 配置。
5. WHEN 本地引擎为 `managed-wsl`（Windows） THEN System SHALL 读取当前 WSL2 实际可用内存/CPU 及 `%USERPROFILE%\.wslconfig` 中的 `[wsl2]` 配置，清晰标注 `.wslconfig` 属于 Windows 全局 WSL2 设置（会影响本机其他 WSL2 发行版）；若用户显式确认修改并应用，CLI SHALL 先备份原 `.wslconfig`，仅增量更新 `memory` 与 `processors` 字段而保留其余注释与配置项，并在应用后提示用户需要重启托管引擎（或在用户二次确认“关闭所有 WSL2 实例”时执行）方能生效。
6. WHEN 本地引擎为 `external` THEN System SHALL 展示容器级资源配置（完整可用），并对引擎级内存/CPU 仅作只读展示与外部引擎设置指引。

### 需求 5：本地服务与引擎代理服务器配置

**用户故事：** 作为处于国内网络或企业代理环境下的本地自托管用户，我希望在本地服务管理中配置代理服务器并一键测试连通性，让 AI 模型请求、网页搜索、插件调用以及镜像拉取都能稳定通过代理访问，同时不影响本地容器之间的内网通信。

#### 验收标准

1. WHEN 用户打开「本地服务管理 → 代理服务器」 THEN System SHALL 支持三种代理模式：
   - **直连（`off`）**：清除本地服务与托管引擎的代理配置；
   - **跟随系统代理（`system`）**：由桌面端读取当前操作系统代理设置（如 Windows WinINET / macOS 系统网络代理），解析并在保存/同步时下发给本地服务与引擎；若当前系统未启用代理则提示按直连处理；
   - **手动配置（`manual`）**：支持分别配置或统一配置代理协议（`http://`、`https://`、`socks5://`）、主机、端口、可选用户名与密码，以及自定义 `NO_PROXY` 例外列表。
2. WHEN 用户配置的代理地址指向宿主机本地回环（`127.0.0.1`、`localhost` 或 `::1`，如本地 Clash / v2ray 代理端口） THEN System SHALL 在写入容器环境变量和托管引擎配置时自动将其映射为容器/引擎可达的宿主机网关地址（如 `host.docker.internal` 或 WSL2 NAT 宿主机 IP），同时在界面上以用户原始填写地址回显，并提示用户需确保本机代理工具已开启“允许局域网/WSL 连接”。
3. WHEN 用户保存代理配置并启用“应用于本地服务端容器出网”（默认开启） THEN System SHALL 将 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`（及小写对应项，并强制合并不可移除的内网保护列表 `127.0.0.1,localhost,::1,postgres,server,worker,computer,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,host.docker.internal`）写入安装目录 `.env`，并在 `deploy/compose.yaml` 中透传至 `server`、`worker`、`computer`；同时若代理指向宿主机端口，确保 `computer` 容器网络策略放通该宿主机代理目标端口，随后重建受影响容器使其立即生效。
4. WHEN 用户保存代理配置并启用“应用于托管引擎镜像拉取”（`managed-wsl` / `managed-lima` 默认开启） THEN System SHALL 在托管引擎内写入 Docker 守护进程 drop-in 配置（`/etc/systemd/system/docker.service.d/outcomego-proxy.conf`）并重载重启 `docker.service`（或切换为直连时移除该文件并重载），使后续镜像拉取与升级自动生效；若为 `external` 引擎，则明确提示需在外部引擎设置中配置镜像拉取代理，不修改第三方配置。
5. WHEN CLI 执行 Release 元数据、校验文件或托管引擎资产下载且用户未通过进程环境变量显式覆盖 THEN CLI SHALL 自动读取当前本地安装保存的代理配置作为默认出网代理。
6. WHEN 用户点击“测试代理连接”按钮 THEN System SHALL 在不提前覆盖正式配置的前提下，验证代理地址可达性并分别探测关键外网端点（如模型 API 域名与 GitHub/镜像源），以清晰状态返回每个检测项的耗时与可读错误原因。
7. WHEN 代理配置包含认证凭据（用户名/密码） THEN System SHALL 在界面回显、CLI JSON 输出、日志与诊断包中对密码进行脱敏或掩码处理，不得以明文暴露到日志或前端诊断复制文本中。

### 需求 6：CLI 运维与配置子命令（结构化契约与跨平台兼容）

**用户故事：** 作为桌面端主进程和熟悉命令行的自托管用户，我希望上述所有本地服务查询与变更能力都由 CLI 提供稳定、结构化的子命令，以便桌面端与命令行行为一致、可单独脚本化测试。

#### 验收标准

1. WHEN 调用 CLI 本地运维命令并携带 `--json` THEN System SHALL 输出带有明确 `schemaVersion` 的稳定 JSON 结构，所有错误返回规范错误码（复用或扩展 Spec 012 错误码集合）。
2. WHEN 执行以下 CLI 能力 THEN System SHALL 支持非交互模式（如 `--yes`）与桌面端受控调用校验（复用 `OUTCOMEGO_DESKTOP_CLI_VERSION` 版本握手与本地安装路径白名单校验）：
   - `outcomego status --json`：扩展返回每个服务的详细信息与健康状态；新增可选 `--stats` 或独立 `outcomego containers --json` 返回各容器实时 CPU/内存与运行时长；
   - `outcomego restart [service] --json`：支持重启整个服务栈或单个服务（重启 `computer` 自动联动 `computer-memory-init`）；
   - `outcomego logs <service> --tail <n> --json`：返回脱敏后的日志行数组；
   - `outcomego autostart status|set --enabled <true|false> --json`：查询与设置本地服务开机自启；
   - `outcomego resources status|set --json`：查询当前容器与引擎资源配置，以及更新容器/引擎资源；
   - `outcomego proxy status|set|test --json`：查询、设置并应用、测试代理配置。
3. WHEN 用户仍使用旧版 `.env` 或 Linux / 远程部署方式运行 `deploy/compose.yaml` THEN System SHALL 保持完全向后兼容：所有新增环境变量均具备空值或安全默认值，不影响现有部署。

### 需求 7：安全脱敏、并发保护与国际化

**用户故事：** 作为使用中文或英文界面的桌面端用户，我希望所有新增的托盘菜单、服务管理界面与错误提示都具备完整的中英文翻译，且并发操作和敏感信息都得到稳妥保护。

#### 验收标准

1. WHEN 多个配置变更或生命周期操作（如启停、重启、应用资源、应用代理、更新）同时发起 THEN System SHALL 通过现有的桌面端串行互斥锁（`LocalDeployManager.mutate`）与 CLI 安装目录锁（`acquireUpdateLock`）保证互斥执行，对冲突请求返回 `BUSY` 而不是损坏 `.env` 或容器状态。
2. WHEN 界面语言切换为 `zh-CN` 或 `en-US` THEN 托盘右键菜单、设置页「本地服务管理」面板、容器日志弹窗、资源配置与代理配置的所有标签、说明和错误提示 SHALL 完整跟随切换。
3. WHEN 任何本地服务管理 IPC 处理器被渲染进程调用 THEN 主进程 SHALL 校验调用来源窗口与当前本地连接身份（`canManageLocalInstallation`），并严格校验服务名白名单、资源数值范围、代理 URL 协议与字符集（禁止换行、空字节与 Shell 注入字符）。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 用户右键点击托盘图标 THEN 菜单弹出等待时间 SHALL 不超过 `1.5s`（优先读取已同步状态，避免长时间阻塞菜单弹出）。
2. WHEN 打开「本地服务管理」面板 THEN 基础状态与容器列表首次渲染 SHALL 在 `2s` 内完成（容器实时指标 `docker stats --no-stream` 可与基础状态异步分步加载，不阻塞首屏展示）。
3. WHEN 窗口处于隐藏、最小化或不在「本地服务管理」视图 THEN 容器状态与指标轮询 SHALL 自动暂停，后台空闲 CPU 占用接近零。

### 非功能需求 2：可靠性

1. WHEN 应用资源或代理配置导致容器重建或 Docker daemon 重载失败 THEN System SHALL 自动回滚已修改的 `.env`、Lima 配置或 Docker proxy drop-in 文件，并尝试恢复原服务运行状态。
2. WHEN 修改 Windows `%USERPROFILE%\.wslconfig` THEN System SHALL 先写入同目录备份文件（如 `.wslconfig.outcomego.bak`）并使用原子写入，保留所有用户原有其他配置节与注释。
3. WHEN 本地代理配置开启 THEN 强制内网直连清单（`NO_PROXY`）SHALL 始终包含 `postgres`、`server`、`worker`、`computer` 与回环/私有网段，防止服务端内部 RPC、数据库与健康检查走外部代理导致服务瘫痪。

### 非功能需求 3：可维护性

1. WHEN 后续新增本地服务运维动作或配置项 THEN System SHALL 继续遵循“CLI 负责配置落盘与引擎执行 + 桌面端主进程 IPC 校验转发 + 渲染进程展示”的单向分层，不在 Electron 主进程重复拼写 Docker/WSL/Lima 命令。
2. WHEN 排查托盘状态异常或代理/资源应用失败 THEN CLI 与桌面端 SHALL 输出脱敏后的结构化诊断日志，并复用「本地服务管理」中的诊断导出能力。

## 成功定义

- 托盘右键菜单在 Windows 与 macOS 本地部署模式下准确反映实时状态，不再出现服务已健康运行却卡在“正在启动本地服务”的现象。
- 用户在桌面端可完整查看 5 个核心容器的运行状态、健康状态与资源占用，完成单容器重启与日志查看/复制，全程无需打开终端。
- 用户可独立开关“开机自动启动本地服务”（Windows 与 macOS 托管引擎均验证生效）与“登录时启动 OutcomeGo（含静默启动到托盘）”。
- 用户可查看当前生效的性能资源配置并成功调整容器/引擎资源，异常时回滚无损。
- 用户在无全局透明代理的 Windows/macOS 环境下，通过本功能配置本地 HTTP/SOCKS5 代理后，一键测试通过，且服务端模型请求、网页搜索及托管引擎镜像拉取均成功走代理。
- 全部新增单元测试与核心集成测试通过，且不破坏现有远程连接与 Spec 012 一键部署流程。
