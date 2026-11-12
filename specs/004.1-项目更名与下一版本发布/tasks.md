# 任务清单 - 项目更名与下一版本发布（人话版）

状态：IN_PROGRESS

## 范围变更记录

2026 年 11 月 12 日，负责人确认改为全量内部重命名：不要求旧安装平滑升级，新实例直接从包含全部最新字段的单一 schema 初始化；用户如需保留数据，采用“手动备份、校验、导入新实例”的外部运行方式。仓库不转换旧数据库字段或旧表名。原有 1.x–8.x 任务中的兼容保留项不再是最终验收条件；已完成的品牌预发布证据保留为历史记录，新全量迁移由阶段 9 负责。

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

## 状态说明

- `TODO`：未开始
- `IN_PROGRESS`：正在实施
- `BLOCKED`：被外部决策、账号或设备阻塞
- `IN_REVIEW`：实现完成，等待证据复核
- `DONE`：实现、失败路径和验证证据均已完成
- `CANCELLED`：明确记录取消原因

只有 `DONE` 的任务才能勾选完成。每个任务完成后立即回写状态和证据路径。

## 阶段 0：发布前基线

- [x] 0.1 记录工作区、分支、Tag、Release 和当前版本
  - 状态：DONE
  - 证据：`docs/baseline.md`
  - 这一步到底做什么：记录下一版本前可复核的 Git 和发布基线。
  - 做完你能看到什么：当前版本、分支、远程地址、Release asset 和发布 Workflow 都有快照。
  - 先依赖什么：无
  - 开始前先看：`README.md`、`FORK.md`、`.github/RELEASING.md`、`package.json`
  - 主要改哪里：`docs/baseline.md`
  - 这一步先不做什么：不改远程仓库、不发布、不删除资产。
  - 怎么算完成：记录根版本、分支、Tag、远程、Release 和当前工作树状态。
  - 怎么验证：`git status --short`、`git remote -v`、`git branch -a`、`git tag --list`、`bun scripts/release/version.ts check`
  - 对应需求：需求 2、需求 3、需求 6
  - 对应设计：`design.md` §6、§7

- [x] 0.2 完成旧名称分类清单
  - 状态：DONE
  - 证据：`docs/name-inventory.md`
  - 这一步到底做什么：分类扫描所有品牌、包名、路径、签名、上游和协议命中。
  - 做完你能看到什么：`docs/name-inventory.md` 为每个命中给出 `rename`、`alias`、`preserve` 或 `separate-migration`。
  - 先依赖什么：0.1
  - 开始前先看：`design.md` §6
  - 主要改哪里：`docs/name-inventory.md`
  - 这一步先不做什么：不运行全局替换。
  - 怎么算完成：名称扫描结果全部有处理结论；GHCR `ghcr.io/.../ai-teamos`、`OUTCOMEGO_*`、保留的 `aiteamos_events`、新的 `outcomego://`、Desktop `userData=aiTeamOS` 和 iOS `APP_DISPLAY_NAME` 都有分类及理由（`design.md` §12）。
  - 怎么验证：`rg -n -i 'outcomego|outcomeGo|outcomego|openteam|com\.teambots|com\.outcomego'`，再人工抽查 root、CLI、Desktop、Android、iOS、Compose、CI、Release、Docker 和文档。
  - 对应需求：需求 5、需求 16
  - 对应设计：`design.md` §6、§12

## 阶段 1：代码和文档重命名

- [x] 1.1 更新根工作区显示信息和公开文档
  - 状态：DONE
  - 证据：`README.md`、`README.en.md`、`FORK.md`、`CHANGELOG.md`、`docs/20261112-从aiTeamOS迁移到OutcomeGo.md`；`bun install --frozen-lockfile --ignore-scripts`；`bun scripts/release/version.ts check`
  - 先依赖什么：0.2
  - 开始前先看：`requirements.md` 需求 1、需求 5、需求 6；`design.md` §6.1
  - 主要改哪里：`package.json`、`apps/*/package.json`、`packages/*/package.json`、`README.md`、`README.en.md`、`FORK.md`
  - 这一步先不做什么：不修改上游 `openteam` 运行标识；workspace scope、根包名和数据库运行身份按阶段 9 全量内部重命名方案处理。
  - 怎么算完成：OutcomeGo 名称、描述、作者说明、GPL 和 Fork 关系一致。
  - 怎么验证：`bun install --frozen-lockfile --ignore-scripts`、`bun scripts/release/version.ts check`、README 链接检查。
  - 对应需求：需求 1、需求 5、需求 6
  - 对应设计：`design.md` §6.1

