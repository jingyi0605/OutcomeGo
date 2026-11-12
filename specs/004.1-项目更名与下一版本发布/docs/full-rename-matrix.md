# 全量重命名映射表

状态：IN_PROGRESS

本表是全量迁移的唯一命名映射。目标是让新安装、数据库、代码、平台身份、协议和发布资产都使用 OutcomeGo 名称；新数据库直接使用单一最新 schema，手动备份导入由外部运行手册负责。

| 层级 | 旧模式 | 新模式 | 代表范围 | 迁移方式 | 验证 |
|---|---|---|---|---|---|
| 产品文本 | `outcomeGo`、`OpenTeam`（产品显示语境） | `OutcomeGo` | UI、服务端错误、文档、插件帮助 | 代码/文档修改 | 用户文本扫描 |
| TypeScript symbols | `OutcomeGo*`、`outcomeGo*` | `OutcomeGo*`、`outcomeGo*` | client、contracts、messaging、server、desktop、computer | AST/受控文本替换后 typecheck | 全 workspace typecheck |
| Bun packages | `outcomego`、`@outcomego/*` | `outcomego`、`@outcomego/*` | package.json、imports、bun.lock、scripts | package graph 更新 | frozen install/build |
| CLI | `outcomego`、`.outcomego`、`OUTCOMEGO_*` | `outcomego`、`.outcomego`、`OUTCOMEGO_*` | binary、config、installer、update state | 新安装身份 | CLI build/test |
| Runtime | `outcomego_*`、`aiteamos_events`、`/usr/lib/outcomego` | `outcomego_*`、`aiteamos_events`、`/usr/lib/outcomego` | Compose、Postgres、computer image | 新 Compose/镜像；LISTEN 通道保留 | render + fresh-schema integration test |
| Database | 旧产品前缀和旧物理命名 | `outcomego_*` 物理表、enum、索引、约束；LISTEN `aiteamos_events` 按运行接口保留；新实例直接使用单一 `outcomego-v1` schema | schema、SQL、database/user、indexes | 只初始化空库；用当前 Prisma/raw SQL SHA-256 标记 schema，拒绝不匹配版本的非空库，不执行原地升级 | Prisma generate、fresh-schema integration、validator checks |
| Historical Prisma migrations | 历史 schema 增量 SQL | 不由当前部署入口执行；旧 provider 字段回填迁移已删除 | `packages/db/prisma/migrations/**` | 部署入口仅对空库运行当前 `db push` + raw schema，不执行 `prisma migrate deploy` | migration path search and fresh-schema CI |
| Desktop | `dev.outcomego.desktop`、`outcomego`、`outcomeGo-*` | `dev.outcomego.desktop`、`outcomego`、保留 `aiTeamOS-*` artifact 与 `userData=aiTeamOS` | appId、executable、artifact、userData | 新应用身份；两个固定路径/发布身份按清单保留 | package/static checks |
| Android | `com.outcomego.android`、`com.outcomego.android`、`outcomego://` | `com.outcomego.android`、`com.outcomego.android`、`outcomego://` | applicationId、namespace、actions、links | 新 APK 并行安装 | debug APK inspection |
| iOS | `dev.outcomego.mobile`、extensions、`outcomego` | `dev.outcomego.mobile`、extensions、`outcomego` | Bundle IDs、APNs、scheme、targets | 新 Xcode identity | generation/native config |
| Release | `outcomego`、`outcomego-compose.yaml`、旧签名 identity | `outcomego`、`outcomego-compose.yaml`、新 identity | GHCR、assets、workflow assertions | 新发布链路 | YAML/dry-run/signature |

`packages/db/prisma/schema.prisma` 使用 Prisma `@@map` 和命名约束/索引将产品身份映射到 `outcomego_*` 物理标识。当前 schema 中没有产品前缀的领域字段继续使用 `createdAt`、`botId` 等语义名称；应用层仍使用 `prisma.bot`、`prisma.channelMessage` 等领域 API，避免把物理名称泄漏到业务代码。raw SQL、搜索触发器、索引和约束使用新物理表名。`scripts/migration/validate-outcomego-backup.ts` 只校验最新 schema 备份，不转换旧表名或旧字段。

## 禁止保留为运行时身份的模式

除迁移文档、历史说明、明确 upstream fixture 和 name-inventory.md 指定的固定标识外，旧产品模式不得出现在新运行代码中。当前代码使用 `OutcomeGo`、`outcomego`、`OUTCOMEGO_*`、`com.outcomego`、`dev.outcomego`、`outcomego://`；仅 `userData=aiTeamOS`、Desktop artifact `aiTeamOS-*`、GHCR `ai-teamos` 和 Postgres channel `aiteamos_events` 按固定决策保留。
