# 设计文档 - Android 客户端极简玻璃态 UI 重构

状态：Draft

## 1. 概述

### 1.1 目标

- 构建一套统一的 **Spatial Glass Design System（空间玻璃设计系统）**，以纯 Jetpack Compose 实现兼具 **极致极简主义（Ultra-Minimalist）** 与 **Vision Pro 未来感（Futuristic Glass）** 的视觉规范。
- 借鉴 Gemini App 与 ChatGPT App 的信息密度控制、聚焦画布排版与流畅物理动效，全面升级全量 21 个页面、浮窗、Markdown/Rich 卡片与多媒体预览。
- 在重构过程中严格保持 `AppViewModel`、`LiveFeatureGateway`、`AndroidPlatformRuntime` 与 `mobile/shared` 零业务改动，完整保留全部 `testTag` 与布局自动化测试契约。
- 将超大型单体 UI 文件拆分为清晰、低耦合的模块结构。

### 1.2 覆盖需求

- `requirements.md` 需求 1：全功能零丢失与测试契约兼容
- `requirements.md` 需求 2：极致极简与 Vision Pro 空间玻璃视觉体系
- `requirements.md` 需求 3：Gemini / ChatGPT 风格核心对话与目录体验
- `requirements.md` 需求 4：直觉化的物理动效、转场与触觉反馈
- `requirements.md` 需求 5：实时语音、多媒体预览与全功能设置页视觉统一
- `requirements.md` 需求 6：UI 模块化架构重构

### 1.3 技术约束

- 目标平台：Android（`minSdk = 26`，`targetSdk = 35`，`compileSdk = 36`），见 `apps/android/app/build.gradle.kts`。
- UI 框架：Jetpack Compose（`androidx.compose:compose-bom:2024.12.01`）、Material 3、Material Icons Extended。
- 状态管理与业务层：`AppViewModel`、`UiState`、`FeatureState`、`AndroidPlatformRuntime` 均保持只读接入，不修改协议层。
- 模糊与硬件加速约束：Android 12（API 31）及以上原生支持 `RenderEffect.createBlurEffect` / `Modifier.blur()`；API 26–30 必须优雅降级，不可使用会引起 `NoClassDefFoundError` 的未受保护 API，也不引入重型原生 NDK/C++ 模糊库。
- 打包要求：构建验证必须遵循项目规则使用 `bash scripts/android/package-debug.sh`（以及 JVM 单元测试），禁止在仓库写入 `local.properties` 或直接试验不兼容的 JDK。

## 2. 架构

### 2.1 系统与 UI 分层结构

```text
MainActivity (Edge-to-Edge Window + Theme Wrapper)
  └── OutcomeGoTheme (SpatialTokens + MaterialTheme + LocalSpatialTokens)
        └── SpatialAmbientCanvas (自适应极简底色 + 微妙静态/低频环境光晕)
              ├── OutcomeGoApp (NavHost + 空间景深转场 + 权限/深链/触觉编排)
              │     ├── designsystem/ (玻璃材质、悬浮胶囊、动效原语、按钮/输入框/开关)
              │     ├── screens/auth/ (登录向导 3 步流畅过渡)
              │     ├── screens/directory/ (目录、置顶区、悬浮搜索、消息搜索、侧边栏管理)
              │     ├── screens/chat/ (对话画布、悬浮顶栏、胶囊输入器、消息气泡、活动脉冲)
              │     ├── screens/voice/ (LiveVoiceView 声纹光环 + 可折叠迷你药丸)
              │     ├── screens/details/ (Bot详情、会话配置、新建会话、Computer VNC、Marketplace)
              │     ├── screens/settings/ (Settings、Routines、Plugins、Providers、Web、Memory、NetworkSharing)
              │     └── screens/system/ (ShareTarget、Outbox、AttachmentGallery)
              └── features/ (MarkdownRenderer、DocumentPreview、DropdownPickers、RichMessageCard)
```

### 2.2 模块职责

