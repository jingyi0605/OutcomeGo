# Spec 005.2：钉钉个人工作区插件

状态：IN_PROGRESS

本 Spec 为 OutcomeGo 集成 DingTalk Workspace CLI（`dws`），让已授权的单个钉钉用户可以通过 OutcomeGo Bot 使用钉钉待办、消息和钉钉 Drive/文档能力。

文档关系：

- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- 补充材料：[`docs/README.md`](docs/README.md)

## 当前决策

- 使用官方开源的 DingTalk Workspace CLI `v1.0.68` 作为外部运行时。
- 采用 skills-only 插件，将 `dws` 安装、登录和产品命令说明交给 Bot Computer 执行。
- 远程 Computer 的个人授权使用 `dws auth login --device --no-browser` OAuth 设备流，用户在自己的设备上打开 verification URL 并通过钉钉扫码/确认完成授权。
- 登录态属于选定的 Bot Computer；使用 DWS portable auth bundle 和一次性 Computer 文件传输迁移到另一台支持的 Computer。
- 本 Spec 首先闭合本地插件包、CLI 安装、技能路由和只读/受控写入验证；不把钉钉账号凭据写入仓库。
