# 任务清单 - 群任务看板（人话版）

状态：In Progress（阶段 1–3 已完成，阶段 4 待用户确认后执行）

## 这份文档是干什么的

让人快速知道：先做什么、后做什么、每一步改什么、做完怎么判断真的完成。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：只有 `状态：DONE` 的任务才能勾选成 `[x]`；`BLOCKED` 写清卡在哪；`CANCELLED` 写清原因；每做完一个任务立刻更新这里。

---

## 阶段 1：契约与数据

- [x] 1.1 群任务契约与纯规则
  - 状态：DONE
  - 这一步到底做什么：定义任务状态、视图、工具入参与描述；把“认领、改状态、指派、释放”的权限和状态转换写成不依赖数据库的纯函数；写每轮看板快照的渲染。
  - 做完你能看到什么：四个工具的 JSON Schema，`planGroupTaskUpdate`、`planGroupTaskClaim`、`renderGroupTaskBoard`。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 2、3、4、5
    - `design.md` §3.1、§3.3、§4.2、§6
  - 主要改哪里：
    - `packages/contracts/src/group-tasks.ts`
    - `packages/contracts/package.json`、`packages/contracts/src/index.ts`、`packages/contracts/src/tool-contracts.ts`
  - 这一步先不做什么：不碰数据库，不做界面。
  - 怎么算完成：
    1. 全部合法与非法转换、权限矩阵、必填 `note`、去重键都有单测
    2. 快照在最坏情况下不超过 6000 字符
    3. 工具入参不含 `channelId`，多余字段被拒绝
  - 怎么验证：`cd packages/contracts && bun test test/group-tasks.test.ts`（39 个用例通过）
  - 对应需求：`requirements.md` 需求 2.1–2.9、3.1–3.11、4.1–4.6、5.3、非功能需求 3.1、4.1
  - 对应设计：`design.md` §3.1、§3.3、§4.2、§6.1–6.6

- [x] 1.2 数据表与迁移
  - 状态：DONE
  - 这一步到底做什么：新增 `outcomego_group_task` 表、状态枚举、索引、唯一约束与 CHECK 约束。
  - 做完你能看到什么：Prisma 模型 `GroupTask`；新建库与 `db push` 都能得到该表。
  - 先依赖什么：无
  - 开始前先看：`design.md` §3.2.1、§4.1
  - 主要改哪里：
    - `packages/db/prisma/schema.prisma`
    - `packages/db/prisma/sql/raw-schema.sql`
    - `packages/db/prisma/migrations/202611200001_add_group_tasks/migration.sql`
  - 这一步先不做什么：不建事件审计表；不给负责人加数据库级约束（Bot 删除时外键会置空）。
  - 怎么算完成：
    1. 群删除级联删除任务
    2. `(channelId, number)` 与 `(channelId, clientRequestId)` 唯一
    3. 已结束状态必须有完成时间
  - 怎么验证：在临时 Postgres 17 上 `bun run db:push` 成功；`cd packages/db && bun test`（48 个用例通过，含全新建库测试）
  - 对应需求：`requirements.md` 需求 1.1、1.5、7.3、7.4、非功能需求 1.1
  - 对应设计：`design.md` §3.2.1、§4.1

### 阶段检查

- [x] 1.3 阶段 1 检查点
  - 状态：DONE
  - 这一步到底做什么：确认契约与表结构站稳，再做服务。
  - 做完你能看到什么：契约单测与建库测试均通过。
  - 先依赖什么：1.1、1.2
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新需求。
  - 怎么算完成：1.1、1.2 的验证命令均通过
  - 怎么验证：见 1.1、1.2
  - 对应需求：需求 1–4
  - 对应设计：§3.2、§4

---

## 阶段 2：服务、工具与每轮上下文

