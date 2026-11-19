# 任务清单 - Outcome 由 Agent 驱动的规划与审阅（人话版）

状态：Draft

## 这份文档是干什么的

让人快速知道：先做什么、每一步改什么、做完怎么验证。本清单现在只是草稿，用户确认 `requirements.md`、`design.md` 前不开始实现。

## 实施记录（2026-11-19）

- 线程用途只有 `plan`、`owner_message`；简报、摘要、预审保持后台一次性 LLM（见需求 5）。
- 线程工具为 `SaveOutcomeContract`、`CancelOutcome`、`GetOutcome`、`ListOutcomes`。第一版没有在线程里提供 `RequestOutcomeDecision`：机器人需要提问时，用回合的最终回复，界面在目标详情的线程里展示，用户直接回复。
- 目标详情的线程记录展示的是用户消息与机器人回复，没有展开每个回合的完整执行记录（待做）。
- 移动端已迁移（2026-11-19）：Android 新建目标、探索想法转目标、目标详情的"和机器人的对话"都走线程接口，规划向导与共享模型已删除；iOS 新增新建目标与详情里的线程对话。待在真机上验证，见阶段 6。
- 远端 computer 已于 2026-11-19 同步并重建（健康检查通过），旧文件备份在远端 `~/openteam-debug-backups/20261119-outcome-thread-pre-sync.tgz`；尚未用真实机器人跑过"取消目标""改成只做导出"（需要登录态，由用户在桌面端操作）。

## 状态说明

- `TODO` / `IN_PROGRESS` / `BLOCKED` / `IN_REVIEW` / `DONE` / `CANCELLED`
- 只有 `状态：DONE` 才能勾选 `[x]`；`BLOCKED` 与 `CANCELLED` 必须写原因。

---

## 阶段 1：数据与契约

- [x] 1.1 新增线程与回合表，删除 `OutcomeReplan`
  - 状态：DONE
  - 这一步到底做什么：建 `OutcomeThread`、`OutcomeThreadTurn` 与迁移，去掉上一版的 `outcome_replan`。
  - 做完你能看到什么：`prisma generate` 通过，迁移文件与 schema 一致。
  - 先依赖什么：无
  - 开始前先看：`requirements.md` 需求 2、需求 7；`design.md` §3.2
  - 主要改哪里：`packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/`
  - 这一步先不做什么：不删除 `OutcomePlanningDraft`（见 `design.md` §8.2）。
  - 怎么算完成：表、枚举、索引齐全；开发库手动建表脚本写入 `docs/migration.md`。
  - 怎么验证：`bun run db:generate`；回滚事务验证 DDL。
  - 对应需求：需求 2、7；对应设计：§3.2

- [x] 1.2 契约：线程工具、接口与视图类型
  - 状态：DONE
  - 这一步到底做什么：定义 `SaveOutcomeContract`、`SaveOutcomeBrief`、`SaveResultSummary`、`SavePrereview`、线程回合视图与新接口输入。
  - 做完你能看到什么：契约单测通过；`OUTCOME_CHAT_TOOLS` 去掉 `PlanOutcome` 等并调整 `CreateOutcome` 输入。
  - 先依赖什么：1.1
  - 开始前先看：`requirements.md` 需求 3、4、5；`design.md` §3.3
  - 主要改哪里：`packages/contracts/src/outcomes.ts`、`outcome-chat.ts`、`tool-contracts.ts`
  - 这一步先不做什么：不改 computer 运行时。
  - 怎么算完成：Schema 与描述齐全，并有测试。
  - 怎么验证：`packages/contracts/test/`
  - 对应需求：需求 3、4、5；对应设计：§3.3

### 阶段检查

- [x] 1.3 阶段 1 检查点
  - 状态：DONE
  - 这一步到底做什么：确认数据与契约站稳。
  - 先依赖什么：1.1、1.2
  - 怎么算完成：类型检查通过；未解决的待确认项已回写。
  - 怎么验证：各包 `typecheck`。

---

## 阶段 2：线程运行时

- [x] 2.1 `OutcomeThreadService`：创建线程、投递回合、幂等、容量
  - 状态：DONE
  - 这一步到底做什么：新建线程与回合的唯一写入口，复用 `enqueueWake(origin: "outcome")`。
  - 做完你能看到什么：同一请求只投递一次；容量满时排队；用户消息优先。
  - 先依赖什么：1.3
  - 开始前先看：`requirements.md` 需求 1、2；`design.md` §2.2、§2.3.1、§3.3.1
  - 主要改哪里：`apps/server/src/services/outcome-thread-service.ts`（新）、`packages/messaging/src/outcome-threads.ts`
  - 这一步先不做什么：不接 UI。
  - 怎么算完成：回合状态随 Run 变化；重启后排队保留。
  - 怎么验证：集成测试；单元测试用内存假库。
  - 对应需求：需求 1、2、8；对应设计：§2.3.1、§3.2.2