| 模块 / 包 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `com.outcomego.android.ui.designsystem` | 空间玻璃 Token、玻璃容器、镜面描边、Spring 动效规格、按压缩放、悬浮顶栏/底栏、基础控件 | `Appearance`、`Accent`、交互状态 | 统一视觉组件与 `LocalSpatialColors` |
| `com.outcomego.android.ui.screens.*` | 各业务路由页面与交互编排，零业务计算，纯渲染与事件透传 | `AppViewModel` / `UiState` / 回调 | Compose 页面树（保留全部 `testTag`） |
| `com.outcomego.features`（重构 UI 部分） | 富文本卡片、Markdown、文件预览、LiveVoiceView、选择器、设置子页 | `FeatureState` / `RichMessageBlock` / `AndroidLiveVoiceState` | 视觉统一的跨功能组件 |
| `OutcomeGoApp.kt`（瘦身后） | 仅保留路由定义、权限申请、系统事件监听与 `NavHost` 空间转场配置 | `AppViewModel`、更新状态 | 顶层应用导航壳 |

### 2.3 关键交互流程

#### 2.3.1 自适应空间玻璃渲染流程（API 26–36 兼容）

1. 外层容器通过 `SpatialGlassSurface` 接收 `GlassLevel`（`Canvas`、`Elevated`、`Floating`、`Overlay`）与 `Shape`。
2. 在背景画布层（`SpatialAmbientCanvas`）绘制极简底色及 1–2 个低透明度、非阻塞的环境光斑（仅作为静态/低频率径向渐变，保证零性能开销）。
3. `SpatialGlassSurface` 根据 `Build.VERSION.SDK_INT >= Build.VERSION_CODES.S` 与场景级别：
   - 对独立悬浮装饰层或背板（如弹窗背景/全屏遮罩）按需应用 `Modifier.blur(...)`；
   - 对高频滚动列表之上的悬浮胶囊顶栏/底栏，采用“高质感多层半透明渐变 + 顶部边缘渐变遮罩（Edge Fade Mask）+ 1px 镜面高光描边 + 内嵌柔光”，避免对实时 `LazyColumn` 逐帧重采样造成 GPU 掉帧。
4. 1px 镜面描边采用从左上（高光 `alpha = 0.28~0.45`）到右下（微弱反射 `alpha = 0.06~0.12`）的 `Brush.linearGradient`，还原 Vision Pro 玻璃边缘折射质感。

#### 2.3.2 胶囊输入器（`ChatComposer`）折叠与展开流程

1. 严格保留 `PrimaryWorkflowTest.composerCollapsesWhenUnfocusedAndSplitsWhenFocused` 的状态机与几何约束：
   - **未聚焦且无草稿**：单行悬浮玻璃胶囊，`attach-composer` 位于左侧，`message-composer` 位于中间自适应填充，`voice-composer` 位于右侧。
   - **聚焦或存在草稿文本**：`message-composer` 自动上移至第一行独立展开（支持多行），`attach-composer`（左下）与 `send-message` / `voice-composer`（右下）退居第二行，保证 `inputFocused.bottom <= attachFocused.top` 且 `inputFocused.bottom <= voiceFocused.top`。
2. 使用 `animateContentSize(animationSpec = SpatialMotion.SnappySpring)` 与平滑图标交叉淡入（`voice-composer` <-> `send-message` 仅在非空输入时切换存在性，确保 `assertDoesNotExist()` 测试断言精准）。
3. 点击 `chat-message-list` 空白区清除焦点并触发折叠，回归单行胶囊。

## 3. 组件和接口

### 3.1 核心 Design System 组件

覆盖需求：2、3、4、6

- `SpatialColors` & `LocalSpatialColors`：定义深/浅模式全套表面色、玻璃填充色、高光边框起止色、环境光晕色、语义状态色与文本对比度色阶。
- `SpatialMotion`：集中定义全部动效常量：
  - `SnappySpring`（`dampingRatio = 0.82f, stiffness = 480f`）：用于按钮按压、输入栏折叠展开、胶囊切换。
  - `SpatialSpring`（`dampingRatio = 0.88f, stiffness = 360f`）：用于页面景深转场、Sheet 弹出、语音卡片形态变换。
  - `GentleSpring`（`dampingRatio = 0.92f, stiffness = 240f`）：用于列表项入场、流式消息微浮现、光晕呼吸。
