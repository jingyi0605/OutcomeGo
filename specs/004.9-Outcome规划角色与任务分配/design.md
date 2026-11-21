# 设计文档 - Outcome 规划角色与任务分配

状态：Draft

## 1. 概述

### 1.1 目标

- 规划（写契约、拆任务、指定 bot、重规划）只发生在规划角色的回合里，规划角色的模型由角色模型设置决定（优先级见 §2.3.12）。
- 普通 bot 只提交目标、执行被指派的任务、更新进度、提交证据。
- 可选的审查角色做初验，把用户要看的信息收敛成"摘要 + 有疑问的项"。
- 程序仍然只负责权限、幂等、事实持久化、状态派生、调度与恢复；批准与最终验收只来自用户界面。
- 两个角色都未设置时，行为与 004.8 完全一致。

### 1.2 覆盖需求

| 需求 | 设计章节 |
| --- | --- |
| 需求 1 设置角色与并发上限 | §2.3.1、§2.4、§3.2.1、§3.3.4 |
| 需求 2 bot 只提交目标 | §2.3.2、§3.3.1、§3.3.6 |
| 需求 3 保存任务计划 | §2.3.3、§3.2.2、§3.3.2 |
| 需求 4 批准后创建并分配 | §2.3.4、§4.2 |
| 需求 5 执行 bot 只处理被指派任务 | §2.3.5、§3.3.6 |
| 需求 6 重规划 | §2.3.6、§4.2、§6.16 |
| 需求 7 审查角色初验 | §2.3.7、§3.3.3、§3.3.9 |
| 需求 8 用户基于初验决策 | §2.3.8、§3.3.5、§3.3.10 |
| 需求 9 权限、可观测、回退 | §3.3.9、§3.3.11、§5、§6 |
| 需求 10 审查角色驳回任务结果 | §2.3.9、§3.3.7、§3.3.9、§6.9、§6.10 |
| 需求 11 不绑定目标类型 | §2.3.10、§3.2.2、§3.3.6、§6.11、§6.12 |
| 需求 12 规划与审查角色理解环境 | §2.3.11、§3.2.1、§3.3.1、§3.3.2、§3.3.6、§6.13 |
| 需求 13 每个 bot 单独设置模型 | §2.3.12、§2.4、§3.2.4、§3.3.8、§6.15 |

### 1.3 技术约束

- 复用现有机制：`enqueueWake`、`enqueueOutcomeTurn`、线程回合（004.8 `OutcomeThread` / `OutcomeThreadTurn`）、`Run` / `RunItem`、004.5 恢复、`transitionWorkItem`、`recomputeOutcomeStatus`、`OutcomeReviewService.submit`。
- 状态由事实派生（004.2 设计 §42.3），不新增手写状态字段。
- 工具定义位于 `packages/contracts`，由 `apps/computer` 读取，生效需要同步并重建远端 computer（AGENTS.md「Remote Debug Computer」）。
- 模型：目前所有运行共用 `settings.json` 里的全局推理设置（`apps/worker/src/worker.ts:1831` 调用 `loadInferenceSettings`，`packages/messaging/src/agent-data.ts:3325`）；`Bot.inferenceProvider` / `Bot.inferenceModel` 两列存在但没有任何代码读写（`apps/worker/src/projection.ts:96-110` 写的是 `ContextSession` 与 `Run`，不是 `Bot`），所以"另建一个 bot"并不能换模型。本 Spec 新增两层：**角色模型**（规划角色、审查角色各带一个独立模型引用，线程回合用它）和 **Bot 模型**（启用 `Bot` 上的两列并补 `inferenceReasoning`，每个 bot 可单独设置）；优先级见 §2.3.12。参照现有先例：子 agent 沿用父运行记录的模型（`worker.ts:1901-1908`）。
- 目标管理开关关闭时，不创建线程、不暴露工具（沿用 004.8）。

## 2. 架构

### 2.1 系统结构

```
用户 / 任意 bot ──提交原话──► 服务端：校验、幂等、创建目标 ──► 规划角色线程（plan 回合）
                                                              │ SaveOutcomeContract、SavePlan
                                                              ▼
                                            契约修订 + 任务计划（保存在修订上）
                                                              │ 用户批准（只能来自界面）
                                                              ▼
                  按计划创建任务：全部 queued 并尝试入队；有未满足依赖的由现有逻辑保持等待
                                                              │
                          ┌───────────────────────────────────┼─────────────────────────────┐
                          ▼                                   ▼                             ▼
                    执行 bot A（任务）                   执行 bot B（任务）          任务失败 → 规划角色
                          │ 完成                                                        replan 回合
                          ▼
            审查角色：任务级审查（review_task）── 通过 → 放行依赖任务
                          │ 驳回（每个任务最多一次）
                          ▼
            原 bot 按审查意见返工 → 完成后放行依赖任务（不再审查）
                          │
                          ▼
                 目标进入 review_pending ──► 审查角色线程（review 回合）──► SubmitPrereview
                                                              │
                                                              ▼
                                        用户在初验摘要上决策：采纳 / 单项处理 / 返工
```

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| 角色解析（新，server） | 读取规划、审查角色设置，校验 bot 可运行，给出回退结果 | 目标、角色设置 | 线程 bot 或"回退" |
| `OutcomeThreadService`（004.8，扩展） | 按线程角色创建线程与回合；放宽线程 bot 约束 | 提交、消息、系统触发 | `OutcomeThreadTurn` |
| `SavePlan`（新线程工具） | 校验并保存任务计划，批准后按差异调整未开始任务 | 规划角色的工具调用 | 计划、任务、事件 |
| 计划物化（新，server） | 批准时按计划创建任务并尝试入队 | 批准、`SavePlan` | `OutcomeWorkItem`、唤醒 |
| 依赖放行（扩展，messaging） | 任务通过门控后，放行依赖它的任务，含指定了其他 bot 的任务 | 任务结算、审查结论 | 排队唤醒 |
| 任务级审查（新，server / messaging） | 任务 `completed` 后排队 `review_task` 回合；处理驳回与返工任务 | 任务结算 | 审查回合、返工任务 |
| 重规划触发（新，messaging） | 任务失败后排队 `replan` 回合 | 任务状态变化 | `OutcomeThreadTurn` |
| 审查触发（新，server） | 目标进入 `review_pending` 时排队 `review` 回合 | 状态变化 | `OutcomeThreadTurn` |
| `SubmitPrereview`（新线程工具） | 保存初验结果与摘要 | 审查角色的工具调用 | `ai_prereview` 证据、回合结果 |
| `ReviewTaskResult`（新线程工具） | 保存任务级审查结论；驳回时创建返工任务 | 审查角色的工具调用 | 回合结果、返工任务 |
| 采纳初验（新，server） | 把用户的一次点击转成对 `likely_pass` 项的用户验收 | 用户操作 | `OutcomeReview`（经现有验收服务） |
| 桌面端、Android、iOS | 角色设置（仅桌面）、计划展示、初验摘要与采纳 | 事实、回合记录 | 用户操作 |

### 2.3 关键流程

#### 2.3.1 设置角色

1. 用户在目标管理设置里选择规划 bot、审查 bot（可只设其一），写入目标管理设置（现有 `FeatureSettings`，落地前核对存储位置，见 `tasks.md` 0.1）。
2. 服务端校验 bot 存在且可运行；保存后只影响之后新建的线程与新进入待验收的目标。
3. 已有线程的 bot 不变（见 §8.2 待确认项 1）。
4. 并发：规划类回合（`plan`、`owner_message`、`replan`）与审查类回合（`review`、`review_task`）对每个 bot 各限制 5 个同时运行，按角色分别计数，超出的回合保持排队；执行任务的每 bot 并发 2 不变，三者互不占用。具体位置见 §2.4。

#### 2.3.2 提交目标

1. 用户在界面新建目标，或 bot 在对话中调用 `SubmitOutcome`，输入用户原话、提交 bot、可选 `exploreIdeaId`、`clientRequestId`。
2. 已设置规划角色：同一事务创建 `Outcome(status = planning, botId = 提交 bot)`、规划线程（`role = planner`，`botId = 规划 bot`）、`OutcomeThreadTurn(purpose = plan, trigger = 原文)`。
3. 未设置规划角色：保持 004.8 行为，`CreateOutcome` 仍可由 bot 直接写契约。
4. 规划角色读到原话和"可指派 bot 清单"，决定追问或写契约与计划。

#### 2.3.3 规划

1. 规划角色调用 `SaveOutcomeContract` 保存修订 N（待批准），复用 004.2 校验与冲突检测。
2. 规划角色调用 `SavePlan` 为该修订保存任务计划；可多次调用，后一次整体替换前一次（批准前）。
3. 目标详情同时展示契约和任务计划；用户批准的是契约，计划随批准一同生效并在批准前对用户可见。

#### 2.3.4 批准与创建任务

1. 用户批准契约。批准事务内，读取该修订的任务计划。
2. 有计划：按拓扑顺序创建任务，写入指定 bot、依赖（任务 ID）、`planKey`、`ordinal`，状态都是 `queued`，并对每个任务调用 `enqueueOutcomeTurn`。有未满足依赖的任务由现有逻辑保持等待：`enqueueOutcomeTurn` 在依赖没有 `completed` 时返回 `queued_for_capacity`，并留下待处理的幂等记录供之后放行（`packages/messaging/src/outcome-threads.ts:63-66`）。不新增任务状态。
3. 无计划：沿用 004.2，创建一个 initial 任务交给 `executionBotId`（`outcome-service.ts:291-303`）。
4. 幂等：以 `(outcomeId, contractRevisionId, planKey)` 判断任务是否已创建，取代现在按 `kind: initial` 的查找。

#### 2.3.5 执行与依赖放行

