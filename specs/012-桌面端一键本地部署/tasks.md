# 任务清单 - 桌面端一键本地部署（人话版）

状态：Draft

关联文档：[需求文档](requirements.md)、[设计文档](design.md)、[补充文档目录](docs/README.md)

## 这份文档是干什么的

这份任务清单把“桌面端一键本地部署”拆成可以逐步验证的步骤。先用阶段 1 的 Spike 验证最危险的假设，再按阶段 2 到 6 实现。每个任务都能追踪到需求和设计，完成后立即回写状态。

规划（任务 1.1、1.2）已完成。2026-11-24 按用户授权推进 M2/M3 候选代码；该授权不等于 1.10 或任何发布 Go，实际进度以各任务状态和证据为准。

2026-11-24：用户确认可继续实现 M2/M3 的代码与自动化测试。真机、Spike F、法务、签名和发布仍待验收；此决定不是 1.10 的发布 Go。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- `BLOCKED` 必须写清楚卡在哪里
- `CANCELLED` 必须写清楚为什么不做
- 每做完一个任务，必须立刻更新这里

## 每个任务的字段

在模板字段之外，每个任务额外有两项，便于逐项核对：

- **技术规划：** 点名要改的文件、符号、命令、接口和关键参数，以及做法的顺序，使没参与讨论的工程师可以直接动手。Spike 任务写“要验证什么、用什么方法”。
- **指标：** 可以被判定为通过或失败的标准，如数值阈值、计数、退出码、命令输出、事件序列。标注“初值”的阈值是规划时的假设，可在 Spike 或实测后调整，调整时必须回写本文和 `design.md`。

核对：运行 `python3 -I specs/012-桌面端一键本地部署/docs/check_spec.py specs/012-桌面端一键本地部署`，退出码为 0 表示引用、依赖、双向追踪、验收标准覆盖和任务字段都完整。

## 阶段与里程碑

| 阶段 | 内容 | 里程碑 |
| --- | --- | --- |
| 阶段 1 | Spec 与 Spike，先验证再投入 | 前置；M1 只依赖 1.7，其余结论决定 M2、M3 |
| 阶段 2 | CLI 引擎抽象与非交互部署 | M1 的一半 |
| 阶段 3 | 桌面端向导与设置 | M1 |
| 阶段 4 | Windows 托管引擎 | M2 |
| 阶段 5 | macOS 托管引擎 | M3 |
| 阶段 6 | 文档、国际化与最终验收 | 收尾 |

---

## 阶段 1：Spec 与 Spike

- [x] 1.1 建立 Spec 目录与主文档
  - 状态：DONE
  - 这一步到底做什么：复制模板，写出需求、设计、任务和补充文档。
  - 做完你能看到什么：`specs/012-桌面端一键本地部署/` 下有完整的主文档，三份主文档互相引用。
  - 先依赖什么：无
  - 开始前先看：`specs/000-Spec规范/Spec模板/`、`AGENTS.md`
  - 技术规划：
    1. 复制 `specs/000-Spec规范/Spec模板` 为 `specs/012-桌面端一键本地部署`，按模板填写需求、设计、任务和补充文档。
    2. 用 `docs/check_spec.py` 核对引用、依赖、双向追踪和验收标准覆盖。
  - 主要改哪里：当前 Spec 目录
  - 这一步先不做什么：不修改任何业务代码。
  - 怎么算完成：目录结构与模板一致；内容为中文；需求、设计、任务可逐项追踪。
  - 指标：
    - `python3 -I docs/check_spec.py specs/012-桌面端一键本地部署` 退出码为 0。
    - 目录下有 README、requirements、design、tasks 四份主文档和 `docs/`。
  - 怎么验证：检查目录结构；对需求、设计章节、任务编号做交叉引用核对。
  - 对应需求：全部需求
  - 对应设计：`design.md` §1

- [x] 1.2 记录现状核查与引擎选型
  - 状态：DONE
  - 这一步到底做什么：把对桌面端、CLI、compose 的代码核查结论，以及引擎方案对比写成补充文档，区分“已核实”和“未验证”。
  - 做完你能看到什么：后续设计和 Spike 都能对照同一份事实基线，不会把未验证的假设当事实。
  - 先依赖什么：1.1
  - 开始前先看：`docs/20261123-现状核查记录.md`、`docs/20261123-引擎方案对比与选型.md`
  - 技术规划：
    1. 逐项读桌面端、CLI、compose、打包配置的代码，记录文件与符号。
    2. 把结论分成“已核实”和“未验证”两张表；引擎方案对比列出官方文档出处。
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不做任何实验，不下结论说引擎一定可用。
  - 怎么算完成：每条事实都有代码位置或出处；未验证项单独列出。
  - 指标：
    - 核查记录中每条“已核实”都有文件加符号（或行号）或官方文档链接。
    - “未验证”单独成表，编号连续，当前 13 条。
  - 怎么验证：抽查引用的文件与行号。
  - 对应需求：全部需求（作为依据）
  - 对应设计：`design.md` §1.4、§3.3.4、§3.3.6

- [ ] 1.3 Spike A：WSL2 私有发行版运行 computer 容器
  - 状态：BLOCKED（待干净 Windows x64 与受信 rootfs，真机暂缓）
  - 这一步到底做什么：在一台干净的 Windows 11 上，用最小 rootfs 加 dockerd 导入专用发行版，运行 `deploy/compose.yaml` 全栈，逐项验证 `computer` 的运行要求。
  - 做完你能看到什么：一份结论清楚的记录：cgroup v2 可写、`computer-memory-init` 就绪、nftables、`/dev/net/tun`、`systempaths=unconfined`、`pid: service:`、`127.0.0.1` 端口转发各自通过或失败，并附证据；同时记录 Windows Home 是否可用、Windows 版本下限能否低于 `design.md` §3.3.8 的取值、托管 CI runner 是否可用。Windows ARM64 已决定不支持，不需要验证。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 5、需求 4.6
    - `design.md` §3.3.4、§8.2 Q1、Q8、Q10、Q12
    - `docs/20261123-现状核查记录.md` §4
  - 技术规划：
    1. 在一台干净的 Windows 11 x64 上执行 `wsl --install --no-distribution`（需要管理员，必要时重启）。
    2. 以 Debian 或 Alpine 最小 rootfs 为底（二选一并记录理由），`wsl --import outcomego-engine <目录> <tar> --version 2`；在 `/etc/wsl.conf` 设 `[boot] systemd=true`。
    3. 在发行版内安装固定版本的 dockerd 与 Compose，把 `deploy/compose.yaml` 和一份测试 `.env` 放进去，`docker compose up -d`。
    4. 逐项验证 `computer` 的 8 个能力：cgroup v2 可写、`computer-memory-init` 的 ready 文件出现、nftables、`/dev/net/tun`、`systempaths=unconfined`、`pid: service:computer`、`127.0.0.1:8787` 与 `6200–6299` 从宿主机可达、带桌面的机器人能启动。
    5. 读取 `/sys/fs/cgroup/memory.max`；记录 Windows Home、版本下限、托管 CI runner 是否可用。
  - 主要改哪里：只写记录 `docs/<执行日期>-SpikeA-WSL2运行computer容器.md`；实验脚本放在仓库之外的临时目录。
  - 这一步先不做什么：不写产品代码；不改 `deploy/compose.yaml`；不触碰 `openteam-dev` 项目。
  - 怎么算完成：
    1. 每个能力项都有通过或失败的结论与证据。
    2. 失败项给出可行的绕过方案，或明确判定 No-Go。
    3. 结论回写 `design.md` §8.2 的 Q1、Q8、Q10、Q12。
  - 指标：
    - Go：8 个能力项全部通过，且 `docker compose ps` 中 `computer`、`computer-memory-init`、`server`、`worker`、`postgres` 连续 30 分钟（初值）保持 healthy 或 running，`computer` 的 `RestartCount` 为 0。
    - No-Go：任一项失败，且找不到不修改 `deploy/compose.yaml` 的绕过办法。
    - 每个能力项的结论附命令输出或日志作为证据。
  - 怎么验证：
    - 在真机上 `docker compose ps` 全部服务健康。
    - 手工开启一个带桌面的机器人，确认 Chromium 与 XFCE 正常，并读取 `/sys/fs/cgroup/memory.max`。
  - 对应需求：`requirements.md` 需求 5 / 验收 5.7、需求 4 / 验收 4.6
  - 对应设计：`design.md` §3.3.4、§8.2

- [ ] 1.4 Spike B：引擎内执行 compose 的调用方案
  - 状态：BLOCKED（需在 Windows 真机验证参数传递、挂载和性能）
  - 这一步到底做什么：验证“在引擎内执行 compose”的调用方式，包括 `wsl.exe -d … --cd … --exec docker compose …`。
  - 做完你能看到什么：确认 stdin 透传（owner 凭据 JSON）、退出码透传、取消时进程终止、路径转换（空格、中文用户名、非 C 盘）、`/mnt/c` 读取 `.env` 的速度；若不可行，给出“复制执行副本”备选方案的验证结果。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 4 / 验收 4.1、需求 10 / 验收 10.7
    - `design.md` §3.3.4、§8.2 Q2
  - 技术规划：
    1. 主方案：宿主机执行 `wsl.exe -d outcomego-engine --cd <WSL 路径> --exec docker compose --project-name outcomego --project-directory <路径> --env-file <路径> --file <路径> <参数>`，安装目录经 `/mnt/<盘符>/…` 访问。
    2. 验证四件事：stdin 透传（`compose exec --no-TTY server … owner-credentials` 传 JSON）、退出码透传、取消（宿主机终止 `wsl.exe` 后发行版内无残留 `docker compose` 进程）、路径转换（空格、中文用户名、非 C 盘）。
    3. 测 `/mnt/c` 读取 `.env` 与 `compose.yaml` 的耗时。
    4. 备选方案：把安装目录复制进发行版作为执行副本，宿主机目录为权威来源，每次变更前同步；同样验证上述四件事。
  - 主要改哪里：只写记录 `docs/<执行日期>-SpikeB-引擎内执行compose.md`。
  - 这一步先不做什么：不写产品代码；不暴露 Docker TCP 接口。
  - 怎么算完成：
    1. 主方案与备选方案各有通过或失败的结论。
    2. 选定的方案回写 `design.md` §3.3.4。
  - 指标：
    - 主方案四件事全部通过则选主方案；否则选备选方案，并说明主方案失败的具体项。
    - stdin 的 JSON（含中文与引号）往返逐字节一致。
    - 取消后 5 秒内（初值）发行版内无残留的 compose 进程。
    - `compose config` 在 `/mnt/c` 路径下耗时 ≤ 2 秒（初值）。
  - 怎么验证：
    - 实际执行 `up -d`、`exec`（带 stdin）、`ps`、`down`，核对输出与退出码。
    - 取消正在进行的 `pull`，确认没有残留进程。
  - 对应需求：`requirements.md` 需求 4 / 验收 4.1、需求 5 / 验收 5.7、需求 10 / 验收 10.7
  - 对应设计：`design.md` §3.3.4、§8.2

- [ ] 1.5 Spike C：macOS 虚拟机运行 computer 容器与签名公证
  - 状态：BLOCKED（待 Apple Silicon、Intel 真机及授权的签名公证资产）
  - 这一步到底做什么：在 macOS 上用 Lima（vz）和 vfkit 两条路线各跑一次全栈，并验证签名、虚拟化 entitlement 与公证。
  - 做完你能看到什么：确认 `computer` 容器能否运行、主目录共享与端口转发方式、macOS 13.5 这个下限是否成立、Intel Mac 在 13.5 上的客户机内核能否启动、应用退出后虚拟机是否继续运行（Q13），以及 `package:mac-release` 流程能否容纳辅助二进制；并选定实现路线。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §3.3.4、§8.1、§8.2 Q3、Q8、Q10
    - `apps/desktop/build/entitlements.mac.plist`、`apps/desktop/scripts/package-macos-release.ts`
  - 技术规划：
    1. 在 macOS 13.5 及以上的 Apple Silicon 与 Intel 各一台，分别用 Lima（`vmType: vz`）和 vfkit 加自管 dockerd 建虚拟机。
    2. 在虚拟机内运行 `deploy/compose.yaml`，验证与 Spike A 相同的 8 个能力项。
    3. 宿主机用 `lsof -iTCP -sTCP:LISTEN` 验证 8787 与 6200–6299 只监听 `127.0.0.1`。
    4. 退出应用后确认虚拟机管理进程仍运行，API 仍可访问（Q13）；确认 Intel 在 13.5 上所选的客户机内核能启动。
    5. 用临时签名身份验证带 `com.apple.security.virtualization` entitlement 的辅助二进制能启动虚拟机，评估对 `apps/desktop/build/entitlements.mac.plist` 与 `scripts/package-macos-release.ts` 的改动面。
  - 主要改哪里：只写记录 `docs/<执行日期>-SpikeC-macOS虚拟机引擎.md`。
  - 这一步先不做什么：不写产品代码；不修改正式发布的签名配置。
  - 怎么算完成：
    1. 两条路线各有通过或失败的结论，并选定一条或判定 No-Go。
    2. 结论回写 `design.md` §8.2 的 Q3、Q8、Q10、Q13，必要时回写 §3.3.8。
  - 指标：
    - Go 判据与 1.3 相同：8 个能力项全部通过，栈连续 30 分钟（初值）健康。
    - `lsof` 输出中 8787 与 6200–6299 没有 `*:` 通配监听。
    - 应用退出后管理进程存活 ≥ 10 分钟（初值）且 `/api/v0/health` 返回 ready。
    - 带 entitlement 的辅助二进制 `codesign --verify --deep --strict` 通过。
    - 两条路线都通过时选改动面更小的一条，并写明理由；都不通过为 No-Go。
  - 怎么验证：
    - 在真机上全栈健康，并开启一个带桌面的机器人。
    - 用临时签名身份验证带 entitlement 的辅助二进制可以启动虚拟机。
  - 对应需求：`requirements.md` 需求 6 / 验收 6.1–6.6
  - 对应设计：`design.md` §3.3.4、§8.1、§8.2

