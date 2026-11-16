# 任务清单 - 微信 iLink 消息服务集成

状态：IN_PROGRESS

文档关系：

- 基础服务：[`../009-外部消息服务/tasks.md`](../009-外部消息服务/tasks.md)
- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)

## 阶段 1：依赖基础服务和插件骨架

- [x] 1.1 建立 Spec 009.1
  - 状态：DONE
  - 这一步到底做什么：把微信实现从基础外部消息服务中拆成独立子规格。
  - 主要改哪里：`specs/009.1-微信iLink消息服务集成/*`
  - 怎么验证：文档引用、范围和依赖走查。
  - 对应需求：全部需求
  - 对应设计：§1、§7

- [ ] 1.2 完成 Spec 009 基础服务依赖检查
  - 状态：TODO
  - 这一步到底做什么：确认公共 ExternalMessage、mapping、receipt、AssetStore 和 inbound service 已可调用。
  - 先依赖什么：`009` 任务 2.4
  - 这一步先不做什么：不实现 iLink API。
  - 怎么验证：基础服务验收结果和类型检查。
  - 对应需求：需求 4
  - 对应设计：§1.2、§2.2

- [ ] 1.3 建立 WeChat plugin manifest 和 server
  - 状态：TODO
  - 这一步到底做什么：按 WhatsApp connector 模式建立 `stdio`、persistent state、deviceLink 和 MCP server。
  - 先依赖什么：1.2
  - 主要改哪里：`packages/plugins/wechat`、目录注册和测试。
  - 这一步先不做什么：不接真实 provider 网络，不实现媒体。
  - 怎么验证：plugin package tests、MCP discovery tests。
  - 对应需求：需求 1
  - 对应设计：§2.2、§3.2

## 阶段 2：QR、token 和连接状态

- [ ] 2.1 实现 iLink API client
  - 状态：TODO
  - 这一步到底做什么：封装 QR、QR status、getconfig、getupdates、sendmessage 的 HTTP JSON 请求和错误。
  - 先依赖什么：1.3
  - 主要改哪里：`packages/plugins/wechat/connector/api.ts`、协议类型和 provider simulator。
  - 怎么验证：offline HTTP provider simulator。
  - 对应需求：需求 1、2
  - 对应设计：§2.3、§3.2、§5

- [ ] 2.2 实现 QR 和 token 状态机
  - 状态：TODO
  - 这一步到底做什么：实现 start/finish/status/cancel/remove、token 持久化和重启恢复。
  - 先依赖什么：2.1
  - 主要改哪里：`connector/account.ts`、`state.ts`、QR fixture/tests。
  - 这一步先不做什么：不发送真实微信消息。
  - 怎么验证：connector unit tests、host lifecycle integration tests、QR UI fixture。
  - 对应需求：需求 1
  - 对应设计：§2.3.1、§4、§6.3

### 阶段检查

- [ ] 2.3 QR 阶段检查
  - 状态：TODO
  - 先依赖什么：2.1、2.2
  - 怎么算完成：host-only 工具隐藏，token 不出结果，重启可恢复。
  - 怎么验证：connector 专项测试和 package round-trip。
  - 对应需求：需求 1
  - 对应设计：§2.3.1、§6.3

## 阶段 3：peer、cursor、文本和媒体

- [ ] 3.1 实现 peer 列表和本地 peer state
  - 状态：TODO
  - 先依赖什么：2.3
  - 这一步到底做什么：维护 direct peer 列表和展示名称，提供 `list_peers`。
  - 这一步先不做什么：不声称存在完整微信联系人历史。
  - 怎么验证：connector unit/integration tests。
  - 对应需求：需求 2
  - 对应设计：§3.1、§4.2

- [ ] 3.2 实现 cursor 长轮询和标准化消息
  - 状态：TODO
  - 先依赖什么：3.1
  - 这一步到底做什么：实现 `poll_inbound`、cursor 保存和 ExternalMessage 转换。
  - 这一步先不做什么：不直接写数据库，不绕过 Spec 009。
  - 怎么验证：duplicate、Server failure 不推进 cursor、重启恢复测试。
  - 对应需求：需求 2、4
  - 对应设计：§2.3.2、§6.1

- [ ] 3.3 实现文本发送和 reply context
  - 状态：TODO
  - 先依赖什么：3.2
  - 这一步到底做什么：实现 `send_message`、peer context 隔离、accepted/uncertain 结果。
  - 这一步先不做什么：不自动重试不确定结果。
  - 怎么验证：connector integration tests。
  - 对应需求：需求 2、4
  - 对应设计：§2.3.3、§4.2、§6.2

- [ ] 3.4 实现媒体下载和上传
  - 状态：TODO
  - 先依赖什么：3.2、3.3
  - 这一步到底做什么：把 provider media 接到 Spec 009 AssetStore，并支持受控 asset 外发。
  - 这一步先不做什么：不支持未经验证的媒体类型和任意路径。
  - 怎么验证：connector + Server media integration tests。
  - 对应需求：需求 3
  - 对应设计：§2.3.4、§5

## 阶段 4：接入 OpenTeam Channel

- [ ] 4.1 接入 host poller 和 ExternalInboundMessageService
  - 状态：TODO
  - 先依赖什么：009 任务 2.4、3.4
  - 这一步到底做什么：Server 调用 `poll_inbound`，把消息交给 Spec 009 inbound service，并按结果推进 cursor。
  - 这一步先不做什么：不实现 automation trigger，不添加 QQ 分支。
  - 怎么验证：Server + packaged MCP integration test。
  - 对应需求：需求 2、4
  - 对应设计：§2.3.2、§6.1

- [ ] 4.2 接入 WeChat 外发回复
  - 状态：TODO
  - 先依赖什么：4.1
  - 这一步到底做什么：让 Bot 通过 Spec 009 外发边界把文本和受控媒体回复到同一 peer。
  - 这一步先不做什么：不把 provider context 放进 Bot 可见正文。
  - 怎么验证：end-to-end fixture test。
  - 对应需求：需求 3、4
  - 对应设计：§2.3.3、§2.3.4、§6.2

### 最终检查

- [ ] 4.3 WeChat 子规格验收
  - 状态：TODO
  - 先依赖什么：4.1、4.2
  - 这一步到底做什么：确认微信从 QR、token、peer、cursor、媒体、Channel、Bot wake 到回复的证据完整。
  - 这一步先不做什么：不添加 QQ 或 automation trigger。
  - 怎么验证：connector 专项测试、Server 集成测试、package round-trip、TypeScript 检查和 Spec 走查。
  - 对应需求：全部需求
  - 对应设计：全文
