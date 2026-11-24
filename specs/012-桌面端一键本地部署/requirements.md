# 需求文档 - 桌面端一键本地部署

状态：Draft

关联文档：[设计文档](design.md)、[任务清单](tasks.md)、[现状核查记录](docs/20261123-现状核查记录.md)、[引擎方案对比与选型](docs/20261123-引擎方案对比与选型.md)

## 简介

当前在本机运行 OutcomeGo 服务端，需要用户先在终端安装 Docker Desktop，再粘贴 `curl | sh` 或 `install.ps1`（`docs/getting-started/installation.md`，`sign-in-flow.tsx` 的安装提示）。Windows 上的 Docker Desktop 依赖 WSL2，macOS 上也需要额外安装引擎，对普通用户门槛高。桌面端已内置 CLI 并能识别本机安装，但没有“在这台电脑部署”的动作，也没有 Docker 之外的引擎选择。

本 Spec 让 Windows 与 macOS 桌面端提供两种服务器来源：连接已有的远程服务器，或在这台电脑上一键部署。Linux 桌面端和所有服务器继续使用 Docker Engine。

服务对象：

- 没有运维经验、希望在自己电脑上直接使用 OutcomeGo 的个人用户。
- 已经拥有远程服务器、只想用桌面端连接的用户（行为不变）。
- 已经装有 Docker 兼容引擎的开发者（沿用其引擎，不被迫改用托管引擎）。

成功后的核心收益：普通用户不打开终端、不手工安装 Docker，也能在 Windows 或 macOS 上从“下载桌面端”走到“第一个机器人可用”。

## 术语表

- **System**：OutcomeGo 桌面端、CLI 和本地服务端组成的本地部署系统。
- **桌面端**：Electron 应用 `apps/desktop`。
- **远程服务器**：运行在其他主机上、桌面端通过地址连接的 OutcomeGo 服务端。
- **本地部署**：在桌面端所在电脑上运行 `deploy/compose.yaml` 描述的整套服务（postgres、server、worker、computer 等）。
- **栈**：名为 `outcomego` 的 Compose 项目及其全部容器。
- **引擎**：运行 Linux 容器的运行时，提供 Docker API 与 Compose 能力。
- **external 引擎**：用户自己安装的 Docker 兼容引擎，包括 Docker Desktop、Docker Engine、OrbStack、Colima、Rancher Desktop、Podman 的 Docker API。
- **managed 引擎**：由 OutcomeGo 安装和管理的引擎。Windows 上是私有 WSL2 发行版 `outcomego-engine`；macOS 上是基于 Apple Virtualization 的 Linux 虚拟机。
- **引擎提供者**：CLI 内对引擎的抽象，见 `design.md` §3.2.1。
- **部署向导**：桌面端中引导用户完成本地部署的界面流程。
- **进度事件**：`bootstrap` 命令按行输出的 JSON 事件，见 `design.md` §3.2.3。
- **bootstrap**：新增的非交互 CLI 命令，完成部署并创建 owner 账号，见 `design.md` §3.3.1。
- **安装目录**：保存 `installation.json`、`.env`、`compose.yaml` 的目录，Windows 为 `%LOCALAPPDATA%\OutcomeGo`，macOS 为 `~/.outcomego`。
- **owner 账号**：本地服务端的所有者账号，由 `owner-credentials` 创建。
- **CLI 载体**：实际运行 CLI 与更新代理的可执行文件，见 `design.md` §3.3.5。
- **托盘图标**：应用在系统状态区的图标。macOS 指菜单栏右侧的状态项，Windows 指任务栏的通知区域图标。
- **关窗常驻**：关闭主窗口时只隐藏窗口，应用进程、托盘图标、通知和本地服务继续运行。
- **退出应用**：应用进程真正结束，来源包括托盘菜单、应用菜单、系统关机或注销、桌面端自更新。关闭窗口不等于退出应用。
- **支持矩阵**：各平台、系统版本和 CPU 架构可使用哪种引擎，见 `design.md` §3.3.8。

## 范围说明