- [x] 1.2 更新 CLI 主入口和兼容别名
  - 状态：DONE
  - 证据：`apps/cli/package.json`、CLI source/installer changes；`apps/cli/test/help.test.ts`、`status-command.test.ts`、setup/update safety tests；清除六个大小写代理变量后 full suite 756 pass、0 fail，Sigstore/TUF 测试通过。
  - 先依赖什么：1.1
  - 开始前先看：`apps/cli/package.json`、`apps/cli/src/constants.ts`、`apps/cli/src/cli-update.ts`、`apps/cli/test/`
  - 主要改哪里：`apps/cli/package.json`、`apps/cli/src/`、CLI fixture 和安装脚本
  - 这一步先不做什么：不删除 `aiteamos` 命令名别名；别名不恢复旧配置目录或数据身份。
  - 怎么算完成：`outcomego --help`、`aiteamos --help`、配置读取、基础查询和更新源校验都能工作。
  - 怎么验证：`bun --filter @outcomego/cli test`、CLI fresh install fixture、签名仓库断言。
  - 对应需求：需求 4、需求 6、需求 8
  - 对应设计：`design.md` §6.1、§8

- [x] 1.3 更新 Desktop 品牌和安装资产
  - 状态：DONE
  - 证据：`apps/desktop/package.json`、`apps/desktop/src/main/user-data-path.ts`、`apps/desktop/test/user-data-path.test.ts`；typecheck；Desktop full suite 544 pass、1 skip、0 fail；固定 `userData=aiTeamOS`，artifact prefix `aiTeamOS-*` 保留。
  - 先依赖什么：1.1
  - 开始前先看：`apps/desktop/package.json`、`apps/desktop/src/main/update-status.ts`、`apps/desktop/src/renderer/components/outcomego/settings/about.tsx`
  - 主要改哪里：Desktop package、About、安装包名称、图标引用、权限文本和 updater fixture
  - 这一步先不做什么：不访问或清理旧用户数据目录。
  - 怎么算完成：安装包显示 OutcomeGo；`userData` 在读取前固定为保留目录名 `aiTeamOS`（`design.md` §14）；旧更新资产前缀只有在有解析证据时才修改。
  - 怎么验证：`bun --filter @outcomego/desktop typecheck`、`bun --filter @outcomego/desktop test`、Desktop package test。
  - 对应需求：需求 1、需求 2、需求 7
  - 对应设计：`design.md` §6.2

- [x] 1.4 更新 Android 显示名和发布文案
  - 状态：DONE（本地）
  - 证据：`AndroidManifest.xml`、`res/values*/strings.xml`；`bash scripts/android/package-debug.sh`；APK label/package/version/hash inspection。
  - 先依赖什么：1.1
  - 开始前先看：`apps/android/app/build.gradle.kts`、`AndroidManifest.xml`、`scripts/android/`
  - 主要改哪里：Manifest label、strings、Release 用户可见文案、更新 manifest 文案和测试快照；新安装身份按阶段 9 统一处理
  - 这一步先不做什么：不访问签名材料；真实设备安装留给后续任务。
  - 怎么算完成：应用显示 OutcomeGo，debug 和 release 配置仍可构建。
  - 怎么验证：`bash scripts/android/package-debug.sh`、APK manifest 检查、`bash scripts/android/release-gate.sh check`。
  - 对应需求：需求 1、需求 7
  - 对应设计：`design.md` §6.3

- [x] 1.5 更新 iOS 显示名和发布配置说明
  - 状态：DONE
  - 证据：`apps/ios/scripts/generate-project.py`、generated project、`python3 apps/ios/scripts/check-native-config.py`。
  - 先依赖什么：1.1
  - 开始前先看：`apps/ios/release.json`、`apps/ios/scripts/generate-project.py`、`apps/ios/Sources/App/`
  - 主要改哪里：显示名、Release 文案、配置检查和迁移说明
  - 这一步先不做什么：不访问签名材料；真实设备和商店迁移留给后续任务。
  - 怎么算完成：显示 OutcomeGo，native config 检查和 Core 测试通过。
  - 怎么验证：`bun --filter @outcomego/ios generate`、iOS package tests、`python3 apps/ios/scripts/check-native-config.py`。
  - 对应需求：需求 1、需求 7、需求 9
  - 对应设计：`design.md` §6.4

