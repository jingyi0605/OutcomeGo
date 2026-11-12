# 变更记录

## 0.1.0-beta.14

### 项目更名与全量内部迁移

- 用户可见产品名称改为 OutcomeGo，并在 README、FORK、CLI、Desktop、Android、iOS、安装器和应用内文案中同步更新。
- README 和 FORK 说明 OutcomeGo (formerly aiTeamOS) 是 OpenTeam 的独立 Fork，不代表上游背书；GPL-3.0-only、版权和上游归属说明继续保留。
- 新安装使用 `outcomego`，不要求旧安装覆盖升级；仓库只校验符合 `outcomego-v1` 的手动备份，旧数据库字段和旧表名由用户在外部流程处理。
- Bun workspace、Compose、环境变量、Desktop artifact、Android/iOS 身份和 URL scheme 全部切换到 OutcomeGo 对应身份。
- Prisma 物理表、索引和约束使用 `outcomego_*` 映射；OpenTeam attribution、GPL 文本和 `openteam` 上游边界继续保留。
- iOS Release 显示名为 OutcomeGo，Debug 显示名为 OutcomeGo Dev。

### 版本

- 根工作区、workspace、lockfile、iOS 基础版本和 Android debug 包统一为 `0.1.0-beta.14`。
- 本版本只完成本地构建和验证，不创建 tag、GitHub Release、签名候选资产或设备升级记录。
