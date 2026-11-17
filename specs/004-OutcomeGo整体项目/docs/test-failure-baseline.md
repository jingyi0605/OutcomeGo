# 第 0 波数据库测试失败基线

日期：2026-11-17

代码基线：`69e5edd7c`（第 0 波 A 阶段 1 提交）；父基线 `3b02ebfe6`。本次全量数据库运行在第 0 波 B 修改前启动，运行期间未修改业务代码。

## 后续修复状态（2026-11-17 组合验收）

下文保留第 0 波原始失败事实。原 `read-transcript.integration.test.ts:51` 已由 `7e6b0e028` → 集成 `49a7500c6` 修复：canonical `Computer` 截图回执恢复为可观察文本，不暴露工具输入、图片内容或私有 details；第三方同名动态工具仍被排除。原集成测试文件未修改，integrator 在专用本地数据库实际执行该原用例、新真实截图读回及单元隐私回归，另与 Routine schema 回归合并为 **25 PASS / 0 FAIL / 217 assertions / 4 files**。修复与原始红绿对照见[证据](../../004.5-运行时恢复与版本验收/docs/20261117-历史截图回执修复与验证.md)。

本轮同时修正 51 处历史测试库变量读取，使规范命令激活原先被跳过的用例。新广泛失败必须保留实际数量、身份和原因，不能自动归入本表，也不能因是旧问题就当作验收通过。当前全量运行的其他实际失败仍在负责人协调下处理，父任务 1.3 保持 PENDING。

## 环境和命令

- 本机 macOS / Bun `1.4.4`；CI 固定 Bun `1.4.2`，本地结果不等价于 GitHub CI。
- 仅使用一次性 PostgreSQL 17 容器 `outcomego-w0-pg`，端口 `55430`；未连接项目 `.env` 的数据库或远端数据库。
- 原始 `OUTCOMEGO_TEST_DATABASE_URL=<临时库> bun run test` 退出 0：25/25 Turbo 任务成功，但严格环境过滤导致数据库测试跳过，不能算数据库验证。
- 显式传递临时库后强制运行全部包，禁止缓存，没有删除、跳过或放宽既有测试。

```bash
DATABASE_URL=postgresql://outcomego:outcomego@127.0.0.1:55430/outcomego bun --cwd packages/db scripts/deploy-schema.ts
DATABASE_URL=postgresql://outcomego:outcomego@127.0.0.1:55430/outcomego OUTCOMEGO_TEST_DATABASE_URL=postgresql://outcomego:outcomego@127.0.0.1:55430/outcomego TURBO_ENV_MODE=loose bun run test --force --continue=always
```

CI 使用 `turbo.json` 的 `test.passThroughEnv` 精确传递测试库变量，无需 loose 模式；`--force --continue=always` 保证所有包实际执行并报告失败。Turbo dry-run 已确认变量进入 db 测试。

原始日志位于本机 `/tmp/openteam-wave0/full-baseline.log` 和 `/tmp/openteam-wave0/full-database-baseline.log`。不提交可能含测试运行环境的原始日志。

## 负责人决定

2026-11-17，负责人明确选择 “Make all DB tests blocking”：完整数据库测试放入 `checks`，保留失败门槛，接受既有问题修复前 CI 为红色。不使用非阻塞 job。推送和 GitHub CI 观察尚未执行，父任务 1.3 保持 PENDING，不能声称 CI 已绿色。

## 本次失败

下表记录本次执行事实，不能将所有失败都声称为已在 `3b02ebfe6` 验证的旧失败。交接材料只明确报告 worker 约 14 项及 transcript 第 51 行在旧基线上同样失败；其余为本次新增观测。跨包并发共享测试库可能干扰清理和计数，应以逐文件重放区分确定失败和时序问题。

