# 需求文档 - Outcome 规划执行与成果验收闭环

状态：Approved（2026-11-17）

关联文档：[README.md](README.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 简介

本 Spec 让用户从一个想法或任务开始，使用目标、验收和边界三组规划形成 Contract，并将已批准 Contract 交给现有 OpenTeam Runtime 在 **Outcome 子线程**中执行（父 design §45），最后基于 Evidence 对成果进行验收。

## 范围说明

### In Scope

- Outcome、ContractRevision、AcceptanceCriterion、WorkItem、Evidence、Output、Review 的最小模型，以及 `Run.outcomeWorkItemId` 关联。
- 三维规划和多选自定义。
- Contract 草案、批准和 revision。
- Outcome 子线程：独立上下文、独立运行租约、运行组完成判断，不打断 Bot 主对话。
- 一个研究或文档任务试点。
- 证据收集、验收结果和返工。
- Desktop 的规划、批准、详情和验收；Android/iOS 的 Outcome 列表和只读详情（父 design §41）。
- 普通 Bot 对话中的原生 Outcome 草案创建、查询、变更、已批准任务启动、取消及 Explore 管理；契约批准与最终验收仍由既有用户界面提交（需求 21）。

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
3. WHEN WorkItem 提交执行 THEN System SHALL 为它开启一个 Outcome 子线程，并保存子线程根 Run ID；子线程内的每个 Run 都可以反查到该 WorkItem。

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

1. WHEN WorkItem 创建 THEN System SHALL 保存 `outcomeId`、`contractRevisionId`、`contractRevision` 和 executor type。
2. WHEN 子线程 Run 入队 THEN System SHALL 在 `Run.outcomeWorkItemId` 上记录关联，并在 WorkItem 上保存 `rootRunId`。
3. WHEN 子线程运行组结束或失败 THEN System SHALL 可通过 Outcome 查询 WorkItem、所有关联 Run、输出、错误和验收状态。
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
2. WHEN 试点执行 THEN System SHALL 通过现有 Worker 在 Outcome 子线程中执行，不直接绕过 Worker 伪造结果。
3. WHEN 试点完成 THEN System SHALL 产生可复核的输出、来源和验收记录。
4. WHEN 试点重复执行 THEN 每次执行有独立 Outcome/Run，但同一次请求重试不能产生重复消息。

## API 合同需求

以下路径是本阶段的正式合同（`apps/server/src/main.ts:107` 会把 `/api/v0` 映射为 `/api`）。所有写接口在请求体中携带 `clientRequestId`，服务端以 `IdempotencyRecord(scope, key=clientRequestId)` 去重，不使用 `Idempotency-Key` 请求头：

| 方法 | 路径 | 作用 | 幂等 scope |
|---|---|---|---|
| `POST` | `/api/v0/outcomes/plans` | 生成三维 PlanningDraft | `outcome-plan`，不写正式 Outcome |
| `GET` | `/api/v0/outcomes/plans/:planId` | 重新读取 PlanningDraft | 只读 |
| `POST` | `/api/v0/outcomes` | 从 PlanningDraft 创建 Outcome 和 revision 1 | `outcome-create` |
| `GET` | `/api/v0/outcomes` | Outcome 列表（按状态过滤、cursor 分页） | 只读 |
| `GET` | `/api/v0/outcomes/:id` | 返回 Outcome、当前 revision、WorkItems、Runs、Outputs、Evidence、Reviews 汇总 | 只读 |
| `GET` | `/api/v0/outcomes/:id/revisions/:revision` | 返回该 Outcome 的真实历史 ContractRevisionView 和条款；不改变当前指针或控制资格 | 只读 |
| `POST` | `/api/v0/outcomes/:id/revisions` | 用完整确认内容创建新 revision（解决冲突、变更范围） | `outcome-revision` |
| `POST` | `/api/v0/outcomes/:id/revisions/:revision/approve` | 批准 revision | `outcome-approve` |
| `POST` | `/api/v0/outcomes/:id/runs` | 从批准 revision 创建 WorkItem 并开启子线程 | `outcome-run` |
| `POST` | `/api/v0/outcomes/:id/reviews` | 提交条款结论和 Evidence（唯一验收入口，D20） | `outcome-review` |
| `POST` | `/api/v0/outcomes/:id/rework` | 对 FAIL/UNVERIFIED 条款发起返工 | `outcome-rework` |
| `POST` | `/api/v0/outcomes/:id/cancel` | 取消 Outcome，停止未结束的子线程 | `outcome-cancel` |
| `GET` | `/api/v0/outcomes/:id/work-items/:workItemId/transcript` | 只读查看子线程记录 | 只读 |

所有写接口必须返回稳定的错误码、当前状态和可重试信息。错误消息不得要求客户端猜测数据库状态。

## 需求 11：普通聊天行为保持不变

**用户故事：** 作为现有用户，我希望不使用 Outcome 时仍然使用原有聊天、Run、Tool、Memory 和消息投递行为。

#### 验收标准

1. WHEN 普通用户消息没有 Outcome context 且未显式调用原生 Outcome 管理工具 THEN Worker SHALL 不增加 Outcome prompt 或状态写入；用户主动要求管理目标时的工具调用按需求 21 处理。
2. WHEN 普通 Run 完成 THEN System SHALL 不创建 Outcome Output、Review 或 Decision。
3. WHEN Outcome API 或 Outcome 表不可用 THEN 普通聊天路径 SHALL 仍能按现有行为运行。
4. WHEN Outcome 子线程失败 THEN 不得改变任何 Bot 主对话或群聊的消息状态。

## 需求 12：Contract 变更可解释

#### 验收标准

1. WHEN 新 revision 创建 THEN System SHALL 记录变更摘要、来源 Decision/用户操作和旧 revision。
2. WHEN Run 绑定旧 revision THEN 查询 SHALL 展示其实际绑定 revision，不自动切换到新 revision。
3. WHEN 新 revision 影响未开始 WorkItem THEN System SHALL 按明确迁移规则处理并记录结果。
4. WHEN 新 revision 影响已产生 Evidence/Review THEN System SHALL 保留旧审计结果并重新判断当前 revision 的验收。

## 需求 13：输出和证据来源可解释

#### 验收标准

1. WHEN Output 由子线程运行组的最终结果或输出目录文件产生 THEN SHALL 保存来源 Run、WorkItem 和内容引用。
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
| Execution | approved revision | WorkItem + 子线程运行组 | Run.outcomeWorkItemId/lease/event |
| Output | 子线程最终结果/输出目录文件 | Output | run/workItem link |
| Isolation | 主对话消息 + 子线程并行 | 双方都不被打断 | Run 状态和租约记录 |
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
2. WHEN 发起返工 THEN System SHALL 在同一 Contract revision 下创建返工 WorkItem，并在新的 Outcome 子线程中执行。
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

## 需求 19：Outcome 子线程不打断主对话（父需求 13）

**用户故事：** 作为用户，我希望 Outcome 任务执行时仍能和同一个 Bot 正常聊天。

#### 验收标准

1. WHEN WorkItem 开始执行 THEN System SHALL 通过 `RunOrigin.outcome` 和独立运行租约开启子线程，不设置 `interruptedRunId`，不中断该 Bot 主对话正在运行的回合。
2. WHEN 用户在主对话发送消息 THEN 正在运行的 Outcome 子线程 SHALL 继续运行。
3. WHEN 子线程执行 THEN 主对话 SHALL 不出现执行说明、Contract 内容或子线程的可见消息。
4. WHEN 子线程启动子 Agent 或后台 shell THEN WorkItem SHALL 保持 `running`，直到运行组全部结束。
5. WHEN 同一 Bot 已有 2 个运行中的 Outcome 子线程 THEN 新的 WorkItem SHALL 保持 `queued`，有空位时自动开始（D13）。

## 需求 20：移动端可以查看 Outcome（只读）

**用户故事：** 作为用户，我希望在手机上看到 Outcome 的进度和结果，规划、批准和验收仍在 Desktop 完成。

#### 验收标准

1. WHEN 用户在 Android/iOS 打开 Outcome 列表 THEN System SHALL 显示标题、状态和更新时间。
2. WHEN 用户打开 Outcome 详情 THEN System SHALL 只读显示当前 revision、WorkItem 状态、Output 和验收结果。
3. WHEN 操作只能在 Desktop 完成（规划、批准、验收、返工） THEN 移动端 SHALL 显示“请在 Desktop 完成”，不提供提交入口。
4. WHEN 移动端连接不支持 Outcome API 的旧服务端 THEN SHALL 隐藏 Outcome 入口。

## 需求 21：在普通对话中管理原生目标

2026-11-18 用户确认补充：更新既有 Spec 后实现；用户说“创建一个目标，清理 Unraid 分区空间并给出分解建议”时，Bot 应操作本地 Outcome，不因缺少原生工具而转去 Notion。

**用户故事：** 作为用户，我希望直接在与 Bot 的对话中创建、修改和查询目标，以便不必重新把聊天内容输入规划页面。

#### 验收标准

1. WHEN 用户要求创建目标 THEN 普通主 Bot SHALL 可生成和重读三维 PlanningDraft、按候选项或自定义文字保存待批准 Outcome，并返回实际 ID、状态和现有应用详情链接；不得自动批准或启动未批准 revision。
2. WHEN 用户要求修改目标 THEN Bot SHALL 通过既有完整 Contract revision 接口保存变更，使用 `baseRevision` 检测过期编辑，保留既有执行快照、输出和证据。
3. WHEN 用户询问目标 THEN Bot SHALL 可按文字和状态分页查找、读取详情/历史 revision/执行记录，以及分页读取需要用户处理的事项；返回服务端事实，不将 Agent 自报成功当作 Accepted。
4. WHEN 用户明确要求启动或取消 THEN Bot SHALL 可调用既有服务；启动仍要求当前 revision 已由用户批准，取消保留历史；重试沿用稳定 `clientRequestId`。
5. WHEN 用户要求记录、查看、转为目标或放弃探索想法 THEN Bot SHALL 可调用既有 Explore 服务；转为目标先生成规划，不跳过契约批准。
6. WHEN 工具调用进入服务端 THEN Bot/审计主体 SHALL 来自已校验的当前 Run；不接受模型声明的批准人、验收人或执行状态。子 Agent、Routine 与 Outcome 执行子线程不获得普通对话管理入口。
7. WHEN 用户仅普通聊天、客户端未升级或不存在 Outcome 工具调用 THEN 既有消息、Tool、Memory、Routine 和 Outcome 子线程工具保持原行为；无需新数据库表或第二套状态机。
8. WHEN 新工具尚未部署到远端 Computer THEN 交付记录 SHALL 明确本地代码/测试通过与实际远端可用的区别；远端重建需遵守现有授权规则。

客户端边界：本需求增加的是 Bot 对话能力，Android/iOS 普通聊天也可表达目标并获得原生记录链接；不新增移动端原生规划/批准/验收表单，需求 20 的页面限制和既有用户批准入口保持不变。

对应设计：[design.md §35](design.md#35-普通对话原生-outcome-工具)；对应任务：[tasks.md 阶段 8](tasks.md#阶段-8普通对话目标管理2026-11-18-补充)。


## 需求 22：对话阶段卡片与渐进披露（2026-11-18）

- 普通 Bot 的原生目标规划、草稿生成、执行与结果在对话中显示原生卡片；卡片由实际工具调用及已保存事实驱动，不能用计时器伪造完成或百分比。
- 分析、生成、待审阅、执行、结果、失败有可区分的图标与轻量动态效果；遵循系统减少动态效果设置，静态状态文字始终可读。
- 对话默认仅展示目标摘要、当前阶段、下一步及打开目标入口；建议与契约全文需主动展开，不重复长篇背景和技术记录。
- 详情默认显示概览、当前动作和结果摘要；背景、完整契约、执行记录、证据、历史和诊断按层展开。批准入口位于完整契约审阅层内，不提供跳过审阅的快捷批准。
- 现有 revision、幂等、历史回执验收、普通聊天及所有者批准边界保持不变；草稿、输出生成和最终用户验收必须区分。


## 需求 23：以当前决策为中心的语义渐进披露

详情及对话卡片必须首先回答“现在需要我决定或做什么”。默认仅显示一个简短背景句、前提状态、少量任务名及真实待办；没有记录风险时不显示风险栏。点击各类别才显示简短说明/状态/列表，再点击来源或原始记录才显示完整材料，不能只把旧长文放进折叠框。

只读摘要可以整理已保存文字，但必须引用原文，不能自行认定前提已满足、生成业务风险或把建议任务说成已经创建的 WorkItem。批准/依赖状态取真实记录；未知保持未知。实际 Inbox 决策/人工事项必须有可操作入口。摘要失败不阻塞详情、批准或执行；新 revision 不得沿用旧摘要。对应设计 §37、任务 10.1–10.2。


## 需求 24：简明审批选项与行内来源

待批准区使用“需要你决定的事”，默认只显示简明建议选项及自定义文字入口，不能展开即倾倒完整契约和单独确认输入框。批准、稍后决定、自定义修改分别对应明确批准、保持待定及生成可选择的新方案；自定义修改不能暗中批准或直接执行。原始资料位于任务/前提/风险文字末尾的信息图标浮层，支持悬停、点击、键盘和关闭。各项显示真实状态；无持久完成事实时显示未安排或待评估，不伪造完成。其他记录仅显式请求时显示。对应设计 §38、任务 11.1–11.2。

本需求按用户本轮修正替代需求 22 中“展开完整契约后才显示批准”的展示方式：仍须主动打开决策区、选择批准并明确提交，但不要求先阅读长篇原文。原文可通过信息图标查看；原 revision、幂等和所有者批准约束不变。


## 需求 25：首屏直接处理批准与路线选择

“现在需要你”必须直接展示当前动作。方案批准以意见输入和“是，批准 / 否，修改”按钮处理，不提供稍后或额外展开入口；未处理即保持待定。路线决策直接显示最多四项服务端选项，标签用简短准确的一句话，详细后果/理由/来源进入行尾 Info 浮层，以分段和加粗关键词呈现；另提供允许自定义时的独立空白文字行与提交。选择、意见和提交沿用原版本、幂等与真实业务语义，不能通过 UI 文案推断或伪造决策效果。详细背景继续置于动作之后。对应设计 §39、任务 12.1–12.2。


## 需求 26：目标浮层与紧凑摘要

目标列表点击后直接打开浮动模态框，外点或 Escape 关闭并回到原列表/分类；深链接、创建后打开、Decision/人工任务/历史验收跳转仍可用。意见输入默认一行，随内容自动增加高度。审批的否定修改按钮只称“修改”，移除按钮旁与上方方案说明重复的 Info；完整方案原文仍可从上方唯一 Info 访问。任务栏折叠时显示总数、完成数和进行中数，按当前 revision 的实际 WorkItem 状态计算；建议步骤须明确标为建议，不伪造已建任务或完成事实。对应设计 §40、任务 13.1–13.2。


## 需求 27：可读资料与稳定的执行观察

Info 来源浮层支持悬停后滚轮滚动与 Markdown 排版；处于目标模态框时不得被背景滚动锁误拦截。目标执行及后台刷新保留已显示事实和已加载头像，不反复清空或重播进入效果；遇到窗口闪烁须区分已复现原因与未确认的环境因素。目标对话卡片、详情及目标列表提供只读执行消息入口，入口打开的只读对话展示服务端已脱敏可观察消息/工具活动，支持刷新及较早记录（呈现方式以下方 2026-11-18 补充“执行消息只读对话”为准，取代原卡片内展开）；不得发送消息、接管前台或暴露隐藏推理/原始私有工具参数。对应设计 §41、§41.2，任务 14.1–14.2、16.1–16.4。

2026-11-18 补充：右侧云电脑预览刷新同一 Bot 时，保留上一张成功解码的画面，直到下一帧完成下载与解码。临时网络、HTTP 或图片解码失败不得清空旧画面；保留旧画面时显示重新连接提示。切换 Bot、退出账号或凭据失效必须移除旧画面，迟到响应不能恢复旧身份内容。预览刷新频率、隐藏时资源暂停、只读观看与接管语义保持不变。对应设计 §41 补充、任务 15.1–15.2。

2026-11-18 补充（执行消息只读对话）：执行消息不再在目标卡片内展开，避免挤占卡片。
- 入口：对话目标卡片中，入口与“查看目标”等按钮同处底部一行，“查看目标”保持原样式靠右，入口自动占用剩余横向空间；没有底部按钮行的阶段仍单独显示入口。目标详情保留整行入口。全部目标列表中，已进入执行阶段的目标行（非草稿、规划中、待批准、待启动）增加独立的“执行消息”入口，点击才读取该目标，点击目标行本身仍进入详情。
- 呈现：入口打开参照 Bot 之间只读对话的弹层，含 Bot 头像、Bot 名称与目标标题、任务切换、刷新、带头像的回复气泡、默认折叠的脱敏工具活动、较早/最新消息翻页，以及底部“此聊天为只读”和“关闭聊天”。有新消息且阅读者位于底部时跟随到最新，向上查看历史时不被强制拉回。没有可观察任务时明确说明暂无消息。
- 边界：只发 GET 请求，无输入框、发送、接管、继续执行或审批动作；run 级 user 行、隐藏推理与原始私有工具参数仍不展示；仅在弹层打开、任务运行/排队且查看最新页时才每 5 秒刷新，关闭即停止；旧任务的晚响应不覆盖当前任务。
对应设计 §41.2、任务 16.1–16.4。


## 需求 28：人工动作浮层遵循渐进披露（2026-11-18）

从“下一步操作”打开的人工动作浮层首屏只呈现当前最该做的一件事：现在需要你做什么（下一步或当前步骤）、第几步共几步，以及“开始/继续动作”主按钮。目的与依据收在“查看为什么需要你”内；步骤、前置条件、资料引用、证据要求、执行回执、暂停并保存进度、已保存进度、回执历史和详情分别是默认折叠的行，每行只给一句预览，展开才看正文。动作进行中时，步骤与回执两行默认展开，便于直接执行与提交。折叠不得丢失已输入的回执内容，也不改变任何开始、暂停、回执提交的请求语义和幂等键。状态、版本、开始执行人这类内部事实只在“详情”中出现，首屏不再展示原始标识与时间戳。对应设计 §42、任务 17.1–17.2。

## 需求 29：自动化执行中读取密码管理器须经步骤审批（2026-11-18）

目标（Outcome）执行线程里的 Bot 不得因为“处于自动化线程”而直接要求用户手动登录。它应通过现有的 Bitwarden 工具申请读取，服务端把申请变成一条给目标所有者的“步骤审批”决策（理由码 `credential_access_required`），暂停该任务；所有者在决策中看到将被读取的登录项（名称、主机名、实例）并选择“允许本目标读取”或“不允许”。
- 授权范围：所有者允许后，对该目标的全部后续执行轮次有效，仍限定到具体实例和具体登录项，其他登录项必须另行审批；无需每轮重复询问。
- 授权来源：只有真实用户或所有者的选择生成授权；Bot、系统关闭、过期或撤回的决策不生成授权；自定义文字不得充当授权，该决策不允许自定义输入。拒绝不生成授权，且 Bot 不应重复申请。
- 范围边界：例行（routine）运行没有可回答的对象，仍不允许读取 Bitwarden；普通聊天仍使用聊天内的授权卡；凭据值仍只进入 Computer 的短时环境，不进入对话、决策或日志。
对应设计 §43、任务 17.3–17.6；与需求 005.1 的“读取前须用户授权”一致，仅把授权载体从聊天卡扩展到目标决策。

## 需求 30：目标批准后直接进入执行（2026-11-18）

所有者批准目标方案后，目标直接进入执行，不再单独提示“启动已批准的目标”。批准之后目标只会处于两种状态之一：正在执行，或正在等待步骤批准（决策、人工动作、凭据审批等）。批准与创建首个执行任务在同一事务内完成，批准的幂等重放与之后的任何启动请求都不得产生第二个初始任务或第二次运行。仅当没有更早的任务仍在运行或等待（即该版本确实是下一步）时才自动启动；存在更早的活动任务时沿用原有的接续规则。批准前已处于“已批准、无任务”的旧目标，在被打开时自动启动一次，不再显示启动按钮或“待启动”状态。聊天中的 `StartOutcome` 与 `/runs` 接口保留为幂等入口。对应设计 §44、任务 18.1–18.3。
