# 任务清单 - 任务全景视图（人话版）

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

## 这份文档是干什么的

让人快速知道：

- 先做什么，后做什么
- 每一步到底改什么
- 做完后怎么判断是不是真的完成了

当前没有任何任务开始，规格只做规划，不开始实现。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- `BLOCKED` 必须写清楚卡在哪里
- `CANCELLED` 必须写清楚为什么不做
- 每做完一个任务，必须立刻更新这里

## 阶段顺序

用户已确认"先做目标详情内的时间线，再做全局日历"。其余阶段的位置是建议，待确认。

| 阶段 | 内容 | 对应部分 |
| --- | --- | --- |
| 0 | 核实与基线 | A（前置） |
| 1 | 目标详情时间线 v1 | C |
| 2 | 排期数据与到点放行 | C |
| 3 | 时间线 v2 | C |
| 4 | 活动视图与"需要我" | A |
| 5 | 目标降级与提示词精简 | A |
| 6 | 现实待办项 | B |
| 7 | 全局日历及单次安排补充 | A、C |
| 8 | ICS 订阅与外部日历叠加 | C |
| 9 | 移动端（待办四个操作为首批，已确认；活动与议程可选） | A、B、C |

阶段 5 必须晚于阶段 4：bot 停止登记目标之前，所有者必须已经有地方看到 bot 的工作。阶段 7 晚于阶段 6，日历才会有待办条目。

## 全局约束

- **重建远端 computer 需要用户同意。** 任务 2.5、6.4 在 `packages/contracts` 新增 bot 工具，生效要同步并重建远端 computer 容器；重建会中断正在运行的 bot 任务（见 `AGENTS.md`「Remote Debug Computer」）。任务 0.x 和各端到端验证里涉及真实对话的，也要先征得同意。
- 数据库迁移只加列、表和索引，不改已有数据；迁移前先备份。
- 不对已有文件运行格式化命令，避免产生无关的改动。
- 新增界面文案必须同时有中英文，并通过 i18n 目录检查脚本。
- 提交信息用中文，格式 `前端：xxx` 或 `修复：xxx`。
- **不硬编码场景。** 待办相关的代码、数据模型、提示词和工具描述里，不得出现具体场景（邮件、拜访、巡检等）的标识符、按来源类型的分支，或业务数值字面量；业务数值走策略设置，场景只写在 `docs/` 的示例里（需求 D 部分）。

---

## 阶段 0：核实与基线（先于目标降级）

- [ ] 0.1 请求进展的续跑与来源核实
  - 状态：BLOCKED
  - 卡点（2026-11-24）：只读部分已完成（代码走读结论见 `docs/20261124-阶段0核实与基线记录.md` §2）；第 2 步「在调试环境用真实对话验证 `waiting` 加 `checkAt` 的续跑」需要所有者同意发起真实对话，尚未获得同意，未做。设计 §10.2 第 19 项的结论依赖这一步，目前只有初步判断，不能当作结论。
  - 这一步到底做什么：核实 `waiting` 加 `checkAt` 到期后是否真的续跑；核实由例程唤醒的回合能否使用请求进展（`background_revival` 来源）；核实 `independentOrigins` 的实际边界。
  - 做完你能看到什么：一份结论写进 `docs/`：哪些情况请求进展可靠，哪些不行，是否需要补强。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 A6
    - `design.md` §2.2、§3.5
    - `packages/messaging/src/request-progress.ts`
  - 主要改哪里：
    - `docs/`（核实结论）
  - 这一步先不做什么：不改代码；真实对话验证需先征得用户同意，远端代码落后时同步重建需另行同意。
  - 怎么算完成：
    1. 读代码给出"唤醒回合是否开始请求追踪"的结论。
    2. 在调试环境用真实对话验证一次 `waiting` 加 `checkAt` 的续跑（取得同意后）。
    3. 明确写出"必须建例程"的要求是否可以放宽。
  - 怎么验证：
    - 代码走查记录；调试环境的实际运行日志（`inference.metrics` 和请求检查日志）。
  - 对应需求：`requirements.md` 需求 A6、A7
  - 对应设计：`design.md` §3.5、§10.1

- [ ] 0.2 bot 遵从度基线
  - 状态：BLOCKED
  - 卡点（2026-11-24）：需要只读统计调试库的 `Run` 记录。没有所有者指定的可用库，不连接共享库或远端库，所以没有统计，也没有数字。
  - 这一步到底做什么：量一量真实对话里，使用 `Task` 派发工作的请求中，有多少持续更新了请求进展。
  - 做完你能看到什么：一个数字和样本说明，用来判断活动视图会不会显得空。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 A1
    - `design.md` §10.1「请求进展依赖 bot 调用」
  - 主要改哪里：
    - `docs/`（基线记录）
  - 这一步先不做什么：不改提示词，不改代码。
  - 怎么算完成：
    1. 给出样本范围、统计方法和结果。
    2. 若遵从度偏低，列出补强建议（不在本任务里实现）。
  - 怎么验证：
    - 只读统计调试库的 `Run` 记录。
  - 对应需求：`requirements.md` 需求 A1、A7
  - 对应设计：`design.md` §10.1

- [ ] 0.3 提示词与缓存基线
  - 状态：BLOCKED
  - 卡点（2026-11-24）：提示词长度基线已测（开启 27,328、关闭 22,473，详见 `docs/20261124-阶段0核实与基线记录.md` §3）；一轮真实对话的 `cachedInputTokens` 占比需要真实推理记录，需所有者同意发起真实对话，尚未做。
  - 这一步到底做什么：记录改动前的基础提示词长度和缓存命中情况，作为阶段 5 和 6 对比的基线。
  - 做完你能看到什么：目标管理开启和关闭时的基础提示词字符数，以及一轮真实对话的 `cachedInputTokens` 占比。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 非功能需求 6
    - `design.md` §3.6
  - 主要改哪里：
    - `docs/`（基线记录）
  - 这一步先不做什么：不改提示词。
  - 怎么算完成：
    1. 记录两种开关下的长度（已测约 27,328 和 22,473 字符，需在实施时复测）。
    2. 记录一次真实对话的缓存读取占比；若调试环境没有推理记录，说明原因。
  - 怎么验证：
    - 渲染函数输出长度；`inference.metrics` 日志。
  - 对应需求：`requirements.md` 非功能需求 6.1
  - 对应设计：`design.md` §3.6

### 阶段检查

- [ ] 0.4 阶段 0 检查点
  - 状态：BLOCKED
  - 卡点（2026-11-24）：依赖 0.1、0.2、0.3 的未完成部分。阶段 1 至 3 不依赖本检查点，已先行；阶段 4 开工前必须先完成它（任务 4.1 依赖 0.4）。
  - 这一步到底做什么：确认前置核实已完成，再决定阶段 4 和 5 的细节。
  - 做完你能看到什么：一份结论清单，明确"请求进展可靠吗、遵从度够吗、缓存基线是多少"。
  - 先依赖什么：0.1、0.2、0.3
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 三份记录都已写入 `docs/`。
    2. 设计 §10.2 第 19 项有结论。
  - 怎么验证：
    - 人工走查。
  - 对应需求：`requirements.md` 需求 A6、A7
  - 对应设计：`design.md` §10.1、§10.2

---

## 阶段 1：目标详情时间线 v1（只用已有数据）

- [x] 1.1 暴露任务实际时间与运行分段
  - 状态：DONE
  - 当前进展（2026-11-24）：契约（`RunSegmentView`、`RUN_SEGMENT_LIMIT`、`buildRunSegments`、`WorkItemView` 三个可选字段）和服务端详情组装已实现；契约单元测试 5 个新增用例通过，`packages/contracts` 全量 264 通过，contracts 与 server 的 `tsc` 通过，`check:architecture` 通过。
  - 验证补记（2026-11-24）：服务端详情集成测试 `apps/server/test/outcome-work-item-times.integration.test.ts`（5 个用例）已在本机一次性 Postgres 上真实执行，5 个全部通过（测试库的来源见 `docs/20261124-阶段0核实与基线记录.md` §5）。因此状态由 IN_REVIEW 改为 DONE。
  - 实现取舍：运行分段只收 `startedAt` 非空的运行（排队中、未开始的运行不算一段，也不用创建时间代替）；按开始时间升序，同一时刻按运行 ID 排序，保证稳定；取最近 20 段。首次开始时间沿用 `OutcomeWorkItem.startedAt`（`transitionWorkItem` 已保证只在首次进入运行状态时写入）。
  - 这一步到底做什么：在目标详情里补上每个任务的首次开始、结束，以及最近 20 段运行的起止和状态。
  - 做完你能看到什么：客户端能拿到任务真实的开始和结束时间；事件被清理后仍然有。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 C2
    - `design.md` §5.10「视图契约」
    - `docs/20261124-现状核实记录.md` §1、§3
  - 主要改哪里：
    - `packages/contracts/src/outcomes.ts`（`WorkItemView`）
    - `apps/server/src/services/outcome-service.ts`（详情组装处）
    - `packages/contracts/test/outcomes.test.ts`
  - 这一步先不做什么：不加任何排期字段，不做界面。
  - 怎么算完成：
    1. 任务视图包含 `startedAt`、`completedAt`、`runSegments`，从未运行的任务这些字段为空。
    2. 多段运行按开始时间升序，且不覆盖首次开始时间。
    3. 旧数据和字段缺失的服务端响应不会让客户端解析失败。
  - 怎么验证：
    - 契约单元测试；服务端详情集成测试（含运行多次的任务）。
  - 对应需求：`requirements.md` 需求 C2 / 验收 C2.1 至 C2.4
  - 对应设计：`design.md` §5.10、§6.1

- [x] 1.2 展示状态推导与时间条目类型（纯函数）
  - 状态：DONE
  - 完成记录（2026-11-24）：新增 `packages/contracts/src/task-overview.ts`（请求、目标任务、例程的展示状态推导，逾期叠加标记，所有者时区的本地日期，`TimeItem`/`ActivityItem` 类型）和 `packages/contracts/test/task-overview.test.ts`（31 个用例），并在 `packages/contracts/package.json` 登记 `./task-overview` 导出。`packages/contracts` 全量 295 通过，`tsc` 与 `check:architecture` 通过；场景词与数值字面量自查通过。阈值（`checkOverdueMinutes`、`recentCompletedHours`）全部由调用方传入，文件内没有业务数值。
  - 对规格的补充解释（需所有者确认，已记入 docs）：①设计 §2.2 表里没有覆盖「已排期的时间已到、依赖仍未完成」的组合，按「等待依赖」处理；②例程最近一次执行为 `queued` 时按「运行中」处理；③例程的暂停不遮盖失败或运行中；④请求「核对中」按对账次数大于 0 判断，不写死 3 次的上限（上限只存在于 `request-progress.ts` 的运行时逻辑）。
  - 范围说明：待办的展示状态按本任务「先不做什么」留到阶段 6，`DisplayState` 目前只含请求、目标任务和例程三类。
  - 这一步到底做什么：写一份被各视图共用的展示状态推导，以及 `TimeItem`、`ActivityItem` 类型。
  - 做完你能看到什么：一个只有纯函数的新文件，带完整单元测试。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 C4.8、C9、非功能需求 3.2
    - `design.md` §2.2「展示状态推导」、§2.3「时间条目」
  - 主要改哪里：
    - `packages/contracts/src/task-overview.ts`（新）
    - `packages/contracts/test/task-overview.test.ts`（新）
  - 这一步先不做什么：不接数据库，不改任何界面；待办相关状态在阶段 6 再补测试。
  - 怎么算完成：
    1. 设计 §2.2 里请求、目标任务、例程的每一行都有对应测试。
    2. 没有 `dueAt` 的任务任何情况下都不会逾期。
    3. 全天条目在夏令时切换日期不漂移。
  - 怎么验证：
    - 契约包单元测试。
  - 对应需求：`requirements.md` 需求 C4.8、C9.2、C9.3、A6、非功能 3.2
  - 对应设计：`design.md` §2.2、§2.3、§8.6、§8.7

- [ ] 1.3 目标详情时间线 v1
  - 状态：IN_REVIEW
  - 会话 A 验证（2026-11-25）：本机 Chromium 用离线夹具打开实际目标详情组件的「更多详情」，中英文和深浅主题均检查到运行分段、间隙、依赖、今天线及未排期提示。真实规划目标的数据仍待核对，见[远端清单](docs/20261125-远端验证清单.md)。
  - 当前进展（2026-11-24）：布局纯函数 `timeline/timeline-layout.ts`（运行分段、间隙、依赖连线、未排期区、拓扑顺序、环保护、旧服务端降级）、状态呈现 `timeline-status.ts`、组件 `outcome-timeline.tsx`、样式（追加到 `outcome-ui.css`，只新增行）已实现，并接入目标详情「支撑记录」区、位于「Execution progress」折叠区之前。新增测试 31 个（布局 17、状态 5、渲染 9）全部通过；desktop `tsc` 通过。
  - 未验证：「人工打开真实目标走查」没有做。没有在真实界面里看过时间线的对齐、配色和滚动，目前只有 HTML 结构测试和 CSS 文本检查。需要所有者或具备界面环境的人打开一个已拆分的目标确认。
  - 与规格的差异：①`WorkItemView` 还没有 `scheduledAt`（任务 2.1 才加），时间线用局部扩展类型 `TimelineWorkItem` 接收它，所以「延后至 X」目前在真实数据下不会出现，2.1 加字段后自动生效，需在 2.x 回归；②延后的未来时间只作为文字标注放在行尾，不按时间画到轴上（轴只覆盖已发生的时间，不预测）；③时间线放在「支撑记录」折叠区内，默认收起，没有改详情页的首屏结构。
  - 这一步到底做什么：在目标详情里画时间线：任务行、每段实际运行的实心条、依赖连线、今天线、未排期区。
  - 做完你能看到什么：打开一个已拆分的目标，一眼看到任务先后、依赖和已发生的进度；没有时间的任务在"未排期"里并写明在等谁。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 C1
    - `design.md` §5.6「目标详情时间线」
    - `apps/desktop/src/renderer/components/outcomego/outcomes/outcome-progress.ts`
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/outcomes/timeline/`（新）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/detail/outcome-detail.tsx`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/outcome-ui.css`
  - 这一步先不做什么：不画计划条和估算条，不做改期，不加依赖库（先用 CSS 网格和 SVG）。
  - 怎么算完成：
    1. 每个任务一行，延后的任务分段绘制并标注"延后至 X"。
    2. 只有一个任务或没有计划的目标仍能正常显示。
    3. 服务端不返回时间字段时降级为只显示顺序和状态。
  - 怎么验证：
    - 组件测试（单任务、多任务、延后、无计划、字段缺失）；人工打开真实目标走查。
  - 对应需求：`requirements.md` 需求 C1.1 至 C1.5、C1.7、C1.8
  - 对应设计：`design.md` §5.6

- [x] 1.4 等价列表视图与国际化
  - 状态：DONE
  - 会话 A 验证（2026-11-25）：本机 Chromium 用实际组件核对中英文表格可访问名称、状态文字、图标及配色。键盘可按回车定位今天线并保留焦点，可从改期入口按 Tab 进入时间控件。系统减少动态效果时运行图标停止。读屏软件尚未操作。全仓国际化检查仍有基线的六条缺项与一条重复键，本次未增加诊断。
  - 当前进展（2026-11-24）：等价列表视图（`<table>`，行标题用 `scope="row"`，图形区 `aria-hidden`）、状态的文字+图标+语气三重表达、动画只用于进行中并随 `prefers-reduced-motion` 关闭（由 `outcome-timeline-a11y.test.ts` 断言）、中英文目录（新增 22 条）均已完成；`check:i18n` 通过。
  - 原始验证范围（2026-11-24）：表格语义和 `aria-hidden` 当时只有静态 HTML 断言。
  - 注意：`check:i18n` 报告的「未使用条目」从 584 增至 596，是因为状态标签通过 `t(style.label)` 动态翻译，脚本只认字面量调用，不是遗漏。`timeline-status.test.ts` 用 `missingKeys` 补上了这条覆盖。
  - 这一步到底做什么：给时间线配一个信息等价的表格视图，补全中英文文案，保证不靠颜色区分状态。
  - 做完你能看到什么：键盘和读屏软件能完整使用时间线；切换语言文案齐全。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 C1.6、非功能需求 5
    - `design.md` §5.6 第 7、8 步
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/outcomes/timeline/`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不做用户偏好的持久化设置页。
  - 怎么算完成：
    1. 状态同时有文字、图标和颜色。
    2. 动画只用于"进行中"，并遵守 `prefers-reduced-motion`。
    3. i18n 目录检查脚本通过。
  - 怎么验证：
    - 组件测试；`scripts/check/i18n-catalog.ts` 检查；键盘走查。
  - 对应需求：`requirements.md` 需求 C1.6、非功能需求 5
  - 对应设计：`design.md` §5.6

### 阶段检查

