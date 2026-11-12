# GitHub 仓库重命名决定与执行记录

- 日期：2026 年 11 月 12 日
- 目标：`jingyi0605/OutcomeGo`
- 更名后状态（2026-11-13）：GitHub 仓库为 `jingyi0605/OutcomeGo`，默认分支为 `OutcomeGo`；远端 `ai-TeamOS` 已删除，上游同步分支 `main` 保持不变。最新已发布版本仍是 `v0.1.0-beta.13`。
- 执行方式：仓库 slug 此前通过 GitHub Settings 从 `ai-TeamOS` 改为 `OutcomeGo`。负责人现授权同步当前代码并将 fork 默认分支重命名为 `OutcomeGo`；上游 `main` 不改名。
- 初始核验：仓库 slug `jingyi0605/OutcomeGo`，公开且为 OpenTeam fork；旧默认分支 `ai-TeamOS` 指向 `a25f265306f5ce38171ddb25c105c44392ed001b`。
- 完成核验：本地 `OutcomeGo`、`origin/OutcomeGo` 和 GitHub 默认分支均指向 `048df07d40b3fbd3a0a0c52652daaf86fb15210a`；旧 tip `53d1a7bcfcfb9b86757b7f0966b3cad4502cefcb` 是新 tip 的祖先；GitHub 不再有 `ai-TeamOS` 分支；active ruleset 只保护 `OutcomeGo`；无打开的 PR；`origin/HEAD` 跟踪 `origin/OutcomeGo`。
- 已核验 Release 行为：新仓库 `releases/latest` 解析到 `v0.1.0-beta.13`；GitHub Release API 页面包含 beta.13 旧名称资产，Release 正文的安装器及 Full Changelog URL 仍指向旧 slug。CodingNS 直接 fetch 旧下载 URL 回 HTTP 404；不能据此宣称旧附件 redirect 可用。
- 未核验：旧 SSH clone URL 的 redirect、GitHub API 写权限、Push 权限、Actions secrets/variables 的逐项存在性以及当前本地 workflow/database 改动的 runner 执行。其他 GitHub owner、npm scope、更多域名、商店提交流程和商标仍未完整核查。

## 决定

负责人已明确批准将 fork 的默认/source branch 改名为 `OutcomeGo`。该操作已完成：目标分支包含旧分支全部历史，切为 GitHub 默认分支，保护规则已迁移，旧 ref 删除。上游镜像分支 `main` 保留，用于上游合并和向上游提交 PR。

## 本地准备结果

- README/FORK、文档 metadata、移动端说明和应用内仓库链接使用新 slug；多个用户入口中的 server installer 旧域名已改为新 GitHub Releases URL。GitHub 网页当前公开文件仍是旧提交内容，说明本地修正尚未推送。
- CLI `DEFAULT_REPOSITORY`、Desktop electron-builder publish repo 和 release workflow consistency check 使用 `jingyi0605/OutcomeGo`。
- GHCR 保持 `ghcr.io/jingyi0605/ai-teamos-*`；GitHub repository rename 不会迁移 Container Registry package。本次不复制镜像、不更名 GHCR。
- 仓库网页旧 URL 已在浏览器中验证会跳转到新 slug；CodingNS `web_fetch` 对旧 Release asset URL 返回 404。不同访问方式结果不可互相外推；SSH clone redirect 仍待验证。

## 后续验证

1. 记录本次分支重命名、default branch、ruleset、远端 SHA 和推送后的 CI run。
2. 在直接下载路径可用的网络上重新验证旧 SSH clone URL 与 beta.13 Release asset URL redirect；目前网页抓取返回 404。
3. 检查 Environments、secrets/variables、webhooks、deploy keys、GitHub Apps、Pages 和 Marketplace links；不得读取或记录 secret 值。
4. Tag 发布前再核对签名门槛与候选清单。

## 回滚

若新路径 Actions、Release 或下载失败，暂停发布。可在 Settings 将仓库名改回 `ai-TeamOS` 并同步恢复本地 `origin`；不能假定所有第三方链接会随之恢复。不得删除旧 Release、Tag、GHCR packages 或用户数据。
