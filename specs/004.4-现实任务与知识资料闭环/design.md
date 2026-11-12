# 设计文档 - 现实任务与知识资料闭环

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. KnowledgeProvider

```ts
interface KnowledgeProvider {
  search(input: KnowledgeQuery): Promise<KnowledgeReference[]>;
  get(referenceId: string): Promise<KnowledgeDocument | null>;
}
```

`KnowledgeReference` 至少包含：

- `referenceId`
- `title`
- `source`
- `version`
- `updatedAt`
- `projectScope`
- `permissionSummary`
- `relevance`

Provider 只负责资料读取和来源说明，不负责授权 Contract 或改变任务范围。

## 2. Human WorkItem

```ts
interface HumanActionCard {
  workItemId: string;
  purpose: string;
  steps: string[];
  inputs: string[];
  expectedEvidence: EvidenceRequirement[];
  references: KnowledgeReference[];
  status: 'pending' | 'in_progress' | 'submitted' | 'accepted' | 'rejected';
}
```

人工回执可以是文本、文件、照片、日志、测试结果或外部记录引用。

## 3. 状态流

```text
Outcome / WorkItem
        ↓
KnowledgeProvider 资料引用
        ↓
HumanActionCard
        ↓
人工执行
        ↓
Receipt / Evidence
        ↓
Acceptance review
```

## 4. 探索轨和交付轨

- `Explore` 保存未形成正式 Contract 的想法和调查。
- `Delivery` 只包含已确认目标、验收和边界的 Outcome。
- 探索结果可以建议创建新的 Outcome，但不能直接修改已有 Contract。

## 5. 数据隔离

资料引用必须携带项目范围。跨项目复用资料时，需要明确来源和适用范围，不把历史资料自动视为当前项目事实。

## 6. 当前代码映射

实现前必须先查明当前资料和文件能力，优先复用：

| 现有能力 | 可能位置 | 设计用途 |
|---|---|---|
| Agent 文件状态 | `apps/computer/src/agent-store/`、`packages/db` 的 `AgentFileState` | 读取项目资料的来源和 digest |
| 文件/附件 | `packages/messaging/src/asset-store.ts`、`apps/server/src/services/asset-service.ts` | 保存人工回执和大文件引用 |
| 消息附件 | `apps/server/src/services/channel-service.ts`、`packages/contracts/src/messages-send.ts` | 将用户提交材料写入现有路径 |
| 用户/项目身份 | `Bot`、`Channel`、`Conversation`、现有 settings | 形成项目范围，不新增组织 RBAC |
| Desktop 文件操作 | `apps/desktop/src/main/host/file-transfer.ts` 等 | 仅在现有授权范围内提供上传入口 |

## 7. KnowledgeProvider 详细合同

```ts
type KnowledgeScope = {
  projectScope: string; // "bot:<botId>" | "fixture:<fixtureId>"，见 §15
  outcomeId: string;
  contractRevision: number;
  allowedSources?: string[];
};

type KnowledgeQuery = {
  text: string;
  scope: KnowledgeScope;
  limit: number;
};

type KnowledgeReference = {
  id: string;
  title: string;
  sourceType: "file" | "message" | "url" | "fixture";
  sourceRef: string;
  version?: string;
  updatedAt?: string;
  projectScope?: string;
  excerpt?: string;
  stale: boolean;
};

interface KnowledgeProvider {
  search(query: KnowledgeQuery): Promise<KnowledgeReference[]>;
  read(reference: KnowledgeReference): Promise<{ text: string; digest?: string }>;
}
```

Provider 适配器必须返回稳定来源 ID和摘要。它不得返回无来源的模型生成文本，也不得把资料检索结果直接写入 Contract。

## 8. Human WorkItem 和回执模型

```text
HumanWorkItem:
id, outcomeId, contractRevisionId, title, purpose, prerequisites,
steps JSON, inputRefs JSON, expectedEvidence JSON,
executorId, status, startedAt, submittedAt, acceptedAt

HumanReceipt:
id, workItemId, outcomeId, submittedBy, payload JSON,
assetRefs JSON, sourceRefs JSON, submittedAt, status, reviewComment
```

