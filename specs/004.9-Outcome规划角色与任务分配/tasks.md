# 任务清单 - Outcome 规划角色与任务分配（人话版）

状态：Draft

## 这份文档是干什么的

让人快速知道：先做什么、每一步改什么、做完怎么判断完成。本清单现在只是规划，用户确认 `requirements.md`、`design.md` 前不开始任何实现。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住（必须写清楚卡在哪里）
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了（必须写原因）

规则：只有 `状态：DONE` 才能勾选 `[x]`；每做完一个任务立刻更新这里。

## 验证约定

- 服务端、消息、契约：只跑改动相关的聚焦测试，不跑全仓检查。
- 涉及 `packages/contracts` 的改动，同步并重建远端 computer 后才在 bot 侧生效，见 5.2。
- iOS 只能做语法检查（无完整 Xcode），需要真机验证的写明"待真机"。

---

## 阶段 0：先核实再动手

- [x] 0.1 核实设计里依赖的现状
  - 状态：DONE
  - 这一步到底做什么：只读代码，逐项确认设计里标注"落地前核对"的假设，结果写进 `docs/20261121-核实记录.md`，有出入的回头改 `design.md`。第 12、13、14 项决定方案能否落地，先做；不通过就回头改设计，再往下做。第 1、3、4、9 项在第二轮复核时已核实，结论直接回写记录。
  - 做完你能看到什么：一份带 `文件:行号` 的核实记录，设计里的待确认项被消掉或改写。
  - 先依赖什么：无
  - 开始前先看：
    - `design.md` §4.2、§8.1、§8.2
    - `requirements.md` 需求 4、需求 5
  - 主要改哪里：
    - `specs/004.9-Outcome规划角色与任务分配/docs/20261121-核实记录.md`（新增）
  - 要核实的事项：
    1. 目标管理设置：已确认存放在全局 `featureSettings` 行（`id = "global"`，`packages/messaging/src/feature-settings.ts`，现有 `outcomesEnabled`、`streamBotReplies`）；核实读写接口、客户端契约和桌面 hook 的位置，并确认新增字段全部可选、旧客户端不受影响（`apps/server/src/app-service.ts`、`apps/server/src/routes/client.ts`、`apps/desktop/src/renderer/hooks/use-feature-settings.ts`）。
    2. 等待依赖的任务直接用 `queued` 加待处理排队记录（`enqueueOutcomeTurn` 的依赖检查，`outcome-threads.ts:63-66`，已读过代码确认存在）：核实目标状态派生、任务看板（004.7）、恢复（004.5）不会把"`queued` 且 `rootRunId` 为空的等待任务"误判为卡死或超时。
    3. （已核实）`recomputeOutcomeStatus`（`outcome-state.ts:143-201`）：没有活跃任务且有任一任务 `completed` 时进入 `review_pending`（`:167-170`），所以"一个任务失败、其余完成"会被当成待验收；`queued`、`needs_review` 算活跃（`:16`）；`planning` 只在修订为草稿或待批准时生效（`:182`）。据此确定了设计 §4.2 的失败任务规则（已由用户确认，§8.3）。
    4. （已核实）`GetOutcome`、`ListOutcomes` 不按 bot 过滤（`outcome-chat-tools.ts:170-197`），本 Spec 不新增可见性限制。仍需盘点 `Outcome.botId` 在列表、通知、桌面端展示里的使用点，确认"提交 bot 与执行 bot 不同"时没有展示错误。
    5. `CreateOutcome` 聊天路径现在怎么写契约，改成 `SubmitOutcome` 的影响面。
    6. 可指派 bot 清单可以取哪些字段（`Bot.name`、`Bot.description`、状态），以及"可运行"的判断函数。
    7. `outcome.review.required` 事件（`outcome-threads.ts` 约 `:187-200`）抽成共享函数的可行性，以及它和 `OutcomeEvidenceConsumer`（`outcome-evidence-consumer.ts:41-43`）的关系。
    8. `ReportOutcomeProgress` 是否限制只能写自己的任务（`apps/server/src/services/outcome-progress-tool.ts`）。
    9. （已核实）线程回合的租约 scope 是 `outcome-thread:<id>`（`worker.ts:1647`），不被 `outcome:`、`automation:` 计数覆盖（`worker.ts:1447-1450`），线程回合现在没有按 bot 的并发上限，"5"是新增上限。仍需评估 `OUTCOMEGO_WORKER_CONCURRENCY`（默认 8，`worker.ts:632`）与 5 + 5 的关系，写进核实记录由用户决定。
    10. `recomputeOutcomeStatus` 能否加入"任务 `completed` 但还有未结束的 `review_task` 回合或返工任务时保持 `running`"的规则；修改未开始任务时，待处理排队记录（`outcome-turn:<id>` 幂等记录里的输入）如何同步。
    11. 审查 bot 能读取哪些类型的产出：`OutcomeOutput` 的 `final_result` 与 `file` 类型、`contentRef` 如何解析、文档、表格、PDF、图片等非文本文件能否读取；读不了的产出，审查 bot 的处理方式（标 `unclear`，不驳回）；以及 004.4 资料引用和人工回执证据的读取方式。
    12. 目标线程回合（`outcome_thread`）里规划角色和审查角色能否使用 `RecallMemory`、`UpdateMemory`、`ReadTranscript`、`ReadAgentActivity`（工具在这类回合是否可见）；目标线程的对话是否进入记忆学习（`memory-learning.ts`）；`ReadTranscript` 读另一个 bot 时的现有限制（`read-transcript.ts`：只返回可见消息，不含工具数据，已脱敏）能否满足"读提交 bot 的对话"。结论决定提示词里依赖这些工具的部分是否需要在目标线程回合显式开放。
    13. 按回合覆盖模型的可行性：`worker.ts:1895-1920` 的 `selectedInference` 能否按回合选择；独立模型的提供方凭据能否按 `providerId` 取到（`apps/computer` 的凭据解析、`credentialScopeId`），是否与全局提供方共用同一套配置；`formatPiModelRef` 对不同提供方的兼容性；"已配置可用的模型"列表从哪里取（`settings-service.ts`、模型设置页）；`ExecutorProfile`（`packages/contracts/src/task-configuration.ts`，目前 `selectTaskConfiguration` 实际不使用它）能否复用为角色模型的选择来源。
    14. 每个 bot 单独设置模型的可行性：(a) `Bot.inferenceProvider` / `inferenceModel` 两列现有数据是否全为空（决定迁移是否要清空）；(b) 这两列的所有读写点（已知 worker 只写 `Run`、没有读取，需全仓确认，含移动端客户端契约）；(c) bot 更新接口（`apps/server/src/routes/conversation.ts:42` 的 `app.updateBot`）与桌面端 bot 设置界面的位置；(d) `UpdateProfile` 与每个 bot 的 `settings.json`（`agent-data.ts` 约 `:423`、`:1221`）的文件导入逻辑是否会让 bot 或文件编辑改到模型字段，不能的话如何排除；(e) 运行回退到下一级时在哪里留标注（运行事件还是回合记录）；(f) 后台一次性推理（`worker.ts:568`、`outcome-inference.ts`）没有 bot 上下文，确认保持全局。
  - 这一步先不做什么：不改任何源码。
  - 怎么算完成：
    1. 上面 14 项都有结论和出处。
    2. 与设计不一致的地方已经回写 `design.md`，并在 §8.2 里标注。
  - 怎么验证：人工走查核实记录与 `design.md` 的差异。
  - 对应需求：`requirements.md` 需求 1、4、5、6、7
  - 对应设计：`design.md` §4.2、§8.1、§8.2

