# 需求文档 - Outcome 统一模型与标准化规划

状态：Draft

## 简介

当前 OutcomeGo 的目标管理体系在演进过程中形成了多套并行的数据模型与规划管线：

- **对象模型割裂**：`Outcome`（`standard` / `tracked`）、`OwnerTodoItem`（`todo`）、`ExploreIdea`（`explore_idea`）、`Routine(once / 固定日期 Cron)`（`scheduled_once`）各自维护独立的表、服务、API 和前端详情页，彼此间升级/转换只能「关闭旧对象 + 复制创建新对象」，丢失上下文且难以统一管理；同时缺少轻量化的 `note`（笔记）对象承载备忘与调研草稿。
- **Plan 流程不可复用且权限设计存在缺陷**：目前存在 4 套彼此割裂的规划/预分析通道——`OutcomeThread(plan/replan)`、`Routine(preparation)`、`OutcomeThread(inspection)`、`OutcomePlanningService`。其中：
  - `scheduled_once` 的「运行建议（`preparation`）」因 `readOnly: true` 一刀切拦截了 `ListMachines` 和所有带 `machineId` 的本机工具，且受限于狭窄的只读 MCP 白名单与独立规划 Bot 隔离，导致读不到本机文档或业务 Bot 的 MCP 数据，产出的规划建议缺乏参考价值；
  - `inspection` 被硬锁为只能调用 `GetOutcome`，无法查看真实资料；
  - `standard` 的 `plan` 回合反而完全未在代码层限制写类工具，仅靠提示词约束；
  - `todo`、`explore_idea` 无法原地复用规划流程。

本 Spec 的核心目标是：**将 6 类目标/任务/笔记对象统一收口到 `Outcome` 单表管理，建立一套标准可复用、具备完整本机与只读 MCP 调研能力的统一 Plan 流程，并彻底整合与删除冗余的旧表、旧服务、旧路由与并行分支。**

## 术语表

- **System**：OutcomeGo 整体系统（包含 Server、Worker、Computer 运行时、Client SDK、Desktop 与 Mobile 客户端）。
- **Outcome**：系统唯一的目标/任务/笔记统一对象模型（`outcomego_outcome` 表），通过 `kind` 区分具体形态。
- **OutcomeKind**：Outcome 的 6 种标准类型：`standard`、`tracked`、`scheduled_once`、`todo`、`explore_idea`、`note`。
- **统一 Plan 流程（Unified Plan Pipeline）**：运行在 `OutcomeThread(role="planner")` 上的标准化、可复用规划引擎，支持 `triage`（收件自动分类与多条拆分）、`advice`（轻量运行建议/调研简报/主动巡检）和 `contract_plan`（正式合同与执行任务计划）三档输出。
- **Go 统一收件（Go Inbox / Intake）**：整合「新建目标」「记录想法」与侧栏快速记录的单一入口（弹窗标题「随便记点什么」），支持文本、`@Bot`、图片与文件附件，提交后立即落盘源记录并后台异步交由 Plan Pi Agent 分诊归类。
- **只读调研模式（`research_readonly`）**：Plan 与进度分析回合使用的标准工具权限档位（方案 B），允许本机读取与本机调研 Shell、允许调用规划 Bot 与目标归属 Bot 合并后的只读 MCP 及记忆/网页检索，但在代码层硬禁止外部投递、修改例程、写类 MCP 等副作用工具。
- **原地演进（In-place Promotion / Conversion）**：在不创建新对象、不丢弃原 `outcomeId` 与规划线程历史的前提下，将某个 Outcome 从轻量类型（如 `note`、`todo`、`explore_idea`、`tracked`、`scheduled_once`）转换/升格为另一种类型（如 `standard`）。
- **Routine**：回归纯粹的周期性（非固定日期 Cron / Interval）或事件触发例程，不再承担一次性排期或运行建议职责。

## 范围说明

### In Scope

