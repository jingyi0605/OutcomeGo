# 设计文档 - 任务全景视图

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [tasks.md](tasks.md) · [docs/20261124-现状核实记录.md](docs/20261124-现状核实记录.md)

本设计按三个部分组织（A 活动视图与目标降级、B 现实待办项、C 时间线与日历），共享 §2 的基础。模板要求的架构、接口、状态模型、错误处理、正确性属性、测试和风险分别在 §2 至 §10 中。

## 1. 概述

### 1.1 目标

- **A**：所有者能看到所有 bot 正在做什么和即将做什么。工作从已有持久记录推导；正式目标沿用原有条件，单次安排按 §3.10 作为轻量目标展示。
- **B**：由人来做的事有轻量的待办记录；机制通用、不含任何具体场景；没有有效所有者消息引用的创建只能是建议，所有者可对信任的例程设置自动接受规则。
- **D**：一切由 pi agent 推理、系统只限定输入输出的格式；场景不硬编码，业务数值由所有者配置。
- **E**：桌面端设置里有独立的"目标管理"页，位于"模型"与"语音消息"之间，集中显示所有相关设置。
- **C**：任务可排期并到点才开始；目标详情有时间线；全局日历、ICS 订阅、外部日历叠加。
- 三部分共用一份展示状态推导和一个"需要我"队列，视图都是只读投影。

### 1.2 覆盖需求

- `requirements.md` 需求 A1 至 A10、B1 至 B11、C1 至 C13 和全部非功能需求。对应关系见 requirements.md 末尾"需求与阶段对照"和本文 §9.4。

### 1.3 技术约束

以下事实已在代码中核实，位置见 [核实记录](docs/20261124-现状核实记录.md)：

- 后端 TypeScript、Effect Schema、Prisma（PostgreSQL）；契约在 `packages/contracts/src`，状态机和入队在 `packages/messaging/src`，服务在 `apps/server/src/services`，调度在 `apps/worker/src/worker.ts`；桌面端 React，目标仪表盘在 `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/`。
- **请求进展已存在且持久**：`Run.requestProgress`、`requestNextCheckAt`、`requestStoppedAt`、`requestReconciliations`。记录含 `state`（working、waiting、blocked、complete）、摘要、证据、剩余事项、下一步、`checkAt`、`deadline`、`blockSource`（user、policy、tool、runtime）。`Task` 派发自动开始追踪。例程和目标执行产生的运行被排除在外（`independentOrigins`）。
- **请求进展有自愈**：`settleRequestProgress` 在"状态是 working、没有活跃 worker、没有记录的下一次检查"时最多 3 次私下提醒父级核对，第 3 次把状态改为 `blocked`、来源 `runtime`。`dispatchRequestChecks` 在到期时把 `waiting` 转回 `working` 并排队检查。worker 在启动恢复和每分钟的 `dispatchRoutinePass` 里调用它们。
- **客户端目前只拿到请求进展的两个字段**：`requestState` 和 `requestNextCheckAt`（`snapshot/views.ts`）。
- 例程有 `nextRunAt`、`lastRunAt`、`enabled`、`pausedAt`，每次执行有 `status`（queued、running、completed、failed、cancelled、skipped）、`scheduledFor`、`error`、`skipReason`。`Subagent` 有 `requestRunId`、`status`、`progress`。
- 目标管理是可选模块，`outcomesEnabled` 默认关闭（`packages/messaging/src/feature-settings.ts`）。目标相关工具在 `apps/computer/src/runtime/dynamic-catalog.ts` 里仅对非子 agent、非 automation、非只读回合开放。
- 基础提示词在 `packages/messaging/src/prompts/platform.json`；目标管理一节 `native-outcome-records` 约 4,853 字符；目标管理开启时基础提示词约 27,328 字符，关闭时约 22,473 字符。工具参数说明放在工具描述里，按需加载。
- 004.4：人工任务（`executorType=human`）只能作为一个目标的子任务产生，来源是 `RequestHumanAction` 或决策的 `manual_action` 选项。
- 任务状态机允许 `running → queued`；`settleOutcomeWorkItem` 只对 5 种状态提前返回，因此延后必须配结算守卫（§5.4）。
- 计划任务当前没有任何时间字段，一个计划最多 20 个任务；`WorkItemView` 没有返回 `startedAt`、`completedAt`。
- 桌面端依赖里没有日历或甘特图组件。

### 1.4 共同原则

1. **谁执行，决定记录从哪来**：bot 执行的从已有记录推导；人执行的要显式待办；等外部的是待办加等待。
2. **展示状态读时推导，不存储**，由 §2.2 的单一实现负责。
3. **每类事实只认一个权威来源**，不再造第二套。
4. **没有有效所有者消息引用的创建只能是建议**，由所有者确认，或命中所有者创建的自动接受规则；判断依据是服务端按 ID 读取的所有者消息，不靠 agent 转述，也不依赖来源类型。
5. **时间诚实**：实际是事实，计划和估算只是意图，不预测。
6. **所有者的日期调整不改契约**；排期和延后不扩大任何权限。
7. **新增存储**：待办项、自动接受规则、任务与目标的日期列、订阅令牌、现有设置表的策略 JSON 列，以及 §3.10 的单次例程调度元数据。视图状态读时推导。
8. **提示词不增反减**，工具参数放进工具描述。
9. **一切由 agent 推理，系统只定格式**：是否记录、标题、概括、紧急度、何时跟进都由 agent 给出；服务端只校验格式、权限、来源和幂等（§2.5）。
10. **不硬编码场景，业务数值不进代码**：代码里只有通用流水线和格式与规模上限；业务数值由所有者可配置的策略设置承载（§2.6）。

## 2. 共同基础

### 2.1 系统结构

```text
持久事实（唯一权威）                          读时推导                      视图
──────────────────────────────────────────────────────────────────────────────────────────
Run.requestProgress / requestNextCheckAt  ┐
Subagent（executor）                        │  deriveDisplayState()        活动视图
Routine / RoutineExecution                  ├─► ActivityItem[]          ─► "需要我"队列
OutcomeWorkItem（新增日期列）                │  NeedsMeItem[]               目标详情时间线
Outcome（新增 dueAt）/ 收件箱步骤            │  TimeItem[]                  全局日历 / ICS
TodoItem（新增）                            ┘                              移动端
外部日历（只读，宿主调用插件）
```

- 展示状态都不入库。新增存储只有 `TodoItem`、日期列和订阅令牌。
- 契约与推导函数放在 `packages/contracts/src/task-overview.ts`（新），服务端和桌面端共用。

### 2.2 展示状态推导

覆盖需求：A1、A6、B2、C4、C9。所有状态都由 `deriveDisplayState` 在读取时计算，状态机和目标状态派生不变。

**请求（来自请求进展）：**

| 展示状态 | 条件 |
| --- | --- |
| 进行中 | `state = working` 且 `requestReconciliations = 0` |
| 核对中 | `state = working` 且 `0 < requestReconciliations < 3` |
| 等待中 | `state = waiting`，下次检查在未来或过期不超过策略 `activity.checkOverdueMinutes` |
| 检查未触发 | `state = waiting` 且 `requestNextCheckAt` 早于现在超过策略 `activity.checkOverdueMinutes` |
| 需要我 | `state = blocked` 且 `blockSource` 为 `user` 或 `policy` |
| 受阻 | `state = blocked` 且 `blockSource = tool` |
| 无人跟进 | `state = blocked` 且 `blockSource = runtime` |
| 已完成 | `state = complete`，策略 `activity.recentCompletedHours` 内显示在"最近完成" |

**目标里的 bot 任务：**

| 展示状态 | 条件 |
| --- | --- |
| 等待依赖（未排期） | `queued`，`scheduledAt` 为空，存在未完成依赖 |
| 已排期 | `queued`，`scheduledAt` 晚于现在，`statusReason` 不是 `missed_schedule` |
| 已延后 | 同上且 `statusReason = deferred_by_agent` |
| 错过计划 | `queued` 且 `statusReason = missed_schedule` |
| 排队中 | `queued`，无未完成依赖，`scheduledAt` 为空或已过，没有活跃运行 |
| 进行中、等待决策、等待人工、重试中、待审查、已完成、失败、已取消 | 现有状态 |

**目标里的人工任务：** 待开始、进行中、已提交、待验收、已通过，沿用现有状态。

**待办项：**

| 展示状态 | 条件 |
| --- | --- |
| 待分诊 | `suggested` |
| 逾期 | `open` 或 `waiting`，`dueAt` 早于现在 |
| 今天 / 本周 / 无日期 | `open`，按 `dueAt` 与 `scheduledAt` 相对所有者时区的今天分组 |
| 已延后 | `snoozeUntil` 晚于现在，期间不进"需要我" |
| 需跟进 | `waiting` 且 `followUpAt` 不晚于现在 |
| 等待中 | `waiting` 且 `followUpAt` 晚于现在 |
| 待确认完成 | 已交给 bot，关联请求已完成，待办仍是 `open` 或 `waiting` |
| 已完成 / 已忽略 | `done` / `dismissed` |

**例程：** 运行中、失败、已跳过、已暂停；"下次运行时间"取 `nextRunAt`。

**叠加标记：** 逾期只是叠加标记，没有 `dueAt` 的对象永远没有逾期标记（C9.2、B2.6）。

### 2.3 时间条目（TimeItem）

覆盖需求：C10、C11、C13。位置 `packages/contracts/src/task-overview.ts`，由 `ScheduleService` 即时生成，不存储。

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | 稳定 ID：`<kind>:<来源ID>[:<序号>]` | 同一事物始终相同，供 ICS 的 UID 使用 |
| `kind` | `"goal_due" \| "work_item" \| "human_task" \| "todo" \| "follow_up" \| "routine_run" \| "scheduled_once" \| "external_event"` | 是 | 来源类型 | `follow_up` 来自请求进展或待办的跟进时间，`scheduled_once` 见 §3.10 |
| `title` | `string` | 是 | 标题 | — |
| `start` | `string \| null` | 否 | 开始 | ISO 8601 UTC |
| `end` | `string \| null` | 否 | 结束或截止 | ISO 8601 UTC |
| `allDay` | `boolean` | 是 | 是否全天 | 全天条目用所有者时区日期 |
| `timeBasis` | `"actual" \| "scheduled" \| "estimated" \| "due"` | 是 | 时间含义 | 区分实际与计划 |
| `state` | 展示状态 | 是 | §2.2 | 读时推导 |
| `overdue` | `boolean` | 是 | 是否逾期 | 仅当有 `dueAt` 且未终态 |
| `owner` | `"me" \| "bot" \| "external"` | 是 | 执行者 | — |
| `botId`、`outcomeId` | `string` | 否 | 相关 bot、目标 | — |
| `link` | `{ type; id }` | 是 | 跳转目标 | — |
| `editable` | `boolean` | 是 | 能否拖动改期 | 仅所有者拥有的和未开始的 bot 任务 |
| `updatedAt` | `string` | 是 | 来源最后修改 | 供 ICS 的 `LAST-MODIFIED` |

### 2.4 "需要我"队列的构成

覆盖需求：A4。位置：桌面端 `dashboard-state.ts` 现有的 `attentionRows` 扩展为 `NeedsMeItem`，服务端提供 `GET /api/v0/needs-me`（§3.8）。

| 来源 | 条件 |
| --- | --- |
| 收件箱步骤 | 决策、批准、验收、人工动作（004.3、004.4，含错过计划产生的决策） |
| 请求 | 展示状态为"需要我"、"无人跟进"、"检查未触发" |
| 待办 | 待分诊、逾期、今天到期、需跟进 |
| 晨报卡片 | 晨报开启且当天有事项 |

排序（分区从高到低；同一分区内先按 agent 声明的紧急度，再按等待时间从久到近。紧急度不改变分区，也不使建议排到所有者自己的待办或收件箱步骤之前）：

1. 异常：无人跟进、检查未触发、逾期待办。
2. 阻塞中：展示状态为"需要我"的请求，以及收件箱步骤（服务端已有排序）。
3. 今天到期、需跟进。
4. 待分诊建议。
5. 本周及之后到期的待办只出现在时间轴和日历，不进队列。

同一事项只出现一次：已在收件箱的目标步骤不再作为活动项重复出现；队列项以"来源 + ID"为键去重。队列状态不存储，处理后下次读取自然消失。

### 2.5 通用处理流水线与职责边界

覆盖需求：D1、D2

待办、建议、跟进、交接和单次安排均沿用同一条职责边界，产品代码仅识别通用的数据形状和操作：

触发源（所有者消息 / 例程的定时或事件触发 / 唤醒）→ pi agent 回合（推理）→ 工具调用（带 schema 的结构化输出）→ 服务端校验（格式、权限、来源门、幂等）→ 持久化 → 读时推导展示状态 → 所有者操作（接受、延后、忽略、完成、交给 agent）→ 可能触发下一轮。

**谁决定什么：**