- `SpatialGlassSurface`：统一玻璃态卡片/面板容器，支持 `GlassTier`（`Subtle`、`Card`、`FloatingBar`、`Modal`）、镜面描边、微投影与按压高光响应。
- `Modifier.spatialPressScale(enabled, hapticEffect)`：结合 `pointerInput` 按压缩放（`0.965f`）与 `LocalAppHaptics` 触发，统一所有交互元件手感。
- `SpatialFloatingTopBar`：无硬边界的悬浮玻璃顶栏，底部附带渐隐羽化遮罩（Edge Scrim），使列表滚动内容从顶栏背后滑过时自然融出。
- `SpatialGroupedSection` & `SpatialSettingRow`：极简分组卡片与设置行原语，用于统一 Settings / BotDetails / Profile / Routines / Providers / Plugins 的信息排版。

### 3.2 视觉 Token 规范（深浅双模式）

覆盖需求：2

#### 3.2.1 浅色模式（Ceramic Minimalist Glass）

| Token | 色值 / 渐变 | 用途 |
| --- | --- | --- |
| `canvasBase` | `#F7F8FA` | 主画布极简陶瓷底色（非刺眼纯白） |
| `ambientGlowPrimary` | Accent 色 `alpha = 0.08f` | 顶部微弱环境光晕 |
| `glassSurfaceSubtle` | `#FFFFFF` `alpha = 0.68f` | 次级分组/静态卡片 |
| `glassSurfaceFloating` | `#FFFFFF` `alpha = 0.84f` | 悬浮顶栏、胶囊输入器、搜索栏 |
| `glassBorderStart` / `End` | `#FFFFFF` `0.95f` -> `#0F172A` `0.08f` | 左上到右下的镜面高光描边 |
| `textPrimary` / `Secondary` | `#0B0F17` / `#5A6270` | 高对比度文字层级 |
| `userBubble` | Accent 融合渐变或 `#111318` | 用户消息气泡 |

#### 3.2.2 深色模式（Obsidian Spatial Glass）

| Token | 色值 / 渐变 | 用途 |
| --- | --- | --- |
| `canvasBase` | `#07080C` | 深邃黑曜石空间底色 |
| `ambientGlowPrimary` | `#3B82F6` / Accent `alpha = 0.14f` | 顶部空间极光微光 |
| `glassSurfaceSubtle` | `#161922` `alpha = 0.66f` | 列表卡片、设置分组 |
| `glassSurfaceFloating` | `#1C202B` `alpha = 0.80f` | 悬浮顶栏、输入胶囊、迷你语音药丸 |
| `glassBorderStart` / `End` | `#FFFFFF` `0.22f` -> `#FFFFFF` `0.04f` | 标志性 Vision Pro 玻璃边缘光 |
| `textPrimary` / `Secondary` | `#F5F7FA` / `#9CA3B2` | 柔和而清晰的中英文暗色排版 |
| `userBubble` | Accent 玻璃渐变（高饱和微透） | 用户消息气泡 |

### 3.3 页面级重构接口契约

覆盖需求：1、3、5、6

1. **包与签名兼容策略**：
   - `OutcomeGoTheme`、`OutcomeGoApp`、`LiveVoiceView`、`MarkdownMessage`、`DocumentPreview`、`RichMessageCardScreen`、`SettingsScreen`、`RoutinesScreen`、`RoutineEditorScreen`、`AccountMemoryScreen`、`ProviderSettingsScreen`、`WebProviderSettingsScreen`、`VoiceSettingsScreen`、`PluginsScreen`、`NetworkSharingDetailsScreen`、`DropdownSelectorField`、`SearchableTimeZoneSelector`、`VolcengineVoiceSelector` 保持现有公开包名、函数名及参数签名不变，确保外部调用方（`MainActivity.kt` 等）及测试零编译破坏。
2. **导航转场契约**：
   - 主体前向 Push：`slideIntoContainer(Left, 280ms)` 升级为 **Spatial Push**（前景 `offsetX + alpha + scale(0.96f -> 1f)` 协同动画，背景 `scale(1f -> 0.94f) + alpha(1f -> 0.72f)` 产生真实景深退让）。
   - `SETTINGS` 左侧抽屉式打开保持自左向右滑入习惯，并叠加暗化磨砂背景景深。
