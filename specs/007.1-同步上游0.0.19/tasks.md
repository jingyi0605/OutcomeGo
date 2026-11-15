# 任务清单 - 同步上游 0.0.19（人话版）

状态：COMPLETE

文档关系：

- 总览：[`README.md`](README.md)
- 父规格：[`../007-上游主分支同步/tasks.md`](../007-上游主分支同步/tasks.md)
- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)

## 阶段 1：Spec、基线和集成分支

- [x] 1.1 建立 Spec 007.1 文档
  - 状态：DONE
  - 这一步到底做什么：创建当前版本同步的需求、设计、任务和补充文档入口。
  - 做完你能看到什么：所有实现任务都能追踪到父 Spec 和当前版本决策。
  - 先依赖什么：Spec 007 的 1.1
  - 开始前先看：`specs/000-Spec规范/Spec模板/`、`specs/007-上游主分支同步/`
  - 主要改哪里：`specs/007.1-同步上游0.0.19/`
  - 这一步先不做什么：不修改业务代码。
  - 怎么算完成：四个主文档和 `docs/README.md` 已建立并互相引用。
  - 怎么验证：检查目录结构和链接。
  - 对应需求：全部需求
  - 对应设计：`design.md` §1

- [x] 1.2 固定 0.0.19 同步基线
  - 状态：DONE
  - 这一步到底做什么：固定 upstream、fork、共同祖先、提交计数和冲突规模。
  - 做完你能看到什么：本次同步的目标不会随远程后续提交漂移。
  - 先依赖什么：1.1
  - 开始前先看：`requirements.md` 需求 1、`design.md` §3.1
  - 主要改哪里：本 Spec 基线记录。
  - 这一步先不做什么：不创建正式 merge commit。
  - 怎么算完成：`fd32377bf`、`afd276ed9`、共同祖先和 272 个冲突文件均已记录。
  - 怎么验证：Git ref 和 merge-tree 输出。
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §3.1

- [x] 1.3 创建独立集成分支
  - 状态：DONE
  - 这一步到底做什么：从 OutcomeGo 当前提交创建临时 worktree 和集成分支，保护现有工作树。
  - 做完你能看到什么：可以在隔离目录中执行 merge 和冲突解决。
  - 先依赖什么：1.2
  - 开始前先看：`AGENTS.md`、`requirements.md` 需求 1。
  - 主要改哪里：Git worktree、集成分支。
  - 这一步先不做什么：不修改 `OutcomeGo` 分支，不推送。
  - 怎么算完成：集成分支基于 `afd276ed9`，工作树干净。
  - 怎么验证：`git worktree list`、`git status`、`git rev-parse HEAD`。
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §3.1

- [x] 1.4 生成并保存冲突清单
  - 状态：DONE
  - 这一步到底做什么：在集成分支运行 merge preview，按设计中的 12 个冲突组归档文件。
  - 做完你能看到什么：每个冲突文件都能找到所属模块和负责人。
  - 先依赖什么：1.3
  - 开始前先看：`design.md` §3.2 至 §3.12。
  - 主要改哪里：`specs/007.1-同步上游0.0.19/docs/20261115-冲突清单.md`
  - 这一步先不做什么：不提交任何未经审查的冲突解决。
  - 怎么算完成：冲突文件数、冲突类型和功能组映射齐全。
  - 怎么验证：`git diff --name-only --diff-filter=U`、`git status --short`。
  - 对应需求：`requirements.md` 需求 1、需求 5
  - 对应设计：`design.md` §3

### 阶段检查

- [x] 1.5 基线阶段检查
  - 状态：DONE
  - 这一步到底做什么：确认集成分支、冲突清单和产品身份清单已经准备好。
  - 做完你能看到什么：可以进入身份和数据库冲突处理。
  - 先依赖什么：1.3、1.4
  - 开始前先看：本 Spec 全部文件和 `FORK.md`。
  - 主要改哪里：Spec 和冲突清单。
  - 这一步先不做什么：不进入客户端 UI 合并。
  - 怎么算完成：基线、分组、分支保护和待确认项均明确。
  - 怎么验证：人工走查。
  - 对应需求：需求 1、需求 2
  - 对应设计：`design.md` §2、§3.1、§3.2