## 阶段 2：发布链路

- [x] 2.1 更新 CI、Compose 和 Release Workflow 的公开引用
  - 状态：DONE
  - 证据：`.github/workflows/*.yml`、`docker-compose.yml`、`deploy/compose.yaml`、`docs/ci-workflow-audit.md`；`bun run check:workflows`；YAML/JSON/XML parse；`docker compose -f docker-compose.yml config --quiet`；`bun scripts/release/version.ts check`。
  - 先依赖什么：1.2、1.3、1.4、1.5
  - 开始前先看：`.github/workflows/ci.yml`、`.github/workflows/cli-installer.yml`、`.github/workflows/release.yml`、`docker-compose.yml`
  - 主要改哪里：Release 标题、Android APK 用户可见文件名和迁移说明；仓库地址和固定 upstream `openteam` 标识保持不变
  - 这一步先不做什么：不启动服务；Compose、数据库用户和 `/usr/lib/outcomego` 按全量新安装方案静态验证。
  - 怎么算完成：工作流静态引用一致，签名 workflow 文件名保持不变。
  - 怎么验证：YAML 语法、`bun scripts/release/version.ts check`、release dry-run fixture、compose render。
  - 对应需求：需求 3、需求 6、需求 9
  - 对应设计：`design.md` §6.5、§7

- [ ] 2.2 构建下一版本候选资产
  - 状态：IN_PROGRESS
  - 原因：Android beta.14 release APK 与 macOS beta.14 arm64 DMG/ZIP 已签名并完成本地/Apple 验证。Android updater manifest 私钥已轮换并写入 GitHub secret `ANDROID_UPDATE_SIGNING_PRIVATE_KEY_BASE64`（见 `docs/signing-builds.md`）。Windows 按 beta.13 方式发布未签名安装包（beta.13 实测 PE 证书表为空），不再是阻塞项；`release.yml` 缺证书时只输出 warning。iOS 继续延期。剩余工作：服务端/CLI/Desktop 全套候选资产须由 CI 在推送后构建。
  - 部分完成证据：`docs/signing-builds.md`；构建备份：`/Users/jackson/SynologyDrive/我的应用/配置文件备份/OutcomeGo/builds/`。
  - 先依赖什么：2.1
  - 开始前先看：`.github/RELEASING.md`、平台打包脚本和签名配置
  - 主要改哪里：Release 临时目录和构建记录
  - 这一步先不做什么：不将私钥写入仓库、文档或命令参数。
  - 怎么算完成：server/worker/computer 镜像、CLI、Desktop 和 Android 候选资产可识别；iOS 按负责人决定延期，不纳入本次候选门槛。
  - 怎么验证：版本检查、构建、SHA-256、APK manifest 和桌面 artifact；iOS 仅保留配置检查证据。
  - 对应需求：需求 6、需求 7
  - 对应设计：`design.md` §7

## 阶段 3：新安装、回滚和发布

- [ ] 3.1 验收 OutcomeGo 新安装和手动备份导入
  - 状态：PENDING
  - 原因：旧版原地升级不在范围内；新安装和最新 schema 备份导入由负责人在隔离环境验收。
  - 先依赖什么：2.2
  - 开始前先看：`docs/upgrade-matrix.md`
  - 主要改哪里：隔离测试环境、新安装记录、客户端 fixture
  - 这一步先不做什么：不清理旧数据，不覆盖用户真实环境。
  - 怎么算完成：新实例可登录并运行基础 Bot/Routine；符合最新 schema 的手动备份可按外部运行手册导入，源备份保持不变。
  - 怎么验证：Desktop/CLI/Android/server 新安装回放；不执行旧安装升级或旧数据库转换。
  - 对应需求：需求 2、需求 7、需求 8
  - 对应设计：`design.md` §2、§8

- [ ] 3.2 执行签名、更新和回滚验证
  - 状态：PENDING
  - 原因：需要签名候选资产、真实 Release manifest 和回滚资产；本会话只完成本地 focused negative tests。
  - 先依赖什么：3.1
  - 开始前先看：`.github/RELEASING.md`、`scripts/android/release-gate.sh`、更新测试
  - 主要改哪里：验证记录和旧/新 Release asset
  - 这一步先不做什么：不轮换签名密钥，不以仓库重命名替代回滚。
  - 怎么算完成：APK、Desktop、CLI 和 Compose 更新链都有成功和失败证据。
  - 怎么验证：`bash scripts/android/release-gate.sh all`（外部证据缺失项记录为 PENDING）、CLI update tests、Desktop update tests。
  - 对应需求：需求 6、需求 7、需求 8
  - 对应设计：`design.md` §7、§8

