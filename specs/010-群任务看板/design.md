# 设计文档 - 群任务看板

状态：Draft

## 1. 概述

### 1.1 目标

- 每个群一块共享看板，任务认领是原子的，从机制上避免多个 bot 重复做同一件事
- bot 用四个少而清晰的工具读写看板；每一轮自动看到最新看板
- 状态机与权限是纯函数，数据库只负责串行化与持久化
- 不改动单聊、子智能体、自动化运行的行为

### 1.2 覆盖需求

- `requirements.md` 需求 1：任务登记与去重
- `requirements.md` 需求 2：原子认领、指派与释放
- `requirements.md` 需求 3：状态更新与权限
- `requirements.md` 需求 4：子任务
- `requirements.md` 需求 5：bot 先看板、后动手
- `requirements.md` 需求 6：用户可见与用户干预
- `requirements.md` 需求 7：成员与群生命周期
- `requirements.md` 非功能需求 1–4

### 1.3 技术约束

- 后端：Bun、TypeScript、Effect Schema（契约）、Prisma 7（PostgreSQL）
- 前端：桌面端 React，现有 `inspector.tsx` 群详情
- 数据存储：PostgreSQL，按群事务级咨询锁串行化
- 认证授权：bot 工具沿用 `InternalToolService` 的运行上下文校验；用户接口沿用现有会话鉴权
- 外部依赖：无
- 参考：DSH 智能体团队任务看板（单调 `revision`、条件认领、墓碑）

## 2. 架构

### 2.1 系统结构

```
bot（computer 容器）
  └─ 工具 ListGroupTasks / CreateGroupTask / ClaimGroupTask / UpdateGroupTask
       └─ InternalToolService（校验运行上下文：运行中、同一 bot、同一 channel）
            └─ GroupTaskTools（校验群频道，解析参数）
                 └─ GroupTaskService（按群加锁，事务内读—判—写）
                      └─ PostgreSQL: outcomego_group_task

worker 每轮开始
  └─ AgentMessaging.platformPrompt()
       ├─ 群频道 → groupTasksEnabled = true
       └─ ambientContext += 看板快照（读 GroupTaskService/同一查询）

桌面端 inspector「任务」区块（成员列表下方）
  └─ GET /api/channels/:id/tasks（每 5 秒轮询，仅群详情可见时）
  └─ PATCH /api/channels/:id/tasks/:number（用户释放/取消）

群成员变更 / bot 归档
  └─ 同事务内释放名下未结束任务
```

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `packages/contracts/src/group-tasks.ts` | 常量、Schema、视图类型、工具描述、状态机与权限纯函数、快照渲染 | 无 | 类型、纯函数、工具定义 |
| `packages/db` `GroupTask` | 任务持久化 | Prisma 调用 | 行 |
| `packages/messaging/src/group-tasks.ts`（`GroupTaskService`） | 事务、锁、去重、认领、子任务、释放、每轮快照；放在 messaging 是因为服务端（工具、路由、成员移出）与每轮提示词都要用 | 调用者、群、输入 | `GroupTaskView`、快照文本 |
| `apps/server/src/services/group-task-tools.ts` | 把工具调用适配到服务，解析 `assignTo` | `DynamicToolCallRequest` | 工具结果与下一步提示 |
| `apps/server/src/routes/group-task.ts` | 用户列表与干预接口 | HTTP | JSON |
| `packages/messaging` | 判断群频道，生成快照并写入 `ambientContext`，输出 `groupTasksEnabled` | botId、channelId | `PlatformPrompt` |
| `apps/worker` | 把 `groupTasksEnabled` 传给 computer | `PlatformPrompt` | `ComputerTurnRequest` |
| `apps/computer` | 仅在群轮次注册四个工具 | `ActiveTurn` | 动态工具目录 |
| 桌面端 `group-tasks.tsx`、`lib/group-tasks.ts` | 看板展示、排布（子任务归父任务之下）与用户干预 | API | UI |

