# 任务清单 - 项目更名与下一版本发布（人话版）

状态：Draft

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
  - 怎么算完成：名称扫描结果全部有处理结论；`ghcr.io/.../ai-teamos`、`AITEAMOS_*`、`aiteamos_events`、`aiteamos://` 和 iOS `APP_DISPLAY_NAME` 都有处理结论（`design.md` §12）。
  - 怎么验证：`rg -n -i 'aiteamos|aiTeamOS|ai-teamos|openteam|com\.teambots|com\.aiteamos'`，再人工抽查 root、CLI、Desktop、Android、iOS、Compose、CI、Release、Docker 和文档。
  - 对应需求：需求 5、需求 16
  - 对应设计：`design.md` §6、§12

## 阶段 1：代码和文档重命名

- [ ] 1.1 更新根工作区显示信息和公开文档
  - 状态：TODO
  - 先依赖什么：0.2
  - 开始前先看：`requirements.md` 需求 1、需求 5、需求 6；`design.md` §6.1
  - 主要改哪里：`package.json`、`apps/*/package.json`、`packages/*/package.json`、`README.md`、`README.en.md`、`FORK.md`
  - 这一步先不做什么：不修改 `@aiteamos/*` workspace scope 和 workspace 包名（R4，不与本次品牌发布绑定，`design.md` §12、§22）；不修改上游 `openteam` 运行标识和数据库卷名。
  - 怎么算完成：OutcomeGo 名称、描述、作者说明、GPL 和 Fork 关系一致。
  - 怎么验证：`bun install --frozen-lockfile --ignore-scripts`、`bun scripts/release/version.ts check`、README 链接检查。
  - 对应需求：需求 1、需求 5、需求 6
  - 对应设计：`design.md` §6.1

- [ ] 1.2 更新 CLI 主入口和兼容别名
  - 状态：TODO
  - 先依赖什么：1.1
  - 开始前先看：`apps/cli/package.json`、`apps/cli/src/constants.ts`、`apps/cli/src/cli-update.ts`、`apps/cli/test/`
  - 主要改哪里：`apps/cli/package.json`、`apps/cli/src/`、CLI fixture 和安装脚本
  - 这一步先不做什么：不删除 `aiteamos` 的配置读取和更新兼容。
  - 怎么算完成：`outcomego --help`、`aiteamos --help`、配置读取、基础查询和更新源校验都能工作。
  - 怎么验证：`bun --filter @aiteamos/cli test`、CLI fresh install fixture、签名仓库断言。
  - 对应需求：需求 4、需求 6、需求 8
  - 对应设计：`design.md` §6.1、§8

- [ ] 1.3 更新 Desktop 品牌和安装资产
  - 状态：TODO
  - 先依赖什么：1.1
  - 开始前先看：`apps/desktop/package.json`、`apps/desktop/src/main/update-status.ts`、`apps/desktop/src/renderer/components/aiteamos/settings/about.tsx`
  - 主要改哪里：Desktop package、About、安装包名称、图标引用、权限文本和 updater fixture
  - 这一步先不做什么：不删除旧数据目录和旧可执行名。
  - 怎么算完成：安装包显示 OutcomeGo；`userData` 已固定为旧目录名 `aiTeamOS`（`design.md` §14），升级后仍是登录状态；旧更新资产仍可解析。
  - 怎么验证：`bun --filter @aiteamos/desktop typecheck`、`bun --filter @aiteamos/desktop test`、Desktop package test。
  - 对应需求：需求 1、需求 2、需求 7
  - 对应设计：`design.md` §6.2

- [ ] 1.4 更新 Android 显示名和发布文案
  - 状态：TODO
  - 先依赖什么：1.1
  - 开始前先看：`apps/android/app/build.gradle.kts`、`AndroidManifest.xml`、`scripts/android/`
  - 主要改哪里：Manifest label、strings、Release asset name、更新 manifest 文案和测试快照
  - 这一步先不做什么：不改变 `com.teambots.android`、签名和稳定 update identity。
  - 怎么算完成：应用显示 OutcomeGo，debug 和 release 配置仍可构建。
  - 怎么验证：`bash scripts/android/package-debug.sh`、APK manifest 检查、`bash scripts/android/release-gate.sh check`。
  - 对应需求：需求 1、需求 7
  - 对应设计：`design.md` §6.3

