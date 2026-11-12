# 发布决策（待候选资产）

状态：PENDING（不得发布）

当前结论：beta.14 仍未发布，不具备提交正式 Release 的条件。GitHub 仓库已为 `jingyi0605/OutcomeGo`，fork 默认分支改名及源代码同步正在本次执行；上游同步分支 `main` 保持独立。公开 latest 仍是 beta.13。Android beta.14 release APK 与 macOS arm64 DMG/ZIP 已在本机签名/公证并备份，Android update manifest 私钥已轮换（公钥与 `AndroidUpdateManifest.kt` 一致，GitHub secret 已设置，真实 APK manifest 签名验证通过）。Windows 沿用 beta.13 未签名方式，缺证书时 `release.yml` 警告后继续；iOS 按决定延期。新空 schema CI 和真实设备新实例/手动备份导入仍待验证；GitHub runner 尚未验证。

| 门槛 | 证据 | 当前状态 | 发布负责人结论 |
|---|---|---|---|
| 名称盘点和稳定标识分类 | `name-inventory.md`、`name-to-asset-matrix.md` | 本地已更正 `userData=aiTeamOS`、`aiteamos_events` 等 preserve；最终全树扫描尚未复核 | 待复核 |
| 版本和工作区一致 | `bun scripts/release/version.ts check` | DONE | 待复核 |
| CLI/Desktop 本地验证 | typecheck、focused/full tests | CLI typecheck PASS；清除所有代理变量后 CLI 756 pass/0 fail；Desktop typecheck PASS、544 pass/1 skip | 本地 Sigstore/TUF 测试通过；runner 仍待验证 |
| Android debug package | APK manifest、version、hash | PASS；本轮重建 SHA-256 `d838022c625c28a90315a6cd697837ae8f696bda216c68d9a1d6d34f1d8ca7c8` | 仅 debug 证据 |
| Android beta.14 signed APK | `docs/signing-builds.md` | LOCAL PASS；updater manifest 已用新私钥签署并通过公钥验证（设备在线更新未测）；采用 `com.outcomego.android` 新安装身份 | 不支持覆盖旧 package ID；按手动备份/导入流程迁移 |
| macOS beta.14 arm64 | `docs/signing-builds.md`、Apple notarization | LOCAL PASS；Developer ID、Gatekeeper、DMG checksum、app/DMG ticket 验证通过 | 本地签名资产，未发布 |
| Windows Authenticode | `docs/signing-builds.md` | ACCEPTED UNSIGNED：沿用 beta.13 未签名发布；用户会看到 SmartScreen 警告；`release.yml` 缺证书仅 warning，补齐 `WINDOWS_CERTIFICATE_*` 与 `WINDOWS_SIGNING_SUBJECT` 后自动启用签名与校验 | beta.14 Windows 安装包未签名；后续取得可信证书再签名 |
| iOS native config | project generation、`check-native-config.py` | DONE | 仅本地配置证据 |
| 错误来源/新 schema 负例 | `tasks.md` 7.2、7.3 | hash/version/source focused negatives 已有；在线 Sigstore refresh BLOCKED；旧 provider 字段回填及旧字段读取逻辑已删除；schema fingerprint integration test 尚未执行 | 7.2 IN_PROGRESS；7.3 等待隔离 PostgreSQL/导入验收 |
| 真实新安装和回滚 | `upgrade-matrix.md` | PENDING | 必须设备/候选资产后执行 |
| 名称可用性 | `name-availability.md` | PENDING；本轮 CodingNS web search endpoint 失败 | 非 GitHub 类别不可声称已核验 |
| 完整候选集和正式发布 | 任务 2.2、3.3 | PENDING | Android/macOS 本地签名包与 update-manifest 私钥已就绪，Windows 接受未签名；须推送后由 CI 构建完整候选集并核验 |
| GitHub repository/branch rename | 任务 6.2、`docs/repository-rename-decision.md` | 仓库 slug 已改；OutcomeGo 默认分支同步和 ruleset 更新随本次执行 | 推送后验证 GitHub CI 和默认分支；不创建 tag/Release |
| GitHub Actions workflow 触发去重 | `docs/ci-workflow-audit.md` | beta.13 API 证据：同一 tag 触发 Release、Android QA、CLI installer 各一条，独立 CI 为 0；本地已加 branch-only trigger，checker/YAML PASS；未推送验证 | 推送后观察 branch run；未来 tag 事件确认只启动 Release workflow |

## 回滚条件

任何签名、版本、新安装、数据读取或关键回归失败时，状态必须为 FAIL/PENDING，保留 `v0.1.0-beta.13` 历史资产，暂停公开发布，记录日志、版本和 hash，并由负责人决定修复版本或回退方案。
