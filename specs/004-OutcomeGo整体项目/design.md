# 设计文档 - OutcomeGo 整体项目

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. 设计目标

OutcomeGo 采用增量架构：现有客户端负责交互，现有服务端负责逻辑权威，现有 Worker 和 OpenTeam Runtime 继续负责执行。新增能力围绕 Outcome、Contract、Evidence、Decision 和人工 WorkItem 组织。

## 2. 总体架构

```text
Desktop / Android / iOS
        │
apps/server：Outcome、Contract、Decision、Evidence、API
        │
packages/contracts + packages/db + messaging
        │
apps/worker：WorkItem 调度、状态汇总、恢复
        │
OpenTeam Bot / Computer / Plugin / MCP
        │
人工执行与 KnowledgeProvider
```

OutcomeGo 不创建第二套 Agent Runtime、第二套数据库或独立编排平台。

## 3. 阶段关系

```text
004.1 更名与下一版本
        ↓
004.2 规划 → Contract → OpenTeam 执行 → 验收
        ↓
004.3 Inbox 与 Decision
        ↓
004.4 现实任务与知识资料
        ↓
004.5 恢复、幂等、指标和最终验收
```

`004.2` 是第一条产品价值主链路。`004.5` 的最低运行能力可以在 `004.2` 执行期间并行实现。

## 4. 数据所有权

- 服务端是 Outcome、Contract revision、Decision、Evidence 和批准事件的逻辑权威。
- OpenTeam Runtime 是 Agent 执行和原生 Run 生命周期的执行基础。
- 外部邮件、文档、客户系统和生产系统继续拥有其自身业务数据。
- KnowledgeProvider 只提供带来源信息的资料，不自动改变 Contract 或授权。
- 用户批准和人工验收必须由服务端记录，不能只依赖客户端状态。

## 5. 全局状态原则

- 已批准 Contract revision 不原位编辑。
- Run 必须引用创建时有效的 Contract revision。
- `Run=completed` 不自动等于 `Outcome=Accepted`（`RunStatus` 实际取值见 §42）。
- 缺少必要证据时只能是 `UNVERIFIED`。
- Decision 解决后必须产生可追踪的结果事件。
- 只有项目计划已经要求的动作才实现暂停、批准或拒绝。
- 本项目不实施工具级授权门禁，处理决定见 §40。

## 6. 发布顺序

1. 完成 `004.1` 的只读盘点、品牌修改、新实例与手动备份导入验收，再按发布门槛发布下一版本。
2. 完成 `004.2` 的模型、规划、执行和验收主链路。
3. 完成 `004.3`、`004.4` 和 `004.5` 的阶段能力。
4. 通过父 Spec 最终验收后再进行完整 Beta 发布。

## 7. 全局验证

- 阶段退出条件必须由子 Spec 的最终检查点提供证据。
- 父 Spec 的最终检查必须复现一条完整流程，并覆盖新实例初始化、手动备份导入、执行、验收和人工任务；不要求旧安装原地升级。
- 不把未实现的设计建议标记为完成。

## 8. 当前代码映射、现有代码所有权和文件影响清单

| 能力 | 逻辑权威 | 主要实现位置 | 允许的变更边界 |
|---|---|---|---|
| 品牌、版本和发布 | 根工作区与发布 Workflow | `package.json`、`scripts/release/`、`.github/workflows/release.yml`、客户端发布配置 | 必须通过 `004.1` 的兼容矩阵 |
| Outcome/Contract | Server + DB | `apps/server/src/services/`、`apps/server/src/routes/`、`packages/db/prisma/schema.prisma` | 不在客户端保存最终事实 |
| OpenTeam Run | 现有 Channel/Worker/Computer 链路 | `apps/server/src/services/channel-service.ts`、`run-service.ts`、`apps/worker/src/worker.ts`、`apps/computer/src/runtime/` | 通过窄接口接入，不替换 Runtime |
| Inbox/通知 | Server 投影 + 现有通知通道 | `InboxEvent`、`ChannelNotification`、`apps/server/src/services/notification-service.ts`、`packages/messaging/src/notifications.ts` | 不复制完整消息系统 |
| 现实任务 | Outcome WorkItem + KnowledgeProvider | `apps/server`、`packages/contracts`、客户端页面 | 人工动作不能伪装为 Agent Run |
| 恢复和幂等 | 现有 Event/Outbox/IdempotencyRecord | `packages/db`、`apps/server/src/services/service-utils.ts`、`apps/worker` | 只扩展当前流程需要的字段和处理器 |

## 9. 跨阶段数据流

```text
用户输入
  → PlanningDraft
  → Outcome(draft)
  → ContractRevision(pending_approval)
  → ContractRevision(approved)
  → WorkItem
  → Run / HumanActionReceipt
  → Output / Evidence
  → Review
  → Decision 或 Accepted
```

父规格要求所有跨阶段实体都带有稳定关联：

