# 全量重命名本地验证记录

日期：2026 年 11 月 12 日

## 通过项

| 命令或检查 | 结果 |
|---|---|
| `bun scripts/release/version.ts check` | 通过，所有 workspace 和 iOS 基础版本为 `0.1.0-beta.14`。|
| `bun install --frozen-lockfile --ignore-scripts` | 通过，1681 installs / 1844 packages。|
| workspace typecheck | `@outcomego/cli`、`desktop`、`computer`、`contracts`、`client-core`、`db`、`messaging`、`server`、`worker`、`plugin-sdk` 全部通过。|
| `bun --filter @outcomego/db db:generate` | Prisma Client 生成通过；物理模型、enum、索引和约束使用 `outcomego_*` 映射，领域字段保持语义名称。|
| latest database event identity | `apps/server/src/event-wakeup.ts` listens on preserved `aiteamos_events`; `packages/db/prisma/sql/raw-schema.sql` notifies the same channel.|
| latest-schema backup validator tests | 5 pass，覆盖当前物理表名、旧格式拒绝、SHA-256、行数和关系错误拒绝；不执行旧字段转换。|
| `bun --filter @outcomego/desktop test` | 544 pass、1 skip、0 fail。|
| `bun --filter @outcomego/desktop typecheck` | 通过。|
| `python3 apps/ios/scripts/check-native-config.py` | 通过，version `0.1.0`、build `65`。|
| `bun --filter @outcomego/ios generate` | 通过，生成 `OutcomeGoNative.xcodeproj`。|
| `docker compose config --quiet` | 开发和生产 Compose 均通过；生产检查使用临时环境变量，不启动服务。|
| preserve identifier scan | Runtime hits `aiTeamOS` Desktop userData, `aiTeamOS-*` Desktop asset prefix, GHCR `ai-teamos`, and Postgres channel `aiteamos_events` are documented preserves.|
| fresh database behavior | `deploy-schema.ts` rejects nonempty databases without exact `OutcomeGo schema target: outcomego-v1` schema comment, then applies only current Prisma schema and raw SQL; legacy conversion/deletion steps were removed. Fresh-schema and refusal integration tests are authored; execution awaits disposable PostgreSQL CI.|

## Android 包证据

命令：`bash scripts/android/package-debug.sh`

- APK：`/Users/jackson/Code/openteam/apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`
- SHA-256：`d838022c625c28a90315a6cd697837ae8f696bda216c68d9a1d6d34f1d8ca7c8`
- label：`OutcomeGo`
- package：`com.outcomego.android.debug`
- versionName：`0.1.0-beta.14`
- versionCode：`10014`
- Android namespace：`com.outcomego.android`

## CLI 完整套件

命令：`env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy bun --filter @outcomego/cli test`

结果：756 pass、0 fail，跨 52 个文件。Sigstore/TUF root、captured release bundle 和 CLI self-update identity 测试全部通过。命令清除了代理变量并使用终端默认网络配置。

## 最终名称扫描

命令：`rg -n -i "aiteamos|aiTeamOS|ai-teamos" .`（排除依赖、构建产物和已记录的扫描证据文件）。

结果：147 个命中，全部属于公开历史说明、`aiteamos` 同一 binary 命令别名、`ai-TeamOS` 默认分支、Desktop `userData`/artifact 固定标识、GHCR `ai-teamos` 路径、Postgres `aiteamos_events` 通道、历史 beta.13 资产或 upstream/迁移清单；未发现新的用户可见旧品牌运行字符串。分类依据：`docs/name-inventory.md`。

## 未执行项

未启动 backend/frontend/database 服务，未访问签名密钥，未执行真实设备导入或新安装；GitHub repository rename 已完成，但没有 push、tag 或 Release。新数据库的 PostgreSQL 集成测试尚未在本机运行；CI 变更未推送，远端 runner 结果待验证。对应任务继续保持 `PENDING`。
