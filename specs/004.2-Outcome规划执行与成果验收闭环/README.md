# Spec 004.2：Outcome 规划执行与成果验收闭环

规格编号：`004.2`

状态：实施中（阶段 0 完成，进入阶段 1）

日期：2026 年 11 月 11 日创建；2026 年 11 月 17 日按“主线程 + 子线程”执行模型更新。

父规格：[Spec 004：OutcomeGo 整体项目](../004-OutcomeGo整体项目/README.md)

本 Spec 合并 Outcome 核心模型、Contract、规划闭环、OpenTeam 执行和成果验收。它是项目的第一条完整产品价值主链路，不拆分为多个技术 Spec。

目标流程：

```text
用户请求
  → 目标/验收/边界规划
  → Contract 草案
  → 用户批准
  → WorkItem / Outcome 子线程（不打断 Bot 主对话）
  → 输出与 Evidence
  → 逐项验收
  → Outcome 结果
```

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)
- [普通对话原生目标工具开发与验证（2026-11-18）](docs/20261118-对话目标工具开发与验证.md)

## 可实施边界

本阶段是一个可运行的垂直产品切片，不是只定义数据库模型。实现完成后，测试人员必须能够使用固定输入创建 Outcome，完成三维规划和批准，在 Outcome 子线程中执行，读取输出，提交 Evidence，并得到逐条验收结果；执行期间同一 Bot 的主对话不受影响。

当前代码中的可复用主链路（详见 [`docs/runtime-capability-matrix.md`](docs/runtime-capability-matrix.md)）：

- 入队唤醒：`packages/messaging/src/index.ts` 的 `enqueueWake`（不使用会顶替当前回合的 `acceptDirectUserMessage`）。
- 子线程模式的先例：Routine 的 `automation` 上下文和 `automation:<id>` 租约（`apps/worker/src/worker.ts:198`、`:1307`），运行组判断 `packages/messaging/src/automation-results.ts`。
- Run 取消和状态：`apps/server/src/services/run-service.ts`、`packages/db/prisma/schema.prisma` 的 `Run`。
- Worker 执行：`apps/worker/src/worker.ts`、`apps/worker/src/projection.ts`（写入 `run.started`/`run.completed` 事件）。
- 共享协议：`packages/contracts/src/`。
- 数据库：`packages/db/prisma/schema.prisma`，通过 `db:push` 部署（父 design §16）。

执行模型见父 design §45 和本 Spec design §12；相关决策 D09–D15 见父 design §39。

本阶段采用最小 Contract 结构，允许后续扩展，但不把六部分 Contract、复杂审批等级或通用流程编辑器一次性实现。三组规划是用户确认的核心；Budget 只作为可选字段，恢复信息由 `004.5` 负责，本项目不保存动作授权字段（父 design.md §40）。验收不合格时可以直接返工（design.md §32）。

- [2026-11-18 对话阶段卡片与渐进披露验证](docs/20261118-对话目标卡片与渐进披露开发验证.md)。

- [2026-11-18 决策优先语义总览与三级披露验证](docs/20261118-决策优先目标总览与三级披露验证.md)（需求 23、设计 §37，修正初版仅折叠原文的问题）。

- [2026-11-18 审批选项与行内来源渐进披露验证](docs/20261118-审批选项与行内来源渐进披露验证.md)（需求 24、设计 §38，审批选择替代全文确认框，资料改为行内信息浮层）。

- [2026-11-18 首屏直接审批与路线选择验证](docs/20261118-首屏直接审批与路线选择验证.md)（需求 25、设计 §39，动作直接进入首屏，取代稍后选项和二次入口）。

- [2026-11-18 目标浮层与任务计数验证](docs/20261118-目标浮层与任务计数验证.md)（需求 26、设计 §40，外点关闭浮层、一行自适应意见、唯一方案来源和真实任务计数）。

- [2026-11-18 来源浮层与执行消息观察验证](docs/20261118-来源浮层与执行消息观察验证.md)（需求 27、设计 §41，模态内滚轮/Markdown、刷新保留与只读执行消息卡；卡片内展开形态已被“执行消息只读对话与目标列表入口验证”取代）。

- [2026-11-18 侧栏云电脑预览稳定刷新验证](docs/20261118-侧栏云电脑预览稳定刷新验证.md)（需求 27 补充、设计 §41.1，下载/解码/临时失败保留与身份隔离）。

- [2026-11-18 执行消息只读对话与目标列表入口验证](docs/20261118-执行消息只读对话与目标列表入口验证.md)（需求 27 补充、设计 §41.2，卡片入口与“查看目标”同行、只读对话弹层、目标列表入口；实际 Electron 检查未执行）。
