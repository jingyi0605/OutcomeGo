# 任务清单 - 本地服务托盘管理与引擎配置（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单不是拿来堆术语的，是拿来让人快速知道：

- 先做什么
- 后做什么
- 每一步到底改什么
- 做完后怎么判断是不是真的完成了

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

---

## 阶段 1：CLI 运维契约、引擎能力与 Compose 底座

- [x] 1.1 扩展 Compose 环境变量透传、本地覆盖文件支持与 `computer` 宿主机代理端口放通
  - 状态：DONE
  - 这一步到底做什么：给 `deploy/compose.yaml` 补齐可选的代理环境变量透传与 `server`/`worker` 的 `host.docker.internal` 映射；让 CLI `ComposeProject` 在安装目录存在 `compose.local.yaml` 时自动叠加加载；并在 `docker/outcomego-computer-network.py` 里支持根据 `OUTCOMEGO_HOST_PROXY_TARGET` 放行宿主机代理 `ip:port`。
  - 做完你能看到什么：不改旧 `.env` 时 `docker compose config` 行为零变化；填入代理变量或生成 `compose.local.yaml` 后，容器能正确拿到代理环境变量、CPU 限额，且 `computer` 容器能连上宿主机代理端口。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5、需求 6
    - `design.md` §3.3.3「`deploy/compose.yaml` 与容器网络配合」
    - `design.md` §6.1「属性 1：内网通信免代理不变量」
  - 主要改哪里：
    - `deploy/compose.yaml`
    - `apps/cli/src/docker.ts`
    - `docker/outcomego-computer-network.py`
  - 这一步先不做什么：不写 CLI 新子命令，不改桌面端界面。
  - 怎么算完成：
    1. `deploy/compose.yaml` 在不含新变量的旧 `.env` 下通过 `docker compose config` 校验
    2. `ComposeProject` 在 `compose.local.yaml` 存在时自动带上 `-f compose.local.yaml`，不存在时不带
    3. `outcomego-computer-network.py` 单元测试覆盖 `OUTCOMEGO_HOST_PROXY_TARGET` 合法解析、非法输入忽略及 `@host_bridge_v4` 放行规则
  - 怎么验证：
    - 运行 `docker compose -f deploy/compose.yaml config`（空可选变量与含代理变量两组用例）
    - 运行 `apps/cli` 与 `docker/outcomego-computer-network.py` 相关单元测试
  - 对应需求：`requirements.md` 需求 4 / 验收 4.3、需求 5 / 验收 5.3、需求 6 / 验收 6.3
  - 对应设计：`design.md` §3.3.3、§6.1

- [x] 1.2 实现 CLI 容器查询、实时指标、单容器重启与脱敏日志命令
  - 状态：DONE
  - 这一步到底做什么：在 CLI 中新增 `containers --json [--stats]`、`restart [service] --json --yes`、`logs <service> --tail <n> --json`，补齐参数解析、服务名白名单校验、核心服务与初始化任务区分、`computer` 重启联动 `computer-memory-init`，以及统一日志脱敏。
  - 做完你能看到什么：命令行运行 `outcomego containers --json --stats`、`outcomego restart computer --json --yes`、`outcomego logs server --tail 200 --json` 都能输出规范的 `schemaVersion: 1` JSON，敏感凭据不会泄露。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6、需求 7
    - `design.md` §2.3.2「容器状态、指标查看与单容器重启」
    - `design.md` §3.2.1「`LocalContainerInfo`」
    - `design.md` §3.3.1「CLI 新增与扩展子命令」
    - `design.md` §6.2「属性 2：`computer` 重启协同不变量」
  - 主要改哪里：
    - `apps/cli/src/arguments.ts`
    - `apps/cli/src/main.ts`
    - `apps/cli/src/local-ops.ts`（新增）
    - `apps/cli/src/lifecycle.ts`
    - `apps/cli/test/local-ops.test.ts`（新增）
  - 这一步先不做什么：不做流式持续 `logs --follow` 的前端推送，不做桌面端 IPC。
  - 怎么算完成：
    1. `containers --json` 准确返回 `core` / `init` 分类、状态、健康、运行时长、镜像，带 `--stats` 时合并 CPU 与内存占用
    2. `restart computer` 固定协同重建 `computer` 与 `computer-memory-init`
    3. `logs --json` 校验服务名白名单与 `tail` 范围，并对密码/Token/API Key 完成脱敏
    4. 桌面端版本握手白名单涵盖新增子命令
  - 怎么验证：
    - 运行 `apps/cli/test/local-ops.test.ts` 单元测试通过
  - 对应需求：`requirements.md` 需求 2 / 验收 2.2、2.4、2.5，需求 6 / 验收 6.1、6.2，需求 7 / 验收 7.3
  - 对应设计：`design.md` §2.3.2、§3.2.1、§3.3.1、§6.2