- [ ] 1.5 更新 iOS 显示名和发布配置说明
  - 状态：TODO
  - 先依赖什么：1.1
  - 开始前先看：`apps/ios/release.json`、`apps/ios/scripts/generate-project.py`、`apps/ios/Sources/App/`
  - 主要改哪里：显示名、Release 文案、配置检查和迁移说明
  - 这一步先不做什么：不无证据改变 bundle ID、APNs topic 或 extension ID。
  - 怎么算完成：显示 OutcomeGo，native config 检查和 Core 测试通过。
  - 怎么验证：`bun --filter @aiteamos/ios generate`、iOS package tests、`python3 apps/ios/scripts/check-native-config.py`。
  - 对应需求：需求 1、需求 7、需求 9
  - 对应设计：`design.md` §6.4

## 阶段 2：发布链路

- [ ] 2.1 更新 CI、Compose 和 Release Workflow 的公开引用
  - 状态：TODO
  - 先依赖什么：1.2、1.3、1.4、1.5
  - 开始前先看：`.github/workflows/ci.yml`、`.github/workflows/cli-installer.yml`、`.github/workflows/release.yml`、`docker-compose.yml`
  - 主要改哪里：仓库地址、Release 标题、asset 前缀、公开镜像标签和迁移说明
  - 这一步先不做什么：不重命名数据卷、数据库用户和 `/usr/lib/aiteamos` 运行路径。
  - 怎么算完成：工作流静态引用一致，签名 workflow 文件名保持不变。
  - 怎么验证：YAML 语法、`bun scripts/release/version.ts check`、release dry-run fixture、compose render。
  - 对应需求：需求 3、需求 6、需求 9
  - 对应设计：`design.md` §6.5、§7

- [ ] 2.2 构建下一版本候选资产
  - 状态：TODO
  - 先依赖什么：2.1
  - 开始前先看：`.github/RELEASING.md`、平台打包脚本和签名配置
  - 主要改哪里：Release 临时目录和构建记录
  - 这一步先不做什么：不将私钥写入仓库、文档或命令参数。
  - 怎么算完成：server/worker/computer 镜像、CLI、Desktop、Android 和 iOS 候选资产可识别。
  - 怎么验证：版本检查、构建、SHA-256、APK manifest、桌面 artifact 和 iOS config。
  - 对应需求：需求 6、需求 7
  - 对应设计：`design.md` §7

## 阶段 3：升级、回滚和发布

- [ ] 3.1 执行当前版本到 OutcomeGo 候选版本升级
  - 状态：TODO
  - 先依赖什么：2.2
  - 开始前先看：`docs/upgrade-matrix.md`
  - 主要改哪里：隔离测试环境、升级记录、客户端 fixture
  - 这一步先不做什么：不清理旧数据，不覆盖用户真实环境。
  - 怎么算完成：登录、历史消息、Bot、Routine、配置、通知和更新仍可用。
  - 怎么验证：Desktop/CLI/Android/server 四类升级回放；数据库迁移前后行数和关键记录对账。
  - 对应需求：需求 2、需求 7、需求 8
  - 对应设计：`design.md` §2、§8

- [ ] 3.2 执行签名、更新和回滚验证
  - 状态：TODO
  - 先依赖什么：3.1
  - 开始前先看：`.github/RELEASING.md`、`scripts/android/release-gate.sh`、更新测试
  - 主要改哪里：验证记录和旧/新 Release asset
  - 这一步先不做什么：不轮换签名密钥，不以仓库重命名替代回滚。
  - 怎么算完成：APK、Desktop、CLI 和 Compose 更新链都有成功和失败证据。
  - 怎么验证：`bash scripts/android/release-gate.sh all`（外部证据缺失项记录为 PENDING）、CLI update tests、Desktop update tests。
  - 对应需求：需求 6、需求 7、需求 8
  - 对应设计：`design.md` §7、§8

- [ ] 3.3 发布 OutcomeGo 下一版本
  - 状态：TODO
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
  - 状态：TODO
  - 先依赖什么：3.3
  - 这一步到底做什么：确认需求、设计、任务、升级证据和发布资产一致。
  - 怎么算完成：每一条需求有验证记录，父 Spec 可以进入 `004.2`。
  - 怎么验证：按 `requirements.md`、`design.md` 和 `docs/upgrade-matrix.md` 逐项核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 4：版本和资产追踪

- [ ] 4.1 生成名称层级和资产追踪表
  - 状态：TODO
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

