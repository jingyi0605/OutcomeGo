# 第 1 波线 5B 发布验收复核矩阵

复核日期：2026-11-17（Asia/Singapore）。

结论：`004.1` 遗留项的逐项复核与可执行离线检查已完成；真实新安装、人工导入、设备更新和回滚均为 **PENDING**。发现三项可重复的备份校验缺口，记为 **FAIL**。`004.5` 任务 3.2 整体未完成，不能据此形成新的发布 PASS 结论。

关联：[需求 4、12、14](../requirements.md)、[设计 §14、§28、§44、§48](../design.md)、[任务 3.2](../tasks.md)、[004.1 发布结论](../../004.1-项目更名与下一版本发布/docs/release-decision.md)。

## 环境、范围和证据

| 项目 | 本轮事实 |
| --- | --- |
| 执行工作树 | `/Users/jackson/Code/openteam-spec004-worktrees/l5b-ops` |
| 分支和起点 | `outcome/l5b-ops`，从集成分支 `outcome/spec004` 的 `5070c6bc9c564cc2c0b982a25393860bcd82c774` 创建，开始时干净 |
| 本地版本 | `0.1.0-beta.19`；`version.ts check` 实际通过 |
| 平台 | macOS / arm64；Bun `1.4.4`，仓库固定版本为 `1.4.2` |
| schema 指纹 | `7937b6f1f8aec63f98a3f0dbbbde72684b5d00f79c1c69eb058bc2811f0fd158`；计算方式为 Prisma 文件、NUL、raw schema 文件连接后的 SHA-256 |
| 已有发布资料 | `004.1/docs/release-asset-inventory.md` 中的 beta.19 历史快照；本轮没有重新查询 Release，也没有下载或运行候选资产 |
| 外部环境 | 负责人没有提供并授权隔离安装/导入/更新/回退环境及设备；命令存在不代表设备、Docker daemon 或候选资产已就绪 |
| 本地依赖 | 新工作树没有 `node_modules`、没有根 `.env`；未安装依赖、未借用其他工作树的依赖或产物 |
| 执行边界 | 只运行仓库内已检查的离线工具、既有聚焦测试和本目录复核脚本；临时样本均在本目录的独立临时子目录中创建并清理 |

所有实际命令、退出码和结果见 [results.json](20261117-l5b-evidence/results.json)，完整命令输出见同目录 `*.log`（仅规范化行末空白，保留错误信息和失败结果）；[environment.json](20261117-l5b-evidence/environment.json) 记录环境，[source-hashes.json](20261117-l5b-evidence/source-hashes.json) 记录源文件、签名 fixture、CI 门槛和第 0 波失败基线的 hash。

复核入口：

```bash
python3 specs/004.5-运行时恢复与版本验收/docs/20261117-l5b-evidence/run-checks.py
```

该脚本只重放离线证据，不启动服务或数据库，不安装依赖，不做真实导入。脚本自身退出 0 只表示完成证据采集；必须读取 `results.json` 中的逐项状态，不能把采集成功解释为验收全通过。临时文件路径写在日志中，复核时由脚本重新创建。

## 验收矩阵

下表的 PASS 只适用于“实际检查”列所述范围。需要真实环境的项目单列为 PENDING；不会用 fixture 或源码审查代替端到端结果。

