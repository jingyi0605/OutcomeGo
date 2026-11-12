# OutcomeGo 名称可用性核查

核查日期：2026 年 11 月 12 日（GitHub 仓库重命名后复核）

状态：部分信息已确认，其余待查。GitHub 仓库名已改为 `jingyi0605/OutcomeGo`。npm 上的名称是否被占用、OutcomeGo 相关网址能否注册、App Store/Google Play 的开发者账号与应用名称、商标是否冲突，目前都还没有查完，所以这些项目不能说已经可用。

| 检查类别 | 计划检查 | 本地尝试 | 结果 |
|---|---|---|---|
| GitHub 仓库/组织 | `OutcomeGo` 仓库名、组织和旧仓库重定向 | Repository API 为 `jingyi0605/OutcomeGo`，公开 fork；默认分支 `OutcomeGo`，上游镜像 `main` 独立保留。`/releases/latest` 是 beta.13，正文命令仍使用旧仓库 URL。旧主页 redirect 来自此前浏览器记录；当前未验证 SSH clone redirect | DONE（仓库 slug 和默认分支已改；SSH clone redirect 待单独核验） |
| npm 包名 | `outcomego` 是否已被其他项目占用、目标组织能否使用对应名称 | 尚未查询 npm 当前注册情况 | PENDING |
| 网站地址 | OutcomeGo 相关网址是否可注册，已有网址由谁持有 | 尚未完成所有目标后缀和注册信息查询 | PENDING |
| 应用商店 | Apple App Store 和 Google Play 中是否已有同名应用，以及发布所需开发者账号是否可用 | 尚未检查商店条目或账号 | PENDING |
| 商标 | 主要销售地区是否有相同或近似商标 | 尚未完成官方商标库查询 | PENDING |

此前的查询记录显示 `outcomego.com` 可能已被注册，但还没有重新确认。代码当前没有绑定这个网址。发布前仍需查清计划使用的网址、npm 名称、商店账号和商标；现在不能据此断言名称在这些地方可用。
