# 设计文档 - 项目更名与下一版本发布

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. 名称层级

| 层级 | 处理方式 |
|---|---|
| 用户可见品牌 | 下一版本改为 OutcomeGo |
| GitHub 仓库和 Release | 完成兼容盘点后修改并验证旧路径 |
| CLI 入口 | 新入口可用，旧入口在过渡期保留 |
| Bun package scope | 只有在依赖链验证完成后单独处理 |
| Android 显示名 | 改为 OutcomeGo |
| Android `applicationId` | 默认保持不变 |
| iOS Bundle ID | 默认保持不变 |
| 数据库和配置目录 | 默认保持不变，必要时提供迁移 |
| 签名和更新身份 | 保持兼容，不因品牌变化轮换 |

## 2. 迁移矩阵

迁移测试至少覆盖：

- 全新安装。
- 当前版本升级。
- 登录和会话。
- 已有 Bot、Routine 和配置。
- Android 推送和通知深链。
- 桌面更新。
- 服务端安装器和更新清单。
- 回滚到旧发布资产。

## 3. 发布流程

```text
只读盘点
  → 更新用户可见品牌
  → 构建下一版本
  → 安装和升级验证
  → 签名与更新验证
  → 发布迁移说明
  → 发布 OutcomeGo 下一版本
```

## 4. 兼容原则

- 不对 `openteam` 做无差别全局替换。
- 不因为显示名变化修改移动端覆盖升级所需的应用标识。
- 不删除旧 CLI、配置键或更新路径，直到迁移周期结束。
- 不把 GitHub 重定向当作所有外部系统兼容的证明。

## 5. 回滚

品牌文案可以通过回滚提交恢复。发布资产、安装器和更新清单必须保留上一版本。涉及仓库地址的变化需要保留迁移说明，不依赖再次更名作为唯一回滚方案。

## 6. 当前代码映射

### 6.1 版本和工作区

| 文件 | 设计动作 | 验证 |
|---|---|---|
| `package.json` | 保持根版本为单一来源，下一版本统一递增 | `bun scripts/release/version.ts check` |
| `apps/*/package.json`、`packages/*/package.json` | 只更新 `description` 等用户可见文字和版本；`@aiteamos/*` 包名本阶段不改（§12、§22） | version check、lockfile 检查 |
| `bun.lock` | 由版本脚本更新并检查工作区版本 | `git diff -- bun.lock`、version check |
| `scripts/release/version.ts` | 保持版本同步逻辑，增加新产品名所需的可测试常量 | script unit test |
| `apps/cli/src/constants.ts` | `PROJECT_NAME`（现有 Compose project 名，`status.ts`、`password.ts`、`providers.ts` 依赖它找到已安装实例）保持 `aiteamos`；`DEFAULT_REPOSITORY` 和 `DEFAULT_IMAGE_PREFIX` 只在任务 6.2 决定重命名仓库后才修改，因为签名身份（`release.ts` 的 workflow identity）由仓库地址生成；Release 资产名 `aiteamos-compose.yaml`、`aiteamos-<os>-<arch>` 保持不变，旧 CLI 按这些名字下载更新 | CLI update/signature test |
| `apps/cli/package.json` | 新 `outcomego` binary/命令，保留旧 alias 入口 | fresh install and help test |

### 6.2 Desktop

`apps/desktop/package.json` 当前包含 `productName`、`executableName`、`appId`、artifact pattern、图标和权限说明。设计要求：

1. `productName`、artifact 显示名、权限文本和 About 页面使用 OutcomeGo。
2. `dev.aiteamos.desktop` 是否变化必须由升级测试决定；若保持不变，README 记录这是稳定安装身份而不是品牌遗漏。
3. `aiteamos` 可执行文件和用户数据目录在兼容期保留，新增 `outcomego` 入口或迁移提示。
4. Desktop updater 的旧 artifact pattern、新 artifact pattern 和 `/releases/latest` 解析都要有 fixture。

### 6.3 Android

`apps/android/app/build.gradle.kts` 当前的 `namespace`、`applicationId`、App Link host 和 versionCode 推导必须分别处理：

- `AndroidManifest.xml` 的 `android:label` 改为 OutcomeGo。
- `applicationId=com.teambots.android` 默认保留，保证覆盖升级；不得只为品牌而更换。
- `namespace=com.aiteamos.android` 可以在独立内部重构中迁移，但不属于本次下一版本品牌门槛。
- App Link scheme、host、通知 action 和 update manifest 的旧值必须在兼容矩阵中验证。
- `scripts/android/package-debug.sh` 用于 debug 构建；正式包必须使用现有 release gate 和签名验证。

