#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
workspace_root="${OUTCOMEGO_WORKSPACE_ROOT:-/workspace}"
if [[ $# -ne 1 ]]; then
  echo "Usage: bash dws-auth-export.sh <workspace-output-path>" >&2
  exit 2
fi

workspace_root="$(cd -P -- "$workspace_root" && pwd)"
output="$1"
if [[ "$output" != /* ]]; then
  echo "The output path must be absolute." >&2
  exit 2
fi
output_dir="$(cd -P -- "$(dirname -- "$output")" 2>/dev/null && pwd)" || {
  echo "The output directory does not exist." >&2
  exit 2
}
output="$output_dir/$(basename -- "$output")"
case "$output" in
  "$workspace_root"/*) ;;
  *) echo "The auth bundle must be written inside the Computer workspace." >&2; exit 2 ;;
esac
if [[ -e "$output" || -L "$output" ]]; then
  echo "Refusing to overwrite an existing auth bundle: $output" >&2
  exit 1
fi

umask 077
bash "$script_dir/dws.sh" auth export --output "$output"
chmod 600 "$output"
printf '%s\n' "$output"
echo "The exported bundle contains encrypted authentication material. Transfer it once, then remove it from every staging location." >&2
