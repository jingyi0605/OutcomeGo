# aiTeamOS app icons

`aiTeamOS.icon` is the shared, editable Icon Composer source for iOS and macOS.
It holds one layer, `Assets/logo.png`, the aiTeamOS prism mark (trimmed from
`apps/landing/public/ai-teamOS-concept-02-prism.png`), on a charcoal gradient
background. Colors are defined in `icon.json`. The robot artwork that upstream
aiTeamOS ships here was removed in this fork.

## Build integration

- iOS: `apps/ios/Resources/Assets.xcassets/AppIcon.appiconset` holds the current
  native app icon. Xcode packages it with the Swift app; it has no Expo fallback pipeline.
- macOS: electron-builder compiles the `.icon` into `Assets.car`, includes a legacy
  ICNS, and writes the native icon keys into Info.plist. Do not replace it with
  `app.dock.setIcon`, which bypasses the system's appearance selection.
- Windows: `icon.ico` includes 16, 24, 32, 48, 64, 128 and 256px representations.
- Linux: `aiteamos-desktop-light.png` is the packaged icon. Windows and Linux use
  static icons; light and dark PNG exports are available for both.

The native PNGs here are flattened previews with platform masking. Do not use them
as opaque iOS App Store asset-catalog inputs. Use the `.icon` source instead.
The standalone `icon.icns` contains the full set of 16–1024px representations and
the Mac's outer padding, and is used by the DMG.

## Regenerate

From the repository root on macOS with Xcode 26+ selected and dependencies installed:

```sh
bun scripts/branding/export-app-icons.ts
bun test ./apps/desktop/test/macos-release.test.ts
```

Rebuild/reinstall native apps to see updated system icons.

## Design references

- [Apple app icon guidelines](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [Creating icons with Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer)
- [Apple's new app icon appearances](https://developer.apple.com/videos/play/wwdc2025/220/)
- [ChatGPT on the App Store](https://apps.apple.com/us/app/chatgpt/id6448311069)
- [Messages on the App Store](https://apps.apple.com/us/app/messages/id1146560473)