| ID / 来源 | 项目、版本与实际检查 | 结果与证据 | 精确缺失前置 / 后续责任 |
| --- | --- | --- | --- |
| A1 / 004.1 3.1、6.1、9.7 | Desktop 全新安装；登录、基础对话、Bot、Routine、历史消息 | **PENDING**；只复核本地 beta.19 源码及已有资产清单，未安装 | 负责人指定候选 DMG/ZIP/EXE/AppImage 及 SHA-256、空白隔离用户目录/虚拟机、隔离 server 和测试账号、可完成 Bot/Routine 的测试推理配置，以及安装执行授权 |
| A2 / 同上 | CLI / server 全新安装、配置、登录与业务冒烟 | **PENDING**；配置聚焦测试隔离重试 7 PASS，仅代表配置函数 | 指定 CLI/Compose 候选、签名 bundle/校验和、镜像 digest；可丢弃的本地安装目录、PostgreSQL 17、volume 和测试账号；安装及服务启动授权 |
| A3 / 004.1 3.1、9.7 | Android 全新身份安装；iOS 延期项定位 | **PENDING**；Android 实际设备安装未执行，iOS 继续延期 | 指定空白测试设备/模拟器、候选包、签名身份、隔离登录账号及安装授权；iOS 真机另需负责人恢复发布范围和提供签名/profile |
| B1 / 004.1 3.1、7.3、9.7 | `validate-outcomego-backup.ts` 既有测试；当前格式合成备份、错误 hash、同一失败文件重试、旧格式、错误 rowCount、目标表存在的破损引用 | **PASS（离线子项）**；既有 5 项测试 PASS；六次 CLI 校验的接受/拒绝符合预期；[backup-tests.log](20261117-l5b-evidence/backup-tests.log)、[backup-hashes.json](20261117-l5b-evidence/backup-hashes.json) | 不等于真实最新 schema 备份或导入验证；所有九次文件校验的完整输入 SHA-256 均保持不变 |
| B2 / 同上 | 不存在的 `outcomego_nonexistent_table` | **FAIL：应拒绝却退出 0**；[backup-unknown-table.log](20261117-l5b-evidence/backup-unknown-table.log) | 建议数据库/备份脚本负责人处理 F1；本线不修代码 |
| B3 / 同上 | `outcomego_channel.botId=missing`，整个 `outcomego_bot` 表未提供 | **FAIL：应拒绝却退出 0**；[backup-missing-reference-table.log](20261117-l5b-evidence/backup-missing-reference-table.log) | 建议数据库/备份脚本负责人处理 F2；本线不修代码 |
| B4 / 同上 | Outcome WorkItem 指向不存在的 Outcome，且目标 Outcome 表为空 | **FAIL：应拒绝却退出 0**；[backup-outcome-orphan.log](20261117-l5b-evidence/backup-outcome-orphan.log) | 建议数据库/备份脚本负责人协调 Outcome 模型负责人处理 F3 |
| B5 / 004.1 3.1、9.7 | 最新 schema 真实备份校验、导入新实例、导入中断、源文件不变和重新导入 | **PENDING**；没有真实备份或数据库操作 | 负责人提供脱敏且符合当前全部字段的备份、导出时 source commit/schema 指纹、独立目标 PostgreSQL 和导入运行手册；授权导入、故障注入、删除可丢弃目标后重建；F1–F3 处理或明确人工复核前，不以 validator 的成功作为可导入证明 |
| C1 / 004.1 3.2、7.2 | CLI 历史签名 fixture：真实 `localReleaseSigningPayload` + Node 公钥验签；仓库、版本、hash 改动及改名仓库重放 | **PASS（密码学原语子项）**；1 个有效载荷通过，4 个改动载荷拒绝；[cli-signature-primitive.log](20261117-l5b-evidence/cli-signature-primitive.log) | 只证明载荷签名绑定；没有执行 Sigstore 证书、TUF 或透明日志信任验证 |
| C2 / 004.1 3.2 | 当前 CLI 候选的完整 Sigstore 校验和更新链 | **PENDING**；聚焦签名测试在加载期缺 `@sigstore/bundle`，更新安全测试缺 `semver`；[cli-signature-tests.log](20261117-l5b-evidence/cli-signature-tests.log)、[cli-safety-local-exports.log](20261117-l5b-evidence/cli-safety-local-exports.log) | 先在本独立工作树准备已锁定依赖及实际 Sigstore/TUF 所需信任材料，再由负责人提供固定 tag/repository、CLI 候选及 bundle；真实更新另需隔离安装目标和执行授权；缺少独立 `cosign` 并非本测试唯一或必要阻塞 |
| C3 / 004.1 3.2、7.2 | Android 仓库 beta.14 signed manifest fixture + 当前内嵌公钥；改 tag、repository URL、hash、certificate hash、applicationId | **PASS（fixture 密码学子项）**；`openssl dgst` 有效样本 Verified OK，五个改动样本 Verification Failure；`android-signature-*.log` | 未运行 Kotlin/JVM suite、未验证实际 APK 包签名或在线更新，不能外推 beta.19 设备结果 |
| C4 / 004.1 3.2 | Android `android-update.json` 在线下载、验证和覆盖安装 | **PENDING**；没有枚举、连接或修改设备 | 指定设备/序列号、已安装的 `com.outcomego.android` 起始版本及证书、目标 APK/manifest 与 hash、设备可访问的更新源、设备更新授权；旧 `com.teambots.android` 不是同包覆盖升级路径 |
| C5 / 004.1 3.2、7.2 | Desktop updater 诊断、错误分类、cache 隔离、更新文案、固定 `aiTeamOS` userData、共享更新进度函数 | **PASS（聚焦代码子项）**；22 PASS / 0 FAIL；[desktop-local-exports.log](20261117-l5b-evidence/desktop-local-exports.log) | 原始测试加载因工作区包未链接失败，补充运行只通过临时 tsconfig 精确映射本树的四个公开 export，不 mock 实现、不改变断言；不是完整 Desktop suite |
| C6 / 004.1 3.2 | Desktop `latest*.yml` 元数据、候选包下载、验签、应用和重启恢复 | **PENDING**；真实 updater 未启动 | 指定平台的起始安装包、目标 updater 资产/`latest*.yml`/hash、可信签名身份、隔离用户目录和更新源；运行 Desktop、更新及重启授权 |
| D1 / 004.1 7.2 | 本地 beta.19 对错误 tag `v0.1.0-beta.13`；Android/CLI fixture 错误来源 | **PASS（离线子项）**；版本检查预期退出 1；C1/C3 的错误来源均拒绝；[wrong-tag.log](20261117-l5b-evidence/wrong-tag.log) | 不能代替候选平台端到端旧资产混用负例 |
| D2 / 004.1 7.2 | CLI/Desktop/Android 真实旧资产混用、错误仓库、错误 hash、错误 certificate | **PENDING**；没有下载或执行旧/新候选 | 固定平台与版本的两组资产、正确 hash/signature 和安全可控的错误来源 fixture、隔离安装环境及更新授权；本地历史资产前缀 `aiTeamOS-*` 是保留项，前缀本身不构成错误来源证据 |
| E1 / 004.1 6.3；004.5 需求 14 | 关闭 Outcome 新入口后普通聊天/Bot/Routine 继续可用 | **PENDING**；仅核对父 design §16/§36 与本规格 §48 | 已整合的 Outcome 候选、负责人确认的入口关闭/恢复操作、隔离普通聊天与 Routine fixture、状态切换授权；没有在本轮新造 Feature Gate |
| E2 / 004.1 6.3 | 回退上一版本资产、实际旧镜像启动和含 Outcome 数据的 schema 行为 | **PENDING**；未连接数据库、未启动容器、未回退镜像 | 固定旧/新镜像 digest 与对应源码、包含 Outcome 表数据的可丢弃 PostgreSQL、部署前备份及恢复点、回退/启动授权；不能在共享调试项目中代替执行 |
| E3 / 父 design §16 | 当前数据库部署边界静态复核 | **PASS（源码事实）**；认可 marker 但指纹变化且库非空时返回 `initialize` 并执行 `prisma db push`；后者不带 `--accept-data-loss` | 旧镜像遇到新增含数据表可能拒绝的实际结果仍属 E2；正式回退方向仍为关闭入口、保留新镜像和新表 |
| S1 / 辅助静态检查 | 版本一致、Release workflow 资产身份；Android parity schema、assetlinks 模板、11 项 contract 检查；iOS native config | **PASS（静态/contract）**；`version.log`、`workflows.log`、`android-parity.log`、`android-assetlinks.log`、`android-contract.log`、`ios-native-config.log` | Android parity 报告中的 blocked/pending 仍保留；assetlinks 只是模板，contract 的 11 次请求是内存模拟、没有网络；iOS 只核对 version `0.1.0` / build `65` 和静态配置 |