如果现有 WorkItem 模型可以容纳 `executorType=human`，优先扩展它；否则新增最小表并通过 `workItemId` 与 Outcome 关联。不得在 `ChannelMessage.content` 中编码完整的动作卡状态。

## 9. 人工动作卡接口

```text
GET  /api/v0/outcomes/:outcomeId/work-items
GET  /api/v0/work-items/:workItemId
POST /api/v0/work-items/:workItemId/start
POST /api/v0/work-items/:workItemId/receipts
POST /api/v0/work-items/:workItemId/review
```

回执请求示例：

```json
{
  "clientRequestId":"receipt:<workItemId>:<device-id>:1",
  "comment":"现场网络检查完成",
  "assetRefs":["asset:<id>"],
  "sourceRefs":[{"type":"test-log","ref":"<id>"}],
  "observations":[{"criterionId":"<id>","result":"observed","value":"pass"}]
}
```

服务端先验证 WorkItem 属于该 Outcome、revision 匹配，再写回执；提交人记录为 actorRef（父 design.md §44）。重复 clientRequestId 返回同一个 HumanReceipt。

## 10. 探索/交付状态

```text
ExploreIdea:
draft → exploring → proposed_for_delivery → converted / discarded

Delivery Outcome:
draft → planning → pending_approval → approved → running → accepted
```

转换操作创建新 Outcome 或新 Contract revision，不能把探索记录直接改造成已批准交付对象。

## 11. 文件影响清单

- `packages/contracts/src/knowledge.ts`（新增）
- `packages/contracts/src/human-work.ts`（新增）
- `packages/contracts/src/outcomes.ts`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<generated>_add_human_work/`
- `apps/server/src/services/knowledge-provider.ts`（新增）
- `apps/server/src/services/knowledge-file-provider.ts`（新增）
- `apps/server/src/services/human-work-service.ts`（新增）
- `apps/server/src/routes/human-work.ts`（新增）
- `apps/server/src/services/asset-service.ts`
- `apps/desktop/src/renderer/components/outcomego/outcomes/HumanActionCard.tsx`（新增）
- `apps/desktop/src/renderer/components/outcomego/outcomes/ReceiptForm.tsx`（新增）
- `apps/desktop/src/renderer/client/outcomego-api.ts`
- `apps/ios/Sources/App/` 中的 Outcome/receipt 页面（按现有导航组织）
- `apps/android/app/src/main/kotlin/com/outcomego/features/` 中的 Outcome/receipt 页面（按现有导航组织）

## 12. 验证策略

- provider 返回来源、版本、stale 和项目范围的契约测试。
- 跨项目资料不可见和失效资料展示测试。
- Human WorkItem 状态转换和暂停恢复测试。
- 回执幂等、asset 引用、缺失材料、驳回和重新提交测试。
- Agent 生成建议不能直接改变 WorkItem 状态的服务端测试。
- Desktop/mobile 动作卡填写、上传、错误和重新打开测试。
- Explore 转 Delivery 产生新 PlanningDraft 的集成测试。

## 13. Provider 实现边界

### 13.1 Provider 生命周期

```text
create provider
  → validate scope
  → search references
  → filter permission/stale/scope
  → return references
  → read selected reference
  → attach digest/version to WorkItem
