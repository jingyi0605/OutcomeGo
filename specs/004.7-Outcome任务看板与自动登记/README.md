# Spec 004.7 - Outcome 任务看板与自动登记

状态：In Progress

## 一句话

把 Outcome 当作 bot 的任务看板 / 待办：bot 在日常对话里，凡是"当场做不完"的事都自动登记为目标；不需要用户决策的由 bot 自己跟进并自动结束，需要用户决策或批准的才进入收件箱。

## 文档

- `requirements.md`：需求与验收标准
- `design.md`：设计与数据模型
- `tasks.md`：任务拆解、验证方式与回写状态

## 与相邻 Spec 的关系

- 004.2：复用契约、验收与状态派生；本 Spec 新增"跟踪型目标"，不改变标准目标的审批与验收规则。
- 004.3：复用 Decision 与收件箱；新增"无 WorkItem 的 Decision"解决路径。
- 005 / 计算机运行时：`OUTCOME_CHAT_TOOLS` 变化需要同步并重建远端 computer 容器才在 bot 侧生效。
