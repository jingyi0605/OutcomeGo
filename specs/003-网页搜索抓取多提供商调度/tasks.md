# 任务清单 - 网页搜索与抓取多提供商调度（人话版）

状态：IN_REVIEW

## 这份任务清单是做什么的

这份任务清单把 DeepSeek 接入和多提供商调度拆成可验证的步骤。每个任务完成后要立即更新状态，并保持与 [requirements.md](requirements.md) 和 [design.md](design.md) 的追踪关系。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

## 阶段 1：契约、数据模型与迁移

- [x] 1.1 扩展 Web provider 共享契约
  - 状态：DONE
  - 这一步到底做什么：增加 DeepSeek、schedule、strategy、cursor 和新旧输入兼容类型。
  - 做完你能看到什么：contracts 能表达关闭、单 provider 和多 provider 配置。
  - 先依赖什么：无
  - 开始前先看：`requirements.md` 需求 1、2、3、4；`design.md` §3.2、§3.3
  - 主要改哪里：`packages/contracts/src/web-search.ts` 和相关 contract parity 测试
  - 这一步先不做什么：不修改运行时请求和 UI。
  - 怎么算完成：Search 和 Fetch 都列出 DeepSeek；新旧输入类型和公开视图类型清晰区分。
  - 怎么验证：contracts typecheck、contract parity tests
  - 对应需求：`requirements.md` 需求 1、2、3、4
  - 对应设计：`design.md` §3.2、§3.3

- [x] 1.2 更新数据库模型并添加迁移
  - 状态：DONE
  - 这一步到底做什么：保存每个 Web tool 的 schedule 和轮询 cursor，同时保留旧字段兼容读取。
  - 做完你能看到什么：升级后原 provider、secret 和 check 状态仍然存在，新配置能保存。
  - 先依赖什么：1.1
  - 开始前先看：`requirements.md` 需求 2、4；`design.md` §4.1
  - 主要改哪里：`packages/db/prisma/schema.prisma`、新 migration、`packages/db/prisma/sql/raw-schema.sql`
  - 这一步先不做什么：不删除旧 provider 字段。
  - 怎么算完成：旧数据迁移为单 entry schedule；schedule 结构和目录约束可由服务层验证。
  - 怎么验证：Prisma generate、database migration test
  - 对应需求：`requirements.md` 需求 2、4
  - 对应设计：`design.md` §4.1

### 阶段检查

- [x] 1.3 契约与迁移检查点
  - 状态：DONE
  - 这一步到底做什么：确认新数据结构不会破坏现有单 provider 读取。
  - 做完你能看到什么：可以在新模型上实现 server service，不用回头改基础结构。
  - 先依赖什么：1.1、1.2
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：阶段 1 全部相关文件
  - 这一步先不做什么：不增加新的策略。
  - 怎么算完成：旧配置和空配置默认值明确；新旧公开 API 结构有测试样例。
  - 怎么验证：typecheck、service validation tests
  - 对应需求：`requirements.md` 需求 2、4
  - 对应设计：`design.md` §3.2、§4.1、§6.3

## 阶段 2：服务端配置与运行时调度

- [x] 2.1 实现服务端 schedule 保存和兼容读取
  - 状态：DONE
  - 这一步到底做什么：让 settings service 保存完整 schedule、校验 ready provider，并返回 secret-free view。
  - 做完你能看到什么：API 能创建、修改、删除多个 provider entry，并保留旧客户端行为。
  - 先依赖什么：1.3
  - 开始前先看：`requirements.md` 需求 2、4；`design.md` §2.2、§3.3.1、§4.1
  - 主要改哪里：`apps/server/src/services/web-provider-settings.ts`、`apps/server/src/routes/settings.ts`、服务端测试
  - 这一步先不做什么：不实现 provider 外部请求。
  - 怎么算完成：保存完整 schedule 是事务性的；公开 API 永不回传 secret。
  - 怎么验证：server web provider tests、integration test with database
  - 对应需求：`requirements.md` 需求 2、4
  - 对应设计：`design.md` §3.3.1、§4.1、§5

- [x] 2.2 实现 DeepSeek Search/Fetch adapters
  - 状态：DONE
  - 这一步到底做什么：接入 DeepSeek Search/Fetch 官方 endpoint，并把响应转换为现有工具结果。
  - 做完你能看到什么：runtime 可以单独使用 DeepSeek 完成搜索和抓取。
  - 先依赖什么：1.1
  - 开始前先看：`requirements.md` 需求 1；`design.md` §3.3.3、§3.3.4；DeepSeek 中文接口说明
  - 主要改哪里：`apps/computer/src/search-provider.ts`、`apps/computer/src/fetch-provider.ts`、对应测试
  - 这一步先不做什么：不实现多 provider 顺序。
  - 怎么算完成：请求 method、URL、headers、body 与文档一致；错误信息不会泄露 API Key。
  - 怎么验证：provider adapter unit tests、malformed/oversized response tests
  - 对应需求：`requirements.md` 需求 1、4
  - 对应设计：`design.md` §3.3.3、§3.3.4、§5.3

