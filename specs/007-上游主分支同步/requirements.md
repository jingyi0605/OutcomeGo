# 需求文档 - 上游主分支同步

状态：COMPLETE

文档关系：

- 总览：[`README.md`](README.md)
- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- 当前版本子规格：[`../007.1-同步上游0.0.19/requirements.md`](../007.1-同步上游0.0.19/requirements.md)

## 简介

OutcomeGo 是基于 OpenTeam 的独立 fork，已经形成自己的产品名称、数据库物理表名、版本线、Android/iOS 身份、网络出口、实时语音、凭据插件、Webhook 和移动端实现。上游继续快速演进，直接合并会同时触及运行时、数据库、Desktop、iOS、Android、插件和发布文件。

当前已知事实是：`origin/main` 可以从上游快进 88 个提交；真正的产品分支 `OutcomeGo` 与上游发生了大规模分叉。若没有统一的冲突分类和逐项验收，直接合并容易覆盖 fork 功能、破坏 `outcomego_*` 数据库映射，或把上游的删除性变更错误应用到 Android 和现有用户数据。

## 术语表

- **System**：OutcomeGo 工作区及其 Desktop、Server、Worker、Computer、Android、iOS、插件和发布资产。
- **Upstream**：`https://github.com/raghavpillai/openteam.git` 的 `main` 分支。
- **Fork source branch**：`OutcomeGo`，当前 fork 的默认产品分支。
- **Mirror branch**：`main`，只用于跟踪上游的镜像分支。
- **Upstream sync**：把上游提交合并到 fork source branch，同时保留 OutcomeGo 的身份和已批准的 fork 功能。
- **Intentional divergence**：明确决定保留 fork 行为、拒绝上游行为或需要延后迁移的差异，必须记录原因和后续复核点。

## 范围说明

### In Scope

- 建立上游、镜像分支和 OutcomeGo 产品分支的可重复比较方法。
- 将上游提交按功能、数据库、协议、客户端、插件、文档和发布资产分类。
- 按模块给出冲突解决方案和优先级，避免用无差别的全局替换解决品牌冲突。
- 使用子规格执行当前 `0.0.19` 上游同步，并保留 OutcomeGo 的独立版本和身份。
- 对数据库升级、协议兼容、客户端行为、构建、测试和发布资产建立验收门槛。

### Out of Scope

- 不把 OutcomeGo 改回 OpenTeam 产品身份。
- 不直接采用上游版本号覆盖 OutcomeGo 自己的版本线。
- 不在没有独立规格和移动端验收的情况下删除 OutcomeGo 已有功能。
- 不在同步过程中启动开发服务器、修改远程 Debug 环境或推送发布资产。

## 需求

### 需求 1：建立同步基线

**用户故事：** 作为维护者，我希望每次同步都能从明确的提交、分支和版本开始，以便结果可以复核和回滚。

#### 验收标准

1. WHEN 开始一次同步 THEN System SHALL 记录 `upstream/main`、`origin/main`、`OutcomeGo`、共同祖先、提交计数和工作树状态。
2. WHEN 同步目标发生变化 THEN System SHALL 重新生成上游独有、fork 独有和补丁等价提交清单。
3. WHEN 发现本地工作树存在用户改动 THEN System SHALL 保留改动并停止会覆盖它们的操作。

### 需求 2：形成上游功能清单

**用户故事：** 作为产品和工程维护者，我希望知道上游每组提交增加了什么能力，以便按价值而不是按提交顺序决定取舍。

#### 验收标准

1. WHEN 读取上游独有提交 THEN System SHALL 将其归入运行时可靠性、例程、记忆、草稿与问题卡、Computer、Desktop、iOS、Android、插件、文档或发布资产。
2. WHEN 一组上游提交与 OutcomeGo 已有实现重叠 THEN System SHALL 记录对应的 fork 实现和保留策略。
3. WHEN 上游提交包含删除、迁移或版本身份变化 THEN System SHALL 标注为兼容性决策，不得自动视为普通代码冲突。

### 需求 3：逐项解决合并冲突

