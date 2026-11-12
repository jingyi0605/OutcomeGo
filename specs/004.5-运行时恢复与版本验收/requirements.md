# 需求文档 - 运行时恢复与版本验收

状态：Draft

关联文档：[README.md](README.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 简介

OutcomeGo 的规划、执行和人工任务需要基本的状态恢复和重复处理能力。该 Spec 只实现已有产品流程实际需要的运行支持。

## 范围说明

### In Scope

- Outcome、Run、Decision 的恢复状态。
- Checkpoint。
- 事件去重。
- 支持范围内的幂等重试。
- Contract revision 变化处理。
- 计划功能所需的最小动作授权判断。
- N/T/Q 和基础运行指标。
- 全项目最终验收。

### Out of Scope

- 通用 IAM、组织级 RBAC 和多租户安全平台。
- 未被产品流程使用的工具分类和策略引擎。
- 大量预防性 Feature Gate。
- 为假设风险建设的复杂编排或隔离系统。
- 独立监控、告警和运营看板平台；本阶段只复用现有日志，并在 Outcome 详情中展示必要状态。

## 需求

### 需求 1：保存可恢复状态

**用户故事：** 作为用户，我希望任务中断后可以继续，以便不用重新开始整个 Outcome。

#### 验收标准

1. WHEN 支持的 Run 中断 THEN System SHALL 保存 Contract revision、已完成 WorkItem、下一步和当前阻塞信息。
2. WHEN 进程重启 THEN System SHALL 恢复 Outcome 和 Run 的可见状态。
3. WHEN 无法安全续跑 THEN System SHALL 保留状态并展示需要处理的事项。

### 需求 2：避免重复处理

**用户故事：** 作为用户，我希望重复事件和普通重试不会产生重复结果，以便任务状态保持一致。

#### 验收标准

1. WHEN 同一事件重复到达 THEN System SHALL 只应用一次业务结果。
2. WHEN 支持的外部动作重试 THEN System SHALL 使用幂等键或已知回执判断是否已完成。
3. WHEN 结果无法确认 THEN System SHALL 保留待处理状态，而不是假设成功或失败。

### 需求 3：实现必要动作处理

**用户故事：** 作为用户，我希望规划中明确需要用户决定的动作能够暂停并等待选择。

#### 验收标准

1. WHEN Run 需要已规划范围之外的用户选择 THEN Agent SHALL 通过 `RequestOutcomeDecision` 创建 Decision，WorkItem 进入 `waiting_decision`。
2. WHEN 用户解决 Decision THEN System SHALL 继续原 Run 或创建明确的新 Contract revision。
3. WHEN 动作不属于当前已实现范围 THEN System SHALL 标记 `UNSUPPORTED` 或交给人工路径，不宣称已经自动完成。本需求是产品路由，不是工具权限检查（父 design.md §40）。

### 需求 4：完成最终版本验收

**用户故事：** 作为维护者，我希望所有阶段组合后能够复核整个产品，以便发布可工作的版本。

#### 验收标准

1. WHEN 执行父 Spec 端到端回放 THEN 所有关键阶段 SHALL 产生可追踪结果。
2. WHEN 执行旧版本升级回放 THEN System SHALL 保留已确认的兼容能力。
3. WHEN 发布验收失败 THEN System SHALL 保留旧发布资产和明确的回退结论。

## 非功能需求

### 非功能需求 1：可观察性

1. 关键状态转换必须能够按 Outcome、Run 和 Contract revision 查询。
2. 指标记录不得阻塞主业务流程。

### 非功能需求 2：范围控制

1. 只实现产品流程所需的最小动作判断。
2. 不得因本 Spec 引入泛化安全架构或大规模 Feature Gate。

## 成功定义

- 进程重启、重复事件和支持范围内的重试回放通过。
- 必要 Decision 可以暂停和恢复流程。
- N/T/Q 等指标可以记录基础数据。
- 父 Spec 的最终端到端和发布验收通过。

## 详细需求

### 需求 5：Checkpoint 保存可继续执行的信息

**用户故事：** 作为用户，我希望 Run 中断后能看到准确的下一步，以便从断点继续而不是重复整个任务。

#### 验收标准

1. WHEN Outcome Run 进入 `running`、`waiting`、`paused` 或产生外部动作 THEN System SHALL 保存当前 Contract revision、WorkItem、下一步和关联输出。
2. WHEN 服务进程重启 THEN System SHALL 将可恢复 Run 恢复为 `queued`、`waiting` 或明确的 `needs_review` 状态。
3. WHEN Run 不具备安全续跑条件 THEN System SHALL 创建 Decision 或人工动作，不得自动重新执行不确定副作用。
4. WHEN Checkpoint 被重复写入 THEN System SHALL 按 Run 和序列更新，不产生分叉状态。

### 需求 6：事件和请求幂等

**用户故事：** 作为系统维护者，我希望重复事件不会重复创建业务对象，以便重试可以安全执行。

#### 验收标准

1. WHEN 同一 `eventId` 被处理多次 THEN System SHALL 只应用一次状态转换。
2. WHEN 同一 `clientRequestId` 重复提交 THEN System SHALL 返回初次结果或稳定的处理中状态。
3. WHEN 同一 Run 完成事件和结果写入并发到达 THEN System SHALL 只创建一个 Output、Review 或 Decision。
4. WHEN 幂等记录过期 THEN System SHALL 只能在业务允许的窗口内重新处理，不得重复写入已终态对象。

### 需求 7：支持范围内的外部动作重试

**用户故事：** 作为用户，我希望网络故障后的重试不会重复发送已完成的动作。

#### 验收标准

1. WHEN 动作有稳定幂等键和可查询回执 THEN System SHALL 使用回执或幂等键决定是否重试。
2. WHEN 动作没有可确认回执 THEN System SHALL 暂停并创建 Decision 或人工动作。
3. WHEN 普通内部计算失败 THEN System SHALL 按当前 Run 的有限重试字段重试，不创建第二个 WorkItem。
4. WHEN 重试次数或时间超过当前任务配置 THEN System SHALL 进入 `failed` 或 `decision_pending`，并保留错误摘要。

### 需求 8：必要动作按产品流程分流

**用户故事：** 作为用户，我希望系统能处理规划内的简单动作和需要我参与的动作，以便流程继续推进。

#### 验收标准

1. WHEN 动作属于当前 Contract 和已实现的执行类型 THEN System SHALL 返回 `ALLOW` 并继续现有流程。
2. WHEN 动作需要用户选择或批准 THEN System SHALL 返回 `NEEDS_USER_DECISION` 并交给 `004.3`。
3. WHEN 动作必须现场执行 THEN System SHALL 返回 `MANUAL_ACTION` 并交给 `004.4`。
4. WHEN 动作类型没有实现路径 THEN System SHALL 返回 `UNSUPPORTED`，不假装完成，也不自动扩展范围。

### 需求 9：运行和发布可观察

**用户故事：** 作为维护者，我希望能够查询状态、恢复结果和版本验收证据，以便判断是否可以发布。

#### 验收标准

1. WHEN 查询 Outcome/Run THEN System SHALL 返回当前状态、最后 Checkpoint、revision 和最后错误摘要。
2. WHEN 发生恢复、重复事件或重试 THEN System SHALL 记录可关联的事件和计数。
3. WHEN 执行父规格最终回放 THEN System SHALL 产出版本、数据库、客户端和测试证据。
4. WHEN 版本验收失败 THEN System SHALL 阻止发布结论变为通过，并保留失败和回滚依据。

## 故障注入矩阵

| 故障 | 注入点 | 预期结果 | 验证证据 |
|---|---|---|---|
| Server 进程重启 | Run running | 恢复或进入 needs review | Checkpoint/Run 对账 |
| Event 重复 | Event handler | 只应用一次 | event ID 表和状态 |
| Worker 断开 | Run submit/heartbeat | 保存状态，有限重试或 Decision | Run/lease 记录 |
| 外部调用超时 | action adapter | 查询回执或暂停 | Decision/receipt |
| DB 写入重试 | service transaction | 唯一业务对象 | idempotency record |
| 旧客户端升级 | release fixture | 数据和登录保留 | upgrade report |

## 需求 10：恢复逻辑不改变普通 Run

**用户故事：** 作为现有用户，我希望新 Outcome 恢复能力不会改变普通聊天 Run 的恢复、取消和消息投递行为。

#### 验收标准

1. WHEN Run 没有关联 Outcome THEN recovery SHALL 使用现有普通 Run 处理路径。
2. WHEN Outcome recovery schema 解析失败 THEN 普通 Run SHALL 不被阻塞。
3. WHEN 新的 idempotency/recovery code 被部署 THEN 现有消息 clientId 和 Run cancel 语义 SHALL 保持不变。
4. WHEN Outcome capability 被关闭 THEN 普通聊天、Routine、通知和更新流程 SHALL 继续工作。

## 需求 11：恢复状态可人工解释和处理

**用户故事：** 作为维护者，我希望遇到 needs_review 时能知道为什么以及下一步如何处理，以便不依赖数据库手工猜测。

#### 验收标准

1. WHEN Run 进入 `needs_review` THEN System SHALL 保存 reason code、checkpoint、revision 和最近事件。
2. WHEN 维护者查询恢复状态 THEN SHALL 看到 resume、Decision、HumanAction 或 cancel 的建议路径。
3. WHEN 执行 reconcile THEN SHALL 使用幂等入口并产生 recovery event。
4. WHEN reconcile 不能安全完成 THEN SHALL 保留原状态和错误，不强行标记成功。

## 需求 12：最终发布结论可复核

#### 验收标准

1. WHEN 父 Spec 场景 A–D 完成 THEN System SHALL 生成包含版本、migration、测试和 fixture 的报告。
2. WHEN 任一硬门槛失败 THEN release decision SHALL 为 FAIL 或 PENDING，不得为 PASS。
3. WHEN 外部设备/账号不可用 THEN 报告 SHALL 区分环境缺失和代码失败。
4. WHEN 回滚执行 THEN SHALL 记录旧 asset、版本、数据库状态和恢复结果。

## 运行时发布硬门槛

| 门槛 | 通过条件 | 失败结论 |
|---|---|---|
| 数据迁移 | 新安装和旧数据读取通过 | FAIL |
| 普通聊天回归 | 原有 focused tests 通过 | FAIL |
| Outcome 主链路 | 004.2 fixture 通过 | FAIL |
| Decision/Inbox | resolve/通知/旧客户端 fallback 通过 | FAIL/PENDING |
| 人工任务 | receipt/review fixture 通过 | FAIL/PENDING |
| 重复事件 | output/decision/notification 不重复 | FAIL |
| Upgrade | 旧版本升级和数据保留通过 | FAIL |
| 外部设备 | 无设备时明确 PENDING | PENDING |

## 需求 13：注意力和质量指标可导出

**用户故事：** 作为负责人，我希望按 Outcome 查看人工介入、注意力投入、验收质量和通知有效性，以便建立基线。

#### 验收标准

1. WHEN Outcome 结束 THEN System SHALL 可以导出 N、T、Q、非必要通知比例和 Contract 变更追溯率（design.md §40）。
2. WHEN 客户端无法上报注意力时间 THEN T SHALL 为空，不得估算。
3. WHEN 指标写入失败 THEN 主流程 SHALL 不受影响。
4. WHEN 生成发布结论 THEN SHALL 附带故障注入回放的恢复正确率。

## 需求 14：迁移有备份和恢复演练

#### 验收标准

1. WHEN 在发布验证环境应用 Outcome migration THEN SHALL 先完成数据库备份并记录路径。
2. WHEN 执行回退演练 THEN 旧版本镜像 SHALL 能读取保留了新表的数据库。
3. WHEN 关键运行失败（needs_review、state_inconsistent、通知重试耗尽）THEN SHALL 写入错误日志并在 Outcome 详情可见。
