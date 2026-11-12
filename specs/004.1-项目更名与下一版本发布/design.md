# 设计文档 - 项目更名与下一版本发布

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. 名称层级

| 层级 | 处理方式 |
|---|---|
| 用户可见品牌 | 下一版本改为 OutcomeGo |
| GitHub 仓库和 Release | GitHub 仓库 slug 和 fork 默认分支均使用 OutcomeGo；上游 `main` 保持不变 |
| CLI 入口 | `outcomego` 为正式入口；安装器可额外安装同一二进制的 `aiteamos` 兼容命令 |
| Bun package scope | 全量改为 `@outcomego/*`，同步 workspace 和 lockfile |
| Android 显示名 | 改为 OutcomeGo |
| Android `applicationId` | 改为 `com.outcomego.android`，旧 APK 通过手动迁移并行存在 |
| iOS Bundle ID | 按全量身份方案使用 `dev.outcomego.mobile`、OutcomeGo APNs topic 和 extensions；签名/商店发布单独验收 |
| 数据库和配置目录 | 改为 OutcomeGo 新名称；新实例直接使用单一最新 schema，用户手动备份后再按运行手册导入 |
| 签名和更新身份 | 新平台身份按 OutcomeGo 构建；不得把 beta.13 历史签名当作新信任根；旧资产仅作为历史输入保留 |

本阶段的范围决策已经由负责人确认：不考虑现有数据的平滑升级，也不实现旧数据库字段、旧表名或旧 schema 的自动转换。用户手动备份后导入新实例；本仓库只校验已经符合最新 schema 的备份制品。此前为保留旧内部身份而编写的兼容结论只适用于已完成的品牌预发布记录，不再约束本次全量内部迁移。

## 2. 新实例验收矩阵

全量重命名测试至少覆盖：

- 全新安装。
- 新空数据库从当前完整 schema 初始化。
- 最新 `outcomego-v1` portable 备份校验和关系校验。
- 错误校验和和中断导入；源备份保持不变。
- Android、iOS、Desktop 和 CLI 的新身份静态检查。
- 新 Compose、数据库 schema、协议和更新清单。
- 删除隔离的新实例后，从同一份源备份重新导入。

## 3. 发布流程

```text
只读盘点
  → 更新用户可见品牌
  → 构建下一版本
  → 全新安装和手动备份导入验证
  → 签名与更新验证
  → 发布迁移说明
  → 发布 OutcomeGo 下一版本
```

## 4. 迁移原则

- 不对 `openteam` 做无差别全局替换。
- OutcomeGo 使用独立的新安装身份；不读取或改写旧安装和旧数据库。
- 新实例只从当前 Prisma/raw schema 初始化；用户手动备份由运行手册导入，源备份只读保留，仓库不转换旧字段。
- 数据库部署入口只对空数据库执行当前 Prisma schema 的 `db push`，随后安装 raw SQL 对象；schema 标记与当前 Prisma/raw schema 指纹一致时视为已初始化。旧版标记或未标记的非空数据库一律拒绝，不执行原地 schema 升级。
- beta.13 是旧身份历史版本；不得把旧仓库签名扩展为 OutcomeGo 信任根。

本 Spec 不保留旧数据库的 Prisma 增量迁移链。部署只用当前完整 `schema.prisma` 和 `raw-schema.sql` 初始化新数据库；schema 指纹不匹配时停止并要求新建数据库，不尝试修补旧表或旧字段。

## 5. 回滚

品牌文案可以通过回滚提交恢复。发布资产、安装器和更新清单必须保留上一版本。涉及仓库地址的变化需要保留迁移说明，不依赖再次更名作为唯一回滚方案。

## 6. 当前代码映射

### 6.1 版本和工作区

| 文件 | 设计动作 | 验证 |
|---|---|---|
| `package.json` | 保持根版本为单一来源，下一版本统一递增 | `bun scripts/release/version.ts check` |
| `apps/*/package.json`、`packages/*/package.json` | 全量使用 `@outcomego/*` scope 和 `outcomego` 根包名 | version check、lockfile、frozen install |
| `bun.lock` | 由版本脚本更新并检查工作区版本 | `git diff -- bun.lock`、version check |
| `scripts/release/version.ts` | 保持版本同步逻辑，增加新产品名所需的可测试常量 | script unit test |
| `apps/cli/src/constants.ts` | `DEFAULT_REPOSITORY=jingyi0605/OutcomeGo` 与新 Sigstore 证书身份同步；`DEFAULT_IMAGE_PREFIX` 继续保留 GHCR 稳定路径 | CLI update/signature test |
| `apps/cli/package.json` | `outcomego` 和 `aiteamos` 都指向 `dist/outcomego.js`；只有 `outcomego` 是规范名称 | package metadata and installer tests |

### 6.2 Desktop

`apps/desktop/package.json` 当前包含 `productName`、`executableName`、`appId`、artifact pattern、图标和权限说明。设计要求：