---

## 阶段 1：数据与契约

- [x] 1.1 数据库字段与迁移
  - 状态：DONE
  - 这一步到底做什么：按 `design.md` §3.2.3 增加字段与枚举值（含 `review_task` 用途与回合的 `model`、`workItemId`、`result`；全局 `featureSettings` 行的 `plannerBotId`、`reviewerBotId`、`plannerModel`、`reviewerModel`、`environmentNote`；修订 `plan` 的 `{ notes, tasks }` 结构），线程唯一约束改为 `(outcomeId, role)`；`Bot` 新增 `inferenceReasoning`（Bot 模型的推理强度，见 `design.md` §3.2.4）。
  - 做完你能看到什么：`prisma generate` 通过，迁移与 schema 一致，现有线程数据默认成为规划线程。
  - 先依赖什么：0.1
  - 开始前先看：
    - `design.md` §3.2.3、§4.1
    - `requirements.md` 需求 3、7
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`
    - 迁移文件
  - 这一步先不做什么：不改服务代码；不新增 `OutcomeStatus` 或 `OutcomeWorkItemStatus` 值，不新增驳回专用字段。
  - 怎么算完成：
    1. 新字段 `plan`、`planKey`、线程 `role`、回合 `model`、`workItemId`、`result`，设置行的角色与环境说明字段，`Bot.inferenceReasoning`，以及用途 `replan`、`review`、`review_task` 都已建好。
    2. 现有 004.8 的测试在不改语义的前提下仍然通过。
  - 怎么验证：
    - `prisma generate`；`packages/db` 与 `packages/messaging` 的聚焦测试。
  - 对应需求：`requirements.md` 需求 3.1、3.6、7.3、9.5
  - 对应设计：`design.md` §3.2.3、§4.1

- [x] 1.2 契约与工具定义
  - 状态：DONE
  - 这一步到底做什么：在 `packages/contracts` 增加 `PlanTask`（含必填、无默认值的 `nature`）、`SavePlan`（含可选的规划说明 `notes`）、`SubmitOutcome`、`SubmitPrereview`、`ReviewTaskResult`（含 `Finding`：类型、依据、理由）的输入输出结构、错误码，角色设置字段（含模型与环境说明），设计 §3.3.10 的客户端读取契约（`OutcomeDetail` 的 `plan`、任务 `nature` 与 `review`、`prereview`，线程接口的 `reviewTurns`），设计 §3.3.11 的新事件主题（注册进 `OUTCOME_EVENT_TOPICS`），以及按回合用途区分的目标线程工具清单（设计 §3.3.9）；turn 请求带回合用途，计算机侧据此过滤。
  - 做完你能看到什么：契约包类型检查通过，规划线程、审查线程、任务回合各自暴露的工具集合可以用测试断言。
  - 先依赖什么：1.1
  - 开始前先看：
    - `design.md` §3.2.2、§3.3.1–§3.3.4
    - `requirements.md` 需求 5.3、7.2、9.1
  - 主要改哪里：
    - `packages/contracts/src/outcome-chat.ts`
    - `packages/contracts/src/tool-contracts.ts`
    - `packages/contracts/src/index.ts`
    - `packages/contracts/src/outcome-thread.ts`、`packages/contracts/src/outcomes.ts`（读取契约、事件主题）
    - `packages/contracts/src/service-protocol.ts`（turn 请求的 `goalThread` 带用途）
    - `apps/computer/src/runtime/tools.ts`（`goalThreadToolDefinitions` 按用途过滤）
  - 这一步先不做什么：不实现工具的服务端逻辑；不加 `RequestReplan` 之类设计里没要求的工具。
  - 怎么算完成：
    1. 任务回合里没有 `SaveOutcomeContract`、`SavePlan`、`SubmitPrereview`、`ReviewTaskResult`；审查线程里没有契约与计划工具；整体初验回合没有 `ReviewTaskResult`，任务级审查回合没有 `SubmitPrereview`。
    2. `PlanTask` 的长度、数量上限在契约里体现。
    3. 新事件主题已注册；读取契约的新字段全部可选。
    4. 规划线程、审查线程的工具集合里没有 Decision、凭据类工具（需求 11.6）。
  - 怎么验证：
    - `npx tsc -b packages/contracts`；工具清单的单元测试；`apps/computer` 的工具过滤聚焦测试。
  - 对应需求：`requirements.md` 需求 3、5.3、7.2、8.1、9.1、9.4、10.11、11.6
  - 对应设计：`design.md` §3.1、§3.2.2、§3.3

- [x] 1.3 每个 bot 单独设置模型：字段、接口与选模型
  - 状态：DONE
  - 这一步到底做什么：启用 `Bot.inferenceProvider` / `inferenceModel`（现有两列，无读写）；bot 更新接口接受 `model`（用户身份，校验模型可用，可清空）；worker 创建运行时按优先级选模型（子 agent 沿用父运行 > 角色回合独立模型 > Bot 模型 > 全局），写入 `Run` 现有的模型字段；不可用时逐级回退并留标注；模型字段不能被 bot 通过 `UpdateProfile` 或编辑 `settings.json` 改动；迁移时清空非空旧值（若 0.1 第 14 项发现有）。
  - 做完你能看到什么：给 bot A 设一个模型、bot B 不设，两个 bot 的运行分别记录各自的模型；清空后回到全局模型；bot 改不了任何 bot 的模型。
  - 先依赖什么：0.1、1.1
  - 开始前先看：
    - `requirements.md` 需求 13
    - `design.md` §2.3.12、§3.2.4、§3.3.8、§6.15
    - `docs/20261121-核实记录.md`（0.1 第 13、14 项）
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`（`Bot`）
    - `apps/worker/src/worker.ts`（约 `:1895-1920` 的 `selectedInference`）
    - `apps/server/src/routes/conversation.ts` 与 bot 更新服务、`packages/contracts` 的 bot 更新输入
    - `packages/messaging/src/agent-data.ts`（`settingsDocument` 与文件导入）
  - 这一步先不做什么：不做桌面端界面（6.5）；不改后台一次性推理（记忆整理、成果简报）；不做按目标或按任务覆盖；不实现角色模型（2.5）。
  - 怎么算完成：
    1. 优先级正确：子 agent、角色回合、Bot 模型、全局各一条测试；某一级不可用时逐级回退并有标注。
    2. 运行创建后修改设置，不改变该运行已记录的模型。
    3. 更新接口只接受用户身份，模型不可用被拒；`UpdateProfile` 与 `settings.json` 改不了模型字段。
    4. 没有任何 bot 设置模型时，所有运行用全局模型，现有测试不改语义。
  - 怎么验证：
    - worker 选模型、更新接口的聚焦测试；`npx tsc -b packages/contracts`。
  - 对应需求：`requirements.md` 需求 13.1–13.6、13.8–13.10
  - 对应设计：`design.md` §2.3.12、§3.2.4、§3.3.8、§6.15

---

## 阶段 2：规划角色