- 将 `standard`、`tracked`、`scheduled_once`、`todo`、`explore_idea`、`note` 统一到 `Outcome` 表（含通用 `attachments` 承载）与统一服务中维护。
- 新增统一「Go / 随便记点什么」收件入口与 Plan Pi Agent 异步自动分诊能力（识别为 `note` / `todo(open)` / `standard` / `explore_idea` / `scheduled_once`，并支持保留源 `note` 的同源多条拆分）。
- 新增 `note` 类型完整能力（工作区「全部 / 笔记」筛选、**双向接入共享记忆 `MemoryFact`**、默认不进日历除非设时间、统一对话工具增改查、原地 Plan 与演进）。
- 重构标准化、可复用的 Plan 流程（覆盖所有 `kind`、收件自动分诊、`scheduled_once` 自动/手动准备、保留 `inspection.*` 策略的到期自动巡检收敛为 `plan(mode="advice")`），统一输入、输出结构与状态展示。
- 落地 Plan 阶段 `research_readonly` 权限模型（方案 B：本机只读 + 本机调研 Shell + 借用目标归属 Bot 的只读 MCP 及 `RecallMemory`/`ReadTranscript` 上下文 + 代码层硬禁副作用工具）。
- 统一 HTTP API、Agent 对话工具、Client SDK、Desktop 工作区/日历/详情页与 Android / iOS / KMP Mobile 接口调用。
- 彻底删除旧表、旧服务、旧路由与兼容代理层（不考虑旧字段向后兼容迁移；保留 Bot 内部任务清单 `TodoItem` / `todo-service.ts`）。

### Out of Scope

- 010 群任务看板（`GroupTask`）的架构改动（保持独立）。
- 周期性/事件型 `Routine` 的核心触发机制变更（仅剥离其一次性排期与 `preparation` 分支）。
- 审批与验收安全边界放宽（合同审批、最终验收、外部写动作授权仍由所有者掌控）。
- 为旧 API 保留兼容代理层或为历史数据库做复杂双写兼容。

## 需求

### 需求 1：统一 Outcome 对象模型（单一事实源）

**用户故事：** 作为所有者，我希望 `standard`、`tracked`、`scheduled_once`、`todo`、`explore_idea`、`note` 全部统一为 `Outcome` 对象在同一套体系中维护，以便用一个列表、一套详情与一套规则管理所有工作与记录，不再出现割裂的数据模型。

#### 验收标准

1. WHEN System 初始化或读写目标数据时 THEN System SHALL 仅通过 `Outcome` 单表及其标准子表（合同修订、工作项、规划/评审线程、决策、产出、证据、评审、人工回执、自动接受规则）维护全部 6 种 `OutcomeKind`（`standard`、`tracked`、`scheduled_once`、`todo`、`explore_idea`、`note`），不再保留 `OwnerTodoItem`、`ExploreIdea`、`OutcomePlanningDraft` 表及 `OutcomeTrackingMode` 枚举。
2. WHEN 所有者或 Bot 创建 `todo`、`explore_idea` 或 `note` 且未指定执行 Bot 时 THEN System SHALL 允许 `Outcome.botId` 为空并正常保存与展示；创建 `standard`、`tracked`、`scheduled_once` 时 SHALL 要求指定有效的活跃 `botId`。
3. WHEN 用户按 `kind`、状态、标签、时间范围或关键词查询 Outcome 列表时 THEN System SHALL 通过统一列表接口返回一致结构的数据视图，并支持按 `kind` 精确筛选与分页。
4. WHEN 所有者将任一轻量类型（`note`、`todo`、`explore_idea`、`tracked`、`scheduled_once`）原地演进/升格为 `standard` 或其他目标类型时 THEN System SHALL 保持同一 `outcomeId` 不变，保留原有正文、标签、来源引用及历史 `OutcomeThread` 规划记录，不产生「关旧建新」的重复对象。

### 需求 2：新增 `note`（笔记）类型、共享记忆接入与对话工具能力

**用户故事：** 作为所有者，我希望拥有轻量化的 `note` 类型来沉淀灵感、资料与会议记录，让机器人能够通过共享记忆自动检索到我的笔记要点，并能在对话中直接帮我创建、更新和检索笔记，需要时还能对笔记发起 Plan 转化为行动。

