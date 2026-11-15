# Spec 007.1：同步上游 0.0.19

状态：COMPLETE（补丁待分批提交）

本 Spec 是 Spec 007 的当前执行子规格，目标是把上游 `main` 截止 `fd32377bf` 的 `0.0.19` 候选状态合并到 OutcomeGo 产品分支，同时保留 OutcomeGo 的产品身份、数据库映射、独立版本线和已实现功能。

当前基线：

- 上游：`upstream/main`，`fd32377bf`，2026 年 11 月 14 日。
- OutcomeGo：`afd276ed9`，2026 年 11 月 15 日。
- 共同祖先：`6af6444c6be3b31588180ccca8518e2a5aa35436`，另有两个历史共同祖先需要在合并记录中保留。
- 上游相对 `origin/main`：88 个提交。
- 上游相对 `OutcomeGo`：122 个上游独有提交；OutcomeGo 有 322 个 fork 独有提交。
- 合并预览：272 个冲突文件。

同步结果：

- 最终 merge commit：`22a47c80e`，父提交为 `afd276ed9` 和 `fd32377bf`。
- 同步后 `OutcomeGo` 相对 `upstream/main`：0 个上游独有提交。
- 同步后工作树干净，完整合并结果已快进到 `OutcomeGo` 分支；未推送远程。
- 验证基线：全仓 15 个包类型检查通过；Server 667 pass/338 skip/0 fail；Messaging 292 pass/217 skip/0 fail；Worker 133 pass/89 skip/0 fail；Desktop 703 pass/2 skip/0 fail；Computer 1301 pass/72 skip/0 fail。

文档关系：

- 父规格：[`../007-上游主分支同步/README.md`](../007-上游主分支同步/README.md)
- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- 补充文档：[`docs/README.md`](docs/README.md)
- 本轮复核：[`docs/20261115-冲突清单.md`](docs/20261115-冲突清单.md)、[`docs/20261115-同步决策记录.md`](docs/20261115-同步决策记录.md)、[`docs/20261115-验证证据索引.md`](docs/20261115-验证证据索引.md)
