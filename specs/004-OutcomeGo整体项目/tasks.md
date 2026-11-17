# 任务清单 - OutcomeGo 整体项目（人话版）

状态：IN_PROGRESS

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

2026-11-17 整理：合并了原来重复的“父级执行检查点”“阶段 4 父级交付检查点”“父级阶段检查”三组任务，统一为下面的阶段 0–3；任务编号重新排列。

## 状态说明

`TODO`、`IN_PROGRESS`、`BLOCKED`、`PENDING`（缺外部环境或设备，不能写成 PASS）、`DONE`、`CANCELLED`。只有 `DONE` 的任务才能勾选。

## 阶段 0：准备、决策和更名

- [x] 1.1 建立 `004` 及 `004.1`–`004.5` Spec 目录
  - 状态：DONE
  - 证据：`specs/004*` 目录、README、requirements/design/tasks/docs 均存在并相互链接；提交 `a6459787a`。
  - 对应需求：全部需求
  - 对应设计：`design.md` §3

- [x] 1.1a 确认决策基线和原规划覆盖
  - 状态：DONE
  - 证据（2026-11-17）：负责人确认 D01、D03、D05、D07；新增 D09（主线程 + 子线程执行模型）为已确认；D10–D20 为默认基线并写明确认时点（`design.md` §39）。覆盖核对文档已更新原规划路径和子线程相关落点。
  - 开始前先看：`data/20261110-OutcomeGo-项目总体规划与ai-TeamOS迁移方案-v1.1.md` §20、[`docs/20261112-OutcomeGo总体规划覆盖核对.md`](docs/20261112-OutcomeGo总体规划覆盖核对.md)
  - 对应需求：需求 11、需求 12
  - 对应设计：`design.md` §39、§40、§41

- [x] 1.2 完成 `004.1` 项目更名与下一版本发布
  - 状态：DONE（带已知 PENDING 项）
  - 证据：`004.1/tasks.md` “收尾记录”；`004.1/docs/release-decision.md`；`004.1/docs/release-asset-inventory.md`。OutcomeGo 自 `v0.1.0-beta.14`（2026-11-12）启用，当前 Latest 为 `v0.1.0-beta.19`。
  - 已知 PENDING：真实设备新安装、手动备份导入、回滚演练、跨平台旧资产混用负例、名称可用性核查。由任务 3.1 在最终验收中复核。
  - 对应需求：需求 1
  - 对应设计：`design.md` §6