```text
outcomeId
contractId
contractRevision
workItemId
runId 或 humanReceiptId
eventId / idempotencyKey
```

客户端可以缓存投影，但不能以缓存状态覆盖服务端事实。每个阶段必须定义其事件产生者、消费者、重放方式和失败后可见状态。

## 10. 版本和数据库策略

- 下一版本品牌发布沿用当前版本线；发布前根版本为 `0.1.0-beta.13`，`004.1` 已将本地候选版本设为 `0.1.0-beta.14`，实际发布仍以版本脚本、tag 和 Release 证据为准。
- `004.1` 全量名称迁移的新实例直接从包含全部最新字段的单一 `outcomego-v1` Prisma/raw schema 初始化；不执行旧产品数据库字段、表名或 schema 的自动转换。
- Outcome 产品功能新增的数据库字段仍按本父 Spec 的 API 和数据兼容规则设计；`004.1` 品牌迁移不要求对 beta.13 数据库原地升级。
- Outcome 相关 Event 和 API 载荷必须有 `schemaVersion` 或明确的兼容解析分支。
- 旧数据保留流程是用户手动备份后导入符合最新 schema 的备份；仓库校验器拒绝旧格式且不改写输入文件。
- 所有发布验证必须记录构建版本、数据库迁移版本、客户端版本和测试环境。

## 11. 全局验证策略和测试分层

1. **合同测试**：共享 DTO、枚举、状态转换和兼容解析。
2. **服务单元测试**：每个领域服务的创建、更新、失败和幂等行为。
3. **数据库集成测试**：迁移、唯一约束、事务和历史数据读取。
4. **Worker/Runtime 集成测试**：Contract 到 Run、Run 到输出和事件回放。
5. **客户端测试**：规划、Inbox、人工动作卡、升级状态和错误展示。
6. **发布测试**：版本同步、打包、升级、回滚、签名和 Release 资产。
7. **父规格回放**：使用固定 fixture 完成场景 A–D。

## 12. 不变量

- 未批准 Contract 不得创建正式执行 Run。
- 已批准 Contract revision 不原位覆盖。
- `Run=completed` 不等于 `Outcome=Accepted`。
- 每个必需 AcceptanceCriterion 必须有 Review 结果。
- 人工 WorkItem 没有人工回执时不能完成。
- 同一个业务 idempotency key 不能产生两个业务结果。
- 品牌字符串变化不能改变 Outcome 业务数据主键或上游来源记录。`004.1` 新版使用全新 OutcomeGo 身份与数据库 schema；旧签名只能按其原仓库来源验证，不能作为 OutcomeGo 的信任根。

## 13. 阶段级设计约束

### 13.1 `004.1` 更名发布阶段

`004.1` 是版本交付边界，不只是文案变更。它必须同时处理以下对象：

| 对象 | 事实来源 | 变化类型 | 失败时的保护 |
|---|---|---|---|
| 根版本 | `package.json`、`bun.lock`、`apps/ios/release.json` | 下一版本递增 | `version.ts check` 阻止不一致发布 |
| CLI 默认仓库 | `apps/cli/src/constants.ts` | 指向 `jingyi0605/OutcomeGo` | 新仓库 tag、Release 和签名 identity fixture |
| Desktop 名称 | `apps/desktop/package.json`、About | 新安装身份与用户可见名称 | 历史 artifact prefix 按 updater 证据保留 |
| Android 名称 | Manifest、strings、Release asset | 新 application ID 与新安装身份 | 更新清单仍须匹配固定公钥 |
| iOS 名称 | Release 工程和文案 | 新 bundle ID、APNs、extensions 和显示名 | 新安装身份；签名和商店发布单独验收 |
| Compose/镜像 | `docker-compose.yml`、workflow | 新运行身份和数据库 schema | 新 volume/database；旧数据手动备份导入 |
| 许可证/Fork 关系 | `FORK.md`、README、LICENSE | 说明更新 | 保留上游署名和 GPL 文件 |

阶段结束时父规格只能引用已生成的发布和升级证据，不能引用“未来会验证”的设计判断。

### 13.2 `004.2` 主链路阶段

`004.2` 负责业务事实的产生：Outcome、Contract revision、WorkItem、Run、Output、Evidence 和 Review。它不负责通知渠道，也不负责现实现场执行，但必须产生供 `004.3` 和 `004.4` 消费的稳定状态和事件。

### 13.3 `004.3` Inbox 阶段

`004.3` 消费 `004.2` 和 `004.4` 的事实事件，创建 Decision、Inbox projection 和必要通知。Inbox 不得成为 Outcome 状态的第二个写入入口。

### 13.4 `004.4` 人工任务阶段

`004.4` 生成 `executorType=human` 的 WorkItem、资料引用和人工回执。它可以依赖 `004.2` 的 Evidence/Review，但不能把人工回执伪装为 Agent Run。

### 13.5 `004.5` 恢复阶段