### 2.3 关键流程

#### 2.3.1 bot 接到群任务

1. 轮次开始，worker 取平台提示词，`ambientContext` 带看板快照
2. bot 看快照：已有匹配任务且被他人认领 → 不重做，转做别的或回复进展
3. 没有匹配任务 → `CreateGroupTask`（`assignTo: "me"`）登记并认领；若返回 `group_task_duplicate`，改为认领或跳过已有任务
4. 大任务拆分 → 对父任务逐个 `CreateGroupTask`（`parent`），可指派给合适的成员
5. 开始工作前，对未认领的任务调用 `ClaimGroupTask`
6. 完成 → `UpdateGroupTask`（`status: done`，`note` 写结果）；受阻 → `blocked` 并写原因；不再做 → `assignTo: "none"` 释放

#### 2.3.2 并发认领

1. 两个 bot 同时调用 `ClaimGroupTask`
2. 两个事务先后拿到 `channel:<id>` 咨询锁
3. 第一个读到 `assignee = null` 并写入；第二个获锁后读到已有负责人，返回 409 `group_task_claimed`（带负责人）

#### 2.3.3 成员移出

1. `setGroupMembers` 在事务内计算被移出的 bot
2. 同一事务内 `releaseTasksForBots(tx, channelId, removed)`：负责人清空、状态回到 `open`、`revision + 1`
3. 因为 `setGroupMembers` 与任务写入使用同一把 `channel:<id>` 锁，不会出现“刚被指派给已移出成员”的任务

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4

- `GroupTaskService`（`packages/messaging/src/group-tasks.ts`）：全部写操作在 `prisma.$transaction` 内先取 `pg_advisory_xact_lock(hashtext('channel:<channelId>'))`，与群管理共用同一把锁；锁内重新读取任务再判断
- `planGroupTaskUpdate`（纯函数）：输入当前任务、调用者、变更，输出“允许并给出新字段”或抛出带错误码的规则错误；服务只负责取数与落库
- `renderGroupTaskBoard`（纯函数）：把任务列表渲染为每轮快照
- `GroupTaskTools`：工具参数解码、`assignTo` 解析（`me`、`none`、成员 id、成员名称）

### 3.2 数据结构

覆盖需求：1、2、3、4、7

#### 3.2.1 `GroupTask`（表 `outcomego_group_task`）

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 是 | 主键 | 默认 `uuid()` |
| `channelId` | `uuid` | 是 | 所属群 | 外键 `outcomego_channel`，`onDelete: Cascade` |
| `number` | `int` | 是 | 群内编号 | `(channelId, number)` 唯一，从 1 递增，永不复用 |
| `parentId` | `uuid` | 否 | 父任务 | 外键自引用，`onDelete: Cascade`；只允许一层 |
| `title` | `text` | 是 | 标题 | ≤ 200 |
| `titleKey` | `text` | 是 | 去重键：小写、压缩空白 | 与 `(channelId, parentId)` 联合用于未结束任务查重 |
| `description` | `text` | 是 | 描述 | 默认空，≤ 4000 |
| `status` | `GroupTaskStatus` | 是 | `open / in_progress / blocked / done / cancelled` | 默认 `open` |
| `creatorBotId` | `uuid` | 否 | 创建者 | 外键 `outcomego_bot`，`onDelete: SetNull` |
| `assigneeBotId` | `uuid` | 否 | 负责人 | 外键 `outcomego_bot`，`onDelete: SetNull` |
| `note` | `text` | 否 | 完成摘要、阻塞原因或取消原因 | ≤ 2000 |
| `revision` | `int` | 是 | 单调版本 | 默认 1 |
| `clientRequestId` | `text` | 否 | 创建幂等键 | `(channelId, clientRequestId)` 唯一 |
| `createdAt` / `updatedAt` | `timestamp` | 是 | 创建与更新时间 | |
| `completedAt` | `timestamp` | 否 | 进入 `done` 或 `cancelled` 的时间 | |