- [x] 2.1 角色设置与解析
  - 状态：DONE
  - 这一步到底做什么：保存规划 bot、审查 bot、各自的独立模型（校验已配置可用，需求 1.8）、环境说明（上限 8000 字）设置，提供 `resolveRole`：返回线程 bot 或"回退"。
  - 做完你能看到什么：设置后新线程用规划 bot；bot 被删或不可运行时回退，不报错。
  - 先依赖什么：0.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.3.1、§3.2.1、§3.3.4
  - 主要改哪里：
    - 目标管理设置的存放与接口（以 0.1 的结论为准）
    - `apps/server/src/services/`（新增角色解析，落地时核对命名）
  - 这一步先不做什么：不做每个目标单独覆盖；不做已有线程的切换。
  - 怎么算完成：
    1. 设置的校验（bot 可运行、模型可用、环境说明长度）与回退都有测试。
    2. 开关关闭时没有角色相关的入口与工具。
  - 怎么验证：
    - 服务端聚焦测试。
  - 对应需求：`requirements.md` 需求 1.1–1.5
  - 对应设计：`design.md` §2.3.1、§3.2.1、§3.3.4

- [x] 2.2 线程角色与回合用途
  - 状态：DONE
  - 这一步到底做什么：线程按角色创建，线程 bot 不再强制等于目标 bot；回合用途增加 `replan`、`review`、`review_task`；`OutcomeThreadService` 的 `upsert` 键改为 `(outcomeId, role)`；`OutcomeThreadTools.execute` 按回合用途校验工具白名单（设计 §3.3.9），turn 请求带用途让计算机侧同样过滤；`replan` 不改变目标状态。
  - 做完你能看到什么：一个目标可以同时有规划线程和审查线程，各自绑定自己的 bot。
  - 先依赖什么：1.1、2.1
  - 开始前先看：
    - `requirements.md` 需求 2、6、7
    - `design.md` §2.2、§3.2.3、§4.2
  - 主要改哪里：
    - `apps/server/src/services/outcome-thread-service.ts`
    - `packages/messaging/src/`（线程回合与状态派生）
  - 这一步先不做什么：不实现 `SavePlan`；不触发审查回合。
  - 怎么算完成：
    1. 未设置角色时线程创建行为与 004.8 一致。
    2. 回合失败后目标状态由事实重新派生，不停在 `planning`。
    3. 审查回合调 `SaveOutcomeContract`、任务级审查回合调 `SubmitPrereview`、规划回合调 `ReviewTaskResult` 等越权调用被服务端拒绝（403）。
  - 怎么验证：
    - `apps/server`、`packages/messaging` 的线程服务与状态派生聚焦测试。
  - 对应需求：`requirements.md` 需求 2.3、6.4、7.2、9.5、10.2
  - 对应设计：`design.md` §2.2、§4.2、§6.7、§6.8

- [x] 2.3 `SavePlan` 保存与校验
  - 状态：DONE
  - 这一步到底做什么：实现 `SavePlan`：批准前整体替换，校验重复 key、缺失依赖、成环、bot 不可运行、验收项未覆盖、数量上限、缺少任务性质（`nature`）、规划说明超过 2000 字，保存到修订的 `plan`（`{ notes, tasks }`）。
  - 做完你能看到什么：规划角色能为待批准修订保存计划，错误会指出具体的任务 key。
  - 先依赖什么：1.2、2.2
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3.3、§3.2.2、§3.3.2
  - 主要改哪里：
    - `apps/server/src/services/outcome-thread-tools.ts`
    - `apps/server/src/services/`（新增计划校验）
  - 这一步先不做什么：不处理批准后的差异调整（3.4）；不创建任务。
  - 怎么算完成：
    1. 计划不进入契约内容哈希，保存计划不要求重新批准。
    2. 回合结束没有计划时，详情提示"规划角色没有保存任务计划"。
  - 怎么验证：
    - `SavePlan` 单元测试：覆盖需求 3.2–3.5 的每一类错误与正常保存。
  - 对应需求：`requirements.md` 需求 3.1–3.7
  - 对应设计：`design.md` §2.3.3、§3.2.2、§3.3.2、§6.2

- [x] 2.4 提交目标：`SubmitOutcome` 与新建接口
  - 状态：DONE
  - 这一步到底做什么：已设置规划角色时，bot 对话里用 `SubmitOutcome` 提交用户原话；桌面、移动端新建与探索想法转目标走 `POST /api/outcomes/threads`，线程 bot 为规划 bot；已设置规划角色时，`CreateOutcome` 被服务端拒绝并提示改用 `SubmitOutcome`。
  - 做完你能看到什么：在任意 bot 里说一个目标，生成 `planning` 状态的目标和规划回合，bot 自己没有写契约。
  - 先依赖什么：0.1、2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.2、§3.3.1
  - 主要改哪里：
    - `apps/server/src/services/outcome-chat-tools.ts`
    - `apps/server/src/services/outcome-thread-service.ts`
    - `apps/server/src/services/explore-service.ts`
  - 这一步先不做什么：跟踪型目标不动；不删除未设置角色时的 `CreateOutcome` 路径。
  - 怎么算完成：
    1. 同一 `clientRequestId` 只创建一次。
    2. 已设置规划角色时，bot 调 `CreateOutcome` 被拒绝并提示改用 `SubmitOutcome`；未设置时仍可直接写契约。
  - 怎么验证：
    - 集成测试：提交 bot 与规划 bot 不同；未设置角色时与 004.8 一致。
  - 对应需求：`requirements.md` 需求 2.1–2.5
  - 对应设计：`design.md` §2.3.2、§3.3.1、§6.7

- [x] 2.5 角色回合并发上限与独立模型
  - 状态：DONE
  - 这一步到底做什么：（一）规划类、审查类回合按角色使用独立模型：创建回合时把当时的 `plannerModel` / `reviewerModel` 记录到回合上，worker 选模型时 `outcome_thread` 回合优先用它，模型不可用时回退到下一级（Bot 模型，再到全局模型）并在回合记录里标注；其余运行不变。（二）为 `outcome_thread` 回合增加按 bot、按角色的并发上限：规划类（`plan`、`owner_message`、`replan`）5 个，审查类（`review`、`review_task`）5 个，分别计数；执行任务的每 bot 并发 2 保持不变。
  - 做完你能看到什么：同一规划 bot 同时有 6 个目标在规划时，5 个运行，1 个排队；它作为执行 bot 的任务名额不受影响。
  - 先依赖什么：0.1、1.3、2.2
  - 开始前先看：
    - `requirements.md` 需求 1.6、1.7
    - `design.md` §2.3.1、§2.4、§8.1
    - `docs/20261121-核实记录.md`（0.1 第 9 项已核实：线程回合现在没有按 bot 的并发上限，这里是新增上限，不是提高）
  - 主要改哪里：
    - `apps/worker/src/worker.ts`（`:1417-1465` 的租约与限流）
    - `packages/messaging/src/outcome-threads.ts:73` 附近只确认执行任务计数不被影响，不改动其语义
  - 这一步先不做什么：不改 `OUTCOMEGO_WORKER_CONCURRENCY` 默认值（先在核实记录里给出建议，由用户决定）；不把上限做成用户可配置项。
  - 怎么算完成：
    1. 规划类与审查类各自最多 5 个同时运行，超出的保持排队，空出名额后自动继续。
    2. 执行任务并发上限仍为 2，且不统计规划与审查回合。
    3. 设置了独立模型的角色回合，`Run.inferenceProvider/Model/Reasoning` 记录的是该模型；同一个 bot 的主对话和其他运行仍用各自的生效模型（Bot 模型，未设置则全局模型）。
    4. 回合运行期间修改设置，不改变已创建回合的模型；所设模型不可用时回退到下一级并标注，不阻塞。
    5. 角色 bot 设为主 bot 时，回合上下文仍含主 bot 的 persona、个人记忆、共享记忆、技能（只是模型不同）。
  - 怎么验证：
    - worker 聚焦测试：并发计数、排队、名额释放、与执行任务互不占用。
  - 对应需求：`requirements.md` 需求 1.6、1.7、非功能 1.2
  - 对应设计：`design.md` §2.3.1、§2.4、§8.1