1. 被唤醒的任务回合收到：任务指令、契约摘要（目标、本任务覆盖的验收项、边界）、依赖任务的产出摘要（`OutcomeOutput` 内容，超长时给引用）。
2. 执行 bot 用 `ReportOutcomeProgress` 更新进度，用现有机制提交产出与证据；"领取"即"被指定后被唤醒"，不新增领取工具。
3. 任务结算后，现有逻辑只挑选**同一个 bot** 的排队任务入队（`settleOutcomeWorkItem` 末尾的 `dispatchQueuedOutcomeWorkItems(tx, messaging, item.botId)`，`outcome-threads.ts:104-130`）。本 Spec 扩展它：同时挑选同一目标里依赖该任务、但指定了其他 bot 的排队任务，否则 A 完成后指定给另一个 bot 的 B 不会被唤醒。
4. 依赖是否满足统一在 `enqueueOutcomeTurn` 的依赖检查处判断（`outcome-threads.ts:63-66`）：在"依赖任务 `completed`"之外增加门控条件——依赖任务没有未出结论的任务级审查，且它若有返工任务则返工任务已 `completed`（§2.3.9）；返工任务 `failed` 或 `cancelled` 时下游保持等待，由重规划处理。
5. 全部任务 `completed` 且没有未结束的门控后，状态由 `recomputeOutcomeStatus` 派生到 `review_pending`（沿用 004.2，补充规则见 §4.2）。

#### 2.3.6 失败与重规划

1. 任务进入 `failed`（004.5 重试用尽）或 `needs_review` 时，在同一事务内排队规划线程的 `replan` 回合（触发点挂在 `transitionWorkItem`，`outcome-state.ts:55`，而不是 `settleOutcomeWorkItem`：后者对这两个状态直接 return，`outcome-threads.ts:155`，而它们还会从 `outcome-recovery.ts:165`、`automation-results.ts:456`、`enqueueOutcomeTurn` 的 `bot_not_runnable` 写入，只挂在 settle 上会漏掉恢复路径），`triggerBy = system:task_failed`，触发说明含任务 ID 与原因。
2. 规划角色读取目标事实，选择：调用 `SavePlan` 调整未开始任务（新增任务，修改或移除未开始任务）；调用 `SaveOutcomeContract` 保存新修订（走重新批准）；或在最终回复里写清楚需要用户做什么。
3. 批准后的 `SavePlan` 按 `planKey` 与现有任务比对：已入队 Run（`rootRunId` 不为空）、运行中、已结束的任务必须原样出现；未开始任务（`queued` 且 `rootRunId` 为空，包括等依赖和等并发名额的）可改可删，修改未开始任务时，先删除它待处理的排队记录（`outcome-turn:<id>`），再以新 `clientId` 重新入队；不能只改记录里存的 input，因为 `enqueueOutcomeTurn` 会校验 `requestHash`（约 `outcome-threads.ts:46`），放行时会抛 `idempotency_conflict`，而且是在别的任务的结算事务里抛。新 `key` 视为新增。
4. 系统触发的回合不能取消目标（沿用 004.8 §6.3）。

#### 2.3.7 初验

1. 目标进入 `review_pending` 且已设置审查角色：排队审查线程（`role = reviewer`）的 `review` 回合，幂等键为 `(outcomeId, 修订号, 产出批次)`。触发点挂在现有的 `outcome.review.required` 事件上（`settleOutcomeWorkItem` 里按修订幂等发出，`outcome-threads.ts` 约 `:187-200`）。该事件的发出逻辑需要抽成共享函数：最后一个任务级审查通过时，任务早已结算，也要在审查结论写入后重新派生状态并发出该事件（§2.3.9）。
2. 审查角色读取目标详情（契约、任务、产出、证据），按审查清单（§3.3.6）逐条检查。
3. 审查角色调用 `SubmitPrereview` 一次，服务端写入 `ai_prereview` 证据（沿用 `outcome-review-service.ts:289-290` 的格式）、把摘要和关注点写入回合结果。
4. 已设置审查角色时，`OutcomeEvidenceConsumer` 不再调用一次性 `prereview`（`outcome-evidence-consumer.ts:41-43`）。

#### 2.3.8 用户决策

1. 验收界面首屏：初验摘要、`likely_fail` 与 `unclear` 项及理由；`likely_pass` 折叠。
2. "采纳初验通过项"调用采纳接口（§3.3.5），服务端把当前修订里 `likely_pass` 的项组装成用户验收，交给 `OutcomeReviewService.submit`，因此 `passIsSupported`（`packages/contracts/src/outcome-view.ts:60`）、修订冲突检查、证据检查全部沿用。
3. 单项处理、返工与现有界面一致。

#### 2.3.9 任务级审查与一次驳回

1. 任务结算为 `completed`、已设置审查角色，且该任务由计划创建（有 `planKey`）、计划里声明 `nature = deliverable` 时，在同一事务内排队审查线程的 `review_task` 回合，回合记录 `workItemId`；幂等键为 `(workItemId)`。`nature` 从修订的 `plan` 里按 `planKey` 读取，不新增列。以下任务不排队：`nature = action`、无计划回退时的单个 initial 任务（没有 `planKey`）、返工任务、人工任务（`executorType = human`）。
2. 审查角色读取：该任务的指令、产出、证据，它覆盖的验收项，契约边界。目标管理类工具只有 `ReviewTaskResult` 一个写工具（§3.3.7），由服务端按回合用途校验（§3.3.9）。
3. 判定"通过"：写入结论；放行依赖该任务的任务（走 §2.3.5 步骤 3、4）；不对用户产生任何提示。
4. 判定"驳回"：服务端校验后在同一事务内创建返工任务：`kind = rework`，`reworkOfWorkItemId` 指向原任务，`botId` 与原任务相同，指令为原指令加审查发现；入队走 `enqueueOutcomeTurn`。原任务保持 `completed`；依赖原任务的任务等返工任务 `completed` 后才放行；返工任务 `failed` 或 `cancelled` 时门控不满足，下游保持等待，并因返工任务失败触发 `replan`（§2.3.6），由规划角色改动这些未开始任务或交给用户。
5. 驳回至多一次：同一任务已有一个 `verdict = reject` 的审查回合时，服务端拒绝再次驳回（`review_reject_exhausted`）。返工任务完成后直接放行，其结果由整体初验（§2.3.7）覆盖；审查角色在那里可以把剩余疑虑写进摘要。
6. 驳回的门槛由服务端和提示词共同保证，目的是让审查角色**没有办法**把优化项变成必须项：
   - 服务端（可验证的部分）：每条发现必须带类型（严重错误或遗漏）、依据和理由（一两句话说明产出哪里与依据不符）。依据只能是该任务覆盖的**必需**验收项，或契约里已有的某一条边界。引用非必需验收项、该任务未覆盖的验收项、或不存在的边界，一律拒绝（`review_not_rejectable`）。"多做了没要求的事"只有违反 `excluded` 的某一条才可驳回。
   - 备注隔离：`note` 只作为整体初验的素材，永远不写进返工任务的指令，也不发给执行 bot；有长度上限。审查角色没有办法通过备注让执行 bot 去改任何东西。
   - 提示词（不可验证的部分）：默认通过，拿不准就通过；只读已记录的产出与证据；明确列出"不是驳回理由"的清单（§3.3.6）。
   - 返工后不再审：被驳回的任务返工完成后直接放行，审查角色没有第二次机会。
   - 可追溯：每次驳回的发现与依据都保存在回合 `result` 里，用于事后统计驳回率；如果上线后发现偏高，再收紧提示词或服务端校验，本 Spec 不做自动熔断。
7. 失败不阻塞：审查回合失败、超时或审查 bot 不可运行时，视为通过并放行，目标详情标注"未经审查"。
8. 状态：任务已 `completed` 但审查回合未出结论，或返工任务未完成时，目标保持 `running`（§4.2），避免提前进入 `review_pending`。审查结论写入后重新派生状态，并在达到 `review_pending` 时发出 `outcome.review.required`。
9. 取消与替换：用户取消目标或契约被新修订替换时，不单独取消在途的审查回合，让它自然结束；它的写入因目标已终结或修订已替换被拒绝（`review_task_stale`）。未开始的返工任务按 004.2 的取消规则取消。

#### 2.3.10 目标类型与任务性质

目标不限于代码编写。设计上不假设"产出是代码、可以反复修改"，而是用任务性质和现有的验证机制区别对待：

| 目标类型举例 | 典型任务 | 任务性质 | 任务级审查与自动返工 | 主要证据 |
| --- | --- | --- | --- | --- |
| 资料整理 | 按来源或主题整理、汇总、去重 | `deliverable` | 是 | 产出文件、资料引用（004.4 `KnowledgeProvider`） |
| 文档编写 | 按章节或交付物撰写、改写 | `deliverable` | 是 | 产出文件、正文 |
| 项目管理 | 排期、风险清单、周报、跟踪表 | `deliverable` | 是 | 产出文件；跟踪型目标仍走 `TrackOutcome`，不经过本流程 |
| 运维任务 | 变更、重启、迁移、部署 | `action` | 否：重做可能重复产生影响 | 外部记录、确定性检查；凭据与对外操作批准走 Decision（004.3） |
| 现实任务 | 需要真人到现场执行 | 人工任务（004.4），不是 `nature` | 否：沿用动作卡、回执、owner 验收 | 人工回执、外部记录 |
| 代码编写 | 实现、修复、补测试 | `deliverable` | 是 | 产出文件、确定性检查（测试结果） |

规则：

1. **规划**：规划角色按目标类型的自然单元拆分，不套"设计、实现、测试"的开发流程；每个任务声明 `nature`；拿不准选 `action`（不审查、不自动返工，更保守）。
2. **自动返工只用于成果类**：成果可以按意见修改。操作类任务重做可能重复发送、重复变更，所以驳回路径对它们关闭；它们的问题由证据、整体初验和用户处理。
3. **证据来源**（沿用 004.4"AI 生成的步骤只能作为建议，不得作为执行事实"）：关于外部系统或现实世界的事实，只有外部记录（`external_record`）、确定性检查（`deterministic_check`）、人工回执（`human_confirmed`）算证据；执行 bot 自己的陈述（`agent_report`）只能说明"产出里写了什么"。缺证据时审查角色标 `unclear` 并说明缺什么，不标 `likely_pass`，也不据此驳回。
4. **验证方式**：验收项的 `verificationMethod` 为 `deterministic_check` 时，审查角色只核对确定性检查证据存在且为通过，不重新执行；为 `human_review` 时对照验收项陈述给建议。
5. **现实任务**：由执行中的 agent 任务通过动作卡请求（004.4 §32），规划角色不直接创建人工任务；任务处于 `waiting_human` 时不排审查，完成后才审查。
6. **授权**：规划与审查不产生动作授权，不改变凭据授权；需要的批准仍由执行任务发起 Decision（沿用 004.3 与 `outcome-credential-approval.ts`）。

#### 2.3.11 规划与审查角色的环境理解