| 决定 | 由谁决定 | 代码做什么 |
| --- | --- | --- |
| 要不要记这件事 | agent（推理） | 校验格式，应用来源门 |
| 标题、概括、紧急度、时间、标签 | agent | 校验长度、枚举、时间格式 |
| 来源怎么称呼（`kind`、`id`、`label`） | agent | 原样保存，只用于去重、显示、过滤，不解释 |
| 一条建议是否成为待办 | 所有者，或所有者事先创建的自动接受规则 | 状态流转，规则匹配 |
| 周期性、定时、事件触发 | 所有者指令加 agent | 沿用例程调度，单次语义见 §3.10 |
| 需要所有者看什么 | 通用状态推导（§2.2、§2.4） | 读时推导，只依赖通用字段 |
| 交给谁做、怎么做 | 所有者选 bot，bot 推理 | 以所有者身份发一条消息 |

**场景怎么表达：** 只通过所有者可配置的内容：对话指令、例程提示词、技能。这些不是代码，也不随代码发布。示例见 `docs/20261124-场景示例.md`，示例不构成需求。

**代码里禁止：**

- 出现任何场景标识符（例如邮件、拜访、巡检、客户、发件人）。
- 按来源类型、标签或标题内容分支。`kind`、`label`、`tags` 对服务端是不透明值。
- 业务策略数值的字面量（§2.6）。
- 为某个场景写专用的提示词模板，或在工具描述里用具体场景举例当规则。

**代码里允许（格式与规模上限）：** 字段长度、数组条数、枚举值集合（状态、紧急度、执行者等通用词汇）、时间格式、查询范围与条数、令牌长度、请求体大小。

### 2.6 策略设置（taskPolicy）

覆盖需求：D3

- **存放位置**：现有的单行设置表 `outcomego_feature_settings`（`FeatureSettings`）新增一个 `taskPolicy Json?` 列；沿用 `readFeatureSettings`、`updateFeatureSettings` 读写，`FeatureSettingsView` 和 `UpdateFeatureSettingsInput`（`packages/contracts/src/index.ts`）增加可选的 `taskPolicy`；桌面端沿用 `use-feature-settings` 钩子，设置页新增"任务策略"一节。
- **读取方式**：集中定义在 `packages/contracts/src/task-policy.ts`：`TASK_POLICY_FIELDS`（每个键的分组、类型、单位、取值范围、初始值，服务端校验和设置页渲染共用）和据此实现的 `resolveTaskPolicy(raw)`。业务代码只调用 `resolveTaskPolicy`，不得出现策略数值字面量。
- **更新方式**：按键合并，某个键传 `null` 表示恢复初始值；每个键有取值范围校验（这些范围属于格式上限）；修改后立即生效，不需要改代码或重新部署。
- **初始值**只是集中定义的默认选择，不是代码逻辑。所有者已确认先按这些值试用（§10.2 第 5 项），试用后再调整。

| 键 | 用途 | 含义 | 初始值（待确认） |
| --- | --- | --- | --- |
| `schedule.graceMinutes` | C4.6 | 错过计划的宽限时间 | 60 |
| `schedule.deferMaxCount` | C5.4 | 单个任务最多延后次数 | 10 |
| `schedule.deferMaxDays` | C5.4 | 延后最远天数 | 180 |
| `activity.recentCompletedHours` | A1.4 | "最近完成"保留时长 | 24 |
| `activity.checkOverdueMinutes` | A6.3 | 检查到期多久未分发算"未触发" | 10 |
| `activity.cardMaxItems` | A9.3 | 卡片展示的最大条数，超过用表格 | 8 |
| `activity.dashboardLayout` | A1.7 | 仪表盘里活动区与目标泳道的显示方式：`both`（并存）、`activity`（只显示活动）、`lanes`（只显示目标泳道） | `both` |
| `todo.suggestionTtlDays` | B3.5 | 建议未处理多久过期 | 14 |
| `todo.restoreRetentionDays` | B2.5 | 完成或忽略后可恢复的时长 | 30 |
| `todo.maxPendingSuggestionsPerBot` | B3.7 | 单个 bot 未处理建议上限 | 未设置（不限） |
| `todo.ownerRef.maxAgeHours` | B3.2 | 所有者消息引用的有效期 | 24 |
| `todo.ownerRef.maxTodosPerMessage` | B3.2 | 单条所有者消息最多授权的待办数 | 未设置（不限） |
| `todo.autoAccept.maxPerRulePerDay` | B12.5 | 单条自动接受规则每天最多命中次数 | 未设置（不限） |
| `todo.highUrgencyNotify` | B6.3 | 新建的高紧急度事项是否触发打断式通知 | false |
| `todo.digest.enabled` | B9 | 是否开启晨报 | false |
| `todo.digest.localTime` | B9 | 晨报时间（所有者时区） | 08:30 |
| `todo.digest.maxTitles` | B9 | 晨报最多列出的标题数 | 5 |

标为"未设置"的键表示不过期或不限；是否给出默认值由所有者在试用后决定。

**保留在代码里的格式与规模上限**（不是业务策略）：字段长度（标题 200、备注 4000、概括 300、来源标签 120 等）、标签个数、单次批量操作条数、活动查询 200 条、运行分段 20 段、日程查询 93 天与 1000 条、ICS 窗口、移动端议程范围（今天起 14 天）与令牌长度、延后和排期的时间格式。

### 2.7 目标管理设置页

覆盖需求：E1、E2、E3

**现状（已核实）：** 桌面端设置页的导航在 `settings/panel.tsx` 的 `navigation` 数组里，顺序是通用、键盘、电脑、模型、语音消息、实时语音、服务器、提供商、更新。目标管理的总开关现在在"通用"页（`general.tsx` 的 `FeatureSettings`）里，开关旁边的按钮打开一个弹窗（`outcome-role-settings.tsx`），弹窗里是规划 bot、规划独立模型、审查 bot、审查独立模型和环境说明。

**导航与加载：**

- `SettingsView` 增加 `"goals"`；`navigation` 在 `model` 与 `voice` 之间插入"目标管理"（图标选用与侧栏"目标"入口一致的）；`sectionLoaders`、`sectionComponents` 同步登记，保持按需加载。插入后的顺序：通用、键盘、电脑、模型、**目标管理**、语音消息、实时语音、服务器、提供商、更新。
- **深链接**：共享契约包 `packages/contracts/src/app-deep-links.ts` 的 `APP_SETTINGS_ANCHORS` 新增 `goal-management`、`goal-roles`、`goal-schedule`、`goal-activity`、`goal-todo`、`goal-auto-accept`、`goal-calendar`；桌面端 `lib/app-deep-links.ts` 的 `viewByAnchor` 全部映射到 `"goals"`。这些锚点在共享契约包里，移动端没有这一页，遇到它们时的行为未核实（§10.1）。
- **不新增命令面板入口**：现有命令面板只收录通用、电脑、服务器的电脑网络和更新，且有测试固定列表；模型、语音消息等页也不在其中。

**页面分组**（自上而下，分组随功能上线逐步出现，未上线的功能不显示分组，不留空壳）：

| 分组（锚点） | 内容 | 实现方式 | 出现阶段 |
| --- | --- | --- | --- |
| 总开关（`goal-management`） | 启用目标管理 | 从"通用"页搬来 | 2 |
| 规划与审查（`goal-roles`） | 规划 bot、规划独立模型、审查 bot、审查独立模型、环境说明 | 把 `outcome-role-settings.tsx` 由弹窗内容改为页内分组，去掉 `Dialog` | 2 |
| 排期与延后（`goal-schedule`） | `schedule.graceMinutes`、`schedule.deferMaxCount`、`schedule.deferMaxDays` | 策略元数据渲染 | 2 |
| 活动视图（`goal-activity`） | `activity.recentCompletedHours`、`activity.checkOverdueMinutes`、`activity.cardMaxItems`、`activity.dashboardLayout` | 策略元数据渲染 | 4 |
| 待办（`goal-todo`） | `todo.suggestionTtlDays`、`todo.restoreRetentionDays`、`todo.maxPendingSuggestionsPerBot`、`todo.ownerRef.maxAgeHours`、`todo.ownerRef.maxTodosPerMessage`、`todo.highUrgencyNotify`；晨报 `todo.digest.enabled`、`todo.digest.localTime`、`todo.digest.maxTitles` | 策略元数据渲染 | 6 |
| 自动接受规则（`goal-auto-accept`） | 规则列表（名称、例程或 bot、来源类型、启用、命中次数、最近命中）、创建、编辑、停用、删除；`todo.autoAccept.maxPerRulePerDay` | 自建组件，调用 §4.12 的接口 | 6 |
| 日历（`goal-calendar`） | ICS 订阅管理；外部日历叠加（账号、日历、只显示"忙"） | 自建组件，调用 §5.8、§5.9 的接口 | 8（叠加视可行性验证） |

**留在"通用"页的：** `streamBotReplies`（流式显示回复，不属于目标管理）和悬浮窗设置。

**策略项由元数据渲染：**

- `TASK_POLICY_FIELDS` 的每一项含：键、分组、类型（整数、布尔、时间、枚举）、单位、最小值、最大值（枚举则为可选值列表）、初始值、"未设置即不限制"标记。服务端校验和界面渲染使用同一份，界面代码里不出现任何数值。
- 每个字段行显示：名称与说明（文案按键在 i18n 目录里）、当前值、单位、允许范围、初始值、"恢复初始值"；带"未设置即不限制"标记的项显示明确的"不限制"状态。
- 后续阶段新增策略键，只需登记元数据和文案，页面自动显示；不需要为每个键写界面。

**读写：**

- `FeatureSettingsView.taskPolicy` 返回原始覆盖值（缺省的键表示使用初始值）；`UpdateFeatureSettingsInput.taskPolicy` 按键合并，某个键传 `null` 表示恢复初始值。
- 沿用 `useFeatureSettings().update`：即改即存，失败时显示原因并恢复原值。
- 自动接受规则和订阅走各自的接口，不经过 `taskPolicy`。

**总开关关闭时：** 其余分组可见但禁用，并说明开启后生效（已确认，§10.2 第 22 项），方便了解有哪些选项。

**"通用"页的变化（§10.2 第 23 项已确认保留入口）：** `FeatureSettings` 里的目标管理行改成一行只跳转、不可编辑的入口，显示"目标管理设置"和一个打开按钮；行内不再有开关和弹窗，使每项设置只有一个可编辑入口。点击时复用现有的设置深链接机制：派发 `OUTCOMEGO_DEEP_LINK_EVENT`，链接为 `outcomego://app/v1/settings?id=goal-management`，由 `App.tsx` 的处理函数设置设置面板的目标锚点，面板按锚点切到目标管理页（版本不匹配横幅已经用同样方式打开设置）。设置面板已打开时这条路径是否照常切页，实施时核对。

**不做：** 命令面板入口、移动端页面、把这些设置暴露给 bot。

## 3. 第一部分：活动视图与目标降级

### 3.1 活动项的来源与推导

覆盖需求：A1、A3

| 活动项类型 | 数据来源 | 标题 | 默认是否显示 |
| --- | --- | --- | --- |
| 请求 | `Run` 中 `requestProgress` 非空、`requestStoppedAt` 为空、来源不在 `independentOrigins`，跨所有者的所有 bot | 原始用户消息内容的前 120 个字符（沿用 `message-preview` 工具函数） | 显示未结束的；已完成的 24 小时内 |
| 例程 | `Routine`（启用、未删除）及最近一次 `RoutineExecution` | 例程名 | 仅失败、跳过、运行中；成功的隐藏 |
| 目标任务 | `OutcomeWorkItem`（agent 任务）：运行中，或 `queued` 且 `scheduledAt` 在未来 | 任务标题加目标标题 | 显示；运行中带 `ReportOutcomeProgress` 的阶段与完成数 |

说明：

- **一个请求一行**：请求下的 executor（`Subagent.requestRunId`）汇总在父请求下，只在详情里展开，默认隐藏。
- **不重复**：目标执行和例程执行的运行不进入请求进展，所以不会与请求重复；tracked 目标没有任务，不作为活动项。
- **待办交给 bot**：待办记录 `handoffMessageId`，请求通过 `Run.userMessageId` 与之关联（`userMessageId` 唯一）。
- **范围**：当前所有者名下的全部 bot。

### 3.2 请求进展的公开与隐私

覆盖需求：A2

- 新增只读的所有者视图 `RequestProgressView`：`requestRunId`、`botId`、`state`、`summary`、`remaining`、`nextAction`、`blockSource`、`checkAt`、`deadline`、`updatedAt`、`revision`、`reconciliations`。
- **列表不返回** `evidence` 和 `toolError`；单项详情接口按需返回，且仅所有者可读。
- 所有文字按纯文本渲染，不解析链接或标记，并标注"由 bot 填写"。
- bot 现有的 `requestProgressSnapshot`（按 bot 和对话，注入该 bot 自己的上下文）保持不变；新增的所有者视图不通过任何 bot 工具暴露。
- 请求进展保存的是工具已限制的内容（"不写入密码、令牌"）。服务端不另做内容脱敏，隐私边界靠"列表不含证据"和"仅所有者"。