`004.5` 只提供恢复、幂等、动作分流和最终验收。它不能重新定义 Outcome、Decision 或 WorkItem 的业务含义。

## 14. 父级事件合同

所有跨阶段事件使用统一 Envelope，存储方式见 §43：

```ts
interface OutcomeEventEnvelope<T> {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  outcomeId: string;
  contractRevision?: number;
  workItemId?: string;
  runId?: string;
  actorId: string;
  correlationId: string;
  idempotencyKey?: string;
  payload: T;
}
```

最小事件目录：

| 事件 | 产生阶段 | 消费阶段 | 是否创建主动通知 |
|---|---|---|---|
| `outcome.created` | `004.2` | 所有阶段 | 否 |
| `contract.revision.created` | `004.2`/`004.3` | `004.2`、`004.3` | 否 |
| `contract.revision.approved` | `004.2` | `004.2`、`004.5` | 否 |
| `work_item.created` | `004.2`/`004.4` | Worker、Inbox | 否 |
| `run.started` | `004.2` | `004.5` | 否 |
| `run.finished` | `004.2` | Review、Inbox、恢复 | 通常否 |
| `review.required` | `004.2`/`004.4` | `004.3` | 是，待验收 |
| `review.recorded` | `004.2`/`004.4` | Outcome 状态计算、指标 | 否 |
| `decision.required` | `004.3`/`004.5` | Inbox、客户端 | 是 |
| `decision.resolved` | `004.3` | `004.2`、`004.5` | 否 |
| `human_action.required` | `004.4` | Inbox、客户端 | 是 |
| `human_receipt.submitted` | `004.4` | Review、Inbox | 否 |
| `outcome.accepted` | `004.2`/`004.4` | Inbox、指标、发布回放 | 是，结果 |
| `outcome.recovered` | `004.5` | 查询、审计 | 否 |

事件消费者必须能处理未知事件类型。未知事件可以进入事实日志，但不能改变现有业务状态。

上表是唯一的事件名目录。子 Spec 不得为同一事实另起名字（例如不得使用 `contract.approved`、`run.submitted`、`review.updated`）；需要新事件时先在本表登记。

## 15. 全局错误合同

服务端错误沿用现有 `ApiError` 和 `apps/server/src/http.ts` 的响应形状 `{ error: { code, message, details } }`，Outcome 相关字段放在 `details` 中，不另起错误外壳：

```json
{
  "error": {
    "code": "contract_revision_not_approved",
    "message": "The contract revision must be approved before execution.",
    "details": {
      "retryable": false,
      "currentStatus": "pending_approval",
      "correlationId": "<id>"
    }
  }
}
```

错误码按阶段归类：

| 类别 | 错误码示例 | 客户端行为 |
|---|---|---|
| 资源 | `outcome_not_found`、`work_item_not_found` | 返回列表或刷新 |
| 状态 | `invalid_outcome_transition`、`decision_expired` | 显示当前状态 |
| 版本 | `contract_revision_conflict`、`superseded_revision` | 重新读取当前 revision |
| 幂等 | `idempotency_conflict`、`request_in_progress` | 使用原结果或等待 |
| 执行 | `run_not_active`、`bot_not_runnable` | 显示失败和下一步 |
| 验收 | `evidence_missing`、`review_incomplete` | 回到验收页面 |
| 发布 | `version_mismatch`、`upgrade_incompatible` | 停止发布并保留旧资产 |

错误文本使用英文代码标识和项目现有 API 语言约定；面向用户的解释由客户端本地化层提供。

## 16. 数据库迁移顺序

跨阶段数据库迁移按以下顺序进行：

1. 先创建可选的新表和可选外键。
2. 部署读路径，允许旧客户端继续工作。
3. 部署写路径和事件投影。
4. 运行历史数据核对和新数据回放。
5. 在确认没有旧客户端写入冲突后，才增加必要的非空约束或索引。

禁止在 `004.1` 的品牌发布迁移中创建不可回滚的 Outcome 业务表。业务表迁移属于 `004.2` 或对应阶段，并且必须有独立 migration 名称和回退说明。

## 17. 跨阶段事务和异步边界

### 同一数据库事务内

- 创建 Outcome 与第一版 Contract 草案。
- 批准 Contract revision 与批准证明。
- 创建 WorkItem 与其 revision 关联。
- 写入 Review 并重新计算 Outcome 状态。
- Decision resolve 与状态变更。
- HumanReceipt 幂等写入与 WorkItem 状态更新。

### 不得放入长事务

- 调用 OpenTeam Worker。
- 调用外部资料 provider。
- 发送 Push 或 Desktop 原生通知。
- 构建安装包、签名或上传 Release。
- 等待用户操作。

这些异步动作必须先写入事实或队列意图，再由现有 Worker/Outbox 机制执行。

## 18. 权限和身份边界