- [ ] 4.2 验证根版本和所有 workspace
  - 状态：TODO
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

- [ ] 5.1 验证 CLI 新旧入口和更新源
  - 状态：TODO
  - 先依赖什么：1.2、2.1
  - 主要改哪里：`apps/cli` 测试、安装 fixture、迁移记录。
  - 这一步先不做什么：不删除旧入口。
  - 怎么算完成：新旧命令帮助、配置、status、update 和错误签名路径有结果。
  - 怎么验证：CLI focused tests、fresh install fixture、update signature fixture。
  - 对应需求：需求 8、需求 14
  - 对应设计：`design.md` §13、§25

- [ ] 5.2 验证 Desktop identity 和 updater
  - 状态：TODO
  - 先依赖什么：1.3、2.2
  - 主要改哪里：`apps/desktop/package.json`、updater tests、upgrade fixture。
  - 这一步先不做什么：不清理旧用户目录。
  - 怎么算完成：显示名、appId、artifact、旧 update manifest、覆盖升级和中断恢复均有结果。
  - 怎么验证：Desktop typecheck/test/package/update tests。
  - 对应需求：需求 1、需求 7、需求 12
  - 对应设计：`design.md` §14、§29

- [ ] 5.3 验证 Android 包身份和升级
  - 状态：TODO
  - 先依赖什么：1.4、2.2
  - 主要改哪里：Manifest、Gradle、release gate 和升级报告。
  - 这一步先不做什么：不改变 applicationId 或签名。
  - 怎么算完成：APK label、versionName/versionCode、package ID、certificate、manifest 和 update manifest 对账。
  - 怎么验证：`bash scripts/android/package-debug.sh`、`bash scripts/android/release-gate.sh check`、APK inspection。
  - 对应需求：需求 1、需求 7、需求 12
  - 对应设计：`design.md` §15、§29

- [ ] 5.4 验证 iOS 标识和配置
  - 状态：TODO
  - 先依赖什么：1.5、2.2
  - 主要改哪里：`apps/ios/release.json`、生成工程、native config 记录。
  - 这一步先不做什么：不改 bundle ID、APNs 或 extension ID。
  - 怎么算完成：显示名、bundle、APNs、share、notification extension 和 profile 关系有结果。
  - 怎么验证：iOS project generation、`python3 apps/ios/scripts/check-native-config.py`、Core/config tests。
  - 对应需求：需求 1、需求 7、需求 12
  - 对应设计：`design.md` §16

## 阶段 6：升级矩阵和仓库迁移

- [ ] 6.1 完成 Desktop/CLI/server 升级矩阵
  - 状态：TODO
  - 先依赖什么：5.1、5.2、5.3
  - 主要改哪里：`docs/upgrade-matrix.md`、隔离环境 fixture。
  - 这一步先不做什么：不使用真实用户目录。
  - 怎么算完成：登录、历史消息、Bot、Routine、配置、更新和回滚都有记录。
  - 怎么验证：重复执行隔离升级回放。
  - 对应需求：需求 2、需求 7、需求 12
  - 对应设计：`design.md` §29

- [ ] 6.2 决定是否执行 GitHub repository rename
  - 状态：TODO
  - 先依赖什么：4.1、5.1、6.1
  - 主要改哪里：`docs/repository-rename-decision.md`
  - 这一步先不做什么：不在没有通过兼容矩阵时执行 rename。
  - 怎么算完成：记录执行/暂缓结论、前置条件、验证步骤和回滚方法。
  - 怎么验证：检查旧 clone/fetch/Release/Actions/installer 引用清单。
  - 对应需求：需求 13
  - 对应设计：`design.md` §26

- [ ] 6.3 执行候选发布和回滚演练
  - 状态：TODO
  - 先依赖什么：6.1、6.2
  - 主要改哪里：Release candidate、旧资产、迁移公告和回滚记录。
  - 这一步先不做什么：不轮换签名私钥。
  - 怎么算完成：候选版本发布、失败中止、旧资产恢复和新入口关闭均可回放。
  - 怎么验证：发布 dry-run、安装/升级/回滚和资产 hash 检查。
  - 对应需求：需求 15
  - 对应设计：`design.md` §20、§31

### 最终检查增强项