- [ ] 1.5 阶段 1 检查点
  - 状态：IN_REVIEW
  - 会话 A 准备（2026-11-25）：离线 Chromium 的界面与键盘证据见 1.3、1.4。真实规划目标的验证见[远端清单](docs/20261125-远端验证清单.md)。
  - 当前进展（2026-11-24）：任务 1.1 至 1.4 的代码、测试与记录已完成，见各任务条目；已知缺口与偏差记入 `docs/20261124-实施偏差与待确认记录.md`。
  - 已满足：「现有 Outcome 相关测试保持通过」。在本机一次性 Postgres 上，未改动的 `8fec13f10` 与本分支的 messaging 都是 900 通过 0 失败；server 基线 1671 通过 / 19 跳过 / 0 失败，本分支 1676 通过 / 19 跳过 / 0 失败，多出的 5 个就是任务 1.1 的集成测试。
  - 未满足：①「真实目标是否确实被规划角色拆成多个任务」没有核实，需要真实环境里的数据（任务 0.2 要的只读统计库，或真实对话）。②任务 1.3、1.4 的界面和键盘走查没做。这两项没补齐前保持 IN_REVIEW。
  - 这一步到底做什么：只检查时间线 v1 是否站稳，不加新范围。
  - 做完你能看到什么：可以进入排期阶段，且时间线对现有目标都能正常显示。
  - 先依赖什么：1.1、1.2、1.3、1.4
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 现有 Outcome 相关测试保持通过。
    2. 已知缺口和风险（例如真实目标是否确实被规划角色拆成多个任务）已记入 `docs/`。
  - 怎么验证：
    - 相关测试和人工走查。
  - 对应需求：`requirements.md` 需求 C1、C2
  - 对应设计：`design.md` §5.6、§5.10

---

## 阶段 2：排期数据与到点放行

- [x] 2.1 数据库列、策略设置通道与契约字段
  - 状态：DONE
  - 完成记录（2026-11-24）：
    - 数据库：`Outcome.dueAt`；`OutcomeWorkItem.scheduledAt / dueAt / estimateMinutes / deferCount`；索引 `(status, scheduledAt)`；`FeatureSettings.taskPolicy`。迁移 `202611240002_add_outcome_schedule`，只加可空列、一个带默认值的列和一个索引。迁移测试 `packages/db/test/outcome-schedule-migration.integration.test.ts` 在本机一次性 Postgres 上执行通过：已有行不变、新列默认值与可空性正确、索引存在，另有静态断言迁移里没有 DROP/DELETE/UPDATE 等语句。
    - 契约：新增 `task-policy.ts`（`TASK_POLICY_FIELDS` 元数据、`resolveTaskPolicy`、`validateTaskPolicyUpdate`、`mergeTaskPolicy`）；`PlanTask`/`PlanTaskInputSchema` 增加 `startAt / dueAt / estimateMinutes`；`validatePlanSchedule` 与 `parseOffsetTimestamp`；`WorkItemView`、`OutcomeDetail`、`FeatureSettingsView`、`UpdateFeatureSettingsInput` 增加对应可选字段。`parseOutcomePlan` 对旧数据照常解析。
    - 设置通道：`updateFeatureSettings` 对 `taskPolicy` 在一条 SQL 里按键原子合并（`null` 删键即恢复初始值），校验失败整体拒绝并返回 `invalid_task_policy` 与每个出错键的允许范围；12 个并发更新两个键都保留。
    - 验证：contracts 322、messaging 900、server 1686（19 跳过）、db 50，均 0 失败（有数据库）；根目录 `typecheck` 15/15、`check:architecture` 通过。
  - 注意：①`validatePlanSchedule` 目前只被契约测试使用，`SavePlan` 的接线在任务 2.2，所以这个任务不改变任何运行行为。②测试库用 `db push` 建表，不走迁移文件；迁移文件本身由上面的迁移测试单独验证。③生产库升级前按全局约束先备份，这一步由部署方执行，我没有对任何真实库做迁移。
  - 范围外的取舍：各字段的 `min`/`max` 规格没有给出，我取了宽松的格式上限（只挡明显错误输入），所有者可以调；`taskPolicy` 在存储中按点分键扁平保存。记入 `docs/20261124-实施偏差与待确认记录.md`。
  - 这一步到底做什么：新增任务和目标的日期列，给 `PlanTask` 加排期、截止、估时字段，并让旧数据照常解析；同时在现有设置表里加一个策略 JSON 列和读取函数，让业务数值由所有者配置。
  - 做完你能看到什么：数据结构和策略设置通道就绪，但行为还没变。
  - 先依赖什么：1.5
  - 开始前先看：
    - `requirements.md` 需求 C3、C6、C7
    - `design.md` §5.10「数据结构」、§2.6「策略设置」
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`（任务和目标的日期列；`FeatureSettings.taskPolicy`）
    - `packages/db/prisma/migrations/<时间戳>_add_outcome_schedule/`（新）
    - `packages/contracts/src/outcomes.ts`、`packages/contracts/src/outcome-thread.ts`
    - `packages/contracts/src/task-policy.ts`（新，`TASK_POLICY_FIELDS` 元数据、`resolveTaskPolicy`）、`packages/contracts/src/index.ts`（`FeatureSettingsView`、`UpdateFeatureSettingsInput`）
    - `packages/messaging/src/feature-settings.ts`
  - 这一步先不做什么：不改放行逻辑，不改界面。
  - 怎么算完成：
    1. 迁移只加列和索引，`prisma generate` 通过。
    2. `parseOutcomePlan` 对缺新字段的旧数据仍返回计划。
    3. `OutcomeDetail.dueAt` 与任务视图的新字段可读。
    4. 策略缺失时用集中定义的初始值，越界被拒绝，按键合并更新，传 `null` 恢复初始值；业务代码里没有策略数值字面量。
  - 怎么验证：
    - 契约单元测试；迁移文件与 schema 一致检查；策略解析的单元测试。
  - 对应需求：`requirements.md` 需求 C3.1、C3.3、C7.1、D3
  - 对应设计：`design.md` §5.10、§2.6

- [x] 2.2 `SavePlan` 排期校验、物化与差异比对
  - 状态：DONE
  - **此前的悬而未决已解决（2026-11-25，随任务 2.6）：** 原先对已开始任务的排期比较以任务行为准（D2-7），所有者改期后规划角色原样回传旧计划会被拒绝。现按「改期不回写计划，重规划比对时保留所有者的修改」（待确认项 14 的默认做法）改为：规划角色传回的计划与**它上次看到的已保存计划**比较，只有它真正改过的字段才会写入任务行；所有者之后改过的日期保持不变。有测试和变异检查。
  - 完成记录（2026-11-25）：
    - 校验：`SavePlan` 对每个任务调用 `validatePlanSchedule`，失败整体拒绝并返回 400 `invalid_schedule`，`details` 含任务 key 和出错字段，计划和事件都不变；过去的 `startAt` 被接受；`dueAt` 可等于但不可早于 `startAt`。错误码已登记到 `OUTCOME_ERROR_CODES`。
    - 保存：`normalizePlanTask` 保留三个字段；`plansEqual` 把它们纳入比较，且按时间点而不是按字符串比较（同一时刻不同偏移写法不算修改，只改排期也不再被判为 `plan_unchanged`）。
    - 物化：批准时（`startApprovedRevision`）和批准后追加任务（`applyApprovedPlanChanges`）两处都通过共用函数 `workItemScheduleFromPlanTask` 写入 `scheduledAt / dueAt / estimateMinutes`。
    - 批准后差异：未开始任务的排期改动更新任务行，并沿用「先删待处理排队记录再以新 clientId 重新入队」；已开始或已结束任务的排期被改则整体拒绝（`plan_task_locked`，任务行不变）；可原样回传。锁定任务的比较对象是任务行而不是计划 JSON，因为所有者之后可以改排期（任务 2.6）。
    - 验证：`outcome-plan-service.test.ts` +8、`outcome-stage3.test.ts` +7，共 15 个；做过变异检查（关掉锁定任务的排期比较，对应测试立刻变红，已还原）。有数据库时 contracts 322、messaging 900、server 1701（19 跳过）均 0 失败；根目录 `typecheck` 15/15、`check:architecture` 通过。
  - **说明：2.2 与 2.3 需要一起发布。** 消息层目前没有任何地方读取任务的 `scheduledAt`，所以在 2.3 的到点闸口实现之前，带未来 `startAt` 的计划被批准后任务仍会立刻执行，排期只是被保存下来。
  - 未做（按任务边界）：规划角色并不知道要使用这三个字段。`SavePlan` 的工具描述和规划角色提示词的排期指导在任务 2.8；现在只是 schema 接受它们。
  - 测试环境：server 整包运行时 `runtime-health.test.ts` 的 `attributes queue-timeout failures and bounds the response` 出现过 1 次失败（computer 状态 `unavailable`），单独重跑 5/5 通过、整包重跑 0 失败。它与本任务无交集，判断为并行负载下的偶发失败，**未在未改动的提交上验证**。
  - 这一步到底做什么：让规划角色能保存带排期的计划；批准后把日期复制到任务；批准后修改未开始任务的排期按既有规则处理。
  - 做完你能看到什么：带排期的计划能保存、批准，任务上有正确的日期；非法排期被整体拒绝。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 C3
    - `design.md` §5.1、§5.11
    - `specs/004.9-Outcome规划角色与任务分配/design.md`（批准后 `SavePlan` 的差异规则）
  - 主要改哪里：
    - `apps/server/src/services/outcome-plan-service.ts`
    - `apps/server/src/services/outcome-service.ts`（批准后创建任务处）
    - `apps/server/test/outcome-plan-service.test.ts`
  - 这一步先不做什么：不实现到点放行，不改规划角色提示词。
  - 怎么算完成：
    1. `dueAt` 早于 `startAt`、估时越界、时间格式错误都返回 `invalid_schedule` 且不保存。
    2. 过去的 `startAt` 被接受。
    3. 已开始或已结束的任务试图改排期时整体拒绝。
  - 怎么验证：
    - `outcome-plan-service.test.ts` 扩展；批准后再次 `SavePlan` 的集成测试。
  - 对应需求：`requirements.md` 需求 C3.1 至 C3.6
  - 对应设计：`design.md` §5.1、§5.11

- [x] 2.3 到点才放行
  - 状态：DONE
  - 完成记录（2026-11-25）：
    - 闸口：`enqueueOutcomeTurn` 在写入待处理记录之后、依赖检查与容量检查之前，若 `scheduledAt` 晚于当前时间就返回 `queued_for_capacity`，意图保持 `processing`。
    - 防饿死：`dispatchQueuedOutcomeWorkItems` 的筛选 SQL 增加 `(scheduledAt IS NULL OR scheduledAt <= now())`，100 个未到点任务排在前面也不会挤掉到点任务。
    - 到点扫描：新增 `dispatchDueScheduledWorkItems`（`packages/messaging`，已导出），只查「已到点、`queued`、有 `processing` 记录」的任务，按 bot 在独立事务里放行；worker 在启动恢复和每分钟的 `dispatchRoutinePass` 里调用（`releaseDueScheduledWork`，紧挨 `dispatchRequestChecks` 与 `recoverRequestProgress`），出错只记日志、不影响同一轮的其他步骤。
    - 日志：每次放行一个带排期的任务，打一行 `outcome.scheduled_release {workItemId, scheduledAt, releasedAt, delaySeconds}`。
    - 取消、已验收、契约被取代：沿用 `enqueueOutcomeTurn` 与 dispatch 查询里原有的判断，各有一个测试。
  - 验证：`outcome-scheduled-dispatch.integration.test.ts` 13 个、`scheduled-release.integration.test.ts`（worker）2 个，均在本机一次性 Postgres 上真实执行。**做了三个变异检查**：去掉闸口（8 个测试变红）、去掉 SQL 排除（1 个变红）、把闸口挪到容量检查之后（1 个变红），每次都已还原。有数据库时 messaging 913、worker 278（3 跳过）、server 1701（19 跳过）、contracts 322 均 0 失败；根目录 `typecheck` 15/15。
  - 没有验证的：①「worker 重启跨过到点时间」只验证了「状态在数据库里、清空内存后扫描仍会放行」，没有真的杀掉并重启一个 worker 进程。②没有在真实 computer 上跑过；本任务不改 `packages/contracts` 的工具、不改 `apps/computer`，不需要同步重建远端 computer。③暂停期间排期任务是否放行（设计 §10.2 第 17 项）还没核对，留给阶段 2 检查点。
  - 重要：本任务让任务 2.2 保存的 `startAt` 真正生效，所以 2.2 与 2.3 现在可以一起发布。
  - 这一步到底做什么：让未到点的 bot 任务不启动，到点后恰好放行一次，停机后能补放行。
  - 做完你能看到什么：排到未来的任务在到点前保持排队，到点后自动开始，且不占并发名额。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 C4.1 至 C4.5、非功能 2
    - `design.md` §5.2「到期放行」
    - `docs/20261124-现状核实记录.md` §2
  - 主要改哪里：
    - `packages/messaging/src/outcome-threads.ts`（`enqueueOutcomeTurn` 闸口、`dispatchQueuedOutcomeWorkItems` 筛选、新增 `dispatchDueScheduledWorkItems`）
    - `apps/worker/src/worker.ts`（启动恢复和 `dispatchRoutinePass`）
    - `packages/messaging/test/`（新增放行测试）
  - 这一步先不做什么：不处理错过计划，不做延后。
  - 怎么算完成：
    1. 未到点的任务不创建运行，也不占名额。
    2. 到点后重复触发调度也只产生一个运行。
    3. 取消、已验收、契约被取代的目标不会放行。
    4. 放行日志包含计划时间、实际时间和延迟秒数。
  - 怎么验证：
    - messaging 集成测试：到点、重启、取消、名额、修订被取代。
  - 对应需求：`requirements.md` 需求 C4.1 至 C4.5、非功能 2.1、2.2、3.3
  - 对应设计：`design.md` §5.2、§8.1、§8.2

- [x] 2.4 错过计划的处理
  - 状态：DONE
  - 完成记录（2026-11-25）：
    - 判断：`enqueueOutcomeTurn` 在依赖和容量检查都满足、马上要启动的那一刻，若任务性质（按 `planKey` 读修订计划里的 `nature`）是 `action`，且放行时间晚于 `scheduledAt` 超过策略 `schedule.graceMinutes`，就不放行：创建一个 `missed_schedule` 决策（选项「Run now」「I will set a new time」，不允许自由文本），任务保持 `queued`、`statusReason = missed_schedule`，启动意图保留。`deliverable` 和没有计划性质的任务照常放行。
    - 只对「排期启动」判断：`reason = start` 且任务仍是 `queued` 时才判断，续跑、重试、决策后恢复不受旧排期影响。
    - 重复扫描：同一任务同一排期时间只会有一个决策（确定性的请求快照作幂等键），扫描不会再弹、也不会启动。
    - 选择：「现在执行」把 `scheduledAt` 置为当前时间、标记 `missed_schedule_confirmed`（之后不再追问，宽限时间为 0 也一样），并用任务一直持有的原始启动意图放行（不是「决策已解决」的消息）；bot 正忙时保持就绪，有空位即启动。「我来改期」只记录选择，任务继续被拦住。任务在决策期间被取消或已启动，则只记录、不启动。
    - 可见性：决策是普通的收件箱决策，出现在收件箱，经 worker 现有的 `reconcileOutcomeInboxNotifications` 送达通知，选择后通知被撤销（均有测试）。
  - 验证：messaging `outcome-missed-schedule.integration.test.ts` 11 个、server `outcome-missed-schedule.integration.test.ts` 9 个，均在本机一次性 Postgres 上真实执行。**做了 7 个变异检查**（去掉启动原因守卫、去掉确认标记、忽略性质、忽略宽限时间；决策效果里不移动时间、不打标记、两个选项都启动），每个都有测试变红，已还原。有数据库时全量：contracts 322、messaging 924、worker 278（3 跳过）、server 1710（19 跳过）、db 50，均 0 失败；根目录 `typecheck` 15/15、`check:architecture` 通过。（第一次全量验证在会话中断时被终止、没有出结果，上面的数字来自重跑。）
  - 没有验证的：①「选『我来改期』之后，所有者改期会关闭决策并清除标记」属于任务 2.6，目前没有任何代码清除 `missed_schedule`；在 2.6 完成前，选了「我来改期」的任务会一直被拦住（这是设计的预期，改期接口在 2.6）。②决策卡片在桌面端的实际显示没有在界面里看过（本任务按边界不改决策界面）。③没有在真实 computer 上跑过，不需要同步重建。
  - 这一步到底做什么：到点后若已晚于宽限时间，`action` 任务不自动执行，改为让所有者决定。
  - 做完你能看到什么：停机后恢复时，对外产生影响的任务不会静默晚执行；你能选择"现在执行"或"等我改期"。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 C4.6、C4.7、C8.5
    - `design.md` §5.3、§10.2 第 12 项
  - 主要改哪里：
    - `packages/messaging/src/outcome-threads.ts`
    - `packages/messaging/src/`（决策创建，沿用 `createOutcomeDecision`）
    - `packages/messaging/test/`
  - 这一步先不做什么：不做改期接口，不改决策界面。
  - 怎么算完成：
    1. `action` 任务晚于宽限时间时创建一个决策，重复扫描不产生第二个。
    2. `deliverable` 和无计划回退任务照常放行。
    3. 选择"现在执行"后放行。
  - 怎么验证：
    - 集成测试覆盖三种性质和两个选项。
  - 对应需求：`requirements.md` 需求 C4.6、C4.7
  - 对应设计：`design.md` §5.3、§8.5

- [ ] 2.5 运行中延后（`DeferWorkItem`）与结算守卫
  - 状态：IN_REVIEW
  - 会话 A 验证（2026-11-25）：在独立的本机 `tov_close` 库重跑延后工具和结算的集成测试，均通过。真实 bot 的续做仍待授权验证，步骤见[远端清单](docs/20261125-远端验证清单.md)。
  - 完成记录（2026-11-25）：
    - 契约：`DeferWorkItemInput`（`resumeAt`、`note` 1 至 2000、可选 `reason` 至 300）、`DEFER_WORK_ITEM_TOOL`（描述里写明「调用后结束本回合，不代表任务完成」，不含业务数值和场景词）、`OUTCOME_THREAD_TOOL_NAMES` 加入 `DeferWorkItem`、错误码 `defer_limit_reached`（409）、审计事件主题 `outcome.schedule.changed` 及载荷。
    - 服务端：`createDeferWorkItemTool`。校验顺序为参数格式、`resumeAt` 是否真实带偏移的时间、回合上下文（与 `ReportOutcomeProgress` 相同的 409 `tool_context_invalid` 规则）、是否在未来、是否超过策略 `schedule.deferMaxDays`（400 `invalid_schedule`）、是否已达策略 `schedule.deferMaxCount`（409 `defer_limit_reached`）。同一事务内先拿目标锁再拿任务锁，设置 `scheduledAt` 与 `deferCount`，`running → queued`（原因 `deferred_by_agent`），保留以续做说明为内容、原因为 `resume_scheduled`、`clientId = defer:<任务>:<次数>` 的待处理启动意图，写入 `outcome.schedule.changed`（来源 `agent_defer`，含旧值与原因）。任何拒绝都不改变任何东西。
    - 结算守卫：`settleOutcomeWorkItem` 对「`queued` 且原因为 `deferred_by_agent`」的任务提前返回，不会把它结算为完成、失败或待审查，也不记录结果产物。
    - 恢复守卫（规格没写，见 D2-16）：恢复流程对已延后的任务提前返回，避免延后的那一轮被中断后被当成「被中断的任务」立刻续跑。
    - computer：`DeferWorkItem` 登记到线程工具注册表，只在 Outcome 任务自己的回合里出现。
  - 验证：messaging `outcome-defer.integration.test.ts` 7 个、server `outcome-defer-tool.integration.test.ts` 13 个（均在本机一次性 Postgres 上真实执行）、computer 新增 1 个、contracts 新增 6 个。**变异检查共 11 个**（结算守卫三种写法、恢复跳过、处理器的次数限制 / 天数限制 / 请求与上下文的 runId 一致 / 错误被吞掉、工具被误开放到所有回合），每个都有测试变红，已还原。全量（有数据库）：contracts 328、messaging 931、worker 278（3 跳过）、server 1723（19 跳过）、computer 1392（73 跳过），均 0 失败；根目录 `typecheck` 15/15、`check:architecture` 通过。
  - **没有验证（所以不是 DONE）：** 真实延后与续做的端到端，需要把 `packages/contracts` 与 `apps/computer` 的改动同步到远端 computer 并重建，会中断运行中的 bot 任务，**必须先征得所有者同意，尚未请求**。在那之前，`DeferWorkItem` 在真实 bot 里不可用（远端 computer 还是旧版本，看不到这个工具）。
  - **发现一个已有缺陷（不属于本任务，未修改）：** `apps/server/src/services/outcome-progress-tool.ts` 第 135 行 `catch` 里写的是 `mapOutcomeError(error);` 而不是 `throw mapOutcomeError(error);`（同目录其他 6 处都有 `throw`）。后果：`ReportOutcomeProgress` 在事务里出任何错误，包括它自己抛的 `ApiError`（如 `tool_context_invalid`），都会被吞掉，函数返回 `undefined`，bot 会以为调用成功。我的处理器写了 `throw`，并用变异检查（去掉 `throw` 后 8 个测试变红）证实这个写法确实有区别。是否修复需要所有者决定，修复本身一行。
  - 这一步到底做什么：新增线程工具让运行中的任务约定未来某个时间继续，并让结算逻辑不再把它误判为完成。
  - 做完你能看到什么：执行中的 bot 发现现在做不完，可以约定某时间继续；回合结束后任务仍在排队，到点带着续做说明重新开始。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 C5
    - `design.md` §5.4、§5.11、§8.3
    - `apps/server/src/services/outcome-progress-tool.ts`（同类工具的写法）
  - 主要改哪里：
    - `packages/contracts/src/outcomes.ts`（`OUTCOME_THREAD_TOOL_NAMES`）、新工具的输入定义
    - `apps/server/src/services/`（新工具处理）、`internal-tool-service.ts`、`outcome-thread-tools.ts`
    - `packages/messaging/src/outcome-threads.ts`（`settleOutcomeWorkItem` 提前返回条件）
    - `apps/computer/src/runtime/tools.ts`
  - 这一步先不做什么：不在本任务里重建远端 computer；重建单独征得用户同意。
  - 怎么算完成：
    1. 延后成功后任务为 `queued`，`scheduledAt` 为 `resumeAt`，续做说明保存。
    2. 回合结算后任务不变为 `completed`、`failed` 或 `needs_review`。
    3. `resumeAt` 不在未来、超过策略 `schedule.deferMaxDays`、已达策略 `schedule.deferMaxCount`、调用方不是当前运行回合，都被拒绝。
    4. 延后写入审计事件。
  - 怎么验证：
    - 线程工具集成测试和结算守卫测试；真实延后与续做的端到端验证需要重建远端 computer，征得用户同意后进行。
  - 对应需求：`requirements.md` 需求 C5.1 至 C5.7
  - 对应设计：`design.md` §5.4、§5.11、§8.3

- [x] 2.6 所有者改期、目标截止日与事件
  - 状态：DONE
  - 完成记录（2026-11-25）：
    - 接口：`PUT /api/v0/outcomes/:id/work-items/:workItemId/schedule`（`scheduledAt`、`dueAt`、`estimateMinutes`，缺省为不变，`null` 为清除）与 `PUT /api/v0/outcomes/:id/due`，均带 `clientRequestId` 做幂等；错误 `invalid_schedule`（400）、`schedule_not_editable`（409）、`outcome_not_open`（409）。
    - 规则：只允许未开始的任务（bot 任务要求 `queued` 且没有活跃运行；人工任务要求未提交）；已验收或已取消的目标拒绝；目标截止日可设为过去（只是逾期）；对 tracked 目标同样可用；不改契约、哈希或批准状态；每次修改写 `outcome.schedule.changed`（来源 `owner`，含旧值）；设置成与当前相同的值不写事件。
    - 放行：移动一个被持有的 bot 任务时，用同样的内容和原因、新的请求 ID 重建它持有的启动意图（延后任务的续做说明不会丢）；改到已过去的时间则立即放行且恰好一次，并带确认标记，不会被判成「错过计划」；清除时间也立即放行。
    - 错过计划：任务正等所有者表态时改期，会撤回未决决策并清除标记（改到未来则回到正常排期）。
    - 重规划（解决原 D2-7）：规划角色传回的计划与它上次看到的已保存计划比较，只写它真正改过的字段。
  - 验证：server `outcome-schedule-service.integration.test.ts` 23 个、`outcome-routes.test.ts` +1、`outcome-stage3.test.ts` +3、contracts +4，均真实执行（数据库）。**变异检查 8 个**（可编辑检查、关闭决策、重建意图、过去时间确认标记、重建丢内容；重规划的三种写法），每个都有测试变红，已还原。全量（有数据库）：contracts 332、messaging 931、server 1750（19 跳过），均 0 失败；根目录 `typecheck` 15/15、`check:architecture` 通过。
  - 没有验证的：桌面端界面（任务 3.2 才做）。路径是 `/api/v0/outcomes/...`（设计里的 `/api/v0/outcomes/:outcomeId/work-items/:workItemId/schedule` 一致）。
  - 有一处行为需要你知道：所有者把一个**已有未决「错过计划」决策**的任务改到未来，决策会被撤回（状态 `withdrawn`），不是「已解决」。
  - 这一步到底做什么：提供修改未开始任务排期和目标截止日的接口，并新增 `outcome.schedule.changed` 事件。
  - 做完你能看到什么：可以通过接口改期和设截止日，契约不受影响，每次修改都有审计记录。
  - 先依赖什么：2.1、2.3
  - 开始前先看：
    - `requirements.md` 需求 C7、C8
    - `design.md` §5.5、§5.10「事件」、§5.11、§8.4
  - 主要改哪里：
    - `apps/server/src/services/`（新增 `OutcomeScheduleService`）、`apps/server/src/routes/outcome.ts`
    - `packages/contracts/src/outcomes.ts`（事件主题与载荷）
    - `apps/server/src/services/outcome-event-retention.ts`（核对新主题的留存归类）
  - 这一步先不做什么：不做界面，不回写计划 JSON。
  - 怎么算完成：
    1. 改期和设截止日后契约内容哈希不变，没有重新批准。
    2. 已开始的任务、已验收的目标被拒绝。
    3. 重复请求通过 `clientRequestId` 幂等。
    4. 改期到未来会关闭错过计划的决策。
  - 怎么验证：
    - 服务端集成测试。
  - 对应需求：`requirements.md` 需求 C7.1 至 C7.5、C8.1 至 C8.5
  - 对应设计：`design.md` §5.5、§5.11

- [ ] 2.7 人工任务日期
  - 状态：IN_REVIEW
  - 会话 A 验证（2026-11-25）：本机 Chromium 的实际动作卡显示预约、截止、逾期文字及图标，中英文及深浅主题通过。目标详情时间线可修改未开始的人工任务日期，离线夹具读回成功。真实桌面端 `PUT` 及服务端审计联动待 3.2 的真实链路验收。
  - 完成记录（2026-11-25）：
    - 契约：`RequestHumanAction`（`humanActionInputSchema`，仍是严格模式）和 agent 看到的工具 schema 增加可选的 `scheduledAt`、`dueAt`（描述写明「预约只提示、不阻塞」「截止只用于标逾期、不会停止任何事」）；`HumanWorkItemView` 增加可选的 `scheduledAt`、`dueAt`、`overdue`（旧服务端缺失按「无」处理）。
    - 服务端：`createCard` 在写入前用 `validatePlanSchedule` 校验（400 `invalid_schedule`，整体拒绝、不创建任何东西），通过后写到任务行；日期不进动作卡自己的记录；任务状态流转完全不看日期。逾期由共享的 `isWorkItemOverdue` 在读取时推导，不存储：有截止且已过、且尚未提交回执才为真，没有截止永不逾期，只有预约时间永不逾期。
    - 桌面端：新增 `HumanTaskDates`（预约时间、截止、「已逾期」用文字加图标表达），接进动作卡标题下方；新增 3 条中英文文案。
  - 验证：server `human-work-service.test.ts` +11（数据库）、桌面端 `human-task-dates.test.tsx` 8 个（含动作卡整体渲染）、contracts +3。**变异检查 4 个**（不写入日期、不校验、逾期忽略回执状态、预约时间被当成截止），每个都有测试变红。全量：contracts 335、messaging 931、server 1761（19 跳过）、desktop 1094（2 跳过）均 0 失败；根目录 `typecheck` 15/15、`check:architecture` 与 `check:i18n` 通过。
  - **没有做 / 没有验证：**
    1. **任务 2.7 的第三条做法「日期可由所有者在界面修改」没有界面。** 后端接口在 2.6 已支持人工任务改期，但动作卡里没有改期入口，桌面端界面改期放在 3.2（时间线行菜单）。所以这里是 IN_REVIEW，不是 DONE。
    2. **决策选项里的 `manualAction` 不带日期**（规格 C6.1 只写了 `RequestHumanAction`）。agent 通过决策提议的人工任务，日期会被静默丢弃（不报错），已用测试固定这一行为，见 D2-22。
    3. 动作卡的实际界面没在真实窗口里看过，只有静态渲染断言。
  - 这一步到底做什么：让人工任务可带预约时间和截止，并可由所有者修改。
  - 做完你能看到什么：动作卡里能看到日期；日期不阻塞流程；逾期的人工任务被标出。
  - 先依赖什么：2.1、2.6
  - 开始前先看：
    - `requirements.md` 需求 C6
    - `design.md` §5.11
    - `specs/004.4-现实任务与知识资料闭环/requirements.md`
  - 主要改哪里：
    - `packages/contracts/src/human-work.ts`
    - `apps/server/src/services/human-action-tool.ts`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/human-work/human-action.tsx`
  - 这一步先不做什么：不做移动端回执，不做提醒推送。
  - 怎么算完成：
    1. `RequestHumanAction` 可带 `scheduledAt`、`dueAt` 并保存。
    2. 日期不影响人工任务的状态流转。
    3. 过了截止时间且未提交回执的任务读时标为逾期。
  - 怎么验证：
    - `human-work.test.ts` 扩展；人工任务集成测试。
  - 对应需求：`requirements.md` 需求 C6.1 至 C6.4
  - 对应设计：`design.md` §5.10、§5.11

