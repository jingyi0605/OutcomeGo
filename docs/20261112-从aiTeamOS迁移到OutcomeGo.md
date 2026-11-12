# 从 aiTeamOS 迁移到 OutcomeGo

日期：2026 年 11 月 12 日

OutcomeGo (formerly aiTeamOS), an independent fork of OpenTeam, not affiliated with or endorsed by upstream.
本项目继续保留 OpenTeam 的上游归属说明、GPL-3.0-only 许可和第三方许可文件。

## 用户能看到的变化

- Desktop、Android、iOS Release、CLI 帮助、安装器、README、下载页和服务端提示使用 OutcomeGo。
- iOS Debug 构建显示为 OutcomeGo Dev，便于与 Release 构建区分。
- CLI 新安装使用 `outcomego` 规范命令；`aiteamos` 作为调用同一 binary 的命令名兼容入口。两者不共享旧配置/data identity；保留数据需手动备份再导入新实例。
- 本地候选版本从 `0.1.0-beta.13` 更新到 `0.1.0-beta.14`；beta.14 尚未发布，GitHub 最新正式 Release 仍为 beta.13。

## 新实例使用的内部身份

本次负责人决定不要求旧安装覆盖升级。新实例全面使用 OutcomeGo 对应身份：

- Bun 根包和 workspace 使用 `outcomego`、`@outcomego/*`。
- CLI、Compose、镜像、环境变量、数据目录、Desktop artifact、Android/iOS 身份和 URL scheme 使用 `outcomego` 对应名称。
- Prisma 物理表、索引和约束使用 `outcomego_*` 映射；应用层领域模型 API 保持可读的模型名。
- `OpenTeam` attribution、GPL 文本和 `openteam` 上游协议边界继续保留。

旧名称只在迁移输入映射和历史说明中出现。完整分类见 [name-inventory.md](../specs/004.1-项目更名与下一版本发布/docs/name-inventory.md)。

## 安装、数据和回滚

OutcomeGo 不提供旧安装原地升级，也不会把旧数据库字段改造成新字段。新安装使用当前 Prisma/raw schema 的完整字段集；数据库部署会核对 schema 指纹，不匹配时要求新建数据库。需要保留的数据由用户先手动备份，只有符合 `outcomego-v1` 的备份才由校验器接受，再导入新实例。Desktop `userData` 按固定决定使用 `aiTeamOS` 路径。

CI 已添加空库 schema 初始化和指纹不匹配拒绝测试，仍待 GitHub runner 执行。Android beta.14 release APK 已在本机签名并校验，更新清单私钥已轮换并更新到 GitHub secret；macOS arm64 beta.14 DMG/ZIP 已 Developer ID 签名、公证并通过 Gatekeeper 验证。beta.14 尚未发布。Windows 按 beta.13 方式生成未签名安装包；iOS distribution signing 按决定延期。真实设备安装和导入验收仍待执行。

发生导入问题时，按隔离环境的运维手册重新创建新 OutcomeGo 实例，再从未修改的源备份重试；不要直接删除任何已有实例或源备份。GitHub 仓库已更名为 `https://github.com/jingyi0605/OutcomeGo`，fork 默认分支正在从 `ai-TeamOS` 切换到 `OutcomeGo`；上游同步分支 `main` 不变。beta.14 尚未发布；本地 installer、README、工作流和源码修正需推送并由 GitHub runner 验证。beta.13 Release 留作旧身份历史发布，其安装器命令和 Full Changelog 链接仍引用旧 slug。

当前 README 中的安装命令使用 GitHub `releases/latest`，截至本说明日期会下载 beta.13 旧身份构建。beta.14 发布之前，请在 [Releases 页面](https://github.com/jingyi0605/OutcomeGo/releases)确认具体版本，不要将 `latest` 当作 beta.14 下载入口。
