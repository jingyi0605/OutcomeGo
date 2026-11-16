import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "outcomego-build-command-"));
  roots.push(root);
  mkdirSync(join(root, "scripts/release"), { recursive: true });
  mkdirSync(join(root, "bin"));
  for (const script of ["build-images.sh", "smoke-image.sh"]) {
    copyFileSync(join(import.meta.dir, script), join(root, "scripts/release", script));
  }
  const docker = join(root, "bin/docker");
  writeFileSync(docker, `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['DOCKER_CALLS'], 'a') as log: log.write(json.dumps(args) + '\\n')
if args[0] == 'info': print('aarch64')
if args[:2] == ['buildx', 'build']:
    if os.environ.get('FAIL_BUILD'): sys.exit(1)
    path = args[args.index('--metadata-file') + 1]
    with open(path, 'w') as metadata: json.dump({'containerimage.digest': 'sha256:' + 'a' * 64}, metadata)
`);
  chmodSync(docker, 0o755);
  const log = join(root, "docker-calls.jsonl");
  const run = (args: string[], env: Record<string, string> = {}) => spawnSync("bash", [join(root, "scripts/release/build-images.sh"), ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, DOCKER_CALLS: log, ...env },
  });
  const calls = (): string[][] => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { root, run, calls };
};
const pinnedBase = `example.invalid/base@sha256:${"a".repeat(64)}`;

test("routine checks load four native images and smoke them without OCI exports or release digests", () => {
  const f = fixture();
  const result = f.run(["--computer-base", pinnedBase]);
  expect(result.status).toBe(0);
  const builds = f.calls().filter((args) => args[0] === "buildx");
  expect(builds).toHaveLength(4);
  for (const args of builds) {
    expect(args).toContain("--load");
    expect(args).toContain("linux/arm64");
    expect(args).not.toContain("--output");
  }
  expect(builds[3]).toContain(`COMPUTER_BASE=${pinnedBase}`);
  expect(f.calls().filter((args) => args[0] === "run")).toHaveLength(4);
  expect(existsSync(join(f.root, "output/outcomego-release-core/digests"))).toBe(false);
});

test.each(["linux/amd64", "linux/arm64,linux/amd64", "garbage"])("routine checks reject foreign or malformed platform %s before building", (platform) => {
  const f = fixture();
  expect(f.run(["--platform", platform]).status).toBe(2);
  expect(f.calls().filter((args) => args[0] === "buildx")).toHaveLength(0);
});

test("full local multiarch exports require the explicit gate flag", () => {
  const f = fixture();
  expect(f.run(["--multiarch-oci", "--image", "server"]).status).toBe(0);
  const build = f.calls().find((args) => args[0] === "buildx")!;
  expect(build).toContain("linux/amd64,linux/arm64");
  expect(build).toContain("--output");
  expect(build.some((arg) => arg.startsWith("type=oci,dest=") && arg.endsWith("/server.tar"))).toBe(true);
  expect(build).not.toContain("--load");
  expect(f.calls().filter((args) => args[0] === "run")).toHaveLength(0);
  expect(f.run(["--multiarch-oci", "--platform", "linux/arm64"]).status).toBe(2);
});

test("help needs no Docker daemon and explicit bases must be immutable", () => {
  const f = fixture();
  expect(f.run(["--help"]).status).toBe(0);
  expect(f.calls()).toHaveLength(0);
  expect(f.run(["--computer-base", "example.invalid/base:latest"]).status).toBe(2);
  expect(f.calls()).toHaveLength(0);
});

test("a failed build stops before smoke checks or subsequent images", () => {
  const f = fixture();
  expect(f.run(["--image", "server", "--image", "worker"], { FAIL_BUILD: "1" }).status).toBe(1);
  expect(f.calls().filter((args) => args[0] === "buildx")).toHaveLength(1);
  expect(f.calls().filter((args) => args[0] === "run")).toHaveLength(0);
});