- [x] 1.3 实现本地服务开机自启独立配置与双平台引擎支持
  - 状态：DONE
  - 这一步到底做什么：在 `installation.json` 增加 `autostart.enabled` 持久化偏好；解耦 `startCommand`/`stopCommand` 不再静默覆盖用户偏好；为 `ManagedWslEngine` 补齐计划任务存在性查询；为 `ManagedLimaEngine` 实现 macOS 用户级 LaunchAgent（`~/Library/LaunchAgents/com.outcomego.managed-engine.plist`）的查询、注册与卸载；新增 `outcomego autostart status|set --enabled <true|false> --json`。
  - 做完你能看到什么：无论 Windows 还是 macOS 托管引擎，都可以独立查看和开关“本地服务开机自启”，手动停止或启动服务不会把用户的自启开关搞乱；外部引擎返回清晰的只读说明。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 6
    - `design.md` §3.2.2「`LocalAutostartStatus`」
    - `design.md` §4.1「数据关系与持久化位置」
    - `design.md` §4.2「自启偏好与手动启停的解耦规则」
  - 主要改哪里：
    - `apps/cli/src/config.ts`
    - `apps/cli/src/engine/managed.ts`
    - `apps/cli/src/engine/managed-wsl.ts`
    - `apps/cli/src/engine/managed-lima.ts`
    - `apps/cli/src/lifecycle.ts`
    - `apps/cli/src/local-ops.ts`
    - `apps/cli/test/autostart.test.ts`（新增）
  - 这一步先不做什么：不做 Electron 桌面端 `setLoginItemSettings`（留给阶段 2）。
  - 怎么算完成：
    1. `autostart status/set --json` 在 `managed-wsl`、`managed-lima`、`external` 下均返回符合契约的 JSON
    2. `stopCommand` 不删除已开启的自启任务，`startCommand` 在自启关闭时不重新注册任务，`uninstallCommand` 仍清理自启任务
    3. macOS LaunchAgent plist 指向稳定 CLI 路径且可幂等注册/卸载
  - 怎么验证：
    - 运行 `apps/cli/test/autostart.test.ts` 与现有 `apps/cli` 引擎测试全部通过
  - 对应需求：`requirements.md` 需求 3 / 验收 3.2、3.3、3.4、3.5，需求 6 / 验收 6.1、6.2
  - 对应设计：`design.md` §3.2.2、§3.3.1、§4.1、§4.2