问题：用户最熟悉环境的是主 bot，它的积累主要在自己的记忆和对话里；独立的规划 bot、审查 bot 一开始是空白的。核对现有代码后，它们能拿到的已经不少，缺的是一份结构化的、由用户掌控的环境描述，以及规划角色向执行 bot 传递环境的方式。

| 来源 | 谁维护 | 规划、审查 bot 现在能否拿到 | 本 Spec |
| --- | --- | --- | --- |
| 共享用户记忆（`shared_profile`、`shared_journal`）：每个 bot 写自己的分片，其他 bot 在提示里看到，并可用 `RecallMemory` 检索（`packages/messaging/src/memory-rendering.ts`） | 所有 bot 自动学习 | 能 | 沿用；提示词要求规划与审查前先检索，并把用户透露的新环境事实写回共享记忆 |
| 该 bot 自己的记忆、技能、persona（`Bot.instructions`） | 该 bot | 能，但新 bot 是空的 | 沿用；规划 bot 会随使用逐步积累 |
| 队友清单（名称、描述，`<teammates>` 块，描述截断到 120 字） | 用户 | 能 | 可指派 bot 清单补充所用模型；设置页提示在描述里写明擅长什么 |
| 主 bot 或其他 bot 的对话 | | 能读：`ReadTranscript(in = <botId>)` 只返回可见消息，不含工具数据，已脱敏并限长（`packages/messaging/src/read-transcript.ts`）；`ReadAgentActivity` 可看近期活动 | 沿用，不复制；首个规划回合的上下文给出提交 bot 的名称与 id，并提示需要时去读 |
| 其他 bot 的私有记忆与文件 | | 不能（现有隐私边界：不得查看队友的私有对话、记忆、文件） | 不改变 |
| **环境说明**（新） | 用户 | 否 | 目标管理设置里的长文本，仅规划类与审查类回合携带 |
| **规划说明**（新） | 规划角色 | 审查角色读不到 | `SavePlan` 的可选字段，随计划保存 |
| **自包含的任务指令** | 规划角色 | 执行 bot 只靠它 | 提示词要求；执行 bot 不自动带环境说明 |

设计取舍：

1. **不让规划、审查 bot 读主 bot 的私有记忆。** 这是现有隐私边界，改它影响面太大；用户通过"环境说明"自己决定交出哪些信息，主 bot 已经学到的、适合所有 bot 知道的用户事实本来就在共享记忆里。
2. **环境说明由用户维护，不自动生成。** 它会进入模型提供方的上下文，用户需要知道里面写了什么；"让主 bot 起草，用户审阅后保存"的辅助见 §8.2。
3. **执行 bot 只拿到规划角色写进任务指令的那部分环境信息**（最小必要）。不把整份环境说明发给每个执行 bot，避免无关信息扩散，也避免执行 bot 被无关的禁区或偏好干扰。
4. **冲突时的优先级**：用户当前的话 > 更新的共享记忆事实 > 环境说明。环境说明可能过时，所以规划角色发现冲突且影响计划时要向用户确认，不自行猜测。
5. **规划说明是规划角色传给审查角色的桥**：规划角色了解环境，审查角色未必；规划说明写明"为什么这样拆、对环境做了什么假设"，审查角色据此判断产出是否合理，而不是脱离环境凭空评判。
6. **推荐让主 bot 以独立模型担任规划与审查角色（共享资料与记忆，换模型）。** 规划回合、审查回合以主 bot 的身份运行：同一份 persona、`Bot.instructions`、个人记忆、共享记忆、技能、文件和连接器，只是模型换成 `plannerModel` / `reviewerModel`。这满足"规划、审查 bot 对环境的理解与主 bot 一样"，而不需要复制或开放任何私有数据。角色只是一个 bot 设置加一个模型设置。目标线程是独立上下文，不复制主对话历史（现有行为），但同一个 bot 的记忆、persona、技能保持不变，所以环境理解天然最全。代价：规划与审查回合占用主 bot 的并发（各 5，按角色分别计数，不挤占主对话，因为目标线程回合属于后台来源）；模型额度记在独立模型上，不消耗全局模型的额度。另见 §8.1 的"同一 bot 并发写记忆"。

#### 2.3.12 每个 bot 单独设置模型

现状（已核实）：

- `Bot.inferenceProvider` / `Bot.inferenceModel` 两列已存在（`packages/db/prisma/schema.prisma:332-333`），但没有任何代码读取或写入，也没有设置入口；`Run` 上记录实际使用的模型（`inferenceProvider`、`inferenceModel`、`inferenceReasoning`）。
- worker 创建运行时一律取全局设置（`worker.ts:1831` 的 `loadInferenceSettings`），只有子 agent 沿用父运行记录的模型（`worker.ts:1901-1908`）。
- 后台一次性推理（记忆整理 `worker.ts:568`、`apps/server/src/services/outcome-inference.ts`）没有 bot 上下文，一直用全局设置。

设计：

1. **生效模型的优先级**（worker 创建运行时决定一次，写入 `Run`）：
   1. 子 agent：父运行记录的模型（不变）。
   2. 目标线程回合：回合上记录的独立模型（`plannerModel` / `reviewerModel`，§3.2.1）。
   3. Bot 模型：该 bot 自己的 `inferenceProvider` / `inferenceModel` / `inferenceReasoning`。
   4. 全局设置。

   某一级模型不可用（凭据失效、模型被移除）时回退到下一级，并在运行事件里标注（标注位置见 `tasks.md` 0.1 第 14 项），不阻塞。
2. **Bot 模型作用于该 bot 的所有运行**：主对话、自动化、目标线程回合、执行任务。后台一次性推理仍用全局设置。
3. **只有用户能设置。** 模型字段以数据库为准，只通过 bot 更新接口（用户身份）写入；它不属于 bot 可以通过 `UpdateProfile` 或编辑 `settings.json` 修改的内容，避免 bot 自行换成更贵或更弱的模型。现有的 per-agent `settings.json` 是数据库的镜像（`agent-data.ts:423` 的 `settingsDocument`），文件修改是否会被导入回数据库见 `tasks.md` 0.1 第 14 项。
4. **角色模型仍然保留。** 推荐配置是让主 bot 担任规划与审查，却用与主对话不同的模型；Bot 模型只能给主 bot 一个模型，表达不了"同一个 bot 在不同回合用不同模型"，所以角色模型作为优先级第 2 级的覆盖保留。
5. **对任务分配的意义。** 执行 bot 的任务回合用该 bot 的 Bot 模型，所以"写代码的 bot 用一个模型、写前端的 bot 用另一个、联网检索的 bot 用第三个"成为可能；规划回合的可指派 bot 清单显示每个 bot 的生效模型（Bot 模型，未设置则为全局模型），规划角色据此分配。
6. **无设置时不变。** 没有任何 bot 设置模型、也没有设置角色模型时，所有运行仍用全局设置。

### 2.4 要修改的现有代码

| 位置 | 处理 |
| --- | --- |
| `packages/db/prisma/schema.prisma` | 新增字段，见 §3.2.3 |
| `apps/server/src/services/outcome-service.ts:291-303`（批准后创建 initial 任务） | 有计划时按计划创建；无计划保持原行为；幂等键改为 `planKey` |
| `apps/server/src/services/outcome-thread-service.ts:94、113`（线程 bot 取 `outcome.botId`；`upsert` 的键是 `outcomeId`） | 线程 bot 按角色解析；`upsert` 的键改为 `(outcomeId, role)` |
| `packages/messaging/src/outcome-threads.ts`（`settleOutcomeWorkItem`） | `completed` 时排队任务级审查；`outcome.review.required` 的发出抽成共享函数 |
| `packages/messaging/src/outcome-state.ts:55`（`transitionWorkItem`，任务状态变更的唯一入口） | 任务进入 `failed` / `needs_review` 时排队 `replan` 回合（覆盖恢复路径） |
| `packages/messaging/src/outcome-state.ts:143-201`（`recomputeOutcomeStatus`） | 增加失败任务与被失败依赖阻塞的等待任务的派生规则（§4.2）、审查与返工门控（§2.3.9）；`replan` 回合不影响目标状态 |
| `packages/messaging/src/outcome-threads.ts:104-130`（`dispatchQueuedOutcomeWorkItems`，只挑同一 bot 的排队任务） | 扩展为同时挑选同一目标里依赖已结算任务、指定了其他 bot 的排队任务 |
| `packages/messaging/src/outcome-threads.ts:63-66`（依赖检查） | 增加门控条件：依赖任务没有未出结论的任务级审查、没有未完成的返工任务 |
| `packages/messaging/src/outcome-threads.ts` 的 `outcomeRunContext`（`:200` 起） | 任务上下文加入被覆盖的验收项与依赖任务的产出摘要 |
| `packages/messaging/src/outcome-threads.ts:73`（`reserved >= 2`，执行任务每 bot 并发 2） | 保持 2，只统计执行任务，不统计规划与审查回合 |
| `apps/worker/src/worker.ts:1447-1450`（租约计数）与 `:1647`（线程回合的租约 scope 是 `outcome-thread:<id>`，不被 `outcome:`、`automation:` 前缀的计数覆盖） | 已核实：线程回合现在没有按 bot 的并发上限，所以"5"是**新增**上限，不是提高；为 `outcome_thread` 回合增加按 bot、按角色的并发上限 5（规划类与审查类分别计数） |
| `packages/messaging/src/feature-settings.ts` 与全局 `featureSettings` 行（`id = "global"`） | 新增 `plannerBotId`、`reviewerBotId`、`environmentNote`；读写与校验放在这里 |
| `packages/messaging/src/outcome-threads.ts:295`（`outcomeThreadContext`，目标线程的上下文构造） | 规划类、审查类回合加入环境说明、提交 bot 的名称与 id、可指派 bot 清单、计划里的规划说明；执行任务回合（`outcomeRunContext`）不加环境说明 |
| `apps/worker/src/worker.ts:1895-1920`（`selectedInference`：先取子 agent 父运行的模型，否则用全局设置） | 增加一个分支：`outcome_thread` 回合若记录了角色模型（`OutcomeThreadTurn.model`），用它；否则取该 bot 的 Bot 模型（§2.3.12）；都没有才用全局设置。写入 `Run.inferenceProvider/Model/Reasoning` 的现有逻辑不变 |
| `packages/db/prisma/schema.prisma:332-333`（`Bot.inferenceProvider`、`Bot.inferenceModel`，现有未使用）与 `Bot` | 启用这两列，新增 `inferenceReasoning`；已有非空旧值核实后在迁移时清空 |
| `apps/server/src/routes/conversation.ts:42`（`app.updateBot`）及对应服务、`packages/contracts` 的 bot 更新输入 | 新增 `model` 入参，仅用户身份可写，校验模型可用（§3.3.8） |
| `packages/messaging/src/agent-data.ts:423`（`settingsDocument`）与文件导入（约 `:1221`） | 模型字段不进入 bot 可通过文件或 `UpdateProfile` 修改的范围 |
| 桌面端 bot 设置界面（落地时核对，候选 `apps/desktop/src/renderer/components/outcomego/bot-screen.tsx`） | 新增模型选择（提供方、模型、推理强度），显示生效模型与不可用提示 |
| `apps/worker/src/worker.ts:568-579`（记忆整理的一次性推理，用全局模型） | 不改：记忆整理仍用全局模型 |
| `apps/worker/src/worker.ts:1921`（`credentialScopeId`）与 `apps/computer`（按 `providerId` 取凭据） | 核实：独立模型的提供方凭据能否按 `providerId` 取到、与全局提供方是否共用同一套配置（`tasks.md` 0.1 第 13 项） |
| `apps/worker/src/worker.ts:632`（`OUTCOMEGO_WORKER_CONCURRENCY`，默认 8，全局 `bot-wake` 并发） | 评估是否需要随之调高，见 §8.1 |
| `apps/server/src/services/outcome-evidence-consumer.ts:41-43` | 已设置审查角色时跳过一次性预审 |
| `apps/server/src/services/outcome-review-service.ts` | 新增采纳初验入口；一次性预审保持 |
| `apps/server/src/services/outcome-chat-tools.ts` 与 `packages/contracts/src/outcome-chat.ts` | 新增 `SubmitOutcome`；已设置规划角色时，`CreateOutcome` 分支（`outcome-chat-tools.ts:168`）直接返回错误并提示改用 `SubmitOutcome`——控制点在服务端，工具列表仍是静态契约 |
| `apps/server/src/services/outcome-thread-tools.ts` 与 `packages/contracts` | 新增 `SavePlan`、`SubmitPrereview`、`ReviewTaskResult`；`execute` 按回合用途校验工具白名单（§3.3.9） |
| `apps/computer/src/runtime/tools.ts`（`goalThreadToolDefinitions`，只按 `goalThread` 标记给出全部目标线程工具）、`packages/contracts/src/service-protocol.ts`（turn 请求的 `goalThread`）、worker 组装 turn 请求处 | turn 请求带回合用途，计算机侧按用途过滤目标线程工具；生效需同步并重建远端 computer |
| `packages/messaging/src/prompts/platform.json` 与 `platform-system-prompt.ts` | 新增规划、重规划、审查、提交目标、执行任务的运行说明 |
| 桌面端目标详情与设置、Android、iOS | 见 §2.3.8 与需求 8 |