索引：`(channelId, status)`、`(channelId, parentId)`、`(assigneeBotId)`。

查重不依赖数据库唯一约束，因为“只在未结束任务之间唯一”在 Prisma 中需要部分索引；由按群锁内的显式查询保证，并有测试覆盖。

#### 3.2.2 `GroupTaskView`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id`、`channelId`、`number` | string / number | 标识 |
| `parentNumber` | `number \| null` | 父任务编号 |
| `title`、`description`、`status`、`note`、`revision` | | 同表 |
| `creator`、`assignee` | `{ id: string; name: string } \| null` | bot 与名称；已删除的创建者为 `null` |
| `createdAt`、`updatedAt`、`completedAt` | ISO 字符串 | 时间 |

### 3.3 接口契约

覆盖需求：1–6

#### 3.3.1 `ListGroupTasks`（bot 工具）

- 输入：`includeClosed?: boolean`（默认 false）、`assignee?: "me" | "none" | <botId 或名称>`、`parent?: number`
- 输出：`{ tasks: GroupTaskView[], counts: { open, in_progress, blocked, done, cancelled } }`
- 错误：`group_task_unavailable`（非群或非成员）

#### 3.3.2 `CreateGroupTask`

- 输入：`title`（必填）、`description?`、`parent?: number`、`assignTo?: "me" | <botId 或名称>`、`clientRequestId?`
- 输出：`{ task, created: boolean, nextStep }`；幂等重试返回 `created: false`
- 错误：`invalid_request`、`group_task_duplicate`（带 `existing`）、`group_task_limit`、`group_task_depth`、`group_task_closed`、`group_task_assignee_invalid`、`group_task_unavailable`

#### 3.3.3 `ClaimGroupTask`

- 输入：`task: number`、`expectedRevision?: number`
- 输出：`{ task, nextStep }`
- 错误：`group_task_claimed`（带 `assignee`）、`group_task_closed`、`group_task_revision_conflict`、`group_task_not_found`

#### 3.3.4 `UpdateGroupTask`

- 输入：`task: number`、`expectedRevision?`、`status?: "in_progress" | "blocked" | "done" | "cancelled"`、`title?`、`description?`、`note?`、`assignTo?: "me" | "none" | <botId 或名称>`
- 输出：`{ task, nextStep }`
- 错误：`invalid_request`、`group_task_forbidden`、`group_task_invalid_transition`、`group_task_subtasks_open`、`group_task_duplicate`、`group_task_closed`、`group_task_revision_conflict`、`group_task_assignee_invalid`

`channelId` 不出现在任何工具入参中，一律取运行上下文。

#### 3.3.5 用户接口

- `GET /api/channels/:id/tasks?includeClosed=true|false` → `{ tasks: GroupTaskView[], counts }`；频道不存在或不是群返回 404 `channel_not_found`
- `PATCH /api/channels/:id/tasks/:number`，请求体 `{ action: "release" | "cancel", expectedRevision: number, note?: string }` → `{ task }`
  - 用户干预不受创建者与负责人限制，但仍受状态机约束（已结束任务返回 409 `group_task_closed`）
  - 修订不一致返回 409 `group_task_revision_conflict`

## 4. 数据与状态模型

### 4.1 数据关系

- `Channel 1—N GroupTask`；`GroupTask 1—N GroupTask`（子任务，仅一层）
- `GroupTask → Bot`（创建者、负责人，均可空）
- 任务不物理删除；群删除时级联；这与 DSH“墓碑”思路一致，只是 OutcomeGo 的取消即墓碑

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `open` | 待处理（可无人认领，也可已指派未开始） | 创建；释放；改派 | 认领或负责人开始 → `in_progress`；取消 → `cancelled` |
| `in_progress` | 负责人处理中 | 认领；负责人开始；从阻塞恢复 | `done`、`blocked`、释放回 `open`、`cancelled` |
| `blocked` | 负责人受阻，原因在 `note` | 负责人置为阻塞且 `note` 非空 | 恢复 `in_progress`、释放回 `open`、`cancelled` |
| `done` | 已完成，结果在 `note` | 负责人置为完成且 `note` 非空，且无未结束子任务 | 终态 |
| `cancelled` | 已取消 | 创建者、负责人或用户取消；父任务取消时级联 | 终态 |

