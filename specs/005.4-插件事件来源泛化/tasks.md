# 任务清单 - 插件事件来源泛化（人话版）

状态：Draft

## 这份文档是干什么的

让人快速知道：先做什么、后做什么、每一步改什么、做完后怎么判断真的完成了。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：只有 `状态：DONE` 的任务才能勾选成 `[x]`；每做完一个任务，必须立刻更新这里。

---

## 阶段 1：清单与共享类型

- [x] 1.1 清单允许通用事件来源
  - 状态：DONE
  - 这一步到底做什么：让清单里的 `events.source` 可以写 `plugin`，并允许 Remote MCP（`http`）连接声明；`email` 仍只允许 `stdio`。
  - 做完你能看到什么：一个声明了 `events: { pollTool, source: "plugin" }` 的 Remote MCP 插件能通过清单校验；`email` 用在 `http` 连接上仍被拒绝。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §3.2.1
  - 主要改哪里：
    - `packages/plugin-sdk/src/types.ts`（`PluginEventSource`）
    - `packages/plugin-sdk/src/manifest.ts`（`PLUGIN_EVENT_SOURCES` 与校验）
    - `packages/plugin-sdk/test/package.test.ts`
  - 这一步先不做什么：不改宿主轮询；不动 `drafts`、`messaging` 的校验
  - 怎么算完成：
    1. `plugin` 来源接受 `http` 和 `stdio`
    2. `email` 来源用于 `http` 仍报 "Only packaged (stdio) connectors can poll for events"
    3. 未知来源、间隔越界仍被拒绝
  - 怎么验证：`cd packages/plugin-sdk && bun test test/package.test.ts`
  - 对应需求：需求 1
  - 对应设计：§3.2.1

---

## 阶段 2：事件与触发器（messaging）

- [x] 2.1 事件解析与匹配支持 `plugin` 来源
  - 状态：DONE
  - 这一步到底做什么：事件增加 `plugin` 来源和 `plugin`、`account`、`resourceId` 字段；匹配规则支持 `plugin` 触发器。
  - 做完你能看到什么：`parseAutomationEvent` 接受插件事件；`matchesAutomationEvent` 按插件、事件类型、资源、触发方过滤。
  - 先依赖什么：无
  - 开始前先看：`requirements.md` 需求 3、4；`design.md` §3.2.3、§3.3.3
  - 主要改哪里：
    - `packages/messaging/src/automation-events.ts`
    - `packages/messaging/test/automation-events.test.ts`
  - 这一步先不做什么：不改触发器解析；不改唤醒文案
  - 怎么算完成：
    1. 新来源和新字段被解析，长度限制生效
    2. 匹配规则覆盖：插件不同、事件类型不匹配、资源不匹配、触发方不匹配、多条件同时满足
    3. 现有来源（含 `email`）的测试不变
  - 怎么验证：`cd packages/messaging && bun test test/automation-events.test.ts`
  - 对应需求：需求 3、4
  - 对应设计：§3.2.3、§3.3.3

- [x] 2.2 触发器解析支持 `plugin`
  - 状态：DONE
  - 这一步到底做什么：保存 routine 时校验并规范化 `plugin` 触发器；要求 `resourceIds` 与 `actors` 至少一个非空；分组规则与 `origin` 互斥。
  - 做完你能看到什么：不合法的订阅在保存时被拒绝并提示原因；合法订阅被规范化保存。
  - 先依赖什么：无
  - 开始前先看：`requirements.md` 需求 4；`design.md` §3.2.4
  - 主要改哪里：
    - `packages/messaging/src/automation-trigger.ts`
    - `packages/messaging/test/automation-trigger-validation.test.ts`
  - 这一步先不做什么：不做插件是否已安装的检查（触发器只描述订阅）
  - 怎么算完成：
    1. 缺少 `plugin`、缺少 `resourceIds` 与 `actors`、列表超限，均被拒绝
    2. 列表去重、去空白；未提供的字段不写入
    3. 与 `origin` 同组被拒绝，与 `cron` 同组允许
  - 怎么验证：`cd packages/messaging && bun test test/automation-trigger-validation.test.ts`
  - 对应需求：需求 4
  - 对应设计：§3.2.4

