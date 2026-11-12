# 需求文档 - Outcome 规划执行与成果验收闭环

状态：Draft

关联文档：[README.md](README.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 简介

本 Spec 让用户从一个想法或任务开始，使用目标、验收和边界三组规划形成 Contract，并将已批准 Contract 交给现有 OpenTeam Runtime 执行，最后基于 Evidence 对成果进行验收。

## 范围说明

### In Scope

- Outcome、ContractRevision、AcceptanceCriterion、WorkItem、Run、Evidence 的最小模型。
- 三维规划和多选自定义。
- Contract 草案、批准和 revision。
- OpenTeam Run 关联。
- 一个研究或文档任务试点。
- 证据收集和验收结果。

### Out of Scope

- 通用 BPMN 编辑器。
- 重建 OpenTeam Runtime。
- 自动执行未被当前试点使用的复杂外部动作。
- 复杂长期偏好学习和多租户权限。
- 工具级授权门禁和 authority 字段（父 design.md §40）。
- 规划模板复用和预授权自动规划（父 design.md §39 D01）。
- Android/iOS 上的规划、批准和验收（父 design.md §41）。
- 预算超限后的自动中止。

## 需求

### 需求 1：创建 Outcome 和 Contract

**用户故事：** 作为用户，我希望把想法表达成可验收的成果，以便 Agent 有清楚的执行边界。

#### 验收标准

1. WHEN 用户开始规划 THEN System SHALL 创建可追踪的 Outcome 草案。
2. WHEN 用户确认目标、验收和边界 THEN System SHALL 生成 Contract 草案。
3. WHEN Contract 被批准 THEN System SHALL 创建不可变的 Contract revision。

### 需求 2：支持三维规划

**用户故事：** 作为用户，我希望分别选择目标、验收和边界，以便提前澄清结果标准。

#### 验收标准

1. WHEN System 提供规划建议 THEN 每个维度 SHALL 最多提供四个 AI 建议项和一个自定义入口。
2. WHEN 用户选择规划项 THEN System SHALL 支持多选，并保存实际确认文字。
3. WHEN 规划存在明显冲突 THEN System SHALL 在批准前提示冲突。

### 需求 3：批准 Contract 后执行

**用户故事：** 作为用户，我希望已批准的 Contract 能驱动 OpenTeam 任务，以便不需要重新手工描述任务。

#### 验收标准

1. WHEN Contract 未批准 THEN System SHALL 不提交正式 Run。
2. WHEN Contract 已批准 THEN System SHALL 生成 WorkItem 并关联 Contract revision。
3. WHEN WorkItem 提交 OpenTeam THEN System SHALL 保存原生 Bot 或 Run ID。

### 需求 4：记录执行输出和证据

**用户故事：** 作为用户，我希望看到成果来自哪些执行和资料，以便进行验收。

#### 验收标准

1. WHEN Run 产生输出 THEN System SHALL 保存输出引用和执行上下文。
2. WHEN 验收条款需要证据 THEN System SHALL 关联一个或多个 Evidence。
3. WHEN Evidence 不足 THEN System SHALL 标记 `UNVERIFIED`，不自动接受 Outcome。

### 需求 5：逐项验收成果

**用户故事：** 作为用户，我希望逐条检查验收条件，以便区分 Agent 完成任务和成果真正达标。

#### 验收标准

1. WHEN 所有必需条款通过 THEN System SHALL 允许 Outcome 进入 Accepted。
2. WHEN 任一必需条款失败 THEN System SHALL 保持 Outcome 未接受并展示缺口。
3. WHEN Agent 仅报告成功但没有足够证据 THEN System SHALL 不得进入 Accepted。

## 非功能需求

### 非功能需求 1：追踪

1. Run、Evidence 和 Review 必须带有 `contract_revision`。
2. 所有 Contract 实质变更必须生成新 revision。

### 非功能需求 2：兼容

1. 应复用现有 OpenTeam Bot、Worker、事件和数据库机制。
2. 不得为本 Spec 引入第二套 Runtime 或数据库。

## 成功定义

- 一个研究或文档任务可以完整完成规划、批准、执行、证据和验收。
- 用户可以从 Outcome 追踪到 Contract、Run、Output 和 Evidence。
- 未批准或缺证据的任务不能被错误标记为已完成。

## 详细需求

### 需求 6：规划候选项由服务端生成和校验

**用户故事：** 作为用户，我希望候选项有来源且受控，以便模型建议不会覆盖我的实际选择。

#### 验收标准

1. WHEN `POST /api/v0/outcomes/plans` 收到任务描述 THEN System SHALL 返回 `goal`、`acceptance`、`boundaries` 三个维度。
2. WHEN 任一维度返回候选项 THEN `options.length` SHALL 不大于 4，并且每个选项有稳定 ID、文字和可选推荐理由。
3. WHEN 客户端提交超过四个候选项或伪造未返回的选项 ID THEN System SHALL 拒绝请求或按服务端草案重新校验。
4. WHEN 用户提交自定义项 THEN System SHALL 将其保存为确认文字，并不得把自定义内容当作授权扩大依据。

### 需求 7：Contract 版本和批准具有事务性

**用户故事：** 作为用户，我希望批准的是我实际看到的内容，以便执行时不会悄悄改变目标。

#### 验收标准

1. WHEN 用户批准草案 THEN System SHALL 在同一事务内写入批准时间、批准主体、草案摘要和 revision。
2. WHEN 已批准 revision 被再次修改 THEN System SHALL 拒绝原位更新，并要求创建新 revision。
3. WHEN Contract 状态不是 `approved` THEN System SHALL 不创建正式 Run。
4. WHEN 批准请求重复提交 THEN System SHALL 返回同一个批准结果，不创建第二个 revision。

### 需求 8：Run 与 Contract revision 可对账

**用户故事：** 作为维护者，我希望从 Run 反查用户批准的 Contract，以便解释 Agent 为什么执行这些动作。

#### 验收标准

1. WHEN WorkItem 创建 THEN System SHALL 保存 `outcomeId`、`contractId`、`contractRevision` 和 executor type。
2. WHEN Run 提交到 OpenTeam THEN System SHALL 保存原生 Run ID 或等价关联，并保留创建时间。
3. WHEN Run 完成或失败 THEN System SHALL 可通过 Outcome 查询 Run、输出、错误和验收状态。
4. WHEN Agent 结果提出新目标 THEN System SHALL 将其作为待决策内容，而不是自动追加到已批准 Contract。

### 需求 9：验收条款和 Evidence 逐项关联

**用户故事：** 作为验收人，我希望每一条结论都能看到证据，以便不把 Agent 自报完成当成结果。

#### 验收标准

1. WHEN AcceptanceCriterion 被标记 `PASS` THEN System SHALL 记录 reviewer、时间和至少一个满足要求的 Evidence，除非该条款明确允许无附件的确定性检查。
2. WHEN 证据缺失、来源不明或检查未完成 THEN System SHALL 使用 `UNVERIFIED`。
3. WHEN 任一必需条款为 `FAIL` 或 `UNVERIFIED` THEN Outcome SHALL 不能进入 `Accepted`。
4. WHEN 条款被豁免 THEN System SHALL 记录批准的变更理由，并保留原条款和原 revision。

### 需求 10：研究试点可重复运行

**用户故事：** 作为开发和验收人员，我希望有一条固定试点任务，以便验证完整主链路而不依赖生产资料。

#### 验收标准

1. WHEN 使用测试 fixture “比较两个备份方案并给出选型建议” THEN System SHALL 可以生成规划草案并完成批准。
2. WHEN 试点执行 THEN System SHALL 使用现有 OpenTeam Bot/Run 路径，不直接绕过 Worker 伪造结果。
3. WHEN 试点完成 THEN System SHALL 产生可复核的输出、来源和验收记录。
4. WHEN 试点重复执行 THEN 每次执行有独立 Outcome/Run，但同一次请求重试不能产生重复消息。

## API 合同需求

以下路径是本阶段的正式讨论基线，路径实现前必须与当前 route 注册方式核对：

| 方法 | 路径 | 作用 | 幂等要求 |
|---|---|---|---|
| `POST` | `/api/v0/outcomes/plans` | 生成三维 PlanningDraft | 可选 request ID，不写正式 Outcome |
| `POST` | `/api/v0/outcomes` | 创建 Outcome 草案 | 客户端 request ID |
| `GET` | `/api/v0/outcomes/:id` | 返回 Outcome、Contract、Run、Review 汇总 | 只读 |
| `POST` | `/api/v0/outcomes/:id/revisions` | 从草案或变更创建 revision | revision request key |
| `POST` | `/api/v0/outcomes/:id/revisions/:revision/approve` | 批准 revision | `approve:<revision>` |
| `POST` | `/api/v0/outcomes/:id/runs` | 从批准 revision 创建 WorkItem/Run | `run:<outcome>:<revision>` |
| `POST` | `/api/v0/outcomes/:id/reviews` | 提交条款结论和 Evidence | review key |
| `POST` | `/api/v0/outcomes/:id/rework` | 对 FAIL/UNVERIFIED 条款发起返工 | `rework:<outcome>:<n>` |

所有写接口必须返回稳定的错误码、当前状态和可重试信息。错误消息不得要求客户端猜测数据库状态。

## 需求 11：普通聊天行为保持不变

**用户故事：** 作为现有用户，我希望不使用 Outcome 时仍然使用原有聊天、Run、Tool、Memory 和消息投递行为。

#### 验收标准

1. WHEN 普通用户消息没有 Outcome context THEN Worker SHALL 不增加 Outcome prompt 或状态写入。
2. WHEN 普通 Run 完成 THEN System SHALL 不创建 Outcome Output、Review 或 Decision。
3. WHEN Outcome API 或数据库迁移不可用 THEN 普通聊天路径 SHALL 仍能按现有行为运行。
4. WHEN Outcome Run 失败 THEN 不得改变其他 Bot/Conversation 的普通消息状态。

## 需求 12：Contract 变更可解释

#### 验收标准

1. WHEN 新 revision 创建 THEN System SHALL 记录变更摘要、来源 Decision/用户操作和旧 revision。
2. WHEN Run 绑定旧 revision THEN 查询 SHALL 展示其实际绑定 revision，不自动切换到新 revision。
3. WHEN 新 revision 影响未开始 WorkItem THEN System SHALL 按明确迁移规则处理并记录结果。
4. WHEN 新 revision 影响已产生 Evidence/Review THEN System SHALL 保留旧审计结果并重新判断当前 revision 的验收。

## 需求 13：输出和证据来源可解释

#### 验收标准

1. WHEN Output 由 Agent 可见消息产生 THEN SHALL 保存 source message、Run 和 WorkItem。
2. WHEN Evidence 来自文件、资料或人工回执 THEN SHALL 保存 sourceRef、capturedAt、capturedBy 和 revision。
3. WHEN Output 没有足够 Evidence THEN Review SHALL 使用 `UNVERIFIED` 或明确的待补材料状态。
4. WHEN 结果被用户查看 THEN UI SHALL 能展开到来源和验收条款。

## 需求 14：主链路在受控失败下可复现

#### 验收标准

1. WHEN Planning provider 返回失败 THEN 草案状态和重试信息 SHALL 可读取。
2. WHEN 数据库事务失败 THEN 不得留下可批准半对象。
3. WHEN OpenTeam 提交失败 THEN WorkItem/Run 状态 SHALL 显示失败原因且重试不创建重复消息。
4. WHEN Evidence 上传失败 THEN criterion 状态 SHALL 不被错误改为 PASS。
5. WHEN Review 请求重复或并发 THEN 结果 SHALL 具有稳定幂等行为。

## 主链路验收矩阵

| 阶段 | 输入 | 主要事实 | 验收证据 |
|---|---|---|---|
| Planning | sourceText/context | PlanningDraft | plan fixture/API response |
| Contract | selections/custom | Outcome + revision draft | DB/API snapshot |
| Approval | confirmation | approved revision | approval proof |
| Execution | approved revision | WorkItem + Run | Run/lease/event |
| Output | SendToUser/asset | Output | sourceMessage/run link |
| Evidence | references/files | Evidence | source/digest/capturedBy |
| Review | criterion results | Review + Outcome status | review response |
| Regression | ordinary message | no Outcome facts | existing tests |

## 需求 15：规划候选项由模型生成且可解释

**用户故事：** 作为用户，我希望系统根据我的描述给出目标、验收和边界建议，并说明推荐理由，以便我快速确认。

#### 验收标准

1. WHEN 用户提交任务描述 THEN System SHALL 通过 computer 现有推理接口生成三个维度的候选项，不新建 Agent Run。
2. WHEN 模型返回无法解析或超时 THEN System SHALL 返回 `planning_generation_failed` 和可重试标记，不创建 Outcome。
3. WHEN 选项被标为推荐 THEN SHALL 附带一句推荐理由，UI 展开时可见。
4. WHEN 描述缺少关键信息 THEN System SHALL 以问题形式提示，而不是自行假设。

## 需求 16：验收失败后可以返工

**用户故事：** 作为用户，我希望不合格的成果可以直接退回修改，而不需要重新规划。

#### 验收标准

1. WHEN 必需条款为 FAIL 或 UNVERIFIED THEN 用户 SHALL 能对这些条款发起返工并附意见。
2. WHEN 发起返工 THEN System SHALL 在同一 Contract revision 下创建返工 WorkItem，并通过现有 OpenTeam 路径执行。
3. WHEN 返工完成 THEN 用户 SHALL 能对之前未通过的条款重新验收，旧 Review 保留为历史。
4. WHEN 返工意见要求改变目标、验收或边界 THEN System SHALL 要求走 revision 变更流程。

## 需求 17：AI 预审只作为参考

**用户故事：** 作为验收人，我希望看到 AI 对每条验收条款的预审意见，以便更快核对，但最终结论由我决定。

#### 验收标准

1. WHEN Agent WorkItem 完成 THEN System SHALL 生成逐条款的预审建议，并作为 `ai_prereview` 类 Evidence 保存。
2. WHEN 用户提交 Review THEN 预审建议 SHALL 不能代替用户结论，也不能单独支撑必需条款的 PASS。
3. WHEN 预审失败 THEN Review SHALL 仍可正常进行。

## 需求 18：Evidence 区分可信度

#### 验收标准

1. WHEN 写入 Evidence THEN SHALL 标记 `credibility`：确定性检查、人工确认、外部记录、Agent 输出或 AI 预审。
2. WHEN 必需条款标记 PASS THEN SHALL 至少有一条非 `agent_report`、非 `ai_prereview` 的 Evidence，或用户明确确认。
3. WHEN 展示 Evidence THEN UI SHALL 显示可信度标签。
