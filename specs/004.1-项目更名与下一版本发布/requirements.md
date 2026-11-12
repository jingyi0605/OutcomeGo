# 需求文档 - 项目更名与下一版本发布

状态：Draft

关联文档：[README.md](README.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 简介

将 OutcomeGo 的用户可见项目名称迁移为 OutcomeGo，并在下一版本中启用新名称。新安装直接使用全量 OutcomeGo 内部身份和最新数据库 schema；既有数据由用户手动备份后按外部运行手册导入。

负责人补充决策（2026 年 11 月 12 日）：OutcomeGo 使用全新的安装身份和一份包含当前全部字段的 schema。不实施旧版原地升级、旧数据库字段转换或旧配置读取。需要保留的数据由用户手动备份，再把符合当前 `outcomego-v1` 格式的备份导入新实例。

## 范围说明

### In Scope

- 用户可见品牌和文档名称。
- 下一版本名称和发布资产。
- GitHub 仓库、Release、安装器、更新清单和 Actions 引用盘点。
- 新安装、最新 schema 初始化和手动备份导入边界。
- 新命令、配置和数据路径的内部命名。
- OpenTeam Fork 关系、版权和 GPL-3.0-only 说明。

### Out of Scope

- 保持旧内部身份以实现无缝覆盖升级。
- 旧安装、旧数据库和旧协议的自动兼容迁移。
- 在本阶段继续保留旧 package scope、运行时 namespace、平台包身份和发布资产身份。

## 需求

### 需求 1：下一版本启用 OutcomeGo

**用户故事：** 作为用户，我希望下一版本显示 OutcomeGo，以便看到项目已经完成更名。

#### 验收标准

1. WHEN 用户查看应用标题、README、下载页或 Release THEN System SHALL 使用 OutcomeGo 作为主要名称。
2. WHEN 文档提及历史关系 THEN System SHALL 说明 OutcomeGo formerly aiTeamOS，并说明其为不隶属于 OpenTeam 且未获上游背书的独立 fork。
3. WHEN 发布版本 THEN System SHALL 使用统一的新名称和版本说明。

### 需求 2：新安装和手动备份导入

**用户故事：** 作为维护者，我希望 OutcomeGo 采用全新内部身份和单一最新数据库 schema；保留旧实例数据由用户在仓库外手动备份并导入。

#### 验收标准

1. WHEN 用户安装 beta.14 THEN System SHALL 创建新的 OutcomeGo 应用、配置和服务端身份；新应用与旧实例并行存在，不执行覆盖安装或旧数据目录读取。
2. WHEN 用户需要保留旧数据 THEN System SHALL 在迁移说明中要求手动备份，并只接受符合当前 `outcomego-v1` schema 的备份校验；仓库不自动改写旧字段、表名或数据库文件。
3. WHEN 更新链校验 OutcomeGo 安装包 THEN System SHALL 校验当前仓库、tag、签名身份、哈希和版本；不得以旧仓库历史签名认证 OutcomeGo Release。

### 需求 3：发布链路兼容

**用户故事：** 作为维护者，我希望旧地址和新地址在过渡期内都可定位，以便用户和自动化流程不会突然失效。

#### 验收标准

1. WHEN 访问旧仓库、Release 或文档链接 THEN System SHALL 能够通过重定向或迁移说明找到新项目。
2. WHEN Actions、安装器、Webhook 或更新清单使用仓库路径 THEN System SHALL 完成实际引用核验和必要更新。
3. WHEN 发布失败 THEN System SHALL 保留旧发布资产和回退步骤。

### 需求 4：单一 OutcomeGo CLI 入口

**用户故事：** 作为新安装用户，我希望只有 `outcomego` 命令和一份配置/更新实现，避免旧命令成为第二套身份。

#### 验收标准

1. WHEN 用户通过新安装器安装 CLI THEN System SHALL 安装规范命令 `outcomego`，并可提供 `aiteamos` 命令名过渡入口。
2. WHEN 用户执行任一 CLI 命令 THEN 参数解析、配置、更新和错误处理 SHALL 只经过同一实现。
3. WHEN 代码扫描发现旧产品运行身份 THEN SHALL 标记为历史说明、不可修改的已发布资产、OpenTeam 上游接口或单独协议迁移，不得暗中保留为新配置/数据目录兼容层。

## 非功能需求

### 非功能需求 1：可回滚

1. 发布过程必须保留旧安装包、更新清单和关键验证记录。
2. 不得依赖不可逆的数据迁移完成品牌更名。

### 非功能需求 2：可追踪性

1. 每个名称命中必须分类为品牌、依赖、路径、签名、兼容性或上游身份。
2. 每项修改必须有验证结果。

## 成功定义

- 下一版本正式使用 OutcomeGo 名称。
- 至少一次新空实例初始化检查通过。
- 手动备份保留、最新 schema 备份校验和签名/设备边界均有记录。
- 迁移说明和回滚依据齐全。

## 详细需求

### 需求 5：名称命中必须分类处理

**用户故事：** 作为维护者，我希望每个旧名称的出现位置都有处理结论，以便避免全局替换破坏上游或兼容性。

#### 验收标准

1. WHEN 执行名称盘点 THEN System SHALL 记录 `outcomeGo`、`OutcomeGo`、`outcomego`、`@outcomego`、`com.outcomego`、`com.outcomego` 和 `openteam` 的文件、用途和目标处理。
2. WHEN 命中表示上游、协议、数据库或稳定应用标识 THEN System SHALL 将其标记为保留、兼容别名或单独迁移，而不是直接替换。
3. WHEN 命中表示用户可见品牌 THEN System SHALL 将其替换为 OutcomeGo，并提供测试证据。

### 需求 6：Release 版本和资产一致

**用户故事：** 作为发布者，我希望所有平台使用同一个下一版本，以便用户能够正常升级和验证安装包。

#### 验收标准

1. WHEN 根版本更新 THEN `scripts/release/version.ts check` SHALL 通过，workspace、`bun.lock` 和 `apps/ios/release.json` 不得漂移。
2. WHEN Release Workflow 构建资产 THEN server、worker、computer、CLI、Desktop、Android 和 iOS 的版本关系 SHALL 可解释且符合现有发布规则。
3. WHEN CLI 验证更新来源 THEN `DEFAULT_REPOSITORY`、tag、Release 地址和签名工作流 SHALL 指向批准后的仓库地址。

### 需求 7：全新安装身份和迁移边界

**用户故事：** 作为维护者，我希望 OutcomeGo 安装身份与历史 aiTeamOS 完全分离，并向用户清楚说明手动备份导入方式。

#### 验收标准

1. WHEN 安装新版本 THEN Desktop/CLI/Android/iOS/Compose/database SHALL 使用清单记录的 OutcomeGo 新身份。
2. WHEN 安装 Android/iOS 的 OutcomeGo 新身份 THEN 用户 SHALL 使用新应用身份，并可按外部运行手册导入符合当前 schema 的手动备份；不执行旧应用身份覆盖升级。
3. WHEN iOS project generation THEN 新 Release/Debug display name、bundle IDs、APNs topic、share extension 和 notification extension SHALL 一致并通过 native config 检查。
4. WHEN 新实例初始化失败 THEN 源备份不得被修改，用户可重建隔离的新实例后重试。

### 需求 8：安装来源和历史资产边界

**用户故事：** 作为用户，我希望 OutcomeGo 新下载入口不会把 beta.13 旧身份资产误报为 OutcomeGo beta.14。

#### 验收标准

1. WHEN 用户打开 OutcomeGo Releases 安装入口 THEN 文档 SHALL 显示 latest 实际版本和 beta.14 是否已发布。
2. WHEN 历史 beta.13 资产保留 THEN 资产 SHALL 按原名称和原校验留作历史输入，不得标成 OutcomeGo beta.14。
3. WHEN 用户使用旧下载链接 THEN 文档 SHALL 指向新仓库，并说明历史 Release 正文仍含旧 slug，直到相关 redirect 得到实测。

### 需求 9：公开信息和许可正确

**用户故事：** 作为开源使用者，我希望知道 OutcomeGo 与 OpenTeam、aiTeamOS 的关系，并能获得完整许可信息。

#### 验收标准

1. WHEN 用户查看 README、FORK 或 OutcomeGo Release THEN System SHALL 说明 OutcomeGo (formerly aiTeamOS) 是 OpenTeam 的独立 fork，与上游无隶属关系且未获上游背书。
2. WHEN 用户检查源代码和发布资产 THEN GPL-3.0-only、版权和第三方许可声明 SHALL 保留。
3. WHEN 仓库地址变化 THEN 旧地址、Issue、Release、PR、Actions、徽章和外部安装链接 SHALL 有迁移验证或说明。

## 发布验收矩阵

| 对象 | 旧值基线 | OutcomeGo 目标 | 必须保留 | 验证 |
|---|---|---|---|---|
| 根工作区 | `aiteamos` / `0.1.0-beta.13` | `outcomego` / `0.1.0-beta.14` | 版本同步脚本 | `version.ts check` |
| CLI | `aiteamos` | `outcomego` 规范入口；可附 `aiteamos` 同实现别名 | 不复用旧配置/data identity | CLI help/install/update 测试 |
| Desktop | `aiTeamOS`、`aiteamos` | `OutcomeGo`、`outcomego` | artifact prefix 和 `userData=aiTeamOS` 按固定决策保留 | package/build/update 静态测试 |
| Android | `aiTeamOS`、`aiteamos`、`com.teambots` | `OutcomeGo`、`com.outcomego.android` | update manifest 公钥沿用；不要求覆盖升级 | APK manifest/certificate/static checks |
| Android namespace | `com.teambots.android` | `com.outcomego.android` | 新实例身份 | Gradle/test |
| iOS | `OpenTeam`/`aiTeamOS` 混合现状 | OutcomeGo 显示名 | 新 Bundle/APNs/extensions；设备签名延期 | native config |
| Compose/镜像 | `aiteamos_*` | `outcomego_*` | GHCR `ai-teamos` package path | compose render/schema checks |
| 上游身份 | `openteam` | 保留 | Fork 关系、协议和同步 | grep 分类审计 |

## 需求 10：发布资产和名称层级可追踪

**用户故事：** 作为发布维护者，我希望每个新名称都能追溯到对应的代码、构建资产和兼容策略，以便发布问题可以定位到具体层级。

#### 验收标准

1. WHEN 生成名称清单 THEN 每个命中 SHALL 标记为用户可见品牌、分发地址、内部标识、上游标识、签名标识或数据路径。
2. WHEN 发布候选资产生成 THEN 每个资产 SHALL 记录版本、构建来源、显示名称、内部身份和校验值。
3. WHEN 某个内部标识保留 THEN 迁移记录 SHALL 说明其与用户可见品牌的关系和保留原因。
4. WHEN 发布失败 THEN 维护者 SHALL 能根据资产清单定位旧资产、候选资产和回滚资产。

## 需求 11：版本检查和构建结果一致

**用户故事：** 作为维护者，我希望版本脚本、各平台构建和 Release 资产使用同一个版本事实，以便避免部分平台升级、部分平台没有升级。

#### 验收标准

1. WHEN 执行 `bun scripts/release/version.ts set <version>` THEN 根包、workspace、lockfile 和 iOS 基础版本 SHALL 按脚本规则更新。
2. WHEN 执行 `bun scripts/release/version.ts check` THEN 版本不一致、Tag 不一致或 Release 配置漂移 SHALL 失败。
3. WHEN Android 读取根版本 THEN versionName 和 versionCode SHALL 与迁移矩阵一致。
4. WHEN iOS 构建 prerelease 版本 THEN marketing version 和 build number SHALL 按现有发布规则分开处理。
5. WHEN Release Workflow 产生资产 THEN 资产名称、SHA-256、版本和仓库来源 SHALL 能相互对账。

## 需求 12：签名、更新和数据目录不被品牌修改破坏

**用户故事：** 作为新安装用户，我希望 OutcomeGo 使用独立身份；保留已有业务数据时，我可以通过手动备份导入新实例。

#### 验收标准

1. WHEN 生成 Android/iOS/Desktop OutcomeGo 构建 THEN SHALL 使用新安装身份；不以 beta.13 旧身份作为覆盖安装验收条件。
2. WHEN Desktop 启动 THEN SHALL 在读取 userData 前固定到 `join(app.getPath("appData"), "aiTeamOS")` 并通过测试；该稳定目录名按明确决策保留，不代表读取或迁移旧安装数据。
3. WHEN 用户配置 CLI/服务端新实例 THEN SHALL 使用当前 `outcomego` 配置、Compose、数据库和 volume 身份。
4. WHEN 用户导入数据 THEN 只校验 `outcomego-v1` 手动备份，不自动转换旧字段、旧表名、旧数据库或旧配置。
5. WHEN iOS project generation THEN bundle ID、APNs、share extension 和 keychain group SHALL 在新身份下自洽并通过配置检查。

## 需求 13：公开仓库迁移可控

**用户故事：** 作为项目维护者，我希望仓库地址更名不会让 Release、Actions、安装器和用户文档失效。

#### 验收标准

1. WHEN 执行仓库 rename 前 THEN 系统 SHALL 已完成旧 clone/fetch、Tag、Issue、Release、PR、Fork、Actions 和 webhook 盘点。
2. WHEN 仓库 rename 后 THEN CLI default repository、Release API、下载 manifest、README badges 和 workflow 引用 SHALL 经过验证。
3. WHEN 旧路径不自动重定向某类引用 THEN 项目 SHALL 提供迁移页或暂缓 rename。
4. WHEN 仓库 rename 验证失败 THEN 项目 SHALL 继续使用旧仓库地址完成用户可见品牌发布，不强行推进 rename。

## 需求 14：OutcomeGo 入口只有一套实现

**用户故事：** 作为新安装维护者，我希望 OutcomeGo 的命令、配置和更新状态使用单一实现。

#### 验收标准

1. WHEN 安装 CLI THEN 安装规范 `outcomego` 命令，并可将 `aiteamos` 作为同一 binary 的命令名别名；不复制第二套实现。
2. WHEN 用户运行 CLI THEN 同一可执行入口负责解析、配置、更新和状态。
3. WHEN 项目文档引用 CLI THEN 规范命令必须为 `outcomego`；迁移说明可说明 `aiteamos` 同实现别名。
4. WHEN 更新失败 THEN 新实例配置和用户手动备份不得被删除。

## 需求 15：发布失败有可执行回滚

**用户故事：** 作为发布负责人，我希望候选版本失败时能快速恢复旧版本服务和安装路径。

#### 验收标准

1. WHEN 候选版本未通过签名、新安装或关键回归 THEN 发布状态 SHALL 为 `FAIL`，不得继续公开发布。
2. WHEN 公开发布后发现回归 THEN 负责人 SHALL 能关闭新入口、保留旧资产并发布修复或兼容版本。
3. WHEN Android/iOS 不能覆盖回滚 THEN 回滚方案 SHALL 使用兼容服务端和新修复版本，而不是假设用户可以安装旧包。
4. WHEN 回滚执行 THEN SHALL 保留失败版本的日志、资产、版本和数据库状态记录。

## 非功能需求补充

### 非功能需求 3：可审计

1. 所有名称层级变化必须有分类清单和变更提交。
2. 所有候选资产必须有版本、commit、构建命令和校验值。
3. 通过/PENDING/FAIL 不能只写在聊天或 PR 描述中，必须写入迁移报告。

### 非功能需求 4：可重复

1. 版本检查和名称盘点脚本在相同工作树上重复执行应得到相同结论。
2. 新实例初始化可安全重试；已标记为当前版本的数据库不会再次执行初始化。
3. 备份校验可重复运行，且不会修改输入文件。

## 验收证据要求

每个发布平台至少提供：

```text
current version
candidate version
source commit
build command
artifact path
artifact SHA-256
identity/package/bundle ID
signature result
fresh-install/import result
rollback result
known pending evidence
reviewer/date
```

## 需求 16：上游同步、公开文档和名称核查

**用户故事：** 作为维护者，我希望更名后仍能同步上游，公开文档完整，并在发布前知道名称是否有明显冲突。

#### 验收标准

1. WHEN 品牌更名完成 THEN SHALL 完成一次从 `main` 到产品分支的上游同步演练，冲突集中在品牌和发布文件（design.md §33）。
2. WHEN 发布下一版本 THEN SHALL 提供 README、FORK、CHANGELOG 和迁移说明（design.md §34）。
3. WHEN 公开发布前 THEN SHALL 记录 GitHub、npm、域名、应用商店和商标的检索结果；有明显冲突时暂停公开发布（design.md §35）。
4. WHEN 处理容器镜像路径、环境变量、LISTEN 通道和 URL scheme THEN SHALL 按 design.md §12 保留或双路径发布，不随品牌一起改名。

## 需求 17：全量内部名称迁移和单一最新数据库版本

**用户故事：** 作为维护者，我希望项目内部实现、数据库 schema、平台身份和发布身份都使用 OutcomeGo 对应名称；我可以先手动备份并导入数据，因此不要求旧安装原地覆盖升级。

### 验收标准

1. WHEN 完成本阶段全量迁移 THEN TypeScript、Kotlin、Swift、Python、Shell、SQL、配置文件和 workspace package identifiers SHALL 使用 OutcomeGo 命名约定；旧名称只能存在于明确的历史迁移说明或外部上游兼容 fixture 中。
2. WHEN 创建新数据库 THEN product-specific Prisma model metadata、物理表名、字段命名、enum 类型、索引、约束、Postgres database/user 和运行时 schema metadata SHALL 使用新的数据库命名；Postgres LISTEN channel `aiteamos_events` 按固定运行接口保留；新实例 SHALL 直接从包含全部最新字段的单一 `outcomego-v1` schema 初始化。部署只对空数据库运行；对已有数据库仅当 schema 指纹完全一致时视为已初始化，否则拒绝，不做原地升级或字段转换。
3. WHEN 构建客户端和服务端 THEN Bun package scope/root package、CLI binary/config directory、Compose project/volume/env vars、GHCR paths、Desktop appId/executable/userData、Android applicationId/namespace、iOS bundle/APNs/extensions、URL schemes 和 update identities SHALL 使用新的 OutcomeGo 身份。
4. WHEN 用户提供手动备份 THEN System SHALL 只接受已经使用最新 `outcomego-v1` schema 的备份校验；校验器 SHALL 检查 manifest、SHA-256、行数和关系完整性，不转换旧字段、不覆盖源备份，真实导入由后续运行手册负责。
5. WHEN 完成全量迁移 THEN 新安装、最新 schema 生成、CLI/Compose 静态检查、Desktop/Android/iOS 构建、协议通信、更新资产和发布静态检查 SHALL 通过；旧版本覆盖升级和旧数据库字段转换不属于本阶段实现或验收范围。

### 非功能需求补充

1. 新 OutcomeGo 安装与旧安装使用独立身份；不得修改手动备份文件，校验失败必须保留源备份和可诊断日志。
2. 全量重命名必须使用当前 Prisma schema、raw schema 和结构化备份校验器；不得使用无法审计的全局文本替换修改数据库 schema 或二进制/签名身份。