本项目不新增组织级 RBAC，但所有新 API 仍必须使用当前服务端 owner/session 鉴权。当前服务端是单 owner 模型，`OUTCOMEGO_AUTH_MODE=disabled` 时没有 session，具体规则见 §44：

1. API 从当前认证上下文取得 owner identity，不能信任请求体中的 ownerId。
2. Outcome、Decision、WorkItem、Evidence 和回执查询必须沿关系验证归属。
3. `actorId` 记录真实用户、Agent 或系统服务主体。
4. 客户端只提交选择和回执，不能提交批准人、验收人或最终状态作为可信字段。
5. 内部 Worker API 继续使用现有内部认证方式；不把内部 token 写入 Outcome payload。

## 19. 端到端序列：成功路径

```text
Desktop
  └─ POST /outcomes/plans
Server
  └─ 返回 PlanningDraft
Desktop
  └─ POST /outcomes + confirm dimensions
Server
  └─ Outcome + ContractRevision(draft)
Desktop
  └─ POST /revisions/1/approve
Server
  └─ ContractRevision(approved) + event
Desktop
  └─ POST /runs
Server
  └─ WorkItem(queued) + existing Run
Worker
  └─ Run completed + ChannelMessage(sourceRunId)
Server
  └─ Output + ReviewPending
Desktop
  └─ POST /reviews
Server
  └─ Evidence/Review + Outcome(Accepted)
```

## 20. 端到端序列：需要决策

```text
Worker/Recovery
  └─ action cannot continue in current Contract
Server
  └─ Checkpoint + Decision(open) + Outcome(DecisionPending)
Inbox projection
  └─ decision_pending item + notification fact
User
  └─ POST /decisions/:id/resolve
Server
  ├─ same revision: resume WorkItem
  └─ changed scope: create revision N+1 pending approval
Worker
  └─ resume only after valid status
```

## 21. 端到端序列：人工任务

```text
Agent/Planner
  └─ WorkItem(executorType=human)
Server
  └─ HumanActionPending + references
User
  └─ start work item
User
  └─ POST receipt with assets/observations
Server
  └─ HumanReceipt(submitted) + ReviewPending
Reviewer
  └─ PASS or FAIL
Server
  └─ accepted / Decision / retry action
```

## 22. 客户端一致性要求

所有客户端必须遵循同一组事实优先级：

```text
HTTP response / event snapshot
  > local optimistic state
  > stale cached projection
```

当客户端收到版本冲突、状态冲突或未知事件时，刷新 Outcome 详情，不自行推断为成功。客户端可以乐观显示按钮反馈，但在服务端响应前不能将 Outcome 标为 Accepted。

## 23. 测试 fixture 目录

父规格建议建立以下 fixture：

```text
specs/004-OutcomeGo整体项目/docs/fixtures/
  research-outcome.json
  decision-pending.json
  human-action.json
  duplicate-event.json
  upgrade-from-beta-13.json
  release-assets.json
```

每个 fixture 必须包含输入对象、预期状态序列、关键 ID 关系、预期通知类别和清理方法。Fixture 不得引用生产用户、真实 token 或私有路径。

## 24. 跨平台验证矩阵

| 能力 | Server | Worker | Desktop | Android | iOS | 发布环境 |
|---|---:|---:|---:|---:|---:|---:|
| Outcome 查询 | ✓ | - | ✓ | ✓ | ✓ | - |
| Contract 批准 | ✓ | - | ✓ | 后续 | 后续 | - |
| Agent Run | ✓ | ✓ | 触发 | 观察 | 观察 | - |
| Decision resolve | ✓ | ✓ | ✓ | ✓ | ✓ | - |
| Human receipt | ✓ | - | ✓ | 后续 | 后续 | - |
| 版本升级 | - | - | ✓ | ✓ | ✓ | ✓ |

阶段子规格必须说明自己覆盖的矩阵单元，并将未覆盖单元写入 Out of Scope，而不是隐含跳过。

各平台的第一版范围以 §41 为准；本表中的“后续”单元不在本项目实现。

## 25. 父级运行手册

### 开发前

1. 读取父 Spec 和目标阶段的 `requirements.md`、`design.md`、`tasks.md`。
2. 检查工作树和当前版本，不覆盖用户未提交改动。
3. 运行目标包的现有 typecheck/test，记录基线。
4. 确认数据库、客户端或发布测试所需的环境是否存在。

### 实现中

1. 先完成共享 Contract 和数据迁移，再连接 UI。
2. 每次跨进程调用都记录请求 ID、响应状态和可重试结论。
3. 每个任务完成后立即写回 `tasks.md` 和证据文件。
4. 发现现有实现与 Spec 不符时，更新设计和任务，不通过静默代码偏差解决。

### 交付前

1. 运行阶段验证命令。
2. 回放阶段 fixture。
3. 更新文件影响清单中的实际路径。
4. 记录已知限制、未执行的外部测试和回滚方法。
5. 只有在所有必需证据齐全时将任务标记为 `DONE`。