### 3.3 活动视图

覆盖需求：A1、A9

- **位置**：目标仪表盘（`outcome-dashboard.tsx`）。"需要我"区沿用现有并扩展；新增"活动"区，与现有的"Bots are working"和"Paused or failed"两个目标泳道**默认并存同时显示**（已确认，2026-11-24）。
- **显示方式（已确认）**：所有者可在目标管理设置页选择 `activity.dashboardLayout`：并存（默认）、只显示活动、只显示目标泳道，用于评估活动视图是否取代泳道。这个选项只影响活动区和两个目标泳道，"需要我"区在任何方式下都显示。系统自身不移除任何泳道，是否取代由所有者评估后另行决定，本规格不实现取代。
- **并存期的重叠**：两个目标泳道的行为、以及它们与"需要我"之间现有的去重规则保持不变。活动区里的目标任务行与泳道里的同一目标可能同时出现，评估期内接受这种重叠，活动区的行点击后跳转到该目标；`needsOwner` 为真的事项只显示在"需要我"，活动区不重复渲染。活动区默认隐藏 tracked 目标，而按状态派生推断，它们仍会出现在现有的"Bots are working"泳道里（未实测）。
- **每行信息优先级**：状态、原因（受阻或等待时）、正在做什么、最后活动、下次检查，bot 名作为分组。前三项常显，其余悬停或展开。
- **分组与汇总**：按 bot 分组，每组显示进行中、等待、受阻的数量；"需要我"置顶且展平。
- **密度**：活动项不超过策略 `activity.cardMaxItems` 时用卡片，超过时用表格。
- **默认隐藏**：成功的例程执行、超出"最近完成"时长（策略 `activity.recentCompletedHours`）的工作、executor 子任务、tracked 目标，可用"显示全部"切换。
- **状态表达**：文字、图标和颜色并用；动画只用于"进行中"和"需要我"，遵守减少动态效果偏好。
- **刷新**：沿用现有实时事件通道，不轮询；实施时核对可用的运行事件主题，缺失则增加一个轻量的 `activity.changed` 信号，做法同 `goal.progress.updated`。

### 3.4 "需要我"与通知分级

覆盖需求：A4、A5

| 级别 | 事件 | 方式 |
| --- | --- | --- |
| 打断式 | 新进入"需要我"的收件箱步骤、"需要我"状态的请求（若原渠道未通知）；"无人跟进"和"检查未触发"首次出现 | 现有通知渠道（`publishOutcomeNotification`、`publishRequiredDecisionNotification` 等） |
| 提示式 | 工作完成 | 仅视图里的角标，不推送 |
| 静默 | 进行中、等待中、例程成功 | 无 |

- **去重**：同一事项同一状态只通知一次，键为请求 ID 加修订号；已由原渠道通知的事项（例如 bot 在对话里问了问题，对话本身已产生消息通知）不再重复推送。
- **待办**：默认不单独推送，靠晨报（§4.9）和视图；到期提醒作为后续可选项。
- **高紧急度**：策略 `todo.highUrgencyNotify` 开启时，新建的 `urgency = high` 的建议或待办触发一次打断式通知，按待办 ID 去重；默认关闭，避免外部内容借此打断所有者。

### 3.5 无人跟进的呈现

覆盖需求：A6

- **不新建任何机制**，只呈现请求进展已有的状态：自愈期内显示"核对中"，对账用尽后显示"无人跟进"（`blocked` 加 `runtime`），到期未被分发的检查显示"检查未触发"。
- 推导条件见 §2.2。"检查未触发"的查询使用已有索引 `outcomego_run_request_next_check_at_idx`。
- 通知按请求 ID 加修订号去重（§3.4）。
- 与"强制 bot 建例程"的关系：对用户请求，`waiting` 加 `checkAt` 由主机持久调度续跑，本身不需要例程；例程触发的运行不在请求进展里，仍由例程自己负责。是否可放宽"必须建例程"的要求，取决于阶段 0 的实测结论。

### 3.6 目标降级与提示词

覆盖需求：A7

**变更点：**

1. `packages/messaging/src/prompts/platform.json` 的 `native-outcome-records` 一节：持续性工作用 `Task` 与 `ReportRequestProgress` 跟进。正式目标用于用户明确要求建目标或追踪、需要所有者批准计划或最终验收或人工动作，以及需要收件箱决策卡片的事项。单次安排按 §3.10 展示，沿用例程入口。
2. 工具描述：`packages/contracts/src/outcome-chat.ts` 里 `TrackOutcome` 的描述，以及 `tool-contracts.ts` 里的对应摘要，改为与新规则一致，不再说"登记所有当前回合做不完的事"。
3. 工具输入输出保持兼容：`TrackOutcome`、`CloseOutcome` 的 schema 不变，旧调用不受影响。

**约束：**

- 目标管理一节净减少篇幅；精确文字在实施时定稿并用测试固定。
- 提示词内容不随轮次变化，不引入动态内容。
- **缓存**：基础提示词前缀变更部署时，每个活跃会话下一轮会重建一次前缀缓存，之后恢复命中；篇幅净减少，长期读取成本不增加。实施前后用 `inference.metrics` 的 `cachedInputTokens` 对比（阶段 0 和阶段 5）。
- 测试：`packages/messaging/test/platform-system-prompt.test.ts`（开启时包含 `TrackOutcome`、关闭时不包含，保持成立）；`outcome-context.test.ts` 的提示词基线按需更新；同步 `PLATFORM_SYSTEM_PROMPT_VERSION`。
- **上线顺序**：必须在活动视图可用之后（阶段 4 之后），否则 bot 停止登记后所有者失去可见性。

### 3.7 已有 tracked 目标

覆盖需求：A8

- 不自动迁移、关闭或删除。
- `OutcomeSummary` 新增可选 `trackingMode`，目标列表显示"bot 登记"标记并可筛选。
- `CloseOutcome` 对 tracked 目标照常工作。
- 是否提供"批量关闭已完成的 bot 登记目标"留作待确认（§10.2）。

### 3.8 数据结构与接口

覆盖需求：A1、A2、A4

**`ActivityItem`（新，`task-overview.ts`）：**

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | `<type>:<来源ID>` | 稳定 |
| `type` | `"request" \| "routine" \| "goal_task"` | 是 | 活动项类型 | — |
| `botId` | `string` | 是 | 所属 bot | — |
| `title` | `string` | 是 | 标题 | 请求取消息前 120 字符 |
| `state` | 展示状态 | 是 | §2.2 | 读时推导 |
| `reason` | `string \| null` | 否 | 受阻或等待的原因 | 来自 `nextAction` 或 `summary`，纯文本 |
| `doing` | `string \| null` | 否 | 正在做什么的一句话 | 取 `summary` |
| `progress` | `{ done: number; total: number; phase?: string } \| null` | 否 | 目标任务的阶段与完成数 | — |
| `lastActivityAt` | `string` | 是 | 最后活动 | — |
| `nextCheckAt` | `string \| null` | 否 | 下次检查或排期 | — |
| `needsOwner` | `boolean` | 是 | 是否已在"需要我"中显示 | 为真时活动区不重复渲染（§3.3） |
| `link` | `{ type; id }` | 是 | 跳转 | 打开对话或详情 |
| `workerCount` | `number` | 否 | 汇总的 executor 数 | 仅请求 |

**接口：**

- `GET /api/v0/activity`：输入 `botId`、`includeAll`（显示默认隐藏的）、`recentHours`（默认 24）；输出 `{ items: ActivityItem[]; truncated: boolean }`，上限 200 条；所有者身份。
- `GET /api/v0/activity/requests/:requestRunId`：单项详情，含 `evidence`、`toolError`、executor 汇总；所有者身份。
- `GET /api/v0/needs-me`：输出 `NeedsMeItem[]`（来源、标题、原因、等待起点、级别、跳转或操作）。
- 查询：`Run` 中 `requestProgress` 非空且未停止的行，应用层过滤状态；全局查询可能需要一个部分索引（`requestProgress` 非空且 `requestStoppedAt` 为空），实施时核对（§10.1）。

### 3.9 移动端活动

覆盖需求：A10

- 手机端只读显示"需要我"和活动列表，复用 §3.8 的接口，点击打开现有对话或详情。
- iOS 已有对话级的活动展示（`ChatActivityFooter.swift`），本规格的全局列表是新增；Android 的现状未核实。

### 3.10 单次安排与事前准备

覆盖需求：A11、C10.4、D1 至 D4。首批范围为所有者与 bot 的对话，以及桌面端目标管理和全局日历。

**记录和调度。** 扩展 `UpdateRoutine` 的结构化 `trigger`，拟用 `{ type: "once", runAt, preparation?: { at, instruction } }`。执行指令复用例程 `prompt`。bot 从当前对话解析意图和时区，提交带偏移的时间，服务端校验格式、现有例程权限、单次触发与其他触发参数互斥、准备时间早于正式时间。新增单次调度类型，扩展 `Routine`、`RoutineRevision` 与例程文件的往返读写，保留该修订的单次时间和准备指令。旧 cron、间隔及事件例程按原定义读取，历史记录保留原触发类型。即使现有 cron 的文字写着“仅一次”，也以已保存的结构化定义为准。

**生命周期。** 在 `RoutineService` 的现有扫描和入队事务中，`nextRunAt` 指向下一待分发阶段，`runAt` 始终是用户约定时间。`RoutineExecution` 记录准备或正式执行，两个阶段分别按例程 ID 和修订去重入队。改期、暂停、取消和正式执行的领取使用同一把例程锁。worker 领取时核对启用状态、修订和正式阶段是否已开始，在事务内消费该例程的正式执行机会并清空 `nextRunAt`。被取代的待运行记录标为取消，当前修订仍可正常入队和领取。已经开始的回合按实际结果留痕，恢复时沿用同一运行记录。worker 恢复时，跳过已到正式时间的准备，补发延迟提醒并标明延迟。涉及对外动作时沿用现有权限与确认流程，由 bot 核对实际情况。

**准备和交付。** 即使所有者只请求提醒，只要已有授权资料能帮助完成事项，bot 也应安排事前准备。bot 根据上下文决定提前量，并可在正式回合核对最新事实。后台准备复用 `AutomationResult` 存简报和资料引用，正式回合只接收当前修订的结果。准备仍在运行时，现有例程的重叠跳过判断仅比较正式执行，正式阶段照原计划分发。资料过时或缺少权限时，bot 根据可核实的情况补充说明。正式回合沿用 `WakeParent` 交给主 bot，再由主对话送达。详情分别反映运行结算与实际消息送达。由所有者亲自完成的事项，送达状态显示为「提醒已发出」。

**显示和交互。** 在 `ActivityResponse` 增加可选的 `upcoming` 字段，复用活动项和 `routine:<id>`，另带正式排期 `runAt`。状态由单次例程及当前修订的执行记录推导，按 `runAt` 升序，并与一般例程活动去重。已暂停、已取消和已经开始正式执行的安排移出「即将执行」，运行结果可在目标管理的已排期目标详情查看。日历使用稳定 ID `scheduled_once:<routineId>`，以 `runAt` 为时间，默认开启，通过同一个已排期目标详情打开。目标管理和日历都从该详情操作改期、暂停或取消，例程编辑器只维护例程定义和排期。桌面端按 `upcoming` 字段是否存在识别服务端支持情况，旧服务端使用原有日历类型。移动端和 ICS 复用原有类型集合。

**通用指导。** 将单次与周期的选择、按上下文准备以及资料不足时照常提醒写入例程工具说明，基础提示词保持阶段 0 的长度约束。产品代码使用触发结构、执行阶段和现有权限，资料来源、提前量和建议内容由 bot 推理。文档示例见 [单次安排示例](docs/20261125-单次安排与准备示例.md)。

**手动生成建议。** 目标管理中的「已排期目标」负责单次安排的生命周期。所有者可以在目标卡片中生成运行建议、暂停、恢复或取消。`POST /api/v0/routines/:id/prepare` 只校验当前修订并在例程锁内入队一个只读 `preparation` 回合，实际分析由拥有该安排的规划 Bot 通过 Worker 的 pi agent 执行，产品代码不生成或拼接 LLM 结果。请求重试沿用同一个 `clientId`。手动入队后，当前修订的自动准备扫描直接推进到正式时间。改期后，旧建议可在历史中查阅，待执行的旧准备回合在领取时取消。固定日期 Cron 可以在首次正式执行前使用入口，仍按原 Cron 规则调度，首次正式执行可读取同一修订的简报。例程编辑器保留定义和排期维护，不承载运行建议操作。

## 4. 第二部分：现实待办项

本部分是**通用的待办机制**，不含任何具体场景。场景（邮件、拜访、巡检、手动待办等）只作为文档示例，见 `docs/20261124-场景示例.md`。

### 4.1 设计取舍