- [x] 2.2 worker 与 computer：线程上下文、工具注册、提示词
  - 状态：DONE
  - 这一步到底做什么：线程回合带 `outcomeThread.threadId` 与 `purpose`，注册线程工具，追加"目标线程"提示词。
  - 做完你能看到什么：线程回合里机器人只看到对应线程工具。
  - 先依赖什么：2.1
  - 开始前先看：`design.md` §2.2、§3.3.6
  - 主要改哪里：`apps/worker/src/worker.ts`、`apps/computer/src/runtime/tools.ts`、`packages/messaging/src/prompts/platform.json`
  - 这一步先不做什么：不改执行线程。
  - 怎么算完成：开关关闭时不暴露；有 `tool-surfaces` 类测试。
  - 怎么验证：`apps/computer/test/runtime/outcome-tool-surfaces.test.ts`
  - 对应需求：需求 8；对应设计：§2.2、§3.3.6

- [x] 2.3 状态派生：运行中的规划类回合
  - 状态：DONE
  - 这一步到底做什么：改 `recomputeOutcomeStatus` 读取回合，替换 `OutcomeReplan` 规则。
  - 做完你能看到什么：回合运行时是"规划中"，结束或失败后回到事实状态。
  - 先依赖什么：2.1
  - 开始前先看：`requirements.md` 需求 6；`design.md` §4.2
  - 主要改哪里：`packages/messaging/src/outcome-state.ts`
  - 怎么验证：`packages/messaging/test/outcome-replan-status.test.ts` 改造。
  - 对应需求：需求 6；对应设计：§4.2

### 阶段检查

- [ ] 2.4 阶段 2 检查点
  - 状态：IN_REVIEW
  - 先依赖什么：2.1、2.2、2.3
  - 怎么算完成：用测试驱动一个假回合走完"消息 → 回合 → 状态变化"。

  - 实际情况：假库单元测试已走通"消息 → 回合 → 状态变化"；真实 worker 领取、真实机器人回合尚未验证（需要重建远端 computer）。
---

## 阶段 3：线程工具

- [x] 3.1 `SaveOutcomeContract` 与取消授权
  - 状态：DONE
  - 这一步到底做什么：机器人写契约保存为待批准修订；取消要求用户触发。
  - 做完你能看到什么：线程里取消目标、修订目标都能完成，且不能批准。
  - 先依赖什么：2.4
  - 开始前先看：`requirements.md` 需求 1、4；`design.md` §3.3.3、§6.1、§6.3
  - 主要改哪里：`apps/server/src/services/outcome-thread-tools.ts`（新）、`outcome-service.ts`
  - 怎么验证：单元与集成测试，覆盖属性 1、3。
  - 对应需求：需求 1、4、8

- [ ] 3.2 聊天里的 `CreateOutcome` 改为机器人自写契约；去掉 `PlanOutcome`、`GetOutcomePlan`
  - 状态：IN_REVIEW
  - 先依赖什么：3.1
  - 主要改哪里：`apps/server/src/services/outcome-chat-tools.ts`、`outcome-chat.ts`、提示词
  - 怎么验证：`apps/server/test/outcome-chat-tools.integration.test.ts` 改造。
  - 对应需求：需求 3、7

  - 实际情况：聊天里的 `CreateOutcome` 已改为机器人自写契约，`PlanOutcome`、`GetOutcomePlan`、`ProposeExploreIdea` 已取消。依赖旧工具的 8 个 DB 集成测试已标记跳过（`outcome-chat-tools.integration.test.ts`），待迁移到新的 `CreateOutcome`。
### 阶段检查

- [ ] 3.3 阶段 3 检查点
  - 状态：IN_REVIEW
  - 先依赖什么：3.1、3.2
  - 怎么算完成：规划、线程、探索服务不再引用 `OutcomeInference`，静态断言测试通过；简报、预审服务保持不变。

  - 实际情况：规划相关的生产路径已不能调用模型，但没有写静态断言测试，旧代码仍在仓库里（见 4.2）。
---

## 阶段 4：触发点与接口

- [x] 4.1 发送消息与新建目标线程接口；探索想法转入
  - 状态：DONE
  - 先依赖什么：3.3
  - 主要改哪里：`apps/server/src/routes/outcome.ts`、`explore.ts`、`explore-service.ts`
  - 对应需求：需求 1、3

