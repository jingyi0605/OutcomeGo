# 需求文档 - 移动端全功能 Outcome 管理

状态：Draft

## 简介

当前移动端（Android）的 Outcome 能力仅覆盖收件箱查看、目标列表/详情只读展示以及决策处理，无法在移动端完成创建目标、修订与批准契约、启动或取消执行、验收评审、退回返工、执行人工动作并提交回执、以及探索想法等高频管理动作，用户在移动端操作时被迫回到桌面端。

本 Spec 旨在为 Android 端（含 KMP `mobile/shared` 核心层）补齐全功能 Outcome 管理工作台：
- 在交互入口上，于 Bot 列表页（`DirectoryScreen`）支持**左滑呼出** Outcome 工作台，并在工作台首页支持**右滑返回 Bot 列表页**（与设置页“右滑呼出、左滑返回”的操作逻辑对称一致）。
- 在布局与功能上，参考桌面端 `OutcomeWorkspace`（`All goals` / `Needs attention` / `Explore ideas` + `New Outcome` + 详情/决策/人工动作路由），结合移动端 `SpatialGlass` 视觉体系实现完整的 Outcome 生命周期管理。

## 术语表

- **System**：OutcomeGo Android 客户端与 KMP `mobile/shared` 核心层
- **Outcome 工作台**：移动端全功能目标管理主页面，对应桌面端 `OutcomeWorkspace`
- **Bot 列表页**：Android 端 `DirectoryScreen`，登录后的主导航目录页
- **Contract Revision**：Outcome 的契约修订版本，包含目标条款（goal）与验收标准（criteria）
- **Human Work Item / Action**：需要人工参与执行、提交回执并接受验收的工作项
- **Explore Idea**：处于探索阶段的想法条目，可推进生成提案或直接转为规划/目标

## 范围说明

### In Scope

- Bot 列表页左滑呼出 Outcome 工作台、工作台右滑返回 Bot 列表的对称抽屉手势与转场动画
- KMP `mobile/shared` 层补齐 Outcome 规划/创建、契约修订/批准、运行/取消、工作项 Transcript、验收/返工、人工动作（开始/暂停/回执/知识检索阅读）、探索（Explore）的全部模型与 HTTP API
- Android 端 `FeatureGateway` / `LiveFeatureGateway` / `FeatureContracts` 对接上述 KMP API
- Android 端全功能 Outcome 工作台 UI（全部目标 / 待处理收件箱 / 探索想法三标签 + 新建规划向导 + 目标详情全操作 + 人工动作全操作 + 决策处理），保持与移动端一致的 `SpatialGlass` 玻璃态风格与中英双语支持
- 保留现有 `OutcomeInboxScreen` 深链/推送通知直达能力，并与新工作台无缝衔接

### Out of Scope

- iOS 端（`apps/ios`）的同步改造（后续单独 Spec 处理）
- 服务端新增或修改业务逻辑（复用现有 `/api/v0/*` 到 `/api/*` 的路由映射）
- 桌面端（`apps/desktop`）UI 改造

## 需求

### 需求 1：Bot 列表页左滑呼出与右滑返回工作台

**用户故事：** 作为 Android 用户，我希望在 Bot 列表页向左滑动就能拉出 Outcome 工作台，并在工作台内向右滑动回到 Bot 列表，以便获得与设置页一致的单手直觉操作体验。

#### 验收标准

1. WHEN 用户在 Bot 列表页（非搜索态）从右向左水平拖动达到触发阈值（`72.dp`）THEN System SHALL 从右侧以抽屉转场动画打开 Outcome 工作台。
2. WHEN 用户在 Outcome 工作台根页面从左向右水平拖动达到触发阈值（`72.dp`）或点击返回按钮/系统返回 THEN System SHALL 以对称抽屉动画关闭工作台并返回 Bot 列表页。
3. WHEN 用户在 Bot 列表页向右拖动 THEN System SHALL 继续触发原有的设置页入口，与左滑 Outcome 互不冲突。

### 需求 2：工作台三栏信息架构与目标列表筛选

**用户故事：** 作为移动端用户，我希望 Outcome 工作台参考桌面端提供清晰的“全部目标 / 待处理 / 探索”视图与新建入口，以便快速定位不同阶段的目标。

#### 验收标准

1. WHEN 用户打开 Outcome 工作台 THEN System SHALL 在顶部展示工作台标题、“新建目标”入口以及“全部目标（All goals）”、“待处理（Needs attention）”、“探索想法（Explore ideas）”三个标签页。
2. WHEN 用户处于“全部目标”标签页 THEN System SHALL 支持按状态筛选、分页加载更多、下拉/点击刷新，并展示各目标的标题、状态、所属 Bot、当前修订版本及更新时间。
3. WHEN 用户处于“待处理”标签页 THEN System SHALL 复用并升级收件箱能力，支持按分类筛选（全部分类、待决策、待验收、待人工处理、已完成）并直接跳转至对应的决策、人工动作或目标详情验收页面。

### 需求 3：新建目标与规划向导（Planning Wizard）

**用户故事：** 作为移动端用户，我希望直接在手机上发起目标规划、指定执行 Bot、查看并确认规划草案后创建目标，而不再提示“请在 Desktop 完成”。

#### 验收标准

1. WHEN 用户点击“新建目标”并填写目标描述与执行 Bot（可选补充约束/预算）提交规划 THEN System SHALL 调用 `/api/v0/outcomes/plans` 生成规划草案并展示目标条款、验收标准及工作项预览。
2. WHEN 规划处于异步生成中或需要轮询 THEN System SHALL 通过 `/api/v0/outcomes/plans/{id}` 更新草案状态并在就绪后允许确认创建。
3. WHEN 用户确认规划草案并提交创建 THEN System SHALL 调用 `/api/v0/outcomes` 创建目标并跳转至新目标详情页。

