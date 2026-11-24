# CLI 契约：本机部署

来源：[设计 §3.2–3.3、§5](../design.md)、[任务 2.7、4.2、5.2](../tasks.md)。M2、M3 候选实现沿用 M1 的 v1 事件；资产签名、公证与真机验收尚未完成。

## 命令

- `bootstrap --json-progress [--dir <路径>] [--engine auto|external|managed] [--api-port <端口>] [--version <版本>] [--accept-low-memory]`：stdin 接收一个 `{ schemaVersion: 1, owner: { username, password } }` JSON 对象及 EOF。凭据不进入命令行、环境变量或文件。引擎仅用本地套接字或命名管道；首次安装的 `auto` 优先选择就绪的本机兼容引擎，否则使用本平台候选托管引擎。
- 桌面端在 Windows 上可通过 `OUTCOMEGO_BOOTSTRAP_CANCEL_FILE` 指定单次部署的非秘密取消标记路径。出现空文件时，CLI 取消当前步骤并回滚；不改变 stdin、输出契约或退出码。
- `status --json`：输出单个 `{ engine, stack: { state, services }, version, apiPort, ownerUsername }`；返回快照时退出 0，不代表栈已就绪。`engine` 与下一条命令格式相同；未安装时版本、端口和用户名可为 `null`。`services` 项使用 Compose 的 `Service`、`State`、可选 `Health` 和 `ExitCode`。
- `engine status --json [--engine auto|external|managed]`：输出 `{ state, reasons, engine: { kind, name, version?, location? }, engineVersion?, composeVersion?, cgroupVersion?, memoryBytes?, code? }`。只读取状态，不启动引擎。
- `engine start` / `engine stop`：仅启停安装清单记录的托管引擎；要启停应用栈用 `start` / `stop`。
- `engine upgrade --version <资产版本> --yes [--dir <路径>]`：明确确认维护停机；只接受健康、归属匹配的本机托管安装。迁移本安装的普通 Compose 本地卷，保留原卷名、权限和所有者；不更新服务器版本。旧清单没有资产版本时不从 Docker 版本推断。用两代正式资产验收前，不在日常安装执行。
- `engine rollback --yes [--dir <路径>]`：仅恢复有未完成升级记录的安装；故障时 CLI 会先自动尝试恢复，恢复失败或进程中断才执行此命令。成功升级后的旧磁盘和 `volumes.json`、tar 归档保留于安装目录下的 `engine-backup-*`，不是一键降级入口。归档含本地业务数据，应按私有备份保管。操作前结束任务、断开客户端，并预留归档、旧磁盘和新引擎所需空间。
- `engine remove --purge-data`：只接受已标记移除且归属验证通过的托管实例，不能替代桌面的删除确认。`engine docker -- <参数>`：通过本机清单调用引擎；以 `compose` 开头时使用已记录的项目与配置路径。
- `engine enable-wsl --yes`：仅在部署状态等待授权时可用；仅触发启用 WSL 的 UAC。若需重启，写入不含密码的 `deploy-state.json`；用户重新打开应用并重新输入密码。
- `resources set --computer-memory <大小> --desktop-memory <大小> [--yes]`：在确认后改写本机配置，只重建 `computer` 和 `computer-memory-init`。大小为不小于 16 MiB 的整数值，接受 `b`、`k`、`m`、`g`、`t` 后缀（例如 `3584m`）。

桌面端可给 `bootstrap` 设置 `OUTCOMEGO_DESKTOP_CLI_VERSION`，与进程实际 CLI 版本不一致时返回 `CLI_VERSION_MISMATCH`。更新代理使用验证后的独立载体：macOS `~/.local/bin/outcomego`，Windows `%LOCALAPPDATA%\OutcomeGo\bin\outcomego.exe`。旧的终端安装不依赖桌面端变量。

## 进度事件 v1

stdout 每行一个 UTF-8 JSON 对象，包含 `schemaVersion: 1`、`ts`（ISO 8601）和 `type`。未知版本须停止解析并提示更新。`message`、`action.detail` 为已脱敏的可选文本，不可用于流程分支。

| 类型 | 专属字段 |
| --- | --- |
| `stage` | `stage`、`status`（`started`、`progress`、`completed`、`skipped`、`failed`）、可选 `current` / `total` |
| `log` | 可选 `stage`、`message` |
| `action-required` | `action: { kind, detail? }` |
| `error` | `stage`、`code`、`retryable`，可选 `field`（`username`、`password`、`apiPort`、`stdin`）和 `action` |
| `result` | `result: { url, username, directory, engine, version }`；成功时为最后一条事件 |

阶段：`detect`、`engine`、`release`、`configure`、`pull`、`start`、`health`、`owner`。`pull` 确定进度按镜像 N/M；操作类型：`elevate`、`reboot`、`install-engine`、`free-disk`、`free-port`、`confirm-low-memory`。同一安装目录的变更操作互斥。

## 退出码与错误码

成功退出 0。其他情况按下表，不使用诊断文本判断错误类型。

| 错误码 | 退出码 |
| --- | --- |
| `INVALID_INPUT` | 2 |
| `VIRTUALIZATION_DISABLED` | 2 |
| `WSL_NOT_ENABLED` | 2 |
| `REBOOT_REQUIRED` | 2 |
| `ELEVATION_DENIED` | 2 |
| `WINDOWS_UNSUPPORTED` | 2 |
| `MACOS_UNSUPPORTED` | 2 |
| `ENGINE_UNAVAILABLE` | 2 |
| `ENGINE_START_FAILED` | 3 |
| `ENGINE_INCOMPATIBLE` | 2 |
| `ASSET_DOWNLOAD_FAILED` | 3 |
| `ASSET_VERIFICATION_FAILED` | 1 |
| `PORT_IN_USE` | 2 |
| `DISK_SPACE_LOW` | 2 |
| `MEMORY_LOW` | 2 |
| `IMAGE_PULL_FAILED` | 3 |
| `STACK_START_FAILED` | 3 |
| `HEALTH_TIMEOUT` | 3 |
| `OWNER_CREATE_FAILED` | 3 |
| `BUSY` | 3 |
| `CLI_VERSION_MISMATCH` | 3 |
| `CANCELLED` | 130 |
| `UNKNOWN` | 1 |

## 引擎提供者

```typescript
interface EngineProvider {
  kind: "external" | "managed-wsl" | "managed-lima";
  detect(): Promise<EngineDetection>;
  ensureReady(onEvent?: (message: string) => void, options?: { apiPort?: number; signal?: AbortSignal }): Promise<void>;
  docker(args: readonly string[], options?: RunOptions): RunResult;
  composeInvocation(project: ComposeTarget, args: readonly string[]): {
    command: string;
    args: readonly string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
  };
  memoryBytes(): number | null;
  describe(): EngineInfo;
  stop?(): Promise<void>;
  remove?(options: { purgeData: boolean }): Promise<void>;
}
```

`detect()` 的 `state` 为 `ready`、`stopped`、`needs-setup` 或 `unsupported`。已有安装优先按清单中的 `engine.kind` 选引擎，旧清单缺省为 `external`。`managed-wsl` 只接受归属匹配的 WSL 2 与可确认的 NAT；`managed-lima` 使用独立 `LIMA_HOME` 与回环转发。服务端更新不会更换引擎资产。
