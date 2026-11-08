#!/usr/bin/env bash
# Build the signed Android release APK and print its reproducible artifact details.
#
# Signing material comes only from the environment and is never written to the repository:
#   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
# Optional:
#   AITEAMOS_APP_LINK_HOST   verified App Links host (otherwise the manifest placeholder is used)
#   ANDROID_VERSION_CODE     overrides the versionCode derived from the root package.json
#
# The script does not reset, clean, delete or commit files, and starts no servers.
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
APK_PATH="$ROOT_DIR/apps/android/app/build/outputs/apk/release/androidApp-release.apk"

for name in ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  [[ -n "${!name:-}" ]] || { echo "Missing signing variable: $name" >&2; exit 1; }
done
[[ -f "$ANDROID_KEYSTORE_PATH" ]] || { echo "Keystore not found: $ANDROID_KEYSTORE_PATH" >&2; exit 1; }

java_major() {
  "$1/bin/java" -version 2>&1 | awk -F'"' '/version/ {print $2}' \
    | sed -E 's/^1\.//' | cut -d. -f1
}

pick_java_home() {
  local candidates=() candidate major
  [[ -n "${JAVA_HOME:-}" ]] && candidates+=("$JAVA_HOME")
  candidates+=(
    "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
    "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
    "/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
    "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  )
  for candidate in "${candidates[@]}"; do
    [[ -x "$candidate/bin/java" ]] || continue
    major=$(java_major "$candidate" 2>/dev/null || true)
    [[ "$major" =~ ^[0-9]+$ ]] || continue
    if (( major >= 17 && major <= 24 )); then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

JAVA_HOME_SELECTED=$(pick_java_home) || {
  echo "No compatible JDK 17-24 found. Set JAVA_HOME or install a supported JDK." >&2
  exit 1
}
export JAVA_HOME="$JAVA_HOME_SELECTED"
export PATH="$JAVA_HOME/bin:$PATH"

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && ! -f "$ROOT_DIR/local.properties" ]]; then
  [[ -d "$HOME/Library/Android/sdk" ]] || {
    echo "Android SDK not found. Set ANDROID_HOME or create local.properties with sdk.dir." >&2
    exit 1
  }
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi

gradle_args=(--no-daemon :mobile:androidApp:assembleRelease)
[[ -n "${AITEAMOS_APP_LINK_HOST:-}" ]] && gradle_args+=("-PaiteamosAppLinkHost=$AITEAMOS_APP_LINK_HOST")
[[ -n "${ANDROID_VERSION_CODE:-}" ]] && gradle_args+=("-PaiteamosVersionCode=$ANDROID_VERSION_CODE")

echo "Repository: $ROOT_DIR"
echo "Gradle JDK: $JAVA_HOME"
echo "Building :mobile:androidApp:assembleRelease"
rm -f "$APK_PATH"
(cd "$ROOT_DIR" && ./gradlew "${gradle_args[@]}")

[[ -f "$APK_PATH" ]] || {
  echo "Gradle completed but the signed APK was not found: $APK_PATH" >&2
  echo "An unsigned build produces androidApp-release-unsigned.apk, which must not be published." >&2
  exit 1
}

apksigner_bin=$(command -v apksigner || true)
if [[ -z "$apksigner_bin" ]]; then
  sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  # Gradle also accepts the SDK location from local.properties, which is not exported.
  if [[ -z "$sdk_root" && -f "$ROOT_DIR/local.properties" ]]; then
    sdk_root=$(sed -n 's/^sdk\.dir=//p' "$ROOT_DIR/local.properties" | head -n 1)
  fi
  apksigner_bin=$(ls -1 "$sdk_root"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -n 1 || true)
fi
[[ -n "$apksigner_bin" ]] || { echo "apksigner not found in the Android SDK build-tools." >&2; exit 1; }
"$apksigner_bin" verify --verbose --print-certs "$APK_PATH"

echo
echo "APK_PATH=$APK_PATH"
echo "APK_SHA256=$(sha256 "$APK_PATH")"
ls -lh "$APK_PATH"
