# GitHub CI 与发布构建审计

日期：2026 年 11 月 12 日

状态：本地 workflow/YAML 检查 PASS；GitHub beta.13 run API 已核实旧 tag 触发重复工作流；当前修复仍未推送，新配置 runner 验证 PENDING。

## 结论

CI 在 Release workflow 中以 reusable workflow (`workflow_call`) 运行；历史 beta.13 tag 没有触发独立 CI push run。额外触发的是 Android QA 和 CLI installer：其 `push.paths` 未限定分支，因此同一 beta tag 会启动这两条 workflow。当前本地将 CI、Android QA 和 CLI installer 的 push trigger 都限制为 branches，并由 `scripts/check/release-workflows.ts` 锁定；CI 被 Release 调用时仍运行主 checks job。

本地三个独立工作流限定 branch push；从触发器配置看，tag push 只应启动 `release.yml`。GitHub 仓库已改为 `jingyi0605/OutcomeGo`，fork 默认分支计划切换为 `OutcomeGo`，上游 `main` 保持独立。Actions API 显示 `v0.1.0-beta.13` 同一 tag push 上有 Release、Android QA、CLI installer 各一条成功 run；独立 CI tag push 查询为 0 条。三个 tag run 都指向旧提交 `a25f265306f5ce38171ddb25c105c44392ed001b`。这直接证明 Android QA 和 CLI installer 两条额外 workflow 曾重复运行；本地 branch-only trigger 尚未由 runner 验证。active branch ruleset 应随分支迁移到 `OutcomeGo`。GHCR `ai-teamos` 稳定路径继续保留。

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

本地更新配置验证：`bun run check:workflows`、4 个 workflow YAML parse、version check 和 frozen install 均 PASS。CLI typecheck PASS；清除所有代理变量后 CLI 完整套件 756 pass/0 fail。Desktop typecheck PASS，544 pass/1 skip/0 fail。Android debug package wrapper PASS；release-gate 静态 parity、assetlinks、live parity、FCM 和 dependency 检查 PASS，manifest cleartext 仍 PENDING。数据库 CI 已改为 fresh-schema job，但 PostgreSQL integration test 未在本机运行，远端 runner 尚未验证当前改动。

该审计没有读取 GitHub Secrets 值或签名私钥，也未启动 release tag。真实 runner 是否只触发 Release workflow，需在本地变更提交并推送后从 GitHub Actions 事件记录核验。GitHub Release API 当前仍返回 beta.13；新 beta.14 尚未发布。