保留不变：`TrackOutcome`、`CloseOutcome`、成果简报与摘要的后台生成、`OutcomeReviewService.submit` 的验证规则。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6、7、8

- 角色解析：`resolveRole(role, outcome) → botId | fallback`。
- `OutcomeThreadService`：线程与回合唯一写入口，新增线程 `role`。
- 线程工具集：规划线程 `SaveOutcomeContract`、`SavePlan`、`CancelOutcome`（线程变体）、`GetOutcome`、`ListOutcomes`；审查线程整体初验回合 `GetOutcome`、`SubmitPrereview`，任务级审查回合 `GetOutcome`、`ReviewTaskResult`。
- 任务回合工具：`ReportOutcomeProgress`（现有）。
- 计划物化：同一服务方法同时用于批准与 `SavePlan` 调整。
- 依赖放行与门控：复用 `enqueueOutcomeTurn` 的依赖检查，加入审查与返工门控。
- 任务级审查：线程工具 `ReviewTaskResult`（仅审查线程的 `review_task` 回合）。

### 3.2 数据结构

覆盖需求：1、3、4、7、8

#### 3.2.1 角色设置

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `plannerBotId` | uuid | 否 | 规划 bot | 必须是存在且可运行的 bot；空表示回退 |
| `reviewerBotId` | uuid | 否 | 审查 bot | 同上 |
| `plannerModel` | `{ providerId, modelId, reasoning }` | 否 | 规划类回合使用的独立模型 | 必须是已配置可用的模型；空表示不覆盖，用该 bot 的 Bot 模型，未设置则用全局模型 |
| `reviewerModel` | `{ providerId, modelId, reasoning }` | 否 | 审查类回合使用的独立模型 | 同上 |
| `environmentNote` | string | 否 | 环境说明（账号与服务、项目与目录、bot 分工、偏好、禁区；不含凭据） | 上限 8000 字；纯文本 |

角色 = "以哪个 bot 的身份运行"（`plannerBotId`、`reviewerBotId`）+ "用哪个模型"（`plannerModel`、`reviewerModel`），两者独立。推荐配置：`plannerBotId` 与 `reviewerBotId` 都设为主 bot，只设置不同的模型，这样规划与审查共享主 bot 的记忆、persona、技能和文件，却用更强的模型。bot 与模型也可以分开设置：只设 bot 不设模型则用该 bot 的 Bot 模型（未设置则全局模型）；只设模型不设 bot 则以目标自己的 bot 身份、用该模型运行。

模型在创建回合时记录到回合上（`OutcomeThreadTurn.model`），回合运行期间改设置不会切换模型，与子 agent 沿用父运行模型的做法一致。

存放在目标管理设置中：全局单行 `featureSettings`（`id = "global"`，现有 `outcomesEnabled`、`streamBotReplies`，读写在 `packages/messaging/src/feature-settings.ts`），新增这三个字段。

#### 3.2.2 `PlanTask`（保存在修订的 `plan` 里）

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `key` | string | 是 | 计划内稳定标识，跨 `SavePlan` 调用保持 | 同一计划内唯一 |
| `title` | string | 是 | 任务标题 | 1..200 字 |
| `instructions` | string | 是 | 给执行 bot 的任务说明 | 1..8000 字 |
| `botId` | uuid | 是 | 指定的执行 bot | 存在且可运行；执行类型为 agent |
| `dependsOn` | string[] | 否 | 依赖的任务 `key` | 必须存在，无环 |
| `covers` | uuid[] | 是 | 本任务产出支持的验收项 ID | 必须属于该修订；所有 `required` 验收项至少被一个任务覆盖 |
| `nature` | enum | 是 | 任务性质：`deliverable`（成果类：文档、整理好的资料、调研结论、方案、表格、排期、代码等可检查、可修改的成果）/ `action`（操作类：对外部系统或现实环境执行了操作，如变更生产环境、发送通知、部署、预订、付款） | 没有默认值；拿不准选 `action`；决定是否做任务级审查与自动返工（§2.3.10） |

计划整体上限 20 个任务（实现时作为常量）。

#### 3.2.3 数据库变更

| 对象 | 变更 | 说明 |
| --- | --- | --- |
| `OutcomeContractRevision` | 新增 `plan Json?` | 任务计划，形如 `{ notes?: string, tasks: PlanTask[] }`（`notes` 为规划说明，上限 2000 字）；不进入 `contentHash`，因此不触发重新批准 |
| `OutcomeWorkItem` | 新增 `planKey String?` | 与修订联合唯一，用于幂等与批准后的差异比对 |
| `OutcomeThread` | 新增 `role`（`planner` / `reviewer`，默认 `planner`）；唯一约束由 `outcomeId` 改为 `(outcomeId, role)` | 允许一个目标有规划线程和审查线程 |
| `OutcomeThreadTurnPurpose` | 新增 `replan`、`review`、`review_task` | 与 `plan`、`owner_message` 并列 |
| `OutcomeThreadTurn` | 新增 `model Json?`（创建回合时记录的 `{ providerId, modelId, reasoning }`，空表示不覆盖，沿用 Bot 模型或全局模型）、`result Json?`、`workItemId String?` | `result` 保存初验摘要与关注点，或任务级审查结论（`verdict`、发现、备注、返工任务 ID）；`workItemId` 只用于 `review_task` 回合，指向被审查的任务 |

不新增 `OutcomeStatus` 或 `OutcomeWorkItemStatus` 值，也不新增驳回专用字段：驳回次数通过"该任务是否已有 `verdict = reject` 的审查回合"判断，返工任务沿用现有的 `kind = rework` 与 `reworkOfWorkItemId`。迁移通过 `db:push` 部署（沿用 004.2 父设计 §16）。

#### 3.2.4 Bot 模型

覆盖需求：13

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `Bot.inferenceProvider` | string | 否 | 提供方（现有列，当前未使用） | 与 `inferenceModel` 同时设置或同时为空 |
| `Bot.inferenceModel` | string | 否 | 模型（现有列，当前未使用） | 必须是已配置可用的模型 |
| `Bot.inferenceReasoning` | string | 否 | 推理强度（新增列） | 取值同全局设置的推理强度（`normalizePiReasoningLevel`）；空表示用全局推理强度 |

迁移通过 `db:push` 部署；已有的非空旧值核实后清空（`tasks.md` 0.1 第 14 项）。

### 3.3 接口契约

覆盖需求：2、3、7、8、1

#### 3.3.1 提交目标

- 类型：HTTP 与 bot 工具
- HTTP：沿用 004.8 的 `POST /api/outcomes/threads`；已设置规划角色时，线程 bot 为规划 bot，`botId` 入参语义为提交 bot。
- bot 工具：`SubmitOutcome`，输入 `{ text, exploreIdeaId?, clientRequestId }`。`text` 是用户原话，逐字送达（属性 2 不变）。背景说明字段后置（§8.3）；已设置规划角色时，`CreateOutcome` 在服务端被拒绝并提示改用 `SubmitOutcome`。
- 校验：提交 bot 存在且可运行；`exploreIdeaId` 对应未转换的想法；开关开启。
- 错误：`outcomes_disabled`、`invalid_request`、`idempotency_conflict`。

#### 3.3.2 线程工具 `SavePlan`

