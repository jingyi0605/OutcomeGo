# Spike E：CLI 载体与更新代理（2026-11-23）

对应任务 1.7、需求 8.1/8.2、设计 §3.3.5 与 Q5。

## 改动前基线

分支 `OutcomeGo`，提交 `3413ab01a`，比上游领先 18 个提交，`git status --short` 无输出。

| 检查 | 输出 |
| --- | --- |
| CLI `bun test` | 758 通过、0 失败 |
| CLI `bun run test:doctor` | 225 通过、0 失败 |
| CLI `bun run test:install` | 首次 64 通过、1 失败；`leaves profiles alone when opted out or already on PATH` 超过 5000 ms。串行复跑 65 通过、0 失败 |
| 桌面端 `bun run test` | 1039 通过、2 跳过、0 失败 |
| 两端 `bun run typecheck`、仓库 `bun run check:architecture` | 退出码均为 0 |
| 现有产物 `check-desktop-budgets.ts --release` | 退出码 1；`Electron runtime bytes: 3976604 > 2460000`，另有 renderer 及其懒加载体积超限，并发现 2 个 `app.asar`，ZIP 内 ASAR 未核验。未重新构建，不能当作新构建包体数据 |

## macOS 实测与限制

- `sw_vers`：macOS 27.2（26B123），`uname -m`：`arm64`。
- 对公开 `v0.1.0-beta.24` 执行现有 `downloadCliArtifact`。首次退出码 1，`ECONNREFUSED: Unable to connect`；`curl` 报 `Failed to connect to 127.0.0.1 port 7897`。只在实验子进程中清除代理变量后重试，退出码 1，`TimeoutError: The operation timed out.`。未取得仓库流程成功校验或执行的证据，没有运行未校验二进制。
- 直连请求 `SHA256SUMS` 成功。发布 API 报告 macOS arm64 dmg 129,121,268 字节、Windows x64 NSIS 108,260,219 字节。对应独立 CLI 原始大小为 63,679,986、87,541,248 字节，gzip 分别为 26,029,770、40,041,625 字节。这些是发布附件大小，不能用加和代替实际 dmg/NSIS 打包；方案 (a)/(c) 未打包实测。方案 (b) 不把 CLI 加入安装包。
- 已检查当前 `status` 参数只接受 `--json-progress`，不是新契约 `status --json`。旧发布版本不能用于证明新状态命令，待任务 2.4 实现后复测。

## 待复测

- macOS：签名与摘要均通过后，再从 Electron 启动隔离目录内的独立 CLI；启动测试代理，换名模拟应用更新，核对代理路径、进程和命令退出码。不注册系统服务，不替换日常安装。
- Windows：用户可安排隔离的 Windows 11 x64。只在测试应用副本下比较 Electron 常驻时的 exe 替换结果和独立 CLI 常驻时的结果，回传系统版本、路径（可脱敏）、命令退出码与日志。
- 方案 (b) 目前仍是既定默认，不是 Spike 最终结论。未核实更新后代理可用，也未复现或否定 Windows exe 占用，Q5 保持开放。