3. **测试标签（`testTag`）全量保留清单**：
   - 登录：`login-welcome-title`、`get-started`、`preview-workspace`、`server-field`、`connect-button`、`username-field`、`credential-field`、`sign-in-button`、`wizard-back`
   - 目录：`directory-title`、`pinned-*`、`conversation-*`
   - 对话：`back-to-conversations`、`live-voice-header`、`bot-details`、`chat-operation-status`、`chat-message-list`、`load-older-messages`、`composer-container`、`attach-composer`、`message-composer`、`send-message`、`voice-composer`、`pending-attachments`、`pending-attachment-*`、`remove-pending-attachment-*`、`live-voice-member-picker`、`live-voice-member-*`、`live-voice-start-group`、`bot-activity`、`thread-context`、`thread-context-title`、`thread-context-truncated`、`voice-conversation-card`、`voice-conversation-preview`、`message-row-*`、`delivery-status-*`、`routine-event-*`、`reply-quote`、`reply-preview`、`cancel-reply`
   - 实时语音：`live-voice-minimize`、`live-voice-floating-pill`、`live-voice-restore`、`live-voice-mini-stop`、`live-voice-stage`、`live-voice-captions`、`live-voice-control-*`
   - 分享：`share-target-list`、`share-target-*`、`share-stay`、`share-return`、`share-received`

## 4. 数据与状态模型

### 4.1 状态零侵入原则

- 所有业务数据模型（`AppUiState`、`Conversation`、`ChatMessage`、`ChatRow`、`FeatureState`、`AndroidLiveVoiceState`、`AndroidUpdateState`）维持原样，UI 层仅消费状态并派生视觉呈现状态（如滚动偏移量、焦点态、按压态、折叠展开态）。

### 4.2 视觉派生状态机

| UI 状态 | 触发条件 | 视觉表现 | 退出条件 |
| --- | --- | --- | --- |
| `ComposerCollapsed` | 输入框失焦且文本为空 | 单行悬浮玻璃胶囊（附件 + 输入 + 语音） | 点击聚焦或输入非空字符 |
| `ComposerExpanded` | 输入框聚焦或存在草稿 | 双行玻璃胶囊（多行输入在上，附件+发送/语音在下） | 发送清空或点击消息列表失焦（且无草稿） |
| `VoiceExpanded` | 实时语音激活且未最小化 | 沉浸式全屏/大卡片声纹光环舞台 + 实时字幕流 | 点击最小化按钮或挂断 |
| `VoiceFloatingPill` | 实时语音最小化 | 悬浮可拖动玻璃药丸（头像微脉动 + 恢复 + 挂断） | 点击恢复或挂断 |
| `ScrolledUnderChrome` | 列表 `firstVisibleItemScrollOffset > 0` | 顶栏玻璃浓度提升 + 镜面高光增强 + 边缘渐隐生效 | 列表回到顶部 |

## 5. 错误处理与边界降级

### 5.1 视觉与平台边界场景

- **API 26–30 模糊不可用**：所有通过 `RenderEffect` 实现的模糊调用统一封装在 `Build.VERSION.SDK_INT >= Build.VERSION_CODES.S` 条件分支内，低版本采用半透明高亮度/暗度渐变填充 + 1px 描边，杜绝崩溃。
- **IME 键盘与底部安全区冲突**：重构悬浮 `ChatBottomBar` 时严格使用 `imePadding()` + `navigationBarsPadding()`（以及现有的 `ImeCollapseObserver` 逻辑），确保键盘弹出/收起时胶囊输入器平滑贴合键盘顶部而不遮挡最后一条消息。
- **长文本 / 超大代码 / 表格溢出**：`MarkdownRenderer` 与 `RichMessageCardScreen` 保留水平滚动与最大宽度约束，玻璃卡片外层不裁切内部水平滚动交互。
- **系统关闭动画 / 减少动态效果**：当动画缩放为 0 时，`Spring` 与 `tween` 自动瞬时完成终态渲染，不依赖动画回调触发业务逻辑。

## 6. 正确性属性

### 6.1 属性 1：功能与测试契约不变量

