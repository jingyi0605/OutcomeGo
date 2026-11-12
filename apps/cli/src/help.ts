import type { HelpTopic } from "./arguments";
import { CLI_VERSION } from "./constants";
import { cliLocale } from "./localization";

const heading = (usage: string, summary: string): string => `OutcomeGo ${CLI_VERSION}

Usage:
  ${usage}

${summary}`;

const helpHint = "  --help, -h            Show this help";
const directoryOption = "  --dir <path>          Use a different installation folder";

const pages: Record<HelpTopic, string> = {
  global: `OutcomeGo ${CLI_VERSION}

Usage:
  outcomego <command> [options]

Getting started:
  install       Install OutcomeGo and run guided setup
  setup         Set up or change the connection and account

Your installation:
  status        Show container health and server readiness
  health        Alias for status
  doctor        Check for installation problems
  update        Install the latest OutcomeGo release
  start         Start OutcomeGo after account setup
  stop          Stop OutcomeGo
  logs          View troubleshooting logs
  tailscale     Enable, inspect, or disable private Tailscale HTTPS
  notifications  Configure iOS push credentials or show their status
  uninstall     Remove OutcomeGo services and CLI

Models and accounts:
  provider      Manage AI accounts and connections
  model         Choose inference and transcription models
  account       Change your username or password

Global options:
${directoryOption}
  --help, -h            Show help
  --version, -v         Show the CLI version

Run "outcomego <command> --help" for command options.`,

  tailscale: `${heading("outcomego tailscale <enable|status|disable>", "Manage private HTTPS with Tailscale Serve on this server host.")}

Commands:
  enable        Configure and verify Tailscale HTTPS; restart the stack
  status        Inspect the mapping, prerequisites, and HTTPS endpoint
  disable       Switch to local access and remove OutcomeGo-managed mappings

Options:
${directoryOption}
${helpHint}`,
  "tailscale-enable": `${heading("outcomego tailscale enable [options]", "Configure Tailscale Serve and loopback backend ports, restart OutcomeGo, and verify HTTPS. Reuses matching private routes; never replaces another application's route or enables Funnel.")}

Options:
  --https-port <port>   HTTPS listener (default: current port or 443)
  --json                Print status as JSON
${directoryOption}
${helpHint}

Tailscale must be running and signed in, with MagicDNS and HTTPS certificates enabled.
On failure the previous server configuration is restored. Reconnect apps to the new URL.`,
  "tailscale-status": `${heading("outcomego tailscale status [options]", "Read-only check of Tailscale, mapping ownership, and HTTPS readiness. Exit 2 if configured HTTPS needs attention.")}

Options:
  --json                Print status as JSON
${directoryOption}
${helpHint}`,
  "tailscale-disable": `${heading("outcomego tailscale disable [options]", "Switch Tailscale mode to local-only access and restart OutcomeGo. Remove only unchanged OutcomeGo-managed mappings. Reused user-managed routes are preserved; remote apps must reconnect.")}

Options:
  --json                Print status as JSON
${directoryOption}
${helpHint}`,
  notifications: `${heading("outcomego notifications <command>", "Manage iOS push delivery credentials on the running server.")}

Commands:
  configure     Import APNs credentials and apply them live
  status        Show configuration status without exposing the signing key

${directoryOption}
${helpHint}`,
  "notifications-configure": `${heading("outcomego notifications configure [options]", "Validate and save APNs credentials encrypted in the database. Workers read changes before their next push; no restart is needed.")}

Options:
  --config <file>        Import JSON with keyId, teamId, topic, privateKeyFile
                        (key path is relative to the JSON file)
  --key-file <file>      Import an Apple .p8 key directly instead of JSON
  --key-id <id>          Apple key ID (with --key-file)
  --team-id <id>         Apple team ID (with --key-file)
  --topic <bundle-id>    App bundle ID (with --key-file)
${directoryOption}
${helpHint}

Example:
  outcomego notifications configure --key-file ./AuthKey.p8 --key-id ABCDE12345 --team-id FGHIJ67890 --topic dev.outcomego.mobile

Local validation checks the key format and signing ability. It does not prove Apple acceptance or phone delivery.`,
  "notifications-status": `${heading("outcomego notifications status [options]", "Show the saved APNs configuration source and local validation status. The signing key is never returned.")}

Options:
${directoryOption}
${helpHint}`,
  install: `${heading(
    "outcomego install [options]",
    "Install the OutcomeGo server stack, run guided setup, and wait for it to become healthy."
  )}

Options:
${directoryOption}
  --version <version>   Install a specific release
  --advanced            Show advanced prompts during guided setup
  --no-setup            Skip guided setup for automation
${helpHint}

Advanced release/testing options:
  --repository <owner/repo>  Override the GitHub release repository
  --allow-prerelease        Permit an explicit prerelease target
  --allow-unsigned           Permit unsigned test bundles (unsafe)
  --compose-url <url>        Override the Compose asset URL
  --checksum-url <url>       Override the SHA256SUMS asset URL
  --signature-url <url>      Override the Sigstore bundle asset URL
  --project-name <name>      Override and persist the Compose project name
  --image-prefix <prefix>    Override the container image prefix`,

  setup: `${heading(
    "outcomego setup [options]",
    "Check prerequisites, install the server if needed, and set up its connection and your account.\nRun this again to change the connection. Connect a model in the OutcomeGo app under Settings → Server."
  )}

Options:
${directoryOption}
  --advanced            Also show the API port and tasks at once
${helpHint}`,

  doctor: `${heading(
    "outcomego doctor [options]",
    "Check container health, database/schema setup, worker heartbeat and queue processing, computer API, storage permissions, and host configuration.\nSends one short inference request using your saved provider, model, and thinking setting.\nFinishes without starting services or setup. Failed checks exit 2; warnings alone exit 0."
  )}

Options:
${directoryOption}
  --project-name <name> Override the Compose project name (advanced)
${helpHint}`,

  status: `${heading(
    "outcomego status [options]",
    "Show container states, Docker health checks, and server readiness.\nAlias: outcomego health [options]. Both commands produce the same report.\nRead-only: does not start containers or send an AI request.\nExits 0 when services are ready; exits 2 when stopped, starting, unhealthy, or unable to check.\nUse outcomego doctor for deeper database, queue, storage, and model checks."
  )}

Options:
${directoryOption}
${helpHint}`,

  update: `${heading(
    "outcomego update [options]",
    "Safely update the CLI and server stack in one durable job, with health checks and rollback."
  )}

The update continues if the terminal, SSH connection, or Desktop app closes. Running the same
command again reconnects to the active update and resumes high-level progress output. A standalone
CLI stages and verifies the target CLI before updating the server, then installs it only after the
new server is healthy. Desktop uses the CLI bundled with the app and updates that bundle with Desktop.

Options:
${directoryOption}
  --version <version>   Update to a specific release
  --force               Reapply the currently installed release
  --allow-downgrade     Permit an explicit downgrade for recovery
  --allow-prerelease    Permit an explicit prerelease target
  --when-idle           Refuse, changing nothing, while any bot is working
${helpHint}

Advanced release/testing options:
  --repository <owner/repo>  Override the GitHub release repository
  --allow-unsigned           Permit unsigned test bundles (unsafe)
  --compose-url <url>        Override the Compose asset URL
  --checksum-url <url>       Override the SHA256SUMS asset URL
  --signature-url <url>      Override the Sigstore bundle asset URL
  --json-progress            Emit machine-readable progress`,

  start: `${heading(
    "outcomego start [options]",
    "Requires completed account setup; run outcomego setup first.\nCheck preflight and start services if needed. Healthy installations report already running.\nAI tasks require a connected provider; startup reports when inference is unavailable."
  )}

Options:
${directoryOption}
${helpHint}`,

  stop: `${heading(
    "outcomego stop [options]",
    "Stop OutcomeGo while preserving its containers and data."
  )}

Options:
${directoryOption}
${helpHint}`,

  logs: `${heading("outcomego logs [service] [options]", "Show recent troubleshooting logs.")}

Options:
${directoryOption}
  --follow, -f          Stream logs until interrupted
  --tail <lines>        Number of recent lines to show (default: 200)
  --service <name>      Show logs for one service (or pass its name directly)
${helpHint}`,

  provider: `${heading(
    "outcomego provider <command> [options]",
    "Manage AI account sign-ins and custom providers."
  )}

Commands:
  list                  Show available AI providers and sign-in status
  login [provider]      Sign in to a provider (uses the active one by default)
  logout [provider]     Sign out of a provider
  add <id>              Connect another compatible AI provider
  remove <id>           Remove a custom AI provider

Run "outcomego provider <command> --help" for command options.`,

  "provider-list": `${heading(
    "outcomego provider list [options]",
    "Show AI providers, model counts, and sign-in status."
  )}

Options:
${directoryOption}
${helpHint}`,

  "provider-login": `${heading(
    "outcomego provider login [provider] [options]",
    "Sign in through a browser or with an API key.\nThe active provider is used when omitted."
  )}

Options:
${directoryOption}
  --auth <oauth|api-key>  Select the authentication method
${helpHint}`,

  "provider-logout": `${heading(
    "outcomego provider logout [provider] [options]",
    "Remove one provider credential. The active provider is used when omitted."
  )}

Options:
${directoryOption}
${helpHint}`,

  "provider-add": `${heading(
    "outcomego provider add <id> [options]",
    "Add a custom chat endpoint, then authenticate and discover its models."
  )}

Required options:
  --name <name>          Provider display name
  --base-url <url>      Provider API endpoint
  --api <format>        API format supported by the provider

Additional options:
${directoryOption}
  --model <id>          Optional model metadata; discovery still checks access
  --no-auth             Link an endpoint that needs no credentials
  --context-window <n>  Model context size
  --max-tokens <n>      Model maximum output tokens
  --reasoning           Mark the model as able to think through complex tasks
${helpHint}

Protocols: openai-completions, openai-responses, anthropic-messages, google-generative-ai`,

  "provider-remove": `${heading(
    "outcomego provider remove <id> [options]",
    "Remove a custom AI provider. The active provider cannot be removed."
  )}

Options:
${directoryOption}
${helpHint}`,

  model: `${heading(
    "outcomego model [command] [options]",
    "Open the interactive model editor. Use left/right to switch between Inference and Transcription.\nUse up/down to move, Enter to choose or edit, and Save to apply each tab.\nEsc goes back or asks to discard unsaved changes."
  )}

Commands:
  list [provider]         Show available models
  use <provider> <model>  Choose the active model

Options:
${directoryOption}
${helpHint}

Bare \`outcomego model\` requires an interactive terminal.
Run "outcomego model <command> --help" for scripting options.`,

  "model-list": `${heading(
    "outcomego model list [provider] [options]",
    "List accessible chat models from connected providers, grouped by provider."
  )}

Options:
${directoryOption}
${helpHint}`,

  "model-use": `${heading(
    "outcomego model use <provider> <model> [options]",
    "Select the installation-wide provider, model, and optional reasoning level."
  )}

Options:
${directoryOption}
  --thinking <level>    off, minimal, low, medium, high, xhigh, or max
${helpHint}`,

  account: `${heading(
    "outcomego account <command> [options]",
    "Change the OutcomeGo username or password. Changes sign out every app."
  )}

Commands:
  update                Change the username and/or password

Run "outcomego account update --help" for command options.`,

  "account-update": `${heading(
    "outcomego account update [options]",
    "Update the owner account and revoke all active desktop and mobile sessions.\nWith no credential flags, both are prompted."
  )}

Options:
${directoryOption}
  --username <name>     Update only the owner username
  --password            Prompt securely for a new password
${helpHint}`,

  uninstall: `${heading(
    "outcomego uninstall [options]",
    "Remove OutcomeGo services and CLI while preserving configuration and data by default."
  )}

Options:
${directoryOption}
  --yes, -y             Skip confirmation
  --purge               Permanently delete containers, volumes, configuration, and data
${helpHint}`,
};

