# 设计文档 - 移动端全功能 Outcome 管理

状态：Draft

## 1. 概述

### 1.1 目标

- 为 Android 端构建与桌面端 `OutcomeWorkspace` 能力对等的全功能 Outcome 管理工作台，彻底消除移动端“请在 Desktop 完成”的功能缺口。
- 在 Bot 列表页（`DirectoryScreen`）建立与左侧“设置页”完全对称的右侧抽屉交互：左滑呼出 Outcome 工作台，右滑返回 Bot 列表。
- 扩展 KMP `mobile/shared` 核心层与 Android `FeatureGateway` 体系，保持网络传输、序列化与状态管理的跨平台可复用性与可测试性。

### 1.2 覆盖需求

- `requirements.md` 需求 1：Bot 列表页左滑呼出与右滑返回工作台
- `requirements.md` 需求 2：工作台三栏信息架构与目标列表筛选
- `requirements.md` 需求 3：新建目标与规划向导（Planning Wizard）
- `requirements.md` 需求 4：目标详情全生命周期管理（契约修订、批准、运行与取消）
- `requirements.md` 需求 5：成果验收评审（Review）与退回返工（Rework）
- `requirements.md` 需求 6：人工动作执行、回执提交与知识资料查看
- `requirements.md` 需求 7：探索想法（Explore Ideas）管理

### 1.3 技术约束

- 共享核心层：Kotlin Multiplatform (`mobile/shared`)，`kotlinx.serialization` + `OutcomeGoTransport`
- Android UI：Jetpack Compose + Material3 + `SpatialGlass` 设计系统（`SpatialAmbientCanvas`、`SpatialGlassSurface`、`FeaturePage`）
- 导航与动画：AndroidX Navigation Compose (`OutcomeGoApp.kt`) + `AnimatedContentTransitionScope`
- 服务端协议：复用现有服务端路由，所有请求经由 `/api/v0/...`（服务端 `apps/server/src/main.ts` 自动将 `/api/v0` 前缀重写为 `/api`），携带 Bearer Token 鉴权。

## 2. 架构

### 2.1 系统结构

整体分为三层：
1. **导航与手势壳层（`apps/android/.../ui/OutcomeGoApp.kt` & `DirectoryScreen.kt`）**
   - `DirectoryScreen` 监听水平拖拽手势：右滑（`total >= 72.dp`）呼出 `SETTINGS`（左侧抽屉）；左滑（`total <= -72.dp`）呼出 `OUTCOME_WORKSPACE`（右侧抽屉）。
   - `OutcomeGoApp` 新增 `OUTCOME_WORKSPACE` 路由，配置对称的右侧抽屉转场动画（进入从右滑入，退出向右滑出，底层 `DIRECTORY` 配合微移/缩放景深动画）。
2. **UI 工作台与子页面层（`apps/android/.../features/`）**
   - `OutcomeWorkspaceScreen`：工作台根视图，支持右滑返回 `DirectoryScreen`，顶部含标题、“新建目标”按钮及三栏切换（`全部目标` / `待处理` / `探索想法`）。
   - `OutcomePlanningScreen`：新建目标规划向导（填写目标与选择 Bot -> 生成规划草案 -> 确认条款与标准 -> 创建目标）。
   - `OutcomeDetailScreen`：升级为全功能详情页（状态概览、契约查看与修订编辑、批准修订、启动运行、取消目标、工作项列表与 Transcript 查看、验收评审与返工提交）。
   - `OutcomeHumanActionScreen`：升级为全功能人工动作页（开始/暂停、前置与步骤展示、资料检索与阅读、回执表单填写与提交、回执历史）。
   - `OutcomeDecisionScreen`：保留现有决策解决能力并接入工作台路由。
   - `OutcomeExploreTab`：探索想法列表、新建想法、生成提案（Propose）、丢弃（Discard）及跳转规划/目标。
3. **网关与 KMP 共享协议层（`FeatureGateway` & `mobile/shared/.../core/`）**
   - `Outcomes.kt` 扩展读写模型与 `TransportOutcomeWriteApi`（或统一合并为 `TransportOutcomeApi`）。
   - `OutcomeInbox.kt` 扩展人工动作操作与知识检索 API。
   - 新增 `OutcomeExplore.kt` 承载 Explore 模型与 `TransportExploreApi`。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `DirectoryScreen.kt` | Bot 列表手势识别，左滑触发 `onOutcomes()` | 水平拖拽手势 | 导航回调 `onOutcomes` / `onSettings` |