## 阶段 2：身份、数据库和公共模型

- [x] 2.1 解决品牌、版本和发布身份冲突
  - 状态：DONE
  - 这一步到底做什么：保留 OutcomeGo 身份，接入上游新增的检查和功能说明。
  - 做完你能看到什么：所有应用和发布文件仍指向 OutcomeGo beta 版本线。
  - 先依赖什么：1.5
  - 开始前先看：`requirements.md` 需求 2、`design.md` §3.2。
  - 主要改哪里：`README.md`、`FORK.md`、`.github/RELEASING.md`、`package.json`、`apps/*/package.json`、`apps/ios/release.json`、`.github/workflows/`。
  - 这一步先不做什么：不创建新 tag，不发布。
  - 怎么算完成：身份扫描和版本检查通过。
  - 怎么验证：`rg` 身份检查、版本脚本、`git diff --check`。
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §3.2、§6.1

- [x] 2.2 解决 Prisma、raw schema 和 deployment 冲突
  - 状态：DONE
  - 这一步到底做什么：将上游 schema 变化适配到 `outcomego_*` 物理表和现有迁移框架。
  - 做完你能看到什么：新旧 OutcomeGo 数据库都可以安全升级。
  - 先依赖什么：2.1
  - 开始前先看：`requirements.md` 需求 2、`design.md` §3.3、§6.4。
  - 主要改哪里：`packages/db/prisma/schema.prisma`、`raw-schema.sql`、`deploy-schema.ts`、数据库测试。
  - 这一步先不做什么：不连接真实用户数据库，不删除 Instructions 数据。
  - 怎么算完成：空库、已有库、重复执行和失败恢复回放通过。
  - 怎么验证：数据库 migration/deployment tests。
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §3.3、§4.2

- [x] 2.3 固定公共 contracts 和 fixture
  - 状态：DONE
  - 这一步到底做什么：先统一 routine、memory、draft、question、map、computer 和 plugin 的公共字段、状态和兼容处理。
  - 做完你能看到什么：Server、Worker、Computer、Desktop、iOS 和 Android 有共同的契约基础。
  - 先依赖什么：2.2
  - 开始前先看：`requirements.md` 需求 5、`design.md` §3.6、§3.11。
  - 主要改哪里：`packages/contracts`、`packages/product-core`、`packages/client-core`、各端 fixture。
  - 这一步先不做什么：不先复制桌面 UI 动画。
  - 怎么算完成：未知/缺失字段策略明确，fixture 与生产类型一致。
  - 怎么验证：contracts tests、typecheck、fixture parity checks。
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §3.6、§6.3

### 阶段检查

- [x] 2.4 数据和契约阶段检查
  - 状态：DONE
  - 这一步到底做什么：确认身份、schema、迁移和公共契约已经稳定。
  - 做完你能看到什么：后续运行时和客户端冲突可以基于正确的数据结构处理。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：本 Spec 全部文件。
  - 主要改哪里：数据库、contracts、fixture 和任务记录。
  - 这一步先不做什么：不扩大功能范围。
  - 怎么算完成：schema replay、contract tests、身份扫描通过。
  - 怎么验证：局部测试和人工走查。
  - 对应需求：需求 2、需求 5
  - 对应设计：`design.md` §3.2、§3.3、§4

## 阶段 3：Server、Worker、Computer 和运行时

- [x] 3.1 合并例程、Webhook 和调度可靠性
  - 状态：DONE
  - 这一步到底做什么：接入上游 routine lifecycle/scheduling fixes，并保持 OutcomeGo Webhook 和 Android 配置。
  - 做完你能看到什么：多 schedule、手动运行、编辑保存、Webhook 并行和重复执行行为一致。
  - 先依赖什么：2.4
  - 开始前先看：`design.md` §3.4。
  - 主要改哪里：`packages/messaging/src/routines.ts`、automation files/results、`apps/worker`、routine UI/API。
  - 这一步先不做什么：不删除 OutcomeGo Webhook。
  - 怎么算完成：调度、文件同步、编辑器、Webhook 和 recovery tests 通过。
  - 怎么验证：受影响 routine test suites。
  - 对应需求：`requirements.md` 需求 3.1
  - 对应设计：`design.md` §3.4

