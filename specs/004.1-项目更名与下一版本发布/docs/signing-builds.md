# OutcomeGo beta.14 本地签名构建记录

- 日期：2026 年 11 月 12 日
- 根版本：`0.1.0-beta.14`
- 构建性质：本地签名验证；未创建 Tag、GitHub Release 或远程发布。
- 密钥约束：没有读取或修改 GitHub Actions secrets/variables；私钥值、密码不写入此文档。
- 构建密钥备份位置：`/Users/jackson/SynologyDrive/我的应用/配置文件备份/OutcomeGo/`；该目录含私钥及密码，权限为仅当前用户读写。

## Android

- 命令：`bash scripts/android/package-release.sh`，由 JDK 21 运行；配置从 OutcomeGo 备份目录的 `android/release/signing.env` 读取。
- APK：`/Users/jackson/Code/openteam/apps/android/app/build/outputs/apk/release/androidApp-release.apk`
- 备份 APK：`/Users/jackson/SynologyDrive/我的应用/配置文件备份/OutcomeGo/builds/android/OutcomeGo-0.1.0-beta.14-android.apk`
- `apksigner verify --verbose --print-certs`：通过，APK v2 签名有效；证书 SHA-1 `8ee60aa6a21bd8e7cd4f7d55b51a12cee11bf89e`，证书 SHA-256 `6973a9c2170428745f295fb7304cbfe03878e93fd9f58907f0540d96086ed629`。
- `aapt2 dump badging`：`applicationId=com.outcomego.android`、`versionName=0.1.0-beta.14`、`versionCode=10014`。
- APK SHA-256：`ce9870dc18b67e6788456a57441ca97681db133f72901c66f9894c9e82a4dcf7`。
- 使用的专用 release keystore 与此前 `com.teambots.android` beta.1 本地 APK signer 一致，但它不能改变 Android 的 package identity。当前 APK `com.outcomego.android` 与旧包 `com.teambots.android` 是不同应用，不能覆盖安装；这是新身份行为，不是升级兼容证据。
- Android 更新清单私钥：旧私钥未找到，且 `com.outcomego.android` 是新 package ID，没有任何已安装副本信任旧公钥，因此轮换不破坏用户。已生成新的 ECDSA P-256 私钥，备份于 `android/update-manifest/outcomego-update-manifest-p256.pem`（权限 0600，同目录有 public pem/der/hex）；其公钥 DER 与 `AndroidUpdateManifest.kt` 的 `PUBLIC_KEY_DER_HEX` 逐字节一致。
- manifest 验证：用 `scripts/android/create-update-manifest.py` 对备份 APK（SHA-256 `ce9870dc18b67e6788456a57441ca97681db133f72901c66f9894c9e82a4dcf7`，24943411 字节，certificate SHA-256 `6973a9c2…d629`）签署，按 canonical payload 以公钥 `openssl dgst -sha256 -verify` 验证：Verified OK。
- GitHub secret `ANDROID_UPDATE_SIGNING_PRIVATE_KEY_BASE64` 已于 2026-11-12 通过 `gh secret set` 设置；私钥值不写入此文档。设备上的在线更新流程尚未验证。
- 这是使用新 Android package ID 的新应用身份；`com.outcomego.android` 与旧 `com.teambots.android` 不同，不能覆盖安装。用户已明确不要求既有安装平滑升级，因此本地 APK 按当前新身份构建；此处不代表 Android manifest updater 已就绪。

## macOS

- 命令：`apps/desktop/node_modules/.bin/electron-builder --mac --arm64 --publish never`，通过本次命令设置 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`，签名与公证设置与仓库发布脚本一致，输出到 `apps/desktop/release-signed-local/`。
- DMG：`/Users/jackson/Code/openteam/apps/desktop/release-signed-local/OutcomeGo-0.1.0-beta.14-mac-arm64.dmg`
- ZIP：`/Users/jackson/Code/openteam/apps/desktop/release-signed-local/OutcomeGo-0.1.0-beta.14-mac-arm64.zip`
- 备份目录：`/Users/jackson/SynologyDrive/我的应用/配置文件备份/OutcomeGo/builds/macos/`，包括 DMG、ZIP 和 blockmap。
- identity：`Developer ID Application: Liyan Guan`，SHA-1 `460BBE8FB6F24E5684C2FD138810553EC96C217D`；本机有效 identity、导出的加密 P12 和包内签名证书指纹一致。
- `codesign --verify --deep --strict`：通过；app identifier `dev.outcomego.desktop`，Developer ID 链和 hardened runtime 均可见。
- `spctl --assess --type execute`：`accepted`，source `Notarized Developer ID`。
- Apple notarization：app ZIP 请求 `7002d7d1-780c-423a-87d4-25995fd012f8`，状态 `Accepted`；DMG 请求 `d4c4e1e4-d9b1-4d2e-99bf-38052f24276b`，状态 `Accepted`。
- `xcrun stapler validate`：app 与 DMG 均通过；`hdiutil verify`：DMG checksum 有效。收尾时又对同一 DMG 重查 stapling，Apple CloudKit 查询超时（错误 68）；前序 stapling 和独立验证均成功，文件 SHA-256 未改变。
- DMG SHA-256：`60de1cebc151cce20c82fe60549bf94dd68fd56b51bb6716ff248a26e890f560`。
- ZIP SHA-256：`561615cb9828ef3e28f9c10f8c1f222fff8f1e675dbf3b2e15e684f9ad2fa9f3`。
- 凭据备份：加密 Developer ID P12 和密码文件、matching public certificate、图标源和已发现的 App Store Connect `.p8` key 已复制至 `macos/release/`。此 `.p8` 仅凭本地元数据识别为既有 App Store Connect key，未通过 Apple API 核实其用途/权限；不得据此声称已备份 iOS distribution P12/profile 或 iOS 发布配置。

## Windows 与 iOS

- Windows：未找到本地 Authenticode PFX；搜到的 `sdepcissl.pfx` 是域名 TLS 证书，不可用于 Windows 发布签名。未使用它签名，`WINDOWS_CERTIFICATE_BASE64` / password / subject 未设置。
- beta.13 实际做法：下载 beta.13 `win-x64.exe` 检查 PE 头，Authenticode 证书表大小为 0，即 beta.13 Windows 安装包未签名；其 workflow 在缺少证书 secret 时输出 "publishing an unsigned installer" 并继续。
- 决定：beta.14 沿用 beta.13 方式。`.github/workflows/release.yml` 的 "Restore Windows Authenticode certificate" 步骤已恢复为缺证书时 `::warning::` 并继续（本地修改，未推送）；`bun run check:workflows` 通过。补齐 `WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD` 和变量 `WINDOWS_SIGNING_SUBJECT` 后，签名与 `verify-authenticode.ps1` 校验自动启用，无需再改 workflow。
- iOS：按用户延期要求不构建。尚无经核验的 distribution P12、app/extension/share provisioning profiles 备份。

## 后续阻塞

- 完成全平台候选构建前：推送 workflow 修改，由 CI 构建 server/worker/computer/CLI/Desktop 候选资产并核验。Windows 可信签名为后续改进项，不阻塞 beta.14。
- 新 package ID `com.outcomego.android` 不能覆盖旧 `com.teambots.android` 安装；按用户决策通过手动备份并导入新实例迁移数据，不承诺旧 package ID 原地升级。
- Android beta.14 APK、macOS DMG/ZIP 均为本地构建物，未发布；真实设备安装、升级、回滚和 iOS 仍在对应后续任务范围内。
