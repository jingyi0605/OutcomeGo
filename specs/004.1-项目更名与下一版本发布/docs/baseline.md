# 004.1 发布前基线

- 记录日期：2026 年 11 月 12 日
- 工作目录：`/Users/jackson/Code/openteam`
- 分支：`ai-TeamOS`
- 当前提交：`53d1a7bcfcfb9b86757b7f0966b3cad4502cefcb`
- 当前提交时间：2026-11-12 10:11:46 +08:00
- 当前提交消息：`修复：Android 浅色模式状态栏图标自动适配对比度`
- 根版本：`0.1.0-beta.14`
- 版本脚本结果：`bun scripts/release/version.ts check` 通过，输出 `All versions agree: 0.1.0-beta.14`
- 当前最新本地标签：`v0.1.0-beta.13`
- `v0.1.0-beta.13` 标签对象：`a25f265306f5ce38171ddb25c105c44392ed001b`
- 标签时间：2026-11-11 20:10:04 +08:00
- 远程仓库：`origin=https://github.com/jingyi0605/OutcomeGo.git`
- 上游仓库：`upstream=https://github.com/raghavpillai/openteam.git`
- 远程跟踪状态：本地 `ai-TeamOS` 相对缓存的 `origin/ai-TeamOS` ahead 10；本轮 `git ls-remote` 因本机代理 `127.0.0.1:7890` 不可达失败，不能据此声称远端已同步。
- GitHub Release：公开 GitHub Release API 显示最新仍为 `v0.1.0-beta.13`；beta.14 尚未发布。

## 工作树快照

`git status --short --branch` 显示分支为 `ai-TeamOS...origin/ai-TeamOS [ahead 10]`。工作树有约 1,783 个修改、删除或未跟踪条目，包含此前已开始的全量重命名实现、生成产物和未跟踪规格文档；此状态不是干净发布 checkout。本轮未清理、重置或覆盖这些内容。

## 发布与网络可见性

- 当前 GitHub 仓库 slug 是 `jingyi0605/OutcomeGo`，默认分支仍为 `ai-TeamOS`。
- GitHub 页面/API 可读取 beta.13 的资产和 Release 正文；Release 标题和资产名仍为旧身份，安装命令也指向旧 slug。
- GitHub Actions 上可见的成功 run 均为 beta.13/更名前历史执行；本地未推送的 workflow 修复没有 GitHub runner 证据。
- 本机 `gh`/`git` 的 HTTPS 网络受不可用代理阻塞；本地 remote-tracking refs 是缓存，不能代替远端实时读取。

## 执行命令

```text
git status --short --branch
git remote -v
git branch --show-current
git rev-list --left-right --count origin/ai-TeamOS...HEAD
git tag --list --sort=-version:refname
git show -s --format='%H%n%aI%n%D%n%s' v0.1.0-beta.13
bun scripts/release/version.ts check
git ls-remote origin refs/heads/ai-TeamOS
```

公开 Release 资料：<https://api.github.com/repos/jingyi0605/OutcomeGo/releases/latest>。
