# 需求文档 - 同步上游 0.0.19

状态：COMPLETE

文档关系：

- 总览：[`README.md`](README.md)
- 父规格：[`../007-上游主分支同步/requirements.md`](../007-上游主分支同步/requirements.md)
- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)

## 简介

上游 `0.0.19` 在聊天删除、记忆恢复、例程调度、草稿回执、问题卡、Computer 控制、附件、模型能力、地图、ScreenBot 和插件方面增加了多组功能与可靠性修复。OutcomeGo 在共同祖先之后也加入了 Android、实时语音、网络出口、Webhook、凭据插件、网页搜索、多 provider 和品牌迁移。

本 Spec 的目标是形成一次完整但受控的 upstream merge：上游的通用可靠性和功能改进要进入 OutcomeGo；OutcomeGo 的身份、移动端和 fork 功能不能被上游文件路径或版本元数据覆盖；上游删除性变更必须有兼容决定。

## 术语表

- **System**：OutcomeGo 当前工作区。
- **Target upstream**：`upstream/main` 的 `fd32377bf`，对应上游 `0.0.19` 候选。
- **Integration branch**：从 `OutcomeGo` 创建、用于解决本次合并的临时分支。
- **Compatibility bridge**：为了保留 OutcomeGo 现有用户和客户端行为，在一个版本周期内保留旧字段、旧接口或旧映射的适配层。
- **Intentional divergence**：本次不采用上游行为，并在文档中写明原因和复核条件。

## 范围说明

### In Scope

- 将 `upstream/main` 合并到 OutcomeGo 集成分支。
- 合并并适配上游例程、记忆、草稿、问题卡、删除和 Computer 可靠性改进。
- 评估并接入上游 ScreenBot、Keyboard、maps、T3 Code、iMessage attachment、preview 和 WhatsApp 改进。
- 将上游 Server/Worker/Computer/Desktop/iOS 改动适配到 OutcomeGo 身份。
- 将公共契约、数据库升级、客户端 fixture、测试和文档同步到一致状态。
- 保留 OutcomeGo 的 Android、实时语音、网络出口、Webhook、凭据插件、网页搜索和版本发布能力。

### Out of Scope

- 不将 OutcomeGo 版本号改成上游 `0.0.19`。
- 不删除 Android 的 Bot Instructions 字段或已有用户数据；该删除变更进入分歧记录。
- 不在本 Spec 中发布 GitHub Release、npm 包、Android 正式包或 iOS TestFlight。
- 不启动开发服务器、远程 Computer 重建或真实用户数据迁移。

## 需求

### 需求 1：合并上游 0.0.19 基线

**用户故事：** 作为维护者，我希望把指定的上游 head 合并到独立集成分支，以便可以审查全部差异。

#### 验收标准

1. WHEN 创建集成分支 THEN System SHALL 从 `OutcomeGo=afd276ed9` 创建，不修改原产品分支。
2. WHEN 执行上游合并 THEN System SHALL 使用 `upstream/main=fd32377bf`，保留 merge 历史，不做 rebase。
3. WHEN 合并完成或暂停 THEN System SHALL 保存冲突路径、冲突组和每组解决决策。

### 需求 2：保留 OutcomeGo 身份和数据库

**用户故事：** 作为 OutcomeGo 用户，我希望同步后仍然使用 OutcomeGo 的应用和数据身份，以便已有安装可以继续升级和工作。

#### 验收标准

1. WHEN 合并上游发布和应用文件 THEN System SHALL 保留 OutcomeGo display name、application ID、bundle identity、URL scheme、artifact 命名和版本线。
2. WHEN 合并 Prisma 或 SQL THEN System SHALL 保留 `outcomego_*` 物理表、索引和约束映射。
3. WHEN 执行已有数据库升级 THEN System SHALL 支持空库、已有 OutcomeGo 数据库、重复执行和失败重试。
4. WHEN 上游迁移删除或改名数据字段 THEN System SHALL 在删除前明确数据保留、导出或分歧策略。

### 需求 3：接入上游可靠性和运行时功能

**用户故事：** 作为用户，我希望得到上游对例程、记忆、草稿、问题卡、删除和 Computer 的可靠性修复，以便长任务和恢复场景不丢状态。

