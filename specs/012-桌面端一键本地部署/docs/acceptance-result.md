# 验收结果

## M1 · 2026-11-24

结论：已实现 `external` 引擎上的 M1 功能面；自动测试通过，**整体体积预算未通过，Windows/macOS 端到端未验收**。本节保留 M1 结果，M2、M3 的增量见下文。未发布、未签名、未使用日常安装执行删除或重启。

环境：macOS arm64，Bun 1.4.4，工作区基线 `3413ab01a`。`docker version --format '{{.Server.Version}}'` 返回 `29.9.2`。此前验证的是本机缓存构建镜像的隔离能力，不是签名发布镜像或自动登录，见 [macOS 探测](20261123-macOS外部引擎隔离探测.md)。

| 检查 | 未改动基线 | 当前输出 |
| --- | --- | --- |
| CLI `bun test` | 758 pass / 0 fail | 830 pass / 0 fail |
| CLI `bun run test:doctor` | 225 pass / 0 fail | 225 pass / 0 fail |
| CLI `bun run test:install` | 首次 64 pass / 1 超时；串行复跑 65 pass / 0 fail | 串行 65 pass / 0 fail |
| 桌面 `bun run test` | 1039 pass / 2 skip / 0 fail | 1104 pass / 2 skip / 0 fail；跳过原生快捷键自检及双桌面联网集成 |
| 两端 `bun run typecheck` | 已记录基线 | 均退出 0 |
| `bun run check:architecture` | 通过 | 退出 0；桌面 2274 条、CLI 263 条翻译覆盖一致 |
| 完整桌面构建 | 同工具链可构建 | 退出 0；未签名打包 |
| Spec 核对 | 通过 | `需求 14 条，非功能需求 3 条，验收标准 93 条，任务 37 个`，`核对通过` |

### 体积门

基线取 `git archive HEAD` 的同工具链构建，不使用旧正式包的数据替代当前构建。

| 检查 | 基线（字节） | 当前（字节） | 限制（字节） | 结果 |
| --- | ---: | ---: | ---: | --- |
| `main.js` | 未单独记录 | 167,974 | 175,000 | 通过 |
| `preload.cjs` | 10,405 | 10,800 | 10,900 | 通过；+395 为 IPC 新增，原阈值 10,500 |
| Renderer | 18,301,695 | 18,323,901 | 18,300,000 | 失败，基线已超限 |
| Renderer gzip | 4,769,290 | 4,777,755 | 4,760,000 | 失败，基线已超限 |
| Electron runtime | 2,645,316 | 2,698,704 | 2,514,000 | 失败，基线已超限；只给此次增量留出预算 |
| `outcomeRouteView` 懒加载闭包 | 388,286 | 388,286 | 175,000 | 失败，未改变 |
| `outcomeChatCard` 懒加载闭包 | 396,176 | 396,176 | 185,000 | 失败，未改变 |
| `chatGoals` 懒加载闭包 | 398,197 | 398,197 | 185,000 | 失败，未改变 |

`local-deploy` 与 `tray` 主进程懒加载块分别为 11,886、2,599 字节。`--release` 除上述六项外还报找到两个 `app.asar`，无法取得唯一发布 ASAR 或验证 ZIP 内 ASAR；未生成匹配新构建的签名 dmg/NSIS，不能核定发布包体积。既有预算超限不在此次扩大修复范围，关联 3.6、3.8。

### 真机结果与回传

用户确认暂缓 M1 真机验收、Spike F 办公负载及法务确认。以下是恢复后需要的步骤和回传内容，不代表已安排执行。