- 类型：动态工具（仅规划线程）
- 输入：`{ expectedRevision: number, notes?: string, tasks: PlanTask[], clientRequestId }`；`notes` 是规划说明（上限 2000 字），保存到计划里，审查回合和用户可读。
- 行为：
  - 修订为待批准：整体替换该修订的计划。
  - 修订已批准：按 `key` 与现有任务比对，只允许新增，以及修改、移除未开始任务（`queued` 且 `rootRunId` 为空）；其他任务必须原样出现；变更后立即物化（新任务尝试入队，被移除的任务置为 `cancelled`）。
  - 与当前计划完全相同则拒绝（`plan_unchanged`）。
- 输出：目标详情与"请用户批准契约，不要自行批准"的下一步提示。
- 校验补充：每个任务必须声明 `nature`（`deliverable` / `action`），没有默认值，缺失时返回该任务的 `key`。
- 错误：`invalid_request`（带字段与 `key`）、`plan_revision_conflict`、`plan_cycle`、`plan_uncovered_criteria`、`plan_task_locked`、`plan_unchanged`、`outcome_terminal`。

#### 3.3.3 线程工具 `SubmitPrereview`

- 类型：动态工具（仅审查线程）
- 输入：`{ expectedRevision, results: [{ criterionId, suggestion, reason, evidenceIds? }], summary, attention: [{ criterionId?, question }], clientRequestId }`
- 行为：为每个结果写一条 `ai_prereview` 证据（`sourceType = prereview`，`capturedBy = bot:<审查 bot>`）；摘要与关注点写入回合 `result`；不写 `OutcomeReview`，不改变目标状态。
- 校验：每条验收项恰好一个结果；`summary` 上限 1500 字；修订必须是当前修订；`likely_fail` 只允许用于必需验收项，非必需验收项只能是 `likely_pass` 或 `unclear`；`attention` 里每一项必须对应一个 `likely_fail` 或 `unclear` 的必需验收项，优化建议只能写在 `summary` 的备注段落，不能进入 `attention`。
- 错误：`invalid_request`、`review_revision_conflict`、`prereview_incomplete`。

#### 3.3.4 角色设置接口

- 类型：HTTP
- 路径：沿用目标管理设置的读写接口，新增 `plannerBotId`、`reviewerBotId`、`plannerModel`、`reviewerModel`、`environmentNote`（全部可选，旧客户端不受影响；`UpdateFeatureSettingsInput` 本来就是全可选字段，`packages/contracts/src/index.ts:2136`；落地前核对接口位置，见 `tasks.md` 0.1）。
- 校验：bot 存在且可运行；模型必须是已配置可用的模型；`environmentNote` 不超过 8000 字。
- 错误：`invalid_request`、`bot_not_runnable`、`model_unavailable`。

#### 3.3.5 采纳初验

- 类型：HTTP
- 路径：`POST /api/outcomes/:id/reviews/adopt-prereview`
- 输入：`{ expectedRevision, turnId, clientRequestId }`
- 行为：读取该审查回合的 `result` 与对应 `ai_prereview` 证据，对 `likely_pass` 的验收项组装 `SubmitOutcomeReviewInput`（`userConfirmed = true`，`reviewedBy` 为用户），交给 `OutcomeReviewService.submit`。
- 校验：开关开启；用户身份；修订与回合一致；该回合属于当前修订。
- 错误：沿用 `review_revision_conflict`、`outcome_not_found`、`invalid_outcome_transition`，新增 `prereview_stale`。

#### 3.3.6 提示词与上下文

平台提示词按线程角色与回合用途追加：

- **规划（plan / replan）**：你是规划角色，用户的话由你判断意图；写契约用 `SaveOutcomeContract`，拆任务用 `SavePlan`，不要只在回复里描述；任务要最小化，只在确实互相独立或有先后顺序时才拆分；按目标类型的自然单元拆分（资料整理按来源或主题，文档按章节或交付物，运维按变更步骤并标明风险，项目管理按工作包），不要默认套"设计、实现、测试"的流程；每个任务必须声明 `nature`：`deliverable` 是可检查、可修改的成果，`action` 是对外部系统或现实环境执行的操作，拿不准选 `action`；需要真人到现场的步骤，在任务指令里写明由执行 bot 用动作卡请求，不要自己创建人工任务；不要在计划里授予任何权限或凭据；不能批准契约或验收成果。
  - 环境：你的上下文含用户的共享记忆、"环境说明"、提交 bot 的名称与 id 和"可指派 bot 清单"（id、名称、`description`、生效模型）。规划前先用 `RecallMemory` 检索与目标相关的共享事实；信息冲突时按"用户当前的话 > 更新的共享事实 > 环境说明"取舍，冲突会影响计划时先向用户确认，不要猜；需要更多背景时，可以用 `ReadTranscript` 读提交 bot 与用户的对话；用户在线程里透露的环境事实（账号、目录、偏好、禁区）用 `UpdateMemory` 写入共享记忆，不要只写进自己的角色记忆。
  - 任务指令必须自包含：写明背景、涉及的资源位置（路径、账号名、资料引用）、约束、完成标准，不要假设执行 bot 知道用户的环境；凭据不写进指令。执行 bot 只会看到你写进指令的内容。
  - 保存计划时用 `notes` 写规划说明：为什么这样拆、对环境做了什么假设、已知风险。审查角色会读它。
- **提交目标（普通 bot，已设置规划角色时）**：用 `SubmitOutcome` 逐字提交用户原话，不要改写、不要在提交的文字里加入你自己的理解或补充、不要自己写契约。
- **执行任务**：只做被分配的任务；用 `ReportOutcomeProgress` 更新进度；产出和证据写清楚；不要修改计划或契约。收到返工任务时，只修改审查发现指出的问题，不要重做整个任务，也不要顺手改其他地方。
- **任务级审查（review_task）**：你只检查这一个任务的结果，默认结论是通过，拿不准就通过。只读已记录的产出和证据，不要重新执行任务。
  - 只对照两样东西判断：该任务覆盖的**必需**验收项，和契约里的边界。
  - 只有两种情况才驳回：严重错误（结果与必需验收项或边界明显矛盾、关键事实错误）和遗漏（必需验收项要求的产出缺失）。
  - 驳回必须写：依据（哪条必需验收项或哪条边界）和理由（产出的哪里与依据不符）。写不出这两样就不要驳回。
  - **以下一律不是驳回理由**，只能写进 `note`：格式、排版、措辞、命名、结构、风格、"更完整、更详细或更好的做法"、额外的检查或内容、非必需验收项、你自己新增的要求，以及"多做了点什么"（除非它违反 `excluded` 的某一条）。
  - 你的上下文含契约、计划里的规划说明（`notes`）、用户的共享记忆和环境说明。判断产出是否合理时，先读规划说明，理解规划角色对环境做了什么假设；规划说明或环境说明与产出不符时写进 `note`，不要据此驳回。
  - 关于外部系统或现实世界的事实，只有外部记录、确定性检查、人工回执算证据；执行 bot 自己的陈述只能说明"产出里写了什么"。缺证据时不要驳回，在 `note` 里写缺什么，由整体初验标为 `unclear`。验收项的验证方式是确定性检查时，只核对检查证据是否存在且为通过，不要自己重新执行。
  - `note` 不会发给执行 bot，不要把它写成必须修改的要求，也不要用它代替驳回。
  - 每个任务只能驳回一次，驳回后不会再审查该任务，所以一次把真正的问题写全；不要拿非必要的问题凑数。
- **整体初验（review）**：你的目标是减少用户要看的信息量，不是增加。对照验收项和契约边界检查：必需验收项是否满足；是否违反 `excluded` 的某一条；报告里的验证声明是否有证据支持。对每项给出建议和理由，并写一份用户 30 秒能读完的摘要。`likely_fail` 和"需用户关注的问题"只能用于必需验收项没有满足、或违反了 `excluded`；加入了没要求的内容或步骤、格式、措辞、风格或优化建议，只写进摘要末尾的备注段，不要列为需用户处理的项。关于外部系统或现实世界的事实，只有外部记录、确定性检查、人工回执算证据，执行 bot 的陈述不算；缺证据时标 `unclear` 并说明缺什么，不要标 `likely_pass`，也不要标 `likely_fail`。验收项的验证方式是确定性检查时，只核对检查证据是否存在且为通过，不要自己重新执行。你只提供建议，不能验收。

#### 3.3.7 线程工具 `ReviewTaskResult`

- 类型：动态工具（仅审查线程的 `review_task` 回合）
- 输入：`{ workItemId, verdict: "pass" | "reject", findings: Finding[], note?, clientRequestId }`
  - `Finding`：`{ kind: "error" | "omission", basis: { criterionId } | { boundary: { side: "included" | "excluded", index } }, reason }`。`reason` 必填，一两句话说明产出的哪里与依据不符，有长度上限；服务端只校验依据，不判断理由是否成立。
- 行为：
  - `pass`：记录结论，放行依赖任务；`note` 写优化建议，只作为整体初验的素材，不触发返工，也不发给执行 bot。
  - `reject`：必须至少一条 `findings`；通过全部校验后创建返工任务（§2.3.9 步骤 4）。返工指令只包含原指令和 `findings`，不包含 `note`。
- 校验：
  - `workItemId` 必须是该回合记录的任务，状态为 `completed`，由计划创建且计划里声明 `nature = deliverable`，没有被驳回过，不是返工任务。
  - `basis.criterionId` 必须是该任务覆盖的**必需**验收项；`basis.boundary` 必须指向契约里真实存在的那一条；`kind = omission` 只能依据验收项；`kind = error` 可依据验收项或边界，其中"多做了没要求的事"只有违反 `excluded` 的某一条才成立。
  - `note` 与每条 `reason` 有长度上限。
- 输出：结论确认，驳回时附返工任务 ID。
- 错误：`invalid_request`、`review_reject_exhausted`（该任务已被驳回过一次）、`review_not_rejectable`（依据不是必需验收项或边界、依据未被该任务覆盖，或任务是返工任务）、`review_task_stale`（任务已不是当前修订或已被取消）。

#### 3.3.8 设置 bot 模型

- 类型：HTTP
- 路径：沿用 bot 更新接口（`apps/server/src/routes/conversation.ts:42` 调用 `app.updateBot`；落地前核对路径与入参）
- 输入：在现有入参上新增 `model: { providerId, modelId, reasoning? } | null`；`null` 清空
- 校验：用户身份；`providerId` 与 `modelId` 同时存在；模型必须是已配置可用的模型（可用列表沿用现有模型设置，`apps/server/src/services/settings-service.ts`）
- 输出：更新后的 bot，含用于展示的生效模型
- 错误：`invalid_request`、`model_unavailable`、`bot_not_found`

