#!/usr/bin/env python3
"""Rename OpenTeam to outcomeGo across the working tree. Re-runnable after every upstream merge.

    python3 scripts/rename/rename.py --dry-run      # report only
    python3 scripts/rename/rename.py                # rewrite files, then git mv paths

Case mapping:
    OPENTEAM  -> OUTCOMEGO      (environment variables, constants)
    OpenTeam  -> outcomeGo      (the product name as a word)
    OpenTeam* -> OutcomeGo*     (inside identifiers: createOpenTeamClient -> createOutcomeGoClient)
    openTeam  -> outcomeGo      (camelCase identifiers)
    openteam  -> outcomego      (package scope, paths, binary, docker names)

Some names are stored in existing data or pinned by signatures. Renaming them would make saved
secrets undecryptable or break verification, so they are protected below and never rewritten.
"""
import argparse
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Whole files left alone: upstream attribution, upstream tracking, fixtures signed over upstream
# identities, upstream marketing content, vendored code, and debug tooling that points at machines
# that are migrated separately (see .github/RELEASING.md).
SKIP_PREFIXES = (
    "FORK.md", "LICENSE", "README.md", "README.en.md", "AGENTS.md",
    ".github/workflows/merge-upstream.yml", ".github/workflows/sync-upstream-main.yml",
    "scripts/rename/",
    "apps/landing/content/", "apps/landing/public/", "vendor/", "docs/images/",
    "apps/cli/test/fixtures/release-v0.1.0/", "apps/cli/test/fixtures/sigstore-tuf-cache/",
    "apps/cli/test/fixtures/local-release-artifact.txt", "apps/cli/test/runtime-compat.test.ts",
    "bun.lock",  # handled separately: only workspace names change
)
SKIP_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".car", ".jar", ".gz", ".tgz", ".zip",
    ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".mp3", ".mp4", ".mov", ".wav", ".bin", ".sqlite",
    "/upstream.json",
)
# The native iOS project cannot be compiled on every machine, so only the package scope and the
# environment-variable prefix are renamed there. Targets, schemes and Swift identifiers stay.
IOS_NATIVE = ("apps/ios/",)

# Tokens that must survive untouched.
PROTECTED = [
    "raghavpillai/openteam", "github.com/raghavpillai", "openteam.so", "openteam-docs.invalid",
    "openteam-voice-settings-v1",        # key derivation: changing it orphans saved provider keys
    "openteam-transcription-v1",         # key derivation: changing it orphans saved transcription keys
    "openteam-local-release-2026-10-03",  # pinned release signing key id
    "@openteam.invalid", "openteam.owner@", "openteam.invalid",  # owner e-mail stored by the auth tables
    'format: "openteam"', '"openteam" | "agent-plugin" | "cursor-plugin"',  # plugin package format
    "dev.openteam.mobile", "dev.openbot.mobile", "OutcomeGoNative",  # iOS bundle ids and targets
    "OpenTeam release signature v1",     # signed payload format: existing signatures and fixtures bind to it
    "x-openteam-signature-256",          # header configured by external webhook senders
    "openTeam-desktop-client.json",      # stored OAuth client file, referenced from saved records
    "release-v0.1.0/openteam-compose.yaml",  # signed fixture: bundle and artifact file names stay as signed
    'origin === "openteam"',             # plugin audit descriptors (upstream.json) store origin: "openteam"
    "openteam-dev", "openteam-debug", ".openteam-dev",  # directories, compose projects and share on the user's own hosts
]

PATH_SKIP = (
    "apps/ios/", "apps/landing/content/", "apps/landing/public/", "docs/images/", "vendor/",
    "apps/cli/test/fixtures/release-v0.1.0/", "apps/cli/test/fixtures/sigstore-tuf-cache/",
    "apps/cli/test/fixtures/local-release-artifact.txt", "packages/design-tokens/assets/WebProvider-",
)


def tracked_files():
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout.split(b"\0")
    return [p.decode() for p in out if p]


def skipped(rel):
    return rel.startswith(SKIP_PREFIXES) or rel.endswith(SKIP_SUFFIXES)


def transform(rel, text, counts):
    ios = rel.startswith(IOS_NATIVE)
    holders = {}

    def hold(match):
        key = f"\x00{len(holders)}\x00"
        holders[key] = match.group(0)
        return key

    protected = re.compile("|".join(re.escape(token) for token in sorted(PROTECTED, key=len, reverse=True)))
    text = protected.sub(hold, text)
    before = text
    text = text.replace("@openteam/", "@outcomego/")
    text = re.sub(r"OPENTEAM", "OUTCOMEGO", text)
    if ios:
        # Server-generated links must open the app, so the URL scheme follows the rest of the product.
        text = text.replace("openteam://", "outcomego://")
    if not ios:
        text = re.sub(
            r"(?<![A-Za-z0-9])OpenTeam(?![A-Za-z0-9])", "outcomeGo", text
        )
        text = text.replace("OpenTeam", "OutcomeGo")
        text = text.replace("openTeam", "outcomeGo")
        text = text.replace("openteam", "outcomego")
    if text != before:
        counts[rel] += 1
    for key, value in holders.items():
        text = text.replace(key, value)
    return text


def rewrite_lockfile(dry):
    path = ROOT / "bun.lock"
    text = path.read_text(encoding="utf8")
    new = text.replace("@openteam/", "@outcomego/").replace('"name": "openteam"', '"name": "outcomego"')
    if not dry and new != text:
        path.write_text(new, encoding="utf8")
    return text != new


def path_renames(files):
    moves = []
    for rel in files:
        if rel.startswith(PATH_SKIP):
            continue
        new = rel
        new = re.sub(r"OpenTeam", "OutcomeGo", new)
        new = re.sub(r"openTeam", "outcomeGo", new)
        new = re.sub(r"openteam", "outcomego", new)
        if new != rel:
            moves.append((rel, new))
    return moves


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    counts = Counter()
    files = tracked_files()
    for rel in files:
        if skipped(rel):
            continue
        path = ROOT / rel
        if not path.is_file() or path.is_symlink():
            continue
        try:
            text = path.read_text(encoding="utf8")
        except (UnicodeDecodeError, OSError):
            continue
        new = transform(rel, text, counts)
        if new != text and not args.dry_run:
            path.write_text(new, encoding="utf8")
    lock_changed = rewrite_lockfile(args.dry_run)
    moves = path_renames(files)
    if not args.dry_run:
        for old, new in moves:
            target = ROOT / new
            target.parent.mkdir(parents=True, exist_ok=True)
            tracked = subprocess.run(["git", "ls-files", "--error-unmatch", old], cwd=ROOT, capture_output=True).returncode == 0
            if tracked:
                subprocess.run(["git", "mv", old, new], cwd=ROOT, check=True)
            else:
                (ROOT / old).rename(target)
    print(f"files rewritten: {len(counts)}  bun.lock changed: {lock_changed}  paths renamed: {len(moves)}")
    if args.dry_run:
        top = Counter(rel.split("/")[0] + "/" + (rel.split("/")[1] if "/" in rel else "") for rel in counts)
        for name, n in top.most_common(25):
            print(f"  {n:4d}  {name}")
        for old, new in moves[:8]:
            print(f"  mv {old} -> {new}")
    return 0


sys.exit(main())
