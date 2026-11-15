# 需求文档 - Android 客户端极简玻璃态 UI 重构

状态：Draft

## 简介

当前 Android 客户端已通过 Spec `001` 与后续迭代完整对齐了全部业务功能，覆盖 21 个路由页面、实时语音通话、多模态附件预览、Rich Message 交互卡片、Markdown 渲染、Computer VNC 远程视图与插件/提供者设置，总计约 1.19 万行 Compose UI 代码（其中 `OutcomeGoApp.kt` 单文件达 4,955 行，`FeatureScreens.kt` 达 2,141 行）。

当前界面存在以下痛点：

- 视觉语言偏传统扁平列表与实色卡片，缺少统一的空间层次、通透感与现代 AI 应用（Gemini / ChatGPT）的沉浸式聚焦体验。
- 顶栏、底栏、输入框与列表卡片之间存在较多硬边分割与生硬切换，缺少符合人体直觉的物理弹性动效与触觉协同。
- 大量界面与样式细节硬编码在少数超大文件中，缺少统一的 Design System（设计令牌、玻璃材质容器、动效曲线与规范化组件）。

本 Spec 旨在**完整保留现有全部功能、状态流与测试兼容性**的前提下，将 Android UI 彻底重构为**极致极简主义 + Vision Pro 未来感空间玻璃（Futuristic Glass）**风格，带来媲美 Gemini / ChatGPT 客户端的视觉品质与交互手感。

## 术语表

- **System**：OutcomeGo Android 客户端（`apps/android`）。
- **Spatial Glass（空间玻璃）**：由半透明分层底色、1px 镜面高光描边、微弱环境光晕及按需模糊构成的视觉材质体系。
- **Focus Canvas（聚焦画布）**：参考 Gemini / ChatGPT 的高留白、低干扰主视觉区域，使内容本身成为绝对焦点，导航与控制栏以悬浮玻璃胶囊形态承载。
- **Design System（设计系统）**：统一管理颜色 Token、玻璃层级、圆角、排版、间距、Spring 动效参数与基础玻璃组件的独立 UI 基础层。
- **testTag 契约**：`apps/android/app/src/androidTest`（如 `PrimaryWorkflowTest`、`AndroidParitySmokeTest`）所依赖的语义测试标签及组件几何约束。

## 范围说明

### In Scope

- 建立全新的 Android 空间玻璃 Design System（含深色 Obsidian 空间玻璃与浅色 Ceramic 陶瓷雾面双模式，完整支持现有 `AppSettings.Appearance` 与 `AppSettings.Accent`）。
- 彻底重构全量 21 个路由页面及所有弹窗/浮窗/预览组件：
  - 登录引导（`LOGIN`）、会话目录（`DIRECTORY`）、对话主画布（`CHAT`）
  - 实时语音通话浮窗与迷你胶囊（`LiveVoiceView`、`REALTIME_VOICE`）
  - Bot 详情（`BOT_DETAILS`）、会话配置（`PROFILE`）、新建会话（`CREATE`）、Computer VNC（`COMPUTER`）、Marketplace（`MARKETPLACE`）
  - Routines 与编辑器（`ROUTINES`、`ROUTINE_EDITOR`）、全局设置与网络共享详情（`SETTINGS`、`NETWORK_SHARING_DETAILS`）、模型/网页搜索/语音提供者（`PROVIDERS`、`WEB_PROVIDERS`）、插件（`PLUGINS`）、账户记忆（`ACCOUNT`）
  - 发件箱（`OUTBOX`）、系统分享接收（`SHARE`）、侧边栏管理（`SIDEBAR`）、消息搜索（`MESSAGE_SEARCH`）
  - 富文本消息卡片、Markdown 渲染、附件预览（`DocumentPreview`、`AttachmentGalleryDialog`）与选择器（`DropdownPickers`）
- 引入统一的物理弹性动效、空间景深转场、滚动边缘渐隐、语音波形/呼吸光环及精细触觉联动。
- 将过度膨胀的单体 UI 文件按职责拆分为清晰模块，提升后续可维护性。

### Out of Scope

- 不修改 `mobile/shared` KMP 共享核心业务逻辑、网络协议、数据模型或服务端接口。
- 不删减、不合并、不弱化任何现有业务功能与设置项。
- 不更改 `iOS` 或 `Desktop` 客户端代码。
- 不引入需要侵入系统权限或破坏 `minSdk = 26` 编译的重型第三方 Native 模糊库（坚持纯 Compose + Android 原生 API 方案）。

## 需求

### 需求 1：全功能零丢失与测试契约兼容

**用户故事：** 作为现有 Android 用户与工程维护者，我希望 UI 彻底改版后所有既有功能、入口、本地化文案与自动化测试都能正常工作，以便不引入任何功能回归。

