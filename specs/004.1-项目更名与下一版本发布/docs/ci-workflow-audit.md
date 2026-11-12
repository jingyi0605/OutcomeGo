# GitHub CI 与发布构建审计

日期：2026 年 11 月 12 日

状态：本地 workflow/YAML 检查 PASS；OutcomeGo 默认分支 push 已验证分支触发去重配置生效；首轮 runner 发现 Android source 路径、enum parity、PostgreSQL 初始化和 Ubuntu CLI 超时问题，修正已在本地，待后续 push 复验。

## 结论

CI 在 Release workflow 中以 reusable workflow (`workflow_call`) 运行；历史 beta.13 tag 没有触发独立 CI push run。额外触发的是 Android QA 和 CLI installer：其 `push.paths` 未限定分支，因此同一 beta tag 会启动这两条 workflow。当前本地将 CI、Android QA 和 CLI installer 的 push trigger 都限制为 branches，并由 `scripts/check/release-workflows.ts` 锁定；CI 被 Release 调用时仍运行主 checks job。

本地三个独立工作流限定 branch push；tag push 只应启动 `release.yml`。GitHub 默认分支现为 `OutcomeGo`，上游 `main` 保持独立。Actions API 显示 `v0.1.0-beta.13` 同一 tag push 曾启动 Release、Android QA、CLI installer 各一条，独立 CI tag push 为 0 条；branch-only trigger 避免 tag 启动 Android QA/CLI installer。初次向 `OutcomeGo` 推送时 GitHub 只启动 CI、Android QA、CLI installer 三条 branch run，没有额外 tag build；静态检查和版本检查通过。

首轮 run 的剩余失败为：Android QA 因根目录 `.gitignore` 中裸 `data` 模式忽略 `apps/android/**/data/`，导致 Android 数据源和测试文件未被提交；Architecture 的 enum parity checker 把数据库 `@@map` 名错当作 contract export；PostgreSQL fresh-schema 测试把 Prisma `public` schema 与自建 `outcome_data` schema 混用，且 raw trigger function 未 schema-qualify；Ubuntu CLI 有一项诊断 socket 测试超过测试框架默认 5 秒，Windows CLI installer 通过。后续本地已修复前四项；GitHub runner 尚未复验。

历史 run 查询：