## 26. 需要保留的设计决策记录

以下决策必须作为 ADR 或 `docs/` 记录保留：

- 是否直接扩展现有 `Run` 还是使用 `OutcomeRunLink`。
- Contract revision 是否单独建表或复用现有 JSON 字段。
- Inbox 使用查询投影还是新增 `OutcomeInboxItem` 表。
- Checkpoint 使用 `Run.requestProgress` 还是新增表。
- 现实资料的第一个 provider 以及其项目范围来源。
- 下一版本哪些内部标识保留，哪些内部标识迁移。
- 哪些客户端能力进入第一轮 Beta。

## 27. Parent Spec 与子 Spec 的文件责任

| 内容 | 父 Spec | 子 Spec |
|---|---|---|
| 项目使命和范围 | 定义 | 不重复定义，只引用 |
| 阶段依赖 | 定义全局顺序 | 定义阶段内依赖 |
| 领域模型 | 定义跨阶段关系 | 定义具体字段和迁移 |
| API | 定义跨阶段命名规则 | 定义请求、响应、错误和 route |
| 数据库 | 定义迁移顺序和兼容原则 | 定义具体表、索引和 migration |
| 客户端 | 定义平台矩阵 | 定义具体页面、状态和测试 |
| 测试 | 定义全局场景 | 定义单阶段 fixture 和命令 |
| 发布 | 定义版本顺序和 Gate | 定义平台发布步骤 |
| 回滚 | 定义全局回退原则 | 定义阶段可执行回退 |

子 Spec 可以增加实现细节，但不能违反父 Spec 的数据所有权、版本和范围原则。出现冲突时，先更新父级或记录 ADR，再修改子 Spec。

## 28. 依赖图

```text
004.1 baseline/rename
  └─> 004.2 contracts/model/planning
       ├─> 004.3 Decision/Inbox
       │    └─> 004.5 recovery of decisions
       └─> 004.4 human work/evidence
            └─> 004.5 recovery of human work

004.2 minimum Run/Checkpoint
  └─> 004.5 can implement recovery in parallel

004.1 release candidate
  └─> 004.5 final upgrade/release acceptance
```

不可并行的依赖：

- `004.2` API/DB contract 未稳定前，不能固定 `004.3` Decision payload。
- `004.2` WorkItem/executor type 未稳定前，不能固定 `004.4` HumanActionCard。
- `004.1` application identity 和 update contract 未确认前，不能完成正式发布验收。

可并行的工作：

- `004.1` 的只读名称盘点与 `004.2` 的当前代码能力审计。
- `004.2` 的合同文档与 `004.5` 的恢复能力审计。
- Desktop UI 原型与 server API contract 草案，但 UI 不能先假定最终状态。

## 29. API 版本策略

第一版采用 `/api/v0/`，但每个新 Outcome route 仍必须定义：

- 请求字段是否必填。
- 新增字段是否可选。
- 错误 code 是否稳定。
- response 中是否允许未知字段。
- 旧客户端遇到新状态的行为。
- 迁移期间 server/client 最低兼容版本。

不可兼容变化包括：

- 修改已批准 Contract 的字段语义。
- 删除 `status`、`outcomeId`、`contractRevision` 或 idempotency response。
- 将 `Run=completed` 改成代表 Outcome accepted。
- 修改旧消息 API 的 `clientId` 幂等语义。

可兼容变化包括：

- 增加可选摘要字段。
- 增加客户端忽略的事件字段。
- 增加新的 Inbox category，但旧客户端使用 generic fallback。
- 增加新的 Evidence source type，旧客户端只显示摘要。

## 30. 数据迁移验收矩阵

| 迁移 | 新安装 | 手动备份导入 | 旧客户端读 | 回滚 |
|---|---:|---:|---:|---:|
| 品牌/版本 | ✓ | 手动重新安装 | 不适用 | 保留 beta.13 旧资产 |
| Outcome tables | ✓ | 当前 schema 备份导入 | 不适用 | 保留源备份 |
| Contract revision | ✓ | 按当前 schema 校验 | 不适用 | 保留源备份 |
| Decision/Inbox | ✓ | 按当前 schema 校验 | 不适用 | 保留源备份 |
| Human WorkItem | ✓ | 按当前 schema 校验 | 不适用 | 保留源备份 |
| Checkpoint | ✓ | 按当前 schema 校验 | 不适用 | 保留源备份 |

每个 migration 任务必须记录：

```text
migration name
apply command
database version before/after
row counts
foreign-key checks
old-client read result
rollback/recovery result
```

## 31. 领域状态不变量总表

### Outcome

- 访问控制沿用现有 API 认证，见 §44。
- current revision 必须存在或为空。
- Accepted 必须有所有必需 Review。
- DecisionPending 必须存在 open Decision 或未解决的运行阻塞。
- HumanActionPending 必须存在 active human WorkItem。

### ContractRevision

