# 需求文档 - Outcome 由 Agent 驱动的规划与审阅

状态：Draft

## 简介

目前目标的规划是程序固定调用模型：`OutcomePlanningService` 拼提示词、一次性生成选项，"修改"也走同一条路径。程序决定"这一步是什么"，模型只被当成文本生成函数。用户在待批准的目标上输入"取消目标"，系统仍然生成了一份取消目标的规划，而不是取消目标。

本 Spec 把规划、修改、取消、追问全部改为机器人（PI Agent）的回合：用户的话直接交给目标专属线程，机器人自己判断并用工具写入结果。程序只保证安全边界与事实正确。成果简报、摘要、验收预审只是后台展示内容，不涉及用户意图，沿用现有的后台一次性 LLM 生成。

## 术语表

- **System**：OutcomeGo 服务端、computer 运行时与桌面端
- **目标线程（OutcomeThread）**：每个目标一个专属 Agent 线程，承载规划、修改、简报、预审等回合；与按工作项划分的执行线程（004.2）并列，二者都可在目标详情查看记录
- **线程回合（OutcomeThreadTurn）**：目标线程里的一次 Agent 回合，带用途 `purpose`
- **用途（purpose）**：`plan`（新建/探索转入）、`owner_message`（用户发来的话）
- **线程工具**：只在目标线程暴露的工具，如 `SaveOutcomeContract`
- **固定规划调用**：服务端直接调用 `/v1/inference` 生成规划选项的代码路径（本 Spec 删除）
- **后台生成**：成果简报、成果摘要、验收预审的一次性 LLM 生成（本 Spec 保留）

## 范围说明

### In Scope

- 目标线程与线程回合的数据模型、调度、恢复
- 用户在目标上的所有文字输入（修改、拒绝、取消、追问）交给目标线程
- 新建目标、探索想法转规划由目标线程完成
- 机器人自己撰写契约与修订，用户批准规则不变
- 桌面端、Android、iOS：去掉四步选项向导；目标详情显示线程记录并可发消息
- 删除服务端规划类固定调用、`/api/outcomes/plans` 与上一版加入的 `OutcomeReplan`
- 调试数据库中已有记录的更新
- 平台提示词与线程运行说明

### Out of Scope

- 批准、验收、取消的授权规则（仍然只有用户能批准和验收）
- 工作项执行线程的行为
- 成果简报、成果摘要、验收预审的生成方式（保留后台一次性 LLM）
- `TrackOutcome` / `CloseOutcome` 的语义

## 需求

### 需求 1：用户的话由机器人判断并处理

**用户故事：** 作为用户，我希望在目标上说的任何话都被机器人当成一句真正的话来理解，以便"取消"就是取消，"改成 X"就是修改，不明白时它会问我。

#### 验收标准

1. WHEN 用户在待批准的目标上提交文字 THEN System SHALL 把原文原样作为一条用户消息交给该目标的线程，不经过程序改写、模板包装或意图分类
2. WHEN 机器人判断用户要取消目标 THEN 机器人 SHALL 能在同一回合调用取消工具并取消目标，System SHALL NOT 生成任何规划
3. WHEN 机器人判断需要修改方案 THEN 机器人 SHALL 调用 `SaveOutcomeContract` 保存新版本，新版本为待批准
4. WHEN 机器人需要用户先选择或澄清 THEN 机器人 SHALL 通过回合最终回复向用户提问（第一版不在线程里提供 Decision 工具），目标保持原状态，用户在目标详情的线程里直接回复
5. WHEN 同一个 `clientRequestId` 重复提交 THEN System SHALL 只投递一次

### 需求 2：每个目标有专属线程，记录可查看

**用户故事：** 作为用户，我希望每个目标有自己的 Agent 线程，并能在目标详情里看到它做过什么，以便理解结果、追问或纠正。

#### 验收标准

1. WHEN 目标首次需要 Agent 参与 THEN System SHALL 为其创建唯一的目标线程，绑定该目标的执行机器人
2. WHEN 用户打开目标详情 THEN System SHALL 展示该目标线程的回合列表：用户消息、机器人回复、状态与失败原因（每回合的完整执行记录入口待做，目标是与执行记录一致）
3. WHEN 线程回合运行或排队中 THEN 详情 SHALL 显示"机器人处理中"及其用途，且用户可以继续输入新消息排在其后
4. WHEN 回合失败或被重启打断 THEN System SHALL 记录失败原因，并允许用户重新发送或由系统按恢复规则续跑（004.5）
5. WHEN 机器人在回合里给用户回复 THEN 回复 SHALL 显示在目标详情，且不要求用户去聊天窗口查找

### 需求 3：新建目标与探索想法转规划由机器人完成

**用户故事：** 作为用户，我希望把一句话或一个想法交给机器人，它自己判断要不要追问、怎么写契约，而不是让我走固定向导。

#### 验收标准

1. WHEN 用户在目标页提交任务描述并选择机器人 THEN System SHALL 创建状态为 `planning` 的目标和线程，并投递一条 `plan` 回合，请求立即返回，模态框可立即关闭
2. WHEN 探索想法被转为目标 THEN System SHALL 以同样方式创建目标并把想法全文交给线程，关联 `sourceExploreId`
3. WHEN 机器人在聊天里被要求新建目标 THEN 机器人 SHALL 直接以自己写的契约调用 `CreateOutcome`，不再调用 `PlanOutcome`
4. WHEN 描述不足以写出契约 THEN 机器人 SHALL 先提问，目标保持 `planning`