- [ ] 1.3 修复 `OutcomeGo` 分支 CI 的 `checks` job
  - 状态：PENDING（本地已执行组合验收零失败；未授权推送、未观测 GitHub CI，不能冒称远端 checks 已绿）
  - 最终本地复核（2026-11-17）：最新 Computer / messaging / server / worker / Desktop / contracts 六个完整包命令合计 4950 PASS / 0 FAIL / 83 SKIP；十个专库恢复 / enrollment 用例另行实际通过，六类 CLI 40 checks 通过；七包完整类型、架构 / workflow / 静态检查通过。生产冻结 `5e2ce81d8` 与纯测试后继 `727d410f2` 分列，来源和原始日志见[组合验证总账](docs/20261117-全规格组合验证与修复记录.md)和[后端最终本机结果](docs/20261117-第3波后端组合验收最终本机结果.md)。历史失败仍保留，不以基线豁免或推测扣除替代复验；该本地证据不满足本任务“远端全部 job 成功”的完成标准。
  - 组合验收修复（2026-11-17）：原 `read-transcript.integration.test.ts:51` 失败已修复，来源 `7e6b0e028` → `49a7500c6`。原集成测试文件及隐私断言未改；补充真实 Computer 写图 → 持久历史 → Native Read 图片验证。integrator 实际重跑三个 transcript 文件与 Routine schema 文件共 25 PASS / 0 FAIL / 217 assertions，见[截图修复证据](../004.5-运行时恢复与版本验收/docs/20261117-历史截图回执修复与验证.md)。规范测试库变量激活后，广泛测试新观测仍须逐项分类和修复；不沿用旧 14 项计数，不声称全量或 CI 通过。
  - 后续波次代码进展（2026-11-17）：`543eef450` → 集成 `8667c7ba6` 将 51 处历史测试 / fixture 的数据库读取改为规范 `OUTCOMEGO_TEST_DATABASE_URL ?? OPENTEAM_TEST_DATABASE_URL`，保留专用隔离库优先级，未删除断言、skip 条件或工作流。该改动扩大规范命令实际激活的数据库用例，最终全量结果及失败身份比较待全部代码整合后统一执行；不能沿用旧计数宣称通过。见[后续波次集成记录](docs/20261117-后续波次代码集成记录.md)。
  - 第 0 波 A 证据：规格 `2b9211c16`；偶发测试 `c686edae0`；SQL 表名 `5b9d4dc99`；004.2 阶段 1 `69e5edd7c`；CI/基线 `b7ff0099a`；[失败基线](docs/test-failure-baseline.md)。`checks` 增加 PostgreSQL 17、schema 部署和完整数据库测试；`turbo.json` 放行测试库环境。负责人选择全部数据库测试阻塞，未删除或跳过测试。
  - 这一步到底做什么：2026-11-17 起 `CI` workflow 的 `checks` job 在 `209c770e6`、`3b02ebfe6` 上失败。恢复绿色基线，否则无法判断 Outcome 改动是否引入回归。
  - 进展（2026-11-17，本地，未推送）：最近 4 次失败各不相同，属于 CI runner 上的偶发失败。已修复两项：`packages/plugins/wechat/connector/test/secrets.test.ts`（列目录时原子写临时文件已被重命名导致 ENOENT）、`packages/plugin-sdk/src/runtime-assets.test.ts`（20,001 条 tar 头的测试在 runner 上超过 5 秒默认超时）。仍待观察：Desktop code highlighter 测试、transport/acknowledgement 测试（run `43983034791`、`43980957724`）。
  - 本地带数据库运行时发现的既有问题（基线提交 `3b02ebfe6` 上同样失败，与 Outcome 改动无关；CI 未设置 `OUTCOMEGO_TEST_DATABASE_URL`，所以没有暴露）：
    - 已修复：`packages/messaging/src/read-transcript.ts` 原始 SQL 仍查询更名前的表 `"message"`，生产环境 ReadTranscript 读取子 Agent 记录会报 `relation "message" does not exist`。已改为 `"outcomego_message"`。
    - 历史观测：`packages/messaging/test/read-transcript.integration.test.ts:51`（Computer 工具截图路径断言）现已按上述组合验收记录修复；当时 worker 集成测试 14 项失败，其中已抽查 `apps/worker/test/lifecycle.integration.test.ts`（bootstrap 欢迎消息断言），在基线上同样失败。该历史观测不代替本轮扩大覆盖后的实际结果。
  - 先依赖什么：无
  - 主要改哪里：按失败日志定位
  - 怎么算完成：`OutcomeGo` 分支最新提交 `CI` 全部 job 成功。
  - 怎么验证：`gh run list -R jingyi0605/OutcomeGo --branch OutcomeGo --workflow CI`
  - 对应需求：需求 9
  - 对应设计：`design.md` §25

- [x] 1.4 完成并行开发第 0 波接口冻结与依赖同步
  - 状态：DONE（2026-11-17，本地）
  - 先依赖什么：1.3 的本地基线提交 `b7ff0099a`；负责人选择全部数据库测试阻塞，接受现有失败使 CI 暂红。1.3 的远端绿色检查点继续 PENDING。
  - 实现提交：`23bc29151`（contracts）、`ad4b5de94`（共享实现、测试和接入）。
  - 修改文件：`packages/contracts/src/{outcomes,index}.ts`；`packages/messaging/src/outcome-{state,threads,actions}.ts`、`testing/outcome-thread-fake.ts`、导出和测试；Server Outcome/InternalTool 服务；Computer marker 传递、工具注册点与快照测试；父/子规格依赖说明。
  - 数据库变化：无（复用第 0 波 A 模型）。
  - 验证命令：六个受影响包 typecheck、`bun run check:architecture`、`bun run check:workflows`、Outcome 定向数据库测试、工具快照、完整数据库测试与基线隔离复核。
  - 验证结果：类型/架构/workflow 通过；定向 334 + 64 项通过；全量存在已记录失败，四个第二次才出现的失败在 A/B 隔离回放中均通过。
  - 证据文件：[接口冻结](docs/parallel-interfaces.md)、[失败基线与比较](docs/test-failure-baseline.md)。
  - 已知限制：`enqueueOutcomeTurn/settleOutcomeWorkItem` 是线 1 占位签名；Decision/人工工具尚未登记；`unavailableHumanActionPort` 明确报错；未推送、未重建远端 computer。
  - 回滚方式：撤销第 0 波 B 实现提交，保留 A 的基础模型和测试证据。
  - 对应需求：需求 6、需求 7、需求 10、需求 13。
  - 对应设计：§14、§26、§39、§42–§45；[接口冻结](docs/parallel-interfaces.md)。

