# 004.1 发布前基线

- 记录日期：2026 年 11 月 12 日
- 工作目录：`/Users/jackson/Code/openteam`
- 分支：`ai-TeamOS`
- 当前提交：`2a8da6f7cca316e60bd7ed3b575c67591c9e0c31`
- 当前提交时间：2026-11-11 22:26:23 +08:00
- 当前提交消息：`修复：补充网页搜索抓取多提供商调度规格`
- 根版本：`0.1.0-beta.13`
- 版本脚本结果：`bun scripts/release/version.ts check` 通过，输出 `All versions agree: 0.1.0-beta.13`
- 当前稳定标签：`v0.1.0-beta.13`
- 标签对象：`a25f265306f5ce38171ddb25c105c44392ed001b`
- 标签时间：2026-11-11 20:10:04 +08:00
- 远程仓库：`origin=https://github.com/jingyi0605/ai-TeamOS.git`
- 上游仓库：`upstream=https://github.com/raghavpillai/openteam.git`
- 远程分支状态：本地分支相对 `origin/ai-TeamOS` 显示 `ahead 6`

## 工作树快照

`git status --short --branch` 显示：

- 当前分支为 `ai-TeamOS`。
- 只有用户明确要求保留的未跟踪 `specs/004*` 和 `specs/005.1*` 目录。
- 未发现其他已修改或未跟踪源代码文件。

## 发布与网络可见性

- 本地标签列表包含 `v0.1.0-beta.13` 及之前的 fork 版本标签。
- `gh release list --limit 20` 未能完成：GitHub GraphQL 请求被当前代理拒绝，错误为连接 `127.0.0.1:7890` 失败。
- `git ls-remote` 同样未能完成，错误为连接 `127.0.0.1:7890` 失败。
- 因此本基线没有把远程 Release asset 或远程 refs 写成已验证事实；远程 Release 清单保留为外部核查项。

## 执行命令

```text
git status --short --branch
git remote -v
git branch -a
git tag --list --sort=-version:refname
git show -s --format='%H%n%aI%n%D%n%s' v0.1.0-beta.13
bun scripts/release/version.ts check
gh release list --limit 20
git ls-remote --heads origin ai-TeamOS main
```
