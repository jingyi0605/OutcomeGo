# 第 0 波数据库测试失败基线

日期：2026-11-17

代码基线：`69e5edd7c`（第 0 波 A 阶段 1 提交）；父基线 `3b02ebfe6`。本次全量数据库运行在第 0 波 B 修改前启动，运行期间未修改业务代码。

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