- [x] 1.4 扩展性能与资源查询及配置命令（容器级 + Lima VM + Windows `.wslconfig`）
  - 状态：DONE
  - 这一步到底做什么：新增 `outcomego resources status --json` 回显宿主机、容器生效配置与引擎分配；扩展 `outcomego resources set --json --yes` 支持 `computer` 内存/CPU（写入 `compose.local.yaml`）、`desktop` 内存、`worker` 并发，以及 macOS Lima VM 内存/CPU 编辑（失败回滚）和 Windows `%USERPROFILE%\.wslconfig` 安全备份与增量更新。
  - 做完你能看到什么：命令行可一次性查清当前所有生效资源配置，也能安全调整并只在受影响范围重建容器或引擎，失败时自动恢复原配置。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 4、需求 6
    - `design.md` §3.2.3「`LocalResourceSnapshot` & `LocalResourceUpdate`」
    - `design.md` §5「错误处理与回滚策略」
  - 主要改哪里：
    - `apps/cli/src/lifecycle.ts`
    - `apps/cli/src/local-ops.ts`
    - `apps/cli/src/wsl-config.ts`（新增）
    - `apps/cli/src/engine/managed-lima.ts`
    - `apps/cli/src/engine/managed-wsl.ts`
    - `apps/cli/test/resources.test.ts`（新增）
  - 这一步先不做什么：不做前端预设档位交互与滑块 UI（留给阶段 3）。
  - 怎么算完成：
    1. `resources status --json` 准确读取 `.env`、`compose.local.yaml`、引擎当前内存/CPU 及 Windows `.wslconfig` 现有值
    2. 校验规则拦住非法内存（`< 1 GiB` 或 `desktop >= computer`）、非法 CPU、非法并发数
    3. 容器重建失败时自动回滚 `.env` 与 `compose.local.yaml`；`.wslconfig` 修改前自动备份 `.wslconfig.outcomego.bak` 且保留其他配置节和注释
  - 怎么验证：
    - 运行 `apps/cli/test/resources.test.ts`（覆盖正常更新、边界校验、重建失败回滚、`.wslconfig` 增量保留）
  - 对应需求：`requirements.md` 需求 4 / 验收 4.1、4.2、4.3、4.4、4.5、4.6，需求 6 / 验收 6.1、6.2
  - 对应设计：`design.md` §3.2.3、§3.3.1、§4.1、§5

- [x] 1.5 实现本地代理配置、回环地址映射、托管 Docker daemon 同步与一键测通
  - 状态：DONE
  - 这一步到底做什么：新增 `apps/cli/src/proxy-config.ts` 与 `outcomego proxy status|set|test --json`（`set` / `test` 从 stdin 读取 JSON 防密码入参）；支持直连/系统/手动代理，自动映射宿主机回环地址（WSL NAT 网关 IP / `host.lima.internal` / `host.docker.internal`），强制合并内网 `NO_PROXY`，同步写入 `proxy.json`、`.env`、托管引擎 Docker daemon drop-in（`/etc/systemd/system/docker.service.d/outcomego-proxy.conf`）并重建受影响容器；同时让 CLI 资产/Release 下载器读取本地代理配置作为默认代理。
  - 做完你能看到什么：一条 `outcomego proxy test --json` 可实测代理及外部端点连通性；`outcomego proxy set --json --config-stdin --yes` 生效后，容器出网、托管引擎拉镜像和 CLI 下载都能走代理，失败时完整回滚，且任何输出都不含明文密码。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6、需求 7
    - `design.md` §2.3.3「本地服务代理应用与宿主机回环映射」
    - `design.md` §3.2.4「`LocalProxyConfig` & `LocalProxyTestResult`」
    - `design.md` §5「错误处理与回滚策略」
    - `design.md` §6.1「属性 1：内网通信免代理不变量」
    - `design.md` §6.3「属性 3：凭据不入命令行与日志不变量」
  - 主要改哪里：
    - `apps/cli/src/proxy-config.ts`（新增）
    - `apps/cli/src/local-ops.ts`
    - `apps/cli/src/engine/managed.ts`
    - `apps/cli/src/engine/managed-wsl.ts`
    - `apps/cli/src/engine/managed-lima.ts`
    - `apps/cli/src/release.ts`
    - `apps/cli/src/engine/managed-assets.ts`
    - `apps/cli/test/proxy-config.test.ts`（新增）
  - 这一步先不做什么：不做 Windows/macOS 系统代理 GUI 读取（留给阶段 2 桌面端主进程）。
  - 怎么算完成：
    1. `NO_PROXY` 合并逻辑无论用户输入什么都保留全部内网保护条目
    2. `127.0.0.1`/`localhost`/`::1` 按引擎类型正确映射，同时 `proxy.json` 保留原始配置用于界面回显
    3. Docker daemon drop-in 生成/移除与容器重建具备失败回滚
    4. `proxy status`、`proxy test` 与错误输出均不包含明文密码
  - 怎么验证：
    - 运行 `apps/cli/test/proxy-config.test.ts` 覆盖 URL 校验、回环映射、强制 `NO_PROXY`、daemon drop-in 与回滚、脱敏和测通逻辑
  - 对应需求：`requirements.md` 需求 5 / 验收 5.1–5.7，需求 6 / 验收 6.1、6.2，需求 7 / 验收 7.3
  - 对应设计：`design.md` §2.3.3、§3.2.4、§3.3.1、§5、§6.1、§6.3