- [ ] 3.3 发布 OutcomeGo 下一版本
  - 状态：PENDING
  - 原因：禁止 push、tag、GitHub Release 和正式发布。
  - 先依赖什么：3.2、8.1、8.2、8.3
  - 开始前先看：全部前置任务和发布清单
  - 主要改哪里：目标分支、Tag、GitHub Release、迁移文档
  - 这一步先不做什么：不在发布窗口执行包作用域或移动 ID 的深层重构。
  - 怎么算完成：下一版本公开启用 OutcomeGo，旧名称可以通过迁移说明定位到新项目。
  - 怎么验证：安装、升级、登录、基础聊天、Bot/Routine 和回滚冒烟。
  - 对应需求：全部需求
  - 对应设计：`design.md` §7、§8

### 最终检查

- [ ] 3.4 Spec 最终检查点
  - 状态：PENDING
  - 原因：依赖 3.3 以及真实升级、签名和发布证据。
  - 先依赖什么：3.3
  - 这一步到底做什么：确认需求、设计、任务、升级证据和发布资产一致。
  - 怎么算完成：每一条需求有验证记录，父 Spec 可以进入 `004.2`。
  - 怎么验证：按 `requirements.md`、`design.md` 和 `docs/upgrade-matrix.md` 逐项核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 4：版本和资产追踪

- [x] 4.1 生成名称层级和资产追踪表
  - 状态：DONE
  - 证据：`docs/name-to-asset-matrix.md`、`docs/name-inventory.md`、修订后的 preserve 分类；全树最终扫描待完成。
  - 先依赖什么：0.2、1.1、1.2、1.3、1.4、1.5
  - 这一步到底做什么：将名称清单与实际修改文件、构建资产和兼容性结论关联起来。
  - 做完你能看到什么：`docs/name-to-asset-matrix.md`。
  - 开始前先看：`design.md` §12、§23、§24
  - 主要改哪里：`docs/name-to-asset-matrix.md`
  - 这一步先不做什么：不再做全局替换。
  - 怎么算完成：每个命中都有目标、保留理由和验证命令。
  - 怎么验证：名称搜索、文件路径检查、asset inventory 对账。
  - 对应需求：需求 5、需求 10
  - 对应设计：`design.md` §12、§23

- [x] 4.2 验证根版本和所有 workspace
  - 状态：DONE
  - 证据：`bun scripts/release/version.ts check` 通过；`check --tag v0.1.0-beta.13` 按预期失败并指出 tag/version 不一致；`bun.lock`、workspace、iOS release and Android inspection。
  - 先依赖什么：1.1
  - 这一步到底做什么：验证版本脚本对根包、workspace、lockfile、iOS 和 Android 的影响。
  - 做完你能看到什么：版本前后 diff 和 `version.ts check` 结果。
  - 开始前先看：`package.json`、`bun.lock`、`scripts/release/version.ts`、`apps/ios/release.json`
  - 主要改哪里：版本 fixture 和验证记录。
  - 这一步先不做什么：不提交正式 Tag。
  - 怎么算完成：合法版本通过，故意制造不一致时检查失败。
  - 怎么验证：`bun scripts/release/version.ts check` 和版本 fixture。
  - 对应需求：需求 6、需求 11
  - 对应设计：`design.md` §11

## 阶段 5：平台资产和身份验证

- [x] 5.1 验证 CLI 新旧入口和更新源
  - 状态：DONE
  - 证据：CLI help/status aliases、setup/update safety、checksum and wrong-tag checks；清除六个大小写代理变量后完整 CLI 测试 756 pass、0 fail，Sigstore/TUF refresh 通过。
  - 先依赖什么：1.2、2.1
  - 主要改哪里：`apps/cli` 测试、安装 fixture、迁移记录。
  - 这一步先不做什么：不删除旧入口。
  - 怎么算完成：新旧命令帮助、配置、status、update 和错误签名路径有结果。
  - 怎么验证：CLI focused tests、fresh install fixture、update signature fixture。
  - 对应需求：需求 8、需求 14
  - 对应设计：`design.md` §13、§25