- [Release v0.1.0-beta.13](https://api.github.com/repos/jingyi0605/OutcomeGo/actions/runs/43018080684)
- [Android QA v0.1.0-beta.13](https://api.github.com/repos/jingyi0605/OutcomeGo/actions/runs/43018080579)
- [CLI installer v0.1.0-beta.13](https://api.github.com/repos/jingyi0605/OutcomeGo/actions/runs/43018080486)
- [独立 CI tag run query](https://api.github.com/repos/jingyi0605/OutcomeGo/actions/workflows/ci.yml/runs?branch=v0.1.0-beta.13&event=push&per_page=5)，`total_count=0`。

## 构建和资产关系

| 层级 | 构建来源 | 是否上传发布资产 | 命名结论 |
|---|---|---:|---|
| CI Docker 校验 | `ci.yml` 的 `docker` job | 否 | 分支 push/PR 校验；发布 tag 时独立 CI 不触发，复用调用时跳过 |
| 发布 Docker 镜像 | `release.yml` 的 `images` job | 通过 digest 合并并推送 | 每个平台架构只构建一次，随后生成版本 tag 和 digest |
| CLI 原始二进制 | `cli-build` → `sign` | 是 | 负责人授权 beta.14 新名称 `outcomego-<os>-<arch>`，作为 installer/updater 使用的无版本下载名 |
| Compose 文件 | `sign` | 是 | 负责人授权 beta.14 新名 `outcomego-compose.yaml`；beta.13 `aiteamos-compose.yaml` 保留为历史资产 |
| Desktop | `desktop`、可选 `macos` | 是 | `aiTeamOS-${version}-${os}-${arch}`；prefix 保留待旧 updater fixture 证明，`latest*.yml` 是 updater 元数据，不是第二份安装包 |
| Android | `android` | 是（`RELEASE_ANDROID=true` 且密钥齐全） | beta.14 目标名 `OutcomeGo-${version}-android.apk` 和 `android-update.json` |
| iOS | 可选 `ios`，由 `RELEASE_IOS` 控制 | 暂缓 | 本次不启用 iOS 发布任务 |

同一平台的有版本和无版本资产可能承担不同下载身份，不代表两份安装包：CLI raw binary 名称稳定、无版本号，供 installer/updater 按 tag 下载；Android APK 和 Desktop 安装包带版本号；Desktop `latest*.yml` 是 updater metadata，不是第二份安装包。Release `upload-artifact` 先在 workflow jobs 间传递中间结果，`publish` job 只汇总并上传一份 Release asset。当前 release workflow 每个平台只有一条正式构建路径：release matrix 构建一次，再由 `publish` 组装；独立 CI/Android QA/CLI installer 不应由 tag push 构建。

重复工作问题确实存在于 beta.13 release tag：Release workflow、Android QA、CLI installer 三条 workflow 同时运行。Android QA 单独 assemble debug APK，Release 构建 Android release APK，属于同平台的重复构建工作，但 QA 只上传报告，不把 debug APK 作为 Release asset；CLI installer workflow 跑跨平台安装器/回归测试，与 Release CLI asset build 在 CLI 构建和验证工作上重叠。独立 CI tag query 为 0，Release 的 `workflow_call` CI job 是 Release 的依赖，不是第二个独立 workflow run。branch 过滤避免 tag push 启动 Android QA/CLI installer；Release 内部 CI 跳过 Docker 验证，由 Release `images` job 构建镜像。

公开 Release 中同平台 versioned/unversioned 的文件不等于两份安装包：CLI 无版本名 binary 是 installer/updater 按 tag 下载的稳定 asset contract；Android APK 和 Desktop 安装包带版本号；`latest*.yml` 是 Desktop updater metadata。Release jobs 上传的 workflow artifacts 是 job 间暂存，不会原样作为第二套 release assets 上传。当前 branch-filter 修复和本地 Release 行为尚未推送至 GitHub runner 验证。beta.13 本身仍是旧身份历史资产，beta.14 目前未发版。

## 签名门槛

- CLI：发布标签由 `sign` job 使用 GitHub OIDC 生成并验证 Sigstore 证据。
- Windows：发布标签缺少 Authenticode 证书或密码时直接失败；workflow_dispatch dry-run 可以保留未签名构建。
- macOS：`RELEASE_MACOS=true` 时必须提供 Developer ID 和 notarization 凭据。
- Android：`RELEASE_ANDROID=true` 时必须提供 APK keystore 和 update manifest 私钥。
- iOS：本次保持可选并延期。

## 本地验证

```sh
bun run check:workflows
ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].each { |path| YAML.load_file(path); puts "YAML OK: #{path}" }'
bun scripts/release/version.ts check
bun install --frozen-lockfile --ignore-scripts
```

初次 push commit `048df07d40b3fbd3a0a0c52652daaf86fb15210a` 的 run：CI `43252477033` 的版本、安装、workflow graph 及三镜像构建通过，但 architecture 和 database-fresh-schema 失败；Android QA `43252476855` 因被忽略的 `data/` 文件未入提交而编译失败；CLI installer `43252476846` 的 Windows job 通过，Ubuntu 759/760 tests 通过，APNs socket test 在 5 秒测试超时处失败，macOS job 后来取消。后续修复已在本地；architecture、version、workflow、`git diff --check` 和 Android debug package 通过。PostgreSQL integration 受“不启动数据库服务”的本地约束未执行，等待 GitHub runner。

该审计没有读取 GitHub Secrets 值或签名私钥，也未启动 release tag。真实 runner 是否只触发 Release workflow，需在本地变更提交并推送后从 GitHub Actions 事件记录核验。GitHub Release API 当前仍返回 beta.13；新 beta.14 尚未发布。
