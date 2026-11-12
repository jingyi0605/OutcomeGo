# OutcomeGo Mobile

[中文](README.md) | English

The OutcomeGo mobile app is a client for your own server. Sign in to the same server and your phone shows the same bots and conversations as the desktop app.

## Supported platforms

| Platform | Requirements | How to get it | Notes |
| --- | --- | --- | --- |
| Android | Android 8.0 (API 26) or later | beta.14 is available from GitHub Releases; source builds are also supported | [apps/android/README.md](../../apps/android/README.md) |
| iPhone / iPad | iOS 18 or later | No installable package yet. Build from source (beta) | [apps/ios/README.md](../../apps/ios/README.md) |

There is no iOS package for now, and no TestFlight or App Store download.

## What you can do

- Chat with bots, send files and photos, and use voice notes and realtime voice conversation.
- Answer questions and forms from bots.
- Watch a bot's cloud computer screen and take control when it needs you.
- Add, edit and run routines.
- Connect models and manage the server and its connected computers in Settings.
- Receive push notifications, and share content to a bot from the system share sheet.

## Connect to your server

1. On the server host, run `outcomego status` and note the **Server** address.
2. Open OutcomeGo on your phone, enter that address, and sign in with the username and password you created during setup.
3. The phone must be able to reach the address:
   - At home, use the LAN address, for example `http://192.168.1.20:8787`.
   - Away from home, use a VPN such as Tailscale, or give the server an HTTPS address.
   - `localhost` and `127.0.0.1` only work on the server itself, not on a phone.

See [remote access](../configuration/remote-access.md) for all the options.

## Android

- Beta.14 is published. The beta.13 APK uses the former product name and internal identities. The app verifies the update manifest signature, APK checksum and signing certificate before offering an update.
- To build a debug APK yourself, run `bash scripts/android/package-debug.sh`. On macOS you can also double-click `scripts/android/package-debug.command`.
- The output is `apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`.
- To install and launch on a Xiaomi device in one step, run `bash scripts/android/run-xiaomi.sh`. See [the Xiaomi debug guide](../android/20261031-Xiaomi一键运行调试.md) (Chinese).
- Push uses FCM. FCM pushes usually do not reach phones in mainland China. Without a Firebase configuration the app uses local notifications while its sync connection is alive. See [apps/android/README.md](../../apps/android/README.md).

## iPhone / iPad

- On macOS with Xcode and Swift 6, open `apps/ios/OutcomeGoNative.xcodeproj`, choose the `OutcomeGoNative` scheme and run.
- The release build appears as **OutcomeGo** and uses `outcomego://` links. See [apps/ios/README.md](../../apps/ios/README.md) for build steps and signing.
- Shortcuts, Siri and Spotlight are supported on iOS 18 and later.

## Related documents

- [Android guide](../../apps/android/README.md)
- [iOS guide](../../apps/ios/README.md)
- [Project README](../../README.en.md)