覆盖需求：B1、B2

待办项用**独立的轻量实体**，不扩展 tracked 目标（已确认）。

| 选项 | 优点 | 缺点 |
| --- | --- | --- |
| 独立 `TodoItem`（本规格采用，已确认） | 无契约、验收和规划负担；字段贴合时间与来源；不污染目标列表 | 新增一张表、接口和客户端 |
| 扩展 tracked 目标（`ownerNeed = action`） | 复用人工动作卡、回执、收件箱分类、移动端只读 | 目标有契约修订和验收，对待办太重；目标列表会被待办淹没，违背"目标降级" |

人工动作卡和回执的渲染方式可借鉴，但待办不要求回执。

### 4.2 数据结构

覆盖需求：B1、B2、B3、B4、B6

`TodoItem`（`packages/db/prisma/schema.prisma`，表 `outcomego_todo_item`）。所有字段都是通用的，没有任何场景相关的字段或枚举值：

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 是 | 主键 | — |
| `ownerId` | `uuid` | 是 | 所有者 | 与现有所有者模型对齐，实施前核对 |
| `title` | `string` | 是 | 标题 | 1 至 200 字符 |
| `note` | `string` | 否 | 备注 | 不超过 4000 字符 |
| `status` | `enum` | 是 | `suggested`、`open`、`waiting`、`done`、`dismissed` | — |
| `executor` | `enum` | 是 | `owner`、`bot`、`external` | 默认 `owner` |
| `createdVia` | `enum` | 是 | `owner_ui`、`owner_chat`、`agent_turn` | 描述创建渠道，不描述场景 |
| `createdByRunId` | `uuid` | 否 | 创建它的回合 | 取自回合上下文，不由 agent 自述 |
| `createdByRoutineId` | `uuid` | 否 | 创建它的例程 | 取自回合上下文（运行对应的例程执行记录），不由 agent 自述 |
| `authorizedByMessageId` | `uuid` | 否 | 授权它成为 `open` 的所有者消息 | 由来源门校验通过后写入；展示时由服务端按它读取消息预览 |
| `acceptedBy` | `enum` | 否 | `owner`、`rule` | 接受方式；`rule` 时同时记录规则 ID |
| `autoAcceptRuleId` | `uuid` | 否 | 命中的自动接受规则 | — |
| `urgency` | `enum` | 是 | `low`、`normal`、`high` | 默认 `normal`；只影响同一分区内排序 |
| `sourceRef` | `json` | 否 | `{ kind, id, label }` | `kind` 不超过 40、`id` 不超过 200、`label` 不超过 120 字符；不透明，不存正文、不存 URL |
| `summary` | `string` | 否 | agent 概括 | 不超过 300 字符，纯文本 |
| `dedupeKey` | `string` | 否 | 去重键 | 有 `sourceRef` 时由服务端取 `<kind>:<id>`；同一所有者下唯一（未过期的建议和已忽略的） |
| `createdBy` | `string` | 是 | 创建者：`user:<id>` 或 `bot:<id>` | — |
| `botId` | `uuid` | 否 | 产生它的 bot | 用于可见性与可选上限 |
| `tags` | `string[]` | 否 | 自由文本标签 | 最多 5 个，每个不超过 40 字符；服务端不解释，只用于分组和过滤 |
| `dueAt`、`scheduledAt`、`snoozeUntil`、`followUpAt` | `DateTime` | 否 | 时间字段 | — |
| `linkedOutcomeId` | `uuid` | 否 | 升级后的目标 | — |
| `handoffBotId`、`handoffMessageId` | `uuid` | 否 | 交给 bot 的记录 | `handoffMessageId` 对应 `Run.userMessageId` |
| `expiresAt` | `DateTime` | 否 | 建议过期时间 | 建议创建时按策略 `todo.suggestionTtlDays` 计算；未设置则为空 |
| `completedAt`、`dismissedAt`、`dismissReason` | — | 否 | 生命周期 | `dismissReason` 含 `expired` |
| `revision` | `int` | 是 | 乐观并发 | 每次修改加一 |
| `createdAt`、`updatedAt` | `DateTime` | 是 | — | — |

索引：`(ownerId, status, dueAt)`、`(status, expiresAt)`、`(dedupeKey)` 唯一约束（部分）、`(botId, status)`。迁移放 `packages/db/prisma/migrations/<时间戳>_add_todo_item/`，只加表和索引。

### 4.3 状态与展示推导

覆盖需求：B2

**状态流转：**

| 从 | 到 | 触发 |
| --- | --- | --- |
| `suggested` | `open` | 所有者接受 |
| `suggested` | `dismissed` | 忽略，或超过 `expiresAt` |
| `open` | `waiting` | 标为等待对方并设 `followUpAt` |
| `open`、`waiting` | `done` | 所有者完成（或所有者在与 bot 的对话里表达后由 agent 调用 `UpdateTodo`） |
| `open`、`waiting` | `dismissed` | 所有者忽略 |
| `waiting` | `open` | 取消等待 |
| `done`、`dismissed` | `open` | 恢复，限策略 `todo.restoreRetentionDays` 内 |

展示推导见 §2.2。接受建议时按建议的原始时间字段进入时间轴，不丢信息。

### 4.4 创建路径与来源门

覆盖需求：B1、B3、B4、B10

三条创建路径，对服务端没有场景之分：

1. **所有者在桌面端一行输入**：直接 `open`，`createdVia = owner_ui`。
2. **所有者在对话里表达了要记录一件事**：由 agent 推理并调用 `CreateTodo`，附上该消息的引用（消息 ID），`createdVia = owner_chat`。创建可以发生在同一回合，也可以发生在多步流程的后续步骤（例如 executor 完成后唤醒的回合），因为授权依据是被引用的消息，不是当前回合。
3. **agent 在任何回合里产生**：调用 `SuggestTodo`（或 `CreateTodo`），`createdVia = agent_turn`。

**来源门**是一个纯函数，只依赖所有者消息引用的校验结果和自动接受规则，不读取 `sourceRef`、`tags`、`title` 的内容：

```text
decideInitialStatus(调用方, 工具, 输入, 回合上下文):
  调用方是桌面端所有者操作                    -> open（acceptedBy = owner）
  工具是 SuggestTodo                          -> 命中自动接受规则（§4.12）且未超当日上限 ? open（acceptedBy = rule）
                                                 : suggested
  工具是 CreateTodo:
    ownerMessageRef 缺失                      -> suggested（原因 owner_ref_missing）
    引用校验不通过                            -> suggested（原因 owner_ref_invalid）
    否则                                      -> open（authorizedByMessageId = 引用，acceptedBy = owner）
```

**引用校验**（`validateOwnerMessageRef`）全部由服务端按消息 ID 查库完成，agent 不提交任何转述的文字：

1. 消息存在。
2. 消息由所有者发出：消息角色是 `user`，**并且**该消息所属运行的来源（`Run.origin`）是所有者对话。这里必须同时看运行来源：`enqueueWake` 会为例程、事件、后台恢复等所有触发都合成一条 `role = user` 的消息，只看角色不能证明出自所有者。
3. 消息属于该 bot 所在的对话（`Message.conversationId` 与调用方 bot 的对话一致）。
4. 消息在策略 `todo.ownerRef.maxAgeHours` 内。
5. 该消息已授权的待办数（按 `authorizedByMessageId` 统计）未达策略 `todo.ownerRef.maxTodosPerMessage`（未设置则不限）。

- **为什么用引用而不是转述**：多步流程里，创建待办的那一步往往不是所有者说话的那一步（executor 汇报后唤醒、后台恢复等），agent 只能转述所有者的话，转述会走样，也无法可靠校验。引用把"授权依据"变成一个服务端可查的对象；界面显示的是服务端读出的原消息（B3.8），所有者可以核对。
- **引用能证明什么，不能证明什么**：能证明"所有者在这个对话里、近期说过这句话"；不能证明"这句话要求创建这条待办"。后者由所有者在列表里看到依据预览后判断，也由有效期和单消息上限限制滥用面。
- **agent 怎么拿到消息 ID**：触发本回合的消息 ID（`Run.userMessageId`）和 `ReadTranscript` 结果里的消息 ID。这些是否已提供给 agent 尚未核实（§10.1），实施前先核对，缺失就补。
- **为什么不按来源类型判断**：枚举外部来源既不完整，也等于在代码里硬编码场景。

- **去重**：有 `sourceRef` 时 `dedupeKey = <kind>:<id>`；已有未过期建议或已忽略记录时不创建第二条，并返回已有记录。命中规则而直接成为 `open` 的待办同样占用去重键。`id` 标识"这一件具体的事"：同一件事用同一个 `id`，同类事每次用不同的 `id`，这由工具描述里的格式说明和 agent 推理保证。
- **过期**：策略 `todo.suggestionTtlDays` 已设置时，建议创建时写入 `expiresAt`；worker 的每分钟调度里增加一次过期扫描，只查已到期的建议。未设置则不过期。
- **上限**：策略 `todo.maxPendingSuggestionsPerBot` 已设置且该 bot 未处理建议已达上限时，拒绝新的建议（429 `suggestion_limit_reached`）；未设置则不限。

### 4.5 bot 工具与提示词

覆盖需求：B1、B3、B10、D1、D2

| 工具 | 说明 | 用户回合 | 唤醒回合 | automation（例程、事件） | 子 agent、目标线程 |
| --- | --- | --- | --- | --- | --- |
| `CreateTodo` | 创建待办，是否 `open` 由来源门决定 | 可用 | 可用（凭有效的所有者消息引用可为 `open`，否则降级为建议） | 不可用 | 不可用 |
| `SuggestTodo` | 只创建建议 | 可用 | 可用 | **可用，只能创建建议** | 不可用 |
| `UpdateTodo` | 加备注、设等待和跟进、标记完成 | 可用 | 不可用 | 不可用 | 不可用 |
| `ListTodos` | 只返回自己创建的，及所有者在与该 bot 的对话中创建的 | 可用 | 可用 | 不可用 | 不可用 |

**输入格式**（只列格式约束，没有场景字段）：

| 工具 | 输入 |
| --- | --- |
| `CreateTodo` | `title`（1 至 200）、`note?`（不超过 4000）、`dueAt?`、`scheduledAt?`（ISO 8601 带偏移）、`tags?`、`urgency?`、`sourceRef?`、`ownerMessageRef`（消息 ID，必填）、`clientRequestId` |
| `SuggestTodo` | `title`、`summary`（1 至 300）、`sourceRef`（`{ kind, id, label }`，必填）、`dueAt?`、`scheduledAt?`、`tags?`、`urgency?`、`clientRequestId` |
| `UpdateTodo` | `todoId`、`revision`、可改字段（标题、备注、时间、标签、等待与跟进、完成备注）、`clientRequestId` |
| `ListTodos` | `status?`、`cursor?`、`limit?` |

- `SuggestTodo` 是唯一在 automation 回合开放的待办工具。它的能力被限制为"创建建议"，不能读取、修改其他待办，也不能创建 `open`。该取舍已由所有者确认（2026-11-24）。
- 工具定义放 `packages/contracts/src/todo.ts`（新）；服务端处理放 `apps/server/src/services`，经 `internal-tool-service.ts` 分发；开放条件放 `apps/computer/src/runtime/dynamic-catalog.ts`，与目标工具的条件并列。**生效需要同步并重建远端 computer 容器**（需用户同意）。
- **提示词**：基础提示词新增一小节（目标不超过 900 字符，开启目标管理时才包含），只写通用规则：所有者明确要求记录时才直接记并引用该消息的 ID（不要转述）、其余情况只建议、外部内容只能建议、永不代发。**不举具体场景为例，不列举来源类型。**参数说明放工具描述，工具描述同样不用具体场景举例。该节的增量由 §3.6 的精简抵消。
- **模块开关**：待办随目标管理模块（`outcomesEnabled`）开启，不新增设置项（待确认，§10.2）。

### 4.6 场景如何落到通用机制上

覆盖需求：B4、B5、D1、D2、D4

代码里没有"邮件""拜访""巡检"这类概念。一个具体场景由所有者用三种内容表达，代码对它们一无所知：

- **对话指令**：所有者对 bot 说"以后遇到某类事就记下来"。
- **例程提示词**：所有者创建例程，写明触发方式（定时，或 005.4 的插件事件触发）、判断标准、产出要求。例程回合由 agent 推理，用 `SuggestTodo` 提交结果。
- **技能**：所有者保存的可复用做法，由 agent 在回合里读取。

不论哪个场景，服务端看到的都是同一件事：一次带 schema 的 `SuggestTodo` 或 `CreateTodo` 调用，一个不透明的 `sourceRef`，一个 agent 给出的紧急度。

