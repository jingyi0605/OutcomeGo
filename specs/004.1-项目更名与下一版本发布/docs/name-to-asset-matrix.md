# 名称到资产追踪表

记录日期：2026 年 11 月 12 日。该表区分新 OutcomeGo 本地候选、公开 beta.13 历史资产和仍未生成的发布资产。

| 层级 | 用户可见名称 | 新安装内部身份/资产 | 代码位置 | 当前证据 | 结论 |
|---|---|---|---|---|---|
| 公开文档 | OutcomeGo；独立 OpenTeam fork；GPL 保留 | 新仓库 `jingyi0605/OutcomeGo` | README、英文 README、FORK、CHANGELOG、迁移说明 | README/迁移文案审阅；旧产品 installer URLs 改为新仓库 Release URL | 本地已更正；远端文件未推送 |
| GitHub 仓库 | OutcomeGo | slug `jingyi0605/OutcomeGo`；fork 默认分支 `OutcomeGo`；上游同步分支 `main` | GitHub Settings、`origin`、文档链接 | 旧网页 redirect 和 beta.13 历史 Release API 有此前记录；本次分支/默认/ruleset 变更完成后补录远端核验与 Actions 结果。 | 仓库名已改；默认分支同步进行中 |
| CLI | Help 和安装器显示 OutcomeGo | `outcomego` 单一入口；`@outcomego/cli`；`PROJECT_NAME=outcomego`；`DEFAULT_REPOSITORY=jingyi0605/OutcomeGo`；`DEFAULT_IMAGE_PREFIX=ghcr.io/jingyi0605/ai-teamos` | `apps/cli`、release scripts | CLI typecheck 通过；清除所有大小写代理变量后完整套件 756 pass/0 fail，Sigstore/TUF 在线刷新通过 | 本地 PASS；GitHub runner 仍待验证 |
| CLI 历史签名 | beta.13 历史资产 | key id `openteam-local-release-2026-10-03` 绑定旧仓库；新发布依赖 OIDC Sigstore | `apps/cli/src/release.ts`、`release-signing-key.ts` | verifier 限定旧本地 key 只能处理旧仓库；OutcomeGo 使用 workflow identity | 待本轮 focused test 验证 |
| Desktop | 窗口、About、菜单、权限显示 OutcomeGo | `dev.outcomego.desktop`、executable `outcomego`；userData `aiTeamOS` 和 asset prefix `aiTeamOS-*` 按固定清单保留 | `apps/desktop/package.json`、`src/main/user-data-path.ts` | typecheck/full tests、userData test 已通过；没有 beta.13 updater 解析新 prefix fixture | 两项稳定身份保留；macOS 本地候选不等于公开候选 |
| Android | `app_name=OutcomeGo` | `com.outcomego.android(.debug)`；scheme `outcomego://`；资产名 `OutcomeGo-<version>-android.apk` | Manifest、Gradle、strings、release workflow | debug APK 元数据/hash 已记录；beta.14 release APK 已本地签名；update-manifest 私钥已轮换，对 beta.14 APK 的 manifest 签名验证通过 | 本地 APK 与 manifest 签名就绪；设备在线更新待验 |
| iOS | Release `OutcomeGo`、Debug `OutcomeGo Dev` | `dev.outcomego.mobile` 和 extensions/APNs；scheme `outcomego` | generate-project、release config | project generation/native config 通过；distribution/profile 发布构建延期 | 静态配置通过；候选/签名 PENDING |
| Compose/server/database | 产品提示显示 OutcomeGo | `outcomego` project/volume/DB/user、`OUTCOMEGO_*`、`/usr/lib/outcomego`；Postgres `aiteamos_events` 按固定清单保留 | Compose、Prisma/raw schema、server/worker/computer | compose static render、typecheck、Prisma generate、validator tests；fresh-schema test 已添加，待 PostgreSQL runner 实际执行 | 本地静态 PASS；空库真实初始化与人工导入 PENDING |
| GHCR | README、Release 文案使用 OutcomeGo | `ghcr.io/jingyi0605/ai-teamos-{server,worker,migrate,computer}` | CLI constant、Release workflow | 固定值检查和 Compose 路径检查 | 稳定分发标识保留 |
| GitHub Release | OutcomeGo | beta.14 尚无 Release；beta.13 发布名 `aiTeamOS 0.1.0-beta.13`，资产保持旧名；beta.14 目标 CLI/Compose 为 `outcomego-*` | `.github/workflows/release.yml`、公开 Release API | API 返回 beta.13 和旧命名 APK/Desktop/CLI/Compose 资产；Release 正文 installer URL 仍为旧 slug | beta.13 是历史旧版；beta.14 本地代码尚未推送/发布 |
| CI 去重 | workflow UI 名称不影响产品名 | tag push 仅运行 `release.yml`；CI/Android QA/CLI installer 限制 branch push | `.github/workflows/*.yml`、`scripts/check/release-workflows.ts` | 本地触发器断言、YAML 和 workflow checker 记录待本轮复核 | 需推送后观察 GitHub runner；不能称远端已验证 |

## 本地候选文件

- 根版本：`0.1.0-beta.14`，`bun scripts/release/version.ts check` 通过。
- Android debug APK（被后续构建替代）：`apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`；SHA-256 `e93a9709ec3893559d14b2930cd24c7ecfb07e78512a8ac1c230b0f806044c15`；label `OutcomeGo`；package `com.outcomego.android.debug`；versionCode `10014`。
- 本轮重建 Android debug APK：同一路径；SHA-256 `d838022c625c28a90315a6cd697837ae8f696bda216c68d9a1d6d34f1d8ca7c8`；label `OutcomeGo`；package `com.outcomego.android.debug`；versionName `0.1.0-beta.14`；versionCode `10014`；debug signer 为 Android Debug，非 release signing evidence。
- Android release APK：签名文件、证书和版本见 `signing-builds.md`；update manifest 由 CI 在发布时用新私钥签署；本地已对该 APK 签署并验证通过。
- 当前部署使用 `db push` + raw schema 初始化单一最新版本；历史增量 DDL不由该入口执行，旧 provider 字段回填迁移已移除，见 `docs/full-rename-import-rehearsal.md`。
- macOS：`OutcomeGo-0.1.0-beta.14-mac-arm64.dmg` 和 `.zip` 的本地签名/公证证据及 SHA-256 见 `signing-builds.md`；尚未加入 GitHub Release。
- Windows Authenticode PFX 缺失，沿用 beta.13 的未签名安装包；iOS 按延期决定不构建。
- Desktop updater 文件名仍为 `aiTeamOS-${version}-${os}-${arch}.${ext}`。没有 beta.13 updater metadata 能解析新前缀的证据，故保持不变；产品显示名独立改为 OutcomeGo。
- Desktop `userData` 固定为 `join(app.getPath("appData"), "aiTeamOS")`，Postgres listener/notifier 固定使用 `aiteamos_events`；两者是明确保留项，不是遗漏。