#### 验收标准

1. WHEN 用户访问任意既有功能（包括全部 21 个路由、语音录制与实时语音通话、多模态附件上传与预览、Rich Widget 交互、VNC 远程控制、DeepLink 与系统分享接收、应用内更新） THEN System SHALL 保持原有业务行为与数据流完整可用。
2. WHEN 执行既有单元测试与 UI 自动化测试（`PrimaryWorkflowTest`、`AndroidParitySmokeTest`、`RichMessageRendererTest`） THEN System SHALL 保留所有既有 `testTag`（如 `login-welcome-title`、`directory-title`、`conversation-*`、`composer-container`、`attach-composer`、`message-composer`、`voice-composer`、`send-message`、`chat-message-list`、`live-voice-floating-pill` 等）且继续满足 `composerCollapsesWhenUnfocusedAndSplitsWhenFocused` 的几何折叠/展开约束。
3. WHEN 用户切换 `AppSettings.Language`（中/英）、`AppSettings.Appearance`（System / Light / Dark）或 `AppSettings.Accent`（Black / Blue / Purple / Green） THEN System SHALL 实时响应并保持文字对比度符合可读性标准。

### 需求 2：极致极简与 Vision Pro 空间玻璃视觉体系

**用户故事：** 作为 Android 客户端用户，我希望应用整体呈现 Vision Pro 般的通透未来感玻璃质感与 Gemini/ChatGPT 般的极简留白美学，以便获得高级、专注且无压迫感的使用体验。

#### 验收标准

1. WHEN 界面处于浅色模式或深色模式 THEN System SHALL 提供专门调校的双模式空间玻璃色彩系统：深色模式采用深邃黑曜石基底与微弱环境光晕（Obsidian Spatial Glass），浅色模式采用极简陶瓷白画布与清透雾面浮层（Ceramic Frosted Glass），摒弃生硬的实色块与厚重分割线。
2. WHEN 渲染悬浮面板、胶囊工具栏、卡片、对话框或底部 Sheet THEN System SHALL 应用统一的空间玻璃组件规范，包含分层半透明底色、1px 线性渐变镜面高光描边（Specular Border）、柔和环境投影，并在 Android 12+（API 31+）支持原生硬件模糊渲染，在 API 26–30 自动降级为高质感半透明渐变表面。
3. WHEN 查看文字排版、列表与表单 THEN System SHALL 遵循宽松留白（呼吸感间距）、清晰字重层级与胶囊/大圆角几何语言，避免密集边框与冗余装饰元素。

### 需求 3：Gemini / ChatGPT 风格核心对话与目录体验

**用户故事：** 作为高频使用 AI 对话与多 Bot 协作的用户，我希望目录页与对话页具备现代 AI 应用的流畅体验，包括悬浮玻璃顶栏/底栏、聚焦式输入框与清晰的气泡/流式消息呈现，以便高效专注地完成任务。

#### 验收标准

1. WHEN 用户浏览会话目录（`DIRECTORY`）或消息搜索（`MESSAGE_SEARCH`） THEN System SHALL 以高留白空间卡片、悬浮玻璃搜索胶囊、柔和置顶区与边缘渐隐遮罩呈现列表，滚动时内容自然潜入悬浮玻璃顶栏与搜索栏下方。
2. WHEN 用户在对话页（`CHAT`）阅读或输入 THEN System SHALL 提供：
   - 悬浮透明玻璃顶栏（清晰展示会话头像、状态脉冲、实时语音入口与详情按钮）。
   - 无压迫感的极简消息流（AI 回复采用无框/轻盈排版配细腻 Markdown 代码块与表格卡片；用户消息采用高对比度圆润玻璃/主题色气泡；支持平滑的滚动到底部悬浮按钮）。
   - 悬浮胶囊式输入器（`ChatComposer`），在未聚焦/无草稿时保持紧凑单行胶囊，聚焦或存在草稿时平滑弹性展开为多行输入区 + 下方操作栏，并兼容引用回复与待发送附件条。
3. WHEN Bot 正在思考或执行任务（`ChannelActivity` / `FeatureOperationState.Pending`） THEN System SHALL 以现代化的灵动状态指示器（流光/脉冲呼吸动画）替代机械的文字或普通转圈提示。

### 需求 4：直觉化的物理动效、转场与触觉反馈

**用户故事：** 作为移动端用户，我希望每一次点击、页面跳转、面板展开与语音交互都具备符合直觉的物理惯性与微妙触觉，以便让界面感觉“有生命且精准”。

#### 验收标准