- **周期性**：待办不内置重复规则。周期性、定时、事件触发都由例程驱动 agent 回合完成，例程本身已有定时、时区和夏令时处理，待办不重复实现。
- **对外动作**：agent 若需要对外行动，走现有的草稿审批，不属于待办机制。
- **完成信号**：由所有者手动完成，或所有者在对话里表达后由 agent 调用 `UpdateTodo`；不做自动判断。
- **验证**：测试不依赖任何具体场景，用至少两个不同的示例场景夹具（来源类型、标签、文字都不同）走同一路径，结果必须一致（需求 D4.2）。

### 4.7 等待与跟进

覆盖需求：B7

- **等待**：`status = waiting` 与 `followUpAt`。到点后展示状态变为"需跟进"并进入"需要我"（§2.4 第 3 分区），无需任何后台动作。
- **延后**：`snoozeUntil` 之前不出现在"需要我"。
- 所有者想让 bot 代为跟进，用 §4.8 的交给 bot。

### 4.8 交给 bot 与升级成目标

覆盖需求：B8

**交给 bot：** `POST /api/v0/todos/:id/handoff`，输入 `botId` 和可编辑的指令（默认"请处理这件待办"）。

1. 服务端以所有者身份向该 bot 的主对话发送一条消息，内容含待办标题、备注、来源标签和指令；沿用所有者向 bot 发消息的现有服务路径（实施时核对）。
2. 待办 `executor` 变为 `bot`，记录 `handoffBotId` 和 `handoffMessageId`。
3. bot 处理该消息时由 `Task` 自动开始请求进展；活动视图通过 `Run.userMessageId = handoffMessageId` 关联，待办卡片显示其进展。
4. 请求 `complete` 后待办展示为"待确认完成"（§2.2），由所有者确认。
5. 交给 bot 不授予额外权限，来源内容仍属不可信（bot 读到的是所有者发的消息，指令来自所有者）。

**升级成目标：** 桌面端打开现有"新建目标"流程，预填标题和备注；目标创建成功后调用待办更新接口，写入 `linkedOutcomeId` 并置为 `done`。不新增服务端创建路径。

### 4.9 晨报

覆盖需求：B9

- 开关、时间和标题数来自策略 `todo.digest.enabled`、`todo.digest.localTime`、`todo.digest.maxTitles`（§2.6）。
- worker 的每分钟调度里增加 `dispatchTodoDigest`：策略开启、所有者时区当前时间不早于 `localTime`、今天有事项、且今天尚未发送时，通过现有推送基础设施发送。"今天已发送"用现有的幂等记录表示（作用域 `todo-digest`，键为所有者时区的日期），不新增表。
- 内容只含数量和标题（今天到期、逾期、待分诊、需跟进），不含来源内容或 agent 概括；格式固定，不涉及场景。
- 若所有者想要更智能的摘要，应创建一个例程让 agent 生成，而不是扩展这里的固定格式。
- "需要我"顶部的晨报卡片读时生成，不存储。

### 4.10 安全与隐私

覆盖需求：B10

- 没有通过校验的所有者消息引用的创建，只能产生建议，由服务端的来源门强制，不依赖 bot 自觉（§4.4）。
- 自动接受规则只能由所有者通过桌面端接口管理，没有任何 bot 工具能读写它们（§4.12）。
- 只保存来源引用、标签和 agent 概括；不保存外部正文，不保存 URL。
- bot 只能读自己创建的和所有者在与它的对话里创建的待办（`ListTodos` 按 `botId` 与对话过滤）。
- automation 回合只有 `SuggestTodo`。
- agent 摘要按纯文本渲染并标注来源，不生成可点击链接。
- 待办相关操作永不对外发送任何消息；对外发送仍走现有草稿审批。
- 所有者可以一键清除某个 bot 的全部未处理建议（`POST /api/v0/todos/bulk` 的 `dismissBot`）。
- 创建、去重、过期、降级、拒绝都写日志，含 actor、运行 ID、回合来源和降级原因；日志里不写来源内容。

### 4.11 接口与移动端

覆盖需求：B1、B11

- `GET /api/v0/todos`：输入 `view`（`needs_me`、`suggestions`、`all`、`history`）、`tag`、范围；输出待办列表及展示状态。
- `POST /api/v0/todos`：所有者创建，带 `clientRequestId`。
- `PATCH /api/v0/todos/:id`：修改标题、备注、时间、标签、紧急度、等待和跟进；带 `revision`。
- `POST /api/v0/todos/:id/accept|snooze|dismiss|complete|restore`。
- `POST /api/v0/todos/:id/handoff`。
- `POST /api/v0/todos/bulk`：批量接受、忽略、清除某 bot 的建议。
- 晨报等策略数值通过现有的设置接口读写（§2.6），不再单设晨报接口。
- 事件：沿用 `Event` 表的轻量刷新信号（`todo.changed`），做法同 `goal.progress.updated`，不进入 Outcome 事件主题集合。
- **桌面端**：顶部一行输入框；"需要我"里有时间轴（逾期、今天、本周、无日期）、分诊区和需跟进。
- **移动端**：显示"需要我"里的待办和建议，支持接受、延后、忽略、完成；不支持回执上传和创建待办（创建在对话或桌面完成）。004.4 把移动端写操作排除在范围外，本规格对待办增加这四个最小操作，所有者已确认（2026-11-24）。这是对 004.4 的例外，仅限待办这四项，目标、决策、回执等其余移动端写操作的范围不变。

### 4.12 自动接受规则

覆盖需求：B12

所有者对信任的例程或 bot，可以让它们提出的建议直接成为 `open`，不用逐条分诊。规则是通用的，不针对任何场景。

**数据**（`TodoAutoAcceptRule`，表 `outcomego_todo_auto_accept_rule`）：

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 是 | 主键 | — |
| `ownerId` | `uuid` | 是 | 所有者 | — |
| `name` | `string` | 是 | 规则名，自由文本 | 1 至 80 字符 |
| `routineId` | `uuid` | 否 | 匹配产生建议的例程 | 来自回合上下文 |
| `botId` | `uuid` | 否 | 匹配产生建议的 bot | 来自回合上下文 |
| `sourceKind` | `string` | 否 | 进一步收窄：来源类型字符串相等 | 不超过 40 字符；服务端不解释 |
| `enabled` | `boolean` | 是 | 是否启用 | — |
| `matchCount`、`lastMatchedAt` | `int`、`DateTime` | 是、否 | 命中统计 | 用于所有者查看 |
| `createdAt`、`updatedAt` | `DateTime` | 是 | — | — |

**约束与匹配：**

- `routineId` 和 `botId` 至少一个非空。只有 `sourceKind` 的规则被拒绝：`sourceKind` 是 agent 自己填的字符串，可能被外部内容影响，不能单独决定自动接受；`routineId` 和 `botId` 取自回合上下文（例程执行记录和调用方 bot），不由 agent 自述。
- 匹配只做字符串相等：回合上下文里的 `createdByRoutineId`、`botId`，以及建议里的 `sourceRef.kind`。所有已设置的字段都相等才算命中；多条命中时取创建最早的一条，结果确定。
- **只作用于 `SuggestTodo` 产生的建议。** `CreateTodo` 因引用校验失败而降级的建议不适用，否则规则会绕过引用校验。
- 命中后：直接创建 `open`，`acceptedBy = rule`，记录规则 ID；界面标注"自动接受（规则名）"；规则的 `matchCount` 加一。不发打断式通知（除非该事项是 `high` 且策略 `todo.highUrgencyNotify` 开启）。
- 可选上限：策略 `todo.autoAccept.maxPerRulePerDay` 已设置且当天命中已达上限时，该建议降级为普通 `suggested`，不拒绝。

**管理：**

- 只有所有者能创建、修改、删除、启停规则，经桌面端接口；`GET/POST/PATCH/DELETE /api/v0/todos/auto-accept-rules`。**没有任何 bot 工具**读写规则；移动端不管理规则。
- 分诊区的建议卡片提供"以后自动接受来自此例程的建议"快捷入口，预填 `routineId`，由所有者确认。
- 停用或删除规则只影响之后的建议，已自动接受的待办保持不变；每条已自动接受的待办都可一键忽略。
- 创建、命中、停用、因上限降级都写日志，含规则 ID、匹配字段和待办 ID，不写来源内容。

**风险（所有者选择开启规则时需要知道）：** 自动接受等于把这个例程或 bot 的输出当作所有者自己的待办对待，它们会进入"今天到期""逾期"等所有者自己的分区。如果这个例程读取外部内容，外部内容就能影响所有者的待办列表。所以规则要绑定到具体的例程或 bot，不提供"全部自动接受"，并保留命中统计和一键忽略。

## 5. 第三部分：时间线与日历

### 5.1 规划角色排期与批准后物化

覆盖需求：C3

1. 规划角色在 `SavePlan` 的任务里可选提供 `startAt`、`dueAt`、`estimateMinutes`。
2. `normalizePlanTask` 校验：时间必须是带时区偏移的 ISO 8601；`dueAt ≥ startAt`；`estimateMinutes` 为 1 至 10080 的整数；过去的 `startAt` 允许（视为已到点）。校验失败整体拒绝，返回 `invalid_schedule`。
3. 字段随修订的 `plan` JSON 保存；`parseOutcomePlan` 保留新字段，缺字段的旧数据照常解析。
4. 批准后按计划创建任务时，把三个字段复制到 `OutcomeWorkItem.scheduledAt/dueAt/estimateMinutes`；人工任务同样复制。
5. 批准后再次 `SavePlan`：未开始任务的排期可改，改时沿用 004.9，先删除其待处理排队记录再以新 `clientId` 重新入队；已开始或已结束的任务保持原值，若请求试图修改则整体拒绝。
6. 规划角色提示词增加排期指导：只在任务确实不能或不应更早开始时给 `startAt`（等外部日期、需要间隔、周期性复查），只在有把握时给估时，拿不准就不填；建议的目标截止日只写进 `notes`。

### 5.2 到期放行

覆盖需求：C4

1. `enqueueOutcomeTurn` 在写入待处理幂等记录之后、依赖检查之前增加闸口：`item.scheduledAt` 晚于当前时间则返回 `queued_for_capacity`，记录保持 `processing`。闸口位于容量检查之前，所以排期中的任务不占 bot 的并发名额。
2. `dispatchQueuedOutcomeWorkItems` 的筛选 SQL 增加条件 `(w."scheduledAt" IS NULL OR w."scheduledAt" <= now())`，避免未到点的任务占满 `LIMIT 100` 而饿死其他任务。
3. 新增 `dispatchDueScheduledWorkItems`：查询"已到点、状态 queued、存在 `processing` 幂等记录"的任务，按 bot 去重，对每个 bot 在独立事务里调用 `dispatchQueuedOutcomeWorkItems`，写法与 `outcome-recovery.ts` 一致。
4. worker 在启动恢复和 `dispatchRoutinePass`（每分钟）里调用它，位置紧挨 `dispatchRequestChecks`。放行延迟最多约一个调度周期加排队时间。
5. 幂等：放行最终仍走 `enqueueOutcomeTurn` 的同一个 `clientId`，已存在的运行不会重复创建。
6. 取消、已验收、契约被取代由现有判断拦截，排期任务不会越过。
7. 日志：放行时记录任务 ID、`scheduledAt`、实际放行时间、延迟秒数。

### 5.3 错过计划

覆盖需求：C4

1. 放行前计算 `lateness = now - scheduledAt`。
2. `lateness ≤ 策略 schedule.graceMinutes`，或任务性质不是 `action`（`deliverable`、无计划回退任务）：正常放行。
3. `lateness > 策略 schedule.graceMinutes` 且性质为 `action`：不放行。把任务的 `statusReason` 设为 `missed_schedule`（状态仍是 `queued`），并通过现有决策机制创建决策，幂等键为 `missed-schedule:<workItemId>:<scheduledAt>`，选项为"现在执行"和"等我改期"。
4. 选"现在执行"：把 `scheduledAt` 置为当前时间并放行。选"等我改期"：保持阻塞，直到所有者按 §5.5 改期；改期成功时关闭该决策并清除 `missed_schedule`。
5. 性质来自修订 `plan` 里按 `planKey` 读取的 `nature`，不新增列（沿用 004.9）。

### 5.4 运行中延后

覆盖需求：C5

线程工具 `DeferWorkItem`，输入 `resumeAt`、`note`（续做说明）、可选 `reason`。

