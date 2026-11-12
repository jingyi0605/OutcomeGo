# 上游同步演练

演练日期：2026 年 11 月 12 日

## 范围和限制

- 目标是本地检查从 `main` 到 `OutcomeGo` 的同步风险。
- 使用临时 worktree 和临时分支；不修改当前分支的提交，不修改 `main`，不推送。
- 未携带真实用户目录、密钥、远程凭据或发布资产。

## 结果

状态：DONE（本地演练）。

当前已知风险集中在：

- README、FORK、公开文档和迁移说明中的用户可见品牌。
- CLI、Desktop、Android、iOS 的显示名和发布文案。
- Release workflow 标题与 Android 资产显示名。
- Desktop artifact 前缀和图标路径保持现有值；`userData=aiTeamOS`、Postgres channel `aiteamos_events` 和 GHCR `ai-teamos` 按固定清单保留，其他获批的新 `outcomego` 运行身份属于品牌迁移。

## 实际执行结果

- 临时 worktree：由 `OutcomeGo` 当前提交创建，临时分支名为 `spec-004.1-sync-rehearsal`。
- 合并命令：`git merge --no-commit --no-ff main`。
- 合并结果：`Already up to date.`，退出状态 0。
- 当前工作树补丁：通过 `git diff --binary HEAD | git apply --3way --index` 应用，退出状态 0。
- 冲突文件：无。
- 清理：临时 worktree 已移除；未创建提交、未修改 `main`、未推送。

这次本地演练没有发现当前 `main` 与更名补丁之间的冲突。后续真实上游同步仍需在新的上游提交出现后重跑；若冲突涉及 `openteam` runtime、协议、数据库或稳定身份，必须回到 `name-inventory.md` 分类，而不是全局替换。