- revision number 单调递增。
- approved 之后不可原位修改。
- superseded revision 不能创建新 Run。
- approval actor/time/proof 不为空。

### WorkItem

- executorType 是 agent 或 human。
- Agent WorkItem 的 Run 关联最多一个活动 Run。
- Human WorkItem 没有 Run 也可以有 HumanReceipt。
- WorkItem 完成不等于 Outcome accepted。

### Evidence/Review

- Evidence 必须关联 criterion 或明确的 Output。
- Review 必须关联 revision。
- UNVERIFIED 不能算 PASS。
- 旧 revision 的 Evidence 不能满足新 revision 的条款，除非明确继承并记录原因。

### Decision

- resolved/expired/withdrawn 不可再次 resolve。
- resolve 必须匹配 expected revision。
- custom text 不得替代服务端保存的 option snapshot。

## 32. 跨阶段事件重放

重放工具的输入：

```text
event topic/type
from sequence
until sequence
outcome filter
mode=dry-run|apply
```

`dry-run` 只显示预期投影变化；`apply` 必须使用与线上相同的 idempotency 和状态前置条件。禁止通过直接改数据库绕过事件处理器来修复状态，除非有明确的人工数据修复脚本和备份记录。

## 33. 观测和审计字段

所有 Outcome 相关服务日志至少包含：

```text
correlationId
outcomeId
contractRevision
workItemId/runId/decisionId when present
actor type/id hash
operation
result status
error code
elapsedMs
```

日志不包含：

- 完整认证 token。
- Provider secret。
- 完整文件正文。
- 未经脱敏的客户资料。
- 模型内部推理内容。

审计 Event 保存事实摘要；调试日志可以更短。两者不能互相替代。

## 34. 阶段退出条件模板

每个子 Spec 的最终检查点必须回答：

1. 哪些代码已经修改。
2. 哪些数据库 migration 已应用。
3. 哪些客户端/平台已验证。
4. 哪些测试命令通过。
5. 哪些外部环境无法验证。
6. 哪些功能明确未做。
7. 如何回滚本阶段。
8. 下一阶段依赖什么证据。

父 Spec 不接受“实现完成”作为退出理由，必须有这八项记录。

## 35. 版本分支和提交边界

推荐提交边界：

```text
004.1-audit
004.1-brand-docs
004.1-cli-compat
004.1-desktop-release
004.1-mobile-release
004.1-upgrade-verification
004.2-contracts-db
004.2-planning-api
004.2-planning-ui
004.2-openteam-bridge
004.2-review-evidence
004.3-decision-inbox
004.4-human-work
004.5-recovery
004.5-final-acceptance
```

实际提交消息仍遵循仓库中文格式。一个提交不能同时包含品牌更名、数据库不可逆迁移和未完成的产品功能，除非发布任务明确要求并记录回滚方法。

## 36. 全局回滚层级

1. UI/文案回滚：撤销客户端和 README 变化。
2. 功能入口回滚：关闭 Outcome/Decision 入口，保留数据和 API 读取。
3. Worker 行为回滚：停止新 Outcome Run，保留普通聊天/Run。
4. 服务端回滚：回到兼容旧数据库读取的镜像。
5. 发布回滚：恢复旧 asset、tag、manifest 和安装说明。
6. 数据修复：只有在有备份、脚本和审计记录时执行。

## 37. 父级验收脚本输入

父级回放必须使用固定 JSON：

```json
{
  "owner": "fixture-owner",
  "bot": "fixture-bot",
  "outcome": "比较两个备份方案并给出选型建议",
  "goal": ["形成可执行的选型建议"],
  "acceptance": ["比较两条可行路线", "附来源"],
  "boundaries": {"excluded": ["修改生产系统"]},
  "decision": {"required": true},
  "humanAction": {"required": true}
}
```

回放检查：

- Outcome/Contract/Run/Evidence/Decision/Receipt 的 ID 链。
- 事件顺序和重复处理。
- Inbox 卡片内容。
- 旧客户端和新客户端的响应兼容。
- 版本和迁移状态。

## 38. 父级设计评审问题

在 `004` 进入实施前，评审必须回答：

- 当前 Run 是否能承载 Contract revision 关联。
- WorkItem 是否需要新表。
- Outcome owner 是否沿用当前用户身份（已决定，见 §44）。
- Inbox 是否复用现有通知模型。
- 第一版资料 provider 是什么。
- Recovery checkpoint 存在哪里。
- 哪些平台进入第一条真实试点。
- 下一版本品牌和仓库 rename 的边界是什么。
- 哪些测试需要真实账号、设备或发布环境。
- 哪些失败可以记录 PENDING，哪些必须阻止发布。


## 39. 决策基线（原规划 D01–D08）

原规划 §20.2 列出的八项决策在本项目中按下表执行。“已确认”来自用户明确要求；“默认基线”是本 Spec 为了先完整实现功能而采用的最简单方案，负责人可以在对应阶段开始前改写，改写后必须同步更新受影响的子 Spec。