| 文件 | 测试名 | 原因摘要 |
|---|---|---|
| `packages/messaging/test/read-transcript.integration.test.ts` | scoped persisted history: stopped workers, paging, append, compaction and private boundaries | 第 51 行 Computer 截图路径断言为 false，旧表名修复后仍失败。 |
| `apps/worker/test/task-continuation.integration.test.ts` | real queue preserves delayed work across host recreation and reconciles an accepted action after lost completion | 清理时 parentBotId 为空字符串，PostgreSQL 拒绝 UUID 输入；原始失败待复核。 |
| `packages/plugins/test/upstream.test.ts` | every registry package declares its origin and shipped provider files survive export byte for byte | 超过默认 5000ms 测试预算；并发运行时发生。 |
| `packages/messaging/test/context-prompt-snapshot.integration.test.ts` | profile, memory facts, and skills freeze independently per context epoch | 超过默认 5000ms 测试预算；并发运行时发生。 |
| `apps/worker/test/typed-message-supersedes-turn.integration.test.ts` | an explicit Stop wins over an earlier typed interruption of a agent wake after its durable cancellation | Stop 后查询仍返回预期为空的主运行记录，toBeNull 断言失败。 |
| `apps/worker/test/typed-message-supersedes-turn.integration.test.ts` | an explicit Stop wins over an earlier typed interruption of a agent wake before cancellation is recorded | Stop 后查询仍返回预期为空的主运行记录，toBeNull 断言失败。 |
| `apps/worker/test/typed-message-supersedes-turn.integration.test.ts` | an explicit Stop wins over an earlier typed interruption of a connector wake after its durable cancellation | Stop 后查询仍返回预期为空的主运行记录，toBeNull 断言失败。 |
| `apps/worker/test/typed-message-supersedes-turn.integration.test.ts` | an explicit Stop wins over an earlier typed interruption of a connector wake before cancellation is recorded | Stop 后查询仍返回预期为空的主运行记录，toBeNull 断言失败。 |
| `apps/worker/test/typed-message-supersedes-turn.integration.test.ts` | an explicit Stop wins over an earlier typed interruption of a background_revival wake after its durable cancellation | Stop 后查询仍返回预期为空的主运行记录，toBeNull 断言失败。 |
| `apps/worker/test/typed-message-supersedes-turn.integration.test.ts` | an explicit Stop wins over an earlier typed interruption of a background_revival wake before cancellation is recorded | Stop 后查询仍返回预期为空的主运行记录，toBeNull 断言失败。 |
| `apps/worker/test/input-delivery.integration.test.ts` | worker replays an unacknowledged user input and clears its watermark only after durable delivery | 数据库报告 deadlock detected；需排查并发测试库清理。 |
| `apps/server/test/startup-recovery.integration.test.ts` | a restart posts one chat notice per cut-off user turn and wakes no bot | 重启通知数量/事件列表与断言不符。 |
| `apps/server/test/startup-recovery.integration.test.ts` | a bot woken about its failed background Task gets no extra restart notice | 重启通知数量/事件列表与断言不符。 |
| `apps/server/test/web-provider-settings.integration.test.ts` | search and fetch keep separate providers, safe defaults and a secret-free public API | Exa 删除提示的预期文案过期，当前要求从 provider schedule 移除。 |
| `apps/worker/test/wake-parent.integration.test.ts` | routine → isolated automation → WakeParent → channel delivery, including silent results and delegated continuation | WakeParent worker fixture timed out。 |
| `apps/server/test/a2a-contract.integration.test.ts` | source-verified Bot A2A errors, group rows, and channel updates run end to end | fixture 请求失败，消息/更新的结果列表与断言不符。 |
| `apps/server/test/notification-read-chaos.integration.test.ts` | concurrent, duplicated and stale reads preserve newer messages and reactions | 未读计数期望 26，实际 30。 |
| `apps/worker/test/memory-restart.integration.test.ts` | a worker killed at before-memory recovers the settled exchange without another turn | 恢复子进程等待超时，或 P2025 找不到 Run；需排查测试库并发与旧 fixture。 |
| `apps/server/test/plugin/management.integration.test.ts` | sources refresh in place, installed snapshots survive removal, and the skill library is shared by the UI and every Bot | 插件来源/技能目录布尔断言期望 true，实际 false。 |
| `apps/server/test/plugin/released-updates.integration.test.ts` | plugins shipped with a release update with it and reconnect | 插件更新说明文案断言不一致，实际包含 OutcomeGo。 |
| `apps/server/test/plugin/catalog-lifecycle.integration.test.ts` | bitwarden: actual catalog package installs, exports, loads workflows, isolates accounts, and uninstalls | 插件运行环境构建/生命周期调用失败。 |
| `apps/server/test/plugin/bitwarden-environment.integration.test.ts` | Bitwarden runtime fields install, rotate, stay private, inherit, conflict and uninstall in a disposable DB | fixture 用户名环境字段期望 bot@example.test，实际 undefined。 |
| `apps/server/test/external-messaging/delivery.integration.test.ts` | outbound delivery > outcomes > a refusal from the connector is recorded as failed with its own code, and starts no recovery wake | 外部发送失败/不确定结果结构与断言不符。 |
| `apps/server/test/external-messaging/delivery.integration.test.ts` | outbound delivery > outcomes > a tool error after the call began is uncertain, and is never sent again | 外部发送失败/不确定结果结构与断言不符。 |
| `apps/server/test/external-messaging/reply-routing.integration.test.ts` | SendToUser from and to an external chat > replying in the external chat > a picture goes out as a file | 图片发送状态期望 sent，实际 failed。 |
| `apps/worker/test/memory-restart.integration.test.ts` | a worker killed at inference recovers the settled exchange without another turn | 恢复子进程等待超时，或 P2025 找不到 Run；需排查测试库并发与旧 fixture。 |
| `apps/worker/test/memory-restart.integration.test.ts` | a worker killed at inference-natural-expiry recovers the settled exchange without another turn | 恢复子进程等待超时，或 P2025 找不到 Run；需排查测试库并发与旧 fixture。 |
| `apps/worker/test/memory-restart.integration.test.ts` | a worker killed at before-publication recovers the settled exchange without another turn | 恢复子进程等待超时，或 P2025 找不到 Run；需排查测试库并发与旧 fixture。 |
| `apps/worker/test/memory-restart.integration.test.ts` | a worker killed at before-ack recovers the settled exchange without another turn | 恢复子进程等待超时，或 P2025 找不到 Run；需排查测试库并发与旧 fixture。 |
| `apps/worker/test/lifecycle.integration.test.ts` | durable bot mailboxes preserve Pi sessions, agent DMs, and ordered group rounds | bootstrap/生命周期 fixture 断言失败。 |
| `apps/worker/test/memory-routing.integration.test.ts` | in a group room the worker gives each bot only its own memory, and saved and learned facts are bot-wide | 断言与当前行为不一致，需逐文件重放定位。 |