| `OutcomeGoApp.kt` | 路由注册与右侧抽屉转场动画 | 路由状态变化 | `OUTCOME_WORKSPACE` 进出场动画 |
| `OutcomeWorkspaceScreen` | 三栏工作台（全部目标/待处理/探索）+ 右滑返回 | 用户切换 Tab、筛选、创建或选择条目 | 子页面路由切换或 `onBack()` |
| `OutcomePlanningScreen` | 规划草案生成、轮询与确认创建 | 目标描述、Bot ID、预算/约束 | 新创建的 `OutcomeDetail` |
| `OutcomeDetailScreen` | 契约修订/批准、运行/取消、Transcript、验收/返工 | 用户操作与表单输入 | 更新后的 `OutcomeDetail` |
| `OutcomeHumanActionScreen` | 人工工作项开始/暂停、知识检索阅读、回执提交 | 操作指令、检索词、回执表单 | 更新后的 `OutcomeHumanWorkItem` / `Receipt` |
| `mobile/shared` (`Outcomes.kt`, `OutcomeInbox.kt`, `OutcomeExplore.kt`) | 序列化 DTO 与 `/api/v0/*` HTTP 调用 | 请求参数与 Bearer Token | 类型化响应或 `OutcomeGoRequestException` |

### 2.3 关键流程

#### 2.3.1 Bot 列表左滑呼出与右滑返回流程

1. 用户在 `DirectoryScreen`（非搜索态）向左拖动超过 `72.dp.toPx()`，触发 `onOutcomes()`。
2. `OutcomeGoApp` 导航至 `OUTCOME_WORKSPACE`（`launchSingleTop = true`），`isOutcomeOpening()` 触发右侧抽屉滑入动画。
3. 用户在 `OutcomeWorkspaceScreen` 根视图（未打开子详情时）向右拖动超过 `72.dp.toPx()` 或点击返回，触发 `onBack()`，以对称动画返回 `DIRECTORY`。
4. 若当前位于工作台内部子页（如详情页、规划向导、决策页、人工动作页），系统返回或返回按钮先退回工作台根视图，不直接退出工作台。

#### 2.3.2 新建目标与规划创建流程

1. 用户点击工作台右上角“新建目标”，进入 `OutcomePlanningScreen`。
2. 选择执行 Bot（复用已加载的目录 Bot 列表）并填写目标描述与可选预算/说明，点击“生成规划”。
3. 调用 `POST /api/v0/outcomes/plans`；若草案仍在生成中，轮询 `GET /api/v0/outcomes/plans/{planId}` 直至就绪或失败。
4. 用户审阅并确认规划草案中的目标条款与验收标准，点击“确认创建”调用 `POST /api/v0/outcomes`，成功后直接打开新目标详情页。

#### 2.3.3 目标执行、验收与人工协同闭环

1. 目标处于 `pending_approval` 时，用户在详情页审阅修订并点击“批准”（或发起新修订后批准）。
2. 批准后可点击“启动运行”调用 `POST /api/v0/outcomes/{id}/runs`。
3. 运行过程中用户可查看工作项状态及 `Transcript`，若存在 `human` 工作项可进入 `OutcomeHumanActionScreen` 执行“开始 / 暂停 / 查阅资料 / 提交回执”。
4. 当目标进入 `review_pending` / `needs_review` 时，用户在详情页逐条选择验收结果（`PASS` / `FAIL`）并填写评语提交 `reviews`，或填写原因提交 `rework` 退回返工。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7

- `OutcomeWorkspaceScreen`：工作台主容器，承接桌面端 `OutcomeWorkspace` 的三栏结构与“新建目标”入口。
- `OutcomePlanningScreen`：移动端规划向导。
- `OutcomeDetailScreen`：全功能目标详情、契约编辑器、运行/取消控制、Transcript 查看器、验收/返工面板。
- `OutcomeHumanActionScreen`：人工动作执行、知识搜索阅读弹窗/面板、回执表单与历史。
- `ExploreTabContent`：探索想法列表、创建弹窗、提案生成与丢弃操作。

### 3.2 数据结构（KMP `mobile/shared`）

覆盖需求：3、4、5、6、7

在 `Outcomes.kt`、`OutcomeInbox.kt`、`OutcomeExplore.kt` 中补充与 `@outcomego/contracts` 对齐的可序列化模型（所有状态字段保持 `String` 类型以兼容服务端扩展）：