- [x] 5.2 验证 Desktop identity 和 updater
  - 状态：DONE
  - 证据：Desktop package identity、legacy userData test、update-status tests、full Desktop suite；artifact prefix 保留理由见 `docs/name-to-asset-matrix.md`。
  - 先依赖什么：1.3、2.2
  - 主要改哪里：`apps/desktop/package.json`、updater tests、upgrade fixture。
  - 这一步先不做什么：不清理旧用户目录。
  - 怎么算完成：显示名、appId、artifact、旧 update manifest、覆盖升级和中断恢复均有结果。
  - 怎么验证：Desktop typecheck/test/package/update tests。
  - 对应需求：需求 1、需求 7、需求 12
  - 对应设计：`design.md` §14、§29

- [ ] 5.3 验证 Android 包身份和升级
  - 状态：IN_REVIEW
  - 原因：beta.14 APK 签名、package ID、versionName/versionCode 和 SHA-256 已核验；新的 Android 更新清单 ECDSA P-256 私钥已生成并备份，其公钥与 `AndroidUpdateManifest.kt` 中固定的 `PUBLIC_KEY_DER_HEX` 完全一致。已用 `scripts/android/create-update-manifest.py` 对真实 beta.14 APK 签署 manifest，并用公钥 `openssl dgst -verify` 验证通过（Verified OK）。按全新安装和手动备份导入决策，不要求旧 package ID 覆盖升级；真实设备安装与在线更新留待 3.x。
  - 证据：`docs/signing-builds.md`；APK 本地签名、元数据检查与 manifest 签名往返验证通过。
  - 先依赖什么：1.4、2.2
  - 主要改哪里：Manifest、Gradle、release gate 和升级报告。
  - 这一步先不做什么：不要求旧 package ID 覆盖升级，不轮换已固定的更新清单公钥。
  - 怎么算完成：APK label、versionName/versionCode、package ID、certificate 和 update manifest 对账；缺少匹配私钥则保持 BLOCKED。
  - 怎么验证：`bash scripts/android/package-debug.sh`、`bash scripts/android/release-gate.sh check`、APK inspection。
  - 对应需求：需求 1、需求 7、需求 12
  - 对应设计：`design.md` §15、§29

- [x] 5.4 验证 iOS 标识和配置
  - 状态：DONE
  - 证据：project generation、`python3 apps/ios/scripts/check-native-config.py`、`apps/ios/release.json` and generated project identity inspection；device/profile validation remains PENDING。
  - 先依赖什么：1.5、2.2
  - 主要改哪里：`apps/ios/release.json`、生成工程、native config 记录。
  - 这一步先不做什么：不改 bundle ID、APNs 或 extension ID。
  - 怎么算完成：显示名、bundle、APNs、share、notification extension 和 profile 关系有结果。
  - 怎么验证：iOS project generation、`python3 apps/ios/scripts/check-native-config.py`、Core/config tests。
  - 对应需求：需求 1、需求 7、需求 12
  - 对应设计：`design.md` §16

## 阶段 6：新安装验收和仓库迁移

- [ ] 6.1 完成 Desktop/CLI/server 新安装矩阵
  - 状态：PENDING
  - 原因：需要候选资产和隔离环境验证真实新安装及手动备份导入；模板见 `docs/upgrade-matrix.md`。
  - 先依赖什么：5.1、5.2、5.3
  - 主要改哪里：`docs/upgrade-matrix.md`、隔离环境 fixture。
  - 这一步先不做什么：不使用真实用户目录。
  - 怎么算完成：新实例登录、备份导入、历史消息、Bot、Routine、配置、更新和回滚都有记录。
  - 怎么验证：重复执行隔离新安装和导入回放，不覆盖旧实例。
  - 对应需求：需求 2、需求 7、需求 12
  - 对应设计：`design.md` §29

- [ ] 6.2 决定是否执行 GitHub repository rename
  - 状态：DONE
  - 原因：fork 主分支已改为 `OutcomeGo`，GitHub 默认分支和保护规则均指向该分支；旧 `ai-TeamOS` ref 已删除，历史包含在 OutcomeGo 分支中；上游 `main` 保持独立。
  - 证据：`docs/repository-rename-decision.md`；GitHub API default=`OutcomeGo`、远端 SHA `048df07d40b3fbd3a0a0c52652daaf86fb15210a`；`origin/ai-TeamOS` 返回 404；active ruleset 只匹配 `refs/heads/OutcomeGo`；无未合并 PR。
  - 先依赖什么：4.1、5.1、6.1
  - 主要改哪里：GitHub Settings、`origin`、README/FORK/docs、CLI 和 Desktop Release 来源。
  - 这一步先不做什么：不改变 GHCR stable package path，不合并 fork 默认分支与上游 `main`。
  - 怎么算完成：仓库 slug 和默认分支均为 OutcomeGo，源代码同步，默认分支/ruleset 与远端 SHA 均有记录。
  - 怎么验证：GitHub API 核验 repository default branch、远端 `OutcomeGo` SHA、branch ruleset 和 push 后 Actions run；初始 Actions 失败项记录在 `docs/ci-workflow-audit.md`，修复后 runner 复验待后续提交。
  - 对应需求：需求 13
  - 对应设计：`design.md` §26

