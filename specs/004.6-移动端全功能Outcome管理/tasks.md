# 任务清单 - 移动端全功能 Outcome 管理

状态：Completed

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

---

## 阶段 1：KMP 共享层与网关契约扩展

- [x] 1.1 扩展 `mobile/shared` Outcome 与 Explore 模型及传输 API
  - 状态：DONE
  - 这一步到底做什么：在 `mobile/shared` 补齐全功能 Outcome 所需的请求/响应模型与 `TransportOutcomeApi`、`TransportOutcomeInboxApi`、`TransportExploreApi` 方法，并编写 `commonTest` 单测。
  - 做完你能看到什么：KMP 共享层具备规划、创建、修订、批准、运行、取消、Transcript、验收、返工、人工动作控制/回执、知识检索阅读、探索想法的完整类型化调用能力，且单测通过。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 3、4、5、6、7
    - `design.md` §3.2、§3.3
  - 主要改哪里：
    - `mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/Outcomes.kt`
    - `mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/OutcomeInbox.kt`
    - `mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/OutcomeExplore.kt`（新建）
    - `mobile/shared/src/commonTest/kotlin/com/outcomego/mobile/core/OutcomeReadTests.kt`
  - 这一步先不做什么：暂不改动 Android Compose UI。
  - 怎么算完成：
    1. 所有 §3.3 契约接口均已在 `mobile/shared` 实现。
    2. 序列化与路径构造单元测试通过。
  - 怎么验证：
    - 运行 `./gradlew :mobile:shared:jvmTest`（或等效 KMP 测试任务）确认全绿。
  - 对应需求：`requirements.md` 需求 3、4、5、6、7
  - 对应设计：`design.md` §3.2、§3.3

- [x] 1.2 扩展 Android `FeatureGateway` 与 `LiveFeatureGateway`
  - 状态：DONE
  - 这一步到底做什么：在 `FeatureContracts.kt`、`FeatureGatewayDefaults.kt`、`LiveFeatureGateway.kt` 中暴露上述全部 Outcome / HumanWork / Explore 接口。
  - 做完你能看到什么：Android UI 层可通过 `FeatureGateway` 统一调用所有新增的 Outcome 写操作、Transcript 与 Explore 能力。
  - 先依赖什么：1.1
  - 开始前先看：
    - `design.md` §2.2、§3.3
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/FeatureContracts.kt`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/FeatureGatewayDefaults.kt`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/LiveFeatureGateway.kt`
  - 这一步先不做什么：暂不修改页面 UI。
  - 怎么算完成：
    1. `FeatureGateway` 接口与 `LiveFeatureGateway` 实现编译通过，测试替身/默认实现不报错。
  - 怎么验证：
    - 运行 `:mobile:androidApp:testDebugUnitTest` 编译并验证已有单测。
  - 对应需求：`requirements.md` 需求 3、4、5、6、7
  - 对应设计：`design.md` §2.2、§3.3

---

## 阶段 2：Bot 列表左滑呼出与工作台主框架

- [x] 2.1 实现 Bot 列表左滑呼出 Outcome 工作台与对称抽屉动画
  - 状态：DONE
  - 这一步到底做什么：在 `DirectoryScreen.kt` 增加左滑手势触发 `onOutcomes()`，在 `OutcomeGoApp.kt` 注册 `OUTCOME_WORKSPACE` 路由与对称右侧抽屉转场动画（右滑返回 Bot 列表），并保留原有的设置页与收件箱深链入口。
  - 做完你能看到什么：在 Bot 列表右滑打开设置、左滑打开 Outcome 工作台；在工作台首页右滑返回 Bot 列表。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1、§2.3.1
  - 主要改哪里：
    - `apps/android/app/src/main/java/com/outcomego/android/ui/screens/directory/DirectoryScreen.kt`
    - `apps/android/app/src/main/java/com/outcomego/android/ui/OutcomeGoApp.kt`
    - `apps/android/app/src/main/java/com/outcomego/android/ui/designsystem/SpatialMotion.kt`（如需补充右侧抽屉动画辅助函数）
  - 这一步先不做什么：暂不在本步堆砌所有子页面细节，先接通工作台壳层。
  - 怎么算完成：
    1. Bot 列表左滑可打开工作台，工作台根页面右滑可返回 Bot 列表。
    2. 设置页右滑呼出、左滑关闭行为不受影响。
  - 怎么验证：
    - 编译验证并检查手势阈值与导航回退栈行为。
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.1、§2.3.1

- [x] 2.2 实现 `OutcomeWorkspaceScreen` 三栏工作台与“全部目标 / 待处理 / 探索想法”视图
  - 状态：DONE
  - 这一步到底做什么：参考桌面端 `OutcomeWorkspace`，使用 `SpatialGlass` 风格实现移动端工作台主页面，包含顶部栏（标题 + 新建目标按钮）、三栏 Tab（全部目标 / 待处理 / 探索想法）、状态筛选、分页加载及右滑返回。
  - 做完你能看到什么：进入工作台后可流畅切换“全部目标”、“待处理”、“探索想法”，并支持探索想法的创建、生成提案与丢弃操作。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 7
    - `design.md` §2.2、§3.1
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/OutcomeWorkspaceScreen.kt`（新建或整合到 `OutcomeScreens.kt`）
    - `apps/android/app/src/main/kotlin/com/outcomego/features/OutcomeScreens.kt`
    - `apps/android/app/src/main/kotlin/com/outcomego/features/OutcomeInboxScreens.kt`
  - 这一步先不做什么：规划向导与详情全操作在阶段 3 完成。
  - 怎么算完成：
    1. 三栏 Tab 可正常加载、筛选、分页与刷新。
    2. Explore 标签页支持创建想法、生成提案、丢弃想法及 404 降级提示。
  - 怎么验证：
    - 编译与单元测试验证。
  - 对应需求：`requirements.md` 需求 2、需求 7
  - 对应设计：`design.md` §2.2、§3.1