### In Scope

- 桌面端欢迎页与“设置 → 服务器”中的服务器来源选择：连接远程服务器，或在这台电脑部署。
- 桌面端内的一键本地部署：环境检测、引擎就绪、下载与校验、拉镜像、启动、健康检查、创建 owner、自动登录，含进度、取消、重试、失败诊断。
- CLI 的引擎提供者抽象、`external` 引擎、非交互 `bootstrap` 命令和结构化进度事件。
- Windows 与 macOS 的 `managed` 引擎。
- 本地服务生命周期：状态、启动、停止、移除、桌面端启动时恢复。
- 桌面端自更新与服务端更新代理的兼容。
- 内存、磁盘、端口等资源预检与默认值。
- 安全约束、错误诊断、文档与国际化。
- Windows 与 macOS 桌面端的托盘图标和关窗常驻。这会改变 Windows 现有的“关闭窗口即退出”行为，对所有 Windows 用户生效，不限于本地部署用户。
- 第三方组件的许可证登记、源码获取方式和发布前合规检查。

### Out of Scope

- 脱离容器、直接在宿主机运行服务端。
- Hyper-V 虚拟机后端。
- Linux 桌面端的 `managed` 引擎（Linux 继续使用 Docker Engine）。
- 本地部署与远程服务器之间的数据迁移。
- 本地部署向局域网或 Tailscale 暴露（继续使用现有 CLI 与设置，默认只监听 `127.0.0.1`）。
- Windows ARM64。已决定首期只支持 Windows x64，与现有 CLI 单文件二进制只构建 Windows x64 一致（`apps/cli/scripts/build-release-binaries.ts`）。ARM64 设备上仍可连接远程服务器。
- macOS 13.5 以下的托管引擎。这些系统上仍可使用已有的 Docker 兼容引擎或远程服务器。
- Linux 桌面端的托盘与关窗常驻，Linux 保持“关闭最后一个窗口即退出”。
- Android 与 iOS 客户端的本地部署。
- 修改 `deploy/compose.yaml` 的服务拓扑。

## 需求

### 需求 1：服务器来源选择入口

**用户故事：** 作为首次使用桌面端的用户，我希望在欢迎页直接选择“连接已有服务器”或“在这台电脑部署”，以便不需要打开终端。

#### 验收标准

1. WHEN 桌面端启动且没有已保存的服务器选择，且未检测到本机受管安装 THEN System SHALL 展示“连接已有服务器”和“在这台电脑部署”两个入口，并 SHALL 不再把终端安装命令作为唯一路径。
2. WHEN 检测到本机已有受管安装 THEN System SHALL 保持现有行为：显示本机服务在运行并直接连接，不重复部署。
3. WHEN 用户选择“连接已有服务器” THEN System SHALL 沿用现有 `endpoint` 流程、连接校验和已保存地址行为，不引入回归。
4. WHEN 用户在“设置 → 服务器”中查看 THEN System SHALL 显示当前服务器位置（本地或远程），以及本地服务的状态，并允许切换到另一种来源。
5. WHEN 用户从本地切换到远程再切回 THEN System SHALL 保留本地安装与数据，除非用户明确选择移除。

设计：`design.md` §2.2、§2.3.3、§3.3.3、§4.2。任务：3.2、3.3、3.4、3.5、3.8。

### 需求 2：一键本地部署主流程

**用户故事：** 作为没有运维经验的用户，我希望点一次按钮就完成本机服务端部署并登录，以便不需要理解容器和命令行。

#### 验收标准

