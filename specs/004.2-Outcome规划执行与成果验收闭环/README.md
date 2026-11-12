# Spec 004.2：Outcome 规划执行与成果验收闭环

规格编号：`004.2`

状态：草案

日期：2026 年 11 月 11 日。

父规格：[Spec 004：OutcomeGo 整体项目](../004-OutcomeGo整体项目/README.md)

本 Spec 合并 Outcome 核心模型、Contract、规划闭环、OpenTeam 执行和成果验收。它是项目的第一条完整产品价值主链路，不拆分为多个技术 Spec。

目标流程：

```text
用户请求
  → 目标/验收/边界规划
  → Contract 草案
  → 用户批准
  → WorkItem / OpenTeam Run
  → 输出与 Evidence
  → 逐项验收
  → Outcome 结果
```

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)

## 可实施边界

本阶段是一个可运行的垂直产品切片，不是只定义数据库模型。实现完成后，测试人员必须能够使用固定输入创建 Outcome，完成三维规划和批准，触发现有 OpenTeam Run，读取输出，提交 Evidence，并得到逐条验收结果。

当前代码中的可复用主链路：

- 用户输入和 Bot DM：`apps/server/src/services/channel-service.ts`。
- Run 创建、取消和状态：`apps/server/src/services/run-service.ts`、`packages/db/prisma/schema.prisma` 的 `Run`。
- Agent 可见消息：`apps/server/src/services/internal-tool-service.ts`、`ChannelMessage.sourceRunId`。
- Worker 执行：`apps/worker/src/worker.ts`、`apps/worker/src/runtime-dispatch.ts`。
- 共享协议：`packages/contracts/src/`。
- 数据库迁移：`packages/db/prisma/migrations/`。

本阶段采用最小 Contract 结构，允许后续扩展，但不把六部分 Contract、复杂审批等级或通用流程编辑器一次性实现。三组规划是用户确认的核心；Budget 只作为可选字段，恢复信息由 `004.5` 负责，本项目不保存动作授权字段（父 design.md §40）。验收不合格时可以直接返工（design.md §32）。