- [x] 2.3 routine 唤醒内容包含 `<plugin_event>`
  - 状态：DONE
  - 这一步到底做什么：为 `plugin` 来源增加事件块标签、来源标签和一行摘要。
  - 做完你能看到什么：插件事件唤醒 routine 时，提示词后附带转义后的事件 JSON 和"不受信任数据"声明。
  - 先依赖什么：2.1
  - 开始前先看：`requirements.md` 需求 5.5、5.6；`design.md` §3.3.4
  - 主要改哪里：
    - `packages/messaging/src/routines.ts`（`EVENT_BLOCKS`、`EVENT_SOURCE_LABELS`、`describeWakeEvent`）
    - `packages/messaging` 下相应测试
  - 这一步先不做什么：不改合并上限（25）
  - 怎么算完成：
    1. 唤醒内容含 `<plugin_event>` 块，`<` 已转义
    2. 摘要包含插件名、事件类型、资源和触发方
  - 怎么验证：messaging 测试
  - 对应需求：需求 5
  - 对应设计：§3.3.4

---

## 阶段 3：模型可见契约（contracts）

- [x] 3.1 `UpdateRoutine` Schema 与解析器增加 `plugin` 触发器
  - 状态：DONE
  - 这一步到底做什么：让 Bot 能在 `UpdateRoutine` 里创建 `plugin` 触发器，并在触发器不合法时看到它的形状说明。
  - 做完你能看到什么：Schema 校验接受 `plugin` 触发器；错误提示的形状列表包含它。
  - 先依赖什么：2.2
  - 开始前先看：`design.md` §3.3.5；历史提交 `ef0e4147c`（`email` 触发器的加法，可作模板）
  - 主要改哪里：
    - `packages/contracts/src/native-tools.json`（插入形状，调整 `anyOf` 序号与 `$ref`）
    - `packages/contracts/src/tool-reference.json`（模型实际看到的触发器类型枚举）
    - `packages/contracts/src/reference-main-parsers.ts`（`pluginTrigger`、联合类型、组合规则、形状文案）
    - `packages/messaging/src/prompts/managed-skills.json`（routines 技能中的触发器形状，必须与 `AUTOMATION_TRIGGER_SHAPE_LINES` 逐字一致）
    - `packages/contracts/test/main-parser-parity.test.ts`、`packages/contracts/test/contracts.test.ts`、`packages/messaging/test/managed-catalog-parity.test.ts`
  - 这一步先不做什么：不改其他触发器的字段
  - 怎么算完成：
    1. `plugin` 触发器通过 Schema 校验，单个、数组和 `group` 形式均可
    2. 非法类型仍被拒绝
    3. 与 `origin` 同组时返回明确错误
    4. 触发器形状列表包含 `plugin`，原有 `toEndWith` 等断言按需调整并保持有效
  - 怎么验证：`cd packages/contracts && bun test`
  - 对应需求：需求 6.1、6.2
  - 对应设计：§3.3.5

- [x] 3.2 `describeTrigger` 增加可读描述
  - 状态：DONE
  - 这一步到底做什么：routine 列表和详情能用一句话描述 `plugin` 触发器，并在设计中固定最终文案。
  - 做完你能看到什么：`describeTrigger` 对 `plugin` 触发器返回可读文本，单个、组合场景均正确。
  - 先依赖什么：3.1
  - 开始前先看：`design.md` §3.3.4、§8.2
  - 主要改哪里：
    - `packages/contracts/src/reference-main-parsers.ts`（`describeListener`）
    - `packages/contracts/src/tool-results.ts`（如需要）
    - `packages/contracts/test/main-parser-parity.test.ts`
    - `design.md` §3.3.4、§8.2（回写文案）
  - 这一步先不做什么：不改客户端文案
  - 怎么算完成：描述文案固定并有测试；`design.md` 已回写
  - 怎么验证：contracts 测试
  - 对应需求：需求 6.3
  - 对应设计：§3.3.4

---

## 阶段 4：服务端轮询

- [x] 4.1 宿主能对 Remote MCP 连接调用宿主工具，并对 Bot 隐藏
  - 状态：DONE
  - 这一步到底做什么：`callHostTool` 在连接为 `http` 时走 MCP 客户端；Remote MCP 发现结果过滤掉声明的轮询工具。
  - 做完你能看到什么：宿主能用连接的认证头调用 Remote MCP 上的轮询工具；Bot 的工具列表里看不到它。
  - 先依赖什么：1.1
  - 开始前先看：`requirements.md` 需求 2；`design.md` §3.3.2、§6.5
  - 主要改哪里：
    - `apps/server/src/services/plugin/transport.ts`（`callHostTool` 增加 `transport` 判断和可选 `signal`）
    - `apps/server/src/services/plugin-service.ts`（Remote MCP 发现和工具列表变更后过滤宿主工具；`callHostTool` 透传 `signal`）
    - `apps/server/src/services/plugin/transport.ts` 的 `httpOptions` 请求前检查：允许清单声明的宿主工具（它们不在 Bot 可见的工具快照里）
  - 这一步先不做什么：不改 stdio 路径；不改 Bot 调用拦截（已拒绝宿主工具名）
  - 怎么算完成：
    1. 带 `transport: "http"` 的连接调用走 `callHttp`
    2. 其他调用方（草稿、外部消息）行为不变
    3. 发现快照不含轮询工具
  - 怎么验证：服务端单元和集成测试
  - 对应需求：需求 2.1、2.3、2.4、2.6
  - 对应设计：§3.3.2