1. WHEN 用户确认部署 THEN System SHALL 依次执行：环境检测、引擎就绪、下载并校验发布配置、生成配置、拉取镜像、启动栈、等待健康、创建 owner、自动登录，且全程无需终端。
2. WHEN 任一阶段进行中 THEN System SHALL 通过进度事件展示当前阶段、进度（可确定时给出百分比或 N/M，否则显示不确定态）和已用时间，并 SHALL 在点击后 2 秒内显示第一个事件。
3. WHEN 用户取消部署 THEN System SHALL 先让 CLI 终止当前阶段的子进程并有机会回滚，超时才强制终止进程树；System SHALL 保留已下载内容以便续传，并 SHALL 不留下会阻止下次部署的半成品安装。
4. WHEN 部署失败 THEN System SHALL 显示带稳定错误码的可操作原因，并提供“重试”；重试 SHALL 幂等地从失败阶段继续，不要求用户手工清理。
5. WHEN 部署成功 THEN System SHALL 用刚创建的 owner 账号自动连接本地服务，并进入现有的“选择 AI”和“创建第一个机器人”流程。
6. WHEN 本机的 API 端口（默认 8787）或屏幕端口段 6200–6299 被占用 THEN System SHALL 在拉取镜像之前指出占用者，并提供更换 API 端口的选项；屏幕端口段不可更换时 SHALL 说明需要释放。
7. WHEN 托管引擎首次部署需要拉取受支持的公开镜像 THEN System SHALL 并行探测官方源和多个预设的国内镜像源，优先使用同一摘要且实测传输更快的源。镜像源不可用或拉取失败时 SHALL 回退，优先复用本机已有的镜像。镜像加速 SHALL 保留签名配置和原始摘要，且不得修改全局 Docker 设置。

设计：`design.md` §2.3.1、§3.2.3、§3.3.1、§5。任务：2.4、2.5、3.1、3.4、3.8。

### 需求 3：非交互 CLI 部署接口

**用户故事：** 作为桌面端开发者，我希望有一个无需终端、输出结构化进度的 CLI 命令，以便桌面端可靠地驱动部署。

#### 验收标准

1. WHEN 调用 `outcomego bootstrap --json-progress` THEN System SHALL 不要求 TTY，把每个事件以单行 JSON 写到 stdout，把诊断文本写到 stderr。
2. WHEN 需要 owner 凭据 THEN System SHALL 只通过 stdin 的 JSON 接收，SHALL NOT 让凭据出现在命令行参数、环境变量、日志、进度事件或诊断信息中。
3. WHEN 命令结束 THEN System SHALL 用退出码区分：成功（0）、需要用户动作（2）、可重试的失败（3）、被取消（130）、其他错误（1）。其中 2 沿用现有“预检未通过”的含义。
4. WHEN 安装已存在且 owner 已配置 THEN System SHALL 幂等地启动并报告就绪，不覆盖已有 `.env` 与数据。
5. WHEN 用户使用现有的交互命令 `install`、`setup`、`update`、`status`、`doctor` 等 THEN System SHALL 保持原有行为，现有 CLI 测试全部通过。
6. WHEN 进度事件契约变更 THEN System SHALL 在事件中携带 `schemaVersion`；桌面端遇到不认识的版本 SHALL 提示更新应用，而不是崩溃或忽略错误。
7. WHEN stdin 缺失或格式错误，或 owner 用户名、密码不满足规则（用户名 3–30 位且只含字母、数字、短横线、下划线、点；密码 8–128 个字符）THEN System SHALL 在触碰安装目录之前以错误码 `INVALID_INPUT` 结束，用 `field` 指出出错字段，并 SHALL NOT 回显取值。

设计：`design.md` §3.2.3、§3.2.5、§3.3.1、§5.1、§5.2、§5.3、§6.1。任务：2.3、2.4、2.7。

### 需求 4：引擎提供者抽象与 external 引擎

**用户故事：** 作为已经装有 Docker 兼容引擎的用户，我希望桌面端直接使用我的引擎，以便不重复安装。

#### 验收标准