1. `productName`、权限文本、应用菜单和 About 页面使用 OutcomeGo。
2. 全量内部重命名按阶段 9 使用新的 appId 和 executable。Desktop `userData` 依固定标识保留为 `aiTeamOS`，且在任何读取前设置；桌面 artifact filename prefix 暂保留 `aiTeamOS`，直到 beta.13 updater metadata fixture 证明新前缀可解析。
3. Desktop updater 和 electron-builder publish repo 使用 `OutcomeGo`。旧版本 updater 仍指向旧仓库，不承诺跨仓库自动更新；迁移指南要求从新仓库安装并手动导入备份。
4. `app.setPath("userData", join(app.getPath("appData"), "aiTeamOS"))` 必须在读取 userData 前执行，并由测试固定历史数据目录名。

### 6.3 Android

`apps/android/app/build.gradle.kts` 当前的 `namespace`、`applicationId`、App Link host 和 versionCode 推导必须分别处理：

- `AndroidManifest.xml` 的 `android:label` 改为 OutcomeGo。
- `applicationId=com.outcomego.android` 和 `namespace=com.outcomego.android` 使用新身份；新 APK 与旧 APK 并行存在。
- App Link scheme、host、通知 action 和 update manifest 使用新身份。
- `scripts/android/package-debug.sh` 用于 debug 构建；正式包必须使用现有 release gate 和签名验证。

### 6.4 iOS

`apps/ios/release.json` 与 Xcode 工程中的 bundle identifier、APNs topic、extension identifiers、URL scheme 和应用显示名必须作为一组修改，使用新的 OutcomeGo 身份。签名材料仍只从外部环境读取。

### 6.5 Server/Compose/CI

`docker-compose.yml` 中的服务名、卷名、数据库名、健康检查用户名和 `/usr/lib/outcomego` 是运行标识，全部使用新身份并通过静态 render 检查。数据库物理表和字段由 Prisma 映射为 `outcomego_*`。

1. 对外名称：改为 OutcomeGo。
2. 运行身份：改为 `outcomego`、`OUTCOMEGO_*` 和 `/usr/lib/outcomego`。
3. 旧卷和旧数据库不在新实例中复用；新实例直接从当前完整 Prisma schema 和 raw schema 创建。

`.github/workflows/release.yml`、`.github/workflows/cli-installer.yml`、`.github/RELEASING.md` 可以更新用户可见 Release 标题和 Android APK 显示名；workflow 文件名、固定 upstream `openteam` 标识、签名身份和受保护的发布资源按名称清单处理。仓库路径和外部发布迁移属于独立决策，不能由品牌文案变更隐式触发。

## 7. 下一版本发布流程

```text
R0 只读盘点
  → R1 修改用户可见品牌
  → R2 更新包/CLI/仓库和 Release 引用
  → R3 构建所有候选资产
  → R4 全新安装、手动备份导入、登录和数据回放
  → R5 签名、manifest、更新和回滚验证
  → R6 发布下一版本并保留旧资产
```

每一步必须生成可复核的清单文件，不把 GitHub redirect、构建成功或静态 grep 当作升级成功的替代证据。

## 8. 回滚设计

- 代码回滚：恢复品牌和发布 Workflow 提交。
- Desktop/CLI：保留不可修改的 beta.13 历史资产；新安装使用 OutcomeGo 入口，可提供同一 parser 的 `aiteamos` 命令名别名，但不复用旧数据目录。
- Android：新 application ID 与旧 APK 并存；失败时删除新实例并从源备份重新导入，不覆盖旧安装。
- iOS：新 Bundle ID、Keychain 和 APNs 身份独立；失败时保留旧应用和源备份。
- 数据库：从当前 Prisma/raw schema 创建新数据库；校验器只验证最新 schema 备份，禁止修改用户提供的源备份；失败时保留源备份并由运行手册重新导入。

## 8.1 全量命名约定

| 旧模式 | 新模式 | 适用范围 |
|---|---|---|
| `outcomeGo` / `OutcomeGo` | `OutcomeGo` / `OutcomeGo` | 用户文案、PascalCase 类型和历史品牌替换 |
| `outcomego` | `outcomego` | 文件、目录、命令、包名、运行时服务名和 URL host |
| `@outcomego/*` | `@outcomego/*` | Bun workspace package scope 和 imports |
| `OUTCOMEGO_*` | `OUTCOMEGO_*` | 环境变量、配置键、CI 和 Compose |
| `outcomego` | `outcomego` | GHCR、镜像前缀和发布路径 |
| `com.outcomego` / `com.outcomego` / `dev.outcomego` | `dev.outcomego` / `com.outcomego` | Android、iOS、Desktop 新平台身份 |
| `outcomego://` | `outcomego://` | Desktop、Android、iOS 深链 scheme |

代码标识使用 `OutcomeGo`（PascalCase）、`outcomeGo`（camelCase）或 `outcomego`（lowercase）按语言惯例；数据库的产品身份标识使用 snake_case 的 `outcomego_*` 前缀。没有旧产品前缀的领域字段保留语义名称，避免把数据库领域模型改成不可读的机械前缀。

## 9. 文件影响清单