## 阶段 1：核心产品闭环

- [ ] 2.1 完成 `004.2` Outcome 规划执行与成果验收闭环
  - 状态：IN_PROGRESS（全部已分配代码及本地组合验证完成；真实 Bot / 远端子线程端到端和子规格最终检查点仍 PENDING）
  - 先依赖什么：1.2
  - 开始前先看：`../004.2-Outcome规划执行与成果验收闭环/` 三个主文档
  - 主要改哪里：由 `004.2/tasks.md` 定义，包含实际文件路径和验证命令
  - 这一步先不做什么：不加入现实任务和复杂通知系统。
  - 怎么算完成：`004.2` 最终检查点为 DONE；至少一条研究任务在 Outcome 子线程中完成端到端验收。
  - 怎么验证：回放用户输入、Contract、子线程运行组、Evidence 和验收结果。
  - 对应需求：需求 2、需求 13
  - 对应设计：`design.md` §3、§45

- [ ] 2.2 完成 `004.3` Outcome 收件箱与决策通知
  - 状态：IN_PROGRESS（全部已分配代码、本地通知 / 决策 / 恢复测试及客户端编译 / 单元证明完成；真实通知送达、设备 UI / live API 和子规格最终检查点仍 PENDING）
  - 先依赖什么：第 0 波 A/B；`004.2` 任务 1.2、1.3 提供模型；Decision 续跑依赖 `004.2` 3.2、3.4，事件接入依赖 4.2；不等待 `004.2` 最终检查点。
  - 开始前先看：`../004.3-Outcome收件箱与决策通知/` 三个主文档
  - 这一步先不做什么：不建设通用消息中心。
  - 怎么算完成：`004.3` 最终检查点为 DONE；Desktop、Android、iOS 都能查看 Inbox 并解决 Decision。
  - 怎么验证：完成通知、暂停、决策和子线程继续执行回放。
  - 对应需求：需求 3、需求 13
  - 对应设计：`design.md` §4、§45

- [ ] 2.3 完成 `004.4` 现实任务与知识资料闭环
  - 状态：IN_PROGRESS（工具、真实资料来源、资产回执、唯一 Review / requester continuation、Explore 代码和本地验证完成；真实客户端端到端与子规格最终检查点仍 PENDING）
  - 先依赖什么：第 0 波 B；资料和人工表/API 骨架依赖 `004.2` 1.2、1.3；工具来源依赖 `004.2` 3.2、3.4 和 `004.3` 1.3，回执验收依赖 `004.2` 4.2。
  - 开始前先看：`../004.4-现实任务与知识资料闭环/` 三个主文档
  - 这一步先不做什么：不把人工动作自动执行成 Agent 动作。
  - 怎么算完成：`004.4` 最终检查点为 DONE；人工动作卡、资料来源、人工回执和验收能够闭环。
  - 怎么验证：回放一个人工执行任务。
  - 对应需求：需求 4
  - 对应设计：`design.md` §5

- [ ] 2.4 完成 `004.5` 运行时恢复与版本验收
  - 状态：IN_PROGRESS（本地恢复隔离、六故障、metrics / canary 查询已通过；跨客户端安装、真实 provider / Computer、完整旧镜像及有数据回退未完成）
  - 先依赖什么：第 0 波 B；恢复依赖 `004.2` 3.2、3.4；Decision 路由依赖 `004.3` 1.3、1.4；`004.1` 遗留运维验证可先行，最终回放依赖产品闭环。
  - 开始前先看：`../004.5-运行时恢复与版本验收/` 三个主文档
  - 这一步先不做什么：不建设泛化安全平台或复杂权限体系。
  - 怎么算完成：`004.5` 最终检查点为 DONE。
  - 怎么验证：故障回放、新安装/导入回放和父 Spec 端到端回放。
  - 对应需求：需求 5、需求 13
  - 对应设计：`design.md` §6、§45