1. WHEN CLI 执行任何容器操作 THEN System SHALL 通过引擎提供者发起，包括 Compose 命令和 `docker ps`、`docker image`、`docker network` 等直接调用，不再写死 `docker`。
2. WHEN 检测到可用的 Docker 兼容引擎 THEN System SHALL 以 `docker info` 成功且 Compose 不低于 2.20 为判据，使用 `external` 引擎。
3. WHEN `external` 引擎已安装但未运行 THEN System SHALL 尝试启动（macOS 的 Docker Desktop 保持现有行为）或给出针对该引擎的指引，文案 SHALL 不再写死 Docker Desktop。
4. WHEN 存在多种可用引擎 THEN System SHALL 使用安装清单中记录的引擎，SHALL NOT 因环境变化静默切换引擎而导致找不到数据卷。
5. WHEN 运行在 Linux THEN System SHALL 只使用 `external` 引擎，行为与现状一致。
6. WHEN 引擎不满足 `computer` 容器的运行要求（例如不支持 `systempaths=unconfined`、cgroup v2 不可写）THEN System SHALL 在启动服务栈之前指出具体缺失项；可只读判断的项目在拉取前检查，必须进入容器才能验证的项目在已验证发布指定的 `computer` 镜像可用后隔离探测，不额外拉取探测镜像。

设计：`design.md` §3.2.1、§3.2.2、§3.3.2、§3.3.4、§4.1。任务：1.3、1.4、1.10、2.1、2.2、2.4、2.7、4.2、5.2。

### 需求 5：Windows 托管引擎

**用户故事：** 作为没有安装 Docker 的 Windows 用户，我希望桌面端自己准备好容器引擎，以便不需要安装 Docker Desktop。

#### 验收标准

1. WHEN Windows 上没有可用的 `external` 引擎 THEN System SHALL 提供“使用 OutcomeGo 托管引擎”，且不要求用户安装 Docker Desktop。
2. WHEN WSL 或虚拟机平台未启用 THEN System SHALL 说明原因，经用户同意后只用一次管理员授权启用；需要重启时 SHALL 保存状态，并在重启后用户下次打开桌面端时恢复向导，不自动启动桌面端。
3. WHEN 初始化引擎 THEN System SHALL 导入专用发行版 `outcomego-engine`，SHALL NOT 修改用户的 `.wslconfig` 或其他 WSL 发行版。
4. WHEN BIOS/UEFI 虚拟化未开启、Windows 版本过低或 CPU 架构不受支持 THEN System SHALL 检测并给出对应的具体指引，而不是通用失败。支持范围为 x64 的 Windows 10 22H2（build 19045）及以上、Windows 11 23H2（build 22631）及以上，见 `design.md` §3.3.8；ARM64 设备 SHALL 提示改用远程服务器。
5. WHEN 下载引擎资产 THEN System SHALL 在导入前校验固定的 SHA-256 和发布签名，校验失败 SHALL 拒绝使用。
6. WHEN 用户移除本地服务并选择删除数据 THEN System SHALL 注销 `outcomego-engine` 并回收磁盘，SHALL NOT 影响其他发行版。
7. WHEN 发布本需求 THEN System SHALL 已通过 Spike A 与 Spike B，证明 `computer` 容器在该引擎内可正常启动并运行；未通过则本需求不得发布。

设计：`design.md` §2.3.2、§3.3.4、§4.2、§8.2。任务：1.3、1.4、1.6、1.10、4.1、4.2、4.3、4.4、4.5。

### 需求 6：macOS 托管引擎

**用户故事：** 作为没有安装 Docker 的 macOS 用户，我希望桌面端自己准备好容器引擎，以便不需要安装任何额外软件。

#### 验收标准

1. WHEN macOS 上没有可用的 `external` 引擎 THEN System SHALL 提供基于 Apple Virtualization 的托管引擎。
2. WHEN macOS 版本或 CPU 架构不满足 THEN System SHALL 明确提示最低要求，不尝试安装。托管引擎最低要求 macOS 13.5，见 `design.md` §3.3.8；低于该版本的系统 SHALL 提示改用已有的 Docker 兼容引擎或远程服务器，应用本身的其他功能不受影响。
3. WHEN 引擎辅助二进制随应用分发 THEN System SHALL 完成签名、虚拟化 entitlement 与公证，并与现有 `package:mac-release` 流程兼容。
4. WHEN 虚拟机启动 THEN System SHALL 仅通过受控端口转发暴露 `127.0.0.1:8787` 与 `127.0.0.1:6200–6299`，SHALL NOT 监听 `0.0.0.0`。
5. WHEN 用户移除本地服务并选择删除数据 THEN System SHALL 删除专用虚拟机及其磁盘镜像。
6. WHEN 发布本需求 THEN System SHALL 已通过 Spike C，证明 `computer` 容器在该引擎内可正常启动并运行；未通过则本需求不得发布。

