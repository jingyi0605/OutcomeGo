# Spec 004：OutcomeGo 整体项目

规格编号：`004`

状态：草案

日期：2026 年 11 月 11 日。

分支：待创建。

本 Spec 是 OutcomeGo 整体项目的父规格，负责统一定义项目目标、阶段关系、全局验收标准和子规格边界。项目首先完成从 aiTeamOS 到 OutcomeGo 的项目更名，并在下一版本启用新名称；随后完成从 Outcome 规划到 OpenTeam 执行、成果验收、用户决策和现实任务支持的完整产品闭环。

项目采用“一个父 Spec + 多个阶段子 Spec”的结构：

- `004.1`：项目更名与下一版本发布
- `004.2`：Outcome 规划、执行与成果验收闭环
- `004.3`：Outcome 收件箱与决策通知
- `004.4`：现实任务与知识资料闭环
- `004.5`：运行时恢复与版本验收

项目原则：

- 优先交付已规划的产品能力。
- 不建设没有明确产品需求支撑的防御式框架、泛化权限平台或大量 Feature Gate。
- 只实现规划闭环、执行关联、必要决策、成果验收和可靠运行所需要的最小约束。
- 继续使用现有 OpenTeam Runtime，不在本项目中重建 Agent Runtime、桌面容器系统或新的编排平台。
- `004.1` 使用全新 OutcomeGo 安装身份与单一最新数据库 schema；用户可在仓库外手动备份并导入，不提供旧数据库字段自动转换或旧安装覆盖升级。OpenTeam 上游同步与 GPL-3.0-only 归属继续保留。

文档：

- `requirements.md`：项目级需求、阶段交付要求和总体验收标准。
- `design.md`：整体架构、阶段依赖、数据流和发布顺序。
- `tasks.md`：子 Spec 交付任务、项目检查点和最终验收。
- `docs/`：项目级补充资料、矩阵和验证记录。

## 实施基线

本父规格不是愿景说明。实现者必须先阅读本目录的三个主文档和对应阶段子规格，再开始修改代码。阶段子规格负责具体 API、数据库、客户端、发布文件和测试；父规格负责跨阶段依赖、版本边界和最终验收。

当前代码基线：

- 根工作区版本：`0.1.0-beta.13`，根 `package.json` 是版本单一来源。
- 包管理器：Bun，工作区包括 `apps/*`、`packages/*`。
- 数据库：`packages/db/prisma/schema.prisma`，PostgreSQL 运行时模型。
- 现有消息模型：`ChannelMessage`、`Message`、`Run`、`InboxEvent`、`OutboxDelivery` 和 `IdempotencyRecord`。
- 现有服务端入口：`apps/server/src/main.ts`、`apps/server/src/app-service.ts`、`apps/server/src/routes/`、`apps/server/src/services/`。
- 现有客户端：`apps/desktop`、`apps/android`、`apps/ios`，移动共享核心位于 `mobile/shared`。
- 现有发布入口：`scripts/release/version.ts`、`.github/workflows/release.yml`、`scripts/android/`、`apps/ios/release.json`。

实施顺序必须遵守：

1. 先完成 `004.1` 的品牌、全新安装身份、最新 schema 和发布门槛审计，并在下一版本启用 OutcomeGo。
2. 再完成 `004.2` 的一条端到端 Outcome 主链路。
3. `004.3`、`004.4` 和 `004.5` 可以在 `004.2` 稳定后依次交付；`004.5` 的最小 Run 状态和恢复任务可以提前并行。
4. 每个子规格达到最终检查点后，立即回写其 `tasks.md`，并在父规格记录证据链接。

本项目不把“安全”作为独立产品。只有当某个约束直接决定规划、执行、决策、验收或发布行为时，才进入对应实现；未覆盖的未来能力写入 Out of Scope 或后续任务，不在本项目中预先建设。

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)