## 阶段 2：跨阶段一致性

- [x] 3.0 建立跨阶段 fixture 目录和 ID 关系
  - 状态：DONE（2026-11-17，本地固定 fixture、schema / ID / 事件检查及实际 CLI JSON 已核实；不代表安装、远端或父级场景 A–H 全部完成）
  - 最终证据：六个固定 fixture、静态检查、跨阶段数据库测试、六类故障真实初态 / 请求 / ID / 终态及清理记录均存在；最终六 CLI 40 checks 和十个专库恢复 / enrollment 用例独立通过，见[组合验证总账](docs/20261117-全规格组合验证与修复记录.md)。下列“第 3 波”字段是 task-26 开闸前的来源历史，保持原样，不再作为当前尚未执行的声明。
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 第 3 波验证命令：`bun test ./scripts/check-outcome-contracts.test.ts ./scripts/outcome-recovery/report.test.ts ./scripts/check/test-database-gates.test.ts`；`bun scripts/check/outcome-regression-types.ts`；`bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan`；`git diff --check`。
  - 第 3 波验证结果：13 PASS / 0 FAIL / 62 assertions；14 个本线文件语义诊断 0、依赖诊断 0；51 个旧测试文件语法通过；11+6 个新 DB 测试、六场景实际 JSON/DB 对账及备份回退均 PENDING。
  - 第 3 波证据文件：[第3波回归脚手架交接](docs/20261117-第3波回归脚手架交接.md)；同目录组合验证手册/合同矩阵/数据库入口补齐记录；`004.5/docs/final-replay.md` 和 `release-decision.md`。
  - 第 3 波已知限制：canonical 入口补齐已扩大覆盖，新的完整失败数未知；历史 canonical/dual-flag 基线分别保留且数据库失败仍阻塞；远端 CI/Computer/真实模型、安装与旧镜像未验，不宣称 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 先依赖什么：`004.2` 任务 0.2（研究试点 fixture）
  - 这一步到底做什么：为研究任务、Decision、人工任务、重复事件、新安装导入和发布资产建立固定输入和预期状态。
  - 做完你能看到什么：`docs/fixtures/` 下 `research-outcome.json`、`decision-pending.json`、`human-action.json`、`duplicate-event.json`、`fresh-install-import.json`、`release-assets.json`，以及清理说明。
  - 这一步先不做什么：不引用生产账号、真实 token 或私有资料。
  - 怎么算完成：每个 fixture 有初始数据、请求顺序、预期状态、关键 ID 和清理方法。
  - 怎么验证：fixture schema 检查和 dry-run。
  - 对应需求：需求 2、需求 4、需求 5、需求 6
  - 对应设计：`design.md` §23、§37