设计：`design.md` §3.3.4、§4.2、§8.2。任务：1.5、1.10、5.1、5.2、5.3、5.4。

### 需求 7：本地服务生命周期

**用户故事：** 作为本地部署的用户，我希望能在应用里看到服务状态并启动、停止、移除，以便不使用命令行也能管理。

#### 验收标准

1. WHEN 桌面端启动且为本地模式 THEN System SHALL 异步检测栈状态；栈已停止时 SHALL 自动启动并显示状态，且 SHALL NOT 阻塞首屏。
2. WHEN 用户在设置中点击启动或停止 THEN System SHALL 通过 CLI 执行并回显状态；操作期间 SHALL 互斥，重复点击不会并发执行。
3. WHEN 用户关闭窗口 THEN System SHALL 按需求 13 让应用留在后台，本地服务保持运行。WHEN 用户退出应用 THEN System SHALL 默认保持本地服务继续运行（产品决定，2026-11-23），并在设置中提供“退出应用时停止服务”开关，默认关闭。该开关为停止服务的唯一例外，关机与注销不触发它。
4. WHEN 宿主机重启 THEN System SHALL 在下次打开桌面端时恢复栈；System SHALL NOT 依赖 Windows 上并不存在的更新代理系统服务。
5. WHEN 用户选择移除 THEN System SHALL 区分“仅移除容器并保留数据”和“彻底删除（含数据卷）”；后者 SHALL 需要二次确认并说明不可恢复，对应 CLI 的 `uninstall --purge`。桌面端移除只针对服务与其数据，不卸载独立 CLI 载体；已移除的服务不在打开桌面端时自动重建。
6. WHEN 栈不健康 THEN System SHALL 展示服务级状态，并提供一键诊断，结果来自 `status` 与 `doctor`。

设计：`design.md` §2.3.3、§2.3.5、§2.3.6、§3.3.3、§3.3.7、§4.2。任务：3.3、3.5、3.6、3.7、3.8、4.2、4.5、5.2、5.4。

### 需求 8：更新兼容

**用户故事：** 作为本地部署的用户，我希望桌面端自更新和服务端更新都继续正常工作，以便不因为内置 CLI 而被卡在旧版本。

#### 验收标准

1. WHEN 桌面端自更新完成 THEN System SHALL 保证服务端更新代理仍指向存在且可执行的 CLI 载体，SHALL NOT 依赖带版本号的 `app.asar.unpacked` 路径。
2. WHEN 更新代理在 Windows 上常驻 THEN System SHALL NOT 占用桌面端自身的可执行文件而阻塞桌面自更新。
3. WHEN 服务端有新版本 THEN System SHALL 沿用现有“服务器更新”流程，本地模式下更新器可用。
4. WHEN 用户确认升级本机托管引擎资产 THEN System SHALL 先验证新资产、停栈并保留回滚点，再按原名称迁移卷；升级失败 SHALL 回到旧引擎，中断后可重试回退。
5. WHEN CLI 与桌面端版本不兼容 THEN System SHALL 检测并提示，沿用现有的版本兼容判断；独立载体须经发布校验后才可替换，不向准备进程传凭据。

设计：`design.md` §2.3.4、§3.3.5。任务：1.7、2.6、2.7、3.1、4.2、4.5、5.2、5.4。

### 需求 9：资源与容量

**用户故事：** 作为使用普通配置电脑的用户，我希望部署前就知道机器是否够用，以便不会装完才发现机器人频繁被杀。

#### 验收标准