#### 3.3.9 目标线程工具白名单（服务端执行）

覆盖需求：5.3、7.2、9.1、10.2、11.6

`OutcomeThreadTools.execute`（`apps/server/src/services/outcome-thread-tools.ts`）现在只校验"工具名属于目标线程工具、线程 bot 与调用 bot 一致"。在此之后增加按 `turn.purpose` 的白名单：

| 回合用途 | 允许的目标管理工具 |
| --- | --- |
| `plan`、`owner_message`、`replan` | `SaveOutcomeContract`、`SavePlan`、`CancelOutcome`（须用户触发）、`GetOutcome`、`ListOutcomes` |
| `review` | `GetOutcome`、`SubmitPrereview` |
| `review_task` | `GetOutcome`、`ReviewTaskResult` |

不在白名单的调用返回 403 `outcome_thread_tool_forbidden`。计算机侧同步按用途过滤，让模型根本看不到不该用的工具；服务端校验才是真正的控制点。

边界说明：

- 白名单只约束目标管理类工具。审查回合仍保留与其他后台回合相同的通用工具（Shell、发消息等）；"只读已记录的产出、不重新执行任务"是提示词约束，不是技术限制。（通用工具是否保留在目标线程回合里，由 `tasks.md` 0.1 第 12 项核实。）
- 工作项回合（执行任务）调用目标线程工具现在就会被拒绝：它没有对应的线程回合（`outcome_thread_required`）。
- 目标线程工具集里没有 Decision 与凭据类工具：`RequestOutcomeDecision`、`RequestHumanAction`、`RequestBitwardenReadApproval` 只在工作项回合注册（`apps/computer/src/runtime/tools.ts` 的 `OUTCOME_THREAD_TOOLS` 一带）。所以规划与审查不产生动作授权（属性 12），由工具集合断言测试保证。

#### 3.3.10 客户端读取契约

覆盖需求：8.1、8.6、9.3、10.11

- `OutcomeDetail`：新增 `plan`（`{ notes, tasks: [{ key, title, botId, dependsOn, covers, nature }] }`，当前修订；没有计划时为空）；任务视图新增 `planKey`、`nature`、`review`（`{ state: "none" | "passed" | "rejected_once" | "unreviewed", findings }`）；新增 `prereview`（当前修订的最新初验：`{ turnId, revision, summary, attention, results[] }`，没有时为空）。
- `GET /api/outcomes/:id/thread`：保留原有 `threadId`、`turns`（规划线程，旧客户端不受影响），新增 `reviewTurns`（审查线程的回合，每项含 `purpose`、`status`、`workItemId`、结果摘要、`model` 与回退标注）；`OutcomeThreadTurnView.purpose` 新增 `replan`、`review`、`review_task`。
- 回合记录读取沿用 004.8 的 `GET /api/outcomes/:id/thread/turns/:turnId/transcript`。
- 兼容：新增字段全部可选，旧客户端忽略；移动端只需读取 `prereview` 与 `plan`。

#### 3.3.11 事件

覆盖需求：9.4、非功能 3.2

`OUTCOME_EVENT_TOPICS`（`packages/contracts/src/outcomes.ts:121`）是封闭列表，新主题必须先注册（任务 1.2）：

| 事件 | 触发 | 载荷要点 |
| --- | --- | --- |
| `outcome.plan.saved` | `SavePlan` 成功 | 修订号、任务 key 列表 |
| `outcome.replan.requested` | 失败任务触发重规划 | 任务 ID、原因 |
| `outcome.task_review.decided` | `ReviewTaskResult` 通过或驳回，或审查失败按通过放行 | 任务 ID、verdict 或 `unreviewed`、发现 |
| `outcome.prereview.submitted` | `SubmitPrereview` 成功 | 修订号、各验收项建议 |

任务创建沿用 `outcome.work_item.created`；依赖放行与任务进入运行沿用 `outcome.work_item.updated`，不新增。每个事件带幂等键和触发者（`bot:<id>` 或 `system:<原因>`）。

## 4. 数据与状态模型

### 4.1 数据关系

`Outcome 1 — N OutcomeThread（planner / reviewer，每个角色至多一个）1 — N OutcomeThreadTurn N — 1 Run`。

`OutcomeContractRevision 1 — 0..1 plan（JSON，含 N 个 PlanTask）`，批准后物化为 `OutcomeWorkItem N`，每个任务带 `planKey`、`botId`、`dependsOn`（任务 ID）。

### 4.2 状态流转

任务状态沿用现有枚举。新增语义：

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `queued`（等待中） | 已创建，等依赖、等门控或等并发名额；`rootRunId` 为空 | 批准或 `SavePlan` 创建 | 依赖和门控满足且有并发名额后入队 Run；被 `SavePlan` 移除：转 `cancelled` |
| `queued`（被阻塞） | 等待中，但它的某个依赖（或该依赖的返工任务）已 `failed` 或 `cancelled`；不再算"推进中" | 依赖失败 | 规划角色移除（`cancelled`）或修改；用户处理 |
| `queued`（已入队）/ `running` | 已入队或正在执行 | 同上 | 沿用现有 |
| `completed` + 门控 | 任务已完成，但可能还在等任务级审查或返工 | 任务结算 | 审查通过、或返工任务 `completed`、或审查失败视为通过 |
| 其余 | 同 004.2 / 004.5 | 同 | 同 |

不引入新的任务状态：等待依赖沿用现有的 `queued` 加待处理排队记录；门控不是任务状态，而是由"是否存在未出结论的 `review_task` 回合、是否存在未完成的驳回返工任务"这两个事实派生。

目标状态沿用 `recomputeOutcomeStatus`，补充规则：

- `planning`：沿用现有规则——`recomputeOutcomeStatus` 只在修订为草稿或待批准时，对排队、运行中的 `plan`、`owner_message` 回合生效（`outcome-state.ts:182`）。`replan` 回合发生在已批准的修订上，不改变目标状态。
- 所有任务 `completed`，但存在未出结论的 `review_task` 回合或未完成的返工任务时，保持 `running`，不进入 `review_pending`。
- 整体初验回合（`review`）不影响目标状态。

- **失败任务（已确认的规则，见 §8.3）**：当前修订存在 `failed` 任务时，（a）有"推进中"的任务（`queued`、`running`、`retry_pending`、`needs_review`，不含被失败依赖阻塞的等待任务），或有排队、运行中的 `replan` 回合：`running`；（b）否则，且最大序号的失败任务之后没有未失败、未取消的任务：`failed`；（c）否则按现有规则。
- 为什么要改：现有规则在"没有活跃任务且有任何任务 `completed`"时进入 `review_pending`（`outcome-state.ts:167-170`），多任务计划下"一个任务失败、其余完成"的目标会被当成待验收；而依赖失败任务的等待任务是 `queued`，被算作活跃（`:16`），目标会永远停在 `running`。
- "已被替代"的判定用事实而不是新字段：失败任务之后（序号更大）出现过一个未失败、未取消的任务，就认为规划角色已经安排了替代。这是默认判定，待用户确认（§8.3）。

## 5. 错误处理

### 5.1 错误类型

- 校验错误：`SavePlan`、`SubmitPrereview` 入参不合法（字段、环、未覆盖验收项）。
- 业务规则错误：修订已变化、计划与锁定任务冲突、初验过期。
- 授权错误：机器人试图批准、验收；非用户触发的取消；任务回合调用规划工具。
- 容量错误：规划或审查 bot 并发已满，回合排队，不报错。
- 运行错误：角色 bot 不可运行、回合中断、审查失败。

### 5.2 错误响应格式

沿用 004.2 `ApiError`（`code`、`message`、`details.retryable`）。工具错误带具体字段与任务 `key`，让规划角色在同一回合修正。

### 5.3 处理策略

1. 输入验证错误：工具返回具体错误，规划或审查角色在同一回合修正。
2. 业务规则错误：返回当前事实（当前修订号、被锁定的任务），角色重读后重试。
3. 角色 bot 不可运行：新回合回退到未设置时的行为，设置页提示。
4. 审查失败：详情提示，不阻塞用户验收（本版不提供重试入口）。
5. 重启：队列保留；运行中回合与任务按 004.5 续跑或失败。

## 6. 正确性属性

### 6.1 属性 1：机器人永远不能批准或验收

*对于任何* 线程工具与任务工具的调用序列，系统都不能产生已批准的修订或已验收的目标，除非该操作来自用户界面的批准或验收接口。采纳初验接口必须由用户身份调用，且最终经过 `OutcomeReviewService.submit`。

**验证需求：** 8.5、9.1

### 6.2 属性 2：任务只由计划产生

*对于任何* 目标，批准后存在的 agent 任务都能追溯到一份已保存的计划（`planKey`），或属于无计划回退时的唯一 initial 任务、004.2 的返工任务。

**验证需求：** 3.1、4.1、4.4

### 6.3 属性 3：依赖不被绕过

*对于任何* 有依赖的任务，只有当它的所有依赖都是 `completed`，且这些依赖都没有未出结论的任务级审查、没有未完成的返工任务时才会被排队，且只被唤醒一次；依赖任务指定的 bot 与它不同时同样成立。

**验证需求：** 4.2、4.3、4.5、10.1、10.6、非功能 2.2

### 6.4 属性 4：规划不改动已开始的任务

*对于任何* 批准后的 `SavePlan`，已入队 Run、运行中或已结束的任务的指令、指定 bot、依赖保持不变。

**验证需求：** 6.2

### 6.5 属性 5：审查角色不能批准或验收

*对于任何* 审查回合，系统只新增 `ai_prereview` 证据、回合结果，以及任务级审查驳回产生的返工任务；不新增 `OutcomeReview`，不批准契约，不修改契约或计划，不直接改变目标状态。

**验证需求：** 7.2、7.4、8.5、10.2

### 6.6 属性 6：取消只由用户触发

*对于任何* 目标取消，其回合触发者必须是用户；系统触发的 `replan` 与 `review` 回合不能取消目标。

**验证需求：** 6.5、9.2

### 6.7 属性 7：未设置角色时行为不变

*对于任何* 未设置规划角色与审查角色的目标，创建、规划、批准、执行、预审的行为与 004.8 一致。

**验证需求：** 1.3、2.3、4.4、7.6、9.5