### 阶段检查

- [x] 1.6 阶段 1 检查点（CLI 与底座验证）
  - 状态：DONE
  - 这一步到底做什么：确认阶段 1 所有 CLI 子命令、引擎扩展、Compose 兼容与单元测试全部跑通，契约稳定，可支撑桌面端对接。
  - 做完你能看到什么：CLI 层所有新能力已自洽并具备全量自动化测试保障，没有留给桌面端擦屁股的协议漏洞。
  - 先依赖什么：1.1、1.2、1.3、1.4、1.5
  - 开始前先看：
    - `requirements.md` 需求 2–7
    - `design.md` §3.2、§3.3、§6
  - 主要改哪里：本阶段全部相关文件与 `tasks.md` 状态
  - 这一步先不做什么：不提前写桌面端 UI。
  - 怎么算完成：
    1. `apps/cli` 全量测试通过且类型检查无错误
    2. 所有新增 JSON 输出均包含 `schemaVersion: 1` 且与 `design.md` §3.2 对齐
    3. 已记录任何发现的平台兼容细节
  - 怎么验证：
    - 在仓库根目录运行 `apps/cli` 类型检查与测试套件
  - 对应需求：`requirements.md` 需求 2–7
  - 对应设计：`design.md` §3.2、§3.3、§4.1、§5、§6

---

## 阶段 2：桌面端托盘增强、状态同步修复与容器管理面板

- [ ] 2.1 修复托盘状态不同步并增强任务栏右键菜单
  - 状态：TODO
  - 这一步到底做什么：修复右键弹出旧菜单和部署/启停后未刷新托盘的问题（增加右键 1200ms 限时刷新与部署/操作/切服后的主动 `syncLocalTrayState`）；重构 `tray-menu.ts` 与 `tray.ts`，在本地模式下增加“服务管理…”、“重启本地服务”、“开机自动启动本地服务（复选框）”和“打开日志目录”，远程模式保持极简。
  - 做完你能看到什么：本地部署完成或启停后，任务栏托盘状态立刻变成“正在运行 / 已停止”；右键菜单可直接跳转服务管理、一键重启、切换开机自启或打开日志文件夹。
  - 先依赖什么：1.6
  - 开始前先看：
    - `requirements.md` 需求 1、需求 7
    - `design.md` §2.3.1「托盘状态同步与“服务管理…”直达」
    - `design.md` §4.2「托盘状态同步模型」
    - `design.md` §6.4「属性 4：托盘与本地连接身份一致性不变量」
  - 主要改哪里：
    - `apps/desktop/src/main/tray-menu.ts`
    - `apps/desktop/src/main/tray.ts`
    - `apps/desktop/src/main/index.ts`
    - `apps/desktop/test/tray-menu.test.ts`（更新或新增）
  - 这一步先不做什么：不在托盘内做二级资源/代理表单，只做快捷入口和状态同步。
  - 怎么算完成：
    1. 部署完成、启动恢复、启停/重启、切服后托盘状态立刻更新
    2. 本地模式菜单包含“服务管理… / 启停 / 重启 / 开机自启复选框 / 打开日志目录 / 退出”，远程模式仅“打开 / 退出”
    3. 忙碌态下互斥生命周期操作置灰不可重复点
  - 怎么验证：
    - 运行桌面端 `tray-menu` 单元测试覆盖所有状态组合
    - 启动本地桌面端验证托盘菜单项和右键刷新行为
  - 对应需求：`requirements.md` 需求 1 / 验收 1.1–1.5，需求 7 / 验收 7.1、7.2
  - 对应设计：`design.md` §2.3.1、§4.2、§6.4

