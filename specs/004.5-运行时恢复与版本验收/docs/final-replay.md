# 第 3 波恢复与失败回放记录

2026-11-17，task-30 最终本机结果：**四包完整回归 3988 PASS / 0 FAIL / 82 SKIP，另九项专库恢复与六类 CLI 的 40/40 checks 通过。** 发布仍 BLOCKED；真实 Bot/远端/provider、CI、设备及旧镜像门槛不据此放行。

[最终本机结果](../../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)保存精确命令、cwd、环境名称白名单、逐项 skip、42 raw log SHA 和六份实际 JSON。Computer 1360/0/68、Messaging 857/0/0 运行于生产冻结 `5e2ce81d8`；Server 1535/0/11、Worker 236/0/3 运行于纯测试后继 `727d410f2`，**无生产差异**。不混称同一测试树或新全项目 CI。

82 项 package skip 中九项恢复案例使用全局扫描专库隔离，已实际分别运行 startup 6 PASS / 32 assertions、dispatch 3 PASS / 7 assertions；其余 73 项平台/外部 opt-in 未执行。包内 skip footer 保留，不改为 0。

最终六份 JSON 覆盖真实本地 executor exit 137/SIGKILL、重复 finish/D18/Review、连续中断、并发 Decision、真实上传后 receipt 原子回滚/原 key 重试/统一 Review、未知外部回执不自动重发。unknown 使用虚构持久适配器 actualAttemptCount=1；不冒充生产 provider。真实主对话/UI/远端 lease/scoped stop 另待授权回放。

本地指标/诊断可查询与脱敏 canary 通过：包含四个 recovery service DB 案例与 cross-phase 回归；未上报 T 为 null。**没有 live UI 注意力采样、provider 日志、普遍 PII 审计或 latency percentile 证明，分位数 PENDING**。本地服务 canary 不是全环境隐私保证。

同版本 dump/restore 86 表/123 FK 对账通过，dump 保留；Planning/Explore 有数据回退、旧镜像回退仍 PENDING。清理仅本线准确命名的 55439 PG/fixture，结果见最终证据 cleanup.json。

## 历史检查点（保留原始失败，不代表当前本机结果）

以下为首轮及中间检查点记录；原命令、计数、失败原因保留。351 是 failed occurrences，340 个去重 package/file/title keys；Server 294 occurrences 为 283 keys。首轮失败后来实际分派修复，最终整包通过；未以“基线”豁免。

### 首轮回放记录

2026-11-17，task-26 脚手架交付、task-30 实际集中验证。当前状态：**六类本地故障 JSON/数据库对账 PASS；完整回归 BLOCKED**。冻结源码 `b58286ab3` 上完成首次六场景，`af6e9bf6a` 修正并实际重跑 executor 退出证据。完整根命令实际 `6570 PASS / 351 FAIL / 102 SKIP`、退出 1，不能放行发布。

证据与精确命令见 [第 3 波后端组合验收首轮结果](../../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收首轮结果.md)、[六场景 JSON](../../004-OutcomeGo整体项目/docs/20261117-第3波组合验收证据/faults/receipt-retry.json)。各 JSON 的 fixture ID 是本地一次性测试数据，不填写为远端研究试点 ID。

| 项目 | 新增代码/证据 | 实际状态 |
|---|---|---|
| 固定输入/合同 | 父六 fixtures、check-outcome-contracts.ts | 合同检查 PASS，纯检查 13 PASS / 62 assertions |
| 普通 Run 隔离 | outcome-cross-phase-regression.integration.test.ts | 真实 11 PASS / 61 assertions；普通全量仍有失败，隔离任务不整体放行 |
| 六类故障 | test-outcome-recovery.ts 与 server test fixture | 六场景实际 JSON PASS，详见下表 |
| 备份/回退 | 真实故障 fixture 保留期间执行 custom pg_dump / 空库 restore | 同版本 PostgreSQL 86 表 / 123 FK 对账 PASS；Planning/Explore 有数据回退、旧镜像回退仍 PENDING，见[第二检查点](../../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收第二检查点.md) |
| metrics/脱敏 | 新跨阶段 canary、attention 幂等断言 | 真实 DB 的四个 recovery/metrics 用例及跨阶段诊断 canary PASS；远端日志复核 PENDING |
| canonical 测试入口 | 543eef450 的 51 个 legacy test/fixture 文件的 57 处 URL 读取 | 完整 canonical 根命令已执行，351 failed occurrences（340 个去重 package/file/title keys）逐项保留并分派 |

脚本入口：

```bash
bun scripts/test-outcome-recovery.ts --list
bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan
```

上述命令只列出输入。下表 PASS 来自实际不带 `--plan` 的 CLI，完整命令、源码与日志 SHA-256 已归档。

| scenario | 实际 initialState | 注入 ID | replayed | 实际 finalState / Output / Decision | 结果 |
|---|---|---|---|---|---|
| restart-running-run | 见原始 JSON | 实际 Run ID，见 JSON | 见 JSON | running，2 Runs；0 Output / 0 Decision；executor 已退出 137 / SIGKILL | PASS，本地 6 checks |
| duplicate-finish-event | 见原始 JSON | 实际完成事件 ID，见 JSON | 见 JSON | completed / accepted，1 Run；1 Output / 0 Decision | PASS，本地 8 checks |
| interrupted-thread-resume | 见原始 JSON | 实际 Run ID，见 JSON | 见 JSON | needs_review，3 Runs；0 Output / 1 Decision，recoveryCount=2 | PASS，本地 8 checks |
| concurrent-decision | 见原始 JSON | 实际 Decision ID，见 JSON | 见 JSON | running，2 Runs；0 Output / 1 Decision | PASS，本地 5 checks |
| receipt-retry | human_action_pending / waiting_human，1 Run | 实际 receipt.create 故障 ID，见 JSON | 5 | running，2 Runs；0 Output / 0 Decision；统一 Review 后一次续跑 | PASS，本地 9 checks |
| unknown-external-receipt | running / running，1 Run | 实际持久 adapter operation ID，见 JSON | 2 | needs_review，1 Run；0 Output / 1 Decision，无外部重试 | PASS，本地 4 checks |

执行要求见 [组合验证手册](../../004-OutcomeGo整体项目/docs/20261117-第3波组合验证运行手册.md)，JSON 必须由真实服务与数据库查询产生。启动/导入失败只记 FAIL/INCOMPLETE，不写预期数量。JSON 在 fixture 清理前保存，不覆盖历史证据。

本地 restart 的进程退出只确认该脚本拥有的 executor；远端 Computer turnCancel/lease fencing 尚未回放。unknown 通过虚构持久适配器丢失回执和明确 unknown 输入验证实际恢复服务，不覆盖真实 provider 的完整发送/查询链。Human receipt 提交后必须等统一 Review，Review 后才续跑；D18 consumer 的 processed=true 也包括幂等重放，以 projected/实际回执数证明没有重复通知。

历史第 0 波和本次完整数据库失败均继续阻塞。当前接纳修复 `ee61def62` 后，本线实际定向复验 64 PASS / 609 assertions / 13 files；这不能替代完整回归或将原始 351 项失败抹去。精确 `948ead5de` 基线另库对照，选定 4 个 worker 文件的 20 个失败、4 个 server 文件的 18 个失败与原始根日志完全同名；历史同名不是豁免。详见首轮结果、[失败基线](../../004-OutcomeGo整体项目/docs/test-failure-baseline.md) 与 [入口补齐记录](../../004-OutcomeGo整体项目/docs/20261117-数据库测试入口补齐记录.md)。
