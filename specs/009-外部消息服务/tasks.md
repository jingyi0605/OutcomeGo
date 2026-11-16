# 任务清单 - 外部消息服务

状态：IN_PROGRESS

文档关系：

- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- WeChat 子规格：[`../009.1-微信iLink消息服务集成/tasks.md`](../009.1-微信iLink消息服务集成/tasks.md)

## 阶段 1：Spec、公共契约和数据模型

- [x] 1.1 建立 Spec 009
  - 状态：DONE
  - 这一步到底做什么：定义 provider 无关的外部消息基础服务，并把平台 connector 拆到子规格。
  - 主要改哪里：`specs/009-外部消息服务/*`
  - 怎么验证：需求、设计、任务互相引用。
  - 对应需求：全部需求
  - 对应设计：§1、§7

- [ ] 1.2 增加外部消息公共类型和能力契约
  - 状态：TODO
  - 这一步到底做什么：定义 `ExternalMessage`、`ExternalMedia`、provider address 和外发结果。
  - 先依赖什么：1.1
  - 主要改哪里：`packages/plugin-sdk/src/types.ts`、`packages/contracts/src/*`、测试。
  - 这一步先不做什么：不实现具体 provider 协议。
  - 怎么验证：SDK/contracts 测试和类型检查。
  - 对应需求：需求 2、3、4
  - 对应设计：§3.1、§3.2、§6

- [ ] 1.3 增加 mapping 和 receipt 数据模型
  - 状态：TODO
  - 这一步到底做什么：增加 connection/peer 映射表和 provider message 去重表。
  - 先依赖什么：1.2
  - 主要改哪里：`packages/db/prisma/schema.prisma`、Prisma migration、DB fixture。
  - 这一步先不做什么：不改变既有 ChannelKind。
  - 怎么验证：schema 校验、migration test、并发唯一性测试。
  - 对应需求：需求 1、2
  - 对应设计：§3.1、§4

### 阶段检查

- [ ] 1.4 数据模型阶段检查
  - 状态：TODO
  - 先依赖什么：1.2、1.3
  - 怎么算完成：公共类型、唯一约束和事务边界足够支持 WeChat 子规格。
  - 怎么验证：人工走查和数据库测试。
  - 对应需求：需求 1、2、3、4
  - 对应设计：§3、§4、§5

## 阶段 2：Server 入站消息服务

- [ ] 2.1 实现 Channel mapping service
  - 状态：TODO
  - 这一步到底做什么：根据 connection、peer 和显式 target Bot 创建或复用 Channel。
  - 先依赖什么：1.3
  - 主要改哪里：`apps/server/src/services/external-channel-service.ts`、`apps/server/src/app-service.ts`、测试。
  - 这一步先不做什么：不实现 provider polling。
  - 怎么验证：Server integration tests。
  - 对应需求：需求 1
  - 对应设计：§2.2、§3.2、§4

- [ ] 2.2 实现消息接受和去重
  - 状态：TODO
  - 这一步到底做什么：事务化写入 ChannelMessage 并创建 Bot wake。
  - 先依赖什么：2.1
  - 主要改哪里：`apps/server/src/services/external-inbound-message-service.ts`、Messaging 适配点、集成测试。
  - 这一步先不做什么：不接入具体 provider，不推进 cursor。
  - 怎么验证：重复投递、payload conflict、事务失败和 Bot 不可用测试。
  - 对应需求：需求 2
  - 对应设计：§2.3.1、§3.2、§6.2

- [ ] 2.3 实现媒体接收和外发边界
  - 状态：TODO
  - 这一步到底做什么：将 provider media 登记为 AssetStore 资产，并为外发提供受控资产调用。
  - 先依赖什么：2.2
  - 主要改哪里：`apps/server/src/services/external-inbound-message-service.ts`、plugin external files、AssetStore 测试。
  - 这一步先不做什么：不增加任意文件上传入口。
  - 怎么验证：媒体大小、MIME、路径、下载失败和 uncertain 测试。
  - 对应需求：需求 3、4
  - 对应设计：§2.3.2、§3.1、§6.3

### 阶段检查

- [ ] 2.4 Server Channel 阶段检查
  - 状态：TODO
  - 先依赖什么：2.1、2.2、2.3
  - 怎么算完成：fixture 消息跑通“标准化消息 → mapping → ChannelMessage → Bot wake”。
  - 这一步先不做什么：不实现平台 connector 和 automation trigger。
  - 怎么验证：基础服务集成测试和事务边界走查。
  - 对应需求：全部需求
  - 对应设计：§2、§3、§4、§5、§7

## 阶段 3：基础服务验收和子规格交接

- [ ] 3.1 基础服务验收
  - 状态：TODO
  - 先依赖什么：2.4
  - 怎么算完成：所有基础需求有验证证据，target Bot 配置入口和限制已记录。
  - 怎么验证：完整基础服务测试和 Spec 逐项核对。
  - 对应需求：全部需求
  - 对应设计：全文

- [ ] 3.2 交接给 WeChat 子规格
  - 状态：TODO
  - 先依赖什么：3.1
  - 怎么算完成：`009.1` 的 connector 任务全部依赖本 Spec 2.4，并只提交标准化消息。
  - 怎么验证：文档引用和任务依赖走查。
  - 对应需求：全部需求
  - 对应设计：§3.2、§7