- [x] 2.1 看板服务
  - 状态：DONE
  - 这一步到底做什么：实现 `GroupTaskService`：按群加锁（与群管理共用 `channel:<id>` 锁）、创建（去重、幂等、上限、子任务）、认领、更新（含级联取消）、用户释放与取消、列表、每轮快照；以及成员移出或 bot 归档时的 `releaseGroupTasksForBots`。
  - 做完你能看到什么：并发认领恰好一个成功；并发同名创建恰好一个成功；移出成员后其任务回到可认领。
  - 先依赖什么：1.3
  - 开始前先看：`requirements.md` 需求 1–4、7；`design.md` §2.3、§3.1、§5、§6
  - 主要改哪里：
    - `packages/messaging/src/group-tasks.ts`、`packages/messaging/src/index.ts`
    - `apps/server/src/services/channel/group-administration.ts`（成员移出）
    - `apps/server/src/services/bot-service.ts`（归档）
  - 这一步先不做什么：不做超时自动释放；不做依赖与提醒。
  - 怎么算完成：design.md §6 的六条正确性属性均有集成测试覆盖
  - 怎么验证：`OUTCOMEGO_TEST_DATABASE_URL=… bun test apps/server/test/group-task.integration.test.ts`（22 个用例，在临时 Postgres 17 上全部通过）
  - 对应需求：`requirements.md` 需求 1、2、3、4、7、非功能需求 1
  - 对应设计：`design.md` §2.3.2、§2.3.3、§3.1、§5、§6.1–6.6

- [x] 2.2 bot 工具接入
  - 状态：DONE
  - 这一步到底做什么：把四个工具接到服务端分发；只允许群成员在自己的群对话里调用，拒绝子智能体和后台运行；computer 只在群轮次注册这些工具；worker 把标记透传。
  - 做完你能看到什么：群里 bot 有 `ListGroupTasks`、`CreateGroupTask`、`ClaimGroupTask`、`UpdateGroupTask`；单聊、子智能体、自动化运行没有。
  - 先依赖什么：2.1
  - 开始前先看：`requirements.md` 需求 5.5、非功能需求 3.1；`design.md` §2.1、§3.3
  - 主要改哪里：
    - `apps/server/src/services/group-task-tools.ts`、`apps/server/src/services/internal-tool-service.ts`、`apps/server/src/app-service.ts`
    - `packages/contracts/src/index.ts`（`ComputerTurnRequest.groupTasksEnabled`）
    - `apps/worker/src/worker.ts`
    - `apps/computer/src/runtime.ts`、`apps/computer/src/runtime/types.ts`、`apps/computer/src/runtime/dynamic-catalog.ts`
  - 这一步先不做什么：不改单聊、子智能体、自动化运行的工具集合。
  - 怎么算完成：
    1. 工具面测试覆盖群轮次、单聊、子智能体、自动化、只读、目标线程
    2. 工具适配层绑定运行自己的群，多余的 `channelId` 参数被拒绝
  - 怎么验证：`cd apps/computer && bun test test/runtime/group-task-tool-surfaces.test.ts test/runtime/outcome-tool-surfaces.test.ts`（13 个通过）；集成测试中的“工具适配层绑定本群”
  - 对应需求：`requirements.md` 需求 5.4、5.5、5.7、非功能需求 3.1
  - 对应设计：`design.md` §2.1、§3.3.1–3.3.4

- [x] 2.3 每轮看板快照
  - 状态：DONE
  - 这一步到底做什么：群成员的每一轮把看板快照放进隐藏上下文（`ambientContext`）；单聊、自动化、目标线程不注入。
  - 做完你能看到什么：bot 每轮开头都能读到最新任务、负责人（标出“你”）与“先看板后动手”的提示。
  - 先依赖什么：2.1
  - 开始前先看：`requirements.md` 需求 5.1–5.3、5.6；`design.md` §2.3.1、§8.1
  - 主要改哪里：`packages/messaging/src/index.ts`、`packages/messaging/test/fixtures/outcome-prompt.ts`
  - 这一步先不做什么：不做“未变化则跳过”的去重（见 design.md §8.1）。
  - 怎么算完成：非群聊的平台提示词与改动前逐字节一致
  - 怎么验证：`cd packages/messaging && bun test`（带库 875 通过；2 个既有 baseline 失败在干净树上同样失败）；集成测试“每轮快照只给群成员”
  - 对应需求：`requirements.md` 需求 5.1、5.2、5.3、5.6
  - 对应设计：`design.md` §2.3.1、§3.1、§8.1

### 阶段检查