- [ ] 1.6 Spike D：Windows 启用 WSL 与重启续跑
  - 状态：BLOCKED（待隔离 Windows x64、管理员授权和真实重启）
  - 这一步到底做什么：验证从“WSL 未启用”到“重启后自动续跑部署”的完整路径。
  - 做完你能看到什么：确认启用命令与参数、从按用户安装的 NSIS 应用发起提权的方式、需要重启的判定、重启后续跑入口（候选 `RunOnce`）的可靠性，以及虚拟化未开启的检测方法；同时确认桌面端关闭窗口或退出后，WSL 托管引擎如何保持运行（Q13）。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.2、5.4
    - `design.md` §2.3.2、§3.2.4、§8.2 Q4
  - 技术规划：
    1. 覆盖四个场景：WSL 完全缺失、仅缺虚拟机平台、仅有 WSL1、BIOS 虚拟化关闭。每个场景记录 `wsl --status` 输出和桌面端能用的检测信号。
    2. 验证启用命令（候选 `wsl --install --no-distribution`）和从按用户安装的 NSIS 应用以 UAC 提权的方式（候选：`ShellExecute` 的 `runas` 启动一次性辅助程序，其他步骤不提权）。
    3. 验证重启续跑入口（候选：`HKCU` 下的 `RunOnce` 启动桌面端），确认 `deploy-state.json` 不含密钥。
    4. 验证保活：发行版内启用 systemd 后，桌面端退出，引擎与栈是否继续运行；候选做法是脱离进程树的 `wsl.exe -d outcomego-engine --exec sleep infinity`；记录实例空闲回收时间。
    5. 执行 `wsl --update`，记录 WSL 版本，确定版本下限。
  - 主要改哪里：只写记录 `docs/<执行日期>-SpikeD-启用WSL与重启续跑.md`。
  - 这一步先不做什么：不写产品代码；不修改用户的 `.wslconfig`。
  - 怎么算完成：
    1. 覆盖场景：WSL 完全缺失、虚拟机平台未启用、仅 WSL1、BIOS 虚拟化关闭；以及桌面端退出后引擎是否继续运行、保活进程是否能脱离桌面端进程树。
    2. 每个场景记录所需用户动作与桌面端可检测的信号。
    3. 结论回写 `design.md` §2.3.2、§3.3.4 与 Q4、Q13。
  - 指标：
    - 四个场景各有“检测信号、需要的用户动作、能否自动续跑”三列结论。
    - 重启续跑：重启后 60 秒内（初值）桌面端出现“继续部署”提示，连续 3 次成功。
    - 保活：桌面端退出 30 分钟后（初值）`http://127.0.0.1:8787/api/v0/health` 仍返回 ready；做不到则判定需求 7.3 在 Windows 上需要额外机制，并回写设计。
    - 一次完整部署中 UAC 提示 ≤ 1 次。
  - 怎么验证：
    - 在干净的 Windows 11 虚拟机上逐场景实测，包含一次真实重启。
  - 对应需求：`requirements.md` 需求 5 / 验收 5.2、5.4
  - 对应设计：`design.md` §2.3.2、§3.2.4、§3.3.4、§8.2

- [ ] 1.7 Spike E：CLI 载体与更新代理
  - 状态：BLOCKED（缺少含新 CLI 的受信测试资产，用户暂缓真机复测）
  - 证据：[macOS 载体验证记录](docs/20261123-SpikeE-CLI载体与更新代理.md)。Release 校验和清单可取，但仓库下载与校验流程未跑完，因此未执行载体或代理。Windows 测试机可以安排，未收到复测输出。M1 按既定方案 (b) 推进，Q5 不关闭。
  - 这一步到底做什么：验证内置 CLI 与更新代理的冲突，并验证“按需下载独立二进制”方案。
  - 做完你能看到什么：确认 Windows 上以 Electron 作为常驻代理是否真的会占用桌面端 exe 而阻塞自更新；确认方案 (b) 下桌面端调用独立二进制、更新代理指向稳定路径，且桌面自更新后代理仍可用；给出 (a)(b)(c) 的最终选择。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 8
    - `design.md` §3.3.5、§8.2 Q5
    - `apps/cli/src/update-agent.ts:142-215`、`apps/cli/src/update-agent-service.ts:36-66`
  - 技术规划：
    1. 在 Windows 上让更新代理以 Electron 可执行文件常驻（模拟 `updateAgentCommand` 现在用 `process.argv[0]`、`process.argv[1]` 的拼法），再尝试替换桌面端安装目录里的 exe（模拟 NSIS 升级），观察是否被占用。
    2. 实现方案 (b) 的最小验证：从 Release 下载 Bun 单文件 CLI 到 `%LOCALAPPDATA%\OutcomeGo\bin`（macOS 为 `~/.local/bin`），桌面端用它调用 `status --json`，更新代理指向它。
    3. 模拟桌面端自更新（改变应用目录与版本号），检查代理命令是否仍有效。
    4. 对比 (a)(b)(c) 三个方案的安装包体积增量与 `bun scripts/performance/check-desktop-budgets.ts --release` 的结果。
  - 主要改哪里：只写记录 `docs/<执行日期>-SpikeE-CLI载体与更新代理.md`。
  - 这一步先不做什么：不写产品代码；不改现有安装脚本。
  - 怎么算完成：
    1. 复现或否定“占用 exe 阻塞自更新”的推断。
    2. 方案选定并回写 `design.md` §3.3.5 与 Q5。
  - 指标：
    - 明确复现或否定“常驻代理占用桌面端 exe，导致升级失败”。
    - 方案 (b) 下自更新后，代理启动命令指向的文件存在且可执行（是或否）。
    - 方案 (a) 若使 dmg 超过 135 MiB 或 nsis 超过 160 MiB，则淘汰。
    - 最终选择写入 `design.md` §3.3.5 并关闭 Q5。
  - 怎么验证：
    - 在 Windows 与 macOS 上实测：启动代理，再替换桌面端文件，观察是否被占用。
  - 对应需求：`requirements.md` 需求 8 / 验收 8.1、8.2
  - 对应设计：`design.md` §3.3.5、§8.2

- [ ] 1.8 Spike F：内存与磁盘实测
  - 状态：BLOCKED（用户暂缓办公任务；不修改远端环境、不改用夹具推断）
  - 待验证：用户暂缓办公负载；恢复后按 [验收结果](docs/acceptance-result.md) 回传采样窗口。
  - 这一步到底做什么：实测一个典型办公任务的真实内存占用、镜像总体积和首次部署耗时，校准资源公式。
  - 做完你能看到什么：单机器人与 2–3 个机器人的 `memory.peak` 与 `anon`、各服务内存占用、镜像总体积、首次部署耗时基线、WSL2 默认虚拟机内存比例；据此确认或修正 `design.md` §3.3.6 的公式与最低配置。
  - 先依赖什么：1.3 或 1.5（需要一个可运行的托管引擎）
  - 开始前先看：
    - `requirements.md` 需求 9、非功能需求 1
    - `design.md` §3.3.6、§8.2 Q6
    - `docs/20261123-引擎方案对比与选型.md` §4
  - 技术规划：
    1. 在 openteam-debug 上由用户跑一轮典型办公任务后，只读采集 `/sys/fs/cgroup/desktops/*/memory.peak`、`memory.stat` 的 `anon`，以及各容器的 `docker stats`。
    2. 在托管引擎上重复：先 1 个机器人，再 2–3 个机器人并发。
    3. `docker images` 汇总镜像总体积；记录首次 `compose pull` 的耗时和流量；读取 WSL2 虚拟机默认内存比例。
    4. 用实测值替换《引擎方案对比与选型》§4 的估算表，校准 `design.md` §3.3.6 的公式。
  - 主要改哪里：只写记录 `docs/<执行日期>-SpikeF-内存与磁盘实测.md`。
  - 这一步先不做什么：不改默认值；不在调试环境重建 computer（重建前须征得同意）。
  - 怎么算完成：
    1. 估算表中的每一行都被实测值替代或修正。
    2. 首次部署耗时基线已记录。
    3. 公式与最低配置回写 `design.md` §3.3.6。
  - 指标：
    - 估算表的每一行都被实测值替换，或标明偏差。
    - 单机器人的 `anon` 峰值与 `memory.peak` 各至少 3 次采样，给出中位数和最大值。
    - 首次部署耗时基线以分钟记录，附带带宽条件。
    - 若单机器人峰值超过公式给出的 `desktopLimit`，则调整公式或最低配置。
  - 怎么验证：
    - 在 openteam-debug 上由用户运行一轮办公任务后，只读读取 `/sys/fs/cgroup/desktops/*/memory.peak`、`memory.stat`。
    - 在托管引擎上重复一次。
  - 对应需求：`requirements.md` 需求 9 / 验收 9.1–9.3、非功能需求 1 / 验收 1.4
  - 对应设计：`design.md` §3.3.6、§8.2

- [ ] 1.9 合规方案：第三方组件登记、源码获取方式与法务确认
  - 状态：BLOCKED（法务暂缓；等待固定资产组件、对应源码及 §6 的五项答复）
  - 待验证：用户暂缓法务确认，五问暂无答复或预计日期；公开发布托管资产继续阻塞。
  - 这一步到底做什么：把《许可证评估与建议》落成可执行的方案：定下 `THIRD-PARTY-NOTICES` 的格式与生成方式，定下含 GPL 类组件的资产的源码获取方式，把法务问题清单提交并记录答复。
  - 做完你能看到什么：有一份可直接套用的登记模板和流程；法务答复已记录；4.1、5.1 知道自托管的资产需要附带什么。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 14
    - `design.md` §3.3.9、§8.2 Q11
    - `docs/20261123-许可证评估与建议.md`
  - 技术规划：
    1. 确定 `THIRD-PARTY-NOTICES` 的格式（组件、版本、许可证、来源、NOTICE）与生成方式（候选：SBOM 工具生成 SPDX，再手工补 NOTICE）。
    2. 盘点四类分发物：桌面端（Electron、Chromium 声明）、CLI、GHCR 镜像（`docker/computer.Dockerfile` 的 apt 软件包）、托管引擎资产。
    3. 确定源码获取方式：Release 页面旁放源码归档或固定链接，写明位置，保持 ≥ 3 年。
    4. 把《许可证评估与建议》§6 的 5 个问题交给法务并记录答复。
    5. 确定“组件清单与 `THIRD-PARTY-NOTICES` 一致”的发布检查落点，候选 `scripts/check/release-workflows.ts`。
  - 主要改哪里：
    - `docs/<执行日期>-合规方案.md`（记录）
    - 仓库根目录 `THIRD-PARTY-NOTICES`（只放骨架与登记范围，不含未确认的内容）
  - 这一步先不做什么：不写产品代码；不决定引擎资产是自托管还是安装时下载（由 Spike A、C 的结论决定）；不替法务下结论。
  - 怎么算完成：
    1. 登记范围覆盖四类分发物：桌面端、CLI、GHCR 镜像、托管引擎资产，并确定登记内容的生成方式（SBOM 或手写）。
    2. 源码获取方式（位置、保留期限、写在资产旁的文字）已确定。
    3. 法务问题清单已提交，答复或预计答复时间已记录。未答复之前，4.1、5.1 的公开发布保持阻塞。
    4. 现有 GHCR 镜像的合规现状作为单独发现记录下来，不在本 Spec 内修复。
  - 指标：
    - 四类分发物各有登记范围和生成方式。
    - 法务 5 个问题各有答复或预计答复日期。
    - 法务未答复前，4.1、5.1 不得标记为 DONE（可检查）。
  - 怎么验证：
    - 文档审阅；对照现有 Release 与镜像资产，核对登记范围没有遗漏。
  - 对应需求：`requirements.md` 需求 14 / 验收 14.1、14.2、14.5、14.6
  - 对应设计：`design.md` §3.3.9、§6.10、§8.2

### 阶段检查

- [ ] 1.10 阶段检查：Spike 与合规结论回写，Go/No-Go
  - 状态：BLOCKED（缺少平台、办公负载、法务与签名证据；允许编写候选代码，不构成 Go）
  - 这一步到底做什么：汇总 Spike A–F 与合规方案的结论，更新需求和设计，并决定 M2、M3 是否进入实现。
  - 做完你能看到什么：待确认项 Q1–Q14 全部有结论或明确的延期说明；M2、M3 各有 Go 或 No-Go 决定。
  - 先依赖什么：1.3、1.4、1.5、1.6、1.7、1.8、1.9
  - 开始前先看：
    - `requirements.md`
    - `design.md` §8
    - `tasks.md`
  - 技术规划：
    1. 汇总 Spike A–F 与合规方案的结论。
    2. 对 Q1–Q14 逐项标注“已验证 / 已决定 / 延期”，并回写受影响的需求、设计、任务。
    3. 对 M2、M3 各下 Go 或 No-Go；No-Go 项写替代方案或取消原因。
    4. 运行 `docs/check_spec.py`。
  - 主要改哪里：`requirements.md`、`design.md`、`tasks.md`
  - 这一步先不做什么：不加新需求，不开始写产品代码。
  - 怎么算完成：
    1. 每个 Spike 的结论都已回写到设计。
    2. 受影响的需求和任务已同步修改。
    3. No-Go 项的替代方案或取消原因已记录。
  - 指标：
    - Q1–Q14 共 14 项都有结论或延期理由。
    - M2、M3 各有明确的 Go 或 No-Go 与依据。
    - `check_spec.py` 退出码为 0。
  - 怎么验证：
    - 人工走查 `design.md` §8.2 的每一行。
  - 对应需求：`requirements.md` 需求 4 / 验收 4.6、需求 5 / 验收 5.7、需求 6 / 验收 6.6
  - 对应设计：`design.md` §8

---

## 阶段 2：CLI 引擎抽象与非交互部署

- [x] 2.1 引擎提供者接口与 external 实现
  - 状态：DONE
  - 证据：Compose 与直接 Docker 调用已经由提供者执行，规定的扫描在 `engine/` 外 0 处命中。夹具覆盖引擎选择、`ready`、`needs-setup`、`stopped` 以及隔离探测四种结果。CLI 全量 774 通过、doctor 225 通过、install 65 通过，最终均为 0 失败；并行运行安装套件时两个安装夹具触发 5000 ms 超时，串行复跑通过，未修改超时或断言。类型检查和架构检查通过。
  - macOS 实测：[隔离探测记录](docs/20261123-macOS外部引擎隔离探测.md)。本机引擎运行后 `engine status --json` 返回 `ready`；用本机缓存的 `computer` 构建镜像验证了 `systempaths=unconfined`、私有 cgroup v2 可写、TUN 接口创建，命令均退出 0。
  - 变更记录：2026-11-23，Docker 只读元数据不足以证明容器内能力；经用户确认，有缓存的发布镜像在拉取前验证，无缓存时在正常拉取后、启动前验证，见 `design.md` §3.3.4。
  - 这一步到底做什么：新增引擎提供者接口和 `external` 实现，把散落的 docker 调用改走提供者，并让预检文案与引擎无关。
  - 做完你能看到什么：CLI 源码中除了 `engine/external` 之外，没有直接写死 `docker` 的调用；macOS 上 Docker Desktop 的自动拉起行为保留，作为 `external` 的就绪步骤；`outcomego engine status --json` 可用。
  - 先依赖什么：1.2（M1 只在 `external` 引擎上交付，不等待 Spike A–D、F 与合规方案，见 `design.md` §1.5）
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §3.2.1、§3.3.2、§3.3.4
    - `docs/20261123-现状核查记录.md` §2
  - 技术规划：
    1. 新增 `apps/cli/src/engine/types.ts`（`EngineProvider`、`EngineDetection`，字段见 `design.md` §3.2.1）、`external.ts`、`select.ts`。
    2. 把 `docker.ts` 与 `docker-preflight.ts` 里的探测逻辑（`dockerVersion`、`dockerDaemon`、`probeCompose`、`addressPoolsExhausted`、`startDockerDesktop`）迁入 `engine/external.ts`，`docker.ts` 只保留 `ComposeProject`。
    3. `ComposeProject.invocation` 向提供者索取调用描述；`disk-maintenance.ts`（6 处）、`doctor-probes.ts`（1 处）、`stack.ts`（1 处）的 `runner.run("docker", …)` 改为 `engine.docker(…)`。
    4. `docker-preflight.ts` 与 `docker-diagnostics.ts` 的文案改为取自提供者，不再写死 Docker Desktop。
    5. `select.ts` 规则：清单已记录引擎则只用它；首次且 `auto` 时先 external 后 managed；Linux 只用 external。
    6. `main.ts` 增加 `engine status --json`；`external.detect` 只读检查 cgroup 版本等要求；新增独立的隔离能力探测函数，由 2.4 接入首次部署。
  - 主要改哪里：
    - `apps/cli/src/engine/`（新增：类型、`external`、选择器）
    - `apps/cli/src/docker.ts`（`ComposeProject.invocation`、`probeCompose`、`requireComposeProject`）
    - `apps/cli/src/docker-preflight.ts`、`apps/cli/src/docker-diagnostics.ts`
    - `apps/cli/src/disk-maintenance.ts`、`apps/cli/src/doctor-probes.ts`、`apps/cli/src/stack.ts`、`apps/cli/src/doctor.ts`
    - `apps/cli/src/main.ts`、`apps/cli/src/arguments.ts`、`apps/cli/src/help.ts`
  - 这一步先不做什么：不实现 `managed` 提供者；不改 `deploy/compose.yaml`；不改变交互式命令的行为。
  - 怎么算完成：
    1. 对 `apps/cli/src` 搜索直接的 `"docker"` 调用，只剩 `engine/external` 内部。
    2. `external` 的 `detect` 能报告 Compose 版本和 cgroup 版本，并按需求给出具体缺失项。
    3. 现有 CLI 测试全部通过，Linux 与 `external` 行为不变。
    4. 引擎选择规则有单元测试。
  - 指标：
    - `grep -rnE 'run\("docker"|"docker-compose"' apps/cli/src` 在 `engine/` 之外 0 处命中。
    - `apps/cli` 下 `bun test`、`bun run test:doctor`、`bun run test:install` 全部通过，用例数不少于改动前。
    - `engine status --json` 在“已装 Docker、未装 Docker、Docker 已停止”三种夹具下分别返回 `ready`、`needs-setup`、`stopped`。
    - 选择规则单元测试覆盖“清单已记录、auto、Linux”三条路径。
    - 隔离探测覆盖已缓存、未缓存、能力失败与探测执行失败；用本机缓存镜像复测三项能力。
  - 怎么验证：
    - `bun test`、`bun run test:doctor`、`bun run test:install`（在 `apps/cli` 下）。
    - 用 `grep` 核对直接 docker 调用清零。
  - 对应需求：`requirements.md` 需求 4 / 验收 4.1–4.6、非功能需求 3 / 验收 3.1
  - 对应设计：`design.md` §3.2.1、§3.3.2、§3.3.4

