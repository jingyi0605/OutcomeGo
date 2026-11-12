# Releasing OutcomeGo

Releases are built by `.github/workflows/release.yml`. Pushing a tag builds every artifact and
publishes one GitHub Release. The workflow file must keep its name: the CLI only trusts
signatures whose certificate identity is `.github/workflows/release.yml@refs/tags/v<version>`.

## Versions

This fork has its own version line, starting at `0.1.0-beta.1`. The root `package.json` is the
single source of truth.

```sh
bun scripts/release/version.ts set 0.1.0-beta.2   # root, all workspaces, bun.lock, iOS release.json
python3 apps/ios/scripts/generate-project.py      # regenerate the Xcode project
bun scripts/release/version.ts check              # CI runs this on every push
```

- Android reads the version from the root `package.json`. `versionCode` is derived from it
  (`0.1.0-beta.1` is `10001`, `0.1.0` is `10099`) and can be overridden with
  `-PoutcomegoVersionCode`.
- iOS marketing versions cannot carry a prerelease suffix, so `0.1.0-beta.1` ships as `0.1.0`.
  The build number is the workflow run number.
- The tag must be `v<version>` exactly. A mismatch fails the first job.

## Cutting a release

1. Set the version, commit, and merge to the configured fork source branch `OutcomeGo`.
2. `git tag v0.1.0-beta.1 && git push origin v0.1.0-beta.1`.
3. Watch the run. Running the workflow manually from a branch is a dry run: it builds
   everything, pushes and signs nothing, and publishes nothing.

The release is deliberately not marked as a pre-release. The server installer, the CLI updater
and the desktop updater all read `/releases/latest`, which GitHub only answers for
non-pre-release releases.

## What each job produces

| Job | Output |
|---|---|
| `images` / `merge-images` | `ghcr.io/<owner>/ai-teamos-{server,worker,migrate,computer}:<version>` for linux/amd64 and linux/arm64 |
| `verify-images` | Anonymous `docker pull` of every image by digest |
| `cli-build` / `sign` | Five CLI binaries (raw and `.gz`), digest-pinned `outcomego-compose.yaml`, `install.sh`, `install.ps1`, and a `.sigstore.json` for the Compose file and each raw binary |
| `desktop` | Linux AppImage and Windows installer, with `latest*.yml` |
| `macos` | Signed and notarized DMG and ZIP (needs `RELEASE_MACOS=true`) |
| `android` | Signed `OutcomeGo-<version>-android.apk` (needs `RELEASE_ANDROID=true`) |
| `ios` | TestFlight upload, no file on the release (needs `RELEASE_IOS=true`) |
| `publish` | GitHub Release with `SHA256SUMS` and `DESKTOP_SHA256SUMS` |

## First-release checklist

1. **GHCR visibility.** New packages are private. After the first push, set each of the four
   `ai-teamos-*` packages to public (Package settings, Danger Zone). `verify-images` fails with
   the link until you do; re-run the failed jobs afterwards.
2. **Signing.** The CLI signs keylessly with the workflow's GitHub OIDC identity and verifies
   against `DEFAULT_REPOSITORY` in `apps/cli/src/constants.ts`. No private key exists. The
   historical local P-256 key is still accepted by the verifier for old releases.
3. **Optional platforms.** Set repository variables and secrets, then add the variable:

| Platform | Variable | Secrets |
|---|---|---|
| Android | `RELEASE_ANDROID=true`, `ANDROID_APP_LINK_HOST` | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_UPDATE_SIGNING_PRIVATE_KEY_BASE64` |
| Windows | Desktop release is built on `windows-latest`, with Authenticode verification | `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`, `WINDOWS_SIGNING_SUBJECT` repository variable |
| macOS | `RELEASE_MACOS=true`, `MACOS_SIGNING_IDENTITY` (the certificate name without the `Developer ID Application:` prefix, for example `Your Name (TEAMID)`) | `MACOS_CERTIFICATE_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| iOS | `RELEASE_IOS=true`, optional `IOS_RUNNER`, `IOS_XCODE` | `IOS_DISTRIBUTION_P12_BASE64`, `IOS_DISTRIBUTION_P12_PASSWORD`, `IOS_APP_PROFILE_BASE64`, `IOS_EXTENSION_PROFILE_BASE64`, `IOS_SHARE_PROFILE_BASE64`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_PRIVATE_KEY` |

Keep these in an Environment with required reviewers if you want a manual approval before
signing. Never put signing material in the repository or in logs.

## Android

`bash scripts/android/package-release.sh` builds and verifies the signed APK locally when the
four `ANDROID_KEYSTORE_*`/`ANDROID_KEY_*` variables are set. Without them the release build is
unsigned and the script refuses to report it. Create the keystore once and keep it:

```sh
keytool -genkeypair -v -keystore teamos-release.jks -alias teamos -keyalg RSA -keysize 4096 -validity 10000
base64 < teamos-release.jks | pbcopy   # paste as ANDROID_KEYSTORE_BASE64
```

Losing the keystore means existing installs can no longer be updated. The manifest still
enables cleartext traffic for development, which `scripts/android/release-gate.sh` reports as
pending. Decide before a public release.

Android GitHub sideload releases also publish `android-update.json`. The app verifies the
manifest signature, APK checksum, APK signing certificate digest, package ID, version code and
HTTPS download URL before it opens the system `PackageInstaller`. Keep the private manifest
signing key only in `ANDROID_UPDATE_SIGNING_PRIVATE_KEY_BASE64`; its matching public key is
compiled into the app. A key rotation requires an app update that trusts the new public key
before releases signed by it can be installed.

## iOS

`apps/ios/release.json` still carries the upstream bundle identifier and team. The `ios` job
refuses to run until `bundleIdentifier` and `teamIdentifier` are this fork's, so a build cannot
be uploaded under upstream's app. Before enabling it:

1. Register the bundle identifier and its `.notifications` and `.share` variants, and the App
   Store Connect app record.
2. Create an Apple Distribution certificate and three App Store provisioning profiles.
3. Update `release.json`, run `python3 apps/ios/scripts/generate-project.py`, set
   `OUTCOMEGO_APNS_TOPIC` in `deploy/compose.yaml` to the new bundle identifier, and create the
   APNs key.

The workflow stamps `buildNumber` with the run number, so it never collides with an earlier upload.

## Desktop notes

The desktop app is `OutcomeGo` (bundle and app id `dev.outcomego.desktop`, executable `outcomego`, files named
`aiTeamOS-<version>-<os>-<arch>.<ext>`). Keep this filename prefix until a v0.1.0-beta.13 updater fixture proves it resolves a renamed prefix. Icons come from `packages/design-tokens/assets/outcomego.icon`.
The local server data folder is `.outcomego`; Desktop user data is pinned to its own `outcomego` directory.

Windows installers are unsigned until a code-signing certificate is added, so SmartScreen will
warn. Published Windows releases now require `WINDOWS_CERTIFICATE_BASE64`,
`WINDOWS_CERTIFICATE_PASSWORD`, and the expected `WINDOWS_SIGNING_SUBJECT`; the workflow
verifies the generated installer with `Get-AuthenticodeSignature` before uploading it.
Linux builds are not signed. Siri and APNs
behaviour needs a physical device and stays a manual check.
