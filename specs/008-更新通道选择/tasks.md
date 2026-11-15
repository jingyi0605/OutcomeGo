# 任务清单 — 更新通道选择

关联需求：[requirements.md](requirements.md) | 设计：[design.md](design.md)

## 已完成任务

### TASK-01：服务端通道持久化与切换 API（REQ-01、REQ-02、REQ-03）

**文件**：`apps/server/src/server-updates.ts`，`apps/server/src/main.ts`

变更摘要：
- `ServerUpdates` 新增 `_allowPrerelease`、`channelFile`，构造时读 `update-channel.json`
- `get updateChannel()` 返回当前通道
- `setChannel()` 写文件并更新内存
- 导出 `updateChannelRoute`（GET/PUT）
- `main.ts`：版本端点返回实时通道，注册新路由

验收：AC-01、AC-02、AC-03

---

### TASK-02：客户端核心 setUpdateChannel（REQ-02）

**文件**：`packages/client-core/src/client.ts`

变更摘要：新增 `setUpdateChannel(channel)` → PUT `/api/v0/system/update-channel`

验收：TASK-04、TASK-05 依赖此方法

---

### TASK-03：桌面端 ComputerSettings 通道字段（REQ-05）

**文件**：`apps/desktop/src/main/computer-settings.ts`

变更摘要：`updateChannel` 字段，默认 `"stable"`，`normalize` 与 `update` 均处理

---

### TASK-04：桌面主进程 IPC 与 autoUpdater 通道支持（REQ-05）

**文件**：`apps/desktop/src/main/index.ts`，`apps/desktop/src/preload/index.ts`

变更摘要：
- 新增 IPC `get-channel`、`set-channel`
- `checkForDesktopUpdate()` 读取 `ComputerSettings.updateChannel`，设置 `autoUpdater.allowPrerelease`
- 非 feed 构建：beta 通道查列表 API 并过滤 prerelease

验收：AC-05（desktop）

---

### TASK-05：桌面渲染层类型与 Hook（REQ-04）

**文件**：`apps/desktop/src/renderer/env.d.ts`，`use-server-update-status.ts`，`use-server-update.ts`

变更摘要：
- `OutcomeGoUpdateStatus.track` 改为联合类型
- `OutcomeGoServerUpdateStatus` 新增 `updateChannel`
- `setView` 合并 `release.updateChannel`
- `useServerUpdate` 暴露 `serverUpdateChannel`、`setServerUpdateChannel`

---

### TASK-06：桌面更新设置 UI（REQ-04）

**文件**：`apps/desktop/src/renderer/components/outcomego/settings/updates.tsx`

变更摘要：在"OutcomeGo Updates" label 后插入通道切换控件行

验收：AC-04

---

### TASK-07：deep-link anchor（REQ-04）

**文件**：`packages/contracts/src/app-deep-links.ts`，`apps/desktop/src/renderer/lib/app-deep-links.ts`

变更摘要：新增 `"update-channel"` anchor，映射到 `"updates"` 视图

---

### TASK-08：iOS ServerRelease updateChannel 字段（REQ-06）

**文件**：`apps/ios/Sources/Core/ServerUpdates.swift`

变更摘要：`ServerRelease` 新增 `updateChannel: String?`（可选，向后兼容）

---

### TASK-09：iOS 通道选择 UI（REQ-06）

**文件**：`apps/ios/Sources/App/UpdatesSettingsView.swift`

变更摘要：
- `ServerUpdateModel` 新增 `channelSaving`、`updateChannel`、`setChannel`
- Form 中插入 `Picker` 控件

验收：AC-05（iOS）

---

### TASK-10：Android 通道支持（REQ-07）

**文件**：`apps/android/app/src/main/kotlin/com/outcomego/platform/AndroidUpdateManager.kt`，`SettingsScreens.kt`，`OutcomeGoApp.kt`，`MainActivity.kt`，`AppViewModel.kt`

变更摘要：
- beta 常量 URL、`channel` 属性、`setChannel()`
- `SettingsScreen` 新增通道参数与 `UpdateChannelRow` composable

验收：AC-06
