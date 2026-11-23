# Spec 012：桌面端一键本地部署

状态：Draft

本 Spec 让 Windows 与 macOS 上的 OutcomeGo 桌面端可以在两种方式中任选其一：连接已有的远程服务器，或在这台电脑上一键部署服务端。Linux 桌面端和服务器继续使用 Docker Engine。

背景：当前本地部署要求用户先在终端安装 Docker Desktop，再粘贴 `curl | sh` 或 `install.ps1`。Windows 上 Docker Desktop 依赖 WSL2，对普通用户门槛高。桌面端已经内置 CLI 并能识别本机安装，但缺少“在这台电脑部署”的动作，也缺少 Docker 之外的容器引擎。

主文档：

- [需求文档](requirements.md)
- [设计文档](design.md)
- [任务清单](tasks.md)
- [补充文档目录](docs/README.md)

## 一页摘要

- **用户看到的变化：** 欢迎页和“设置 → 服务器”提供“连接已有服务器”与“在这台电脑部署”；部署过程在应用内显示进度，不再需要终端。
- **核心设计：** CLI 新增“引擎提供者”抽象和非交互的 `bootstrap` 命令，桌面端只负责触发、展示进度、衔接登录。引擎分两类：`external`（用户已有的 Docker 兼容引擎）和 `managed`（由 OutcomeGo 托管：Windows 用私有 WSL2 发行版，macOS 用 Apple Virtualization 虚拟机）。
- **后台常驻：** Windows 与 macOS 桌面端都有托盘图标（macOS 菜单栏、Windows 任务栏通知区域），关闭窗口不退出应用，本地服务默认继续运行。这会改变 Windows 现有的“关窗即退出”行为，对所有 Windows 用户生效。
- **支持范围：** Windows 只支持 x64；托管引擎最低 Windows 10 22H2（build 19045）或 Windows 11 23H2（build 22631）、macOS 13.5。低于下限仍可使用已有引擎或远程服务器。
- **不变的部分：** `deploy/compose.yaml` 的服务拓扑、Linux 部署方式、现有交互式 CLI 行为、远程服务器连接流程。

## 里程碑

| 里程碑 | 包含阶段 | 验收标志 |
| --- | --- | --- |
| M1 | 阶段 2、阶段 3 | 已装 Docker 兼容引擎的 Windows 与 macOS 上，桌面端点一次按钮即可部署并登录，全程无需终端 |
| M2 | 阶段 4 | 仅有 WSL 能力、没装 Docker 的干净 Windows 11 上同样可用 |
| M3 | 阶段 5 | 没装 Docker 的 macOS 上同样可用 |

阶段 1 是前置验证（Spike），其结论决定 M2、M3 是否进入实现，见 `design.md` §8.2。M1 只依赖其中的任务 1.7（CLI 载体与更新代理），不等待其他 Spike。

## 当前状态

- 已完成：需求、设计、任务和补充文档。
- 已决定（2026-11-23）：关闭桌面端默认保持本地服务运行；Windows 与 macOS 都有托盘图标且关窗不退出；只支持 Windows x64；托管引擎最低 macOS 13.5。
- 待法务确认：第三方组件许可证，见《许可证评估与建议》§6，确认前不得公开发布托管引擎资产。
- 未开始：全部实现任务。本 Spec 创建时没有修改任何业务代码。
- 待验证：托管引擎能否运行 `computer` 容器等关键假设，见 `design.md` §8 与 `tasks.md` 阶段 1。
