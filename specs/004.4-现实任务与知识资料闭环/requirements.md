# 需求文档 - 现实任务与知识资料闭环

状态：Draft

关联文档：[README.md](README.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 简介

现实任务不能因为 Agent 生成了说明就被视为完成。系统需要将资料引用、人工动作、执行回执和验收结果连接起来。

## 范围说明

### In Scope

- 可替换 KnowledgeProvider。
- 资料来源、版本和适用范围。
- 人工动作卡。
- 人工执行回执和 Evidence。
- 现实任务验收。
- 探索轨和交付轨的最小区分。

### Out of Scope

- 自动控制现场设备。
- 将人工动作自动转换成 Agent 执行。
- 长期偏好训练和复杂知识图谱。
- Project 实体和组织级资料权限（第一版 projectScope 见 design.md §15）。
- X-File 等外部知识库适配（只保留 provider 接口）。
- 移动端回执上传（父 design.md §41；移动端第一版只读）。

## 需求

### 需求 1：提供带来源的资料

**用户故事：** 作为执行人，我希望看到与任务相关的资料和来源，以便按上下文完成工作。

#### 验收标准

1. WHEN System 返回资料 THEN SHALL 展示来源、版本或时间信息。
2. WHEN 资料不适用于当前项目或环境 THEN System SHALL 标记或排除该资料。
3. WHEN 资料权限不足 THEN System SHALL 不把资料内容伪装成可用结果。

### 需求 2：生成人工动作卡

**用户故事：** 作为执行人，我希望看到清晰的下一步动作和验收条件，以便在现场完成任务。

#### 验收标准

1. WHEN WorkItem 的执行者是人 THEN System SHALL 创建人工动作卡。
2. WHEN 人工动作卡展示 THEN SHALL 包含目的、步骤、输入、风险提示和完成材料。
3. WHEN Agent 只生成了步骤但没有人工回执 THEN System SHALL 不标记动作完成。

### 需求 3：提交人工回执

**用户故事：** 作为执行人，我希望提交日志、照片、测试单或备注，以便系统验收现实任务。

#### 验收标准

1. WHEN 用户提交回执 THEN System SHALL 关联到 WorkItem 和 AcceptanceCriterion。
2. WHEN 必需回执缺失 THEN System SHALL 保持待验收状态。
3. WHEN 回执通过验收 THEN System SHALL 允许 Outcome 继续或完成。

### 需求 4：区分探索和交付

**用户故事：** 作为用户，我希望新想法不会自动扩大正式任务范围，以便探索和交付保持清楚。

#### 验收标准

1. WHEN 用户输入未形成正式 Outcome 的想法 THEN System SHALL 将其保留为探索内容。
2. WHEN 探索内容要进入交付 THEN System SHALL 要求目标、验收和边界。
3. WHEN 探索超出预算或范围 THEN System SHALL 展示状态，不自动扩大交付 Contract。

## 成功定义

- 一个现实任务可以从资料引用进入人工动作卡。
- 用户提交实际回执后，系统可以进行证据验收。
- Agent 生成建议不会被误认为现实工作已经完成。

## 详细需求

### 需求 5：知识资料按项目范围检索

**用户故事：** 作为执行人，我希望系统只给出适用于当前项目的资料，以便不会误用其他客户内容。

#### 验收标准

1. WHEN 任务请求资料 THEN KnowledgeProvider SHALL 接收 `projectScope`（第一版为 `bot:<botId>`，见 design.md §15）、`outcomeId`、关键词和当前 Contract revision。
2. WHEN 返回资料引用 THEN 每条 SHALL 包含来源、版本/更新时间、项目范围和适用说明。
3. WHEN 资料没有当前项目权限或已失效 THEN System SHALL 不把它作为默认建议，并展示不可用原因。
4. WHEN 多个 provider 返回重复资料 THEN System SHALL 按稳定来源 ID 去重，不丢失版本信息。

### 需求 6：人工动作卡可执行

**用户故事：** 作为现场执行人，我希望动作卡说明目的、步骤、输入和完成材料，以便不必回到长篇 Agent 对话中寻找下一步。

#### 验收标准

1. WHEN WorkItem 的 `executorType=human` THEN System SHALL 展示目的、前置条件、步骤、输入、输出和验收条款。
2. WHEN 动作涉及资料 THEN 卡片 SHALL 提供来源链接或引用 ID。
3. WHEN 用户开始动作 THEN System SHALL 记录 `startedAt` 和执行主体。
4. WHEN 用户暂停动作 THEN System SHALL 保留已填写材料和当前状态。

### 需求 7：人工回执可验收

**用户故事：** 作为负责人，我希望看到实际执行回执，以便区分“已给建议”和“已完成工作”。

#### 验收标准

1. WHEN 用户提交文本、文件、照片、日志、测试单或外部记录引用 THEN System SHALL 创建 HumanReceipt/Evidence 并关联 WorkItem。
2. WHEN 回执缺少必需材料 THEN System SHALL 保持 `submitted`、`review_pending` 或 `UNVERIFIED`，不能自动完成。
3. WHEN Reviewer 通过全部必需材料 THEN System SHALL 将 WorkItem 标记 `accepted` 并允许 Outcome 继续。
4. WHEN Reviewer 驳回回执 THEN System SHALL 返回缺口和下一步，保留原回执历史。

### 需求 8：探索和交付范围分开

**用户故事：** 作为用户，我希望先探索新想法，再决定是否进入正式交付，以便不会污染已批准 Contract。

#### 验收标准

1. WHEN 输入没有目标、验收或边界 THEN System SHALL 允许保存为 `explore` 内容。
2. WHEN 用户要转为交付 THEN System SHALL 创建新的 PlanningDraft，不直接修改现有 Contract。
3. WHEN 探索产生新建议 THEN System SHALL 关联来源 Outcome，但不得自动创建正式 Run。
4. WHEN 探索被取消或超过用户设定范围 THEN System SHALL 结束探索并保留已有记录。

## 非功能需求

### 非功能需求 1：来源可追踪

1. 每条资料引用必须能够反查 provider、来源 ID、版本或更新时间。
2. 每条人工回执必须能够反查提交人、时间、WorkItem 和 Contract revision。

### 非功能需求 2：数据范围

1. Provider 查询必须带有当前项目或 Outcome 范围。
2. 资料权限不足时不得返回正文作为默认上下文。

### 非功能需求 3：幂等和可恢复

1. 重复提交同一个回执 client request ID 不得创建第二条回执。
2. 页面刷新、客户端重连或动作卡重新打开不得丢失已提交材料。

### 非功能需求 4：可维护性

1. 新增资料 provider 不得修改人工动作卡和验收状态机。
2. 新增回执类型只扩展 payload/asset 适配，不复制 WorkItem 生命周期。

## 人工任务验收矩阵

| 状态 | 用户可见内容 | 是否可进入下一步 |
|---|---|---|
| `pending` | 目的、前置条件、建议步骤 | 否 |
| `in_progress` | 当前步骤、已填内容、资料 | 否 |
| `submitted` | 回执摘要、缺失项 | 否，等待 Review |
| `accepted` | Reviewer、Evidence、完成时间 | 是 |
| `rejected` | 缺口、修正建议、原回执 | 否 |
| `cancelled` | 取消原因和关联 Outcome 状态 | 否 |

## 需求 9：KnowledgeProvider 可以被替换和测试

**用户故事：** 作为维护者，我希望资料来源通过统一接口接入，以便先用当前项目文件完成闭环，再按需增加其他资料库。

#### 验收标准

1. WHEN provider 被调用 THEN SHALL 使用统一的 query、scope、reference 和 read 结构。
2. WHEN provider 返回结果 THEN 每个引用 SHALL 带 sourceRef、版本/时间、scope 和 stale 信息。
3. WHEN provider 不可用 THEN System SHALL 返回结构化错误，不改变 Contract 或 WorkItem 状态为完成。
4. WHEN 使用 fixture provider THEN 任务 SHALL 能在无外部凭据环境重复执行。

## 需求 10：资料引用不会越过项目范围

**用户故事：** 作为多项目用户，我希望资料只来自当前项目，以便不会把其他客户的信息带入任务。

#### 验收标准

1. WHEN 查询资料 THEN request SHALL 包含 Outcome、Contract revision 和项目范围。
2. WHEN sourceRef 不属于当前范围 THEN System SHALL 拒绝读取或不返回正文。
3. WHEN 资料从历史消息或文件读取 THEN System SHALL 保存其来源 ID和版本/digest。
4. WHEN scope 不明确 THEN System SHALL 要求用户补充或只返回公共 fixture。

## 需求 11：人工 WorkItem 状态可恢复

**用户故事：** 作为现场执行人，我希望离开页面后重新打开仍能看到当前步骤，以便不重复填写或误认为完成。

#### 验收标准

1. WHEN 用户开始 Human WorkItem THEN System SHALL 记录执行主体、开始时间和当前状态。
2. WHEN 用户暂停或客户端断开 THEN System SHALL 保留已保存的步骤和草稿摘要。
3. WHEN 用户重新打开动作卡 THEN System SHALL 从服务端恢复当前状态和 Evidence 要求。
4. WHEN Contract revision 已改变 THEN System SHALL 阻止旧动作卡提交并提示刷新。

## 需求 12：人工回执支持多种材料

**用户故事：** 作为执行人，我希望提交文字、照片、日志、测试单或外部记录，以便现实任务可被验收。

#### 验收标准

1. WHEN 用户提交 receipt THEN System SHALL 支持文本摘要、asset refs、source refs 和 observations。
2. WHEN asset 不存在或已关联到其他 WorkItem 的回执 THEN System SHALL 拒绝提交。
3. WHEN 需要的材料缺失 THEN WorkItem SHALL 保持 submitted/review_pending/UNVERIFIED。
4. WHEN reviewer 驳回 THEN System SHALL 返回缺口并保留原 receipt 历史。
5. WHEN 同一 clientRequestId 重试 THEN System SHALL 返回同一 receipt，不创建重复记录。

## 需求 13：Evidence 和人工验收可对账

**用户故事：** 作为负责人，我希望每一条人工验收都能反查到实际材料，以便区分建议和事实。

#### 验收标准

1. WHEN reviewer 标记条款 PASS THEN SHALL 关联满足要求的 Evidence 或明确的确定性检查。
2. WHEN Evidence 版本与当前 Contract 不一致 THEN System SHALL 标记 stale 或要求重新提交。
3. WHEN 所有必需条款通过 THEN WorkItem SHALL accepted，并允许 Outcome 继续。
4. WHEN Outcome 重新进入新 revision THEN 旧 Evidence SHALL 保留但不能未经规则直接满足新条款。

## 需求 14：Explore 和 Delivery 有独立生命周期

**用户故事：** 作为用户，我希望探索内容可以转成新的交付任务，但不会直接改动当前已批准任务。

#### 验收标准

1. WHEN 用户创建没有目标/验收/边界的想法 THEN System SHALL 保存 ExploreIdea。
2. WHEN 用户请求转交付 THEN System SHALL 创建新的 PlanningDraft/Outcome。
3. WHEN ExploreIdea 转换 THEN 原探索记录 SHALL 保持可读且只读，新的 Outcome SHALL 记录来源。
4. WHEN 探索被丢弃 THEN 已产生的资料和历史记录 SHALL 按保留规则保留，不创建 Run。

## 需求 15：现实任务不会伪装成 Agent 完成

**用户故事：** 作为负责人，我希望 Agent 生成步骤不会自动关闭现场任务，以便结果反映真实执行。

#### 验收标准

1. WHEN Agent 只生成动作说明 THEN Human WorkItem SHALL 不进入 accepted。
2. WHEN 没有人工 receipt THEN Outcome SHALL 不因 Agent 自报完成而 Accepted。
3. WHEN 人工 receipt 被驳回或证据 stale THEN 系统 SHALL 展示缺口并保持未完成。
4. WHEN 人工验收通过 THEN 系统 SHALL 记录 reviewer、时间和证据引用。

## 需求 16：资料和回执数据有边界

**用户故事：** 作为用户，我希望资料正文和回执材料只在当前任务需要的范围内保存，以便减少泄露和误删。

#### 验收标准

1. Provider、日志、通知和客户端缓存不得保存超出当前任务需要的资料正文。
2. 回执上传失败不能清空已填写表单或删除已成功上传资产。
3. 未关联资产可以清理，但已被 Receipt/Evidence 引用的资产不得误删。
4. 外部 URL 无法读取时只能作为待核验来源，不能自动标记 PASS。

## 现实任务场景矩阵

| 场景 | 输入 | 期望 |
|---|---|---|
| 当前项目资料 | project scope + query | 返回带来源资料 |
| 跨项目资料 | source scope mismatch | 拒绝正文 |
| provider timeout | timeout | 结构化可重试错误 |
| 动作卡开始 | pending WorkItem | in_progress |
| 页面刷新 | in_progress | 状态和步骤保留 |
| 资料 stale | digest changed | stale/decision |
| 回执缺材料 | missing asset | review_pending/UNVERIFIED |
| 回执重复 | same request/hash | same receipt |
| 回执冲突 | same request/different hash | 409 |
| reviewer reject | missing criterion | rejected + comment |
| reviewer accept | all required pass | accepted + next step |
| explore convert | idea → delivery | new PlanningDraft |