#### 验收标准

1. WHEN 所有者或 Bot 创建 `note` 类型 Outcome 时 THEN System SHALL 支持保存标题、Markdown 长正文（`description`）、图片与文件附件（`attachments`）、标签（`tags`）、来源引用（`sourceRef`）、关联源 Outcome（`parentOutcomeId`）以及可选的 `scheduledAt` / `dueAt`。
2. WHEN 创建或编辑启用了共享记忆同步（默认开启）的 `note` 时 THEN System SHALL 自动生成或更新关联的共享记忆条目（`MemoryFact`，每条遵循 500 字符上限并携带 `noteId` 溯源），使所有 Bot 在日常对话与规划回合调用 `RecallMemory` 时可自动召回笔记核心事实，并可按需通过 `GetOutcome` 读取完整正文与附件说明；WHEN 该 `note` 被归档、取消或关闭同步开关时 THEN System SHALL 同步撤销或失效对应的 `MemoryFact`，避免 Bot 记住过时或已删除的笔记。
3. WHEN Bot 在用户对话中需要记录、修改或查找笔记时 THEN System SHALL 提供统一的 Outcome 对话工具支持创建、更新（标题/正文/标签/时间）与按关键词/标签/`kind=note` 检索笔记，无需另建独立笔记工具体系。
4. WHEN 所有者打开目标管理工作区时 THEN System SHALL 在「全部」视图中提供独立的「笔记（`note`）」筛选分类（支持查看、编辑正文/标签/共享记忆开关、附件预览、归档/取消、发起 Plan 以及原地演进为 `todo` / `scheduled_once` / `standard`）；新建笔记统一通过工作区「Go」收件入口或对话工具完成。
5. WHEN 日历或 ICS 订阅渲染日程项时 THEN System SHALL 默认隐藏未设置 `scheduledAt` 与 `dueAt` 的 `note`；WHEN 某条 `note` 显式设置了 `scheduledAt` 或 `dueAt` THEN System SHALL 将其纳入日历展示并支持改期。

### 需求 3：`scheduled_once` 一次性排期目标完全迁入 Outcome

**用户故事：** 作为所有者，我希望一次性定时提醒/排期任务直接作为 `Outcome(kind="scheduled_once")` 统一管理，不再混在周期例程 `Routine` 中，同时完整保留排期、改期、暂停、恢复、取消、到点自动执行和结果交付能力。

#### 验收标准

1. WHEN 所有者或 Bot 创建一次性未来安排时 THEN System SHALL 创建 `Outcome(kind="scheduled_once")`（包含 `scheduledAt`、执行指令、可选的自动准备时间 `prepareAt` 与准备指令），不再在 `Routine` 表中写入 `scheduleKind="once"` 或固定日期 Cron 一次性标记。
2. WHEN `scheduled_once` 处于未开始正式执行的未来状态时 THEN System SHALL 支持改期、暂停、恢复与取消；每次修改指令或改期 SHALL 递增 `Outcome.revision`，并自动失效旧修订尚未执行的自动/手动准备回合。
3. WHEN `scheduled_once` 到达 `scheduledAt` 且处于启用状态时 THEN System SHALL 由统一调度器原子认领并派发正式执行回合；若当前修订存在已完成的 Plan 调研简报（`advice`），SHALL 自动注入正式执行回合作为参考数据；正式执行结束后 SHALL 按既有机制通过 `WakeParent` 向所有者主对话交付提醒或结果并记录交付状态。
4. WHEN 系统扫描或编辑 `Routine` 时 THEN System SHALL 仅处理周期（非固定日期 Cron / Interval）与事件触发例程，不再包含 `once`、`DATED_ROUTINE_CRON` 兼容逻辑或 `preparation` 执行类型。

### 需求 4：`todo` 与 `explore_idea` 完整迁入 Outcome

**用户故事：** 作为所有者，我希望待办项和探索想法都成为标准 Outcome，保留待办的高效流转与自动接受规则，同时可以直接对它们发起标准 Plan 或原地升级为正式交付目标。

