# 第 3 波恢复与失败回放记录

2026-11-17，task-26。状态：**实现已交接，实际数据库/组合回放 PENDING**。负责人要求所有代码先合入再集中验证；本次没有创建测试库或启动服务器。

| 项目 | 新增代码/证据 | 实际状态 |
|---|---|---|
| 固定输入/合同 | 父六 fixtures、check-outcome-contracts.ts | 最小测试通过，运行时 PENDING |
| 普通 Run 隔离 | outcome-cross-phase-regression.integration.test.ts | 11 个 DB 用例已编写，未执行 |
| 六类故障 | test-outcome-recovery.ts 与 server test fixture | 6 个真实 DB 场景已编写，未执行 |
| 备份/回退 | 组合验证手册的 pg_dump/restore/两级回退步骤 | 未执行 |
| metrics/脱敏 | 新跨阶段 canary、attention 幂等断言 | 已编写，DB 未执行 |
| canonical 测试入口 | 543eef450 的 51 个 legacy test/fixture 文件的 57 处 URL 读取 | 3 个纯 gate 测试、51 文件语法检查通过；扩展后的 DB 集合未执行 |

脚本入口：

```bash
bun scripts/test-outcome-recovery.ts --list
bun scripts/test-outcome-recovery.ts --scenario receipt-retry --plan
```

上述命令只列出输入；不得据此把任何下表结果标为 PASS。

| scenario | 实际 initialState | 注入 ID | replayed | 实际 finalState / Output / Decision | 结果 |
|---|---|---|---|---|---|
| restart-running-run | 尚未生成 | 尚未生成 | 未执行 | 未对账 | PENDING |
| duplicate-finish-event | 尚未生成 | 尚未生成 | 未执行 | 未对账 | PENDING |
| interrupted-thread-resume | 尚未生成 | 尚未生成 | 未执行 | 未对账 | PENDING |
| concurrent-decision | 尚未生成 | 尚未生成 | 未执行 | 未对账 | PENDING |
| receipt-retry | 尚未生成 | 尚未生成 | 未执行 | 未对账 | PENDING |
| unknown-external-receipt | 尚未生成 | 尚未生成 | 未执行 | 未对账 | PENDING |

执行要求见 [组合验证手册](../../004-OutcomeGo整体项目/docs/20261117-第3波组合验证运行手册.md)，JSON 必须由真实服务与数据库查询产生。启动/导入失败只记 FAIL/INCOMPLETE，不写预期数量。JSON 在 fixture 清理前保存，不覆盖历史证据。

本地 restart 的进程退出只确认该脚本拥有的 executor；远端 Computer turnCancel/lease fencing 尚未回放。unknown 通过虚构持久适配器丢失回执和明确 unknown 输入验证实际恢复服务，不覆盖真实 provider 的完整发送/查询链。Human receipt 提交后必须等统一 Review，Review 后才续跑；D18 consumer 的 processed=true 也包括幂等重放，以 projected/实际回执数证明没有重复通知。

历史第 0 波数据库失败和第 1 波完整 worker/messaging 的已知失败仍阻塞。第 1 波集成负责人曾观察到组合 553 PASS/39 files、7 包 types 通过；这是该历史 source 的其他 owner 证据，不能作为本次 17 个新 DB 测试或扩展 canonical 全量的结果。详见 [失败基线](../../004-OutcomeGo整体项目/docs/test-failure-baseline.md) 与 [入口补齐记录](../../004-OutcomeGo整体项目/docs/20261117-数据库测试入口补齐记录.md)。