## 失败证据与修复交接

以下三个输入均由本轮合成，不含真实用户数据。`synthetic-backups.json` 保存输入；`backup-hashes.json` 保存完整文件校验前后 SHA-256。对应命令均为真实校验器 CLI，没有替换校验逻辑：

```bash
bun --no-install scripts/migration/validate-outcomego-backup.ts --input <本轮生成的合成样本路径>
```

| 问题 | 复现输入 / SHA-256（前后相同） | 实际行为和代码入口 | 建议负责人及验证 |
| --- | --- | --- | --- |
| F1 未知表名 | `unknownTable`；`900ac809d870b0c5bd3ad11b3dd18a6a0463d5fea044d0332543d1163f964829` | 退出 0，输出 Validated；`validate-outcomego-backup.ts:100` 只验证名称格式，没有与实际 schema 对账 | 数据库/备份脚本负责人；重放 unknown table 样本，预期非零；保留有效样本和原有五项测试 |
| F2 缺少引用目标表 | `missingReferenceTable`；`ddc8d19281e125647b418ecfc088b9d4db2ff79bc775f42ca09ccdcec3ae35d4` | 退出 0；`:155` 的 `ids.has(target)` 使整个目标表未提供时跳过引用验证；目标表为空时既有负例可以拒绝 | 数据库/备份脚本负责人；重放缺目标表和空目标表两个变体，核对完整备份与明确部分备份的合同 |
| F3 Outcome 孤儿引用 | `outcomeOrphan`；`3b0f3bd0451f43a0c30b76b57c9852cdcc74a9fff75f88d5192e68f66402a0cd` | 退出 0；`:123–146` 的引用映射没有覆盖 `outcomeId`；当前 schema 已有 `OutcomeWorkItem.outcome` 外键 | 数据库/备份脚本负责人协调 Outcome 模型负责人；按当前物理模型重放 Outcome 外键负例，不能仅用名称前缀代表最新 schema 验证 |

