# 第 3 波恢复与失败回放记录

2026-11-17，task-26 脚手架交付、task-30 实际集中验证。当前状态：**六类本地故障 JSON/数据库对账 PASS；完整回归 BLOCKED**。冻结源码 `b58286ab3` 上完成首次六场景，`af6e9bf6a` 修正并实际重跑 executor 退出证据。完整根命令实际 `6570 PASS / 351 FAIL / 102 SKIP`、退出 1，不能放行发布。

证据与精确命令见 [第 3 波后端组合验收首轮结果](../../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收首轮结果.md)、[六场景 JSON](../../004-OutcomeGo整体项目/docs/20261117-第3波组合验收证据/faults/receipt-retry.json)。各 JSON 的 fixture ID 是本地一次性测试数据，不填写为远端研究试点 ID。

| 项目 | 新增代码/证据 | 实际状态 |
|---|---|---|
| 固定输入/合同 | 父六 fixtures、check-outcome-contracts.ts | 合同检查 PASS，纯检查 13 PASS / 62 assertions |
| 普通 Run 隔离 | outcome-cross-phase-regression.integration.test.ts | 真实 11 PASS / 61 assertions；普通全量仍有失败，隔离任务不整体放行 |
| 六类故障 | test-outcome-recovery.ts 与 server test fixture | 六场景实际 JSON PASS，详见下表 |
| 备份/回退 | 真实故障 fixture 保留期间执行 custom pg_dump / 空库 restore | 同版本 PostgreSQL 86 表 / 123 FK 对账 PASS；Planning/Explore 有数据回退、旧镜像回退仍 PENDING，见[第二检查点](../../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收第二检查点.md) |
| metrics/脱敏 | 新跨阶段 canary、attention 幂等断言 | 真实 DB 的四个 recovery/metrics 用例及跨阶段诊断 canary PASS；远端日志复核 PENDING |
| canonical 测试入口 | 543eef450 的 51 个 legacy test/fixture 文件的 57 处 URL 读取 | 完整 canonical 根命令已执行，351 项失败逐一保留并分派 |

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