- [x] 2.6 规划与审查回合的环境上下文
  - 状态：DONE
  - 这一步到底做什么：规划类与审查类回合的上下文加入：环境说明、首个规划回合里提交 bot 的名称与 id（提示可用 `ReadTranscript` 读它的对话）、可指派 bot 清单（名称、id、描述、所用模型）、计划里的规划说明（审查回合）。执行任务回合不加环境说明。
  - 做完你能看到什么：新建一个全新的规划 bot，它的规划回合里能看到环境说明和可指派 bot；执行 bot 的任务回合里没有环境说明。
  - 先依赖什么：0.1、1.1、2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 12
    - `design.md` §2.3.11、§2.4、§6.13
    - `docs/20261121-核实记录.md`（0.1 第 12 项的结论决定工具是否需要显式开放）
  - 主要改哪里：
    - `packages/messaging/src/outcome-threads.ts`（`outcomeThreadContext`，约 `:295`；`outcomeRunContext` 只确认不改）
    - `packages/messaging/src/feature-settings.ts`（读取环境说明）
  - 这一步先不做什么：不新增读取其他 bot 私有记忆的能力；不复制主 bot 的对话历史；不把环境说明发给执行 bot。
  - 怎么算完成：
    1. 规划类与审查类回合上下文含环境说明；执行任务回合不含。
    2. 用户原话仍逐字送达。
    3. 环境说明超过 8000 字、规划说明超过 2000 字被拒。
  - 怎么验证：
    - 上下文构成的聚焦测试：各用途回合的段落断言、长度上限。
  - 对应需求：`requirements.md` 需求 12.1、12.2、12.4、12.6、12.7
  - 对应设计：`design.md` §2.3.11、§2.4、§6.13

### 阶段检查

- [x] 2.7 阶段 2 检查点
  - 状态：DONE
  - 这一步到底做什么：确认"提交 → 规划 → 保存契约与计划"这条链路在服务端站稳。
  - 做完你能看到什么：可以进入批准与执行，而不是带着结构问题继续。
  - 先依赖什么：2.1、2.2、2.3、2.4、2.5、2.6
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 阶段 2 的聚焦测试都通过。
    2. 已知缺口写进 `docs/`。
  - 怎么验证：人工走查，关键测试。
  - 对应需求：`requirements.md` 需求 1、2、3
  - 对应设计：`design.md` §2.3.1–§2.3.3

---

## 阶段 3：批准后的分配与执行

- [x] 3.1 批准时按计划创建任务
  - 状态：DONE
  - 这一步到底做什么：批准事务里读取计划并创建任务，无依赖的排队唤醒，有依赖的等待；无计划时保持原来的单个 initial 任务；幂等键改为 `planKey`。
  - 做完你能看到什么：批准一个含 3 个任务的计划，得到 3 个任务，只有无依赖的那个被唤醒。
  - 先依赖什么：2.7
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.4、§4.2
  - 主要改哪里：
    - `apps/server/src/services/outcome-service.ts`（现 `:291-303`）
  - 这一步先不做什么：不做依赖放行（3.2）；不改变批准权限。
  - 怎么算完成：
    1. 重复批准不重复创建、不重复唤醒。
    2. 无计划回退行为与 004.2 的测试一致。
  - 怎么验证：
    - 集成测试：有计划、无计划、重复批准。
  - 对应需求：`requirements.md` 需求 4.1–4.5
  - 对应设计：`design.md` §2.3.4、§6.2、§6.7

- [x] 3.2 依赖放行（含跨 bot）
  - 状态：DONE
  - 这一步到底做什么：任务结算后，同时挑选同一目标里依赖它、但指定了其他 bot 的排队任务（现有逻辑只挑同一个 bot 的）。依赖满足与否仍由 `enqueueOutcomeTurn` 的依赖检查判断，不新增任务状态。
  - 做完你能看到什么：A（bot X）完成后，B（bot Y）自动开始；A 失败时 B 不会被唤醒。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 4.2、4.3、4.6、非功能 2.2
    - `design.md` §2.3.5、§6.3
  - 主要改哪里：
    - `packages/messaging/src/outcome-threads.ts`（`dispatchQueuedOutcomeWorkItems` 约 `:104-130`、依赖检查 `:63-66`）
  - 这一步先不做什么：不处理失败后的重规划（3.4）；审查与返工门控在 4.6 加入，这里先不判断。
  - 怎么算完成：
    1. 跨 bot 的依赖放行有测试。
    2. 两个依赖并发完成时，下游任务只被唤醒一次。
    3. 依赖失败或取消时，下游保持等待。
  - 怎么验证：
    - 并发、失败、跨 bot 场景的聚焦测试。
  - 对应需求：`requirements.md` 需求 4.2、4.3、4.5、4.6
  - 对应设计：`design.md` §2.3.5、§6.3

- [x] 3.3 执行回合的上下文与可见性
  - 状态：DONE
  - 这一步到底做什么：任务被唤醒时带上任务指令、契约摘要、依赖产出摘要；被指派的非提交 bot 能读自己任务所在目标的事实（现状不按 bot 过滤，不新增限制）。
  - 做完你能看到什么：下游任务的 bot 能看到上游产出；执行 bot B 能 `GetOutcome` 它被指派的目标。
  - 先依赖什么：0.1、3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.5、§3.3.6
  - 主要改哪里：
    - `packages/messaging/src/`（任务回合的消息构造）
    - `apps/server/src/services/internal-tool-service.ts`、`outcome-chat-tools.ts`（只确认现状，不改可见性）
  - 这一步先不做什么：不新增领取工具；不改变 `ReportOutcomeProgress` 的行为。
  - 怎么算完成：
    1. 任务回合里没有规划与审查工具。
    2. 被指派的非提交 bot 能 `GetOutcome` 它的任务所在的目标。
  - 怎么验证：
    - 集成测试：可见性与工具集合断言。
  - 对应需求：`requirements.md` 需求 5.1–5.5
  - 对应设计：`design.md` §2.3.5、§3.1

