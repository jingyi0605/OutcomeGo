#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

usage() {
  cat <<'USAGE'
Usage: bash scripts/release/build-images.sh [options]
  --image server|worker|migrate|computer   Build one image (repeatable; default: all)
  --platform linux/amd64|linux/arm64      Must match the Docker daemon architecture
  --computer-base IMAGE@sha256:DIGEST     Use an explicit prebuilt Computer base
  --multiarch-oci                        Occasional full local gate; exports OCI archives
  --help                                 Show this help

Routine checks load only native images. Use the GitHub Image verification workflow
for another architecture. Local metadata is rehearsal evidence, not GHCR release digests.
USAGE
}
platform=""
base_ref=""
multiarch_oci=false
images=()
while (($#)); do
  case "$1" in
    --image)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      case "$2" in server|worker|migrate|computer) images+=("$2") ;; *) usage >&2; exit 2 ;; esac
      shift 2 ;;
    --platform)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      platform=$2
      shift 2 ;;
    --computer-base)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      base_ref=$2
      [[ "$base_ref" =~ ^[^[:space:]@]+@sha256:[a-f0-9]{64}$ ]] || { echo "Computer base must be digest-pinned." >&2; exit 2; }
      shift 2 ;;
    --multiarch-oci) multiarch_oci=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

# Docker may target a remote daemon; that daemon, rather than the shell host,
# determines which architecture can run builds without emulation.
daemon_arch=$(docker info --format '{{.Architecture}}')
case "$daemon_arch" in
  arm64|aarch64) native_platform=linux/arm64 ;;
  x86_64|amd64) native_platform=linux/amd64 ;;
  *) echo "Unsupported Docker daemon architecture: $daemon_arch" >&2; exit 1 ;;
esac
if "$multiarch_oci"; then
  [[ -z "$platform" ]] || { echo "Do not combine --platform with --multiarch-oci." >&2; exit 2; }
  platform=linux/amd64,linux/arm64
  mode=multiarch-oci
else
  platform=${platform:-$native_platform}
  if [[ "$platform" != "$native_platform" ]]; then
    echo "Routine checks require $native_platform. Use .github/workflows/verify-images.yml on a native GitHub runner for $platform." >&2
    exit 2
  fi
  mode=${platform#linux/}
fi
((${#images[@]})) || images=(server worker migrate computer)
output="$repo_root/output/outcomego-release-images/$mode"
mkdir -p "$output"

resolve_base() {
  [[ -z "$base_ref" ]] || return 0
  base_ref=computer-base
  # A new clone can reuse the published heavy base even with an empty BuildKit cache.
  # A miss/offline registry falls back to the internal stage without pushing anything.
  if ! "$multiarch_oci" && command -v bun >/dev/null && command -v jq >/dev/null; then
    local prefix hash digest
    prefix=$(bun -e 'import { DEFAULT_IMAGE_PREFIX } from "./apps/cli/src/constants.ts"; console.log(DEFAULT_IMAGE_PREFIX)')
    hash=$(bun scripts/release/image-inputs.ts computer-base)
    digest=$(docker buildx imagetools inspect "$prefix-computer-base:inputs-$hash-${platform#linux/}" --format '{{json .Manifest}}' 2>/dev/null | jq -r '.digest' || true)
    if [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
      base_ref="$prefix-computer-base@$digest"
    fi
  fi
  echo "Computer base: $base_ref"
}

for image in "${images[@]}"; do
  args=(buildx build --platform "$platform" --metadata-file "$output/$image.metadata.json"
    --provenance=false --sbom=false --progress plain)
  case "$image" in
    computer)
      resolve_base
      args+=(--file docker/computer.Dockerfile --build-arg "COMPUTER_BASE=$base_ref") ;;
    *) args+=(--file docker/app.Dockerfile --target "$image") ;;
  esac
  if "$multiarch_oci"; then
    args+=(--output "type=oci,dest=$output/$image.tar")
  else
    args+=(--tag "outcomego-release-$image:local" --load)
  fi
  # Remove only this run's metadata so a failed build cannot leave stale evidence.
  rm -f "$output/$image.metadata.json"
  docker "${args[@]}" .
  if ! "$multiarch_oci"; then
    bash scripts/release/smoke-image.sh "$image" "outcomego-release-$image:local"
  fi
done

echo "Built $platform images. Local build evidence: $output"