### 需求 4：契约由机器人撰写，批准权不变

**用户故事：** 作为用户，我希望机器人写出完整契约供我批准，而不是只给我一堆勾选项，同时机器人永远不能替我批准。

#### 验收标准

1. WHEN 机器人调用 `SaveOutcomeContract` THEN System SHALL 校验目标、验收标准、范围边界、预算并保存为待批准的新修订，沿用 004.2 的校验与冲突检测
2. WHEN 保存的契约与上一版本相同 THEN System SHALL 拒绝并说明没有变化
3. WHEN 任何线程工具、聊天工具或回合产出试图批准契约或验收成果 THEN System SHALL 拒绝，批准与验收只能由用户在界面完成
4. WHEN 用户批准待批准修订 THEN System SHALL 沿用现有流程启动执行，不受本 Spec 影响

### 需求 5：简报、摘要与预审保持后台生成

**用户故事：** 作为用户，我希望简报、成果摘要和验收建议继续在后台自动生成，以便打开目标时直接可读，而不增加额外的 Agent 开销。

#### 验收标准

1. WHEN 契约修订被保存（无论由用户界面还是 `SaveOutcomeContract`） THEN System SHALL 沿用现有后台流程预热成果简报
2. WHEN 工作项完成并等待验收 THEN System SHALL 沿用现有后台流程生成成果摘要与预审建议，凭证等级仍为 `ai_prereview`，仅供参考
3. WHEN 这类后台生成失败或超时 THEN System SHALL 记录失败并继续展示原始事实，不得阻塞批准或验收
4. WHEN 本 Spec 完成 THEN 这类后台生成 SHALL NOT 创建目标线程回合，也不改变目标状态

### 需求 6：状态由事实派生

**用户故事：** 作为用户，我希望目标状态和角标真实反映现在需要我做什么。

#### 验收标准

1. WHEN 目标没有已批准修订，且没有待批准修订或存在运行中的 `plan` / `owner_message` 回合 THEN 状态 SHALL 为 `planning`
2. WHEN 当前修订待批准且没有运行中的规划类回合 THEN 状态 SHALL 为 `pending_approval`
3. WHEN 回合失败 THEN 状态 SHALL 回到失败前能由事实推出的状态，不得停在 `planning`
4. WHEN 状态变化 THEN System SHALL 发出 `goal.status.changed`，列表与角标自动刷新

### 需求 7：移除固定规划流程

**用户故事：** 作为维护者，我希望代码里不再有"程序决定这一步"的规划流程，以便 Agent 的行为只由提示词和工具边界决定。

#### 验收标准

1. WHEN 本 Spec 完成 THEN 规划、修改、探索转规划相关的服务端代码 SHALL NOT 再调用 `/v1/inference`，并有测试保证；简报与预审服务不受此限
2. WHEN 本 Spec 完成 THEN `OutcomeReplan`、`PlanOutcome`、`GetOutcomePlan`、`ProposeExploreIdea` 的生成逻辑、`/api/outcomes/plans` 与三端的四步选项向导 SHALL 被移除
3. WHEN 存在升级前保存的待批准目标 THEN System SHALL 保持其可批准、可修改，修改时走目标线程
4. WHEN 升级调试数据库 THEN System SHALL 更新已有记录：移除 `outcome_replan` 数据并重新派生受影响目标的状态，保留既有目标、修订与简报
5. WHEN 移动端使用新版本 THEN Android 与 iOS SHALL 通过新接口新建目标、发送消息、查看线程记录，不再调用规划接口

### 需求 8：边界与可观测

**用户故事：** 作为用户，我希望给机器人更大自由的同时，危险动作仍然受控。

#### 验收标准

1. WHEN 目标管理开关关闭（004 开关设置）THEN System SHALL 不创建线程与回合，线程工具不暴露
2. WHEN 线程回合想执行取消 THEN System SHALL 要求该线程最近一条触发消息来自用户，否则拒绝
3. WHEN 回合调用线程工具 THEN System SHALL 记录审计事件，含线程、回合、调用者机器人
4. WHEN 排查问题 THEN 每个回合 SHALL 可通过 `runId` 在目标详情和日志里定位

## 非功能需求

### 非功能需求 1：性能

1. WHEN 用户提交消息 THEN System SHALL 在 1 秒内返回回合已排队，不等待模型
2. WHEN 打开目标详情 THEN System SHALL 不因线程记录而额外等待模型

### 非功能需求 2：可靠性

1. WHEN 服务重启 THEN 排队中的回合 SHALL 保留，运行中的回合按 004.5 恢复规则续跑或标记失败
2. WHEN 机器人没有容量（每机器人 2 个并发子线程上限） THEN 回合 SHALL 排队，用户消息优先于 `brief`、`review_prep`

### 非功能需求 3：可维护性

1. WHEN 调整机器人行为 THEN System SHALL 只需修改提示词与工具描述，不需要修改调度代码
2. WHEN 新增线程用途 THEN System SHALL 只需增加 `purpose` 与对应提示，不增加新的服务端生成路径

## 成功定义

- 用户写"取消目标"，机器人取消目标，不出现任何规划界面。
- 用户写"改成 X"，机器人保存新修订，用户看到待批准的新契约。
- 规划相关服务端代码中没有 `/v1/inference` 调用（测试断言）。
- Android 与 iOS 能新建目标并向机器人发消息。
- 目标详情能看到线程记录，并在其中追问。
