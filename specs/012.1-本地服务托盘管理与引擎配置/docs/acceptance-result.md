# Spec 012.1 自动化验证与实机验收记录

更新时间：2026-11-26  
代码分支：`OutcomeGo`

## 一、自动化测试与构建验证结果（已全部通过）

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| `computer` 容器网络放通代理端口单测 | `python3 scripts/imessage-bridge-linux/test_network.py` | **21/21 PASS**（覆盖 `OUTCOMEGO_HOST_PROXY_TARGET` IPv4/IPv6/`host.docker.internal`/`host.lima.internal` 解析、非法值忽略、`@host_bridge_v4` 与 `ip rule` 生成） |
| `deploy/compose.yaml` 向后兼容与覆盖解析 | `docker compose --env-file ... -f deploy/compose.yaml config`（旧 `.env` & 含代理变量 + `compose.local.yaml`） | **PASS**（两组配置均正常解析，透传 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`/`OUTCOMEGO_HOST_PROXY_TARGET`、`extra_hosts` 与 `cpus`） |
| CLI 类型检查与全量单测 | `cd apps/cli && bun run typecheck && bun test --timeout 15000` | **921/921 PASS**（69 个测试文件；含新增 `local-ops.test.ts`、`autostart.test.ts`、`resources.test.ts`、`proxy-config.test.ts` 及 `docker.test.ts` 扩展） |
| CLI 产物构建 | `cd apps/cli && bun run build` | **PASS**（Bundled 414 modules -> `dist/outcomego.js`） |
| 桌面端类型检查与渲染层边界检查 | `cd apps/desktop && bun run typecheck` | **PASS**（0 错误） |
| 桌面端核心单测（隔离模式） | `cd apps/desktop && bun test --isolate test/app-deep-links.test.ts test/server-location.test.ts test/i18n-catalog.test.ts test/settings-navigation.test.ts test/tray.test.ts test/tray-menu.test.ts test/background-preferences.test.ts test/system-proxy.test.ts test/local-deploy.test.ts test/local-deploy-ipc.test.ts test/local-deploy-preload.test.ts test/local-deploy-ui.test.tsx` | **133/133 PASS**（12 个测试文件） |
| 桌面端主进程 / 预加载 / 内置 CLI / Vite 构建 | `cd apps/desktop && bun run build:main && bun run build:preload && bun run build:server-updater && bunx vite build` | **PASS**（全部产物构建成功） |

> 注：`packages/contracts` 全量测试中存在 2 条与本 Spec 无关的既有失败（`test/contracts.test.ts` 中 `UpdateRoutine` 工具描述文案断言），本 Spec 仅修改 `packages/contracts/src/app-deep-links.ts` 且相关路由单测（`apps/desktop/test/app-deep-links.test.ts`）全部通过。

## 二、Windows 11 / macOS 实机验收状态（待实机执行回填）

当前开发机环境尚未执行带桌面 GUI 会话的 Windows 11（`managed-wsl`）与 macOS（`managed-lima` / `external`）实机联调，请按 [`acceptance-checklist.md`](./acceptance-checklist.md) 在实机逐项勾选并补充下方证据：

| 平台与引擎 | 状态 | 重点验证项 | 备注 |
| --- | --- | --- | --- |
| Windows 11 x64 (`managed-wsl`) | 待实机验证 | T-1.1~1.6 托盘状态同步与菜单、T-2.4 `computer` 协同重启、T-3.1/3.3/3.5 计划任务与静默登录自启、T-4.4 `.wslconfig` 备份写入、T-5.2~5.5 本机 Clash/v2rayN 回环代理测通与镜像拉取 | 需实机开启本机代理 Allow LAN 验证 WSL2 网关连通 |
| macOS (`managed-lima` / `external`) | 待实机验证 | T-1.1~1.6 托盘菜单与深链接直达、T-3.2 LaunchAgent 注册/卸载、T-4.3 Lima VM 内存/CPU 编辑与回滚、T-5.1~5.5 系统代理探测与手动代理应用 | 需验证 `~/Library/LaunchAgents/com.outcomego.managed-engine.plist` 生效 |
