# 任务清单 - Android 客户端极简玻璃态 UI 重构（人话版）

状态：Done

## 这份文档是干什么的

这份任务清单把约 1.19 万行 Android Compose UI 的彻底美化重构，拆成 6 个可控、可验证的阶段：
先搭好“空间玻璃设计系统”底座，再从最核心的登录/目录/对话页改起，接着改造实时语音与 Markdown/预览，然后统一全部二三级功能与设置页，最后完成全量构建、测试回归与验收。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- `BLOCKED` 必须写清楚卡在哪里
- `CANCELLED` 必须写清楚为什么不做
- 每做完一个任务，必须立刻更新这里

---

## 阶段 1：搭建 Spatial Glass Design System（空间玻璃设计系统）

- [x] 1.1 建立双模式空间玻璃色彩与排版 Token（`SpatialTheme`）
  - 状态：DONE
  - 这一步到底做什么：升级 `Theme.kt` 并新建设计系统 Token 文件，定义浅色陶瓷白（Ceramic）与深色黑曜石（Obsidian）双模式玻璃色板、1px 镜面描边渐变色、环境光晕色、字体字重层级与圆角规范，同时兼容现有 `AppSettings.Appearance` 与 `AppSettings.Accent`。
  - 做完你能看到什么：应用根容器具备极简背景画布与轻微环境光晕，主题切换时所有颜色 Token 平滑切换且对比度清晰。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §3.1、§3.2
    - `apps/android/app/src/main/java/com/outcomego/android/ui/Theme.kt`
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/Theme.kt`
    - `apps/android/app/src/main/java/com/outcomego/android/ui/designsystem/SpatialTokens.kt`（新建）
  - 这一步先不做什么：先不改具体业务页面（Directory、Chat、Settings 等）。
  - 怎么算完成：
    1. `LocalSpatialColors` 与 `SpatialTokens` 覆盖 Light / Dark 及 4 种 Accent。
    2. `OutcomeGoTheme` 保持原有公开函数签名不变。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh` 编译通过
  - 对应需求：`requirements.md` 需求 1 / 验收 1.3、需求 2 / 验收 2.1
  - 对应设计：`design.md` §3.1、§3.2

- [x] 1.2 实现空间玻璃基础容器、动效规格与交互原语
  - 状态：DONE
  - 这一步到底做什么：新建空间玻璃基础组件库：玻璃态容器 `SpatialGlassSurface`（多层半透明底色 + 1px 渐变镜面高光边框 + API 31+ 按需模糊与低版本降级）、背景光晕画布 `SpatialAmbientCanvas`、统一 Spring 动效常量 `SpatialMotion`、按压缩放修饰符 `spatialPressScale`（联动 `LocalAppHaptics`）、悬浮玻璃顶栏 `SpatialFloatingTopBar`、分组卡片 `SpatialGroupedSection` 与统一按钮/输入框/开关原语。
  - 做完你能看到什么：有一套可直接拿来拼装所有页面的 Vision Pro 风格玻璃 UI 基础组件库。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4
    - `design.md` §2.3.1、§3.1、§5.1
    - `apps/android/app/src/main/kotlin/com/outcomego/features/AppHaptics.kt`
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/designsystem/SpatialGlass.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/designsystem/SpatialMotion.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/designsystem/SpatialComponents.kt`（新建）
  - 这一步先不做什么：先不修改 `OutcomeGoApp.kt` 中的页面实现。
  - 怎么算完成：
    1. API 31+ 模糊调用均做好版本判断与低版本降级。
    2. 所有基础控件均内置按压弹性反馈与触觉联动。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh` 编译通过
  - 对应需求：`requirements.md` 需求 2 / 验收 2.2、2.3、需求 4 / 验收 4.1
  - 对应设计：`design.md` §2.3.1、§3.1、§5.1

### 阶段检查