### 6.4 iOS

`apps/ios/release.json` 与 Xcode 工程中的 bundle identifier、APNs extension、share extension 和应用显示名必须作为一组修改。应用显示名可以改为 OutcomeGo；bundle ID 和签名身份保持稳定，除非发布负责人提供新的 App Store 和迁移证据。

### 6.5 Server/Compose/CI

`docker-compose.yml` 中的服务名、卷名、数据库名、健康检查用户名和 `/usr/lib/aiteamos` 是运行标识，不得无测试全量改名。新名称分三类：

1. 对外名称：改为 OutcomeGo。
2. 内部稳定运行名：保留并记录兼容原因。
3. 全面迁移名：仅在独立迁移任务中修改，同时提供数据卷和 systemd/Compose 迁移。

`.github/workflows/release.yml`、`.github/workflows/cli-installer.yml`、`.github/RELEASING.md` 必须同步更新仓库、Release 标题、资产前缀和签名身份，但不能破坏 workflow 文件名，因为 CLI 签名校验依赖它。

## 7. 下一版本发布流程

```text
R0 只读盘点
  → R1 修改用户可见品牌
  → R2 更新包/CLI/仓库和 Release 引用
  → R3 构建所有候选资产
  → R4 安装、覆盖升级、登录和数据回放
  → R5 签名、manifest、更新和回滚验证
  → R6 发布下一版本并保留旧资产
```

每一步必须生成可复核的清单文件，不把 GitHub redirect、构建成功或静态 grep 当作升级成功的替代证据。

## 8. 回滚设计

- 代码回滚：恢复品牌和发布 Workflow 提交。
- Desktop/CLI：保留旧 artifact 和旧入口，禁止清理旧下载地址。
- Android：只有同一 application ID、签名链和可接受 versionCode 的包可以覆盖升级；否则停止发布。
- iOS：保留旧 TestFlight/App Store 版本和服务端兼容路径，不能依赖安装旧包覆盖新包。
- 数据库：本 Spec 不包含不可逆品牌数据库迁移。

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
- `apps/desktop/src/renderer/components/aiteamos/settings/about.tsx`
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

- `apps/android` 的 `com.teambots.android` application ID。
- `apps/android` 的 `com.aiteamos.android` namespace，除非独立迁移获批。
- `apps/ios` 的 bundle identifier、APNs extension 和 share extension 标识。
- `/usr/lib/aiteamos`、Compose 数据卷和数据库连接标识，除非迁移任务提供可回滚方案。
- `.github/workflows/release.yml` 文件名，因为签名校验依赖其身份。

## 10. 验证策略

### 静态检查

- `bun scripts/release/version.ts check`
- 名称分类扫描和未知命中审查。
- YAML、JSON、Manifest、Gradle 和 iOS release 配置检查。
- `python3 apps/ios/scripts/check-native-config.py`

### 构建和包检查

- `bun --filter @aiteamos/cli test`
- `bun --filter @aiteamos/desktop typecheck`
- `bun --filter @aiteamos/desktop test`
- `bash scripts/android/package-debug.sh`
- `bash scripts/android/release-gate.sh check`
- Release 候选资产的 SHA-256、APK manifest、签名和版本校验。

### 升级和回滚

- 当前版本到候选版本的 Desktop、CLI、Android 和 server 升级。
- 登录、历史消息、Bot、Routine、通知、配置和更新链路回放。
- 失败安装、旧入口、旧下载地址和回滚资产检查。

### 通过标准