权限矩阵（调用者为 bot）：

| 操作 | 允许者 |
| --- | --- |
| 创建、读取 | 任一群成员 |
| 认领 | 任一群成员，且任务无人认领，或已指派给自己 |
| `in_progress` / `blocked` / `done` | 仅当前负责人 |
| `cancelled`、改标题与描述、改派、释放 | 创建者或当前负责人 |
| 释放/取消（用户） | 用户，不受上述限制 |

## 5. 错误处理

### 5.1 错误类型

- `invalid_request`（400）：参数不合法、无变更、`done/blocked` 缺 `note`
- `group_task_unavailable`（403）：当前运行不在群里，或调用者不是成员
- `group_task_forbidden`（403）：不是创建者或负责人
- `group_task_not_found`（404）：编号不存在
- `group_task_duplicate`（409）：存在同名未结束任务
- `group_task_claimed`（409）：已被他人认领
- `group_task_closed`（409）：任务已结束
- `group_task_invalid_transition`（409）：状态转换不在表中
- `group_task_subtasks_open`（409）：父任务仍有未结束子任务
- `group_task_depth`（409）：子任务不能再有子任务
- `group_task_limit`（409）：任务数量超限
- `group_task_assignee_invalid`（409）：指派目标不是有效成员
- `group_task_revision_conflict`（409）：`expectedRevision` 过期

### 5.2 错误响应格式

沿用现有 `ApiError`：`{ error: { code, message, ... } }`。冲突类错误在 `details` 中附带 `task` 或 `existing` 或 `assignee`，让 bot 不必再查一次就能决定下一步。

### 5.3 处理策略

1. 输入验证错误：在工具适配层与服务层各校验一次，返回 400，不进入事务
2. 业务规则错误：事务内抛出，整体回滚
3. 外部依赖错误：无外部依赖
4. 重试：`clientRequestId` 保证创建幂等；`ClaimGroupTask` 对“已指派给自己”的任务幂等；其他冲突由 bot 重新读取后重试

## 6. 正确性属性

### 6.1 属性 1：认领互斥

*对于任何* 一个任务与任意数量的并发 `ClaimGroupTask`，最终至多一个 bot 成为负责人，其余收到 `group_task_claimed`。

**验证需求：** 需求 2 验收 2、4

### 6.2 属性 2：编号与版本单调

*对于任何* 一个群，任务编号严格递增且不复用；*对于任何* 一个任务，每次成功变更使 `revision` 恰好加 1，失败不改变 `revision`。

**验证需求：** 需求 1 验收 1；需求 2 验收 8；非功能需求 1

### 6.3 属性 3：未结束任务不重名

*对于任何* 一个群的同一父任务下，未结束任务的 `titleKey` 互不相同。

**验证需求：** 需求 1 验收 4；需求 3 验收 9；需求 4 验收 6

### 6.4 属性 4：父子一致

*对于任何* `done` 的父任务，其所有子任务均已结束；*对于任何* `cancelled` 的父任务，其子任务均已结束。

**验证需求：** 需求 3 验收 5；需求 4 验收 5

### 6.5 属性 5：负责人必为有效成员

*对于任何* 未结束任务，若有负责人，则该负责人是该群当前成员且为活跃 bot；成员被移出或 bot 被归档时任务被释放。

**验证需求：** 需求 2 验收 7；需求 7 验收 1、2

### 6.6 属性 6：群边界

*对于任何* 工具调用，被读写的任务都属于运行上下文中的群。