- [ ] 2.2 扩展桌面端 `LocalDeployManager`、LoginItem 偏好、系统代理探测与 IPC 契约
  - 状态：TODO
  - 这一步到底做什么：在 `local-deploy.ts`、`local-deploy-contract.ts`、`background-preferences.ts`、`preload/index.ts` 与 `main/index.ts` 接入阶段 1 新增的全部 CLI 子命令；扩展 `BackgroundPreferences` 支持 `launchAtLogin` / `launchHidden` 并联动 Electron `app.setLoginItemSettings` 及 `--autostart-hidden` 静默启动；新增 `system-proxy.ts` 封装 Windows/macOS 系统代理探测；每次变更后自动回调刷新托盘状态。
  - 做完你能看到什么：渲染进程通过 `window.outcomego.localServer` 和 `window.outcomego.backgroundPreferences` 可直接调用容器列表、单容器重启、日志、自启、资源、代理、系统代理探测和打开日志目录，且全部带参数校验、脱敏与互斥锁保护。
  - 先依赖什么：1.6、2.1
  - 开始前先看：
    - `requirements.md` 需求 2–5、需求 7
    - `design.md` §2.2「模块职责」
    - `design.md` §3.2「数据结构」
    - `design.md` §3.3.2「桌面端 IPC 桥扩展」
  - 主要改哪里：
    - `apps/desktop/src/renderer/lib/local-deploy-contract.ts`
    - `apps/desktop/src/main/local-deploy.ts`
    - `apps/desktop/src/main/background-preferences.ts`
    - `apps/desktop/src/main/system-proxy.ts`（新增）
    - `apps/desktop/src/main/index.ts`
    - `apps/desktop/src/preload/index.ts`
    - `apps/desktop/src/renderer/global.d.ts`（或窗口桥类型定义文件）
    - `apps/desktop/test/local-deploy.test.ts`（更新）
    - `apps/desktop/test/system-proxy.test.ts`（新增）
  - 这一步先不做什么：先不写全部设置页 React 界面（2.3 与阶段 3 实现）。
  - 怎么算完成：
    1. 所有新增 IPC 均校验窗口来源、本地连接归属与参数白名单
    2. 代理密码仅经 stdin 传入 CLI，不出现在主进程日志或异常消息中
    3. `--autostart-hidden` 启动参数在主进程生效：仅初始化托盘和后台服务而不主动显示主窗口
    4. `system-proxy.ts` 正确解析 `PROXY`/`SOCKS5`/`DIRECT` 并带单元测试
  - 怎么验证：
    - 运行 `apps/desktop` 相关单元测试与 TypeScript 类型检查通过
  - 对应需求：`requirements.md` 需求 3 / 验收 3.6、需求 5 / 验收 5.1、需求 7 / 验收 7.1、7.3
  - 对应设计：`design.md` §2.2、§3.2、§3.3.2、§6.3