- [x] 3.4 失败重规划与批准后调整
  - 状态：DONE
  - 这一步到底做什么：任务进入 `failed` / `needs_review` 时在 `transitionWorkItem` 里排队 `replan` 回合（覆盖恢复路径，不挂在 `settleOutcomeWorkItem` 上）；`recomputeOutcomeStatus` 按设计 §4.2 处理失败任务与被失败依赖阻塞的等待任务；批准后的 `SavePlan` 只允许新增，以及修改、移除未开始任务（`queued` 且 `rootRunId` 为空）；修改时先删除该任务待处理的排队记录，再以新 `clientId` 重新入队。
  - 做完你能看到什么：一个任务失败后，规划角色被唤醒，能改后续任务，改不了已开始的任务。
  - 先依赖什么：2.3、3.2
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §2.3.6、§3.3.2、§6.4、§6.6
  - 主要改哪里：
    - `packages/messaging/src/outcome-state.ts`（`transitionWorkItem` 约 `:55`、`recomputeOutcomeStatus` 约 `:143-201`）
    - `packages/messaging/src/outcome-threads.ts`
    - `apps/server/src/services/outcome-thread-tools.ts`
  - 这一步先不做什么：不让规划角色改动已排队、运行中、已结束的任务；不让系统触发的回合取消目标。
  - 怎么算完成：
    1. 锁定任务被改动时返回 `plan_task_locked`。
    2. 重规划回合结束后目标状态由事实重新派生。
    3. 状态规则：一个任务 `failed`、其余 `completed` 且无替代 → `failed`，不是 `review_pending`；`replan` 回合排队或运行时 → `running`；替代任务出现后可进入 `review_pending`；被失败依赖阻塞的等待任务不算推进中。
    4. 修改未开始任务后放行，不抛 `idempotency_conflict`，也不影响无关任务的结算。
    5. `needs_review` 从恢复路径进入时同样触发 `replan`。
  - 怎么验证：
    - 单元与集成测试：失败触发、调整、锁定、取消授权。
  - 对应需求：`requirements.md` 需求 6.1–6.6
  - 对应设计：`design.md` §2.3.6、§3.3.2、§4.2、§6.4、§6.6、§6.16

### 阶段检查

- [x] 3.5 阶段 3 检查点
  - 状态：DONE
  - 这一步到底做什么：用固定输入走一遍"批准 → 按依赖执行 → 失败重规划"。
  - 做完你能看到什么：一条服务端完整主链路。
  - 先依赖什么：3.1、3.2、3.3、3.4
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加审查角色。
  - 怎么算完成：
    1. 关键流程与异常路径有测试。
    2. 重启恢复场景已验证。
  - 怎么验证：集成测试、重启恢复测试。
  - 对应需求：`requirements.md` 需求 4、5、6
  - 对应设计：`design.md` §2.3.4–§2.3.6

---

## 阶段 4：审查角色

- [x] 4.1 整体初验的触发与审查线程
  - 状态：DONE
  - 这一步到底做什么：目标进入 `review_pending` 且已设置审查角色时，排队审查线程的 `review` 回合，同一修订、同一批产出只排一次；触发点挂在 `outcome.review.required` 事件上，该事件的发出逻辑抽成共享函数（4.6 也要用）。
  - 做完你能看到什么：任务全部完成并通过审查后，审查 bot 被唤醒做整体初验。
  - 先依赖什么：2.2、3.5
  - 开始前先看：
    - `requirements.md` 需求 7.1、7.2
    - `design.md` §2.3.7
  - 主要改哪里：
    - `packages/messaging/src/outcome-threads.ts`（约 `:187-200`）、`apps/server/src/services/outcome-evidence-consumer.ts`
  - 这一步先不做什么：不实现 `SubmitPrereview`（4.2）；不做任务级审查（4.5、4.6）。
  - 怎么算完成：
    1. 重复进入 `review_pending` 不重复排队。
    2. 审查回合里只有读取工具和 `SubmitPrereview`。
  - 怎么验证：
    - 集成测试：触发幂等、工具集合。
  - 对应需求：`requirements.md` 需求 7.1、7.2
  - 对应设计：`design.md` §2.3.7、§6.5

- [x] 4.2 `SubmitPrereview`
  - 状态：DONE
  - 这一步到底做什么：保存每项初验建议为 `ai_prereview` 证据，摘要与关注点写进回合 `result`；校验 `likely_fail` 只能用于必需验收项，`attention` 里不能出现优化项。
  - 做完你能看到什么：审查完成后，目标详情能读到摘要和每项建议。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 7.3、7.4
    - `design.md` §3.3.3、§6.5
  - 主要改哪里：
    - `apps/server/src/services/outcome-thread-tools.ts`
    - `apps/server/src/services/outcome-review-service.ts`（复用 `:289-290` 的证据格式）
  - 这一步先不做什么：不写 `OutcomeReview`，不改目标状态。
  - 怎么算完成：
    1. 每条验收项恰好一个结果，缺项返回 `prereview_incomplete`。
    2. 审查回合不产生 `OutcomeReview`。
  - 怎么验证：
    - 单元测试：完整性、修订过期、只产生 `ai_prereview` 证据。
  - 对应需求：`requirements.md` 需求 7.3、7.4
  - 对应设计：`design.md` §3.3.3、§6.5

- [x] 4.3 采纳初验接口
  - 状态：DONE
  - 这一步到底做什么：新增 `POST /api/outcomes/:id/reviews/adopt-prereview`，把 `likely_pass` 的项组装成用户验收，交给现有验收服务。
  - 做完你能看到什么：用户一次点击，初验通过的项被验收；过期初验被拒绝。
  - 先依赖什么：4.2
  - 开始前先看：
    - `requirements.md` 需求 8.2、8.4、8.5
    - `design.md` §2.3.8、§3.3.5、§6.1
  - 主要改哪里：
    - `apps/server/src/services/outcome-review-service.ts`
    - `apps/server/src/routes/`（路由，落地时核对）
  - 这一步先不做什么：不允许审查角色或 bot 调用；不绕过 `passIsSupported`。
  - 怎么算完成：
    1. 只能以用户身份调用。
    2. 修订变化后返回 `prereview_stale`。
  - 怎么验证：
    - 单元测试：用户身份、过期、只处理 `likely_pass`。
  - 对应需求：`requirements.md` 需求 8.2、8.4、8.5
  - 对应设计：`design.md` §3.3.5、§6.1

- [x] 4.4 与一次性预审切换
  - 状态：DONE
  - 这一步到底做什么：已设置审查角色时，跳过证据消费者里的一次性预审；审查回合失败时在详情提示（本版不提供重试入口）。
  - 做完你能看到什么：同一目标不会既有一次性预审又有审查角色的初验。
  - 先依赖什么：4.2
  - 开始前先看：
    - `requirements.md` 需求 7.5、7.6
    - `design.md` §2.3.7
  - 主要改哪里：
    - `apps/server/src/services/outcome-evidence-consumer.ts`（现 `:41-43`）
  - 这一步先不做什么：不删除一次性预审。
  - 怎么算完成：
    1. 未设置审查角色时一次性预审行为不变。
    2. 审查失败不阻塞用户验收。
  - 怎么验证：
    - 回归：现有预审测试；新增切换与失败场景测试。
  - 对应需求：`requirements.md` 需求 7.5、7.6、9.5
  - 对应设计：`design.md` §2.3.7、§6.7

