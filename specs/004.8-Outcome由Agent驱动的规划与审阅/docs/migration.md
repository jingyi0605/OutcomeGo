# 迁移说明 - 目标线程（Spec 004.8）

## 数据库

迁移：`packages/db/prisma/migrations/202611190003_add_outcome_thread/migration.sql`

- `outcomego_run_origin` 新增 `outcome_thread`
- 新表 `outcomego_outcome_thread`、`outcomego_outcome_thread_turn` 与两个枚举
- `outcomego_run` 新增 `outcomeThreadId` 与索引

上一版中间实现的 `outcomego_outcome_replan` 从未提交也未发布，只存在于调试库，已删除。

## 部署顺序

1. 先执行迁移（含 `ALTER TYPE ... ADD VALUE`）。
2. 再发布 server 和 worker。
3. 同步并重建 computer（线程工具和 `goalThread` 字段在 computer 侧）。重建会打断正在运行的机器人任务。

没有先重建 computer 时：线程回合照常排队和运行，但机器人拿不到 `SaveOutcomeContract` 等工具，只会在最终回复里说话。

## 调试库（2026-11-19 已执行）

- 执行了上面的迁移，并删除了 `outcomego_outcome_replan`（当时 1 行，对应一个因旧版本"修改"处于规划中的目标）。
- 该目标的状态已由服务端同一个状态推导函数重新派生，不再因 replan 停在"规划中"；它现在是待批准，可批准，也可通过"发给机器人"修改。
- 既有目标、修订、简报与 `outcomego_outcome_planning_draft` 保持不变。
- 调试库的结构是手动同步的；不要直接运行 `scripts/dev/debug.sh db-push`，它会同时删除全文搜索索引 `outcomego_search_document_search_vector_idx`（既有偏差，与本次无关）。

## 旧数据

- 升级前的待批准目标保持可批准、可修改；修改时在目标详情的线程里发消息，线程在第一条消息时创建。
- `OutcomePlanningDraft` 只读保留。
- 生产环境的规划服务注入了一个拒绝调用模型的函数；`OutcomePlanningService`、`createFromDraft`、`ExploreService.propose` 是 `@deprecated` 旧代码，只被恢复测试夹具使用。

## 接口变化

- 删除：`POST/GET /api/outcomes/plans`、`POST /api/outcomes`（按规划草稿创建）、`POST /api/explore/:id/propose`、`/api/outcomes/:id/replan`（中间版本）。
- 新增：`POST /api/outcomes/threads`、`GET /api/outcomes/:id/thread`、`POST /api/outcomes/:id/thread/messages`。
- 事件：`goal.thread.updated`。
- 机器人工具：新增 `SaveOutcomeContract`（仅目标线程）；聊天里的 `CreateOutcome` 改为接收机器人自己写的契约；取消 `PlanOutcome`、`GetOutcomePlan`、`ProposeExploreIdea`。
- 移动端（2026-11-19）：Android 与 iOS 已改用 `/api/v0/outcomes/threads`、`/api/v0/outcomes/:id/thread`、`/thread/messages`。旧版本的移动端仍会调用已删除的 `/api/outcomes/plans` 等接口，新建目标会失败，需要升级移动端。