1. WHEN 用户点击任意可交互玻璃按钮、胶囊或列表卡片 THEN System SHALL 提供细腻的按压微缩反馈（Spring Press Scale + 光泽微变）并联动 `LocalAppHaptics` 触觉脉冲。
2. WHEN 在页面路由间导航（如 `DIRECTORY` <-> `CHAT`、`DIRECTORY` <-> `SETTINGS`、详情页与模态面板） THEN System SHALL 使用带景深微缩与透明度融合的物理空间转场（Spatial Depth Transition），替代生硬的线性平移。
3. WHEN 展开或折叠输入框、引用栏、附件条、上下文摘要或弹窗/Sheet THEN System SHALL 采用统一调校的 Spring 弹性形变与 `AnimatedContent` / `AnimatedVisibility` 过渡，无画面跳变或闪烁。

### 需求 5：实时语音、多媒体预览与全功能设置页视觉统一

**用户故事：** 作为使用实时语音通话、文档预览及各项高级设置的用户，我希望语音浮窗、VNC 视图、附件预览、Routines 与 Settings 等所有二级页面都与主页面保持一致的未来感极简设计语言。

#### 验收标准

1. WHEN 启动或最小化实时语音通话（`LiveVoiceView`） THEN System SHALL 呈现发光呼吸声纹光环（随音频能量/对话状态动态响应）、悬浮玻璃控制胶囊与可平滑拖拽/收起的迷你动态药丸（`live-voice-floating-pill`）。
2. WHEN 打开设置（`SETTINGS`）、Routines、Plugins、Providers、Bot 详情、Computer VNC、Marketplace、Memory 等页面 THEN System SHALL 统一采用极简分组玻璃卡片、内嵌微弱分隔线、精致开关/选择器（`DropdownPickers`）与一致性悬浮顶栏。
3. WHEN 预览 Markdown、Rich Message 交互卡片、图片/音视频/PDF/DOCX 附件 THEN System SHALL 采用统一的玻璃边框容器、圆润代码块、自适应表格与沉浸式全屏画廊浏览体验。

### 需求 6：UI 模块化架构重构

**用户故事：** 作为项目开发者，我希望将目前集中在 `OutcomeGoApp.kt` 与 `FeatureScreens.kt` 的庞大 UI 代码拆分为职责清晰的包与文件，以便后续迭代与多人协作。

#### 验收标准

1. WHEN 完成本次重构 THEN System SHALL 拥有独立的设计系统包（`com.outcomego.android.ui.designsystem`），集中存放 Theme、Glass Tokens、Glass Surface、Motion Spec 与基础交互原语。
2. WHEN 查找或修改特定页面（如登录、目录、对话、设置、语音） THEN System SHALL 将原本 `OutcomeGoApp.kt`（4,955 行）与 `FeatureScreens.kt`（2,141 行）中的页面拆分为独立且内聚的 Screen 文件，使单文件保持清晰可读，且不破坏既有公共函数签名或包级导入兼容性。

## 非功能需求

### 非功能需求 1：性能与渲染流畅度

1. WHEN 在主流 Android 设备上快速滑动长对话列表或会话目录 THEN System SHALL 避免因过度离屏渲染（`RenderEffect` / 大面积阴影 / 无缓存画笔）导致的掉帧，合理限制实时模糊层的数量与作用范围。
2. WHEN 界面发生重组（Recomposition） THEN System SHALL 复用 `remember` 缓存的画刷、配色与动画状态（延续 `Theme.kt` 的 `ColorScheme` 缓存原则），避免在滚动帧内频繁分配对象。

### 非功能需求 2：系统版本兼容与降级

1. WHEN 应用运行在 Android 8.0–11（API 26–30）设备 THEN System SHALL 不触发任何 API 31+ 专属模糊类缺失异常，自动回退至多层半透明渐变 + 高光描边渲染。
2. WHEN 设备开启系统“移除动画（Animator Duration Scale = 0）”或无障碍辅助功能 THEN System SHALL 保持所有交互状态可达、文本语义完整且不因动画时长为 0 而卡在中间状态。

### 非功能需求 3：可验证性与构建可靠性

1. WHEN 任意阶段改造完成 THEN System SHALL 能够通过 `./gradlew :apps:android:app:assembleDebug`（或项目规定的 `bash scripts/android/package-debug.sh`）编译及全部 JVM 单元测试。

## 成功定义

- 全量 21 个路由页面及浮窗/预览组件完成向“极简主义 + Vision Pro 空间玻璃”设计系统的迁移，无未迁移的旧式实色粗糙页面。
- 100% 保留原有业务功能与全部 `testTag` 锚点，相关单元测试与 UI 自动化测试断言逻辑保持成立。
- `OutcomeGoApp.kt` 与 `FeatureScreens.kt` 完成模块化拆分，形成可复用的空间玻璃 Design System。
- 通过 `bash scripts/android/package-debug.sh` 打包验证与单元测试回归。
