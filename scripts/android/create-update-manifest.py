#!/usr/bin/env python3
"""Create and sign the GitHub sideload update manifest for Android."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import subprocess
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_payload(manifest: dict[str, object]) -> str:
    return "".join(
        [
            f"version={manifest['version']}\n",
            f"versionCode={manifest['versionCode']}\n",
            f"applicationId={manifest['applicationId']}\n",
            f"apkUrl={manifest['apkUrl']}\n",
            f"sizeBytes={manifest['sizeBytes']}\n",
            f"sha256={str(manifest['sha256']).lower()}\n",
            f"certificateSha256={str(manifest['certificateSha256']).lower()}\n",
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--version-code", required=True, type=int)
    parser.add_argument("--application-id", required=True)
    parser.add_argument("--apk-url", required=True)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--certificate-sha256", required=True)
    parser.add_argument("--private-key", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    if args.version_code <= 0:
        raise SystemExit("--version-code must be positive")
    if not args.apk.is_file():
        raise SystemExit(f"APK does not exist: {args.apk}")
    if not args.private_key.is_file():
        raise SystemExit(f"Signing key does not exist: {args.private_key}")
    if not args.apk_url.startswith("https://"):
        raise SystemExit("--apk-url must use HTTPS")

    manifest: dict[str, object] = {
        "version": args.version,
        "versionCode": args.version_code,
        "applicationId": args.application_id,
        "apkUrl": args.apk_url,
        "sizeBytes": args.apk.stat().st_size,
        "sha256": sha256_file(args.apk),
        "certificateSha256": args.certificate_sha256.lower(),
    }
    payload = canonical_payload(manifest).encode("utf-8")
    signature = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(args.private_key)],
        input=payload,
        check=True,
        capture_output=True,
    ).stdout
    manifest["signatureBase64"] = base64.b64encode(signature).decode("ascii")
    args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