#### 验收标准

1. WHEN Bot 建议待办或所有者创建待办时 THEN System SHALL 写入 `Outcome(kind="todo")`，完整保留 `suggested / open / waiting / accepted（UI 展示已完成）/ cancelled（UI 展示已忽略）` 状态、`executor`（`owner` / `bot`）、`urgency`、`dueAt`、`scheduledAt`、`followUpAt`、`snoozeUntil`、`dedupeKey`、来源授权校验（无有效所有者消息引用仅可创建 `suggested`，命中自动接受规则除外）以及自动接受规则（`OutcomeAutoAcceptRule`）。
2. WHEN 所有者对待办执行接受、延后（snooze）、完成、忽略、恢复或「交给 Bot（Handoff）」操作时 THEN System SHALL 通过统一的 Outcome 接口完成状态变更并更新活动视图与日历。
3. WHEN 所有者或 Bot 创建探索想法时 THEN System SHALL 写入 `Outcome(kind="explore_idea")`，支持 `draft / exploring / cancelled（UI 展示已丢弃）` 状态流转以及关联 `parentOutcomeId`、`sourceRef`、`budget`。
4. WHEN 所有者对 `todo` 或 `explore_idea` 点击「升级为正式目标」时 THEN System SHALL 在同一 `Outcome` 记录上原地演进为 `kind="standard"` 并启动标准 Plan 流程，不再保留独立 `OwnerTodoItem` / `ExploreIdea` 表及其跨表关联字段。

### 需求 5：标准化可复用的 Plan 流程与统一输入输出

**用户故事：** 作为所有者，我希望无论面对 `standard`、`scheduled_once`、`todo`、`explore_idea` 还是 `note`，都能使用同一套标准化的 Plan 流程进行调研与规划，既能快速产出结构化运行建议，也能在需要时平滑产出正式合同与任务计划。

#### 验收标准

1. WHEN 对任一非终态 `Outcome` 发起 Plan（统一收件「Go」自动分诊、手动调用 `POST /api/v0/outcomes/:id/plan`、创建 `standard` 目标自动触发、`scheduled_once` 到 `prepareAt` 自动触发、到期前主动巡检自动触发、或执行期触发 `replan` / 进度分析）时 THEN System SHALL 统一通过 `OutcomeThread(role="planner")` 调度执行，不再存在 `RoutineExecution(kind="preparation")`、`OutcomePlanningService` 或独立 `inspection` 硬锁分支；同时保留 `inspection.enabled` 与 `inspection.leadHours` 策略配置，由统一调度器在到期前自动触发 `plan(mode="advice")`（按修订幂等去重）。
2. WHEN Plan 请求指定产出模式（`mode: "triage" | "advice" | "contract_plan"`，缺省按 `kind` 自动推导：`standard` 默认 `contract_plan`，其余类型默认 `advice`）时 THEN System SHALL 使用同一套调研管线执行，并产出标准化结果：
   - `triage` 模式：通过结构化工具（`ClassifyOutcome`）结合用户原始文本、图片与附件判断归类为 `note` / `todo` / `explore_idea` / `standard` / `scheduled_once`，支持单落点原地演进或保留源 `note` 并拆出多条关联子项；
   - `advice` 模式：通过结构化工具（`SavePlanAdvice`）提交标准 JSON 结果，包含 `summary`（摘要）、`facts`（已核实事实及来源列表）、`gaps`（缺失或过期信息）、`recommendations`（下一步建议或待确认项）、`suggestedKind`（可选演进建议，覆盖 `standard | scheduled_once | todo | explore_idea | note`），并保存在 `OutcomeThreadTurn.result` 与 `reply` 中；
   - `contract_plan` 模式：通过 `SaveOutcomeContract` 与 `SavePlan` 产出或修订正式合同与可执行任务 DAG。