- [x] 2.2 安装清单记录引擎并锁定
  - 状态：DONE（经 IN_PROGRESS、IN_REVIEW 验证）
  - 实际输出：`config.test.ts` 11 pass / 0 fail；旧清单读取不回写，修改 `engine.kind` 抛错；`engine.test.ts` 的 Docker 就绪、缺失、停止三种夹具均保留已记录的引擎，拒绝切换。CLI 全量 788 pass / 0 fail，类型与架构检查通过。
  - 这一步到底做什么：在 `installation.json` 里记录创建栈时的引擎，并保证之后不会被静默切换。
  - 做完你能看到什么：新安装的清单带 `engine` 字段；旧清单（没有该字段）按 `external` 处理；已有 `engine` 的安装，选择器只会选它。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4 / 验收 4.4
    - `design.md` §3.2.2、§6.2
  - 技术规划：
    1. `config.ts` 的 `InstallationManifest` 增加可选 `engine`（`kind`、`name`、`version`、`createdAt`），`schemaVersion` 保持 1；`readManifest` 对缺省值补 `external`。
    2. 首次创建栈成功时写入 `engine`。
    3. `select.ts` 读取清单，已有 `engine` 则只返回该引擎，否则返回 `ENGINE_UNAVAILABLE` 并说明原因。
    4. 栈已存在时，`writeManifest` 拒绝修改 `engine.kind`。
  - 主要改哪里：
    - `apps/cli/src/config.ts`（`InstallationManifest`、读写）
    - `apps/cli/src/engine/`（选择器）
    - `apps/cli/test/config.test.ts`
  - 这一步先不做什么：不做引擎迁移；`schemaVersion` 保持为 1。
  - 怎么算完成：
    1. 旧清单读取不报错且行为不变。
    2. 试图以别的引擎操作已有安装时，得到明确的拒绝信息。
  - 指标：
    - 旧清单（无 `engine`）读取不报错，行为与升级前一致（回归测试）。
    - 已有 `engine` 的安装，在 3 种环境夹具下选择器都只返回该引擎（3 个用例）。
    - 修改 `engine.kind` 时 `writeManifest` 抛错（1 个用例）。
    - `apps/cli/test/config.test.ts` 全部通过。
  - 怎么验证：
    - 清单读写与选择器的单元测试。
  - 对应需求：`requirements.md` 需求 4 / 验收 4.4
  - 对应设计：`design.md` §3.2.2、§6.2

- [ ] 2.3 异步运行器与 NDJSON 进度事件
  - 状态：IN_REVIEW（实现及 macOS 自动验证完成）
  - 实际输出：`deploy-events.test.ts` 与 `process-streaming.test.ts` 7 pass / 0 fail；事件往返、半行与 UTF-8 分片、交错输出、超 1 MiB 行、23 个错误码、哨兵脱敏、0600 与日志轮换均通过；取消后孙进程探测返回 `ESRCH`。
  - 待验证：在 Windows x64 隔离机运行 `bun test test/process-streaming.test.ts test/deploy-events.test.ts`，预期全通过且取消后子进程树无残留，回传命令输出。
  - 这一步到底做什么：新增进度事件与错误码的类型、序列化和脱敏，以及供长任务使用的异步流式运行器，并把日志写入 `logs/`。
  - 做完你能看到什么：可以用一个函数发出符合 §3.2.3 的单行 JSON 事件；子进程输出可以逐行转成事件；所有文本先脱敏；错误码与退出码按 §5.1 映射。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 11、非功能需求 3
    - `design.md` §3.2.3、§5.1、§5.2
  - 技术规划：
    1. 新增 `deploy-events.ts`：`DeployProgressEvent` 联合类型、`emit(event)`（单行 JSON 写 stdout）、`redact(text)`（复用 `@outcomego/product-core/redaction` 的 `safeErrorMessage`，并追加对 `.env` 键值与令牌的脱敏）、错误码到退出码的映射表（`design.md` §5.1）。
    2. `process.ts` 新增 `runStreaming(command, args, options)`：用 `spawn` 而非 `spawnSync`，按行切分 stdout 与 stderr 并回调，支持 `AbortSignal` 取消并终止整个进程树；不改动现有 `SystemCommandRunner`。
    3. 日志写入安装目录 `logs/bootstrap-<时间>.log`，权限 0600，保留最近 5 个文件、每个 ≤ 10 MiB（初值）。
  - 主要改哪里：
    - `apps/cli/src/deploy-events.ts`（新增）
    - `apps/cli/src/process.ts`（新增异步运行器，保留现有同步运行器不变）
    - `apps/cli/test/`（新增对应测试）
  - 这一步先不做什么：不实现部署流程本身；不改现有同步运行器的行为。
  - 怎么算完成：
    1. 事件序列化、`schemaVersion`、脱敏有单元测试。
    2. 半行、超长行、乱序输出的逐行解析有测试。
    3. 日志文件滚动保留，权限正确。
  - 指标：
    - 事件序列化与解析的往返测试通过；半行、超长行（≥ 1 MiB）、乱序输出各至少 1 个用例。
    - 对包含测试密码与测试令牌的输入，脱敏后输出中搜不到原文（断言）。
    - `design.md` §5.1 表中的每个错误码都映射到 {1, 2, 3, 130} 之一，测试遍历全部。
    - 取消后进程树无残留（夹具子进程验证）。
  - 怎么验证：
    - 单元测试，包含密码与令牌样例的脱敏断言。
  - 对应需求：`requirements.md` 需求 3 / 验收 3.1–3.3、3.6，需求 10 / 验收 10.3，需求 11 / 验收 11.1、11.3，非功能需求 3 / 验收 3.2、3.3
  - 对应设计：`design.md` §3.2.3、§5.1、§5.2

- [ ] 2.4 `bootstrap` 命令与 `status --json`
  - 状态：IN_REVIEW（夹具通过，待签名发布的真机端到端）
  - 实际输出：`bootstrap.test.ts` 22 pass / 0 fail；真实 stdin 管道非法输入在 2 秒内退出 2 且未建目录，FakeRunner 全流程退出 0、末事件 `result`；密码扫描 0 命中、重复部署 `.env` SHA-256 相同。失败注入、取消、`BUSY`、两个回环绑定、缓存命中与未命中探测顺序、探测失败不启动均通过。新增取消标记使 `up` 中断、回滚并退出 130。`status --json` 子进程夹具退出 0、无写操作。
  - 待验证：M1 端到端使用含新命令的签名发布载体，在两平台检查完整非交互部署；当前 v0.1.0-beta.24 正式资产不含此命令。
  - 镜像源实际输出：CLI 全量 873 pass / 0 fail，桌面端 1126 pass / 1 skip / 0 fail。两端类型、架构、Spec 核对通过。Win11 真实镜像测速仅官方 GHCR 完成样本读取，选源结果为 `ghcr.io`。已构建并校验含自动选源的 Windows x64 QA 安装包，完整冷缓存对比和签名产品端到端仍待验收，见 [验收记录](docs/acceptance-result.md)。
  - 变更记录：2026-11-23，按 2.1 实测与用户确认，把运行时能力探测接在已验证发布的 `computer` 镜像可用后、服务栈启动前。
  - 变更记录：2026-11-23，明确本机部署只接受本地套接字或命名管道，防止对远程 Docker 上下文写入；旧 CLI 命令不受影响。
  - 变更记录：2026-11-24，独立 `bootstrap.ts` 复用现有配置和健康检查；首次成功创建 owner 后提交清单，失败恢复本次写入。
  - 变更记录：2026-11-24，Windows 使用独立的非秘密取消信号，避免 `taskkill /F` 跳过回滚；见 `design.md` §2.3.1。
  - 变更记录：2026-11-24，Windows QA 部署实测 GHCR `computer` 镜像拉取缓慢，按用户确认将多源测速与回退纳入产品。见 `requirements.md` 需求 2.7、`design.md` §2.3.1。
  - 这一步到底做什么：实现非交互的 `bootstrap` 流水线和只读的 `status --json`。
  - 做完你能看到什么：在没有 TTY 的环境里，`outcomego bootstrap --json-progress` 能从零完成下载、配置、拉取、启动、健康检查和创建 owner，并输出事件；重复执行是幂等的；`status --json` 返回引擎与栈状态。
  - 先依赖什么：2.2、2.3、2.5（2.5 可与 2.2、2.3 并行先做）
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §2.3.1、§3.3.1、§3.3.2、§5
    - `apps/cli/src/lifecycle.ts:315-431`、`apps/cli/src/setup.ts:961`、`apps/cli/src/password.ts:65`
  - 技术规划：
    1. `main.ts`、`arguments.ts` 注册 `bootstrap` 与 `status --json`，`help.ts` 补文案。
    2. `lifecycle.ts` 新增 `bootstrapCommand`，阶段顺序：校验 stdin → `detect` → `engine` → `release` → `configure` → `pull` → `start` → `health` → `owner`，复用 `downloadRelease`、`writeFileAtomic`、`createEnvironment`、`startProject`。
    3. `owner` 阶段复用 `compose exec --no-TTY server bun main.js owner-credentials`，凭据 JSON 经 stdin 传入（与 `password.ts`、`setup.ts` 现有调用一致），完成后写回清单 `ownerUsername` 并调用 `ensureUpdateAgent`。
    4. stdin 校验复用 `validateOwnerUsername` 与 `validateOwnerPassword`，失败以 `INVALID_INPUT` 并带 `field` 结束，此时尚未创建安装目录。
    5. 幂等：清单存在且 `ownerUsername` 已配置时，只做启动与健康检查。并发：用安装目录下的锁文件（参考 `update-agent.lock`）保证单写者，冲突返回 `BUSY`。首次安装失败沿用 `lifecycle.ts` 现有回滚。
    6. 先验证 Compose 2.20 是否支持 `pull --progress=json`（Q7），不支持则按镜像 N/M 上报。`status.ts` 增加 `--json`。
    7. 本地模式 `.env` 默认 `OUTCOMEGO_BIND_HOST` 与 `OUTCOMEGO_VIEWER_BIND_HOST` 为 `127.0.0.1`（`createEnvironment` 现有默认）。
    8. 首次部署在发布配置校验后解析 `computer` 镜像摘要，按 `design.md` §3.3.4 在 `pull` 前探测，未缓存则在 `pull` 后探测；失败时不得执行 `compose up`。
    9. 托管引擎在拉取阶段比较预设镜像与官方源的目标摘要及实测速度，按测速排序回退，并为实际使用的镜像记录与签名 Compose 内容绑定的补充配置。
  - 主要改哪里：
    - `apps/cli/src/lifecycle.ts`、`apps/cli/src/main.ts`、`apps/cli/src/arguments.ts`、`apps/cli/src/help.ts`
    - `apps/cli/src/status.ts`
    - `apps/cli/src/setup-values.ts`（本地模式默认值）
  - 这一步先不做什么：不改交互式 `install`、`setup` 的行为；不实现 `managed` 引擎；不处理 Windows 重启续跑。
  - 怎么算完成：
    1. 无 TTY 下可以完成全流程，owner 凭据只经 stdin，不出现在参数、环境变量、日志和事件中。
    2. 已有安装且 owner 已配置时，只启动并输出 `result`，不覆盖 `.env`。
    3. 取消和失败后，首次安装不留半成品；重试能继续。
    4. 同一安装目录的并发操作返回 `BUSY`。
    5. 记录 Compose 2.20 是否支持 `pull --progress=json`，并据此决定进度粒度（Q7）。
  - 指标：
    - 无 TTY（stdin 为管道）下全流程完成，退出码 0，最后一个事件为 `result`。
    - 对 stdout、stderr、`logs/`、安装目录全部文件搜索测试密码，命中 0 次。
    - 第二次执行 `bootstrap`，`.env` 的 SHA-256 不变（幂等）。
    - 向每个阶段注入失败，退出码与错误码符合 §5.1；首次安装失败后不存在 `installation.json`。
    - 同时启动两个 `bootstrap`，第二个以 `BUSY` 结束。
    - 用户名或密码不合规时 2 秒内以 `INVALID_INPUT` 结束，且安装目录未被创建。
    - 执行后 `.env` 中 `OUTCOMEGO_BIND_HOST` 与 `OUTCOMEGO_VIEWER_BIND_HOST` 均为 `127.0.0.1`。
    - 启动后 2 秒内输出第一个事件（非功能需求 1.1）。
    - 夹具断言缓存命中在 `pull` 前探测、缓存未命中在 `pull` 后探测；任一能力不兼容均无 `compose up` 调用。
  - 怎么验证：
    - FakeRunner 集成测试：全流程、每个阶段失败、重试、取消、并发。
    - 凭据泄露扫描：对全部输出与日志搜索测试密码。
    - 镜像源夹具覆盖清单篡改、限流、测速排序、缓存、取消、镜像拉取失败回退及补充配置的版本隔离。真机复测实际选源与下载耗时。
  - 对应需求：`requirements.md` 需求 2 / 验收 2.1–2.4、2.7，需求 3 / 验收 3.1–3.5、3.7，需求 4 / 验收 4.6，需求 10 / 验收 10.3、10.4，非功能需求 1 / 验收 1.1、1.3，非功能需求 2 / 验收 2.1–2.3
  - 对应设计：`design.md` §2.3.1、§3.3.1、§3.3.2、§3.3.4、§5