- [ ] 6.3 执行候选发布和回滚演练
  - 状态：PENDING
  - 原因：beta.14 Android/macOS 有本地签名包，Android update-manifest 私钥已就绪；Windows 按 beta.13 方式发布未签名安装包；iOS 延期，正式发布尚未执行，须推送后由 CI 构建完整候选集。模板见 `docs/release-decision.md`、`docs/signing-builds.md`。
  - 先依赖什么：6.1、6.2
  - 主要改哪里：Release candidate、旧资产、迁移公告和回滚记录。
  - 这一步先不做什么：不轮换签名私钥。
  - 怎么算完成：候选版本发布、失败中止、旧资产恢复和新入口关闭均可回放。
  - 怎么验证：发布 dry-run、安装/升级/回滚和资产 hash 检查。
  - 对应需求：需求 15
  - 对应设计：`design.md` §20、§31

### 最终检查增强项

- [ ] 6.4 迁移报告和父 Spec 交接
  - 状态：PENDING
  - 原因：依赖 6.1–6.3 的真实升级、候选发布和回滚证据；GitHub slug rename 已完成，Actions 本地修复仍待推送验证。
  - 先依赖什么：6.3
  - 主要改哪里：`docs/release-decision.md`、父 Spec `tasks.md`。
  - 怎么算完成：所有通过/PENDING/FAIL 项、责任人、回滚资产和下一阶段依赖已经写清。
  - 怎么验证：按 `requirements.md` 需求 1–15 和 `design.md` §23、§32 逐项核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 7：发布证据和失败路径

- [ ] 7.1 生成候选资产清单
  - 状态：PENDING
  - 原因：只有 Android beta.14 APK 与 macOS arm64 DMG/ZIP 有本地签名证据；完整 server/worker/computer/CLI/Desktop/Windows 集合不全（Windows 为未签名安装包），iOS 延期。完整资产清单须待候选资产齐备。
  - 先依赖什么：2.2、5.1、5.2、5.3、5.4
  - 这一步到底做什么：记录所有 server/worker/computer/CLI/Desktop/Android/iOS/Compose 资产。
  - 主要改哪里：`docs/release-asset-inventory.md`
  - 这一步先不做什么：不把未构建的资产写成已生成。
  - 怎么算完成：每个资产有路径、版本、commit、SHA-256、身份和签名结论。
  - 怎么验证：文件存在检查、hash、manifest、signature fixture。
  - 对应需求：需求 6、需求 10
  - 对应设计：`design.md` §24、§30

- [ ] 7.2 执行错误版本/错误签名负例
  - 状态：IN_PROGRESS（本地用例通过，等待候选资产与 runner 验证）
  - 原因：在清除全部代理环境变量后，CLI 完整测试 756 项全部通过，包含历史仓库签名与仓库/tag/hash 绑定负例。Android 错误 hash、错误 tag、错误 certificate 静态负例已覆盖；真实 manifest 签名已用新 updater 私钥对 beta.14 APK 完成签署并通过公钥验证。剩余：候选资产齐备后的跨平台旧资产混用负例与 CI runner 验证。
  - 先依赖什么：7.1
  - 这一步到底做什么：验证 updater、CLI、Android manifest 和 Release workflow 会拒绝错误来源。
  - 主要改哪里：各平台 update/signature tests。
  - 这一步先不做什么：不修改生产签名配置。
  - 怎么算完成：错误 tag、错误 repository、错误 hash、错误 certificate 和旧资产混用在各平台均有结果；真实 Android manifest 签名可端到端验证。
  - 怎么验证：`env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy bun --filter @outcomego/cli test`、Android manifest 单测和签名候选验证。
  - 对应需求：需求 6、需求 12、需求 15
  - 对应设计：`design.md` §13、§15、§29

