#!/usr/bin/env python3
"""Verify the pinned v0.0.19 audit without changing Git or workspace files."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "scripts/integration/fixtures/v019-baseline.json"


def git(*args, cwd=ROOT):
    return subprocess.check_output(
        ["git", "--no-optional-locks", "-C", str(cwd), *args]
    )


def text(*args, cwd=ROOT):
    return git(*args, cwd=cwd).decode().strip()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def commits(revision):
    return [
        dict(zip(("sha", "subject"), row.split(" ", 1)))
        for row in text("log", "--reverse", "--format=%H %s", revision).splitlines()
    ]


def verify_history(fixture):
    base = fixture["baseCommit"]
    common = fixture["commonAncestor"]
    target = fixture["upstreamCommit"]
    tag = fixture["upstreamTag"]
    require(text("rev-parse", tag) == fixture["upstreamTagObject"], "Tag object changed")
    require(text("rev-parse", f"{tag}^{{commit}}") == target, "Tag target changed")
    require(text("merge-base", base, target) == common, "Common ancestor changed")
    excluded = commits(f'{fixture["previousTagCommit"]}..{common}')
    effective = commits(f"{common}..{target}")
    require(excluded == fixture["excludedCommits"], "Excluded commit inventory changed")
    require(effective == fixture["effectiveCommits"], "Effective commit inventory changed")
    require(len(excluded) == 18 and len(effective) == 26, "Expected 18 + 26 commits")
    paths = [
        dict(zip(("status", "path"), row.split("\t")))
        for row in text("diff", "--name-status", common, target).splitlines()
    ]
    require(paths == fixture["effectivePaths"] and len(paths) == 152, "Path inventory changed")
    require(
        {row["sha"] for row in excluded}.isdisjoint(row["sha"] for row in effective),
        "Excluded and effective commit ranges overlap",
    )
    contract_paths = [row for row in paths if row["path"].startswith("packages/contracts/")]
    require(contract_paths == fixture["contractChangedPaths"], "Contract path inventory changed")
    reviewed = {row["surface"] for row in fixture["contractCompatibility"]}
    require(
        all(row["path"] in reviewed for row in contract_paths),
        "An effective contract change has no compatibility decision",
    )
    print("PASS: common ancestor fd32377bf; 18 excluded / 26 effective commits; 152 paths")
    print(f"PASS: all {len(contract_paths)} changed contract paths have compatibility decisions")


def verify_identity(fixture):
    for file_path, expected in fixture["protectedSourceBlobs"].items():
        actual = text("hash-object", "--no-filters", "--", file_path)
        require(actual == expected, f"Protected baseline source changed: {file_path}")
    for package in fixture["packages"]:
        local = json.loads((ROOT / package["path"]).read_text())
        upstream = json.loads(git("show", f'{fixture["upstreamCommit"]}:{package["path"]}'))
        require(
            (local["name"], local["version"]) == (package["localName"], package["localVersion"]),
            f'Local package identity changed: {package["path"]}',
        )
        require(
            (upstream["name"], upstream["version"])
            == (package["upstreamName"], package["upstreamVersion"]),
            f'Upstream package identity changed: {package["path"]}',
        )
    require(
        not (ROOT / "apps/desktop/src/renderer/components/openteam").exists(),
        "Upstream Desktop component path restored",
    )
    require(
        not (ROOT / "apps/desktop/src/renderer/client/openteam-api.ts").exists(),
        "Upstream Desktop API path restored",
    )
    for mapping in fixture["desktopPathMappings"]:
        expected = mapping["upstream"].replace("/openteam/", "/outcomego/")
        expected = expected.replace("/openteam-api.ts", "/outcomego-api.ts")
        require(mapping["local"] == expected, f"Incorrect Desktop mapping: {mapping}")
    print(
        f'PASS: {len(fixture["packages"])} package identities; '
        f'{len(fixture["protectedSourceBlobs"])} source blobs; '
        f'{len(fixture["desktopPathMappings"])} Desktop mappings'
    )


def verify_phase1_scope(fixture):
    base = fixture["baseCommit"]
    require(text("merge-base", base, "HEAD") == base, "Phase branch lost its local base")
    changed = set(filter(None, git("diff", "--name-only", "-z", base).decode().split("\0")))
    changed.update(
        filter(None, git("ls-files", "--others", "--exclude-standard", "-z").decode().split("\0"))
    )
    unexpected = changed - set(fixture["phase1AllowedPaths"])
    require(not unexpected, f"Files outside Phase 1 scope: {sorted(unexpected)}")
    imported = text("rev-list", f'{fixture["commonAncestor"]}..{fixture["upstreamCommit"]}', "^HEAD")
    require(len(imported.splitlines()) == 26, "An effective upstream commit entered Phase 1 history")
    print(f"PASS: Phase 1 changes limited to {len(changed)} documentation/fixture/script paths")


def verify_main(fixture, workspace):
    snapshot = fixture["protectedMainWorkspace"]
    require(workspace.resolve() != ROOT, "Use the protected main workspace, not this worktree")
    require(text("rev-parse", "HEAD", cwd=workspace) == snapshot["head"], "Main HEAD changed")
    require(
        text("branch", "--show-current", cwd=workspace) == snapshot["branch"],
        "Main branch changed",
    )
    require(
        git("status", "--porcelain=v1", "--untracked-files=all", cwd=workspace).decode()
        == snapshot["statusPorcelain"],
        "Main workspace status changed",
    )
    drift = []
    if (
        hashlib.sha256(git("diff", "--binary", "HEAD", cwd=workspace)).hexdigest()
        != snapshot["trackedDiffSha256"]
    ):
        drift.append("Main tracked diff changed")
    for entry in snapshot["files"]:
        data = (workspace / entry["path"]).read_bytes()
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            drift.append(f'Bytes changed: {entry["path"]}')
        if text("hash-object", "--no-filters", "--", entry["path"], cwd=workspace) != entry["gitBlob"]:
            drift.append(f'Blob changed: {entry["path"]}')
        require(
            (text("ls-files", "-s", "--", entry["path"], cwd=workspace) or None) == entry["indexEntry"],
            f'Index entry changed: {entry["path"]}',
        )
    require(not drift, "; ".join(drift))
    print("PASS: main HEAD, branch, status, index entries, tracked diff and all 8 Android hashes unchanged")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--main-worktree", type=Path, help="Also verify the original workspace read-only")
    args = parser.parse_args()
    fixture = json.loads(FIXTURE.read_text())
    verify_history(fixture)
    verify_identity(fixture)
    verify_phase1_scope(fixture)
    if args.main_worktree:
        verify_main(fixture, args.main_worktree)
    print("Baseline audit passed. No files or Git objects were written.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