- [ ] 2.5 资源与端口预检、内存公式与调整入口
  - 状态：IN_REVIEW（自动检查通过，待真机重建）
  - 变更记录：2026-11-23，明确磁盘检查沿用 8 GiB 初值，宿主机检查不代表外部引擎客户机磁盘容量；待 Spike F 校准。
  - 实际输出：`deploy-resources.test.ts` 13 pass / 0 fail；4、6、16 GiB 分别生成 3/2、4.5/3.5、默认；`10x` 和 `15m` 退出 2；只重建两个指定服务。`bootstrap.test.ts` 确认 `DISK_SPACE_LOW`、`PORT_IN_USE`、`MEMORY_LOW` 均在 `detect` 结束且无 `pull`。CLI 类型与架构检查通过。
  - 待验证：M1 真机对隔离安装调整内存，确认 `computer` 与 `computer-memory-init` 重建后均正常。
  - 这一步到底做什么：实现 `detect` 阶段的内存、磁盘、端口检查，按公式写入内存限制，并新增 `resources set` 命令。
  - 做完你能看到什么：低内存时发出 `confirm-low-memory` 并等待确认；磁盘不足时在下载前阻止；端口被占用时指出占用者并允许更换 API 端口；`outcomego resources set` 能改写 `.env` 并重建 `computer` 与 `computer-memory-init`。
  - 先依赖什么：2.1（公式的最终数值依赖 1.8）
  - 开始前先看：
    - `requirements.md` 需求 2 / 验收 2.6、需求 9
    - `design.md` §3.3.2、§3.3.6、§5.1
    - `apps/cli/src/stack.ts`、`apps/cli/src/constants.ts:18`
  - 技术规划：
    1. 在 `detect` 阶段新增检查：宿主机内存（`os.totalmem()`，沿用 `MINIMUM_RECOMMENDED_MEMORY_BYTES`，8 GiB）、引擎客户机内存（`EngineProvider.memoryBytes()`）、磁盘（`fs.statfs` 对安装目录与引擎资产目录）、端口（复用 `stack.ts` 的 `occupiedHost` 与 `describePortOccupant`）。
    2. `config.ts` 新增 `resourceLimits(guestMem)`：`computerLimit = min(12 GiB, floor(guestMem × 0.75))`，`desktopLimit = max(1 GiB, computerLimit − 1 GiB)`；仅当 `computerLimit < 12 GiB` 时写入 `OUTCOMEGO_COMPUTER_MEMORY_LIMIT` 与 `OUTCOMEGO_DESKTOP_MEMORY_LIMIT`。
    3. 新增 `outcomego resources set --computer-memory <大小> --desktop-memory <大小>`：用 `replaceEnvironmentValue` 改写 `.env`，大小格式沿用 `apps/computer/src/desktop-memory.ts` 的 `parseMemoryLimit`，随后重建 `computer` 与 `computer-memory-init`。
    4. 低内存时发出 `action-required`（`confirm-low-memory`），带 `--accept-low-memory` 才继续。
  - 主要改哪里：
    - `apps/cli/src/config.ts`（`createEnvironment`、`replaceEnvironmentValue`）
    - `apps/cli/src/stack.ts`、`apps/cli/src/doctor.ts`
    - `apps/cli/src/lifecycle.ts`、`apps/cli/src/arguments.ts`、`apps/cli/src/help.ts`
  - 这一步先不做什么：不修改用户的 `.wslconfig`；不改 compose 的默认值。
  - 怎么算完成：
    1. 公式在 4 GiB、6 GiB、16 GiB 客户机内存下的输出有单元测试。
    2. 低内存、磁盘不足、端口占用各有对应的错误码和动作。
    3. `resources set` 在提示后重建 `computer` 与 `computer-memory-init`。
  - 指标：
    - 公式单元测试：客户机 4 GiB → computerLimit 3 GiB、desktopLimit 2 GiB；6 GiB → 4.5 GiB、3.5 GiB；16 GiB → 不写入，保持默认。
    - 磁盘不足、端口占用、内存不足分别返回 `DISK_SPACE_LOW`、`PORT_IN_USE`、`MEMORY_LOW` 和对应动作（3 个用例）。
    - 这些检查都发生在拉镜像之前：`detect` 失败事件先于 `pull` 的 `started`（事件顺序断言）。
    - `resources set` 对非法大小（如 `10x`、小于 16 MiB）以退出码 2 结束。
  - 怎么验证：
    - 单元测试加 FakeRunner 集成测试。
  - 对应需求：`requirements.md` 需求 2 / 验收 2.6、需求 9 / 验收 9.1–9.5
  - 对应设计：`design.md` §3.3.2、§3.3.6、§5.1

- [ ] 2.6 更新代理与 CLI 载体修复
  - 状态：IN_REVIEW（按 Spike E 默认方案 b 实现）
  - 实际输出：`cli-update.test.ts`、`update-agent.test.ts`、`update-agent-service.test.ts` 合计 27 pass / 0 fail。桌面代理参数不含 `app.asar.unpacked`，兼容版本复用、签名/摘要验证失败保留已有载体、`CLI_VERSION_MISMATCH` 与 `DOCKER_*` 透传均有测试。全量套件包含 `update --version 1.3.0` 安装夹具，结果为 `complete`。
  - 待验证：用户提供 Windows x64 和 macOS 含此版本的签名资产，按 Spike E 检查载体可复用、桌面升级后仍可执行；Windows 常驻时替换桌面文件不被占用。
  - 这一步到底做什么：按 Spike E 的结论，让更新代理使用稳定的 CLI 载体，不再依赖 `process.argv`。
  - 做完你能看到什么：桌面端自更新后，更新代理的启动命令仍指向存在的可执行文件；Windows 上代理不占用桌面端自己的 exe。
  - 先依赖什么：1.7、2.2
  - 开始前先看：
    - `requirements.md` 需求 8
    - `design.md` §2.3.4、§3.3.5、§6.7
    - `apps/cli/src/update-agent.ts:142-215`、`apps/cli/src/update-agent-service.ts`
  - 技术规划：
    1. 按 Spike E 结论（默认方案 (b)）改 `update-agent.ts` 的 `updateAgentCommand`：可执行文件取自稳定位置的 CLI 载体（macOS `~/.local/bin/outcomego`，Windows `%LOCALAPPDATA%\OutcomeGo\bin\outcomego.exe`），不再用 `process.argv[0]`、`process.argv[1]`。
    2. 保持 `updateWorkerArguments` 与 `cli-update.ts` 的 `readCliPromotion` 兼容；`update-agent-service.ts` 的 launchd plist 与 systemd 单元使用同一载体。
    3. 桌面端期望的 CLI 版本与载体版本不一致时返回 `CLI_VERSION_MISMATCH`，由桌面端按校验后的版本替换载体。
    4. 保留 `DOCKER_*` 环境透传（`external` 引擎需要）。
  - 主要改哪里：
    - `apps/cli/src/update-agent.ts`、`apps/cli/src/update-agent-service.ts`
    - `apps/cli/src/cli-update.ts`
    - `apps/cli/test/update-agent.test.ts`、`apps/cli/test/update-agent-service.test.ts`
  - 这一步先不做什么：不改桌面端界面；不统一 Tailscale 管理使用的内置 CLI。
  - 怎么算完成：
    1. 代理命令不含带版本号的 `app.asar.unpacked` 路径。
    2. 现有 `update-agent` 相关测试全部通过，并新增覆盖稳定载体的用例。
    3. `DOCKER_*` 环境透传保留，供 `external` 引擎使用。
  - 指标：
    - `updateAgentCommand` 的返回值不含 `app.asar.unpacked`（单元断言）。
    - `apps/cli` 下 `bun test test/update-agent.test.ts test/update-agent-service.test.ts` 通过，并新增“载体路径稳定”“版本不一致返回 `CLI_VERSION_MISMATCH`”两个用例。
    - 在 Windows 上启动代理后替换桌面端文件不被占用（按 Spike E 步骤复测 1 次）。
    - 本地模式下 `outcomego update --version <x>` 在夹具上完成（需求 8.3；3.8 的端到端清单再验证一次）。
  - 怎么验证：
    - 单元测试；按 Spike E 的步骤在 Windows 与 macOS 上手工验证。
  - 对应需求：`requirements.md` 需求 8 / 验收 8.1–8.3、8.5
  - 对应设计：`design.md` §2.3.4、§3.3.5、§6.7

### 阶段检查

- [ ] 2.7 阶段检查：CLI 回归与契约冻结
  - 状态：IN_REVIEW（回归与契约通过，仍有上游真机验证）
  - 契约：[CLI 契约 v1](docs/cli-contract.md)。
  - 实际输出：CLI 全量 830 pass / 0 fail，类型检查退出 0；doctor 225 pass / 0 fail，install 65 pass / 0 fail。引擎目录外直接调用 0 处，设计/契约/实现对照为 `23 codes; 0 differences`，架构检查通过。
  - 这一步到底做什么：确认 CLI 侧能力齐备且没有回归，冻结引擎提供者接口与事件契约，供桌面端和托管引擎使用。
  - 做完你能看到什么：桌面端可以只依赖 CLI 的 `bootstrap`、`status --json`、`engine`、`resources` 契约开发。
  - 先依赖什么：2.1、2.2、2.3、2.4、2.5、2.6
  - 开始前先看：
    - `requirements.md` 需求 3、4、8、9
    - `design.md` §3
    - `tasks.md`
  - 技术规划：
    1. 在 `apps/cli` 运行完整测试与类型检查，用 grep 核对直接 docker 调用清零。
    2. 把事件契约（`schemaVersion` 1、事件类型、错误码表）和提供者接口签名冻结，写入 `docs/cli-contract.md`。
    3. 运行 `docs/check_spec.py`，确认契约文档与设计一致。
    4. 冻结范围：事件契约与 `external` 相关成员冻结。`EngineProvider` 中仅供托管引擎使用的成员（`stop`、`remove`、`memoryBytes`，以及 `composeInvocation` 的托管分支）允许在 4.2、5.2 按 Spike 结论增补，增补不得改变 M1 已验证的行为，并同步更新 `docs/cli-contract.md`。
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. `bun test` 在 `apps/cli` 下全部通过。
    2. 直接 docker 调用清零。
    3. 事件 `schemaVersion` 与接口签名已冻结并记录。
  - 指标：
    - `apps/cli` 下 `bun test` 与 `bun run typecheck` 退出码 0。
    - `grep -rnE 'run\("docker"|"docker-compose"' apps/cli/src` 在 `engine/` 之外 0 处。
    - `docs/cli-contract.md` 列出的错误码集合与 `design.md` §5.1 的差异为 0（脚本比对）。
    - 仓库根目录 `bun run check:architecture` 通过。
  - 怎么验证：
    - 在 `apps/cli` 下运行 `bun test`、`bun run typecheck`；人工走查。
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 8、需求 9
  - 对应设计：`design.md` §3.2、§3.3

---

## 阶段 3：桌面端向导与设置

- [ ] 3.1 LocalDeployManager
  - 状态：IN_REVIEW（管理器测试通过，待真机取消验证）
  - 实际输出：`local-deploy.test.ts` 22 pass / 0 fail。覆盖忙锁、半行、未知版本、只写一次 stdin、哨兵 0 命中、非回环及错端口拒绝，Windows 协作取消标记在退出后清理。构建 `main.js` 167,974 B ≤ 175,000 B。
  - 待验证：用户在 Windows x64 与 macOS 隔离机执行 M1-10、M1-11，取消拉取和首次启动后核对无孤儿进程、配置可安全重试，回传进程与退出日志。
  - 变更记录：2026-11-24，为遵守仓库禁止跨应用导入的边界，用随包 CLI 的一次性准备入口复用签名下载与替换逻辑；`bootstrap` 和更新代理只执行独立载体。
  - 变更记录：2026-11-24，Windows 不能用 POSIX 信号请求正常退出；先用私有临时取消文件通知 CLI 回滚，再用 `taskkill /T /F` 兜底。
  - 这一步到底做什么：在主进程新增 `LocalDeployManager`，负责运行 `bootstrap`、解析事件、取消和互斥。
  - 做完你能看到什么：主进程可以启动一次部署并拿到逐条事件；取消能终止整个子进程树；同一时刻只有一个变更类操作；所有文本已脱敏。
  - 先依赖什么：2.7
  - 开始前先看：
    - `requirements.md` 需求 2、需求 10
    - `design.md` §2.3.1、§3.3.3、§6.1、§6.4、§6.5、§6.8
    - `apps/desktop/src/main/tailscale-manager.ts`
  - 技术规划：
    1. 新增 `apps/desktop/src/main/local-deploy.ts`，结构仿 `tailscale-manager.ts`：`request()` 校验、忙锁；执行改用 `spawn`（需要流式事件与 stdin）。
    2. 启动命令：`<CLI 载体> bootstrap --json-progress --dir <安装目录> …`；owner JSON 写入 stdin 后立即 `end()` 并清除本地引用。
    3. 逐行解析 stdout 为 `DeployProgressEvent`；`schemaVersion` 不是 1 时终止并报告 `CLI_VERSION_MISMATCH`。
    4. 取消：Windows 用私有临时目录内的空文件通知 CLI，60 秒（初值）未退出才用 `taskkill /T /F`；macOS 向进程组发 `SIGTERM`，超时再 `SIGKILL`。
    5. 所有出站文本经 `safeErrorMessage` 脱敏；仅在 `canManageLocalInstallation` 命中时执行写操作。
    6. 模块用动态 `import()` 懒加载，避免超出 `main.js` 的体积预算。
  - 主要改哪里：
    - `apps/desktop/src/main/local-deploy.ts`（新增）
    - `apps/desktop/test/local-deploy.test.ts`（新增）
  - 这一步先不做什么：不做界面；不做 IPC 注册。
  - 怎么算完成：
    1. 凭据只经 stdin 写入后立即丢弃，不进入日志与事件。
    2. 取消后没有孤儿进程（Windows 与 macOS 各自的终止方式）。
    3. 事件 `schemaVersion` 未知时给出“请更新应用”。
    4. 只对 `canManageLocalInstallation` 命中的本机安装执行写操作。
  - 指标：
    - 单元测试至少 6 个用例：忙锁（并发第二次返回 `BUSY`）、取消（进程树无残留）、半行事件解析、`schemaVersion` 不兼容、脱敏（输出中搜不到测试密码）、非回环地址拒绝。
    - mock 断言密码只出现在 `stdin.write` 的那一次调用里。
    - `bun scripts/performance/check-desktop-budgets.ts` 中 `main.js` ≤ 175,000 字节；超出则拆块或上调预算并写明增量与原因。
  - 怎么验证：
    - 单元测试：忙锁、取消、事件解析、脱敏、版本不兼容。
  - 对应需求：`requirements.md` 需求 2 / 验收 2.2–2.4、需求 8 / 验收 8.5、需求 10 / 验收 10.1–10.3、非功能需求 2 / 验收 2.2
  - 对应设计：`design.md` §2.3.1、§3.3.3、§6.1、§6.4、§6.5、§6.8