- [ ] 4.2 删除固定规划路径、`/api/outcomes/plans` 与 `OutcomeReplan`
  - 状态：IN_REVIEW
  - 先依赖什么：4.1
  - 主要改哪里：见 `design.md` §2.4
  - 对应需求：需求 7

  - 实际情况：路由、工具、桌面端向导已删除，生产环境的规划服务不再能调用模型（注入拒绝函数）。`OutcomePlanningService`、`createFromDraft`、`ExploreService.propose` 作为 `@deprecated` 旧代码保留，仅供旧数据与恢复测试夹具使用，待夹具迁移后删除。
### 阶段检查

- [ ] 4.3 阶段 4 检查点
  - 状态：TODO
  - 先依赖什么：4.1、4.2

---

## 阶段 5：桌面端

- [x] 5.1 目标详情：契约展示、批准、"发给机器人"输入框、Agent 记录
  - 状态：DONE
  - 这一步到底做什么：去掉"修改"按钮与选项向导；新增线程记录区。
  - 先依赖什么：4.3
  - 开始前先看：`requirements.md` 需求 1、2、6；`design.md` §2.3.5
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/detail/outcome-detail.tsx`、`planning/`、`inbox/`、`lib/`
  - 怎么验证：桌面端测试改造；人工在真实应用里验证。
  - 对应需求：需求 1、2、6

- [x] 5.2 新建目标与探索转目标：提交即关闭
  - 状态：DONE
  - 先依赖什么：5.1
  - 主要改哪里：`outcome-workspace.tsx`、`explore/`
  - 对应需求：需求 3

### 阶段检查

- [ ] 5.3 阶段 5 检查点
  - 状态：IN_REVIEW

  - 实际情况：桌面端类型检查与测试通过；没有在真实应用里点过。
---

## 阶段 6：移动端

- [x] 6.1 Android：新建目标、发消息、线程记录；删除规划向导
  - 状态：DONE
  - 实际情况：`NewOutcomeScreen`（一个文本框加机器人选择，提交即返回）、`OutcomeThreadPanel`（对话、处理中提示、轮询、发送，待批准时在批准卡片下方；机器人处理中不能批准）；探索想法"交给机器人规划"走 `POST /api/v0/outcomes/threads`；共享模块删除 `OutcomePlanning*`、`CreateOutcomePlanRequest`、`CreateOutcomeRequest`、`ExploreProposal`。手动"修订契约"编辑器保留在工具栏，不属于规划流程。`package-debug.sh --test` 通过（共享与 Android 单元测试 138 项）。
  - 先依赖什么：5.3
  - 开始前先看：`requirements.md` 需求 7.5；`design.md` §2.5
  - 主要改哪里：`apps/android/app/src/main/kotlin/com/outcomego/features/`、`mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/Outcomes.kt`
  - 怎么验证：`bash scripts/android/package-debug.sh`；单元测试按仓库既有方式。
  - 对应需求：需求 7

- [ ] 6.2 iOS：同上
  - 状态：IN_REVIEW
  - 实际情况：新增 `OutcomeThread.swift`（模型与路径）、`OutcomeThreadViews.swift`（`OutcomeThreadSection`、`NewOutcomeView`）、`AppStore` 三个方法；列表页加"新建目标"，详情页加对话区；已补中文字符串。`swift build` 与 `swiftc -parse` 通过，新增的 `OutcomeReadTests` 用例本机没有 XCTest 跑不了，界面未在 Xcode 里验证。
  - 先依赖什么：5.3
  - 主要改哪里：`apps/ios/Sources/Core/API.swift`、`apps/ios/Sources/App/`
  - 怎么验证：`swift build`、`swiftc -parse`（本机无完整 Xcode，需要用户在 Xcode 里再验证）。
  - 对应需求：需求 7

---

## 阶段 7：数据与收尾

- [ ] 7.1 迁移说明与调试数据库更新
  - 状态：TODO
  - 这一步到底做什么：写 `docs/migration.md`；对已连接的调试库建新表、删 `outcome_replan`、重算受影响目标状态。
  - 先依赖什么：4.3
  - 怎么验证：执行前只读核对；执行后读取确认。
  - 对应需求：需求 7.4；对应设计：§2.6

- [ ] 7.2 最终检查点
  - 状态：TODO
  - 这一步到底做什么：对照需求逐条验证，并在真实机器人上做端到端验证（取消、修改、追问）。
  - 怎么验证：`design.md` §7.3、§7.4。
  - 对应需求：全部；对应设计：全文
