# Installation

Install the server on the machine that will host your bots. The desktop app can run on the same machine or connect from another one. The current `latest` installer installs OutcomeGo `v0.1.0-beta.14`; select beta.13 explicitly on the [Releases page](https://github.com/jingyi0605/OutcomeGo/releases) if you need the former product identity.

## Requirements

### 桌面端本机部署（Spec 012，待发布验收）

在支持本机部署的测试版桌面端，欢迎页可选“在这台电脑部署”或“连接已有服务器”。默认优先复用已就绪的本机兼容引擎；托管模式使用 `outcomego-engine`。托管模式要求 Windows x64（Windows 10 22H2 / build 19045、Windows 11 23H2 / build 22631 或更高）或 macOS 13.5 及以上（Apple Silicon、Intel）。Linux 继续走下文的终端安装流程。

Windows 托管模式要求支持 NAT 检测的 WSL 2；若已启用其他网络模式，可改用本机兼容引擎或连接已有服务器。Windows 上关闭窗口只隐藏窗口。点击通知区域图标唤回，右键菜单可退出。默认退出桌面端也不停止本地服务。托管资产未通过发布验收前，正式版本仍使用现有安装路径。

| Requirement | What you need |
| --- | --- |
| Operating system | macOS, Windows, or Linux on x64 or arm64 |
| Docker | A running Docker engine with Compose 2.20 or newer |
| Memory | 8 GB recommended |
| Disk | 8 GB free recommended. Updates need at least 4 GB free. |
| Ports | `8787` for the server (you can change it), `6200–6299` for bot screens, and `80` and `443` if you use automatic HTTPS |
| AI model | A ChatGPT or Claude subscription, an API key, or a compatible endpoint. You connect it in the app after setup. |

On macOS and Windows, install and open Docker Desktop. On Linux, install Docker Engine and the Compose plugin. Installing only the `docker` command-line tool isn't enough; the engine must be running.

Bots only work while the host is on. If you want them to keep working while your laptop is closed, install on a machine that stays on. See [how hosting works](../overview/architecture.md).

## Install

**macOS or Linux**

```sh
curl -fsSL https://github.com/jingyi0605/OutcomeGo/releases/latest/download/install.sh | sh
```

**Windows PowerShell**

```powershell
irm https://github.com/jingyi0605/OutcomeGo/releases/latest/download/install.ps1 | iex
```

The installer downloads and verifies the CLI, checks Docker, and starts guided setup. If Docker is missing, it links to the download; install it and run the setup command printed by the installer. On a Mac with Docker Desktop installed but not running, setup starts it for you. If another check fails, fix it and run setup again. You don't need Node.js or Bun. The current public latest installer is OutcomeGo beta.14.

The tool is installed to `~/.local/bin` on macOS and Linux, and the installer adds that directory to your `PATH` in your shell's startup file, such as `~/.zshrc` or `~/.bashrc`. Open a new terminal to use `outcomego`. To leave your startup files unchanged, set `OUTCOMEGO_NO_MODIFY_PATH=1` before running the installer. On Windows, it's installed to `%LOCALAPPDATA%\OutcomeGo\bin` and added to your `PATH`.

## Guided setup

Setup sets up the connection and your account:

1. **Connection.** Setup detects a private network address, or your Tailscale HTTPS address if your tailnet has HTTPS turned on. If it can't find one, it asks for the address your devices will use to reach the server.
2. **Your account.** OutcomeGo has one account per server. Use it to sign in from all your devices. Pick a username of 3 to 30 letters, numbers, dashes, underscores, or dots, starting and ending with a letter or number. Signing in ignores capital letters.

Setup then shows a summary. Choose **Start OutcomeGo** to download the server and start it. If a port the server needs is in use, setup takes you back to the connection step with your answers kept. When the server is ready, setup prints the server URL and username to use in the apps.

Connect a model in the app after you sign in. See [model providers](../configuration/models.md) for the options.

Run `outcomego setup --advanced` to choose a different connection mode, API port, time zone, or number of tasks that run at once. See [server settings](../configuration/server.md).

To change your username or password later, see [server commands](../manage/server.md#change-your-account).

## Check the installation

```sh
outcomego status
outcomego doctor
```

`status` shows the server URL, version, and health of each service. `doctor` runs deeper checks.

## Where OutcomeGo is installed

Configuration lives in `~/.outcomego` on macOS and Linux (or `$XDG_CONFIG_HOME/outcomego` if that variable is set), and `%LOCALAPPDATA%\OutcomeGo` on Windows. To use a different directory, set `OUTCOMEGO_HOME` or pass `--dir <path>` to any command. Your bots' data is stored in Docker volumes, not in this directory. See [backups](../manage/backups.md).

To run unreleased code or contribute, see [development from source](../development/from-source.md).