3. WHEN 所有者在已有规划线程的 Outcome 上继续发送消息（`POST /api/v0/outcomes/:id/thread/messages`）时 THEN System SHALL 复用同一 `OutcomeThread` 上下文进行多轮追问、补充调研、修订 `advice` 或原地演进为 `contract_plan`。
4. WHEN 同一个 Outcome 的同一修订已存在运行中/排队中的同模式 Plan 回合时 THEN System SHALL 幂等复用该回合而不重复入队；若上次 Plan 失败或修订号已更新，SHALL 允许重新发起。
5. WHEN 已配置独立规划 Bot 但该 Bot 当前不可用时 THEN System SHALL 按统一策略记录明确的回退原因并回退至目标归属 Bot（若目标无 `botId` 且无可用规划 Bot 则返回明确错误 `409 planner_unavailable`），不再在不同入口出现「一个报错、一个静默回退」的不一致行为。

### 需求 6：Plan 阶段只读调研权限模型（方案 B）

**用户故事：** 作为所有者，我希望规划阶段能真正读到我的本机文档和业务 Bot 授权的 MCP 数据，从而产出高准确度的运行建议与执行计划，同时在代码层严格杜绝规划阶段误执行写操作或擅自向外发消息。

#### 验收标准

1. WHEN Worker 派发任一 Plan / Replan / Advice / 进度分析回合给 Computer 时 THEN System SHALL 以统一的 `accessMode: "research_readonly"` 运行，替代原先割裂的 `readOnly: boolean` 与 `purpose === "inspection"` 硬锁。
2. WHEN Computer 运行在 `research_readonly` 模式时 THEN System SHALL 允许以下只读调研能力：
   - 本机访问（方案 B）：开放 `ListMachines`、`Read(machineId)`、`Shell(machineId)` 与 `AwaitShell(machineId)`，并在系统提示词中明确约束本机 `Shell` 仅用于只读查询/文档内容提取，禁止修改、删除、移动文件或触发外部副作用；
   - 容器与通用只读能力：开放容器内 `Read`、`Shell`、`AwaitShell`、`RecallMemory`、`ReadTranscript`、`ListSections`、`WebSearch`、`WebFetch`、`GetDynamicTools`、`CallDynamicTool`、`SearchPlugins`、`GetPlugin`、`GetMcpServerStatus`；
   - 规划写入工具：开放当前模式允许的 Outcome 规划工具（如 `GetOutcome`、`ListOutcomes`、`SavePlanAdvice`、`SaveOutcomeContract`、`SavePlan`、`CancelOutcome` 等）。
3. WHEN 规划回合由独立规划 Bot 执行且目标绑定了归属 Bot（`outcome.botId` 且 `outcome.botId !== plannerBotId`）时 THEN System SHALL 在 Worker 与 Server 侧自动合并加载并授权借用目标归属 Bot 的只读 MCP 工具与相关只读上下文（私有技能说明、`ReadTranscript`、`RecallMemory` 范围），确保规划 Bot 能查到目标归属 Bot 可访问的外部只读数据。
4. WHEN `research_readonly` 回合调用 MCP 工具时 THEN System SHALL 仅放行只读工具（`annotations.readOnlyHint === true`、内置只读连接器白名单或明确声明 `risk === "read"` 的工具），在 Computer 与 Server 双重拦截任何 `write` / `destructive` MCP 工具调用。
5. WHEN `research_readonly` 回合尝试调用 `SendToUser`、`WakeParent`、`UpdateRoutine`、`InstallPlugin`、`CopyToBox`/`CopyFromBox` 等外部投递或状态变更工具时 THEN System SHALL 在代码层直接拒绝。

### 需求 7：统一接口、统一工具层、多端适配与彻底清理冗余

**用户故事：** 作为系统维护者与所有者，我希望前后端、客户端 SDK、移动端和 Agent 工具全部切到统一的 Outcome 体系，并彻底删除旧表、旧服务和旧路由，不留历史包袱和兼容代理层。

#### 验收标准