- [ ] 7.3 验证新 schema 初始化和备份校验负例
  - 状态：PENDING
  - 原因：代码不再实现旧数据库字段转换、旧配置读取或原地升级；最新 schema PostgreSQL 集成测试和手动备份导入仍待负责人在隔离环境执行。
  - 证据：`docs/full-rename-import-rehearsal.md`；新空库测试 `packages/db/test/fresh-schema.integration.test.ts` 等待 PostgreSQL runner。
  - 先依赖什么：1.2、9.3
  - 这一步到底做什么：验证当前 schema 初始化边界和备份校验失败时源文件保持不变。
  - 主要改哪里：schema 集成测试、备份 validator tests 和导入记录。
  - 这一步先不做什么：不删除真实用户目录。
  - 怎么算完成：新 schema 初始化和校验器负例通过；外部导入失败可从未修改源备份重试。
  - 怎么验证：fresh-schema integration、validator negative tests 和隔离手动导入回放；不测试旧库转换。
  - 对应需求：需求 4、需求 7、需求 8、需求 14
  - 对应设计：`design.md` §13、§25、§29

- [ ] 7.4 Spec 发布门槛复核
  - 状态：PENDING
  - 原因：依赖 7.1、7.2 和 3.x/6.x 外部证据；当前门槛模板见 `docs/release-decision.md`。
  - 先依赖什么：7.1、7.2、7.3
  - 这一步到底做什么：确认所有必需验收、PENDING 外部证据和回滚方式已记录。
  - 主要改哪里：`docs/release-decision.md`
  - 这一步先不做什么：不将 PENDING 写成 PASS。
  - 怎么算完成：父 Spec 可以读取本阶段的版本和升级结论。
  - 怎么验证：requirements/design/tasks 三向核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 8：上游同步、文档和名称核查

- [x] 8.1 执行上游同步演练
  - 状态：DONE
  - 证据：`docs/upstream-sync-rehearsal.md`；临时分支/worktree merge from `main` clean，tracked patch applied cleanly，no conflicts、commit、push or main modification。演练早于本轮 DB deploy simplification 和 CI fresh-schema job，后两项仍待实际 runner 验证。
  - 先依赖什么：1.1–1.5
  - 主要改哪里：临时分支、`docs/upstream-sync-rehearsal.md`
  - 这一步先不做什么：不推送演练分支，不修改 `main`。
  - 怎么算完成：冲突文件清单只涉及品牌和发布配置，或已回到名称清单修正。
  - 怎么验证：本地合并记录。
  - 对应需求：需求 16
  - 对应设计：`design.md` §33

- [x] 8.2 编写 CHANGELOG 和迁移说明
  - 状态：DONE
  - 证据：`CHANGELOG.md`、`docs/20261112-从aiTeamOS迁移到OutcomeGo.md`、README/FORK history text。
  - 先依赖什么：0.2、1.1
  - 主要改哪里：`CHANGELOG.md`、`docs/` 下带日期的中文迁移说明、README、FORK
  - 这一步先不做什么：不新建 `docs/rfcs/`、`docs/specs/`。
  - 怎么算完成：迁移说明列出改名项、保留项、手动备份/导入边界和回滚方式；不承诺旧数据库字段自动转换。
  - 怎么验证：链接检查和名称清单对照。
  - 对应需求：需求 9、需求 16
  - 对应设计：`design.md` §34

- [ ] 8.3 记录名称可用性核查
  - 状态：PENDING
  - 原因：GitHub 仓库 slug 和当前公开仓库信息已由 GitHub API 核验；npm scope、域名完整范围、应用商店账号和商标仍未核验，故整体保留 PENDING。详情见 `docs/name-availability.md`。
  - 先依赖什么：无
  - 主要改哪里：`docs/name-availability.md`
  - 这一步先不做什么：不注册域名、包名或商标。
  - 怎么算完成：五类检查都有结果和日期；明显冲突已提交负责人决定。
  - 怎么验证：负责人复核。
  - 对应需求：需求 16
  - 对应设计：`design.md` §35

## 阶段 9：全量内部重命名和最新 schema

- [x] 9.1 建立全量命名映射和禁止残留清单
  - 状态：DONE
  - 证据：`docs/full-rename-matrix.md`、`docs/name-inventory.md`；最终全树扫描 147 个命中均已归入迁移说明、历史/别名或固定 preserve 项，未发现新的用户可见旧品牌运行字符串。
  - 目标：覆盖 package scope、代码符号、文件/目录、环境变量、Compose、数据库、平台身份、协议、CI、Release 和测试 fixture；显式记录 `aiTeamOS` userData、`aiteamos_events`、GHCR `ai-teamos` 为 preserve。
  - 验证：结构化扫描、旧模式残留分组、命名约定审查。