### 必须审阅或修改的文件

- `package.json`
- `bun.lock`
- `README.md`
- `README.en.md`
- `FORK.md`
- `apps/cli/package.json`
- `apps/cli/src/constants.ts`
- `apps/cli/src/cli-update.ts`
- `apps/desktop/package.json`
- `apps/desktop/src/renderer/components/outcomego/settings/about.tsx`
- `apps/desktop/src/main/update-status.ts`
- `apps/android/app/build.gradle.kts`
- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/main/res/values/strings.xml`
- `apps/ios/release.json`
- `apps/ios/scripts/generate-project.py`
- `docker-compose.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/cli-installer.yml`
- `.github/workflows/release.yml`
- `.github/RELEASING.md`

### 必须保留并记录原因的文件或标识

- `apps/android` 的 `com.outcomego.android` application ID。
- `apps/android` 的 `com.outcomego.android` namespace，除非独立迁移获批。
- `apps/ios` 的 bundle identifier、APNs extension 和 share extension 标识。
- `/usr/lib/outcomego`、Compose 数据卷和数据库连接标识，除非迁移任务提供可回滚方案。
- `.github/workflows/release.yml` 文件名，因为签名校验依赖其身份。

## 10. 验证策略

### 静态检查

- `bun scripts/release/version.ts check`
- 名称分类扫描和未知命中审查。
- YAML、JSON、Manifest、Gradle 和 iOS release 配置检查。
- `python3 apps/ios/scripts/check-native-config.py`

### 构建和包检查

- `bun --filter @outcomego/cli test`
- `bun --filter @outcomego/desktop typecheck`
- `bun --filter @outcomego/desktop test`
- `bash scripts/android/package-debug.sh`
- `bash scripts/android/release-gate.sh check`
- Release 候选资产的 SHA-256、APK manifest、签名和版本校验。

### 新安装和回滚

- Desktop、CLI、Android 和 server 新实例安装。
- 登录、手动备份导入后的历史消息、Bot、Routine、通知、配置和更新链路回放。
- 失败安装、旧入口、旧下载地址和回滚资产检查；不验证旧版原地升级。

### 通过标准

所有静态检查、构建检查和新安装矩阵必须有结果。外部账号或设备不可用时可以记录 `PENDING`，但不能将其标记为通过，也不能发布正式版本。

## 11. 版本值和生成流程

### 11.1 版本单一来源

根 `package.json` 的 `version` 是当前发布脚本的单一来源。下一版本不允许手工分别修改 workspace 包、lockfile、iOS release 配置或 Android version code。版本变更流程为：

```text
bun scripts/release/version.ts set <version>
  → python3 apps/ios/scripts/generate-project.py
  → bun scripts/release/version.ts check
  → 检查 package.json / bun.lock / release.json diff
  → 构建候选资产