- [x] 4.5 任务级审查：`ReviewTaskResult` 与一次驳回
  - 状态：DONE
  - 这一步到底做什么：由计划创建且 `nature = deliverable` 的任务 `completed`、并且已设置审查角色时，排队 `review_task` 回合（操作类、无计划的单个任务、返工任务、人工任务都不排）；实现 `ReviewTaskResult`：通过则记录结论，驳回则校验（至少一条发现；每条依据必须是该任务覆盖的必需验收项或契约里真实存在的边界，并带理由；该任务没被驳回过；不是返工任务）并创建返工任务，交给原任务的同一个 bot；备注永远不进返工指令。
  - 做完你能看到什么：一个带明显遗漏的任务被驳回一次，原 bot 收到带审查发现的返工任务；同一任务第二次驳回被拒绝。
  - 先依赖什么：1.2、2.5、3.5、4.1
  - 开始前先看：
    - `requirements.md` 需求 10
    - `design.md` §2.3.9、§3.3.7、§6.9、§6.10
  - 主要改哪里：
    - `packages/messaging/src/outcome-threads.ts`（任务结算处排队审查回合）
    - `apps/server/src/services/outcome-thread-tools.ts`
    - `apps/server/src/services/outcome-review-service.ts`（参考 `:232` 现有返工任务的创建方式）
  - 这一步先不做什么：不让返工任务再被审查；不做多次返工；不让审查角色修改契约、计划或写验收结论；审查失败时不阻塞（视为通过并标注"未经审查"）。
  - 怎么算完成：
    1. 这些驳回都被拒绝：依据是非必需验收项；依据是该任务未覆盖的验收项；边界编号不存在；缺少理由；"多做"但没违反 `excluded`；第二次驳回；对返工任务驳回。
    2. 返工任务的 bot、`reworkOfWorkItemId` 正确，指令只含原指令与审查发现，不含备注。
    3. 审查回合失败、超时或审查 bot 不可运行时，任务按通过放行并标注"未经审查"。
    4. 只有优化意见时只写进备注，不产生返工任务。
    5. 操作类任务、无计划的单个任务、返工任务、人工任务完成后不排 `review_task`，也不会因审查产生返工任务。
    6. 返工任务失败或取消时，下游保持等待并触发重规划；取消目标或修订被替换时，在途审查回合自然结束，写入被拒绝（`review_task_stale`）。
  - 怎么验证：
    - 单元与集成测试：通过、合法驳回、上面每一类被拒绝的驳回、备注隔离、审查失败、任务性质对排队的影响。
  - 对应需求：`requirements.md` 需求 10.1–10.13、11.2、11.5
  - 对应设计：`design.md` §2.3.9、§3.3.7、§6.9、§6.10

- [x] 4.6 审查与返工门控、状态派生
  - 状态：DONE
  - 这一步到底做什么：在依赖检查里加入门控（依赖任务没有未出结论的 `review_task` 回合、没有未完成的返工任务）；`recomputeOutcomeStatus` 在任务全部 `completed` 但门控未结束时保持 `running`；审查结论写入后重新派生状态，并在达到 `review_pending` 时发出 `outcome.review.required`。
  - 做完你能看到什么：审查没出结论时下游任务不会开始，目标也不会提前进入待验收；最后一个任务通过审查后，整体初验被触发。
  - 先依赖什么：4.1、4.5
  - 开始前先看：
    - `requirements.md` 需求 4.3、10.1、10.6
    - `design.md` §2.3.5、§2.3.9、§4.2、§6.3
  - 主要改哪里：
    - `packages/messaging/src/outcome-threads.ts`（依赖检查 `:63-66`）
    - `packages/messaging/src/`（`recomputeOutcomeStatus`）
  - 这一步先不做什么：不新增任务状态；未设置审查角色时门控必须完全不起作用。
  - 怎么算完成：
    1. 驳回后下游任务等返工任务 `completed` 才放行。
    2. 未设置审查角色时行为与 004.8 / 004.2 一致。
    3. 目标状态可由事实重算。
  - 怎么验证：
    - 状态派生与依赖门控的聚焦测试；重启恢复场景。
  - 对应需求：`requirements.md` 需求 4.3、10.1、10.6、9.5
  - 对应设计：`design.md` §2.3.5、§2.3.9、§4.2、§6.3、§6.8

### 阶段检查

- [x] 4.7 阶段 4 检查点
  - 状态：DONE
  - 这一步到底做什么：确认审查角色不能批准或验收、驳回至多一次、审查失败不阻塞，且最终验收仍只来自用户。
  - 做完你能看到什么：可以进入提示词与界面。
  - 先依赖什么：4.1、4.2、4.3、4.4、4.5、4.6
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：
    1. 属性 1、5、9、10 有对应测试。
    2. 已知缺口写进 `docs/`。
  - 怎么验证：人工走查，关键测试。
  - 对应需求：`requirements.md` 需求 7、需求 8、需求 9、需求 10
  - 对应设计：`design.md` §2.3.7、§2.3.8、§2.3.9、§6.1、§6.5、§6.9、§6.10

---

## 阶段 5：提示词与远端 computer

- [x] 5.1 平台提示词
  - 状态：DONE
  - 这一步到底做什么：写规划、重规划、提交目标、执行任务（含收到返工任务时只改审查发现指出的问题）、任务级审查（非必要不驳回、只驳回严重错误和遗漏、每个任务只能驳回一次）、整体初验共六段运行说明，内容见 `design.md` §3.3.6。所有说明用中性措辞，不使用只适用于代码的术语；规划说明含任务性质（`nature`）与"按目标类型的自然单元拆分"的要求，审查说明含"外部事实只认外部记录、确定性检查、人工回执"的证据规则。另含环境理解的内容：规划前先检索共享记忆；信息优先级（用户当前的话 > 更新的共享事实 > 环境说明）与冲突时向用户确认；任务指令自包含、不写凭据；用 `notes` 写规划说明；把用户透露的环境事实写入共享记忆；审查前先读规划说明。
  - 做完你能看到什么：不同角色与用途的回合收到对应说明；审查说明包含对照边界与检查没要求的功能的清单。
  - 先依赖什么：2.7、4.7
  - 开始前先看：
    - `requirements.md` 需求 2.5、7.7
    - `design.md` §3.3.6
  - 主要改哪里：
    - `packages/messaging/src/prompts/platform.json`
    - `packages/messaging/src/platform-system-prompt.ts`
    - `packages/messaging/test/platform-system-prompt.test.ts`
  - 这一步先不做什么：不改 bot 自身的人设；不新增模型配置。
  - 怎么算完成：
    1. 按角色与用途追加的说明有测试断言。
    2. 未设置角色时提示词与 004.8 一致。
  - 怎么验证：
    - `packages/messaging` 提示词聚焦测试。
  - 对应需求：`requirements.md` 需求 2.5、需求 7.7、需求 11、需求 12
  - 对应设计：`design.md` §3.3.6

- [ ] 5.2 同步并重建远端 computer
  - 状态：IN_PROGRESS
  - 这一步到底做什么：按 AGENTS.md「Remote Debug Computer」的步骤，备份、dry-run、同步、重建 `computer` 与 `computer-memory-init`，用 `scripts/dev/debug.sh check` 验证。
  - 做完你能看到什么：远端 computer 容器 `healthy`，bot 侧能看到新增工具。
  - 先依赖什么：1.2、2.2、5.1
  - 开始前先看：
    - `AGENTS.md`「Remote Debug Computer」
  - 主要改哪里：远端 `~/openteam-debug`（不改仓库源码）
  - 这一步先不做什么：不碰 `openteam-dev`、不碰 `data` 目录、不打印 `.env`。**重建会中断该 computer 上正在运行的 bot 任务，执行前必须先问用户。**
  - 怎么算完成：
    1. 备份文件已写入远端备份目录。
    2. `docker ps` 显示 `healthy`，`debug.sh check` 通过。
  - 怎么验证：
    - `docker ps --filter name=openteam-debug`；`scripts/dev/debug.sh check`。
  - 对应需求：`requirements.md` 需求 5.3、9.1
  - 对应设计：`design.md` §1.3、§8.1

