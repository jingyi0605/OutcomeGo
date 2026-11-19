# 任务清单 - Outcome 任务看板与自动登记

状态：In Progress

## 状态说明

`TODO` / `IN_PROGRESS` / `BLOCKED` / `IN_REVIEW` / `DONE` / `CANCELLED`

---

## 阶段 1：契约与数据

- [x] 1.1 数据库增加 `trackingMode`、`autoClosedAt`、`closeSummary` 与迁移
  - 状态：DONE
  - 开始前先看：`requirements.md` 需求 1、2；`design.md` §3.2
  - 主要改哪里：`packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/202611190001_add_outcome_tracking/`
  - 验证：`prisma generate` 通过；迁移文件与 schema 一致
- [x] 1.2 契约：新增 `TrackOutcome`、`CloseOutcome` 与 `OutcomeDetail` 字段
  - 状态：DONE
  - 开始前先看：`design.md` §3.3
  - 主要改哪里：`packages/contracts/src/outcome-chat.ts`、`packages/contracts/src/outcomes.ts`、`packages/contracts/src/tool-contracts.ts`
  - 验证：`packages/contracts/test/outcome-chat.test.ts`（需求 1.4）

## 阶段 2：服务端

- [x] 2.1 `OutcomeService.track` / `closeTracked`
  - 状态：DONE
  - 开始前先看：`requirements.md` 需求 1、2；`design.md` §2.3.1、§2.3.2
  - 主要改哪里：`apps/server/src/services/outcome-service.ts`
  - 验证：集成测试（需求 1.1–1.3、2.1–2.5）
- [x] 2.2 决策路径：状态派生与无 WorkItem 解决
  - 状态：DONE
  - 开始前先看：`requirements.md` 需求 3；`design.md` §2.3.3、§4.2
  - 主要改哪里：`packages/messaging/src/outcome-state.ts`、`apps/server/src/services/decision-service.ts`、`packages/contracts/src/outcome-inbox.ts`
  - 验证：集成测试（需求 3.1–3.3）
- [x] 2.3 工具派发与装配
  - 状态：DONE
  - 主要改哪里：`apps/server/src/services/outcome-chat-tools.ts`
  - 验证：集成测试经 `InternalToolService` 调用

## 阶段 3：bot 行为与展示

- [x] 3.1 平台提示词准则与版本号
  - 状态：DONE
  - 开始前先看：`requirements.md` 需求 4；`design.md` §2.4
  - 主要改哪里：`packages/messaging/src/prompts/platform.json`
  - 验证：提示词相关现有测试通过
- [x] 3.2 桌面端"自动结束"标记
  - 状态：DONE
  - 开始前先看：`requirements.md` 需求 5
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/outcomes/detail/outcome-detail.tsx`、`i18n-catalog.ts`
  - 验证：`apps/desktop/test/outcome-detail.test.ts`

## 最终检查

- [ ] 4.1 现有 Outcome 相关测试全部通过
  - 状态：IN_REVIEW
  - 结果：新增契约与集成测试通过；桌面端目标测试 48 项通过；server/messaging 回归中仅剩 5 项失败，均与本 Spec 无关（撤掉本 Spec 的核心改动后仍失败）：`outcome-context.test.ts` 提示词基线 2 项（基线夹具缺"原生目标"章节）、`outcome-inbox-service.test.ts` 与 `outcome-notifications.test.ts` 各 1 项（通知投影向频道写消息）、`outcomego-marketplace.test.ts` 1 项（插件数 25 与已提交的 Codingns4DSH 插件后的 26 不符）
- [ ] 4.2 同步并重建远端 computer 后做端到端验证（需用户同意重建，见 AGENTS.md "Remote Debug Computer"）
  - 状态：TODO
  - 阻塞原因：新工具在 `packages/contracts`，只有同步并重建远端 computer 后 bot 才能调用；重建会中断正在运行的 bot 任务，需先征得用户同意