- [ ] 2.8 规划角色排期指导
  - 状态：IN_REVIEW
  - 会话 A 验证（2026-11-25）：`outcome-thread-context.test.ts` 重跑通过。真实规划回合、实际 `SavePlan` 与到点放行待验收，见[远端清单](docs/20261125-远端验证清单.md)。
  - 完成记录（2026-11-25）：
    - 规划线程（`plan / replan / owner_message`）的提示词新增一行排期指导：只在任务不能或不应更早开始时给 `startAt`（等外部日期、需要间隔、后续复查），只在有把握时给 `estimateMinutes`，拿不准就不填、多数任务两者都不需要；过去的 `startAt` 只表示已到点，重规划可原样回传；不为目标设截止日，只在 `SavePlan.notes` 里建议。审查线程和任务执行线程没有这一行。
    - `SavePlan` 的工具描述补充了三个可选字段的含义（输入 schema 在 2.2 已含这三个字段）。
    - 没有碰基础提示词：七个变体（开启 27,328、关闭 22,473、规划角色 27,545、直接文本 25,797 / 20,942、非技能化 31,320 / 26,465）与阶段 0 基线逐项相同，所以不影响前缀缓存。
  - 验证：messaging `outcome-thread-context.test.ts` +5、contracts +1；**变异检查 3 个**（整行删除、去掉「拿不准就不填」、改成让规划角色设置目标截止日），每个都有测试变红，已还原。全量（有数据库）：contracts 336、messaging 936、computer 1392（73 跳过）均 0 失败；根目录 `typecheck` 15/15、`check:architecture` 通过。
  - **没有验证（所以不是 DONE）：**「用真实规划回合抽查输出」，即规划角色在真实模型下是否真的按指导只在必要时排期、而不是给每个任务编日期。这需要真实对话，**尚未取得同意**。提示词和工具描述只在远端 computer 同步重建后才会在真实 bot 里生效（提示词在 `packages/messaging`，由服务端使用，工具描述在 `packages/contracts`，由 computer 读取）。
  - 这一步到底做什么：在规划角色提示词里补一小段排期指导，说明什么时候给 `startAt`、什么时候给估时。
  - 做完你能看到什么：规划角色只在确实需要时排期，不给每个任务都编日期。
  - 先依赖什么：2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 C3.7
    - `design.md` §5.1 第 6 步
  - 主要改哪里：
    - `packages/messaging/src/outcome-threads.ts`（规划角色提示词）
    - `packages/messaging/test/`（提示词相关测试）
  - 这一步先不做什么：不改普通 bot 的基础提示词（避免影响缓存）。
  - 怎么算完成：
    1. 提示词包含排期指导，新增篇幅尽量短。
    2. 相关提示词测试和基线保持通过或按需更新。
  - 怎么验证：
    - 提示词测试；用真实规划回合抽查输出。
  - 对应需求：`requirements.md` 需求 C3.7
  - 对应设计：`design.md` §5.1

