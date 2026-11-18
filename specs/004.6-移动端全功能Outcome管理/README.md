# Spec 004.6：移动端全功能 Outcome 管理

本 Spec 定义了 Android 端（含 KMP `mobile/shared` 核心层）全功能 Outcome 管理工作台的完整需求、架构设计与实施任务。

## 背景与目标

- **现状**：目前移动端 Outcome 仅支持收件箱、列表、详情的只读查看以及决策（Decision）提交，核心生命周期操作（规划、创建、修订、批准、运行、取消、验收、返工、人工动作执行与回执、探索想法）均提示“请在 Desktop 完成”。
- **目标**：参考 Desktop 端 Outcome 管理工作台（`OutcomeWorkspace`）的信息架构与全功能能力，在 Android 端以移动端极简玻璃态（Spatial Glass）风格实现全功能 Outcome 工作台，并在 Bot 列表页支持**左滑呼出、右滑返回 Bot 列表**的对称抽屉交互（与设置页右滑呼出、左滑返回保持一致）。

## 文档导航

- [需求文档](requirements.md)：业务背景、范围边界、7 项核心功能需求与非功能需求
- [设计文档](design.md)：KMP 共享层模型/API 扩展、Android 抽屉交互与转场动画、工作台与子页面设计
- [任务清单](tasks.md)：分阶段可追踪实施计划与验证方式
- [补充文档](docs/README.md)：接口与联调记录目录