- [ ] 2.3 新增 `local-services` 深链接锚点并实现「本地服务管理」概览与容器运维 UI
  - 状态：TODO
  - 这一步到底做什么：在 `packages/contracts/src/app-deep-links.ts` 和桌面端 `app-deep-links.ts` 注册 `"local-services"` 锚点（映射到 `server` 设置页）；升级 `server-location.tsx` 并拆分 `settings/local-service/` 子模块，实现本地安装概览（引擎类型、版本、目录、端口、整体启停/重启/移除/打开日志目录）、容器列表（核心容器主列表 + 折叠初始化任务 + 实时 CPU/内存分步加载 + 前台可见轮询）、单容器重启按钮和脱敏日志弹窗（行数切换、筛选、复制）。
  - 做完你能看到什么：从托盘点“服务管理…”或进入「设置 → 服务器」，立即看到清晰的本地服务与 5 个核心容器状态，能直接重启单个容器并在线查看复制日志。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、非功能需求 1
    - `design.md` §2.3.1「托盘状态同步与“服务管理…”直达」
    - `design.md` §2.3.2「容器状态、指标查看与单容器重启」
    - `design.md` §3.3.2「深链接锚点扩展」
  - 主要改哪里：
    - `packages/contracts/src/app-deep-links.ts`
    - `apps/desktop/src/renderer/lib/app-deep-links.ts`
    - `apps/desktop/src/renderer/components/outcomego/settings/server-location.tsx`
    - `apps/desktop/src/renderer/components/outcomego/settings/local-service/containers-panel.tsx`（新增）
    - `apps/desktop/src/renderer/components/outcomego/settings/local-service/container-logs-dialog.tsx`（新增）
  - 这一步先不做什么：不在这一步实现自启、性能资源和代理表单（留给阶段 3 独立拆解）。
  - 怎么算完成：
    1. 点击托盘“服务管理…”能唤起主窗并自动打开「设置 → 服务器」且滚动高亮到「本地服务管理」
    2. 引擎已停止时容器区显示友好空态与“启动本地服务”按钮，不报错
    3. 容器列表首次展示不等待 `stats` 阻塞，窗口切后台后自动暂停轮询
    4. 重启 `computer` 时给出联动提示，日志弹窗支持 100/200/500 行切换、筛选与一键复制
  - 怎么验证：
    - 运行深链接单测与桌面端类型检查/构建
    - 手工走查托盘跳转、容器列表、单容器重启与日志弹窗
  - 对应需求：`requirements.md` 需求 1 / 验收 1.3，需求 2 / 验收 2.1–2.6，非功能需求 1 / 1.2、1.3
  - 对应设计：`design.md` §2.3.1、§2.3.2、§3.1、§3.3.2

### 阶段检查

- [ ] 2.4 阶段 2 检查点（托盘 + 容器运维主链路验证）
  - 状态：TODO
  - 这一步到底做什么：核查托盘状态同步、右键菜单跳转、桌面端 IPC 与容器运维面板已完整串联且无状态漂移。
  - 做完你能看到什么：最核心的“托盘管理 + Docker 容器查看/重启/日志”已经是一条完整可用的产品链路。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §2.3.1、§2.3.2、§4.2
  - 主要改哪里：本阶段全部相关文件与 `tasks.md` 状态
  - 这一步先不做什么：不新增范围外功能。
  - 怎么算完成：
    1. 桌面端类型检查、构建与新增单元测试全过
    2. 托盘状态与设置页状态在所有生命周期动作后完全一致
  - 怎么验证：
    - 运行桌面端测试与构建命令
    - 人工走查托盘与容器运维流程
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2.3.1、§2.3.2、§3.3.2、§4.2

---

## 阶段 3：开机自启、性能资源与代理配置界面及双平台联调验收