```

Provider 不应该在 `search` 阶段把全部正文写入数据库。搜索结果只保存来源、摘要和引用 ID；用户或 Agent 选择资料后才执行 `read`，并将读取版本固定到当前 WorkItem。

### 13.2 Provider 错误

| 错误 | 服务端结果 | 用户可见结果 |
|---|---|---|
| source unavailable | 保留 WorkItem，创建资料缺失状态 | “资料暂时不可用” |
| permission denied | 不返回正文 | “没有权限读取该资料” |
| stale reference | 返回引用并标记 stale | 需要确认是否继续 |
| source changed | 重新读取并比较 digest | 显示版本变化 |
| provider timeout | 可按查询重试一次 | 提供重试操作 |
| malformed document | 记录 provider error | 建议人工上传或跳过 |

Provider 错误不能自动改变 Contract 的 acceptance 或 boundaries。

## 14. 资料引用版本

每个引用必须有稳定的 `sourceRef` 和可选 digest：

```ts
interface ResolvedKnowledgeReference {
  referenceId: string;
  sourceType: "file" | "message" | "url" | "fixture";
  sourceRef: string;
  sourceVersion?: string;
  digest?: string;
  retrievedAt: string;
  applicableProjectId?: string;
  applicableContractRevision: number;
}
```

当同一资料在执行期间发生变化：

1. 已经写入 Evidence 的引用保持原 digest。
2. 尚未开始的 WorkItem 可以读取最新版本，但必须更新引用记录。
3. 已经开始且验收依赖旧版本的 WorkItem 进入 Decision 或 Review，不自动替换证据。

## 15. 项目范围解析

当前仓库没有完整组织级 project entity 时，第一版项目范围必须使用现有可表达的身份：

第一版固定为：

```text
projectScope = "bot:<Outcome.botId>"     # 正式资料
             | "fixture:<fixtureId>"      # 测试资料
```

`bot:<botId>` 与 `AgentFileState.botId` 对齐，ProjectFileKnowledgeProvider 只返回该 Bot 的文件。`channel` 和显式 project id 不在第一版实现（父 design.md §39）。

Scope 解析必须集中在 `KnowledgeScopeService`，不能由每个 provider 自己解释。解析结果记录在 `KnowledgeReference.projectScope`，以便测试和审计。

禁止使用“最近打开的项目”“模型猜测的客户名”作为唯一 scope。缺少明确 scope 时，provider 只能返回公共 fixture 或要求用户补充。

## 16. Human WorkItem 状态机

```text
pending
  → ready
  → in_progress
  → submitted
  → review_pending
  → accepted

in_progress → paused | cancelled
submitted → review_pending | rejected
review_pending → accepted | rejected
rejected → in_progress | cancelled
accepted → 不可回退，除非创建新的 revision/work item
```

状态转换要求：

- `start` 只能从 `pending`/`ready` 进入 `in_progress`。
- `pause` 保存当前表单草稿和最后查看资料。
- `submit` 必须验证必填回执结构，不要求立即通过业务验收。
- `reject` 必须包含 reviewer comment 和缺失条款。
- `accept` 必须写 Review 和 Evidence 关联。
- 任何客户端刷新都从服务端状态恢复，不从按钮点击推导完成。

## 17. 动作卡数据合同

```ts
interface HumanActionCardView {
  id: string;
  workItemId: string;
  outcomeId: string;
  contractRevision: number;
  title: string;
  purpose: string;
  prerequisites: Array<{ label: string; completed: boolean }>;
  steps: Array<{ id: string; ordinal: number; text: string; optional: boolean }>;
  inputFields: Array<{
    id: string;
    label: string;
    type: "text" | "number" | "boolean" | "selection" | "asset";
    required: boolean;
  }>;
  evidenceRequirements: Array<{
    criterionId: string;
    label: string;
    acceptedTypes: string[];
    required: boolean;
  }>;
  references: KnowledgeReference[];
  status: HumanWorkItemStatus;
}
```

动作卡的 `steps` 是执行说明，不是自动化命令。若包含命令或外部系统操作，必须标注“由人执行”，并将实际结果通过回执提交。

## 18. 回执数据处理

### 文本回执

保存摘要、原文引用、提交人和时间。长文本使用现有 asset/message 存储策略，不塞进 WorkItem 行。

### 文件/照片/日志

1. 客户端先通过现有 asset upload 获取 `assetRef`。
2. 服务端检查 asset 存在，且未被其他 WorkItem 的回执引用。
3. Receipt 事务只保存 assetRef、类型、摘要和 digest。
4. Review 页面通过授权接口读取 asset。

### 外部记录

外部记录只保存 URL/record ID、来源系统、读取时间和人工说明。系统不把无法读取的外部链接当成已验证证据。

## 19. 回执幂等和附件一致性

回执 key：

```text
human-receipt:<workItemId>:<clientRequestId>
```

上传流程分两阶段：

```text
asset upload
  → assetRef
  → receipt submit
  → transactional receipt + evidence refs
