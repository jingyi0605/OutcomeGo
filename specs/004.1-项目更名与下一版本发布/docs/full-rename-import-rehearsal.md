# 全量重命名最新 schema 备份校验演练

状态：局部 DONE；真实实例/导入 PENDING

本文件记录 OutcomeGo 新实例的数据库边界。新实例直接从当前 Prisma schema 和 raw schema 创建，版本标识为 `outcomego-v1`，并以这两份 schema 文件的 SHA-256 指纹标记初始化结果。用户可以在实例外部手动备份并导入数据；本仓库只校验已经符合最新 schema 的 portable JSON 备份，不转换旧表名、旧字段名或旧 schema。

数据库容器入口调用 `packages/db/scripts/deploy-schema.ts`。它只会对空数据库执行当前 Prisma `db push` 和 raw schema。开始初始化前写入带当前指纹的 initializing 标记；中断后相同代码可以重试。完成后写入 ready 标记。后续部署只有在版本号和 schema 指纹都完全一致时才视为已初始化；任何旧标记、指纹不匹配或未标记的非空数据库都会被拒绝，不执行原地数据库升级。`packages/db/prisma/migrations/` 的历史 SQL 不会由生产或 CI 部署容器执行；其中旧 provider 字段回填迁移已删除。

| 场景 | 输入 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| 空新实例 | 无旧数据 | 当前 Prisma/raw schema 创建全部最新表、字段、enum、索引、约束和搜索对象 | 本地尚未启动 PostgreSQL；新增 CI 集成测试创建 disposable empty database 并两次部署，等待 runner 执行 | PENDING |
| 非空且无 schema marker 的数据库 | 任意已有表 | 部署前拒绝，不转换旧表或旧字段 | negative integration test 已添加，PostgreSQL runner 未执行 | PENDING |
| 当前 schema ready marker | `OutcomeGo schema ready: outcomego-v1:<sha256>` schema comment | 同一指纹视为已初始化；不执行 db push 或旧 schema 转换 | fresh-schema test 校验标记、重复部署和不匹配指纹拒绝，等待 runner 执行 | PENDING |
| 中断初始化 | 当前 schema 对应的 initializing marker | 只允许相同 schema 指纹继续初始化 | 集成测试尚待 PostgreSQL runner | PENDING |
| 最新 schema 备份 | `outcomego-backup/v1`、`outcomego-v1` | manifest、物理表名、SHA-256、行数和关系校验通过 | 离线 validator tests 已通过 | DONE |
| 旧格式备份 | 非 `outcomego-backup/v1` | 在读取表数据前拒绝，不进行字段或表名转换 | validator negative test 已通过 | DONE |
| 错误校验和 | 被修改的最新 schema 备份 | 导入前拒绝并报告 data SHA-256 不匹配 | validator negative test 已通过 | DONE |
| 错误关系 | 最新表名但外键引用缺失 | 导入前拒绝并报告缺失关系 | validator negative test 已通过 | DONE |
| 人工导入 | 通过校验的最新 schema 备份 | 由后续运行手册写入新实例，源备份保持不变 | 本会话未启动数据库或服务 | PENDING |
| 中途失败 | 人工导入过程被中断 | 保留源备份，删除隔离新实例后可以重新执行人工导入 | 本会话未启动数据库或服务 | PENDING |

## 本次本地验证

- 命令：`bun test scripts/migration/validate-outcomego-backup.test.ts`
- 结果：5 项通过，覆盖最新物理 schema、拒绝旧格式、未知物理表名、破损关系和错误校验和/行数。
- 边界：本次没有启动数据库或服务，没有实际导入数据；手动备份必须已符合 `outcomego-v1`，本仓库不执行旧字段/表名转换。
- 数据库部署边界：仅创建单一当前版本 schema；指纹不同代表另一个数据库版本，必须新建数据库后导入当前格式备份。

## 当前实现

`scripts/migration/validate-outcomego-backup.ts` 接受一个已经使用最新 schema 的 JSON 文件。它要求：

- `manifest.format` 为 `outcomego-backup/v1`。
- `manifest.product` 为 `OutcomeGo`。
- `manifest.schema` 为 `outcomego-v1`，`schemaVersion` 为 `1`。
- 每个表名符合当前物理命名 `outcomego_*`。
- `dataSha256` 与规范化表数据一致，`rowCounts` 与实际行数一致。
- 已提供的外键关系指向同一备份中存在的记录。

验证命令：

```sh
bun scripts/migration/validate-outcomego-backup.ts \
  --input outcomego-backup.json
```

测试命令：

```sh
bun test scripts/migration/validate-outcomego-backup.test.ts
```

验证器只读输入文件，不创建输出文件，也不修改源备份。旧数据库字段、旧表名和旧 schema 没有转换逻辑；需要数据保留时，用户必须先生成符合 `outcomego-v1` 的手动备份，再按后续运行手册导入新实例。