- [x] 4.2 轮询器支持 `http`、`plugin` 来源、命名空间和超时
  - 状态：DONE
  - 这一步到底做什么：`PluginEventPoller` 同时轮询 `stdio` 和 `http` 连接；`plugin` 来源的事件由宿主覆盖 `source`、`plugin`、`account` 并加命名空间标识；`http` 调用 30 秒上限；超过 50 个只取前 50 并警告。
  - 做完你能看到什么：声明了事件轮询的 Remote MCP 插件，事件到来时匹配的 routine 被唤醒；Email 行为不变。
  - 先依赖什么：2.1、4.1
  - 开始前先看：`requirements.md` 需求 2、3、5；`design.md` §2.3、§3.2.3、§5
  - 主要改哪里：
    - `apps/server/src/services/plugin/events.ts`
    - `apps/server/test/plugin-events.integration.test.ts`
  - 这一步先不做什么：不做快速追赶；不改数据库
  - 怎么算完成：
    1. `transport` 包含 `stdio` 和 `http`；查询带上 `transport`、`endpoint`、`authType`、`connectorKey`
    2. `plugin` 事件的 `source`、`plugin`、`account` 被覆盖；标识为 `plugin:<key>:<连接 ID>:<原始 id>`
    3. 空标识、超长标识被丢弃并警告，其余事件继续
    4. `http` 调用超时被取消，游标不变，其他连接继续
    5. Email 的现有测试全部通过
  - 怎么验证：`cd apps/server && bun test test/plugin-events.integration.test.ts`（部分用例需要 `OUTCOMEGO_TEST_DATABASE_URL`）
  - 对应需求：需求 2、3、5
  - 对应设计：§2.3、§3.2.3、§3.3.2

- [x] 4.3 端到端的订阅与唤醒测试
  - 状态：DONE
  - 这一步到底做什么：用模拟 Remote MCP 服务验证：创建 `plugin` 触发器的 routine，事件到来后只唤醒匹配的 routine，重复事件不重复运行。
  - 做完你能看到什么：自动化测试覆盖订阅、匹配、去重、失败重试和游标语义。
  - 先依赖什么：2.3、3.1、4.2
  - 开始前先看：`design.md` §6、§7.2
  - 主要改哪里：
    - `apps/server/test/plugin-events.integration.test.ts`
    - `apps/server/test/automation-events.integration.test.ts`
  - 这一步先不做什么：不接真实 DSH-WEB
  - 怎么算完成：
    1. 匹配与不匹配的 routine 各一个：只有匹配的运行
    2. 同一事件重复返回，routine 只运行一次
    3. 派发失败时游标不变，下一周期补上
    4. 唤醒内容含 `<plugin_event>`
  - 怎么验证：服务端集成测试（需要数据库）
  - 对应需求：需求 3、4、5
  - 对应设计：§6.1–§6.4

---

## 阶段 5：文档

- [x] 5.1 用户与插件开发文档
  - 状态：DONE
  - 这一步到底做什么：写明如何让 Bot 订阅插件事件，以及插件如何声明事件轮询。
  - 做完你能看到什么：用户文档说明订阅与限制；插件开发文档说明清单、轮询协议和首次轮询语义。
  - 先依赖什么：4.2
  - 开始前先看：`requirements.md` 需求 6.4；`design.md` §3.3.1
  - 主要改哪里：
    - `docs/usage/routines.md`（插件事件触发）
    - `packages/plugins/README.md`（`events` 声明、`source: "plugin"`、轮询协议）
    - 如存在，`docs/` 下的事件订阅与插件开发参考文档
  - 这一步先不做什么：不写 DSH-WEB 专属内容（见 Spec 005.3）
  - 怎么算完成：文档包含声明示例、协议约定、触发器字段、限制（最短 30 秒、单次 50 个、首次轮询只返回基线）
  - 怎么验证：人工阅读；示例与测试一致
  - 对应需求：需求 6.4
  - 对应设计：§3.3.1、§3.3.5

---

## 阶段 6：DSH-WEB 接入（Spec 005.3）

