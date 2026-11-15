# Spec 007：上游主分支同步

状态：COMPLETE

本 Spec 负责把 OutcomeGo 与上游 `openteam/main` 的同步工作变成一套可追踪、可回滚、可验收的长期流程。当前基线为 2026 年 11 月 15 日：

- `upstream/main`：`fd32377bf`，上游 `0.0.19` 候选状态。
- `origin/main`：`8289259d6`，比 `upstream/main` 少 88 个提交，没有 fork 独有提交。
- `OutcomeGo`：`afd276ed9`，相对 `upstream/main` 有 322 个 fork 独有提交和 122 个上游独有提交。
- `OutcomeGo` 与 `upstream/main` 的合并预览报告 272 个冲突文件。

同步完成后的进度基线：

- 同步 merge head：`22a47c80e`，提交消息为 `修复：完成上游 0.0.19 同步`。
- 合并父提交：`afd276ed9`（OutcomeGo）和 `fd32377bf`（`upstream/main`）。
- `OutcomeGo` 相对 `upstream/main`：0 个上游独有提交；同步 merge 相对 `origin/OutcomeGo`：134 个本地提交。
- 当前工作树无未解决冲突，Server、Messaging 和全仓类型检查已通过。

本 Spec 维护长期策略、分阶段计划、冲突分类和验收门槛。针对当前上游 `0.0.19` 的具体实现拆分为子规格 [`specs/007.1-同步上游0.0.19/`](../007.1-同步上游0.0.19/)。

文档关系：

- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- 当前版本子规格：[`../007.1-同步上游0.0.19/README.md`](../007.1-同步上游0.0.19/README.md)
- Spec 模板：[`../000-Spec规范/Spec模板/`](../000-Spec规范/Spec模板/)