- [x] 2.9 目标管理设置页（骨架、总开关、规划与审查、排期与延后）
  - 状态：DONE
  - 会话 A 验证（2026-11-25）：离线 Chromium 中英文和深浅主题通过。实际设置面板显示导航顺序、排期锚点滚动高亮。回车及失焦分别保存策略，规划与审查机器人和两个独立模型各自保存。总开关关闭后，Tab 与程序聚焦均无法进入禁用组。真实调试服务复核步骤见[远端清单](docs/20261125-远端验证清单.md)。
  - 完成记录（2026-11-25）：
    - 设置导航新增"目标管理"页，位于"模型"与"语音消息"之间，其余页面顺序不变（导航表抽到 `settings/navigation.ts`，由测试固定顺序）。没有命令面板入口，`search.test.ts` 保持通过。
    - 页内分组：总开关、规划与审查（原弹窗内容改为页内分组，去掉弹窗标题和自带滚动）、排期与延后（三项策略）。其余分组（活动、待办、自动接受规则、日历）在 `GOAL_SETTINGS_GROUPS` 里登记为 `available: false`，所以现在不显示、没有空壳，对应阶段把它翻成 `true` 即可。
    - 策略项全部由 `TASK_POLICY_FIELDS` 元数据渲染：单位、允许范围、初始值、"恢复初始值"（保存 `null`，由服务端还原）都来自元数据；界面代码里没有业务数值（文案模块 `goal-policy-copy.ts` 对元数据的键做穷尽匹配，新增键漏写文案会是类型错误）。"允许：…"一行只写格式，不举数值示例。
    - 每一项单独保存；越界、非整数、空值在页内拦下并显示允许范围；保存失败恢复旧值并给出原因。初始为"不限制"的字段（待办分组里有三项）显示"不限制"，清空已存值即恢复。
    - 总开关关闭时，其余分组可见但整体禁用（`fieldset disabled`），并说明"开启后才能修改"。
    - "通用"页只留一行"目标管理 → 打开"，只发出设置深链接事件，没有开关和弹窗；`streamBotReplies` 和悬浮窗设置原样留在"通用"页。
    - 深链接：新增 7 个锚点（`goal-management`、`goal-roles`、`goal-schedule`、`goal-activity`、`goal-todo`、`goal-auto-accept`、`goal-calendar`），都打开该页；面板按 `data-settings-anchor` 定位分组，设置面板已打开时同样能切页。
  - 验证：桌面端新增测试文件 6 个（导航顺序、元数据渲染、范围校验、恢复初始值、总开关禁用、深链接与跳转行、文案模块穷尽性）；`app-deep-links.test.ts` 扩展。桌面端全量 1141 通过、2 跳过、0 失败；contracts 336 通过；`tsc`、`check:i18n`、`check:architecture` 通过。
  - 原始验证范围（会话 A 之前）：
    1. **没有在真实界面里走查**：布局、禁用态的视觉、分组定位滚动、深色模式。测试用的是 linkedom 的 DOM 替身，它没有 `KeyboardEvent`、`FocusEvent`，所以"按回车保存"和"离开输入框保存"两条路径没有被测试执行过，测试只覆盖了"保存"按钮。
    2. **规划与审查分组只做了静态渲染**（整页的页面测试会渲染到它，但不运行 effect、不做交互），其中规划、审查机器人和模型选择器的保存逻辑是原弹窗的代码原样搬来、没有改动，也没有交互测试。
    3. "总开关关闭 → 其余分组禁用"只验证了标记（`fieldset disabled` 和 `data-goals-disabled`），没有在真实键盘操作下验证控件确实不可聚焦。
  - 这一步到底做什么：在桌面端设置里新增独立的"目标管理"页，位于"模型"和"语音消息"之间；把总开关和规划、审查设置从"通用"页搬过来；加入按元数据渲染的策略分组，先放排期与延后三项。
  - 做完你能看到什么：设置里多出"目标管理"一页，所有目标管理相关的设置都在这里；"通用"页只剩一行跳转入口，没有可编辑的重复项。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 E1 至 E3
    - `design.md` §2.7、§2.6
    - `apps/desktop/src/renderer/components/outcomego/settings/panel.tsx`、`general.tsx`、`outcome-role-settings.tsx`
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/settings/panel.tsx`（导航、加载器、组件登记）
    - `apps/desktop/src/renderer/components/outcomego/settings/goals.tsx`（新）、`outcome-role-settings.tsx`（弹窗内容改为页内分组）、`general.tsx`（目标管理行改为只跳转的入口，移除开关和弹窗）
    - `packages/contracts/src/task-policy.ts`（`TASK_POLICY_FIELDS` 元数据）、`packages/contracts/src/app-deep-links.ts`、`apps/desktop/src/renderer/lib/app-deep-links.ts`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不做活动、待办、自动接受规则、日历分组（随各自阶段加入）；不加命令面板入口；不做移动端；不改 `streamBotReplies` 和悬浮窗设置，它们留在"通用"页。
  - 怎么算完成：
    1. 导航顺序为"……模型、目标管理、语音消息……"，其余页面顺序不变。
    2. 总开关和规划、审查设置的行为与原来一致，只是位置变了；"通用"页里只保留一行只跳转、不可编辑的入口，点击后打开目标管理页（复用设置深链接事件，设置面板已打开时也能切页）。
    3. 策略项由元数据渲染，界面代码里没有数值；每项显示单位、范围、初始值和"恢复初始值"。
    4. 新增的深链接锚点能打开该页并定位到对应分组。
    5. 总开关关闭时其余分组可见但禁用，并说明开启后生效（设计 §10.2 第 22 项已确认）。
    6. i18n 目录检查脚本通过。
  - 怎么验证：
    - 组件测试（导航顺序、元数据渲染、范围校验、恢复初始值）；`apps/desktop/test/app-deep-links.test.ts` 扩展；人工走查。
  - 对应需求：`requirements.md` 需求 E1、E3、E2.1 至 E2.3、D3
  - 对应设计：`design.md` §2.7、§2.6、§8.18

### 阶段检查

- [ ] 2.10 阶段 2 检查点
  - 状态：IN_REVIEW
  - 会话 A 准备（2026-11-25）：本机 `tov_close` 上与阶段 2 相关的排期、错过计划、延后集成测试通过，设置页的本机走查见 2.9。真实规划、延后和到点放行见[远端清单](docs/20261125-远端验证清单.md)。
  - 完成记录（2026-11-25）：
    - **设计 §8.1 至 §8.5 的属性都有测试对应**（逐条核对过测试名和断言，不是只看文件名）：8.1 未到点不启动、不占名额（`outcome-scheduled-dispatch`：不启动、两个名额保持空闲、不取容量锁、100 个未到点任务不饿死）；8.2 恰好一次（同文件：重复放行 3 次、并发两次、停机跨过到点时刻）；8.3 延后不误判完成（`outcome-defer`）；8.4 改期不改契约（`outcome-schedule-service`：内容哈希、状态、批准时间不变）；8.5 `action` 不静默晚执行（`outcome-missed-schedule`：一次决策、不重复、续跑不误判、「现在执行」后不再追问）。
    - **暂停（设计 §10.2 第 17 项）已核对：现状没有可暂停的目标**，结论见偏差记录 D2-28。
    - **检查点中发现并修复一个缺陷（D2-29）：** 到点扫描 `dispatchDueScheduledWorkItems` 原先按任务行 `LIMIT 100`，而「已到点但被容量、依赖或所有者决策挡住」的任务不会离开结果集，积累到 100 行就会让别的 bot 的可放行任务永远排不进去。已改为按 bot 去重选取，并用先红后绿的测试固定（105 个被挡住的任务 + 另一个 bot 的到点任务）。
    - 目标管理设置页（2.9）已完成，「通用」页只剩一行跳转入口。
  - 验证（全部有数据库，本机一次性 Postgres）：根目录 `typecheck` 15/15、`check:architecture` 通过；contracts 336、messaging 937、server 1761（19 跳过）、worker 278（3 跳过）、db 50、computer 1392（73 跳过）、desktop 1189（2 跳过），**均为 0 失败**。db 那一项在扫描修复之前跑过，该修复不涉及 db 包。
  - **没有验证（所以不是 DONE）：**
    1. **没有在真实环境里验证排期**：规划角色是否真的会给出 `startAt`、`DeferWorkItem` 在真实运行里是否按预期、真实 bot 到点是否被放行。这些依赖远端 computer 同步重建（改了 `packages/contracts` 和 `packages/messaging` 的提示词与工具描述），**尚未取得同意**，也没有发起真实对话。
    2. 设置页（2.9）没有在真实界面里走查。
    3. 单个 worker 测试文件 `task-continuation` 要几分钟，整个 worker 套件约 6 分钟（354 秒），这是原有行为；只是跑它们时不要给太短的限时。
  - 这一步到底做什么：确认排期和到点放行站稳，再进入时间线 v2。
  - 做完你能看到什么：未到点不启动、到点一次、停机后补放行、`action` 不静默晚执行、延后不被误判完成。
  - 先依赖什么：2.1 至 2.9
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 设计 §8.1 至 §8.5 的属性都有测试覆盖。
    2. 现有目标、计划、状态派生和审批测试保持通过。
    3. 暂停期间排期任务是否放行（设计 §10.2 第 17 项）已核对并有结论。
    4. 目标管理设置页（任务 2.9）已上线，"通用"页只有一行跳转入口，没有可编辑的重复项。
  - 怎么验证：
    - 集成测试和人工走查。
  - 对应需求：`requirements.md` 需求 C3 至 C8
  - 对应设计：`design.md` §5.1 至 §5.5、§8.1 至 §8.5

---

## 阶段 3：时间线 v2（计划与估算）

- [x] 3.1 计划条、估算条、截止旗标与逾期标记
  - 状态：DONE
  - 会话 A 验证（2026-11-25）：本机 Chromium 用实际详情组件和离线夹具验证中英文、深浅主题、窄窗口滚动、估算与实际条同轨以及终点旗标。修复估算标签被实际条覆盖、状态配色未继承与延后文字遮挡排期标记的问题。轴补充实现见 [close-1](docs/20261125-偏差记录-close.md)。已有逾期、无截止及无预测测试通过。
  - 完成记录（2026-11-25）：
    - 时间线行新增：**计划标记**（任务有 `scheduledAt` 且还没跑过或被延后时，在该时间画实线轮廓的标记，人工任务为菱形）、**估算条**（虚线轮廓并写"估算"，从计划时间或真实开始起算，长度恰为估时，已结束的任务不画；没有锚点时不画、不编日期，只在列表里写估时）、**任务截止刻线**、**逾期标记**（图标加文字，没有 `dueAt` 的任务永不逾期，已结束的不逾期，估时用完也不算逾期）。
    - 目标详情把目标截止日接进时间线：终点旗标、贯穿的刻线、列表上方一行"目标截止 …"；已过截止且目标未结束时标"逾期"。目标是否结束取契约里的 `OUTCOME_TERMINAL_STATUSES`。
    - 轴现在总是包含"现在"，并扩展到计划时间、估算末端和各截止时间之外；仅有目标截止日也能画出旗标和今天线；完全没有时间信息时仍然没有轴、不编日期。
    - 等价列表新增三列：计划时间、估算、截止（逾期处同样写文字）；旧服务端不报时间时显示"—"，不会误写成"未安排"。估时按能精确表达的单位写（整天、半小时的倍数、分钟），不四舍五入成另一个数字。
    - 契约包新导出 `isWorkItemFinished`（原先是 `isWorkItemOverdue` 里私有的判断），时间线与逾期共用，不另抄状态集合。
  - 验证：布局测试与组件测试共新增 48 个（每条规则用两组不同夹具；估算虚线、实线计划标记、没有"预测""关键路径"字样都有断言），桌面端全量 1189 通过、0 失败；`tsc`、`check:i18n`、`check:architecture` 通过。**变异检查 3 个**（给已结束任务画估算条、逾期不看有无截止时间、把估算条改成实线），每个都有测试变红，已还原。
  - 原始验证范围（会话 A 之前）：条的对齐与重叠、旗标边缘、深色和窄窗口只有静态 HTML 与样式文本检查。
  - 这一步到底做什么：在时间线上加上计划条、虚线估算条、目标截止旗标，并标出逾期。
  - 做完你能看到什么：排到未来的任务在它的计划时间处有条；估算与实际样式明显不同；目标终点有旗标。
  - 先依赖什么：2.10
  - 开始前先看：
    - `requirements.md` 需求 C1.5、C9
    - `design.md` §5.6 第 2、5、9 步
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/outcomes/timeline/`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不画预测完成日期，不做关键路径。
  - 怎么算完成：
    1. 估算条是虚线并标注"估算"。
    2. 没有 `dueAt` 的任务不显示逾期。
    3. 等价列表视图同步包含新信息。
  - 怎么验证：
    - 组件测试；人工走查。
  - 对应需求：`requirements.md` 需求 C1.5、C9.1 至 C9.4
  - 对应设计：`design.md` §5.6

- [ ] 3.2 改期界面与目标截止日设置
  - 状态：IN_REVIEW
  - 会话 A 验证（2026-11-25）：离线 Chromium 用键盘打开改期，在其后的 Tab 进入日期输入。430 px 窗口表单换行，人工任务预约、目标截止日均经替身提交，拒绝原因留在表单。Electron 原生弹出的选择器、对真实调试服务的 `PUT` 及跨窗口事件尚待验收。
  - 完成记录（2026-11-25）：
    - **任务改期：** 等价列表每行新增"改期"按钮（带任务名的无障碍标签），点开后行内展开表单：计划时间、截止、估算（分钟）。表单只发送改过的字段，清空表示清除（`null`）；不是时间或超出契约范围的估时在表单里拦下并标出；服务端拒绝时就地显示原因，已输入的内容保留。
    - **只有未开始的任务有入口：** bot 任务看 `status === "queued"`，人工任务看"回执未交"（契约新增 `isWorkItemScheduleEditable`，只是界面预判，最终由服务端裁决）；其余行显示"已开始或已结束，不能改期"。队列中但回合已在运行的任务界面会给入口，服务端回 409 后表单里显示原因。
    - **目标截止日：** 目标详情头部新增"截止日"一行，可设置、修改、清除；已验收或取消的目标只显示日期、没有控件。
    - **接口：** `OutcomeClient` 新增 `setWorkItemSchedule`、`setDue`（两个 `PUT`，沿用现有请求 ID 去重）；失败交还给表单而不是页面顶部的错误条，409 时刷新目标。
    - **刷新：** 客户端事件流不含 `outcome.*` 主题（`snapshot-service` 明确排除），所以新增目标级轻量事件 `goal.schedule.changed`（只带目标 ID），在所有者改期、改截止日、bot 延后三处写入；桌面端据此刷新打开着的目标，client-core 不因它整体刷新。
  - 验证：桌面端新增 33 个测试（表单逻辑 16、客户端路径 2、界面 14、事件 1），server 新增 3 个（改期、改截止日、延后各一个，含"重放、无变化、被拒绝都不发事件"），contracts +3，client-core +2。**变异检查 4 个**（入口对所有任务开放、全发而不只发改动字段、吞掉服务端原因、已结束目标仍显示控件），每个都有测试变红，已还原。全量（有数据库）：server 1764、messaging 937、desktop 1222（2 跳过）、contracts 339、client-core 96，均 0 失败；`typecheck` 15/15、`check:i18n`、`check:architecture` 通过。
  - **没有验证（所以不是 DONE）：** 没有在真实界面里操作：`datetime-local` 在 Electron 里的选择器体验、键盘走查（Tab 顺序、表单打开后的焦点）、窄窗口下表单换行；也没有用真实桌面端对真实服务端发过一次 `PUT`（路径、方法与 2.6 的路由测试逐字对照过，传输层沿用现有 `request`，`PUT` 已在 CORS 放行且别处在用，但没有端到端跑通）。
  - 这一步到底做什么：在时间线行菜单里用日期时间选择器修改未开始任务的排期，并在目标详情里设置截止日。
  - 做完你能看到什么：不用重新规划，就能把一个还没开始的任务挪到别的时间。
  - 先依赖什么：2.6、3.1
  - 开始前先看：
    - `requirements.md` 需求 C7、C8
    - `design.md` §5.5、§5.6 第 10 步
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/outcomes/timeline/`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/detail/outcome-detail.tsx`
  - 这一步先不做什么：不做拖动改期，避免误操作。
  - 怎么算完成：
    1. 已开始的任务没有改期入口，并说明原因。
    2. 改期失败时显示服务端给出的原因。
    3. 修改后时间线通过事件刷新。
  - 怎么验证：
    - 组件与交互测试；人工走查。
  - 对应需求：`requirements.md` 需求 C7、C8
  - 对应设计：`design.md` §5.5、§5.6

### 阶段检查

- [ ] 3.3 阶段 3 检查点
  - 状态：IN_REVIEW
  - 会话 A 准备（2026-11-25）：离线 Chromium 对照首尾折线和任务轨道中心、今天线和轨道区顶端、右边距的旗标、估算标签及窄窗口。§5.6 第 6 步轴功能另有独立提交。真实桌面验收由复核者执行。
  - 完成记录（2026-11-25）：逐条核对需求 C1、C8、C9 的验收标准。**发现并修复一处缺口：** 1.3 在布局里算了依赖连线（`layout.links`），但组件从来没把它画出来，C1.1 要求的"依赖连线"并没有实现，而 1.3 的记录写成了已完成。现已补上：任务行外包一层容器，叠一层只对辅助技术隐藏的 SVG，每条依赖一条折线，从前驱结束处到后继开始处（后继没有任何时间、或前驱还在运行时不画）；行距由 `gap` 改成行内 `padding`，使行号与纵向位置成线性关系。同时图表每行补上状态图标和"任务 · 负责方 · 状态"的提示（C1.1 要求行内含负责方和状态）。
    - C1.1 行含名称、负责方、状态、起止条、依赖连线：**现已满足**（图表行：名称加图标加提示；列表：全部文字列）。C1.2 实心实际条、运行中画到现在：1.3。C1.3 延后分段、空档、"延后至"：1.3。C1.4 未排期区与等待对象：1.3。C1.5 目标终点旗标、今天线、逾期突出：3.1。C1.6 等价列表、状态用文字加图标加颜色：1.4 与 3.1。C1.7 单任务和旧数据不报错：1.3。
    - C8.1 改期写审计且不改契约：2.6 加 3.2；C8.2 已开始返回 409 `schedule_not_editable`，界面无入口并说明：2.6 加 3.2；C8.3 改到过去视为立即可放行：2.6；C8.4 请求幂等：2.6，界面重试沿用同一请求 ID；C8.5 错过计划的任务改期到未来关闭决策：2.6。
    - C9.1 估算条虚线并标"估算"：3.1；C9.2 没有 `dueAt` 永不逾期：3.1；C9.3 不预测、不画关键路径、不自动重排：3.1（有断言）；C9.4 数据缺失显示"未排期"：3.1 与 1.3。
  - 验证：桌面端新增 6 个测试（依赖连线的位置与数量、对辅助技术隐藏、行内负责方与状态）；桌面端 1228 通过（2 跳过）、0 失败。检查点的其余验证（全量测试、类型检查、架构检查）同 3.2。
  - **没有验证（所以不是 DONE）：** 没有在真实界面里看过时间线，这是三项最大的未知：(1) 依赖折线的纵向位置依赖"每一行等高"的假设（轨道 1rem 加固定内边距），行内出现换行或更高的元素时线会偏；(2) 估算条与实际条在同一轨道叠放、旗标标签在右边缘、今天线的起点（`top: 1.25rem` 是按旧的行距估的，行距改成 `padding` 后可能差几个像素）；(3) 深色模式配色与窄窗口。"人工走查"是本检查点规定的验证方式，**尚未做**。
    - 已知缺口（不影响验收标准，记入偏差记录 D3-3）：设计 §5.6 第 6 步的轴刻度、水平滚动、"回到今天"按钮。
  - 这一步到底做什么：确认目标详情里的时间线完整可用。
  - 做完你能看到什么：目标详情时间线满足需求 C1、C8、C9。
  - 先依赖什么：3.1、3.2
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 需求 C1、C8、C9 的验收标准逐条通过。
    2. 已知缺口记入 `docs/`。
  - 怎么验证：
    - 人工走查和相关测试。
  - 对应需求：`requirements.md` 需求 C1、C8、C9
  - 对应设计：`design.md` §5.6

