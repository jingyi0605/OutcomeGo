#!/usr/bin/env python3
"""Run the credential-free line 5B checks without starting services."""

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile


EVIDENCE = Path(__file__).resolve().parent
ROOT = EVIDENCE.parents[3]
RESULTS = []


def run(name, command, expected=0):
    if command[0] == "bun" and "--no-install" not in command:
        command = [command[0], "--no-install", *command[1:]]
    environment = {
        "PATH": os.environ["PATH"],
        "LANG": "en_US.UTF-8",
        "TMPDIR": str(SCRATCH),
        "BUN_CONFIG_NO_CLEAR_TERMINAL": "1",
    }
    result = subprocess.run(
        command, cwd=ROOT, env=environment, capture_output=True, text=True, timeout=60
    )
    content = result.stdout + result.stderr
    log = EVIDENCE / f"{name}.log"
    log.write_text(
        "\n".join(
            line.rstrip()
            for line in f"$ {shlex.join(command)}\nexit={result.returncode}\n{content}".splitlines()
        ).rstrip() + "\n",
        encoding="utf-8",
    )
    entry = {
        "id": name,
        "command": shlex.join(command),
        "exit": result.returncode,
        "expectedExit": expected,
        "status": (
            "PASS" if result.returncode == expected else
            "PENDING" if re.search(r"Cannot find (?:module|package)", content) else "FAIL"
        ),
        "log": log.name,
    }
    RESULTS.append(entry)
    return result


