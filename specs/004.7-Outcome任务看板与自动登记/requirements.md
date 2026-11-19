# 需求文档 - Outcome 任务看板与自动登记

状态：Draft

## 简介

目前目标只能通过"与 bot 对话规划"或"手动创建"建立，且每个目标都必须经用户批准契约、用户最终验收。用户希望目标管理最终能跟进"所有需要我决定的事情"，因此 bot 在日常处理事务时应主动登记目标，并把 Outcome 当作任务看板：凡是不能当场直接完成的事项都登记，无论是否需要用户批准。不需要用户决策的目标由 bot 自己跟进并自动结束，不强制用户验收。

## 术语表

- **System**：OutcomeGo 服务端与 bot 工具链
- **跟踪型目标（tracked）**：由 bot 通过 `TrackOutcome` 直接登记、无需 PlanOutcome 规划的目标，`trackingMode = tracked`
- **标准目标（standard）**：现有目标，需要用户批准契约并经验收
- **自动结束**：bot 调用 `CloseOutcome` 提交结果摘要后，系统直接置为 `accepted`，并记录 `autoClosedAt` 与审计事件，不进入用户待验收
- **所有者介入（ownerNeed）**：登记时声明的用户参与程度：`none`（无需）、`decision`（需用户决策）、`approval`（需用户批准后由 bot 执行）

## 范围说明

### In Scope

- 新增 bot 工具 `TrackOutcome`、`CloseOutcome`
- 跟踪型目标的数据模型、状态与审计
- 需要用户决策的跟踪型目标进入收件箱（Decision，无 WorkItem）
- 需要批准的登记沿用标准目标审批流程
- bot 平台提示词：何时登记、何时自动结束、何时必须升级
- 桌面端目标详情与列表区分"自动结束"标记

### Out of Scope

- 移动端展示改造（沿用 004.6，后续单独跟进）
- bot 对跟踪型目标的定时巡检与催办
- 改变标准目标的审批、验收规则

## 需求

### 需求 1：bot 自动登记目标

**用户故事：** 作为用户，我希望 bot 在日常处理事务时把当场做不完的事自动登记成目标，以便我在目标管理里看到全部待跟进事项。

#### 验收标准

1. WHEN bot 调用 `TrackOutcome` 并提供标题与目标描述 THEN System SHALL 直接创建目标，无需先调用 `PlanOutcome`
2. WHEN 同一 `clientRequestId` 重复调用 THEN System SHALL 返回同一目标而不重复创建
3. WHEN `ownerNeed = none` THEN System SHALL 创建 `tracked` 目标，契约由系统自动批准并记录审计，目标不出现在用户收件箱
4. WHEN 参数缺失或超出长度限制 THEN System SHALL 返回 400 `invalid_request` 且不创建任何数据

### 需求 2：不需要用户决策的目标自动结束

**用户故事：** 作为用户，我不希望为 bot 自己能完成的小事逐个验收，以便只关注真正需要我的事。

#### 验收标准

1. WHEN bot 对自己登记的 `tracked` 目标调用 `CloseOutcome` 并提交非空结果摘要 THEN System SHALL 将目标置为 `accepted`，写入 `autoClosedAt`，并追加"自动结束"审计事件
2. WHEN 目标存在未解决的 Decision THEN System SHALL 拒绝自动结束并返回 409
3. WHEN 目标是 `standard` 目标 THEN System SHALL 拒绝 `CloseOutcome` 并说明最终验收属于用户
4. WHEN 目标已 `accepted` 或 `cancelled` THEN `CloseOutcome` SHALL 幂等返回当前状态或 409 `invalid_outcome_transition`，不得改写历史
5. WHEN 自动结束成功 THEN 用户的待验收收件箱 SHALL 不新增条目

### 需求 3：需要用户决策的事项进入收件箱

**用户故事：** 作为用户，我希望所有需要我拍板的事都出现在目标管理里，以便一处处理。

#### 验收标准

1. WHEN `ownerNeed = decision` 并提供问题与 1–4 个选项 THEN System SHALL 创建 `tracked` 目标并创建无 WorkItem 的 Decision，目标状态为 `decision_pending`，并出现在收件箱
2. WHEN 用户解决该 Decision THEN System SHALL 记录选择，目标回到 `tracked` 进行中状态，bot 可经 `GetOutcome` 读到结果
3. WHEN 用户未解决 Decision THEN `CloseOutcome` SHALL 被拒绝（需求 2.2）
4. WHEN `ownerNeed = approval` THEN System SHALL 创建 `standard` 目标，契约为待批准，沿用现有批准与执行流程，bot 不得自行批准

### 需求 4：bot 行为约束

**用户故事：** 作为用户，我希望 bot 懂得何时登记、何时升级，避免目标噪音。

#### 验收标准

1. WHEN 事项能在当前回合直接完成 THEN bot SHALL 不登记目标
2. WHEN 事项当场无法完成（需等待、需后续跟进、需用户决策或批准）THEN bot SHALL 先用 `ListOutcomes` 查重，再登记
3. WHEN bot 的工作涉及用户必须决定的内容（付款、对外发送、删除、不可逆变更）THEN bot SHALL 使用 `ownerNeed = decision|approval`，不得声明 `none` 并自动结束
4. WHEN 自动结束 THEN bot SHALL 向用户简短说明已结束的结果

### 需求 5：展示与审计

**用户故事：** 作为用户，我希望能区分并回看自动结束的目标。

#### 验收标准

1. WHEN 目标为自动结束 THEN 详情与列表 SHALL 显示"自动结束"标记与结果摘要
2. WHEN 追溯 THEN 事件流 SHALL 记录登记者、自动批准、自动结束的 actor 与时间

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN 写操作失败 THEN System SHALL 整体回滚，不留下半成品目标
2. WHEN 工具重试 THEN System SHALL 依靠 `clientRequestId` 保持幂等

### 非功能需求 2：安全边界

1. WHEN 任何入口尝试批准标准目标或验收标准目标 THEN System SHALL 仍要求用户身份
2. WHEN 自动批准 `tracked` 目标 THEN System SHALL 不创建 WorkItem、不启动执行线程、不授予任何额外凭据或工具权限

### 非功能需求 3：可维护性

1. WHEN 新增跟踪型逻辑 THEN System SHALL 位于独立方法与测试中，不改动标准目标的审批分支语义

## 成功定义

- bot 能用一次 `TrackOutcome` 登记事项，且自动结束的目标不进入用户待验收
- 需要用户决策的事项均出现在收件箱
- 现有标准目标的审批、验收测试全部保持通过