- [x] 3.2 IPC、preload 与类型
  - 状态：DONE（经 IN_PROGRESS、IN_REVIEW 验证）
  - 实际输出：`local-deploy-ipc.test.ts` 与 `local-deploy-preload.test.ts` 合计 11 pass / 0 fail。八个调用通道均拒绝非法参数，非主窗口在加载模块前被拒绝；保留 `detect`，订阅仅交付事件且可取消。桌面类型检查退出 0；`preload.cjs` 10,800 B ≤ 10,900 B，预算脚本注明增加 395 B。
  - 变更记录：2026-11-24，将 3.5 已要求的内存调整通道补入 `design.md` §3.3.3，与生命周期通道共用授权和忙锁。
  - 这一步到底做什么：注册 §3.3.3 的 IPC 通道，并在 preload 与类型声明中暴露。
  - 做完你能看到什么：渲染进程可以调用 `localDeploy.start/cancel/onProgress` 和 `localServer.status/start/stop/remove/diagnostics`。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 10 / 验收 10.2
    - `design.md` §3.3.3
    - `apps/desktop/src/main/index.ts` 的 `requireAuthSender` 与 `outcomego:local-server:detect` 处理、`apps/desktop/src/preload/index.ts` 的 `localServer`
  - 技术规划：
    1. 在 `index.ts` 注册 `design.md` §3.3.3 的 7 个通道（`local-deploy:start`、`cancel`、`progress`，`local-server:status`、`start`、`stop`、`remove`、`diagnostics`），每个处理函数首行调用 `requireAuthSender`。
    2. 参数校验：字符串长度上限、`purgeData` 必须是布尔、`apiPort` 为 1–65535 的整数，沿用 `tailscaleRequest` 的校验风格。
    3. `preload/index.ts` 的 `localServer` 增加 `status`、`start`、`stop`、`remove`、`diagnostics`，新增 `localDeploy: { start, cancel, onProgress }`；`renderer/env.d.ts` 同步类型；`local-server:detect` 保持兼容。
    4. 预加载体积：`preload.cjs` 预算只有 10,500 字节且本地余量不足 100 字节，按实测上调预算并写明增量。
  - 主要改哪里：
    - `apps/desktop/src/main/index.ts`
    - `apps/desktop/src/preload/index.ts`
    - `apps/desktop/src/renderer/env.d.ts`
    - `apps/desktop/test/`（preload 与 IPC 校验测试）
  - 这一步先不做什么：不做界面；现有 `local-server:detect` 保持兼容。
  - 怎么算完成：
    1. 每个通道都调用 `requireAuthSender`，并校验参数类型与长度。
    2. 忙时返回 `BUSY`。
    3. 现有 `localServer.detect` 行为不变。
  - 指标：
    - 每个通道的非法参数（类型错、超长、越界）至少各 1 个拒绝用例。
    - 来自非主窗口的调用被拒绝（用例）。
    - 现有 preload 暴露面相关测试全部通过；`apps/desktop` 下 `bun run typecheck` 通过。
    - `check-desktop-budgets.ts` 的 `preload.cjs` 检查通过；若上调预算，注释中写明实测增量字节数。
  - 怎么验证：
    - IPC 参数与发送方校验的单元测试；preload 暴露面测试。
  - 对应需求：`requirements.md` 需求 10 / 验收 10.2、需求 1 / 验收 1.2
  - 对应设计：`design.md` §3.3.3

- [ ] 3.3 本地服务状态与生命周期 IPC
  - 状态：IN_REVIEW（状态、诊断与移除夹具通过）
  - 实际输出：状态夹具覆盖 7 种状态，均只调用 `status --json`；失败返回 `unhealthy` 与 `ENGINE_UNAVAILABLE`。诊断的密码、控制令牌、认证密钥三个哨兵 0 命中；非法 `purgeData` 拒绝。CLI 两个 Windows 移除夹具均保留载体；只在彻底移除时删除卷与配置。
  - 待验证：用户在隔离机执行 M1-12、M1-14、M1-16、M1-17，回传启停健康、脱敏扫描和两种移除结果。
  - 变更记录：2026-11-24，桌面卸载不能删除 Windows 安装目录 `bin` 下正在运行的独立载体；只清理服务及其数据，终端行为不变。见 `design.md` §2.3.5。
  - 这一步到底做什么：扩展对本机安装的读取，使其带上引擎与栈状态，并实现启动、停止、移除和诊断。
  - 做完你能看到什么：渲染进程能拿到 `not-installed`、`stopped`、`starting`、`running`、`unhealthy` 等状态，并执行启动、停止、移除；诊断文本已脱敏。
  - 先依赖什么：3.2、2.4
  - 开始前先看：
    - `requirements.md` 需求 7、需求 11 / 验收 11.2
    - `design.md` §2.3.3、§2.3.5、§3.3.3、§4.2
    - `apps/desktop/src/main/local-installation.ts`
  - 技术规划：
    1. 扩展 `local-installation.ts` 的 `readManagedInstallation`，返回 `engine` 与 `awaiting`（来自 `deploy-state.json`）。
    2. `local-server:status` 调用 `outcomego status --json`，映射为 `not-installed`、`stopped`、`starting`、`running`、`unhealthy`、`updating`、`removing`（`design.md` §4.2）。
    3. `start`、`stop` 调用 `outcomego start`、`stop`；`remove` 调用 `uninstall --yes`，`purgeData` 为真时加 `--purge`，托管引擎再调用 `engine remove --purge-data`。
    4. `diagnostics` 拼接系统信息、引擎信息、失败阶段、最近 200 行日志（初值）和 `doctor` 结果，脱敏后返回。
    5. 所有变更操作共用 3.1 的忙锁。
  - 主要改哪里：
    - `apps/desktop/src/main/local-installation.ts`
    - `apps/desktop/src/main/local-deploy.ts`
    - `apps/desktop/src/main/index.ts`
  - 这一步先不做什么：不做界面；不做开机自启。
  - 怎么算完成：
    1. 状态读取只调用 CLI 的 `status --json`，不自行解析容器。
    2. 移除区分“保留数据”和“含数据卷”，后者需要调用方传入已确认标志。
    3. 诊断文本含系统与引擎信息、失败阶段、最近日志与 `doctor` 结果，且无敏感信息。
  - 指标：
    - 状态映射：夹具覆盖 7 个状态，每个至少 1 个用例。
    - `purgeData` 缺省或不是布尔时拒绝（不会误删数据）。
    - 诊断文本中搜不到测试密码、`OUTCOMEGO_CONTROL_TOKEN` 与 `OUTCOMEGO_AUTH_SECRET` 的值（断言）。
    - `status --json` 失败时返回 `unhealthy` 与原因，不抛出未处理异常（用例）。
  - 怎么验证：
    - 主进程单元测试；用 FakeRunner 模拟各状态。
  - 对应需求：`requirements.md` 需求 1 / 验收 1.4，需求 7 / 验收 7.1、7.2、7.5、7.6，需求 11 / 验收 11.2，非功能需求 3 / 验收 3.3
  - 对应设计：`design.md` §2.3.3、§2.3.5、§3.3.3、§4.2

- [ ] 3.4 欢迎页双入口与部署向导
  - 状态：IN_REVIEW（渲染夹具通过，待端到端）
  - 实际输出：向导逻辑及 DOM 夹具共 12 pass / 0 fail。覆盖 23 个错误码、字段定位、进度、取消、低内存确认、续跑、登录清空两处密码；夹具断言首个进度在 2 秒内可见。桌面全量与文案检查通过。
  - 待验证：用户在含新 CLI 的签名桌面包执行 M1-01 至 M1-11，回传两平台首进度、自动登录耗时和首次机器人结果。
  - 这一步到底做什么：把欢迎页的终端命令提示改成两个入口，并实现部署向导界面。
  - 做完你能看到什么：用户可以选“连接已有服务器”或“在这台电脑部署”；部署时看到阶段、进度、已用时间，可取消、重试、复制诊断信息；部署成功后自动登录并进入现有的“选择 AI”流程。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 11
    - `design.md` §2.3.1、§2.3.2 步骤 4、§3.3.3、§5
    - `apps/desktop/src/renderer/components/outcomego/sign-in-flow.tsx:36,118-125,203-288`
  - 技术规划：
    1. `sign-in-flow.tsx` 欢迎页：把 `INSTALL_COMMAND` 提示替换为两个入口；“连接已有服务器”沿用现有 `endpoint` 阶段，“在这台电脑部署”进入新增的 `local-deploy-flow.tsx`。
    2. 向导步骤：账号设置（用户名、密码、确认密码；只做非空与两次一致的前置检查，其余规则以 CLI 的 `INVALID_INPUT` 为准）→ 部署进度（订阅 `localDeploy.onProgress`）→ 完成后调用现有 `connectTo(localServer.url, username)` 并登录，随后清除密码状态。
    3. 错误展示：按 `design.md` §5.1 映射文案与动作；`INVALID_INPUT` 的 `field` 定位到对应输入框；`confirm-low-memory` 弹确认。
    4. 支持取消、重试和“复制诊断信息”（调用 `localServer.diagnostics`）；续跑场景读取 `localServer.status().awaiting`，预填用户名并要求重新输入密码。
    5. 新文案接入 `i18n-catalog.ts`。
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/sign-in-flow.tsx`
    - `apps/desktop/src/renderer/components/outcomego/local-deploy-flow.tsx`（新增）
    - `apps/desktop/test/`（渲染进程测试）
  - 这一步先不做什么：不做 Windows 与 macOS 的引擎专属步骤（见 4.4、5.3）；不做设置页。
  - 怎么算完成：
    1. 远程连接流程行为不变；检测到本机服务时保持现有提示。
    2. 每个错误码都有对应的文案和建议动作；低内存时要求确认。
    3. 密码只在内存中，登录成功后立即清除。
    4. 续跑场景下提示重新输入密码，用户名预填。
  - 指标：
    - 渲染测试至少 8 个用例：阶段推进、失败（每类错误码都能映射到文案）、取消、重试、低内存确认、续跑、`INVALID_INPUT` 字段定位。
    - 点击“部署”到第一个进度可见 ≤ 2 秒（夹具中从事件到达到 DOM 更新计，非功能需求 1.1）。
    - 登录成功后组件状态中不再保存密码（断言）。
    - 远程连接流程的现有测试全部通过；`bun scripts/check/i18n-catalog.ts` 通过。
  - 怎么验证：
    - 渲染进程测试：各阶段、失败、取消、重试、低内存确认。
    - M1 手工清单（任务 3.8）。
  - 对应需求：`requirements.md` 需求 1 / 验收 1.1–1.3、需求 2 / 验收 2.1–2.6、需求 11 / 验收 11.1、11.2、11.4
  - 对应设计：`design.md` §2.3.1、§2.3.2、§3.3.3、§5

- [ ] 3.5 设置“服务器位置”与生命周期操作
  - 状态：IN_REVIEW（设置逻辑测试通过，待手工确认）
  - 实际输出：`server-location.test.ts` 5 pass / 0 fail，覆盖七种状态、删除确认、回环匹配、1 GiB 最低值和 75% 上限；文案目录检查通过。移除后复用已有清凭据并回欢迎页流程。
  - 待验证：用户执行 M1-12、M1-13、M1-15 至 M1-17，回传两次确认、变更后服务健康、来源切换与数据保留结果；未在隔离真机执行删除。
  - 变更记录：2026-11-24，桌面提示超过客户机内存 75% 时实际按上限提交；不改变终端参数规则，见 `design.md` §3.3.6。
  - 这一步到底做什么：在“设置 → 服务器”里显示服务器位置和本地服务状态，并提供启动、停止、移除、切换来源和内存调整。
  - 做完你能看到什么：用户能在设置里看到“本地”或“远程”，对本地服务启动、停止、移除（二次确认），并能调整内存；切换到远程不会删除本地数据。
  - 先依赖什么：3.3、2.5
  - 开始前先看：
    - `requirements.md` 需求 1 / 验收 1.4、1.5，需求 7，需求 9 / 验收 9.4
    - `design.md` §2.3.5、§3.3.2、§3.3.3
    - `apps/desktop/src/renderer/components/outcomego/settings/server.tsx`
  - 技术规划：
    1. `settings/server.tsx` 新增“服务器位置”区块：本地或远程、本地服务状态、启动、停止、移除、内存调整。
    2. 内存调整经 IPC 调用 `outcomego resources set`，提示“会中断进行中的任务”并二次确认。
    3. 移除分两档：保留数据；彻底删除（需勾选确认并输入固定词，如“删除”）。
    4. 切换来源沿用现有 `CONFIGURED_API_BASE_KEY` 机制，不删除本地安装。
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/settings/server.tsx`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
    - `apps/desktop/test/`
  - 这一步先不做什么：不做本地与远程之间的数据迁移；不改现有的 Tailscale 与局域网设置。
  - 怎么算完成：
    1. 彻底删除需要二次确认，并说明不可恢复。
    2. 调整内存时提示“会中断进行中的任务”，确认后才执行。
    3. 切换来源后，本地安装与数据保留。
  - 指标：
    - 渲染测试至少 5 个用例：7 种状态的展示、彻底删除未确认时按钮不可点、内存调整需二次确认、切换到远程后 `readManagedInstallation` 仍返回本地安装、非法内存输入被拒绝。
    - 内存输入小于 1 GiB 被拒绝；大于引擎客户机内存 75% 时提示会被限制。
    - 文案目录检查通过。
  - 怎么验证：
    - 渲染进程测试；手工验证移除与切换。
  - 对应需求：`requirements.md` 需求 1 / 验收 1.4、1.5，需求 7 / 验收 7.2、7.5、7.6，需求 9 / 验收 9.4
  - 对应设计：`design.md` §2.3.5、§3.3.2、§3.3.3