1. WHEN 创建或启动托管引擎 THEN System SHALL 读取引擎客户机的实际内存，按 `design.md` §3.3.6 的公式计算并写入 `OUTCOMEGO_COMPUTER_MEMORY_LIMIT` 与 `OUTCOMEGO_DESKTOP_MEMORY_LIMIT`。
2. WHEN 引擎客户机内存低于最低配置（初始值 4 GiB，待 Spike F 校准）THEN System SHALL 警告并要求用户确认，SHALL NOT 静默安装。
3. WHEN 安装目录或适用的托管引擎资产目录所在文件系统可用磁盘空间不足 THEN System SHALL 在下载前阻止，并说明所需空间（初值 8 GiB，待 Spike F 校准）。
4. WHEN 用户在设置中调整本地服务内存 THEN System SHALL 重新生成 `.env`，并在提示“会中断进行中的任务”后重建 `computer` 与 `computer-memory-init`；超出已知客户机内存 75% 的设置须提示并按上限提交。
5. WHEN 在 Windows 上低内存 THEN System SHALL 只给出手工修改 `.wslconfig` 的说明，SHALL NOT 自行修改该文件。

设计：`design.md` §3.3.6。任务：1.8、2.5、2.7、3.5、4.4。

### 需求 10：安全与隔离

**用户故事：** 作为用户，我希望桌面端的本地部署不扩大我电脑的攻击面，以便放心使用。

#### 验收标准

1. WHEN 桌面端调用 CLI 执行写操作 THEN System SHALL 只管理 `canManageLocalInstallation` 命中的本机回环安装，SHALL NOT 对远程主机执行。
2. WHEN 处理 IPC 请求 THEN System SHALL 校验发送方与全部参数（类型、长度、格式）。
3. WHEN 记录日志、进度事件或诊断信息 THEN System SHALL 对密钥、令牌、密码脱敏。
4. WHEN 本地部署 THEN System SHALL 默认让 `OUTCOMEGO_BIND_HOST` 与 `OUTCOMEGO_VIEWER_BIND_HOST` 为 `127.0.0.1`；向局域网暴露 SHALL 仍需用户在现有设置中显式操作。
5. WHEN 下载引擎资产或 CLI 载体 THEN System SHALL 校验签名与摘要，失败则拒绝使用。
6. WHEN 需要管理员权限 THEN System SHALL 只对“启用 Windows 功能”一步提权，并事先说明用途。
7. WHEN 使用托管引擎 THEN System SHALL NOT 在宿主机上暴露无认证的 Docker TCP 接口。

设计：`design.md` §3.3.3、§3.3.4、§6.1、§6.4。任务：1.4、2.3、2.4、3.1、3.2、4.1、4.2、4.3、5.1、5.2。

### 需求 11：错误诊断与可观测

**用户故事：** 作为用户或支持人员，我希望失败时能看到明确原因和下一步，以便自己解决或快速求助。

#### 验收标准

1. WHEN 部署或生命周期操作失败 THEN System SHALL 返回稳定错误码、用户可读说明、建议动作和日志位置，错误码见 `design.md` §5.1。
2. WHEN 用户点击“复制诊断信息” THEN System SHALL 生成脱敏的诊断文本，包含系统与引擎信息、失败阶段、最近日志和 `doctor` 结果。
3. WHEN 部署进行 THEN System SHALL 把完整日志写入安装目录下的 `logs/`，并滚动保留。
4. WHEN 发生以下常见故障 THEN System SHALL 给出各自专属的提示：虚拟化未开启、WSL 未启用、端口被占用、磁盘不足、内存不足、网络不可达或镜像拉取失败、引擎未运行、被代理或安全软件拦截。

设计：`design.md` §5.1、§5.2、§5.3。任务：2.3、3.3、3.4、4.4、5.3、6.1。

### 需求 12：文档、国际化与兼容

**用户故事：** 作为现有用户，我希望新功能不改变我现在的使用方式，以便升级后一切照旧。

#### 验收标准