```

如果 receipt transaction 失败，asset 可以进入未关联资产清理队列，但不能创建半完成的 accepted WorkItem。重复提交相同 request hash 返回原 Receipt；不同 payload 返回 `409 idempotency_conflict`。

## 20. Reviewer 和验收

Reviewer 只能审阅其有权访问的 Outcome。Review 请求必须带：

```json
{
  "workItemId":"<id>",
  "contractRevision":1,
  "criterionResults":[
    {"criterionId":"<id>","result":"PASS","evidenceIds":["<id>"],"comment":"..."}
  ],
  "decision":"accept",
  "comment":"..."
}
```

服务端重新加载条款和 Evidence，不能信任客户端提交的 criterion statement、required 标志或 revision 内容。

## 21. Explore/Delivery 数据流

```text
用户想法
  → ExploreIdea(draft)
  → provider research / notes
  → ExploreIdea(proposed_for_delivery)
  → 新 PlanningDraft
  → 新 Outcome
  → 独立 ContractRevision
```

ExploreIdea 可以引用已有 Outcome，但不得共享可变的 Contract JSON。转交后，原探索记录保持只读，新的 Outcome 记录 `sourceExploreId`。

## 22. 人工任务和 Agent 任务的统一查询

Outcome 查询返回统一 WorkItem view：

```ts
interface WorkItemView {
  id: string;
  executorType: "agent" | "human";
  status: string;
  title: string;
  outcomeId: string;
  contractRevision: number;
  runId?: string;
  humanActionCardId?: string;
  evidenceCount: number;
  nextAction?: string;
}
```

客户端根据 `executorType` 渲染 Agent 运行摘要或 HumanActionCard，不依赖标题文本猜测执行类型。

## 23. 文件影响清单扩展

### Server

- `apps/server/src/services/knowledge-provider.ts`
- `apps/server/src/services/knowledge-scope-service.ts`
- `apps/server/src/services/knowledge-file-provider.ts`
- `apps/server/src/services/human-work-service.ts`
- `apps/server/src/services/human-receipt-service.ts`
- `apps/server/src/routes/human-work.ts`
- `apps/server/src/routes/client.ts`（现有 `POST /api/assets` 上传入口，只核对，不新增 route）
- `apps/server/src/services/outcome-review-service.ts`

### Contracts/DB

- `packages/contracts/src/knowledge.ts`
- `packages/contracts/src/human-work.ts`
- `packages/contracts/src/outcomes.ts`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<generated>_add_human_work/`
- `packages/db/test/human-work.integration.test.ts`

### Desktop/mobile

- `apps/desktop/src/renderer/components/outcomego/outcomes/HumanActionCard.tsx`
- `apps/desktop/src/renderer/components/outcomego/outcomes/ReceiptForm.tsx`
- `apps/desktop/src/renderer/components/outcomego/outcomes/KnowledgeReferences.tsx`
- `apps/desktop/src/renderer/client/outcomego-api.ts`
- `apps/android/app/src/main/kotlin/com/outcomego/features/`
- `apps/ios/Sources/App/`
- `mobile/shared/src/commonMain/kotlin/com/outcomego/mobile/core/Models.kt`（仅当共享 DTO 确实需要）

## 24. 客户端行为

### Desktop

- 默认显示当前步骤和下一步。
- 资料引用可以展开，不自动插入到用户的提交文本。
- 上传失败允许重试，不清空已填写表单。
- 关闭页面后从服务端恢复 `in_progress` 状态。

### Android/iOS

- 第一版只提供只读动作卡（父 design.md §41），回执上传在 Desktop 完成；移动端显示“请在 Desktop 完成”。
- 网络断开后显示本地未提交草稿，但提交前重新获取 revision。
- 文件上传完成后再提交 receipt，不把本地路径当成服务端 Evidence。