- [ ] 3.6 托盘图标与关窗常驻
  - 状态：IN_REVIEW（自动测试通过，真机与整体预算未过门）
  - 实际输出：托盘与退出偏好 15 pass / 0 fail，含 6 种关窗组合、5 种状态的本地/远程菜单、两平台左右键。构建 `main.js` 167,974 B ≤ 175,000 B；整体预算仍有六项超限，`--release` 另缺可验证的匹配签名包，详见 [验收结果](docs/acceptance-result.md)。
  - 待验证：用户在 Windows x64 和 macOS 各执行 M1-19 至 M1-24，回传托盘、注销、关机、应用退出和更新结果。
  - 变更记录：2026-11-24，按本任务验收统一左右键行为，macOS 左键唤回窗口、右键打开菜单；不改 Dock，见 `design.md` §3.3.7。
  - 这一步到底做什么：给 Windows 与 macOS 桌面端加上托盘图标和菜单，把“关闭窗口只隐藏”从 macOS 扩展到 Windows，并处理关机、注销和自更新时的退出。
  - 做完你能看到什么：关闭窗口后应用仍在菜单栏或通知区域，点图标能唤回；菜单里能看到本地服务状态并启动、停止；关机和桌面端自更新不被阻止。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 13、需求 7 / 验收 7.3、需求 12 / 验收 12.3
    - `design.md` §2.3.6、§3.3.7、§6.9
    - `apps/desktop/src/main/index.ts` 中的符号：`mainWindow.on("close", …)`、`focusMainWindow`、`app.on("second-instance", …)`、`app.on("before-quit", …)`、`app.on("window-all-closed", …)`，以及自更新处理里 `quitAndInstall` 之前的 `isQuitting = true`
  - 技术规划：
    1. 新增 `tray.ts`：`createTray({ platform, getStatus, actions })`；菜单构造为纯函数 `buildTrayMenu(state)` 便于单测。macOS 用模板图（`outcomegoTemplate.png` 与 `@2x`，16×16 和 32×32），Windows 用多尺寸 `.ico`。
    2. `index.ts`：`mainWindow.on("close")` 的条件改为 `(darwin || win32) && !isQuitting`；`window-all-closed` 只在 Linux 退出；Windows 增加 `mainWindow.on("session-end")` 置 `isQuitting = true`。
    3. 托盘菜单状态取自 3.3 的 `local-server:status`；变更操作走忙锁。
    4. 首次关窗提示：用现有桌面通知机制显示一次，标记存入新增的本机偏好文件 `background-preferences.json`（`userData` 下，读写方式沿用 `keyboard-shortcuts.json`）。`computer-settings.ts` 的字段是服务端侧设置，不适合存放本机偏好。
    5. 图标资产以 `packages/design-tokens/assets/` 为源。`apps/desktop/package.json` 的 `build.files` 目前只列了应用目录内的路径（`dist/**`、`dist-electron/**`），需要先确认它能否引用目录之外的文件；不能则把图标复制进 `apps/desktop/build/`，或用 `extraResources`。`tray.ts` 用动态 `import()` 懒加载。
  - 主要改哪里：
    - `apps/desktop/src/main/tray.ts`（新增）
    - `apps/desktop/src/main/index.ts`（`close`、`window-all-closed`、`session-end`）
    - `apps/desktop/src/main/background-preferences.ts`（新增，本机偏好文件 `background-preferences.json` 的读写，保存“已提示过关窗”标记）
    - `packages/design-tokens/assets/`（新增托盘图标：macOS 模板图、Windows `.ico`）
    - `apps/desktop/package.json`（把托盘图标打进应用）
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
    - `apps/desktop/test/`
  - 这一步先不做什么：不做 Linux 托盘；不做“登录时自动启动”（见 Q14）；不改 Dock 图标行为；不新增“关闭窗口时退出”的设置项。
  - 怎么算完成：
    1. Windows 与 macOS 上关闭窗口都只隐藏窗口，托盘图标保持。
    2. 点击托盘、菜单“打开”、再次启动应用都能唤回窗口。
    3. 菜单在本地与远程模式下的项目符合 §3.3.7，退出文案随设置变化。
    4. 首次关窗只提示一次。
    5. `session-end`、托盘退出、应用菜单退出和 `quitAndInstall` 路径都不会被关窗逻辑拦住。
    6. macOS 现有的关窗与 Dock 行为不变，Linux 行为不变。
  - 指标：
    - 单元测试：`close` 判断覆盖 `darwin`、`win32`、`linux` × `isQuitting` 真假共 6 种组合；菜单构造覆盖“本地、远程”× 5 种状态。
    - 手工清单（Windows 与 macOS 各一遍）共 8 项：关窗后图标仍在、点击唤回、再次启动唤回、首次提示只出现 1 次、托盘退出后进程消失、系统关机不被阻止、注销不被阻止、桌面自更新成功。全部通过。
    - `check-desktop-budgets.ts` 通过：`main.js` ≤ 175,000 字节；`--release` 下 nsis ≤ 160 MiB、dmg ≤ 135 MiB。
  - 怎么验证：
    - 单元测试：菜单构造、各平台取值下的 `close` 判断、`isQuitting` 置位。
    - 手工：Windows 与 macOS 各走一遍 `design.md` §7.3 的托盘清单，含真实关机和桌面端自更新。
  - 对应需求：`requirements.md` 需求 13 / 验收 13.1–13.9，需求 7 / 验收 7.3，需求 12 / 验收 12.3
  - 对应设计：`design.md` §2.3.6、§3.3.7、§6.9

- [ ] 3.7 启动恢复与退出策略
  - 状态：IN_REVIEW（调度及恢复夹具通过，待 Electron 真机计时）
  - 实际输出：后台恢复 5 个夹具，仅已安装且停止的本机栈调用 `start` 1 次；已移除、等待用户动作、切换到远程、正退出均调用 0 次。偏好默认 `false`；续跑预填用户名，密码输入为空。主进程创建窗口后异步调用恢复，不等待服务检测。
  - 待验证：用户执行 M1-18、M1-21、M1-22，并验证窗口 `ready-to-show` 不受人为 5 秒状态延迟影响；预期重启后 60 秒内健康、明确退出按设置停服务一次、系统会话结束停服务零次。
  - 变更记录：2026-11-24，补充仅用于读取和修改本机退出偏好的 IPC，沿用主窗口授权，见 `design.md` §3.3.3。
  - 变更记录：2026-11-24，只有应用菜单和托盘发起的明确退出才按偏好停服务，系统发起的退出不等待。
  - 变更记录：2026-11-24，续跑状态可记录非秘密的 `ownerUsername` 以便预填；仍不保存密码。见 `design.md` §3.2.4。
  - 变更记录：2026-11-24，保留数据移除后的 `uninstalledAt` 安装不自动重建；见 `design.md` §2.3.3。
  - 这一步到底做什么：桌面端启动时在后台检测并拉起本地服务，恢复未完成的部署，并实现“退出时是否停止服务”的开关。
  - 做完你能看到什么：重启电脑后打开桌面端，本地服务自动恢复；首屏不被检测阻塞；默认情况下退出应用时本地服务继续运行。
  - 先依赖什么：3.3、3.6
  - 开始前先看：
    - `requirements.md` 需求 7 / 验收 7.1、7.3、7.4，非功能需求 1 / 验收 1.2
    - `design.md` §2.3.3、§2.3.6、§8.2 Q9、Q14
  - 技术规划：
    1. `index.ts` 在 `app.whenReady` 之后异步调用 `LocalDeployManager.status()`，不 `await`，首屏不阻塞。
    2. 栈已停止则调用 `start`；存在 `deploy-state.json` 且 `awaiting` 非空时，向渲染进程推送“恢复部署”事件。
    3. 在 `background-preferences.json`（3.6 新增）中加入 `stopServiceOnQuit`，默认 `false`。
    4. `before-quit` 在 `stopServiceOnQuit` 为真时先异步 `stop` 再退出，超时 30 秒（初值）强制退出；`session-end` 路径不停服务。
    5. 托盘“退出”文案随该设置变化（需求 13.5）。
  - 主要改哪里：
    - `apps/desktop/src/main/index.ts`
    - `apps/desktop/src/main/local-deploy.ts`
    - `apps/desktop/src/main/background-preferences.ts`（新增，读写 3.6 创建的 `background-preferences.json`）
  - 这一步先不做什么：不依赖更新代理系统服务；“登录系统时自动启动桌面端”是否做见 Q14，决定之前不实现。
  - 怎么算完成：
    1. 启动检测是异步的，首屏不受影响。
    2. 未完成的部署状态能恢复向导。
    3. “退出应用时停止服务”默认关闭，可在设置中修改；关机与注销不触发它。
  - 指标：
    - 启动检测不阻塞首屏：测试里让 `status()` 延迟 5 秒，窗口的 `ready-to-show` 不被延后（断言）。
    - `stopServiceOnQuit` 默认 `false`；为真时退出路径调用 `stop` 1 次，`session-end` 路径调用 0 次。
    - 未完成的 `deploy-state.json` 能触发恢复向导（用例）。
    - 手工：重启宿主机后打开应用，60 秒内（初值）本地服务恢复。
  - 怎么验证：
    - 主进程单元测试；手工：重启宿主机后打开应用。
  - 对应需求：`requirements.md` 需求 7 / 验收 7.1、7.3、7.4，需求 13 / 验收 13.5，非功能需求 1 / 验收 1.2
  - 对应设计：`design.md` §2.3.3、§2.3.6、§8.2

### 阶段检查

- [ ] 3.8 M1 阶段检查：已装 Docker 的 Windows 与 macOS 端到端
  - 状态：IN_REVIEW（验收清单和自动测试已记录，未通过真机和发布门）
  - 实际输出：[手工清单](docs/acceptance-checklist.md) 26 项；[验收结果](docs/acceptance-result.md) 记录基线、实际测试、预算失败和回传方法。CLI 830 pass / 0 fail；桌面 1104 pass / 2 skip / 0 fail，均不少于基线。两平台全新部署耗时未测，真机清单均未执行，不计为通过。
  - 待验证：用户确认暂缓真机验收。恢复时提供匹配的受信签名 CLI、服务器发布描述及两平台桌面包，在隔离机逐项执行并回传版本、耗时、结果和脱敏日志。M2、M3 保持未启动。
  - 这一步到底做什么：写出 M1 手工验收清单，并在已装 Docker 兼容引擎的 Windows 与 macOS 上完整走一遍。
  - 做完你能看到什么：从欢迎页点一次按钮到登录并创建第一个机器人，全程不打开终端；结果记录在补充文档里。
  - 先依赖什么：3.4、3.5、3.6、3.7、2.7
  - 开始前先看：
    - `requirements.md` 需求 1、2、7、13，非功能需求 1
    - `design.md` §7.3
    - `tasks.md`
  - 技术规划：
    1. 写出 `docs/acceptance-checklist.md` 的 M1 部分，每项含前置条件、步骤、期望、结果栏。
    2. 在已装 Docker 的 Windows x64 与 macOS 13.5 以上各执行：全新部署、失败重试（断网、占用 8787）、取消、重启后恢复、移除（保留、删除）、切换远程再切回、关窗常驻、桌面自更新、服务端更新。
    3. 在终端安装用户、Linux、远程服务器三种既有路径各跑一次回归。
    4. 结果写入 `docs/acceptance-result.md`。
  - 主要改哪里：`docs/acceptance-checklist.md`、`docs/acceptance-result.md`
  - 这一步先不做什么：不验收托管引擎。
  - 怎么算完成：
    1. 两个平台各一次完整通过，含失败与重试路径，以及关窗常驻、托盘、关机与桌面端自更新（需求 13）。
    2. 终端安装、Linux、远程服务器的既有测试无回归。
    3. 已知缺口与风险已记录。
  - 指标：
    - 清单 ≥ 20 项（初值），逐项有通过或失败结果。
    - 两个平台各完成 1 次从点击到登录成功的全新部署，全程无需终端，并记录耗时。
    - `apps/cli` 与 `apps/desktop` 下 `bun test` 全部通过，用例数不少于改动前。
    - 失败项为 0，或逐项有对应的修复任务编号。
  - 怎么验证：
    - 按清单逐项执行；对照 `design.md` §7.4 的验证映射。
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 7、需求 13，需求 12 / 验收 12.4，非功能需求 1
  - 对应设计：`design.md` §7.3、§7.4

---

## 阶段 4：Windows 托管引擎

- [ ] 4.1 Windows 引擎资产构建与发布
  - 状态：IN_REVIEW（真实候选双构建通过，待发布门与 Windows 验收）
  - 变更记录：2026-11-24，使用固定 Debian amd64 OCI 摘要和 Debian 签名快照在 CI 重建 rootfs，消除预先托管整包的依赖；见 `design.md` §3.3.4 和需求 14。
  - 变更记录：2026-11-24，Win11 实测当前版本的引擎归档及 Sigstore 签名均返回 HTTP 404；接入默认关闭的 Windows 引擎资产构建与现有签名作业，开启后缺件阻止发布，并让 CLI 区分缺件和临时网络错误；见 `design.md` §3.3.4。
  - 实际输出：两次独立构建各产出 146,715,149 B，`sha256sum -c` 均为 `OK`，SHA-256 同为 `f3d244d97df9d4639b5339e794002fdea07769a751f5c5a2d0a1e06ba114a378`。100 个 Debian 软件包与公告一致，归档内均有许可声明。`engine-assets-build.test.ts` 3 pass / 0 fail，Sigstore 既有夹具接受原字节、拒绝一字节篡改。
  - 发布流程复查：汇总夹具覆盖开关关闭、开启但缺件以及齐全纳入 `SHA256SUMS`。现有版本 Windows bootstrap 对缺失签名返回 `ASSET_VERIFICATION_FAILED`、`retryable=false`，退出 1。候选在 Linux amd64 容器中识别 Compose `2.26.1-4`，`dockerd --validate` 返回 `configuration OK`。
  - 待验收：法务核对对应源码保留、Go 链接依赖声明和上游 NOTICE 原文。发布负责人完成 1.10 Go、恢复 GitHub 认证后验证 tag CI 组包、正式 Sigstore 签名及一字节篡改、NSIS 体积门。Windows 验收人员用匹配版本执行 bootstrap 并回传 WSL 导入、`docker info`、Compose 启动和回环监听结果。
  - 这一步到底做什么：在 CI 中构建固定版本的最小 rootfs（含 dockerd 与 Compose），生成摘要并签名，发布为 Release 资产。
  - 做完你能看到什么：每个版本的 Release 带有引擎资产、SHA-256 清单和签名；CLI 能按固定摘要校验。
  - 先依赖什么：1.9、1.10（Spike A、B 为 Go）
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.5、需求 10 / 验收 10.5
    - `design.md` §3.3.4、§8.2 Q11
    - `apps/cli/src/release.ts`、`apps/cli/scripts/sign-release.ts`、`.github/workflows/release.yml`
  - 技术规划：
    1. 新增 CI 工作流（候选 `.github/workflows/engine-assets.yml`，或并入 `release.yml`）：构建最小 rootfs，固定基础发行版与 dockerd、Compose 版本并写入清单文件。
    2. 产物：`outcomego-engine-windows-x64.tar.gz`、`SHA256SUMS` 与 sigstore 签名，复用 `apps/cli/scripts/sign-release.ts` 和 `apps/cli/src/release.ts` 的 `verifyArtifactSignature`。
    3. 生成组件清单并与 `THIRD-PARTY-NOTICES` 比对（在 `scripts/check/release-workflows.ts` 增加检查）；自托管资产旁写明源码获取方式。
    4. 确认组成中不含 Docker Desktop 等专有软件（需求 14.3）。
  - 主要改哪里：
    - `.github/workflows/`（新增或修改发布工作流）
    - `apps/cli/scripts/`（新增资产构建脚本）
    - `docs/`（组件版本与许可记录）
  - 这一步先不做什么：不实现 `managed-wsl` 提供者。
  - 怎么算完成：
    1. 组件版本固定，构建可复现。
    2. 摘要与签名可被 CLI 的现有校验逻辑验证。
    3. 组件已登记到 `THIRD-PARTY-NOTICES`；自托管的资产旁写明源码获取方式；法务已确认（Q11），未确认前不公开发布。
  - 指标：
    - 同一输入构建两次，产物 SHA-256 相同，或差异已解释（可复现）。
    - `verifyArtifactSignature` 对产物成功，篡改 1 字节后失败（2 个用例）。
    - 组件清单与 `THIRD-PARTY-NOTICES` 比对差异为 0，否则发布失败（用例）。
    - 引擎资产体积记录在案，且不计入桌面端安装包：`bun scripts/performance/check-desktop-budgets.ts --release` 中 nsis ≤ 160 MiB 仍通过。
  - 怎么验证：
    - CI 构建通过；本地用 `verifyArtifactSignature` 校验产物。
  - 对应需求：`requirements.md` 需求 5 / 验收 5.5、需求 10 / 验收 10.5、需求 14 / 验收 14.1–14.3、14.5、14.6
  - 对应设计：`design.md` §3.3.4、§8.2

