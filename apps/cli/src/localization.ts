import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "@outcomego/contracts/localization";

/**
 * Interface language for the CLI.
 *
 * Only an explicit opt-in is honoured — `--language` (which sets
 * `OUTCOMEGO_LANGUAGE`) or that variable directly. Ambient `LANG`/`LC_ALL` is
 * deliberately ignored so scripts, piping, and test runs keep stable English
 * output; the interface language is a user choice, not an OS side effect.
 */
export const cliLocale = (value?: string): Locale =>
  normalizeLocale(value ?? process.env.OUTCOMEGO_LANGUAGE ?? DEFAULT_LOCALE);

type Values = Record<string, string | number>;

const interpolate = (text: string, values?: Values): string =>
  values
    ? text.replace(/\{(\w+)\}/g, (_, key: string) =>
        key in values ? String(values[key] ?? "") : `{${key}}`
      )
    : text;

/** English source string → Simplified Chinese. Keys are the English text itself. */
const simplifiedChinese: Record<string, string> = {
  "Enable virtualization in your firmware, then retry.": "请在固件设置中开启虚拟化，再重试。",
  "Enable WSL before deploying the managed engine.": "请先启用 WSL，再部署托管引擎。",
  "Allow the system change or use an existing engine.": "请允许系统变更，或使用已有引擎。",
  "Start a local Docker-compatible engine and retry.": "请启动本机兼容 Docker 的引擎，再重试。",
  "The engine did not start. Check diagnostics and retry.": "引擎未启动，请查看诊断后重试。",
  "This engine lacks capabilities required by OutcomeGo.": "此引擎缺少 OutcomeGo 所需能力。",
  "Download failed. Check your connection or proxy and retry.": "下载失败，请检查网络或代理后重试。",
  "Required engine release file is missing.": "缺少必需的引擎发布文件。",
  "The release could not be verified. Retry the download.": "无法验证发布资产，请重新下载。",
  "Free the occupied port or choose another API port.": "请释放被占用的端口，或选择另一个 API 端口。",
  "Free disk space before retrying deployment.": "请释放磁盘空间后重试。",
  "Available memory is low. Add memory or confirm you want to continue.": "可用内存不足，请增加内存或确认继续。",
  "Image download failed. Check your connection and retry.": "镜像下载失败，请检查网络后重试。",
  "Local services could not start. Check diagnostics and retry.": "本地服务未能启动，请查看诊断后重试。",
  "Local services did not become healthy. Check diagnostics and retry.": "本地服务未通过健康检查，请查看诊断后重试。",
  "The owner account could not be created. Check your credentials and retry.": "未能创建管理员账户，请检查输入后重试。",
  "A local service operation is already running.": "已有本地服务操作正在进行。",
  "Update the desktop app to use a compatible command-line tool.": "请更新桌面应用，以使用兼容的命令行工具。",
  "Deployment cancelled.": "部署已取消。",
  "Deployment did not finish. Copy diagnostics and retry.": "部署未完成，请复制诊断信息并重试。",
  "Supply container CLI arguments after --.": "请在 -- 后提供容器命令参数。",
  "Unknown engine command; use status, start, stop, remove, or docker.": "未知引擎命令，请使用 status、start、stop、remove 或 docker。",
  "Managed deployment requires Windows x64 (Windows 10 22H2 or Windows 11 23H2 or later). Connect to an existing server on unsupported hardware.": "托管部署要求 Windows x64（Windows 10 22H2、Windows 11 23H2 或更高版本）。设备不受支持时，请连接已有服务器。",
  "Managed deployment requires macOS 13.5 or later on Apple Silicon or Intel. Use an existing container engine or server instead.": "托管部署要求 Apple Silicon 或 Intel Mac 运行 macOS 13.5 或更高版本。也可使用已有引擎或连接服务器。",
  "Restart your computer, then reopen OutcomeGo to continue deployment.": "请重启电脑，然后重新打开 OutcomeGo 继续部署。",
  "Windows could not report the WSL status.": "Windows 无法报告 WSL 状态。",
  "The managed engine requires WSL 2.": "托管引擎需要 WSL 2。",
  "Engine recovery is pending. Run outcomego engine rollback --yes for this installation.": "托管引擎等待恢复。请对该安装运行 outcomego engine rollback --yes。",
  "Engine operation completed. Recovery files were retained at {path}.": "引擎操作已完成。恢复文件保留在 {path}。",
  "Engine upgrade requires private Compose volumes without custom drivers or mounts.": "升级引擎只支持本安装的 Compose 数据卷，不支持自定义驱动或挂载。",
  "The managed WSL engine requires NAT networking. Use an existing container engine or server if NAT is unavailable.": "WSL 托管引擎需要 NAT 网络。无法使用 NAT 时，请改用已有容器引擎或服务器。",
  "The managed engine could not verify ownership of outcomego-engine.": "无法确认 outcomego-engine 的归属。",
  "The managed virtual machine could not report its state.": "托管虚拟机无法报告状态。",
  "Retry with the original API port: {port}.": "请使用原 API 端口 {port} 重试。",
  "The selected container engine is unavailable on this host.": "此主机无法使用所选的容器引擎。",
  "The recorded engine of an existing installation cannot be changed.": "不能更改现有安装已记录的容器引擎。",
  "Install or repair a Docker-compatible container engine and its CLI.": "请安装或修复兼容 Docker 的容器引擎及其命令行工具。",
  "Start your container engine or check the current Docker connection.": "请启动容器引擎或检查当前的 Docker 连接。",
  "The container engine did not report its capabilities as JSON.": "容器引擎没有以 JSON 格式报告其能力。",
  "Install or update Compose to {version} or newer.": "请安装 Compose {version} 或更高版本，或升级现有版本。",
  "The container engine must report Linux container support.": "容器引擎必须支持 Linux 容器。",
  "The container engine must report cgroup v2 support.": "容器引擎必须支持 cgroup v2。",
  "OutcomeGo requires a rootful container engine.": "OutcomeGo 需要以 root 权限运行的容器引擎。",
  "Docker-compatible engine": "兼容 Docker 的引擎",
  "Unknown engine command; use status.": "未知的引擎命令；请使用 status。",
  "Unknown resources command; use set.": "未知的资源命令；请使用 set。",
  "The desktop app requires a compatible CLI version.": "桌面应用需要兼容版本的命令行工具。",
  "Preparing local deployment.": "正在准备本机部署。",
  "The deployment input is invalid.": "部署输入不合规。",
  "The verified release does not specify valid deployment images.": "已验证的发布配置未指定有效的部署镜像。",
  "Local deployment requires loopback bindings.": "本机部署要求端口只绑定到回环地址。",
  "Local deployment requires a local Docker socket or named pipe.": "本机部署要求使用本机 Docker 套接字或命名管道。",
  "The Compose project name is already used by another installation.": "该 Compose 项目名称已被其他安装使用。",
  "Choose an API port outside the screen-viewer port range.": "请选择不在屏幕查看端口段内的 API 端口。",
  "The engine is missing required capabilities: {capabilities}.": "引擎缺少所需能力：{capabilities}。",
  "The engine capability probe could not finish.": "引擎能力探测未能完成。",
  "The pulled computer image is not available by its verified digest.": "无法按已验证的摘要找到拉取的电脑镜像。",
  "Pulling {service} from {registry}.": "正在从 {registry} 拉取 {service}。",
  "Image pull failed from {registry}.": "从 {registry} 拉取镜像失败。",
  "Automatic server updates could not be enabled.": "未能启用服务器自动更新。",
  "Automatic engine startup at sign-in could not be enabled.": "未能启用登录时自动启动引擎。",
  "Both memory limits must be integer sizes of at least 16 MiB (for example 4g or 3584m).": "两个内存上限都必须是不小于 16 MiB 的整数大小，例如 4g 或 3584m。",
  "Changing memory limits restarts the computer services and interrupts running tasks.": "更改内存上限会重启电脑服务，并中断进行中的任务。",
  "Only {available} is available near {directory}; deployment needs {required}.": "{directory} 所在磁盘仅有 {available} 可用空间；部署需要 {required}。",
  "Your computer has {available} of memory; {required} is recommended.": "此电脑有 {available} 内存；建议至少 {required}。",
  "The engine has {available} of memory; deployment recommends at least {required}.": "引擎有 {available} 内存；部署建议至少 {required}。",
  "Port {port} on {address} is already in use by {container}.": "{address} 上的端口 {port} 已被 {container} 占用。",
  "Port {port} on {address} is already in use by another local process.": "{address} 上的端口 {port} 已被其他本机进程占用。",
  "Free port {port} or choose another API port.": "请释放端口 {port} 或选择其他 API 端口。",
  "Free port {port}; the screen-viewer port range cannot be changed here.": "请释放端口 {port}；此处不能更改屏幕查看端口段。",
  "Install Docker Engine and the Compose plugin: https://docs.docker.com/engine/install/":
    "请安装 Docker Engine 和 Compose 插件：https://docs.docker.com/engine/install/",
  "Install a Docker-compatible engine with Compose. Docker Desktop is one option: https://www.docker.com/products/docker-desktop/":
    "请安装兼容 Docker 且支持 Compose 的引擎。也可选择安装 Docker Desktop：https://www.docker.com/products/docker-desktop/",
  "Open a new terminal and run docker --version. If the engine is already installed, check that the docker command is on PATH and check the executable's permissions.":
    "请打开新终端并运行 docker --version。如果已安装引擎，请检查 docker 是否在 PATH 中，并检查可执行文件权限。",
  "Start your Docker-compatible engine and run docker info. Check the selected Docker context if it still fails.":
    "请启动兼容 Docker 的引擎并运行 docker info。如果仍然失败，请检查当前 Docker context。",
  "Start your Docker runtime with colima start (using the selected profile), then run docker info.":
    "请用 colima start 启动所选配置，再运行 docker info。",
  "Start your Docker runtime by opening OrbStack, then run docker info.":
    "请打开 OrbStack 启动引擎，再运行 docker info。",
  "Start your Docker runtime by opening Rancher Desktop, then run docker info.":
    "请打开 Rancher Desktop 启动引擎，再运行 docker info。",
  "Start your Docker runtime with podman machine start or start your Podman API service, then run docker info.":
    "请运行 podman machine start 或启动 Podman API 服务，再运行 docker info。",
  "Show container health and server readiness": "显示容器健康状态和服务器就绪状态",
  "Check for installation problems": "检查安装问题",
  "Install the latest OutcomeGo release": "安装最新的 OutcomeGo 版本",
  "Configure private HTTPS with Tailscale": "使用 Tailscale 配置私有 HTTPS",
  "Manage AI accounts and connections": "管理 AI 账户和连接",
  "Choose inference and transcription models": "选择推理和转写模型",
  "Change your username or password": "更改用户名或密码",
  "View troubleshooting logs": "查看故障排查日志",
  "Stop OutcomeGo": "停止 OutcomeGo",
  "Start OutcomeGo after account setup": "账户设置后启动 OutcomeGo",
  "Remove OutcomeGo services and CLI": "移除 OutcomeGo 服务和 CLI",
  "Install OutcomeGo and run guided setup": "安装 OutcomeGo 并运行引导式设置",
  "Set up or change the connection and account": "设置或更改连接与账户",
  "Configure iOS push credentials or show their status": "配置 iOS 推送凭据或查看其状态",
  Healthy: "健康",
  Running: "运行中",
  Stopped: "已停止",
  Stopping: "正在停止",
  Starting: "正在启动",
  Unhealthy: "不健康",
  Unknown: "未知",
  Ready: "就绪",
  "Not ready": "未就绪",
  Version: "版本",
  Status: "状态",
  Address: "地址",
  Data: "数据",
  Server: "服务器",
  Services: "服务",
  Account: "账户",
  Username: "用户名",
  Password: "密码",
  Model: "模型",
  Provider: "服务商",
  Doctor: "诊断",
  CLI: "CLI",
  Problems: "问题",
  Warnings: "警告",
  Warning: "警告",
  Passed: "通过",
  Failed: "失败",
  Skipped: "已跳过",
  "All checks passed": "所有检查均已通过",
  "No problems found": "未发现问题",
  "Check again": "重新检查",
  "Run outcomego doctor to see what needs attention": "运行 outcomego doctor 查看需要处理的问题",

  // status
  "Completed · exit 0": "已完成 · 退出码 0",
  "Created; not started": "已创建；未启动",
  Restarting: "正在重启",
  Paused: "已暂停",
  Dead: "已终止",
  "Being removed": "正在移除",
  "Unknown state: {state}": "未知状态：{state}",
  "not reported": "未报告",
  "setup in progress": "设置进行中",
  healthy: "健康",
  "health check starting": "健康检查启动中",
  "health check failing": "健康检查失败",
  "no Docker health check": "无 Docker 健康检查",
  "health: {health}": "健康状态：{health}",
  "exit code not reported": "未报告退出码",
  "exit {code}": "退出码 {code}",
  "{running}/{total} containers running · {healthy} passing Docker health checks":
    "{running}/{total} 个容器正在运行 · {healthy} 个通过 Docker 健康检查",
  "Container state could not be checked.": "无法检查容器状态。",
  Next: "下一步",
  "Next steps": "后续步骤",
  "For a deeper check:": "如需更深入的检查：",
  "Recommended action:": "建议操作：",
  "Check blocked": "检查受阻",
  Containers: "容器",
  "Not checked. Resolve the issue above, then run status again.":
    "未检查。请先解决上述问题，然后再次运行 status。",
  "Not created": "未创建",
  "Setup jobs": "设置任务",
  "Setup jobs finish and stop normally; exit 0 means success.":
    "设置任务会正常结束并停止；退出码 0 表示成功。",
  Readiness: "就绪状态",
  "Ready · responding with the installed release": "就绪 · 已安装版本正常响应",
  "Cannot reach the server: {detail}": "无法连接服务器：{detail}",
  "Not checked": "未检查",
  "Checked at": "检查地址",
  "Queue database": "队列数据库",
  Database: "数据库",
  "Computer API": "电脑 API",
  "AI model": "AI 模型",
  Connected: "已连接",
  "Not connected · connect one in the OutcomeGo app": "未连接 · 请在 OutcomeGo 应用中连接",
  "Not ready ({status}) · check it in the OutcomeGo app":
    "未就绪（{status}）· 请在 OutcomeGo 应用中检查",
  Connection: "连接",
  Access: "访问方式",
  "Compose project": "Compose 项目",
  Installation: "安装",
  "NOT INSTALLED": "未安装",
  "STATUS UNKNOWN": "状态未知",
  "NEEDS ATTENTION": "需要处理",
  STOPPED: "已停止",
  STARTING: "正在启动",
  RUNNING: "运行中",
  "Not configured": "未配置",
  "OutcomeGo has not been installed in this directory.": "此目录中尚未安装 OutcomeGo。",
  "Install OutcomeGo, or use --dir to select an existing installation.":
    "安装 OutcomeGo，或使用 --dir 选择已有安装。",
  "Some installation files are missing.": "部分安装文件缺失。",
  "Check that --dir selects the right installation. Restore missing files from a known-good backup, then run {command}.":
    "请确认 --dir 指向正确的安装。从可信备份恢复缺失的文件，然后运行 {command}。",
  "Missing: {files}": "缺失：{files}",
  "OutcomeGo's installation configuration could not be read.": "无法读取 OutcomeGo 的安装配置。",
  "Check file access and restore damaged configuration from a known-good backup. Run {command} for details.":
    "请检查文件访问权限，并从可信备份恢复损坏的配置。运行 {command} 查看详情。",
  "Run {command} on the server host.": "请在服务器主机上运行 {command}。",
  "Docker Compose is too old or its version is unknown: {version}":
    "Docker Compose 版本过旧或无法确定：{version}",
  "Docker Compose could not run.": "无法运行 Docker Compose。",
  "Install or update Compose to {version} or newer for your container engine. Verify with docker compose version (or docker-compose version).":
    "请为当前容器引擎安装或升级 Compose 到 {version} 或更高版本。用 docker compose version（或 docker-compose version）验证。",
  "OutcomeGo could not read its container states.": "OutcomeGo 无法读取容器状态。",
  "Run docker info to check the engine, then {command} to inspect Compose and configuration errors.":
    "运行 docker info 检查引擎，然后运行 {command} 查看 Compose 和配置错误。",
  "Resolve the server port conflict before starting this installation. Inspect the configuration with:":
    "请先解决服务器端口冲突，再启动此安装。使用以下命令检查配置：",
  "Inspect {service} logs to find why it is not ready. For a deeper diagnosis, run {command}.":
    "查看 {service} 日志以找出未就绪的原因。如需更深入的诊断，请运行 {command}。",
  "Setup or health checks are still in progress. Wait a moment and check again. If this persists, run {command}.":
    "设置或健康检查仍在进行中。请稍候再检查。如果问题持续，请运行 {command}。",
  "Finish account setup before using OutcomeGo:": "请先完成账户设置，再使用 OutcomeGo：",
  "Start the missing or stopped services, then check status again:":
    "启动缺失或已停止的服务，然后再次检查状态：",
  "The server cannot use its database or job queues. Inspect database logs, then run {command} to check schema setup and queue processing.":
    "服务器无法使用其数据库或任务队列。请查看数据库日志，然后运行 {command} 检查数据结构设置和队列处理。",
  "The computer service is not ready or rejected the server's credentials. Inspect its logs, then run {command} to check the connection and workspace.":
    "电脑服务未就绪，或拒绝了服务器的凭据。请查看其日志，然后运行 {command} 检查连接和工作区。",
  "Containers are running, but the server is not ready. Check server logs; run {command} for a deeper diagnosis.":
    "容器正在运行，但服务器未就绪。请查看服务器日志；运行 {command} 进行更深入的诊断。",
  "Containers and server are ready. Connect a model in the OutcomeGo app under Settings → Server before starting AI tasks. On a server without the app, run:":
    "容器和服务器均已就绪。开始 AI 任务前，请在 OutcomeGo 应用的“设置 → 服务器”中连接模型。在没有该应用的服务器上，请运行：",
  "For deeper database, queue, storage, and model checks:":
    "如需更深入的数据库、队列、存储和模型检查：",
  "OutcomeGo is not healthy: {detail}": "OutcomeGo 状态不健康：{detail}",
  "OutcomeGo services need attention.": "OutcomeGo 服务需要处理。",

  // doctor
  "Install the OutcomeGo server on an x64 or arm64 host.":
    "请在 x64 或 arm64 主机上安装 OutcomeGo 服务器。",
  "Use a host with at least 8 GiB of RAM for the OutcomeGo server.":
    "请使用至少有 8 GiB 内存的主机运行 OutcomeGo 服务器。",
  "Free space on the installation disk. For a new installation, choose a disk with more space using outcomego install --dir <path>.":
    "请释放安装磁盘的空间。如需全新安装，请用 outcomego install --dir <path> 选择空间更大的磁盘。",
  "Check that your user can write to the reported directory, or choose a writable directory with outcomego install --dir <path>.":
    "请确认你的用户可写入所报告的目录，或用 outcomego install --dir <path> 选择可写目录。",
  "Install or repair Docker, then open a new terminal and run docker --version.":
    "请安装或修复 Docker，然后打开新的终端运行 docker --version。",
  "Start your Docker runtime and wait for its engine to be ready. Run docker info; if it fails, inspect docker context ls and any DOCKER_HOST or DOCKER_CONTEXT overrides.":
    "请启动 Docker 运行时并等待其引擎就绪。运行 docker info；如果失败，请检查 docker context ls 以及 DOCKER_HOST 或 DOCKER_CONTEXT 覆盖设置。",
  "Restore the missing or invalid installation files from a known-good backup, or use outcomego install --dir <path> for a separate new installation.":
    "请从可信备份恢复缺失或无效的安装文件，或用 outcomego install --dir <path> 单独进行全新安装。",
  "Identify which application is using the reported port. Stop it if appropriate, or choose another API port during guided installation or outcomego setup; the screen-viewer ports must be available.":
    "请查明哪个应用占用了所报告的端口。如合适请停止它，或在引导安装或 outcomego setup 中选择其他 API 端口；屏幕查看端口必须可用。",
  "Restrict the reported configuration file to owner-only access before starting OutcomeGo.":
    "启动 OutcomeGo 前，请将所报告的配置文件限制为仅所有者可访问。",
  "Restore the missing or invalid secrets from a known-good installation backup; the database and service credentials must remain consistent.":
    "请从可信的安装备份恢复缺失或无效的密钥；数据库和服务凭据必须保持一致。",
  "Correct the reported error in the installation's configuration files, or restore them from a known-good backup before starting OutcomeGo.":
    "请修正安装配置文件中报告的错误，或在启动 OutcomeGo 前从可信备份恢复这些文件。",
  "Run outcomego setup to create your account.": "运行 outcomego setup 创建你的账户。",
  "Run outcomego setup to repair the access mode, public URL, and bind addresses.":
    "运行 outcomego setup 修复访问方式、公开 URL 和绑定地址。",
  "Keep plain HTTP on a trusted LAN or VPN. For access from anywhere, choose an HTTPS connection with outcomego setup.":
    "请仅在可信局域网或 VPN 中使用明文 HTTP。如需随处访问，请用 outcomego setup 选择 HTTPS 连接。",
  "Docker could not list the services. Run docker info, then inspect the reported Compose error before trying outcomego status again.":
    "Docker 无法列出服务。请运行 docker info，查看所报告的 Compose 错误，然后再次尝试 outcomego status。",
  "Run outcomego start to start the missing services. If startup fails, inspect outcomego logs.":
    "运行 outcomego start 启动缺失的服务。如果启动失败，请查看 outcomego logs。",
  "Run outcomego status to check which server release is running. Verify the API port belongs to this installation before using outcomego update to align its release.":
    "运行 outcomego status 查看正在运行的服务端版本。使用 outcomego update 对齐版本前，请确认 API 端口属于此安装。",
  "Identify the OutcomeGo instance using the reported API port. Use the intended installation's --dir path, or choose an unused API port in outcomego setup.":
    "请查明占用所报告 API 端口的 OutcomeGo 实例。使用目标安装的 --dir 路径，或在 outcomego setup 中选择未使用的 API 端口。",
  "Run outcomego status and inspect outcomego logs for unhealthy or stopped services; resolve the reported startup or connection error.":
    "运行 outcomego status 并查看 outcomego logs，找出不健康或已停止的服务；解决所报告的启动或连接错误。",
  "Inspect outcomego logs migrate and outcomego logs postgres for database startup or migration errors.":
    "查看 outcomego logs migrate 和 outcomego logs postgres，排查数据库启动或迁移错误。",
  "Inspect outcomego logs computer and confirm the worker and computer use the same installation control token.":
    "查看 outcomego logs computer，并确认 worker 和 computer 使用同一安装的控制令牌。",
  "Check the worker's agent and asset volume permissions. The worker must be able to read and write both volumes.":
    "请检查 worker 的 agent 卷和资源卷权限。worker 必须能读写这两个卷。",
  "Inspect outcomego logs postgres and outcomego logs migrate; the worker needs the application tables and job queues.":
    "查看 outcomego logs postgres 和 outcomego logs migrate；worker 需要应用数据表和任务队列。",
  "Inspect outcomego logs worker for stalled jobs, expired leases, or database connection errors.":
    "查看 outcomego logs worker，排查停滞任务、过期租约或数据库连接错误。",
  "The computer rejected the server's credentials. Check that both services use the installation's OUTCOMEGO_CONTROL_TOKEN, then recreate the affected service with the corrected configuration.":
    "computer 拒绝了服务器的凭据。请确认两个服务都使用此安装的 OUTCOMEGO_CONTROL_TOKEN，然后用修正后的配置重新创建受影响的服务。",
  "Inspect outcomego logs computer for startup or connection errors.":
    "查看 outcomego logs computer，排查启动或连接错误。",
  "Check that the public hostname resolves to this server's reachable address, then retry after the DNS change has propagated.":
    "请确认公开主机名解析到此服务器的可达地址，待 DNS 变更生效后重试。",
  "Check the public hostname and certificate on your HTTPS proxy. For bundled HTTPS, inspect outcomego logs caddy and verify inbound ports 80 and 443 are reachable.":
    "请检查 HTTPS 代理上的公开主机名和证书。使用内置 HTTPS 时，查看 outcomego logs caddy，并确认入站端口 80 和 443 可访问。",
  "Check the public URL, firewall, and reverse proxy; verify the proxy forwards HTTP and WebSocket traffic to OutcomeGo's configured API port.":
    "请检查公开 URL、防火墙和反向代理；确认代理将 HTTP 和 WebSocket 流量转发到 OutcomeGo 配置的 API 端口。",
  "Check the model provider's quota or billing, or wait for its rate limit to reset. To switch models, use Settings → Server in the OutcomeGo app, or run outcomego model.":
    "请检查模型服务商的配额或计费，或等待其速率限制重置。如需切换模型，请在 OutcomeGo 应用的“设置 → 服务器”中操作，或运行 outcomego model。",
  "Reconnect the provider in the OutcomeGo app under Settings → Server. On a server without the app, run outcomego model.":
    "请在 OutcomeGo 应用的“设置 → 服务器”中重新连接服务商。在没有该应用的服务器上，请运行 outcomego model。",
  "Check network access from the server and computer services to the model provider, including proxy or VPN settings. Inspect outcomego logs computer and retry outcomego doctor.":
    "请检查服务器和 computer 服务到模型服务商的网络访问，包括代理或 VPN 设置。查看 outcomego logs computer 后重试 outcomego doctor。",
  "Choose an available model in the OutcomeGo app under Settings → Server. On a server without the app, run outcomego model list to see the models this account can use.":
    "请在 OutcomeGo 应用的“设置 → 服务器”中选择可用模型。在没有该应用的服务器上，运行 outcomego model list 查看此账户可用的模型。",
  "Connect a model in the OutcomeGo app under Settings → Server. On a server without the app, run outcomego model.":
    "请在 OutcomeGo 应用的“设置 → 服务器”中连接模型。在没有该应用的服务器上，请运行 outcomego model。",
  "Check the model connection in the OutcomeGo app under Settings → Server. On a server without the app, run outcomego provider list and outcomego model list.":
    "请在 OutcomeGo 应用的“设置 → 服务器”中检查模型连接。在没有该应用的服务器上，运行 outcomego provider list 和 outcomego model list。",
  "Run outcomego status and check the server connection and installation control token. Inspect outcomego logs server before testing transcription again.":
    "运行 outcomego status，检查服务器连接和安装控制令牌。再次测试转写前，请查看 outcomego logs server。",
  "Open Settings → Server → Transcription, check the provider URL, model and key, then use Test connection.":
    "请打开“设置 → 服务器 → 转写”，检查服务商 URL、模型和密钥，然后使用“测试连接”。",
  "Open the iPhone app connected to this server, sign in, and check Settings → Notifications. Retry notifications or turn them off and on to register again.":
    "请打开连接到此服务器的 iPhone 应用，登录后检查“设置 → 通知”。重试通知，或关闭再开启以重新注册。",
  "Run outcomego notifications configure --config ./apns.json to import the APNs key and apply it live. The topic must match the iOS app bundle ID (dev.outcomego.mobile for the distributed app). Then run outcomego notifications status and outcomego doctor.":
    "运行 outcomego notifications configure --config ./apns.json 导入 APNs 密钥并立即生效。主题必须与 iOS 应用包 ID 一致（正式分发的应用为 dev.outcomego.mobile）。然后运行 outcomego notifications status 和 outcomego doctor。",
  "Inspect outcomego logs worker for APNs delivery errors and check the push credentials and device registration. Verify a real alert on the iPhone with the conversation closed and Focus allowing OutcomeGo.":
    "查看 outcomego logs worker，排查 APNs 投递错误，并检查推送凭据和设备注册。请在关闭对话且“专注模式”允许 OutcomeGo 的 iPhone 上验证真实提醒。",
  "Check that the reported volume is writable by the service's user and has free space. Inspect outcomego logs for storage errors.":
    "请确认所报告的卷对服务用户可写且有可用空间。查看 outcomego logs 排查存储错误。",
  "Inspect outcomego logs {service} to identify why the container stopped or became unhealthy.":
    "查看 outcomego logs {service}，查明容器停止或变得不健康的原因。",
  "Review the reported {label} error and inspect outcomego logs for further details.":
    "请查看所报告的 {label} 错误，并查看 outcomego logs 了解详情。",
  "Run outcomego install to complete the installation.": "运行 outcomego install 完成安装。",
  "After resolving the failed checks, run outcomego install again.":
    "解决失败的检查后，请再次运行 outcomego install。",
  "After completing these steps, run outcomego doctor again.":
    "完成这些步骤后，请再次运行 outcomego doctor。",
  "Details: {detail}": "详情：{detail}",
  "{count} blocking problem found.": "发现 {count} 个阻塞问题。",
  "{count} blocking problems found.": "发现 {count} 个阻塞问题。",
  "Checks passed with {count} warning.": "检查通过，有 {count} 个警告。",
  "Checks passed with {count} warnings.": "检查通过，有 {count} 个警告。",
  "No blocking problems found; {count} check was not completed.":
    "未发现阻塞问题；{count} 项检查未完成。",
  "No blocking problems found; {count} checks were not completed.":
    "未发现阻塞问题；{count} 项检查未完成。",
  "All checks passed.": "所有检查均已通过。",
  "{passed} passed   {warnings} warning   {failed} failed   {skipped} not checked":
    "{passed} 通过   {warnings} 个警告   {failed} 个失败   {skipped} 项未检查",
  "{passed} passed   {warnings} warnings   {failed} failed   {skipped} not checked":
    "{passed} 通过   {warnings} 个警告   {failed} 个失败   {skipped} 项未检查",
  "{passed} passed   {warnings} warning   {failed} failed":
    "{passed} 通过   {warnings} 个警告   {failed} 个失败",
  "{passed} passed   {warnings} warnings   {failed} failed":
    "{passed} 通过   {warnings} 个警告   {failed} 个失败",
  "Completed in {seconds}s": "耗时 {seconds} 秒",
  "NEXT STEPS": "后续步骤",
  "No blocking problems found. Some checks could not be completed; see the reasons above.":
    "未发现阻塞问题。部分检查未能完成，原因见上文。",
  "No blocking problems found. Doctor finished without starting services.":
    "未发现阻塞问题。诊断结束时未启动任何服务。",
  "Doctor finished with blocking problems. Exit code 2.": "诊断结束，存在阻塞问题。退出码 2。",
  "SETUP NEEDED": "需要设置",
  "CHECKS INCOMPLETE": "检查未完成",
  "READY WITH NOTES": "就绪（有提示）",
  "ALL SYSTEMS READY": "一切就绪",
  "HOST & SETUP": "主机与设置",
  SERVICES: "服务",
  "AI CONNECTION": "AI 连接",
  "VOICE NOTES": "语音消息",
  NOTIFICATIONS: "通知",
  STORAGE: "存储",
  "Checking host and Docker": "正在检查主机和 Docker",
  "Checking configuration and services": "正在检查配置和服务",
  "Run outcomego tailscale status on the server host.":
    "请在服务器主机上运行 outcomego tailscale status。",
  "Testing database, computer, and worker": "正在测试数据库、电脑和 worker",
  "Checking notification registrations and push delivery": "正在检查通知注册和推送投递",
  "Verifying storage permissions": "正在验证存储权限",
  "Checking transcription from the server": "正在从服务器检查转写",
  "Testing the saved AI model (up to 40s)": "正在测试已保存的 AI 模型（最多 40 秒）",

  // lifecycle
  "OutcomeGo is not installed at {directory}. Run outcomego install first.":
    "OutcomeGo 未安装在 {directory}。请先运行 outcomego install。",
  "OutcomeGo installation manifest is missing at {path}": "OutcomeGo 安装清单缺失：{path}",
  "ALREADY RUNNING": "已在运行",
  READY: "就绪",
  "Network address": "网络地址",
  "OutcomeGo is already running.": "OutcomeGo 已在运行。",
  "OutcomeGo is ready.": "OutcomeGo 已就绪。",
  "No model is connected yet. Connect one in the OutcomeGo app under Settings → Server, or run {command} on this server.":
    "尚未连接模型。请在 OutcomeGo 应用的“设置 → 服务器”中连接，或在此服务器上运行 {command}。",
  "AI is not ready ({status}). Check the model connection in the OutcomeGo app under Settings → Server, or run {command}.":
    "AI 尚未就绪（{status}）。请在 OutcomeGo 应用的“设置 → 服务器”中检查模型连接，或运行 {command}。",
  "To stop OutcomeGo, run: {command}": "如需停止 OutcomeGo，请运行：{command}",
  "Checking startup ports…": "正在检查启动端口…",
  "OutcomeGo is stopped. Starting services…": "OutcomeGo 已停止。正在启动服务…",
  "OutcomeGo is partially running. Starting or checking: {services}…":
    "OutcomeGo 部分运行中。正在启动或检查：{services}…",
  "OutcomeGo is running but not ready ({detail}). Checking services…":
    "OutcomeGo 正在运行但未就绪（{detail}）。正在检查服务…",
  "Waiting for OutcomeGo…": "正在等待 OutcomeGo…",
  "OutcomeGo did not become healthy: {detail}": "OutcomeGo 未能进入健康状态：{detail}",
  "Reinstalling OutcomeGo {version}; refreshing release configuration…":
    "正在重新安装 OutcomeGo {version}；刷新发布配置…",
  "OutcomeGo {version} is installed but setup is incomplete; resuming setup.":
    "OutcomeGo {version} 已安装，但设置尚未完成；正在继续设置。",
  "OutcomeGo {version} is already installed; starting it.": "OutcomeGo {version} 已安装；正在启动。",
  "Docker is required.": "需要 Docker。",
  "Server requirements checked": "已检查服务器要求",
  "Server setup paused. The CLI is available. Fix the failed checks above, then run {command} again.":
    "服务器设置已暂停。CLI 仍可使用。请修复上方的失败检查，然后再次运行 {command}。",
  "Preflight checks passed. Guided setup needs an interactive terminal. Run {command} in a terminal to continue.":
    "预检已通过。引导式设置需要交互式终端。请在终端中运行 {command} 继续。",
  "Downloading OutcomeGo {version} release configuration…": "正在下载 OutcomeGo {version} 发布配置…",
  "Could not save the OutcomeGo configuration in {directory}: {error}. Free up disk space or fix the folder's permissions, then run {command} again.":
    "无法在 {directory} 中保存 OutcomeGo 配置：{error}。请释放磁盘空间或修复文件夹权限，然后再次运行 {command}。",
  "Pulling OutcomeGo container images…": "正在拉取 OutcomeGo 容器镜像…",
  "Installation configuration: {directory}": "安装配置：{directory}",
  "Guided setup was skipped. Run {command} to finish setup.":
    "已跳过引导式设置。运行 {command} 完成设置。",
  "Doctor checks failed.": "诊断检查失败。",
  "OutcomeGo is stopped. Its data and containers are preserved.":
    "OutcomeGo 已停止。其数据和容器均已保留。",
  "OutcomeGo is installed, but account setup is incomplete. Run outcomego setup to create your sign-in, then retry outcomego start.":
    "OutcomeGo 已安装，但账户设置尚未完成。运行 outcomego setup 创建登录信息，然后重试 outcomego start。",
  "Updating OutcomeGo {from} → {to}…": "正在更新 OutcomeGo {from} → {to}…",
  "OutcomeGo {version} and its command-line tools are up to date.":
    "OutcomeGo {version} 及其命令行工具均为最新版本。",
  "OutcomeGo {version} is already installed.": "OutcomeGo {version} 已安装。",
  "OutcomeGo and its command-line tools are now running {version}.":
    "OutcomeGo 及其命令行工具现在运行 {version}。",
  "OutcomeGo is now running {version}.": "OutcomeGo 现在运行 {version}。",
  "Interactive confirmation is unavailable; pass --yes to confirm.":
    "无法进行交互式确认；请传入 --yes 确认。",
  "Continue? [y/N]": "继续？[y/N]",
  "Permanently delete all OutcomeGo containers, volumes, configuration, sessions, and workspace data?":
    "要永久删除所有 OutcomeGo 容器、卷、配置、会话和工作区数据吗？",
  "Remove the OutcomeGo containers while preserving configuration and data?":
    "要移除 OutcomeGo 容器并保留配置和数据吗？",
  "Uninstall cancelled.": "已取消卸载。",
  REMOVED: "已移除",
  "CLI removed": "CLI 已移除",
  "OutcomeGo and its local Docker data were permanently removed.":
    "OutcomeGo 及其本地 Docker 数据已被永久删除。",
  UNINSTALLED: "已卸载",
  "Data preserved": "数据已保留",
  "Run the OutcomeGo installer again to restore the CLI and recreate the containers with the preserved data.":
    "请再次运行 OutcomeGo 安装程序，以恢复 CLI 并使用保留的数据重建容器。",

  // tailscale
  "Tailscale HTTPS: {state}": "Tailscale HTTPS：{state}",
  enabled: "已启用",
  disabled: "已禁用",
  "Server: {url}": "服务器：{url}",
  "Backend: {url}": "后端：{url}",
  "Route: {route} ({ownership})": "路由：{route}（{ownership}）",
  "OutcomeGo-managed mappings: {count}": "OutcomeGo 管理的映射：{count}",
  "Reconnect your apps using the server address above. Reused user-managed Serve mappings are preserved.":
    "请使用上方的服务器地址重新连接应用。复用的用户自建 Serve 映射会被保留。",

  // notifications
  "Could not read the APNs configuration or key file (maximum 32 KiB).":
    "无法读取 APNs 配置或密钥文件（最大 32 KiB）。",
  "Choose --config or --key-file with --key-id, --team-id and --topic.":
    "请选择 --config，或使用 --key-file 搭配 --key-id、--team-id 和 --topic。",
  "Could not read valid APNs configuration JSON.": "无法读取有效的 APNs 配置 JSON。",
  "APNs configuration must be a JSON object.": "APNs 配置必须是 JSON 对象。",
  "Choose one privateKeyFile path or privateKey in the APNs JSON.":
    "请在 APNs JSON 中选择 privateKeyFile 路径或 privateKey 之一。",
  "Use --config ./apns.json, or --key-file with --key-id, --team-id and --topic.":
    "请使用 --config ./apns.json，或使用 --key-file 搭配 --key-id、--team-id 和 --topic。",
  "Invalid APNs configuration.": "APNs 配置无效。",
  "The server returned invalid APNs status. Update OutcomeGo to a release supporting live notification configuration.":
    "服务器返回了无效的 APNs 状态。请将 OutcomeGo 更新到支持实时通知配置的版本。",
  "APNs configuration saved. Workers apply it before their next push; no restart needed.":
    "APNs 配置已保存。worker 会在下次推送前应用，无需重启。",
  "APNs configuration source: {source}": "APNs 配置来源：{source}",
  "Topic: {topic}": "主题：{topic}",
  unavailable: "不可用",
  "Configuration needs attention: {issue}": "配置需要处理：{issue}",
  "APNs credentials are not fully configured.": "APNs 凭据尚未完整配置。",
  "Signing key and configuration are valid locally.": "签名密钥和配置在本地有效。",
  "Run outcomego doctor to check worker configuration and registrations. Apple acceptance and phone delivery require a real notification.":
    "运行 outcomego doctor 检查 worker 配置和注册情况。Apple 是否接受及手机能否收到，需要通过真实通知验证。",

  // commands and setup prompts
  "{connected} connected · {total} providers": "{connected} 个已连接 · {total} 个服务商",
  "Connected accounts": "已连接的账户",
  "Available to connect": "可连接",
  "API key": "API 密钥",
  "Configured credentials": "已配置的凭据",
  "Connected · {method}": "已连接 · {method}",
  "Ambient credentials": "环境凭据",
  "{count} chat models": "{count} 个对话模型",
  custom: "自定义",
  selected: "已选中",
  "No providers are available.": "没有可用的服务商。",
  "Connect a provider before starting AI tasks.": "请先连接服务商，再开始 AI 任务。",
  "{count} accessible chat models · {provider}": "{count} 个可用对话模型 · {provider}",
  "{count} accessible chat models": "{count} 个可用对话模型",
  Selected: "当前选择",
  Thinking: "思考强度",
  "{provider} · {count} models": "{provider} · {count} 个模型",
  "reasoning {levels}": "推理 {levels}",
  images: "图片",
  "{context} context": "{context} 上下文",
  "{provider}: {message}": "{provider}：{message}",
  "Model discovery is unavailable. Reconnect the provider and retry.":
    "模型发现不可用。请重新连接服务商后重试。",
  "No models found for {provider}. Connect a provider or check model discovery.":
    "未找到 {provider} 的模型。请连接服务商或检查模型发现。",
  "No models found. Connect a provider or check model discovery.":
    "未找到模型。请连接服务商或检查模型发现。",
  "Switch model": "切换模型",
  "Add --thinking medium to choose a thinking level.": "添加 --thinking medium 可选择思考强度。",
  CHECK: "检查",
  DOWNLOAD: "下载",
  BACKUP: "备份",
  IMAGES: "镜像",
  RESTART: "重启",
  VERIFY: "校验",
  ROLLBACK: "回滚",
  COMPLETE: "完成",
  FAILED: "失败",
  "VERSION {version}": "版本 {version}",
  "COMMAND FAILED": "命令失败",
  "↑/↓ move · Enter select": "↑/↓ 移动 · Enter 选择",
  "arrows · Enter": "方向键 · Enter",
  recommended: "推荐",
  "not set": "未设置",
  "↑ {count} more": "↑ 还有 {count} 行",
  "↓ {count} more": "↓ 还有 {count} 行",
  "A few quick choices, then OutcomeGo will check the rest.":
    "只需几个简单选择，其余交给 OutcomeGo 检查。",
  "Type to edit · Enter save · Esc discard": "输入以编辑 · Enter 保存 · Esc 放弃",
  "Enter save · Esc discard": "Enter 保存 · Esc 放弃",
  "←/→ step · Esc cancel": "←/→ 切换步骤 · Esc 取消",
  "↑↓ move · Enter · ←→ · Esc cancel": "↑↓ 移动 · Enter · ←→ · Esc 取消",
  "Type to replace · Enter keep · ↑/↓ move · ←/→ step · Esc cancel":
    "输入以替换 · Enter 保留 · ↑/↓ 移动 · ←/→ 切换步骤 · Esc 取消",
  "Type to enter · Enter edit · ↑/↓ move · ←/→ step · Esc cancel":
    "输入以填写 · Enter 编辑 · ↑/↓ 移动 · ←/→ 切换步骤 · Esc 取消",
  "↑/↓ move · Enter change · ←/→ step · Esc cancel":
    "↑/↓ 移动 · Enter 更改 · ←/→ 切换步骤 · Esc 取消",
  "↑/↓ choose · Enter confirm · ← back · Esc cancel": "↑/↓ 选择 · Enter 确认 · ← 返回 · Esc 取消",
  "↑/↓ choose · Enter confirm · ←/→ step · Esc cancel":
    "↑/↓ 选择 · Enter 确认 · ←/→ 切换步骤 · Esc 取消",
};

/** Translates one CLI interface string; unknown keys fall back to English. */
export const cliTranslate = (key: string, values?: Values): string => {
  const text = cliLocale() === "zh-CN" ? (simplifiedChinese[key] ?? key) : key;
  return interpolate(text, values);
};

export const cliText = (locale: Locale, english: string, simplifiedChineseText: string): string =>
  locale === "zh-CN" ? simplifiedChineseText : english;

export { DEFAULT_LOCALE };