| 决策 | 本项目结论 | 状态 | 影响的子 Spec |
|---|---|---|---|
| D01 规划自动化 | 第一版采用 A：每个 Outcome 都走三维规划和一次明确批准。B（模板复用）和 C（预授权自动规划）不在本项目实现。 | 默认基线 | `004.2` |
| D02 公开名称和仓库 | 下一版本启用 OutcomeGo 用户可见名称；仓库 slug 为 `jingyi0605/OutcomeGo`，fork 默认分支命名为 `OutcomeGo`，上游 `main` 保持不变。 | 已确认；分支同步和默认分支切换随本次执行 | `004.1` |
| D03 Contract Schema | Contract 只包含 goal、acceptance、boundaries 三部分，加可选 `budget`（不填默认值）和执行 Bot；批准人和验收人都是当前 owner；任何目标、验收、边界变化都生成新 revision。原规划六部分中的 Authority 和 Recovery 不进入 Contract。 | 默认基线 | `004.2` |
| D04 权限动作矩阵 | 不实施，见 §40。 | 已确认（用户要求先完整实现功能） | 全部 |
| D05 第一个试点 | Agent 试点：“比较两个备份方案并给出选型建议”（`004.2` 需求 10）。现实任务试点：`004.4` 的现场网络检查 fixture。两者都只使用虚构数据。 | 默认基线 | `004.2`、`004.4` |
| D06 门禁覆盖路径 | 不实施，见 §40。 | 已确认 | 全部 |
| D07 验收方式 | 所有必需条款的 PASS/FAIL 由 owner 提交。系统可以生成 AI 预审建议（`004.2` 需求 17），但建议只是 Evidence，不能写入 PASS。现实任务必须有人工回执。 | 默认基线 | `004.2`、`004.4` |
| D08 品牌和 MVP 顺序 | 先完成 `004.1` 更名发布，再开发 Outcome 功能。 | 已确认 | `004.1`、`004.2` |

实现层面的补充决定：

| 问题 | 结论 |
|---|---|
| Outcome 与 Bot 的关系 | 每个 Outcome 绑定一个执行 Bot，Agent WorkItem 通过该 Bot 的 DM 会话进入现有 Run。多 Bot 协作沿用该 Bot 现有的 subagent 能力，不在 Outcome 层编排。 |
| 资料项目范围 | 第一版 `projectScope = bot:<botId>`，与 `AgentFileState.botId` 对齐；不新增 Project 表。 |
| 规划候选项来源 | 服务端调用 computer 现有 `/v1/infer`，新增 `kind="planning"`，见 `004.2` §31。 |
| Agent 请求用户决策 | 新增内部工具 `RequestOutcomeDecision`，只在带 Outcome 上下文的 Run 中提供，见 `004.3` §41。 |
| 深链格式 | 沿用现有 `outcomego://app/v1/...` scheme，见 `004.3` §10。 |

## 40. 授权门禁处理决定

用户要求本项目先完整实现功能，不做防御式编程，不建设没有直接产品价值的安全门禁。因此：

1. 不实施原规划 OG-006 的工具前门禁、`AuthorizationGrant`、授权元组、`ALLOW_WITH_LIMITS`/`NEEDS_APPROVAL`/`DENY` 判定和权限等级。
2. Contract 的 boundaries 作为执行上下文交给 Agent（`004.2` §23）。现有 OpenTeam 工具、插件、MCP 和外发草稿审批行为保持原样，本项目既不新增也不移除这些行为。
3. 范围控制通过产品流程实现：Contract 只能由用户通过 API 改变；Agent 发现需要超出范围的工作时调用 `RequestOutcomeDecision`；越界或不合格的输出在逐项验收时被发现并标记 FAIL。
4. 所有 Spec 不得宣称 Agent 的工具动作“被阻止”或“被拦截”。原规划场景 C（生产排障只读）和 E（恶意文档）在父场景 F 中只验证 Contract 不被 Agent 改写、越界提议进入 Decision、验收能发现越界输出，不验证工具级拦截。
5. `004.5` 的 ActionDecision 只做产品路由（继续、交给 Decision、交给人工、标记不支持），不是权限判断。
6. 未来如果需要工具级门禁，必须另立 Spec，并以真实事故或明确需求为依据。

## 41. 客户端范围

| 能力 | Desktop | Android | iOS |
|---|---|---|---|
| 三维规划和 Contract 批准 | 第一版 | 后续 | 后续 |
| Outcome 详情和结果查看 | 第一版 | 第一版（只读） | 第一版（只读） |
| Outcome Inbox | 第一版 | 第一版 | 第一版 |
| Decision 解决 | 第一版 | 第一版 | 第一版 |
| 逐项验收 | 第一版 | 后续 | 后续 |
| 人工动作卡 | 第一版 | 第一版（只读） | 第一版（只读） |
| 人工回执上传 | 第一版 | 后续 | 后续 |
| 结果和决策通知、深链 | 第一版 | 第一版 | 第一版 |