1. 校验上下文：与 `ReportOutcomeProgress` 相同，回合必须是该任务当前运行中的 `outcome` 回合，任务是 agent 任务、状态 `running`，目标未取消、未验收。否则 409 `tool_context_invalid`。
2. 校验：`resumeAt` 在未来且不超过策略 `schedule.deferMaxDays`；该任务 `deferCount` 小于策略 `schedule.deferMaxCount`。否则 400 `invalid_schedule` 或 409 `defer_limit_reached`。
3. 同一事务内：设置 `scheduledAt = resumeAt` 并将 `deferCount` 加一；`transitionWorkItem(running → queued, reason "deferred_by_agent")`；创建待处理的 `enqueueOutcomeTurn` 记录，`content` 为续做说明，`reason` 为 `resume_scheduled`，`clientId` 为 `defer:<workItemId>:<deferCount>`，因为闸口返回 `queued_for_capacity` 并保持 `processing`；写入 `outcome.schedule.changed` 事件（来源 `agent_defer`）。
4. 工具返回后指示 bot 结束本回合。
5. **结算守卫**：`settleOutcomeWorkItem` 的提前返回条件增加"`status = queued` 且 `statusReason = deferred_by_agent`"，否则回合一结束，任务会被误结算为 `completed`。任务被重新放行并转回 `running` 后守卫自然失效。
6. 到 `resumeAt` 按 §5.2 放行，新回合的内容是续做说明，成为该任务的又一段运行。
7. 权限与契约不变：延后不增加工具、不修改契约、不改变依赖。
8. **部署**：工具在 `packages/contracts` 与 `apps/computer/src/runtime/tools.ts` 注册，生效需要同步并重建远端 computer 容器（需用户同意）。

### 5.5 所有者改期与目标截止日

覆盖需求：C6、C7、C8

1. 所有者通过 `PUT .../schedule` 修改任务的 `scheduledAt/dueAt/estimateMinutes`，通过 `PUT .../due` 修改目标截止日，均带 `clientRequestId`。
2. 任务排期只允许未开始任务：agent 任务要求状态 `queued` 且没有活跃运行；人工任务要求未提交。否则 409 `schedule_not_editable`。
3. 修改 bot 任务排期时，先删除其待处理排队记录，再以新 `clientId` 重新入队（沿用 004.9 的差异规则），随后触发一次对该 bot 的放行尝试。
4. 任务正处于 `missed_schedule` 时，改期到未来会关闭对应决策并清除标记。
5. 目标 `dueAt` 不进入契约内容哈希，不触发重新批准；已验收或取消的目标拒绝修改。
6. 每次修改写入 `outcome.schedule.changed`，记录修改者、旧值和新值。
7. 所有者的修改只更新任务行，不回写修订的 `plan` JSON；是否回写见 §10.2。

### 5.6 目标详情时间线

覆盖需求：C1、C2、C9

输入：`OutcomeDetail`（含 `dueAt`、计划任务和任务视图的新字段）。阶段 1 只有实际时间和依赖；阶段 3 加入计划与估算。

1. **行**：每个任务一行，顺序为计划任务的拓扑顺序，其后是返工和补充任务；人工任务用菱形标记。
2. **条的类型**：实际条（实心，每一段运行画一段，运行中的画到"现在"）；计划条（实线轮廓，任务有 `scheduledAt` 且尚未开始，长度为 `estimateMinutes`，没有估时则画起点标记）；估算条（虚线）；延后空档（相邻两段运行之间用斜线连接并标注"延后至 X"）。
3. **依赖线**：从前驱任务的结束到后继任务的开始，折线；后继没有任何时间时不画线，改为在"未排期"区写"等待：A、B"。
4. **未排期区**：没有任何时间信息的任务，不编造日期。
5. **终点与今天线**：目标 `dueAt` 画旗标；"今天"线贯穿；`dueAt` 已过且未完成的任务和目标突出。
6. **轴**：范围取已知时间的最小值到最大值（含 `dueAt`、估算末端、现在），两端留白；自动选择小时、天、周刻度；水平滚动；"回到今天"按钮。
7. **状态表达**：颜色、图标和文字并用；动画只用于"进行中"和"需要我"，遵守减少动态效果偏好。
8. **等价列表视图**：同样的信息以表格呈现，供键盘和读屏使用。
9. **时间诚实**：不画"预计完成"，不画关键路径；没有 `dueAt` 的任务不会出现逾期标记。
10. **改期入口（阶段 3）**：行菜单里用日期时间选择器修改未开始任务的排期，经 §5.5 的接口；不做拖动，避免误操作。
11. **刷新**：沿用目标事件流（含 `outcome.schedule.changed`），不轮询。
12. 示意：

```text
目标：交付某项工作（示意）                     截止 12/05
              11/20     11/24 ▼今天    11/28    12/02    12/05
调研 (研发)    ████████ 已完成
实现 (研发)           ██████▒▒▒ 进行中（依赖：调研）
评审 (总监)                        ░░░ 等待依赖
联调 (我)                                   ◇ 12/03
未排期：写发布说明
```

### 5.7 全局日历

覆盖需求：C10、C13、A11

1. `GET /api/v0/schedule` 返回 `TimeItem[]`，由 `ScheduleService` 按来源汇总：目标截止日（`Outcome.dueAt`）；目标任务（`scheduledAt`、`dueAt`，已完成任务的实际结束）；人工任务；待办项（`dueAt`、`scheduledAt`、`followUpAt`）；跟进时间（请求进展的 `requestNextCheckAt`，指向对应对话）；例程（过去用 `RoutineExecution.scheduledFor`，未来用与例程调度相同的计算展开，每个例程每次查询最多 100 次）。
2. 范围不超过 93 天，条目不超过 1000 个；超出时返回截断标记。
3. 时区采用 `UserTimeZoneSettings`；时间点用 UTC 存取，全天条目用日期，客户端按所有者时区显示。
4. 视图：日、周、月；月视图每天显示条目数和前三条，周和日视图显示完整时间块；筛选项为 bot、目标、来源类型、"只看我的"。
5. 默认来源：目标截止日、人工任务、有排期的 bot 任务、待办项、跟进时间及 §3.10 的单次安排开启。其余例程、已完成的 bot 任务、外部日历关闭。同一单次安排在桌面日历按 `scheduled_once` 显示一次，准备阶段不单列。
6. 拖动：只有所有者拥有的条目（人工任务日期、目标截止日、待办日期）和未开始的 bot 任务排期可拖，经 §5.5 或待办接口；其他条目只读。
7. 移动端议程：同一接口，范围固定为今天起 14 天，只读列表。

### 5.8 ICS 订阅

覆盖需求：C11

1. 所有者在设置里创建订阅，选择名称和条目类型；服务端生成 32 字节随机令牌，只保存其哈希，令牌明文仅在创建时展示一次。
2. 订阅地址形如 `<服务地址>/calendar/feed/<令牌>.ics`，不需要会话，路径匹配方式参考自动化 webhook 路由；只允许 GET。
3. 输出 iCalendar（RFC 5545）：范围为今天前 30 天到后 180 天；每个条目一个 `VEVENT`，`UID` 为稳定的条目 ID 加域名后缀，`DTSTAMP` 为生成时间，`LAST-MODIFIED` 为来源更新时间；带时间的条目用 UTC，全天条目用 `VALUE=DATE`；仅有截止时间的条目作为全天或短事件，因为很多日历应用忽略 `VTODO`；`SUMMARY` 为标题，默认不写 `DESCRIPTION`、不写外部日历事件、不写应用链接（所有者可开启链接）；日历级属性 `X-WR-CALNAME`、`REFRESH-INTERVAL;VALUE=DURATION:PT1H`、`X-PUBLISHED-TTL:PT1H`。
4. 撤销或轮换：数据库标记 `revokedAt`，之后同一令牌返回 404；无效令牌与不存在使用相同响应和耗时。
5. 限流：按令牌哈希限制请求频率；访问日志对路径中的令牌脱敏。
6. 订阅内容永远排除外部日历叠加的事件。

### 5.9 外部日历叠加

覆盖需求：C12

1. 所有者在日历设置里选择已连接的日历账号（`google-calendar` 插件）和要叠加的日历，可选"只显示忙"。
2. 前端请求 `GET /api/v0/schedule/external`；宿主在没有 bot 回合的情况下调用插件的读取工具，取回事件的标题和时间，结果仅在内存缓存，不超过 5 分钟。
3. 全程只读：宿主只调用读取类工具，不暴露写入类工具，也不向任何 bot 提供这些数据的读取途径。
4. 授权失效或插件不可用：返回降级信息，日历其余部分照常显示。
5. **前提待验证**：005.4 有"宿主发起轮询工具"的先例，但"宿主在无 bot 回合时调用任意读取工具"是否支持尚未核实，任务 8.3 先做可行性验证；不可行时需求 C12 保持 BLOCKED，不引入 bot 定时轮询的替代方案。

### 5.10 数据结构

覆盖需求：C1、C2、C3、C6、C7

**`PlanTask`（扩展）** 位置 `packages/contracts/src/outcomes.ts`（`PlanTask`、`parseOutcomePlan`）和 `outcome-thread.ts`（`PlanTaskInputSchema`）：

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `startAt` | `string`（ISO 8601，带偏移） | 否 | 不早于该时间开始 | 可为过去；解析失败拒绝 |
| `dueAt` | `string`（ISO 8601，带偏移） | 否 | 期望完成时间 | 不早于 `startAt`（两者都有时） |
| `estimateMinutes` | `number` | 否 | 估时，只用于展示 | 整数，1 至 10080 |

`parseOutcomePlan` 不得因缺少新字段而返回 `null`。

**`OutcomeWorkItem`（新增列）：**

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `scheduledAt` | `DateTime?` | 否 | bot 任务的"不早于"；人工任务的预约时间 | 人工任务不阻塞流程 |
| `dueAt` | `DateTime?` | 否 | 期望完成时间 | — |
| `estimateMinutes` | `Int?` | 否 | 估时 | 1 至 10080 |
| `deferCount` | `Int`，默认 0 | 是 | 已延后次数 | 上限见策略 `schedule.deferMaxCount` |

索引 `(status, scheduledAt)`，用于到期放行扫描。迁移放 `packages/db/prisma/migrations/<时间戳>_add_outcome_schedule/`，只加列和索引。

**`Outcome`（新增列）：** `dueAt DateTime?`，不参与契约内容哈希；已验收或取消后不可改。

**视图契约（扩展，`packages/contracts/src/outcomes.ts`）：**

- `WorkItemView` 新增：`startedAt`、`completedAt`、`scheduledAt`、`dueAt`、`estimateMinutes`、`deferCount`，以及 `runSegments`（最近 20 段运行 `{ id; startedAt; completedAt; status }`，按开始时间升序）。
- `OutcomeDetail` 新增 `dueAt`；`OutcomeSummary` 新增可选 `nextScheduledAt`（最早的未到点排期，供列表显示"已排期，下一步 …"）和可选 `trackingMode`（§3.7）。
- 所有新字段在旧服务端缺失时按"无"处理。

**`CalendarFeedToken`（新，阶段 8）：**

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 是 | 主键 | — |
| `userId` | `uuid` | 是 | 所有者 | 关联 `User` |
| `name` | `string` | 是 | 名称 | 1 至 80 字符 |
| `tokenHash` | `string` | 是 | 令牌哈希 | 唯一；明文不入库 |
| `kinds` | `string[]` | 是 | 包含的条目类型 | `external_event` 不可选 |
| `includeLinks` | `boolean` | 是 | 是否写入应用链接 | 默认 false |
| `createdAt`、`lastUsedAt`、`revokedAt` | `DateTime` | — | 生命周期 | `revokedAt` 非空即失效 |

**事件：** 新增 `outcome.schedule.changed`，载荷 `{ target: "outcome" | "work_item"; workItemId?; scheduledAt?; dueAt?; estimateMinutes?; previous?; source: "planner" | "owner" | "agent_defer" | "system" }`。需同步更新 `OUTCOME_EVENT_TOPICS`、载荷映射和 `isOutcomeEventTopic`，并检查 `apps/server/src/services/outcome-event-retention.ts` 对新主题的归类。

### 5.11 接口契约

覆盖需求：C3、C5、C6、C7、C8、C10、C11、C12。路径为建议值，实现时与现有路由风格核对。

- **`SavePlan`（扩展，线程工具）**：任务对象增加可选 `startAt`、`dueAt`、`estimateMinutes`；校验见 §5.1；错误 `invalid_schedule`（400）、`schedule_not_editable`（409）。
- **`DeferWorkItem`（线程工具，加入 `OUTCOME_THREAD_TOOL_NAMES`）**：输入 `resumeAt`、`note`（1 至 2000 字符）、可选 `reason`（不超过 300 字符）；输出 `{ deferred: true, resumeAt }` 并指示结束本回合；错误 `tool_context_invalid`（409）、`invalid_schedule`（400）、`defer_limit_reached`（409）、`invalid_outcome_transition`（409）。
- **`PUT /api/v0/outcomes/:outcomeId/work-items/:workItemId/schedule`**：输入 `{ scheduledAt?, dueAt?, estimateMinutes?, clientRequestId }`，`null` 表示清除；错误 `invalid_schedule`、`schedule_not_editable`、`outcome_not_open`。
- **`PUT /api/v0/outcomes/:outcomeId/due`**：输入 `{ dueAt, clientRequestId }`；错误 `outcome_not_open`、`invalid_schedule`。
- **`RequestHumanAction`（扩展，`packages/contracts/src/human-work.ts`）**：增加可选 `scheduledAt`、`dueAt`，写入人工任务，不影响放行和状态。
- **`GET /api/v0/schedule`**：输入 `from`、`to`（跨度不超过 93 天）、`kinds`、`botId`、`outcomeId`、`mine`；输出 `{ items: TimeItem[]; truncated: boolean }`；错误 `invalid_range`（400）。
- **订阅管理**：`GET/POST /api/v0/calendar/feeds`、`DELETE /api/v0/calendar/feeds/:id`、`POST /api/v0/calendar/feeds/:id/rotate`（所有者身份，创建和轮换时一次性返回明文地址）。
- **feed**：`GET /calendar/feed/:token.ics`（无会话，令牌鉴权），`text/calendar; charset=utf-8`；令牌无效或已撤销一律 404，响应体相同；超限 429。
- **`GET /api/v0/schedule/external`**：输入 `from`、`to`、账号列表、`busyOnly`；输出 `{ items; unavailable? }`；不可用时返回 200 加降级信息，不返回 5xx。