### 6.8 属性 8：状态可由事实重算

*对于任何* 时刻，目标状态等于 `recomputeOutcomeStatus` 在当前事实上的结果。

**验证需求：** 6.4、10.1

### 6.9 属性 9：每个任务最多被驳回一次

*对于任何* 任务及其返工链，`verdict = reject` 的审查回合至多一个；返工任务不会产生新的 `review_task` 回合；每次被接受的驳回都至少带一条发现，其依据是该任务覆盖的必需验收项或契约里真实存在的边界，并带有理由；返工任务的指令里不出现审查备注。

**验证需求：** 10.4、10.5、10.7、10.9、10.12

### 6.10 属性 10：审查失败不阻塞

*对于任何* 审查回合失败、超时或审查 bot 不可运行的情况，被审查的任务按"通过"放行，目标详情标注"未经审查"，目标不会因此停在 `running`。

**验证需求：** 10.10

### 6.11 属性 11：操作类任务不被自动返工

*对于任何* `nature = action` 的任务、无计划回退的单个任务、返工任务和人工任务，系统都不排任务级审查，也不会因审查创建返工任务。

**验证需求：** 10.1、11.2、11.5

### 6.12 属性 12：规划与审查不产生动作授权

*对于任何* 规划、重规划、审查回合，系统都不新增、修改或撤销任何凭据授权或对外操作的批准；这些只来自用户对 Decision 的回答。

**验证需求：** 11.6

### 6.13 属性 13：环境信息按最小必要传递

*对于任何* 目标，环境说明只出现在规划类与审查类回合的上下文里，不自动出现在执行任务回合里；用户原话在规划回合里仍逐字送达；规划、审查回合不能读取其他 bot 的私有记忆。

**验证需求：** 12.1、12.2、12.4、12.5

### 6.14 属性 14：角色模型只作用于角色回合

*对于任何* 运行，只有记录了 `OutcomeThreadTurn.model` 的 `outcome_thread` 回合使用独立模型；同一个 bot 的主对话、自动化、执行任务使用生效模型中的 Bot 模型（未设置则全局模型），不使用角色模型；记忆整理等后台一次性推理仍使用全局模型；回合创建后修改设置不改变该回合已记录的模型；模型不可用时回退到下一级（Bot 模型，再到全局模型）并标注。

**验证需求：** 1.8、1.9、1.10

### 6.15 属性 15：每个 bot 的生效模型按优先级确定，且只有用户能改

*对于任何* 运行，实际使用的模型等于优先级（子 agent 父运行 > 角色回合独立模型 > Bot 模型 > 全局设置）中第一个可用的一级，并记录在 `Run` 上；*对于任何* 工具调用或文件编辑序列，bot 都不能改变任何 bot（包括自己）的模型设置；没有设置任何模型时所有运行用全局设置。

**验证需求：** 13.2、13.6、13.8

### 6.16 属性 16：失败任务不会被藏在待验收里

*对于任何* 当前修订存在失败任务、且没有被替代的时刻，目标状态不是 `review_pending`；被失败依赖阻塞的等待任务不会让目标永远停在 `running`；重规划回合排队或运行期间目标不显示 `failed`。

**验证需求：** 6.6

## 7. 测试策略

### 7.1 单元测试

- `SavePlan`：重复 `key`、依赖缺失、成环、bot 不可运行、验收项未覆盖、超上限、批准后改动被锁定任务、无变化。
- 角色解析：已设置、未设置、bot 被删除或不可运行。
- 依赖放行：全部依赖完成才放行、并发完成只唤醒一次、依赖失败不放行。
- `SubmitPrereview`：每项一个结果、修订过期、只产生 `ai_prereview` 证据。
- 采纳初验：只对 `likely_pass` 项生效、修订过期拒绝、经现有验收校验。
- 取消授权：用户触发 vs 系统触发（`replan`、`review`、`review_task`）。
- `ReviewTaskResult`：通过、驳回（依据合法）、第二次驳回被拒、对返工任务驳回被拒、任务已取消或修订过期。
- 驳回约束：依据是非必需验收项被拒；依据是该任务未覆盖的验收项被拒；边界编号不存在被拒；缺少理由被拒；"多做"但未违反 `excluded` 被拒；对 `nature = action` 的任务、无计划回退的单个任务、人工任务排队或驳回都被拒。
- 环境上下文：规划与审查回合的上下文含环境说明，执行任务回合不含；设置了环境说明后新建的规划线程能看到它；环境说明超过 8000 字、规划说明超过 2000 字被拒；用户原话仍逐字一致。
- 任务性质：`SavePlan` 缺 `nature` 被拒；`action` 任务完成后不排 `review_task`；`deliverable` 任务完成后排队；无 `planKey` 的任务、返工任务、人工任务不排。
- 证据规则：外部事实只有 `agent_report` 证据时，整体初验结果为 `unclear`，不是 `likely_pass`，任务级审查不以此驳回。
- 备注隔离：带 `note` 的通过与驳回，返工任务指令和发给执行 bot 的内容里都不出现 `note`。
- 整体初验约束：非必需验收项标为 `likely_fail` 被拒；`attention` 里出现优化项被拒。
- 驳回产生的返工任务：bot 与原任务相同、指令只含原指令与审查发现、`reworkOfWorkItemId` 正确。
- 依赖门控：审查未出结论时不放行；驳回后等返工任务完成才放行；审查失败视为通过。
- 独立模型：设置了 `plannerModel` 的规划回合 `Run` 记录该模型，同一 bot 的主对话仍记录全局模型；回合创建后改设置不影响已记录的模型；模型不可用时回退全局模型并在回合记录里标注；角色 bot 设为主 bot 时回合上下文含它的个人记忆与共享记忆。
- Bot 模型：优先级（子 agent > 角色模型 > Bot 模型 > 全局）、某一级不可用时逐级回退并标注、运行创建后改设置不影响已记录的模型、清空后回到全局；更新接口只接受用户身份、模型不可用被拒；`UpdateProfile` 与 `settings.json` 修改模型字段无效；后台一次性推理仍用全局模型。
- 目标状态：一个任务 `failed`、其余 `completed` 且无替代 → `failed`，不是 `review_pending`；`replan` 回合排队或运行时 → `running`；失败任务之后出现未失败、未取消的任务后可进入 `review_pending`；被失败依赖阻塞的等待任务不算推进中；`replan` 回合不使 `planning` 状态出现在已批准修订上。
- 重规划触发：`failed` 与 `needs_review` 从恢复路径（`outcome-recovery.ts`）、结算路径、`bot_not_runnable` 进入时都触发；返工任务失败时下游保持等待并触发重规划。
- 修改未开始任务：先删记录再以新 `clientId` 重新入队，放行时不抛 `idempotency_conflict`，且不影响无关任务的结算事务。
- 工具白名单：审查回合调 `SaveOutcomeContract`、任务级审查回合调 `SubmitPrereview`、规划回合调 `ReviewTaskResult` 都返回 403；规划线程、审查线程的工具集合里没有 Decision 与凭据类工具。
- `CreateOutcome` 在规划角色已设置时被拒绝并提示 `SubmitOutcome`，未设置时行为不变。
- 角色设置：模型不可用时保存被拒；环境说明超长被拒。
- 并发上限：同一 bot 的规划类回合最多 5 个同时运行，审查类最多 5 个，执行任务仍为 2，三者互不占用。

### 7.2 集成测试

- 提交目标：同一事务创建目标、规划线程与回合；幂等；规划 bot 与提交 bot 不同。
- 批准：按计划创建任务；幂等；无计划回退为单个 initial 任务。
- 任务失败触发 `replan`；规划角色调整后未开始任务继续。
- 进入 `review_pending` 触发 `review` 回合；已设置审查角色时不再运行一次性预审。
- 任务完成触发 `review_task` 回合；A 完成、B 指定给另一个 bot：A 通过审查后 B 被唤醒（覆盖跨 bot 放行）。
- 所有任务完成但最后一个审查未出结论：目标保持 `running`；结论写入后进入 `review_pending` 并触发整体初验。
- 重启恢复：规划、重规划、审查回合与依赖任务。
- 开关关闭、角色 bot 不可运行时回退。

### 7.3 端到端测试

- 真实规划 bot + 两个执行 bot：提交"含先后顺序的目标"，得到带依赖的计划，批准后按顺序完成。
- 多种目标类型各走一遍：资料整理、文档编写、项目管理（成果类，经过任务级审查）；运维变更（操作类，不被自动返工，凭据批准仍走 Decision）；含现实任务的目标（人工任务沿用动作卡与回执，不被审查）。
- 一个任务失败：规划角色重排后续任务，用户未被打扰。
- 审查 bot：用户只处理被标出的项，"采纳初验通过项"后目标可验收，且仍需用户点击。
- 审查 bot 驳回一个带明显遗漏的任务：原 bot 返工一次，之后放行；构造一个只有优化空间的任务，确认不被驳回。
- 两个角色都未设置：行为与 004.8 一致。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §2.3.1、§2.4、§3.2.1、§3.3.4 | 单元测试（含并发上限）、集成测试 |
| 需求 2 | §2.3.2、§3.3.1 | 集成测试、端到端 |
| 需求 3 | §2.3.3、§3.2.2、§3.3.2、§6.2 | 单元测试 |
| 需求 4 | §2.3.4、§4.2、§6.3 | 单元测试、集成测试 |
| 需求 5 | §2.3.5、§3.3.6 | 集成测试 |
| 需求 6 | §2.3.6、§4.2、§6.4、§6.16 | 单元测试、集成测试、端到端 |
| 需求 7 | §2.3.7、§3.3.3、§3.3.9、§6.5 | 单元测试、集成测试 |
| 需求 8 | §2.3.8、§3.3.5、§3.3.10、§6.1 | 单元测试、桌面端与移动端测试、端到端 |
| 需求 9 | §3.3.9、§3.3.11、§5、§6 | 单元测试、集成测试 |
| 需求 10 | §2.3.9、§3.3.7、§3.3.9、§4.2、§6.9、§6.10 | 单元测试、集成测试、端到端 |
| 需求 11 | §2.3.10、§3.2.2、§3.3.6、§6.11、§6.12 | 单元测试、集成测试、多类型样例评估（`tasks.md` 5.3） |
| 需求 12 | §2.3.11、§3.2.1、§3.3.1、§3.3.2、§3.3.6、§6.13 | 单元测试（上下文构成、长度上限）、集成测试、真实规划 bot 评估（`tasks.md` 5.4） |
| 需求 13 | §2.3.12、§2.4、§3.2.4、§3.3.8、§6.15 | 单元测试（选模型优先级、回退、权限）、集成测试、桌面端测试 |

