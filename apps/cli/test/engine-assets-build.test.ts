import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { stageEngineAssets, verifyEngineNotices, verifyWindowsPackageInventory } from "../scripts/engine-assets";

test("offline asset staging is deterministic and rejects unlisted components and changed inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "outcomego-stage-engine-"));
  try {
    const source = join(root, "input.qcow2");
    const manifest = join(root, "inputs.json");
    const name = `outcomego-engine-darwin-${"arm64"}.qcow2`;
    const bytes = "fixture content";
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const components = [{ name: "dummy", version: "1.2.3", license: "MIT", source: "https://example.invalid/source", notice: "LICENSE" }];
    const asset = { name, source, sha256: checksum, components: ["dummy@1.2.3"] };
    await writeFile(source, bytes);
    await writeFile(manifest, JSON.stringify({ components, assets: [asset] }));
    await stageEngineAssets(manifest, join(root, "build1"));
    await stageEngineAssets(manifest, join(root, "build2"));
    for (const file of [name, "SHA256SUMS", "engine-components.json"]) {
      expect(await readFile(join(root, "build1", file))).toEqual(await readFile(join(root, "build2", file)));
    }
    await writeFile(source, "tampered content");
    await expect(stageEngineAssets(manifest, join(root, "build3"))).rejects.toThrow("Unexpected SHA-256");
    await writeFile(manifest, JSON.stringify({ components, assets: [{ ...asset, components: ["other@1.0.0"] }] }));
    await expect(stageEngineAssets(manifest, join(root, "build4"))).rejects.toThrow("Undeclared engine component");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release review fails for missing or stale component notice metadata", () => {
  const components = [{ name: "dummy", version: "1.2.3", license: "MIT", source: "https://example.invalid/source", notice: "LICENSE" }];
  const notices = (value: unknown) => `登记\n\n\`\`\`engine-components-json\n${JSON.stringify(value)}\n\`\`\`\n`;
  expect(() => verifyEngineNotices(components, notices(components))).not.toThrow();
  expect(() => verifyEngineNotices(components, notices([]))).toThrow("differs");
  expect(() => verifyEngineNotices(components, notices([{ ...components[0], notice: "wrong" }]))).toThrow("differs");
});

test("Windows rootfs packages must match every reviewed binary version and architecture", () => {
  const status = `Package: docker.io
Status: install ok installed
Architecture: amd64
Version: 1:26.1.5+dfsg1-9
Description: Docker
 Package: unrelated text inside a continuation line

Package: ca-certificates
Status: install ok installed
Architecture: all
Version: 20250419

Package: removed
Status: deinstall ok config-files
Architecture: amd64
Version: 1.0
`;
  const packages = ["ca-certificates@20250419", "docker.io@1:26.1.5+dfsg1-9"];
  expect(() => verifyWindowsPackageInventory(status, packages)).not.toThrow();
  expect(() => verifyWindowsPackageInventory(status, packages.slice(0, 1))).toThrow("docker.io@1:26.1.5+dfsg1-9");
  expect(() => verifyWindowsPackageInventory(status.replace("1:26.1.5", "1:26.1.6"), packages)).toThrow("docker.io@1:26.1.6");
  expect(() => verifyWindowsPackageInventory(status.replace("amd64", "arm64"), packages)).toThrow("arm64");
});