- [x] 2.3 实现 round-robin 和 failover 调度
  - 状态：DONE
  - 这一步到底做什么：把 schedule credentials 接入 Search/Fetch client，实现轮询和故障转移。
  - 做完你能看到什么：运行时按照保存策略调用 provider，失败时遵守策略边界。
  - 先依赖什么：2.1、2.2
  - 开始前先看：`requirements.md` 需求 3；`design.md` §2.3.2、§2.3.3、§5.3、§6.2
  - 主要改哪里：`apps/computer/src/search-settings.ts`、`search-provider.ts`、`fetch-provider.ts`、对应测试
  - 这一步先不做什么：不实现并行聚合和按成本调度。
  - 怎么算完成：round-robin 单次请求最多一个外部请求；failover 顺序稳定且会跳过未 ready provider；取消信号不会触发后续 provider。
  - 怎么验证：runtime scheduler tests、cancellation and retry tests
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §2.3、§5.3、§6.2

### 阶段检查

- [x] 2.4 运行时核心流程检查点
  - 状态：DONE
  - 这一步到底做什么：确认 server credentials、DeepSeek adapter 和调度器能串成完整调用链。
  - 做完你能看到什么：可以把同一 schedule 提供给 Search 和 Fetch，而不出现类型或错误分类断层。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：`requirements.md` 需求 1、3、4；`design.md` §2、§3、§5
  - 主要改哪里：阶段 2 全部相关文件
  - 这一步先不做什么：不改设置页面布局。
  - 怎么算完成：单 provider、轮询、故障转移和关闭均有测试；凭据不进入错误消息。
  - 怎么验证：computer tests、server integration tests

## 阶段 3：桌面端设置页面

- [x] 3.1 更新 Search/Fetch 页面为多 provider 编辑器
  - 状态：DONE
  - 这一步到底做什么：支持添加、删除、排序 provider entries，并选择策略。
  - 做完你能看到什么：用户可以在对应页面配置多个 provider，页面重开后顺序和策略仍然显示。
  - 先依赖什么：2.4
  - 开始前先看：`requirements.md` 需求 2、3；`design.md` §2.2、§3.2；现有 providers.tsx
  - 主要改哪里：`apps/desktop/src/renderer/components/aiteamos/settings/providers.tsx`、web provider icons、DeepSeek 图标和 i18n
  - 这一步先不做什么：不增加新的 Web tool。
  - 怎么算完成：当前 tool 能显示已加入 entries 和可添加 provider；顺序、策略、API Key 和删除状态都能保存；单 provider 旧配置仍能编辑。
  - 怎么验证：desktop typecheck、settings UI test script、手工走查 Search 和 Fetch 页面
  - 对应需求：`requirements.md` 需求 2、3
  - 对应设计：`design.md` §2.2、§3.2

- [x] 3.2 兼容 onboarding 和设置摘要
  - 状态：DONE
  - 这一步到底做什么：让 onboarding、Providers 总览和 warning 使用新 schedule，同时继续支持单 provider 引导。
  - 做完你能看到什么：已有 Search 配置不会被误判为未配置，Fetch 默认 built-in 行为保持不变。
  - 先依赖什么：3.1
  - 开始前先看：`requirements.md` 需求 2、4；onboarding.tsx 和 providers.tsx
  - 主要改哪里：`apps/desktop/src/renderer/components/aiteamos/onboarding.tsx`、providers.tsx
  - 这一步先不做什么：不把 onboarding 改成完整多 provider 管理器。
  - 怎么算完成：总览显示首选 provider 或 Off；onboarding 能根据 schedule 是否为空判断 Search 是否开启。
  - 怎么验证：onboarding tests、provider settings tests
  - 对应需求：`requirements.md` 需求 2、4
  - 对应设计：`design.md` §2.3.1、§4.2

### 阶段检查

- [ ] 3.3 桌面端交互检查点
  - 状态：IN_REVIEW
  - 这一步到底做什么：检查多 provider 编辑在错误、取消、重新加载和保存成功场景下的状态一致性。
  - 做完你能看到什么：没有丢失未保存 key；策略切换不会覆盖另一项 tool；错误提示可理解。
  - 先依赖什么：3.1、3.2
  - 开始前先看：`requirements.md`；`design.md` §2.3.1、§5
  - 主要改哪里：桌面端阶段全部相关文件
  - 这一步先不做什么：不扩展其他设置页面。
  - 怎么算完成：Search 和 Fetch 的 draft 状态互不污染；保存失败后用户输入仍然存在。
  - 怎么验证：desktop test scripts、手工交互检查

## 阶段 4：最终验证

- [ ] 4.1 全量相关测试与静态检查
  - 状态：IN_REVIEW
  - 这一步到底做什么：运行受影响 workspace 的 typecheck、单元测试、集成测试和构建检查。
  - 做完你能看到什么：DeepSeek、调度、迁移和 UI 都有实际验证证据。
  - 先依赖什么：3.3
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`
  - 主要改哪里：当前 Spec 涉及的全部代码和测试
  - 这一步先不做什么：不处理无关的预存工作区修改。
  - 怎么算完成：相关测试通过；已知限制和未执行的环境测试被记录。
  - 怎么验证：`bun run typecheck`、相关 package tests、`bun --filter @aiteamos/desktop build`
  - 对应需求：全部需求
  - 对应设计：全部相关章节

- [ ] 4.2 最终检查点
  - 状态：IN_REVIEW
  - 这一步到底做什么：确认需求、设计、任务和验证证据逐项对应，并回写 Spec 状态。
  - 做完你能看到什么：Spec 可以交付复核，代码和文档没有遗漏的主链路。
  - 先依赖什么：4.1
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`、`docs/`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不追加未评审的新需求。
  - 怎么算完成：已完成任务标记为 `DONE` 并有验证证据；三份主文档交叉引用有效；最终状态更新为可复核状态。
  - 怎么验证：文档人工走查、相关测试结果复核
  - 对应需求：全部需求
  - 对应设计：全部相关章节