- [x] 2.4 阶段 2 检查点
  - 状态：DONE
  - 这一步到底做什么：确认服务端主链路跑通且没有回归。
  - 做完你能看到什么：新增测试全部通过；其余套件的失败集合与干净树完全一致。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新范围。
  - 怎么算完成：对 `apps/server`（14 个既有失败）、`packages/messaging`（2 个）、`apps/computer`（47 个）、`apps/worker`（5 个）逐一在干净树上对照，失败集合一致
  - 怎么验证：`git stash -u` 在干净树上以同一数据库运行同一套件并比对
  - 对应需求：需求 1–5、7
  - 对应设计：§2.3、§6

---

## 阶段 3：用户可见

- [x] 3.1 REST 接口与桌面端任务区块
  - 状态：DONE
  - 这一步到底做什么：提供列表与用户“释放/取消”接口；桌面端群详情里成员列表下方显示任务区块（子任务缩进、状态、负责人、阻塞原因、已结束可展开，每 5 秒刷新），并补中文文案。
  - 做完你能看到什么：用户能看到谁在做哪个任务，并在 bot 卡住时释放或取消。
  - 先依赖什么：2.4
  - 开始前先看：`requirements.md` 需求 6；`design.md` §3.3.5
  - 主要改哪里：
    - `apps/server/src/routes/channel.ts`、`apps/server/src/app-service.ts`
    - `packages/client-core/src/client.ts`
    - `apps/desktop/src/renderer/components/outcomego/group-tasks.tsx`、`apps/desktop/src/renderer/lib/group-tasks.ts`、`apps/desktop/src/renderer/components/outcomego/inspector.tsx`、`apps/desktop/src/renderer/lib/i18n-catalog.ts`
  - 这一步先不做什么：不做用户新建或编辑任务内容；不做移动端。
  - 怎么算完成：
    1. 类型检查通过，排布与文案有单测
    2. 用户释放与取消受 `expectedRevision` 保护
  - 怎么验证：`cd apps/desktop && bun run typecheck && bun test test/group-tasks.test.ts`；集成测试“用户可以释放或取消”
  - 对应需求：`requirements.md` 需求 6.1–6.6
  - 对应设计：`design.md` §3.3.5
  - 未覆盖：桌面端界面没有在真实窗口里目视验收（见 3.2）

### 最终检查

- [ ] 3.2 人工验收与最终检查点
  - 状态：TODO
  - 这一步到底做什么：在真实环境里让两个以上 bot 在同一个群里接同一件事，观察是否先登记、是否不重复；目视检查桌面端任务区块。
  - 做完你能看到什么：需求 5 中“bot 实际行为”这类无法用单测证明的验收有结论。
  - 先依赖什么：3.1、4.1
  - 开始前先看：`requirements.md` 全部；`design.md` §8；`tasks.md`
  - 主要改哪里：无（只验收；发现问题再回到对应任务）
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. 群里两个 bot 面对同一请求，只有一个认领并执行，另一个转做别的或补充
    2. 桌面端任务区块显示、刷新、释放、取消正常
    3. 风险、延期项、取消项已写清楚
  - 怎么验证：人工走查，结果写入 `docs/acceptance-result.md`
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 4：让 bot 侧生效（需要用户确认）

- [ ] 4.1 同步并重建远端 computer 容器
  - 状态：TODO（等待用户确认；重建会中断远端 bot 正在运行的任务）
  - 这一步到底做什么：新工具在 `apps/computer` 与 `packages/contracts` 中，只有同步到远端调试主机并重建 computer 容器后，bot 才拿到新工具。
  - 做完你能看到什么：远端 `openteam-debug-computer-1` 为 `healthy`，群里 bot 能调用四个新工具。
  - 先依赖什么：3.1，且用户明确同意
  - 开始前先看：仓库根 `AGENTS.md`「Remote Debug Computer」一节
  - 主要改哪里：远端 `~/openteam-debug`（先 `rsync -n` 预演并备份差异文件，再重建 `computer` 与 `computer-memory-init`）
  - 这一步先不做什么：不碰 `openteam-dev` 项目与 `data` 目录；不打印 `.env`。
  - 怎么算完成：`docker ps` 显示 healthy；`bash scripts/dev/debug.sh check` 通过
  - 怎么验证：按 AGENTS.md 命令执行并核对
  - 对应需求：需求 5.4、5.5
  - 对应设计：`design.md` §8.2
