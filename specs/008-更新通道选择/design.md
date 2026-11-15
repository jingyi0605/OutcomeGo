# 技术设计 — 更新通道选择

关联需求：[requirements.md](requirements.md) | 任务：[tasks.md](tasks.md)

## 数据流

```
用户 UI 切换通道
    ├─ PUT /api/v0/system/update-channel   → ServerUpdates.setChannel()
    │       写入 update-channel.json（数据目录）
    │       更新内存 _allowPrerelease
    │       /api/v0/system/version 实时返回新 updateChannel
    │
    └─ IPC outcomego:updates:set-channel   → ComputerSettings.updateChannel
            下次 checkForUpdates() 读取
            autoUpdater.allowPrerelease = true/false
```

## 各层变更

### 服务端（apps/server）

**`server-updates.ts`**
- 新增字段 `_allowPrerelease: boolean`（替代原 readonly 构造参数）
- 构造时：先读 `update-channel.json`，无文件则用传入的 allowPrerelease
- `get updateChannel()` 返回 `"stable" | "beta"`
- `setChannel(channel)` 写文件 + 更新内存
- `start()` 中使用 `this._allowPrerelease` 判断 prerelease 是否允许
- 导出新函数 `updateChannelRoute` 处理 GET/PUT `/api/system/update-channel`

**`main.ts`**
- `/api/system/version` 响应改为 `{ ...release, updateChannel: serverUpdates.updateChannel }`
- 新增路由 `/api/system/update-channel` → `updateChannelRoute`

### 客户端核心（packages/client-core）

**`client.ts`** — 新增 `setUpdateChannel(channel)` → PUT `/api/v0/system/update-channel`

### 桌面端（apps/desktop）

**`computer-settings.ts`**
- `ComputerSettings` 新增 `updateChannel: "stable" | "beta"`，默认 `"stable"`

**`index.ts`（主进程）**
- IPC `outcomego:updates:get-channel` → 读 ComputerSettings
- IPC `outcomego:updates:set-channel` → 写 ComputerSettings
- `checkForDesktopUpdate()` 在调用 `checkForUpdates()` 前读取并设置 `autoUpdater.allowPrerelease`
- 非 feed 构建：beta 通道查 `/releases?per_page=10`（含 prerelease），stable 仍查 `/releases/latest`

**`preload/index.ts`** — 在 `updates` 对象中暴露 `getChannel`、`setChannel`

**`env.d.ts`**
- `OutcomeGoUpdateStatus.track` 改为 `"stable" | "beta"`
- `OutcomeGoServerUpdateStatus` 新增 `updateChannel: "stable" | "beta" | null`
- `updates` 接口新增 `getChannel`、`setChannel`

**`use-server-update-status.ts`** — `setView` 中合并 `release.updateChannel`

**`use-server-update.ts`** — 导出 `serverUpdateChannel`、`setServerUpdateChannel`

**`settings/updates.tsx`** — 在"OutcomeGo Updates" SectionLabel 下方插入通道切换行

**`packages/contracts/src/app-deep-links.ts`** — 新增 anchor `"update-channel"`

**`apps/desktop/src/renderer/lib/app-deep-links.ts`** — `viewByAnchor` 新增 `"update-channel": "updates"`

### iOS（apps/ios）

**`Sources/Core/ServerUpdates.swift`** — `ServerRelease` 新增 `updateChannel: String?`

**`Sources/App/UpdatesSettingsView.swift`**
- `ServerUpdateModel` 新增 `channelSaving`、`updateChannel` 计算属性
- 新增 `setChannel(_ channel:, store:)` async 方法，PUT `/api/v0/system/update-channel`
- Form 中"App"Section 新增 `Picker("Update channel", ...)` — 仅在非更新/非加载状态显示

### Android（apps/android）

**`AndroidUpdateManager.kt`**
- 常量：`UPDATE_MANIFEST_URL_STABLE`、`UPDATE_MANIFEST_URL_BETA`
- `channel: String` 属性 — 读写 SharedPreferences key `update-channel`
- `setChannel(newChannel)` — 验证 + 写 pref + 重置 last-check + 清空状态
- `fetchManifest()` 使用 `manifestUrl` 计算属性（依据 channel 选择 URL）

**`SettingsScreens.kt`**
- `SettingsScreen` 新增参数 `androidUpdateChannel`、`onSetAndroidUpdateChannel`
- 在 `AndroidUpdateRow` 后追加 `UpdateChannelRow` composable（稳定版/开发版两段式切换器）

**`OutcomeGoApp.kt`** — `OutcomeGoApp` 新增相应参数并透传至 `SettingsScreen`

**`MainActivity.kt`** — 传入 `viewModel.androidUpdateChannel`、`viewModel::setAndroidUpdateChannel`

**`AppViewModel.kt`** — 新增 `androidUpdateChannel` 属性、`setAndroidUpdateChannel` 方法

## 兼容性

- 旧服务端无 `/api/v0/system/update-channel` 时，PUT 失败，UI 显示错误，不影响其他功能
- `update-channel.json` 不存在时回落到环境变量，行为与旧版完全一致
- `ServerRelease.updateChannel` 为可选字段，旧服务端返回时缺失不影响 iOS 解码
