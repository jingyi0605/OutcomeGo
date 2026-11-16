#!/usr/bin/env bash
set -euo pipefail
image=${1:?Usage: smoke-image.sh server|worker|migrate|computer <image-ref>}
ref=${2:?An image reference is required}
case "$image" in
  server|migrate) docker run --rm --network none --entrypoint bun "$ref" --version ;;
  worker) docker run --rm --network none --entrypoint node "$ref" --version ;;
  computer)
    docker run --rm --network none --entrypoint /bin/sh "$ref" -ec '
      id box
      /usr/lib/outcomego/bin/bun --version
      /usr/bin/node --version
      /usr/lib/outcomego/bin/uv --version
      python3 -c "import pptx, docx, openpyxl, pandas, PIL, lxml"
      NODE_PATH=/usr/lib/outcomego/node/lib/node_modules node -e "require(\"pptxgenjs\"); require(\"docx\")"
      test -x /usr/lib/outcomego/bin/outcomego-memory-init
      test -x /usr/lib/outcomego/bin/outcomego-desktop-exec
      test -x /usr/lib/outcomego/bin/tun2socks
      test -x /usr/bin/chromium
      test -f /usr/share/outcomego/apt-baseline
    '
    ;;
  *) echo "Unknown release image: $image" >&2; exit 2 ;;
esac