- [ ] 4.2 managed-wsl 提供者
  - 变更记录：2026-11-24，按需求 8.4 与 `design.md` §2.3.4 增加停机 VHDX 回滚点、按卷名迁移与中断恢复；先验证夹具，不执行真实替换。
  - 状态：IN_REVIEW（Windows 11 候选部署与本机登录通过，待正式资产和生命周期验收）
  - 变更记录：2026-11-24，WSL 3.0.1.0 真机的 `wslinfo` 位于 `/usr/bin`，修正 NAT 探测和 Docker 命令防护共用的路径，见 `design.md` §3.3.4。
  - 实际输出：Win11 build 26100.9457 导入 `outcomego-engine`，修正探测后确认 `nat`，Docker `26.1.5+dfsg1`、Compose `2.26.1-4`。本地 SHA-256 候选注入测试入口，原版发行 Compose 验签通过，启动、健康和 owner 阶段通过，退出 0。登录 HTTP 200，扫描 6 份文件密码哨兵命中 0。Windows 101 个 API 和 viewer 监听均为 `127.0.0.1`，Docker TCP 监听 0。CLI 865 pass / 0 fail，WSL 定向 6 pass / 0 fail。
  - 升级夹具：验证无 VHDX 快照不能替换；有快照后只替换 `outcomego-engine`，卷归档使用原名索引。真实替换与回滚待验收。
  - 待验收：发布负责人提供匹配的正式签名资产。Windows 负责人执行 M2-06、M2-07 剩余路径组合、M2-09 人工任务、M2-10 桌面退出和宿主重启、M2-12、M2-14。回传签名篡改拒绝、卷数据核对和 VHDX 回退结果，见 [验收结果](docs/acceptance-result.md)。
  - 变更记录：2026-11-24，使用注册表 `BasePath` 确认发行版归属；平台行为仍待 Spike A、B、D 复测。
  - 变更记录：2026-11-24，显式以 UTF-8 读取注册路径与版本，要求实际 WSL NAT；无法确认时不启动 Docker，不修改 `.wslconfig`，见 `design.md` §3.3.4。
  - 这一步到底做什么：实现 `managed-wsl` 引擎提供者，以及 `engine start/stop/remove`。
  - 做完你能看到什么：`bootstrap --engine managed` 在 Windows 上能下载校验资产、导入 `outcomego-engine`、启动 dockerd，并用选定的调用方式运行 compose；`engine remove --purge-data` 能注销该发行版。
  - 先依赖什么：4.1、2.7
  - 开始前先看：
    - `requirements.md` 需求 4 / 验收 4.6，需求 5 / 验收 5.1、5.3、5.5、5.6，需求 7，需求 8 / 验收 8.4，需求 10 / 验收 10.7
    - `design.md` §3.2.1、§3.3.2、§3.3.4、§4.2
  - 技术规划：
    1. 新增 `engine/managed-wsl.ts` 实现 `EngineProvider`：`detect`（`wsl --status`、`wsl -l -v`、`wsl -d outcomego-engine --exec free -b`、能力检查）；`ensureReady`（下载 → 校验摘要与签名 → `wsl --import` → 写 `/etc/wsl.conf` → 启动 → 轮询 `docker info`）。
    2. `docker`、`composeInvocation` 按 Spike B 选定的方式；`stop` 用 `wsl --terminate outcomego-engine`；`remove({ purgeData })` 用 `wsl --unregister outcomego-engine`，只针对该名称。
    3. 保活按 Spike D 的结论启动脱离进程树的进程；不开启 Docker TCP 监听；端口只转发到 `127.0.0.1`。
    4. `main.ts` 的 `engine start|stop|remove`；选择器纳入 `managed-wsl`（仅 win32）。
  - 主要改哪里：
    - `apps/cli/src/engine/managed-wsl.ts`（新增）
    - `apps/cli/src/engine/`（选择器）
    - `apps/cli/test/`
  - 这一步先不做什么：不处理启用 WSL 与重启（见 4.3）；不修改 `.wslconfig` 与其他发行版。
  - 怎么算完成：
    1. `detect` 报告 WSL 状态、能力缺失项与客户机内存。
    2. 资产校验失败时拒绝导入。
    3. `remove --purge-data` 只注销 `outcomego-engine`，不影响其他发行版。
    4. 提供者不暴露 Docker TCP 接口。
  - 指标：
    - FakeRunner 测试：`detect` 的各状态；资产校验失败时拒绝导入；`remove` 只发出针对 `outcomego-engine` 的 `--unregister`（断言命令参数）。
    - 命令参数里不出现 `tcp://` 与 `-H`（断言）。
    - Windows 真机：`bootstrap --engine managed` 全流程成功；`netstat -ano` 显示 8787 与 6200–6299 只绑定 `127.0.0.1`。
    - 保活：桌面端退出 30 分钟后（初值）API 仍健康，依赖 Spike D 的结论。
  - 怎么验证：
    - FakeRunner 单元测试；在 Windows 真机上执行 `bootstrap --engine managed`。
  - 对应需求：`requirements.md` 需求 4 / 验收 4.6，需求 5 / 验收 5.1、5.3、5.5、5.6，需求 7，需求 8 / 验收 8.4，需求 10 / 验收 10.4、10.7
  - 对应设计：`design.md` §3.2.1、§3.3.2、§3.3.4、§4.2

- [ ] 4.3 功能启用、提权与重启续跑
  - 状态：IN_REVIEW（授权、拒绝和续跑夹具通过，待真机 UAC）
  - 实际输出：状态夹具仅序列化白名单字段，POSIX 权限 `0600`；`1223` 映射 `ELEVATION_DENIED` 并保留可重试状态，`3010` 映射 `REBOOT_REQUIRED`。Win11 上通过管理员 SSH 会话用 DISM 启用两个 WSL 可选功能，均返回 `3010`；随后真实重启，重连后两项 `InstallState=1`。这不是应用触发的 UAC 测试，未验证拒绝/同意提示、桌面向导续跑或密码不落盘。
  - 待验收：Windows 负责人按 Spike D 与 M2-03–M2-05 验证真实 UAC ≤ 1 次、Windows 文件访问权限、重启后重新打开时用户名预填且不恢复密码。
  - 变更记录：2026-11-24，先实现用户下次打开桌面端时恢复；不注册未经 Spike D 验证的开机项。
  - 这一步到底做什么：实现启用 WSL 的提权步骤、`deploy-state.json` 的读写和重启后续跑。
  - 做完你能看到什么：WSL 未启用时，向导经用户同意后一次提权完成启用；需要重启时保存状态；重启后打开桌面端，向导提示继续。
  - 先依赖什么：4.2、1.6
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.2、5.4，需求 10 / 验收 10.6，非功能需求 2 / 验收 2.1
    - `design.md` §2.3.2、§3.2.4
  - 技术规划：
    1. CLI 新增 `deploy-state.ts`：读写 `deploy-state.json`（0600，无密钥）。
    2. `managed-wsl.detect` 增加 WSL 状态与虚拟化检测，信号来自 Spike D。
    3. 桌面端 `local-deploy.ts` 通过一次性辅助程序以 UAC 提权运行启用命令，这是唯一提权点。
    4. 启用后若需要重启，写入 `deploy-state.json`（`awaiting: "reboot"`），按 Spike D 的结论注册续跑入口；桌面端启动时读取并恢复向导。
  - 主要改哪里：
    - `apps/cli/src/engine/managed-wsl.ts`
    - `apps/cli/src/deploy-state.ts`（新增）
    - `apps/desktop/src/main/local-deploy.ts`（提权辅助与恢复）
  - 这一步先不做什么：不做界面文案（见 4.4）；不做除“启用 Windows 功能”之外的任何提权。
  - 怎么算完成：
    1. `deploy-state.json` 不含任何密钥，权限为 0600。
    2. 提权范围最小，且事先说明用途。
    3. 虚拟化未开启、Windows 版本过低有各自的检测结果。
  - 指标：
    - `deploy-state.json` 单元测试：权限 0600，遍历字段断言不含 `password` 等键。
    - 一次完整部署中 UAC 提示 ≤ 1 次。
    - Spike D 的 4 个场景在真机各走通 1 次，其中含 1 次真实重启后的自动续跑。
    - 用户拒绝 UAC 时返回 `ELEVATION_DENIED` 且可重试（用例）。
  - 怎么验证：
    - 单元测试；按 Spike D 的场景在干净的 Windows 11 上逐一实测，含真实重启。
  - 对应需求：`requirements.md` 需求 5 / 验收 5.2、5.4，需求 10 / 验收 10.6，非功能需求 2 / 验收 2.1
  - 对应设计：`design.md` §2.3.2、§3.2.4

- [ ] 4.4 Windows 引导界面与文案
  - 状态：IN_REVIEW（渲染与文案检查通过）
  - 实际输出：向导 DOM 套件 10 pass / 0 fail，覆盖 WSL 授权、拒绝、重启提示、虚拟化、系统版本及手工内存提示；未写 `.wslconfig`，两端文案检查退出 0。
  - 待验收：Windows 负责人执行 M2-02–M2-05，确认启用与真实重启时文案、动作及状态连贯。
  - 这一步到底做什么：在部署向导里加入 Windows 托管引擎的专属步骤和文案。
  - 做完你能看到什么：向导能解释为什么需要管理员授权、提示重启、给出虚拟化与系统版本的具体指引，并在低内存时展示手工调整 `.wslconfig` 的说明。
  - 先依赖什么：4.3、3.4
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.2、5.4，需求 9 / 验收 9.5，需求 11 / 验收 11.4
    - `design.md` §2.3.2、§5.1
  - 技术规划：
    1. `local-deploy-flow.tsx` 增加 Windows 分支：说明为何需要管理员授权、提权按钮、重启提示与“重启后继续”、虚拟化与系统版本的专属指引。
    2. 覆盖 `VIRTUALIZATION_DISABLED`、`WSL_NOT_ENABLED`、`REBOOT_REQUIRED`、`ELEVATION_DENIED`、`WINDOWS_UNSUPPORTED` 五个错误码。
    3. 低内存时展示手工调整 `.wslconfig` 的说明，只展示，不修改文件；文案接入 `i18n-catalog.ts`。
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/local-deploy-flow.tsx`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不自动修改 `.wslconfig`。
  - 怎么算完成：
    1. 每个 Windows 相关错误码都有专属提示。
    2. 重启续跑时界面状态连贯。
  - 指标：
    - 渲染测试：上述 5 个错误码各 1 个用例，各自显示专属文案与动作。
    - 低内存场景断言：界面不触发任何写 `.wslconfig` 的 IPC。
    - `bun scripts/check/i18n-catalog.ts` 通过。
  - 怎么验证：
    - 渲染进程测试；在真机上走一遍启用与重启流程。
  - 对应需求：`requirements.md` 需求 5 / 验收 5.2、5.4，需求 9 / 验收 9.5，需求 11 / 验收 11.4
  - 对应设计：`design.md` §2.3.2、§5.1

### 阶段检查

- [ ] 4.5 M2 阶段检查：干净 Windows 11 端到端
  - 状态：IN_REVIEW（已有 Windows 可用性与 bootstrap 探测，部署端到端未完成）
  - 实际输出：`test-windows-install.ts` 纳入托管、bootstrap 与进程夹具；相同组件测试在 macOS 运行，不算 Windows 验收。Win11 实测记录了 WSL 功能启用前后状态；bootstrap 在 `engine` 阶段以 `ASSET_DOWNLOAD_FAILED`、退出码 3 结束，未导入发行版。stdout/stderr 与部署目录文件扫描测试哨兵密码命中 0 次。最新代码复测的 CLI SHA-256 与 Win11 文件摘要一致；`engine-status`、bootstrap 和全量 CLI 测试结果与前次相同，详见 [验收结果](docs/acceptance-result.md)。
  - 待验收：准备匹配 CLI 版本的正式 SHA-256 清单、Sigstore 签名与已批准引擎资产后，继续 M2-04–M2-14；其中真实 UAC/桌面续跑、网络回环、办公任务、保活、数据移除及两代资产升级回滚仍未验证。Spike F 的内存比较仍待用户参与。
  - 这一步到底做什么：在仅有 WSL 能力、没装 Docker 的干净 Windows 11 上完整验收托管引擎。
  - 做完你能看到什么：从下载桌面端到登录并创建第一个机器人，全程不安装 Docker；重启后服务恢复；移除并回收磁盘。
  - 先依赖什么：4.1、4.2、4.3、4.4
  - 开始前先看：
    - `requirements.md` 需求 5、7、8
    - `design.md` §7.3
    - `tasks.md`
  - 技术规划：
    1. 写出 M2 清单：干净 Windows 11 x64（仅 WSL 能力）→ 部署 → 登录 → 机器人办公任务 → 重启后恢复 → 退出应用后服务仍运行 → 移除并回收磁盘 → 其他 WSL 发行版不受影响。
    2. 扩展 `apps/cli/scripts/test-windows-install.ts` 覆盖可脚本化的部分。
    3. 结果写入 `docs/acceptance-result.md`。
  - 主要改哪里：`docs/acceptance-checklist.md`、`docs/acceptance-result.md`
  - 这一步先不做什么：不加新范围。
  - 怎么算完成：
    1. 干净系统、重启续跑、移除回收、不影响其他 WSL 发行版均已验证。
    2. 桌面端自更新后更新代理仍可用。
    3. 单个机器人的办公任务跑通，内存默认值与 Spike F 一致。
  - 指标：
    - 清单 ≥ 12 项（初值），逐项有结果。
    - 部署前后 `wsl -l -v` 中其他发行版的输出一致。
    - 单机器人办公任务的内存峰值与 Spike F 数据的偏差 ≤ 20%（初值）。
    - 移除后 `wsl -l` 不含 `outcomego-engine`，对应的 `.vhdx` 已删除。
  - 怎么验证：
    - 按清单执行；扩展 `apps/cli/scripts/test-windows-install.ts` 覆盖可脚本化的部分。
  - 对应需求：`requirements.md` 需求 5、需求 7、需求 8，需求 12 / 验收 12.4
  - 对应设计：`design.md` §7.3、§7.4

---

## 阶段 5：macOS 托管引擎

- [ ] 5.1 macOS 引擎资产与打包签名
  - 状态：IN_REVIEW（资产与签名流水线已实现，待授权发布流水线实跑）
  - 实际输出：新增 `build-macos-engine.ts`，固定 Lima 2.1.4、Ubuntu Jammy 镜像摘要和两架构输入，使用 Developer ID 签名运行时并应用 `com.apple.security.virtualization`；新增 `macos-engine` CI 矩阵和双架构 macOS 公证包矩阵，复用现有 macOS 证书恢复和发布 Sigstore 签名。离线组件核对 4 pass / 0 fail，macOS 发布配置测试 8 pass / 0 fail，发布工作流核对通过。当前本机没有可用于公证的凭据，未生成正式 DMG、ZIP 或引擎资产。
  - 待验收：发布负责人提供两架构已授权运行时和磁盘，核对虚拟化 entitlement、Developer ID、Gatekeeper、公证、通知与 dmg/zip 体积；先完成 Spike C、法务与发布门。
  - 这一步到底做什么：按 Spike C 选定的路线，打包虚拟机运行时与资产，完成签名、虚拟化 entitlement 与公证。
  - 做完你能看到什么：正式发布的 macOS 应用带有已签名公证的辅助二进制，资产有摘要与签名。
  - 先依赖什么：1.9、1.10（Spike C 为 Go）
  - 开始前先看：
    - `requirements.md` 需求 6 / 验收 6.3，需求 10 / 验收 10.5
    - `design.md` §3.3.4、§8.1、§8.2 Q11
    - `apps/desktop/package.json`、`apps/desktop/build/entitlements.mac.plist`、`apps/desktop/scripts/package-macos-release.ts`
  - 技术规划：
    1. 按 Spike C 的路线，在 `apps/desktop/package.json` 增加所需资源；优先按需下载，若必须随包则核对 dmg 预算。
    2. 新增 `build/entitlements.engine.mac.plist`，为 Lima 辅助二进制提供 `com.apple.security.virtualization`。
    3. `build-macos-engine.ts` 对辅助二进制逐个签名并生成两架构运行时、磁盘摘要和组件清单。
    4. CI 构建并签名资产，生成摘要与 Sigstore 签名，并执行与 4.1 相同的 `THIRD-PARTY-NOTICES` 一致性检查；确认不含专有软件。
  - 主要改哪里：
    - `apps/desktop/package.json`（`extraResources` 或下载逻辑）
    - `apps/desktop/build/entitlements.mac.plist`
    - `apps/cli/engine-assets/entitlements.engine.mac.plist`
    - `apps/desktop/scripts/package-macos-release.ts`、`apps/desktop/scripts/macos-release-utils.ts`
    - `.github/workflows/release.yml`
  - 这一步先不做什么：不实现 `managed-lima` 提供者；不改变现有 `package:mac-local` 的行为。
  - 怎么算完成：
    1. `package:mac-release` 产物签名、公证通过。
    2. 现有的 macOS 通知校验脚本仍然通过。
    3. 组件已登记到 `THIRD-PARTY-NOTICES`；自托管的资产旁写明源码获取方式；法务已确认（Q11），未确认前不公开发布。
  - 指标：
    - `bun run package:mac-release` 成功；`codesign --verify --deep --strict` 与 `spctl --assess` 通过。
    - `bun run verify:mac-notifications` 仍通过。
    - `check-desktop-budgets.ts --release` 下 dmg ≤ 135 MiB、zip ≤ 130 MiB。
    - 资产摘要与签名校验 2 个用例（成功、篡改失败）。
  - 怎么验证：
    - 运行 `package:mac-release` 与 `verify:mac-notifications`；用 `codesign` 与 `spctl` 检查。
  - 对应需求：`requirements.md` 需求 6 / 验收 6.3，需求 10 / 验收 10.5，需求 14 / 验收 14.1–14.3、14.5、14.6
  - 对应设计：`design.md` §3.3.4、§8.1、§8.2

- [ ] 5.2 managed-lima 提供者
  - 变更记录：2026-11-24，按需求 8.4 与 `design.md` §2.3.4 保留停机实例和运行时作为回滚点，迁移原名卷；不启动真机 VM。
  - 状态：IN_REVIEW（提供者和安全夹具通过，待双架构）
  - 实际输出：夹具核对 4–8 GiB 内存、`vz`、只读挂载、回环转发规则、资产摘要/签名、归属、符号链接拒绝、专属删除和首次部署换端口；未创建实际 VM。
  - 升级夹具：验证原实例和运行时一同恢复，重复回退不会覆盖已恢复目录；未运行真实 VM。
  - 待验收：两架构负责人执行 M3-04–M3-09、M3-11、M3-13，回传 VM 配置、监听、桌面退出保活、两代资产的卷数据核对和原虚拟磁盘回退结果。
  - 变更记录：2026-11-24，按 vz 候选实现签名资产与专用实例隔离，保留 Spike C 验收门。
  - 变更记录：2026-11-24，复用解包运行时前核对已验证的安装记录与摘要，拒绝专用引擎目录中的符号链接，见 `design.md` §3.3.4。
  - 这一步到底做什么：实现 `managed-lima` 引擎提供者，含虚拟机创建、启动、停止、移除。
  - 做完你能看到什么：`bootstrap --engine managed` 在 macOS 上能创建专用虚拟机，运行 compose，端口只转发到 `127.0.0.1`；移除时删除虚拟机与磁盘。
  - 先依赖什么：5.1、2.7
  - 开始前先看：
    - `requirements.md` 需求 4 / 验收 4.6，需求 6，需求 7，需求 8 / 验收 8.4
    - `design.md` §3.2.1、§3.3.4、§3.3.6
  - 技术规划：
    1. 新增 `engine/managed-lima.ts` 实现 `EngineProvider`：`limactl create/start/stop/delete`；配置 vz、内存 = `clamp(宿主机内存 × 0.5, 4 GiB, 8 GiB)`、只读共享安装目录、端口只转发 `127.0.0.1`。
    2. `docker`、`composeInvocation`：`limactl shell <实例> -- docker compose …`。
    3. `remove({ purgeData })` 删除专属实例与磁盘镜像；选择器纳入（仅 darwin 且 ≥ 13.5）。
  - 主要改哪里：
    - `apps/cli/src/engine/managed-lima.ts`（新增）
    - `apps/cli/src/engine/`（选择器）
    - `apps/cli/test/`
  - 这一步先不做什么：不做界面。
  - 怎么算完成：
    1. 虚拟机内存按公式设定，客户机内存可读取。
    2. 端口只绑定 `127.0.0.1`。
    3. 删除数据时虚拟机与磁盘镜像被清理。
  - 指标：
    - FakeRunner 测试：配置中的内存按公式；`remove` 的命令参数只指向专属实例。
    - macOS 真机：`bootstrap --engine managed` 全流程成功；`lsof -iTCP -sTCP:LISTEN` 显示 8787 与 6200–6299 只在 `127.0.0.1`。
    - 桌面端退出后 API 仍健康（依赖 Spike C 对 Q13 的结论）。
  - 怎么验证：
    - FakeRunner 单元测试；在 macOS 真机上执行 `bootstrap --engine managed`。
  - 对应需求：`requirements.md` 需求 4 / 验收 4.6，需求 6 / 验收 6.1、6.4、6.5，需求 7，需求 8 / 验收 8.4，需求 10 / 验收 10.4
  - 对应设计：`design.md` §3.2.1、§3.3.4、§3.3.6

- [ ] 5.3 macOS 引导界面与文案
  - 状态：IN_REVIEW（两项指标已由 DOM 夹具覆盖）
  - 实际输出：同一 DOM 用例覆盖 `MACOS_UNSUPPORTED` 专属 13.5 门槛及虚拟机准备文案；复用低内存确认，i18n 检查退出 0。
  - 待验收：macOS 负责人执行 M3-02、M3-04，检查不支持时可退出向导、受支持时显示 VM 准备进度。
  - 这一步到底做什么：在部署向导里加入 macOS 托管引擎的专属步骤和文案。
  - 做完你能看到什么：向导能提示系统版本与架构要求，并在部署过程中说明正在准备虚拟机。
  - 先依赖什么：5.2、3.4
  - 开始前先看：
    - `requirements.md` 需求 6 / 验收 6.2，需求 11 / 验收 11.4
    - `design.md` §5.1
  - 技术规划：
    1. `local-deploy-flow.tsx` 增加 macOS 分支：`MACOS_UNSUPPORTED` 文案（含 13.5 要求，以及改用已有引擎或远程服务器的指引）、“正在准备虚拟机”阶段文案。
    2. 低内存确认与 Windows 分支共用；文案接入 `i18n-catalog.ts`。
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/local-deploy-flow.tsx`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不改 Windows 步骤。
  - 怎么算完成：
    1. `MACOS_UNSUPPORTED` 有专属提示。
    2. 低内存确认流程与 Windows 一致。
  - 指标：
    - 渲染测试 2 个用例：`MACOS_UNSUPPORTED`、虚拟机准备阶段。
    - `bun scripts/check/i18n-catalog.ts` 通过。
  - 怎么验证：
    - 渲染进程测试；在真机上走一遍。
  - 对应需求：`requirements.md` 需求 6 / 验收 6.2，需求 11 / 验收 11.4
  - 对应设计：`design.md` §5.1