### 需求 4：目标详情全生命周期管理（契约修订、批准、运行与取消）

**用户故事：** 作为移动端用户，我希望在目标详情页查看完整状态、编辑或批准契约修订、启动运行、取消目标以及查看工作项执行日志（Transcript），以便随时掌控目标进度。

#### 验收标准

1. WHEN 目标存在待批准修订或用户需要修改契约 THEN System SHALL 支持查看修订内容、发起新修订（`POST /api/v0/outcomes/{id}/revisions`）以及批准指定修订（`POST /api/v0/outcomes/{id}/revisions/{rev}/approve`）。
2. WHEN 目标处于可运行状态 THEN System SHALL 支持点击启动运行（`POST /api/v0/outcomes/{id}/runs`）；WHEN 目标处于可取消状态 THEN System SHALL 支持输入原因并取消目标（`POST /api/v0/outcomes/{id}/cancel`）。
3. WHEN 用户查看目标下的工作项（Work Item）THEN System SHALL 支持展开或进入查看该工作项的执行日志（`GET /api/v0/outcomes/{id}/work-items/{itemId}/transcript`）并支持分页加载更早记录。

### 需求 5：成果验收评审（Review）与退回返工（Rework）

**用户故事：** 作为移动端用户，我希望在目标待验收时查看每条验收标准的证据与输出产物，逐条提交通过/不通过评审，或在需要时退回返工。

#### 验收标准

1. WHEN 目标处于待验收状态 THEN System SHALL 展示各验收标准（Criterion）、关联输出（Outputs）与证据（Evidence），并允许用户选择验收结果、填写评语后提交评审（`POST /api/v0/outcomes/{id}/reviews`）。
2. WHEN 用户认为当前成果需要返工 THEN System SHALL 允许填写返工说明并提交返工请求（`POST /api/v0/outcomes/{id}/rework`），随后刷新目标状态。

### 需求 6：人工动作执行、回执提交与知识资料查看

**用户故事：** 作为移动端用户，我希望在手机上直接开始、暂停人工动作，查阅关联知识资料，并填写表单/说明提交回执，完成人机协同闭环。

#### 验收标准

1. WHEN 人工工作项（`executorType == "human"`）处于可操作状态 THEN System SHALL 支持点击“开始”（`POST /api/v0/work-items/{id}/start`）与“暂停”（`POST /api/v0/work-items/{id}/pause`）。
2. WHEN 用户完成人工步骤并填写必填输入与说明 THEN System SHALL 支持提交回执（`POST /api/v0/work-items/{id}/receipts`），并在提交后刷新回执历史与工作项状态。
3. WHEN 人工动作页包含知识资料引用或用户需要检索资料 THEN System SHALL 支持调用 `/api/v0/outcomes/{id}/knowledge/search` 与 `/api/v0/outcomes/{id}/knowledge/read` 检索并阅读知识正文。

### 需求 7：探索想法（Explore Ideas）管理

**用户故事：** 作为移动端用户，我希望在移动端查看、创建探索想法，对其生成提案（Propose）或丢弃（Discard），并将提案直接推进为目标规划。

#### 验收标准

1. WHEN 用户切换到“探索想法”标签页 THEN System SHALL 调用 `/api/v0/explore` 分页展示想法列表及其状态。
2. WHEN 用户创建新想法（`POST /api/v0/explore`）、为想法生成提案（`POST /api/v0/explore/{id}/propose`）或丢弃想法（`POST /api/v0/explore/{id}/discard`）THEN System SHALL 正确执行请求并更新列表与详情状态；若生成目标规划，可直接进入目标详情或规划确认流程。
3. WHEN 服务端返回 `404` 表示不支持 Explore 能力 THEN System SHALL 给出明确友好提示而不崩溃。

## 非功能需求

### 非功能需求 1：样式一致性与可用性

1. WHEN 渲染 Outcome 工作台及所有子页面 THEN System SHALL 统一使用 `SpatialAmbientCanvas`、`SpatialGlassSurface`、`SpatialTokens` 及 `FeaturePage` 体系，保持与 Bot 列表、设置页一致的视觉风格，并完整支持中/英文切换（`localizedText`）。
2. WHEN 遇到网络错误、401 未授权、409 状态冲突或 410 过期 THEN System SHALL 保留用户输入/草稿状态，展示明确错误提示与重试入口，并在 401 时触发重登引导。

### 非功能需求 2：可测试性与构建质量

1. WHEN 修改 KMP `mobile/shared` 模型与传输逻辑 THEN System SHALL 提供对应的 `commonTest` 单元测试覆盖序列化、路径构造与核心状态逻辑。
2. WHEN 完成 Android 端改造 THEN System SHALL 通过 `:mobile:shared` 与 `:mobile:androidApp` 的单元测试及 `bash scripts/android/package-debug.sh` 调试包构建验证。

## 成功定义

- Bot 列表左滑可流畅呼出 Outcome 工作台，工作台内右滑可返回 Bot 列表。
- 移动端移除所有“请在 Desktop 完成”的阻塞提示，桌面端 Outcome 工作台的 7 项核心能力均可在 Android 端独立闭环操作。
- KMP 共享层测试、Android 单元测试及 Debug APK 打包全部通过，并在 `10.255.0.204` 真机完成验证。