所有静态检查、构建检查和升级矩阵必须有结果。外部账号或设备不可用时可以记录 `PENDING`，但不能将其标记为通过，也不能发布正式版本。

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
| `aiTeamOS` | 用户可见产品名 | 改为 OutcomeGo | UI、README、asset 检查 |
| `aiteamos` | CLI、包 scope、服务运行路径 | 新入口/显示名改动；兼容入口和运行路径保留 | CLI、Compose、update test |
| `@aiteamos/*` | workspace package scope | 本阶段保留；改名属于原规划 R4，需另立任务，不能与品牌发布绑定 | package graph/build |
| `com.aiteamos.android` | Kotlin namespace | 默认保留 | Gradle compile |
| `com.teambots.android` | Android application ID | 默认保留 | APK upgrade/signing |
| `dev.aiteamos.desktop` | Desktop app identity | 默认保留 | updater/install test |
| `dev.aiteamos.mobile` | iOS bundle ID | 默认保留 | iOS native config |
| `openteam` | 上游、协议、服务或目录 | 逐项保留或独立迁移 | classified grep |
| `ai-TeamOS` | 仓库、Release、默认 repo | 改为新仓库或兼容重定向 | CLI/release workflow |
| `ghcr.io/<owner>/ai-teamos-*` | 容器镜像路径（`DEFAULT_IMAGE_PREFIX`、release.yml `image_prefix`） | 默认保留；仓库重命名不会自动迁移 GHCR 包，若改名需同时推送新旧两个路径并保留旧路径至少一个版本周期 | CLI update、compose render |
| `AITEAMOS_*` | 环境变量（约 219 个） | 保留；新增同名 `OUTCOMEGO_*` 别名不在本阶段实现 | `.env.example`、compose、server 启动 |
| `aiteamos_events` | Postgres LISTEN 通道（`apps/server/src/event-wakeup.ts`） | 保留；改名会让新旧版本混跑时丢失唤醒 | event stream 测试 |
| `aiteamos://` | 客户端 URL scheme（Android Manifest、iOS `APP_URL_SCHEME`、`app-deep-links.ts`） | 保留；`004.3` 的 Outcome 深链也使用该 scheme | 三端深链测试 |
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
outcomego <args>
  └─ canonical CLI entry

aiteamos <args>
  └─ compatibility alias → canonical CLI entry