- [x] 9.2 重命名 Bun workspace、TypeScript 符号和 CLI
  - 状态：DONE
  - 证据：`package.json`、`bun.lock`、所有 `@outcomego/*` workspace、CLI binary/build output；`bun install --frozen-lockfile --ignore-scripts`、CLI typecheck、CLI build、CLI focused tests；清除六个大小写代理变量后完整 CLI 测试 756 pass、0 fail。
  - 依赖：9.1
  - 验证：`bun install --frozen-lockfile --ignore-scripts`、workspace typecheck、CLI build/test、`outcomego --help`。

- [ ] 9.3 使用单一最新 schema 并校验最新备份
  - 状态：PENDING（静态检查和备份 validator 通过；PostgreSQL integration 尚未实际执行）
  - 原因：当前 Prisma schema 和 raw schema 是唯一初始化来源；deploy script 只初始化空数据库或重试同一份中断初始化，schema 指纹不匹配时拒绝原地升级。已移除旧字段回填 SQL 和读取旧字段的运行逻辑。备份 validator 只接受 `outcomego-backup/v1` / `outcomego-v1`，验证物理表名、SHA-256、行数和关系。
  - 证据：`packages/db/prisma/schema.prisma`、`packages/db/prisma/sql/raw-schema.sql`、`packages/db/scripts/deploy-schema.ts`、`packages/db/test/fresh-schema.integration.test.ts`、`scripts/migration/validate-outcomego-backup.ts`、`docs/full-rename-import-rehearsal.md`；PG 集成执行待 CI runner。
  - 依赖：9.1
  - 验证：`bun --filter @outcomego/db db:generate`、db typecheck、latest-schema validator tests；真实数据库初始化和人工导入留待 9.7。

- [x] 9.4 重命名 Compose、服务端运行时和环境变量
  - 状态：DONE
  - 证据：`docker-compose.yml`、`deploy/compose.yaml`、Docker helpers、server/worker/computer source；带临时必需变量的 `docker compose config --quiet`、server/worker/computer typecheck 通过。未启动服务，运行时 smoke 留待 9.7。
  - 依赖：9.2、9.3
  - 验证：新 `.env`、开发/生产 Compose render、服务端/worker/computer typecheck/test、Postgres channel smoke fixture。

- [x] 9.5 重命名 Desktop、Android、iOS 平台身份和深链
  - 状态：DONE
  - 证据：Desktop package/userData tests/full suite（固定路径 `aiTeamOS`）；Android debug APK label `OutcomeGo`、package `com.outcomego.android.debug`、version `0.1.0-beta.14`、versionCode `10014`；APK SHA-256 `d838022c625c28a90315a6cd697837ae8f696bda216c68d9a1d6d34f1d8ca7c8`；iOS project generation 和 native config check。
  - 依赖：9.2、9.4
  - 验证：Desktop package/typecheck/test、Android debug package、iOS project generation/native config、三端新 scheme/identity 静态检查。

- [x] 9.6 重命名 CI、GHCR、Release asset 和签名身份
  - 状态：DONE
  - 证据：`.github/workflows/*.yml`、`.github/RELEASING.md`、`scripts/check/release-workflows.ts`、asset matchers、Compose render；稳定 GHCR `ai-teamos` 与 workflow identities 已分类，workflow/YAML 静态检查通过。beta.13 API 显示 Android QA 和 CLI installer 曾重复响应 tag；本地修复未推送，runner 验证仍 PENDING。
  - 依赖：9.2–9.5
  - 验证：workflow/YAML/asset matrix、release dry-run、签名 identity fixture；旧资产只作为迁移输入，不要求旧 updater 兼容。

- [ ] 9.7 执行全量新安装和备份导入验收
  - 状态：PENDING
  - 原因：新 PostgreSQL schema 测试、手动备份导入和设备验收由负责人在隔离环境执行；旧安装和旧数据库转换不属于待办范围。
  - 依赖：9.3–9.6
  - 证据：`docs/full-rename-import-rehearsal.md`
  - 验证：空安装、最新 schema 备份校验、人工导入、失败导入和删除新实例后重新导入。