1. WHEN 本 Spec 实施完成时 THEN System SHALL 彻底移除以下旧接口与旧代码，不保留任何兼容转发层：
   - 路由：`/api/v0/todos*`、`/api/v0/explore*`、`/api/v0/outcomes/scheduled-goals*`、`/api/v0/routines/:id/prepare`；
   - 服务与模型：`OwnerTodoService`、`ExploreService`、`OutcomePlanningService`、`OwnerTodoItem`、`ExploreIdea`、`OutcomePlanningDraft`、`OutcomeTrackingMode` 以及 `Routine` 中的 `once` / `DATED_ROUTINE_CRON` / `preparation` 代码路径。
2. WHEN Bot 在普通对话中操作目标、待办、一次性安排、想法或笔记时 THEN System SHALL 通过精简后的统一 Outcome 对话工具集完成创建、更新、检索、状态变更与发起 Plan，移除独立的 `Todo` 对话工具与旧 `CreateOutcome` 旁路。
3. WHEN 用户使用桌面端工作区（总览、全部、需要处理、日历）与详情抽屉时 THEN System SHALL 承接精简后的概览页（置顶紧凑可点击状态条 + 「需要我处理」+ 合并后的「进行中」+ 按需「即将执行」，「需要处理」内含「待办」子筛选），统一基于 `Outcome` API 渲染全部 6 种 `kind`，提供「全部 / 笔记」独立筛选及统一的「运行建议 / 规划」交互面板，移除独立的 `ScheduledGoalDetail` / `todo-api.ts` / `ExplorePanel` 旧客户端调用。
4. WHEN 移动端（`mobile/shared`、`apps/android`、`apps/ios`）访问目标、待办与探索想法时 THEN System SHALL 全部切换至统一的 `/api/v0/outcomes` 接口（替换原有 `/api/v0/explore` 与 `/api/v0/todos` 调用），移除旧路径引用并通过对应构建与单元测试。

### 需求 8：统一「Go / 随便记点什么」收件入口与 Plan Pi Agent 自动分诊

**用户故事：** 作为所有者，我希望不再在「新建目标」「记录想法」「新建待办」「记笔记」多个入口间做选择，只需点一下「Go」在「随便记点什么」里随手丢入文字、图片或文件，系统就立即收下并在后台由 Plan Pi Agent 自动识别归类或按需拆成多条同源记录。

#### 验收标准

1. WHEN 用户使用桌面端目标工作区或侧栏快速记录时 THEN System SHALL 将目标页右上角原「+ 新建目标」、概览工具栏「记录想法」与侧栏快速记录小灯泡整合为统一入口（目标页右上角按钮文案为 **`Go`**），点击后打开标题为 **「随便记点什么」** 的模态框；概览页「进行中」空状态不显示新建目标按钮。
2. WHEN 用户在「随便记点什么」模态框中输入内容时 THEN System SHALL 复用悬浮框（`DockComposer`）交互能力，支持纯文本、`@Bot` 可选指定归属/执行机器人、图片粘贴/拖拽/选择（带缩略图预览）与通用文件附件，支持无文本仅图片/附件提交；按下 `Enter`（非输入法组合态）或点击模态框内的 **`Go`** 按钮即可提交。
3. WHEN 用户提交「Go」内容时 THEN System SHALL 携带 `clientRequestId` 幂等键，复用现有资产上传接口（`POST /api/assets` / `AssetRef`）绑定附件、**先提交持久化源记录**（初始为 `Outcome(kind="note", status="active", kindMeta.createdVia="owner_go_inbox")`）并**立即关闭弹窗**，随后在后台异步触发标准 Planner 回合（`planMode: "triage"`，将文本与多模态图片/附件透传给 Pi Agent）；即使 Planner 不可用也不得回滚已提交的源记录。
4. WHEN Plan Pi Agent 执行 `triage` 分诊时 THEN System SHALL 不硬编码关键词规则，由 Agent 自主判断并调用 `ClassifyOutcome` 完成以下落盘之一：
   - **单落点**：将源 `Outcome` 原地 `convert` 为 `note` / `todo` / `explore_idea` / `standard`（自动串联一次 `contract_plan`） / `scheduled_once`；
   - **同源多条拆分**：保留源 `Outcome` 为 `kind="note"`（保存完整原始内容与附件并同步共享记忆），同时创建 1..N 条子 `Outcome`（`todo` / `standard` / `explore_idea` / `scheduled_once`），全部设置 `parentOutcomeId = sourceOutcome.id` 以关联同一源记录。