## 6. 数据与状态模型

### 6.1 数据关系

- `Outcome 1 — N OutcomeWorkItem`；任务的日期来自修订 `plan` 的物化或所有者修改。
- `OutcomeWorkItem 1 — N Run`，运行分段取自 `Run.startedAt/completedAt`。
- `OutcomeWorkItem` 的待放行内容保存在 `IdempotencyRecord`（scope `outcome-turn:<id>`，status `processing`）。
- `TodoItem` 可选关联：`linkedOutcomeId`（升级后的目标）、`handoffMessageId`（对应唯一的 `Run.userMessageId`）。
- `ActivityItem`、`NeedsMeItem`、`TimeItem` 都不存储，即时生成。单次安排从 `Routine`、`RoutineRevision` 和 `RoutineExecution` 生成两处视图（§3.10）。
- `TodoAutoAcceptRule` 属于所有者，匹配回合上下文里的例程和 bot；`CalendarFeedToken` 属于 `User`；业务策略数值在现有设置表的 `taskPolicy` 列里；晨报的"当天已发送"用现有幂等记录表示。

### 6.2 目标状态保持不变

`recomputeOutcomeStatus` 把 `queued` 视为活跃，所以一个目标只剩未来才开始的任务时，状态仍是 `running`。本规格**不改**这一点，避免影响 004.2 的状态机和既有测试。界面通过 `OutcomeSummary.nextScheduledAt` 和"已排期"标识说明目标在等待未来某个时间；活动视图把这类任务显示为"已排期"，不显示为"正在工作"（需求 A3.4）。

## 7. 错误处理

### 7.1 错误类型

- `invalid_schedule`：时间格式错误、`dueAt` 早于 `startAt`、估时越界、`resumeAt` 不在允许范围。
- `schedule_not_editable`：任务已开始、完成、失败或取消。
- `defer_limit_reached`：延后次数已达上限。
- `tool_context_invalid`：延后工具的调用方不是任务当前运行中的回合。
- `outcome_not_open`：目标已验收或取消。
- `invalid_range`：日程查询范围超限。
- `suggestion_limit_reached`：策略设置了未处理建议上限且已达上限（429）。
- `todo_conflict`：待办的 `revision` 过期（409）。
- `owner_ref_missing`、`owner_ref_invalid`：所有者消息引用缺失或校验不通过，`CreateTodo` 降级为建议，不报错，只在响应里说明。
- `auto_accept_rule_invalid`：自动接受规则没有任何来自回合上下文的字段（400）。
- `todo_forbidden_status`：创建未通过来源门；服务端不报错而是降级为 `suggested`，同时在响应里说明原因（见 §4.4）。
- `feed_not_found`：订阅令牌无效或已撤销，对外统一为 404。
- `external_calendar_unavailable`：以降级信息返回，不作为错误。

### 7.2 错误响应格式

沿用仓库现有的 `ApiError(status, code, message, details)`，不引入新格式。

### 7.3 处理策略

1. 输入验证错误：整体拒绝，不保存任何内容。
2. 业务规则错误：返回 409 和当前状态，调用方可据此刷新。
3. 外部依赖错误：外部日历、某个活动来源失败只影响该来源，不影响其他视图和目标执行。
4. 重试与补偿：放行靠持久化记录和幂等键；worker 停机后下一个调度轮次补放行；错过计划的 `action` 任务交给所有者决策；建议靠 `dedupeKey` 和过期扫描自洽。

## 8. 正确性属性

### 8.1 属性 1：未到点不启动

*对于任何* `scheduledAt` 晚于当前时间的 bot 任务，系统都不会为它创建执行回合，也不会占用 bot 的并发名额。

**验证需求：** C4.1、C4.3

### 8.2 属性 2：到点恰好放行一次

*对于任何* 已到点且满足依赖和契约有效性的排期任务，无论调度器被重复触发、worker 重启还是并发放行，都只产生一个新回合。

**验证需求：** C4.2、C4.5、非功能 2.1、2.2

### 8.3 属性 3：延后不被误判为完成

*对于任何* 因 `DeferWorkItem` 而结束的回合，结算后任务仍是 `queued`，不会变为 `completed`、`failed` 或 `needs_review`。

**验证需求：** C5.1、C5.2

### 8.4 属性 4：日期调整不改契约

*对于任何* 目标截止日或任务排期的修改，契约内容哈希、修订状态和批准记录都保持不变。

**验证需求：** C7.1、C8.1

### 8.5 属性 5：`action` 任务不会静默晚执行

*对于任何* 性质为 `action` 的排期任务，若放行时已晚于宽限时间，系统不会自动执行，而是等待所有者决策。

**验证需求：** C4.6

### 8.6 属性 6：展示状态不存储且单一实现

*对于任何* 请求、任务、待办或例程，活动视图、"需要我"、时间线、日历和 ICS 看到的展示状态都来自同一个 `deriveDisplayState`，数据库不保存这些状态。

**验证需求：** C4.8、A4.5、非功能 3.2

### 8.7 属性 7：没有截止日就没有逾期

*对于任何* 没有 `dueAt` 的任务、待办或目标，系统都不会产生逾期标记，也不会显示预测完成日期。

**验证需求：** C9.2、C9.3、B2.6

### 8.8 属性 8：订阅与叠加的隐私边界

*对于任何* 订阅令牌，数据库只保存其哈希，撤销后立即失效，输出默认不含描述；*对于任何* 外部日历叠加，系统只读，不落库，不暴露给 bot，也不进入订阅输出。

**验证需求：** C11.3、C11.4、C11.7、C12.2、C12.4

### 8.9 属性 9：没有有效所有者消息引用，就只能是建议

*对于任何* `CreateTodo` 请求，只有所有者消息引用通过校验（存在、由所有者发出、属于同一对话、在有效期内、未超单消息上限）才会创建 `open`，否则只创建 `suggested`；`SuggestTodo` 永远只创建 `suggested`，除非命中所有者创建的自动接受规则。该判断不依赖来源类型，也不依赖 agent 转述的文字。

**验证需求：** B3.1、B3.2、B10.1、B12.3

### 8.10 属性 10：待办创建幂等且去重

*对于任何* 重试的创建请求和同一来源的重复建议，系统都只产生一条待办，已忽略的来源不再被建议。

**验证需求：** B1.4、B3.3、B3.2

### 8.11 属性 11：活动视图不新增提醒机制

*对于任何* 请求进展，"核对中"、"无人跟进"、"检查未触发"都只来自它已有的字段，活动视图不写入请求进展，也不触发任何提醒或重试。

**验证需求：** A6.4

### 8.12 属性 12：同一事项只出现一次

*对于任何* 事项，在活动视图和"需要我"里都只出现一次，来源重叠时按"来源加 ID"去重。

**验证需求：** A3.6、A4.4

### 8.13 属性 13：工具兼容且提示词不增

*对于任何* 既有的 `TrackOutcome` 和 `CloseOutcome` 调用，输入输出保持兼容；目标管理开启时基础提示词总长度不超过实施前。

**验证需求：** A7.6、非功能 6.1

### 8.14 属性 14：bot 隔离

*对于任何* bot，系统都不会让它读取其他 bot 的请求进展，也不会让它读取非自己创建且非自己对话中创建的待办；automation 回合只能创建建议。

**验证需求：** A2.3、B10.3、B10.4

### 8.15 属性 15：场景无关性

*对于任何* 两个仅在来源类型、标签和文字上不同的待办请求，系统都走同一条代码路径并得到同样的结果；代码、数据模型、提示词和工具描述里没有任何具体场景的标识符或分支。

**验证需求：** B4.3、D2.1、D4.2

### 8.16 属性 16：业务数值来自策略设置

*对于任何* 业务策略数值，系统都从策略设置读取；修改设置后无需改代码即生效；代码里只保留格式与规模上限。

**验证需求：** D3.1、D3.2、D3.3

### 8.17 属性 17：自动接受规则的边界

*对于任何* 自动接受规则：只有所有者能创建、修改、删除；至少包含一个来自回合上下文的匹配字段，只有来源类型字符串的规则被拒绝；任何 bot 工具都不能读写规则；`CreateTodo` 因引用校验失败而降级的建议不适用规则。

**验证需求：** B12.1、B12.2、B12.4、B12.8

### 8.18 属性 18：设置只有一个入口，数值来自元数据

*对于任何* 目标管理相关的设置，界面上都只有一个可编辑入口；*对于任何* 策略项，界面显示的单位、范围和初始值都来自契约包里的元数据，界面代码里没有业务数值。

**验证需求：** E1.4、E3.2、D3.1

## 9. 测试策略

### 9.1 单元测试

- `task-overview.ts`：§2.2 全部展示状态的推导，逾期规则，全天条目的时区和夏令时；`validateSchedule` 边界（过去的 `startAt`、`dueAt < startAt`、估时 0 和 10081）。
- `parseOutcomePlan`：旧数据无新字段仍可解析；新字段被保留。
- 来源门与引用校验：消息存在、由所有者发出（角色为 user 且所属运行来源是所有者对话，例程、事件、唤醒合成的 user 消息被拒绝）、同一对话、有效期、单消息上限、降级原因；两个仅来源类型和文字不同的请求走同一路径、结果一致。
- 自动接受规则：匹配（例程 ID、bot ID 相等，来源类型只做收窄）、只有来源类型的规则被拒绝、停用后不影响已接受的、当日上限降级、引用校验失败的降级不适用规则。
- 建议规则：去重键；过期（策略未设置则不过期）；可选上限。
- 策略解析：缺失时用集中初始值，越界被拒绝，修改立即生效。
- 设置页：导航顺序（模型、目标管理、语音消息）；策略项按元数据渲染，范围校验、恢复初始值、"不限制"状态；深链接锚点映射到该页；通用页不再有目标管理行。
- 时间线布局：未排期区、延后空档、运行分段。
- iCalendar 生成：UID 稳定、全天与 UTC 格式、转义、默认不含描述。

### 9.2 集成测试

沿用 `apps/server/test/outcome-plan-service.test.ts`、`outcome-thread-tools.test.ts`、`outcome-tracking.integration.test.ts` 和 `packages/messaging/test` 里 outcome 系列的夹具：

- **A**：活动查询（各来源、24 小时、隐藏项、200 条上限）；请求进展对账状态的呈现（核对中、无人跟进、检查未触发）；`evidence` 不在列表返回；"需要我"合并与去重；提示词与工具描述变更后 `TrackOutcome` 兼容；提示词长度不增。
- **B**：待办 CRUD、乐观并发；`CreateTodo`、`SuggestTodo` 的来源门（含多步流程里后续步骤凭引用创建）；自动接受规则的创建、匹配与管理权限；automation 回合只能 `SuggestTodo`；去重；按策略的过期扫描与可选上限；`ListTodos` 的 bot 隔离；交给 bot 的消息与关联；晨报选择与"一天一次"；批量清除。
- **D**：用至少两个不同的示例场景夹具走同一路径，结果一致；评审清单检查（无场景标识符、无按来源类型的分支、无业务数值字面量）。
- **C**：`SavePlan` 带排期；到期放行（未到点不创建运行、到点一次、停机后补放行、取消与修订被取代不放行、不占名额）；错过计划（`action` 创建决策，`deliverable` 照常，两个选项）；`DeferWorkItem`（延后、结算守卫、次数与范围限制、非当前回合被拒）；所有者改期和目标截止日（契约哈希不变）；日程查询（各来源、范围与条数）；订阅（创建、撤销、轮换、限流、脱敏）。

### 9.3 端到端测试

- 桌面端：活动视图与"需要我"；待办一行输入、分诊、延后、完成、交给 bot；目标详情时间线、改期；日历默认显示项、筛选、拖动、跳转。
- 设置页：在目标管理页修改一项策略后无需重启即生效，相应行为随之改变；总开关关闭时其余分组可见但禁用并说明开启后生效；"通用"页只有一行跳转入口，点击后打开目标管理页；切换"仪表盘显示"方式后仪表盘立即按所选方式显示，"需要我"区始终存在。
- 外部日历叠加（可行后）：叠加、授权失效降级、订阅输出不含叠加事件。
- 需要同步并重建远端 computer 后验证：`DeferWorkItem` 的真实延后与续做、`SuggestTodo` 在例程回合的来源门、由任一示例场景（见 `docs/20261124-场景示例.md`）触发的建议链路并用第二个不同场景复验同一路径、提示词变更后的缓存命中对比。**必须先征得用户同意。**