- [ ] 3.1 实现「本地服务管理」开机自启动设置面板
  - 状态：TODO
  - 这一步到底做什么：在「本地服务管理」中实现独立自启动配置分组，包含“开机自动启动本地服务”（联动 `autostartStatus` / `setAutostart`，外部引擎只读说明）、“登录时启动 OutcomeGo 桌面端”、“启动时最小化到托盘”以及既有的“退出桌面端时停止本地服务”。
  - 做完你能看到什么：用户在一个清晰分组里即可完全掌控服务端和桌面端的启动/退出行为，且设置页开关与托盘右键“开机自动启动本地服务”实时保持同步。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §3.2.2「`LocalAutostartStatus`」
    - `design.md` §4.2「自启偏好与手动启停的解耦规则」
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/settings/local-service/autostart-section.tsx`（新增）
    - `apps/desktop/src/renderer/components/outcomego/settings/server-location.tsx`
  - 这一步先不做什么：不做性能资源和代理表单。
  - 怎么算完成：
    1. 托管引擎可正常开关本地服务自启并同步刷新托盘复选框
    2. 外部引擎明确展示只读状态与原因提示
    3. 桌面端登录自启开启时可切换“最小化到托盘”，关闭时子选项禁用
  - 怎么验证：
    - 组件/逻辑单测 + 桌面端交互走查
  - 对应需求：`requirements.md` 需求 3 / 验收 3.1–3.6
  - 对应设计：`design.md` §3.2.2、§4.2

- [ ] 3.2 实现「本地服务管理」性能与资源配置面板
  - 状态：TODO
  - 这一步到底做什么：替换原 `server-location.tsx` 中无回显的裸内存表单，新建 `resources-section.tsx`：展示宿主机硬件信息与当前生效资源；提供“轻量 / 均衡 / 高性能 / 自定义”预设档位；支持配置 `computer` 内存/CPU、`desktop` 内存、`worker` 并发，以及按引擎类型展示 macOS Lima VM 直接编辑或 Windows `.wslconfig` 检测与显式确认修改（含全局影响警示与重启说明）。
  - 做完你能看到什么：用户一眼看清本机配置与当前已分配额度，点预设档位或微调后确认即可生效，不再盲填且有清晰中断提示。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §3.2.3「`LocalResourceSnapshot` & `LocalResourceUpdate`」
    - `design.md` §5「错误处理与回滚策略」
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/settings/local-service/resources-section.tsx`（新增）
    - `apps/desktop/src/renderer/lib/server-location.ts`
    - `apps/desktop/src/renderer/components/outcomego/settings/server-location.tsx`
  - 这一步先不做什么：不做实时折线图历史监控。
  - 怎么算完成：
    1. 打开面板自动回显当前实际配置值，不再空白
    2. 前端即时校验内存下限、`desktop < computer`、CPU 范围、并发范围与 75% 引擎上限提示
    3. 应用前强制用户确认“重启受影响服务并中断运行中任务”；Windows `.wslconfig` 变更给出全局影响与需重启 WSL 提示
  - 怎么验证：
    - 补充 `server-location.ts` 校验与档位计算单元测试
    - 桌面端界面走查（覆盖托管 WSL / Lima / 外部引擎三种视图）
  - 对应需求：`requirements.md` 需求 4 / 验收 4.1–4.6
  - 对应设计：`design.md` §3.2.3、§5

