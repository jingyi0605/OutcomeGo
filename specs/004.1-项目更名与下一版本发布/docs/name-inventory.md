# 004.1 名称命中分类清单

- 盘点日期：2026 年 11 月 12 日
- 盘点范围：仓库工作树；排除 `.git`、`node_modules`、构建输出和本 Spec 之外的生成目录。
- 处理原则：按用途分类，不执行全局替换。用户可见文案进入 `rename`；旧入口和旧配置进入 `alias`；升级、签名、协议、数据和上游身份进入 `preserve`；需要远程账号、设备或单独迁移任务的内容进入 `separate-migration`。

## 处理结论

| 命中模式或代表位置 | 用途 | 分类 | 本阶段结论与证据要求 |
|---|---|---|---|
| `aiTeamOS` 用户可见文案：README、FORK、CLI 输出、Desktop About/权限、Android/iOS 文案、迁移文档 | 产品显示品牌 | `rename` | 改为 `OutcomeGo`；保留历史关系为“OutcomeGo (formerly aiTeamOS), an independent fork of OpenTeam, not affiliated with or endorsed by upstream”。|
| `ai-TeamOS` 仓库路径、默认分支、发布链接 | GitHub 分发身份 | `separate-migration` | 本会话不改仓库、不推送、不改远程设置；旧路径保留并在迁移文档中说明。仓库改名由任务 6.2 单独决定。|
| `aiteamos` CLI 命令、可执行文件、配置目录、Compose 项目和运行路径 | 旧入口与稳定运行身份 | `alias` / `preserve` | 新增 `outcomego` 入口并共用同一解析、配置和更新路径；`aiteamos` 保留。`PROJECT_NAME`、可执行文件、配置目录和运行路径保留。|
| `@aiteamos/*` | Bun workspace package scope | `preserve` | 本阶段不改，避免依赖图和上游同步冲突。|
| 根 package name `aiteamos` | workspace 根身份 | `preserve` | 本阶段不改。|
| `apps/cli/src/constants.ts` 的 `PROJECT_NAME`、`DEFAULT_REPOSITORY`、`DEFAULT_IMAGE_PREFIX` | Compose、Release 和镜像稳定身份 | `preserve` | 按固定决策保持原值；默认仓库和镜像迁移由 6.2/独立迁移任务决定。|
| `aiteamos-compose.yaml`、`aiteamos-<os>-<arch>` | Release asset 名称 | `preserve` | 保持原名，避免旧版本 updater 无法解析；Desktop artifact 前缀只有在有 updater 证据时才改，本阶段保留。|
| `.github/workflows/release.yml` | Sigstore workflow identity | `preserve` | 文件名保持不变；签名身份继续使用该路径。|
| `ghcr.io/jingyi0605/ai-teamos-*` | GHCR 镜像路径 | `preserve` | 不重命名、不新增并行镜像路径；旧路径继续服务现有 Compose/CLI 更新。|
| `AITEAMOS_*` | 环境变量和配置键 | `preserve` | 约 219 个运行时变量按原名保留；本阶段不新增 `OUTCOMEGO_*` 别名。|
| `aiteamos_events` | PostgreSQL LISTEN 通道 | `preserve` | 保留，避免新旧版本混跑时丢失事件唤醒。|
| `aiteamos://` | Android、iOS、Desktop 深链 scheme | `preserve` | 保留，确保旧链接和 004.3 深链兼容。|
| `dev.aiteamos.desktop` | Desktop appId、安装和通知身份 | `preserve` | 保留，不因显示名变化破坏覆盖升级。|
| Desktop `aiteamos` executable、`dist-electron/aiteamos-cli.js` | 本地进程和更新兼容身份 | `preserve` | 保留；显示名和 About 改为 OutcomeGo。|
| Desktop userData 目录 `aiTeamOS` | 认证、机器 ID、设置和 durable journal 数据路径 | `preserve` | 在读取 userData 前固定为 `join(app.getPath("appData"), "aiTeamOS")`，并加测试。|
| `com.teambots.android` | Android applicationId 和覆盖升级身份 | `preserve` | 保留；debug 后缀仍为 `.debug`。|
| `com.aiteamos.android` | Android namespace、Kotlin package、action/provider identity | `preserve` | 保留，避免无必要的源码和 manifest 迁移。|
| Android signing、update manifest public key、provider authority | 签名和更新身份 | `preserve` | 不访问私钥、不改信任链。|
| iOS `dev.aiteamos.mobile` 及 extensions | Bundle ID、Keychain、APNs 和扩展身份 | `preserve` | 保留，显示名单独修改。|
| iOS APNs topic、URL scheme `aiteamos` | 推送和深链协议 | `preserve` | 保留。|
| iOS `APP_DISPLAY_NAME` 中的 `OpenTeam` | Release/Debug 用户可见显示名 | `rename` | Release 改为 `OutcomeGo`；Debug 使用 `OutcomeGo Dev` 保持区分。|
| 其他 `OpenTeam` 文本、`openteam` API/路径/协议/上游目录 | 上游身份、协议和运行时兼容 | `preserve` | 逐项保留；只有直接显示给用户的产品名才改。不得全局替换。|
| GitHub repository rename、真实 Release、签名候选包、设备升级 | 外部发布或单独迁移 | `separate-migration` | 任务 2.2、3.x、6.x、7.1/7.4 按用户要求留作 PENDING，不在本会话执行。|

## 必须覆盖的专项命中

| 专项 | 代表文件 | 分类 | 当前处理 |
|---|---|---|---|
| GHCR `ai-teamos` | `apps/cli/src/constants.ts`、`.github/workflows/release.yml`、Compose/发布文档 | `preserve` | 保留镜像路径，记录为稳定分发身份。|
| `AITEAMOS_*` | `docker-compose.yml`、CLI/server/worker/computer 配置 | `preserve` | 保留全部环境变量和配置键。|
| `aiteamos_events` | `apps/server/src/event-wakeup.ts` | `preserve` | 保留 PostgreSQL LISTEN 通道。|
| `aiteamos://` | Android Manifest、iOS release/config、Desktop deep-link parser | `preserve` | 保留旧 scheme 和现有解析。|
| iOS `APP_DISPLAY_NAME` | `apps/ios/scripts/generate-project.py` | `rename` | Release `OutcomeGo`，Debug `OutcomeGo Dev`。|

## 审计命令

```text
rg -n -i 'aiteamos|aiTeamOS|ai-teamos|openteam|com\.teambots|com\.aiteamos'
```

审计结果必须结合本表与最终 `rg` 复核：命中稳定标识、协议、上游身份或本清单自身时保留；命中用户可见品牌时继续修正，直到没有遗漏的用户可见字符串。