#### 验收标准

1. WHEN 处理多 schedule routine THEN System SHALL 保留最早触发、并发去重、Webhook 并行、时区和编辑保存语义。
2. WHEN 记忆被纠正、取消或服务重启 THEN System SHALL 防止旧事实重新召回、晚到推理写入或重复 receipt。
3. WHEN draft send/discard、问题卡或消息回合跨重连和重启 THEN System SHALL 保留最终状态和正确回执。
4. WHEN 删除聊天或归档 bot THEN System SHALL 阻止旧 agent store、晚到 dispatch 和后台工作重新认领。
5. WHEN Computer 控制权、网络出口或连接发生变化 THEN System SHALL 保留 OutcomeGo 的 provider、lease、route epoch 和手动控制语义。

### 需求 4：接入选定的上游产品功能

**用户故事：** 作为产品用户，我希望获得上游中对 OutcomeGo 有价值的桌面、地图、附件和插件能力。

#### 验收标准

1. WHEN ScreenBot、Keyboard、file preview、maps、T3 Code 或 iMessage attachments 被接入 THEN System SHALL 使用 OutcomeGo 的组件、权限和文案边界。
2. WHEN 上游插件加入 marketplace THEN System SHALL 同步插件 manifest、资源、权限说明、README 和测试。
3. WHEN 上游功能需要 Android 或 iOS 支持而当前没有等价实现 THEN System SHALL 保留已有移动端功能，并记录平台差异。

### 需求 5：公共契约和客户端闭合

**用户故事：** 作为跨端维护者，我希望 Server、Worker、Computer、Desktop、iOS、Android 对同一字段使用同一语义，以便同步后不会出现单端成功、其他端崩溃。

#### 验收标准

1. WHEN 修改 routine、memory、draft、question、map、computer 或 plugin contract THEN System SHALL 更新所有生产调用方和测试 fixture。
2. WHEN 上游删除 `dismissOnMoveOn` 或 `Bot.instructions` THEN System SHALL 先检查 OutcomeGo Android 和既有 API，再执行保留、兼容或分歧决策。
3. WHEN 客户端解码未知或缺失字段 THEN System SHALL 按兼容规则处理，不能因新字段导致旧消息或旧服务器无法使用。

### 需求 6：完成同步验收

**用户故事：** 作为发布维护者，我希望在合并前得到分层验证证据，以便知道哪些功能已同步、哪些功能仍需后续处理。

#### 验收标准

1. WHEN 所有冲突解决 THEN System SHALL 通过冲突扫描、格式、类型和路径身份检查。
2. WHEN 数据库、契约或运行时被修改 THEN System SHALL 通过相关升级回放、单元测试和集成测试。
3. WHEN Android 代码或资源被修改 THEN System SHALL 使用 `bash scripts/android/package-debug.sh` 完成 debug package，并报告 APK 路径和 SHA-256。
4. WHEN 本 Spec 结束 THEN System SHALL 在 `tasks.md` 标记采用、适配、保留、暂缓和阻塞项。

## 非功能需求

### 非功能需求 1：数据安全

1. 数据库迁移不得默认删除 OutcomeGo 用户数据。
2. 凭据、token、密钥、真实用户目录和远程 `.env` 不得进入 diff、日志或 Spec。

### 非功能需求 2：可靠性

1. 合并结果必须能在空库和已有 OutcomeGo 数据库上重复执行。
2. 任何异步状态变更都必须保留 revision、lease、epoch、ownership 或等价 fencing 语义。

### 非功能需求 3：可维护性

1. 每个冲突组必须有文件范围、上游提交范围、解决策略和验证命令。
2. 代码注释、标识符和提交消息继续使用英文；本 Spec 内容使用中文。
3. 任何暂缓的上游功能都必须有后续入口，不能只留下未解决冲突。

## 成功定义

- 集成分支成功合并目标上游 head，冲突清零。
- OutcomeGo 的产品身份、数据库、版本线和 fork 功能保持正确。
- 上游高价值可靠性改进通过适配进入 OutcomeGo。
- ScreenBot、地图、T3 Code、附件和其他选定功能有明确采用或暂缓结论。
- 数据库、公共契约、桌面、iOS、Android 和插件验证证据齐全。
