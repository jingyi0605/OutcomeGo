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

## 第 1 波线 5B 遗留项复核（2026-11-17）

上述 PASS 是已有版本发布事实的历史结论。本轮只完成 `004.1` 遗留项的逐项复核与可安全执行的离线检查，不形成下一候选的发布 PASS。完整证据见 [`004.5` 发布验收矩阵](../../004.5-运行时恢复与版本验收/docs/release-acceptance-matrix.md)。

| 遗留门槛 | 本轮实际证据 | 复核结论 / 缺失前置 |
| --- | --- | --- |
| 新安装、登录、基础聊天、Bot/Routine | CLI 配置测试隔离重试 7 PASS；Desktop/共享更新聚焦测试 22 PASS；没有真实安装或服务启动 | **PENDING**；需指定候选及 hash、空白隔离目录/实例、测试账号和安装/启动授权 |
| 最新备份校验、人工导入及失败重试 | 原有 validator 5 项测试 PASS；合成输入九次校验均前后 hash 不变；另有三个校验缺口 | **FAIL（离线校验缺口）/ PENDING（真实导入）**；未知表、缺失引用目标表、Outcome 孤儿引用被错误接受；先交数据库/备份脚本负责人处理，再提供脱敏备份、当前 schema 指纹、可丢弃目标与导入/失败重试授权。不得以 validator 成功作为真实备份可导入证明 |
| CLI/Android/Desktop 签名和更新 | CLI 历史 fixture 的载荷签名绑定验证；Android beta.14 fixture 有效签名通过且五种改动被拒绝；Desktop 更新诊断/缓存/文案/身份测试通过 | **PENDING（完整签名和更新链）**；CLI 完整签名测试缺 `@sigstore/bundle` 等已锁定依赖，更新安全测试缺 `semver`；需实际候选、更新基线、设备/隔离用户目录和更新授权；原语验签不代表 Sigstore/TUF/透明日志或设备更新通过 |
| 跨平台旧资产混用 | 错误本地 tag、Android 和 CLI fixture 的 repository/tag/hash 绑定负例已执行 | **PENDING**；需两组固定平台/版本资产及 hash、可控错误来源和隔离更新目标；没有执行候选混用 |
| 关闭入口、回退资产/镜像 | 静态核对父 design §16、§36 与当前 deploy 脚本；无真实状态变更 | **PENDING**；需集成候选、明确入口关闭操作、旧/新镜像 digest、含 Outcome 数据的可丢弃数据库和备份、回退授权 |
| 名称可用性与后续 GHCR 发布 | 本轮未查询或操作 | **PENDING，非本线范围**；8.3、9.8 继续由对应名称/发布负责人提供证据 |

回退边界补充：当前 `packages/db/scripts/deploy-schema.ts:58–62` 对认可 marker、指纹变化且非空的库继续初始化并执行 `db push`，不是一律拒绝指纹变化；`fresh-schema.integration.test.ts` 已有 outdated marker 升级成功的断言。本地旧导入说明中的“一切指纹变化均拒绝”不是当前回退保护证据。旧镜像遇到含数据新增表时可能被 `db push` 拒绝启动的风险仍需隔离回放；正式回退方向保持“关闭 Outcome 入口、保留新镜像和新表”，本轮没有验证关闭操作成功。

第 0 波完整数据库测试门槛、失败基线和父任务 1.3 的 CI PENDING 保持不变。`004.5` 任务 3.2 仍未完成；第 3 波的跨客户端 Outcome 回归未在本轮执行。本线没有修改产品代码、数据库、签名配置或 Release 资产，也没有启动/重建/重启本地或远端服务。