**验证需求：** 非功能需求 3 验收 1

## 7. 测试策略

### 7.1 单元测试

- `packages/contracts/test/group-tasks.test.ts`：Schema 解码（含多余字段、长度、`assignTo` 取值）；`planGroupTaskUpdate` 的全部合法与非法转换、权限矩阵、必填 `note`；`normalizeTitleKey`；`renderGroupTaskBoard` 的截断、缩进、“你”标记、空看板、超限提示
- `apps/computer/test/runtime/group-task-tool-surfaces.test.ts`：仅群轮次且非子智能体、非自动化、非只读、非目标线程时注册四个工具；轮次契约携带可选标记
- `apps/desktop/test/group-tasks.test.ts`：子任务排布与新增中文文案齐全

### 7.2 集成测试

需要 `OUTCOMEGO_TEST_DATABASE_URL`，无库时跳过：

- `apps/server/test/group-task.integration.test.ts`：创建、重名拒绝、幂等、并发认领、并发重名创建、并发创建编号、指派与释放、子任务与父任务完成限制、级联取消、成员移出释放、非成员与非群被拒、跨群不可达、`expectedRevision` 冲突、数量上限、用户释放与取消、群删除级联、每轮快照（仅群成员）、工具适配层绑定本群

### 7.3 端到端测试

- 本期不做自动化端到端；人工验收见 7.4 与 `tasks.md` 阶段检查

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| 需求 1 | §3.2.1、§3.3.2、§6.2、§6.3 | 单元（去重键）+ 集成（创建、重名、幂等、上限） |
| 需求 2 | §2.3.2、§3.3.3、§6.1 | 集成（并发认领）+ 单元（权限与转换） |
| 需求 3 | §3.3.4、§4.2、§6.4 | 单元（`planGroupTaskUpdate`）+ 集成 |
| 需求 4 | §3.2.1、§4.1、§6.4 | 单元 + 集成（深度、上限、级联） |
| 需求 5 | §2.3.1、§3.1、§6.6 | 单元（快照渲染、工具面）+ 人工（bot 实际行为，见 §8.2） |
| 需求 6 | §3.3.5 | 桌面端单测 + 类型检查 + 人工（桌面端区块） |
| 需求 7 | §2.3.3、§6.5 | 集成（成员移出释放、归档释放） |
| 非功能需求 | §2.1、§3.1、§6 | 并发集成测试、渲染长度单测 |

## 8. 风险与待确认项

### 8.1 风险

- 工具与快照只能引导 bot，不能强制 bot 一定先看板；服务端的认领互斥和重名拒绝是兜底，保证即使 bot 疏忽也不会产生两个负责人
- bot 认领后若因故没有收尾，任务会一直停在 `in_progress`；本期靠用户“释放”、成员被移出、bot 自行释放来处理，不做超时自动释放（见需求 Out of Scope）
- 重名检测是按标题的精确匹配（忽略大小写与空白），语义相近但措辞不同的任务无法拦截；由每轮快照让 bot 自己判断
- 快照每轮注入会占用上下文：`ambientContext` 作为不可见消息写入 bot 会话历史，不是临时的。已限制为最多 40 行且整体不超过 6000 字符，每轮规则文案压缩到约 400 字符（完整规则在工具描述中）；典型看板每轮约几百 token。后续若成为瓶颈，可改为“看板自上次注入后未变化则跳过”（需记录每个 bot 的最后注入版本并在压缩后重置）
- 看板文本来自其他 bot，存在提示词注入面；快照头部声明其为数据，并限制长度

### 8.2 待确认项

- 是否需要在群聊消息流里展示“某 bot 认领了任务”的系统消息（本期不做，只在“任务”区块展示）
- 是否需要任务依赖与定时提醒（本期不做）
- 远端 computer 容器需要同步并重建后，bot 才拿到新工具；重建会中断正在运行的 bot 任务，需用户确认后执行