- [ ] 3.0a 跨阶段 API、事件和数据库合同复核
  - 状态：IN_PROGRESS（2026-11-17，全部本地合同 / Schema / 工具 / API / 客户端 / 恢复组合复核完成；父级真实环境最终验收仍 PENDING）
  - 最终本地证据：所有已分配源码与修复均已整合并独立源码审查关闭；纯测试后继相对最终生产冻结只有六个已审测试文件差异。六完整包零失败、十个隔离 DB 用例和六 CLI 的 40 checks 通过，七完整类型 / 架构 / workflow / fixture 通过；Android shared 43 + app 86、Swift 329 为客户端执行者的实际证据，Desktop 真实生产 bundle 为 integrator 实际执行。来源、映射、原始 SHA、已知 skip 与外部门见[组合验证总账](docs/20261117-全规格组合验证与修复记录.md)。本地合同证据已完成，仍不把父级真实安装 / provider / 设备 / 远端与发布检查点勾为 DONE。
  - 后续波次进展：[代码集成与覆盖矩阵](docs/20261117-后续波次代码集成记录.md) 从 `948ead5de` 继续，整个 Spec004 剩余代码及明确必做的 Explore 已整合，包括共享 Schema / 合同、Decision / 人工回执 / 恢复服务、真实工具 / 路由和客户端桥接。代码阶段只执行必要的编译与定向合并检查；后端、移动端、独立审查及静态合同的统一验收由负责人下一阶段启动。定向集成检查与所有者证据分列，正式验收仍未完成，本父任务保持未勾选。
  - 第 3 波本线验收状态：BLOCKED（2026-11-17，task-26 代码交付及最小检查完成；按负责人要求集中数据库/回放待执行，未满足正式验收；此项为来源线状态，不覆盖父任务正在进行的整合与验证）
  - 第 3 波实现提交：`2d9eaeb43`、`e00496f5e`、`543eef450`、`d4de4846e`、`d330efc34`、`80ea59865`；`870ebac90` 仅为本线编译所需依赖合并，不拾取到集成线。
  - 第 3 波修改文件：父六 JSON/合同检查脚本；`scripts/test-outcome-recovery.ts`、`scripts/outcome-recovery/`、`apps/server/test/fixtures/outcome-recovery/`、新 cross-phase 测试；本任务文档。51 个既有测试文件的精确清单见交接与入口补齐记录。
  - 第 3 波数据库变化：none（本线不改 schema；恢复计数等为其他线原始提交依赖；没有启动或连接本线测试库）。
  - 第 3 波验证命令：`bun test ./scripts/check-outcome-contracts.test.ts ./scripts/outcome-recovery/report.test.ts ./scripts/check/test-database-gates.test.ts`；`bun scripts/check/outcome-regression-types.ts`；`bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan`；`git diff --check`。
  - 第 3 波验证结果：13 PASS / 0 FAIL / 62 assertions；14 个本线文件语义诊断 0、依赖诊断 0；51 个旧测试文件语法通过；11+6 个新 DB 测试、六场景实际 JSON/DB 对账及备份回退均 PENDING。
  - 第 3 波证据文件：[第3波回归脚手架交接](docs/20261117-第3波回归脚手架交接.md)；同目录组合验证手册/合同矩阵/数据库入口补齐记录；`004.5/docs/final-replay.md` 和 `release-decision.md`。
  - 第 3 波已知限制：canonical 入口补齐已扩大覆盖，新的完整失败数未知；历史 canonical/dual-flag 基线分别保留且数据库失败仍阻塞；远端 CI/Computer/真实模型、安装与旧镜像未验，不宣称 CI 全绿。
  - 第 3 波回滚方式：只撤销本线脚手架、测试 URL 回退与文档提交；保留其他线依赖、真实 Outcome/人工证据和旧 l1 原始日志。
  - 证据：[第 1 波集成验证记录](docs/20261117-第1波集成验证记录.md)。schema/contracts 分批并集合入，保留 L1/L2 共享服务方法和第四参数撤回回调；最终组合定向数据库/合同/工具/Desktop/Stop 553 PASS（39 文件、2315 断言），7 包类型通过。内部事件流过滤、未消费 Evidence 保留、开放 Decision/HumanAction 验收门槛、永久 Decision 通知恢复、取消重绑定与停止事实均已有实际定向验证和审查闭环。完整父级合同矩阵/后续波次和真实端到端尚未结束，不勾选本父任务；1.3 的远端 CI 继续 PENDING。
  - 先依赖什么：2.1、2.2、2.3、2.4 各自的模型任务
  - 这一步到底做什么：核对各子 Spec 使用的 DTO、事件名（只能使用 §14 目录）、revision、idempotency key 和 schema 变更是否一致。
  - 做完你能看到什么：`docs/cross-phase-contract-matrix.md`，每个跨阶段载荷都有生产者、消费者和兼容行为。
  - 这一步先不做什么：不通过修改测试快照掩盖合同不一致。
  - 怎么算完成：没有重复的业务事实来源、冲突的字段语义、未登记的事件名或无法解析的事件。
  - 怎么验证：合同静态检查（扫描 `topic:` 字面量是否都在 §14 目录或现有运行时主题中）、事件 fixture、数据库 relation 检查。
  - 对应需求：需求 6、需求 7、需求 8
  - 对应设计：`design.md` §14、§16、§17、§29