## 25. 验证矩阵

| 测试 | 输入 | 期望 |
|---|---|---|
| provider scope | project A query | 只返回 A 资料 |
| stale source | digest changed | 标记 stale，不自动替换 |
| permission denied | source B | 无正文、可解释错误 |
| action start | pending work item | in_progress + startedAt |
| pause/resume | partial form | 表单保留 |
| receipt retry | same key/hash | 同一 receipt |
| receipt conflict | same key/different hash | 409 |
| missing evidence | required asset absent | review_pending/UNVERIFIED |
| rejection | reviewer fail | rejected + comment |
| acceptance | all required pass | accepted + Outcome continuation |
| explore conversion | explore idea | new PlanningDraft, old idea immutable |

## 26. 数据清理和保留

- 未关联 asset 由现有清理机制按状态清理，不影响已提交 Receipt。
- Explore 草稿可以按现有用户数据保留规则清理，但已引用到 Delivery 的记录不得删除。
- Evidence 和 Review 是验收历史，不能因为用户重新提交回执而覆盖；新提交产生新版本或新记录。
- provider 缓存如果存在，必须标记来源和过期时间，不能作为唯一业务事实。

## 27. 设计决策记录

实现前必须记录：

- 第一版实际使用哪个 KnowledgeProvider。
- 项目 scope 从哪个现有实体解析。
- Human WorkItem 是扩展 `WorkItem` 还是新建表。
- 大文件是否复用现有 asset store。
- Android/iOS 是否进入第一版人工闭环。
- Reviewer 是否必须是用户本人，还是沿用当前唯一用户身份。
- ExploreIdea 是否作为数据库模型，还是以现有记录/草稿模型表示。

## 28. KnowledgeProvider 的第一版实现

第一版实现建议使用两个 provider：

```text
FixtureKnowledgeProvider
  → 用于确定性测试和验收

ProjectFileKnowledgeProvider
  → 读取当前项目允许的文件/消息/asset 引用
```

两个 provider 必须实现相同接口。Fixture provider 不应被生产环境默认启用；ProjectFile provider 不应跨项目搜索。

### 28.1 Provider registry

```ts
interface KnowledgeProviderRegistry {
  register(provider: KnowledgeProvider): void;
  get(providerId: string): KnowledgeProvider;
  listCapabilities(scope: KnowledgeScope): ProviderCapability[];
}
```

Registry 的选择由服务端配置和 Outcome scope 决定。用户请求不能直接提交任意 provider ID 以绕过范围规则。

## 29. 文件读取和 source adapter

### 29.1 文件来源

如果项目资料来自 Agent file store：

1. 通过现有 Agent/asset service 查询文件 metadata。
2. 检查 bot/project/outcome scope。
3. 读取文件并计算 digest。
4. 将摘要和 sourceRef 返回给 provider caller。

如果资料来自消息：

1. 使用 `ChannelMessage` ID 或 asset ID作为 sourceRef。
2. 检查消息所属 channel 与当前 Outcome 的关系。
3. 只读取允许的正文/附件。
4. 保存 message sequence 和 createdAt 作为版本上下文。

### 29.2 不支持的文件

无法提取正文的文件可以作为 Evidence/source reference 展示，但不得伪造内容摘要。系统应返回 `unreadable_source` 并允许用户上传文本或人工说明。

## 30. Knowledge cache

第一版可以不做持久化全文缓存。若需要短期缓存，缓存 key 必须包括：

```text
providerId
sourceRef
sourceVersion/digest
projectScope
```

缓存命中不能绕过最新权限检查。资料权限变化后，缓存读取仍需重新检查当前 scope。

## 31. 资料引用到 Agent context

Agent context 只包含选中的引用和有界摘要：

```json
{
  "knowledge": [
    {
      "referenceId":"<id>",
      "title":"现场网络检查清单",
      "sourceRef":"file:<id>",
      "version":"2026-11-11",
      "excerpt":"检查 DHCP、DNS 和出口连通性",
      "digest":"<digest>"
    }
  ]
}
```