### 9.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| A1 活动视图 | §3.1、§3.3、§3.8 | 活动查询集成测试、桌面端组件测试 |
| A2 公开与隐私 | §3.2 | 集成测试（列表不含证据、仅所有者）、纯文本渲染测试 |
| A3 例程与目标任务 | §3.1 | 集成测试（来源、已排期不显示为工作中、不重复） |
| A4 统一"需要我" | §2.4、§3.4 | 集成测试（合并、排序、去重、读时消失） |
| A5 通知分级 | §3.4 | 集成测试（通知去重键、静默项） |
| A6 无人跟进 | §3.5、§2.2 | 单元测试（各状态推导）、集成测试（自愈后转 blocked） |
| A7 目标降级 | §3.6 | 提示词测试、工具描述测试、前后缓存对比 |
| A8 已有 tracked 目标 | §3.7 | 集成测试（不迁移、标记、筛选、`CloseOutcome` 照常） |
| A9 默认隐藏与密度 | §3.3 | 组件测试 |
| A10 移动端活动 | §3.9 | 各平台现有测试方式 |
| A11 单次安排与事前准备 | §3.10、§5.7 | 调度与恢复集成测试、桌面展示与跳转测试、两个不同场景的真实 bot 验收 |
| B1 手动添加 | §4.4、§4.11 | 集成测试、对话回合测试 |
| B2 状态与时间 | §4.2、§4.3 | 单元测试、集成测试 |
| B3 建议与分诊 | §4.4 | 集成测试（引用校验、去重、按策略的过期与上限、批量） |
| B4 来源引用与内容边界 | §4.2、§4.4 | 单元测试（两个不同来源类型走同一路径）、不存正文检查 |
| B5 周期性与定时产生待办 | §4.6、§4.7 | 例程回合只能建议并记录例程 ID；用一个示例场景做端到端 |
| B6 紧急度 | §2.4、§4.2 | 单元测试（分区内排序、不跨分区） |
| B7 等待与跟进 | §4.7 | 单元测试（推导）、集成测试 |
| B8 交给 bot 与升级 | §4.8 | 集成测试（消息、关联）、桌面端交互测试 |
| B9 晨报 | §4.9 | 集成测试（时区、一天一次、无事项不推） |
| B10 安全与隐私 | §4.10 | 集成测试（隔离、清除）、日志检查 |
| B11 移动端待办 | §4.11 | 各平台现有测试方式 |
| B12 自动接受规则 | §4.12 | 集成测试（匹配、权限、上限、不绕过引用校验）、单元测试 |
| C1 时间线 | §5.6、§5.10 | 桌面端组件测试、列表视图可访问性检查 |
| C2 实际时间 | §5.10 | 契约测试、详情集成测试（事件清理后仍有数据） |
| C3 规划排期 | §5.1、§5.10、§5.11 | 契约单元测试、`outcome-plan-service.test.ts` 扩展 |
| C4 到点才开始 | §5.2、§5.3、§2.2 | messaging 集成测试 |
| C5 延后继续 | §5.4、§5.11 | 线程工具集成测试、结算守卫测试、真实 computer 端到端 |
| C6 人工任务日期 | §5.10、§5.11 | `human-work.test.ts` 扩展 |
| C7 目标截止日 | §5.5、§5.10 | 服务端集成测试 |
| C8 所有者改期 | §5.5、§5.11 | 服务端集成测试、桌面端交互测试 |
| C9 时间诚实 | §5.6、§2.2 | 单元测试、组件测试 |
| C10 全局日历 | §5.7、§2.3 | 日程查询集成测试、桌面端日历测试 |
| C11 ICS 订阅 | §5.8 | 订阅集成测试、iCalendar 单元测试、真实日历应用手动验收 |
| C12 外部日历叠加 | §5.9 | 可行性验证记录、降级测试 |
| C13 移动端议程 | §5.7 | 复用日程查询测试，移动端按平台方式 |
| D1 通用处理流水线 | §2.5 | 集成测试（同一路径）、评审清单 |
| D2 不硬编码场景 | §2.5、§4.6 | 评审清单、属性 15 的测试 |
| D3 策略数值可配置 | §2.6 | 单元测试（策略解析）、评审清单（无数值字面量） |
| D4 场景示例只放文档 | §4.6 | 两个示例场景夹具走同一路径 |
| E1 独立的目标管理设置页 | §2.7 | 组件测试（导航顺序、单一入口）、深链接测试 |
| E2 页面包含的设置 | §2.7 | 组件测试（各分组）、人工走查 |
| E3 编辑行为 | §2.7、§2.6 | 组件测试（元数据渲染、范围校验、恢复初始值）、i18n 检查 |

## 10. 风险与待确认项

### 10.1 风险

- **请求进展依赖 bot 调用。** 它已写入基础提示词，且 `Task` 会自动开始追踪，但 bot 的遵从度没有实测。遵从度低时，活动视图会显得空。阶段 0 先量基线；若偏低，需要先补强再做目标降级。
- **目标降级会减少可见项。** 所以放在活动视图可用之后（阶段 5 晚于阶段 4），并且工具保持兼容、已有 tracked 目标不动。
- **证据字段的隐私。** 列表不返回证据，详情仅所有者可读；仍需在阶段 4 评估是否要对详情里的内容做更严格处理。
- **例程和目标执行不在请求进展里。** 它们通过例程执行记录和任务进展投影（§3.1）；例程触发的运行是否都能关联到请求，需阶段 0 核对。
- **全局查询的索引。** 活动视图要跨 bot 查 `requestProgress` 非空的行，现有索引只覆盖 `requestNextCheckAt`，可能需要部分索引。
- **建议质量与噪音。** 建议是否有用取决于 agent 的推理和所有者写的例程提示词；系统只能用接受率衡量，并提供批量清除和可选的上限。
- **去重键由 agent 提供。** 同一件事要用同一个来源 `id`，同类事每次要用不同的 `id`，否则会被当作重复而不再出现；这靠工具描述里的格式说明和 agent 推理保证，不由代码判断。
- **策略初始值。** 集中定义的初始值本身也是一种默认选择，需所有者确认（§10.2 第 5 项）。
- **提示注入。** bot 概括可能带有被外部内容影响的文字；已通过强制建议、纯文本渲染、来源标注和不存正文缓解，但不能完全消除。
- **`SuggestTodo` 扩大了 automation 回合的工具面。** 能力被限定为"创建建议"，上限由策略设置（可选）决定，所有者已确认接受（2026-11-24）。
- **所有者身份模型未核实。** `TodoItem.ownerId` 与现有所有者和 bot 归属如何对应，实施前需核对（`User` 模型存在）。
- **所有者消息引用的边界。** 它只能证明所有者在这个对话里近期说过那句话，不能证明那句话要求创建这条待办；靠依据预览、有效期和单消息上限限制滥用面。多步流程里的后续步骤（包括由例程结果唤醒的回合）凭有效引用也可创建 `open`，这是为了避免转述，代价是依赖上述限制。
- **agent 是否拿得到消息 ID 未核实。** 触发消息 ID 和 `ReadTranscript` 结果里的消息 ID 是否已提供给 agent，实施前要核对，缺失需要补。
- **设置入口迁移。** 习惯在"通用"页开关目标管理的人会找不到；缓解办法是在"通用"页保留一行跳转入口（§10.2 第 23 项，已确认）。
- **新增设置锚点在共享契约包里。** 移动端没有这一页，遇到新增锚点时的行为未核实，实施前核对。
- **页面变长。** 目标管理页最多有七个分组，靠分组标题、锚点定位和按功能上线逐步出现缓解；总开关关闭时其余分组可见但禁用（§10.2 第 22 项，已确认），所以页面始终是完整长度。
- **自动接受规则降低了分诊保护。** 规则一旦命中，外部内容可经被信任的例程影响所有者的待办列表；缓解是规则必须绑定具体的例程或 bot、不提供全部自动接受、保留命中统计和一键忽略、可选当日上限。
- **移动端写操作与 004.4 的取舍。** 004.4 把移动端写操作排除在外，本规格对待办增加四个最小操作，所有者已确认（2026-11-24），例外仅限这四项。
- **结算误判。** 延后若没有结算守卫，会把任务标为完成，已作为必做项并有专门测试（属性 3）。
- **目标状态误导。** 目标只剩未来任务时仍显示 `running`（§6.2），靠"已排期"标识缓解。
- **暂停语义。** 目标被暂停时，排期任务是否会在到点放行需要核对。
- **计算机重建。** 新工具生效要求同步并重建远端 computer，会中断正在运行的 bot 任务，必须先征得用户同意。
- **提示词缓存。** 前缀变更部署时有一次性重建；篇幅净减少，长期成本不增。
- **004.9 状态。** 用户确认规划角色已在其环境启用（2026-11-24），目标会按计划拆分成多个任务；这一点没有在代码或环境里独立验证，004.9 规格本身仍标为 Draft。若实际目标仍只有一个任务，时间线价值有限。
- **事件留存。** 时间线不依赖事件回放，新事件主题仍需纳入留存策略。
- **例程展开。** 需要复用例程调度计算，实施时核对 `routines.ts`。

### 10.2 待确认项

编号保持不变（任务清单按编号引用）。第 1、2、3、4、5、8、12、13、18、20、21、22、23、24 项已由所有者确认（2026-11-24），标注【已确认】；共 24 项，其余 10 项仍待确认。

1. **活动视图与目标泳道**【已确认：并存】：先把活动区与现有的"Bots are working"和"Paused or failed"两个目标泳道同时实现和显示，由所有者评估后再决定是否取代；本规格不实现取代。
2. **待办用独立实体**【已确认：独立实体】，不扩展 tracked 目标。
3. **所有者可以为某个例程或 bot 设置"其建议自动接受"**【已确认：允许】（通用设置，不针对任何具体场景；见需求 B12、设计 §4.12）。
4. **`SuggestTodo` 在 automation 回合使用**【已确认：允许，只能创建建议；是否设上限由策略设置决定，代码不写死数值】。
5. **策略设置的初始值**【已确认：先按当前初始值试用，保留集中定义的默认值】（需求 D3）：建议过期天数、恢复保留天数、可选的未处理建议上限、宽限时间、延后次数与天数、展示阈值、晨报时间、引用有效期等。
6. **bot 可见的待办范围**：自己创建的，加所有者在与它的对话中创建的，是否合适？
7. **待办是否并入目标管理开关**，还是单独开关？
8. **手机端首批**【已确认：包含】接受、延后、忽略、完成待办（对 004.4 移动端写操作限制的例外，仅限待办这四项）。
9. **已有 tracked 目标**是否提供批量关闭已完成的？默认不动。
10. **`blocked` 的 `policy` 来源**是否进入"需要我"？默认进入。
11. **待办是否有独立的到期推送**，还是只靠晨报？默认只靠晨报，晨报默认关闭。
12. **宽限时间**【随第 5 项先试用】初始值 60 分钟（策略 `schedule.graceMinutes`）。
13. **延后上限**【随第 5 项先试用】：初始值最多 10 次、最远 180 天（策略 `schedule.deferMaxCount`、`schedule.deferMaxDays`）。
14. **所有者改期是否回写修订的 `plan`**？不回写时重规划可能覆盖所有者的改期，需要在差异比对时优先保留所有者修改。
15. **日历默认显示项**（需求 C10.4）是否符合预期？单次安排按 A11 默认显示，其余类型沿用当前默认设置，等待实机验收。
16. **ICS 默认不带应用链接、不带描述**是否合适？
17. **目标暂停期间**排期任务到点是否放行？默认建议不放行，恢复后补放行。
18. **004.9 的规划角色**【已确认：已在用户环境启用】（由用户确认，未独立验证）。
19. **"必须建例程"的要求**能否放宽，取决于阶段 0 对请求进展续跑的实测。
20. **所有者授权校验**【已确认：采用，但改为引用所有者消息（消息 ID），由服务端读取并校验，不靠 agent 转述原话】（需求 B3.2）。
21. **高紧急度事项是否触发打断式通知**【已确认：作为可配置选项，默认关闭】（策略 `todo.highUrgencyNotify`，需求 B6.3）。
22. **总开关关闭时，目标管理页其余分组怎么显示**【已确认：可见但禁用，并说明开启后生效】（需求 E1.3）。
23. **"通用"页是否保留一行跳转到目标管理页的入口**【已确认：保留，只跳转、不可编辑】（需求 E1.4）。
24. **目标管理页的"仪表盘显示"选项**【已确认：加，默认并存】（并存 / 只显示活动 / 只显示目标泳道），便于评估活动视图是否取代泳道（第 1 项）；需求 A1.7 已同步改写，策略键 `activity.dashboardLayout`。