## 阶段 3：最终验收

- [ ] 3.1 执行全局场景 A–H
  - 状态：PENDING（本地固定场景与故障 / 合同回放已完成；真实安装 / 导入、远端 Computer / provider、设备 UI 和完整回退场景未完成）
  - 先依赖什么：2.1–2.4 最终检查点、3.0、3.0a
  - 这一步到底做什么：按固定 fixture 回放新安装/导入、规划执行（含主对话不被打断）、Decision、人工任务、重复事件、Contract 变更、外部内容、验收失败返工和旧客户端兼容；同时复核 `004.1` 的已知 PENDING 项。
  - 做完你能看到什么：`docs/final-replay.md`，包含每个步骤、ID、命令和结果。
  - 这一步先不做什么：不在最终回放阶段新增功能。
  - 怎么算完成：场景 A–H 全部有结论，失败项明确为 BLOCKED/PENDING/FAIL。
  - 怎么验证：父级 replay 命令和人工验收矩阵。
  - 对应需求：需求 1–9、需求 13
  - 对应设计：`design.md` §19–§24、§37、§45

- [ ] 3.2 父级发布/回滚结论
  - 状态：PENDING（当前本地结论零失败；正式发布仍不放行，远端 CI、设备 / 安装和完整回退缺证据）
  - 先依赖什么：3.1
  - 这一步到底做什么：汇总版本、schema 变更、构建、测试、PENDING 证据、回滚方式和责任人。
  - 做完你能看到什么：`docs/release-decision.md`。
  - 这一步先不做什么：不以“稍后补测试”替代硬门槛；不把缺少设备/账号的检查写成 PASS。
  - 怎么算完成：结论为 PASS/PENDING/FAIL，下一步明确。
  - 怎么验证：逐项检查父/子 requirements、design、tasks 和证据。
  - 对应需求：需求 9、需求 10
  - 对应设计：`design.md` §34、§36

- [ ] 3.3 父 Spec 最终检查点
  - 状态：PENDING（全部已分配代码完成不等于全部子规格正式验收完成；保留上列外部与父级端到端门槛）
  - 先依赖什么：3.2
  - 怎么算完成：所有子 Spec 最终检查点为 DONE，父级场景 A–H 有实际验证记录，覆盖核对文档没有未归属项。
  - 怎么验证：按本文件“父级质量检查清单”逐项核对。
  - 对应需求：全部需求
  - 对应设计：全文

## 任务执行规则

每个子任务开始前确认：已读对应 `requirements.md` 和 `design.md` 章节；依赖任务为 `DONE`；明确要改和不改的文件；测试环境可用。

每个任务完成时回写：

```text
状态：DONE / BLOCKED / CANCELLED
实现提交：<commit>
修改文件：<paths>
数据库变化：<schema 变更摘要 or none>
验证命令：<commands>
验证结果：<pass/fail/pending>
证据文件：<path>
已知限制：<list>
回滚方式：<method>
```

## 父级质量检查清单

- [ ] 所有 `requirements.md` 都有 In Scope、Out of Scope、验收标准、非功能需求和成功定义。
- [ ] 所有 `design.md` 都有当前代码基线、文件影响、验证策略、状态/API/数据合同；设计决策只引用 §39 编号。
- [ ] 所有 `tasks.md` 都有依赖、文件、明确不做、完成标准和验证命令；最终检查点引用的需求范围与 requirements 一致。
- [ ] 每个子 Spec 的 README 链接到三个主文档和 docs/README。
- [ ] 没有任务通过“由其他 Spec 定义”省略实际执行入口。
- [ ] 所有事件名都来自 `design.md` §14 目录。
- [ ] 没有任何 Spec 按多 owner 设计查询或测试（§44）。
- [ ] 没有将安全建议扩展为当前项目之外的通用平台；没有任何 Spec 宣称工具动作被拦截或阻止（§40）。
- [ ] 父级场景 A–H 使用固定 fixture，不依赖生产账号。
- [ ] 原规划覆盖核对文档与各子 Spec 需求一致，没有未归属项。
- [ ] 所有发布和外部环境检查区分 PASS、PENDING 和 FAIL。