Agent 不自动获得 provider 的访问 token 或任意项目文件路径。需要读取全文时由服务端按 reference ID 提供已授权内容。

## 32. HumanActionCard 创建流程

```text
approved Contract
  → identify executorType=human
  → create HumanWorkItem
  → resolve references
  → create action card snapshot
  → publish human_action.required
```

动作卡快照保存生成时的 steps、references 和 evidence requirements。资料更新不会静默改变已经开始的动作卡；需要变化时创建新 revision 或 Decision。

## 33. Human WorkItem API

### `GET /work-items`

必须支持按 Outcome、status 和 executor type 查询，并返回 evidence count 和 next action。

### `POST /work-items/:id/start`

请求：

```json
{
  "clientRequestId":"human-start:<workItemId>:<clientId>",
  "expectedContractRevision":1
}
```

服务端条件更新 `pending/ready → in_progress`，重复请求返回原 `startedAt`。

### `POST /work-items/:id/pause`

保存：

- 当前 step ID。
- 表单草稿摘要。
- 已读取 reference IDs。
- pause reason。

不保存未提交的 secret 字段和超出表单合同的任意客户端 payload。

### `POST /work-items/:id/receipts`

要求：

- `clientRequestId`。
- `expectedContractRevision`。
- observations/attachments/sourceRefs。
- 可选 comment。

服务端先检查 asset/reference 归属，再事务性写 Receipt。

## 34. Receipt 数据库关系

建议关系：

```text
Outcome
  └─ WorkItem
      ├─ HumanReceipt 1..*
      │    └─ ReceiptAssetRef 0..*
      ├─ AcceptanceCriterion 1..*
      └─ Review 0..*
```

Receipt 不覆盖旧 Receipt。重新提交产生新 sequence 或新记录，并由 Review 选择当前有效记录。被驳回的 Receipt 仍然可以作为审计历史，但不能满足当前 criterion。

## 35. Evidence 选择规则

Criterion 要求可以指定：

```ts
type EvidenceRequirement =
  | { kind: "text"; minLength?: number }
  | { kind: "asset"; mediaTypes: string[] }
  | { kind: "sourceReference"; sourceTypes: string[] }
  | { kind: "observation"; field: string; acceptedValues?: string[] };
```

Review 时服务端检查：

1. Evidence 是否属于当前 WorkItem。
2. Evidence 的提交人 actorRef 是否已记录。
3. asset 是否存在且未被撤销。
4. source reference 是否属于当前 scope。
5. observation 是否符合条款要求。

模型生成的文字不能单独满足 `asset` 或 `sourceReference` 要求。

## 36. 现场任务的执行边界

动作卡可以展示命令、检查项或操作步骤，但默认不由 Agent 自动执行现场动作。若未来需要自动化，必须新建 action type 和单独验收，不在本 Spec 中隐式加入。

步骤文字必须标注：

```text
说明：为什么做
执行者：human
输入：需要什么
操作：执行人做什么
完成材料：提交什么
失败处理：停止、补充资料或联系谁
```

## 37. ExploreIdea 数据模型

```text
ExploreIdea:
id, botId nullable, title, note, status,
sourceOutcomeId nullable, sourceReferences JSON,
budget JSON nullable, proposedOutcomeId nullable,
createdAt, updatedAt, discardedAt nullable
```

ExploreIdea 的 `proposedOutcomeId` 是转换结果，不是对现有 Outcome 的可变引用。转换操作必须生成新的 PlanningDraft/Outcome。

## 38. Explore/Delivery API

```text
POST /api/v0/explore
GET  /api/v0/explore
POST /api/v0/explore/:id/propose
POST /api/v0/explore/:id/discard
```

`propose` 请求只创建 PlanningDraft，不直接批准或运行。`discard` 不删除引用过的资料和历史事件。

## 39. UI 页面结构