- [x] 6.1 回写 Spec 005.3：F2 改用订阅
  - 状态：DONE
  - 这一步到底做什么：把 005.3 的 F2 从 Routine Webhook 改为"Bot 创建 `plugin` 触发器 routine 订阅会话"，B6 从 Webhook 存储重试改为 `session_events` 查询接口。
  - 做完你能看到什么：005.3 的需求、设计、任务、前后端提示词与本规格一致。
  - 先依赖什么：本规格设计评审通过
  - 开始前先看：`specs/005.3-DSH-WEB插件集成/`
  - 主要改哪里：`specs/005.3-DSH-WEB插件集成/` 下的 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`FRONTEND_PROMPT.md`、`BACKEND_PROMPT.md`
  - 这一步先不做什么：不改插件清单
  - 怎么算完成：005.3 中不再有 Routine Webhook 作为事件通道的描述，且引用本规格
  - 怎么验证：人工复核；需求、设计、任务相互引用一致
  - 对应需求：需求 2、6
  - 对应设计：§2.3

- [x] 6.2 DSH-WEB 插件声明事件轮询与订阅指引
  - 状态：DONE（清单已声明；与真实后端的联调随 Spec 005.3 任务 F1.2 进行）
  - 这一步到底做什么：在 DSH-WEB 的 `plugin.json` 中声明 `events`，并在 `SKILL.md` 中写订阅方法。
  - 做完你能看到什么：连接 DSH-WEB 后，Bot 创建订阅 routine 即可在会话状态变化时被唤醒。
  - 先依赖什么：4.2、6.1、后端 `session_events`
  - 开始前先看：`design.md` §3.3.1；`specs/005.3-DSH-WEB插件集成/`
  - 主要改哪里：
    - `packages/plugins/dsh-web/plugin.json`（`events`，版本提升）
    - `packages/plugins/dsh-web/skills/dsh-web/SKILL.md`
    - `packages/plugins/dsh-web/README.md`
  - 这一步先不做什么：不等后端——宿主对"服务端还没有该工具"安静地每 15 分钟检查一次（需求 2.2），所以可以先声明。不在 `SKILL.md` 里点名 Bot 调用不到的轮询工具
  - 怎么算完成：清单校验通过；与后端联调，事件能唤醒订阅的 routine
  - 怎么验证：联调
  - 对应需求：需求 2
  - 对应设计：§3.3.1

---

## 阶段 7：客户端文案（可选）

- [ ] 7.1 客户端显示 `plugin` 触发器的专用文案
  - 状态：TODO
  - 这一步到底做什么：桌面、iOS、Android 的触发器描述增加 `plugin` 分支，例如"当 DSH-WEB 的会话有事件时"。
  - 做完你能看到什么：routine 列表和详情里订阅可读。
  - 先依赖什么：3.2
  - 开始前先看：`requirements.md` 需求 7.2
  - 主要改哪里：
    - `apps/desktop/src/renderer/lib/routines.ts` 与语言包
    - `apps/ios/Sources/Core/RoutineSchedule.swift`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/FeatureContracts.kt`
  - 这一步先不做什么：不做触发器编辑界面
  - 怎么算完成：三端文案一致，未识别的类型仍退化为通用文案
  - 怎么验证：各端现有测试与人工检查
  - 对应需求：需求 7
  - 对应设计：§8.1

---

## 阶段 8：回归与验收

- [ ] 8.1 回归测试与验收
  - 状态：IN_REVIEW
  - 这一步到底做什么：运行受影响包的测试，确认 Email、Routine Webhook、外部消息服务不受影响。
  - 做完你能看到什么：测试结果记录在 `docs/` 下的验收文档。
  - 先依赖什么：阶段 1–5
  - 开始前先看：`design.md` §7.3
  - 主要改哪里：`docs/`（验收结果）
  - 这一步先不做什么：不新增功能
  - 怎么算完成：`plugin-sdk`、`messaging`、`contracts`、`apps/server` 相关测试通过；未通过项逐条说明
  - 怎么验证：运行测试并记录输出
  - 对应需求：需求 7
  - 对应设计：§7.3

---

## 需求—设计—任务追踪

| 需求 | 设计章节 | 任务 | 验证方式 |
| --- | --- | --- | --- |
| 需求 1 | §3.2.1 | 1.1 | SDK 清单测试 |
| 需求 2 | §3.3.2、§6.5 | 4.1、4.2、6.2 | 服务端测试、联调 |
| 需求 3 | §3.2.2、§3.2.3、§6.2、§6.3 | 2.1、4.2、4.3 | 解析与轮询测试 |
| 需求 4 | §3.2.4、§3.3.3、§6.4 | 2.1、2.2、4.3 | 触发器解析与匹配测试 |
| 需求 5 | §2.3、§3.3.4、§6.1 | 2.3、4.2、4.3 | 集成测试 |
| 需求 6 | §3.3.5 | 3.1、3.2、5.1、6.1 | 契约测试、文档检查 |
| 需求 7 | §1.4、§7.3 | 7.1、8.1 | 回归测试 |