- [x] 3.2 合并记忆和取消 fencing
  - 状态：DONE
  - 这一步到底做什么：接入记忆纠正、lease、取消、重启和并发 receipt 可靠性。
  - 做完你能看到什么：纠正后的旧事实不会正常召回，取消后的晚到结果不会写入。
  - 先依赖什么：2.4
  - 开始前先看：`design.md` §3.5。
  - 主要改哪里：`packages/messaging/src/memory-*`、`agent-data.ts`、Server/Worker memory paths、数据库迁移。
  - 这一步先不做什么：不覆盖 OutcomeGo provider 和 prompt identity。
  - 怎么算完成：memory correction、lease、restart、multiworker、cancel tests 通过。
  - 怎么验证：受影响 messaging/server/worker tests。
  - 对应需求：`requirements.md` 需求 3.2
  - 对应设计：`design.md` §3.5、§6.2

- [x] 3.3 合并 draft、question 和消息回执可靠性
  - 状态：DONE
  - 这一步到底做什么：接入 durable draft outcomes、send/discard recovery、question retirement 和 reaction acknowledgements。
  - 做完你能看到什么：重启、重连、晚到 connector 结果和普通回复不会产生错误回执或重复发送。
  - 先依赖什么：2.4
  - 开始前先看：`design.md` §3.6。
  - 主要改哪里：Server draft/question services、contracts、product-core、Desktop/iOS/Android state handlers。
  - 这一步先不做什么：不改变 OutcomeGo 的 Inbox/Outcome 产品命名。
  - 怎么算完成：draft/question lifecycle、external draft、receipt and retry tests 通过。
  - 怎么验证：Server、product-core、messaging and client tests。
  - 对应需求：`requirements.md` 需求 3.3、需求 5
  - 对应设计：`design.md` §3.6、§6.2

- [x] 3.4 合并删除、agent store 和 Computer 控制
  - 状态：DONE
  - 这一步到底做什么：接入最终删除、旧目录退休、晚到 dispatch fence、控制权持久化和 handoff。
  - 做完你能看到什么：被删除或归档的聊天不会重新认领，Computer 控制在重连后仍符合用户选择。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：`design.md` §3.7。
  - 主要改哪里：Server lifecycle、Computer agent store/screen control、messaging lifecycle。
  - 这一步先不做什么：不重建远程 Debug Computer。
  - 怎么算完成：删除 race、symlink boundary、control ownership、handoff and recovery tests 通过。
  - 怎么验证：受影响 server/worker/computer integration tests。
  - 对应需求：`requirements.md` 需求 3.4、需求 3.5
  - 对应设计：`design.md` §3.7

- [x] 3.5 合并 Computer 网络可靠性
  - 状态：DONE
  - 这一步到底做什么：接入上游 startup readiness、network reset、SOCKS lifecycle 和 attachment routing 修复，同时保留 OutcomeGo exits。
  - 做完你能看到什么：网络变化和服务启动时更容易恢复，旧 route 仍被正确 fence。
  - 先依赖：3.4
  - 开始前先看：`design.md` §3.8、`AGENTS.md` Remote Debug Computer。
  - 主要改哪里：`apps/computer/src/browser-network*`、Server network service、plugin-sdk network、Docker network scripts。
  - 这一步先不做什么：不申请或执行远程 Computer rebuild。
  - 怎么算完成：network policy、DNS/TLS、lease/epoch、startup and recovery tests 通过。
  - 怎么验证：受影响 package tests and static checks。
  - 对应需求：`requirements.md` 需求 3.5
  - 对应设计：`design.md` §3.8

### 阶段检查

