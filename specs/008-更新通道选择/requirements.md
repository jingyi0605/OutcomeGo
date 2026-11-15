# 需求规格 — 更新通道选择

关联设计：[design.md](design.md) | 任务：[tasks.md](tasks.md)

## 功能概述

在更新设置页面增加"更新通道"选择，支持两个通道：

- **稳定版（stable）**：仅接收正式发布版本（无 prerelease 标识）。
- **开发版（beta）**：同时接收 `beta.x` 预发布版本与稳定版，以 beta 更新优先。

该设置统一控制：服务端更新、桌面端自身更新、iOS 与 Android 移动端更新。

## 需求列表

### REQ-01：服务端通道持久化

服务端的更新通道存储于数据目录下的 `update-channel.json`，启动时优先读取该文件，无文件则回落到 `OUTCOMEGO_UPDATE_CHANNEL` 环境变量，默认值为 `stable`。

### REQ-02：服务端通道切换 API

提供 `PUT /api/v0/system/update-channel` 端点：
- 请求体：`{ "channel": "stable" | "beta" }`
- 响应体：`{ "updateChannel": "stable" | "beta" }`
- 鉴权：与 `/api/v0/system/update` POST 相同（需要 owner session + Bearer token）
- 效果：立即更新内存状态（允许或拒绝 prerelease 版本请求），同时写入持久化文件

### REQ-03：/api/v0/system/version 返回当前通道

`GET /api/v0/system/version` 的响应中 `updateChannel` 字段反映当前生效的通道（包含运行时更改），而非仅返回启动时的快照。

### REQ-04：桌面端通道选择 UI

桌面更新设置页顶部显示"更新通道"行，包含"稳定版 / Beta"切换控件：
- 切换时同时调用服务端 API 与本地 IPC 保存通道偏好
- 通道状态从连接服务端读取，断线时显示本地缓存值

### REQ-05：桌面端自身更新遵循通道

`electron-updater` 在每次 `checkForUpdates()` 前根据 `ComputerSettings.updateChannel` 设置 `allowPrerelease`；非 feed 构建在 beta 通道下向 GitHub API 查询含预发布的 release 列表。

### REQ-06：iOS 通道选择 UI

iOS 更新设置页中显示"Update channel"选择器（Stable / Beta），触发对 `/api/v0/system/update-channel` 的 PUT 请求并即时更新本地 `release.updateChannel`。

### REQ-07：Android 通道支持

`AndroidUpdateManager` 维护通道偏好（持久化至 SharedPreferences）。beta 通道使用独立的 manifest URL（`android-update-beta.json`）。Android 设置页中显示通道切换行。

## 验收标准

| 编号 | 条件 |
|------|------|
| AC-01 | 服务端重启后，通过 API 修改的通道不丢失 |
| AC-02 | 切换到 beta 后，服务端接受包含 `-beta.x` 的版本号 POST 请求 |
| AC-03 | 切换到 stable 后，服务端拒绝 prerelease 版本 POST 请求（返回 400） |
| AC-04 | 桌面更新设置页展示通道切换控件，当前通道与服务端一致 |
| AC-05 | iOS 更新设置页展示 Picker，切换后服务端通道同步变更 |
| AC-06 | Android 设置页展示通道切换行，选择后 SharedPreferences 记录新通道 |