“后续”项不在本项目内实现，但服务端 API 必须对所有客户端一致；移动端遇到未实现的入口时显示“请在 Desktop 完成”。§24 的矩阵以本表为准。

## 42. 状态取值和映射

### 42.1 现有 Run

`RunStatus` 的实际取值是 `queued`、`running`、`completed`、`failed`、`cancelled`、`interrupted`。本项目不修改该枚举，也不在 Spec 中使用 `Succeeded`、`WaitingApproval`、`WaitingHuman`、`RetryPending` 这些不存在的 Run 状态。

### 42.2 Agent WorkItem

Agent WorkItem 状态是 Outcome 层的唯一执行状态，`004.5` 的恢复状态机就是这一组状态：

```text
queued → running → completed
                 → failed
                 → cancelled
running → waiting_decision → running | cancelled
running → retry_pending → running | failed
running → needs_review → running | cancelled | completed
```

| Run 状态 | Agent WorkItem 状态 |
|---|---|
| `queued` | `queued` |
| `running` | `running` |
| `completed` | `completed`，随后由 Review 决定 Outcome 是否 Accepted |
| `failed` | `failed`，或在 `004.5` 允许时进入 `retry_pending` |
| `cancelled` | `cancelled` |
| `interrupted` | 由 `004.5` 恢复逻辑判断：重新排队进入 `queued`，或进入 `needs_review` |

提交到 OpenTeam 失败时，可重试的失败进入 `retry_pending`，不可重试的进入 `failed`；不再使用 `submission_failed`。Human WorkItem 使用 `004.4` §16 的状态机。

### 42.3 Outcome

Outcome 状态使用 `004.2` §9.1 的取值。`decision_pending`、`human_action_pending`、`paused` 是侧向状态，进入时把原状态写入 `resumeStatus`，离开时恢复，满足原规划 §12.1 的 `resume_state` 要求。

Outcome 状态由服务端从 WorkItem、Decision 和 Review 重新计算，优先级为：

```text
cancelled > accepted > decision_pending > human_action_pending
  > review_pending > running > approved > pending_approval > planning > draft
```

一个 WorkItem 等待 Decision 时，只阻塞它和依赖它的 WorkItem（`dependsOn`）；其他独立 WorkItem 继续执行。Inbox 的 `acceptance_pending` 类别对应 Outcome 的 `review_pending`。

## 43. 事件存储

§14 的 Envelope 写入现有 `Event` 表，不新建事件表：

| Envelope 字段 | `Event` 列 |
|---|---|
| `eventType` | `topic` |
| `outcomeId` | `entityId` |
| `schemaVersion` | `schemaVersion` |
| 其余字段（`eventId`、`occurredAt`、`contractRevision`、`workItemId`、`runId`、`actorId`、`correlationId`、`idempotencyKey`）和 `payload` | `payload` |

规则：

1. 生产者使用 `apps/server/src/services/service-utils.ts` 的 `appendEvent`，与业务写入放在同一事务。业务写入本身由 `IdempotencyRecord` 或唯一约束去重，因此同一业务事实只产生一个事件。
2. 消费者按 `sequence` 递增读取，使用 `IdempotencyRecord(scope="outcome-event:<handler>", key=eventId)` 记录已处理事件，重复投递不会重复生效。
3. 新事件通过现有 `EventWakeup`（`apps/server/src/event-wakeup.ts`，LISTEN 通道 `aiteamos_events`）唤醒，不新增队列。该通道是固定保留的运行接口，数据库表和索引命名仍使用 OutcomeGo schema。
4. 实现前必须核对 `apps/server/src/event-stream.ts` 对 topic 的过滤，确保新增的 `outcome.*` 等 topic 不改变现有客户端事件流的行为。

## 44. 身份和归属

当前服务端是单 owner 系统：`owner-credentials.ts` 以第一个 `User` 作为 owner，`OUTCOMEGO_AUTH_MODE=disabled` 时没有 session，API 也可以通过 token 或 loopback 访问。因此：

1. Outcome 相关表不增加 `ownerId` 列。访问控制沿用现有 API 认证：请求能通过现有中间件，就能访问全部 Outcome。
2. 批准、验收、Decision 解决和回执提交记录 `actorRef`：有 session 时为 `user:<User.id>`，认证关闭、token 或 loopback 访问时为 `owner:local`；Agent 动作为 `bot:<botId>`；系统动作为 `system:<service>`。
3. 客户端不能提交 `actorRef`、批准人或验收人，服务端从请求上下文生成。
4. 测试只覆盖“未认证请求被现有中间件拒绝”和“认证关闭模式下 actorRef 为 `owner:local`”，不编写多用户越权测试。
5. 多用户或组织级归属不在本项目范围内。