- [x] 3.6 运行时阶段检查
  - 状态：DONE
  - 这一步到底做什么：确认 runtime、worker、server、computer 的状态机和 fencing 语义闭合。
  - 做完你能看到什么：客户端可以基于稳定 API 开始适配。
  - 先依赖：3.1 至 3.5
  - 开始前先看：本 Spec 全部运行时章节。
  - 主要改哪里：受影响 runtime、tests 和决策记录。
  - 这一步先不做什么：不追加新插件。
  - 怎么算完成：跨包状态流转、错误恢复和数据库回放证据齐全。
  - 怎么验证：Server/Worker/Computer integration and typecheck。
  - 对应需求：需求 3、需求 5
  - 对应设计：`design.md` §4、§6

## 阶段 4：Desktop、iOS 和 Android

- [x] 4.1 合并 Desktop ScreenBot、Keyboard 和 preview
  - 状态：DONE
  - 这一步到底做什么：适配 ScreenBot、快捷键、截图 composer、文件 preview 和相关动画到 OutcomeGo Desktop。
  - 做完你能看到什么：桌面功能可用，路径、权限、用户数据和品牌仍属于 OutcomeGo。
  - 先依赖：3.6
  - 开始前先看：`design.md` §3.9。
  - 主要改哪里：`apps/desktop/src/main`、`preload`、renderer、native helper、Desktop tests。
  - 这一步先不做什么：不把上游 `openteam` 文件路径直接当作目标路径。
  - 怎么算完成：ScreenBot ownership、shortcut、preview、resource and build checks 通过。
  - 怎么验证：Desktop package tests、native/resource checks、build checks。
  - 对应需求：`requirements.md` 需求 4.1
  - 对应设计：`design.md` §3.9

- [x] 4.2 合并 iOS voice note、preview 和 question 行为
  - 状态：DONE
  - 这一步到底做什么：接入 voice note 离开聊天后继续转写、文件 preview、问题卡和 composer motion 修复。
  - 做完你能看到什么：iOS 任务在切换聊天或重连时保留状态。
  - 先依赖：3.6
  - 开始前先看：`design.md` §3.10。
  - 主要改哪里：`apps/ios/Sources`、`Tests`、fixtures、resources。
  - 这一步先不做什么：不改 OutcomeGo bundle identity 或 release version。
  - 怎么算完成：Swift model、fixture、resource and UI checks 通过。
  - 怎么验证：iOS available test/build checks。
  - 对应需求：`requirements.md` 需求 4.1、需求 5
  - 对应设计：`design.md` §3.10

- [x] 4.3 适配 Android 公共契约和已有功能
  - 状态：DONE
  - 这一步到底做什么：让 OutcomeGo Android 适配新的 routine、memory、draft、question、computer 和 plugin contracts。
  - 做完你能看到什么：Android 可以连接同步后的 Server，同时保留实时语音、网络出口、Webhook、更新和 Instructions 兼容。
  - 先依赖：3.6
  - 开始前先看：`design.md` §3.11、`apps/android/README.md`、`AGENTS.md` Android Debug Packaging。
  - 主要改哪里：`apps/android`、`mobile/shared`、shared contracts and fixtures。
  - 这一步先不做什么：不自动移植桌面专属 ScreenBot/Keyboard UI，不删除 Instructions。
  - 怎么算完成：Android compile/tests and protocol compatibility checks pass。
  - 怎么验证：Android package tests and `bash scripts/android/package-debug.sh`。
  - 对应需求：`requirements.md` 需求 4.3、需求 5
  - 对应设计：`design.md` §3.11、§7.3

### 阶段检查

- [x] 4.4 客户端阶段检查
  - 状态：DONE
  - 这一步到底做什么：确认三端对公共状态、身份和版本资源的处理一致。
  - 做完你能看到什么：可以进入插件、文档和最终构建验证。
  - 先依赖：4.1、4.2、4.3
  - 开始前先看：本 Spec 客户端章节。
  - 主要改哪里：各端 fixture、资源和任务记录。
  - 这一步先不做什么：不发布正式客户端。
  - 怎么算完成：Desktop/iOS/Android 关键路径和身份检查通过。
  - 怎么验证：客户端局部测试、构建和人工走查。
  - 对应需求：需求 4、需求 5
  - 对应设计：`design.md` §3.9、§3.10、§3.11、§6.3

## 阶段 5：插件、文档和发布准备

