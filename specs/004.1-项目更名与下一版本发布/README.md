# Spec 004.1：项目更名与下一版本发布

规格编号：`004.1`

状态：草案

日期：2026 年 11 月 11 日。

父规格：[Spec 004：OutcomeGo 整体项目](../004-OutcomeGo整体项目/README.md)

本 Spec 是 OutcomeGo 项目的第一阶段。目标是在下一版本启用 OutcomeGo 用户可见名称，并完成项目内部身份、数据库物理命名和平台命名的全量切换。

2026 年 11 月 12 日负责人补充决定：不要求旧安装原地升级，也不实现旧数据库字段到新字段的转换。新版本直接从包含全部最新字段的单一 OutcomeGo schema 初始化；用户如需保留数据，先手动备份，再由后续运行手册完成外部导入。

本阶段先完成项目更名和全量内部命名，再进入 `004.2` 的产品能力开发。

文档：

- `requirements.md`：更名、全量内部命名和发布需求。
- `design.md`：品牌层级、迁移矩阵、发布和回滚设计。
- `tasks.md`：审计、修改、构建、升级测试和发布任务。

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)

## 实施结果

本阶段的交付是可验证的 OutcomeGo 下一版本本地候选。实现者必须先完成名称命中盘点，再按品牌层、分发层、内部标识层分别处理。`openteam` 代表上游和运行时身份，不能作为 OutcomeGo 品牌字符串全局替换。

当前已知基线：

- 根版本为 `0.1.0-beta.14`，由 `scripts/release/version.ts` 统一检查。
- CLI 默认仓库位于 `apps/cli/src/constants.ts`，配置目标为 `jingyi0605/OutcomeGo`；规范命令为 `outcomego`，安装器的 `aiteamos` 命令名调用同一 binary。GitHub 仓库和 fork 默认分支均使用 `OutcomeGo`；上游同步分支 `main` 保持不变。
- Desktop 的产品名、可执行名和 `dev.outcomego.desktop` 位于 `apps/desktop/package.json`；安装包前缀暂保留 `aiTeamOS-*`，因为没有 beta.13 updater fixture 证明改名前缀后的更新元数据仍可解析。`userData` 路径按固定标识保留为 `aiTeamOS`，并在启动早期显式固定。
- Android 用户可见名称在 `AndroidManifest.xml`，beta.14 正式包 ID 为 `com.outcomego.android`，源码 namespace 为 `com.outcomego.android`；不要求旧包覆盖升级。签名 APK 已本地构建，Android update manifest 私钥已轮换并通过签名验证，见 `docs/signing-builds.md`。
- iOS Release bundle ID/APNs/extension 属于新安装身份配置；显示名是 `OutcomeGo`，Debug 是 `OutcomeGo Dev`。商店签名和设备迁移另行验收。
- Compose、CI、Release Workflow 和服务端镜像使用新的 `outcomego` 运行标识；稳定 GHCR 镜像路径为 `ghcr.io/jingyi0605/ai-teamos`，另有 `OUTCOMEGO_*` 环境变量、保留的 Postgres LISTEN 通道 `aiteamos_events` 和新的 `outcomego://` URL scheme。
- iOS 发布显示名由 `apps/ios/scripts/generate-project.py` 生成为 `OutcomeGo`，Debug 名称为 `OutcomeGo Dev`。

退出条件：下一版本的本地候选、CLI、Desktop、Android、iOS 和文档用户可见名称统一为 OutcomeGo；当前 schema、平台身份和运行时内部标识完成全量命名。按固定决策保留 `aiTeamOS` Desktop `userData`、`aiteamos_events` 和 GHCR `ai-teamos` package path。尚未完成的完整候选、真实设备的新实例与手动备份导入、GitHub runner 和名称法律核查均明确为 BLOCKED/PENDING；Windows 沿用 beta.13 未签名方式，Android updater 私钥已轮换，iOS 发布延期。beta.14 尚未发布，推送与默认分支切换待本次执行。