共 31 个不同失败测试。全量命令退出 1。

```text
@outcomego/design-tokens:test:  4 pass
@outcomego/design-tokens:test:  0 fail
@outcomego/client-core:test:  82 pass
@outcomego/client-core:test:  0 fail
@outcomego/shell-jobs:test:  18 pass
@outcomego/shell-jobs:test:  0 fail
@outcomego/ios:test:  7 pass
@outcomego/ios:test:  0 fail
@outcomego/contracts:test:  180 pass
@outcomego/contracts:test:  0 fail
@outcomego/product-core:test:  157 pass
@outcomego/product-core:test:  0 fail
@outcomego/landing:test:  61 pass
@outcomego/landing:test:  0 fail
@outcomego/db:test:  41 pass
@outcomego/db:test:  4 skip
@outcomego/db:test:  0 fail
@outcomego/desktop:test:  726 pass
@outcomego/desktop:test:  0 fail
@outcomego/messaging:test:  322 pass
@outcomego/messaging:test:  185 skip
@outcomego/messaging:test:  2 fail
@outcomego/plugins:test:  780 pass
@outcomego/plugins:test:  19 skip
@outcomego/plugins:test:  1 fail
@outcomego/plugin-sdk:test:  260 pass
@outcomego/plugin-sdk:test:  0 fail
@outcomego/cli:test:  758 pass
@outcomego/cli:test:  0 fail
@outcomego/server:test:  1125 pass
@outcomego/server:test:  178 skip
@outcomego/server:test:  12 fail
@outcomego/computer:test:  1347 pass
@outcomego/computer:test:  72 skip
@outcomego/computer:test:  0 fail
@outcomego/worker:test:  155 pass
@outcomego/worker:test:  51 skip
@outcomego/worker:test:  16 fail
 Tasks:    21 successful, 25 total
```

## 修复、限制和回滚

- `c686edae0`：Wechat 原子重命名竞争只容忍 ENOENT，其他错误仍失败；runtime archive 大 fixture 使用独立 30 秒测试预算。
- `5b9d4dc99`：ReadTranscript SQL 使用 `outcomego_message`。截图路径失败为另一个问题，保留测试。
- 未修改无关 Worker、通知、插件或发送业务。测试偶发失败及真正业务失败均保留门槛。
- 回滚：撤销对应源码/CI 提交；数据库只在一次性容器内创建，无生产数据库变化。
- 第 0 波 B 验证和后续 CI 结果写入后续验证记录，不覆盖本次观测。

## 第 0 波 B 验证记录

实现提交：`23bc29151`（共享合同）、`ad4b5de94`（状态实现、工具接入和测试）。数据库结构无变化。

定向验证：