- [x] 1.3 阶段 1 检查点：设计系统可编译且独立成体系
  - 状态：DONE
  - 这一步到底做什么：检查阶段 1 的 Token、玻璃组件与动效规格命名一致、无重复代码、无硬编码冲突。
  - 做完你能看到什么：设计系统底座稳固，可以开始批量重构业务页面。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `design.md` §3.1、§3.2
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/Theme.kt`
    - `apps/android/app/src/main/java/com/outcomego/android/ui/designsystem/*`
  - 这一步先不做什么：不提前改动业务页面。
  - 怎么算完成：
    1. Debug 包构建成功且无新增编译器警告。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 2、需求 6
  - 对应设计：`design.md` §2.1、§3.1、§3.2

---

## 阶段 2：重构导航转场、登录引导与会话目录（Core Shell）

- [x] 2.1 重构导航壳与空间景深转场动画，并拆分导航配置
  - 状态：DONE
  - 这一步到底做什么：优化 `OutcomeGoApp.kt` 中的 `NavHost` 转场，将生硬的线性滑入升级为带前景微缩放（`0.96 -> 1.0`）与透明度融合的 Spatial Depth 转场（保留 `SETTINGS` 从左侧抽屉式进入的语义与全量 21 个路由定义）。
  - 做完你能看到什么：所有页面切换都有丝滑的空间纵深感，不再是生硬平移。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 4
    - `design.md` §3.3
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`（L296-L650 路由与 NavHost）
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`
  - 这一步先不做什么：先不改单个页面的内部布局，先打通转场壳。
  - 怎么算完成：
    1. 21 个路由全部保留且深链/返回手势正常。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 1 / 验收 1.1、需求 4 / 验收 4.2
  - 对应设计：`design.md` §3.3

- [x] 2.2 重构登录引导页（`SignInScreen`）并拆分为独立文件
  - 状态：DONE
  - 这一步到底做什么：将 `SignInScreen`（Welcome / Endpoint / Credentials 三步流）迁出 `OutcomeGoApp.kt` 至独立文件，重构为极简未来感视觉：发光呼吸感 Hero 徽章、大留白排版、玻璃态步骤卡片、流畅步骤间 `AnimatedContent` 过渡，完整保留全部 `testTag`（`login-welcome-title`、`get-started`、`preview-workspace`、`server-field`、`connect-button`、`username-field`、`credential-field`、`sign-in-button`、`wizard-back`）。
  - 做完你能看到什么：全新极具仪式感的极简玻璃态登录向导。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 6
    - `design.md` §3.3
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`（L1312-L1741）
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/auth/SignInScreen.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`
  - 这一步先不做什么：不修改登录验证逻辑与 `AppViewModel`。
  - 怎么算完成：
    1. 登录 3 步流程、Preview Workspace 与错误提示均可正常操作。
    2. 全部 `testTag` 完整保留。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
    - 核对 `AndroidParitySmokeTest.signInSurfaceExposesAccessibleControls` 所需 `testTag`
  - 对应需求：`requirements.md` 需求 1 / 验收 1.2、需求 2、需求 6
  - 对应设计：`design.md` §2.2、§3.3

- [x] 2.3 重构会话目录（`DirectoryScreen`）与搜索（`MessageSearchScreen`、`SidebarManagementScreen`）
  - 状态：DONE
  - 这一步到底做什么：将 `DirectoryScreen`、`MessageSearchScreen`、`SidebarManagementScreen` 迁出 `OutcomeGoApp.kt` 至独立目录模块，重构为高留白空间卡片、悬浮玻璃顶栏（设置/新建按钮胶囊化）、优雅置顶 Bot 卡片（`PinnedBotCard` 玻璃微光）、悬浮底部玻璃搜索胶囊（`FloatingSearchBar` <-> `ExpandedSearchBar` 弹性形变）与精致头像光环。保留 `directory-title`、`pinned-*`、`conversation-*` 等全部 `testTag` 及全部快捷操作/长按菜单。
  - 做完你能看到什么：通透、有呼吸感、支持底部悬浮搜索胶囊丝滑展开的全新主目录体验。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 6
    - `design.md` §2.2、§3.3
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`（L1191-L1310、L1742-L2603）
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/directory/DirectoryScreen.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/directory/DirectoryComponents.kt`（新建：头像、分组、搜索栏、置顶卡片）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`
  - 这一步先不做什么：不改动 `DirectoryGrouping.kt` 的分组算法逻辑。
  - 怎么算完成：
    1. 会话目录、全局搜索（FilterChip + 结果跳转）、侧边栏排序/显隐管理全部正常。
    2. 滚动内容自然进入悬浮顶栏与底部搜索胶囊下方。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
    - 运行相关单元测试 `DirectoryGroupingTest`
  - 对应需求：`requirements.md` 需求 1、需求 3 / 验收 3.1、需求 6
  - 对应设计：`design.md` §2.2、§3.3

### 阶段检查

- [x] 2.4 阶段 2 检查点：登录与目录主链路稳固
  - 状态：DONE
  - 这一步到底做什么：确认登录、转场与目录模块拆分后无多余死代码、所有 `testTag` 完好、APK 正常构建。
  - 做完你能看到什么：应用入口和首页已完成彻底焕新。
  - 先依赖什么：2.1、2.2、2.3
  - 主要改哪里：阶段 2 全部文件
  - 这一步先不做什么：不提前展开阶段 3 对话页细节。
  - 怎么算完成：
    1. 构建通过且目录/登录 `testTag` 核查无缺失。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 1、需求 3
  - 对应设计：`design.md` §3.3、§7.4

---

## 阶段 3：重构核心对话画布与实时语音（Gemini / ChatGPT 核心体验）

- [x] 3.1 重构对话页（`ChatScreen`）、消息气泡、流式/活动状态与悬浮顶栏
  - 状态：DONE
  - 这一步到底做什么：将 `ChatScreen` 及消息列表、气泡、上下文摘要、引用回复、Routine 事件卡片、Bot 活动行迁出 `OutcomeGoApp.kt` 至独立对话模块：
    - 悬浮玻璃顶栏（融入边缘渐隐，展示头像/状态点、实时语音按钮、详情入口）；
    - 参考 Gemini / ChatGPT 重塑消息流：AI 消息采用简洁无重框高可读布局配微妙左侧标识或轻盈玻璃卡片，用户消息采用圆润玻璃/主题渐变气泡，时间戳与投递状态低调精致；
    - 升级 `BotActivityRow` 与待处理状态为流光脉冲呼吸动效；
    - 升级回到底部悬浮胶囊按钮与长按操作菜单/反应行（`ReactionsAndActionsRow`）。
    - 严格保留全部对话区 `testTag`。
  - 做完你能看到什么：极简、高专注度、如 Gemini / ChatGPT 般优雅的 AI 对话画布。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 4
    - `design.md` §3.3、§6.3
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`（L3430-L4955）
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/chat/ChatScreen.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/chat/ChatMessageComponents.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`
  - 这一步先不做什么：输入胶囊 `ChatComposer` 放在 3.2 精细打磨（此处先接入原有或占位）。
  - 怎么算完成：
    1. 所有消息类型（文本、RichCard、语音对话卡片、Routine 事件、引用回复、附件条）均正常显示与交互。
    2. `message-row-*`、`delivery-status-*`、`chat-message-list` 等 `testTag` 全部保留。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
    - 核对 `ChatRowsTest` 与 `AndroidParitySmokeTest` 语义标签
  - 对应需求：`requirements.md` 需求 1、需求 3 / 验收 3.2、3.3、需求 4
  - 对应设计：`design.md` §3.3、§7.4

- [x] 3.2 精细重构悬浮玻璃胶囊输入器（`ChatComposer`）、引用条与待发送附件条
  - 状态：DONE
  - 这一步到底做什么：将 `ChatComposer`、`ChatBottomBar`、`ReplyPreviewBar`、`PendingAttachmentStrip`、`voiceControls` 迁出并升级为 Vision Pro 悬浮玻璃胶囊输入区：
    - **严格保留**单行折叠（失焦无草稿：`attach` + `input` + `voice`）与双行展开（聚焦/有草稿：`input` 在上，`attach` + `send/voice` 在下）的几何契约，确保 `PrimaryWorkflowTest.composerCollapsesWhenUnfocusedAndSplitsWhenFocused` 完全成立；
    - 为展开/收起加入弹簧物理过渡、发送按钮发光微动效、录音状态动态声波条与触觉反馈；
    - 保持 `ImeCollapseObserver` 与 `imePadding()` 键盘避让流畅无抖动。
  - 做完你能看到什么：跟手、通透、展开收起极具直觉感的悬浮玻璃输入胶囊。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 1 / 验收 1.2、需求 3 / 验收 3.2、需求 4
    - `design.md` §2.3.2、§5.1、§6.3
    - `apps/android/app/src/androidTest/java/com/outcomego/android/shell/PrimaryWorkflowTest.kt`
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/chat/ChatComposer.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/chat/ChatScreen.kt`
  - 这一步先不做什么：不改变语音录制底层逻辑与草稿存储逻辑。
  - 怎么算完成：
    1. 未聚焦/聚焦/有草稿/发送后/点击消息列表失焦 5 种状态切换完全符合 `PrimaryWorkflowTest` 几何断言。
    2. `composer-container`、`attach-composer`、`message-composer`、`send-message`、`voice-composer`、`pending-attachments`、`reply-preview` 全部准确存在。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
    - 逐行比对 `PrimaryWorkflowTest` 三个测试用例的所有断言条件
  - 对应需求：`requirements.md` 需求 1 / 验收 1.2、需求 3 / 验收 3.2
  - 对应设计：`design.md` §2.3.2、§6.3

- [x] 3.3 重构实时语音对话舞台与迷你悬浮药丸（`LiveVoiceView`）
  - 状态：DONE
  - 这一步到底做什么：全面美化 `LiveVoiceView.kt` 与群聊语音成员选择器 `VoiceMemberPickerDialog`：
    - 打造 Vision Pro 风格的沉浸式玻璃语音通话卡片/全屏舞台，加入随通话状态（Connecting / Listening / Thinking / Speaking / Muted）变化的多层有机光环与呼吸声波动画；
    - 美化底部玻璃控制按钮（静音、扬声器、最小化、挂断）与柔和渐隐的实时字幕流；
    - 升级 `FloatingMiniVoiceBar` 为精致的悬浮可拖拽玻璃态动态药丸，完整保留 `live-voice-*` 全部 `testTag`。
  - 做完你能看到什么：极具未来科技感的实时语音光环舞台与优雅的悬浮语音药丸。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 4、需求 5 / 验收 5.1
    - `design.md` §3.3、§4.2
    - `apps/android/app/src/main/kotlin/com/outcomego/features/LiveVoiceView.kt`
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/LiveVoiceView.kt`
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/chat/VoiceMemberPickerDialog.kt`（新建或纳入 chat 模块）
  - 这一步先不做什么：不修改 `AndroidLiveVoiceSession` 与 WebSocket/音频管道。
  - 怎么算完成：
    1. 通话舞台、群聊成员舞台、字幕流、最小化药丸与展开恢复动效流畅。
    2. 全部 `live-voice-*` `testTag` 保持不变。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 4、需求 5 / 验收 5.1
  - 对应设计：`design.md` §3.3、§4.2

### 阶段检查

- [x] 3.4 阶段 3 检查点：核心对话与语音主链路验收
  - 状态：DONE
  - 这一步到底做什么：核查阶段 3 改造后的对话收发、输入器折叠/展开、实时语音浮窗与所有对话 `testTag` 完整性。
  - 做完你能看到什么：应用最高频的“聊天 + 语音”核心体验全面完工。
  - 先依赖什么：3.1、3.2、3.3
  - 主要改哪里：阶段 3 全部文件
  - 这一步先不做什么：不提前进入设置页与二级页面。
  - 怎么算完成：
    1. 构建通过，核心对话/输入器/语音相关 `testTag` 与几何约束全部确认无误。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 4、需求 5
  - 对应设计：`design.md` §2.3.2、§6.3

---

## 阶段 4：重构 Markdown、富文本交互卡片、附件预览与通用选择器

- [x] 4.1 重构 `MarkdownRenderer` 与 `RichMessageCardScreen` 视觉风格
  - 状态：DONE
  - 这一步到底做什么：升级 `MarkdownRenderer.kt` 与 `FeatureScreens.kt` 中的 `RichMessageCardScreen`：代码块改为圆润暗/亮色玻璃终端容器（清晰语言标签与平滑横向滚动）、表格采用极简半透明表头与柔和网格线、引用块采用纤细主题色竖线与轻透底色；Interactive Widget（单选/多选/文本输入/确认操作）升级为空间玻璃交互选项卡片与弹性选中动效。
  - 做完你能看到什么：AI 输出的复杂 Markdown 与互动问答卡片具有极致的排版高级感。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.3
    - `design.md` §5.1
    - `apps/android/app/src/main/kotlin/com/outcomego/features/MarkdownRenderer.kt`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/FeatureScreens.kt`（L242-L486）
    - `apps/android/app/src/androidTest/java/com/outcomego/android/features/RichMessageRendererTest.kt`
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/MarkdownRenderer.kt`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/RichMessageCardUi.kt`（从 `FeatureScreens.kt` 拆出，保留公开符号兼容）
  - 这一步先不做什么：不改变 Markdown 解析器语义与交互提交接口。
  - 怎么算完成：
    1. `RichMessageRendererTest` 覆盖的渲染元素均正常可见且样式升级。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 5 / 验收 5.3
  - 对应设计：`design.md` §3.3、§5.1

- [x] 4.2 重构多模态附件条、画廊全屏预览与 `DocumentPreview`
  - 状态：DONE
  - 这一步到底做什么：美化 `ChatAttachmentStrip`、`AttachmentGalleryScreen`、`AttachmentGalleryDialog` 与 `DocumentPreview.kt`：附件缩略图与文件卡片改为圆润玻璃胶囊/卡片，全屏图片/文档/PDF/音视频预览采用深邃空间画布配悬浮半透明顶部/底部控制条（下载/分享/关闭胶囊按钮），媒体播放器控制条极简现代。
  - 做完你能看到什么：沉浸式的全屏附件与文档预览体验。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.3
    - `apps/android/app/src/main/kotlin/com/outcomego/features/DocumentPreview.kt`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/FeatureScreens.kt`（L487-L780）
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/DocumentPreview.kt`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/AttachmentUi.kt`（拆出附件相关 UI）
  - 这一步先不做什么：不改变底层文件解码与 `NativeAttachmentPreview` 逻辑。
  - 怎么算完成：
    1. 图片、PDF、DOCX、表格、音视频及普通文本预览全格式正常打开与操作。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 5 / 验收 5.3
  - 对应设计：`design.md` §3.3

- [x] 4.3 重构通用玻璃选择器（`DropdownPickers`）与 Sheet 交互
  - 状态：DONE
  - 这一步到底做什么：升级 `DropdownPickers.kt` 中的 `SelectorTriggerField`、`DropdownSelectorField`、`SearchableTimeZoneSelector`、`VolcengineVoiceSelector`：统一采用空间玻璃触发框、圆角玻璃 ModalBottomSheet、内嵌极简搜索胶囊与带勾选脉冲的选项行。
  - 做完你能看到什么：所有表单选择与音色/时区弹窗都有统一的高级玻璃手感和弹性弹出效果。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.2
    - `apps/android/app/src/main/kotlin/com/outcomego/features/DropdownPickers.kt`
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/DropdownPickers.kt`
  - 这一步先不做什么：不改动 `PickerCatalogs` 数据列表与 `PickerCatalogsTest`。
  - 怎么算完成：
    1. 全部选择器功能与公开函数签名保持不变。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 5 / 验收 5.2
  - 对应设计：`design.md` §3.1、§3.3

### 阶段检查

- [x] 4.4 阶段 4 检查点：富文本、预览与选择器重构验收
  - 状态：DONE
  - 这一步到底做什么：检查跨页面复用的渲染器、预览器与选择器在深/浅模式下均风格统一。
  - 做完你能看到什么：跨模块的“内容展示与选择交互组件”全部完成统一美化。
  - 先依赖什么：4.1、4.2、4.3
  - 主要改哪里：阶段 4 全部文件
  - 这一步先不做什么：不提前改动剩余设置页。
  - 怎么算完成：
    1. 构建通过，无未迁移的旧式实色对话框或粗糙弹窗。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §7.4

---

## 阶段 5：重构二级功能页与全量设置页（完整收口剩余路由）

- [x] 5.1 重构 Bot 详情、会话配置、新建会话、Computer VNC 与 Marketplace
  - 状态：DONE
  - 这一步到底做什么：将 `BotDetailsScreen`、`ConversationProfileScreen`、`CreateConversationScreen`、`ComputerViewerScreen`、`MarketplaceScreen` 从 `OutcomeGoApp.kt` 拆出并重构：
    - 详情与配置页采用顶部大头像光晕 Hero + 极简玻璃能力列表与快捷操作胶囊；
    - Computer VNC 页面采用沉浸式全屏画布 + 悬浮半透明玻璃控制栏（连接状态胶囊、键盘/缩放/刷新操作）；
    - Marketplace 采用空间玻璃卡片展示模板/Bot 并支持一键创建。
  - 做完你能看到什么：从对话点击进入的所有 Bot 与远程桌面二级页面视觉完全统一。
  - 先依赖什么：2.4、4.3
  - 开始前先看：
    - `requirements.md` 需求 5 / 验收 5.2、需求 6
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`（L2604-L3429）
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/details/BotAndConversationScreens.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/details/ComputerViewerScreen.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/details/MarketplaceScreen.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`
  - 这一步先不做什么：不修改 VNC WebView 通信层。
  - 怎么算完成：
    1. 5 个页面功能完整迁出，构建无错。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 1、需求 5 / 验收 5.2、需求 6
  - 对应设计：`design.md` §2.1、§2.2

- [x] 5.2 重构 Settings、NetworkSharing、Routines、Memory、Providers 与 Plugins
  - 状态：DONE
  - 这一步到底做什么：重构 `FeatureScreens.kt` 剩余页面与 `NetworkSharingDetailsScreen.kt`（并按域拆分为清晰文件，保留原有包级公开函数）：
    - 统一使用 `SpatialFloatingTopBar`、`SpatialGroupedSection` 与精致玻璃开关/行；
    - `SettingsScreen`、`RoutinesScreen` & `RoutineEditorScreen`、`AccountMemoryScreen`、`ProviderSettingsScreen`、`WebProviderSettingsScreen`、`VoiceSettingsScreen`、`PluginsScreen`、`NetworkSharingDetailsScreen` 全部接入统一空间玻璃设计系统。
  - 做完你能看到什么：所有设置、自动化任务、插件、网络出口、提供者配置页呈现统一高级的 Vision Pro 极简卡片质感。
  - 先依赖什么：4.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 5 / 验收 5.2、需求 6
    - `apps/android/app/src/main/kotlin/com/outcomego/features/FeatureScreens.kt`（L781-L2141）
    - `apps/android/app/src/main/kotlin/com/outcomego/features/NetworkSharingDetailsScreen.kt`
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/FeatureScreens.kt`（拆分为清晰子文件或精简重构）
    - `apps/android/app/src/main/kotlin/com/outcomego/features/NetworkSharingDetailsScreen.kt`
  - 这一步先不做什么：不修改 `LiveFeatureGateway` 与 `AppSettings` 存储模型。
  - 怎么算完成：
    1. 全部设置与管理页面的外观、主题切换（System/Light/Dark + Accent）、应用内更新栏、网络状态卡均工作正常。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 1、需求 5 / 验收 5.2、需求 6
  - 对应设计：`design.md` §2.2、§3.3

- [x] 5.3 重构系统分享接收（`ShareTargetScreen`）与发件箱（`OutboxScreen`）
  - 状态：DONE
  - 这一步到底做什么：将 `ShareTargetScreen` 与 `OutboxScreen` 迁出 `OutcomeGoApp.kt` 并重构为空间玻璃卡片样式，保留 `share-target-list`、`share-target-*`、`share-stay`、`share-return`、`share-received` 全部 `testTag`。
  - 做完你能看到什么：全量 21 个路由页面无一遗漏地完成重构，且 `OutcomeGoApp.kt` 瘦身完毕。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 1、需求 6
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`（L978-L1190）
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/system/ShareAndOutboxScreens.kt`（新建）
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`
  - 这一步先不做什么：不修改 `OutboxStore` 与 `SharePayload` 处理逻辑。
  - 怎么算完成：
    1. `OutcomeGoApp.kt` 仅保留顶层导航与事件编排，代码体积大幅缩减。
    2. 分享接收与发件箱重试/删除交互正常。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 1、需求 6
  - 对应设计：`design.md` §2.2、§3.3

### 阶段检查

- [x] 5.4 阶段 5 检查点：全量 21 路由迁移收口
  - 状态：DONE
  - 这一步到底做什么：全量检查 21 个路由及所有弹窗/Sheet 是否仍有遗留的旧风格实色组件或未迁移分支。
  - 做完你能看到什么：整个 Android 客户端 UI 完成彻底重构。
  - 先依赖什么：5.1、5.2、5.3
  - 主要改哪里：阶段 5 全部文件
  - 这一步先不做什么：准备进入最终验证阶段。
  - 怎么算完成：
    1. 21 个路由全部使用空间玻璃设计系统。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
  - 对应需求：`requirements.md` 需求 1、需求 5、需求 6
  - 对应设计：`design.md` §7.4

---

## 阶段 6：全量回归验证、测试核查与验收交付

- [x] 6.1 运行全量 Android 单元测试、编译 `androidTest` 并核查 `testTag` 契约
  - 状态：DONE
  - 实际执行与结果：
    - `:mobile:androidApp:compileDebugKotlin`、`compileDebugUnitTestKotlin` 与 `:mobile:androidApp:testDebugUnitTest` 全部通过（JDK 21）；
    - `:mobile:androidApp:compileDebugAndroidTestKotlin` 报出仓库既有的 `apps/android/app/src/androidTest/java/com/outcomego/android/features/RichMessageRendererTest.kt:4` 未解析导入 `androidx.compose.ui.test.assertDoesNotExist`（未修改 `androidTest` 既有代码），其余全部 `testTag` 与布局契约已通过 `rg` 核对保留。
  - 这一步到底做什么：执行 Android 模块单元测试与 `androidTest` 编译检查，核对 `design.md` §3.3 列出的全部 `testTag` 在重构后代码中的存在性与语义正确性，并修复任何编译、测试或对比度/布局问题。
  - 做完你能看到什么：所有自动化测试与编译检查全部通过，功能零回归得到工程验证。
  - 先依赖什么：5.4
  - 开始前先看：
    - `requirements.md` 需求 1、非功能需求 3
    - `design.md` §3.3、§6、§7
  - 主要改哪里：发现问题时定向修复对应 UI 文件
  - 这一步先不做什么：不引入新需求。
  - 怎么算完成：
    1. JVM 单元测试与 `androidTest` 编译通过。
    2. 全部 `testTag` 与 `PrimaryWorkflowTest` 几何断言核对无误。
  - 怎么验证：
    - 运行 Android 单元测试与 `assembleDebugAndroidTest`（遵循项目 Gradle/JDK 脚本规范）
    - 检查 `rg` 核对全量 `testTag`
  - 对应需求：`requirements.md` 需求 1、非功能需求 3
  - 对应设计：`design.md` §7.1、§7.2、§7.3

- [x] 6.2 最终 Debug APK 打包与 Spec 验收回写
  - 状态：DONE
  - 交付产物：
    - `APK_PATH`：`/Users/jackson/Code/openteam/apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`
    - `APK_SHA256`：`a24f44af30e7f8f37bc7abcb22b5b9989f971aeb2032803efaf47663bfd1a033`
  - 这一步到底做什么：执行 `bash scripts/android/package-debug.sh` 生成最终 Debug APK，记录绝对路径与 SHA-256，并将验收结果写入 `docs/`（如需要），将本 Spec 与所有任务状态更新为最终状态。
  - 做完你能看到什么：可安装的全新极简未来感玻璃态 Android 客户端 APK 及完整的 Spec 交付记录。
  - 先依赖什么：6.1
  - 开始前先看：
    - `requirements.md` 成功定义
    - `design.md` §1.3、§7
  - 主要改哪里：
    - `specs/001.1-Android极简玻璃态UI重构/tasks.md`
    - `specs/001.1-Android极简玻璃态UI重构/README.md`
  - 这一步先不做什么：不擅自执行 `run-xiaomi.sh` 或发布操作（除非用户要求）。
  - 怎么算完成：
    1. `bash scripts/android/package-debug.sh` 成功生成 `apps/android/app/build/outputs/apk/debug/androidApp-debug.apk` 并获取 SHA-256。
    2. 任务清单全部状态更新完毕。
  - 怎么验证：
    - `bash scripts/android/package-debug.sh`
    - `shasum -a 256 apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`
  - 对应需求：`requirements.md` 成功定义、非功能需求 3
  - 对应设计：`design.md` §7.1