- [M1 清单](acceptance-checklist.md) 26 项尚无真机结果。两平台从点击到自动登录的耗时未测，实际应用进程退出、关机/注销、60 秒恢复与签名升级未测。Linux 与远程回归目前只有自动套件证据，未执行手工清单。
- 1.7（Spike E）：隔离 Windows 11 x64 与 macOS ≥ 13.5，准备含此次新命令的受信签名资产。按 [Spike E 记录](20261123-SpikeE-CLI载体与更新代理.md) 在测试副本对比 Electron 常驻和独立 CLI 常驻时的文件替换，检查更新后代理路径仍可执行。回传系统/包版本、资产摘要、退出码及脱敏日志；不使用开发机的日常安装或签名凭据。
- 1.8（Spike F）：请用户在 `openteam-debug` 上使用测试机器人执行典型办公任务，单机器人重复至少 3 次，再记录 2–3 个机器人并发的时间窗口。回传开始/结束时间、并发数、测试机器人标识和是否成功；随后只读采集 `memory.peak`、`anon`、各容器 `docker stats`。托管引擎、首次拉取耗时和带宽等仍待实测。不重建远程 computer。
- 1.9：请法务逐条回答 [许可证评估 §6](20261123-许可证评估与建议.md#6-请法务确认的问题)：GPL 资产分发与源码、命令行交互是否构成合并作品、第三方名称、现有 GHCR 声明、Electron/Chromium 声明。回传每条结论或预计答复日期；未答复前不公开发布托管资产。

## M2 / M3 · 2026-11-24

按用户授权完成可本地验证的候选路径；**尚无 1.10 Go，不可视为发布就绪**。未注册开机项、启动实际 VM、执行真实注销或卸载，也未修改签名配置。候选代码自动验证环境为 macOS arm64、Bun 1.4.4；另有 Windows 11 可用性与部署探测，见下文。

| 检查 | 实际结果 |
| --- | --- |
| CLI `bun test`、`bun run test:doctor`、`bun run test:install` | 收尾分别为 859 pass、225 pass、65 pass，均 0 fail |
| 桌面 `bun run test` | 1112 pass / 1 skip / 0 fail；跳过双桌面联网集成 |
| CLI 与桌面类型 | 均退出 0 |
| 架构、国际化、发布工作流静态检查 | 退出 0；桌面 2281 条、CLI 291 条翻译，23 个错误码与设计、排障表一致 |
| M2/M3 资产夹具 | 同一模拟输入两次产物和清单逐字节相同；错摘要、公告不匹配、一字节篡改均拒绝。实际 Sigstore 验证用了已签名的历史夹具，不是托管发行资产 |
| 托管升级夹具 | `engine-upgrade.test.ts` 10 项通过；另有 WSL 快照顺序与 Lima 目录恢复两项通过。首次定向并行构建时，旧 Sigstore 夹具超过 5 秒；随后定向复跑及最终全量通过，未改断言或超时配置 |
| 桌面 `bun run build` | 退出 0；未签名打包 |
| `verify:mac-notifications` | 退出 1：`The outcomeGo app bundle was not found. Build the macOS package first.` 未生成匹配的已签名应用 |
| Spec 核对 | `需求 14 条，非功能需求 3 条，验收标准 93 条，任务 37 个`，`核对通过` |

### 体积与暂缓项

- 最终普通预算由 6 项超限降至 3 项；阈值未变，具体结果见下表。`main.js` 168,177 B、`preload.cjs` 10,839 B 均在当前预算内。发布门暂缓，未测匹配发布包体积。
- Windows 真机仍须验证 WSL 2 NAT、实际回环监听、应用触发的 UAC/桌面续跑、后台保活和卸载；[M2 清单](acceptance-checklist.md#m2windows-私有-wsl2-发行版)中 M2-01、M2-03 有部分实测，其余未完成。非 NAT 或无法确认 NAT 时拒绝启动，不改 `.wslconfig`。
- macOS 真机须验证两种架构的 `vz`、实际转发、虚拟化 entitlement、签名公证及无开发工具启动；[M3 清单](acceptance-checklist.md#m3macos-apple-virtualization) 13 项待验收。无实际运行时或系统镜像的测量值。
- Windows 可从固定 Debian 输入生成候选包，构建与公告核对已接入默认关闭的发布作业。候选证据见下文。
- 托管引擎资产升级和回滚已实现为独立 CLI 维护命令（需求 8.4）。夹具验签、停栈、保留原名的卷归档、挂载拒绝、替换、健康失败回退与失败后重试已覆盖；Windows 保留停机 VHDX、macOS 保留原 VM 和运行时。需用两代正式签名资产验证两平台的卷内容、数字所有者、ACL/xattr、磁盘空间和中断回退。现有服务端更新不会替换引擎资产。
- Spike A–D、F、Spike E 跨平台验证、法务和发布决定继续暂缓；未检查或修改 `openteam-debug` / 生产环境。

### Windows 11 可用性与部署探测 · 2026-11-24

环境：Win11 IoT Enterprise LTSC 24H2 x64，build `26100.9457`；本地管理员账户经 SSH 公钥认证。测试 CLI 从当前工作树构建，SHA-256 `8aa412afabb0a8d75863b50e6304970dd97d7e98f9d750ce47bd4b7b8729db18`，Node.js `v22.23.3`。

| 检查 | 实际结果 |
| --- | --- |
| WSL 启用前 | 两个可选功能 `InstallState=2`；`wsl --status` 报告 WSL2 无法启动但退出码为 0；旧逻辑将状态误报为 `needs-setup` 且无错误码 |
| 回归修复 | 新增对 `Win32_OptionalFeature` 状态的查询；真实 CLI 在功能未启用时返回 `WSL_NOT_ENABLED`、退出码 0，未导入或启动发行版 |
| 系统启用与重启 | 管理员 SSH 会话对 `Microsoft-Windows-Subsystem-Linux` 和 `VirtualMachinePlatform` 分别运行 DISM `/Enable-Feature /All /NoRestart`，均退出 `3010`；真实重启后两项均为 `InstallState=1` |
| WSL 启用后 | `wsl --status` 退出 0；没有已注册发行版；`.wslconfig` 不存在；CLI 返回 `needs-setup`，未启动 WSL 实例 |
| Bootstrap | 测试凭据只经 stdin JSON 输入；进度到 `detect` 完成、`engine` 失败，错误码 `ASSET_DOWNLOAD_FAILED`、退出码 3。资产未通过下载/验签，未导入发行版 |
| 凭据扫描 | bootstrap stdout/stderr 和测试部署目录文件中的哨兵密码命中 0 次；部署目录日志文件已产生，不含哨兵 |

最新代码复测：重新构建并传入 Win11 的 CLI SHA-256 仍为 `8aa412afabb0a8d75863b50e6304970dd97d7e98f9d750ce47bd4b7b8729db18`；Windows 文件摘要匹配。`engine-status` 仍返回 `needs-setup`；bootstrap 再次返回 `ASSET_DOWNLOAD_FAILED` / 3，stdout/stderr 与测试目录复扫哨兵命中均为 0。CLI 全量测试 859 pass / 0 fail，typecheck 退出 0。未创建发行版或改动 `.wslconfig`。

下载定位：在 Win11 对 `v0.1.0-beta.24` 的 `SHA256SUMS` 发起 HEAD 请求返回 HTTP 200；`outcomego-engine-windows-x64.tar.gz` 及其 `.sigstore.json` 均返回 HTTP 404。至少这两个输入在该发布中不可下载；重试不能补齐它们。下载器现对 HTTP 404/410 报缺少哪个发布文件，保留 `ASSET_VERIFICATION_FAILED` 的拒绝导入行为。Windows 发布流程只在 4.1 前置门批准后启用，见 [发布输入](README.md#windows-引擎发布输入)。

诊断修复复测：Win11 新 CLI 摘要 `494337e7148b492f645b40622d7f7b28d14148c61693ac554344d06bc215a3ec`，`bootstrap` 在 `engine` 阶段返回 `ASSET_VERIFICATION_FAILED`、`retryable=false`、退出 1，详细信息指明 `outcomego-engine-windows-x64.tar.gz.sigstore.json (HTTP 404)`；捕获输出中哨兵命中 0。发布汇总脚本的三个夹具场景均符合预期：未启用时正常汇总，启用但缺件时拒绝，启用且齐全时把引擎归档纳入 `SHA256SUMS`。未实际签名或发布。

自动验证：CLI 全量 864 pass / 0 fail，CLI 类型、发布工作流静态检查、架构及 Spec 核对通过。单独运行历史 Sigstore 夹具时曾遇到 `error refreshing TUF metadata`；全量通过，未修改签名校验规则。

本次没有匹配版本的正式托管引擎资产与签名可供导入，因此未能完成 Compose 启动、回环监听、桌面登录、办公任务、保活、移除或两代资产升级回滚。DISM 启用不是应用 UAC 路径测试；真实 UAC 拒绝/同意、桌面重启续跑仍待验收。测试 CLI 与日志保留在 Win11 的 `%LOCALAPPDATA%\Temp\outcomego-win-acceptance`，没有创建 WSL 发行版。

### Windows 11 候选部署复测 · 2026-11-24

- Win11 24H2 x64 build `26100.9457` 与 WSL `3.0.1.0`。测试入口在 Windows 对候选归档计算 SHA-256 后交给现有 `ManagedWslEngine` 和 `bootstrapCommand`，正式引擎签名路径仍待验收。禁用测试实例的自动更新代理。发行 Compose 下载和验签走原逻辑。
- 首次实测成功导入，随后 NAT 探测返回 `ENGINE_INCOMPATIBLE`、退出 2。WSL 返回 `/usr/lib/wsl/wslinfo` 不存在，实测 `/usr/bin/wslinfo` 是到 `/init` 的符号链接，探测输出 `nat`。修复探测路径，重跑通过，`docker info` 返回 `26.1.5+dfsg1/2`，Compose 返回 `2.26.1-4`，Docker 服务为 `active`。
- 全栈在带中文和空格的 Windows 安装路径上启动成功。首次 `pull` 约 32 分钟（大镜像层经历续传），部署退出 0，输出 `managed-wsl` 和 `http://127.0.0.1:8787`。再次运行复用当前安装和镜像，健康检查为 `ready`，数据库、队列和 computer 均为 `ready`。在 Windows 本机实际登录返回 HTTP 200，账号匹配。安装环境、清单与诊断等 6 个文件的密码哨兵命中 0。
- `netstat -ano` 与 `Get-NetTCPConnection` 均确认 API 8787 和 viewer 6200–6299 共 101 个监听均绑定 `127.0.0.1`，没有 2375/2376 监听。Mac 到 Windows LAN 地址的 8787、6200、6299 TCP 检查均超时。`.wslconfig` 仍不存在。
- 首次通过 SSH 直接运行的会话退出后，WSL 停止运行，Windows 本机 API 连不上。通过 Windows 独立进程启动同一测试入口后，部署与启动进程均退出，之后从新 SSH 连接检查 API 仍为 `ready`。桌面退出的 30 分钟检查、宿主重启和安装包 UI 验收待执行。CLI 全量 865 pass / 0 fail，WSL 定向 6 pass / 0 fail，CLI typecheck、Spec 核对通过。

### Windows x64 本地候选包 · 2026-11-24

- 自动选源追加包 `OutcomeGo-QA-0.1.0-beta.24-mirrors-win-x64.exe` 已复制到 Win11 QA 测试目录。Mac 与 Win11 的 SHA-256 一致，为 `b3eaef4ebad072df51e5df7cc3eee16640d625bfef6db8e5d64c846f6568cba3`。包大小 148,781,135 字节，Win11 Authenticode 状态为 `NotSigned`。
- Win11 实际选源探测验证了 `computer` 的发布摘要 `sha256:596bdd403afcf7dc61da60fd8010497c7258df3f667326c57db0686662f6c8f1`。南京大学镜像的清单和 AMD64 子清单返回 HTTP 200，限时内无完整层样本。DaoCloud 的鉴权清单 HEAD 返回 HTTP 403。GHCR 的镜像层样本返回 HTTP 206，探测输出 `{"ranking":["ghcr.io"]}`。本次探测未完成整镜像冷缓存耗时对比。
- 普通桌面体积门待人工确认。QA 构建输出超限为 renderer `18332038 > 18300000`、renderer gzip `4783499 > 4760000`、Electron runtime `4081726 > 2514000`、settingsInitial `52524 > 52000`。阈值保持原值。

- 以固定 OCI 摘要的 Debian 13.8 amd64 和 `20261124T000000Z` 的 Debian 签名快照构建。两次独立执行 APT 安装，其中一次显式使用 `--no-cache`。输出归档均为 146,715,149 字节（约 140 MiB），`sha256sum -c` 均返回 `OK`，摘要同为 `f3d244d97df9d4639b5339e794002fdea07769a751f5c5a2d0a1e06ba114a378`。两份 `engine-components.json` 逐字节相同。
- 初次真实组包发现 Debian 的 `dockerd` 在 `/usr/sbin/dockerd`，已同步修正文件检查及 systemd 单元。最终归档用 Docker 导入到隔离的 Linux amd64 容器后，`docker --version` 返回 `26.1.5+dfsg1`，`docker compose version --short` 返回 `2.26.1-4`，`dockerd --validate` 返回 `configuration OK`。`containerd 1.7.24~ds1`、`runc 1.1.15+ds1`、`systemd 257`、`flock`、`sleep` 与 `tar` 均可执行。早期通过 arm64 宿主的 amd64 模拟容器套用 `chroot` 时 Compose 探测触发 Go `SIGSEGV`，复测改用直接导入归档启动容器，退出码 0。
- 归档内 100 个已安装包均有 Debian 许可文件，与 `THIRD-PARTY-NOTICES` 对照通过。登记包含精确 Debian 源码版本。发布前仍须核对 Go 链接依赖、上游 NOTICE、源码保留及法务结论。
- CLI 全量 865 pass / 0 fail，doctor 225 pass / 0 fail，install 65 pass / 0 fail。CLI 类型、架构、发布工作流静态检查及 Spec 核对通过。候选、`SHA256SUMS`、组件清单和公告保留在本机 `/tmp/outcomego-windows-engine.3BpTzi86/final-1/`。
- 对工作区现有桌面产物执行 `bun scripts/performance/check-desktop-budgets.ts --release`，退出 1。报告 renderer 18,330,094 B、gzip 4,783,085 B、Electron runtime 4,920,707 B、main 285,608 B、preload 17,959 B、host utility 285,149 B 和内置 CLI 2,051,415 B 超限。updater 块不唯一，找到 2 份 `app.asar`，ZIP 内 ASAR 未核验。本轮未重新构建桌面包，以上是现存产物检查输出，当前 NSIS 体积待匹配版本产物确认。
- 正式发布仍需任务 1.10 与法务结论、可用的 GitHub 凭据，以及 tag 工作流的 Sigstore 签名和发布体积验收。Win11 只读检查仍无已注册发行版，等待匹配版本资产后执行 bootstrap 实测。

| 普通桌面预算 | 收尾前（字节） | 最终（字节） | 限制（字节） | 结果 |
| --- | ---: | ---: | ---: | --- |
| Renderer | 18,327,019 | 18,330,094 | 18,300,000 | 超 30,094，待白天确认 |
| Renderer gzip | 4,778,965 | 4,783,085 | 4,760,000 | 超 23,085，待白天确认 |
| Electron runtime | 2,728,406 | 2,718,252 | 2,514,000 | 超 204,252，待白天确认 |
| `outcomeRouteView` 懒加载闭包 | 388,286 | 107,877 | 175,000 | 通过 |
| `outcomeChatCard` 懒加载闭包 | 396,176 | 117,332 | 185,000 | 通过 |
| `chatGoals` 懒加载闭包 | 398,197 | 121,857 | 185,000 | 通过 |

目标详情正文只在需要时加载，新正文闭包为 364,774 B；这是加载时机优化，不是删除代码。白天需在隔离桌面确认打开详情的首屏与等待状态，并评估 Renderer 总量。普通 macOS 原生助手保留双架构与原签名处理，仅使用 `-Osize`，由 461,224 B 降至 437,880 B；需白天复核整体预算与正式包，未改变预算检查口径。

### 6.3 逐项证据

| 设计 §7.4 项 | 当前证据 | 尚未验收 |
| --- | --- | --- |
| 需求 1 | `local-deploy-ui.test.tsx`、`server-location.test.ts` | 欢迎页两条真机链路 |
| 需求 2 | `bootstrap.test.ts` 的成功、取消、回滚及重试夹具 | 全新签名部署与自动登录 |
| 需求 3 | `deploy-events.test.ts`、bootstrap 的 stdin 与哨兵输出检查 | 无 |
| 需求 4 | `engine.test.ts`、`config.test.ts`、`managed-engine.test.ts` | Linux Docker 引擎手工回归 |
| 需求 5 | WSL 归属、NAT、UAC 拒绝、续跑和摘要夹具 | Spike A/B/D、M2 清单 |
| 需求 6 | Lima 配置、MACOS_UNSUPPORTED 和签名校验夹具 | Spike C、M3 清单、签名公证 |
| 需求 7 | `local-deploy.test.ts` 状态和恢复、`lifecycle.test.ts` 移除夹具 | 真实退出、重启、移除回收 |
| 需求 8 | `update-agent.test.ts`、`cli-update.test.ts` 独立载体证据；`engine-upgrade.test.ts` 与平台回滚夹具 | Spike E 真机、两代托管资产迁移和回滚 |
| 需求 9 | `deploy-resources.test.ts` 公式、向导低内存覆写夹具 | Spike F 校准 |
| 需求 10 | IPC 授权和参数测试、回环规则及签名篡改夹具 | Windows/macOS 实际监听检查 |
| 需求 11 | 诊断哨兵、23 项错误码和排障表静态比对 | 真机错误处理 |
| 需求 12 | 安装、备份、排障与国际化已核对 | 实际备份恢复及终端、Linux、远程手工清单 |
| 需求 13 | 托盘、窗口生命周期、退出偏好夹具 | 实际关窗、关机/注销和更新 |
| 需求 14 | `engine-assets-build.test.ts` 与公告格式及清单比对 | 组件批准、对应源码、法务确认 |
| 非功能需求 1 | 渲染测试断言两秒内显示首条进度 | 首次部署耗时与 Spike F 基线 |
| 非功能需求 2 | bootstrap 阶段故障注入、部署忙锁、续跑状态夹具 | Windows 进程树及真实重启 |
| 非功能需求 3 | 引擎选择与事件契约测试；诊断文本脱敏 | 无 |
