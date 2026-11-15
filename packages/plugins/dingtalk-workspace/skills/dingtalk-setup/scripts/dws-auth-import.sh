#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
workspace_root="${OUTCOMEGO_WORKSPACE_ROOT:-/workspace}"
force=0
input=""
for argument in "$@"; do
  case "$argument" in
    --force) force=1 ;;
    --) shift; input="${1:-}"; break ;;
    -*) echo "Usage: bash dws-auth-import.sh [--force] <workspace-bundle-path>" >&2; exit 2 ;;
    *)
      if [[ -n "$input" ]]; then
        echo "Usage: bash dws-auth-import.sh [--force] <workspace-bundle-path>" >&2
        exit 2
      fi
      input="$argument"
      ;;
  esac
done
if [[ -z "$input" || "$input" != /* ]]; then
  echo "Usage: bash dws-auth-import.sh [--force] <workspace-bundle-path>" >&2
  exit 2
fi

workspace_root="$(cd -P -- "$workspace_root" && pwd)"
if [[ ! -f "$input" || -L "$input" ]]; then
  echo "The auth bundle must be a regular file." >&2
  exit 2
fi
input_dir="$(cd -P -- "$(dirname -- "$input")" && pwd)"
input="$input_dir/$(basename -- "$input")"
case "$input" in
  "$workspace_root"/*) ;;
  *) echo "The auth bundle must be inside the Computer workspace." >&2; exit 2 ;;
esac

import_args=(auth import --input "$input")
if (( force )); then import_args+=(--force); fi
bash "$script_dir/dws.sh" "${import_args[@]}"

status_output=""
if ! status_output="$(bash "$script_dir/dws-status.sh")"; then
  printf '%s\n' "$status_output"
  echo "DWS status could not verify the imported login; the bundle was retained for recovery." >&2
  exit 1
fi
printf '%s\n' "$status_output"
if [[ ! "$status_output" =~ \"authenticated\"[[:space:]]*:[[:space:]]*true ]]; then
  echo "DWS did not report authenticated=true; the bundle was retained for recovery." >&2
  exit 1
fi

rm -r -- "$input"
echo "DWS login imported and verified on this Computer; the one-time bundle was removed." >&2
