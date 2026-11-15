# 规格文档：Android 客户端极简玻璃态 UI 重构

规格编号：`001.1`

状态：Done

日期：2026 年 11 月 15 日

本 Spec 为 `001-KMP移动核心与Android客户端` 的子规格，专注于在不改变任何既有业务能力、KMP 共享核心逻辑、接口契约及自动化测试 `testTag` 兼容性的前提下，对 Android 客户端（`apps/android`）进行彻底的视觉与交互重构。

## 设计方向

- **极致极简主义（Ultra-Minimalist）**：参考 Gemini App 与 ChatGPT App 的高留白聚焦画布（Focus Canvas）、低视觉噪音层级、清晰的排版韵律与直觉化的单手操作重心。
- **未来感空间玻璃（Vision Pro Futuristic Glass）**：构建自适应深/浅双模式的“空间玻璃”设计系统，包含分层半透明磨砂底色、1px 镜面高光描边（Specular Rim）、柔和环境光晕（Ambient Glow）、边缘渐隐遮罩与 Android 12+（API 31+）原生模糊渲染（API 26–30 优雅降级）。
- **直觉物理动效与触觉协同**：以 Spring 弹簧物理动画、景深空间转场、流式消息入场、语音呼吸光环及 `AndroidHaptics` 精细触觉反馈，打造连贯跟手的操作体验。

## 与 Spec 001 的关系

- Spec `001` 定义的 `mobile/shared` KMP 共享核心、`AppViewModel` 状态流、`HttpMobileGateway` / `LiveFeatureGateway`、推送与深链、`androidTest` 验收契约保持不变。
- Spec `001.1` 仅重构 Android 表现层（`com.outcomego.android.ui` 与 `com.outcomego.features` 中的 UI 组合逻辑、视觉 Token、动效与组件拆分），完整保留全部 21 个导航路由与功能入口。

## 文档索引

- `requirements.md`：重构目标、范围边界、功能保留约束、视觉/动效/无障碍需求与验收标准。
- `design.md`：空间玻璃设计系统（Design System）、双模式色彩与材质规范、API 26+ 模糊兼容方案、动效物理参数、模块拆分架构、兼容性与验证映射。
- `tasks.md`：分阶段可执行的改造任务清单（设计系统 -> 核心画布 -> 对话与语音 -> 功能设置页 -> 代码拆分与全量回归验证）。
- `docs/README.md`：补充设计说明与验收记录目录。