- [ ] 5.3 审查约束与多类型样例评估
  - 状态：TODO
  - 这一步到底做什么：准备一组覆盖多种目标类型的固定样例，用真实的审查 bot 跑任务级审查和整体初验，记录它有没有把优化项当成必须项、有没有把代码场景的做法硬套到其他类型上。样例矩阵如下（代码编写只是其中一行，不能只用代码样例）：

    | 目标类型 | 任务性质 | 样例 A：只有优化空间（必须通过） | 样例 B：真实遗漏或错误（必须驳回） |
    | --- | --- | --- | --- |
    | 资料整理 | `deliverable` | 分类可以更细、排版可以更美观 | 必需验收项要求的某个来源完全没整理 |
    | 文档编写 | `deliverable` | 措辞可以更精炼、章节顺序可以调整 | 必需验收项要求的章节缺失，或与边界明显矛盾 |
    | 项目管理 | `deliverable` | 排期表可以加更多列、风险描述可以更详细 | 必需的里程碑缺失，或日期与契约约束冲突 |
    | 代码编写 | `deliverable` | 命名、结构、额外的防御性处理 | 必需验收项对应的功能没有实现 |
    | 运维操作 | `action` | 不适用：不做任务级审查，确认没有产生 `review_task` 回合和返工任务 | 不适用：确认问题由整体初验标 `unclear` 或不通过，交给用户 |
    | 现实任务 | 人工任务 | 不适用：确认不被审查，动作卡和回执流程不受影响 | 不适用 |

    另外两个专项样例：关于外部系统的事实只有执行 bot 自述（`agent_report`），整体初验必须标 `unclear` 而不是 `likely_pass`，任务级审查不得据此驳回；验收项为 `deterministic_check` 时，审查 bot 只核对检查证据，没有自己重新执行。
  - 做完你能看到什么：一份评估记录，列出每个样例的预期结论、实际结论、被服务端拒绝的驳回次数；所有样例 A 必须通过，所有样例 B 必须驳回，不适用的行必须确认没有触发审查。
  - 先依赖什么：5.1、5.2
  - 开始前先看：
    - `requirements.md` 需求 7.8、10.4、10.5、10.8、10.9、11
    - `design.md` §2.3.9、§2.3.10、§3.3.6、§3.3.7、§8.1
  - 主要改哪里：
    - `specs/004.9-Outcome规划角色与任务分配/docs/20261121-审查样例评估.md`（新增）
    - 样例数据放在 `docs/` 下，不进入业务代码
  - 这一步先不做什么：不做自动熔断；不根据一次评估结果就改服务端规则，先在评估记录里写建议，由用户决定是否收紧。
  - 怎么算完成：
    1. 矩阵里每个样例都有结论记录；真实审查 bot 对所有"只有优化空间"的样例没有产生驳回。
    2. 操作类、人工任务的样例确认没有触发任务级审查，也没有产生返工任务。
    3. 如果出现过度审查，评估记录里写明是被服务端校验拦下，还是穿过了校验，以及对应的提示词或校验调整建议。
    4. 评估记录里没有出现只适用于代码的判断依据。
  - 怎么验证：
    - 用真实审查 bot 跑样例；需要登录态的部分由用户在桌面端操作。
  - 对应需求：`requirements.md` 需求 7.8、10.4、10.5、10.8、10.9、10.13、11.2、11.3、11.4、11.5、11.8
  - 对应设计：`design.md` §2.3.9、§2.3.10、§3.3.6、§3.3.7、§8.1

- [ ] 5.4 环境理解评估
  - 状态：TODO
  - 这一步到底做什么：用一个全新的规划 bot（没有任何记忆）和一份样例环境说明，验证它是否真的理解环境。样例环境说明至少写明：几个 bot 的分工与擅长（例如哪个擅长写前端、哪个擅长联网检索）、一个需要通过某个账号才能访问的服务、一个禁区（例如"生产环境任何变更都要先问我"）、一个目录约定。依次提交：一个资料整理目标、一个文档编写目标、一个运维变更目标、一个与环境说明冲突的目标（用户当前的话要求做禁区里的事）。
  - 做完你能看到什么：一份评估记录，列出每个目标的计划是否：把任务分给了合适的 bot；遵守了禁区（运维任务没有直接动生产环境，而是标明需要用户决定）；任务指令自包含（执行 bot 不需要追问环境）；没有把凭据写进指令；规划说明写明了环境假设；冲突时向用户确认而不是自行猜测。同时确认执行 bot 的任务回合里没有环境说明，审查回合读到了规划说明。
  - 先依赖什么：5.1、5.2
  - 开始前先看：
    - `requirements.md` 需求 12
    - `design.md` §2.3.11、§3.3.6、§8.1
  - 主要改哪里：
    - `specs/004.9-Outcome规划角色与任务分配/docs/20261121-环境理解评估.md`（新增）
  - 这一步先不做什么：不为通过评估而把环境说明写成提示词里的规则；不根据一次评估结果就改设计，先在评估记录里写建议。
  - 怎么算完成：
    1. 四个目标都有结论记录，对应上面的检查项逐条给出"是 / 否 / 部分"。
    2. 如果规划 bot 因为读不到某类信息而做错，评估记录里写明缺的是哪一类（共享记忆、环境说明还是对话历史），以及建议补哪一块。
  - 怎么验证：
    - 用真实规划 bot 跑；需要登录态的部分由用户在桌面端操作。
  - 对应需求：`requirements.md` 需求 12.2、12.3、12.4、12.5、12.6、12.7
  - 对应设计：`design.md` §2.3.11、§3.3.6、§8.1

---

## 阶段 6：界面

- [x] 6.1 桌面端：角色设置
  - 状态：DONE
  - 这一步到底做什么：在目标管理设置里增加规划 bot、审查 bot 的选择，以及各自的"独立模型"选择（从已配置的模型里选，默认建议"以主 bot 身份运行，换一个更强的模型"），提示不可运行的 bot 和不可用的模型；增加"环境说明"文本框（8000 字上限、显示最后更新时间），旁边提示：写账号与服务、项目与目录、bot 分工、偏好、禁区；不要写密码、令牌等凭据；并提示在各 bot 的描述里写明擅长什么。
  - 做完你能看到什么：设置页能选角色、填环境说明，bot 失效时有提示。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §3.3.4
  - 主要改哪里：
    - `apps/desktop/src/renderer/hooks/use-feature-settings.ts` 及对应设置页面（落地时核对）
  - 这一步先不做什么：不在移动端做角色设置。
  - 怎么算完成：
    1. 保存、清空、失效提示都可用。
    2. 开关关闭时入口隐藏。
  - 怎么验证：
    - 桌面端聚焦测试。
  - 对应需求：`requirements.md` 需求 1.1–1.5
  - 对应设计：`design.md` §3.3.4