---

## 阶段 3：全功能子页面（规划向导、详情全操作、人工动作闭环）

- [x] 3.1 实现新建目标与规划向导（`OutcomePlanningScreen`）
  - 状态：DONE
  - 这一步到底做什么：实现移动端规划向导，支持选择执行 Bot、输入目标描述与可选预算、生成并轮询规划草案、审阅目标条款与验收标准后确认创建目标并进入详情。
  - 做完你能看到什么：点击工作台“新建目标”即可在手机上完成目标规划与创建全流程。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3.2
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/OutcomePlanningScreen.kt`（新建）
    - `apps/android/app/src/main/kotlin/com/outcomego/features/OutcomeWorkspaceScreen.kt`
  - 这一步先不做什么：不修改服务端规划逻辑。
  - 怎么算完成：
    1. 支持生成规划、轮询状态、确认创建并跳转至新目标详情。
  - 怎么验证：
    - 单元测试 + 实机联调验证。
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §2.3.2

- [x] 3.2 升级 `OutcomeDetailScreen` 支持契约修订/批准、运行/取消、Transcript 与验收/返工
  - 状态：DONE
  - 这一步到底做什么：移除“请在 Desktop 完成”提示，补齐契约修订查看/编辑/批准、启动运行、取消目标（含原因输入）、工作项 Transcript 分页查看，以及验收标准逐条评审（PASS/FAIL + 评语）和退回返工。
  - 做完你能看到什么：目标详情页具备与桌面端对等的全部管理与验收能力。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §2.3.3、§4.2
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/OutcomeScreens.kt`
  - 这一步先不做什么：不改动人工动作内部表单（在 3.3 完成）。
  - 怎么算完成：
    1. 契约修订、批准、运行、取消、Transcript、验收与返工全部可操作且状态同步刷新。
  - 怎么验证：
    - 单元测试 + 实机联调验证。
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §2.3.3、§4.2

- [x] 3.3 升级 `OutcomeHumanActionScreen` 支持开始/暂停、知识检索阅读与回执提交
  - 状态：DONE
  - 这一步到底做什么：移除“请在 Desktop 完成”提示，为人工工作项增加“开始”、“暂停”按钮，增加知识资料搜索与正文阅读弹窗，以及动态输入字段/说明的回执提交表单。
  - 做完你能看到什么：在手机上可完整接管人工工作项、查阅资料并提交回执。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §2.3.3、§3.3
  - 主要改哪里：
    - `apps/android/app/src/main/kotlin/com/outcomego/features/OutcomeInboxScreens.kt`
  - 这一步先不做什么：不改动决策（Decision）既有逻辑。
  - 怎么算完成：
    1. 开始/暂停、知识检索与阅读、回执提交均可正常执行并刷新状态与回执历史。
  - 怎么验证：
    - 单元测试 + 实机联调验证。
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §2.3.3、§3.3

---

## 阶段 4：测试、打包与真机验证

- [x] 4.1 补全单元测试并打包安装到 `10.255.0.204` 真机验证
  - 状态：DONE
  - 这一步到底做什么：运行 `mobile/shared` 与 `apps/android` 全部单元测试，使用 `bash scripts/android/package-debug.sh` 构建 Debug APK，并安装至 `10.255.0.204:5555` 验证核心交互与页面展示。
  - 做完你能看到什么：全部测试通过、APK 成功构建并安装启动，Spec 任务全部更新为 `DONE`。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：
    - `requirements.md` 非功能需求 1、2
  - 主要改哪里：
    - `specs/004.6-移动端全功能Outcome管理/tasks.md`
  - 这一步先不做什么：不修改无关模块。
  - 怎么算完成：
    1. KMP 与 Android 单元测试全部通过。
    2. `package-debug.sh` 成功输出 APK 路径与 SHA-256。
    3. 设备 `10.255.0.204:5555` 安装并启动成功。
  - 怎么验证：
    - `./gradlew :mobile:shared:jvmTest :mobile:androidApp:testDebugUnitTest`
    - `bash scripts/android/package-debug.sh`
    - `bash scripts/android/run-xiaomi.sh --device 10.255.0.204:5555 --no-build`
  - 对应需求：`requirements.md` 非功能需求 1、2
  - 对应设计：`design.md` §1、§5