- contracts、db、messaging、worker、server、computer 类型检查全部通过。
- `bun run check:architecture` 和 `bun run check:workflows` 通过。
- 临时 PostgreSQL 上的状态矩阵、端口、原 OutcomeService、工具分发、模型测试：334 PASS / 0 FAIL；其中原 OutcomeService 11 项全部通过。
- contracts 与 Computer 工具列表快照：64 PASS / 0 FAIL。主对话、Routine、普通事件 Run 列表与修改前完全一致，两个未实现工具未暴露。
- 全量数据库复核在同一容器内的新数据库 `outcomego_w0_verify` 执行：`OUTCOMEGO_TEST_DATABASE_URL=<该临时库> bun run test --force --continue=always`，使用 Turbo 严格环境白名单，日志 `/tmp/openteam-wave0/full-database-after.log`。

| 包 | 第 0 波 A PASS / FAIL / SKIP | 第 0 波 B PASS / FAIL / SKIP |
|---|---|---|
| cli | 758 / 0 / 0 | 758 / 0 / 0 |
| client-core | 82 / 0 / 0 | 82 / 0 / 0 |
| computer | 1347 / 0 / 72 | 1352 / 0 / 72 |
| contracts | 180 / 0 / 0 | 180 / 0 / 0 |
| db | 41 / 0 / 4 | 41 / 0 / 4 |
| design-tokens | 4 / 0 / 0 | 4 / 0 / 0 |
| desktop | 726 / 0 / 0 | 726 / 0 / 0 |
| ios | 7 / 0 / 0 | 7 / 0 / 0 |
| landing | 61 / 0 / 0 | 61 / 0 / 0 |
| messaging | 322 / 2 / 185 | 635 / 2 / 185 |
| plugin-sdk | 260 / 0 / 0 | 260 / 0 / 0 |
| plugins | 780 / 1 / 19 | 780 / 1 / 19 |
| product-core | 157 / 0 / 0 | 157 / 0 / 0 |
| server | 1125 / 12 / 178 | 1133 / 10 / 178 |
| shell-jobs | 18 / 0 / 0 | 18 / 0 / 0 |
| worker | 155 / 16 / 51 | 157 / 14 / 51 |

第 0 波 A 有 31 个不同失败，第 0 波 B 有 27 个不同失败；两次均为 21/25 Turbo 任务成功，命令退出 1。全量重放仍有以下 4 个在第二次出现、第一次未出现的失败：

| 文件 | 测试名 | 复核结果 |
|---|---|---|
| `packages/plugins/test/bitwarden.test.ts` | network, authentication, sync and provider failures never forward raw CLI output or stale results | A 基线与 B 当前实现逐文件隔离回放均通过 |
| `apps/server/test/routine-validation.integration.test.ts` | bot and group routine routes reject invalid schedules without changing saved routines | A 基线与 B 当前实现逐文件隔离回放均通过 |
| `packages/messaging/test/file/watcher-startup.integration.test.ts` | watching imports new skill directories after repeated atomic profile replacements | A 基线与 B 当前实现逐文件隔离回放均通过 |
| `apps/server/test/external-messaging/reminder.integration.test.ts` | daily reminder > the answer > "1" after a reminder keeps the channel open and wakes nobody | A 基线与 B 当前实现逐文件隔离回放均通过 |

复核方法：在 `/tmp/openteam-wave0/baseline` 建立 detached worktree，固定 `b7ff0099a`（第 0 波 B 前），独立安装依赖和生成 Prisma/plugin 产物，使用临时库 `outcomego_w0_baseline_replay`；当前分支使用另一临时库 `outcomego_w0_current_replay`。两个版本分别执行上述四个文件：A 为 13 + 52 PASS / 0 FAIL，B 为 65 PASS / 0 FAIL。日志为 `/tmp/openteam-wave0/baseline-replay.log`、`baseline-reminder-replay.log`、`current-replay.log`。

结论：未发现可重复的第 0 波 B 新失败；全量执行中的偶发/并发问题仍然使 CI 失败，未将其隐藏或标为 PASS。既有确定失败继续保留。所有新 Outcome 测试在定向和全量运行中通过。不能根据两次不同失败数宣称修复了这些无关业务问题。

回滚：撤销第 0 波 B 两个实现提交；保留 A 的 Outcome 基础模型与 CI 测试门槛。测试结束删除本次一次性容器，独立 worktree 在检查无用户改动后移除；原始日志保留在本机临时目录。没有重建远端 computer。
