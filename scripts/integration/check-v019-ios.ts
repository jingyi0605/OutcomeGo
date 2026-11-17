import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { SendMessageInput } from "../../packages/contracts/src/index";
import { DeviceLocation, LocationSubmission } from "../../packages/contracts/src/user-location";

// Resolve Effect through its owning workspace, without adding a root dependency.
const root = resolve(import.meta.dir, "../..");
const { Schema } = createRequire(resolve(root, "packages/contracts/package.json"))("effect");
const baseline = "f2ed5fcfa5c35278c01bbe8723c4465cae6bdfb1";
const git = (...args: string[]) =>
  execFileSync("git", ["--no-optional-locks", ...args], { cwd: root, encoding: "utf8" });
const read = (path: string) => Bun.file(resolve(root, path)).text();
const fixture = await Bun.file(resolve(import.meta.dir, "fixtures/v019-ios-location.json")).json();
const decode = (schema: unknown, value: unknown) =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value);

decode(SendMessageInput, fixture);
decode(LocationSubmission, fixture.location);
const { location, ...legacy } = fixture;
decode(SendMessageInput, legacy);
const { accuracyMeters, ...coarse } = location.fix;
decode(DeviceLocation, coarse);
assert.throws(() => decode(LocationSubmission, { fix: location.fix }));
assert.throws(() => decode(LocationSubmission, { ...location, sharingRevision: "stale" }));
assert.throws(() => decode(DeviceLocation, { ...location.fix, userId: "untrusted-owner" }));
assert.throws(() => decode(DeviceLocation, { ...location.fix, latitude: 91 }));
console.log(
  "PASS: actual contracts accept optional revision envelope and legacy/coarse sends; reject invalid identity/revision/latitude"
);

const models = await read("apps/ios/Sources/Core/Models.swift");
function fields(name: string): Map<string, string> {
  const body = models.match(
    new RegExp(`public struct ${name}:[^{]+\\{([\\s\\S]*?)(?:public init|\\n\\})`)
  )?.[1];
  assert.ok(body, `Missing Swift model ${name}`);
  return new Map(
    [...body.matchAll(/public var (\w+): (\w+\??)/g)].map((match) => [match[1]!, match[2]!])
  );
}
const fix = fields("DeviceLocation");
assert.deepEqual([...fix.keys()].sort(), Object.keys(location.fix).sort());
assert.deepEqual(Object.fromEntries(fix), {
  latitude: "Double",
  longitude: "Double",
  accuracyMeters: "Double?",
  capturedAt: "String",
  device: "String",
});
assert.deepEqual(Object.fromEntries(fields("LocationSubmission")), {
  fix: "DeviceLocation",
  sharingRevision: "String",
});
assert.equal(fields("SendInput").get("location"), "LocationSubmission?");
console.log(
  "PASS: Swift location field names/types/optionality match the fixture and contract envelope (source check only)"
);

const changed = new Set(
  [
    ...git("diff", "--name-only", "-z", baseline).split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ].filter(Boolean)
);
for (const path of changed) {
  assert.ok(
    path.startsWith("apps/ios/") ||
      path.startsWith("specs/007.1-同步上游0.0.19/docs/20261117-iOS") ||
      path === "scripts/integration/check-v019-ios.ts" ||
      path === "scripts/integration/fixtures/v019-ios-location.json",
    `Outside Phase 5 scope: ${path}`
  );
  if (!path.startsWith("apps/ios/")) continue;
  assert.ok(
    path.endsWith(".swift") || path === "apps/ios/Resources/Info.plist",
    `Unexpected iOS asset/project/release change: ${path}`
  );
  assert.ok(
    !/Robot|BotGlyph|NativeDesign|GroupChannelAvatar/.test(path),
    `Artwork/animation change: ${path}`
  );
}
const testDiff = git("diff", "--unified=0", baseline, "--", "apps/ios/Tests");
assert.ok(
  !/^-[^-].*\b(XCTAssert\w*|XCTFail)\s*\(/m.test(testDiff),
  "Existing assertion removed/rewritten"
);
assert.ok(!/^\+[^+].*\bXCTSkip/m.test(testDiff), "Test skip added");
console.log(
  `PASS: ${changed.size} phase paths stay in scope; no removed XCTest assertions or added skips`
);

const swift = [...changed].filter((path) => path.endsWith(".swift")).sort();
const formatter = "/Library/Developer/CommandLineTools/usr/bin/swift-format";
for (const path of swift) {
  // SwiftSyntax parses only. Discard output: no formatting writes, SDK, compiler or test runner.
  execFileSync(formatter, ["format", resolve(root, path)], { stdio: ["ignore", "ignore", "pipe"] });
}
console.log(
  `PASS: SwiftSyntax parsed ${swift.length} Swift files; no Swift compilation or tests executed`
);

if (process.argv.includes("--rollback")) {
  const output = resolve(root, "output/integration-v019/ios");
  mkdirSync(output, { recursive: true });
  const temporary = mkdtempSync(resolve(output, "rollback-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: resolve(temporary, "index") };
    const groups = git("rev-list", "--reverse", `${baseline}..HEAD`)
      .trim()
      .split("\n")
      .filter((commit) =>
        git("diff-tree", "--no-commit-id", "--name-only", "-r", commit)
          .split("\n")
          .some((path) => path.startsWith("apps/ios/"))
      );
    assert.equal(
      groups.length,
      6,
      "Expected one independently reversible iOS commit per capability"
    );
    for (const commit of groups) {
      execFileSync("git", ["read-tree", "HEAD"], { cwd: root, env });
      execFileSync("git", ["apply", "--reverse", "--3way", "--cached"], {
        cwd: root,
        env,
        input: git("diff", `${commit}^`, commit),
        stdio: ["pipe", "pipe", "pipe"],
      });
      console.log(`PASS: isolated-index reverse application ${commit.slice(0, 9)}`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
