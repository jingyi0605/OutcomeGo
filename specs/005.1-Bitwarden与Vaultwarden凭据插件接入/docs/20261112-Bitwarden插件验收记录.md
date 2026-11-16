# Bitwarden 插件验收记录

日期：2026-11-13。实现分支：`feat/005.1-bitwarden-vaultwarden`。工作树：`openteam-bitwarden`。

已完成：

- `bun run --cwd packages/plugins generate`：16 个插件生成并校验。
- `bun test packages/plugins/test packages/plugin-sdk/test packages/messaging/test/plugin-skill-catalog.test.ts apps/worker/test/plugins.test.ts apps/computer/test/process-secrets.test.ts apps/server/test/plugin/bitwarden-environment.test.ts`：101 tests passed。
- Bitwarden fake CLI 覆盖 package、四平台安装器、URL/参数、登录/解锁/同步、精确匹配、多匹配、username/password/TOTP、错误分类、并发目录和取消清理。
- server unit fixture 覆盖 master password 空白保留、字段级 URL 校验、1Password token trim、runtime environment 冲突。
- `bun run --cwd packages/plugin-sdk typecheck`、`bun run --cwd packages/plugins typecheck`、`bun run --cwd apps/server typecheck`：通过。

待执行：

- Disposable PostgreSQL integration test：当前未设置 `OUTCOMEGO_TEST_DATABASE_URL`，状态 SKIPPED。
- 官方 CLI release asset 实际下载：本机 TLS 建连失败，状态 PENDING。
- 真实 Vaultwarden、远程 computer 网络、浏览器测试站点：没有授权启动服务或重建远程 computer，状态 PENDING。

## 2026-11-16 多实例演进验收补充

已完成：

- `bun run --cwd packages/plugins generate`：25 个插件生成并校验（`bitwarden` 升级至 `1.1.0`，声明 `outcomego://bitwarden` 与 5 个实例 `setup.fields`）。
- 全受影响工作区 typecheck 通过：`packages/db`、`packages/plugin-sdk`、`packages/contracts`、`packages/plugins`、`apps/server`、`apps/computer`、`apps/desktop`（含 `check-renderer-boundary.ts`）。
- `bun test packages/plugins/test/bitwarden.test.ts packages/plugins/test/bitwarden-installer.test.ts packages/plugins/test/catalog.test.ts packages/plugins/test/onepassword-lookup.test.ts packages/contracts/test/plugin-namespaces.test.ts packages/messaging/test/plugin-skill-catalog.test.ts apps/worker/test/plugins.test.ts apps/server/test/plugin/bitwarden-environment.test.ts apps/server/test/plugin/bitwarden-multi-instance.test.ts apps/server/test/plugin/bitwarden-read-gate.test.ts apps/server/test/plugin/catalog.test.ts apps/computer/test/runtime/bitwarden-credential.test.ts apps/computer/test/runtime/bitwarden-secrets.test.ts apps/desktop/test/plugin-bitwarden-ui.test.tsx`：54 tests passed across 14 files（655 assertions）。
- 新增与回归覆盖：
  - `packages/contracts/test/plugin-namespaces.test.ts` 验证 `bitwarden` / `outcomego://bitwarden` 不进入 MCP 动态命名空间与连接器指令。
  - `apps/server/test/plugin/bitwarden-multi-instance.test.ts` 验证邮箱别名（含 `@`）与重复邮箱去重、明文屏蔽与部分字段替换、`bw.sh status` 通过后才进入 `ready` 并默认以邮箱命名，以及旧 `plugin:bitwarden` 自动迁移至第一个实例。
  - `apps/server/test/plugin/bitwarden-read-gate.test.ts` 与 `apps/computer/test/runtime/bitwarden-credential.test.ts` 验证跨已连接实例搜索、审批卡片实例名称展示及读取严格绑定获批 `connectionId`。
  - `apps/desktop/test/plugin-bitwarden-ui.test.tsx` 验证多实例列表、中文「已连接。」与「1 个技能」（修复「1 个事件」问题）渲染。

记录中不写入真实 API Key、主密码、session key、密码或 TOTP。