### 阶段检查

- [ ] 5.4 M3 阶段检查：未装 Docker 的 macOS 端到端
  - 状态：IN_REVIEW（13 项清单就绪，尚无双架构结果）
  - 实际输出：两架构各列 13 项，当前全部待验收。
  - 待验收：macOS 负责人用匹配的公证包走 M3-01–M3-13，并提供无开发工具 Mac 的 `spctl` 输出及删除后的磁盘检查。
  - 这一步到底做什么：在没装 Docker 的 macOS 上完整验收托管引擎。
  - 做完你能看到什么：从下载桌面端到登录并创建第一个机器人，全程不安装任何额外软件；重启后服务恢复；移除并回收磁盘。
  - 先依赖什么：5.1、5.2、5.3
  - 开始前先看：
    - `requirements.md` 需求 6、7、8
    - `design.md` §7.3
    - `tasks.md`
  - 技术规划：
    1. 写出 M3 清单：macOS 13.5 以上的 Apple Silicon 与 Intel 各一台，全新部署 → 登录 → 机器人办公任务 → 重启后恢复 → 退出应用后服务仍运行 → 移除并回收磁盘。
    2. 把公证后的应用拷到另一台未装开发工具的 Mac 上验证。
    3. 结果写入 `docs/acceptance-result.md`。
  - 主要改哪里：`docs/acceptance-checklist.md`、`docs/acceptance-result.md`
  - 这一步先不做什么：不加新范围。
  - 怎么算完成：
    1. 干净系统、重启恢复、移除回收均已验证。
    2. 公证后的应用在另一台未装开发工具的 Mac 上可用。
    3. 单个机器人的办公任务跑通。
  - 指标：
    - 清单 ≥ 12 项（初值），逐项有结果。
    - 两种 CPU 架构各完成 1 次全新部署。
    - `spctl --assess` 在未装开发工具的机器上通过。
    - 移除后虚拟机与磁盘镜像不存在。
  - 怎么验证：
    - 按清单执行。
  - 对应需求：`requirements.md` 需求 6、需求 7、需求 8，需求 12 / 验收 12.4
  - 对应设计：`design.md` §7.3、§7.4

---

## 阶段 6：文档、国际化与最终验收

- [ ] 6.1 文档更新
  - 状态：IN_REVIEW（文档、发布说明模板和错误码比对已更新）
  - 实际输出：安装、备份、排障和 Windows 通知区域退出说明已更新；排障表与设计匹配 23 项。未执行真实备份/恢复。
  - 待验收：在外部引擎和托管引擎的隔离安装上按文档分别完成备份与恢复，并对比数据校验结果。
  - 这一步到底做什么：更新安装、备份和排障文档，写清楚托管引擎下的操作方式。
  - 做完你能看到什么：安装文档以桌面端一键部署为首选路径；备份文档里的命令在托管引擎下改为经 `outcomego engine docker -- …` 执行；排障文档覆盖各常见故障。
  - 先依赖什么：3.8（随 4.5、5.4 的交付逐步补充）
  - 开始前先看：
    - `requirements.md` 需求 11 / 验收 11.4，需求 12 / 验收 12.1
    - `design.md` §4.1、§5.1
    - `docs/getting-started/installation.md`、`docs/manage/backups.md`、`docs/manage/troubleshooting.md`
  - 技术规划：
    1. `docs/getting-started/installation.md`：桌面端一键部署作为首选路径，写明系统要求（Windows x64、macOS 13.5 等）与 Windows 关窗常驻。
    2. `docs/manage/backups.md`：托管引擎下把命令前缀改为 `outcomego engine docker -- compose …`。
    3. `docs/manage/troubleshooting.md`：按 `design.md` §5.1 的错误码逐条写原因与处理。
    4. 发布说明模板加入“Windows 关闭窗口后应用留在通知区域”。
  - 主要改哪里：
    - `docs/getting-started/installation.md`
    - `docs/manage/backups.md`
    - `docs/manage/troubleshooting.md`
  - 这一步先不做什么：不改与本功能无关的文档。
  - 怎么算完成：
    1. 每个错误码在排障文档里都有对应条目。
    2. 备份与恢复命令在两类引擎下都能照着执行。
    3. 发布说明与安装文档写明：Windows 桌面端关闭窗口后应用留在通知区域，以及如何退出（需求 12.3、13）。
  - 指标：
    - `design.md` §5.1 的每个错误码在 `troubleshooting.md` 中都有 1 条，脚本核对缺失为 0。
    - 备份与恢复文档中的命令在托管引擎与 external 引擎各执行 1 次并通过。
    - 文档中第三方产品名称仅用于兼容性描述，引擎统一称 `outcomego-engine`（人工检查加 grep）。
  - 怎么验证：
    - 在真机上照文档操作一遍。
  - 对应需求：`requirements.md` 需求 11 / 验收 11.4，需求 12 / 验收 12.1、12.3，需求 13 / 验收 13.6，需求 14 / 验收 14.4
  - 对应设计：`design.md` §4.1、§5.1

- [x] 6.2 国际化
  - 状态：DONE（经 IN_PROGRESS、IN_REVIEW 验证）
  - 实际输出：架构门中桌面和 CLI 国际化检查均退出 0；桌面 2281 条、CLI 291 条翻译通过扫描，设计的 23 个错误码在 CLI、桌面中英文一致，并各有 1 条排障记录。向导 DOM 套件覆盖平台错误文案。
  - 这一步到底做什么：把新增的界面与 CLI 文案接入现有国际化机制并检查缺失。
  - 做完你能看到什么：所有新增文案在各支持语言下都有翻译，没有硬编码的单语言文案。
  - 先依赖什么：3.4、4.4、5.3
  - 开始前先看：
    - `requirements.md` 需求 12 / 验收 12.2
  - 技术规划：
    1. 收集本 Spec 新增的界面与 CLI 文案。
    2. 桌面端放入 `i18n-catalog.ts`，CLI 放入 `localization.ts` 的 `simplifiedChinese` 表。
    3. 两处的错误码文案保持一致，并检查没有把第三方产品名称用作本产品名称。
  - 主要改哪里：
    - `apps/cli/src/localization.ts`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不新增语言。
  - 怎么算完成：
    1. 现有的国际化缺失检查通过。
    2. 错误码文案在两个入口（CLI 与桌面端）一致。
  - 指标：
    - `bun scripts/check/i18n-catalog.ts` 与 `bun scripts/check/i18n-cli-catalog.ts` 退出码均为 0。
    - `design.md` §5.1 的全部错误码在 CLI 与桌面端都有对应文案（脚本核对缺失为 0）。
  - 怎么验证：
    - 运行现有的国际化相关测试；人工抽查。
  - 对应需求：`requirements.md` 需求 12 / 验收 12.2，需求 14 / 验收 14.4
  - 对应设计：`design.md` §7.1

### 最终检查

- [ ] 6.3 最终检查点
  - 状态：IN_REVIEW（静态与自动核对已执行，不是发布通过）
  - 实际输出：`check_spec.py` 核对 37 项后退出 0；17 行对应证据、测试结果和缺口见 [验收结果](docs/acceptance-result.md)。普通桌面预算由 6 项超限降至 3 项，剩余项待白天确认；未放宽阈值，未跑暂缓的发布门。
  - 待验收：负责人补齐三个里程碑手工结果、Spike A–F 未完成部分、签名公证、法务记录、已批准 NOTICE 与源码信息；托管资产升级/回滚另需实测。未达到全部任务 DONE/CANCELLED。
  - 这一步到底做什么：确认本 Spec 真的达到交付标准，而不是“差一点点以后再说”。
  - 做完你能看到什么：需求、设计、任务、验证证据能一一对上；M1、M2、M3 的验收结果齐全。
  - 先依赖什么：3.8、4.5、5.4、6.1、6.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 技术规划：
    1. 运行 `docs/check_spec.py` 做机械核对。
    2. 逐行核对 `design.md` §7.4 的 17 行是否各有证据（测试名、手工清单结果、文档链接）。
    3. 汇总风险、延期项、取消项；核对 `THIRD-PARTY-NOTICES`、源码获取方式和法务确认记录。
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. 关键任务都能追踪到需求和设计，`design.md` §7.4 的每一行都有验证证据。
    2. 风险、延期项、取消项已经写清楚。
    3. 终端安装、Linux、远程服务器用户的回归全部通过。
    4. 后续接手的人能快速看懂。
    5. `THIRD-PARTY-NOTICES`、源码获取方式和法务确认记录齐全（需求 14）。
  - 指标：
    - `check_spec.py` 退出码为 0。
    - `design.md` §7.4 的 17 行各有 ≥ 1 条证据。
    - 所有任务状态为 DONE 或 CANCELLED，CANCELLED 均写明原因。
    - M1、M2、M3 的验收结果齐全，法务确认已记录。
  - 怎么验证：
    - 按 `design.md` §7.4 逐项核对证据。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
