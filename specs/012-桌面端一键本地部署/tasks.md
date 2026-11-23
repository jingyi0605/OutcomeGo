# 任务清单 - 桌面端一键本地部署（人话版）

状态：Draft

关联文档：[需求文档](requirements.md)、[设计文档](design.md)、[补充文档目录](docs/README.md)

## 这份文档是干什么的

这份任务清单把“桌面端一键本地部署”拆成可以逐步验证的步骤。先用阶段 1 的 Spike 验证最危险的假设，再按阶段 2 到 6 实现。每个任务都能追踪到需求和设计，完成后立即回写状态。

当前只完成了规划（任务 1.1、1.2）。**所有实现任务都还没有开始，本 Spec 创建时没有修改任何业务代码。**

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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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

- [ ] 2.1 引擎提供者接口与 external 实现
  - 状态：TODO
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
    6. `main.ts` 增加 `engine status --json`；`external.detect` 额外检查 cgroup 版本等 `computer` 要求，缺失时列出具体项。
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
  - 怎么验证：
    - `bun test`、`bun run test:doctor`、`bun run test:install`（在 `apps/cli` 下）。
    - 用 `grep` 核对直接 docker 调用清零。
  - 对应需求：`requirements.md` 需求 4 / 验收 4.1–4.5、非功能需求 3 / 验收 3.1
  - 对应设计：`design.md` §3.2.1、§3.3.2、§3.3.4

- [ ] 2.2 安装清单记录引擎并锁定
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 怎么验证：
    - FakeRunner 集成测试：全流程、每个阶段失败、重试、取消、并发。
    - 凭据泄露扫描：对全部输出与日志搜索测试密码。
  - 对应需求：`requirements.md` 需求 2 / 验收 2.1–2.4、需求 3 / 验收 3.1–3.5、3.7，需求 10 / 验收 10.3、10.4，非功能需求 1 / 验收 1.1、1.3，非功能需求 2 / 验收 2.1–2.3
  - 对应设计：`design.md` §2.3.1、§3.3.1、§3.3.2、§5

- [ ] 2.5 资源与端口预检、内存公式与调整入口
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
    4. 取消：Windows 用 `taskkill /T /F` 终止进程树，macOS 向进程组发 `SIGTERM`，超时再 `SIGKILL`。
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

- [ ] 3.2 IPC、preload 与类型
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
  - 这一步到底做什么：按 Spike C 选定的路线，打包虚拟机运行时与资产，完成签名、虚拟化 entitlement 与公证。
  - 做完你能看到什么：正式发布的 macOS 应用带有已签名公证的辅助二进制，资产有摘要与签名。
  - 先依赖什么：1.9、1.10（Spike C 为 Go）
  - 开始前先看：
    - `requirements.md` 需求 6 / 验收 6.3，需求 10 / 验收 10.5
    - `design.md` §3.3.4、§8.1、§8.2 Q11
    - `apps/desktop/package.json`、`apps/desktop/build/entitlements.mac.plist`、`apps/desktop/scripts/package-macos-release.ts`
  - 技术规划：
    1. 按 Spike C 的路线，在 `apps/desktop/package.json` 增加所需资源；优先按需下载，若必须随包则核对 dmg 预算。
    2. `build/entitlements.mac.plist` 为辅助二进制增加 `com.apple.security.virtualization`。
    3. `scripts/package-macos-release.ts` 与 `macos-release-utils.ts` 对辅助二进制逐个签名并纳入公证。
    4. CI 构建并签名资产，生成摘要与 sigstore 签名，并执行与 4.1 相同的 `THIRD-PARTY-NOTICES` 一致性检查；确认不含专有软件。
  - 主要改哪里：
    - `apps/desktop/package.json`（`extraResources` 或下载逻辑）
    - `apps/desktop/build/entitlements.mac.plist`
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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
  - 状态：TODO
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

- [ ] 6.2 国际化
  - 状态：TODO
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
  - 状态：TODO
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