1. WHEN 发布 THEN System SHALL 更新 `docs/getting-started/installation.md`、`docs/manage/backups.md`（托管引擎的备份方式）和 `docs/manage/troubleshooting.md`。
2. WHEN 展示新增的界面与 CLI 文案 THEN System SHALL 接入现有的国际化机制，不留硬编码的单语言文案。
3. WHEN 用户是终端安装、Docker Engine 或远程服务器的现有用户 THEN System SHALL 保持其行为与升级路径不变。唯一有意的行为变更是 Windows 桌面端关闭窗口后不再退出（需求 13），System SHALL 在发布说明和文档中写明这一变更。
4. WHEN 每个里程碑发布前 THEN System SHALL 完成对应的端到端验收，并把结果记录到 `docs/acceptance-result.md`。

设计：`design.md` §1.5、§7。任务：3.6、3.8、4.5、5.4、6.1、6.2。

### 需求 13：托盘图标与关窗常驻

**用户故事：** 作为 Windows 或 macOS 用户，我希望关闭窗口后应用继续在后台运行并留有托盘图标，以便本地服务和通知不被打断，需要时一键唤回。

背景：核查（2026-11-23）发现桌面端目前没有任何托盘图标，仓库中不存在 `new Tray`。macOS 关闭窗口只是隐藏窗口，Dock 图标保留（`apps/desktop/src/main/index.ts` 的 `mainWindow.on("close", …)`）；Windows 关闭窗口会直接退出，因为 `app.on("window-all-closed", …)` 只在 macOS 上保留进程。

#### 验收标准

1. WHEN 桌面端在 Windows 或 macOS 上运行 THEN System SHALL 显示托盘图标：macOS 在菜单栏，Windows 在任务栏通知区域。图标在应用运行期间始终存在，与窗口是否可见无关。
2. WHEN 用户关闭主窗口 THEN System SHALL 只隐藏窗口，应用进程、托盘图标、通知、后台任务和本地服务继续运行。此行为 SHALL 在 Windows 与 macOS 上一致。
3. WHEN 用户点击托盘图标或选择菜单中的“打开 OutcomeGo” THEN System SHALL 显示并聚焦主窗口。WHEN 用户再次启动应用 THEN System SHALL 通过现有单实例机制唤回已隐藏的窗口，不启动第二个进程。
4. WHEN 用户打开托盘菜单 THEN System SHALL 提供：打开 OutcomeGo、本地服务（仅本地模式：显示状态，并提供启动或停止）、退出。远程模式下 SHALL 不显示本地服务项。
5. WHEN 用户选择托盘菜单的“退出” THEN System SHALL 完全结束应用进程。WHEN 本地模式且“退出应用时停止服务”关闭 THEN 菜单项文案 SHALL 说明本地服务将继续运行。
6. WHEN 用户第一次关闭窗口 THEN System SHALL 显示一次性提示，说明应用仍在后台运行以及如何退出，之后不再重复。
7. WHEN 系统关机、重启或用户注销，或桌面端自更新要求退出 THEN System SHALL NOT 因关窗隐藏逻辑而阻止或延迟这些操作。Windows 上不会触发 `before-quit` 的关机与注销路径 SHALL 被显式处理。
8. WHEN 系统切换浅色与深色外观，或在高分辨率屏幕上 THEN 托盘图标 SHALL 保持清晰可辨：macOS 使用模板图标，Windows 使用 `.ico`。
9. WHEN 运行在 Linux THEN System SHALL 保持现有行为，不显示托盘图标。

设计：`design.md` §2.3.6、§3.3.7、§6.9。任务：3.6、3.7、3.8、6.1。

### 需求 14：第三方组件合规

**用户故事：** 作为项目维护者，我希望随产品分发或安装时下载的第三方组件都有明确的许可证登记和源码获取方式，以便合规发布。

背景：仓库根目录许可证为 `GPL-3.0-only`。候选引擎组件（Lima、Moby、Docker CLI、Compose、containerd、runc、vfkit）为 Apache-2.0，可与 GPLv3 项目共存；难点是托管引擎的 rootfs 与虚拟机镜像含有 GPL 类组件，在自有 Release 中提供即构成分发。详见《许可证评估与建议》。

#### 验收标准