5. WHEN 分诊结果产出 `todo`（无论单落点或同源拆分出的子待办）时 THEN System SHALL 校验源记录的 `createdVia === "owner_go_inbox"` 并**直接创建为正式待办（`status = "open"`）**，不降级为待审批建议（`suggested`）。
6. WHEN 异步分诊完成或失败时 THEN System SHALL 在完成时推送轻量提示/通知（展示归类或拆分结果并支持直达详情与一键改判）；若 Planner 不可用、超时或未返回有效分类，源 `note` 记录与附件 SHALL 完整保留且不丢失，并向所有者暴露可重试或手动转换的入口。

## 非功能需求

### 非功能需求 1：性能与调度效率

1. WHEN 查询 Outcome 列表（按 `kind` / `status` / 时间窗口）或日历视图时 THEN System SHALL 仅需对 `Outcome` 表及其索引执行单源查询（替代原 4 张表的分散拼接），常规列表查询 P95 响应时间 < 200ms。
2. WHEN 调度器扫描到期的 `scheduled_once` 正式执行或 `prepareAt` 自动准备时 THEN System SHALL 通过复合索引 `(kind, status, scheduledAt)` / `(kind, prepareAt)` 批量扫描，单批上限 50 条，不阻塞其他例程或工作项派发。

### 非功能需求 2：可靠性与一致性

1. WHEN 对同一 Outcome 并发发起改期、原地演进、取消或 Plan 请求时 THEN System SHALL 使用 `pg_advisory_xact_lock(hashtext('outcome:' || outcomeId))` 串行化状态写操作，并结合 `revision` 乐观并发校验与 `clientRequestId` 幂等表防止重复入队或竞态脏写。
2. WHEN 本机未连接或某个 MCP 连接处于 `needs_auth` / `error` 状态时 THEN System SHALL 允许 Plan 正常降级继续执行，并在 `advice.gaps` 中如实说明未能读取的来源，不得因单个数据源不可用而中断整次规划。

### 非功能需求 3：可维护性

1. WHEN 未来新增 Outcome 子类型或新的规划输出字段时 THEN System SHALL 只需在 `OutcomeKind` 枚举、对应 Zod/Effect Schema 与 UI 类型映射表扩展，无需新增平行表、平行服务或复制规划管线。
2. WHEN 排查规划回合的工具调用与权限借用行为时 THEN System SHALL 在 `Run` 与 `PluginInvocation` 审计记录中清晰留痕执行 `botId`、借用 `sourceBotId`、`accessMode` 与规划 `mode`。

## 成功定义

- 数据库中仅存在 `Outcome` 单一对象主表（以及标准子表），`OwnerTodoItem`、`ExploreIdea`、`OutcomePlanningDraft`、`OutcomeTrackingMode` 与 `Routine` 一次性/准备逻辑 100% 清除。
- 6 种 `OutcomeKind` 均可直接发起标准 Plan；在配置独立规划 Bot 且目标涉及本机文档和业务 Bot 授权的 Notion/MCP 时，Plan 能实测读取本机文档与只读 MCP 并产出带真实来源依据的结构化建议。
- 桌面端「Go / 随便记点什么」统一收件入口可用：支持文本、`@Bot`、图片粘贴预览与附件，提交后立即关闭弹窗并后台异步由 Plan Pi Agent 自动识别为笔记 / 正式待办（`open`）/ 正式目标 / 想法，支持保留源笔记的同源多条拆分。
- `note` 类型支持自动同步精简摘要至共享记忆（`MemoryFact`）且随编辑/归档/删除同步更新、Bot 对话创建/更新/检索、工作区「全部 / 笔记」独立筛选、无时间默认不进日历、设时间自动进日历，并可原地演进为 `todo` / `scheduled_once` / `standard`。
- Server、Worker、Computer、Client SDK、Desktop、Android、iOS 全量类型检查与自动化测试通过，无残留死代码或孤立路由。