另有一次实际测试失败：`cli-config-local-exports.log` 中 `writes secret files privately and atomically` 超过既有 5000ms 预算（约 7880ms），该次为 6 PASS / 1 FAIL。未修改测试、未提高超时、未改变实现；相同默认参数隔离重试在 [cli-config-isolated-retry.log](20261117-l5b-evidence/cli-config-isolated-retry.log) 为 7 PASS / 0 FAIL（对应测试约 4ms）。这是本轮观测的时序失败，不计作已修复，也不归入三个已重复确认的校验缺口。若整合验证重现，由 CLI/测试环境负责人排查文件 I/O 和并行负载。

## 回退结论与文档偏差

`packages/db/scripts/deploy-schema.ts:58–62` 在识别到 `ready` 或 `initializing` 前缀且库非空时，即使指纹不同也返回 `initialize`；随后写 initializing marker、执行已有存储整理和 `db push`。`packages/db/test/fresh-schema.integration.test.ts:84–104` 也明确期待 outdated marker 部署成功。这是源码和测试定义的当前边界，本轮未执行该数据库测试。

`004.1/docs/full-rename-import-rehearsal.md` 及任务 9.3 仍保留“任何指纹变化都拒绝”的旧描述；它不能作为回退保护证据。本线按文件所有权保留历史文件，并在 `004.1` 发布结论和本矩阵记录偏差，由文档/数据库负责人后续统一。父 design §16 所述“旧镜像的 `db push` 可能因新表数据而拒绝启动”仍需实际回放。执行前应保存数据库备份和新旧镜像 digest，不能直接把旧资产指向当前共享数据库。

本轮没有验证入口关闭的具体操作，因此不能声称关闭入口已成功；关闭入口、保留新镜像/新表只是既定回退方向，E1/E2 的实际结果继续 PENDING。

## 004.1 PENDING 逐项结论

| 任务 | 本轮结论 | 恢复前置 |
| --- | --- | --- |
| 3.1 | **PENDING**；离线校验完成，真实安装/导入未做；有 F1–F3 | A1–A3、B5 |
| 3.2 | **PENDING**；C1/C3/C5/D1 的局部证据已补，完整签名/设备更新/回退未做 | C2、C4、C6、E2 |
| 6.1 | **PENDING**；候选资产历史快照不能证明新实例可登录或 Bot/Routine 成功 | A1/A2、B5 |
| 6.3 回滚部分 | **PENDING**；两种回退方式的实际结果都没有本轮证据 | E1/E2 |
| 7.2 跨平台旧资产混用 | **PENDING**；错误 tag/仓库/hash 的离线绑定已重放，平台候选混用未做 | D2 |
| 8.3 名称可用性 | **PENDING，非本线执行范围**；未做 npm、域名、商店账号或商标实时查询，已有仓库核查历史结论保留 | 名称负责人提供核查范围/账号及证据；本线不注册或占用名称 |
| 9.7 | **PENDING**；源样本不变已证实，导入/失败导入/删除目标后再导入尚未授权 | B5，先处理 F1–F3 |
| 9.8 | **PENDING，非本线执行范围**；下一次 GHCR 发布、匿名拉取和旧包处理未执行 | 发布负责人另行授权 tag/发布/包可见性操作；本线不触发 |

`7.3` 的历史局部 DONE 不改写；本轮发现的三个 validator 缺口不被历史五项 PASS 覆盖，必须随最终导入验收继续追踪。

## 第 0 波门槛与第 3 波交接

第 0 波失败基线和 `.github/workflows/ci.yml` 没有改动，hash 已归档。父任务 1.3 的 CI 观察仍为原有 PENDING，完整数据库测试继续阻塞；没有跳过或放宽既有测试。该基线中的第 0 波 A 31 个不同失败、第 0 波 B 27 个不同失败是历史全量观测，不能与本轮无数据库聚焦检查相加或宣称本轮修复。

本轮没有运行全量带 PostgreSQL 测试，没有启动任何 Docker、开发、前端、后端、渲染或设备服务，也没有访问远端主机。新安装/导入/更新/回退、真实 Android JVM/设备检查、完整 CLI 签名链仍按上表 PENDING；第 3 波再执行 Desktop/Android/iOS 的 Outcome 深链、通知、登录、主对话和普通聊天回归。没有新增接口、事件、schema 或产品代码。

回滚本线交付时只撤销本线文档/证据提交；不涉及数据库或运行服务。