// The Chinese pages mirror the English ones line for line: same commands, flags,
// argument placeholders, and URLs. Section headings keep an ASCII colon so
// renderHelp still recognizes them as titles; sentences use Chinese punctuation.
const zhHeading = (usage: string, summary: string): string => `OutcomeGo ${CLI_VERSION}

用法:
  ${usage}

${summary}`;

const zhHelpHint = "  --help, -h            显示此帮助";
const zhDirectoryOption = "  --dir <path>          使用其他安装文件夹";

const simplifiedChinesePages: Record<HelpTopic, string> = {
  global: `OutcomeGo ${CLI_VERSION}

用法:
  outcomego <command> [options]

快速开始:
  install       安装 OutcomeGo 并运行引导式设置
  setup         设置或更改连接与账户

你的安装:
  status        显示容器健康状态和服务器就绪状态
  health        status 的别名
  doctor        检查安装问题
  update        安装最新的 OutcomeGo 版本
  start         账户设置后启动 OutcomeGo
  stop          停止 OutcomeGo
  logs          查看故障排查日志
  tailscale     启用、检查或禁用 Tailscale 私有 HTTPS
  notifications  配置 iOS 推送凭据或查看其状态
  uninstall     移除 OutcomeGo 服务和 CLI

模型与账户:
  provider      管理 AI 账户和连接
  model         选择推理和转写模型
  account       更改用户名或密码

全局选项:
${zhDirectoryOption}
  --help, -h            显示帮助
  --version, -v         显示 CLI 版本

运行“outcomego <command> --help”查看命令选项。`,

  tailscale: `${zhHeading("outcomego tailscale <enable|status|disable>", "在此服务器主机上使用 Tailscale Serve 管理私有 HTTPS。")}

命令:
  enable        配置并验证 Tailscale HTTPS；重启整套服务
  status        检查映射、前提条件和 HTTPS 端点
  disable       切换到本地访问，并移除 OutcomeGo 管理的映射

选项:
${zhDirectoryOption}
${zhHelpHint}`,
  "tailscale-enable": `${zhHeading("outcomego tailscale enable [options]", "配置 Tailscale Serve 和回环后端端口，重启 OutcomeGo，并验证 HTTPS。\n复用匹配的私有路由；绝不替换其他应用的路由，也不启用 Funnel。")}

选项:
  --https-port <port>   HTTPS 监听端口（默认：当前端口或 443）
  --json                以 JSON 输出状态
${zhDirectoryOption}
${zhHelpHint}

Tailscale 必须正在运行并已登录，且已启用 MagicDNS 和 HTTPS 证书。
失败时会恢复之前的服务器配置。请使用新的 URL 重新连接应用。`,
  "tailscale-status": `${zhHeading("outcomego tailscale status [options]", "只读检查 Tailscale、映射归属和 HTTPS 就绪状态。\n已配置的 HTTPS 需要处理时，退出码为 2。")}

选项:
  --json                以 JSON 输出状态
${zhDirectoryOption}
${zhHelpHint}`,
  "tailscale-disable": `${zhHeading("outcomego tailscale disable [options]", "将 Tailscale 模式切换为仅本地访问并重启 OutcomeGo。\n只移除未变更的 OutcomeGo 管理映射。复用的用户自管路由会保留；远程应用必须重新连接。")}

选项:
  --json                以 JSON 输出状态
${zhDirectoryOption}
${zhHelpHint}`,
  notifications: `${zhHeading("outcomego notifications <command>", "管理运行中服务器上的 iOS 推送投递凭据。")}

命令:
  configure     导入 APNs 凭据并立即生效
  status        显示配置状态，不暴露签名密钥

${zhDirectoryOption}
${zhHelpHint}`,
  "notifications-configure": `${zhHeading("outcomego notifications configure [options]", "校验 APNs 凭据并以加密方式保存到数据库。worker 会在下次推送前读取变更，无需重启。")}

选项:
  --config <file>        导入包含 keyId、teamId、topic、privateKeyFile 的 JSON
                        （密钥路径相对于 JSON 文件）
  --key-file <file>      直接导入 Apple .p8 密钥，而不使用 JSON
  --key-id <id>          Apple 密钥 ID（配合 --key-file）
  --team-id <id>         Apple 团队 ID（配合 --key-file）
  --topic <bundle-id>    应用包 ID（配合 --key-file）
${zhDirectoryOption}
${zhHelpHint}

示例:
  outcomego notifications configure --key-file ./AuthKey.p8 --key-id ABCDE12345 --team-id FGHIJ67890 --topic dev.outcomego.mobile

本地校验会检查密钥格式和签名能力，但不能证明 Apple 已接受或手机已收到。`,
  "notifications-status": `${zhHeading("outcomego notifications status [options]", "显示已保存的 APNs 配置来源和本地校验状态。签名密钥永远不会返回。")}

选项:
${zhDirectoryOption}
${zhHelpHint}`,
  install: `${zhHeading(
    "outcomego install [options]",
    "安装 OutcomeGo 服务器套件，运行引导式设置，并等待其进入健康状态。"
  )}

选项:
${zhDirectoryOption}
  --version <version>   安装指定版本
  --advanced            在引导式设置中显示高级选项
  --no-setup            跳过引导式设置，用于自动化
${zhHelpHint}

高级发布/测试选项:
  --repository <owner/repo>  覆盖 GitHub 发布仓库
  --allow-prerelease         允许显式指定预发布版本
  --allow-unsigned           允许未签名的测试包（不安全）
  --compose-url <url>        覆盖 Compose 资源 URL
  --checksum-url <url>       覆盖 SHA256SUMS 资源 URL
  --signature-url <url>      覆盖 Sigstore bundle 资源 URL
  --project-name <name>      覆盖并持久化 Compose 项目名称
  --image-prefix <prefix>    覆盖容器镜像前缀`,

  setup: `${zhHeading(
    "outcomego setup [options]",
    "检查前提条件，按需安装服务器，并设置其连接和你的账户。\n再次运行可更改连接。请在 OutcomeGo 应用的“设置 → 服务器”中连接模型。"
  )}

选项:
${zhDirectoryOption}
  --advanced            同时显示 API 端口和任务
${zhHelpHint}`,

  doctor: `${zhHeading(
    "outcomego doctor [options]",
    "检查容器健康状态、数据库和数据结构设置、worker 心跳与队列处理、\n电脑 API、存储权限以及主机配置。\n使用已保存的服务商、模型和思考强度发送一次简短的推理请求。\n结束时不会启动服务或设置。检查失败时退出码为 2；仅有警告时退出码为 0。"
  )}

选项:
${zhDirectoryOption}
  --project-name <name> 覆盖 Compose 项目名称（高级）
${zhHelpHint}`,

  status: `${zhHeading(
    "outcomego status [options]",
    "显示容器状态、Docker 健康检查和服务器就绪状态。\n别名：outcomego health [options]。两个命令生成相同的报告。\n只读：不会启动容器，也不会发送 AI 请求。\n服务就绪时退出码为 0；已停止、正在启动、不健康或无法检查时退出码为 2。\n如需更深入地检查数据库、队列、存储和模型，请使用 outcomego doctor。"
  )}

选项:
${zhDirectoryOption}
${zhHelpHint}`,

  update: `${zhHeading(
    "outcomego update [options]",
    "通过一个可持久化的任务安全地更新 CLI 和服务器套件，并带有健康检查和回滚。"
  )}

即使终端、SSH 连接或桌面应用关闭，更新也会继续。
再次运行同一命令会重新连接到进行中的更新，并恢复高层进度输出。
独立的 CLI 会先暂存并校验目标 CLI，再更新服务器，
且仅在新的服务器进入健康状态后才安装它。
桌面应用使用随应用捆绑的 CLI，并随桌面应用一起更新该捆绑包。

选项:
${zhDirectoryOption}
  --version <version>   更新到指定版本
  --force               重新应用当前已安装的版本
  --allow-downgrade     允许为恢复目的显式降级
  --allow-prerelease    允许显式指定预发布版本
  --when-idle           任何机器人正在工作时拒绝执行，且不做任何改动
${zhHelpHint}

高级发布/测试选项:
  --repository <owner/repo>  覆盖 GitHub 发布仓库
  --allow-unsigned           允许未签名的测试包（不安全）
  --compose-url <url>        覆盖 Compose 资源 URL
  --checksum-url <url>       覆盖 SHA256SUMS 资源 URL
  --signature-url <url>      覆盖 Sigstore bundle 资源 URL
  --json-progress            输出机器可读的进度`,

  start: `${zhHeading(
    "outcomego start [options]",
    "需要先完成账户设置；请先运行 outcomego setup。\n按需执行预检并启动服务。健康的安装会报告已在运行。\nAI 任务需要已连接的服务商；推理不可用时会报告。"
  )}

选项:
${zhDirectoryOption}
${zhHelpHint}`,

  stop: `${zhHeading("outcomego stop [options]", "停止 OutcomeGo，同时保留其容器和数据。")}

选项:
${zhDirectoryOption}
${zhHelpHint}`,

  logs: `${zhHeading("outcomego logs [service] [options]", "显示最近的故障排查日志。")}

选项:
${zhDirectoryOption}
  --follow, -f          持续输出日志，直到中断
  --tail <lines>        显示最近的行数（默认：200）
  --service <name>      显示单个服务的日志（或直接传入服务名）
${zhHelpHint}`,

  provider: `${zhHeading(
    "outcomego provider <command> [options]",
    "管理 AI 账户登录和自定义服务商。"
  )}

命令:
  list                  显示可用的 AI 服务商和登录状态
  login [provider]      登录服务商（默认使用当前服务商）
  logout [provider]     退出服务商登录
  add <id>              连接其他兼容的 AI 服务商
  remove <id>           移除自定义 AI 服务商

运行“outcomego provider <command> --help”查看命令选项。`,

  "provider-list": `${zhHeading(
    "outcomego provider list [options]",
    "显示 AI 服务商、模型数量和登录状态。"
  )}

选项:
${zhDirectoryOption}
${zhHelpHint}`,

  "provider-login": `${zhHeading(
    "outcomego provider login [provider] [options]",
    "通过浏览器或 API 密钥登录。\n省略时使用当前服务商。"
  )}

选项:
${zhDirectoryOption}
  --auth <oauth|api-key>  选择认证方式
${zhHelpHint}`,

  "provider-logout": `${zhHeading(
    "outcomego provider logout [provider] [options]",
    "移除一个服务商凭据。省略时使用当前服务商。"
  )}

选项:
${zhDirectoryOption}
${zhHelpHint}`,

  "provider-add": `${zhHeading(
    "outcomego provider add <id> [options]",
    "添加自定义对话端点，然后认证并发现其模型。"
  )}

必需选项:
  --name <name>          服务商显示名称
  --base-url <url>       服务商 API 端点
  --api <format>         服务商支持的 API 格式

其他选项:
${zhDirectoryOption}
  --model <id>           可选的模型元数据；发现时仍会检查访问权限
  --no-auth              关联无需凭据的端点
  --context-window <n>   模型上下文大小
  --max-tokens <n>       模型最大输出令牌数
  --reasoning            将模型标记为能够思考复杂任务
${zhHelpHint}

协议：openai-completions、openai-responses、anthropic-messages、google-generative-ai`,

  "provider-remove": `${zhHeading(
    "outcomego provider remove <id> [options]",
    "移除自定义 AI 服务商。当前服务商无法移除。"
  )}

选项:
${zhDirectoryOption}
${zhHelpHint}`,

  model: `${zhHeading(
    "outcomego model [command] [options]",
    "打开交互式模型编辑器。使用左/右方向键在“推理”和“转写”之间切换。\n使用上/下方向键移动，Enter 选择或编辑，用“保存”应用每个标签页。\nEsc 返回，或询问是否放弃未保存的更改。"
  )}

命令:
  list [provider]         显示可用模型
  use <provider> <model>  选择当前模型

选项:
${zhDirectoryOption}
${zhHelpHint}

直接运行 \`outcomego model\` 需要交互式终端。
运行“outcomego model <command> --help”查看脚本化选项。`,

  "model-list": `${zhHeading(
    "outcomego model list [provider] [options]",
    "按服务商分组列出已连接服务商中可访问的对话模型。"
  )}

选项:
${zhDirectoryOption}
${zhHelpHint}`,

  "model-use": `${zhHeading(
    "outcomego model use <provider> <model> [options]",
    "选择整个安装范围的服务商、模型和可选的推理级别。"
  )}

选项:
${zhDirectoryOption}
  --thinking <level>    off、minimal、low、medium、high、xhigh 或 max
${zhHelpHint}`,

  account: `${zhHeading(
    "outcomego account <command> [options]",
    "更改 OutcomeGo 的用户名或密码。更改后所有应用都会退出登录。"
  )}

命令:
  update                更改用户名和/或密码

运行“outcomego account update --help”查看命令选项。`,

  "account-update": `${zhHeading(
    "outcomego account update [options]",
    "更新所有者账户，并撤销所有活动的桌面和移动会话。\n未提供任何凭据选项时，会提示输入两项。"
  )}

选项:
${zhDirectoryOption}
  --username <name>     仅更新所有者用户名
  --password            安全地提示输入新密码
${zhHelpHint}`,

  uninstall: `${zhHeading(
    "outcomego uninstall [options]",
    "移除 OutcomeGo 服务和 CLI，默认保留配置和数据。"
  )}

选项:
${zhDirectoryOption}
  --yes, -y             跳过确认
  --purge               永久删除容器、卷、配置和数据
${zhHelpHint}`,
};

export const helpFor = (topic: HelpTopic = "global"): string =>
  cliLocale() === "zh-CN" ? (simplifiedChinesePages[topic] ?? pages[topic]) : pages[topic];
