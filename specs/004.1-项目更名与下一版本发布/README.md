# Spec 004.1：项目更名与下一版本发布

规格编号：`004.1`

状态：草案

日期：2026 年 11 月 11 日。

父规格：[Spec 004：OutcomeGo 整体项目](../004-OutcomeGo整体项目/README.md)

本 Spec 是 OutcomeGo 项目的第一阶段。目标是在下一版本启用 OutcomeGo 用户可见名称，同时保留已有用户数据、登录、运行能力、更新链路和签名兼容性。

本阶段先完成项目更名，再进入 `004.2` 的产品能力开发。

文档：

- `requirements.md`：更名、兼容和发布需求。
- `design.md`：品牌层级、迁移矩阵、发布和回滚设计。
- `tasks.md`：审计、修改、构建、升级测试和发布任务。

文档导航：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档](docs/README.md)

## 实施结果

本阶段的交付不是把字符串替换成新名字，而是交付一个可升级的 OutcomeGo 下一版本。实现者必须先完成名称命中盘点，再按品牌层、分发层、内部标识层分别处理。`openteam` 代表上游和运行时身份，不能作为 OutcomeGo 品牌字符串全局替换。

当前已知基线：

- 根版本为 `0.1.0-beta.13`，下一版本必须由 `scripts/release/version.ts` 统一设置。
- CLI 默认仓库位于 `apps/cli/src/constants.ts`，当前为 `jingyi0605/ai-TeamOS`。
- Desktop 的产品名、可执行名、安装包名和 `dev.aiteamos.desktop` 位于 `apps/desktop/package.json`。
- Android 用户可见名称在 `AndroidManifest.xml`，正式包 ID 当前为 `com.teambots.android`，源码 namespace 为 `com.aiteamos.android`。
- iOS Release 标识位于 `apps/ios/release.json`，不能因为显示名变化而直接破坏签名和升级。
- Compose、CI、Release Workflow 和服务端镜像仍有大量 `aiteamos` 运行标识，必须分类处理，包括 GHCR 镜像路径 `ghcr.io/jingyi0605/ai-teamos`、约 219 个 `AITEAMOS_*` 环境变量、LISTEN 通道 `aiteamos_events` 和 `aiteamos://` URL scheme。
- iOS 发布显示名当前仍为 `OpenTeam`（`apps/ios/scripts/generate-project.py`）。

退出条件：下一版本安装包、服务器安装器、CLI、Desktop、Android 和 iOS 的用户可见名称统一为 OutcomeGo；旧版本升级、历史数据、签名和更新链路均有记录；未处理的内部标识有明确保留原因或迁移任务。