---

## 阶段 4：活动视图与"需要我"

- [x] 4.1 请求进展的所有者视图与活动查询
  - 状态：DONE
  - 完成记录（2026-11-25）：
    - 契约：`RequestProgressView`、`RequestProgressDetailView`、`ActivityResponse`，以及两个格式与规模上限常量 `ACTIVITY_TITLE_LIMIT`（120）和 `ACTIVITY_LIST_LIMIT`（200）。
    - 服务：`ActivityService.list` 返回所有 bot 的未结束请求，来源不在 `INDEPENDENT_RUN_ORIGINS`（从 `request-progress.ts` 导出，不再各处另写一份 `["routine","outcome"]`）、`requestStoppedAt` 为空、`requestProgress` 非空；标题取所有者原始消息的前 120 字符（沿用 `messagePreviewText`），标题一次查询批量取；展示状态直接用 1.2 的 `deriveRequestDisplayState`，`checkOverdueMinutes` 与 `recentCompletedHours` 都读策略设置，没有写死数值；已完成的请求只在"最近完成"窗口内显示，未完成的无论多久都显示，`includeAll` 取消窗口限制；最多 200 条，超出时 `truncated` 为真；按最近活动倒序。`requestDetail` 返回单个请求，才带 `evidence`、`toolError`。
    - 接口：`GET /api/v0/activity`（`botId`、`includeAll`、`recentHours`，窗口范围取自策略元数据，不另写数值）、`GET /api/v0/activity/requests/:requestRunId`；都只读、仅已登录的所有者、`no-store`，不暴露给任何 bot 工具。
    - 性能抽查：本机 Postgres（Docker，单连接）上，3 万行普通运行加 200 条未结束请求，查询中位数 11 毫秒（最差 16 毫秒）；15 万行时中位数 10.6 毫秒（最差 18.6 毫秒），指标是 p95 小于 500 毫秒。**没有加部分索引**：加了也只是 5 至 7 毫秒，却要给 `Run` 这张热表增加写入成本，而且迁移无法在 schema 里表达（仓库里也没有部分索引的先例）。
  - 验证：server 新增 19 个测试（服务 14 个：标题截断、列表不含证据与工具错误、跨 bot、过滤已停止与独立来源、各展示状态、策略读取、最近完成窗口、排序、200 条上限；路由 5 个：鉴权、只认 GET、查询解析、详情 404 与 400）；**变异检查 4 个**（含已停止请求、含独立来源、列表泄露证据、最近完成窗口写死 24 小时），每个都有测试变红，已还原。
  - 局限：去掉 `take` 上限的变异**没有**被测试发现（截断逻辑本身还会切片，行为一致，只是多读数据），所以 `take` 是性能边界而不是被测试固定的行为。性能数字来自本机一次测量，不是生产环境。
  - 这一步到底做什么：新增只读的所有者视图和全局活动查询，把所有 bot 的未结束请求按展示状态返回，列表不含证据。
  - 做完你能看到什么：一个接口返回所有 bot 当前在做的请求；详情接口才返回证据和工具错误。
  - 先依赖什么：0.4、1.2
  - 开始前先看：
    - `requirements.md` 需求 A1、A2
    - `design.md` §3.1、§3.2、§3.8
    - `apps/server/src/services/snapshot/views.ts`（现有的两个公开字段）
  - 主要改哪里：
    - `apps/server/src/services/`（新增活动服务）、`apps/server/src/routes/`
    - `packages/contracts/src/task-overview.ts`
    - `packages/db/prisma/migrations/`（如需部分索引，核对后再定）
  - 这一步先不做什么：不改 bot 侧的 `requestProgressSnapshot`，不暴露给任何 bot 工具。
  - 怎么算完成：
    1. 标题取原始消息前 120 字符。
    2. 列表不含 `evidence`、`toolError`，仅所有者可读。
    3. 查询在 200 个未结束请求下满足性能指标，必要时补索引。
  - 怎么验证：
    - 服务端集成测试和一次性能抽查。
  - 对应需求：`requirements.md` 需求 A1.1、A1.2、A2.1 至 A2.3、非功能 1.1
  - 对应设计：`design.md` §3.1、§3.2、§3.8

- [x] 4.2 例程与目标任务并入活动
  - 状态：DONE
  - 完成记录（2026-11-25）：
    - **例程：** 启用、未删除的例程，按最近一次执行用 1.2 的 `deriveRoutineDisplayState` 推导：运行中（含排队）、失败、跳过才成行，成功和取消的不单独成行，"显示全部"时补上成功的（空闲）和暂停的；暂停的例程最近一次失败仍显示为失败。失败显示执行的错误原文（截 300 字符），跳过显示跳过原因，下次运行取 `nextRunAt`，点击跳转到例程。
    - **目标任务：** 目标里 bot 任务正在运行的，带 `ReportOutcomeProgress` 的阶段、摘要和"完成数/总数"；排到未来的显示"已排期"或"已延后"和开始时间，不显示为"正在工作"；只取当前计划的任务（被替换的计划留下的不算），已验收和已取消的目标的任务不显示；tracked 目标没有任务，所以天然不在此列。标题是"任务 — 目标"，点击跳转到目标。
    - **executor：** 请求下仍在工作的 executor（`provisioning/queued/running/waiting`）汇总成父请求的 `workerCount`，不单独成行；已结束的不计入。
    - **合并：** 各来源各自查询，共用类型、推导和上限；事物 ID 为 `<类型>:<来源 ID>`，同一事物只留一行；按最近活动倒序，总数不超过 200，超出时 `truncated` 为真；没有任何活动时返回空列表而不是报错。例程和目标任务的运行（`origin` 为 `routine`、`outcome`）本来就不进请求进展，不会与请求重复。
  - 验证：server 活动服务测试从 14 增到 34（例程 8、目标任务 6、executor 与去重 3、跨来源 3）；**变异检查 6 个**（成功的例程也显示、已排期当作运行中、executor 计数含已结束的、跳过不看窗口、失败也套窗口、被替换的计划的任务也显示），每个都有测试变红，已还原。
  - 测试夹具的教训：每个夹具有自己的连接池，原先等到整个文件结束才清理，34 个测试累积后超过 Postgres 连接上限（"too many clients"），表现为随机失败。改为每个测试结束就清理，同时让全局策略设置在测试间复位。这不是产品代码的问题，但说明单个测试文件的夹具数量有上限。
  - 这一步到底做什么：把例程（失败、跳过、运行中）和目标里的 bot 任务（运行中、已排期）加进活动查询，并汇总 executor。
  - 做完你能看到什么：活动里同时有请求、例程异常和目标任务；已排期的任务不显示为"正在工作"；executor 汇总在父请求下。
  - 先依赖什么：4.1、2.10
  - 开始前先看：
    - `requirements.md` 需求 A1.3、A3
    - `design.md` §3.1、§6.2
  - 主要改哪里：
    - `apps/server/src/services/`（活动服务）
  - 这一步先不做什么：不新增例程功能。
  - 怎么算完成：
    1. 成功的例程执行不单独成行。
    2. tracked 目标不作为活动项。
    3. 同一件事只出现一次。
  - 怎么验证：
    - 集成测试覆盖各来源和去重。
  - 对应需求：`requirements.md` 需求 A1.3、A3.1 至 A3.6
  - 对应设计：`design.md` §3.1

- [ ] 4.3 活动视图界面
  - 状态：IN_REVIEW
  - 会话 A 验证（2026-11-25）：离线 Chromium 中英文和深浅主题检查卡片、活动表、bot 分组与窄窗口，恢复状态配色。真实 bot 进展待验收，D4-5 的 30 秒刷新待所有者决定。同 4.4 一并发布。
  - 完成记录（2026-11-25）：
    - **活动区：** 仪表盘在"需要你处理"和两条目标泳道之间新增"活动"区，按 bot 分组，每组显示进行中、等待中、受阻的数量；不超过策略 `activity.cardMaxItems` 条时用卡片，更多时用一张表（表头加每组一个分组行）；状态用文字、图标和色调，只有进行中和运行中的图标会闪动，减少动态效果时静止；默认隐藏项（成功的例程、超出最近完成窗口的、executor、tracked 目标）通过"显示全部"切换，切换时重新向服务端要全部。
    - **bot 写的文字：** 摘要和原因都按纯文本渲染（React 转义，没有任何解析链接或标记的代码），并标注"由 bot 填写"；例程的错误是系统的文字，不加这个标注。
    - **与泳道并存：** 现有的"Bots are working"和"Paused or failed"泳道原样保留，有活动数据和没有活动数据时泳道的标记完全相同（有测试）；`needsOwner` 为真的事项不在活动区重复渲染。
    - **显示方式：** 目标管理设置页的"活动视图"分组随之出现（四项策略都来自 2.1 登记的元数据，界面里没有新数字）；`activity.dashboardLayout` 为"并存"（默认）、"只显示活动"、"只显示目标泳道"时，仪表盘立即按所选方式显示；"需要你处理"区在任何方式下都显示；只显示目标泳道时不向服务端请求活动。无法识别的值按"并存"处理。
    - **旧服务端：** 没有活动接口或请求失败时，活动区直接不出现，不报错，目标和"需要你处理"不受影响。
    - **跳转：** 目标任务打开所在目标；请求和频道例程打开所在频道（活动项的链接改为优先指向频道，没有频道才回落到对话；例程属于频道时链接指向频道）；既没有频道也没有目标的行只显示文字，不做成按钮。
  - 验证：桌面端新增 43 个测试（状态与分组逻辑 14、活动区渲染 14、仪表盘集成 11、客户端路径 2、设置页 2），server 新增 2 个（请求和例程链接到频道）；既有的 16 个工作区测试因为工作区现在要读策略而失败，已在它们的 `api` 桩里补上 `featureSettings`，不是产品问题；**变异检查 3 个**（泳道不看显示方式、隐藏时仍请求活动、没有活动数据也画区），每个都有测试变红，已还原。桌面端全量 1271 通过（2 跳过）、0 失败；`tsc`、`check:i18n` 通过。
  - **没有验证（所以不是 DONE）：** (1) 没有在真实窗口里看过，包括卡片栅格、表格在窄窗口、分组行、深色模式；(2) 活动区的数据没有用真实 bot 的请求进展跑过，只有测试夹具；(3) 刷新见偏差记录 D4-5：沿用仪表盘现有的触发（窗口获得焦点、每 30 秒、目标状态事件），没有新增 `activity.changed`，与规格"不轮询"不完全一致；(4) "需要你处理"里还没有请求（4.4 加入），所以在 4.4 之前，`needsOwner` 的请求（需要我、无人跟进、检查未触发）既不在活动区也不在"需要你处理"，**4.3 单独发布会让这几类请求暂时不可见**，必须与 4.4 一起发布。
  - 这一步到底做什么：在目标仪表盘里新增"活动"区，按 bot 分组，卡片或表格，默认隐藏项可切换。
  - 做完你能看到什么：打开仪表盘就能看到每个 bot 在做什么、什么状态、做到哪。
  - 先依赖什么：4.2
  - 开始前先看：
    - `requirements.md` 需求 A1、A9
    - `design.md` §3.3
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/outcome-dashboard.tsx`
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不改目标列表页，不做移动端；系统自身不移除现有的两个目标泳道，是否隐藏由所有者在设置页选择，是否取代评估后另行决定。
  - 怎么算完成：
    1. 不超过策略 `activity.cardMaxItems` 个时用卡片，更多用表格，每组显示状态汇总。
    2. 默认隐藏项可通过"显示全部"切换。
    3. 状态用文字、图标和颜色，动画遵守减少动态效果偏好。
    4. 现有的"Bots are working"和"Paused or failed"泳道行为不变，与活动区同时显示；`needsOwner` 为真的事项只显示在"需要我"。
    5. 在策略元数据里登记 `activity.*` 的三项数值和仪表盘显示方式 `activity.dashboardLayout`，目标管理设置页的"活动视图"分组自动显示（需求 E2.4）。
    6. 切换显示方式（并存、只显示活动、只显示目标泳道，默认并存）后仪表盘立即按所选方式显示；"需要我"区在任何方式下都显示。
  - 怎么验证：
    - 组件测试；人工走查；国际化检查。
  - 对应需求：`requirements.md` 需求 A1、A9
  - 对应设计：`design.md` §3.3

- [ ] 4.4 统一的"需要我"队列
  - 状态：IN_REVIEW
  - 会话 A 验证（2026-11-25）：离线 Chromium 核对异常分区先于受阻、收件箱混排、跳转及 bot 文字按纯文本显示，中英文和深浅主题通过。真实 bot 请求及恢复后的实际数据待验收，见[远端清单](docs/20261125-远端验证清单.md)。
  - 完成记录（2026-11-25）：
    - **服务端：** `GET /api/needs-me`（所有者身份、仅 GET、不缓存）返回无人能推进的请求：阻塞且来源为用户或策略（需要我）、无人跟进、检查未触发。条目由活动服务读时推导，与活动列表的 `needsOwner` 标记是同一批行（有测试固定两者一致）；不带 `evidence` 和 `toolError`；请求恢复推进后下次读取自然消失。
    - **排序与去重：** 契约里的 `needsMeZone` 与 `compareNeedsMe`：异常分区在前，其后是阻塞分区，分区内等待最久的在前，键相同时按 key 稳定。桌面端 `needsMeQueue` 把收件箱步骤（保持服务端顺序）与阻塞请求（按等待久近）按谁等得久交错合并，条目以 key 去重。
    - **界面：** 仪表盘"需要你处理"区的总数、空状态都计入请求；请求行显示标题、bot、状态、原因（纯文本并标注"由 bot 填写"）、等待时间，有频道时可打开对话，否则只是文字；旧服务端缺这个接口或调用失败时只显示收件箱步骤，不报错。4.3 记录的"请求暂时不可见"缺口随之补上。
  - 验证：contracts 新增 3 个；server 新增 6 个（集成 5、路由 1）；桌面端新增 12 个（合并与排序 4、仪表盘集成 8）。**变异检查 5 个**（不过滤已停止、不排序、不接住接口失败、去掉"由 bot 填写"、空状态忽略请求），每个都有测试变红。桌面端全量 1431 通过、0 失败；根目录 typecheck 另行见阶段汇报。
  - **没有验证（所以不是 DONE）：** 没有在真实窗口里看过；没有用真实 bot 的请求进展跑过。
  - 这一步到底做什么：把收件箱步骤、受阻的请求、无人跟进和检查未触发合并成一个队列，排序并去重。
  - 做完你能看到什么：一个常显总数的队列，每项一行原因和就地操作，处理后自然消失。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 A4
    - `design.md` §2.4、§3.8
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/dashboard-state.ts`
  - 主要改哪里：
    - `apps/server/src/services/`（`GET /api/v0/needs-me`）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/dashboard-state.ts` 和 `outcome-dashboard.tsx`
    - `apps/desktop/test/outcome-dashboard-state.test.ts`
  - 这一步先不做什么：不加待办来源（阶段 6 再加）。
  - 怎么算完成：
    1. 来源重叠时只出现一次。
    2. 排序符合设计 §2.4。
    3. 旧服务端缺新来源时只显示收件箱步骤。
  - 怎么验证：
    - 单元和集成测试；人工走查。
  - 对应需求：`requirements.md` 需求 A4.1 至 A4.6
  - 对应设计：`design.md` §2.4、§8.12

- [ ] 4.5 通知分级
  - 状态：IN_REVIEW
  - 会话 A 验证（2026-11-25）：`request-notifications.integration.test.ts` 在 `tov_close` 重跑通过。iOS、Android 真机通知与旧客户端点击行为待所有者验收，见[远端清单](docs/20261125-远端验证清单.md)。
  - 完成记录（2026-11-25）：
    - **新通知类型：** `RequestNotificationPayload`（`kind: "request"`）。请求没有 outcomeId，不能复用目标通知。事实键是 `request:<请求ID>:<修订号>:<状态>`，同一请求同一修订同一状态只通知一次；文字固定，不含 bot 写的任何内容。
    - **扫描：** `notifyRequestsNeedingOwner`（messaging）在 worker 每分钟的例程轮次里执行：只通知"需要我"、"无人跟进"、"检查未触发"三种；进行中、等待中、已完成保持静默；失败不拖垮该轮次，下一轮重试。
    - **去重原渠道：** 状态为"需要我"时，若该 bot 在这个频道里从请求开始后已发过消息，则不再推送（对话已产生消息通知）；"无人跟进"和"检查未触发"始终通知。
    - **推送链路：** worker 的 `push-notifications`、`fcm`、`apns` 都接受新类型；发送前再核对请求是否仍在等所有者（已停止、改了修订或不再阻塞则丢弃）。
  - 验证：server 集成测试 10 个（`request-notifications.integration.test.ts`，含两次发送前核对）、worker 3 个（FCM、APNs 载荷）。**变异检查 4 个**（去掉原渠道跳过、去掉去重、不限于三种状态、去掉发送前核对），每个都有测试变红。有数据库时全量：contracts 342、messaging 937、worker 281、server 1821，均 0 失败；根目录 `typecheck` 15/15。
  - **没有验证（所以不是 DONE）：** 没有在真机上收到过这类推送；iOS 和 Android 客户端没有改，旧客户端遇到未知类型的行为未验证（系统通知文字由推送本身带，点击后只打开应用）；高紧急度待办通知属阶段 6。`check:architecture` 的失败来自 OutcomeGo 上已有的 i18n 缺项，不是本任务引入。
  - 这一步到底做什么：按设计把通知分成打断、提示、静默三级，并按请求 ID 加修订号去重。
  - 做完你能看到什么：只有真正需要你的事和"无人跟进"才推送；完成只留角标。
  - 先依赖什么：4.4
  - 开始前先看：
    - `requirements.md` 需求 A5
    - `design.md` §3.4
  - 主要改哪里：
    - `packages/messaging/src/notifications`（沿用现有通知函数）
    - `apps/worker/src/worker.ts`
  - 这一步先不做什么：不新增待办推送（阶段 6 的晨报另行处理）。
  - 怎么算完成：
    1. 同一事项同一状态只通知一次。
    2. 已由原渠道通知的事项不重复推送。
  - 怎么验证：
    - 集成测试覆盖去重和静默项。
  - 对应需求：`requirements.md` 需求 A5.1 至 A5.4
  - 对应设计：`design.md` §3.4

- [ ] 4.6 无人跟进的呈现
  - 状态：IN_REVIEW
  - 当前进展（2026-11-25）：保留既有展示状态、自愈与任务 4.5 的通知投递；新增两组占位夹具集成测试，验证真实数据库对账由 `working` 转 `blocked/runtime`、活动与「需要我」的一致性、检查阈值边界，以及读取不写入、不增加检查或通知。变异检查：把 `runtime` 映射成普通受阻，或令详情读取修改请求修订号，两组测试均失败；还原后通过。
  - 未验证：阶段 0.4 仍未通过；未在真实对话中验证续跑、遵从度及仪表盘呈现。
  - 这一步到底做什么：把"核对中""无人跟进""检查未触发"作为展示状态呈现，并进入"需要我"，不新建任何提醒机制。
  - 做完你能看到什么：bot 停下来没人跟的任务能被发现，且不会与请求进展自己的自愈重复告警。
  - 先依赖什么：4.4、0.4
  - 开始前先看：
    - `requirements.md` 需求 A6
    - `design.md` §3.5、§2.2、§8.11
  - 主要改哪里：
    - `packages/contracts/src/task-overview.ts`
    - `apps/server/src/services/`（活动服务）
  - 这一步先不做什么：不改 `request-progress.ts` 的自愈逻辑。
  - 怎么算完成：
    1. 对账 1 至 2 次显示"核对中"，不报警。
    2. 对账用尽转 `blocked` 加 `runtime` 显示"无人跟进"。
    3. 到期超过策略 `activity.checkOverdueMinutes` 仍未分发的检查显示"检查未触发"。
  - 怎么验证：
    - 单元测试（各状态推导）；集成测试（自愈到转 `blocked`）。
  - 对应需求：`requirements.md` 需求 A6.1 至 A6.4
  - 对应设计：`design.md` §3.5、§8.11

### 阶段检查

- [ ] 4.7 阶段 4 检查点
  - 状态：TODO
  - 复核准备（2026-11-25）：见 [会话 B 复核材料](docs/20261125-偏差记录-act.md#47阶段-4-检查点)。检查点未执行。
  - 这一步到底做什么：确认活动视图和"需要我"可以独立承担"看 bot 在做什么"。
  - 做完你能看到什么：不依赖目标登记，也能看到所有 bot 的工作。
  - 先依赖什么：4.1 至 4.6
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求，不做目标降级。
  - 怎么算完成：
    1. 需求 A1 至 A6、A9 的验收标准逐条通过。
    2. 阶段 0 的遵从度基线已用来判断视图是否足够完整，结论写入 `docs/`。
    3. 活动区与现有两个目标泳道默认并存显示，所有者可在设置页切换显示方式用于评估（设计 §10.2 第 1、24 项已确认）；是否取代由所有者评估后另行决定，不在本规格实现，评估所需的对照记入 `docs/`。
  - 怎么验证：
    - 人工走查和相关测试。
  - 对应需求：`requirements.md` 需求 A1 至 A6、A9
  - 对应设计：`design.md` §3.1 至 §3.5

---

## 阶段 5：目标降级与提示词精简

- [ ] 5.1 提示词与工具描述调整
  - 状态：IN_REVIEW
  - 当前进展（2026-11-25）：持续性工作改用 `Task` 和 `ReportRequestProgress`；目标仅用于明确要求、需要计划批准／最终验收／人工动作，或需要收件箱决策。同步工具描述和目录摘要，升级提示词版本至 `outcomego-platform-35`；工具输入输出与权限不变。开启的三种必测变体为 24,966／25,183／23,435 字符；关闭的默认和直接回复变体均未变化。旧提示词触发新规则断言失败；模拟前缀超长时四个长度断言均失败，还原后焦点测试通过。
  - 未验证：真实 bot 遵从度、活动可见性和推理缓存；阶段 4 检查点通过前不发布。
  - 这一步到底做什么：把"目标看板"一条改为"持续性工作用请求进展，正式目标只用于三种情况"，同步 `TrackOutcome` 的工具描述，目标管理一节净减少篇幅。单次安排的轻量展示与工具指导由 7.6 至 7.8 补充。
  - 做完你能看到什么：bot 默认不再为日常工作登记目标；提示词比之前更短。
  - 先依赖什么：4.7
  - 开始前先看：
    - `requirements.md` 需求 A7、非功能需求 6
    - `design.md` §3.6
    - `docs/20261124-现状核实记录.md` §5
  - 主要改哪里：
    - `packages/messaging/src/prompts/platform.json`（`native-outcome-records`）
    - `packages/contracts/src/outcome-chat.ts`、`packages/contracts/src/tool-contracts.ts`
    - `packages/messaging/test/platform-system-prompt.test.ts`、`packages/messaging/test/outcome-context.test.ts`
  - 这一步先不做什么：不改 `TrackOutcome`、`CloseOutcome` 的输入输出；待办一节在阶段 6 加。
  - 怎么算完成：
    1. 目标管理开启时基础提示词不长于改动前（阶段 0.3 的基线）。
    2. 开启时仍包含 `TrackOutcome`，关闭时仍不包含。
    3. `PLATFORM_SYSTEM_PROMPT_VERSION` 已更新，基线测试已按需更新。
  - 怎么验证：
    - 提示词测试、长度对比；用一轮真实对话抽查 bot 行为。
  - 对应需求：`requirements.md` 需求 A7.1 至 A7.6、非功能 6.1
  - 对应设计：`design.md` §3.6、§8.13

- [ ] 5.2 已有 tracked 目标的标记与筛选
  - 状态：IN_REVIEW
  - 当前进展（2026-11-25）：列表返回可选 `OutcomeSummary.trackingMode`，桌面端显示「机器人登记」并可只筛选登记目标，和状态筛选组合；服务端先筛选后分页。旧服务端或缺失字段的行默认照常显示，但不会猜为机器人登记。无迁移、批量操作或状态派生改动。两组数据库夹具验证筛选前后原记录不变、已有登记目标仍能正常 `CloseOutcome`。移除契约枚举校验、服务端筛选或桌面端查询参数时，对应测试失败；还原后通过。
  - 未验证：未在已升级的真实环境核对历史目标数量，未人工走查桌面端界面。
  - 这一步到底做什么：在目标列表里给 bot 登记的目标加标记并可筛选，不迁移不关闭。
  - 做完你能看到什么：已有的 tracked 目标原样保留，能一眼认出并过滤。
  - 先依赖什么：5.1
  - 开始前先看：
    - `requirements.md` 需求 A8
    - `design.md` §3.7
  - 主要改哪里：
    - `packages/contracts/src/outcomes.ts`（`OutcomeSummary.trackingMode`）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/outcome-list.tsx`
  - 这一步先不做什么：不批量关闭（待确认，设计 §10.2 第 9 项）。
  - 怎么算完成：
    1. 系统升级后已有 tracked 目标数量和状态不变。
    2. `CloseOutcome` 对 tracked 目标照常工作。
  - 怎么验证：
    - 集成测试；组件测试。
  - 对应需求：`requirements.md` 需求 A8.1 至 A8.3
  - 对应设计：`design.md` §3.7