- 规划与创建：`CreateOutcomePlanRequest`、`OutcomePlanningDraft`、`CreateOutcomeRequest`
- 契约与运行控制：`CreateContractRevisionRequest`、`ApproveContractRevisionRequest`、`StartOutcomeRunRequest`、`CancelOutcomeRequest`
- 验收与返工：`SubmitOutcomeReviewRequest`、`OutcomeCriterionReviewInput`、`OutcomeReworkRequest`
- 执行日志：`OutcomeWorkItemTranscriptPage`、`OutcomeTranscriptEntry`
- 人工工作项与知识：`HumanWorkMutationRequest`、`HumanWorkPauseRequest`、`HumanReceiptRequest`、`HumanKnowledgeSearchRequest`、`KnowledgeDocument`
- 探索想法：`ExploreIdea`、`ExploreIdeaPage`、`CreateExploreIdeaRequest`、`ProposeExploreIdeaRequest`、`ExploreProposal`、`DiscardExploreIdeaRequest`

### 3.3 接口契约

覆盖需求：2、3、4、5、6、7

所有接口均通过 `OutcomeGoTransport` 请求 `/api/v0/...`（服务端自动映射为 `/api/...`）：

| 功能 | 方法与路径 | 说明 |
| --- | --- | --- |
| 目标列表/详情 | `GET /api/v0/outcomes`、`GET /api/v0/outcomes/{id}` | 支持 `status`、`cursor`、`limit` 参数 |
| 创建规划/查询规划 | `POST /api/v0/outcomes/plans`、`GET /api/v0/outcomes/plans/{id}` | 生成与轮询规划草案 |
| 创建目标 | `POST /api/v0/outcomes` | 从规划草案创建目标 |
| 契约修订与批准 | `POST /api/v0/outcomes/{id}/revisions`、`POST /api/v0/outcomes/{id}/revisions/{rev}/approve` | 新建修订或批准修订 |
| 启动运行/取消 | `POST /api/v0/outcomes/{id}/runs`、`POST /api/v0/outcomes/{id}/cancel` | 运行控制 |
| 验收评审/返工 | `POST /api/v0/outcomes/{id}/reviews`、`POST /api/v0/outcomes/{id}/rework` | 验收与返工 |
| 工作项 Transcript | `GET /api/v0/outcomes/{id}/work-items/{itemId}/transcript` | 支持 `before`、`limit` 分页 |
| 人工动作控制/回执 | `POST /api/v0/work-items/{id}/start`、`pause`、`receipts` | 人工工作项闭环 |
| 知识资料检索/阅读 | `POST /api/v0/outcomes/{id}/knowledge/search`、`read` | 知识资料查阅 |
| 探索想法 | `GET/POST /api/v0/explore`、`POST /api/v0/explore/{id}/propose`、`discard` | 想法管理与提案 |

## 4. 数据与状态模型

### 4.1 数据关系

- 一个 `Outcome` 拥有多个 `ContractRevision`（当前版本由 `currentRevision` 标识），每个修订包含 `goal` 与 `criteria` 列表。
- `OutcomeDetail` 聚合当前修订、`workItems`、`outputs`、`evidence`、`reviews`。
- 人工工作项（`executorType == "human"`）关联 `OutcomeHumanActionCard` 与多条 `OutcomeHumanReceipt` 历史。

### 4.2 状态流转

- **Outcome 状态**：`draft` / `planning` -> `pending_approval` -> `approved` -> `queued` / `running` -> `review_pending` / `needs_review` -> `accepted`（或经 `rework` 重新进入执行，或 `cancelled` / `failed`）。
- **人工工作项状态**：`pending` / `ready` -> `in_progress` <-> `paused` -> `submitted` / `review_pending` -> `accepted` / `rejected`。
- **界面操作可用性**：依据当前 `status` 动态展示对应操作按钮（如 `pending_approval` 展示“批准修订”，`approved` 展示“启动运行”，`review_pending`/`needs_review` 展示“验收/返工”），同时保留“状态冲突时刷新详情”的兜底机制。

## 5. 错误处理

### 5.1 错误类型

- `401 Unauthorized`：登录态失效，回调 `onAuthenticationRequired` 引导重新认证。
- `404 Not Found`：旧版服务端不支持特定路由（如 `/api/v0/explore` 或 `/api/v0/outcomes`），降级展示友好提示而非崩溃。
- `409 Conflict` / `410 Gone`：修订版本或决策状态发生并发变更或过期，提示用户并自动重新拉取最新详情。
- 网络超时或 `5xx`：保留用户已填表单内容，提供“重试”按钮。

### 5.2 处理策略

1. 所有变更操作（批准、启动、取消、验收、返工、人工动作、提交回执、创建规划/目标）在请求期间锁定按钮防重复提交。
2. 变更成功后自动刷新当前页面数据，并标记工作台列表需要刷新。