*对于任何* 本次重构涉及的页面或组件，重构前存在的全部业务动作回调、状态展示分支及 `testTag` 语义标签，在重构后都必须保持完整可达且行为等价。

**验证需求：** 需求 1

### 6.2 属性 2：双模式可读性与对比度不变量

*对于任何* `Appearance`（Light / Dark / System）与 `Accent`（Black / Blue / Purple / Green）组合，空间玻璃卡片上的主文本、次文本、错误提示与状态徽章都必须保持清晰可辨的视觉对比度，不出现暗字配暗底或亮字配亮底。

**验证需求：** 需求 1、需求 2

### 6.3 属性 3：输入器几何状态不变量

*对于任何* 对话进入与输入交互，当输入框失焦且无草稿时必须处于单行水平排列；当聚焦或存在草稿时输入区必须位于附件/发送按钮上方，满足现有自动化测试的几何断言。

**验证需求：** 需求 1、需求 3

## 7. 测试策略

### 7.1 编译与打包验证

- 每个阶段检查点执行：`bash scripts/android/package-debug.sh`，确认 Compose 编译、资源合并与 Debug APK 打包通过。

### 7.2 单元测试与契约回归

- 运行 Android JVM 单元测试（通过 Gradle / 脚本校验）：确认所有既有测试（`DirectoryGroupingTest`、`ChatRowsTest`、`AppViewModelEventsTest`、`FeatureContractsTest` 等）全部通过。

### 7.3 UI 自动化测试与视觉走查

- 在 `androidTest` 代码层面逐项核对 `PrimaryWorkflowTest`、`AndroidParitySmokeTest`、`RichMessageRendererTest` 所需的全部 `testTag` 与几何约束；如有设备/模拟器可用时执行 instrumentation 测试及深浅双模式人工走查。

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §3.3、§6.1、§6.3 | 核对全部 `testTag` 清单、运行 JVM 单测、编译检查 `androidTest`、执行 `package-debug.sh` |
| `requirements.md` 需求 2 | `design.md` §2.3.1、§3.1、§3.2 | 深/浅模式与 4 种 Accent 视觉走查 + API 26 降级分支代码审查 |
| `requirements.md` 需求 3 | `design.md` §2.3.2、§3.3 | 验证 Directory / Chat / Composer 展开收起行为与 `PrimaryWorkflowTest` 几何约束 |
| `requirements.md` 需求 4 | `design.md` §3.1、§3.3 | 验证按钮按压缩放、页面空间转场、语音波形与 `AndroidHaptics` 联动 |
| `requirements.md` 需求 5 | `design.md` §2.1、§4.2 | 逐一核对 LiveVoice、Settings、Routines、Providers、Plugins、VNC、Markdown、DocumentPreview 视觉一致性 |
| `requirements.md` 需求 6 | `design.md` §2.1、§2.2 | 检查 `OutcomeGoApp.kt` 与 `FeatureScreens.kt` 拆分后的目录结构与构建无告警 |

## 8. 风险与待确认项

### 8.1 风险

- **过度重绘导致滚动掉帧**：在滚动列表中滥用 `Modifier.blur()` 或复杂 `Canvas` 阴影会引起中低端 Android 设备掉帧。缓解方案：滚动背景不实时做全屏动态模糊，仅对静态背景光晕、局部非滚动浮层按需启用模糊，悬浮栏采用精心调校的多层半透明渐变与边缘渐隐模拟通透玻璃。
- **大规模文件拆分引发隐藏引用遗漏**：`OutcomeGoApp.kt` 接近 5,000 行，内部存在不少跨屏幕共享的 `private` helper。缓解方案：先建立 `designsystem` 与公共 UI helper，再按页面域分批迁出，每迁出一批即运行编译与单测验证。
- **`PrimaryWorkflowTest` 严格几何断言**：`composerCollapsesWhenUnfocusedAndSplitsWhenFocused` 直接断言按钮和输入框的像素边界关系。缓解方案：修改 `ChatComposer` 时显式保留双态布局结构，仅美化其玻璃外壳、圆角、间距与弹簧动画。

### 8.2 待确认项

- 如需针对特定品牌视觉（如启动 Logo 动画或特定极光配色）做进一步定制，可在阶段 1 评审后微调 `SpatialColors` Token 表。
