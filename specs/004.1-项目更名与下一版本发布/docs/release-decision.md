# 发布决策

状态：PASS（已发布，带已知 PENDING 项）

结论日期：2026-11-17

当前结论：OutcomeGo 已于 `v0.1.0-beta.14`（2026-11-12T18:26:55Z）首次公开发布，并连续发布到 `v0.1.0-beta.19`（2026-11-17T00:25:24Z，GitHub Latest）。所有版本均由 `Release` workflow 在 `jingyi0605/OutcomeGo` 构建，资产见 `release-asset-inventory.md`。GitHub 仓库和 fork 默认分支均为 `OutcomeGo`；上游同步分支 `main` 保持独立。`aiTeamOS 0.1.0-beta.13` 及更早资产保留，作为回滚参考。

下表“当前状态”只写有证据的事实；没有证据的项目保持 PENDING，不写成 PASS。

| 门槛 | 证据 | 当前状态 | 结论 |
|---|---|---|---|
| 名称盘点和稳定标识分类 | `name-inventory.md`、`name-to-asset-matrix.md`、`full-rename-matrix.md` | PASS；最终全树扫描 147 个命中均已分类（任务 9.1） | 通过 |
| 版本和工作区一致 | `bun scripts/release/version.ts check`；Release workflow 的版本检查 | PASS | 通过 |
| CLI/Desktop 验证 | 本地 full tests；Release workflow 构建 | PASS | 通过 |
| Android 正式包 | beta.14–beta.19 Release 的 APK 和签名 `android-update.json` | PASS；设备在线更新未测 | 通过，设备更新归入 PENDING |
| macOS | Release DMG/ZIP；`signing-builds.md` | PASS | 通过 |
| Windows Authenticode | `signing-builds.md` | ACCEPTED UNSIGNED | 按决定未签名，用户会看到 SmartScreen 警告 |
| iOS | native config 检查 | 延期 | 不在本阶段发布范围 |
| 新 schema 初始化 | CI `database-fresh-schema` job 成功 | PASS | 通过 |
| 错误来源负例 | CLI 756 项测试、Android 静态负例 | 本地 PASS；跨平台旧资产混用 PENDING | 已知限制 |
| 真实新安装、手动备份导入 | `upgrade-matrix.md`、`full-rename-import-rehearsal.md` | PENDING | 已知限制，移交 `004.5` 任务 3.2 |
| 回滚演练 | — | PENDING | 已知限制，移交 `004.5` 任务 3.2 |
| 名称可用性 | `name-availability.md` | PENDING（npm、域名、应用商店、商标未核验） | 已知限制，不阻塞产品开发 |
| GitHub repository/branch rename | `repository-rename-decision.md` | PASS | 通过 |
| CI 健康 | GitHub Actions | `OutcomeGo` 分支最新 `CI` 的 `checks` job 失败（2026-11-17） | 不属于 004.1；在 `004.2` 开始前修复 |

## 回滚条件

任何签名、版本、新安装、数据读取或关键回归失败时，暂停后续公开发布，保留 `v0.1.0-beta.13` 及所有 OutcomeGo 历史资产，记录日志、版本和 hash，由负责人决定修复版本或回退方案。回滚演练本身仍为 PENDING。
