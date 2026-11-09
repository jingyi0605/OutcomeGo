import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "@aiteamos/contracts/localization";

/**
 * Interface language for the CLI.
 *
 * Only an explicit opt-in is honoured — `--language` (which sets
 * `AITEAMOS_LANGUAGE`) or that variable directly. Ambient `LANG`/`LC_ALL` is
 * deliberately ignored so scripts, piping, and test runs keep stable English
 * output; the interface language is a user choice, not an OS side effect.
 */
export const cliLocale = (value?: string): Locale =>
  normalizeLocale(value ?? process.env.AITEAMOS_LANGUAGE ?? DEFAULT_LOCALE);

type Values = Record<string, string | number>;

const interpolate = (text: string, values?: Values): string =>
  values
    ? text.replace(/\{(\w+)\}/g, (_, key: string) =>
        key in values ? String(values[key] ?? "") : `{${key}}`
      )
    : text;

/** English source string → Simplified Chinese. Keys are the English text itself. */
const simplifiedChinese: Record<string, string> = {
  "Show container health and server readiness": "显示容器健康状态和服务器就绪状态",
  "Check for installation problems": "检查安装问题",
  "Install the latest aiTeamOS release": "安装最新的 aiTeamOS 版本",
  "Configure private HTTPS with Tailscale": "使用 Tailscale 配置私有 HTTPS",
  "Manage AI accounts and connections": "管理 AI 账户和连接",
  "Choose inference and transcription models": "选择推理和转写模型",
  "Change your username or password": "更改用户名或密码",
  "View troubleshooting logs": "查看故障排查日志",
  "Stop aiTeamOS": "停止 aiTeamOS",
  "Start aiTeamOS after account setup": "账户设置后启动 aiTeamOS",
  "Remove aiTeamOS services and CLI": "移除 aiTeamOS 服务和 CLI",
  "Install aiTeamOS and run guided setup": "安装 aiTeamOS 并运行引导式设置",
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
  "Run aiteamos doctor to see what needs attention": "运行 aiteamos doctor 查看需要处理的问题",

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
  "Not connected · connect one in the aiTeamOS app": "未连接 · 请在 aiTeamOS 应用中连接",
  "Not ready ({status}) · check it in the aiTeamOS app":
    "未就绪（{status}）· 请在 aiTeamOS 应用中检查",
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
  "aiTeamOS has not been installed in this directory.": "此目录中尚未安装 aiTeamOS。",
  "Install aiTeamOS, or use --dir to select an existing installation.":
    "安装 aiTeamOS，或使用 --dir 选择已有安装。",
  "Some installation files are missing.": "部分安装文件缺失。",
  "Check that --dir selects the right installation. Restore missing files from a known-good backup, then run {command}.":
    "请确认 --dir 指向正确的安装。从可信备份恢复缺失的文件，然后运行 {command}。",
  "Missing: {files}": "缺失：{files}",
  "aiTeamOS's installation configuration could not be read.": "无法读取 aiTeamOS 的安装配置。",
  "Check file access and restore damaged configuration from a known-good backup. Run {command} for details.":
    "请检查文件访问权限，并从可信备份恢复损坏的配置。运行 {command} 查看详情。",
  "Run {command} on the server host.": "请在服务器主机上运行 {command}。",
  "Docker Compose is too old or its version is unknown: {version}":
    "Docker Compose 版本过旧或无法确定：{version}",
  "Docker Compose could not run.": "无法运行 Docker Compose。",
  "Install or update Docker Desktop or the Docker Compose plugin to {version} or newer. Verify with docker compose version, then retry.":
    "请安装或更新 Docker Desktop 或 Compose 插件到 {version} 或更高版本。用 docker compose version 验证后重试。",
  "aiTeamOS could not read its container states.": "aiTeamOS 无法读取容器状态。",
  "Run docker info to check the engine, then {command} to inspect Compose and configuration errors.":
    "运行 docker info 检查引擎，然后运行 {command} 查看 Compose 和配置错误。",
  "Resolve the server port conflict before starting this installation. Inspect the configuration with:":
    "请先解决服务器端口冲突，再启动此安装。使用以下命令检查配置：",
  "Inspect {service} logs to find why it is not ready. For a deeper diagnosis, run {command}.":
    "查看 {service} 日志以找出未就绪的原因。如需更深入的诊断，请运行 {command}。",
  "Setup or health checks are still in progress. Wait a moment and check again. If this persists, run {command}.":
    "设置或健康检查仍在进行中。请稍候再检查。如果问题持续，请运行 {command}。",
  "Finish account setup before using aiTeamOS:": "请先完成账户设置，再使用 aiTeamOS：",
  "Start the missing or stopped services, then check status again:":
    "启动缺失或已停止的服务，然后再次检查状态：",
  "The server cannot use its database or job queues. Inspect database logs, then run {command} to check schema setup and queue processing.":
    "服务器无法使用其数据库或任务队列。请查看数据库日志，然后运行 {command} 检查数据结构设置和队列处理。",
  "The computer service is not ready or rejected the server's credentials. Inspect its logs, then run {command} to check the connection and workspace.":
    "电脑服务未就绪，或拒绝了服务器的凭据。请查看其日志，然后运行 {command} 检查连接和工作区。",
  "Containers are running, but the server is not ready. Check server logs; run {command} for a deeper diagnosis.":
    "容器正在运行，但服务器未就绪。请查看服务器日志；运行 {command} 进行更深入的诊断。",
  "Containers and server are ready. Connect a model in the aiTeamOS app under Settings → Server before starting AI tasks. On a server without the app, run:":
    "容器和服务器均已就绪。开始 AI 任务前，请在 aiTeamOS 应用的“设置 → 服务器”中连接模型。在没有该应用的服务器上，请运行：",
  "For deeper database, queue, storage, and model checks:":
    "如需更深入的数据库、队列、存储和模型检查：",
  "aiTeamOS is not healthy: {detail}": "aiTeamOS 状态不健康：{detail}",
  "aiTeamOS services need attention.": "aiTeamOS 服务需要处理。",

  // doctor
  "Install the aiTeamOS server on an x64 or arm64 host.":
    "请在 x64 或 arm64 主机上安装 aiTeamOS 服务器。",
  "Use a host with at least 8 GiB of RAM for the aiTeamOS server.":
    "请使用至少有 8 GiB 内存的主机运行 aiTeamOS 服务器。",
  "Free space on the installation disk. For a new installation, choose a disk with more space using aiteamos install --dir <path>.":
    "请释放安装磁盘的空间。如需全新安装，请用 aiteamos install --dir <path> 选择空间更大的磁盘。",
  "Check that your user can write to the reported directory, or choose a writable directory with aiteamos install --dir <path>.":
    "请确认你的用户可写入所报告的目录，或用 aiteamos install --dir <path> 选择可写目录。",
  "Install or repair Docker, then open a new terminal and run docker --version.":
    "请安装或修复 Docker，然后打开新的终端运行 docker --version。",
  "Start your Docker runtime and wait for its engine to be ready. Run docker info; if it fails, inspect docker context ls and any DOCKER_HOST or DOCKER_CONTEXT overrides.":
    "请启动 Docker 运行时并等待其引擎就绪。运行 docker info；如果失败，请检查 docker context ls 以及 DOCKER_HOST 或 DOCKER_CONTEXT 覆盖设置。",
  "Install or update Docker Desktop or the Compose plugin to {version} or newer. Verify with docker compose version (or docker-compose version).":
    "请安装或更新 Docker Desktop 或 Compose 插件到 {version} 或更高版本。用 docker compose version（或 docker-compose version）验证。",
  "Restore the missing or invalid installation files from a known-good backup, or use aiteamos install --dir <path> for a separate new installation.":
    "请从可信备份恢复缺失或无效的安装文件，或用 aiteamos install --dir <path> 单独进行全新安装。",
  "Identify which application is using the reported port. Stop it if appropriate, or choose another API port during guided installation or aiteamos setup; the screen-viewer ports must be available.":
    "请查明哪个应用占用了所报告的端口。如合适请停止它，或在引导安装或 aiteamos setup 中选择其他 API 端口；屏幕查看端口必须可用。",
  "Restrict the reported configuration file to owner-only access before starting aiTeamOS.":
    "启动 aiTeamOS 前，请将所报告的配置文件限制为仅所有者可访问。",
  "Restore the missing or invalid secrets from a known-good installation backup; the database and service credentials must remain consistent.":
    "请从可信的安装备份恢复缺失或无效的密钥；数据库和服务凭据必须保持一致。",
  "Correct the reported error in the installation's configuration files, or restore them from a known-good backup before starting aiTeamOS.":
    "请修正安装配置文件中报告的错误，或在启动 aiTeamOS 前从可信备份恢复这些文件。",
  "Run aiteamos setup to create your account.": "运行 aiteamos setup 创建你的账户。",
  "Run aiteamos setup to repair the access mode, public URL, and bind addresses.":
    "运行 aiteamos setup 修复访问方式、公开 URL 和绑定地址。",
  "Keep plain HTTP on a trusted LAN or VPN. For access from anywhere, choose an HTTPS connection with aiteamos setup.":
    "请仅在可信局域网或 VPN 中使用明文 HTTP。如需随处访问，请用 aiteamos setup 选择 HTTPS 连接。",
  "Docker could not list the services. Run docker info, then inspect the reported Compose error before trying aiteamos status again.":
    "Docker 无法列出服务。请运行 docker info，查看所报告的 Compose 错误，然后再次尝试 aiteamos status。",
  "Run aiteamos start to start the missing services. If startup fails, inspect aiteamos logs.":
    "运行 aiteamos start 启动缺失的服务。如果启动失败，请查看 aiteamos logs。",
  "Run aiteamos status to check which server release is running. Verify the API port belongs to this installation before using aiteamos update to align its release.":
    "运行 aiteamos status 查看正在运行的服务端版本。使用 aiteamos update 对齐版本前，请确认 API 端口属于此安装。",
  "Identify the aiTeamOS instance using the reported API port. Use the intended installation's --dir path, or choose an unused API port in aiteamos setup.":
    "请查明占用所报告 API 端口的 aiTeamOS 实例。使用目标安装的 --dir 路径，或在 aiteamos setup 中选择未使用的 API 端口。",
  "Run aiteamos status and inspect aiteamos logs for unhealthy or stopped services; resolve the reported startup or connection error.":
    "运行 aiteamos status 并查看 aiteamos logs，找出不健康或已停止的服务；解决所报告的启动或连接错误。",
  "Inspect aiteamos logs migrate and aiteamos logs postgres for database startup or migration errors.":
    "查看 aiteamos logs migrate 和 aiteamos logs postgres，排查数据库启动或迁移错误。",
  "Inspect aiteamos logs computer and confirm the worker and computer use the same installation control token.":
    "查看 aiteamos logs computer，并确认 worker 和 computer 使用同一安装的控制令牌。",
  "Check the worker's agent and asset volume permissions. The worker must be able to read and write both volumes.":
    "请检查 worker 的 agent 卷和资源卷权限。worker 必须能读写这两个卷。",
  "Inspect aiteamos logs postgres and aiteamos logs migrate; the worker needs the application tables and job queues.":
    "查看 aiteamos logs postgres 和 aiteamos logs migrate；worker 需要应用数据表和任务队列。",
  "Inspect aiteamos logs worker for stalled jobs, expired leases, or database connection errors.":
    "查看 aiteamos logs worker，排查停滞任务、过期租约或数据库连接错误。",
  "The computer rejected the server's credentials. Check that both services use the installation's AITEAMOS_CONTROL_TOKEN, then recreate the affected service with the corrected configuration.":
    "computer 拒绝了服务器的凭据。请确认两个服务都使用此安装的 AITEAMOS_CONTROL_TOKEN，然后用修正后的配置重新创建受影响的服务。",
  "Inspect aiteamos logs computer for startup or connection errors.":
    "查看 aiteamos logs computer，排查启动或连接错误。",
  "Check that the public hostname resolves to this server's reachable address, then retry after the DNS change has propagated.":
    "请确认公开主机名解析到此服务器的可达地址，待 DNS 变更生效后重试。",
  "Check the public hostname and certificate on your HTTPS proxy. For bundled HTTPS, inspect aiteamos logs caddy and verify inbound ports 80 and 443 are reachable.":
    "请检查 HTTPS 代理上的公开主机名和证书。使用内置 HTTPS 时，查看 aiteamos logs caddy，并确认入站端口 80 和 443 可访问。",
  "Check the public URL, firewall, and reverse proxy; verify the proxy forwards HTTP and WebSocket traffic to aiTeamOS's configured API port.":
    "请检查公开 URL、防火墙和反向代理；确认代理将 HTTP 和 WebSocket 流量转发到 aiTeamOS 配置的 API 端口。",
  "Check the model provider's quota or billing, or wait for its rate limit to reset. To switch models, use Settings → Server in the aiTeamOS app, or run aiteamos model.":
    "请检查模型服务商的配额或计费，或等待其速率限制重置。如需切换模型，请在 aiTeamOS 应用的“设置 → 服务器”中操作，或运行 aiteamos model。",
  "Reconnect the provider in the aiTeamOS app under Settings → Server. On a server without the app, run aiteamos model.":
    "请在 aiTeamOS 应用的“设置 → 服务器”中重新连接服务商。在没有该应用的服务器上，请运行 aiteamos model。",
  "Check network access from the server and computer services to the model provider, including proxy or VPN settings. Inspect aiteamos logs computer and retry aiteamos doctor.":
    "请检查服务器和 computer 服务到模型服务商的网络访问，包括代理或 VPN 设置。查看 aiteamos logs computer 后重试 aiteamos doctor。",
  "Choose an available model in the aiTeamOS app under Settings → Server. On a server without the app, run aiteamos model list to see the models this account can use.":
    "请在 aiTeamOS 应用的“设置 → 服务器”中选择可用模型。在没有该应用的服务器上，运行 aiteamos model list 查看此账户可用的模型。",
  "Connect a model in the aiTeamOS app under Settings → Server. On a server without the app, run aiteamos model.":
    "请在 aiTeamOS 应用的“设置 → 服务器”中连接模型。在没有该应用的服务器上，请运行 aiteamos model。",
  "Check the model connection in the aiTeamOS app under Settings → Server. On a server without the app, run aiteamos provider list and aiteamos model list.":
    "请在 aiTeamOS 应用的“设置 → 服务器”中检查模型连接。在没有该应用的服务器上，运行 aiteamos provider list 和 aiteamos model list。",
  "Run aiteamos status and check the server connection and installation control token. Inspect aiteamos logs server before testing transcription again.":
    "运行 aiteamos status，检查服务器连接和安装控制令牌。再次测试转写前，请查看 aiteamos logs server。",
  "Open Settings → Server → Transcription, check the provider URL, model and key, then use Test connection.":
    "请打开“设置 → 服务器 → 转写”，检查服务商 URL、模型和密钥，然后使用“测试连接”。",
  "Open the iPhone app connected to this server, sign in, and check Settings → Notifications. Retry notifications or turn them off and on to register again.":
    "请打开连接到此服务器的 iPhone 应用，登录后检查“设置 → 通知”。重试通知，或关闭再开启以重新注册。",
  "Run aiteamos notifications configure --config ./apns.json to import the APNs key and apply it live. The topic must match the iOS app bundle ID (dev.aiteamos.mobile for the distributed app). Then run aiteamos notifications status and aiteamos doctor.":
    "运行 aiteamos notifications configure --config ./apns.json 导入 APNs 密钥并立即生效。主题必须与 iOS 应用包 ID 一致（正式分发的应用为 dev.aiteamos.mobile）。然后运行 aiteamos notifications status 和 aiteamos doctor。",
  "Inspect aiteamos logs worker for APNs delivery errors and check the push credentials and device registration. Verify a real alert on the iPhone with the conversation closed and Focus allowing aiTeamOS.":
    "查看 aiteamos logs worker，排查 APNs 投递错误，并检查推送凭据和设备注册。请在关闭对话且“专注模式”允许 aiTeamOS 的 iPhone 上验证真实提醒。",
  "Check that the reported volume is writable by the service's user and has free space. Inspect aiteamos logs for storage errors.":
    "请确认所报告的卷对服务用户可写且有可用空间。查看 aiteamos logs 排查存储错误。",
  "Inspect aiteamos logs {service} to identify why the container stopped or became unhealthy.":
    "查看 aiteamos logs {service}，查明容器停止或变得不健康的原因。",
  "Review the reported {label} error and inspect aiteamos logs for further details.":
    "请查看所报告的 {label} 错误，并查看 aiteamos logs 了解详情。",
  "Run aiteamos install to complete the installation.": "运行 aiteamos install 完成安装。",
  "After resolving the failed checks, run aiteamos install again.":
    "解决失败的检查后，请再次运行 aiteamos install。",
  "After completing these steps, run aiteamos doctor again.":
    "完成这些步骤后，请再次运行 aiteamos doctor。",
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
  "Run aiteamos tailscale status on the server host.":
    "请在服务器主机上运行 aiteamos tailscale status。",
  "Testing database, computer, and worker": "正在测试数据库、电脑和 worker",
  "Checking notification registrations and push delivery": "正在检查通知注册和推送投递",
  "Verifying storage permissions": "正在验证存储权限",
  "Checking transcription from the server": "正在从服务器检查转写",
  "Testing the saved AI model (up to 40s)": "正在测试已保存的 AI 模型（最多 40 秒）",

  // lifecycle
  "aiTeamOS is not installed at {directory}. Run aiteamos install first.":
    "aiTeamOS 未安装在 {directory}。请先运行 aiteamos install。",
  "aiTeamOS installation manifest is missing at {path}": "aiTeamOS 安装清单缺失：{path}",
  "ALREADY RUNNING": "已在运行",
  READY: "就绪",
  "Network address": "网络地址",
  "aiTeamOS is already running.": "aiTeamOS 已在运行。",
  "aiTeamOS is ready.": "aiTeamOS 已就绪。",
  "No model is connected yet. Connect one in the aiTeamOS app under Settings → Server, or run {command} on this server.":
    "尚未连接模型。请在 aiTeamOS 应用的“设置 → 服务器”中连接，或在此服务器上运行 {command}。",
  "AI is not ready ({status}). Check the model connection in the aiTeamOS app under Settings → Server, or run {command}.":
    "AI 尚未就绪（{status}）。请在 aiTeamOS 应用的“设置 → 服务器”中检查模型连接，或运行 {command}。",
  "To stop aiTeamOS, run: {command}": "如需停止 aiTeamOS，请运行：{command}",
  "Checking startup ports…": "正在检查启动端口…",
  "aiTeamOS is stopped. Starting services…": "aiTeamOS 已停止。正在启动服务…",
  "aiTeamOS is partially running. Starting or checking: {services}…":
    "aiTeamOS 部分运行中。正在启动或检查：{services}…",
  "aiTeamOS is running but not ready ({detail}). Checking services…":
    "aiTeamOS 正在运行但未就绪（{detail}）。正在检查服务…",
  "Waiting for aiTeamOS…": "正在等待 aiTeamOS…",
  "aiTeamOS did not become healthy: {detail}": "aiTeamOS 未能进入健康状态：{detail}",
  "Reinstalling aiTeamOS {version}; refreshing release configuration…":
    "正在重新安装 aiTeamOS {version}；刷新发布配置…",
  "aiTeamOS {version} is installed but setup is incomplete; resuming setup.":
    "aiTeamOS {version} 已安装，但设置尚未完成；正在继续设置。",
  "aiTeamOS {version} is already installed; starting it.": "aiTeamOS {version} 已安装；正在启动。",
  "Docker is required.": "需要 Docker。",
  "Server requirements checked": "已检查服务器要求",
  "Server setup paused. The CLI is available. Fix the failed checks above, then run {command} again.":
    "服务器设置已暂停。CLI 仍可使用。请修复上方的失败检查，然后再次运行 {command}。",
  "Preflight checks passed. Guided setup needs an interactive terminal. Run {command} in a terminal to continue.":
    "预检已通过。引导式设置需要交互式终端。请在终端中运行 {command} 继续。",
  "Downloading aiTeamOS {version} release configuration…": "正在下载 aiTeamOS {version} 发布配置…",
  "Could not save the aiTeamOS configuration in {directory}: {error}. Free up disk space or fix the folder's permissions, then run {command} again.":
    "无法在 {directory} 中保存 aiTeamOS 配置：{error}。请释放磁盘空间或修复文件夹权限，然后再次运行 {command}。",
  "Pulling aiTeamOS container images…": "正在拉取 aiTeamOS 容器镜像…",
  "Installation configuration: {directory}": "安装配置：{directory}",
  "Guided setup was skipped. Run {command} to finish setup.":
    "已跳过引导式设置。运行 {command} 完成设置。",
  "Doctor checks failed.": "诊断检查失败。",
  "aiTeamOS is stopped. Its data and containers are preserved.":
    "aiTeamOS 已停止。其数据和容器均已保留。",
  "aiTeamOS is installed, but account setup is incomplete. Run aiteamos setup to create your sign-in, then retry aiteamos start.":
    "aiTeamOS 已安装，但账户设置尚未完成。运行 aiteamos setup 创建登录信息，然后重试 aiteamos start。",
  "Updating aiTeamOS {from} → {to}…": "正在更新 aiTeamOS {from} → {to}…",
  "aiTeamOS {version} and its command-line tools are up to date.":
    "aiTeamOS {version} 及其命令行工具均为最新版本。",
  "aiTeamOS {version} is already installed.": "aiTeamOS {version} 已安装。",
  "aiTeamOS and its command-line tools are now running {version}.":
    "aiTeamOS 及其命令行工具现在运行 {version}。",
  "aiTeamOS is now running {version}.": "aiTeamOS 现在运行 {version}。",
  "Interactive confirmation is unavailable; pass --yes to confirm.":
    "无法进行交互式确认；请传入 --yes 确认。",
  "Continue? [y/N]": "继续？[y/N]",
  "Permanently delete all aiTeamOS containers, volumes, configuration, sessions, and workspace data?":
    "要永久删除所有 aiTeamOS 容器、卷、配置、会话和工作区数据吗？",
  "Remove the aiTeamOS containers while preserving configuration and data?":
    "要移除 aiTeamOS 容器并保留配置和数据吗？",
  "Uninstall cancelled.": "已取消卸载。",
  REMOVED: "已移除",
  "CLI removed": "CLI 已移除",
  "aiTeamOS and its local Docker data were permanently removed.":
    "aiTeamOS 及其本地 Docker 数据已被永久删除。",
  UNINSTALLED: "已卸载",
  "Data preserved": "数据已保留",
  "Run the aiTeamOS installer again to restore the CLI and recreate the containers with the preserved data.":
    "请再次运行 aiTeamOS 安装程序，以恢复 CLI 并使用保留的数据重建容器。",

  // tailscale
  "Tailscale HTTPS: {state}": "Tailscale HTTPS：{state}",
  enabled: "已启用",
  disabled: "已禁用",
  "Server: {url}": "服务器：{url}",
  "Backend: {url}": "后端：{url}",
  "Route: {route} ({ownership})": "路由：{route}（{ownership}）",
  "aiTeamOS-managed mappings: {count}": "aiTeamOS 管理的映射：{count}",
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
  "The server returned invalid APNs status. Update aiTeamOS to a release supporting live notification configuration.":
    "服务器返回了无效的 APNs 状态。请将 aiTeamOS 更新到支持实时通知配置的版本。",
  "APNs configuration saved. Workers apply it before their next push; no restart needed.":
    "APNs 配置已保存。worker 会在下次推送前应用，无需重启。",
  "APNs configuration source: {source}": "APNs 配置来源：{source}",
  "Topic: {topic}": "主题：{topic}",
  unavailable: "不可用",
  "Configuration needs attention: {issue}": "配置需要处理：{issue}",
  "APNs credentials are not fully configured.": "APNs 凭据尚未完整配置。",
  "Signing key and configuration are valid locally.": "签名密钥和配置在本地有效。",
  "Run aiteamos doctor to check worker configuration and registrations. Apple acceptance and phone delivery require a real notification.":
    "运行 aiteamos doctor 检查 worker 配置和注册情况。Apple 是否接受及手机能否收到，需要通过真实通知验证。",

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
  "A few quick choices, then aiTeamOS will check the rest.":
    "只需几个简单选择，其余交给 aiTeamOS 检查。",
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
