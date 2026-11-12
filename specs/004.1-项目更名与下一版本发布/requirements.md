# 需求文档 - 项目更名与下一版本发布

状态：Draft

关联文档：[README.md](README.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 简介

将 ai-TeamOS 的用户可见项目名称迁移为 OutcomeGo，并在下一版本中启用新名称。迁移必须优先保证既有安装、数据、登录、更新和运行能力继续可用。

## 范围说明

### In Scope

- 用户可见品牌和文档名称。
- 下一版本名称和发布资产。
- GitHub 仓库、Release、安装器、更新清单和 Actions 引用盘点。
- 旧版本到新版本的升级验证。
- 旧命令、配置和数据路径的兼容处理。
- OpenTeam Fork 关系、版权和 GPL-3.0-only 说明。

### Out of Scope

- 没有兼容性需要的内部全量重命名。
- Android `applicationId`、iOS Bundle ID 和签名身份的无必要变化。
- 以品牌更名为理由重建发布系统。

## 需求

### 需求 1：下一版本启用 OutcomeGo

**用户故事：** 作为用户，我希望下一版本显示 OutcomeGo，以便看到项目已经完成更名。

#### 验收标准

1. WHEN 用户查看应用标题、README、下载页或 Release THEN System SHALL 使用 OutcomeGo 作为主要名称。
2. WHEN 文档提及历史关系 THEN System SHALL 说明 OutcomeGo formerly aiTeamOS，并说明其为 OpenTeam 的独立 Fork。
3. WHEN 发布版本 THEN System SHALL 使用统一的新名称和版本说明。

### 需求 2：旧版本可以升级

**用户故事：** 作为现有用户，我希望升级后保留数据和登录状态，以便更名不影响使用。

#### 验收标准

1. WHEN 从当前稳定版本升级 THEN System SHALL 保留用户数据、配置和可迁移的运行状态。
2. WHEN 用户完成升级 THEN System SHALL 能够登录并读取已有基础数据。
3. WHEN 更新链校验安装包 THEN System SHALL 保持包签名、证书、哈希和版本信息一致。

### 需求 3：发布链路兼容

**用户故事：** 作为维护者，我希望旧地址和新地址在过渡期内都可定位，以便用户和自动化流程不会突然失效。

#### 验收标准

1. WHEN 访问旧仓库、Release 或文档链接 THEN System SHALL 能够通过重定向或迁移说明找到新项目。
2. WHEN Actions、安装器、Webhook 或更新清单使用仓库路径 THEN System SHALL 完成实际引用核验和必要更新。
3. WHEN 发布失败 THEN System SHALL 保留旧发布资产和回退步骤。

### 需求 4：兼容旧入口

**用户故事：** 作为旧用户，我希望旧 CLI 或配置仍能工作，以便拥有明确迁移周期。

#### 验收标准

1. WHEN 用户使用旧 CLI 入口 THEN System SHALL 在兼容期内完成基础帮助或查询能力。
2. WHEN 用户读取旧配置 THEN System SHALL 保持配置可读，或提供幂等迁移。
3. WHEN 迁移脚本重复运行 THEN System SHALL 不重复破坏配置或数据。

## 非功能需求

### 非功能需求 1：可回滚

1. 发布过程必须保留旧安装包、更新清单和关键验证记录。
2. 不得依赖不可逆的数据迁移完成品牌更名。

### 非功能需求 2：可追踪性

1. 每个名称命中必须分类为品牌、依赖、路径、签名、兼容性或上游身份。
2. 每项修改必须有验证结果。

## 成功定义

- 下一版本正式使用 OutcomeGo 名称。
- 至少一次真实旧版本升级通过。
- 旧数据、登录、更新和签名链验证通过。
- 迁移说明和回滚依据齐全。

## 详细需求

### 需求 5：名称命中必须分类处理

**用户故事：** 作为维护者，我希望每个旧名称的出现位置都有处理结论，以便避免全局替换破坏上游或兼容性。

#### 验收标准

1. WHEN 执行名称盘点 THEN System SHALL 记录 `aiTeamOS`、`ai-TeamOS`、`aiteamos`、`@aiteamos`、`com.aiteamos`、`com.teambots` 和 `openteam` 的文件、用途和目标处理。
2. WHEN 命中表示上游、协议、数据库或稳定应用标识 THEN System SHALL 将其标记为保留、兼容别名或单独迁移，而不是直接替换。
3. WHEN 命中表示用户可见品牌 THEN System SHALL 将其替换为 OutcomeGo，并提供测试证据。

### 需求 6：Release 版本和资产一致

**用户故事：** 作为发布者，我希望所有平台使用同一个下一版本，以便用户能够正常升级和验证安装包。

#### 验收标准

1. WHEN 根版本更新 THEN `scripts/release/version.ts check` SHALL 通过，workspace、`bun.lock` 和 `apps/ios/release.json` 不得漂移。
2. WHEN Release Workflow 构建资产 THEN server、worker、computer、CLI、Desktop、Android 和 iOS 的版本关系 SHALL 可解释且符合现有发布规则。
3. WHEN CLI 验证更新来源 THEN `DEFAULT_REPOSITORY`、tag、Release 地址和签名工作流 SHALL 指向批准后的仓库地址。

### 需求 7：安装和升级兼容

**用户故事：** 作为旧版本用户，我希望升级到 OutcomeGo 后保留数据和运行能力。

#### 验收标准

1. WHEN 从当前版本执行桌面、CLI、Android 或服务端升级 THEN 用户数据目录、配置目录和数据库 SHALL 保持可读取。
2. WHEN Android 覆盖安装 THEN application ID、签名证书和 versionCode 关系 SHALL 允许系统升级；如必须改变，必须另有迁移方案和批准记录。
3. WHEN iOS 发布配置被修改 THEN bundle identifier、APNs topic、share extension 和 notification extension SHALL 一致并通过现有配置检查。
4. WHEN 任一升级步骤失败 THEN 旧安装包、旧 Release manifest 和回滚说明 SHALL 仍然可用。

### 需求 8：旧入口迁移

**用户故事：** 作为旧 CLI 和自动化用户，我希望旧命令在过渡期仍可执行，以便名称迁移不会打断脚本。

#### 验收标准

1. WHEN 用户调用 `aiteamos` THEN 过渡期内 System SHALL 执行同等基础命令，或明确输出迁移到 `outcomego` 的提示。
2. WHEN 用户使用旧配置键、旧 Compose 文件或旧下载地址 THEN System SHALL 继续读取，或给出幂等迁移结果。
3. WHEN 旧命令执行更新 THEN System SHALL 使用与新命令相同的版本、签名和回滚校验。

### 需求 9：公开信息和许可正确

**用户故事：** 作为开源使用者，我希望知道 OutcomeGo 与 OpenTeam、aiTeamOS 的关系，并能获得完整许可信息。

#### 验收标准

1. WHEN 用户查看 README、FORK 或 Release THEN System SHALL 说明 OutcomeGo 是独立 Fork，不代表上游背书。
2. WHEN 用户检查源代码和发布资产 THEN GPL-3.0-only、版权和第三方许可声明 SHALL 保留。
3. WHEN 仓库地址变化 THEN 旧地址、Issue、Release、PR、Actions、徽章和外部安装链接 SHALL 有迁移验证或说明。

## 发布验收矩阵

| 对象 | 旧值基线 | OutcomeGo 目标 | 必须保留 | 验证 |
|---|---|---|---|---|
| 根工作区 | `aiteamos` / `0.1.0-beta.13` | 下一版本显示 OutcomeGo | 版本同步脚本 | `version.ts check` |
| CLI | `aiteamos` | `outcomego` 主入口 | `aiteamos` 兼容别名 | CLI help/install/update 测试 |
| Desktop | `aiTeamOS`、`aiteamos` | OutcomeGo | updater 和用户数据路径 | package/build/update 测试 |
| Android | `aiTeamOS` | OutcomeGo | `com.teambots.android` 和签名 | APK manifest/证书/覆盖安装 |
| Android namespace | `com.aiteamos.android` | 可延期 | 编译和深链 | Gradle/test |
| iOS | `OpenTeam`/`aiTeamOS` 混合现状 | OutcomeGo 显示名 | bundle ID、APNs、share ID | native config/升级 |
| Compose/镜像 | `aiteamos_*` | 新显示名或兼容标签 | 数据卷、数据库和服务连接 | compose render/smoke |
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

**用户故事：** 作为现有用户，我希望品牌更名不会造成无法覆盖升级、丢失认证或找不到服务器数据。

#### 验收标准

1. WHEN Android 候选包覆盖安装 THEN application ID、签名证书和 versionCode SHALL 满足系统升级要求。
2. WHEN Desktop 候选包覆盖安装 THEN app identity、用户数据目录和 updater state SHALL 仍可读取。
3. WHEN CLI 使用新入口更新 THEN 旧配置目录、认证信息和 update cache SHALL 可读取。
4. WHEN Server/Compose 使用新显示名 THEN 数据库、数据卷和 agent data 路径 SHALL 保持可用，或有明确幂等迁移。
5. WHEN iOS 显示名修改 THEN bundle ID、APNs、share extension 和 keychain 兼容性 SHALL 通过配置检查。

## 需求 13：公开仓库迁移可控

**用户故事：** 作为项目维护者，我希望仓库地址更名不会让 Release、Actions、安装器和用户文档失效。

#### 验收标准

1. WHEN 执行仓库 rename 前 THEN 系统 SHALL 已完成旧 clone/fetch、Tag、Issue、Release、PR、Fork、Actions 和 webhook 盘点。
2. WHEN 仓库 rename 后 THEN CLI default repository、Release API、下载 manifest、README badges 和 workflow 引用 SHALL 经过验证。
3. WHEN 旧路径不自动重定向某类引用 THEN 项目 SHALL 提供迁移页或暂缓 rename。
4. WHEN 仓库 rename 验证失败 THEN 项目 SHALL 继续使用旧仓库地址完成用户可见品牌发布，不强行推进 rename。

## 需求 14：新旧入口有明确过渡期

**用户故事：** 作为自动化脚本维护者，我希望旧 `aiteamos` 入口在过渡期仍然可用，以便更新项目名称不会立即打断已有安装。

#### 验收标准

1. WHEN 用户调用旧 CLI THEN System SHALL 在支持期内执行基础命令或输出可执行迁移提示。
2. WHEN 新旧入口读取同一个配置 THEN 两者 SHALL 使用相同的解析、认证和更新逻辑。
3. WHEN 旧入口被停止支持 THEN Release/迁移文档 SHALL 给出明确版本、日期和替代命令。
4. WHEN 旧入口执行失败 THEN 不得删除旧配置、数据目录或更新状态。

## 需求 15：发布失败有可执行回滚

**用户故事：** 作为发布负责人，我希望候选版本失败时能快速恢复旧版本服务和安装路径。

#### 验收标准

1. WHEN 候选版本未通过签名、升级或关键回归 THEN 发布状态 SHALL 为 `FAIL`，不得继续公开发布。
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
2. 配置迁移脚本重复运行不得重复移动或删除数据。
3. 升级 fixture 必须能够重新创建隔离环境。

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
upgrade result
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