## 8. 风险与待确认项

### 8.1 风险

- **规划角色是瓶颈**：所有目标的规划与重规划都排到同一个 bot。已确认把规划类回合与审查类回合的并发上限各提到 5（执行任务仍为 2）。缓解：用户消息优先；规划回合只读事实并写结果；仍不够用再考虑多个规划 bot（本 Spec 不做）。
- **全局 worker 并发可能先成为瓶颈**：`OUTCOMEGO_WORKER_CONCURRENCY` 默认 8（`apps/worker/src/worker.ts:632`）是所有 bot 的 `bot-wake` 总并发。规划 5 + 审查 5 + 若干执行任务会超过 8，超出部分在 worker 层排队，每个角色的"5"并不能全部同时跑满。缓解：落地前评估是否调高默认值或写进部署说明，由用户决定。
- **并发上限是新增而不是提高**：已核实线程回合的租约 scope 是 `outcome-thread:<id>`（`worker.ts:1647`），不被现有 `outcome:`、`automation:` 计数覆盖（`worker.ts:1447-1450`），所以线程回合目前没有按 bot 的并发上限；"5"是新增上限。风险：新增限流改动 worker 的领取逻辑，要有测试覆盖，且不能影响执行任务的 2。
- **审查拖慢执行**：每个任务完成后多一轮审查，门控期间下游任务要等。缓解：审查回合只读已记录的产出和证据；独立任务并行审查；审查失败视为通过；只有严重错误和遗漏才驳回，不做优化类返工。
- **审查过度**：审查 bot 倾向于挑毛病（尤其是强模型），把优化项说成必须项。服务端只能校验"形式"（依据必须是必需验收项或真实边界，必须写明理由，备注不外发，每任务至多一次，返工后不再审），不能判断"严重"本身。缓解：形式约束让"随便挑一条"不可行；提示词给出明确的"不是驳回理由"清单；每次驳回的发现与依据都展示在任务列表并保存，用户能看到，也能事后统计驳回率；用样例评估审查提示词（`tasks.md` 5.3）；上线后驳回率偏高再收紧。本 Spec 不做自动熔断。
- **每个 bot 单独设置模型是新能力**：现在没有 bot 级模型的读写。风险：一是 `Bot` 两列可能有未知的旧值；二是用户给多个 bot 设置不同供应商后，凭据与额度分散，不可用时的回退要让用户看得见（运行记录与设置页提示）；三是不同 bot 模型能力不一致，同一份提示词（尤其审查约束）对较弱的模型可能效果不同。缓解：迁移时核实并清空旧值；回退必标注；5.3、5.4 的评估对不同模型各跑一遍；落地前核实（`tasks.md` 0.1 第 14 项）。
- **按回合覆盖模型是新能力**：现在没有"某类回合用另一个模型"的机制（只有子 agent 沿用父运行模型）。风险：独立模型的提供方凭据不可用，或与 computer 运行时的模型引用格式（`formatPiModelRef`）不兼容。缓解：保存设置时校验模型可用；回合开始时模型不可用则回退到全局模型并在回合记录里标注，不阻塞；落地前核实（`tasks.md` 0.1 第 13 项）。
- **同一 bot 并发写记忆**：规划、审查回合与主对话同时以主 bot 身份运行，可能同时写个人记忆或共享记忆。现有记忆写入按命名空间加锁（`index.ts` 的 `lockMemoryNamespace`），同一 bot 的主对话与自动化回合本来就会并发，所以预期可行；落地前确认目标线程回合的记忆学习不会重复整理同一段对话（`tasks.md` 0.1 第 12 项）。
- **规划与审查用同一个 bot 身份**：审查者与被审查的规划者共享同一份记忆与 persona，可能带着相同偏见。缓解：模型不同；审查只对照必需验收项和契约边界，不对照"规划者的想法"；规划说明仅作参考，不作驳回依据（§3.3.6）。
- **环境说明过时或写得不全**：环境说明由用户维护，可能落后于实际。缓解：优先级规定里它排在用户当前的话和更新的共享记忆之后；冲突影响计划时向用户确认；设置页显示最后更新时间。
- **规划 bot 是新 bot，开始时对环境一无所知**：缓解：共享记忆自动提供用户层面的事实；环境说明补上结构化的部分；`ReadTranscript` 可以按需读主 bot 的可见对话；也可以直接让主 bot 担任规划角色（§2.3.11 取舍 6）。
- **环境说明可能误写入凭据**：它会进入模型提供方的上下文。缓解：设置页提示不要写凭据，凭据走 Bitwarden 授权；本 Spec 不做服务端拦截。
- **任务性质判断错误**：规划角色可能把有副作用的任务标成 `deliverable`，导致它被自动返工并重复操作。缓解：`nature` 没有默认值；提示词要求拿不准选 `action`；返工指令只要求"修改审查发现指出的问题"，不要求重做整个任务；每次驳回都可见。需要时可以让规划角色在计划里用文字说明理由（本 Spec 不强制）。
- **审查角色读不了所有类型的产出**：文档、表格、PDF、图片等非文本产出审查 bot 不一定能读。缓解：落地前核实审查 bot 能读取哪些产出类型（`tasks.md` 0.1 第 11 项）；读不了的产出审查 bot 标 `unclear` 并说明，不据此驳回。
- **漏驳回**：默认通过和"拿不准就通过"会放过一部分真实问题。这是有意的取舍；整体初验和用户最终验收仍会兜底。
- **规划角色可能不保存计划**：缓解见需求 3.7（提示、可继续发消息、批准后回退为单任务）。
- **提交 bot 可能改写用户原话**：服务端无法验证。缓解：提示词要求逐字提交；规划线程可向用户追问。
- **审查角色只能看到记录在目标里的产出与证据**：看不到执行 bot 工作区里没有登记的文件。缓解：执行任务提示词要求把产出和证据写入目标。
- **跨 bot 依赖放行是现有逻辑的缺口**：`dispatchQueuedOutcomeWorkItems` 只挑同一个 bot 的排队任务（`outcome-threads.ts:104-130`），不扩展的话 A 完成后指定给另一个 bot 的 B 不会被唤醒。已列入 §2.3.5 和任务 3.2，并要求集成测试覆盖。
- **目标状态派生要改**：多任务计划下 `recomputeOutcomeStatus` 的现有规则会让"一个任务失败、其余完成"的目标进入 `review_pending`（`outcome-state.ts:167-170`），必须按 §4.2 修改；这是对现有状态机的改动，需要回归 004.2、004.7 的状态测试。
- **修改未开始任务不能只改记录里的输入**：等待中的任务在 `outcome-turn:<id>` 幂等记录里保存了待发送的输入和 `requestHash`，只改输入会让放行时抛 `idempotency_conflict`，而且在别的任务的结算事务里抛。必须删记录再以新 `clientId` 重新入队（§2.3.6）。落地时单独测试。
- **需要同步并重建远端 computer**：新增线程工具位于 `packages/contracts`，重建会中断该 computer 上正在运行的 bot 任务，需要先征得用户同意。

### 8.2 待确认项

1. 规划角色或审查角色设置变更后，已有目标的线程是否切换到新 bot？当前设计：不切换，只影响新线程；需要切换时由用户重新发起。
2. 是否需要"每个目标单独指定规划 bot 或审查 bot"？当前设计只做全局设置。
3. 执行 bot 是否需要主动请求重规划的工具？当前设计只由任务失败触发。
4. （已解决）单个任务失败时的目标状态：见 §4.2 与 §8.3。
5. 整体初验标出不通过的项时，界面是否增加一个"让规划角色重新规划"的专用按钮？已确认当前不增加：用户已有两条路，一是对该项发起返工（交回原 bot 修改），二是在目标线程里发一条消息（规划角色会按用户的话处理）；严重错误和遗漏在任务级审查阶段已经自动返工过一次。如果之后发现用户经常要手写同样的话，再加按钮。
6. 是否需要"让主 bot 起草环境说明"的辅助？当前设计不做：环境说明由用户在设置里维护。如果之后觉得手写太累，可以加一个入口，把一条固定请求发给主 bot，让它在聊天里给出草稿，用户审阅后自己粘贴保存；不让机器人直接写入，因为环境说明会进入其他模型的上下文，需要用户亲自确认内容。
7. （已并入）目标线程回合里的工具可用性与记忆学习，见 `tasks.md` 0.1 第 12 项。
8. 是否需要让规划角色预先规划人工任务（现实任务）并让下游任务依赖它？当前设计不做：人工任务继续由执行中的任务通过动作卡请求（004.4），因为动作卡需要具体的输入、完成材料和失败处理，规划阶段通常还写不出来。

### 8.3 已确认事项（第二轮复核，2026-11-21）

用户已确认：

1. **任务失败后的目标状态**：重规划回合排队或运行时保持 `running`；没有推进中的任务、存在失败任务且没有重规划在跑时显示 `failed`（§4.2）。
2. **取消初验失败后的重试入口**：失败时提示，用户直接逐条验收。
3. **审查驳回的发现用单一 `reason` 字段**，去掉 `observed`、`expected`；保留依据校验（必需验收项或真实边界）、每任务一次、备注不外发。
4. **提交 bot 的背景说明（`SubmitOutcome.background`）后置**；保留"给出提交 bot 的名称与 id、提示可读它的对话"。

复核中按事实修正、不再需要决定：

5. 删除"非提交 bot 不能读其他目标"的限制：现状 `GetOutcome`、`ListOutcomes` 不按 bot 过滤，本 Spec 不新增可见性限制。
6. 需求 13.6 简化为"模型字段不在 `UpdateProfile` 与 `settings.json` 的可写范围内"，不做独立的拒绝机制。

默认处理，尚未经用户确认：

7. 返工任务 `failed` 或 `cancelled` 时，下游保持等待并触发重规划，由规划角色或用户处理，不自动放行。
8. "失败任务已被替代"的判定：其后（序号更大）出现过未失败、未取消的任务。
9. 取消目标或修订被替换时不主动取消在途审查回合，让它自然结束，写入被拒绝（`review_task_stale`）。