```

`set` 之后必须检查：

- 所有 workspace package version。
- `bun.lock` 中 workspace version。
- `apps/ios/release.json` 的基础版本。
- Android 从根版本推导的 versionCode。
- Release tag 是否为 `v<version>`。
- Desktop artifact 中的 version。
- 镜像 tag、Compose 渲染结果和 CLI asset 名称。

### 11.2 Android versionCode

当前 Android versionCode 由 `apps/android/app/build.gradle.kts` 从根版本推导。更名版本不能修改推导算法来“重置”版本号。正式 APK 必须记录：

```text
versionName
versionCode
applicationId
signing certificate digest
manifest package/label
update manifest version/hash/signature
```

### 11.3 iOS 版本

iOS marketing version 使用不带 prerelease suffix 的基础版本，build number 由发布 Workflow 负责。设计上允许 OutcomeGo 显示名和下一版本同步，但不能把 `beta` 文本写进 iOS marketing version。

## 12. 名称命中处理矩阵

| 命中 | 当前用途 | 下一版本处理 | 验证方式 |
|---|---|---|---|
| `outcomeGo` | 用户可见产品名 | 改为 OutcomeGo | UI、README、asset 检查 |
| `outcomego` | CLI、包 scope、服务运行路径 | 全量新安装身份统一使用 | CLI、Compose、update test |
| `@outcomego/*` | workspace package scope | 全量内部重命名使用 | package graph/build |
| `com.outcomego.android` | Kotlin namespace | 全量新安装身份使用 | Gradle compile |
| `com.outcomego.android` | Android application ID | 全量新安装身份使用 | APK manifest |
| `dev.outcomego.desktop` | Desktop app identity | 全量新安装身份使用 | updater/install test |
| `dev.outcomego.mobile` | iOS bundle ID | 全量新安装身份使用 | iOS native config |
| `openteam` | 上游、协议、服务或目录 | 逐项保留或独立迁移 | classified grep |
| `OutcomeGo` | 仓库、Release、fork 默认分支 | GitHub slug 和默认分支使用 `jingyi0605/OutcomeGo` / `OutcomeGo`；上游 `main` 独立保留 | repository/branch rename evidence、CLI/release workflow |
| `ghcr.io/<owner>/ai-teamos-*` | 容器镜像路径（`DEFAULT_IMAGE_PREFIX`、release.yml `image_prefix`） | 保留稳定的 GHCR package path；仓库 slug 重命名不改变该镜像地址 | CLI update、compose render |
| `OUTCOMEGO_*` | 环境变量（约 219 个） | 保留；新增同名 `OUTCOMEGO_*` 别名不在本阶段实现 | `.env.example`、compose、server 启动 |
| `aiteamos_events` | Postgres LISTEN 通道（`apps/server/src/event-wakeup.ts`、raw schema） | `preserve`；它是 publisher/listener 间的运行接口，数据库表和索引仍采用 OutcomeGo 命名 | fresh-schema integration test |
| `outcomego://` | 客户端 URL scheme（Android Manifest、iOS `APP_URL_SCHEME`、`app-deep-links.ts`） | 保留；`004.3` 的 Outcome 深链也使用该 scheme | 三端深链测试 |
| `OpenTeam` | iOS 显示名（`apps/ios/scripts/generate-project.py` 的 `APP_DISPLAY_NAME`） | 改为 OutcomeGo | iOS native config |

## 13. CLI 和更新链路

### 13.1 当前入口

必须审阅：

- `apps/cli/package.json` 的 `bin` 和 build output。
- `apps/cli/src/constants.ts` 的 `DEFAULT_REPOSITORY`、`PROJECT_NAME` 和资产前缀。
- `apps/cli/src/cli-update.ts`、`durable-update.ts`、`update-gate.ts`。
- `apps/cli/test/cli-update.test.ts`、`release-compose.test.ts` 和 fresh-install fixture。
- `.github/workflows/cli-installer.yml` 的 package filter、Compose 文件和仓库路径。

### 13.2 兼容解析

新命令和旧命令必须最终进入同一个参数解析、配置读取和更新服务。不要复制两套 CLI 行为。建议：

```text
outcomego <args>  ─┐
                    ├─ same dist/outcomego.js entry
aiteamos <args>   ─┘
```

两个命令进入同一个参数解析、配置和更新实现。`aiteamos` 只为用户脚本提供命令名过渡，不恢复旧配置目录、旧数据库或旧平台身份。

### 13.3 默认仓库和签名

CLI 当前会根据 `DEFAULT_REPOSITORY` 和 Release 资产验证来源。GitHub 仓库 slug 已由负责人批准并更改为 `jingyi0605/OutcomeGo`，因此该常量使用新仓库地址；`DEFAULT_IMAGE_PREFIX` 继续保留稳定 GHCR 路径。历史本地 P-256 签名只对 `raghavpillai/openteam` 旧资产有效，不得验证 OutcomeGo 资产；新仓库 Release 必须通过 `.github/workflows/release.yml` 的 OIDC/Sigstore 身份验证。下列稳定项不随本地名称修改：

1. CLI `PROJECT_NAME=outcomego`、`DEFAULT_REPOSITORY=jingyi0605/OutcomeGo` 和 `DEFAULT_IMAGE_PREFIX=ghcr.io/jingyi0605/ai-teamos`（负责人后续授权修改前两项，GHCR 路径保持原值）。
2. `.github/workflows/release.yml` 文件名和 Sigstore workflow identity。
3. GHCR `ai-teamos` 镜像路径。
4. 旧版本 verifier 对历史仓库和旧资产的兼容逻辑；该兼容不得扩大到新仓库。

错误仓库/签名、错误 tag、错误 hash、旧 Release 和新 Release 都需要负例。Sigstore/TUF 透明日志测试若网络不可用，记录为 BLOCKED，不得标记为通过。

## 14. Desktop 更新链路

`apps/desktop/package.json` 中的 `appId`、`productName`、`executableName`、artifactName、图标和权限文本不是同一层的标识。必须分别处理：

- `productName`：改为 OutcomeGo。
- `artifactName`：只有 updater fixture 证明旧 v0.1.0-beta.13 metadata 能解析新前缀后才能修改；当前证据记录见 `docs/name-to-asset-matrix.md`。
- `executableName`：使用全量新安装身份 `outcomego`。
- `appId`：使用全量新安装身份 `dev.outcomego.desktop`。
- 用户数据路径：在读取 userData 前固定为 `join(app.getPath("appData"), "aiTeamOS")`，并由测试断言目录不随产品显示名改变；该路径按固定决策保留。
- macOS permissions 文本：改为 OutcomeGo，但保留实际权限语义。
- `dist-electron/outcomego-cli.js`：如果不改内部文件名，必须在迁移清单中说明。

Desktop 测试必须包含：

- 新安装目录。
- 当前版本内部常规更新（如平台支持）。
- 已登录状态。
- 已打开的 server URL。
- update manifest 旧/新资产匹配。
- 更新中断后恢复。
- About/Settings 显示名。

## 15. Android 发布链路

### 15.1 Gradle 和 Manifest

需要对照：

- `apps/android/app/build.gradle.kts` 的 namespace、applicationId、versionCode、App Link host。
- `apps/android/app/src/main/AndroidManifest.xml` 的 label、scheme、host、通知 action、service 和 provider authority。
- `apps/android/app/src/main/res/values/strings.xml` 和 `values-zh-rCN/strings.xml`。
- `scripts/android/package-debug.sh`、`package-release.sh`、`release-gate.sh`。
- `scripts/android/create-update-manifest.py`。

新实例身份采用负责人确认的全量重命名方案：

- `applicationId=com.outcomego.android` 和 `namespace=com.outcomego.android`。
- 新 release keystore 和固定的 update-manifest public key 信任链；Android updater manifest 私钥缺失时，发布必须保持 BLOCKED。
- URL scheme `outcomego://`，它已是当前 OutcomeGo scheme，不再按旧产品名处理。
- 不要求对 `com.teambots.android` 或 `com.aiteamos.android` 覆盖安装；数据通过手动备份导入新实例。

### 15.2 Android 验收证据

正式候选包至少记录：

```text
APK path
SHA-256
versionName/versionCode
applicationId
signing certificate SHA-256
manifest label
assetlinks package
update manifest signature
```

使用仓库要求的 `bash scripts/android/package-debug.sh` 进行 debug 构建。正式发布候选使用现有 release gate，外部签名缺失时记录 `PENDING`，不能伪造通过。

## 16. iOS 发布链路

`apps/ios/release.json`、Xcode 工程、APNs extension、Share extension 和通知服务必须保持一致。设计检查项：

1. Release app bundle identifier。
2. Notification service bundle identifier。
3. Share extension bundle identifier。
4. APNs topic 和部署配置。
5. provisioning profile 名称。
6. `apps/ios/scripts/generate-project.py` 生成结果。
7. 应用显示名和 URL scheme。
8. 旧版本数据和 keychain 读取。

本阶段已批准并实现新的 OutcomeGo bundle identifiers、APNs、extensions 和显示名。iOS 签名构建与商店提交按负责人要求延期；native config 静态检查不能替代证书、profile、推送和商店验证。未来若再次更改这些身份，必须另建迁移 Spec 或子任务并提供对应验证证据。

## 17. Compose、镜像和服务运行标识

`docker-compose.yml` 中的 `outcomego_*` 名称可能同时是：

- Docker service label。
- PostgreSQL database/user。
- Docker volume。
- hostname。
- `/usr/lib/outcomego` 安装路径。
- agent data 和 workspace 路径。

它们不能用同一个全局替换操作处理。迁移表必须为每个命中记录：

```text
name
kind
user-visible?
persisted data?
used by update?
used by upstream?
compatible action
rollback action
```

下一版本品牌发布最低要求是显示名、README、Release 和用户文案正确；OutcomeGo 新实例使用全量新运行身份和最新 schema，旧数据仅通过用户在外部手动备份并导入新实例保留。

## 18. GitHub Workflow 变更

必须逐项审阅：

- `.github/workflows/release.yml` 的 repository assertion、镜像 tag、asset name、Release title 和签名 identity。
- `.github/workflows/cli-installer.yml` 的 package filters、Docker context 和旧测试名称。
- `.github/workflows/ci.yml` 的数据库用户、测试 URL 和 workspace filters。
- `.github/RELEASING.md` 的版本、Tag、包名和迁移说明。

不能修改 `.github/workflows/release.yml` 的文件名而不更新 CLI 对签名身份的信任规则。Workflow 的临时目录、secret 名称和外部签名配置不得写入 Spec 以外的日志或提交。

## 19. 新实例验收矩阵

| 起点 | 目标 | 检查内容 | 失败处理 |
|---|---|---|---|
| Desktop 新安装 | OutcomeGo Desktop | 显示名、userData 固定路径、About、手动备份导入 | 保留源备份；修复后重建隔离的新实例 |
| CLI 新安装 | OutcomeGo CLI | command alias、全新 config、repository、signature | 不读取旧 CLI 配置；修复新入口 |
| Android 新安装 | OutcomeGo APK | 新 app ID、cert、versionCode、manifest、手动导入 | 保留旧 app 与备份；修复后重装新身份 |
| iOS 新安装 | OutcomeGo app 新身份 | bundle ID、签名、APNs、deep link、手动导入 | iOS 发布延期；保留源备份 |
| Server/Compose 新安装 | OutcomeGo server 新实例 | 新 DB/Compose、当前完整 schema、备份校验与手动导入 | 保留源备份；修复后重建新实例 |
| 旧仓库路径 | 重命名后保留为 redirect/历史地址 | clone/fetch/tag/Release/Actions | 任务 6.2 已执行；旧网页 URL 和新 remote 已验证，SSH/Release 资产 redirect 仍待完整复核 |

每个单元必须有：候选资产、操作步骤、预期结果、实际结果、日志位置、回滚方式和复核人。

## 20. 回滚实施

### 代码回滚

恢复品牌和 workflow 变更提交，但保留已发布的迁移文档，避免用户找不到历史关系。

### Desktop/CLI 回滚

保留旧下载资产和旧入口。不要通过删除新配置或清理用户目录回滚。

### Android 回滚

只有相同 application ID、签名和可接受 versionCode 的版本可以覆盖。若新版本已经发布且无法被旧版本覆盖，回滚必须通过兼容发布或服务端关闭新功能解决。

### iOS 回滚

不能假设用户可以安装旧包覆盖新包。回滚必须依赖兼容服务端、旧版本继续可用和新的修复发布。

### Compose/server 回滚

保留旧镜像 digest、旧 Compose asset、旧实例和源备份。新实例采用单一最新 schema；失败时保留源备份并重建隔离的新实例，不将新 schema 回写到旧实例，也不自动转换旧字段。

## 21. 迁移报告格式

```text
版本：<old> → <new>
目标仓库：<old> → <new>
根提交：<commit>
database schema fingerprint：<sha256>
Desktop：<result>
CLI：<result>
Android：<result>
iOS：<result>
Server/Compose：<result>
签名验证：<result>
新安装/备份导入验证：<result>
回滚验证：<result>
未完成外部证据：<list>
发布结论：PASS / PENDING / FAIL
```

## 22. 设计决策和未决事项

负责人已确定以下决策，实施时不得再视为未决：GitHub slug 为 `jingyi0605/OutcomeGo`；新安装使用 `outcomego`、`@outcomego/*` 和新的 Desktop/Android/iOS identities；CLI 可额外提供同一 binary 的 `aiteamos` 命令别名；旧安装不要求覆盖升级，数据由用户手动备份并导入最新 schema；iOS 发布构建暂缓；GHCR `ai-teamos` 路径和 Desktop `aiTeamOS-*` artifact prefix 按名称清单保留。beta.13 历史 Release/asset 保留为旧身份输入。

## 23. 文件到验证命令映射

| 文件 | 主要验证 |
|---|---|
| `package.json`、`bun.lock` | `bun scripts/release/version.ts check` |
| `apps/cli/src/constants.ts` | CLI update/repository/signature tests |
| `apps/desktop/package.json` | Desktop typecheck/package/update tests |
| `apps/android/app/build.gradle.kts` | Android package and manifest checks |
| `apps/android/app/src/main/AndroidManifest.xml` | `release-gate.sh check` |
| `apps/ios/release.json` | `check-native-config.py`、Xcode project generation |
| `.github/workflows/release.yml` | YAML/static asset/signature fixture |
| `docker-compose.yml` | compose render and isolated startup check |
| README/FORK/CHANGELOG | link and name inventory checks |

## 24. Release Workflow job-by-job impact

### `version`/preflight job

职责：检查根版本、Tag、workspace version、iOS release version 和目标仓库。更名后必须同时检查新仓库名和历史仓库兼容配置。

失败条件：

- 根 package version 与 workspace 不一致。
- Tag 不是 `v<version>`。
- `DEFAULT_REPOSITORY` 与目标仓库不一致。
- Release asset 前缀与 workflow 预期不一致。

### `images`/`merge-images`

职责：构建 server、worker、migrate、computer 镜像，并生成 digest。镜像内部运行路径可以保持 `outcomego`，但公开镜像仓库和 Release 文案必须按迁移决定处理。

验证：

- 多架构 manifest 存在。
- 每个 digest 可 anonymous pull 或按当前仓库规则验证。
- Compose 渲染引用正确 digest。
- 旧 Compose asset 仍能解析或有迁移说明。

### `cli-build`/`sign`

职责：构建 `outcomego` 主入口、兼容 `outcomego` 入口、Compose、install scripts 和签名 metadata。

验证：

- `--help` 和 `--version` 显示新品牌。
- 新安装使用 OutcomeGo 配置目录；不自动读取旧配置目录。
- 新旧入口生成同一 request/config 行为。
- 签名 identity 与目标仓库/tag 一致。
- 错误签名、错误仓库、错误 tag 都被拒绝。

### `desktop`/`macos`

职责：构建 Linux、Windows、macOS 候选资产。应用显示名、artifact name、updater metadata 和签名验证必须一致。

验证：

- Windows Authenticode 结果。
- macOS DMG/ZIP 签名和 notarization 状态。
- Linux artifact 可安装。
- `latest*.yml` 资产能同时被旧 updater 和新 updater 解析。

### `android`

职责：构建 APK、更新 manifest 和签名。全量新安装身份使用 OutcomeGo application ID；release keystore 按本地签名证据记录，update manifest 仍必须使用匹配固定公钥的私钥。

验证：

- versionCode 单调递增。
- package ID 与 OutcomeGo 新身份一致；不要求与旧包相同。
- certificate digest 与本地/CI 批准的 OutcomeGo release keystore 一致。
- update manifest signature、公钥、HTTPS URL 和 SHA-256 正确。
- `assetlinks.json` 仍匹配 package ID。

### `ios`

职责：执行 iOS build/TestFlight workflow 和配置审计。应用显示名及 bundle/profile/APNs 使用 OutcomeGo 新身份；发布构建本阶段延期。

验证：

- release JSON 通过检查。
- 工程重新生成后 diff 只包含批准变化。
- app、notification service、share extension IDs 一致。
- build number 不与已有上传冲突。

### `publish`

职责：生成 GitHub Release、SHA256SUMS、Desktop SHA256SUMS 和迁移说明。

发布前必须确认：

- Release title 使用 OutcomeGo。
- 旧版本链接仍可访问或有迁移页面。
- 所有资产名称和下载说明一致。
- 回滚资产已保存。

## 25. CLI 配置和数据兼容矩阵

| 数据/配置 | 旧位置/名称 | 新入口读取 | 是否迁移 | 验证 |
|---|---|---|---|---|
| Server URL | 现有 CLI config | 是 | 否 | config test |
| auth/session | 现有 auth store | 是 | 否 | login/status |
| Compose file | `outcomego-compose.yaml` | `outcomego` 安装读取 | 旧文件只留历史资产 | installer fixture |
| user data | OutcomeGo 新用户目录 | 是 | 手动备份后新实例导入 | path/backup validator |
| DB path | OutcomeGo 新 schema/volume | 是 | 不自动迁移旧 DB | schema validator |
| update cache | OutcomeGo 新安装状态 | 是 | 旧 cache 不自动读取 | update test |
| command name | `aiteamos` | `outcomego` 主入口；`aiteamos` 调用相同 binary | 单一实现 | help/e2e |
| default repo | `jingyi0605/OutcomeGo` | OutcomeGo Release repository | 负责人已批准并更改 | signature identity test |

本阶段不实现旧配置/旧数据目录的自动迁移脚本。用户若要保留业务数据，在仓库外手动备份，再使用新实例的最新 schema 导入；OutcomeGo 校验器只接受 `outcomego-v1`，且不得修改源文件。

## 26. GitHub 仓库重命名步骤

负责人已批准将仓库 slug 改为 `jingyi0605/OutcomeGo`；GitHub Settings rename 已执行。执行和验证顺序记录如下：

1. 完成名称命中清单。
2. 完成 OutcomeGo 下一版本候选构建。
3. 完成旧 clone/fetch/tag/Release/Issue/PR/Fork 检查。
4. 记录当前默认分支、保护规则和 Actions secrets/environment。
5. 更新 `DEFAULT_REPOSITORY`、README badges、submodules、webhooks 和 installer URLs；GHCR package path 按稳定资产规则处理。
6. 管理员通过 GitHub Settings 执行 rename，并验证旧网页地址重定向和新仓库页面。
7. 验证 Actions 外部引用；不假设旧路径会自动重定向。
8. 验证 Release API、下载 manifest、CLI updater 和 Compose asset。
9. 发布迁移公告并保留旧名称搜索入口。

负责人已批准 GitHub fork 默认分支由 `ai-TeamOS` 更名为 `OutcomeGo`，上游同步仍使用独立的 `main`。本次需同步源代码、配置、分支规则和默认分支设置；完成后记录远端 SHA、默认分支及 ruleset，并继续等待 GitHub runner 验证本地 workflow。

## 27. 安装器和服务名称

安装包显示名、可执行文件、OS service name、Compose project name、volume name 和 data directory 必须分开盘点。

| 层级 | 推荐行为 |
|---|---|
| 安装包显示名 | OutcomeGo |
| CLI 命令 | `outcomego` + 同一 binary 的 `aiteamos` 别名 |
| systemd service | 新 OutcomeGo 实例使用 OutcomeGo 名称 |
| Docker Compose project | 新实例使用 OutcomeGo project 和 volume |
| server image | 使用当前批准的 OutcomeGo release tag；GHCR package path 按名称清单保留 |
| user data directory | 新实例使用 OutcomeGo 路径；旧目录不自动迁移 |
| database name/user | 新实例使用 OutcomeGo 名称和最新 schema |
| desktop executable | `outcomego` |

## 28. 安装和来源检查不是新 Feature Gate

本 Spec 的安装检查是发布功能的一部分。它们不应成为运行时通用 Feature Gate：

- 版本检查只保护发布资产一致性。
- application ID 检查只核对新安装包身份。
- 签名检查只保护安装包来源。
- schema 指纹检查只确认数据库由当前 schema 初始化。
- 旧入口检查只保护脚本兼容。

这些检查不能被抽象成所有产品功能必须经过的通用策略系统。

## 29. 具体新安装和备份导入回放

### Desktop 回放

1. 在隔离环境中准备 OutcomeGo 候选版本和符合最新 schema 的手动备份。
2. 安装 OutcomeGo，检查 `userData`、窗口标题和 About。
3. 按外部运行手册将符合最新 schema 的手动备份导入新实例。
4. 检查导入后的历史消息、设置和登录流程。
5. 执行一次基础 Bot 消息和一次 updater check。
6. 中断新实例初始化或导入流程，确认源备份未被修改并可从头重试。

### CLI 回放

1. 在隔离目录使用 OutcomeGo CLI 完成新实例 setup。
2. 保存新实例 server URL、认证状态和自定义配置。
3. 验证 `outcomego` 与 `aiteamos` 别名进入同一 parser/config/update 实现。
4. 分别执行 `--help`、`status` 和 update 来源校验。
5. 检查新配置及 update cache；不要求自动读取旧目录或旧配置。

### Android 回放

1. 安装 OutcomeGo package ID 的 APK 并验证 label、签名证书、通知、App Link 和 update manifest。
3. 按外部运行手册为新实例配置服务端并导入符合最新 schema 的手动备份。
4. 断网后再次打开，确认 OutcomeGo 本地状态可读，源备份仍未修改。

### iOS 回放

1. 在设备分发和签名条件具备后安装 OutcomeGo 新 bundle identity 构建。
3. 验证新身份登录、Push、deep link、share extension 和设置。
4. 按外部运行手册导入新 schema 备份；不读取旧 app 数据或执行 Keychain 迁移。
5. iOS 签名、profile、商店和实体设备检查按当前决定保持 PENDING，直到另行启用。

## 30. 发布证据目录

```text
specs/004.1-项目更名与下一版本发布/docs/
  baseline.md
  name-inventory.md
  upgrade-matrix.md
  release-asset-inventory.md
  cli-compatibility.md
  desktop-upgrade.md
  android-upgrade.md
  ios-upgrade.md
  signing-verification.md
  rollback-record.md
  release-decision.md
```

每份记录必须含版本、commit、环境、命令、结果和失败日志位置。

## 31. 失败处理表

| 失败 | 是否继续 | 处理 |
|---|---:|---|
| 文案漏改 | 否，修复后继续 | 更新名称清单和测试 |
| 内部路径未改 | 是，若兼容且有记录 | 标记 preserve |
| CLI `outcomego` 规范入口失败 | 否 | 修复唯一 parser/config/update 实现；不得用第二套实现绕过 |
| Desktop 更新失败 | 否 | 保留旧 asset，停止发布 |
| Android cert 不一致 | 否 | 禁止覆盖升级和发布 |
| iOS profile 不匹配 | 否 | 保留旧 TestFlight/App Store |
| 旧 URL 未重定向 | 视 D02 | 增加迁移页/暂缓 rename |
| 外部设备不可用 | 可记录 PENDING | 不标记为 PASS |

## 32. 最终设计检查点

在 `3.4` 标记 DONE 前必须确认：

- 实际根版本和目标版本已写入迁移报告。
- 旧名称命中没有未分类项目。
- 用户可见品牌和发布资产一致。
- 新入口、最新 schema 手动备份校验和新身份更新链至少完成一轮验证。
- Android/iOS 新身份及其签名材料状态明确；不要求旧应用标识覆盖升级。
- GitHub rename 是否执行有明确结论。
- 未完成的外部证据没有被写成通过。
- 回滚资产和责任人已记录。

## 33. 上游同步演练

原规划 §18.7 要求 `main` 上游镜像和产品分支不混淆，并至少完成一次上游同步演练：

1. 记录 `main` 与 `raghavpillai/openteam` 的同步状态和产品分支相对 `main` 的差异。
2. 在临时分支上从 `main` 合并到品牌更名后的产品分支，记录冲突文件。
3. 品牌改动造成的冲突必须集中在 README、FORK、显示名和发布配置；如果冲突扩散到运行时代码，说明更名触及了不该改的内部标识，需要回到名称清单复核。
4. 演练不推送到远端，只记录结果。

## 34. 公开文档

| 文件 | 处理 |
|---|---|
| `README.md`、`README.en.md` | 改为 OutcomeGo，首段说明 “OutcomeGo（formerly outcomeGo），OpenTeam 的独立 Fork，与上游无隶属关系” |
| `FORK.md` | 增加更名记录，保留 OpenTeam 署名和分支规则 |
| `CHANGELOG.md`（新增） | 从下一版本开始记录；第一条为品牌更名和兼容说明 |
| `docs/` 下的迁移说明（新增，带日期的中文文件名：`docs/20261112-从aiTeamOS迁移到OutcomeGo.md`） | 说明哪些名称变了、哪些保留、旧 CLI 和旧下载地址的支持期、手动备份/导入边界和回滚方式 |
| `CONTRIBUTING.md` | 当前仓库不存在；本阶段不新增，贡献说明继续放在 README |

原规划 §19.2 建议的 `docs/rfcs/`、`docs/specs/` 目录不采用；技术规格按仓库规则放在 `specs/`。

## 35. 名称可用性核查

正式发布前记录以下检查结果（只记录，不注册或购买任何资源）：

- GitHub：`jingyi0605/OutcomeGo` 是否可用。
- npm：`outcomego` 包名和 `@outcomego` scope 是否被占用（本阶段不发布 npm 包，只记录）。
- 域名：计划使用的域名是否可用。
- 应用商店：Google Play 和 App Store 是否已有同名应用。
- 商标：公开检索是否有明显冲突。

结果写入 `docs/name-availability.md`。存在明显冲突时暂停公开发布，由负责人决定是否更换名称；这不是法律意见。