### 阶段检查

- [ ] 5.3 阶段 5 检查点
  - 状态：TODO
  - 复核准备（2026-11-25）：见 [会话 B 复核材料](docs/20261125-偏差记录-act.md#53阶段-5-检查点)。检查点未执行，未重建远端。需与阶段 0 同口径测缓存，并核对真实活动可见性。
  - 这一步到底做什么：确认目标降级没有造成可见性损失，且缓存与提示词符合预期。
  - 做完你能看到什么：目标列表只剩有意义的目标，bot 的日常工作在活动视图里。
  - 先依赖什么：5.1、5.2
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：`docs/`
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 用一轮真实对话对比改动前后的 `cachedInputTokens` 占比，写入 `docs/`。
    2. 需要重建远端 computer 才能生效的部分，已征得用户同意并验证。
  - 怎么验证：
    - 真实对话对比；`inference.metrics` 日志。
  - 对应需求：`requirements.md` 需求 A7、A8、非功能 6
  - 对应设计：`design.md` §3.6

---

## 阶段 6：现实待办项（通用机制）

本阶段只做通用机制。邮件、拜访、巡检等场景不是任务，只作为文档示例，用来验证机制足够通用。

- [ ] 6.1 待办数据模型、策略键与基础接口
  - 状态：IN_REVIEW
  - 完成记录：`OwnerTodoItem` 与旧 `TodoWrite` 存储分离，支持所有者 CRUD、乐观并发与创建幂等；待办策略键已由 2.1 登记。登录模式从会话读取已有文本 `User.id`，本地无认证模式使用 `local`。独立库集成测试验证了流转、并发、重试与新增 SQL，旧 bot 待办行保持可读。整链迁移在既有 `202611070001_add_voice_sessions` 因空库缺 `outcomego_bot` 失败。桌面端部分由 D 完成，尚未验证。现有 `/api/v0/needs-me` 的待办来源由 C 在 6.6 提供。
  - 这一步到底做什么：新增待办表，以及创建、读取、修改、接受、延后、忽略、完成、恢复的接口，带乐观并发和幂等；在策略元数据里登记待办相关的键，目标管理设置页的"待办"分组自动显示（需求 E2.5）。
  - 做完你能看到什么：待办可以通过接口完整地创建和流转，所有状态都有测试；数据模型里没有任何场景相关的字段或枚举值。
  - 先依赖什么：4.7、2.1
  - 开始前先看：
    - `requirements.md` 需求 B1、B2、B4、D2、D3
    - `design.md` §2.6、§4.1、§4.2、§4.3、§4.11
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/<时间戳>_add_todo_item/`（新）
    - `packages/contracts/src/todo.ts`（新）、`packages/contracts/src/task-policy.ts`
    - `apps/server/src/services/`（新增 `TodoService`）、`apps/server/src/routes/`（新增待办路由）
  - 这一步先不做什么：不做界面、bot 工具和晨报；不写任何场景相关字段、枚举或重复规则。
  - 怎么算完成：
    1. 状态流转符合设计 §4.3，非法流转被拒绝；恢复保留期读自策略。
    2. 重复的创建请求幂等；过期的 `revision` 返回 `todo_conflict`。
    3. 所有者身份核对完成（设计 §10.1「所有者身份模型」）。
  - 怎么验证：
    - 服务端集成测试。
  - 对应需求：`requirements.md` 需求 B1.1、B1.3、B1.4、B2.1 至 B2.6、B4.1、B4.2
  - 对应设计：`design.md` §4.2、§4.3、§4.11、§8.10

- [ ] 6.2 桌面端：添加、列表与"需要我"时间轴
  - 状态：IN_REVIEW
  - 完成记录：桌面仪表盘已接入独立的 `/api/todos` 接口，可添加、分组浏览、完成、延后、忽略与从历史恢复。创建失败后重试原内容复用请求 ID，操作携带当前 `revision`。组件测试覆盖可选日期和标签、延后事项退出时间轴、无截止日不显示逾期、机器人文本的纯文本展示与来源标注，以及历史恢复。已用变异检查确认测试能捕获接口、创建、分组与操作守卫被破坏。
  - 完成记录补充：已接入 `/api/needs-me` 的待办来源，组件测试覆盖统一队列的计数、排序、去重和处理后移除。
  - 没有验证：真实桌面端人工走查尚未进行。
  - 这一步到底做什么：做顶部一行输入框，以及"需要我"里的时间轴（逾期、今天、本周、无日期）、需跟进和已延后的处理。
  - 做完你能看到什么：随手记一件事，当天就能在"需要我"里看到，完成后自然消失。
  - 先依赖什么：6.1、4.4
  - 开始前先看：
    - `requirements.md` 需求 B1、B2、B7
    - `design.md` §2.4、§4.7、§4.11
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不做分诊区（任务 6.3）；界面不按来源类型做任何定制。
  - 怎么算完成：
    1. 一行输入可选日期和标签。
    2. 延后的待办在 `snoozeUntil` 前不出现。
    3. 没有 `dueAt` 的待办不显示逾期。
  - 怎么验证：
    - 组件测试；人工走查。
  - 对应需求：`requirements.md` 需求 B1.1、B2.3 至 B2.6、B7.1、B7.2
  - 对应设计：`design.md` §2.4、§4.7

- [ ] 6.3 来源门、建议与分诊
  - 状态：IN_REVIEW
  - 完成记录：服务端来源门从消息及其实际运行来源校验授权，按所有者与来源键去重；后台按到期时间扫描，支持批量接受和忽略。短期复用旧建议去重键时只返回 ID、状态和版本给 bot，所有者原消息预览由所有者读接口生成。独立库集成测试及运行来源守卫变异通过。桌面端新增建议分诊、接受、延后、忽略、批量接受或忽略，以及清除此 bot 建议的入口；所有者原始消息与 bot 内容分开展示。组件和接口测试覆盖状态、版本、批量动作与原文预览，并经变异检查确认。
  - 没有验证：真实桌面端人工走查及真实 bot 接入（6.4）。
  - 这一步到底做什么：实现来源门（所有者消息引用校验）、去重、按策略的过期扫描与可选上限、批量处理和分诊区界面。
  - 做完你能看到什么：没有有效所有者消息引用的创建先出现在分诊区，接受后才成为待办；待办详情显示服务端读出的所有者原消息预览；是否过期、有无上限由策略设置决定。
  - 先依赖什么：6.1、6.2
  - 开始前先看：
    - `requirements.md` 需求 B3、B4、B10、D2
    - `design.md` §4.4、§4.10、§8.9、§8.10
  - 主要改哪里：
    - `apps/server/src/services/`（`TodoService`，来源门是一个纯函数）
    - `apps/worker/src/worker.ts`（过期扫描，挂在每分钟调度）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/`（分诊区）
  - 这一步先不做什么：不做 bot 工具；来源门不读取 `sourceRef`、`tags`、`title` 的内容，不枚举来源类型。
  - 怎么算完成：
    1. `SuggestTodo` 创建 `suggested`；`CreateTodo` 只有所有者消息引用通过校验（存在、由所有者发出且所属运行来源是所有者对话、属于同一对话、在有效期内、未超单消息上限）才创建 `open`，否则降级为 `suggested` 并说明原因。
    2. 例程、事件、唤醒合成的 `role = user` 消息不被当作所有者消息。
    3. 待办详情显示被引用的所有者消息预览，内容由服务端按引用读取，不由 agent 转述。
    4. 同一去重键不产生第二条；已忽略的去重键不再被建议。
    5. 过期扫描只查已到期的建议；策略未设置则不过期、不设上限。
    6. 两个仅来源类型和文字不同的请求，结果完全一致。
  - 怎么验证：
    - 集成测试覆盖引用校验（含多步流程里后续步骤凭引用创建、合成 user 消息被拒绝）、去重、过期、上限、批量，以及两个不同来源类型的对照用例。
  - 对应需求：`requirements.md` 需求 B3.1 至 B3.8、B4.3、B10.1、B10.2、B10.6
  - 对应设计：`design.md` §4.4、§4.10、§8.9、§8.10、§8.15

- [ ] 6.4 bot 工具与提示词一节
  - 状态：IN_REVIEW
  - 完成记录：四个待办工具接入运行时与服务端，按可信回合来源限制，并在触发消息和 `ReadTranscript` 提供所有者消息引用。提示词长度与隔离测试在本地核对；未重建远端 computer，真实例程回合待验收。
  - 这一步到底做什么：新增 `CreateTodo`、`SuggestTodo`、`UpdateTodo`、`ListTodos` 工具，加一小节通用的待办提示词，并让 `SuggestTodo` 能在例程回合使用。
  - 做完你能看到什么：agent 在对话里能记待办，例程回合能提出建议；bot 之间互相看不到对方的待办。
  - 先依赖什么：6.3、5.3
  - 开始前先看：
    - `requirements.md` 需求 B1.2、B3、B10.3、B10.4、D1、D2、非功能 6
    - `design.md` §4.4、§4.5、§8.14
    - `apps/computer/src/runtime/dynamic-catalog.ts`（目标工具的开放条件）
  - 主要改哪里：
    - `packages/contracts/src/todo.ts`
    - `apps/server/src/services/internal-tool-service.ts`、`apps/server/src/services/`
    - `apps/computer/src/runtime/dynamic-catalog.ts`、`apps/computer/src/runtime/tools.ts`
    - `packages/messaging/src/prompts/platform.json`（待办一节）、`packages/messaging/test/`
  - 这一步先不做什么：不在本任务里重建远端 computer，重建单独征得用户同意；提示词和工具描述不用具体场景举例，不列举来源类型。
  - 怎么算完成：
    1. 待办一节不超过 900 字符，总提示词仍不超过改动前（含阶段 5 的精简）。
    2. automation 回合只有 `SuggestTodo`；子 agent 和目标线程没有任何待办工具。
    3. `ListTodos` 只返回该 bot 自己创建的及所有者在其对话中创建的。
    4. 提示词和工具描述中没有任何场景词。
    5. 例程回合产生的建议记录产生它的例程 ID（取自回合上下文，不由 agent 自述），同一来源反复提出时按去重键只保留一条。
    6. `CreateTodo` 的输入是所有者消息 ID，不是转述的文字；agent 能拿到触发消息的 ID 和 `ReadTranscript` 结果里的消息 ID，若未提供则补充提供。
  - 怎么验证：
    - 工具集成测试、提示词长度测试、场景词检查；真实例程回合的端到端需重建远端 computer 并征得用户同意。
  - 对应需求：`requirements.md` 需求 B1.2、B3、B5.1 至 B5.3、B10.3、B10.4、D2、非功能 6
  - 对应设计：`design.md` §4.5、§8.14

- [ ] 6.5 场景无关性验证与示例演练
  - 状态：IN_REVIEW
  - 完成记录：两组不同来源引用、标签和文字经过同一个已绑定例程回合，核对建议、去重、过期、展示和自动接受结果一致；详见 `docs/20261125-偏差记录-todo-bot.md`。真实例程演练未验证。
  - 这一步到底做什么：写出场景示例文档，并用至少两个不同的示例场景走同一条路径，证明代码里没有场景分支；做评审清单检查。
  - 做完你能看到什么：一份评审记录：同一路径同样结果；待办相关代码、模型、提示词、工具描述里没有场景词、没有按来源类型的分支、没有业务数值字面量。
  - 先依赖什么：6.4
  - 开始前先看：
    - `requirements.md` 需求 D1 至 D4
    - `design.md` §2.5、§4.6、§8.15、§8.16
    - `docs/20261124-场景示例.md`
  - 主要改哪里：
    - `docs/`（评审清单与验证记录）
    - `apps/server/test/`、`packages/contracts/test/`（两个示例场景的夹具测试）
  - 这一步先不做什么：不为任何场景写专用代码；不引入场景相关的测试辅助函数。
  - 怎么算完成：
    1. 两个不同示例场景（来源类型、标签、文字都不同）的夹具测试结果一致。
    2. 评审清单逐项通过。
    3. 用一个示例场景在真实例程回合做端到端（需重建远端 computer，征得用户同意）。
  - 怎么验证：
    - 夹具测试、评审清单、端到端记录。
  - 对应需求：`requirements.md` 需求 D1、D2、D4
  - 对应设计：`design.md` §2.5、§4.6、§8.15、§8.16

- [ ] 6.6 等待、跟进与紧急度
  - 状态：IN_REVIEW
  - 完成记录：`GET /api/v0/needs-me` 增加 `todos`，原请求保留在 `items`；按到期、跟进时间及策略实时投影。高紧急度仅在策略开启时进入现有推送队列，按待办 ID 和设备去重。已在独立库测试队列、排序及开关。桌面端接入统一队列、等待与跟进操作，并使用契约的分区、紧急度与时间排序。组件测试及变异检查覆盖优先级、去重、版本和完成后移除。
  - 没有验证：真实桌面端人工走查及真机推送。Android 客户端当前不显示新增 FCM 待办类型。
  - 这一步到底做什么：实现等待到点变"需跟进"、延后，以及 agent 声明的紧急度在同一分区内的排序。
  - 做完你能看到什么：等别人答复的事到时间回到面前；紧急度高的建议排在同一分区前面，但不会排到所有者自己的待办之前。
  - 先依赖什么：6.3
  - 开始前先看：
    - `requirements.md` 需求 B6、B7
    - `design.md` §2.4、§4.7
  - 主要改哪里：
    - `apps/server/src/services/`（`TodoService`）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/`
  - 这一步先不做什么：不做重复规则和日历展开；高紧急度是否打断由策略 `todo.highUrgencyNotify` 决定，默认关闭（设计 §10.2 第 21 项已确认为可配置选项）。
  - 怎么算完成：
    1. 到跟进时间显示"需跟进"并回到"需要我"。
    2. 紧急度只在同一分区内排序，不改变分区。
    3. 策略开启时，新建的 `high` 事项触发一次打断式通知并按待办 ID 去重；默认不通知。
  - 怎么验证：
    - 单元测试（分区与排序）；集成测试（通知开关）。
  - 对应需求：`requirements.md` 需求 B6.1 至 B6.3、B7.1、B7.2
  - 对应设计：`design.md` §2.4、§4.7

- [ ] 6.7 交给 bot 与升级成目标
  - 状态：IN_REVIEW
  - 完成记录：桌面端复用目标表单；交接沿用所有者对话写入路径，在同一事务中关联消息；按请求进展读时显示待确认，不自动完成。未在真实调试环境发起对话或创建目标。
  - 这一步到底做什么：实现"交给 bot"（以所有者身份发一条消息并记录），活动视图通过消息 ID 关联进展，以及"升级成目标"。
  - 做完你能看到什么：一键把待办交给 bot 并看到进展；复杂的事一键升级成目标并关联。
  - 先依赖什么：6.4、4.7
  - 开始前先看：
    - `requirements.md` 需求 B8
    - `design.md` §4.8
    - `apps/desktop/src/renderer/components/outcomego/outcomes/thread/new-outcome-form.tsx`
  - 主要改哪里：
    - `apps/server/src/services/`（`TodoService`、所有者发消息的现有路径）
    - `apps/desktop/src/renderer/components/outcomego/outcomes/`
  - 这一步先不做什么：不增加 bot 权限；不新增服务端创建目标的路径。
  - 怎么算完成：
    1. 交给 bot 后待办执行者变为 bot，并记录消息 ID。
    2. 请求完成后待办显示"待确认完成"，由所有者确认。
    3. 升级成目标后待办标为完成并关联目标。
  - 怎么验证：
    - 集成测试；桌面端交互测试。
  - 对应需求：`requirements.md` 需求 B8.1 至 B8.5
  - 对应设计：`design.md` §4.8

- [ ] 6.8 晨报
  - 状态：IN_REVIEW
  - 完成记录：启用时，worker 按所有者时区、策略时间和本地日期推送；依赖现有幂等记录和推送队列。`GET /api/v0/needs-me` 额外返回即时生成的 `todoDigest`。独立库测试验证时间门槛、并发只推一次、空日静默、标题上限和推送数据。桌面组件在「需要我」顶部显示计数和标题，并按纯文本显示标题。
  - 没有验证：真实桌面端人工走查及移动端真机推送。
  - 这一步到底做什么：实现可选的晨报：读取策略、每分钟调度判断、推送和"需要我"顶部卡片；"当天已发送"用现有幂等记录表示。
  - 做完你能看到什么：开启后每天固定时间收到"今天要处理的 N 件事"，没有事项时不打扰。
  - 先依赖什么：6.6
  - 开始前先看：
    - `requirements.md` 需求 B9
    - `design.md` §4.9、§2.6
  - 主要改哪里：
    - `apps/worker/src/worker.ts`
    - 晨报三项由策略元数据在目标管理设置页的"待办"分组自动显示，不需要单独写界面
  - 这一步先不做什么：不发到 bot 对话，不对外发送任何消息；不新增晨报专用表。
  - 怎么算完成：
    1. 默认关闭；开启后一天最多一次，按所有者时区。
    2. 内容只有数量和策略规定条数内的标题。
    3. 当天没有事项时不推送。
  - 怎么验证：
    - 集成测试（时区、一天一次、无事项）。
  - 对应需求：`requirements.md` 需求 B9.1 至 B9.4
  - 对应设计：`design.md` §4.9

- [ ] 6.9 自动接受规则
  - 状态：IN_REVIEW
  - 完成记录：服务端实现所有者规则接口、可信回合绑定、按时区的每日上限和自动接受标注。新增迁移通过独立库的升级 SQL 核对。桌面目标管理设置支持新建、编辑、启停与删除规则，并显示命中次数及最近命中时间；分诊区快捷入口以实际例程 ID 预填并要求确认，自动接受的待办已标注且可直接忽略。组件与接口测试及变异检查均已通过。
  - 没有验证：真实桌面端人工走查及真实 bot 建议命中。设置页手动编辑直接填写例程或 bot ID；分诊快捷入口会预填例程 ID。
  - 这一步到底做什么：新增自动接受规则：数据表、所有者专用的管理接口、在来源门里按例程 ID 和 bot ID 匹配，以及设置页和分诊区的入口。
  - 做完你能看到什么：对信任的例程设置规则后，它之后提出的建议直接成为待办并标注"自动接受"，不用逐条分诊；规则的命中情况和一键忽略都看得到。
  - 先依赖什么：6.3、6.4
  - 开始前先看：
    - `requirements.md` 需求 B12、B10.1
    - `design.md` §4.12、§4.4、§8.17
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/<时间戳>_add_todo_auto_accept_rule/`（新）
    - `packages/contracts/src/todo.ts`、`apps/server/src/services/`（`TodoService`）、`apps/server/src/routes/`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/dashboard/`（分诊区快捷入口）、`apps/desktop/src/renderer/components/outcomego/settings/`（目标管理设置页里的"自动接受规则"分组，需求 E2.6）
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不提供任何 bot 工具读写规则；不做移动端管理；不提供"全部自动接受"；规则不适用于引用校验失败而降级的建议。
  - 怎么算完成：
    1. 只有来源类型、没有例程 ID 或 bot ID 的规则被拒绝。
    2. 匹配只对例程 ID、bot ID 做相等比较，来源类型字符串只做进一步收窄；agent 自述的字段单独不能触发自动接受。
    3. 策略 `todo.autoAccept.maxPerRulePerDay` 未设置则不限，设置后超限降级为普通建议。
    4. 停用或删除规则只影响之后的建议；命中次数和最近命中时间可见；已自动接受的待办可一键忽略。
  - 怎么验证：
    - 集成测试（匹配、权限、上限、不绕过引用校验）；组件测试。
  - 对应需求：`requirements.md` 需求 B12.1 至 B12.8、B10.1
  - 对应设计：`design.md` §4.12、§8.17

### 阶段检查

- [ ] 6.10 阶段 6 检查点
  - 状态：TODO
  - 这一步到底做什么：确认待办的安全边界和通用性站稳。
  - 做完你能看到什么：非所有者发起的创建永远先是建议，bot 之间互相隔离，机制不含任何场景。
  - 先依赖什么：6.1 至 6.9
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 设计 §8.9、§8.10、§8.14、§8.15、§8.16、§8.17 的属性有测试覆盖。
    2. 基础提示词总长度仍不超过阶段 0 的基线。
    3. 设计 §10.2 中仍待确认的待办相关项（第 6、7 项）有结论；已确认的做法（第 2、3、4、5、8、20、21 项）已落实。
  - 怎么验证：
    - 集成测试和人工走查。
  - 对应需求：`requirements.md` 需求 B1 至 B12、D1 至 D4
  - 对应设计：`design.md` §4、§8.9、§8.10、§8.14、§8.15、§8.16、§8.17

---

## 阶段 7：全局日历

- [x] 7.1 日程查询服务
  - 状态：DONE
  - 完成记录：隔离 PostgreSQL 测试覆盖所有者鉴权、四种来源、筛选、全天日期、排序、范围与截断。两组不透明夹具走同一路径。20 次本机抽样（93 天、返回 1000 条）p95 为 84.4 ms。临时移除范围、待办所有者与截断守卫后 4 项测试均失败，恢复后通过。全天输入目前没有独立标记，投影将所有者时区的整午夜截止时间作为全天日期。例程与跟进由 7.2 补齐。
  - 这一步到底做什么：新增按时间范围查询时间条目的接口，支持目标截止日、人工任务、排期的 bot 任务、待办项。
  - 做完你能看到什么：一个接口返回统一的时间条目，带截断标记和范围限制。
  - 先依赖什么：3.3、6.10
  - 开始前先看：
    - `requirements.md` 需求 C10.1 至 C10.3、C10.10
    - `design.md` §5.7、§2.3、§5.11
  - 主要改哪里：
    - `apps/server/src/services/`（新增 `ScheduleService`）、`apps/server/src/routes/`
    - `packages/contracts/src/task-overview.ts`
  - 这一步先不做什么：不加例程和跟进来源，不做界面。
  - 怎么算完成：
    1. 范围超过 93 天返回 `invalid_range`，条目超过 1000 个时带截断标记。
    2. 全天条目按所有者时区的日期输出。
    3. 查询满足性能指标。
  - 怎么验证：
    - 服务端集成测试和一次性能抽查。
  - 对应需求：`requirements.md` 需求 C10.1 至 C10.3、C10.9、非功能 1.3
  - 对应设计：`design.md` §5.7、§5.11

- [x] 7.2 例程与跟进时间来源
  - 状态：DONE
  - 完成记录：复用 worker 的 `nextRoutineTriggerRun` 与 `inferRoutineScheduleAnchor`。隔离 PostgreSQL 测试覆盖跨夏令时 cron、间隔相位与 100 次上限、事件型例程历史、暂停及删除过滤、待办及请求的跟进跳转。移除展开上限及请求停止过滤时，两项新增测试失败，恢复后通过。无关联对话的待办跳转至原待办。
  - 这一步到底做什么：把例程（过去的执行和未来的计划）和请求进展、待办的跟进时间加进日程查询。
  - 做完你能看到什么：日历里能看到例程的每日运行和某个跟进时间点。
  - 先依赖什么：7.1
  - 开始前先看：
    - `requirements.md` 需求 C10.3、C10.8
    - `design.md` §5.7 第 1 步、§10.1「例程展开」
  - 主要改哪里：
    - `apps/server/src/services/`（`ScheduleService`）
    - `packages/messaging/src/routines.ts`（核对可复用的下一次运行计算）
  - 这一步先不做什么：不新增例程功能，不展开超过 100 次。
  - 怎么算完成：
    1. 每个例程每次查询最多展开 100 次。
    2. 已暂停或已删除的例程不展开。
    3. 跟进时间指向对应对话。
  - 怎么验证：
    - 集成测试覆盖 cron、间隔、事件触发型例程。
  - 对应需求：`requirements.md` 需求 C10.3、C10.8
  - 对应设计：`design.md` §5.7

- [x] 7.3 日历界面
  - 状态：DONE
  - 这一步到底做什么：做日、周、月视图、来源筛选、默认显示项、跳转和逾期标记。
  - 做完你能看到什么：打开日历就能看到哪天有什么，筛选后只看自己关心的。
  - 先依赖什么：7.1、7.2
  - 开始前先看：
    - `requirements.md` 需求 C10.1、C10.4、C10.5、C10.7
    - `design.md` §5.7 第 4、5 步
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/outcomes/calendar/`（新）
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不做拖动改期，不做外部日历。
  - 怎么算完成：
    1. 默认显示目标截止日、人工任务、有排期的 bot 任务、待办项、跟进时间。
    2. 点击条目跳到对应目标、任务、待办、对话或例程。
    3. 月视图每天显示条目数和前三条。
  - 怎么验证：
    - 组件测试；人工走查。
  - 对应需求：`requirements.md` 需求 C10.1、C10.4、C10.5、C10.7、C10.10
  - 对应设计：`design.md` §5.7

- [x] 7.4 拖动改期与导航入口
  - 状态：DONE
  - 这一步到底做什么：让所有者拥有的条目和未开始的 bot 任务可拖动改期，并给日历加导航入口。
  - 做完你能看到什么：在日历上拖一下就能改期；不能拖的条目有明确提示。
  - 先依赖什么：7.3、2.6、6.1
  - 开始前先看：
    - `requirements.md` 需求 C10.6
    - `design.md` §5.7 第 6 步
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/outcomes/calendar/`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/outcome-navigation.tsx`
  - 这一步先不做什么：不允许拖动 bot 已开始的任务和例程。
  - 怎么算完成：
    1. 不可拖条目没有拖动手柄。
    2. 改期失败时恢复原位并显示原因。
  - 怎么验证：
    - 交互测试；人工走查。
  - 对应需求：`requirements.md` 需求 C10.6
  - 对应设计：`design.md` §5.7

### 阶段检查

- [ ] 7.5 阶段 7 检查点
  - 状态：TODO
  - 这一步到底做什么：确认日历完整可用，再做订阅和外部叠加。
  - 做完你能看到什么：全局日历满足需求 C10。
  - 先依赖什么：7.1 至 7.4、7.7
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 需求 C10 的验收标准逐条通过。
    2. 默认显示项（设计 §10.2 第 15 项）有结论。
  - 怎么验证：
    - 人工走查和相关测试。
  - 对应需求：`requirements.md` 需求 C10
  - 对应设计：`design.md` §5.7

### 实机反馈补充

- [ ] 7.6 单次例程契约与调度
  - 状态：IN_REVIEW
  - 完成记录：加入 `once` 触发器、可选准备阶段、修订快照、单次执行去重、暂停/删除/改期竞态、worker 恢复与文件往返。隔离 PostgreSQL 迁移、准备失败或未结束、迟到补发、双扫描、正式阶段交付及旧例程回归通过。真实 bot 交办和部署迁移仍待所有者验收。
  - 这一步到底做什么：为 `UpdateRoutine` 和例程管理接口补充显式单次触发及可选准备时间。扩展例程定义、修订和执行记录，复用现有 worker 的调度、锁和入队事务。
  - 做完你能看到什么：bot 保存约定时间，例程保存可回读的运行历史，改期、暂停或取消生效。
  - 先依赖什么：7.2
  - 开始前先看：[需求 A11.1、A11.4](requirements.md#需求-a11单次安排与事前准备)、[设计 §3.10](design.md#310-单次安排与事前准备)。
  - 主要改哪里：`packages/contracts/src/index.ts`、`packages/db/prisma/schema.prisma`、`packages/messaging/src/routines.ts`、`packages/messaging/src/automation-trigger.ts`、`packages/messaging/src/automation-files.ts`、`apps/worker/src/worker.ts`。
  - 这一步先不做什么：旧例程继续按原触发定义运行，单次转换只随所有者明确修改生效。
  - 怎么算完成：带偏移的时间可创建、查询、改期及回读，准备时间校验通过。控制时钟测试覆盖未到点、恢复补发、双扫描去重、旧正式回合已入队时改期后只有新修订能领取，以及准备未结束时正式阶段按时分发。旧 cron、间隔、事件和例程文件回读的测试通过。
  - 怎么验证：契约和文件往返单测，隔离库实际迁移 SQL、改期与取消竞态、worker 领取和恢复集成测试。
  - 对应需求：`requirements.md` 需求 A11.1、A11.4、D1 至 D3
  - 对应设计：`design.md` §2.5、§3.10

- [ ] 7.7 桌面目标管理和日历展示单次安排
  - 状态：IN_REVIEW
  - 完成记录：目标管理加入「即将执行」和「已排期目标」详情，日历默认加入 `scheduled_once`，两处使用同一目标详情和 bot 标识，准备阶段不单独生成日历项。目标详情负责改期、暂停、恢复、取消、建议请求和历史结果，例程编辑器不承载运行建议操作。旧服务端缺少该来源时自动降级。接口、迁移、桌面组件和中英文聚焦测试通过，真实桌面走查仍待所有者验收。
  - 这一步到底做什么：在目标管理增加默认可见的「即将执行」，在日历加入默认开启的单次安排来源。两处都链接到同一例程详情。
  - 做完你能看到什么：安排后马上能看到负责 bot、正式时间和状态。改期或取消后刷新，两处显示一致。
  - 先依赖什么：7.3、7.4、7.6
  - 开始前先看：[需求 A11.2、C10.4](requirements.md#需求-a11单次安排与事前准备)、[设计 §3.10](design.md#310-单次安排与事前准备)。
  - 主要改哪里：`packages/contracts/src/task-overview.ts`、`apps/server/src/services/activity-service.ts`、`apps/server/src/services/schedule-service.ts`、`apps/desktop/src/renderer/components/outcomego/outcomes/`。
  - 这一步先不做什么：首批交付桌面视图。日期调整复用例程详情，正式目标及各视图采用原有的管理入口。
  - 怎么算完成：单次安排按正式时间展示，两处指向同一例程，准备阶段不另成日历条目。验证从等待到准备、改期、取消与完成的显示，核对周期例程不进单次分组、旧服务端降级、ICS 订阅类型兼容和中英文文案。
  - 怎么验证：日程与活动接口集成测试，桌面默认筛选、去重、状态和跳转组件测试，真实桌面人工走查。
  - 对应需求：`requirements.md` 需求 A11.2、A11.4、C10.4 至 C10.6
  - 对应设计：`design.md` §2.3、§3.10、§5.7

- [ ] 7.8 按上下文准备、交付与实机验收
  - 状态：IN_REVIEW
  - 完成记录：补充通用单次安排工具契约和提示词，准备回合只读且禁止 `WakeParent`，正式回合只消费当前修订简报，并通过后台父回合送达提醒。运行结果与消息送达分开记录，资料不可用时仍可发送正式提醒。工具、提示词、worker 交付和隔离集成测试通过，真实 bot 对话、远端 computer 同步和实机收件仍待所有者验收。
  - 手动入口验证：桌面组件和客户端测试覆盖原生单次与固定日期 Cron 的入口、状态、结果和重试。隔离数据库测试覆盖接口、只读领取、当前修订简报、改期失效和正式分发。实机打开「目标管理 → 即将执行」中的未来安排，点击「生成运行建议」，核对结果中的依据和待确认项，再等正式时间验证主对话提醒。
  - 这一步到底做什么：给 bot 提供通用单次安排说明，按交办范围选择资料和准备时机。串起当前修订的准备结果、到点执行和主对话交付。
  - 做完你能看到什么：在目标管理的「已排期目标」中管理单次安排生命周期。即使未配置自动准备，也可点击「生成运行建议」并查看状态、资料依据与待确认项。实际分析由规划 Bot 通过 pi agent 执行。
  - 先依赖什么：7.6、7.7
  - 开始前先看：[需求 A11.3、A11.5、A11.6](requirements.md#需求-a11单次安排与事前准备)、[设计 §3.10](design.md#310-单次安排与事前准备)、[单次安排示例](docs/20261125-单次安排与准备示例.md)。
  - 主要改哪里：`packages/contracts/src/tool-contracts.ts`、`packages/messaging/src/platform-system-prompt.ts`、`packages/messaging/src/automation-results.ts`、`apps/worker/src/worker.ts`。
  - 这一步先不做什么：复用已授权的资料与现有对外操作流程，首批由所有者接收结果和建议。
  - 怎么算完成：两组不同占位输入共用一条路径。准备失败、过时或资料不足时仍送达提醒，改期后旧结果不用于交付，提醒送达与事项完成分别表达。检查实现和提示词只使用通用语义，提前量由 bot 推理，所有提示词变体保持阶段 0 基线限长。
  - 怎么验证：工具与提示词测试、准备结果隔离和交付集成测试、真实 bot 加桌面走查。真实对话及需要的远端同步重建按 [远端验证清单](docs/20261125-远端验证清单.md) 安排并记录证据。
  - 对应需求：`requirements.md` 需求 A11.1 至 A11.6、D1 至 D4、非功能 6
  - 对应设计：`design.md` §2.5、§3.6、§3.10、§9.4

- [ ] 7.9 目标与任务主动巡检
  - 状态：IN_REVIEW
  - 完成记录：加入目标和任务巡检字段、`inspection` 目标线程用途、手动分析接口、自动截止窗口扫描、修订级手动抑制和巡检策略设置。桌面目标详情提供目标与任务的“立即分析”入口，并展示手动和自动分析结果。自动巡检复用 reviewer Bot，只读分析并通过目标线程保存结果。改期会清除当前巡检标记，自动回合领取前会核对修订、截止时间和手动回合。
  - 这一步到底做什么：在目标或任务接近截止时间时主动分析当前状态，允许所有者手动执行分析，并让手动分析抑制当前修订的自动分析。
  - 先依赖什么：4.7、7.6、7.7
  - 主要改哪里：`packages/db/prisma/schema.prisma`、`packages/messaging/src/outcome-inspections.ts`、`packages/messaging/src/outcome-threads.ts`、`apps/server/src/services/outcome-thread-service.ts`、`apps/server/src/routes/outcome.ts`、`apps/worker/src/worker.ts`、`apps/desktop/src/renderer/components/outcomego/outcomes/detail/outcome-detail.tsx`。
  - 怎么算完成：手动分析立即入队；自动扫描对当前目标或任务修订最多入队一次；完成、取消、关闭对象不再巡检；手动分析后当前修订跳过自动巡检；新修订可以重新进入自动巡检；排队中的自动回合在手动分析后不会被 Worker 领取。
  - 怎么验证：隔离数据库迁移、目标和任务自动扫描、手动接口幂等、修订抑制、截止窗口、改期清除、Worker 领取前复核、只读工具面和桌面详情测试。已通过 `packages/messaging/test/outcome-inspections.integration.test.ts`、`apps/worker/test/outcome-inspection.integration.test.ts`、`packages/db/test/outcome-inspection-migration.integration.test.ts` 及 `apps/desktop/test/outcome-detail.test.ts`、`apps/desktop/test/outcome-workspace-navigation.test.tsx`。
  - 对应需求：`requirements.md` 需求 A12.1 至 A12.7、D3、E2
  - 对应设计：`design.md` §3.11、§2.6、§2.7

---

## 阶段 8：ICS 订阅与外部日历叠加

- [ ] 8.1 订阅令牌与 feed 端点
  - 状态：IN_REVIEW
  - 完成记录：服务端测试覆盖令牌仅保存 SHA-256 摘要、所有者隔离、并发轮换、旧地址撤销、GET 限制、限流、日志脱敏和 ICS 时间范围。iCalendar 单元测试覆盖 UID、跨夏令时的当地日期、转义、UTF-8 折行和默认内容。隔离 schema 执行真实迁移 SQL，验证保留已有所有者行、唯一索引和外键。限流、脱敏、外部事件排除、折行与唯一索引经变异验证。
  - 没有验证：真实日历应用订阅和部署反向代理的访问日志。无登录部署的订阅用空 `userId` 表示本地所有者，开启链接时使用已有的目标深链。完整迁移链保留已知 `P3018` 基线问题，本次使用隔离 schema 验证新增 SQL。
  - 这一步到底做什么：新增订阅令牌表、管理接口和公开的 `.ics` 输出，带限流和日志脱敏。
  - 做完你能看到什么：用一个地址就能在日历应用里订阅；撤销后立刻失效。
  - 先依赖什么：7.5
  - 开始前先看：
    - `requirements.md` 需求 C11、非功能 4
    - `design.md` §5.8、§5.10、§5.11、§8.8
    - `apps/server/src/main.ts`（自动化 webhook 的路由先例）
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/<时间戳>_add_calendar_feed/`（新）
    - `apps/server/src/services/`（新增 `CalendarFeedService`）、`apps/server/src/main.ts`
  - 这一步先不做什么：不包含外部日历事件，不做管理界面。
  - 怎么算完成：
    1. 令牌明文只在创建时返回一次，库里只有哈希。
    2. 撤销、轮换后旧地址 404；无效令牌与不存在响应一致。
    3. 默认输出不含描述和应用链接；限流生效；日志里令牌被脱敏。
    4. 输出范围为今天前 30 天到后 180 天，UID 稳定。
  - 怎么验证：
    - 服务端集成测试和 iCalendar 单元测试；用真实日历应用手动订阅验收。
  - 对应需求：`requirements.md` 需求 C11.1 至 C11.7
  - 对应设计：`design.md` §5.8、§5.10、§5.11

- [ ] 8.2 订阅管理界面
  - 状态：IN_REVIEW
  - 完成记录：目标管理设置页新增日历分组，支持创建、命名、选择条目类型、复制创建时一次性返回的地址、撤销和轮换；撤销与轮换有二次确认。
  - 没有验证：真实日历应用订阅和反向代理访问日志。
  - 这一步到底做什么：在目标管理设置页的"日历"分组里创建、命名、选择条目类型、复制地址、撤销和轮换订阅（需求 E2.7）。
  - 做完你能看到什么：不用命令行就能管理订阅。
  - 先依赖什么：8.1
  - 开始前先看：
    - `requirements.md` 需求 C11.1、C11.3
    - `design.md` §5.11
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/settings/`
    - `apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不做团队共享。
  - 怎么算完成：
    1. 明文地址只显示一次，并提示妥善保存。
    2. 撤销和轮换有二次确认。
  - 怎么验证：
    - 组件测试；人工走查。
  - 对应需求：`requirements.md` 需求 C11.1、C11.3、C11.4
  - 对应设计：`design.md` §5.11

- [ ] 8.3 外部日历叠加可行性验证
  - 状态：IN_REVIEW
  - 完成记录：本地代码与隔离数据库验证确认宿主能在无 bot 回合时按连接 ID 调用日历读取工具，两组连接夹具和模拟 401 均通过。详见[外部日历叠加验证结论](docs/20261125-外部日历叠加验证结论.md)。
  - 没有验证：真实测试账号的 OAuth 读取和授权失效。验收步骤及需所有者批准的范围已记录，8.4 的启动仍待此项验收。
  - 这一步到底做什么：验证宿主能否在没有 bot 回合时调用 `google-calendar` 插件的读取工具，并确认账号选择和授权失效的表现。
  - 做完你能看到什么：一份结论写进 `docs/`：可行，或不可行及原因。
  - 先依赖什么：7.5
  - 开始前先看：
    - `requirements.md` 需求 C12
    - `design.md` §5.9、§10.1
    - `specs/005.4-插件事件来源泛化/design.md`
    - `packages/plugins/google-calendar/README.md`
  - 主要改哪里：
    - `docs/`（验证结论）
  - 这一步先不做什么：不写正式实现；不引入 bot 定时轮询日历的替代方案。
  - 怎么算完成：
    1. 明确写出结论、证据和对账号绑定方式的发现。
    2. 若不可行，任务 8.4 标为 BLOCKED 并说明原因。
  - 怎么验证：
    - 在测试环境用一个测试日历账号实际调用一次读取。
  - 对应需求：`requirements.md` 需求 C12.5
  - 对应设计：`design.md` §5.9 第 5 步

- [ ] 8.4 外部日历叠加实现
  - 状态：IN_REVIEW
  - 完成记录：按 8.3 离线可行性结论固定只读调用 `list_calendars` 与 `list_events`，支持账号、日历和只显示忙配置，外部事件失败时降级提示，事件不进入 ICS 客户端调用。
  - 没有验证：真实 Google OAuth、远端 computer 和真实第三方授权撤销。
  - 这一步到底做什么：按验证结论实现只读叠加：选择账号和日历，显示事件，可选只显示"忙"，授权失效时降级；账号、日历和只显示"忙"的设置放在目标管理设置页的"日历"分组。
  - 做完你能看到什么：日历里能同时看到外部日程，并且不会被写回、不会被 bot 读取、不会进入订阅。
  - 先依赖什么：8.3
  - 开始前先看：
    - `requirements.md` 需求 C12
    - `design.md` §5.9、§5.11、§8.8
  - 主要改哪里：
    - `apps/server/src/services/`、`apps/server/src/routes/`
    - `apps/desktop/src/renderer/components/outcomego/outcomes/calendar/`
  - 这一步先不做什么：不写入外部日历，不落库缓存。
  - 怎么算完成：
    1. 只调用读取类工具；缓存只在内存，不超过 5 分钟。
    2. 外部日历失败时其余条目照常显示。
    3. 订阅输出里没有叠加事件。
  - 怎么验证：
    - 降级测试、订阅输出检查、人工走查。
  - 对应需求：`requirements.md` 需求 C12.1 至 C12.4、C11.7
  - 对应设计：`design.md` §5.9、§5.11

### 阶段检查

- [ ] 8.5 阶段 8 检查点
  - 状态：TODO
  - 这一步到底做什么：确认订阅和叠加符合隐私边界。
  - 做完你能看到什么：令牌只存哈希，撤销即失效，叠加只读且不外泄。
  - 先依赖什么：8.1 至 8.4
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 设计 §8.8 的属性有测试覆盖。
    2. 8.3 的结论已回写，BLOCKED 项原因清楚。
  - 怎么验证：
    - 安全相关测试和人工走查。
  - 对应需求：`requirements.md` 需求 C11、C12
  - 对应设计：`design.md` §8.8

---

## 阶段 9：移动端

- [ ] 9.1 移动端待办与"需要我"中的四个操作（首批，已确认）
  - 状态：IN_REVIEW
  - 这一步到底做什么：在 Android 和 iOS 上，把"需要我"里的待办和建议显示出来，并支持接受、延后、忽略和完成。
  - 做完你能看到什么：在路上就能处理待办和分诊建议。
  - 先依赖什么：6.10
  - 开始前先看：
    - `requirements.md` 需求 B11
    - `design.md` §4.11、§10.2 第 8 项（已确认）
    - `specs/004.4-现实任务与知识资料闭环/requirements.md`（移动端写操作的原限制）
    - `specs/004.6-移动端全功能Outcome管理/requirements.md`
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/`
    - `apps/ios/Sources/App/`
  - 这一步先不做什么：不提供回执上传，不提供创建待办；不放宽其他移动端写操作；不做活动列表和议程（任务 9.2）。
  - 怎么算完成：
    1. 四个操作都可用，且与桌面端状态一致。
    2. 对 004.4 的例外只限待办这四项，其余移动端写操作的范围不变。
  - 怎么验证：
    - 各平台现有的测试方式；真机验证按 004.9 的移动端真机记录办理。
  - 已验证：Android 调试包与单测、iOS Swift 核心单测与源码语法检查、待办后端集成测试。两端契约测试覆盖四个操作及修订号。
  - 没有验证：真机界面及与桌面端的实际状态一致性。iOS App 完整编译受基线错误阻塞。详见[会话 H 验证记录](docs/20261125-偏差记录-mobile.md)。
  - 对应需求：`requirements.md` 需求 B11.1 至 B11.4
  - 对应设计：`design.md` §4.11

- [ ] 9.2 移动端活动与议程（只读，可选）
  - 状态：TODO
  - 这一步到底做什么：在 Android 和 iOS 上增加只读的活动列表，以及今天起 14 天的议程。
  - 做完你能看到什么：手机上能看到 bot 在做什么和近期安排，点击进入现有详情。
  - 先依赖什么：4.7、7.5
  - 开始前先看：
    - `requirements.md` 需求 A10、C13
    - `design.md` §3.9、§5.7 第 7 步
    - `specs/004.6-移动端全功能Outcome管理/requirements.md`
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/`
    - `apps/ios/Sources/App/`
  - 这一步先不做什么：不做甘特图，不做写操作。
  - 怎么算完成：
    1. 复用活动与日程查询接口，不新增服务端接口。
    2. 点击条目打开现有对话、目标或任务详情。
  - 怎么验证：
    - 各平台现有的测试方式。
  - 对应需求：`requirements.md` 需求 A10.1、A10.2、C13.1 至 C13.3
  - 对应设计：`design.md` §3.9、§5.7

---

## 最终检查

- [ ] 10.1 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认这个 Spec 真的达到交付标准。
  - 做完你能看到什么：需求、设计、任务、验证证据能一一对上。
  - 先依赖什么：阶段 0 至 8 和任务 9.1 全部完成（任务 9.2 为可选）
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`、`docs/`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. 每个需求的验收标准都有测试或明确的人工验收记录。
    2. 延期项、取消项和 BLOCKED 项都写清了原因。
    3. 待确认项（设计 §10.2）已有结论。
    4. 现有 Outcome 相关测试保持通过，基础提示词总长度不超过阶段 0 的基线。
  - 怎么验证：
    - 按 Spec 验收清单逐项核对。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