```text
OutcomeHumanWorkPage
  ├─ WorkItemHeader
  ├─ PurposeAndPrerequisites
  ├─ StepList
  ├─ KnowledgeReferenceList
  ├─ InputForm
  ├─ EvidenceUpload
  ├─ ReceiptHistory
  └─ ReviewStatus
```

表单状态：

```text
loading → ready → editing → uploading → submitting
                    ↓             ↓
                 paused        submit_error
                                   ↓
                               retryable
```

刷新、导航和应用重启后，已保存的状态从服务端恢复；未提交草稿可以按客户端现有草稿机制保存，但不能冒充 Receipt。

## 40. Provider/receipt 验证脚本

建议新增：

```text
scripts/test-knowledge-provider.ts
scripts/test-human-work-replay.ts
apps/server/test/knowledge-provider.test.ts
apps/server/test/human-receipt.integration.test.ts
apps/desktop/test/human-action-card.test.tsx
```

脚本必须支持 fixture mode，不需要生产资料或外部 provider token。外部 provider 连接测试如需要凭据，结果记录为环境相关 PENDING，不阻塞 fixture 逻辑测试。

## 41. 现实任务 fixture 详细结构

```json
{
  "outcome": {
    "title": "现场网络和资产接入核对",
    "contractRevision": 1
  },
  "references": [
    {
      "id": "fixture:network-checklist",
      "version": "1",
      "scope": "fixture-project",
      "text": "..."
    }
  ],
  "workItem": {
    "executorType": "human",
    "steps": ["核对网络", "核对资产", "提交测试单"]
  },
  "receipts": {
    "missing": {},
    "rejected": {},
    "accepted": {}
  }
}
```

回放必须覆盖：没有资料、资料 stale、动作开始、暂停、缺材料提交、Review 驳回、补交、最终接受。

## 42. 移动端兼容策略

如果 Android/iOS 在第一轮只做只读：

- API 和状态模型必须提前兼容。
- 客户端显示动作卡和状态。
- 上传/提交按钮可以隐藏或显示“请在 Desktop 完成”。
- 不得在移动端将只读查看标记为 started 或 completed。

如果批准进入移动端回执：

- 使用与 Desktop 相同的 receipt API。
- 统一 asset upload 和 deep link。
- 测试后台、断网、文件权限和恢复。

## 43. 数据清理和隐私

- 资料 provider 只返回当前 scope 允许的内容。
- Receipt 的敏感字段按现有数据保留策略处理；不写入通知 payload。
- 日志只记录 sourceRef、digest、大小、错误码和 correlation ID。
- 未关联 asset 使用已有清理机制，清理前不能删除仍被 Receipt 引用的资产。
- Explore 草稿和 Delivery Evidence 使用不同状态，避免清理任务误删交付证据。

## 44. 错误合同

| 错误码 | 条件 | 客户端 |
|---|---|---|
| `knowledge_scope_required` | 没有项目范围 | 要求补充项目 |
| `knowledge_source_forbidden` | 无权限 | 不显示正文 |
| `knowledge_source_stale` | 版本过期 | 显示 stale 并允许重新读取 |
| `human_work_item_not_active` | 状态不允许操作 | 刷新状态 |
| `receipt_asset_not_found` | asset 无效 | 保留表单，重新上传 |
| `receipt_idempotency_conflict` | 同 key 不同内容 | 显示冲突 |
| `review_revision_conflict` | revision 已变化 | 重新读取动作卡 |
| `human_evidence_missing` | 必需材料缺失 | 显示缺口 |

## 45. 设计决策记录扩展

实现前必须记录：

- 第一版 provider 是否只支持 fixture/project files。
- 项目 scope 使用 channel、bot、project 还是独立实体。
- Human WorkItem 是否和 Agent WorkItem 共享表。
- asset upload 是否复用现有 attachment/asset store。
- Receipt 是否允许多个版本同时处于 submitted。
- Review 是否由当前唯一用户主体完成。
- ExploreIdea 是否进入数据库还是现有草稿机制。
- Android/iOS 是否进入可提交回执范围。
