# 004.1 名称命中分类清单

- 盘点日期：2026 年 11 月 12 日
- 范围：当前工作树的源代码、配置、CI、文档、规格和平台资源；排除 `.git`、依赖缓存及构建输出。名称分组按用途归类，不执行全局替换。
- 范围决定：负责人明确要求彻底改用 OutcomeGo 内部名称，并使用单一最新数据库 schema；不要求旧安装覆盖升级或旧数据库字段自动转换。此决定取代早期“保留大部分内部身份以兼容升级”的设计文字。
- 明确授权的身份覆盖（2026 年 11 月 12 日）：负责人批准新 Desktop/Android/iOS app identities、`outcomego://` scheme、`outcomego-*` Compose/CLI assets、Desktop `publish.repo=OutcomeGo`、root package `outcomego`、CLI `PROJECT_NAME=outcomego` 和 `DEFAULT_REPOSITORY=jingyi0605/OutcomeGo`。同时固定保留 GHCR `ai-teamos`、Desktop `userData=aiTeamOS`、Desktop artifact prefix `aiTeamOS-*`、Postgres channel `aiteamos_events`、`.github/workflows/release.yml` 及其他表列稳定身份；fork 默认分支现按负责人决定命名为 `OutcomeGo`，上游同步仍使用 `main`。

## 命中组和最终分类

| 命中组 | 分类 | 处理结论与证据 |
|---|---|---|
| 用户可见产品名 `aiTeamOS`、`outcomeGo`、旧大小写品牌 | `rename`；历史文档为 `alias` | README、FORK、应用显示文案、安装器说明和 iOS Release 显示名使用 OutcomeGo。旧名只可用于迁移说明、历史 release 和本清单。公开首段统一说明 OutcomeGo (formerly aiTeamOS)，是 OpenTeam 的独立 fork 且不获上游背书。 |
| `aiteamos`、`@aiteamos/*`、root package、CLI binary、内部符号和目录 | `rename`；CLI command 为 `alias` | 新代码、workspace 与规范安装身份使用 `outcomego` / `@outcomego/*`；`aiteamos` 仅以同一 binary 提供命令名别名。代码和全 workspace 验证见 `full-rename-verification.md`。 |
| `AITEAMOS_*`、旧配置键、旧安装目录、旧 Compose 项目/卷/数据库用户 | `rename`；旧实例为 `separate-migration` | 新实例使用 `OUTCOMEGO_*`、`outcomego` Compose/volume/database。旧实例数据不自动读取或转换；用户在外部手动备份并导入符合最新 schema 的新实例。 |
| 旧数据库表/字段/enum/index/constraint 命名 | `rename` | 当前 Prisma 和 raw schema 是单一最新 `outcomego-v1`。校验器只接受最新格式、检查 manifest/hash/行数/关系，不把旧字段或表名转换到新 schema。 |
| `com.teambots.android`、`com.aiteamos.android`、`dev.aiteamos.*`、旧 iOS targets | `rename` | 新包使用 `com.outcomego.android`、新 iOS/桌面身份。无旧应用覆盖升级要求；Android/iOS 签名、设备分发和商店登记分开记录，不能从显示名推断签名已就绪。 |
| URL schemes 和协议命中 `aiteamos://`、`outcomego://` | `rename` | 负责人明确授权新 scheme `outcomego://`。旧 `aiteamos://` 链接不会由新 app 自动解析；外部书签/链接需要用户更新。应用代码使用新 scheme。 |
| `DEFAULT_REPOSITORY`、CLI `PROJECT_NAME` 和 root package name | `rename`（负责人覆盖） | 按负责人后续明确授权改为 `jingyi0605/OutcomeGo`、`outcomego` 和 `outcomego`；`DEFAULT_IMAGE_PREFIX` 仍保留 GHCR 稳定路径。 |
| Compose asset `aiteamos-compose.yaml` 与 CLI raw assets `aiteamos-<os>-<arch>` | `rename`（负责人覆盖） | 负责人明确授权 OutcomeGo beta.14 使用 `outcomego-compose.yaml` 与 `outcomego-<os>-<arch>`；安装器、签名、下载和 checksum 消费方已同步。beta.13 资产保持历史原名。 |
| Desktop electron-builder `publish.repo` | `rename`（负责人覆盖） | 负责人明确授权新 Release source `OutcomeGo`；不改 `.github/workflows/release.yml` 文件名和其 OIDC identity 路径。 |
| PostgreSQL LISTEN 通道 `aiteamos_events` | `preserve` | server listener 与数据库通知触发器继续共用此固定运行接口；产品表、索引和约束仍使用 OutcomeGo 名称。 |
| `ghcr.io/jingyi0605/ai-teamos-*`、Release workflow 中 GHCR prefix | `preserve` | 固定保留 GHCR package paths；仓库 slug rename 不会迁移镜像，重命名会造成现有镜像不可定位。CLI `DEFAULT_IMAGE_PREFIX` 及 workflow assertion 保持该值。 |
| `OUTCOMEGO_*` 环境变量和 `aiteamos_events` | `preserve` | 环境变量使用新品牌；LISTEN 通道按固定决定保留为 Postgres 通信接口。不得再机械更名。 |
| `outcomego://` | `preserve` | 它是负责人批准并实现的当前新 scheme，Android、iOS、Desktop 和共享客户端依赖。 |
| iOS `APP_DISPLAY_NAME` 的旧 `OpenTeam` 产品显示值 | `rename` | `apps/ios/scripts/generate-project.py` 生成 Release `OutcomeGo`、Debug `OutcomeGo Dev`；bundle/APNs/extension 设置属于平台身份，签名构建另验。 |
| Desktop `userData=aiTeamOS` 与 `aiTeamOS-<version>-<os>-<arch>` 文件名前缀 | `preserve` | userData 路径按明确决策固定，以避免显示名影响数据目录；artifact prefix 没有 beta.13 updater fixture 证明可改名，故保持。两者均不改变应用窗口、About、菜单或权限文本中的 OutcomeGo 名称。 |
| beta.13 已发布 `aiTeamOS-*`、`aiteamos-*` 和 `aiteamos-compose.yaml` 资产及其签名 | `alias` / `preserve` | 这是不可修改的历史公开 Release；保留以便审计旧版本。旧本地 P-256 key 不得验证 `jingyi0605/OutcomeGo`。 |
| `.github/workflows/release.yml` 文件名 | `preserve` | Sigstore identity 包含该工作流路径；改名会改变信任身份，须单独迁移。 |
| `packages/db/prisma/migrations/**` | `preserve` / 非运行时历史 DDL | 当前部署只运行 Prisma `db push` 和 raw schema。旧 provider 字段回填迁移已删除；其余历史增量 DDL 不由新实例部署入口 replay，也不构成原地升级支持。 |
| `ai-TeamOS` → `OutcomeGo` fork 默认分支 | `rename` | 负责人明确要求将 fork 主分支重命名为 `OutcomeGo`；上游 `main` 保持独立，不做全局替换。 |
| GitHub slug `jingyi0605/ai-TeamOS` → `jingyi0605/OutcomeGo` | `separate-migration` | Settings rename 已执行。旧网页地址 redirect、新页面、分支/ruleset 和 Release API 已复核；旧 Release 正文仍含旧 slug，本地 workflow/源码尚未推送，runner 尚未验证。 |
| `com.outcomego.android` / `namespace=com.outcomego.android`、`dev.outcomego.*` | `rename` | 这是新全量 OutcomeGo 平台身份；旧 application ID/bundle ID 不再要求覆盖升级。签名证书或 profile 仍需按候选构建证据验收。 |
| `openteam`、OpenTeam 名称、`com.openteam.*`、上游路径和协议 | `preserve` | 上游来源、插件/协议身份和归属文本必须保留；只有明确的产品展示字符串才可改为 OutcomeGo。禁止全局搜索替换。 |
| 签名密钥、证书、密钥标签、历史 payload 和 provider authority | `preserve` 或 `separate-migration` | 不因品牌名推导出应轮换密钥。新平台签名单独构建；Android updater manifest 私钥已随新 package ID 轮换，内嵌公钥与私钥成对并有签名验证；Windows Authenticode PFX 缺失不阻塞发布，沿用 beta.13 的未签名安装包。 |

