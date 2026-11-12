# OutcomeGo 移动端

中文 | [English](README.en.md)

OutcomeGo 移动端是你的服务端的客户端：登录同一个服务器后，手机上看到的 bot 和对话与桌面端一致。

## 支持的平台

| 平台 | 要求 | 获取方式 | 说明 |
| --- | --- | --- | --- |
| Android | Android 8.0（API 26）及以上 | 从源码构建；beta.14 尚未发布 | [apps/android/README.md](../../apps/android/README.md) |
| iPhone / iPad | iOS 18 及以上 | 暂不提供安装包，只能从源码构建（测试版） | [apps/ios/README.md](../../apps/ios/README.md) |

iOS 暂时没有安装包，也不提供 TestFlight 或 App Store 下载。

## 能做什么

- 与 bot 聊天，发送文件和图片，使用语音消息和实时语音对话。
- 回答 bot 提出的问题和表单。
- 查看 bot 的云端电脑屏幕，需要时接管操作。
- 添加、编辑和运行例行任务。
- 在设置中连接模型、管理服务器和已连接的电脑。
- 接收推送通知，并从系统分享菜单把内容发给 bot。

## 连接服务端

1. 在服务端主机上运行 `outcomego status`，记下**服务器地址**。
2. 在手机上打开 OutcomeGo，输入该地址，并用设置时创建的用户名和密码登录。
3. 手机必须能访问这个地址：
   - 在家里使用局域网地址，例如 `http://192.168.1.20:8787`。
   - 在外面使用 Tailscale 等 VPN，或给服务端配置 HTTPS 地址。
   - `localhost` 和 `127.0.0.1` 只在服务端本机有效，手机上不能使用。

更多方式参见[远程访问](../configuration/remote-access.md)。

## Android

- beta.14 尚未发布。beta.13 APK 使用旧产品名称和内部身份，不能当作 OutcomeGo beta.14 安装。发布后，应用会在安装前校验更新清单签名、APK 校验和与签名证书。
- 自己构建一个调试 APK：`bash scripts/android/package-debug.sh`，在 macOS 上也可以双击 `scripts/android/package-debug.command`。
- 生成的文件是 `apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`。
- 在小米设备上一键安装并运行：`bash scripts/android/run-xiaomi.sh`，详见 [Xiaomi 一键运行调试](../android/20261031-Xiaomi一键运行调试.md)。
- 推送使用 FCM。国内手机通常收不到 FCM 推送，没有 Firebase 配置时，应用会在同步连接存活期间使用本地通知。详见 [apps/android/README.md](../../apps/android/README.md)。

## iPhone / iPad

- 使用 macOS、Xcode 和 Swift 6 打开 `apps/ios/OutcomeGoNative.xcodeproj`，选择 `OutcomeGoNative` 运行。
- Release 版显示为 **OutcomeGo**，使用 `outcomego://` 链接。构建步骤和签名配置见 [apps/ios/README.md](../../apps/ios/README.md)。
- iOS 18 及以上支持 Shortcuts、Siri 和 Spotlight。

## 相关文档

- [Android 说明](../../apps/android/README.md)
- [iOS 说明](../../apps/ios/README.md)
- [项目 README](../../README.md)
