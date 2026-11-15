#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
executable="$(bash "$script_dir/ensure-dws.sh" --check)"

# Keep both configuration and file-DEK state on writable, persistent Bot storage.
if [[ "$(uname -s)" == Linux && -d /workspace && -w /workspace ]]; then
  if [[ ! -w "$HOME" ]]; then
    export DWS_CONFIG_DIR="${DWS_CONFIG_DIR:-/workspace/.config/dws}"
    export DWS_KEYCHAIN_DIR="${DWS_KEYCHAIN_DIR:-/workspace/.local/share/outcomego/dws-keychain}"
  fi
fi

exec "$executable" "$@"