## 固定覆盖清单

| 必须逐项检查的模式 | 最终分类 | 核验位置/理由 |
|---|---|---|
| `ghcr.io/.../ai-teamos` | `preserve` | `apps/cli/src/constants.ts`、`.github/workflows/release.yml`、Compose；保持既有 GHCR package 路径。 |
| `AITEAMOS_*` | `rename` | 新实例源码和 CI 使用 `OUTCOMEGO_*`；不自动转换旧环境配置。 |
| `aiteamos_events` | `preserve` | `apps/server/src/event-wakeup.ts` 与 raw schema publisher 共用此固定 LISTEN 通道。 |
| `aiteamos://` | `rename` | 负责人授权新 `outcomego://` scheme；新客户端不承诺解析旧 scheme，旧外部链接需要更新。 |
| iOS `APP_DISPLAY_NAME` | `rename` | Release `OutcomeGo`，Debug `OutcomeGo Dev`。 |
| `@aiteamos/*`、root package `aiteamos` | `rename` | 已按负责人批准的全量内部更名方案改为 `@outcomego/*` 和根包 `outcomego`。 |
| Desktop `userData=aiTeamOS` | `preserve` | 固定目录位置由 `pinOutcomeGoUserDataPath` 在启动早期设置，并由 `user-data-path.test.ts` 验证。 |
| Desktop `aiTeamOS-*` artifact | `preserve` | 没有 beta.13 updater 新前缀解析证据；`productName` 仍是 OutcomeGo。 |
| beta.13 发布资产 `aiTeamOS-*`、`aiteamos-*` | `alias` | 已发布资产和签名不可改写，保留为历史下载/审计输入。 |

## 审计命令

```sh
rg -n -i 'aiTeamOS|aiteamos|OUTCOMEGO_|aiteamos_events|outcomego_events|outcomego://|ai-teamos|openteam|com\.teambots|com\.outcomego|dev\.outcomego|APP_DISPLAY_NAME' \
  README.md README.en.md FORK.md .github apps packages deploy docker scripts docs specs
```

范围内的每个命中必须按上表分组；未分类的用户可见旧名称属于遗漏，应修正后再复核。规格历史段落若与负责人最终范围冲突，应更新规格并在任务证据中注明。