- [x] 5.1 合并上游插件和第三方资源
  - 状态：DONE
  - 这一步到底做什么：逐插件接入 T3 Code、OpenStreetMap、Google Maps、WhatsApp、Signal、Ramp 和相关修复。
  - 做完你能看到什么：Marketplace、manifest、权限、图标、README 和测试彼此一致。
  - 先依赖：3.6、4.4
  - 开始前先看：`design.md` §3.12。
  - 主要改哪里：`packages/plugins`、`packages/plugin-sdk`、Server plugin services、plugin docs。
  - 这一步先不做什么：不自动启用需要额外凭据或外部服务的连接。
  - 怎么算完成：每个插件都有 adopted/adapted/deferred 决策和测试结果。
  - 怎么验证：plugin package tests、manifest/resource checks。
  - 对应需求：`requirements.md` 需求 4.2
  - 对应设计：`design.md` §3.12

- [x] 5.2 更新 OutcomeGo 功能文档和同步记录
  - 状态：DONE
  - 这一步到底做什么：把采用的上游能力写入中文文档，把保留和暂缓差异写入同步记录。
  - 做完你能看到什么：用户文档描述当前 OutcomeGo 行为，维护者能查到上游来源和分歧原因。
  - 先依赖：5.1
  - 开始前先看：父 Spec 文档规则、`FORK.md`、`docs/`。
  - 主要改哪里：`docs`、`README.md`、`FORK.md`、`specs/007.1-同步上游0.0.19/docs/`。
  - 这一步先不做什么：不写未验证功能，不发布版本说明。
  - 怎么算完成：文档无上游品牌误导，功能和限制与代码一致。
  - 怎么验证：文档走查、链接检查、品牌扫描。
  - 对应需求：`requirements.md` 需求 4、需求 6
  - 对应设计：`design.md` §3.12、§7.4

- [x] 5.3 完成全量同步验证
  - 状态：DONE
  - 这一步到底做什么：执行静态、契约、数据库、包级、构建和 Android packaging 门槛。
  - 做完你能看到什么：集成分支是否可合并有明确结论。
  - 先依赖：5.1、5.2
  - 开始前先看：`design.md` §7。
  - 主要改哪里：验证输出、任务状态和补充文档。
  - 这一步先不做什么：不启动开发服务器，不发布 npm 或 Release。
  - 怎么算完成：必需检查通过，失败项有状态和原因。
  - 怎么验证：完整验证矩阵；Android 使用项目脚本并记录 APK SHA-256。
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §7

- [x] 5.4 形成待审查的 merge commit
  - 状态：DONE
  - 这一步到底做什么：在所有门槛通过后创建中文提交消息的 merge commit，并记录上游 head 和分歧。
  - 做完你能看到什么：一个可以审查和回滚的同步结果。
  - 先依赖：5.3
  - 开始前先看：`AGENTS.md` Git Commit Messages、父 Spec 最终检查。
  - 主要改哪里：集成分支、同步记录。
  - 这一步先不做什么：不推送、不创建 tag、不发布。
  - 怎么算完成：merge commit 包含完整父提交和验证摘要。
  - 怎么验证：`git show --stat`、`git status`、版本和身份扫描。
  - 对应需求：`requirements.md` 需求 1、需求 6
  - 对应设计：`design.md` §2、§7

### 最终检查

- [x] 5.5 Spec 007.1 最终检查点
  - 状态：DONE
  - 这一步到底做什么：逐项核对需求、设计、任务、代码、验证和 intentional divergence。
  - 做完你能看到什么：可以向父 Spec 回报本次 0.0.19 同步是否完成。
  - 先依赖：5.3、5.4
  - 开始前先看：本 Spec 全部文件、`docs/`、冲突清单。
  - 主要改哪里：任务状态、同步决策记录和版本说明草稿。
  - 这一步先不做什么：不追加新上游功能。
  - 怎么算完成：所有任务为 DONE、DEFERRED 或 BLOCKED，且每项有证据。
  - 怎么验证：按需求到设计、任务、验证映射逐项检查。
  - 对应需求：全部需求
  - 对应设计：`design.md` 全文
