#!/usr/bin/env bash
set -euo pipefail

version="v1.0.68"
mode="${1:---check}"
if [[ $# -gt 1 || ( "$mode" != --check && "$mode" != --install ) ]]; then
  echo "Usage: bash ensure-dws.sh [--check|--install]" >&2
  exit 2
fi

writable_parent() {
  local candidate="$1"
  while [[ ! -d "$candidate" && "$candidate" != / ]]; do
    candidate="$(dirname "$candidate")"
  done
  [[ -w "$candidate" && -x "$candidate" ]]
}

install_dir="${OUTCOMEGO_DWS_CLI_DIR:-$HOME/.local/share/outcomego/dws/$version}"
if [[ -z "${OUTCOMEGO_DWS_CLI_DIR:-}" ]] && ! writable_parent "$install_dir"; then
  if [[ -d /workspace && -w /workspace ]]; then
    install_dir="/workspace/.local/share/outcomego/dws/$version"
  fi
fi
if [[ "$install_dir" != /* ]]; then
  echo "OUTCOMEGO_DWS_CLI_DIR must be an absolute path." >&2
  exit 2
fi

executable="$install_dir/dws"
if [[ -e "$executable" || -L "$executable" ]]; then
  if [[ ! -f "$executable" || ! -x "$executable" ]]; then
    echo "The managed DWS path is not an executable file: $executable" >&2
    exit 1
  fi
  actual_version="$(DWS_NO_UPDATE_CHECK=1 "$executable" --version)"
  accepted_version="$version"
  if [[ -f "$install_dir/.outcomego-dws-version" ]]; then
    recorded_version="$(cat "$install_dir/.outcomego-dws-version")"
    if [[ "$recorded_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      accepted_version="$recorded_version"
    fi
  fi
  if [[ "$actual_version" != "dws version $accepted_version ("* ]]; then
    echo "Unexpected DWS version at $executable; inspect it before replacing." >&2
    exit 1
  fi
  printf '%s\n' "$executable"
  exit 0
fi
if [[ "$mode" == --check ]]; then
  echo "Managed DWS CLI is missing; run setup with --install." >&2
  exit 1
fi

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) asset="dws-darwin-arm64.tar.gz"; checksum="f517d980bdaf18bfc8b1ae92707419d8ddcbb876b4565bbf7ef235d7db79a0fb" ;;
  Darwin/x86_64) asset="dws-darwin-amd64.tar.gz"; checksum="92e49a50147d2295c129962db709ed906b88294d5975b963203eb5f72fd78c75" ;;
  Linux/aarch64|Linux/arm64) asset="dws-linux-arm64.tar.gz"; checksum="bdcc2eb51d7c5d29f0dd88a527eab2d54bb3c09f042c721c0adfb5dd641f7556" ;;
  Linux/x86_64|Linux/amd64) asset="dws-linux-amd64.tar.gz"; checksum="45be0f60c75a95d1287727ea0bfb8b2257a193106d9b008808813ce2ff167645" ;;
  *) echo "Supported hosts: macOS/Linux on ARM64 or x64." >&2; exit 2 ;;
esac

for tool in curl tar install; do
  command -v "$tool" >/dev/null || { echo "Install $tool first." >&2; exit 1; }
done
if command -v sha256sum >/dev/null; then
  hash_command=(sha256sum)
elif command -v shasum >/dev/null; then
  hash_command=(shasum -a 256)
else
  echo "Install sha256sum or shasum first." >&2
  exit 1
fi

mkdir -p "$install_dir"
chmod 700 "$install_dir"
# Stage on the destination filesystem because the Bot computer mounts /tmp noexec.
temporary="$(mktemp -d "$install_dir/.install.XXXXXX")"
trap 'rm -r -- "$temporary"' EXIT
archive="$temporary/$asset"
url="https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/download/$version/$asset"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --connect-timeout 15 --max-time 180 --output "$archive" "$url"
actual_checksum="$("${hash_command[@]}" "$archive")"
if [[ "${actual_checksum%% *}" != "$checksum" ]]; then
  echo "DWS archive checksum mismatch; nothing installed." >&2
  exit 1
fi
tar -xzf "$archive" -C "$temporary" dws
install -m 755 "$temporary/dws" "$executable"
if ! actual_version="$(DWS_NO_UPDATE_CHECK=1 "$executable" --version)" || [[ "$actual_version" != "dws version $version ("* ]]; then
  echo "DWS release version check failed; inspect $executable before use." >&2
  exit 1
fi
printf '%s\n' "$executable"
