#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
executable="$(bash "$script_dir/ensure-dws.sh" --check)"
# DWS verifies official release checksums and atomically replaces its binary.
# Plugin workflows are maintained here, so do not install upstream skills.
bash "$script_dir/dws.sh" upgrade --skip-skills --yes
actual_version="$(DWS_NO_UPDATE_CHECK=1 "$executable" --version)"
if [[ ! "$actual_version" =~ ^dws\ version\ (v[0-9]+\.[0-9]+\.[0-9]+)\ \( ]]; then
  echo "Could not verify the upgraded DWS version." >&2
  exit 1
fi
marker="$(dirname "$executable")/.outcomego-dws-version"
temporary="$(mktemp "${marker}.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT
printf '%s\n' "${BASH_REMATCH[1]}" > "$temporary"
chmod 600 "$temporary"
mv -f -- "$temporary" "$marker"
printf '%s\n' "$actual_version"