with tempfile.TemporaryDirectory(prefix=".l5b-checks-", dir=EVIDENCE) as temporary:
    SCRATCH = Path(temporary)
    run("version", ["bun", "scripts/release/version.ts", "check"])
    run(
        "wrong-tag",
        ["bun", "scripts/release/version.ts", "check", "--tag", "v0.1.0-beta.13"],
        expected=1,
    )
    run("workflows", ["bun", "scripts/check/release-workflows.ts"])
    run("backup-tests", ["bun", "test", "scripts/migration/validate-outcomego-backup.test.ts"])
    run("desktop-tests", ["bun", "test", "apps/desktop/test/update-status.test.ts",
                          "apps/desktop/test/server-update-cache.test.ts"])
    run("cli-safety-tests", ["bun", "test", "apps/cli/test/update-safety.test.ts"])
    run("cli-signature-tests", [
        "bun", "test", "apps/cli/test/release.test.ts", "--test-name-pattern",
        "local release signature trust|fails closed",
    ])
    run(
        "android-parity",
        ["python3", "scripts/android/parity-report.py", "--check"],
    )
    run(
        "android-assetlinks",
        ["python3", "scripts/android/check-assetlinks.py", "docs/android/assetlinks.json.template",
         "--template", "--package", "com.outcomego.android", "--host", "outcomego.example.com"],
    )
    run("android-contract", ["python3", "scripts/android/live-parity.py", "--contract"])
    run("ios-native-config", ["python3", "apps/ios/scripts/check-native-config.py"])

    # Resolve only the exact local workspace exports; do not install dependencies
    # or borrow another checkout's node_modules.
    aliases = SCRATCH / "tsconfig.json"
    aliases.write_text(json.dumps({
        "compilerOptions": {
            "baseUrl": str(ROOT),
            "paths": {
                "@outcomego/contracts/version-compatibility":
                    ["packages/contracts/src/version-compatibility.ts"],
                "@outcomego/product-core/redaction": ["packages/product-core/src/redaction.ts"],
                "@outcomego/contracts/server-updates": ["packages/contracts/src/server-updates.ts"],
                "@outcomego/contracts/localization": ["packages/contracts/src/localization.ts"],
            },
        },
    }))
    run("desktop-local-exports", [
        "bun", "test", "--no-install", "--tsconfig-override", str(aliases),
        "apps/desktop/test/update-status.test.ts",
        "apps/desktop/test/server-update-cache.test.ts",
        "apps/desktop/test/server-update-i18n.test.ts",
        "apps/desktop/test/user-data-path.test.ts",
        "packages/contracts/test/server-updates.test.ts",
    ])
    cli_config_command = [
        "bun", "test", "--no-install", "--tsconfig-override", str(aliases),
        "apps/cli/test/config.test.ts",
    ]
    cli_config = run("cli-config-local-exports", cli_config_command)
    if cli_config.returncode and "timed out" in cli_config.stderr + cli_config.stdout:
        run("cli-config-isolated-retry", cli_config_command)
    run("cli-safety-local-exports", [
        "bun", "test", "--no-install", "--tsconfig-override", str(aliases),
        "apps/cli/test/update-safety.test.ts",
    ])
    cli_primitive = """
import { verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { LOCAL_RELEASE_PUBLIC_KEY, localReleaseSigningPayload } from "./apps/cli/src/release-signing-key";
import { DEFAULT_REPOSITORY } from "./apps/cli/src/constants";
const artifact = readFileSync("./apps/cli/test/fixtures/local-release-artifact.txt");
const bundle = JSON.parse(readFileSync("./apps/cli/test/fixtures/local-release-artifact.txt.sigstore.json", "utf8"));
const signature = Buffer.from(bundle.messageSignature.signature, "base64");
for (const [name, repository, version, bytes, expected] of [
  ["historical-valid", "raghavpillai/openteam", "0.0.0", artifact, true],
  ["wrong-repository", "attacker/repo", "0.0.0", artifact, false],
  ["wrong-tag", "raghavpillai/openteam", "0.0.1", artifact, false],
  ["wrong-hash", "raghavpillai/openteam", "0.0.0", Buffer.concat([artifact, Buffer.from("tampered")]), false],
  ["renamed-repository", DEFAULT_REPOSITORY, "0.0.0", artifact, false],
]) {
  const accepted = verify("sha256", localReleaseSigningPayload(repository, version, bytes), LOCAL_RELEASE_PUBLIC_KEY, signature);
  console.log(JSON.stringify({name, expected, accepted}));
  if (accepted !== expected) process.exit(1);
}
"""
    # This is the actual payload helper plus Node's primitive verification only;
    # no Sigstore bundle, certificate, or transparency-log trust claim is made.
    run("cli-signature-primitive", [
        "bun", "--no-install", "--tsconfig-override", str(aliases), "-e", cli_primitive,
    ])

    # Use the repository's signed public Android fixture and embedded public key.
    # Verify the canonical payload cryptographically, without opening any keystore.
    android_source = (ROOT / "apps/android/app/src/main/kotlin/com/outcomego/platform/AndroidUpdateManifest.kt").read_text()
    android_test = (ROOT / "apps/android/app/src/test/kotlin/com/outcomego/platform/AndroidUpdateManifestTest.kt").read_text()
    public_hex = re.search(r'PUBLIC_KEY_DER_HEX\s*=\s*"([a-f0-9]+)"', android_source)[1]
    fields = {}
    for field in ["version", "applicationId", "apkUrl", "sha256", "certificateSha256", "signatureBase64"]:
        fields[field] = re.search(rf'\b{field} = "([^"]+)"', android_test)[1]
    for field in ["versionCode", "sizeBytes"]:
        fields[field] = int(re.search(rf'\b{field} = (\d+)', android_test)[1])
    public_key = SCRATCH / "android-public.der"
    public_key.write_bytes(bytes.fromhex(public_hex))
    signature = SCRATCH / "android-signature.der"
    signature.write_bytes(base64.b64decode(fields["signatureBase64"]))
    field_order = ["version", "versionCode", "applicationId", "apkUrl", "sizeBytes", "sha256", "certificateSha256"]
    for case, changes, expected in [
        ("valid", {}, 0),
        ("wrong-tag", {"version": "0.1.0-beta.19"}, 1),
        ("wrong-repository", {"apkUrl": fields["apkUrl"].replace("/OutcomeGo/", "/wrong-repository/")}, 1),
        ("wrong-hash", {"sha256": "0" * 64}, 1),
        ("wrong-certificate", {"certificateSha256": "0" * 64}, 1),
        ("wrong-application", {"applicationId": "com.teambots.android"}, 1),
    ]:
        payload = {**fields, **changes}
        payload_file = SCRATCH / f"android-{case}.txt"
        payload_file.write_text("".join(f"{field}={payload[field]}\n" for field in field_order))
        run(f"android-signature-{case}", [
            "openssl", "dgst", "-sha256", "-verify", str(public_key), "-keyform", "DER",
            "-signature", str(signature), str(payload_file),
        ], expected=expected)

    # CLI validation is invoked against synthetic fixtures only. Hash the complete
    # input before/after each invocation to check that success and failure are read-only.
    canonical = lambda value: json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    tables = {
        "outcomego_bot": [{"id": "bot-1", "name": "Synthetic OutcomeGo"}],
        "outcomego_channel": [{"id": "channel-1", "botId": "bot-1"}],
    }

    def backup(data):
        return {"manifest": {
            "format": "outcomego-backup/v1", "product": "OutcomeGo",
            "schema": "outcomego-v1", "schemaVersion": 1,
            "dataSha256": hashlib.sha256(canonical(data)).hexdigest(),
            "rowCounts": {key: len(rows) for key, rows in data.items()},
        }, "tables": data}

    valid = backup(tables)
    invalid = json.loads(json.dumps(valid))
    invalid["manifest"]["dataSha256"] = "0" * 64
    legacy = json.loads(json.dumps(valid))
    legacy["manifest"]["format"] = "legacy-backup/v1"
    counts = json.loads(json.dumps(valid))
    counts["manifest"]["rowCounts"]["outcomego_bot"] = 2
    broken = backup({"outcomego_bot": [],
                     "outcomego_channel": [{"id": "channel-1", "botId": "missing"}]})
    missing_target = backup({"outcomego_channel": [{"id": "channel-1", "botId": "missing"}]})
    unknown_table = backup({"outcomego_nonexistent_table": [{"id": "synthetic"}]})
    outcome_orphan = backup({
        "outcomego_outcome": [],
        "outcomego_outcome_work_item": [{"id": "work-1", "outcomeId": "missing"}],
    })
    observations = []
    for name, value, expected in [
        ("valid", valid, 0), ("wrong-hash", invalid, 1), ("wrong-hash-retry", invalid, 1),
        ("legacy", legacy, 1), ("wrong-row-count", counts, 1), ("broken-reference", broken, 1),
        ("missing-reference-table", missing_target, 1), ("unknown-table", unknown_table, 1),
        ("outcome-orphan", outcome_orphan, 1),
    ]:
        source = SCRATCH / ("backup-wrong-hash.json" if name == "wrong-hash-retry" else f"backup-{name}.json")
        if not source.exists():
            source.write_bytes(canonical(value))
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        result = run(f"backup-{name}", [
            "bun", "scripts/migration/validate-outcomego-backup.ts", "--input", str(source),
        ], expected=expected)
        after = hashlib.sha256(source.read_bytes()).hexdigest()
        observation = {
            "case": name, "beforeSha256": before, "afterSha256": after,
            "sourceUnchanged": before == after, "exit": result.returncode,
            "expectedExit": expected,
        }
        observations.append(observation)
        if result.returncode != expected:
            RESULTS[-1]["status"] = "FAIL"
        if before != after:
            raise RuntimeError(f"Synthetic input changed: {name}")
    (EVIDENCE / "backup-hashes.json").write_text(
        json.dumps(observations, ensure_ascii=False, indent=2) + "\n"
    )
    fixtures = EVIDENCE / "synthetic-backups.json"
    fixtures.write_text(json.dumps({
        "valid": valid, "wrongHash": invalid, "legacy": legacy, "wrongRowCount": counts,
        "brokenReference": broken, "missingReferenceTable": missing_target,
        "unknownTable": unknown_table, "outcomeOrphan": outcome_orphan,
    }, ensure_ascii=False, indent=2) + "\n")

    # Static schema evidence; never import or execute deploy-schema.ts because it
    # loads dotenv and connects to a database at module initialization.
    schema = ROOT / "packages/db/prisma/schema.prisma"
    raw_schema = ROOT / "packages/db/prisma/sql/raw-schema.sql"
    fingerprint = hashlib.sha256(schema.read_bytes() + b"\0" + raw_schema.read_bytes()).hexdigest()
    environment_facts = {
        "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "rootVersion": json.loads((ROOT / "package.json").read_text())["version"],
        "schemaFingerprint": fingerprint,
        "system": os.uname().sysname,
        "machine": os.uname().machine,
        "tools": {name: shutil.which(name) for name in ["bun", "docker", "adb", "cosign", "openssl", "python3"]},
        "nodeModulesPresent": (ROOT / "node_modules").exists(),
        "dotenvPresent": (ROOT / ".env").exists(),
        "externalServicesContacted": False,
        "serversStarted": False,
    }
    (EVIDENCE / "environment.json").write_text(
        json.dumps(environment_facts, ensure_ascii=False, indent=2) + "\n"
    )
    source_paths = [
        "scripts/migration/validate-outcomego-backup.ts",
        "packages/db/scripts/deploy-schema.ts",
        "packages/db/test/fresh-schema.integration.test.ts",
        "apps/android/app/src/main/kotlin/com/outcomego/platform/AndroidUpdateManifest.kt",
        "apps/android/app/src/test/kotlin/com/outcomego/platform/AndroidUpdateManifestTest.kt",
        "apps/cli/src/release-signing-key.ts",
        "apps/cli/test/fixtures/local-release-artifact.txt",
        "apps/cli/test/fixtures/local-release-artifact.txt.sigstore.json",
        "specs/004-OutcomeGo整体项目/docs/test-failure-baseline.md",
        ".github/workflows/ci.yml",
    ]
    (EVIDENCE / "source-hashes.json").write_text(json.dumps({
        name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        for name in source_paths
    }, ensure_ascii=False, indent=2) + "\n")

(EVIDENCE / "results.json").write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2) + "\n")
for entry in RESULTS:
    print(json.dumps(entry, ensure_ascii=False))
print(f"Recorded {len(RESULTS)} checks in {EVIDENCE}")