```

如果可执行文件名不能在当前安装器中双轨提供，则旧命令由 shim 或迁移提示处理，但必须保留同一配置目录和 update state。

### 13.3 默认仓库和签名

CLI 当前会根据 `DEFAULT_REPOSITORY` 和 Release 资产验证来源。迁移必须同时更新：

1. 默认仓库常量。
2. Release API 请求路径。
3. Compose 和 raw binary 资产名称。
4. 签名验证中的 repository identity。
5. 旧版本 verifier 对历史仓库和旧资产的兼容逻辑。

测试必须覆盖错误仓库、错误 tag、错误签名、旧 Release 和新 Release。

## 14. Desktop 更新链路

`apps/desktop/package.json` 中的 `appId`、`productName`、`executableName`、artifactName、图标和权限文本不是同一层的标识。必须分别处理：

- `productName`：改为 OutcomeGo。
- `artifactName`：下一版本可以改为 OutcomeGo 前缀，但 updater 必须同时识别旧资产。
- `executableName`：默认保留 `aiteamos`，或提供兼容启动器。
- `appId`：默认保留，保证安装覆盖和系统通知身份。
- 用户数据路径：必须保留。Electron 默认用 `productName` 推导 `app.getPath("userData")`，把 `productName` 从 `aiTeamOS` 改成 `OutcomeGo` 会把目录从 `~/Library/Application Support/aiTeamOS`（及 Windows/Linux 对应目录）切换到新目录，导致 `auth-session.json`、`machine-id`、`computer-settings.json`、`durable-send-journal` 等文件“丢失”。因此在 `apps/desktop/src/main/index.ts` 的 `app.whenReady()` 之前固定 `app.setPath("userData", join(app.getPath("appData"), "aiTeamOS"))`，并用测试断言打包后的 userData 目录名不变。不做数据目录迁移。
- macOS permissions 文本：改为 OutcomeGo，但保留实际权限语义。
- `dist-electron/aiteamos-cli.js`：如果不改内部文件名，必须在迁移清单中说明。

Desktop 测试必须包含：

- 新安装目录。
- 旧安装覆盖升级。
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

用户可见名称修改不能改变：

- `applicationId=com.teambots.android`。
- APK 覆盖升级所需的签名证书。
- update manifest 的公钥信任链。
- 深链处理所需的旧 scheme，除非新旧双解析已经测试。

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

应用显示名可改为 OutcomeGo；bundle identifiers 不因显示名变化而自动修改。若未来要改 bundle ID，必须另建迁移 Spec 或子任务，包含 App Store、Push、Keychain、深链和数据迁移证据。

## 17. Compose、镜像和服务运行标识

`docker-compose.yml` 中的 `aiteamos_*` 名称可能同时是：

- Docker service label。
- PostgreSQL database/user。
- Docker volume。
- hostname。
- `/usr/lib/aiteamos` 安装路径。
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

下一版本品牌发布最低要求是显示名、README、Release 和用户文案正确，稳定数据卷和内部路径继续可用。

## 18. GitHub Workflow 变更

必须逐项审阅：

- `.github/workflows/release.yml` 的 repository assertion、镜像 tag、asset name、Release title 和签名 identity。
- `.github/workflows/cli-installer.yml` 的 package filters、Docker context 和旧测试名称。
- `.github/workflows/ci.yml` 的数据库用户、测试 URL 和 workspace filters。
- `.github/RELEASING.md` 的版本、Tag、包名和迁移说明。

不能修改 `.github/workflows/release.yml` 的文件名而不更新 CLI 对签名身份的信任规则。Workflow 的临时目录、secret 名称和外部签名配置不得写入 Spec 以外的日志或提交。

## 19. 升级矩阵

| 起点 | 目标 | 检查内容 | 失败处理 |
|---|---|---|---|
| 当前 Desktop | OutcomeGo Desktop | data dir、auth、update、About | 保留旧 asset，停止发布 |
| 当前 CLI | OutcomeGo CLI | command、config、repository、signature | 保留旧 alias |
| 当前 Android | OutcomeGo APK | app ID、cert、versionCode、data、deep link | 禁止正式发布 |
| 当前 iOS | OutcomeGo app | bundle ID、keychain、APNs、deep link | 保留旧 App Store/TestFlight |
| 当前 server | OutcomeGo server | DB、Compose、install script、health | 回退镜像和 manifest |
| 旧仓库路径 | 新仓库路径 | clone/fetch/tag/Release/Actions | 发布迁移说明 |

每个单元必须有：初始资产、操作步骤、预期结果、实际结果、日志位置、回滚方式和复核人。

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

保留旧镜像 digest、旧 Compose asset、旧 schema 版本和 migration 记录。品牌变更不应要求回退数据库结构。

## 21. 迁移报告格式

```text
版本：<old> → <new>
目标仓库：<old> → <new>
根提交：<commit>
数据库 migration：<none or migration>
Desktop：<result>
CLI：<result>
Android：<result>
iOS：<result>
Server/Compose：<result>
签名验证：<result>
升级验证：<result>
回滚验证：<result>
未完成外部证据：<list>
发布结论：PASS / PENDING / FAIL
```

## 22. 设计决策和未决事项

必须在实现前记录：

- 下一版本是否执行 GitHub repository rename，还是先使用用户可见品牌。
- CLI 是否同时发布 `outcomego` 二进制和 `aiteamos` alias。
- `@aiteamos/*` 是否在本阶段保持不变（已决定：保持不变，见 §12）。
- Desktop `appId` 和 executable 是否保持不变。
- Android application ID、iOS bundle ID 是否保持不变。
- 旧 Release asset 的保留周期。
- 迁移公告的发布时间和责任人。

没有完成这些决定时，任务可以继续做只读盘点和品牌资源准备，但不能进行不可逆的仓库或签名迁移。

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

职责：构建 server、worker、migrate、computer 镜像，并生成 digest。镜像内部运行路径可以保持 `aiteamos`，但公开镜像仓库和 Release 文案必须按迁移决定处理。

验证：

- 多架构 manifest 存在。
- 每个 digest 可 anonymous pull 或按当前仓库规则验证。
- Compose 渲染引用正确 digest。
- 旧 Compose asset 仍能解析或有迁移说明。

### `cli-build`/`sign`

职责：构建 `outcomego` 主入口、兼容 `aiteamos` 入口、Compose、install scripts 和签名 metadata。

验证：

- `--help` 和 `--version` 显示新品牌。
- 旧配置目录可以读取。
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

职责：构建 APK、更新 manifest 和签名。品牌改动不应触碰 application ID 或 APK signing certificate。

验证：

- versionCode 单调递增。
- package ID 与旧包相同。
- certificate digest 与旧包相同。
- update manifest signature、公钥、HTTPS URL 和 SHA-256 正确。
- `assetlinks.json` 仍匹配 package ID。

### `ios`

职责：执行 iOS build/TestFlight workflow 和配置审计。应用显示名可以更新，bundle/profile/APNs 关系必须稳定。

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
| Compose file | `aiteamos-compose.yaml` | 新旧都读 | 可复制别名 | installer fixture |
| user data | 现有用户目录 | 是 | 默认不迁移 | fresh/upgrade |
| DB path | 现有服务数据 | 是 | 不变 | DB query |
| update cache | 现有 update state | 是 | alias | update test |
| command name | `aiteamos` | `outcomego` 主入口 | alias | help/e2e |
| default repo | `jingyi0605/ai-TeamOS` | 新仓库 | metadata fallback | signature test |

配置迁移脚本必须是幂等的：

```text
read old config
  → validate schema
  → copy only missing new keys
  → preserve old keys
  → write atomically
  → record migration version
```

不能在读取配置时直接删除旧键，也不能因为品牌变化重置认证或 server URL。

## 26. GitHub 仓库重命名步骤

如果 D02 批准仓库重命名，执行顺序为：

1. 完成名称命中清单。
2. 完成 OutcomeGo 下一版本候选构建。
3. 完成旧 clone/fetch/tag/Release/Issue/PR/Fork 检查。
4. 记录当前默认分支、保护规则和 Actions secrets/environment。
5. 更新 `DEFAULT_REPOSITORY`、README badges、submodules、webhooks 和 installer URLs。
6. 由管理员执行 GitHub Settings rename。
7. 验证旧地址重定向和新地址 API。
8. 验证 Actions 外部引用；不假设旧路径会自动重定向。
9. 验证 Release API、下载 manifest、CLI updater 和 Compose asset。
10. 发布迁移公告并保留旧名称搜索入口。

如果任一发布/签名/更新检查失败，停止仓库重命名，继续使用用户可见品牌和旧仓库地址完成下一版本。

## 27. 安装器和服务名称

安装包显示名、可执行文件、OS service name、Compose project name、volume name 和 data directory 必须分开盘点。

| 层级 | 推荐行为 |
|---|---|
| 安装包显示名 | OutcomeGo |
| CLI 命令 | `outcomego` + `aiteamos` alias |
| systemd service | 保留旧名，增加显示名迁移说明 |
| Docker Compose project | 保留旧 project/data volume，避免数据丢失 |
| server image | 可保留内部路径，公开 tag 按批准方案更新 |
| user data directory | 保留旧路径 |
| database name/user | 保留旧值，避免无必要迁移 |
| desktop executable | 保留旧值或提供 shim |

## 28. 迁移安全检查不是新 Feature Gate

本 Spec 的升级检查是发布功能的一部分。它们不应成为运行时通用 Feature Gate：

- 版本检查只保护发布资产一致性。
- application ID 检查只保护系统覆盖升级。
- 签名检查只保护安装包来源。
- 数据目录检查只保护用户数据。
- 旧入口检查只保护脚本兼容。

这些检查不能被抽象成所有产品功能必须经过的通用策略系统。

## 29. 具体升级回放

### Desktop 回放

1. 安装当前版本。
2. 创建一个 Bot、一个 Routine、一个设置项和一条历史消息。
3. 登录并关闭应用。
4. 安装 OutcomeGo 候选版本覆盖升级。
5. 打开应用，检查窗口标题、About、历史消息和设置。
6. 执行一次基础 Bot 消息和一次 updater check。
7. 中断更新，再次启动并检查状态恢复。

### CLI 回放

1. 使用当前版本完成 setup。
2. 保存 server URL、认证状态和自定义配置。
3. 安装新 CLI 入口。
4. 使用旧命令和新命令分别执行 `--help`、`status`、`update`。
5. 检查配置文件和 update cache 未被清空。

### Android 回放

1. 安装旧 APK。
2. 创建登录、Bot、通知注册和本地配置。
3. 安装新 APK 覆盖升级。
4. 验证 package ID、签名证书、数据、通知、App Link 和 update manifest。
5. 断网后再次打开，确认本地状态可读。

### iOS 回放

1. 安装旧版本/TestFlight build。
2. 登录、注册 Push、打开 Bot 和分享扩展。
3. 安装/升级候选版本。
4. 验证 keychain/session、Push、deep link、share extension 和设置。
5. 记录无法在无实体设备环境验证的项目为 PENDING。

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
| CLI 旧入口失败 | 否 | 保留旧入口，修复 alias |
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
- 旧入口、旧数据和旧更新链至少完成一轮验证。
- Android/iOS 稳定标识的保留理由明确。
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
| `README.md`、`README.en.md` | 改为 OutcomeGo，首段说明 “OutcomeGo（formerly aiTeamOS），OpenTeam 的独立 Fork，与上游无隶属关系” |
| `FORK.md` | 增加更名记录，保留 OpenTeam 署名和分支规则 |
| `CHANGELOG.md`（新增） | 从下一版本开始记录；第一条为品牌更名和兼容说明 |
| `docs/` 下的迁移说明（新增，带日期的中文文件名，如 `docs/20261112-从aiTeamOS迁移到OutcomeGo.md`） | 说明哪些名称变了、哪些保留、旧 CLI 和旧下载地址的支持期、回滚方式 |
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