- [ ] 6.4 迁移报告和父 Spec 交接
  - 状态：TODO
  - 先依赖什么：6.3
  - 主要改哪里：`docs/release-decision.md`、父 Spec `tasks.md`。
  - 怎么算完成：所有通过/PENDING/FAIL 项、责任人、回滚资产和下一阶段依赖已经写清。
  - 怎么验证：按 `requirements.md` 需求 1–15 和 `design.md` §23、§32 逐项核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 7：发布证据和失败路径

- [ ] 7.1 生成候选资产清单
  - 状态：TODO
  - 先依赖什么：2.2、5.1、5.2、5.3、5.4
  - 这一步到底做什么：记录所有 server/worker/computer/CLI/Desktop/Android/iOS/Compose 资产。
  - 主要改哪里：`docs/release-asset-inventory.md`
  - 这一步先不做什么：不把未构建的资产写成已生成。
  - 怎么算完成：每个资产有路径、版本、commit、SHA-256、身份和签名结论。
  - 怎么验证：文件存在检查、hash、manifest、signature fixture。
  - 对应需求：需求 6、需求 10
  - 对应设计：`design.md` §24、§30

- [ ] 7.2 执行错误版本/错误签名负例
  - 状态：TODO
  - 先依赖什么：7.1
  - 这一步到底做什么：验证 updater、CLI、Android manifest 和 Release workflow 会拒绝错误来源。
  - 主要改哪里：各平台 update/signature tests。
  - 这一步先不做什么：不修改生产签名配置。
  - 怎么算完成：错误 tag、错误 repository、错误 hash、错误 certificate 和旧资产混用均被拒绝。
  - 怎么验证：focused negative tests。
  - 对应需求：需求 6、需求 12、需求 15
  - 对应设计：`design.md` §13、§15、§29

- [ ] 7.3 执行配置和数据目录迁移负例
  - 状态：TODO
  - 先依赖什么：1.2、3.1
  - 这一步到底做什么：验证重复迁移、缺失配置、旧目录只读和中途中断行为。
  - 主要改哪里：CLI/Desktop migration fixtures、upgrade report。
  - 这一步先不做什么：不删除真实用户目录。
  - 怎么算完成：迁移幂等，失败可恢复，旧配置仍可读取。
  - 怎么验证：fresh/upgrade/retry/interrupted fixtures。
  - 对应需求：需求 4、需求 7、需求 8、需求 14
  - 对应设计：`design.md` §13、§25、§29

- [ ] 7.4 Spec 发布门槛复核
  - 状态：TODO
  - 先依赖什么：7.1、7.2、7.3
  - 这一步到底做什么：确认所有必需验收、PENDING 外部证据和回滚方式已记录。
  - 主要改哪里：`docs/release-decision.md`
  - 这一步先不做什么：不将 PENDING 写成 PASS。
  - 怎么算完成：父 Spec 可以读取本阶段的版本和升级结论。
  - 怎么验证：requirements/design/tasks 三向核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 阶段 8：上游同步、文档和名称核查

- [ ] 8.1 执行上游同步演练
  - 状态：TODO
  - 先依赖什么：1.1–1.5
  - 主要改哪里：临时分支、`docs/upstream-sync-rehearsal.md`
  - 这一步先不做什么：不推送演练分支，不修改 `main`。
  - 怎么算完成：冲突文件清单只涉及品牌和发布配置，或已回到名称清单修正。
  - 怎么验证：本地合并记录。
  - 对应需求：需求 16
  - 对应设计：`design.md` §33

- [ ] 8.2 编写 CHANGELOG 和迁移说明
  - 状态：TODO
  - 先依赖什么：0.2、1.1
  - 主要改哪里：`CHANGELOG.md`、`docs/` 下带日期的中文迁移说明、README、FORK
  - 这一步先不做什么：不新建 `docs/rfcs/`、`docs/specs/`。
  - 怎么算完成：迁移说明列出改名项、保留项、旧入口支持期和回滚方式。
  - 怎么验证：链接检查和名称清单对照。
  - 对应需求：需求 9、需求 16
  - 对应设计：`design.md` §34

- [ ] 8.3 记录名称可用性核查
  - 状态：TODO
  - 先依赖什么：无
  - 主要改哪里：`docs/name-availability.md`
  - 这一步先不做什么：不注册域名、包名或商标。
  - 怎么算完成：五类检查都有结果和日期；明显冲突已提交负责人决定。
  - 怎么验证：负责人复核。
  - 对应需求：需求 16
  - 对应设计：`design.md` §35
