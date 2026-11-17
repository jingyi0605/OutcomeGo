# 资料能力审计

日期：2026-11-17。任务：004.4 0.1。关联：[需求](../requirements.md) · [设计](../design.md) §6、§15、§28–§29 · [任务](../tasks.md)。

| 能力 | 源码证据 | 第一版结论 |
|---|---|---|
| 受管文件目录 | `packages/db/prisma/schema.prisma` 的 `AgentFileState`；`packages/messaging/src/agent-data.ts` 的 `trackFile` | 只保存路径、Bot、digest、generation、exists/error；不是全文，也不是整个工作区的文件索引。按 Bot 和文件名/路径检索，不宣称任意文件全文搜索。 |
| 文件正文 | `docker-compose.yml` 的 computer/server agent-data 共同卷；`AgentDataStore.root/botDirectory`；`scripts/dev/debug.sh` 的共享挂载检查 | 正文经已有共同挂载直接只读访问。注入 root 和 Bot 目录，校验真实路径、普通文件、大小、UTF-8、读取前后变动，计算实际 SHA-256；数据库 digest 落后时仍发现 stale。 |
| `/v1/read` | `packages/contracts/src/service-protocol.ts` 的 `HOST_BRIDGE_PATHS.read`；`apps/desktop/src/main/host/bridge.ts`；`apps/computer/src/native-tool-executor.ts` | 这是物理主机桥接接口。`COMPUTER_API_PATHS.read` 不存在，computer HTTP 端没有对应通用读取路由；不新增或伪造端点。 |
| 站内检索 | `apps/server/src/services/search-service.ts`；`packages/db/prisma/sql/raw-schema.sql` 的 `outcomego_refresh_message_search` | `SearchDocument` 的 message 是 ChannelMessage，file 是消息附件元数据，不索引 AgentFileState 正文。复用 `prefixTsQuery`/索引；先按当前 Bot 的有效 channel membership 限定，再限制候选条数。 |
| 消息读取 | `ChannelMessage`、`ChannelMember`、`Channel.archivedAt` | 按消息 ID 重新加载并验证 Bot/channel 关系。senderBotId 为空的用户消息仍可读；不能把 senderBotId 当 scope。保存 sequence、createdAt、正文 digest。 |
| 附件读取 | `packages/messaging/src/asset-store.ts` 的 `metadata/contentPath`；`apps/server/src/asset-http.ts` | 仅从允许的消息附件结构解析 assetId，再验证内容寻址元数据、文本类型、大小及真实 digest。assetId 本身不代表 scope，禁止任意 hash 读取。PDF、图片等无文本提取时返回 `unreadable_source`。 |
| 上传入口 | `apps/server/src/routes/client.ts`、`asset-service.ts`、`messages-send-service.ts` | 保留已有上传和消息关联。Provider 不调用 ingestSource、不复制文件、不写 Contract/WorkItem，不用附件说明冒充正文。 |
| 范围与失败 | `knowledge-scope-service.ts` | 正式资料固定 `bot:<Outcome.botId>`，每次操作重查当前 revision；缺 scope 返回 `knowledge_scope_required`；跨范围返回 `knowledge_source_forbidden`，没有正文。无挂载、缺文件、非文本返回 `unreadable_source`；版本/实际 digest 改变返回 `knowledge_source_stale`。 |
| Fixture | `fixture-knowledge-provider.ts` | 仅显式构造的测试依赖；无生产默认注册。支持 stale/forbidden/timeout/unreadable，使用同一合同测试。 |

父设计 §39 D19 只更新该行结论和状态，采用负责人确认的共享挂载读取路径。没有 computer、Desktop、运行工具或远端部署变更。

确定性验证使用一次性 PostgreSQL 和任务 worktree 中临时 Bot 目录、虚构文本及实际 AssetStore；测试后清理。真实调试环境的共享挂载可用性未观察，状态为 PENDING，不能用确定性测试声称远端环境已验证。验证命令和结果见 [第一波证据](20261117-第一波实现与验证.md)。