- [x] 6.2 桌面端：计划展示、初验摘要与采纳
  - 状态：DONE
  - 这一步到底做什么：目标详情读取并显示任务计划（读取契约见设计 §3.3.10：`plan`、`prereview`、任务 `review`；规划说明、任务、指定 bot、依赖、任务性质，用"成果类""操作类"中性名称）；任务列表里标注"已被审查驳回一次"（可展开审查发现）和"未经审查"；"Agent 记录"里显示规划、重规划、任务级审查、整体初验回合；验收首屏显示初验摘要，折叠 `likely_pass`，提供"采纳初验通过项"。
  - 做完你能看到什么：用户在验收界面只看摘要和有疑问的项。
  - 先依赖什么：2.3、4.3、4.5
  - 开始前先看：
    - `requirements.md` 需求 8、9.3
    - `design.md` §2.3.8
  - 主要改哪里：
    - `apps/desktop/src/renderer/`（目标详情与验收组件，落地时核对）
  - 这一步先不做什么：不做"交给规划角色重规划"的入口（见 `design.md` §8.2 待确认项 5）。
  - 怎么算完成：
    1. 初验过期时提示重新初验，不能采纳。
    2. 单项处理与返工与现有一致。
  - 怎么验证：
    - 桌面端测试；人工检查界面。
  - 对应需求：`requirements.md` 需求 8.1–8.5、9.3
  - 对应设计：`design.md` §2.3.8、§3.3.5

- [x] 6.3 Android：计划、初验摘要与采纳
  - 状态：DONE
  - 这一步到底做什么：目标详情显示计划与初验摘要，支持采纳。
  - 做完你能看到什么：手机上能看到同样的摘要并一键采纳。
  - 先依赖什么：6.2
  - 开始前先看：
    - `requirements.md` 需求 8.6
    - `design.md` §2.3.8
  - 主要改哪里：
    - `mobile/shared` 的 `Outcomes.kt`、`LiveFeatureGateway`、`OutcomeScreens.kt`
  - 这一步先不做什么：不做角色设置。
  - 怎么算完成：
    1. 共享模型与网关新增采纳接口。
    2. 界面按桌面端语义展示。
  - 怎么验证：
    - 共享模块测试；按 AGENTS.md 用 `bash scripts/android/package-debug.sh` 打包。
  - 对应需求：`requirements.md` 需求 8.6
  - 对应设计：`design.md` §2.3.8

- [x] 6.4 iOS：计划、初验摘要与采纳
  - 状态：DONE
  - 这一步到底做什么：同 6.3。
  - 做完你能看到什么：iOS 端同样能看到摘要并采纳。
  - 先依赖什么：6.2
  - 开始前先看：
    - `requirements.md` 需求 8.6
    - `design.md` §2.3.8
  - 主要改哪里：
    - `API.swift`、`AppStore.swift`、`OutcomeInboxView.swift` 及相关视图
  - 这一步先不做什么：不做角色设置。
  - 怎么算完成：
    1. 语法检查通过。
    2. 待真机验证的项写入 `docs/`。
  - 怎么验证：
    - 语法检查；真机验证待做。
  - 对应需求：`requirements.md` 需求 8.6
  - 对应设计：`design.md` §2.3.8

- [x] 6.5 桌面端：bot 模型设置
  - 状态：DONE
  - 这一步到底做什么：在桌面端 bot 设置里增加模型选择（提供方、模型、推理强度），可清空；显示该 bot 的生效模型，模型不可用时提示；提示用户按各 bot 的擅长选模型、并在 bot 描述里写明。
  - 做完你能看到什么：每个 bot 都能单独选模型；清空后显示"使用全局模型"；保存无效模型被拒并有提示。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 13.1、13.5、13.7
    - `design.md` §2.3.12、§3.3.8
  - 主要改哪里：
    - `apps/desktop/src/renderer/components/outcomego/inspector.tsx`（`BotSettings` 组件，已于 0.1 核实为实际 Bot 设置界面）
  - 这一步先不做什么：不做移动端设置或显示；不做按目标覆盖。
  - 怎么算完成：
    1. 保存、清空、不可用提示都可用。
    2. 生效模型显示与运行实际使用的一致。
  - 怎么验证：
    - 桌面端聚焦测试；人工检查界面。
  - 对应需求：`requirements.md` 需求 13.1、13.5、13.7
  - 对应设计：`design.md` §2.3.12、§3.3.8

---

### 6.6 同轮初验与成果报告

- [x] 复用 `review` 回合与 `SubmitPrereview`，一次保存用户结论、逐项建议、证据与可选图表；报告接口与验收界面共用已保存报告。对应需求 7.1、7.9、8.1、8.4；设计 §2.3.7、§2.3.8、§3.3.3、§3.3.5。
- [x] 聚焦回归覆盖：同批只排一次；新成果使旧结论和采纳失效；初验待完成或已完成时不额外请求全局模型；不将 Bot 转述画为已核实数据；保留无审核角色的全局汇总。验证：`outcome-stage4-gating.test.ts`、`outcome-stage4-review.test.ts`、`outcome-brief.test.ts`、`outcome-stage6.test.tsx`。
- [ ] 同步远端 `computer` 的工具定义并用真实审核 Bot 验证待决策和待验收页面；按 5.2 先征得重建许可，不用重新执行原任务。

---

## 阶段 7：验证与收尾

- [ ] 7.1 集成与端到端验证
  - 状态：TODO
  - 这一步到底做什么：按 `design.md` §7.2、§7.3 跑集成与真实 bot 端到端。
  - 做完你能看到什么：成功定义里的每一条都有证据。
  - 先依赖什么：5.2、5.3、5.4、6.2、6.5
  - 开始前先看：
    - `requirements.md` 成功定义
    - `design.md` §7
  - 主要改哪里：测试与 `docs/` 验收记录
  - 这一步先不做什么：不追加新需求。
  - 怎么算完成：
    1. 带依赖的多任务目标按顺序完成。
    2. 任务失败后规划角色重排，用户未被打扰。
    3. 初验后用户只处理标出的项。
    4. 带明显遗漏的任务被驳回并返工一次后放行；只有优化空间的任务不被驳回；同一任务没有被驳回第二次；5.3 的评估记录显示没有把优化项当成必须项。
    5. 规划与审查回合各最多 5 个同时运行，执行任务仍为 2。
    6. 至少一个文档编写目标、一个运维变更目标、一个含现实任务的目标各走一遍：成果任务经过任务级审查，操作任务不被自动返工，人工任务按 004.4 的动作卡与回执流程完成，提示词和界面里没有只适用于代码的说法。
    7. 5.4 的环境理解评估显示：全新的规划 bot 在用户填写环境说明后，能把任务分给合适的 bot、遵守禁区、写出自包含的任务指令。
    8. 两个角色都未设置时行为与 004.8 一致。
    9. 给两个执行 bot 各设不同模型后，各自任务的运行记录各自的模型；清空后回到全局模型；bot 无法修改模型；没有给任何 bot 设置模型时行为与现在一致。
    10. 一个任务失败且重规划没有新增替代任务时，目标显示 `failed` 而不是 `review_pending`；重规划回合排队或运行期间显示 `running`。
  - 怎么验证：
    - 聚焦集成测试；端到端需要登录态，由用户在桌面端操作。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §7

### 最终检查

- [ ] 7.2 最终检查点
  - 状态：TODO
  - 这一步到底做什么：核对需求、设计、任务、验证证据能一一对上。
  - 做完你能看到什么：后续接手的人能快速看懂；延期项和取消项写清楚。
  - 先依赖什么：7.1
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`、`docs/`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不再追加需求。
  - 怎么算完成：
    1. 每条需求都能追踪到设计章节、任务和验证方式。
    2. `design.md` §8.2 的待确认项都有结论或明确延期。
  - 怎么验证：按 Spec 验收清单逐项核对。
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