1. WHEN 发布包含托管引擎的版本 THEN System SHALL 提供仓库级 `THIRD-PARTY-NOTICES`，登记每个随发布分发或安装时下载的第三方组件的名称、版本、许可证与来源，并附 Apache-2.0 组件的 NOTICE 内容。
2. WHEN 在自有 Release 中提供 rootfs、虚拟机镜像等含 GPL 类组件的资产 THEN System SHALL 同时提供对应源码的获取方式，并在资产旁写明位置，保持可用至少三年。
3. WHEN 选定托管引擎的组成 THEN System SHALL NOT 使用或要求安装 Docker Desktop 等专有软件作为引擎。
4. WHEN 界面或文档提到 Docker、Moby、Lima 等第三方产品名称 THEN System SHALL 仅用于描述兼容性，不用作本产品或引擎的名称。
5. WHEN 新增或升级第三方二进制 THEN System SHALL 在发布流程中检查 `THIRD-PARTY-NOTICES` 已同步更新。
6. WHEN 公开发布托管引擎资产之前 THEN System SHALL 已取得法务对《许可证评估与建议》§6 所列问题的确认；未确认则 SHALL NOT 公开发布。

设计：`design.md` §3.3.4、§3.3.9、§6.10、§8.2 Q11。任务：1.9、4.1、5.1、6.1、6.2。

## 非功能需求

### 非功能需求 1：性能

1. WHEN 用户确认部署 THEN System SHALL 在 2 秒内显示第一个进度事件。
2. WHEN 桌面端启动 THEN System SHALL 在后台检测本地栈状态，首屏渲染不受影响。
3. WHEN 部署被中断后重试 THEN System SHALL 复用已下载的引擎资产与镜像层，不重复下载。
4. WHEN 完成 Spike F THEN System SHALL 记录首次部署耗时基线，作为后续性能目标的依据；基线之前不设定总耗时指标。

设计：`design.md` §2.3.1、§3.3.1、§7.3。任务：1.8、2.4、3.7、3.8。

### 非功能需求 2：可靠性

1. WHEN 部署的任一阶段中进程被终止、断电或断网 THEN System SHALL 在再次点击部署时收敛到可用状态，不丢失已有数据，不需要手工清理。
2. WHEN 同一安装目录同时发起多个变更类操作 THEN System SHALL 只允许一个执行，其余返回“忙碌”。
3. WHEN 引擎或网络依赖异常 THEN System SHALL 失败并保留已完成的步骤，给出可重试的明确提示。

设计：`design.md` §4.2、§5.3、§6.3、§6.5、§6.8。任务：2.4、3.1、4.3。

### 非功能需求 3：可维护性

1. WHEN 新增一种引擎实现 THEN System SHALL 只新增提供者实现，不修改调用方。
2. WHEN 调整进度事件 THEN System SHALL 通过 `schemaVersion` 向后兼容。
3. WHEN 排查问题 THEN System SHALL 能从 `logs/` 和诊断文本还原失败阶段、引擎类型和版本。

设计：`design.md` §3.2.1、§3.2.3、§5.2、§7.4。任务：2.1、2.3、3.3。

## 成功定义

- 已装 Docker 兼容引擎的 Windows 与 macOS 上，桌面端点一次按钮即可部署并登录，全程无需终端（M1）。
- 仅有 WSL 能力的干净 Windows 11、没装 Docker 的 macOS 上，同样可用（M2、M3）。
- 单个机器人的普通办公任务在托管引擎上跑通，内存默认值有实测依据（Spike F）。
- 终端安装、Linux、远程服务器用户的既有测试和行为无回归，Windows 关窗常驻这一有意变更除外且已在发布说明中写明。
- 关闭窗口后应用留在托盘，本地服务继续运行，且不阻止系统关机或桌面端自更新（需求 13）。
- 随发布分发的第三方组件均已登记，含 GPL 类组件的资产带有源码获取方式，法务已确认（需求 14）。
- 每条验收标准都能在 `design.md` §7.4 和 `tasks.md` 中找到对应的设计与验证方式。