- [ ] 3.3 实现「本地服务管理」代理服务器配置与一键测通面板
  - 状态：TODO
  - 这一步到底做什么：新建 `proxy-section.tsx`：支持切换“直连 / 跟随系统代理 / 手动代理（HTTP·HTTPS·SOCKS5、主机、端口、可选认证、NO_PROXY）”；“跟随系统代理”实时展示探测到的系统代理摘要；勾选作用范围（容器出网、托管引擎镜像拉取）；提供“测试代理连接”展示分项连通结果与耗时；检测到本机回环地址时提示允许局域网/WSL 连接及映射说明；保存已加密/掩码密码时支持“保持原密码 / 修改 / 清除”。
  - 做完你能看到什么：用户在界面填好本地或企业代理，先点“测试代理连接”确认各目标可达，再点“保存并应用”即可让模型、搜索和镜像拉取全部生效。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 5、需求 7
    - `design.md` §2.3.3「本地服务代理应用与宿主机回环映射」
    - `design.md` §3.2.4「`LocalProxyConfig` & `LocalProxyTestResult`」
    - `design.md` §8.1「风险」
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/settings/local-service/proxy-section.tsx`（新增）
    - `apps/desktop/src/renderer/components/outcomego/settings/server-location.tsx`
  - 这一步先不做什么：不干涉“云电脑浏览器出口（`browser-network`）”配置逻辑。
  - 怎么算完成：
    1. 三种模式切换、表单校验、密码掩码保留与清除行为清晰无误
    2. 一键测试不覆盖当前已保存配置，清晰展示每项检测状态、耗时和失败指引（含本机代理 Allow LAN 提示）
    3. 外部引擎下“应用于托管引擎镜像拉取”置灰并说明需在外部引擎中配置
  - 怎么验证：
    - 桌面端单测与构建通过
    - 手工走查直连、系统代理、手动代理与测通交互
  - 对应需求：`requirements.md` 需求 5 / 验收 5.1–5.7，需求 7 / 验收 7.2
  - 对应设计：`design.md` §2.3.3、§3.2.4、§8.1

- [ ] 3.4 补齐中英文文案、全量回归测试与 Windows/macOS 实机验收
  - 状态：TODO
  - 这一步到底做什么：补齐所有新增托盘菜单、设置页、弹窗和错误码的 `zh-CN` / `en-US` 翻译；运行受影响包（`packages/contracts`、`apps/cli`、`apps/desktop`）的全量测试与构建；整理验收清单并在 Windows 11（`managed-wsl`）与 macOS 环境完成实机联调验证，把结果记入 `docs/`。
  - 做完你能看到什么：中英文界面无缺漏原文，自动化测试全绿，并且有 Windows/macOS 实机验证记录作为交付证据。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：
    - `requirements.md` 需求 7、非功能需求、成功定义
    - `design.md` §7「测试策略」
  - 主要改哪里：
    - `apps/desktop/src/renderer/lib/local-service-catalog.ts`
    - `apps/desktop/src/renderer/lib/i18n/`（中英文词条文件）
    - `apps/cli/src/localization.ts`
    - `specs/012.1-本地服务托盘管理与引擎配置/docs/acceptance-checklist.md`（新增）
    - `specs/012.1-本地服务托盘管理与引擎配置/docs/acceptance-result.md`（新增）
  - 这一步先不做什么：不在此任务中执行正式版本发布（发版按 `outcomego-release` 流程另行执行）。
  - 怎么算完成：
    1. `zh-CN` 与 `en-US` 下全部新增界面与托盘文案核对无缺失
    2. `packages/contracts`、`apps/cli`、`apps/desktop` 单元测试和构建全通过
    3. Windows 11 实机验收覆盖托盘状态同步、容器重启/日志、计划任务自启、资源调整与本机代理测通（模型 + 搜索 + 镜像拉取）
  - 怎么验证：
    - 运行各包测试与打包命令
    - 逐项勾选 `docs/acceptance-checklist.md` 并沉淀实机证据到 `docs/acceptance-result.md`
  - 对应需求：`requirements.md` 全部需求与成功定义
  - 对应设计：`design.md` §7.1–§7.4

### 最终检查

- [ ] 3.5 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认 Spec 012.1 全部需求、设计、任务状态与验证证据能逐项闭环，没有遗留悬空项或未回写状态。
  - 做完你能看到什么：所有已完成任务勾选 `[x]` 并标注 `DONE`，文档、代码、测试与实机验收结论一一对应，后续接手人或发版流程可直接引用。
  - 先依赖什么：3.4
  - 开始前先看：
    - `README.md`
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文档状态更新
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. `requirements.md`、`design.md`、`tasks.md` 状态与追踪完全对齐
    2. 风险、平台限制与未尽事项已明确记录
    3. 全部关键验收项具备可复查的测试或实机证据
  - 怎么验证：
    - 按 `design.md` §7.4 验证映射逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