**用户故事：** 作为工程维护者，我希望每个冲突文件都有明确的优先级和解决方法，以便合并结果能说明为什么这样取舍。

#### 验收标准

1. WHEN 合并预览产生冲突 THEN System SHALL 按数据库、契约与运行时、平台客户端、插件、文档和发布资产分组。
2. WHEN 冲突涉及产品身份、物理表名、包名、URL scheme 或版本线 THEN System SHALL 以 OutcomeGo 身份清单为准，并逐项迁移上游行为。
3. WHEN 冲突涉及公共协议、数据一致性或安全边界 THEN System SHALL 优先保留更严格且有测试证据的一方，并补充兼容测试。
4. WHEN 冲突无法在当前版本安全解决 THEN System SHALL 将其记录为 `Intentional divergence`，附带原因、影响和后续任务。

### 需求 4：完成当前版本同步

**用户故事：** 作为 OutcomeGo 用户，我希望获得上游 `0.0.19` 的可靠性和功能改进，同时继续使用 OutcomeGo 的产品功能和数据。

#### 验收标准

1. WHEN 执行 `spec007.1` THEN System SHALL 合并上游 `main` 的目标功能，并保留 OutcomeGo 的 Android、实时语音、网络出口、凭据插件、Webhook、品牌和版本线。
2. WHEN 数据库从已有 OutcomeGo 安装升级 THEN System SHALL 使用 `outcomego_*` 表和索引完成幂等升级，不丢失未迁移数据。
3. WHEN Desktop、iOS 或 Android 使用受影响的 API THEN System SHALL 通过契约、客户端测试和必要的回归检查确认行为一致。
4. WHEN 上游行为与 OutcomeGo 明确冲突 THEN System SHALL 在 Spec 中记录最终决策，不留下未解释的手工冲突结果。

### 需求 5：完成分层验证

**用户故事：** 作为发布维护者，我希望同步结果有足够的验证证据，以便判断是否能进入下一版发布。

#### 验收标准

1. WHEN 代码冲突全部解决 THEN System SHALL 通过格式、类型、受影响包测试和构建检查。
2. WHEN 涉及数据库或协议 THEN System SHALL 执行升级回放、兼容性检查和失败恢复验证。
3. WHEN 涉及 Android 发布资产 THEN System SHALL 按项目规则使用 `bash scripts/android/package-debug.sh`，并报告 APK 绝对路径和 SHA-256。
4. WHEN 所有验收门槛完成 THEN System SHALL 回写任务状态、保留验证输出入口并生成同步决策记录。

## 非功能需求

### 非功能需求 1：可回滚性

1. 同步必须在独立分支或临时 worktree 中进行，不直接破坏 `OutcomeGo` 工作树。
2. 合并采用保留历史的 merge 方式，不对 fork source branch 做 rebase。
3. 每个阶段结束时必须能通过提交、补丁或临时 worktree 回到阶段前状态。

### 非功能需求 2：兼容性

1. OutcomeGo 的 `outcomego_*` 数据库映射、`com.outcomego.android`、URL scheme、发布身份和版本线必须保持一致。
2. 上游删除性迁移必须有旧安装回放和明确的数据保留策略。
3. 公共协议变更必须同时检查 Server、Worker、Computer、Desktop、Android 和 iOS。

### 非功能需求 3：可维护性

1. 冲突解决结果必须引用文件路径、上游提交、需求和设计章节。
2. 不使用全局品牌替换代替逐项身份迁移。
3. 每次同步都能复用本 Spec 的基线、分类、验证和记录格式。

## 成功定义

- `main` 镜像与 `upstream/main` 完成同步，且不携带 fork 产品提交。
- `OutcomeGo` 完成当前 `0.0.19` 上游同步，或者所有未完成差异都被记录为有理由的 `Intentional divergence`。
- 上游新增的高价值可靠性、例程、记忆、草稿、问题卡、附件和 Computer 能力通过适配后保留。
- OutcomeGo 的身份、数据库、移动端、实时语音、网络出口、Webhook、凭据插件和版本线未被错误覆盖。
- 需求、设计、任务和验证证据逐项可追踪。
